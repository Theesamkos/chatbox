/**
 * PluginBridge — Typed, protocol-aware postMessage communication layer
 *
 * This is NOT a generic event bus. It enforces the ChatBridge plugin contract
 * on every message crossing the iframe boundary:
 * - Origin validation against the registered plugin allowlist
 * - Message type routing with typed payloads
 * - Lifecycle state tracking
 * - Timeout watchdog (5s PLUGIN_READY, 10s TOOL_RESULT)
 * - Circuit breaker integration
 *
 * Security: allow-same-origin is NEVER included in the iframe sandbox attribute.
 * This is unconditional and origin-independent.
 */

import { v4 as uuidv4 } from 'uuid'
import type {
  AuditEventType,
  AuditLogEntry,
  AuditSeverity,
  CircuitBreakerState,
  FailureType,
  PluginCompletePayload,
  PluginErrorPayload,
  PluginFailureEntry,
  PluginId,
  PluginInitPayload,
  PluginManifest,
  PluginMessage,
  PluginMessageType,
  PluginReadyPayload,
  PluginRole,
  PluginSessionState,
  PluginStateSnapshot,
  StateUpdatePayload,
  ToolInvokePayload,
  ToolResultPayload,
} from './types'

// ─── Timeouts ─────────────────────────────────────────────────────────────────
const PLUGIN_READY_TIMEOUT_MS = 5_000
const TOOL_RESULT_TIMEOUT_MS = 10_000
const CIRCUIT_BREAKER_THRESHOLD = 3
const CIRCUIT_BREAKER_WINDOW_MS = 5 * 60 * 1_000 // 5 minutes
const CIRCUIT_BREAKER_RESET_MS = 15 * 60 * 1_000 // 15 minutes

// ─── Lifecycle States ─────────────────────────────────────────────────────────
export type PluginLifecycleState = 'loading' | 'ready' | 'active' | 'complete' | 'error' | 'disabled'

// ─── Event Callbacks ──────────────────────────────────────────────────────────
export interface PluginBridgeCallbacks {
  onReady: (pluginId: PluginId) => void
  onStateUpdate: (pluginId: PluginId, state: PluginStateSnapshot) => void
  onComplete: (pluginId: PluginId, payload: PluginCompletePayload) => void
  onError: (pluginId: PluginId, payload: PluginErrorPayload) => void
  onToolResult: (toolCallId: string, result: unknown, error: string | null) => void
  onLifecycleChange: (pluginId: PluginId, state: PluginLifecycleState) => void
  onAuditLog: (entry: AuditLogEntry) => void
  onPluginFailure: (entry: PluginFailureEntry) => void
}

// ─── Pending Tool Invocations ─────────────────────────────────────────────────
interface PendingToolCall {
  toolCallId: string
  toolName: string
  resolve: (result: ToolResultPayload) => void
  reject: (error: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

export class PluginBridge {
  private readonly manifest: PluginManifest
  private readonly sessionId: string
  private readonly userRole: PluginRole
  private readonly callbacks: PluginBridgeCallbacks
  private iframeRef: HTMLIFrameElement | null = null
  private lifecycleState: PluginLifecycleState = 'loading'
  private readyTimeoutHandle: ReturnType<typeof setTimeout> | null = null
  private pendingToolCalls: Map<string, PendingToolCall> = new Map()
  private circuitBreaker: CircuitBreakerState
  private messageHandler: ((event: MessageEvent) => void) | null = null

  constructor(
    manifest: PluginManifest,
    sessionId: string,
    userRole: PluginRole,
    callbacks: PluginBridgeCallbacks
  ) {
    this.manifest = manifest
    this.sessionId = sessionId
    this.userRole = userRole
    this.callbacks = callbacks
    this.circuitBreaker = {
      pluginId: manifest.id,
      conversationId: sessionId,
      failureCount: 0,
      firstFailureAt: 0,
      lastFailureAt: 0,
      disabled: false,
    }
  }

  // ─── Attach to iframe ───────────────────────────────────────────────────────

  attach(iframe: HTMLIFrameElement): void {
    this.iframeRef = iframe
    this.messageHandler = this.handleMessage.bind(this)
    window.addEventListener('message', this.messageHandler)

    // Start PLUGIN_READY timeout watchdog
    this.readyTimeoutHandle = setTimeout(() => {
      if (this.lifecycleState === 'loading') {
        this.handleLoadFailure('PLUGIN_READY not received within 5 seconds')
      }
    }, PLUGIN_READY_TIMEOUT_MS)
  }

  detach(): void {
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler)
      this.messageHandler = null
    }
    if (this.readyTimeoutHandle) {
      clearTimeout(this.readyTimeoutHandle)
      this.readyTimeoutHandle = null
    }
    // Cancel all pending tool calls
    for (const [, pending] of this.pendingToolCalls) {
      clearTimeout(pending.timeoutHandle)
      pending.reject(new Error('PluginBridge detached'))
    }
    this.pendingToolCalls.clear()
    this.iframeRef = null
  }

  // ─── Message Handler ────────────────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    // SECURITY: Validate origin before processing any message
    if (!this.validateOrigin(event.origin)) {
      this.log('INVALID_ORIGIN', 'warning', {
        receivedOrigin: event.origin,
        expectedOrigin: this.manifest.origin,
      })
      return // Silently drop — do not acknowledge to attacker
    }

    const message = event.data as PluginMessage
    if (!message || !message.type || message.pluginId !== this.manifest.id) {
      return // Malformed or wrong plugin — drop silently
    }

    // Validate version
    if (message.version !== '1.0') {
      this.log('MALFORMED_STATE', 'warning', { receivedVersion: message.version })
      return
    }

    switch (message.type as PluginMessageType) {
      case 'PLUGIN_READY':
        this.handlePluginReady(message as PluginMessage<PluginReadyPayload>)
        break
      case 'TOOL_RESULT':
        this.handleToolResult(message as PluginMessage<ToolResultPayload>)
        break
      case 'STATE_UPDATE':
        this.handleStateUpdate(message as PluginMessage<StateUpdatePayload>)
        break
      case 'PLUGIN_COMPLETE':
        this.handlePluginComplete(message as PluginMessage<PluginCompletePayload>)
        break
      case 'PLUGIN_ERROR':
        this.handlePluginError(message as PluginMessage<PluginErrorPayload>)
        break
      default:
        // Unknown message type — drop silently and log
        this.log('MALFORMED_STATE', 'warning', { unknownType: message.type })
    }
  }

  // ─── Origin Validation ──────────────────────────────────────────────────────

  private validateOrigin(origin: string): boolean {
    const registeredOrigin = this.manifest.origin

    // Exact match (covers the 'null' === 'null' case for srcdoc iframes)
    if (origin === registeredOrigin) return true

    // For null-origin plugins (srcdoc), only accept 'null' origin — already handled above.
    // Skip URL parsing for 'null' to avoid Invalid URL errors.
    if (registeredOrigin === 'null') return false

    // Allow localhost variants in development
    if (process.env.NODE_ENV === 'development') {
      try {
        const url = new URL(registeredOrigin)
        if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
          const incomingUrl = new URL(origin)
          if (
            (incomingUrl.hostname === 'localhost' || incomingUrl.hostname === '127.0.0.1') &&
            incomingUrl.port === url.port
          ) {
            return true
          }
        }
      } catch {
        // Malformed URL — reject
      }
    }

    return false
  }

  // ─── Lifecycle Handlers ─────────────────────────────────────────────────────

  private handlePluginReady(message: PluginMessage<PluginReadyPayload>): void {
    if (this.readyTimeoutHandle) {
      clearTimeout(this.readyTimeoutHandle)
      this.readyTimeoutHandle = null
    }
    this.setLifecycleState('ready')
    this.log('PLUGIN_READY', 'info', { capabilities: message.payload.capabilities })
    this.callbacks.onReady(this.manifest.id)

    // Send PLUGIN_INIT to the iframe with session context
    this.sendToPlugin<PluginInitPayload>('PLUGIN_INIT', {
      sessionId: this.sessionId,
      pluginId: this.manifest.id,
      userRole: this.userRole,
    })
    this.setLifecycleState('active')
  }

  private handleToolResult(message: PluginMessage<ToolResultPayload>): void {
    const { toolCallId, result, error } = message.payload
    const pending = this.pendingToolCalls.get(toolCallId)
    if (!pending) {
      // Delayed result after timeout — discard
      this.log('TOOL_RESULT', 'warning', {
        toolCallId,
        note: 'Received after timeout — discarded',
      })
      return
    }
    clearTimeout(pending.timeoutHandle)
    this.pendingToolCalls.delete(toolCallId)
    this.log('TOOL_RESULT', 'info', { toolCallId, toolName: pending.toolName, hasError: !!error })
    pending.resolve(message.payload)
    this.callbacks.onToolResult(toolCallId, result, error)
  }

  private handleStateUpdate(message: PluginMessage<StateUpdatePayload>): void {
    const { state } = message.payload
    // Validate state is not null/undefined
    if (!state || typeof state !== 'object') {
      this.log('MALFORMED_STATE', 'warning', { note: 'STATE_UPDATE payload.state is null or not an object' })
      this.recordFailure('malformed_state', 'STATE_UPDATE missing state object')
      return
    }
    // Security: scan string fields for injection patterns
    if (this.containsInjectionPattern(state)) {
      this.log('MALFORMED_STATE', 'error', { note: 'Injection pattern detected in state' })
      this.recordFailure('malformed_state', 'Injection pattern in STATE_UPDATE')
      return
    }
    this.callbacks.onStateUpdate(this.manifest.id, state as PluginStateSnapshot)
  }

  private handlePluginComplete(message: PluginMessage<PluginCompletePayload>): void {
    this.setLifecycleState('complete')
    this.log('PLUGIN_COMPLETE', 'info', { reason: message.payload.reason })
    this.callbacks.onComplete(this.manifest.id, message.payload)
  }

  private handlePluginError(message: PluginMessage<PluginErrorPayload>): void {
    this.setLifecycleState('error')
    this.log('PLUGIN_ERROR', 'error', {
      errorCode: message.payload.errorCode,
      errorMessage: message.payload.errorMessage,
    })
    this.recordFailure('tool_error', message.payload.errorMessage)
    this.callbacks.onError(this.manifest.id, message.payload)
  }

  private handleLoadFailure(detail: string): void {
    this.setLifecycleState('error')
    this.recordFailure('load_failure', detail)
    this.callbacks.onError(this.manifest.id, {
      errorCode: 'LOAD_FAILURE',
      errorMessage: 'This tool is temporarily unavailable. Your conversation will continue without it.',
      recoverable: false,
    })
  }

  // ─── Tool Invocation ────────────────────────────────────────────────────────

  invokeToolOnPlugin(toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResultPayload> {
    if (this.circuitBreaker.disabled) {
      return Promise.reject(new Error('Plugin disabled by circuit breaker'))
    }
    if (this.lifecycleState !== 'active' && this.lifecycleState !== 'ready') {
      return Promise.reject(new Error(`Plugin not active (state: ${this.lifecycleState})`))
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingToolCalls.delete(toolCallId)
        this.log('TIMEOUT', 'error', { toolCallId, toolName })
        this.recordFailure('timeout', `TOOL_RESULT not received within ${TOOL_RESULT_TIMEOUT_MS}ms`)
        reject(new Error(`Tool invocation timeout: ${toolName}`))
      }, TOOL_RESULT_TIMEOUT_MS)

      this.pendingToolCalls.set(toolCallId, {
        toolCallId,
        toolName,
        resolve,
        reject,
        timeoutHandle,
      })

      this.sendToPlugin<ToolInvokePayload>('TOOL_INVOKE', {
        toolCallId,
        toolName,
        arguments: args,
      })
      this.log('TOOL_INVOKE', 'info', { toolCallId, toolName })
    })
  }

  // ─── Send to Plugin ─────────────────────────────────────────────────────────

  private sendToPlugin<T>(type: PluginMessageType, payload: T): void {
    if (!this.iframeRef?.contentWindow) return
    const message: PluginMessage<T> = {
      type,
      pluginId: this.manifest.id,
      sessionId: this.sessionId,
      payload,
      timestamp: Date.now(),
      version: '1.0',
    }
    // srcdoc iframes report origin as the string "null" — browsers reject postMessage(msg, "null").
    // Use '*' for null-origin plugins; they are already sandboxed by the iframe sandbox attribute.
    const targetOrigin = this.manifest.origin === 'null' ? '*' : this.manifest.origin
    this.iframeRef.contentWindow.postMessage(message, targetOrigin)
  }

  // ─── Circuit Breaker ────────────────────────────────────────────────────────

  private recordFailure(failureType: FailureType, detail: string): void {
    const now = Date.now()

    // Reset counter if outside the window
    if (now - this.circuitBreaker.firstFailureAt > CIRCUIT_BREAKER_WINDOW_MS) {
      this.circuitBreaker.failureCount = 0
      this.circuitBreaker.firstFailureAt = now
    }

    this.circuitBreaker.failureCount++
    this.circuitBreaker.lastFailureAt = now
    if (this.circuitBreaker.failureCount === 1) {
      this.circuitBreaker.firstFailureAt = now
    }

    const entry: PluginFailureEntry = {
      id: uuidv4(),
      pluginId: this.manifest.id,
      conversationId: this.sessionId,
      failureType,
      errorDetail: detail,
      resolved: false,
      createdAt: now,
    }
    this.callbacks.onPluginFailure(entry)

    // Check circuit breaker threshold
    if (this.circuitBreaker.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreaker.disabled = true
      this.circuitBreaker.disabledAt = now
      this.setLifecycleState('disabled')
      this.log('CIRCUIT_BREAKER_ACTIVATED', 'critical', {
        failureCount: this.circuitBreaker.failureCount,
        window: CIRCUIT_BREAKER_WINDOW_MS,
      })

      // Auto-reset after 15 minutes
      setTimeout(() => {
        this.circuitBreaker.disabled = false
        this.circuitBreaker.failureCount = 0
        this.setLifecycleState('loading')
      }, CIRCUIT_BREAKER_RESET_MS)
    }
  }

  // ─── Injection Detection ────────────────────────────────────────────────────

  private containsInjectionPattern(obj: unknown): boolean {
    const INJECTION_PATTERNS = [
      /ignore\s+previous\s+instructions/i,
      /you\s+are\s+now\s+a\s+different\s+ai/i,
      /disregard\s+your\s+guidelines/i,
      /pretend\s+you\s+are/i,
      /forget\s+your\s+training/i,
      /<script[\s>]/i,
      /javascript:/i,
      /data:text\/html/i,
    ]

    const checkString = (s: string): boolean =>
      INJECTION_PATTERNS.some((pattern) => pattern.test(s))

    const traverse = (value: unknown): boolean => {
      if (typeof value === 'string') return checkString(value)
      if (Array.isArray(value)) return value.some(traverse)
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some(traverse)
      }
      return false
    }

    return traverse(obj)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private setLifecycleState(state: PluginLifecycleState): void {
    this.lifecycleState = state
    this.callbacks.onLifecycleChange(this.manifest.id, state)
  }

  private log(eventType: AuditEventType, severity: AuditSeverity, payload: Record<string, unknown>): void {
    const entry: AuditLogEntry = {
      id: uuidv4(),
      eventType,
      conversationId: this.sessionId,
      pluginId: this.manifest.id,
      payload,
      severity,
      createdAt: Date.now(),
    }
    this.callbacks.onAuditLog(entry)
  }

  // ─── Getters ─────────────────────────────────────────────────────────────────

  getLifecycleState(): PluginLifecycleState { return this.lifecycleState }
  getManifest(): PluginManifest { return this.manifest }
  isDisabled(): boolean { return this.circuitBreaker.disabled }
  getCircuitBreakerState(): CircuitBreakerState { return { ...this.circuitBreaker } }
}

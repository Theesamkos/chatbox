/**
 * useK12Plugin — React hook for managing a K-12 plugin within a Chatbox session
 *
 * This hook is the central coordinator for:
 * - Plugin lifecycle (loading → ready → active → complete)
 * - Plugin state management (updated via STATE_UPDATE messages)
 * - Tool invocation routing (LLM → PluginBridge → TOOL_INVOKE → TOOL_RESULT → LLM)
 * - Safety layer integration (pre-input, post-output, state checks)
 * - Audit logging
 * - Circuit breaker state
 *
 * Usage: Mount in the session route when a K-12 plugin is active.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  type AuditLogEntry,
  AuditLogger,
  type PluginBridgeCallbacks,
  type PluginCompletePayload,
  type PluginErrorPayload,
  type PluginFailureEntry,
  type PluginId,
  type PluginLifecycleState,
  type PluginManifest,
  type PluginRole,
  type PluginStateSnapshot,
  type ToolResultPayload,
  auditLogger,
  pluginRegistry,
  safetyLayer,
} from '../packages/plugin-bridge'
import { PluginBridge } from '../packages/plugin-bridge/PluginBridge'
import {
  clearActivePluginState,
  registerPluginToolInvoker,
  setActivePluginState,
  unregisterPluginToolInvoker,
} from '../stores/pluginStateStore'

// ─── Hook State ───────────────────────────────────────────────────────────────

export interface K12PluginState {
  pluginId: PluginId | null
  lifecycleState: PluginLifecycleState
  pluginState: PluginStateSnapshot | null
  isActive: boolean
  isComplete: boolean
  isDisabled: boolean
  errorMessage: string | null
  lastCompletionPayload: PluginCompletePayload | null
}

export interface K12PluginActions {
  launchPlugin: (pluginId: PluginId) => void
  dismissPlugin: () => void
  attachIframe: (iframe: HTMLIFrameElement) => void
  detachIframe: () => void
  invokeTool: (toolCallId: string, toolName: string, args: Record<string, unknown>) => Promise<ToolResultPayload>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useK12Plugin(
  sessionId: string,
  userRole: PluginRole = 'student'
): [K12PluginState, K12PluginActions] {
  const [pluginId, setPluginId] = useState<PluginId | null>(null)
  const [lifecycleState, setLifecycleState] = useState<PluginLifecycleState>('loading')
  const [pluginState, setPluginState] = useState<PluginStateSnapshot | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lastCompletionPayload, setLastCompletionPayload] = useState<PluginCompletePayload | null>(null)

  const bridgeRef = useRef<PluginBridge | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)

  // ─── Callbacks ──────────────────────────────────────────────────────────────

  const callbacks: PluginBridgeCallbacks = {
    onReady: (id: PluginId) => {
      setPluginId(id)
      setLifecycleState('ready')
    },
    onStateUpdate: (id: PluginId, state: PluginStateSnapshot) => {
      // Safety check on incoming state
      if (!safetyLayer.checkPluginState(state, sessionId)) {
        return // State rejected — logged by safety layer
      }
      setPluginState(state)
      // Sync to module-level store so generation.ts can inject it into the system prompt
      setActivePluginState(sessionId, state)
    },
    onComplete: (id: PluginId, payload: PluginCompletePayload) => {
      setLifecycleState('complete')
      setLastCompletionPayload(payload)
      if (payload.finalState) {
        setPluginState(payload.finalState)
        setActivePluginState(sessionId, payload.finalState)
      }
    },
    onError: (id: PluginId, payload: PluginErrorPayload) => {
      setLifecycleState('error')
      setErrorMessage(payload.errorMessage)
    },
    onToolResult: (toolCallId: string, result: unknown, error: string | null) => {
      // Tool result is handled via the Promise returned by invokeTool
      // This callback is for side effects (logging, UI updates)
    },
    onLifecycleChange: (id: PluginId, state: PluginLifecycleState) => {
      setLifecycleState(state)
      if (state === 'disabled') {
        setErrorMessage(
          'This tool has been temporarily disabled due to repeated errors. It will be available again in 15 minutes.'
        )
      }
    },
    onAuditLog: (entry: AuditLogEntry) => {
      auditLogger.logAuditEvent(entry)
    },
    onPluginFailure: (entry: PluginFailureEntry) => {
      auditLogger.logPluginFailure(entry)
    },
  }

  // ─── Actions ────────────────────────────────────────────────────────────────

  const launchPlugin = useCallback(
    (id: PluginId) => {
      // Clean up any existing bridge
      if (bridgeRef.current) {
        bridgeRef.current.detach()
        bridgeRef.current = null
      }

      const registration = pluginRegistry.getPlugin(id)
      if (!registration) {
        setErrorMessage(`Plugin ${id} is not registered.`)
        return
      }
      if (!pluginRegistry.isAllowlisted(id)) {
        setErrorMessage(`Plugin ${id} is not available.`)
        return
      }
      if (!registration.manifest.allowedRoles.includes(userRole)) {
        setErrorMessage(`You don't have permission to use this tool.`)
        return
      }

      setPluginId(id)
      setLifecycleState('loading')
      setPluginState(null)
      setErrorMessage(null)
      setLastCompletionPayload(null)
      // Clear stale plugin state from the module-level store
      clearActivePluginState(sessionId)

      bridgeRef.current = new PluginBridge(registration.manifest, sessionId, userRole, callbacks)

      // Register the tool invoker so generation.ts can route AI tool calls to this bridge
      const bridge = bridgeRef.current
      registerPluginToolInvoker(sessionId, (toolCallId, toolName, args) =>
        bridge.invokeToolOnPlugin(toolCallId, toolName, args)
      )

      // If iframe is already attached, attach the bridge to it
      if (iframeRef.current) {
        bridgeRef.current.attach(iframeRef.current)
      }
    },
    [sessionId, userRole]
  )

  const dismissPlugin = useCallback(() => {
    if (bridgeRef.current) {
      bridgeRef.current.detach()
      bridgeRef.current = null
    }
    setPluginId(null)
    setLifecycleState('loading')
    setPluginState(null)
    setErrorMessage(null)
    setLastCompletionPayload(null)
    // Clear plugin state and tool invoker from module-level store
    clearActivePluginState(sessionId)
    unregisterPluginToolInvoker(sessionId)
  }, [sessionId])

  const attachIframe = useCallback((iframe: HTMLIFrameElement) => {
    iframeRef.current = iframe
    if (bridgeRef.current) {
      bridgeRef.current.attach(iframe)
    }
  }, [])

  const detachIframe = useCallback(() => {
    if (bridgeRef.current) {
      bridgeRef.current.detach()
    }
    iframeRef.current = null
  }, [])

  const invokeTool = useCallback(
    (toolCallId: string, toolName: string, args: Record<string, unknown>): Promise<ToolResultPayload> => {
      if (!bridgeRef.current) {
        return Promise.reject(new Error('No active plugin bridge'))
      }
      return bridgeRef.current.invokeToolOnPlugin(toolCallId, toolName, args)
    },
    []
  )

  // ─── Cleanup ────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (bridgeRef.current) {
        bridgeRef.current.detach()
        bridgeRef.current = null
      }
      // Clear plugin state from module-level store on unmount
      clearActivePluginState(sessionId)
    }
  }, [sessionId])

  // ─── Derived State ───────────────────────────────────────────────────────────

  const state: K12PluginState = {
    pluginId,
    lifecycleState,
    pluginState,
    isActive: lifecycleState === 'active' || lifecycleState === 'ready',
    isComplete: lifecycleState === 'complete',
    isDisabled: lifecycleState === 'disabled',
    errorMessage,
    lastCompletionPayload,
  }

  const actions: K12PluginActions = {
    launchPlugin,
    dismissPlugin,
    attachIframe,
    detachIframe,
    invokeTool,
  }

  return [state, actions]
}

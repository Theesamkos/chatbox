/**
 * ChatBridge Plugin Protocol Types
 * Version: 1.0
 *
 * All messages crossing the iframe boundary use this typed envelope.
 * The parent window validates event.origin against the registered plugin origin
 * before processing any message. Messages from unregistered origins are silently
 * dropped and logged.
 */

export type PluginMessageType =
  | 'PLUGIN_READY'
  | 'TOOL_INVOKE'
  | 'TOOL_RESULT'
  | 'STATE_UPDATE'
  | 'PLUGIN_COMPLETE'
  | 'PLUGIN_ERROR'
  | 'SESSION_PAUSED'
  | 'PLUGIN_INIT' // Sent FROM platform TO plugin on load

export type PluginId = 'chess' | 'timeline' | 'artifact_studio'

export type PluginLifecycleType =
  | 'continuous_bidirectional'   // Chess: runs until game ends
  | 'structured_completion'      // Timeline: defined end state
  | 'guided_multistep'           // Artifact Studio: phases

export type PluginStatus = 'active' | 'disabled' | 'suspended'

export type PluginRole = 'student' | 'teacher' | 'admin'

export interface PluginToolSchema {
  name: string
  description: string
  parameters: {
    type: 'object'
    required: string[]
    properties: Record<string, { type: string; description: string; enum?: string[] }>
  }
}

export interface PluginManifest {
  id: PluginId
  name: string
  version: string
  description: string
  origin: string        // Validated against event.origin on every postMessage
  iframeUrl: string     // The URL loaded in the iframe src
  allowedRoles: PluginRole[]
  lifecycleType: PluginLifecycleType
  stateSchema: Record<string, unknown>  // JSON Schema for state validation
  tools: PluginToolSchema[]
}

// ─── Message Envelope ────────────────────────────────────────────────────────

export interface PluginMessage<T = unknown> {
  type: PluginMessageType
  pluginId: PluginId
  sessionId: string
  payload: T
  timestamp: number
  version: '1.0'
}

// ─── Payload Types ────────────────────────────────────────────────────────────

export interface PluginReadyPayload {
  version: string
  capabilities: string[]
}

export interface ToolInvokePayload {
  toolCallId: string
  toolName: string
  arguments: Record<string, unknown>
}

export interface ToolResultPayload {
  toolCallId: string
  result: unknown
  error: string | null
}

export interface StateUpdatePayload {
  state: PluginStateSnapshot
}

export interface PluginCompletePayload {
  reason: string
  finalState: PluginStateSnapshot
}

export interface PluginErrorPayload {
  errorCode: string
  errorMessage: string
  recoverable: boolean
}

export interface PluginInitPayload {
  sessionId: string
  pluginId: PluginId
  userRole: PluginRole
}

// ─── State Snapshots ──────────────────────────────────────────────────────────

export interface ChessState {
  type: 'chess'
  fen: string
  turn: 'white' | 'black'
  moveHistory: string[]
  status: 'active' | 'checkmate' | 'stalemate' | 'draw' | 'resigned'
  lastMove: string | null
  capturedPieces: { white: string[]; black: string[] }
  /** True when the state update was triggered by a human player move — signals AI to respond */
  humanMove?: boolean
}

export interface TimelineEvent {
  id: string
  name: string
  year: number
  description: string
  placed: boolean
}

export interface TimelineState {
  type: 'timeline'
  topic: string
  events: TimelineEvent[]
  status: 'in_progress' | 'complete' | 'error'
  studentOrder: string[]
  correctOrder: string[]
  score?: number
  perItemCorrectness?: Record<string, boolean>
}

export interface ArtifactInvestigation {
  observations: string
  evidence: string
  claims: string
}

export interface ArtifactItem {
  id: string
  source: 'smithsonian' | 'loc'
  title: string
  date: string
  medium?: string
  imageUrl: string
  metadata: Record<string, unknown>
}

export interface ArtifactState {
  type: 'artifact_investigation'
  phase: 'discover' | 'inspect' | 'investigate' | 'conclude'
  selectedArtifact: ArtifactItem | null
  investigation: ArtifactInvestigation
  status: 'in_progress' | 'complete' | 'error'
  searchHistory: string[]
}

export type PluginStateSnapshot = ChessState | TimelineState | ArtifactState

// ─── Plugin Registry (stored in electron-store) ───────────────────────────────

export interface PluginRegistration {
  manifest: PluginManifest
  status: PluginStatus
  registeredAt: number
  updatedAt: number
}

export interface PluginRegistry {
  plugins: Record<PluginId, PluginRegistration>
}

// ─── Plugin Session State ─────────────────────────────────────────────────────

export interface PluginSessionState {
  pluginId: PluginId
  conversationId: string
  state: PluginStateSnapshot
  version: number
  updatedAt: number
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

export type AuditEventType =
  | 'PLUGIN_READY'
  | 'TOOL_INVOKE'
  | 'TOOL_RESULT'
  | 'PLUGIN_COMPLETE'
  | 'PLUGIN_ERROR'
  | 'SAFETY_BLOCK'
  | 'CIRCUIT_BREAKER_ACTIVATED'
  | 'INVALID_ORIGIN'
  | 'MALFORMED_STATE'
  | 'UNREGISTERED_TOOL_INVOKE'
  | 'EXTERNAL_API_FAILURE'
  | 'LOAD_FAILURE'
  | 'TIMEOUT'

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface AuditLogEntry {
  id: string
  eventType: AuditEventType
  userId?: string
  conversationId?: string
  pluginId?: PluginId
  payload: Record<string, unknown>
  severity: AuditSeverity
  createdAt: number
}

// ─── Plugin Failure ───────────────────────────────────────────────────────────

export type FailureType =
  | 'timeout'
  | 'load_failure'
  | 'invalid_origin'
  | 'malformed_state'
  | 'tool_error'
  | 'circuit_breaker'

export interface PluginFailureEntry {
  id: string
  pluginId: PluginId
  conversationId?: string
  failureType: FailureType
  errorDetail: string
  resolved: boolean
  createdAt: number
}

// ─── Safety Events ────────────────────────────────────────────────────────────

export type SafetyEventType =
  | 'input_blocked'
  | 'output_flagged'
  | 'injection_detected'
  | 'session_frozen'
  | 'content_filtered'

export type SafetyAction = 'blocked' | 'sanitized' | 'flagged_for_review' | 'session_frozen'

export interface SafetyEventEntry {
  id: string
  userId?: string
  conversationId?: string
  eventType: SafetyEventType
  triggerContent: string
  action: SafetyAction
  reviewedBy?: string
  createdAt: number
}

// ─── Circuit Breaker State ────────────────────────────────────────────────────

export interface CircuitBreakerState {
  pluginId: PluginId
  conversationId: string
  failureCount: number
  firstFailureAt: number
  lastFailureAt: number
  disabled: boolean
  disabledAt?: number
}

/**
 * pluginStateStore — Bridges the K-12 plugin React state and the AI generation pipeline.
 *
 * The generation pipeline runs outside React (in sessionActions/generation.ts) so it
 * cannot read React state directly.  This module-level map lets useK12Plugin push the
 * latest PluginStateSnapshot for a session, and lets genMessageContext pull it when
 * building the prompt.
 *
 * It also holds a tool invoker function per session so that stream-text.ts can route
 * AI tool calls (chess__make_move, chess__start_game, etc.) to the correct plugin bridge.
 *
 * Design: simple Map — no Zustand needed, no subscription overhead.
 */

import type { PluginStateSnapshot } from '@/packages/plugin-bridge/types'

// sessionId → latest plugin state snapshot
const _stateStore = new Map<string, PluginStateSnapshot>()

// sessionId → tool invoker function (provided by useK12Plugin)
type ToolInvoker = (toolCallId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>
const _toolInvokerStore = new Map<string, ToolInvoker>()

// ─── State API ────────────────────────────────────────────────────────────────

/** Called by useK12Plugin whenever onStateUpdate fires */
export function setActivePluginState(sessionId: string, state: PluginStateSnapshot | null): void {
  if (state === null) {
    _stateStore.delete(sessionId)
  } else {
    _stateStore.set(sessionId, state)
  }
}

/** Called by genMessageContext to get the current plugin state for a session */
export function getActivePluginState(sessionId: string): PluginStateSnapshot | null {
  return _stateStore.get(sessionId) ?? null
}

/** Called when a session is closed/dismissed to free memory */
export function clearActivePluginState(sessionId: string): void {
  _stateStore.delete(sessionId)
  _toolInvokerStore.delete(sessionId)
}

// ─── Tool Invoker API ─────────────────────────────────────────────────────────

/**
 * Register a tool invoker for a session.
 * Called by useK12Plugin when a plugin is launched.
 */
export function registerPluginToolInvoker(sessionId: string, invoker: ToolInvoker): void {
  _toolInvokerStore.set(sessionId, invoker)
}

/**
 * Unregister the tool invoker for a session.
 * Called by useK12Plugin when a plugin is dismissed or unmounted.
 */
export function unregisterPluginToolInvoker(sessionId: string): void {
  _toolInvokerStore.delete(sessionId)
}

/**
 * Invoke a plugin tool for a session.
 * Called by the AI tool executor in stream-text.ts.
 * Returns null if no invoker is registered (plugin not active).
 */
export async function invokePluginTool(
  sessionId: string,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const invoker = _toolInvokerStore.get(sessionId)
  if (!invoker) {
    throw new Error(`No active plugin for session ${sessionId}. Tool ${toolName} cannot be invoked.`)
  }
  return invoker(toolCallId, toolName, args)
}

/** Check if a session has an active plugin tool invoker */
export function hasActivePlugin(sessionId: string): boolean {
  return _toolInvokerStore.has(sessionId)
}

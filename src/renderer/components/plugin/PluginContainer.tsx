/**
 * PluginContainer — Sandboxed iframe host for K-12 plugins
 *
 * Security model:
 * - sandbox="allow-scripts" ONLY — no allow-same-origin, no allow-forms, no allow-popups
 * - srcdoc is used for built-in plugins (origin = "null")
 * - All communication goes through PluginBridge (typed postMessage)
 * - No direct DOM access from plugin to parent
 *
 * Layout:
 * - When plugin is active: split-view (chat left, plugin right)
 * - When plugin completes: collapses back to full-width chat
 * - Resizable split pane
 */

import { AlertCircle, ChevronRight, Loader2, X, ZapOff } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import type { K12PluginActions, K12PluginState } from '../../hooks/useK12Plugin'
import type { PluginId } from '../../packages/plugin-bridge'

// ─── Plugin HTML Sources (built-in plugins) ───────────────────────────────────
// These are imported at build time and embedded as srcdoc to avoid external requests
// The iframe origin will be "null" which is handled in PluginBridge origin validation

const PLUGIN_DISPLAY_NAMES: Record<PluginId, string> = {
  chess: 'Chess',
  timeline: 'Timeline Builder',
  artifact_studio: 'Artifact Investigation Studio',
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface PluginContainerProps {
  state: K12PluginState
  actions: K12PluginActions
  pluginHtmlContent: string | null
  onClose?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PluginContainer({ state, actions, pluginHtmlContent, onClose }: PluginContainerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Attach/detach the iframe to the PluginBridge
  useEffect(() => {
    if (iframeRef.current && state.pluginId) {
      actions.attachIframe(iframeRef.current)
    }
    return () => {
      actions.detachIframe()
    }
  }, [state.pluginId, actions])

  const handleClose = useCallback(() => {
    actions.dismissPlugin()
    onClose?.()
  }, [actions, onClose])

  if (!state.pluginId || !pluginHtmlContent) {
    return null
  }

  const displayName = PLUGIN_DISPLAY_NAMES[state.pluginId] ?? state.pluginId

  return (
    <div className="plugin-container flex flex-col h-full bg-[#0f0f0f] border-l border-white/10 relative">
      {/* Header */}
      <div className="plugin-header flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#141414]">
        <div className="flex items-center gap-2">
          <PluginStatusIndicator state={state} />
          <span className="text-sm font-semibold text-white/90 tracking-tight">{displayName}</span>
        </div>
        <div className="flex items-center gap-2">
          {state.lifecycleState === 'complete' && (
            <span className="text-xs text-emerald-400 font-medium px-2 py-0.5 rounded-full bg-emerald-400/10">
              Complete
            </span>
          )}
          <button
            onClick={handleClose}
            className="p-1.5 rounded-md text-white/40 hover:text-white/80 hover:bg-white/10 transition-colors"
            aria-label="Close tool"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Plugin iframe */}
      <div className="plugin-iframe-wrapper flex-1 relative overflow-hidden">
        {/* Loading overlay */}
        {state.lifecycleState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0f0f0f] z-10">
            <Loader2 size={24} className="text-blue-400 animate-spin" />
            <span className="text-sm text-white/50">Loading {displayName}...</span>
          </div>
        )}

        {/* Error overlay */}
        {(state.lifecycleState === 'error' || state.lifecycleState === 'disabled') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#0f0f0f] z-10 px-6 text-center">
            {state.lifecycleState === 'disabled' ? (
              <ZapOff size={32} className="text-amber-400" />
            ) : (
              <AlertCircle size={32} className="text-red-400" />
            )}
            <div>
              <p className="text-sm font-medium text-white/80 mb-1">
                {state.lifecycleState === 'disabled' ? 'Tool Temporarily Disabled' : 'Tool Unavailable'}
              </p>
              <p className="text-xs text-white/40 max-w-xs">
                {state.errorMessage ?? 'This tool is temporarily unavailable. Your conversation will continue without it.'}
              </p>
            </div>
          </div>
        )}

        {/* The iframe — sandboxed, no allow-same-origin */}
        <iframe
          ref={iframeRef}
          srcDoc={pluginHtmlContent}
          sandbox="allow-scripts"
          className="w-full h-full border-0"
          title={displayName}
          aria-label={`${displayName} interactive tool`}
        />
      </div>

      {/* Completion banner */}
      {state.lifecycleState === 'complete' && state.lastCompletionPayload && (
        <div className="plugin-completion-banner px-4 py-3 bg-emerald-500/10 border-t border-emerald-500/20">
          <div className="flex items-center gap-2">
            <ChevronRight size={14} className="text-emerald-400" />
            <span className="text-xs text-emerald-300">
              Activity complete — see the chat for feedback
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Status Indicator ─────────────────────────────────────────────────────────

function PluginStatusIndicator({ state }: { state: K12PluginState }) {
  const { lifecycleState } = state

  if (lifecycleState === 'loading') {
    return <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
  }
  if (lifecycleState === 'active' || lifecycleState === 'ready') {
    return <div className="w-2 h-2 rounded-full bg-emerald-400" />
  }
  if (lifecycleState === 'complete') {
    return <div className="w-2 h-2 rounded-full bg-blue-400" />
  }
  if (lifecycleState === 'error' || lifecycleState === 'disabled') {
    return <div className="w-2 h-2 rounded-full bg-red-400" />
  }
  return <div className="w-2 h-2 rounded-full bg-white/20" />
}

export default PluginContainer

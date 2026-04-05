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

import { AlertCircle, ChevronDown, ChevronRight, Loader2, X, ZapOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { K12PluginActions, K12PluginState } from '../../hooks/useK12Plugin'
import type { PluginId } from '../../packages/plugin-bridge'

// ─── Plugin display names & game list ────────────────────────────────────────

const PLUGIN_DISPLAY_NAMES: Record<PluginId, string> = {
  chess: 'Chess',
  timeline: 'Timeline Builder',
  artifact_studio: 'Artifact Investigation Studio',
}

const GAME_LIST: { id: PluginId; label: string }[] = [
  { id: 'chess', label: 'Chess' },
  { id: 'timeline', label: 'Timeline Builder' },
  { id: 'artifact_studio', label: 'Artifact Studio' },
]

// ─── Props ────────────────────────────────────────────────────────────────────

interface PluginContainerProps {
  state: K12PluginState
  actions: K12PluginActions
  pluginHtmlContent: string | null
  onClose?: () => void
  onGameSwitch?: (pluginId: PluginId) => void
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PluginContainer({ state, actions, pluginHtmlContent, onClose, onGameSwitch }: PluginContainerProps) {
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

  // API_PROXY_REQUEST handler — plugins run without allow-same-origin so they
  // cannot fetch() directly. They post API_PROXY_REQUEST; we fetch from the
  // parent frame (which has full network access) and reply with API_PROXY_RESPONSE.
  useEffect(() => {
    const handleProxyRequest = async (event: MessageEvent) => {
      if (!event.data || event.data.type !== 'API_PROXY_REQUEST') return
      const msg = event.data as {
        type: string
        requestId: string
        url: string
        method?: string
        body?: string | null
        headers?: Record<string, string> | null
        sessionId?: string
        pluginId?: string
      }
      const { requestId, url, method = 'GET', body, headers } = msg
      const iframe = iframeRef.current
      if (!iframe?.contentWindow) return
      try {
        const fetchOptions: RequestInit = {
          method,
          headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
        }
        if (body) fetchOptions.body = body
        const res = await fetch(url, fetchOptions)
        const data = await res.json().catch(() => null)
        iframe.contentWindow.postMessage({
          type: 'API_PROXY_RESPONSE',
          requestId,
          sessionId: msg.sessionId,
          pluginId: msg.pluginId,
          ok: res.ok,
          status: res.status,
          data,
        }, '*')
      } catch {
        iframe.contentWindow?.postMessage({
          type: 'API_PROXY_RESPONSE',
          requestId,
          sessionId: msg.sessionId,
          pluginId: msg.pluginId,
          ok: false,
          status: 0,
          data: null,
        }, '*')
      }
    }
    window.addEventListener('message', handleProxyRequest)
    return () => window.removeEventListener('message', handleProxyRequest)
  }, [])

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
          <GameSwitcherDropdown
            activePluginId={state.pluginId}
            displayName={displayName}
            onSwitch={onGameSwitch}
          />
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

// ─── Game Switcher Dropdown ───────────────────────────────────────────────────

function GameSwitcherDropdown({
  activePluginId,
  displayName,
  onSwitch,
}: {
  activePluginId: PluginId | null
  displayName: string
  onSwitch?: (id: PluginId) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  if (!onSwitch) {
    return <span className="text-sm font-semibold text-white/90 tracking-tight">{displayName}</span>
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-sm font-semibold text-white/90 hover:text-white transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{displayName}</span>
        <ChevronDown
          size={12}
          className={`text-white/50 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && (
        <div
          className="absolute top-full left-0 mt-1.5 w-52 bg-[#1c1c1c] border border-white/10 rounded-lg shadow-2xl z-50 overflow-hidden"
          role="listbox"
        >
          <div className="px-3 py-1.5 text-xs text-white/35 font-medium uppercase tracking-wider border-b border-white/5">
            Switch Activity
          </div>
          {GAME_LIST.map((game) => {
            const isActive = game.id === activePluginId
            return (
              <button
                key={game.id}
                role="option"
                aria-selected={isActive}
                disabled={isActive}
                onClick={() => {
                  onSwitch(game.id)
                  setOpen(false)
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left transition-colors ${
                  isActive
                    ? 'text-blue-400 bg-blue-500/10 cursor-default'
                    : 'text-white/70 hover:bg-white/5 hover:text-white cursor-pointer'
                }`}
              >
                <span className="flex-1">{game.label}</span>
                {isActive && (
                  <span className="text-xs text-blue-400 bg-blue-500/15 px-1.5 py-0.5 rounded-full">
                    Active
                  </span>
                )}
              </button>
            )
          })}
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

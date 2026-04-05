/**
 * K12SessionLayout — Split-view layout for K-12 plugin sessions
 *
 * When a plugin is active: chat on left (40%), plugin on right (60%)
 * When no plugin: full-width chat
 * Resizable via drag handle
 * Responsive: stacks vertically on small screens
 */

import { useCallback, useRef, useState } from 'react'
import type { K12PluginActions, K12PluginState } from '../../hooks/useK12Plugin'
import type { PluginId } from '../../packages/plugin-bridge'
import { PluginContainer } from './PluginContainer'

interface K12SessionLayoutProps {
  children: React.ReactNode  // The chat panel
  pluginState: K12PluginState
  pluginActions: K12PluginActions
  pluginHtmlContent: string | null
  onPluginClose?: () => void
  onGameSwitch?: (pluginId: PluginId) => void
}

const MIN_CHAT_WIDTH = 320  // px
const MIN_PLUGIN_WIDTH = 280  // px

export function K12SessionLayout({
  children,
  pluginState,
  pluginActions,
  pluginHtmlContent,
  onPluginClose,
  onGameSwitch,
}: K12SessionLayoutProps) {
  const [chatWidthPercent, setChatWidthPercent] = useState(42)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const showPlugin = pluginState.pluginId !== null && pluginHtmlContent !== null

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDragging.current = true

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const totalWidth = rect.width
      const newChatWidth = moveEvent.clientX - rect.left
      const newChatPercent = (newChatWidth / totalWidth) * 100

      // Enforce min widths
      const minChatPercent = (MIN_CHAT_WIDTH / totalWidth) * 100
      const minPluginPercent = (MIN_PLUGIN_WIDTH / totalWidth) * 100
      const maxChatPercent = 100 - minPluginPercent

      setChatWidthPercent(Math.max(minChatPercent, Math.min(maxChatPercent, newChatPercent)))
    }

    const onMouseUp = () => {
      isDragging.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [])

  if (!showPlugin) {
    return <>{children}</>
  }

  return (
    <div
      ref={containerRef}
      className="k12-session-layout flex h-full w-full overflow-hidden"
      style={{ userSelect: isDragging.current ? 'none' : 'auto' }}
    >
      {/* Chat panel */}
      <div
        className="chat-panel flex flex-col h-full overflow-hidden"
        style={{ width: `${chatWidthPercent}%`, minWidth: MIN_CHAT_WIDTH }}
      >
        {children}
      </div>

      {/* Drag handle */}
      <div
        className="drag-handle w-1 h-full bg-white/10 hover:bg-blue-500/50 cursor-col-resize flex-shrink-0 transition-colors relative group"
        onMouseDown={handleDragStart}
        role="separator"
        aria-label="Resize panels"
        aria-orientation="vertical"
      >
        {/* Visual drag indicator */}
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-blue-500/10 transition-colors" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-0.5 h-3 bg-blue-400 rounded-full" />
          ))}
        </div>
      </div>

      {/* Plugin panel */}
      <div
        className="plugin-panel flex flex-col h-full overflow-hidden"
        style={{ width: `${100 - chatWidthPercent}%`, minWidth: MIN_PLUGIN_WIDTH }}
      >
        <PluginContainer
          state={pluginState}
          actions={pluginActions}
          pluginHtmlContent={pluginHtmlContent}
          onClose={onPluginClose}
          onGameSwitch={onGameSwitch}
        />
      </div>
    </div>
  )
}

export default K12SessionLayout

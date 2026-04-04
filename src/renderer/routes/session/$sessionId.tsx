import NiceModal from '@ebay/nice-modal-react'
import { Button } from '@mantine/core'
import type { Message, ModelProvider } from '@shared/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import MessageList, { type MessageListRef } from '@/components/chat/MessageList'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox from '@/components/InputBox/InputBox'
import Header from '@/components/layout/Header'
import { K12SessionLayout } from '@/components/plugin/K12SessionLayout'
import ThreadHistoryDrawer from '@/components/session/ThreadHistoryDrawer'
import { useK12Plugin } from '@/hooks/useK12Plugin'
import type { PluginId } from '@/packages/plugin-bridge'
import * as remote from '@/packages/remote'
import { getPluginHtml } from '@/plugins/pluginLoader'
import { K12_PENDING_PLUGIN_KEY } from '@/routes/k12'
import { updateSession as updateSessionStore, useSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as scrollActions from '@/stores/scrollActions'
import { modifyMessage, removeCurrentThread, startNewThread, submitNewUserMessage } from '@/stores/sessionActions'
import { constructUserMessage, getAllMessageList } from '@/stores/sessionHelpers'

export const Route = createFileRoute('/session/$sessionId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { sessionId: currentSessionId } = Route.useParams()
  const navigate = useNavigate()
  const { session: currentSession, isFetching, isLoading, isPending } = useSession(currentSessionId)
  const setLastUsedChatModel = useStore(lastUsedModelStore, (state) => state.setChatModel)
  const setLastUsedPictureModel = useStore(lastUsedModelStore, (state) => state.setPictureModel)

  const currentMessageList = useMemo(() => (currentSession ? getAllMessageList(currentSession) : []), [currentSession])
  const lastGeneratingMessage = useMemo(
    () => currentMessageList.find((m: Message) => m.generating),
    [currentMessageList]
  )

  const messageListRef = useRef<MessageListRef>(null)

  const goHome = useCallback(() => {
    navigate({ to: '/', replace: true })
  }, [navigate])

  // ─── K-12 Plugin Split-View ───────────────────────────────────────────────
  const [k12PluginState, k12PluginActions] = useK12Plugin(currentSessionId)
  const [k12PluginHtml, setK12PluginHtml] = useState<string | null>(null)

  // On mount: check if we were launched from the K-12 dashboard with a pending plugin
  useEffect(() => {
    const raw = localStorage.getItem(K12_PENDING_PLUGIN_KEY)
    if (!raw) return
    try {
      const pending = JSON.parse(raw) as { pluginId: PluginId; quickStart: string; sessionId: string }
      // Only consume if this is the right session
      if (pending.sessionId !== currentSessionId) return
      localStorage.removeItem(K12_PENDING_PLUGIN_KEY)
      const html = getPluginHtml(pending.pluginId)
      setK12PluginHtml(html)
      k12PluginActions.launchPlugin(pending.pluginId)
      // Send the quickStart message after a delay to let the plugin iframe load
      // and send its first STATE_UPDATE so the AI has full plugin context.
      setTimeout(() => {
        const msg = constructUserMessage(pending.quickStart)
        void submitNewUserMessage(currentSessionId, { newUserMsg: msg, needGenerating: true })
      }, 1500)
    } catch {
      // Ignore malformed data
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSessionId])
  // ───────────────────────────────────────────────────────────────────────────

  // ─── Chess Auto-Play: trigger AI response when human makes a move ───────────
  const prevChessStateRef = useRef<typeof k12PluginState.pluginState>(null)
  useEffect(() => {
    const state = k12PluginState.pluginState
    const prevState = prevChessStateRef.current
    prevChessStateRef.current = state

    if (
      state?.type === 'chess' &&
      (state as { type: string; humanMove?: boolean; status?: string; lastMove?: string | null }).humanMove === true &&
      (state as { type: string; status?: string }).status === 'active' &&
      state !== prevState
    ) {
      const chessState = state as { type: string; lastMove?: string | null }
      const msg = constructUserMessage(
        `I just moved ${chessState.lastMove ?? 'a piece'}. It's your turn (Black). Please make your move using the chess tool.`
      )
      void submitNewUserMessage(currentSessionId, { newUserMsg: msg, needGenerating: true })
    }
  }, [k12PluginState.pluginState, currentSessionId])

  useEffect(() => {
    setTimeout(() => {
      scrollActions.scrollToBottom('auto') // 每次启动时自动滚动到底部
    }, 200)
  }, [])

  // currentSession变化时（包括session settings变化），存下当前的settings作为新Session的默认值
  useEffect(() => {
    if (currentSession) {
      if (currentSession.type === 'chat' && currentSession.settings) {
        const { provider, modelId } = currentSession.settings
        if (provider && modelId) {
          setLastUsedChatModel(provider, modelId)
        }
      }
      if (currentSession.type === 'picture' && currentSession.settings) {
        const { provider, modelId } = currentSession.settings
        if (provider && modelId) {
          setLastUsedPictureModel(provider, modelId)
        }
      }
    }
  }, [currentSession?.settings, currentSession?.type, currentSession, setLastUsedChatModel, setLastUsedPictureModel])

  const onSelectModel = useCallback(
    (provider: ModelProvider, modelId: string) => {
      if (!currentSession) {
        return
      }
      void updateSessionStore(currentSession.id, {
        settings: {
          ...(currentSession.settings || {}),
          provider,
          modelId,
        },
      })
    },
    [currentSession]
  )

  const onStartNewThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void startNewThread(currentSession.id)
    if (currentSession.copilotId) {
      void remote
        .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_thread' })
        .catch((error) => console.warn('[recordCopilotUsage] failed', error))
    }
    return true
  }, [currentSession])

  const onRollbackThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void removeCurrentThread(currentSession.id)
    return true
  }, [currentSession])

  const onSubmit = useCallback(
    async ({
      constructedMessage,
      needGenerating = true,
      onUserMessageReady,
    }: {
      constructedMessage: Message
      needGenerating?: boolean
      onUserMessageReady?: () => void
    }) => {
      messageListRef.current?.setIsNewMessage(true)

      if (!currentSession) {
        return
      }
      messageListRef.current?.scrollToBottom('instant')

      if (currentSession.copilotId) {
        void remote
          .recordCopilotUsage({ id: currentSession.copilotId, action: 'create_message' })
          .catch((error) => console.warn('[recordCopilotUsage] failed', error))
      }

      await submitNewUserMessage(currentSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [currentSession]
  )

  const onClickSessionSettings = useCallback(() => {
    if (!currentSession) {
      return false
    }
    NiceModal.show('session-settings', {
      session: currentSession,
    })
    return true
  }, [currentSession])

  const onStopGenerating = useCallback(() => {
    if (!currentSession) {
      return false
    }
    if (lastGeneratingMessage?.generating) {
      lastGeneratingMessage?.cancel?.()
      void modifyMessage(currentSession.id, { ...lastGeneratingMessage, generating: false }, true)
    }
    return true
  }, [currentSession, lastGeneratingMessage])

  const model = useMemo(() => {
    if (!currentSession?.settings?.modelId || !currentSession?.settings?.provider) {
      return undefined
    }
    return {
      provider: currentSession.settings.provider,
      modelId: currentSession.settings.modelId,
    }
  }, [currentSession?.settings?.provider, currentSession?.settings?.modelId])

  // The chat panel — used by both plain sessions and K-12 split-view
  const chatPanel = currentSession ? (
    <div className="flex flex-col h-full">
      <Header session={currentSession} />

      {/* MessageList 设置 key，确保每个 session 对应新的 MessageList 实例 */}
      <MessageList ref={messageListRef} key={`message-list${currentSessionId}`} currentSession={currentSession} />

      {/* <ScrollButtons /> */}
      <ErrorBoundary name="session-inputbox">
        <InputBox
          key={`input-box${currentSession.id}`}
          sessionId={currentSession.id}
          sessionType={currentSession.type}
          model={model}
          onStartNewThread={onStartNewThread}
          onRollbackThread={onRollbackThread}
          onSelectModel={onSelectModel}
          onClickSessionSettings={onClickSessionSettings}
          generating={!!lastGeneratingMessage}
          onSubmit={onSubmit}
          onStopGenerating={onStopGenerating}
        />
      </ErrorBoundary>
      <ThreadHistoryDrawer session={currentSession} />
    </div>
  ) : null

  return currentSession ? (
    <K12SessionLayout
      pluginState={k12PluginState}
      pluginActions={k12PluginActions}
      pluginHtmlContent={k12PluginHtml}
      onPluginClose={() => setK12PluginHtml(null)}
    >
      {chatPanel}
    </K12SessionLayout>
  ) : (
    // Only show 'not found' when query is fully settled: not loading, not fetching, not in pending state
    !isLoading && !isFetching && !isPending && (
      <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh]">
        <div className="text-2xl font-semibold text-gray-700 mb-4">{t('Conversation not found')}</div>
        <Button variant="outline" onClick={goHome}>
          {t('Back to HomePage')}
        </Button>
      </div>
    )
  )
}

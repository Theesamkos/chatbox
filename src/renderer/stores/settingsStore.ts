/** biome-ignore-all lint/suspicious/noExplicitAny: any */
/** biome-ignore-all lint/suspicious/noFallthroughSwitchClause: migrate */

import * as defaults from '@shared/defaults'
import { type ProviderSettings, type Settings, SettingsSchema } from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import deepmerge from 'deepmerge'
import type { WritableDraft } from 'immer'
import { createStore, useStore } from 'zustand'
import { createJSONStorage, persist, subscribeWithSelector } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import { getLogger } from '@/lib/utils'
import platform from '@/platform'
import storage from '@/storage'
import { mergeProviderSettings, type ProviderSettingsUpdate } from './providerSettings'

const log = getLogger('settings-store')

/**
 * Returns platform-specific default document parser configuration.
 * - Desktop: 'local' (has full Node.js environment for local parsing)
 * - Mobile/Web: 'none' (only basic text file support by default, user can enable chatbox-ai)
 */
export function getPlatformDefaultDocumentParser(): DocumentParserConfig {
  return platform.type === 'desktop' ? { type: 'local' } : { type: 'none' }
}

type Action = {
  setSettings: (nextStateOrUpdater: Partial<Settings> | ((state: WritableDraft<Settings>) => void)) => void
  getSettings: () => Settings
}

export const settingsStore = createStore<Settings & Action>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        ...SettingsSchema.parse(defaults.settings()),
        setSettings: (val) => set(val),
        getSettings: () => {
          const store = get()
          return SettingsSchema.parse(store)
        },
      })),
      {
        name: 'settings',
        storage: createJSONStorage(() => ({
          getItem: async (key) => {
            const res = await storage.getItem<(Settings & { __version?: number }) | null>(key, null)
            if (res) {
              const { __version = 0, ...state } = res
              return JSON.stringify({
                state,
                version: __version,
              })
            }

            return null
          },
          setItem: async (name, value) => {
            const { state, version } = JSON.parse(value) as { state: Settings; version?: number }
            await storage.setItem(name, { ...state, __version: version || 0 })
          },
          removeItem: async (name) => await storage.removeItem(name),
        })),
        version: 2,
        partialize: (state) => {
          try {
            return SettingsSchema.parse(state)
          } catch {
            return state
          }
        },
        migrate: (persisted: any, version) => {
          // merge the newly added fields in defaults.settings() into the persisted values (deep merge).
          const settings: any = deepmerge(defaults.settings(), persisted, {
            arrayMerge: (_target, source) => source,
          })

          switch (version) {
            case 0:
              // fix typo
              settings.shortcuts.inputBoxSendMessage =
                settings.shortcuts.inpubBoxSendMessage || settings.shortcuts.inputBoxSendMessage
              settings.shortcuts.inputBoxSendMessageWithoutResponse =
                settings.shortcuts.inpubBoxSendMessageWithoutResponse ||
                settings.shortcuts.inputBoxSendMessageWithoutResponse
            case 1:
              if (settings.licenseKey && !settings.licenseActivationMethod) {
                settings.licenseActivationMethod = 'manual'
                settings.memorizedManualLicenseKey = settings.licenseKey
              }
            default:
              break
          }

          // Apply platform-specific default for documentParser if not set
          if (!settings.extension?.documentParser) {
            settings.extension = {
              ...settings.extension,
              documentParser: getPlatformDefaultDocumentParser(),
            }
          }

          return SettingsSchema.parse(settings)
        },
        skipHydration: true,
      }
    )
  )
)

/**
 * Seed API keys from Vite/Vercel environment variables if the settings have no key yet.
 *
 * Platform operators set these in Vercel → Project → Environment Variables:
 *   VITE_OPENAI_API_KEY      → auto-configures the OpenAI provider
 *   VITE_ANTHROPIC_API_KEY   → auto-configures the Claude provider
 *   VITE_DEFAULT_PROVIDER    → "openai" or "claude" (which provider to default to)
 *   VITE_DEFAULT_MODEL       → model ID override (e.g. "gpt-4o", "claude-sonnet-4-5")
 *
 * Keys are only seeded when the stored value is empty — user-entered keys are never overwritten.
 */
function seedSettingsFromEnv(): void {
  // Support both naming conventions (VITE_DEFAULT_*_KEY matches what's set in Vercel)
  const openaiKey =
    ((import.meta.env.VITE_DEFAULT_OPENAI_KEY as string | undefined) ?? '') ||
    ((import.meta.env.VITE_OPENAI_API_KEY as string | undefined) ?? '')
  const anthropicKey =
    ((import.meta.env.VITE_DEFAULT_ANTHROPIC_KEY as string | undefined) ?? '') ||
    ((import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) ?? '')
  const defaultProvider = (import.meta.env.VITE_DEFAULT_PROVIDER as string | undefined) ?? ''
  const defaultModel = (import.meta.env.VITE_DEFAULT_MODEL as string | undefined) ?? ''

  if (!openaiKey && !anthropicKey) return // nothing to seed

  settingsStore.setState((s) => {
    const providers = { ...(s.providers ?? {}) }
    let dirty = false

    if (openaiKey && !providers['openai']?.apiKey) {
      providers['openai'] = { ...(providers['openai'] ?? {}), apiKey: openaiKey }
      dirty = true
    }

    if (anthropicKey && !providers['claude']?.apiKey) {
      providers['claude'] = { ...(providers['claude'] ?? {}), apiKey: anthropicKey }
      dirty = true
    }

    if (!dirty) return s

    log.info('[ENV_SEED] Seeded provider API key(s) from environment variables')
    return { ...s, providers }
  })

  // Set the default provider/model if specified and no session-level override exists
  if (defaultProvider) {
    settingsStore.setState((s) => {
      // Only write if this provider actually has a key now
      const hasKey = !!s.providers?.[defaultProvider]?.apiKey
      if (!hasKey) return s
      // We store last-used provider in a separate store; here we just ensure the
      // provider entry exists. The K12 launcher picks the first configured provider.
      return s
    })
  }

  if (defaultModel && defaultProvider) {
    settingsStore.setState((s) => {
      const existing = s.providers?.[defaultProvider]
      if (!existing?.apiKey) return s
      // Inject the default model into the provider's model list if not already there
      const models = existing.models ?? []
      const alreadyListed = models.some((m) => m.modelId === defaultModel)
      if (alreadyListed) return s
      const providers = {
        ...(s.providers ?? {}),
        [defaultProvider]: {
          ...existing,
          models: [{ modelId: defaultModel }, ...models],
        },
      }
      return { ...s, providers }
    })
  }
}

let _initSettingsStorePromise: Promise<Settings> | undefined
export const initSettingsStore = async () => {
  if (!_initSettingsStorePromise) {
    _initSettingsStorePromise = new Promise<Settings>((resolve) => {
      const unsub = settingsStore.persist.onFinishHydration((val) => {
        const providers = val?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(`[CONFIG_DEBUG] onFinishHydration: providersCount=0`)
        }
        unsub()
        // Seed from env vars after hydration so we don't overwrite persisted user keys
        seedSettingsFromEnv()
        resolve(settingsStore.getState().getSettings())
      })
      settingsStore.persist.rehydrate()
    })
  }

  return await _initSettingsStorePromise
}

settingsStore.subscribe((state, prevState) => {
  // 如果快捷键配置发生变化，需要重新注册快捷键
  if (state.shortcuts !== prevState.shortcuts) {
    platform.ensureShortcutConfig(state.shortcuts)
  }
  // 如果代理配置发生变化，需要重新注册代理
  if (state.proxy !== prevState.proxy) {
    platform.ensureProxyConfig({ proxy: state.proxy })
  }
  // 如果开机自启动配置发生变化，需要重新设置开机自启动
  if (Boolean(state.autoLaunch) !== Boolean(prevState.autoLaunch)) {
    platform.ensureAutoLaunch(state.autoLaunch)
  }
})

export function useSettingsStore<U>(selector: Parameters<typeof useStore<typeof settingsStore, U>>[1]) {
  return useStore<typeof settingsStore, U>(settingsStore, selector)
}

export const useLanguage = () => useSettingsStore((state) => state.language)
export const useTheme = () => useSettingsStore((state) => state.theme)
export const useMcpSettings = () => useSettingsStore((state) => state.mcp)

export const useProviderSettings = (providerId: string) => {
  const providers = useSettingsStore((state) => state.providers)

  const providerSettings = providers?.[providerId]

  const setProviderSettings = (val: ProviderSettingsUpdate) => {
    settingsStore.setState((currentSettings) => {
      return mergeProviderSettings(currentSettings, providerId, val)
    })
  }

  return {
    providerSettings,
    setProviderSettings,
  }
}

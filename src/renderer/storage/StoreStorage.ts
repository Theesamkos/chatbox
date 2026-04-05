import { DebouncedFunc } from 'lodash'
import debounce from 'lodash/debounce'
import { v4 as uuidv4 } from 'uuid'
import BaseStorage from './BaseStorage'

export enum StorageKey {
  ChatSessions = 'chat-sessions',
  Configs = 'configs',
  Settings = 'settings',
  MyCopilots = 'myCopilots',
  ConfigVersion = 'configVersion',
  RemoteConfig = 'remoteConfig',
  ChatSessionsList = 'chat-sessions-list',
  ChatSessionSettings = 'chat-session-settings',
  PictureSessionSettings = 'picture-session-settings',
  AuthInfo = 'authInfo',
}

export const StorageKeyGenerator = {
  session(id: string) {
    return `session:${id}`
  },
  picture(category: string) {
    return `picture:${category}:${uuidv4()}`
  },
  file(sessionId: string, msgId: string) {
    return `file:${sessionId}:${msgId}:${uuidv4()}`
  },
  fileUniqKey(file: File) {
    return `file:${file.path || file.name}-${file.size}-${file.lastModified}`
  },
  linkUniqKey(url: string) {
    return `link:${url}`
  },
}

export default class StoreStorage extends BaseStorage {
  constructor() {
    super()
  }
  public async getItem<T>(key: string, initialValue: T): Promise<T> {
    let value: T = await super.getItem(key, initialValue)

    if (key === StorageKey.Configs && value === initialValue) {
      await super.setItemNow(key, initialValue) // 持久化初始生成的 uuid
    }

    return value
  }

  private debounceQueue = new Map<string, DebouncedFunc<(key: string, value: unknown) => void>>()

  // Keys that must be written immediately — losing them on tab close is unacceptable.
  private immediateKeys = new Set<string>(['settings', 'onboarding-completed'])

  public async setItem<T>(key: string, value: T): Promise<void> {
    // Critical keys (API keys, onboarding state) skip the debounce so they
    // are never lost when the user closes the tab before the timer fires.
    if (this.immediateKeys.has(key)) {
      return this.setItemNow(key, value)
    }
    let debounced = this.debounceQueue.get(key)
    if (!debounced) {
      debounced = debounce(this.setItemNow.bind(this), 500, { maxWait: 2000 })
      this.debounceQueue.set(key, debounced)
    }
    debounced(key, value)
  }

  /** Flush all pending debounced writes — call from beforeunload to avoid data loss. */
  public flushAll() {
    for (const debounced of this.debounceQueue.values()) {
      debounced.flush()
    }
  }
}

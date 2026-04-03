/**
 * PluginRegistry — Plugin allowlist and manifest management
 *
 * Stores plugin manifests in electron-store (local persistence).
 * No plugin can load in an iframe unless its origin is in the allowlist.
 * Changes to the allowlist take effect on the next session start.
 */

import type { PluginId, PluginManifest, PluginRegistration, PluginRegistry as PluginRegistryType } from './types'

// Built-in plugin manifests (bundled with the platform)
// These are the three required apps from the PRD
const BUILT_IN_PLUGINS: PluginManifest[] = [
  {
    id: 'chess',
    name: 'Chess',
    version: '1.0.0',
    description: 'Interactive chess board with AI analysis. Play against the AI or analyze positions.',
    origin: 'null', // srcdoc iframe has null origin — handled specially
    iframeUrl: 'builtin://chess',
    allowedRoles: ['student', 'teacher', 'admin'],
    lifecycleType: 'continuous_bidirectional',
    stateSchema: {
      type: 'object',
      required: ['type', 'fen', 'turn', 'status'],
      properties: {
        type: { type: 'string', const: 'chess' },
        fen: { type: 'string' },
        turn: { type: 'string', enum: ['white', 'black'] },
        status: { type: 'string', enum: ['active', 'checkmate', 'stalemate', 'draw', 'resigned'] },
      },
    },
    tools: [
      {
        name: 'start_game',
        description: 'Initialize a new chess game and return the starting position',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            playerColor: {
              type: 'string',
              description: 'Color for the student to play (white or black)',
              enum: ['white', 'black'],
            },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make a chess move in UCI notation (e.g., e2e4). Returns new FEN and move result.',
        parameters: {
          type: 'object',
          required: ['move'],
          properties: {
            move: { type: 'string', description: 'Move in UCI notation (e.g., e2e4, g1f3)' },
          },
        },
      },
      {
        name: 'get_board_state',
        description: 'Get the current board state as a FEN string and whose turn it is',
        parameters: { type: 'object', required: [], properties: {} },
      },
      {
        name: 'get_legal_moves',
        description: 'Get all legal moves for the current position',
        parameters: { type: 'object', required: [], properties: {} },
      },
    ],
  },
  {
    id: 'timeline',
    name: 'Timeline Builder',
    version: '1.0.0',
    description: 'Arrange historical events in chronological order. Tests historical reasoning skills.',
    origin: 'null',
    iframeUrl: 'builtin://timeline',
    allowedRoles: ['student', 'teacher', 'admin'],
    lifecycleType: 'structured_completion',
    stateSchema: {
      type: 'object',
      required: ['type', 'topic', 'status'],
      properties: {
        type: { type: 'string', const: 'timeline' },
        topic: { type: 'string' },
        status: { type: 'string', enum: ['in_progress', 'complete', 'error'] },
      },
    },
    tools: [
      {
        name: 'load_timeline',
        description: 'Load a set of shuffled historical events for a given topic for the student to arrange',
        parameters: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', description: 'Historical topic (e.g., American Civil War, World War II)' },
          },
        },
      },
      {
        name: 'validate_arrangement',
        description: 'Validate the student\'s event arrangement and return correctness per item and overall score',
        parameters: {
          type: 'object',
          required: ['orderedEventIds'],
          properties: {
            orderedEventIds: {
              type: 'string',
              description: 'Comma-separated event IDs in the student\'s order',
            },
          },
        },
      },
    ],
  },
  {
    id: 'artifact_studio',
    name: 'Artifact Investigation Studio',
    version: '1.0.0',
    description:
      'Guided artifact-based historical inquiry using Smithsonian and Library of Congress collections. Students discover, inspect, and investigate artifacts to build evidence-based claims.',
    origin: 'null',
    iframeUrl: 'builtin://artifact_studio',
    allowedRoles: ['student', 'teacher', 'admin'],
    lifecycleType: 'guided_multistep',
    stateSchema: {
      type: 'object',
      required: ['type', 'phase', 'status'],
      properties: {
        type: { type: 'string', const: 'artifact_investigation' },
        phase: { type: 'string', enum: ['discover', 'inspect', 'investigate', 'conclude'] },
        status: { type: 'string', enum: ['in_progress', 'complete', 'error'] },
      },
    },
    tools: [
      {
        name: 'search_artifacts',
        description: 'Search for historical artifacts by topic or keyword using Smithsonian API (with Library of Congress fallback)',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query for artifacts' },
            dateRange: { type: 'string', description: 'Optional date range filter (e.g., 1860-1865)' },
            culturalContext: { type: 'string', description: 'Optional cultural context filter' },
          },
        },
      },
      {
        name: 'get_artifact_detail',
        description: 'Get full metadata and high-resolution image URL for a specific artifact',
        parameters: {
          type: 'object',
          required: ['artifactId'],
          properties: {
            artifactId: { type: 'string', description: 'Artifact ID from search results' },
          },
        },
      },
      {
        name: 'submit_investigation',
        description: 'Submit the student\'s completed investigation with observations, evidence, and claims',
        parameters: {
          type: 'object',
          required: ['observations', 'evidence', 'claims'],
          properties: {
            observations: { type: 'string', description: 'What the student directly sees in the artifact' },
            evidence: { type: 'string', description: 'What the observations suggest about the artifact\'s context' },
            claims: { type: 'string', description: 'The student\'s interpretive conclusion' },
          },
        },
      },
    ],
  },
]

// Storage key for plugin registry in electron-store
const PLUGIN_REGISTRY_KEY = 'chatbridge_plugin_registry'

export class PluginRegistry {
  private registry: PluginRegistryType

  constructor() {
    this.registry = this.loadRegistry()
  }

  private loadRegistry(): PluginRegistryType {
    // Try to load from electron-store via the preload bridge
    // Fall back to built-in plugins if not available
    try {
      const stored = window.localStorage.getItem(PLUGIN_REGISTRY_KEY)
      if (stored) {
        return JSON.parse(stored) as PluginRegistryType
      }
    } catch {
      // localStorage not available (Electron with no allow-same-origin on main window)
    }
    return this.buildDefaultRegistry()
  }

  private buildDefaultRegistry(): PluginRegistryType {
    const plugins: Record<PluginId, PluginRegistration> = {} as Record<PluginId, PluginRegistration>
    const now = Date.now()
    for (const manifest of BUILT_IN_PLUGINS) {
      plugins[manifest.id] = {
        manifest,
        status: 'active',
        registeredAt: now,
        updatedAt: now,
      }
    }
    return { plugins }
  }

  private saveRegistry(): void {
    try {
      window.localStorage.setItem(PLUGIN_REGISTRY_KEY, JSON.stringify(this.registry))
    } catch {
      // Ignore — will use in-memory registry
    }
  }

  getPlugin(pluginId: PluginId): PluginRegistration | null {
    return this.registry.plugins[pluginId] ?? null
  }

  getActivePlugins(): PluginRegistration[] {
    return Object.values(this.registry.plugins).filter((p) => p.status === 'active')
  }

  isAllowlisted(pluginId: PluginId): boolean {
    const plugin = this.registry.plugins[pluginId]
    return !!plugin && plugin.status === 'active'
  }

  getAllToolSchemas(): Array<{ pluginId: PluginId; tools: PluginManifest['tools'] }> {
    return this.getActivePlugins().map((p) => ({
      pluginId: p.manifest.id,
      tools: p.manifest.tools,
    }))
  }

  /**
   * Returns OpenAI-compatible function definitions for all active plugin tools.
   * These are injected into the LLM context on every user turn.
   */
  getOpenAIToolSchemas(): Array<{
    type: 'function'
    function: {
      name: string
      description: string
      parameters: Record<string, unknown>
    }
  }> {
    const schemas: Array<{
      type: 'function'
      function: { name: string; description: string; parameters: Record<string, unknown> }
    }> = []

    for (const registration of this.getActivePlugins()) {
      for (const tool of registration.manifest.tools) {
        schemas.push({
          type: 'function',
          function: {
            name: `${registration.manifest.id}__${tool.name}`, // Namespace to avoid collisions
            description: `[${registration.manifest.name}] ${tool.description}`,
            parameters: tool.parameters as Record<string, unknown>,
          },
        })
      }
    }
    return schemas
  }

  /**
   * Parse a namespaced tool name back to pluginId + toolName
   */
  parseToolName(namespacedName: string): { pluginId: PluginId; toolName: string } | null {
    const parts = namespacedName.split('__')
    if (parts.length !== 2) return null
    const [pluginId, toolName] = parts
    if (!this.isAllowlisted(pluginId as PluginId)) return null
    return { pluginId: pluginId as PluginId, toolName }
  }

  disablePlugin(pluginId: PluginId): void {
    if (this.registry.plugins[pluginId]) {
      this.registry.plugins[pluginId].status = 'disabled'
      this.registry.plugins[pluginId].updatedAt = Date.now()
      this.saveRegistry()
    }
  }

  enablePlugin(pluginId: PluginId): void {
    if (this.registry.plugins[pluginId]) {
      this.registry.plugins[pluginId].status = 'active'
      this.registry.plugins[pluginId].updatedAt = Date.now()
      this.saveRegistry()
    }
  }
}

// Singleton instance
export const pluginRegistry = new PluginRegistry()

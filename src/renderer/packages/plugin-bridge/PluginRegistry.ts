/**
 * PluginRegistry — Plugin allowlist and manifest management
 *
 * Stores plugin manifests in electron-store (local persistence).
 * No plugin can load in an iframe unless its origin is in the allowlist.
 * Changes to the allowlist take effect on the next session start.
 *
 * Tool schemas here MUST match the actual implementations in the plugin HTML files.
 * Run `grep -n "case '" src/renderer/plugins/*.html` to verify tool names.
 */

import type { PluginId, PluginManifest, PluginRegistration, PluginRegistry as PluginRegistryType } from './types'

// Built-in plugin manifests (bundled with the platform)
// These are the three required apps from the PRD
const BUILT_IN_PLUGINS: PluginManifest[] = [
  {
    id: 'chess',
    name: 'Chess',
    version: '1.0.0',
    description: 'Interactive chess board with AI coaching. Play against the AI or analyze positions.',
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
        description: 'Initialize a new chess game. Optionally start from a custom FEN position.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            fen: {
              type: 'string',
              description: 'Optional FEN string to start from a custom position. Omit to start a new game from the standard opening position.',
            },
          },
        },
      },
      {
        name: 'make_move',
        description: 'Make a chess move. Accepts UCI notation (e2e4) or SAN notation (e4, Nf3, O-O). Returns new FEN, move result, and game status.',
        parameters: {
          type: 'object',
          required: ['move'],
          properties: {
            move: {
              type: 'string',
              description: 'Move in UCI notation (e.g., e2e4, g1f3, e1g1 for castling) or SAN notation (e4, Nf3, O-O)',
            },
          },
        },
      },
      {
        name: 'get_board_state',
        description: 'Get the current board state: FEN string, whose turn it is, move history, captured pieces, and game status.',
        parameters: { type: 'object', required: [], properties: {} },
      },
      {
        name: 'get_legal_moves',
        description: 'Get all legal moves for the current position, or legal moves for a specific square.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            square: {
              type: 'string',
              description: 'Optional square in algebraic notation (e.g., e2). If omitted, returns all legal moves.',
            },
          },
        },
      },
      {
        name: 'auto_move',
        description: 'Make the best available Black move automatically. Use this INSTEAD of get_legal_moves + make_move. One call does everything: picks the best legal Black move and plays it. Returns the move played and new board state.',
        parameters: { type: 'object', required: [], properties: {} },
      },
      {
        name: 'toggle_assistance',
        description: 'Toggle move assistance mode (shows legal move dots on the board). Use to help or challenge the student.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            enabled: {
              type: 'boolean',
              description: 'True to enable assistance (show legal move hints), false to disable. Omit to toggle current state.',
            },
          },
        },
      },
      {
        name: 'get_help',
        description: 'Get comprehensive help information: legal moves, captures, move history, captured pieces, and current position analysis.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    ],
  },
  {
    id: 'timeline',
    name: 'Timeline Builder',
    version: '1.0.0',
    description: 'Arrange historical events in chronological order. Tests historical reasoning with deterministic validation.',
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
        description: 'Load a shuffled set of historical events for a given topic. The student will drag them into chronological order. Supported topics: "World War II", "American Civil War", "Ancient Rome", "Space Race", "French Revolution", "Industrial Revolution", "Civil Rights Movement", "Renaissance".',
        parameters: {
          type: 'object',
          required: ['topic'],
          properties: {
            topic: {
              type: 'string',
              description: 'Historical topic to load. Use exact topic names like "World War II", "American Civil War", "Ancient Rome", "Space Race", "French Revolution", "Industrial Revolution", "Civil Rights Movement", "Renaissance".',
            },
          },
        },
      },
      {
        name: 'validate_arrangement',
        description: 'Validate the student\'s current event arrangement and return per-item correctness and an overall score. This signals TIMELINE_COMPLETE and ends the activity.',
        parameters: {
          type: 'object',
          required: [],
          properties: {
            orderedEventIds: {
              type: 'string',
              description: 'Optional: comma-separated event IDs in the student\'s intended order. If omitted, uses the current drag-and-drop arrangement in the UI.',
            },
          },
        },
      },
      {
        name: 'get_state',
        description: 'Get the current timeline state: topic, loaded events, student\'s current arrangement, attempt count, and available topics.',
        parameters: { type: 'object', required: [], properties: {} },
      },
      {
        name: 'reset_timeline',
        description: 'Reset the current timeline to a new shuffled order so the student can try again.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    ],
  },
  {
    id: 'artifact_studio',
    name: 'Artifact Investigation Studio',
    version: '1.0.0',
    description:
      'Guided artifact-based historical inquiry using Met Museum collections. Students discover, inspect, and investigate artifacts to build evidence-based claims.',
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
        description: 'Search for historical artifacts by topic or keyword using the Met Museum API. Returns a list of artifacts with titles, dates, and thumbnails.',
        parameters: {
          type: 'object',
          required: ['query'],
          properties: {
            query: { type: 'string', description: 'Search query for artifacts (e.g., "ancient Egypt", "medieval armor", "Roman coins")' },
            dateRange: { type: 'string', description: 'Optional date range filter (e.g., "1860-1865", "500BC-200BC")' },
            culturalContext: { type: 'string', description: 'Optional cultural context filter (e.g., "Egyptian", "Greek", "American")' },
          },
        },
      },
      {
        name: 'get_artifact_detail',
        description: 'Get full metadata and image URL for a specific artifact so the student can inspect it closely.',
        parameters: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Artifact ID from search results (the id field in search response)' },
          },
        },
      },
      {
        name: 'submit_investigation',
        description: 'Submit the student\'s completed investigation. All four investigation fields (observations, evidence, interpretation, hypothesis) must have at least 50 characters each before calling this. This triggers PLUGIN_COMPLETE.',
        parameters: {
          type: 'object',
          required: [],
          properties: {},
        },
      },
      {
        name: 'get_investigation_state',
        description: 'Get the current investigation state: selected artifact, all four investigation field contents, phase, and completion status.',
        parameters: { type: 'object', required: [], properties: {} },
      },
      {
        name: 'reset_investigation',
        description: 'Reset the investigation fields so the student can start over. If an artifact is selected, returns to the investigate phase; otherwise returns to discover.',
        parameters: { type: 'object', required: [], properties: {} },
      },
    ],
  },
]

// Storage key for plugin registry in electron-store
const PLUGIN_REGISTRY_KEY = 'chatbridge_plugin_registry'

export class PluginRegistry {
  private registry: PluginRegistryType

  constructor() {
    this.registry = this.buildDefaultRegistry()
    // Attempt to merge any persisted overrides (e.g., disabled plugins)
    this.mergePersistedOverrides()
  }

  private mergePersistedOverrides(): void {
    try {
      const stored = window.localStorage.getItem(PLUGIN_REGISTRY_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as PluginRegistryType
      // Only merge status overrides — never use stored tool schemas (could be stale)
      for (const pluginId of Object.keys(parsed.plugins) as PluginId[]) {
        if (this.registry.plugins[pluginId] && parsed.plugins[pluginId].status === 'disabled') {
          this.registry.plugins[pluginId].status = 'disabled'
          this.registry.plugins[pluginId].updatedAt = parsed.plugins[pluginId].updatedAt
        }
      }
    } catch {
      // localStorage not available or parse error — use defaults
    }
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

/**
 * plugin.ts — Dynamic toolset for K-12 plugin tools
 *
 * Generates AI SDK Tool objects for every tool registered in the active plugin.
 * Each tool's execute() function routes through pluginStateStore.invokePluginTool(),
 * which calls the plugin bridge's invokeToolOnPlugin() method.
 *
 * Tool names are namespaced as `{pluginId}__{toolName}` (e.g., chess__make_move)
 * to avoid collisions with other tools.
 */

import { tool } from 'ai'
import { z } from 'zod'
import { pluginRegistry } from '@/packages/plugin-bridge'
import { getActivePluginId, hasActivePlugin, invokePluginTool } from '@/stores/pluginStateStore'
import { uniqueId } from 'lodash'

/**
 * Build a ToolSet containing all tools for the active plugin in the given session.
 * Returns an empty object if no plugin is active or no tools are registered.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildPluginToolSet(sessionId: string): Record<string, any> {
  if (!hasActivePlugin(sessionId)) {
    return {}
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {}

  // Only expose tools for the plugin that is active in THIS session.
  // pluginRegistry.getActivePlugins() returns ALL enabled plugins; we must filter
  // to the session's plugin so the AI doesn't see irrelevant tool names.
  const activePluginId = getActivePluginId(sessionId)
  const registrations = activePluginId
    ? pluginRegistry.getActivePlugins().filter((r) => r.manifest.id === activePluginId)
    : pluginRegistry.getActivePlugins()

  for (const registration of registrations) {
    for (const toolDef of registration.manifest.tools) {
      const namespacedName = `${registration.manifest.id}__${toolDef.name}`
      const inputSchema = buildZodSchema(toolDef.parameters)
      const capturedToolName = toolDef.name

      tools[namespacedName] = tool({
        description: `[${registration.manifest.name}] ${toolDef.description}`,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: inputSchema as any,
        execute: async (args: Record<string, unknown>) => {
          const toolCallId = `plugin_${capturedToolName}_${uniqueId()}`
          try {
            const result = await invokePluginTool(sessionId, toolCallId, capturedToolName, args)
            return result
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            return { error: message, success: false }
          }
        },
      })
    }
  }

  return tools
}

/**
 * Convert a JSON Schema object to a Zod schema.
 * Handles the common subset used by plugin tool parameters.
 */
function buildZodSchema(jsonSchema: {
  type?: string
  properties?: Record<string, { type?: string; description?: string; enum?: string[] }>
  required?: string[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
}): z.ZodTypeAny {
  if (!jsonSchema.properties || Object.keys(jsonSchema.properties).length === 0) {
    return z.object({})
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  const required = new Set(jsonSchema.required ?? [])

  for (const [key, prop] of Object.entries(jsonSchema.properties)) {
    let fieldSchema: z.ZodTypeAny

    if (prop.enum && prop.enum.length > 0) {
      const [first, ...rest] = prop.enum as [string, ...string[]]
      fieldSchema = z.enum([first, ...rest])
    } else if (prop.type === 'number' || prop.type === 'integer') {
      fieldSchema = z.number()
    } else if (prop.type === 'boolean') {
      fieldSchema = z.boolean()
    } else if (prop.type === 'array') {
      fieldSchema = z.array(z.unknown())
    } else {
      fieldSchema = z.string()
    }

    if (prop.description) {
      fieldSchema = fieldSchema.describe(prop.description)
    }

    if (!required.has(key)) {
      fieldSchema = fieldSchema.optional()
    }

    shape[key] = fieldSchema
  }

  return z.object(shape)
}

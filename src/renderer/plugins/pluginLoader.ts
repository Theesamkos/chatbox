/**
 * pluginLoader — Provides plugin HTML content for the PluginContainer
 *
 * In Electron, plugins are loaded as raw HTML strings injected via srcdoc.
 * This keeps them sandboxed (origin = "null") and prevents any external requests.
 *
 * In development, we use Vite's ?raw import to inline the HTML at build time.
 * This means no runtime file reads and no network requests from the plugin.
 */

// Vite raw imports — these are inlined at build time
// @ts-ignore
import chessHtml from './chess.html?raw'
// @ts-ignore
import timelineHtml from './timeline.html?raw'
// @ts-ignore
import artifactStudioHtml from './artifact_studio.html?raw'

import type { PluginId } from '../packages/plugin-bridge'

const PLUGIN_HTML: Record<PluginId, string> = {
  chess: chessHtml,
  timeline: timelineHtml,
  artifact_studio: artifactStudioHtml,
}

/**
 * Get the HTML content for a plugin by ID.
 * Returns null if the plugin is not found.
 */
export function getPluginHtml(pluginId: PluginId): string | null {
  return PLUGIN_HTML[pluginId] ?? null
}

/**
 * Check if a plugin has HTML content available.
 */
export function hasPluginHtml(pluginId: PluginId): boolean {
  return pluginId in PLUGIN_HTML
}

export const AVAILABLE_PLUGIN_IDS: PluginId[] = Object.keys(PLUGIN_HTML) as PluginId[]

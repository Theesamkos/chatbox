/**
 * AuditLogger — Immutable event log for all significant platform events
 *
 * Writes to localStorage (renderer-side) for the current session.
 * In production, this would write to a server-side database.
 * Every plugin lifecycle event, safety event, and plugin failure is logged here.
 */

import type { AuditLogEntry, PluginFailureEntry, SafetyEventEntry } from './types'

const AUDIT_LOG_KEY = 'chatbridge_audit_logs'
const PLUGIN_FAILURES_KEY = 'chatbridge_plugin_failures'
const SAFETY_EVENTS_KEY = 'chatbridge_safety_events'
const MAX_ENTRIES = 1000

export class AuditLogger {
  private auditLogs: AuditLogEntry[] = []
  private pluginFailures: PluginFailureEntry[] = []
  private safetyEvents: SafetyEventEntry[] = []

  constructor() {
    this.loadFromStorage()
  }

  private loadFromStorage(): void {
    try {
      const auditRaw = localStorage.getItem(AUDIT_LOG_KEY)
      if (auditRaw) this.auditLogs = JSON.parse(auditRaw)
      const failuresRaw = localStorage.getItem(PLUGIN_FAILURES_KEY)
      if (failuresRaw) this.pluginFailures = JSON.parse(failuresRaw)
      const safetyRaw = localStorage.getItem(SAFETY_EVENTS_KEY)
      if (safetyRaw) this.safetyEvents = JSON.parse(safetyRaw)
    } catch {
      // Start fresh if storage is corrupted
    }
  }

  private saveAuditLogs(): void {
    try {
      // Keep only the last MAX_ENTRIES
      if (this.auditLogs.length > MAX_ENTRIES) {
        this.auditLogs = this.auditLogs.slice(-MAX_ENTRIES)
      }
      localStorage.setItem(AUDIT_LOG_KEY, JSON.stringify(this.auditLogs))
    } catch {
      // Storage full — continue in memory
    }
  }

  logAuditEvent(entry: AuditLogEntry): void {
    this.auditLogs.push(entry)
    this.saveAuditLogs()

    // Also log to console in development for debugging
    if (process.env.NODE_ENV === 'development') {
      const level = entry.severity === 'critical' || entry.severity === 'error' ? 'error'
        : entry.severity === 'warning' ? 'warn' : 'log'
      console[level](`[ChatBridge Audit] ${entry.eventType}`, entry.payload)
    }
  }

  logPluginFailure(entry: PluginFailureEntry): void {
    this.pluginFailures.push(entry)
    try {
      if (this.pluginFailures.length > MAX_ENTRIES) {
        this.pluginFailures = this.pluginFailures.slice(-MAX_ENTRIES)
      }
      localStorage.setItem(PLUGIN_FAILURES_KEY, JSON.stringify(this.pluginFailures))
    } catch {
      // Continue in memory
    }
    if (process.env.NODE_ENV === 'development') {
      console.error(`[ChatBridge PluginFailure] ${entry.failureType}: ${entry.errorDetail}`)
    }
  }

  logSafetyEvent(entry: SafetyEventEntry): void {
    this.safetyEvents.push(entry)
    try {
      if (this.safetyEvents.length > MAX_ENTRIES) {
        this.safetyEvents = this.safetyEvents.slice(-MAX_ENTRIES)
      }
      localStorage.setItem(SAFETY_EVENTS_KEY, JSON.stringify(this.safetyEvents))
    } catch {
      // Continue in memory
    }
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[ChatBridge Safety] ${entry.eventType}: ${entry.action}`)
    }
  }

  getAuditLogs(conversationId?: string): AuditLogEntry[] {
    if (conversationId) {
      return this.auditLogs.filter((e) => e.conversationId === conversationId)
    }
    return [...this.auditLogs]
  }

  getPluginFailures(pluginId?: string): PluginFailureEntry[] {
    if (pluginId) {
      return this.pluginFailures.filter((e) => e.pluginId === pluginId)
    }
    return [...this.pluginFailures]
  }

  getSafetyEvents(conversationId?: string): SafetyEventEntry[] {
    if (conversationId) {
      return this.safetyEvents.filter((e) => e.conversationId === conversationId)
    }
    return [...this.safetyEvents]
  }

  clearSession(conversationId: string): void {
    this.auditLogs = this.auditLogs.filter((e) => e.conversationId !== conversationId)
    this.pluginFailures = this.pluginFailures.filter((e) => e.conversationId !== conversationId)
    this.safetyEvents = this.safetyEvents.filter((e) => e.conversationId !== conversationId)
    this.saveAuditLogs()
  }
}

// Singleton instance
export const auditLogger = new AuditLogger()

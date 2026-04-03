/**
 * SafetyLayer — Pre-LLM input moderation + Post-LLM output moderation
 *
 * K-12 content policy enforcement:
 * - Pre-LLM: blocks harmful input, detects prompt injection, enforces length limits
 * - Post-LLM: scans output for harmful content, PII, inappropriate material
 * - Session freeze: marks session as frozen when critical violations occur
 *
 * All events are logged via AuditLogger for teacher/admin review.
 */

import { v4 as uuidv4 } from 'uuid'
import { auditLogger } from './AuditLogger'
import type { SafetyAction, SafetyEventType } from './types'

const MAX_INPUT_LENGTH = 4000

// ─── Pattern Banks ────────────────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your\s+)?(guidelines|training|rules)/i,
  /you\s+are\s+now\s+(a\s+)?(different|new|unrestricted)\s+(ai|assistant|bot)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /forget\s+(your\s+)?(training|guidelines|rules|instructions)/i,
  /act\s+as\s+(if\s+you\s+are\s+)?an?\s+(unrestricted|jailbroken|evil)/i,
  /\[system\]/i,
  /\[assistant\]/i,
  /\[user\]/i,
  /###\s*(system|instruction|prompt)/i,
]

const HARMFUL_CONTENT_PATTERNS = [
  // Violence
  /\b(kill|murder|stab|shoot|bomb|explode|weapon|gun|knife|suicide|self.harm)\b/i,
  // Adult content
  /\b(porn|pornography|nude|naked|sex|sexual|xxx|adult\s+content)\b/i,
  // Hate speech
  /\b(racial\s+slur|hate\s+speech|white\s+supremac|nazi|terrorist)\b/i,
  // Drug-related
  /\b(drug\s+deal|how\s+to\s+(make|buy|sell)\s+(drugs|meth|cocaine|heroin))\b/i,
]

const PII_PATTERNS = [
  // SSN
  /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/,
  // Credit card
  /\b(?:\d{4}[-\s]?){3}\d{4}\b/,
  // Email in output
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
  // Phone number
  /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/,
]

// ─── Result Types ─────────────────────────────────────────────────────────────

export interface SafetyCheckResult {
  allowed: boolean
  reason?: string
  action: SafetyAction
  sanitized?: string
}

// ─── Safety Layer ─────────────────────────────────────────────────────────────

export class SafetyLayer {
  private frozenSessions: Set<string> = new Set()

  // ─── Pre-LLM Input Check ──────────────────────────────────────────────────

  checkInput(
    input: string,
    conversationId: string,
    userId?: string
  ): SafetyCheckResult {
    // Session frozen check
    if (this.frozenSessions.has(conversationId)) {
      return {
        allowed: false,
        reason: 'This session is under review. Please contact your teacher.',
        action: 'session_frozen',
      }
    }

    // Length check
    if (input.length > MAX_INPUT_LENGTH) {
      this.logSafetyEvent(
        'input_blocked',
        'blocked',
        input.slice(0, 100) + '...',
        conversationId,
        userId
      )
      return {
        allowed: false,
        reason: 'Message is too long. Please keep messages under 4,000 characters.',
        action: 'blocked',
      }
    }

    // Injection detection
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        this.logSafetyEvent('injection_detected', 'blocked', input, conversationId, userId)
        return {
          allowed: false,
          reason: 'That message cannot be processed. Please ask a different question.',
          action: 'blocked',
        }
      }
    }

    // Harmful content check
    for (const pattern of HARMFUL_CONTENT_PATTERNS) {
      if (pattern.test(input)) {
        this.logSafetyEvent('input_blocked', 'blocked', input, conversationId, userId)
        return {
          allowed: false,
          reason: 'That message contains content that is not appropriate for this platform.',
          action: 'blocked',
        }
      }
    }

    return { allowed: true, action: 'blocked' }
  }

  // ─── Post-LLM Output Check ────────────────────────────────────────────────

  checkOutput(
    output: string,
    conversationId: string,
    userId?: string
  ): SafetyCheckResult {
    // Check for harmful content in LLM output
    for (const pattern of HARMFUL_CONTENT_PATTERNS) {
      if (pattern.test(output)) {
        this.logSafetyEvent('output_flagged', 'flagged_for_review', output, conversationId, userId)
        // Freeze the session for teacher review
        this.frozenSessions.add(conversationId)
        this.logSafetyEvent('session_frozen', 'session_frozen', output, conversationId, userId)
        return {
          allowed: false,
          reason: 'The AI response was flagged for review. Your teacher has been notified.',
          action: 'session_frozen',
        }
      }
    }

    // Sanitize PII from output
    let sanitized = output
    let hasPII = false
    for (const pattern of PII_PATTERNS) {
      if (pattern.test(sanitized)) {
        hasPII = true
        sanitized = sanitized.replace(pattern, '[REDACTED]')
      }
    }

    if (hasPII) {
      this.logSafetyEvent('content_filtered', 'sanitized', output, conversationId, userId)
      return {
        allowed: true,
        action: 'sanitized',
        sanitized,
      }
    }

    return { allowed: true, action: 'blocked' }
  }

  // ─── Plugin State Check ───────────────────────────────────────────────────

  checkPluginState(state: unknown, conversationId: string): boolean {
    const INJECTION_PATTERNS_STATE = [
      /ignore\s+previous\s+instructions/i,
      /you\s+are\s+now/i,
      /<script/i,
      /javascript:/i,
    ]

    const checkString = (s: string): boolean =>
      INJECTION_PATTERNS_STATE.some((p) => p.test(s))

    const traverse = (value: unknown): boolean => {
      if (typeof value === 'string') return checkString(value)
      if (Array.isArray(value)) return value.some(traverse)
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, unknown>).some(traverse)
      }
      return false
    }

    if (traverse(state)) {
      this.logSafetyEvent(
        'injection_detected',
        'blocked',
        JSON.stringify(state).slice(0, 200),
        conversationId
      )
      return false
    }
    return true
  }

  // ─── Session Management ───────────────────────────────────────────────────

  freezeSession(conversationId: string): void {
    this.frozenSessions.add(conversationId)
  }

  unfreezeSession(conversationId: string): void {
    this.frozenSessions.delete(conversationId)
  }

  isSessionFrozen(conversationId: string): boolean {
    return this.frozenSessions.has(conversationId)
  }

  // ─── Logging ──────────────────────────────────────────────────────────────

  private logSafetyEvent(
    eventType: SafetyEventType,
    action: SafetyAction,
    triggerContent: string,
    conversationId?: string,
    userId?: string
  ): void {
    auditLogger.logSafetyEvent({
      id: uuidv4(),
      userId,
      conversationId,
      eventType,
      triggerContent: triggerContent.slice(0, 500), // Truncate for storage
      action,
      createdAt: Date.now(),
    })
  }
}

// Singleton instance
export const safetyLayer = new SafetyLayer()

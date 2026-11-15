/**
 * Redaction of several fields as one unit: one session, fields in
 * conversation order, and one aggregate verdict. A blocked field blocks the
 * whole unit.
 */

import type { Session } from './engine.ts'
import type { BlockCode, ClassId, RedactOutput, RedactReport, Verdict } from './types.ts'

const NO_KEYS: ReadonlySet<string> = new Set()

/** Accumulates the redaction of one structured request. */
export class RedactionBatch {
  private verdict: Verdict = { kind: 'proceed' }
  private readonly counts: Record<ClassId, number> = {}
  private readonly tokens = new Set<string>()
  private fields = 0

  /** @param session - session whose vault every field shares. */
  constructor(private readonly session: Session) {}

  /** @returns whether any field so far was blocked. */
  get blocked(): boolean { return this.verdict.kind === 'blocked' }

  /**
   * Redact one plain-text field.
   * @param text - field value.
   * @returns the redacted value; the original is never returned once blocked.
   */
  text(text: string): string {
    if (this.blocked) return ''
    return this.absorb(this.session.redact(text))
  }

  /**
   * Redact the string values of a JSON document, keeping keys and structure.
   * Text that is not valid JSON is redacted as plain text.
   * @param raw - JSON text, for example tool-call arguments.
   * @returns the re-serialized redacted JSON.
   */
  json(raw: string): string {
    if (this.blocked) return ''
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (_notJson) {
      // Partial or invalid JSON still crosses the wire; protect it as text.
      return this.text(raw)
    }
    const redacted = this.value(parsed)
    return this.blocked ? '' : JSON.stringify(redacted)
  }

  /**
   * Redact every string inside a structured value, keeping keys and structure.
   * @param value - JSON-like value, for example a session-log event or a JSON Schema.
   * @param keep - keys whose string values are identifiers or vocabulary, not content, and stay as they are.
   * @returns a redacted copy; check {@link blocked} before sending it.
   */
  value(value: unknown, keep: ReadonlySet<string> = NO_KEYS): unknown {
    const walk = (item: unknown, key?: string): unknown => {
      if (typeof item === 'string') return key !== undefined && keep.has(key) ? item : this.text(item)
      if (Array.isArray(item)) return item.map(element => walk(element))
      if (item !== null && typeof item === 'object') {
        return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, walk(child, name)]))
      }
      return item
    }
    return walk(value)
  }

  /**
   * Refuse the whole unit for a reason found outside the text, for example an image.
   * @param code - value-free reason.
   */
  refuse(code: BlockCode): void {
    this.verdict = { kind: 'blocked', code }
  }

  /** @returns the aggregate verdict and value-free report of every field so far. */
  result(): { verdict: Verdict; report: RedactReport; fields: number } {
    return {
      verdict: this.verdict,
      report: { countsByClass: { ...this.counts }, tokensUsed: [...this.tokens], strategy: this.session.strategy.id },
      fields: this.fields,
    }
  }

  private absorb(output: RedactOutput): string {
    this.fields++
    for (const [classId, count] of Object.entries(output.report.countsByClass)) this.counts[classId] = (this.counts[classId] ?? 0) + count
    for (const token of output.report.tokensUsed) this.tokens.add(token)
    if (output.verdict.kind === 'blocked') this.verdict = output.verdict
    return output.text
  }
}

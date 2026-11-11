/**
 * Guards for the DSH channels that send conversation content off the computer
 * outside the model request itself:
 * - `session-telemetry/record`: the Session log released on explicit feedback
 *   (session-telemetry-otel, `FEEDBACK_ONLY` by default);
 * - the `dsh_session_log` field that session-log-deepseek adds to official
 *   DeepSeek API requests, carrying the canonical (unredacted) Session log.
 * Both are redacted with the same per-Session vault as the model requests, so the
 * symbols match; when sAI cannot redact, the content is withheld (fail-closed).
 */

import type { Context } from '@deepseek-ai/cordis'
import { RedactionBatch, type Session } from './core/index.ts'
import { LOG_IDENTITY_KEYS } from './request.ts'

/** The sAI session for a Session id; `off` when sAI is disabled, `invalid` when its settings cannot compile. */
export type SessionLookup = (sessionId: string | undefined) => Session | 'off' | 'invalid'

/** The subset of a telemetry record sAI rewrites (see dsh-session-telemetry). */
interface TelemetryRecord {
  readonly sourceEvent?: { readonly sessionId: string }
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly body?: unknown
}

/** The subset of the DeepSeek request-extension registry sAI wraps (see dsh-deepseek-llm-api-extensions). */
interface ExtensionRegistry {
  prepare(request: { readonly sessionId?: string }): Promise<{ readonly fields: Readonly<Record<string, unknown>>; accept(): Promise<void> }>
}

/** Loosely typed event and service access: these packages are optional for sAI. */
interface LooseContext {
  on(name: string, listener: (value: unknown, next: () => unknown) => unknown): unknown
  inject(deps: string[], callback: (child: LooseContext & Record<string, unknown>) => void): unknown
  effect(execute: () => () => void): unknown
}

/** Session-log keys whose strings are identity, never content. */
const SESSION_KEYS: ReadonlySet<string> = new Set([
  ...LOG_IDENTITY_KEYS, 'createdAt', 'origin', 'agentPreset',
  // Telemetry identity attributes (session.cwd is not here: a path may name a person).
  'session.id', 'session.format_version', 'session.parent_id', 'session.seed_length', 'event.type', 'event.seq',
  'telemetry.op', 'agent.id', 'error.name',
])

/**
 * Redact one structured payload with a Session's vault.
 * @param session - vault owner.
 * @param value - payload to copy and redact.
 * @returns the redacted copy, or undefined when sAI refused it.
 */
export function redactPayload(session: Session, value: unknown): unknown {
  const batch = new RedactionBatch(session)
  const redacted = batch.value(value, SESSION_KEYS)
  return batch.blocked ? undefined : redacted
}

/**
 * Install both guards.
 * @param ctx - sAI plugin context.
 * @param lookup - resolves the sAI session of a DSH Session.
 * @param warn - value-free warning sink.
 */
export function guardEgress(ctx: Context, lookup: SessionLookup, warn: (message: string) => void): void {
  const loose = ctx as unknown as LooseContext

  loose.on('session-telemetry/record', (_record, next) => {
    const record = next() as TelemetryRecord
    const session = lookup(record.sourceEvent?.sessionId)
    if (session === 'off') return record
    // A throwing listener withholds this one record: the telemetry contract is fail-closed.
    if (session === 'invalid') throw new Error('sAI settings are invalid; telemetry record withheld')
    const body = record.body === undefined ? undefined : redactPayload(session, record.body)
    const attributes = record.attributes === undefined ? undefined : redactPayload(session, record.attributes)
    if ((record.body !== undefined && body === undefined) || (record.attributes !== undefined && attributes === undefined)) {
      throw new Error('sAI could not redact a telemetry record; withheld')
    }
    return { ...record, ...body === undefined ? {} : { body }, ...attributes === undefined ? {} : { attributes } }
  })

  loose.inject(['deepseekLlmApiExtensions'], (child) => {
    const registry = child.deepseekLlmApiExtensions as ExtensionRegistry
    const original = registry.prepare
    registry.prepare = async function prepare(this: ExtensionRegistry, request) {
      const prepared = await original.call(this, request)
      if (!Object.hasOwn(prepared.fields, 'dsh_session_log')) return prepared
      const session = lookup(request.sessionId)
      if (session === 'off') return prepared
      const fields: Record<string, unknown> = { ...prepared.fields }
      const redacted = session === 'invalid' ? undefined : redactPayload(session, fields['dsh_session_log'])
      if (redacted === undefined) {
        delete fields['dsh_session_log']
        warn('sAI withheld the DeepSeek session-log field it could not redact')
      } else {
        fields['dsh_session_log'] = redacted
      }
      return { fields: Object.freeze(fields), accept: () => prepared.accept() }
    }
    child.effect(() => () => { registry.prepare = original })
  })
}

/**
 * sAI: reversible pseudonymization of protected terms before model requests
 * leave the machine. The plugin wraps every `llm/stream` call: it redacts the
 * request through a per-Session vault, sends the redacted copy, and restores
 * the streamed answer before the harness assembles and logs it. The local
 * Session log therefore keeps the original text, while the provider receives
 * only symbols.
 * @module @deepseek-ai/dsh-experimental-sai
 */

import { randomUUID } from 'node:crypto'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAgentLoopRequest, type GenerateOptions, type LlmFailure, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-settings'
import {
  DEFAULT_PATTERNS, DEFAULT_SETTINGS, Engine, verifyTexts, type Action, type SaiSettings, type Session,
  type StrategyId, type VerifierSettings, type VocabularyEntry,
} from './core/index.ts'
import { guardEgress } from './egress.ts'
import { redactRequest, requestTexts, restoreStream, type FileTextOf } from './request.ts'
import { httpVerifier } from './verifier-client.ts'
import { SaiModelViewRemote } from './remote.ts'
import { ModelViewStore } from './view.ts'

export * from './core/index.ts'
export { redactRequest, requestTexts, restoreStream } from './request.ts'
export { httpVerifier } from './verifier-client.ts'
export { SaiModelViewRemote } from './remote.ts'
export type { SaiModelView, SaiViewBlock, SaiViewMessage } from './view-types.ts'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'sai'

/** The model runtime whose `llm/stream` waterfall this plugin wraps. */
export const inject = ['llm']

/** Live settings edited on the bundle's Plugins page. */
export interface Config {
  enabled: Volatile<boolean>
  strategy: Volatile<StrategyId>
  preamble: Volatile<boolean>
  preambleTexts: Volatile<{ typed?: string; greek?: string }>
  vocabulary: Volatile<VocabularyEntry[]>
  patterns: Volatile<string[]>
  actions: Volatile<Record<string, Action | 'warn'>>
  allowlist: Volatile<string[]>
  languages: Volatile<string[]>
  images: Volatile<'block' | 'allow'>
  externalTools: Volatile<string[]>
  verifier: Volatile<Partial<VerifierSettings>>
  /** Sessions whose vaults are kept in memory; the least recently used are forgotten first. */
  maxSessions: number
}

/** `warn` is accepted only so profiles saved by older versions still load; the core treats it as `tokenize`. */
const ACTIONS = ['tokenize', 'mask', 'ignore', 'block', 'warn'] as const

export const Config = z.object({
  enabled: z.boolean().default(DEFAULT_SETTINGS.enabled).volatile(),
  strategy: z.union(['typed', 'greek'] as const).default(DEFAULT_SETTINGS.strategy).volatile(),
  preamble: z.boolean().default(DEFAULT_SETTINGS.preamble).volatile(),
  preambleTexts: z.object({ typed: z.string(), greek: z.string() }).default({}).volatile(),
  vocabulary: z.array(z.object({
    id: z.string(),
    class: z.string().required(),
    terms: z.array(z.string()).required(),
    restoreAs: z.string(),
  })).default([]).volatile(),
  patterns: z.array(z.string()).default([...DEFAULT_PATTERNS]).volatile(),
  actions: z.dict(z.union([...ACTIONS])).default({ ...DEFAULT_SETTINGS.actions }).volatile(),
  allowlist: z.array(z.string()).default([]).volatile(),
  languages: z.array(z.string()).default([...DEFAULT_SETTINGS.languages]).volatile(),
  images: z.union(['block', 'allow'] as const).default(DEFAULT_SETTINGS.images).volatile(),
  externalTools: z.array(z.string()).default([...DEFAULT_SETTINGS.externalTools]).volatile(),
  verifier: z.object({
    enabled: z.boolean(),
    mode: z.union(['lowercase', 'all'] as const),
    descriptions: z.dict(z.string()),
    url: z.string(),
    threshold: z.number(),
    timeoutMs: z.natural(),
  }).default({ ...DEFAULT_SETTINGS.verifier }).volatile(),
  maxSessions: z.natural().min(1).default(200),
})

/** Stable failure code of a request sAI refused to send. */
export const SAI_BLOCKED = 'SAI_BLOCKED'

/** Read every live field once, so one request sees one consistent configuration. */
function snapshot(config: Config): SaiSettings {
  return {
    enabled: config.enabled.get(),
    strategy: config.strategy.get(),
    preamble: config.preamble.get(),
    preambleTexts: config.preambleTexts.get(),
    vocabulary: config.vocabulary.get(),
    patterns: config.patterns.get(),
    // A legacy `warn` is mapped to `tokenize` when the Engine resolves these settings.
    actions: config.actions.get() as SaiSettings['actions'],
    allowlist: config.allowlist.get(),
    languages: config.languages.get(),
    images: config.images.get(),
    externalTools: config.externalTools.get(),
    // Partial values are completed and checked when the Engine resolves these settings.
    verifier: config.verifier.get() as VerifierSettings,
  }
}

/**
 * 32-bit FNV-1a hash.
 * @param text - input.
 * @returns the hash.
 */
function fnv1a(text: string): number {
  let hash = 0x811C9DC5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return hash >>> 0
}

/**
 * Small deterministic uniform source (mulberry32).
 * @param seed - 32-bit seed.
 * @returns a [0, 1) generator.
 */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Install the request wrapper.
 * @param ctx - plugin context.
 * @param config - live settings.
 */
export function apply(ctx: Context, config: Config): void {
  // The custom page on the bundle's Plugins page replaces the generated form.
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })

  /** Per-process secret: Greek permutations are stable within a process and unpredictable outside it. */
  const secret = randomUUID()
  /** Requests this plugin already redacted; their nested pass goes straight to the adapter. */
  const own = new WeakSet<GenerateOptions>()
  const sessions = new Map<string, Session>()
  const views = new ModelViewStore(() => config.maxSessions)
  ctx.inject(['typert'], (child) => { child.plugin(SaiModelViewRemote, views) })
  let engineKey = ''
  let engine: Engine | undefined
  let engineError: string | undefined

  const currentEngine = (settings: SaiSettings): Engine | undefined => {
    const key = JSON.stringify(settings)
    if (key !== engineKey) {
      engineKey = key
      sessions.clear()
      views.clear()
      try {
        engine = new Engine(settings)
        engineError = undefined
        if (engine.problems.length > 0) ctx.logger.warn('sAI settings problems: %s', engine.problems.join('; '))
      } catch (error) {
        engine = undefined
        engineError = error instanceof Error ? error.message : String(error)
        ctx.logger.error('sAI settings are invalid: %s', engineError)
      }
    }
    return engine
  }

  const sessionFor = (active: Engine, sessionId: string | undefined): Session => {
    if (sessionId === undefined) return active.session({ random: seededRandom(fnv1a(`${secret}:${randomUUID()}`)) })
    const existing = sessions.get(sessionId)
    if (existing !== undefined) {
      sessions.delete(sessionId)
      sessions.set(sessionId, existing)
      return existing
    }
    const created = active.session({ random: seededRandom(fnv1a(`${secret}:${sessionId}`)) })
    sessions.set(sessionId, created)
    while (sessions.size > config.maxSessions) sessions.delete(sessions.keys().next().value!)
    return created
  }

  ctx.on('llm/stream', (options, next): AsyncIterable<StreamChunk> => {
    if (own.has(options)) return next()
    const settings = snapshot(config)
    if (!settings.enabled) return next()
    const active = currentEngine(settings)
    if (active === undefined) {
      return refusal(`sAI settings are invalid (${engineError ?? 'unknown error'}); the request was not sent`)
    }
    const session = sessionFor(active, options.sessionId)
    const fileText: FileTextOf = block => ctx.llm.fileRequestText(block.attachment)
    const verifier = active.settings.verifier
    if (!verifier.enabled) return send(options, session, settings, fileText)
    // Every lowercase form of a declared name in the request goes to the local model in one call first.
    return (async function* verified(): AsyncIterable<StreamChunk> {
      const report = await verifyTexts(session, requestTexts(options, session, fileText), httpVerifier(verifier))
      if (report.failed) ctx.logger.warn('sAI verifier failed for %d words; they are replaced', report.asked)
      else if (report.asked > 0) ctx.logger.debug('sAI verifier answered %d words in one call', report.asked)
      yield* send(options, session, settings, fileText)
    })()
  })

  /** Redact one request with the session's verifier answers, send it, and restore the answer. */
  const send = (options: GenerateOptions, session: Session, settings: SaiSettings, fileText: FileTextOf): AsyncIterable<StreamChunk> => {
    const redacted = redactRequest(
      options,
      session,
      fileText,
      settings.preamble ? session.preamble() : undefined,
      { images: settings.images },
    )
    const counts = Object.entries(redacted.report.countsByClass).map(([classId, count]) => `${classId}=${count}`).join(', ')
    if (redacted.verdict.kind === 'blocked') {
      const { code, classId } = redacted.verdict
      ctx.logger.warn('sAI blocked a request: %s%s', code, classId === undefined ? '' : ` (${classId})`)
      const hint = code === 'IMAGE_NOT_INSPECTABLE' ? ' — sAI cannot read images; allow them in the sAI settings to send this request' : ''
      return refusal(`sAI blocked this request: ${code}${classId === undefined ? '' : ` (class ${classId})`}${hint}`)
    }
    ctx.logger.debug('sAI redacted a request (%s): %s', session.strategy.id, counts || 'nothing')
    const outgoing = redacted.options
    own.add(outgoing)
    // Only conversation requests define what the Session shows; title and compaction calls do not.
    const record = options.sessionId !== undefined && isAgentLoopRequest(options)
      ? views.begin(options.sessionId, session.strategy.id, outgoing)
      : (upstream: AsyncIterable<StreamChunk>) => upstream
    return restoreStream(record(ctx.llm.stream(outgoing)), session, (report) => {
      if (report.unknownTokens.length > 0 || report.tolerantMatches.length > 0 || report.suspicious.length > 0) {
        ctx.logger.info(
          'sAI restored %d symbols; altered=%d unknown=%d suspicious=%d',
          report.restored, report.tolerantMatches.length, report.unknownTokens.length, report.suspicious.length,
        )
      }
    }, settings.externalTools)
  }

  // Conversation content also leaves through feedback telemetry and the DeepSeek session-log field.
  guardEgress(ctx, (sessionId) => {
    const settings = snapshot(config)
    if (!settings.enabled) return 'off'
    const active = currentEngine(settings)
    return active === undefined ? 'invalid' : sessionFor(active, sessionId)
  }, message => ctx.logger.warn(message))
}

/**
 * A stream that ends immediately with a non-retryable failure.
 * @param message - value-free explanation.
 * @returns the terminal stream.
 */
async function* refusal(message: string): AsyncIterable<StreamChunk> {
  const failure: LlmFailure = { message, code: SAI_BLOCKED }
  yield { type: 'finish', reason: { kind: 'error', failure } }
}

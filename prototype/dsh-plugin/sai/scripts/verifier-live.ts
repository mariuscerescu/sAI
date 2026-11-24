/**
 * Real-model evaluation of the built sAI plugin (`lib/index.js`) with the local verifier in mode `all`: the fictitious cases of
 * `sAI/eval/cases-en.json` and `cases-en-forms.json` go through the DSH LLM runtime to a real provider. For each case it saves
 * what the provider received, the raw answer and the restored answer, so a person can read them all. Resumable.
 *
 * Start the service first (verifier/decider_server.py), then from the repository root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-live.ts --file cases-en.json --out <dir> [--cases A1,B2] [--variants typed,greek]
 * Environment: DSH_HOME (credentials only, no profile settings are read), SAI_EVAL_PROVIDER, SAI_EVAL_MODEL, SAI_EVAL_BASE_URL,
 * SAI_EVAL_KEY_REF, SAI_EVAL_DELAY_MS.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { normalizeTerm, type VocabularyEntry } from '../src/core/index.ts'
import { termForms } from '../src/core/inflection.ts'
import { combineLanguages } from '../src/core/languages.ts'

const REPO = resolve(import.meta.dirname, '../../../..')
const SAI_EVAL = 'D:\\Disk D 13-09-25\\EC\\sAI\\eval'
const VERIFIER = 'http://127.0.0.1:8765/verify'
const { values } = parseArgs({ options: {
  file: { type: 'string', default: 'cases-en.json' }, out: { type: 'string' }, cases: { type: 'string' },
  variants: { type: 'string', default: 'typed,greek' }, 'max-tokens': { type: 'string', default: '8000' },
} })
const PROVIDER = process.env.SAI_EVAL_PROVIDER ?? 'open-router'
const MODEL = process.env.SAI_EVAL_MODEL ?? 'thinkingmachines/inkling-2-small:free'
const BASE_URL = process.env.SAI_EVAL_BASE_URL ?? 'https://openrouter.ai/api/v1'
const KEY_REF = process.env.SAI_EVAL_KEY_REF ?? 'OPEN_ROUTER_API_KEY'
const DELAY_MS = Number(process.env.SAI_EVAL_DELAY_MS ?? 4000)
const MARKERS = { typed: 'placeholders of the form', greek: 'isolated Greek letters' } as const
const ENGLISH = combineLanguages(['en'])

interface Case { id: string; category: string; turns: string[] }
interface CaseFile { system: string; vocabulary: VocabularyEntry[]; cases: Case[] }
type Variant = keyof typeof MARKERS
interface Turn { user: string; sent?: string; raw: string; rawReasoning: string; restored: string; flagged: string[]; blocked?: string; error?: string; ms: number }

/** Every vocabulary form found in what was sent. A hit may be an ordinary word the verifier cleared, so each is read by hand. */
function flagged(sent: string, vocabulary: readonly VocabularyEntry[]): string[] {
  const text = normalizeTerm(sent)
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new Set<string>()
  for (const entry of vocabulary) {
    for (const term of entry.terms) {
      const norm = normalizeTerm(term)
      if (norm.length < 2) continue
      const parts = norm.includes(' ') ? norm.split(' ').filter(word => word.length >= 2) : []
      for (const form of new Set([...termForms(norm, ENGLISH.wordForms), ...parts.flatMap(part => ENGLISH.wordForms(part))])) {
        if (new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, 'u').test(text)) found.add(`${entry.class}:${term} (${form})`)
      }
    }
  }
  return [...found]
}

const textOf = (message: GenerateOptions['messages'][number]): string => message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
const id = (): never => Math.random().toString(36).slice(2) as never

async function setup(variant: Variant, vocabulary: VocabularyEntry[]) {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const { default: Credentials } = await import(pathToFileURL(join(REPO, 'packages/credentials/credentials-local/lib/index.js')).href)
  await ctx.plugin(Credentials, {})
  const piAi = await import(pathToFileURL(join(REPO, 'packages/llm/llm-pi-ai/lib/index.js')).href)
  await ctx.plugin(piAi, { providers: { [PROVIDER]: { displayName: PROVIDER, apiKeyEnv: KEY_REF, api: 'openai-completions', baseURL: BASE_URL, models: [{ id: MODEL, name: MODEL }] } } })
  await sleep(500)
  const sai = await import(pathToFileURL(join(REPO, 'packages/experimental/sai/lib/index.js')).href)
  await ctx.plugin(sai, { vocabulary, languages: ['en'], strategy: variant, verifier: { enabled: true, mode: 'all', url: VERIFIER, threshold: 0.2, timeoutMs: 30_000, descriptions: {} } })
  const seen: { options?: GenerateOptions; raw: string; reasoning: string } = { raw: '', reasoning: '' }
  ctx.on('llm/stream', (options, next) => {
    // The request sAI redacted carries its preamble; only that one is what the provider receives.
    if (!JSON.stringify(options.messages).includes(MARKERS[variant]) && !(options.system ?? '').includes(MARKERS[variant])) return next()
    seen.options = options
    seen.raw = ''
    seen.reasoning = ''
    return (async function* tap(): AsyncIterable<StreamChunk> {
      for await (const chunk of next()) {
        if (chunk.type === 'text-delta') seen.raw += chunk.text
        if (chunk.type === 'reasoning-delta') seen.reasoning += chunk.text
        yield chunk
      }
    })()
  })
  return { ctx, seen }
}

async function call(ctx: Context, options: GenerateOptions, turn: Turn): Promise<'ok' | 'error' | 'blocked' | 'daily-limit'> {
  for (let attempt = 0; attempt < Number(process.env.SAI_EVAL_ATTEMPTS ?? 4); attempt++) {
    turn.restored = ''
    turn.error = undefined
    let failure: { code?: string; message: string } | undefined
    for await (const chunk of ctx.llm.stream(options)) {
      if (chunk.type === 'text-delta') turn.restored += chunk.text
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) failure = chunk.reason.failure
    }
    if (failure === undefined) return 'ok'
    if (failure.code === 'SAI_BLOCKED') {
      turn.blocked = failure.message
      return 'blocked'
    }
    turn.error = `${failure.code}: ${failure.message}`
    const lower = turn.error.toLowerCase()
    if (lower.includes('per-day') || lower.includes('free-models-per-day') || lower.includes('daily')) return 'daily-limit'
    if (/\b(429|500|502|503|504)\b|rate.?limit|timeout|overloaded/.test(lower)) {
      console.log(`  retry after: ${turn.error.slice(0, 120)}`)
      if (attempt + 1 < Number(process.env.SAI_EVAL_ATTEMPTS ?? 4)) await sleep(30_000 * (attempt + 1))
      continue
    }
    return 'error'
  }
  return 'error'
}

const file = JSON.parse(readFileSync(join(SAI_EVAL, values.file!), 'utf8')) as CaseFile
const out = resolve(values.out ?? join(SAI_EVAL, 'results', 'run-live'))
mkdirSync(out, { recursive: true })
const selected = values.cases ? new Set(values.cases.split(',')) : undefined
let stop = false
for (const variant of values.variants!.split(',') as Variant[]) {
  if (stop) break
  const { ctx, seen } = await setup(variant, file.vocabulary)
  for (const testCase of file.cases) {
    if (stop) break
    if (selected && !selected.has(testCase.id)) continue
    const target = join(out, `${testCase.id}__${variant}.json`)
    if (existsSync(target)) continue
    const history: Message[] = [{ id: id(), role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: file.system }] }]
    const turns: Turn[] = []
    const sessionId = `live-${testCase.id}-${variant}` as never
    let failed = false
    for (const user of testCase.turns) {
      history.push({ id: id(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: user }] })
      const turn: Turn = { user, raw: '', rawReasoning: '', restored: '', flagged: [], ms: 0 }
      seen.options = undefined
      const started = Date.now()
      const result = await call(ctx, { provider: PROVIDER, model: MODEL, sessionId, messages: [...history], maxTokens: Number(values['max-tokens']) }, turn)
      turn.ms = Date.now() - started
      if (seen.options !== undefined) {
        turn.sent = textOf(seen.options.messages.at(-1)!)
        turn.flagged = flagged(JSON.stringify(seen.options.messages), file.vocabulary)
        turn.raw = seen.raw
        turn.rawReasoning = seen.reasoning
      }
      turns.push(turn)
      if (result === 'daily-limit') { stop = true; failed = true; console.log(`stopped at ${testCase.id}/${variant}: daily quota`); break }
      if (result !== 'ok') { failed = result === 'error'; break }
      history.push({ id: id(), role: 'assistant', source: { kind: 'model', provider: PROVIDER, model: MODEL }, content: [{ type: 'text', text: turn.restored }] })
      await sleep(DELAY_MS)
    }
    // A failed case is not saved, so the next run asks it again.
    if (!stop && !failed) writeFileSync(target, JSON.stringify({ case: testCase.id, category: testCase.category, variant, model: MODEL, plugin: 'lib/index.js', verifier: 'all@0.2', turns }, null, 2))
    const last = turns.at(-1)
    console.log(`${testCase.id} ${variant}: ${last?.blocked ? 'blocked' : last?.error ? `error ${last.error.slice(0, 100)}` : `${last?.restored.length ?? 0} chars`}${turns.some(t => t.flagged.length > 0) ? ` flagged ${turns.flatMap(t => t.flagged).length}` : ''}${failed ? ' FAILED' : ''}`)
  }
  await ctx.fiber.dispose()
}
console.log('live run finished')
process.exit(0)

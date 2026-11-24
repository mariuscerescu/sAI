/**
 * The single final run of the frozen English set (rules: eval/frozen-en/SPEC.md, section 12): the built plugin, the real local
 * verifier, one call per message, and a fake local provider. Nothing leaves the computer.
 * Start the service first (verifier/decider_server.py), then from the DSH root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-final.ts dry    40 calibration messages, to test this script
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-final.ts run    the final part
 * The run refuses to continue with changed code and refuses to start once its report exists.
 * Totals go to eval/results/frozen-final.json. Per-message results and error contexts stay in sai-model-bench/results.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { Engine, questionKey, type VerifierAnswer, type VerifierQuestion, type VocabularyEntry } from '../src/core/index.ts'

const command = process.argv[2]
if (command !== 'dry' && command !== 'run') throw new Error('usage: verifier-final.ts dry|run')
const DRY = command === 'dry'
const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))
const PART = DRY ? 'calibration' : 'final'
const LIMIT = DRY ? 40 : Number.POSITIVE_INFINITY
const PROGRESS = join(BENCH, 'results', DRY ? 'frozen-final-dry-progress.jsonl' : 'frozen-final-progress.jsonl')
const REPORT = DRY ? join(BENCH, 'results', 'frozen-final-dry.json') : join(SAI, 'eval', 'results', 'frozen-final.json')
const SERVICE = 'http://127.0.0.1:8765/verify'
const PROXY_PORT = 8766
const PROXY = `http://127.0.0.1:${PROXY_PORT}/verify`
const MODES = ['all', 'lowercase'] as const
const SYMBOL = /⟦[A-Z][A-Z0-9_]*_\d+⟧/
const HARD = new Set(`bill mark rose grace hope will may june april frank joy faith grant dean rich art drew chase wade lane
reed cliff glen heath iris ivy olive pearl ruby crystal dawn summer holly daisy lily violet angel jack rob sue pat gene
ray guy sterling hunter mason baker turner cook miller brown white young king wood hill stone price green black bell page
ward fisher carter porter cole smith taylor walker wright hall fox wolf lamb field marsh short long little small rice bush
park love best sharp moody rush apple shell target oracle amazon gap visa delta dove sprint square slack zoom subway orange
jaguar puma corona mercury sage monster unity notion discord signal tide ford mint`.split(/\s+/))

interface Check { start: number; end: number; word: string; masked: boolean; role: string; route: string }
interface Case { id: string; source: string; variant: string; languages: string[]; vocabulary: VocabularyEntry[]; text: string; checks: Check[] }
const COUNTERS = ['sent', 'blocked', 'blockedSent', 'moreThanOneCall', 'differentFromDirect', 'names', 'leaked', 'oneWord', 'oneWordLeaked', 'hard', 'hardLeaked',
  'ordinary', 'overMasked', 'ordinaryCapitalized', 'overMaskedCapitalized', 'symbolsLeftInAnswer', 'answerIdentical', 'answerDiffers', 'calls', 'questions'] as const
type Counts = Record<typeof COUNTERS[number], number>
interface Row { mode: string; index: number; counts: Partial<Counts>; callMs?: number; errors?: unknown[] }

/** One fingerprint for everything that decides the result. */
function fingerprint(): string {
  const files: string[] = []
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder)) {
      const path = join(folder, name)
      if (statSync(path).isDirectory()) walk(path)
      else files.push(path)
    }
  }
  walk(join(PACKAGE, 'src'))
  files.push(join(PACKAGE, 'verifier', 'decider_server.py'), join(PACKAGE, 'lib', 'index.js'), fileURLToPath(import.meta.url))
  const hash = createHash('sha256')
  for (const path of files.sort()) hash.update(relative(PACKAGE, path).replaceAll('\\', '/')).update('\0').update(readFileSync(path).toString('utf8').replaceAll('\r\n', '\n')).update('\0')
  return hash.digest('hex')
}

function loadCases(): { cases: Case[]; sha256: string } {
  const body = readFileSync(join(BENCH, 'data', 'frozen-en', `${PART}.jsonl`))
  const manifest = JSON.parse(readFileSync(join(SAI, 'eval', 'frozen-en', 'manifest.json'), 'utf8')) as { parts: Record<string, { sha256: string }> }
  const sha256 = createHash('sha256').update(body).digest('hex')
  if (sha256 !== manifest.parts[PART]!.sha256) throw new Error(`the ${PART} part does not match the manifest`)
  return { cases: body.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Case).slice(0, LIMIT), sha256 }
}

/** Recording proxy: counts calls, keeps their answers, and notes a failed service so that message is not counted. */
const calls: { questions: VerifierQuestion[]; answers: VerifierAnswer[]; ms: number }[] = []
let serviceFailed = false
const proxy = createServer((request, response) => {
  const parts: Buffer[] = []
  request.on('data', part => parts.push(part as Buffer))
  request.on('end', () => void (async () => {
    const body = Buffer.concat(parts).toString('utf8')
    const started = performance.now()
    try {
      const upstream = await fetch(SERVICE, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const text = await upstream.text()
      if (!upstream.ok) throw new Error(`service answered ${upstream.status}`)
      calls.push({ questions: (JSON.parse(body) as { questions: VerifierQuestion[] }).questions, answers: (JSON.parse(text) as { answers: VerifierAnswer[] }).answers, ms: performance.now() - started })
      response.writeHead(200, { 'content-type': 'application/json' }).end(text)
    } catch {
      serviceFailed = true
      if (!response.destroyed) response.writeHead(502).end()
    }
  })())
})

const textOf = (options: GenerateOptions): string => options.messages.at(-1)!.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')

class Provider extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    const answer = textOf(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    for (let at = 0; at < answer.length; at += 5) yield { type: 'text-delta', index: 0, text: answer.slice(at, at + 5) }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const sai = await import(new URL('../lib/index.js', import.meta.url).href)

async function runMessage(c: Case, index: number, mode: typeof MODES[number]): Promise<Row> {
  const verifier = { enabled: true, mode, url: PROXY, threshold: 0.2, timeoutMs: 280_000, descriptions: {} }
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(sai, { vocabulary: c.vocabulary, languages: c.languages, verifier })
  const provider = new Provider()
  ctx.llm.registerAdapter(['stub'], provider)
  calls.length = 0
  serviceFailed = false
  try {
    let answer = ''
    for await (const chunk of ctx.llm.stream({ provider: 'stub', model: 'stub', sessionId: `final-${mode}-${index}` as never, messages: [{ role: 'user', content: [{ type: 'text', text: c.text }] }] })) {
      if (chunk.type === 'text-delta') answer += chunk.text
    }
    if (serviceFailed) throw new Error('the verifier service failed; this message is not counted')
    const t: Partial<Counts> = {}
    const add = (name: typeof COUNTERS[number]): void => { t[name] = (t[name] ?? 0) + 1 }
    t.calls = calls.length
    t.questions = calls.reduce((sum, call) => sum + call.questions.length, 0)
    if (calls.length > 1) add('moreThanOneCall')
    const replies = new Map<string, VerifierAnswer>()
    for (const call of calls) call.questions.forEach((q, k) => replies.set(questionKey(q), call.answers[k]!))
    const direct = new Engine({ vocabulary: c.vocabulary, languages: c.languages, verifier: verifier as never }).session()
    const questions = direct.questions(c.text)
    direct.answer(questions, questions.map(q => replies.get(questionKey(q)) as VerifierAnswer))
    const expected = direct.redact(c.text)
    const row: Row = { mode, index, counts: t, ...calls[0] === undefined ? {} : { callMs: Math.round(calls[0].ms) } }
    if (expected.verdict.kind === 'blocked') {
      add('blocked')
      if (provider.seen.length > 0) add('blockedSent')
      return row
    }
    add('sent')
    const errors: unknown[] = []
    const outgoing = provider.seen[0] === undefined ? undefined : textOf(provider.seen[0])
    if (outgoing !== expected.text) {
      add('differentFromDirect')
      errors.push({ type: 'different-from-direct', id: c.id, variant: c.variant })
    }
    for (const k of c.checks) {
      const masked = expected.decisions.some(({ span, action }) => action !== 'ignore' && span.start < k.end && k.start < span.end)
      if (k.masked) {
        const hard = k.route === 'one' && HARD.has(k.word.toLowerCase())
        add('names')
        if (k.route === 'one') add('oneWord')
        if (hard) add('hard')
        if (!masked) {
          add('leaked')
          if (k.route === 'one') add('oneWordLeaked')
          if (hard) add('hardLeaked')
        }
      } else {
        const capital = /^\p{Lu}/u.test(k.word)
        add('ordinary')
        if (capital) add('ordinaryCapitalized')
        if (masked) {
          add('overMasked')
          if (capital) add('overMaskedCapitalized')
        }
      }
      if (masked !== k.masked) {
        errors.push({ type: k.masked ? 'leak' : 'over-mask', id: c.id, source: c.source, variant: c.variant, role: k.role, route: k.route, word: k.word, start: k.start,
          context: `${c.text.slice(Math.max(0, k.start - 90), k.start)}[[${k.word}]]${c.text.slice(k.end, k.end + 60)}` })
      }
    }
    if (SYMBOL.test(answer)) add('symbolsLeftInAnswer')
    add(answer === c.text ? 'answerIdentical' : 'answerDiffers')
    return errors.length > 0 ? { ...row, errors } : row
  } finally {
    await ctx.fiber.dispose()
  }
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.96, p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d
  const h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
  return [Math.max(0, c - h), Math.min(1, c + h)]
}

if (!DRY && existsSync(REPORT)) throw new Error('the final report already exists: the final part runs once')
const code = fingerprint()
const { cases, sha256 } = loadCases()
if (DRY) writeFileSync(PROGRESS, '')
const rows = new Map<string, Row>()
if (existsSync(PROGRESS) && statSync(PROGRESS).size > 0) {
  const [header, ...lines] = readFileSync(PROGRESS, 'utf8').split('\n').filter(Boolean)
  if ((JSON.parse(header!) as { code: string }).code !== code) throw new Error('the code changed since this run started; it cannot continue')
  for (const line of lines) {
    const row = JSON.parse(line) as Row
    rows.set(`${row.mode}:${row.index}`, row)
  }
  console.log(`continuing: ${rows.size} results already counted`)
} else {
  writeFileSync(PROGRESS, `${JSON.stringify({ code, part: PART, sha256 })}\n`)
}

await new Promise<void>(resolve => proxy.listen(PROXY_PORT, '127.0.0.1', resolve))
for (const mode of MODES) {
  const started = performance.now()
  for (const [index, c] of cases.entries()) {
    if (rows.has(`${mode}:${index}`)) continue
    const row = await runMessage(c, index, mode)
    rows.set(`${mode}:${index}`, row)
    appendFileSync(PROGRESS, `${JSON.stringify(row)}\n`)
    if ((index + 1) % 250 === 0) console.log(`${mode}: ${index + 1}/${cases.length} in ${Math.round((performance.now() - started) / 1000)} s`)
  }
  console.log(`mode ${mode} done`)
}
proxy.closeAllConnections()
proxy.close()

const result: Record<string, unknown> = {}
for (const mode of MODES) {
  const selected = [...rows.values()].filter(row => row.mode === mode)
  const t = Object.fromEntries(COUNTERS.map(name => [name, selected.reduce((sum, row) => sum + (row.counts[name] ?? 0), 0)])) as Counts
  const ms = selected.flatMap(row => row.callMs ?? []).sort((a, b) => a - b)
  const [low, high] = wilson(t.overMasked, t.ordinary)
  const overMaskedPercent = t.ordinary === 0 ? 0 : 100 * t.overMasked / t.ordinary
  const integrity = t.differentFromDirect === 0 && t.blockedSent === 0 && t.moreThanOneCall === 0 && t.symbolsLeftInAnswer === 0
  result[mode] = {
    messages: selected.length, ...t, overMaskedPercent: +overMaskedPercent.toFixed(2), overMasked95: [+(100 * low).toFixed(2), +(100 * high).toFixed(2)],
    leakRateUpper95Percent: t.oneWord === 0 ? null : +(100 * (t.oneWordLeaked === 0 ? 3 / t.oneWord : wilson(t.oneWordLeaked, t.oneWord)[1])).toFixed(3),
    serviceCallMs: { calls: ms.length, median: percentile(ms, 0.5), p95: percentile(ms, 0.95), max: ms.at(-1) ?? 0 },
    rawPass: t.leaked === 0 && t.oneWord >= (DRY ? 0 : 3000) && overMaskedPercent <= 2 && integrity, integrity,
  }
  console.log(`result ${mode}`, JSON.stringify(result[mode]))
}
writeFileSync(REPORT, `${JSON.stringify({ part: PART, sha256, code, rule: 'SPEC.md section 12', threshold: 0.2, contextChars: 300, ...result }, null, 1)}\n`)
console.log('final script done')
process.exit(0)

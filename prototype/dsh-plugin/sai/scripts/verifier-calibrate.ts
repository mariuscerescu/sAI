/**
 * Threshold calibration of the sAI verifier on the CALIBRATION part of the frozen English set (rules: eval/frozen-en/SPEC.md,
 * section 8). The part is fixed in this file and its hash is checked: this script cannot read the final or reserve part.
 *
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-calibrate.ts collect    asks the local model, resumable
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-calibrate.ts evaluate   no model: replays the answers
 *
 * Answers and error lists hold document text, so they stay in sai-model-bench/results. The repository gets totals only.
 */
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, questionKey, type Candidate, type Decision, type VerifierAnswer, type VerifierQuestion, type VocabularyEntry } from '../src/core/index.ts'
import { httpVerifier } from '../src/verifier-client.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const PART = 'calibration'
const FILE = join(BENCH, 'data', 'frozen-en', `${PART}.jsonl`)
/** `collect <variant>` and `evaluate <variant>` use a separate answer file; `evaluate <variant>` writes no report. */
const VARIANT = process.argv[3]
const ANSWERS = join(BENCH, 'results', `frozen-calibration-answers${VARIANT === undefined ? '' : `-${VARIANT}`}.jsonl`)
const ERRORS = join(BENCH, 'results', 'frozen-calibration-errors.json')
const REPORT = join(SAI, 'eval', 'results', 'frozen-calibration.json')
/** Name labels of the source judged wrong, one by one (calibration part only). Their leaks are reported apart, never dropped. */
const REVIEW = join(SAI, 'eval', 'frozen-en', 'calibration-label-review.json')
const reviewed: ReadonlySet<string> = new Set(existsSync(REVIEW)
  ? (JSON.parse(readFileSync(REVIEW, 'utf8')) as { cases: { id: string; variant: string; start: number; word: string }[] }).cases.map(r => `${r.id}|${r.variant}|${r.start}|${r.word}`)
  : [])
const URL = 'http://127.0.0.1:8765/verify'
const THRESHOLDS = [0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
const MODES = ['lowercase', 'all'] as const
const MAX_OVERMASK = 0.015
const BATCH = 24
const HARD = new Set(`bill mark rose grace hope will may june april frank joy faith grant dean rich art drew chase wade lane
reed cliff glen heath iris ivy olive pearl ruby crystal dawn summer holly daisy lily violet angel jack rob sue pat gene
ray guy sterling hunter mason baker turner cook miller brown white young king wood hill stone price green black bell page
ward fisher carter porter cole smith taylor walker wright hall fox wolf lamb field marsh short long little small rice bush
park love best sharp moody rush apple shell target oracle amazon gap visa delta dove sprint square slack zoom subway orange
jaguar puma corona mercury sage monster unity notion discord signal tide ford mint`.split(/\s+/))

interface Check { start: number; end: number; word: string; masked: boolean; role: string; route: string }
interface Case { id: string; source: string; variant: string; languages: string[]; vocabulary: VocabularyEntry[]; text: string; checks: Check[] }

function loadCases(): Case[] {
  const body = readFileSync(FILE)
  const manifest = JSON.parse(readFileSync(join(SAI, 'eval', 'frozen-en', 'manifest.json'), 'utf8')) as { parts: Record<string, { sha256: string }> }
  if (createHash('sha256').update(body).digest('hex') !== manifest.parts[PART]!.sha256) throw new Error('the calibration part does not match the manifest')
  return body.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Case)
}

const engineFor = (c: Case, mode: 'off' | 'lowercase' | 'all', threshold: number): Engine => new Engine({
  vocabulary: c.vocabulary, languages: c.languages,
  ...mode === 'off' ? {} : { verifier: { enabled: true, mode, url: URL, threshold, timeoutMs: 600_000, descriptions: {} } },
})

function loadAnswers(): Map<string, VerifierAnswer> {
  const answers = new Map<string, VerifierAnswer>()
  if (existsSync(ANSWERS)) {
    for (const line of readFileSync(ANSWERS, 'utf8').split('\n')) {
      if (!line) continue
      const { key, answer } = JSON.parse(line) as { key: string; answer: VerifierAnswer }
      answers.set(key, answer)
    }
  }
  return answers
}

async function collect(): Promise<void> {
  const cases = loadCases()
  const answers = loadAnswers()
  const pending = new Map<string, VerifierQuestion>()
  for (const c of cases) {
    for (const mode of MODES) {
      for (const q of engineFor(c, mode, 0.2).session().questions(c.text)) {
        const key = questionKey(q)
        if (!answers.has(key)) pending.set(key, q)
      }
    }
  }
  const queue = [...pending.entries()].sort((a, b) => a[1].state.length - b[1].state.length)
  console.log(`messages ${cases.length}, answered ${answers.size}, to ask ${queue.length}`)
  const verifier = httpVerifier({ url: URL, timeoutMs: 280_000 })
  const started = performance.now()
  for (let i = 0; i < queue.length; i += BATCH) {
    const batch = queue.slice(i, i + BATCH)
    let result: readonly VerifierAnswer[] | undefined
    for (let attempt = 1; result === undefined; attempt++) {
      try {
        result = await verifier.verify(batch.map(([, q]) => q))
      } catch (error) {
        if (attempt >= 3) throw error
        console.log(`retry after: ${error instanceof Error ? error.name : 'error'}`)
      }
    }
    appendFileSync(ANSWERS, batch.map(([key], k) => `${JSON.stringify({ key, answer: result![k] })}\n`).join(''))
    if ((i / BATCH) % 25 === 0) console.log(`asked ${Math.min(i + BATCH, queue.length)}/${queue.length} in ${Math.round((performance.now() - started) / 1000)} s`)
  }
  console.log(`collect done: ${queue.length} questions in ${Math.round((performance.now() - started) / 1000)} s`)
}

/** `collect per-message`: one call per message, as the plugin makes it (the score of a question depends a little on its batch). */
async function collectPerMessage(): Promise<void> {
  const cases = loadCases()
  const answers = loadAnswers()
  const verifier = httpVerifier({ url: URL, timeoutMs: 280_000 })
  const started = performance.now()
  let calls = 0
  for (const mode of ['all', 'lowercase'] as const) {
    for (const c of cases) {
      const questions = engineFor(c, mode, 0.2).session().questions(c.text).filter(q => !answers.has(questionKey(q)))
      if (questions.length === 0) continue
      const result = await verifier.verify(questions)
      questions.forEach((q, k) => answers.set(questionKey(q), result[k]!))
      appendFileSync(ANSWERS, questions.map((q, k) => `${JSON.stringify({ key: questionKey(q), answer: result[k] })}\n`).join(''))
      if (++calls % 250 === 0) console.log(`calls ${calls}, questions ${answers.size}, ${Math.round((performance.now() - started) / 1000)} s`)
    }
  }
  console.log(`collect done: ${calls} calls, ${answers.size} questions in ${Math.round((performance.now() - started) / 1000)} s`)
}

interface Tally {
  names: number; leaked: number; oneWord: number; oneWordLeaked: number; hard: number; hardLeaked: number
  ordinary: number; overMasked: number; ordinaryCapitalized: number; overMaskedCapitalized: number; unanswered: number
  /** A blocked message sends nothing: its checks are neither leaks nor over-masks, and are counted here. */
  blockedMessages: number; blockedChecks: number
  /** Leaks on labels judged wrong in the review file: raw leaks = leaked + reviewedLeaks. */
  reviewedLeaks: number
}
const covering = (decisions: readonly Decision[], start: number, end: number): Decision | undefined =>
  decisions.find(({ span, action }) => action !== 'ignore' && span.start < end && start < span.end)

function evaluate(cases: Case[], answers: Map<string, VerifierAnswer>, mode: 'off' | 'lowercase' | 'all', threshold: number, errors?: unknown[]): Tally {
  const t: Tally = { names: 0, leaked: 0, oneWord: 0, oneWordLeaked: 0, hard: 0, hardLeaked: 0, ordinary: 0, overMasked: 0, ordinaryCapitalized: 0, overMaskedCapitalized: 0, unanswered: 0, blockedMessages: 0, blockedChecks: 0, reviewedLeaks: 0 }
  for (const c of cases) {
    const session = engineFor(c, mode, threshold).session()
    const questions = session.questions(c.text)
    const replies = questions.map((q) => {
      const answer = answers.get(questionKey(q))
      if (answer === undefined) t.unanswered++
      return answer as VerifierAnswer
    })
    session.answer(questions, replies)
    const output = session.redact(c.text)
    if (output.verdict.kind === 'blocked') {
      t.blockedMessages++
      t.blockedChecks += c.checks.length
      continue
    }
    for (const k of c.checks) {
      const masked = covering(output.decisions, k.start, k.end) !== undefined
      if (k.masked && reviewed.has(`${c.id}|${c.variant}|${k.start}|${k.word}`)) {
        if (!masked) t.reviewedLeaks++
        continue
      }
      if (k.masked) {
        const hard = k.route === 'one' && HARD.has(k.word.toLowerCase())
        t.names++
        if (k.route === 'one') t.oneWord++
        if (hard) t.hard++
        if (!masked) {
          t.leaked++
          if (k.route === 'one') t.oneWordLeaked++
          if (hard) t.hardLeaked++
        }
      } else {
        const capital = /^\p{Lu}/u.test(k.word)
        t.ordinary++
        if (capital) t.ordinaryCapitalized++
        if (masked) {
          t.overMasked++
          if (capital) t.overMaskedCapitalized++
        }
      }
      if (errors !== undefined && masked !== k.masked) {
        errors.push({ id: c.id, source: c.source, variant: c.variant, type: k.masked ? 'leak' : 'over-mask', role: k.role, route: k.route, word: k.word, start: k.start,
          context: c.text.slice(Math.max(0, k.start - 70), k.start) + '[[' + k.word + ']]' + c.text.slice(k.end, k.end + 50) })
      }
    }
  }
  return t
}

/** The model's score for each one-word form in mode `all`, paired with its label. */
function scores(cases: Case[], answers: Map<string, VerifierAnswer>): { names: number[]; ordinary: number[] } {
  const out = { names: [] as number[], ordinary: [] as number[] }
  for (const c of cases) {
    const session = engineFor(c, 'all', 0.2).session() as unknown as {
      gather(text: string): { unconfirmed: Candidate[] }; questionOf(text: string, span: Candidate): VerifierQuestion
    }
    for (const span of session.gather(c.text).unconfirmed) {
      const check = c.checks.find(k => k.start === span.start && k.end === span.end)
      const answer = answers.get(questionKey(session.questionOf(c.text, span)))
      if (check !== undefined && typeof answer === 'number') (check.masked ? out.names : out.ordinary).push(answer)
    }
  }
  return out
}

function runEvaluate(): void {
  const cases = loadCases()
  const answers = loadAnswers()
  const baseline = evaluate(cases, answers, 'off', 0.2)
  console.log('off', JSON.stringify(baseline))
  const grid: Record<string, Record<string, Tally>> = {}
  const chosen: Record<string, number | null> = {}
  for (const mode of MODES) {
    grid[mode] = {}
    chosen[mode] = null
    for (const threshold of THRESHOLDS) {
      const t = evaluate(cases, answers, mode, threshold)
      grid[mode]![threshold] = t
      if (chosen[mode] === null && t.leaked === 0 && t.overMasked / t.ordinary <= MAX_OVERMASK) chosen[mode] = threshold
      console.log(`${mode.padEnd(9)} T=${String(threshold).padEnd(5)} leaked ${t.leaked} (one-word ${t.oneWordLeaked}, hard ${t.hardLeaked})  over-masked ${t.overMasked}/${t.ordinary} = ${(100 * t.overMasked / t.ordinary).toFixed(2)}% (capitalized ${t.overMaskedCapitalized})  blocked ${t.blockedMessages}  label-reviewed ${t.reviewedLeaks}  unanswered ${t.unanswered}`)
    }
  }
  const s = scores(cases, answers)
  const sorted = [...s.names].sort((a, b) => a - b)
  const distribution = {
    namesScored: s.names.length, ordinaryScored: s.ordinary.length, lowestNames: sorted.slice(0, 10).map(p => +p.toFixed(4)),
    namesBelow: Object.fromEntries([0.01, 0.05, 0.1, 0.2, 0.5].map(x => [x, s.names.filter(p => p < x).length])),
    ordinaryAtOrAbove: Object.fromEntries([0.01, 0.05, 0.1, 0.2, 0.5].map(x => [x, s.ordinary.filter(p => p >= x).length])),
  }
  console.log('chosen by the rule', JSON.stringify(chosen)); console.log('scores', JSON.stringify(distribution))
  if (VARIANT !== undefined) return
  const errors: Record<string, unknown[]> = {}
  for (const mode of MODES) for (const threshold of new Set([0.2, chosen[mode] ?? 0.2])) {
    const list: unknown[] = []
    evaluate(cases, answers, mode, threshold, list)
    errors[`${mode}@${threshold}`] = list
  }
  writeFileSync(ERRORS, JSON.stringify(errors, null, 1))
  writeFileSync(REPORT, `${JSON.stringify({ part: PART, messages: cases.length, questionsAnswered: answers.size, rule: 'SPEC.md section 8', baseline, grid, chosen, distribution }, null, 1)}\n`)
  console.log('written', REPORT)
}

const command = process.argv[2]
if (command === 'collect') await (VARIANT === 'per-message' ? collectPerMessage() : collect())
else if (command === 'evaluate') runEvaluate()
else throw new Error('usage: verifier-calibrate.ts collect|evaluate')

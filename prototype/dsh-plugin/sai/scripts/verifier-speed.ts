/**
 * Time the sAI verifier adds to one message, on the CALIBRATION part of the frozen English set (rules: eval/frozen-en/SPEC.md,
 * section 10). The part is fixed in this file and its hash is checked: this script cannot read the final or reserve part.
 * Start the service first (verifier/decider_server.py), then from the DSH root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-speed.ts
 * Writes totals only (no text) to eval/results/frozen-speed.json.
 */
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'
import { httpVerifier } from '../src/verifier-client.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const PART = 'calibration'
const URL = 'http://127.0.0.1:8765/verify'
const WARM_UP = 20
const TARGET_MS = 1000
/** With a label: mode `all` only, totals written to sai-model-bench/results/frozen-speed-<label>.json. */
const LABEL = process.argv[2]
const MODES = (LABEL === undefined ? ['all', 'lowercase'] : ['all']) as readonly ('all' | 'lowercase')[]

interface Case { languages: string[]; vocabulary: VocabularyEntry[]; text: string }
interface Row { addedMs: number; callMs: number; questions: number; chars: number; failed: boolean }

function loadCases(): Case[] {
  const body = readFileSync(join(BENCH, 'data', 'frozen-en', `${PART}.jsonl`))
  const manifest = JSON.parse(readFileSync(join(SAI, 'eval', 'frozen-en', 'manifest.json'), 'utf8')) as { parts: Record<string, { sha256: string }> }
  if (createHash('sha256').update(body).digest('hex') !== manifest.parts[PART]!.sha256) throw new Error('the calibration part does not match the manifest')
  return body.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Case)
}

/** Nearest-rank percentile. */
function percentile(sorted: readonly number[], p: number): number {
  return sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}

function stats(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  const at = (p: number): number => Math.round(percentile(sorted, p))
  return { count: sorted.length, medianMs: at(0.5), p90Ms: at(0.9), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: Math.round(sorted.at(-1) ?? 0) }
}

async function timeMessage(c: Case, mode: typeof MODES[number], verifier: ReturnType<typeof httpVerifier>): Promise<Row> {
  const off = new Engine({ vocabulary: c.vocabulary, languages: c.languages }).session()
  const session = new Engine({ vocabulary: c.vocabulary, languages: c.languages,
    verifier: { enabled: true, mode, url: URL, threshold: 0.2, timeoutMs: 280_000, descriptions: {} } }).session()
  let started = performance.now()
  off.redact(c.text)
  const offMs = performance.now() - started
  started = performance.now()
  const questions = session.questions(c.text)
  let failed = false
  let callMs = 0
  if (questions.length > 0) {
    const called = performance.now()
    try {
      const answers = await verifier.verify(questions)
      callMs = performance.now() - called
      session.answer(questions, answers)
    } catch {
      failed = true
    }
  }
  session.redact(c.text)
  return { addedMs: Math.max(0, performance.now() - started - offMs), callMs, questions: questions.length, chars: c.text.length, failed }
}

const cases = loadCases()
const verifier = httpVerifier({ url: URL, timeoutMs: 280_000 })
for (const c of cases.slice(0, WARM_UP)) await timeMessage(c, 'all', verifier)

const result: Record<string, unknown> = {}
for (const mode of MODES) {
  const started = performance.now()
  const rows: Row[] = []
  for (const [index, c] of cases.entries()) {
    rows.push(await timeMessage(c, mode, verifier))
    if ((index + 1) % 250 === 0) console.log(`${mode}: ${index + 1}/${cases.length} in ${Math.round((performance.now() - started) / 1000)} s`)
  }
  const called = rows.filter(r => r.questions > 0)
  const buckets: [string, number, number][] = [['1', 1, 1], ['2-3', 2, 3], ['4-7', 4, 7], ['8-15', 8, 15], ['16+', 16, Infinity]]
  const summary = {
    messages: rows.length, withCall: called.length, questions: called.reduce((sum, r) => sum + r.questions, 0), failedCalls: rows.filter(r => r.failed).length,
    withCallMs: stats(called.map(r => r.addedMs)), allMessagesMs: stats(rows.map(r => r.addedMs)), serviceCallMs: stats(called.map(r => r.callMs)),
    meetsTarget: stats(called.map(r => r.addedMs)).p95Ms < TARGET_MS && rows.every(r => !r.failed),
    byQuestions: Object.fromEntries(buckets.map(([label, low, high]) => [label, stats(called.filter(r => r.questions >= low && r.questions <= high).map(r => r.addedMs))])),
    slowest: [...called].sort((a, b) => b.addedMs - a.addedMs).slice(0, 5).map(r => ({ ms: Math.round(r.addedMs), questions: r.questions, chars: r.chars })),
  }
  result[mode] = summary
  console.log(`speed ${mode}`, JSON.stringify({ withCall: summary.withCall, failed: summary.failedCalls, ...summary.withCallMs, meetsTarget: summary.meetsTarget }))
}
writeFileSync(LABEL === undefined ? join(SAI, 'eval', 'results', 'frozen-speed.json') : join(BENCH, 'results', `frozen-speed-${LABEL}.json`), `${JSON.stringify({ part: PART, rule: 'SPEC.md section 10', targetP95Ms: TARGET_MS, ...result }, null, 1)}\n`)
console.log('speed measurement done')

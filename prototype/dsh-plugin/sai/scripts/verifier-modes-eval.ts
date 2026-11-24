/**
 * The three verifier modes on the same data: `off` (capital-letter rules only), `lowercase` (variant B) and `all`
 * (two stages: every one-word form goes to the model, plus Q2 and Q3).
 *   1. the 824-case verifier set (reviewed labels; totals only, the Nemotron and Wikipedia texts stay out of the repo);
 *   2. the extended hand-written set eval/verifier-cases-extra.json (fictitious; failures listed);
 *   3. 29 English Wikipedia articles with the English fixture vocabulary;
 *   4. the English evaluation conversations (eval/cases-en.json).
 * Each message makes at most one verifier call, as in the plugin. Run the service first (verifier/decider_server.py; the
 * --wording label names the result file, it does not change the question), then from the DSH root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-modes-eval.ts --wording class
 * Writes eval/results/verificator-moduri-<wording>.json; with both files present, also eval/results/verificator-moduri.md.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { Engine, verifyTexts, type Candidate, type Decision, type SaiSettings, type VocabularyEntry } from '../src/core/index.ts'
import { httpVerifier } from '../src/verifier-client.ts'
import { ENGLISH_CASES } from '../tests/fixtures/english-vocabulary.ts'

const { values } = parseArgs({ options: { wording: { type: 'string', default: 'class' }, only: { type: 'string' } } })
const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const URL = 'http://127.0.0.1:8765/verify'
const verifier = httpVerifier({ url: URL, timeoutMs: 3_600_000 })
type Mode = 'off' | 'lowercase' | 'all'
const MODES: Mode[] = ['off', 'lowercase', 'all']
const settingsFor = (mode: Mode): Partial<SaiSettings> => mode === 'off' ? {}
  : { verifier: { enabled: true, mode, url: URL, threshold: 0.2, timeoutMs: 3_600_000, descriptions: {} } }

interface Timing { calls: number; questions: number; byKind: Record<string, number>; ms: number[]; failed: number }
const newTiming = (): Timing => ({ calls: 0, questions: 0, byKind: {}, ms: [], failed: 0 })
const median = (xs: number[]): number => xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
const p95 = (xs: number[]): number => xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)]!
const summary = (t: Timing) => ({ calls: t.calls, questions: t.questions, byKind: t.byKind, medianMs: Math.round(median(t.ms)), p95Ms: Math.round(p95(t.ms)), failed: t.failed })

/** Redact one message in a mode: one verifier call for its questions (none when it has none), then redaction. */
async function redact(engine: Engine, text: string, timing: Timing, session = engine.session()) {
  if (engine.settings.verifier.enabled) {
    for (const question of session.questions(text)) timing.byKind[question.kind] = (timing.byKind[question.kind] ?? 0) + 1
    const started = performance.now()
    const report = await verifyTexts(session, [text], verifier)
    if (report.calls > 0) { timing.calls++; timing.questions += report.asked; timing.ms.push(performance.now() - started) }
    if (report.failed) timing.failed++
  }
  return session.redact(text)
}
const covering = (decisions: readonly Decision[], start: number, end: number): Decision | undefined =>
  decisions.find(({ span, action }) => action !== 'ignore' && span.start < end && start < span.end)

// 1. The verifier set.
async function verifierSet() {
  interface Item { id: string; source: string; sentence: string; start: number; word: string; kind: string; term: string; label: boolean }
  const items = readFileSync(join(BENCH, 'data', 'verifier-set-en.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l) as Item)
  const corr = JSON.parse(readFileSync(join(BENCH, 'data', 'verifier-set-en.corrections.json'), 'utf8')) as { flip: Record<string, string>; drop: Record<string, string> }
  const rows = items.filter(i => !(i.id in corr.drop)).map(i => ({ ...i, label: i.id in corr.flip ? !i.label : i.label }))
  const out: Record<string, unknown> = {}
  for (const mode of MODES) {
    const timing = newTiming()
    let leaked = 0, overMasked = 0, leakedCapital = 0, overCapital = 0
    for (const item of rows) {
      const vocabulary: VocabularyEntry[] = [{ id: 'x', class: item.kind === 'person' ? 'PERSON' : 'COMPANY', terms: [item.term] }]
      const engine = new Engine({ vocabulary, languages: ['en'], ...settingsFor(mode) })
      const masked = covering((await redact(engine, item.sentence, timing)).decisions, item.start, item.start + item.word.length) !== undefined
      const capital = /^\p{Lu}/u.test(item.word)
      if (item.label && !masked) { leaked++; if (capital) leakedCapital++ }
      if (!item.label && masked) { overMasked++; if (capital) overCapital++ }
    }
    out[mode] = { names: rows.filter(r => r.label).length, ordinary: rows.filter(r => !r.label).length, leaked, leakedCapital, overMasked, overCapital, ...summary(timing) }
    console.log('verifier set', mode, JSON.stringify(out[mode]))
  }
  return out
}

// 2. The extended set.
async function extraSet() {
  interface Check { word: string; nth?: number; masked: boolean; key?: string }
  interface Group { id: string; title: string; languages: string[]; vocabulary: VocabularyEntry[]; cases: { id: string; text: string; checks: Check[] }[] }
  const data = JSON.parse(readFileSync(join(SAI, 'eval', 'verifier-cases-extra.json'), 'utf8')) as { groups: Group[] }
  const out: Record<string, unknown> = {}
  for (const mode of MODES) {
    const timing = newTiming()
    const groups: Record<string, { title: string; checks: number; correct: number; failures: string[] }> = {}
    for (const group of data.groups) {
      const g = groups[group.id] = { title: group.title, checks: 0, correct: 0, failures: [] as string[] }
      for (const item of group.cases) {
        const engine = new Engine({ vocabulary: group.vocabulary, languages: group.languages, ...settingsFor(mode) })
        const result = await redact(engine, item.text, timing)
        for (const check of item.checks) {
          const at = nth(item.text, check.word, check.nth ?? 1)
          const decision = covering(result.decisions, at, at + check.word.length)
          let ok = (decision !== undefined) === check.masked
          let detail = decision === undefined ? 'nemascat' : 'mascat'
          if (ok && check.key !== undefined && decision !== undefined) {
            const key = keyOf(decision.span)
            ok = key === check.key
            detail = `mascat, cheia ${key}`
          }
          g.checks++
          if (ok) g.correct++
          else g.failures.push(`${item.id} „${check.word}” în „${item.text}”: așteptat ${check.masked ? 'mascat' : 'nemascat'}${check.key ? ` (${check.key})` : ''}, obținut ${detail}; trimis: „${result.text}”`)
        }
      }
    }
    out[mode] = { groups, ...summary(timing) }
    console.log('extra set', mode, Object.entries(groups).map(([id, g]) => `${id} ${g.correct}/${g.checks}`).join(' · '))
  }
  return out
}
function nth(text: string, word: string, n: number): number {
  let at = -1
  for (let k = 0; k < n; k++) {
    do { at = text.indexOf(word, at + 1) } while (at >= 0 && (/[\p{L}\p{N}]/u.test(text[at - 1] ?? '') || /[\p{L}\p{N}]/u.test(text[at + word.length] ?? '')))
    if (at < 0) throw new Error(`"${word}" #${n} not in "${text}"`)
  }
  return at
}
const keyOf = (span: Candidate): string => span.key.kind === 'entry' ? `entry:${span.key.entryId}` : span.key.kind

// 3. Wikipedia.
async function wikipedia() {
  const vocabulary: VocabularyEntry[] = ENGLISH_CASES.map(c => ({ id: c.id, class: c.cls, terms: [c.term] }))
  const folder = join(SAI, 'eval', 'corpus', 'en-wiki')
  const files = readdirSync(folder).filter(n => n.endsWith('.txt')).sort()
  const out: Record<string, unknown> = {}
  for (const mode of MODES) {
    const timing = newTiming()
    let masked = 0, lowercase = 0, capital = 0, cleared = 0
    for (const file of files) {
      const text = readFileSync(join(folder, file), 'utf8')
      const decisions = (await redact(new Engine({ vocabulary, languages: ['en'], ...settingsFor(mode) }), text, timing)).decisions
      for (const { span, action } of decisions) {
        if (action === 'ignore') { cleared++; continue }
        masked++
        if (/^\p{Lu}/u.test(text.slice(span.start, span.start + 2))) capital++
        else lowercase++
      }
    }
    out[mode] = { articles: files.length, masked, capital, lowercase, cleared, ...summary(timing) }
    console.log('wikipedia', mode, JSON.stringify(out[mode]))
  }
  return out
}

// 4. Conversations.
async function conversations() {
  const data = JSON.parse(readFileSync(join(SAI, 'eval', 'cases-en.json'), 'utf8')) as { vocabulary: VocabularyEntry[]; cases: { id: string; turns: string[] }[] }
  const texts: Record<string, string[]> = {}
  const out: Record<string, unknown> = {}
  for (const mode of MODES) {
    const timing = newTiming()
    texts[mode] = []
    for (const item of data.cases) {
      const engine = new Engine({ vocabulary: data.vocabulary, languages: ['en'], ...settingsFor(mode) })
      const session = engine.session()
      for (const turn of item.turns) texts[mode]!.push(`${item.id}: ${(await redact(engine, turn, timing, session)).text}`)
    }
    const changed = texts[mode]!.filter((t, i) => t !== texts.off![i])
    out[mode] = { turns: texts[mode]!.length, changed: changed.length, changedTexts: changed, ...summary(timing) }
    console.log('conversations', mode, changed.length, 'changed')
  }
  return out
}

const sets = { verifierSet, extraSet, wikipedia, conversations }
const result: Record<string, unknown> = { wording: values.wording, date: new Date().toISOString().slice(0, 10) }
for (const [name, run] of Object.entries(sets)) if (!values.only || values.only.split(',').includes(name)) result[name] = await run()
const file = join(SAI, 'eval', 'results', `verificator-moduri-${values.wording}.json`)
writeFileSync(file, JSON.stringify(result, null, 1))
console.log('written', file, existsSync(file))

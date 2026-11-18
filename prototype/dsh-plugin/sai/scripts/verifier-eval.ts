/**
 * sAI as it is (verifier off) against sAI with the verifier (Decider-Flash v1.3, local service), on the same data:
 *   1. the 824-case verifier set (sentences with a word that is a name or an ordinary word; reviewed labels);
 *   2. 29 English Wikipedia articles with the English fixture vocabulary (texts that never mention those people);
 *   3. the English evaluation conversations (eval/cases-en.json), turn by turn.
 * Each message gets its own verifier call, as in the plugin. Writes eval/results/verificator-en.md with totals only for
 * the Nemotron and Wikipedia texts (they stay out of the repository) and the changed turns of the fictitious cases.
 * Start the service first (verifier/decider_server.py), then run from the DSH root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-eval.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, verifyTexts, type Decision, type SaiSettings, type VocabularyEntry } from '../src/core/index.ts'
import { httpVerifier } from '../src/verifier-client.ts'
import { ENGLISH_CASES } from '../tests/fixtures/english-vocabulary.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const URL = process.env.SAI_VERIFIER_URL ?? 'http://127.0.0.1:8765/verify'
const verifier = httpVerifier({ url: URL, timeoutMs: 3_600_000 })
const ON: Partial<SaiSettings> = { verifier: { enabled: true, url: URL, threshold: 0.2, timeoutMs: 3_600_000 } }

const median = (values: number[]): number => values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
const p95 = (values: number[]): number => values.length === 0 ? 0 : [...values].sort((a, b) => a - b)[Math.floor(values.length * 0.95)]!
const covered = (decisions: readonly Decision[], start: number, end: number): boolean =>
  decisions.some(({ span, action }) => action !== 'ignore' && span.start < end && start < span.end)

interface Timing { calls: number; questions: number; ms: number[]; failed: number }
const newTiming = (): Timing => ({ calls: 0, questions: 0, ms: [], failed: 0 })

/** Redact one message with the verifier: one call for its questions (none when it has none), then redaction. */
async function redactVerified(session: ReturnType<Engine['session']>, text: string, timing: Timing): Promise<ReturnType<typeof session.redact>> {
  const started = performance.now()
  const report = await verifyTexts(session, [text], verifier)
  if (report.calls > 0) { timing.calls++; timing.questions += report.asked; timing.ms.push(performance.now() - started) }
  if (report.failed) timing.failed++
  return session.redact(text)
}

// 1. The verifier set.
interface Item { id: string; source: string; sentence: string; start: number; word: string; kind: string; term: string; label: boolean; variant: string }
async function verifierSet(): Promise<string[]> {
  const items = readFileSync(join(BENCH, 'data', 'verifier-set-en.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Item)
  const corrections = JSON.parse(readFileSync(join(BENCH, 'data', 'verifier-set-en.corrections.json'), 'utf8')) as { flip: Record<string, string>; drop: Record<string, string> }
  const rows = items.filter(item => !(item.id in corrections.drop)).map(item => ({ ...item, label: item.id in corrections.flip ? !item.label : item.label }))
  const timing = newTiming()
  type Tally = { names: number; ordinary: number; leaked: [number, number]; overMasked: [number, number] }
  const bySource = new Map<string, Tally>()
  const total: Tally = { names: 0, ordinary: 0, leaked: [0, 0], overMasked: [0, 0] }
  const changed: string[] = []
  for (const item of rows) {
    const vocabulary: VocabularyEntry[] = [{ id: 'x', class: item.kind === 'person' ? 'PERSON' : 'COMPANY', terms: [item.term] }]
    const end = item.start + item.word.length
    const before = covered(new Engine({ vocabulary, languages: ['en'] }).session().redact(item.sentence).decisions, item.start, end)
    const after = covered((await redactVerified(new Engine({ vocabulary, languages: ['en'], ...ON }).session(), item.sentence, timing)).decisions, item.start, end)
    for (const tally of [total, bySource.get(item.source) ?? (bySource.set(item.source, { names: 0, ordinary: 0, leaked: [0, 0], overMasked: [0, 0] }), bySource.get(item.source)!)]) {
      if (item.label) { tally.names++; if (!before) tally.leaked[0]++; if (!after) tally.leaked[1]++ }
      else { tally.ordinary++; if (before) tally.overMasked[0]++; if (after) tally.overMasked[1]++ }
    }
    if (before !== after) changed.push(`${item.label ? 'nume' : 'obișnuit'} ${before ? 'mascat' : 'nemascat'} → ${after ? 'mascat' : 'nemascat'}`)
  }
  const kinds = new Map<string, number>()
  for (const line of changed) kinds.set(line, (kinds.get(line) ?? 0) + 1)
  const row = (name: string, t: Tally): string =>
    `| ${name} | ${t.names} | ${t.ordinary} | ${t.leaked[0]} | **${t.leaked[1]}** | ${t.overMasked[0]} | **${t.overMasked[1]}** |`
  console.log('verifier set', JSON.stringify(total), JSON.stringify(timing.calls), timing.questions)
  return [
    '## 1. Setul verificatorului (824 de cazuri, etichete revizuite)', '',
    `Fiecare propoziție e un mesaj separat, cu vocabularul format doar din numele din cazul respectiv. Se verifică dacă cuvântul din caz e mascat. Cazuri: ${total.names + total.ordinary} (${total.names} nume, ${total.ordinary} cuvinte obișnuite).`, '',
    '| Sursă | Nume | Cuvinte obișnuite | Nume scăpate: azi | Nume scăpate: cu verificator | Cuvinte obișnuite mascate: azi | Cuvinte obișnuite mascate: cu verificator |',
    '|---|---|---|---|---|---|---|',
    row('**Total**', total), ...[...bySource].sort().map(([source, tally]) => row(source, tally)), '',
    `Apeluri către model: ${timing.calls} din ${rows.length} mesaje (celelalte nu aveau niciun cuvânt neconfirmat), ${timing.questions} întrebări; ` +
      `durata unui apel: mediană ${median(timing.ms).toFixed(0)} ms, p95 ${p95(timing.ms).toFixed(0)} ms; apeluri eșuate: ${timing.failed}.`, '',
    'Ce s-a schimbat față de azi:', '', ...[...kinds].map(([kind, count]) => `- ${kind}: ${count}`), '',
  ]
}

// 2. Wikipedia.
async function wikipedia(): Promise<string[]> {
  const vocabulary: VocabularyEntry[] = ENGLISH_CASES.map(c => ({ id: c.id, class: c.cls, terms: [c.term] }))
  const folder = join(SAI, 'eval', 'corpus', 'en-wiki')
  const files = readdirSync(folder).filter(name => name.endsWith('.txt')).sort()
  const timing = newTiming()
  let words = 0
  let before = 0
  let after = 0
  let cleared = 0
  const added = new Map<string, number>()
  for (const file of files) {
    const text = readFileSync(join(folder, file), 'utf8')
    words += text.split(/\s+/).length
    const masked = (decisions: readonly Decision[]): Decision[] => decisions.filter(({ action }) => action !== 'ignore')
    const today = masked(new Engine({ vocabulary, languages: ['en'] }).session().redact(text).decisions)
    const all = (await redactVerified(new Engine({ vocabulary, languages: ['en'], ...ON }).session(), text, timing)).decisions
    const verified = masked(all)
    cleared += all.length - verified.length
    before += today.length
    after += verified.length
    const old = new Set(today.map(({ span }) => `${span.start}:${span.end}`))
    for (const { span } of verified) {
      if (old.has(`${span.start}:${span.end}`)) continue
      const word = text.slice(span.start, span.end)
      added.set(word, (added.get(word) ?? 0) + 1)
    }
  }
  console.log('wikipedia', before, after, timing.questions)
  const extra = [...added].sort((a, b) => b[1] - a[1])
  return [
    '## 2. Wikipedia în engleză (texte care nu vorbesc despre persoanele din vocabular)', '',
    `${files.length} articole, ${words} de cuvinte; vocabularul: cele ${vocabulary.length} intrări englezești din teste, declarate cu numele complet. Fiecare articol e un mesaj.`, '',
    '| | Azi | Cu verificator |', '|---|---|---|',
    `| Cuvinte mascate (azi toate cu majusculă: „John”, „King”…) | ${before} | ${after} |`,
    `| Cuvinte scrise cu literă mică mascate în plus față de azi | — | **${[...added.values()].reduce((a, b) => a + b, 0)}** |`,
    `| Cuvinte trimise ca atare pentru că modelul le-a numit obișnuite | — | ${cleared} |`, '',
    `Întrebări puse modelului: ${timing.questions}, în ${timing.calls} apeluri (câte unul pe articol care avea întrebări); ` +
      `durata unui apel: mediană ${median(timing.ms).toFixed(0)} ms, p95 ${p95(timing.ms).toFixed(0)} ms; apeluri eșuate: ${timing.failed}.`, '',
    ...extra.length === 0 ? ['Verificatorul nu a mascat niciun cuvânt scris cu literă mică.'] : [
      'Cuvintele scrise cu literă mică pe care verificatorul le-a mascat (fără context, textele Wikipedia nu intră în repo):', '',
      ...extra.map(([word, count]) => `- \`${word}\`: ${count}`)],
    '',
  ]
}

// 3. The evaluation conversations.
async function conversations(): Promise<string[]> {
  const data = JSON.parse(readFileSync(join(SAI, 'eval', 'cases-en.json'), 'utf8')) as { vocabulary: VocabularyEntry[]; cases: { id: string; turns: string[] }[] }
  const timing = newTiming()
  const changed: string[] = []
  let turns = 0
  for (const item of data.cases) {
    const today = new Engine({ vocabulary: data.vocabulary, languages: ['en'] }).session()
    const verified = new Engine({ vocabulary: data.vocabulary, languages: ['en'], ...ON }).session()
    for (const turn of item.turns) {
      turns++
      const a = today.redact(turn).text
      const b = (await redactVerified(verified, turn, timing)).text
      if (a !== b) changed.push(`- **${item.id}**\n  - azi: ${a}\n  - cu verificator: ${b}`)
    }
  }
  console.log('conversations', turns, changed.length, timing.questions)
  return [
    '## 3. Conversațiile de evaluare (eval/cases-en.json, date fictive)', '',
    `${data.cases.length} cazuri, ${turns} mesaje. Apeluri către model: ${timing.calls}, ${timing.questions} întrebări; apeluri eșuate: ${timing.failed}. ` +
      `Mesaje al căror text trimis s-a schimbat: ${changed.length}.`, '',
    ...changed, '',
  ]
}

const sections = [...await verifierSet(), ...await wikipedia(), ...await conversations()]
writeFileSync(join(SAI, 'eval', 'results', 'verificator-en.md'), [
  '# sAI azi și sAI cu verificatorul (Decider-Flash v1.3), în engleză', '',
  'Aceleași date trec prin motorul sAI real de două ori: o dată ca azi (verificator oprit), o dată cu verificatorul pornit ' +
    '(Decider-Flash v1.3, 4-bit, pe placa video, prag 0,2: cuvântul e mascat dacă modelul îi dă cel puțin 20% să fie nume). ' +
    'Fiecare mesaj face cel mult un apel către model, cu toate întrebările lui.', '',
  ...sections,
].join('\n'))
console.log('written eval/results/verificator-en.md')

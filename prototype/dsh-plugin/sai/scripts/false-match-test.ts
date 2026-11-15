/**
 * False-match test: runs the vocabulary detector (declared spellings + generated forms)
 * over Wikipedia text that does not mention the vocabulary, and lists every match with
 * its context for manual verification.
 *   --set ro  Romanian: half "B" of eval/corpus/ro-wiki, the Romanian fixture + eval vocabulary
 *             → eval/results/false-matches.md
 *   --set en  English: all of eval/corpus/en-wiki, the English fixture declared by full name
 *             → eval/results/false-matches-en.md
 *   --languages ro,en  enabled language packs (default: both)
 * Run from the repository root: node --import tsx/esm packages/experimental/sai/scripts/false-match-test.ts [--set en]
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { compileDictionary } from '../src/core/detectors/dictionary.ts'
import { normalize, resolveSettings, type VocabularyEntry } from '../src/core/index.ts'
import { ENGLISH_CASES } from '../tests/fixtures/english-vocabulary.ts'
import { CASES } from '../tests/fixtures/inflection-vocabulary.ts'

const { values } = parseArgs({ options: { set: { type: 'string', default: 'ro' }, languages: { type: 'string', default: 'ro,en' } } })
const english = values.set === 'en'
const languages = values.languages.split(',')
const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const CORPUS = join(SAI, 'eval', 'corpus', english ? 'en-wiki' : 'ro-wiki')
const OUT = join(SAI, 'eval', 'results', english ? `false-matches-en${languages.includes('ro') ? '' : '-only'}.md` : 'false-matches.md')
const evalVocabulary = (JSON.parse(readFileSync(join(SAI, 'eval', 'cases.json'), 'utf8')) as { vocabulary: VocabularyEntry[] }).vocabulary
const vocabulary = resolveSettings({ vocabulary: english
  ? ENGLISH_CASES.map(c => ({ id: c.id, class: c.cls, terms: [c.term] }))
  : [...CASES.map(c => ({ id: c.id, class: c.cls, terms: c.terms })), ...evalVocabulary.map(entry => ({ ...entry, id: `eval_${entry.id}` }))],
}).settings.vocabulary
const detector = compileDictionary(vocabulary, languages)
const termsByEntry = new Map(vocabulary.map(entry => [entry.id!, entry.terms.join(' · ')]))

const files = readdirSync(CORPUS).filter(name => name.endsWith('.txt')).sort().filter((_, index) => english || index % 2 === 1)
let words = 0
const rows: { file: string; text: string; entry: string; kind: string; context: string }[] = []
for (const file of files) {
  const original = readFileSync(join(CORPUS, file), 'utf8')
  words += original.split(/\s+/).length
  for (const match of detector.detect(normalize(original))) {
    const key = match.key.kind === 'entry' ? match.key.entryId : '?'
    rows.push({
      file, text: original.slice(match.start, match.end), entry: key,
      kind: match.baseForm === undefined ? 'declarat' : `generat din „${match.baseForm}”`,
      context: original.slice(Math.max(0, match.start - 50), match.end + 50).replace(/\s+/g, ' '),
    })
  }
}
const generated = rows.filter(row => row.kind !== 'declarat')
const groups = new Map<string, { text: string; entry: string; kind: string; count: number }>()
for (const row of rows) {
  const id = `${normalize(row.text).norm}|${row.entry}|${row.kind}`
  const group = groups.get(id) ?? { text: row.text, entry: row.entry, kind: row.kind, count: 0 }
  group.count++
  groups.set(id, group)
}
const summary = [...groups.values()].sort((a, b) => Number(a.kind === 'declarat') - Number(b.kind === 'declarat') || b.count - a.count)
const lines = [
  `# Test de potriviri false (${english ? 'Wikipedia în engleză' : 'jumătatea B a corpusului românesc'}; limbi: ${languages.join(', ')})`, '',
  `Fișiere: ${files.length} · cuvinte: ${words} · spellings căutate: ${detector.size} · potriviri: ${rows.length} (declarate: ${rows.length - generated.length}, generate: ${generated.length})`, '',
  '## Rezumat pe text găsit', '', '| Text | Intrare | Tip | Apariții |', '|---|---|---|---|',
  ...summary.map(group => `| ${group.text} | ${group.entry} (${termsByEntry.get(group.entry) ?? ''}) | ${group.kind} | ${group.count} |`),
  '', '## Toate potrivirile', '',
  '| # | Fișier | Text găsit | Intrare | Tip | Context |', '|---|---|---|---|---|---|',
  ...rows.map((row, index) => `| ${index + 1} | ${row.file.replace('.txt', '')} | **${row.text}** | ${row.entry} (${termsByEntry.get(row.entry) ?? ''}) | ${row.kind} | …${row.context.replace(/\|/g, '/')}… |`),
]
writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(`files ${files.length}, words ${words}, spellings ${detector.size}, matches ${rows.length} (declared ${rows.length - generated.length}, generated ${generated.length})`)
for (const row of rows) console.log(`${row.kind === 'declarat' ? 'D' : 'G'} ${row.text} → ${row.entry} | …${row.context}…`)

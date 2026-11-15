/**
 * Coverage of the English forms (plurals, possessive) on capitalized words in English Wikipedia.
 * Plural pairs are found with an independent reference that includes irregular spellings
 * (y → ies, f/fe → ves, man → men); each possessive ("India's") is checked by redacting its
 * sentence with the base declared.
 *   → eval/results/inflection-coverage-wiki-en.md
 * Run from the repository root: node --import tsx/esm packages/experimental/sai/scripts/wiki-inflection-coverage-en.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Engine, englishWordForms } from '../src/core/index.ts'
import { isSentenceStart, normalizeTerm } from '../src/core/normalize.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const DIR = join(SAI, 'eval', 'corpus', 'en-wiki')
const OUT = join(SAI, 'eval', 'results', 'inflection-coverage-wiki-en.md')

const counts = new Map<string, number>()
const spelling = new Map<string, string>()
const possessives: { base: string; sentence: string }[] = []
let words = 0
for (const file of readdirSync(DIR).filter(name => name.endsWith('.txt'))) {
  const text = readFileSync(join(DIR, file), 'utf8')
  for (const match of text.matchAll(/\p{L}+/gu)) {
    words++
    const word = match[0]
    if (!/^\p{Lu}\p{Ll}/u.test(word) || word.length < 3) continue
    if (match.index > 0 && /[\p{L}\p{N}\-']/u.test(text[match.index - 1]!)) continue
    if (isSentenceStart(text, match.index)) continue
    const norm = normalizeTerm(word)
    counts.set(norm, (counts.get(norm) ?? 0) + 1)
    if (!spelling.has(norm)) spelling.set(norm, word)
    if (/^['’]s?\b/u.test(text.slice(match.index + word.length, match.index + word.length + 2))) {
      possessives.push({ base: word, sentence: text.slice(Math.max(0, match.index - 30), match.index + word.length + 20) })
    }
  }
}
const types = new Set(counts.keys())
const plurals = (base: string): [string, string][] => [
  [`${base}s`, '+s'], [`${base}es`, '+es (de verificat: multe sunt alte nume)'],
  ...(/[^aeiou]y$/.test(base) ? [[`${base.slice(0, -1)}ies`, 'y → ies']] as [string, string][] : []),
  ...(base.endsWith('f') ? [[`${base.slice(0, -1)}ves`, 'f → ves']] as [string, string][] : []),
  ...(base.endsWith('fe') ? [[`${base.slice(0, -2)}ves`, 'fe → ves']] as [string, string][] : []),
  ...(base.endsWith('man') ? [[`${base.slice(0, -3)}men`, 'man → men']] as [string, string][] : []),
]
const rows = new Map<string, { occurrences: number; covered: number; misses: string[] }>()
for (const base of types) {
  for (const [form, rule] of plurals(base)) {
    if (!types.has(form)) continue
    const row = rows.get(rule) ?? { occurrences: 0, covered: 0, misses: [] }
    row.occurrences += counts.get(form)!
    if (englishWordForms(base).includes(form)) row.covered += counts.get(form)!
    else row.misses.push(`${spelling.get(base)} → ${spelling.get(form)}`)
    rows.set(rule, row)
  }
}
const engineFor = (base: string): Engine => new Engine({ vocabulary: [{ id: 'x', class: 'ORGANIZATION', terms: [base] }], patterns: [], languages: ['en'] })
const caught = possessives.filter(({ base, sentence }) => !new RegExp(`\\b${base}\\b`, 'u').test(engineFor(base).session().redact(sentence).text)).length

const pct = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
const lines = [
  '# Acoperirea formelor englezești pe Wikipedia', '',
  `Cuvinte: ${words} · cuvinte distincte cu majusculă în mijlocul propoziției: ${types.size}`, '',
  '| Formă | Apariții | Acoperite | Negenerate |', '|---|---:|---:|---|',
  ...[...rows].map(([rule, row]) => `| ${rule} | ${row.occurrences} | ${row.covered} (${pct(row.covered, row.occurrences)}) | ${row.misses.join(', ')} |`),
  `| posesiv ('s) | ${possessives.length} | ${caught} (${pct(caught, possessives.length)}) | |`,
]
writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(lines.slice(4).join('\n'))

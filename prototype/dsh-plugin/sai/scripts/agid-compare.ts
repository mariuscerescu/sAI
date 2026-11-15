/**
 * Compares the English plural generator with the noun plurals of AGID, the Automatically
 * Generated Inflection Database by Kevin Atkinson (SCOWL; permissive license), an independent
 * source. Only plurals of level 0 without doubt markers are used; each is classed by an
 * English grammar rule, so the report shows which kinds of plural are covered.
 *
 * The AGID data stays out of the repository: download it first, once.
 *   https://downloads.sourceforge.net/wordlist/agid-2016.01.19.zip (about 0.9 MB); extract only
 *   infl.txt into a folder. Do not run the scripts shipped in the archive.
 * Only the totals are written to eval/results/agid-compare.md.
 * Run from the repository root:
 *   node --import tsx/esm packages/experimental/sai/scripts/agid-compare.ts --data <folder with infl.txt>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { englishWordForms } from '../src/core/languages.ts'

const OUT = 'D:\\Disk D 13-09-25\\EC\\sAI\\eval\\results\\agid-compare.md'
const { values } = parseArgs({ options: { data: { type: 'string' } } })
if (values.data === undefined) throw new Error('--data <folder with infl.txt> is required')

/** Kind of an English plural, from standard grammar (independent of the generator). */
function kindOf(base: string, plural: string): string {
  if (plural === `${base}s`) return '+s'
  if (plural === `${base}es`) {
    if (/(?:s|x|z|ch|sh)$/.test(base)) return '+es după s, x, z, ch, sh'
    return /o$/.test(base) ? '+es după o (heroes)' : '+es, alte cazuri'
  }
  if (/[^aeiou]y$/.test(base) && plural === `${base.slice(0, -1)}ies`) return 'consoană + y → ies'
  if (/fe?$/.test(base) && /ves$/.test(plural)) return 'f/fe → ves'
  if (/man$/.test(base) && plural === `${base.slice(0, -3)}men`) return 'man → men'
  if (/us$/.test(base) && plural === `${base.slice(0, -2)}i`) return 'us → i (latină, lăsat deoparte)'
  if (/is$/.test(base) && plural === `${base.slice(0, -2)}es`) return 'is → es (greacă, lăsat deoparte)'
  if (/(?:um|on)$/.test(base) && plural === `${base.slice(0, -2)}a`) return 'um/on → a (lăsat deoparte)'
  if (plural === base) return 'neschimbat (sheep)'
  return 'alte neregulate (children)'
}

const rows = new Map<string, { total: number; covered: number; examples: string[] }>()
let nouns = 0
for (const line of readFileSync(join(values.data, 'infl.txt'), 'utf8').split(/\r?\n/)) {
  const match = /^([a-zA-Z]+) N\??: (.*)$/.exec(line)
  if (!match || match[1]!.length < 3) continue
  const base = match[1]!
  const plurals = match[2]!.split(' | ')[0]!.split(', ').map(entry => entry.trim()).filter(entry => /^[a-zA-Z]+$/.test(entry))
  if (plurals.length === 0) continue
  nouns++
  const generated = new Set(englishWordForms(base.toLowerCase()))
  const scope = /^[A-Z]/.test(base) ? 'Nume proprii' : 'Substantive comune'
  for (const plural of plurals) {
    const covered = generated.has(plural.toLowerCase())
    for (const key of ['Toate pluralele', `${scope}, total`, `${scope}: ${kindOf(base.toLowerCase(), plural.toLowerCase())}`]) {
      const row = rows.get(key) ?? { total: 0, covered: 0, examples: [] }
      row.total++
      if (covered) row.covered++
      else if (row.examples.length < 6) row.examples.push(`${base} → ${plural}`)
      rows.set(key, row)
    }
  }
}
const pct = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
const lines = [
  '# Pluralele englezești comparate cu AGID', '',
  `Substantive cu plural sigur (nivel 0, fără marcaje de îndoială): ${nouns}`, '',
  '| Categorie | Plurale | Generate |', '|---|---:|---:|',
  ...[...rows].sort((a, b) => b[1].total - a[1].total).map(([key, row]) => `| ${key} | ${row.total} | ${row.covered} (${pct(row.covered, row.total)}) |`),
]
writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(lines.slice(2).join('\n'))
console.log('\nExemple negenerate (doar local):')
for (const [key, row] of rows) if (row.examples.length > 0) console.log(`  ${key}: ${row.examples.join(', ')}`)

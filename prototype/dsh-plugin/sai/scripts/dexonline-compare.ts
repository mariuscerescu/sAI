/**
 * Compares the Romanian form generator with the inflected forms of dexonline, an independent
 * source: every one-word noun and adjective of the dictionary, each paradigm cell (case, number,
 * article; no vocative) checked against the forms generated from the word as a name would
 * declare it (a noun bare or with the article, an adjective in its own gender).
 *
 * The dexonline data is GPL and stays out of the repository: download it first, once.
 *   1. https://dexonline.ro/update5.php?last=0 lists the current files.
 *   2. Download its <Lexems> and <Inflections> files (about 13 MB together, gzipped XML) into one
 *      folder as lexems.xml.gz and inflections.xml.gz.
 * Only the totals are written to eval/results/dexonline-compare.md; examples of missing forms are
 * printed to the console for local review.
 * Run from the repository root:
 *   node --import tsx/esm packages/experimental/sai/scripts/dexonline-compare.ts --data <folder>
 */
import { createReadStream, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { createGunzip, gunzipSync } from 'node:zlib'
import { wordForms } from '../src/core/inflection.ts'
import { normalizeTerm } from '../src/core/normalize.ts'

const OUT = 'D:\\Disk D 13-09-25\\EC\\sAI\\eval\\results\\dexonline-compare.md'
const { values } = parseArgs({ options: { data: { type: 'string' } } })
if (values.data === undefined) throw new Error('--data <folder with lexems.xml.gz and inflections.xml.gz> is required')
const dir = values.data

const decode = (text: string): string => text.replace(/&#039;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
/** The search spelling of a dexonline form: no stress marks, lowercase, no diacritics. */
const clean = (form: string): string => normalizeTerm(decode(form).replace(/'/g, ''))

interface Lexeme { form: string; capital: boolean; forms: { inflection: number; form: string }[] }
interface Row { total: number; covered: number; examples: string[] }

async function main(): Promise<void> {
  const inflections = new Map<number, string>()
  const xml = gunzipSync(readFileSync(join(dir, 'inflections.xml.gz'))).toString('utf8')
  for (const match of xml.matchAll(/<Inflection id="(\d+)">\s*<Description>([^<]*)<\/Description>/g)) inflections.set(Number(match[1]), match[2]!)

  const lexemes: Lexeme[] = []
  let current: Lexeme | undefined
  let pending: number | undefined
  for await (const line of createInterface({ input: createReadStream(join(dir, 'lexems.xml.gz')).pipe(createGunzip()) })) {
    if (line.includes('<Lexem ')) { current = { form: '', capital: false, forms: [] }; continue }
    if (current === undefined) continue
    const inflection = /<InflectionId>(\d+)<\/InflectionId>/.exec(line)
    if (inflection) { pending = Number(inflection[1]); continue }
    const form = /<Form>([^<]*)<\/Form>/.exec(line)
    if (form) {
      if (pending === undefined) { current.form = decode(form[1]!).replace(/'/g, ''); current.capital = /^\p{Lu}/u.test(current.form) }
      else { current.forms.push({ inflection: pending, form: form[1]! }); pending = undefined }
      continue
    }
    if (line.includes('</Lexem>')) { lexemes.push(current); current = undefined }
  }

  const kind = (id: number): { pos: string; cell: string } | undefined => {
    const [pos, ...rest] = (inflections.get(id) ?? '').split(', ')
    return /^(Substantiv|Adjectiv)/.test(pos ?? '') ? { pos: pos!, cell: rest.join(', ') } : undefined
  }
  const rows = new Map<string, Row>()
  const note = (key: string, covered: boolean, example: string): void => {
    const row = rows.get(key) ?? { total: 0, covered: 0, examples: [] }
    row.total++
    if (covered) row.covered++
    else if (row.examples.length < 8) row.examples.push(example)
    rows.set(key, row)
  }
  let considered = 0
  let complete = 0
  for (const lexeme of lexemes) {
    const relevant = lexeme.forms.map(entry => ({ ...entry, kind: kind(entry.inflection) }))
      .filter(entry => entry.kind !== undefined && !entry.kind.cell.includes('Vocativ'))
    if (relevant.length === 0 || lexeme.form.length < 3 || /\s|-/.test(lexeme.form)) continue
    considered++
    const lemma = clean(lexeme.form)
    const formOf = (pattern: RegExp): string | undefined => {
      const found = relevant.find(entry => pattern.test(`${entry.kind!.pos} | ${entry.kind!.cell}`))
      return found === undefined ? undefined : clean(found.form)
    }
    const feminine = formOf(/^Adjectiv \| feminin, Nominativ-Acuzativ, singular, nearticulat/)
    const articled = formOf(/^Substantiv.*Nominativ-Acuzativ, singular, articulat/)
    const basesFor = (pos: string, cell: string): string[] => pos === 'Adjectiv'
      ? [cell.startsWith('feminin') && feminine !== undefined ? feminine : lemma]
      : [lemma, ...articled === undefined ? [] : [articled]]
    const cache = new Map<string, Set<string>>()
    const generated = (base: string): Set<string> => {
      let set = cache.get(base)
      if (set === undefined) { set = new Set(wordForms(base)); cache.set(base, set) }
      return set
    }
    // One paradigm cell counts once, covered when any of its spellings is generated (anul / anu).
    const cells = new Map<number, typeof relevant>()
    for (const entry of relevant) cells.set(entry.inflection, [...(cells.get(entry.inflection) ?? []), entry])
    let all = true
    for (const variants of cells.values()) {
      const { pos, cell } = variants[0]!.kind!
      const covered = variants.some(variant => basesFor(pos, cell).some(base => generated(base).has(clean(variant.form))))
      all &&= covered
      const example = `${lexeme.form} → ${variants.map(variant => decode(variant.form).replace(/'/g, '')).join('/')}`
      const plural = cell.includes('plural') ? 'plural' : 'singular'
      note('Toate formele', covered, example)
      note(`${pos.replace('Substantiv ', 'Substantive ').replace('Adjectiv', 'Adjective')}, ${plural}`, covered, example)
      if (lexeme.capital) note('Nume proprii din dicționar', covered, example)
    }
    if (all) complete++
  }

  const pct = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
  const ordered = [...rows].sort((a, b) => (a[0] === 'Toate formele' ? -1 : b[0] === 'Toate formele' ? 1 : a[0].localeCompare(b[0])))
  const lines = [
    '# Generatorul de forme comparat cu dexonline', '',
    `Leme în export: ${lexemes.length} · substantive și adjective dintr-un cuvânt: ${considered} · leme cu toate formele generate: ${complete} (${pct(complete, considered)})`, '',
    '| Categorie | Forme din dicționar | Generate |', '|---|---:|---:|',
    ...ordered.map(([key, row]) => `| ${key} | ${row.total} | ${row.covered} (${pct(row.covered, row.total)}) |`),
  ]
  writeFileSync(OUT, `${lines.join('\n')}\n`)
  console.log(lines.slice(2).join('\n'))
  console.log('\nExemple de forme negenerate (doar local, nu se salvează):')
  for (const [key, row] of ordered) console.log(`  ${key}: ${row.examples.join(' · ')}`)
}

await main()

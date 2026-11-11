/**
 * Experiment: deterministic generation of Romanian inflected forms for vocabulary terms.
 * Measures recall on forms that leaked in run1 and false matches in ordinary Romanian prose.
 * Run from the repository root: node --import tsx/esm packages/experimental/sai/scripts/inflection-experiment.ts
 */
import { readFileSync } from 'node:fs'
import { normalizeTerm } from '../src/core/index.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const cases = JSON.parse(readFileSync(`${SAI}\\eval\\cases.json`, 'utf8')) as { vocabulary: { class: string; terms: string[] }[] }

/** Inflected forms of one normalized word (diacritics already removed). */
function wordForms(word: string): string[] {
  const forms = new Set([word])
  if (word.length < 3 || /\d/.test(word)) return [...forms]
  const last = word.at(-1)!
  const stem = word.slice(0, -1)
  if ('a'.includes(last)) {
    // Maria → Mariei, Elena → Elenei, Banca → Bancii (băncii), Andreea → Andreei
    for (const suffix of ['ei', 'ii', 'e', 'a']) forms.add(stem + suffix)
    if (word.endsWith('ea')) forms.add(`${word.slice(0, -2)}ei`)
  } else if (last === 'u') {
    // Popescu → Popescului / Popescul, Lungu → Lungului
    for (const suffix of ['lui', 'l']) forms.add(word + suffix)
  } else if (last === 'e' || last === 'i') {
    // Vrabie → Vrabiei, Acme → Acmei / Acmelui
    for (const suffix of ['i', 'lui']) forms.add(word + suffix)
  } else if (word.endsWith('ul')) {
    // Articled noun: Proiectul → Proiectului
    forms.add(`${word}ui`)
  } else {
    // Ceban → Cebanul / Cebanului / Cebanei, Orion → Orionul / Orionului
    for (const suffix of ['ul', 'ului', 'ule', 'ei', 'ii']) forms.add(word + suffix)
  }
  return [...forms]
}

/** Every inflected spelling of a term: each word varies independently. */
function termForms(term: string): string[] {
  const words = normalizeTerm(term).split(' ')
  let combos = ['']
  for (const word of words) combos = combos.flatMap(prefix => wordForms(word).map(form => (prefix ? `${prefix} ${form}` : form)))
  return combos
}

const index = new Map<string, string>()
for (const entry of cases.vocabulary) for (const term of entry.terms) for (const form of termForms(term)) index.set(form, `${entry.class}:${term}`)
console.log(`vocabulary terms: ${cases.vocabulary.flatMap(e => e.terms).length}, generated spellings: ${index.size}`)

const leaked = ['Cebanei', 'Popescului', 'Mariei', 'Băncii Verde', 'Lungului', 'Vrabiei', 'Elenei', 'Orionului', 'Proiectului Orion',
  'Acmei', 'Cebanul', 'Popescul', 'Nordic Agroului', 'TermoGuard X9-ului']
for (const form of leaked) console.log(`${index.has(normalizeTerm(form)) ? 'FOUND ' : 'MISSED'}  ${form}  → ${index.get(normalizeTerm(form)) ?? '-'}`)

// False matches: generated non-base spellings found in Romanian prose that does not mention the vocabulary.
const base = new Set(cases.vocabulary.flatMap(e => e.terms.map(normalizeTerm)))
const prose = [`${SAI}\\docs\\ARHITECTURA.md`, `${SAI}\\eval\\RAPORT-run1.md`, `${SAI}\\eval\\CHECKLIST.md`]
  .map(path => normalizeTerm(readFileSync(path, 'utf8')))
  .join(' ')
const words = prose.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const hits = new Map<string, number>()
for (let i = 0; i < words.length; i++) {
  for (const n of [1, 2, 3]) {
    const span = words.slice(i, i + n).join(' ')
    if (index.has(span) && !base.has(span)) hits.set(span, (hits.get(span) ?? 0) + 1)
  }
}
console.log(`prose words scanned: ${words.length}; non-base generated spellings found: ${hits.size}`)
for (const [span, count] of hits) console.log(`  ${span} ×${count} → ${index.get(span)}`)

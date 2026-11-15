/**
 * Coverage of the Romanian inflection generator on real proper-name inflections in Wikipedia.
 * Pairs (base, form) are extracted independently of the generator: both spelled with a capital
 * mid-sentence, form = stem' + an inflectional ending, where stem is the base minus a nominative
 * ending and stem' is the stem or the stem with a changed last syllable (a broader set of changes
 * than the generator knows, so its gaps show). The base is the more frequent spelling.
 * A missed form that another corpus word generates (a wrongly chosen base) is counted apart.
 *   → eval/results/inflection-coverage-wiki.md
 * Run from the repository root: node --import tsx/esm packages/experimental/sai/scripts/wiki-inflection-coverage.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { wordForms } from '../src/core/inflection.ts'
import { isSentenceStart, normalizeTerm } from '../src/core/normalize.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const ROOT = join(SAI, 'eval', 'corpus')
const OUT = join(SAI, 'eval', 'results', 'inflection-coverage-wiki.md')

const counts = new Map<string, number>()
const spelling = new Map<string, string>()
let words = 0
for (const dir of ['ro-wiki', 'ro-wiki-extra']) {
  for (const file of readdirSync(join(ROOT, dir)).filter(name => name.endsWith('.txt'))) {
    const text = readFileSync(join(ROOT, dir, file), 'utf8')
    for (const match of text.matchAll(/\p{L}+/gu)) {
      words++
      const word = match[0]
      if (!/^\p{Lu}\p{Ll}/u.test(word) || word.length < 3) continue
      if (match.index > 0 && /[\p{L}\p{N}\-']/u.test(text[match.index - 1]!)) continue
      if (isSentenceStart(text, match.index)) continue
      const norm = normalizeTerm(word)
      counts.set(norm, (counts.get(norm) ?? 0) + 1)
      if (!spelling.has(norm)) spelling.set(norm, word)
    }
  }
}

const BASE_ENDINGS = ['ea', 'a', 'u', 'e', 'i', '']
const FORM_ENDINGS = ['ului', 'lui', 'ul', 'ei', 'ii', 'ilor', 'lor', 'elor', 'ele', 'le', 'ai', 'urilor', 'urile', 'uri', 'i', 'e', 'o']
/** Stem readings an independent grammar allows: as is, or with its last syllable changed. */
function readings(stem: string): Set<string> {
  const out = new Set([stem])
  const swaps: [RegExp, string][] = [[/sc$/, 'st'], [/d$/, 'z'], [/oa([^aeiou]+)$/, 'o$1'], [/ea([^aeiou]+)$/, 'e$1'], [/a([^aeiou]+)$/, 'e$1']]
  for (const [pattern, replacement] of swaps) out.add(stem.replace(pattern, replacement))
  out.add(stem.replace(/sc$/, 'st').replace(/a([^aeiou]+)$/, 'e$1'))
  return out
}

interface Pair { base: string; form: string; count: number; covered: boolean }
const types = new Set(counts.keys())
const pairs = new Map<string, Pair>()
for (const base of types) {
  for (const baseEnding of BASE_ENDINGS) {
    if (!base.endsWith(baseEnding)) continue
    const stem = base.slice(0, base.length - baseEnding.length)
    if (stem.length < 3) continue
    for (const reading of readings(stem)) {
      for (const ending of FORM_ENDINGS) {
        const form = `${reading}${ending}`
        if (form === base || !types.has(form) || pairs.has(form) || counts.get(base)! < counts.get(form)!) continue
        pairs.set(form, { base, form, count: counts.get(form)!, covered: wordForms(base).includes(form) })
      }
    }
  }
}
const generatedBy = new Map<string, string>()
for (const type of types) for (const form of wordForms(type)) if (form !== type && !generatedBy.has(form)) generatedBy.set(form, type)

const list = [...pairs.values()]
const covered = list.filter(pair => pair.covered)
const missed = list.filter(pair => !pair.covered)
const otherBase = missed.filter(pair => generatedBy.has(pair.form))
const residual = missed.filter(pair => !generatedBy.has(pair.form)).sort((a, b) => b.count - a.count)
const sum = (items: Pair[]): number => items.reduce((total, pair) => total + pair.count, 0)
const pct = (part: number, whole: number): string => `${(100 * part / whole).toFixed(1)}%`
const all = sum(list)
const lines = [
  '# Acoperirea flexiunilor pe Wikipedia (română)', '',
  `Cuvinte: ${words} · cuvinte distincte cu majusculă în mijlocul propoziției: ${types.size} · perechi bază → formă: ${list.length} (${all} apariții)`, '',
  '| | Perechi | Apariții |', '|---|---:|---:|',
  `| Generate din baza perechii | ${covered.length} | ${sum(covered)} (${pct(sum(covered), all)}) |`,
  `| Generate din alt cuvânt al corpusului (baza aleasă greșit de extragere) | ${otherBase.length} | ${sum(otherBase)} (${pct(sum(otherBase), all)}) |`,
  `| Negenerate (de verificat manual: multe nu sunt flexiuni) | ${residual.length} | ${sum(residual)} (${pct(sum(residual), all)}) |`,
  '', '## Negenerate', '', '| Bază | Formă | Apariții |', '|---|---|---:|',
  ...residual.map(pair => `| ${spelling.get(pair.base)} | ${spelling.get(pair.form)} | ${pair.count} |`),
]
writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(`pairs ${list.length} (${all} occurrences): from base ${pct(sum(covered), all)}, from another word ${pct(sum(otherBase), all)}, not generated ${pct(sum(residual), all)}`)

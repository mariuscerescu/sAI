/**
 * Deterministic Romanian inflection for vocabulary terms. At compile time each
 * word of a term gets the inflected spellings its ending allows (genitive/dative,
 * definite article, vocative, colloquial feminine genitive); a term's forms are
 * every combination of its words' forms. Forms are generated, never looked up,
 * so the core needs no lexicon and runtime matching stays an exact search.
 */

/** Words that never inflect inside names (legal forms, particles). */
const INVARIANT = new Set(['srl', 'sa', 'ii', 'ong', 'ltd', 'gmbh', 'inc', 'de', 'din', 'si', 'la', 'cu', 'pe', 'al', 'a', 'ai', 'ale', 'lui', 'dl', 'dna'])

/** Shortest word that gets inflected forms. */
const MIN_WORD = 3
/** Longest term whose every word varies; longer terms vary only first and last word. */
const MAX_FREE_WORDS = 4
/** Upper bound on generated spellings per term. */
const MAX_FORMS_PER_TERM = 96

/**
 * Inflected spellings of one normalized word (lowercase, no diacritics).
 * @param word - one word of a normalized term.
 * @returns the word itself first, then its generated forms.
 */
export function wordForms(word: string): string[] {
  const forms = new Set([word])
  if (word.length < MIN_WORD || /\d/.test(word) || INVARIANT.has(word)) return [...forms]
  const add = (...items: string[]): void => { for (const item of items) forms.add(item) }
  if (word.endsWith('ea')) {
    // Andreea → Andreei, Andreeo (vocative) · Universitatea → Universității
    const base = word.slice(0, -1)
    add(`${base}i`, `${base.slice(0, -1)}ii`, `${base}o`)
  } else if (word.endsWith('a')) {
    // Maria → Mariei · Banca → Băncii · Olga → Olgăi · Tehnica → Tehnice · Maria → Mario
    const stem = word.slice(0, -1)
    add(`${stem}ei`, `${stem}ii`, `${stem}ai`, `${stem}e`, `${stem}o`)
  } else if (word.endsWith('ul')) {
    // Proiectul → Proiectului
    add(`${word}ui`)
  } else if (word.endsWith('u')) {
    // Popescu → Popescul, Popescului, Popescule · Petru, Dumitru, Alexandru → Petre, Dumitre, Alexandre (vocative)
    add(`${word}l`, `${word}lui`, `${word}le`)
    if (/[dt]ru$/.test(word)) add(`${word.slice(0, -1)}e`)
  } else if (word.endsWith('e')) {
    // Vrabie → Vrabiei · Sandule (vocative) has no rule here
    add(`${word}i`, `${word}lui`)
  } else if (word.endsWith('i') || word.endsWith('o')) {
    // Ursachi, Mario: only the analytic genitive ("lui Ursachi") exists
  } else {
    // Consonant: Ceban → Cebanul, Cebanului, Cebanule, Cebanei · Orion → Orionului
    add(`${word}ul`, `${word}ului`, `${word}ule`, `${word}ei`)
    // Vocative: Ștefan → Ștefane, Pavel → Pavele; with o → oa in the last syllable: Ion → Ioane
    add(`${word}e`)
    if (/o[^aeiou]+$/.test(word)) add(word.replace(/o([^aeiou]+)$/, 'oa$1e'))
  }
  return [...forms]
}

/**
 * Every generated spelling of a normalized term, the term itself first.
 * @param term - normalized term (words separated by single spaces).
 * @param forms - spellings of one word, the word first; Romanian by default.
 * @returns distinct spellings, bounded by {@link MAX_FORMS_PER_TERM}.
 */
export function termForms(term: string, forms: (word: string) => readonly string[] = wordForms): string[] {
  const words = term.split(' ').filter(Boolean)
  const variable = (index: number): boolean => words.length <= MAX_FREE_WORDS || index === 0 || index === words.length - 1
  const options = words.map((word, index) => (variable(index) ? forms(word) : [word]))
  // Combinations with fewer changed words come first ("Băncii Verde" before "Băncii Verzi"),
  // so the cap only ever drops the least likely spellings.
  const out: string[] = []
  const walk = (index: number, left: number, parts: string[]): void => {
    if (out.length >= MAX_FORMS_PER_TERM || words.length - index < left) return
    if (index === words.length) { out.push(parts.join(' ')); return }
    const [base, ...inflected] = options[index]!
    walk(index + 1, left, [...parts, base!])
    if (left > 0) for (const form of inflected) walk(index + 1, left - 1, [...parts, form])
  }
  for (let changed = 0; changed <= words.length && out.length < MAX_FORMS_PER_TERM; changed++) walk(0, changed, [])
  return [...new Set([term, ...out])]
}

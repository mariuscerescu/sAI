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
 * A stem as it reads before the endings -i, -ii, -ile, -ilor, where Romanian changes the
 * last syllable: d → z (verde → verzi), sc → șt (Popescu → Popeștii), oa → o (Floarea →
 * Florii, școala → școlii), ea → e (seara → serii, Suceava → Sucevei), ia → ie (piața →
 * pieței, pretoriană → pretoriene). t → ț and s → ș need no rule: the search view drops
 * diacritics. Both readings are kept, since not every word alternates (Ioana → Ioanei keeps oa).
 * @param stem - normalized stem without its ending.
 * @returns the stem, then its alternated reading when different.
 */
export function alternations(stem: string): string[] {
  const changed = stem
    .replace(/sc$/, 'st')
    .replace(/d$/, 'z')
    .replace(/oa([^aeiou]+)$/, 'o$1')
    .replace(/ea([^aeiou]+)$/, 'e$1')
    .replace(/ia([^aeiou]+)$/, 'ie$1')
  return changed === stem ? [stem] : [stem, changed]
}

/** Plural and plural-genitive endings after an alternating stem: Bănci, Băncile, Băncilor. */
const I_PLURAL = ['i', 'ii', 'ile', 'ilor'] as const

/**
 * Inflected spellings of one normalized word (lowercase, no diacritics).
 * The singular forms come first, then plurals.
 * @param word - one word of a normalized term.
 * @param singular - only singular forms: a first name found alone has no plural, and its
 *   plurals are mostly other words ("Mării" of the sea for Maria, "Stelele" for Stela).
 * @returns the word itself first, then its generated forms.
 */
export function wordForms(word: string, singular = false): string[] {
  const forms = new Set([word])
  if (word.length < MIN_WORD || /\d/.test(word) || INVARIANT.has(word)) return [...forms]
  const add = (...items: string[]): void => { for (const item of items) forms.add(item) }
  /** The `-i` endings after every reading of a stem. */
  const iPlural = (stem: string, endings: readonly string[] = I_PLURAL): void => {
    for (const reading of alternations(stem)) add(...endings.map(ending => `${reading}${ending}`))
  }
  if (word.endsWith('ea')) {
    // Andreea → Andreei, Andreeo (vocative) · Universitatea → Universității, Universitățile · Floarea → Florii
    const base = word.slice(0, -1)
    // The form without the article: Universitatea → Universitate · Curtea → Curte
    add(`${base}i`, `${base.slice(0, -1)}ii`, `${base}o`, base)
    iPlural(base.slice(0, -1), singular ? ['ii'] : I_PLURAL)
  } else if (word.endsWith('a')) {
    // Maria → Mariei · Banca → Băncii · Olga → Olgăi · Tehnica → Tehnice · Maria → Mario
    const stem = word.slice(0, -1)
    add(`${stem}ei`, `${stem}ii`, `${stem}ai`, `${stem}e`, `${stem}o`)
    // The genitive alternates too: Suceava → Sucevei · Piața → Pieței
    for (const reading of alternations(stem).slice(1)) add(`${reading}ei`)
    // Plural: Banca → Bănci, Băncile, Băncilor · Școala → Școlii, Școlile · Casa → Casele, Caselor
    // · Neagra → Negre (the -e ending alternates too)
    iPlural(stem, singular ? ['ii'] : I_PLURAL)
    if (!singular) {
      add(`${stem}ele`, `${stem}elor`)
      for (const reading of alternations(stem).slice(1)) add(`${reading}e`)
    }
  } else if (word.endsWith('ul')) {
    // Proiectul → Proiectului · plural: Grupul → Grupurile, Grupurilor · Proiectul → Proiectele · Lupul → Lupii
    const base = word.slice(0, -2)
    // A name that merely ends in -ul takes the article itself: Istanbul → Istanbulului
    add(`${word}ui`, `${word}ului`)
    if (!singular) {
      add(`${base}uri`, `${base}urile`, `${base}urilor`, `${base}ele`, `${base}elor`)
      iPlural(base, ['ii', 'ilor'])
    }
  } else if (word.endsWith('u')) {
    // Popescu → Popescul, Popescului, Popescule · Petru, Dumitru, Alexandru → Petre, Dumitre, Alexandre (vocative)
    add(`${word}l`, `${word}lui`, `${word}le`)
    if (/[dt]ru$/.test(word)) add(`${word.slice(0, -1)}e`)
    // The family by name: Popescu → Popeștii, Popeștilor · Rusu → Rușii
    if (!singular) iPlural(word.slice(0, -1), ['ii', 'ilor'])
  } else if (word.endsWith('e')) {
    // Vrabie → Vrabiei · Sandule (vocative) has no rule here
    add(`${word}i`, `${word}lui`)
    // Feminine genitive with the article: Securitate → Securității · Mare → Marii (Marii Britanii)
    iPlural(word.slice(0, -1), ['ii'])
    if (!singular) {
      // Plural: Verde → Verzi · Mare → Mari · Floare → Flori, Florile · Carte → Cărți
      iPlural(word.slice(0, -1), ['i', 'ile', 'ilor'])
      // Masculine article and plural genitive: Soare → Soarele · Mare → Marele · Filipine → Filipinelor
      add(`${word}le`, `${word}lor`)
    }
  } else if (word.endsWith('i')) {
    // București → Bucureștiul, Bucureștiului · Război → Războiul · Vechi → Vechiul · Bălți → Bălțului
    add(`${word}ul`, `${word}ului`, `${word.slice(0, -1)}ului`)
    if (!singular) {
      // Plural with the article: Carpați → Carpații, Carpaților · Alpi → Alpii · Ramuri → Ramurile
      // · Munții → Munților, Principii → Principiile
      add(`${word}i`, `${word}le`, word.endsWith('ii') ? `${word.slice(0, -1)}lor` : `${word}lor`)
    }
  } else if (word.endsWith('o')) {
    // Mario, Bruno: only the analytic genitive ("lui Bruno") exists
  } else {
    // Consonant: Ceban → Cebanul, Cebanului, Cebanule, Cebanei · Orion → Orionului
    add(`${word}ul`, `${word}ului`, `${word}ule`, `${word}ei`)
    // Vocative: Ștefan → Ștefane, Pavel → Pavele; with o → oa in the last syllable: Ion → Ioane
    add(`${word}e`)
    if (/o[^aeiou]+$/.test(word)) add(word.replace(/o([^aeiou]+)$/, 'oa$1e'))
    // Plural: Ceban → Cebanii, Cebanilor · Grup → Grupuri, Grupurile, Grupurilor · Roman → Romani
    // · Stat → Statele, Statelor
    if (!singular) {
      iPlural(word, ['i', 'ii', 'ilor'])
      add(`${word}uri`, `${word}urile`, `${word}urilor`, `${word}ele`, `${word}elor`)
    }
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

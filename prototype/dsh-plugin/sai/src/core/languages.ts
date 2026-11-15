/**
 * Language packs: everything the vocabulary detector needs to know about the
 * languages the user writes in. The rest of the core (matching, symbols,
 * restoration, patterns) is language-independent. A pack is enabled in the
 * settings; with several packs enabled, their forms and word lists are combined.
 */

import { wordForms as romanianWordForms } from './inflection.ts'

/** Languages with a shipped pack. */
export const LANGUAGE_IDS = ['ro', 'en'] as const

/** One shipped language. */
export type LanguageId = typeof LANGUAGE_IDS[number]

/** What one language contributes to vocabulary matching. */
export interface LanguagePack {
  readonly id: LanguageId
  /**
   * Spellings of one normalized word in running text, the word itself first.
   * @param word - one word of a normalized term (lowercase, no diacritics).
   * @param singular - only singular forms (a first name found alone has no plural).
   */
  readonly wordForms: (word: string, singular?: boolean) => readonly string[]
  /** Titles, particles, and salutations written next to names that are not name parts (normalized, no dots). */
  readonly notNames: readonly string[]
  /** Legal-form words of company names (normalized, no dots): "Acme Corp" also protects "Acme". */
  readonly legalForms: readonly string[]
  /**
   * Generic first words of organization names and places, never a short name on their own:
   * "Banca Verde" is not shortened to "Banca", nor "Moldova Agroindbank" to "Moldova".
   */
  readonly orgWords: readonly string[]
}

/** English words that never take the family plural. */
const ENGLISH_INVARIANT = new Set([
  'inc', 'ltd', 'llc', 'corp', 'co', 'plc', 'llp', 'lp', 'gmbh', 'ag', 'the', 'of', 'and', 'for',
  'mr', 'mrs', 'ms', 'miss', 'sir', 'dr', 'prof', 'mx', 'jr', 'sr',
])

/**
 * English names barely inflect: the possessive ("Smith's") is already split off at the
 * apostrophe, so only the plural is generated ("the Smiths", "the Joneses", and with it
 * the plural possessive "the Smiths' house"). Regular plurals and four spelling rules that
 * cannot turn one name into another are covered; Latin and Greek plurals are left out, since
 * they would ("Francis" → "Frances", "Simon" → "Sima"), and are declared when needed.
 * @param word - one normalized word.
 * @param singular - no plural (a first name found alone: "Marks", "Bills" are other words).
 * @returns the word and its plurals.
 */
export function englishWordForms(word: string, singular = false): string[] {
  if (singular || word.length < 3 || !/^\p{L}+$/u.test(word) || ENGLISH_INVARIANT.has(word)) return [word]
  const forms = [word, /(?:s|x|z|ch|sh)$/.test(word) ? `${word}es` : `${word}s`]
  // -ch said "k" takes -s: Czech → Czechs, Monarch → Monarchs (Church → Churches above).
  if (word.endsWith('ch')) forms.push(`${word}s`)
  // A consonant + y: Industry → Industries, University → Universities. Family names keep -ys
  // ("the Kennedys"), so both plurals are kept.
  if (/[^aeiou]y$/.test(word)) forms.push(`${word.slice(0, -1)}ies`)
  // -f, -fe → -ves: Wolf → Wolves, Knife → Knives (Chiefs, Roofs keep the -s above).
  if (word.endsWith('fe')) forms.push(`${word.slice(0, -2)}ves`)
  else if (word.endsWith('f')) forms.push(`${word.slice(0, -1)}ves`)
  // A consonant + o: Hero → Heroes, Potato → Potatoes (Photos keeps the -s above).
  if (/[^aeiou]o$/.test(word)) forms.push(`${word}es`)
  // -man → -men: Congressman → Congressmen, Chairman → Chairmen (Germans keeps the -s above).
  if (word.endsWith('man')) forms.push(`${word.slice(0, -3)}men`)
  return forms
}

/** Every shipped pack, keyed by id. */
export const LANGUAGES: Readonly<Record<LanguageId, LanguagePack>> = {
  ro: {
    id: 'ro',
    wordForms: romanianWordForms,
    notNames: [
      'dl', 'dna', 'd-na', 'd-l', 'domnul', 'doamna', 'domnului', 'doamnei', 'dr', 'av', 'prof', 'ing', 'de', 'din', 'si',
      'stimate', 'stimata', 'draga', 'dragul', 'salut',
    ],
    legalForms: ['srl', 'sa', 'sc', 'ii', 'ong', 'snc', 'scs', 'ra', 'im'],
    orgWords: [
      'banca', 'grupul', 'grup', 'compania', 'firma', 'societatea', 'fundatia', 'asociatia', 'universitatea', 'ministerul',
      'agentia', 'primaria', 'consiliul', 'spitalul', 'fabrica', 'cooperativa', 'institutul', 'centrul', 'proiectul', 'programul',
      'operatiunea', 'campania', 'strategia', 'platforma', 'initiativa', 'vinaria', 'magazinul', 'clinica', 'scoala', 'liceul',
      'academia', 'uniunea', 'federatia', 'camera', 'directia', 'inspectoratul', 'serviciul', 'oficiul', 'biroul', 'casa',
      'compania', 'intreprinderea', 'combinatul', 'trustul', 'holdingul', 'national', 'nationala', 'international', 'moldova',
      'romania', 'chisinau', 'bucuresti', 'balti', 'europa', 'european', 'europeana', 'noua', 'nou', 'prima', 'primul',
    ],
  },
  en: {
    id: 'en',
    wordForms: englishWordForms,
    notNames: [
      'mr', 'mrs', 'ms', 'miss', 'mx', 'sir', 'madam', 'lady', 'lord', 'dr', 'prof', 'jr', 'sr', 'van', 'von', 'of', 'the',
      'dear', 'hi', 'hello',
    ],
    legalForms: ['inc', 'ltd', 'llc', 'corp', 'co', 'plc', 'llp', 'lp', 'gmbh', 'ag', 'corporation', 'incorporated', 'limited'],
    orgWords: [
      'the', 'bank', 'group', 'company', 'foundation', 'association', 'university', 'college', 'school', 'ministry', 'department',
      'agency', 'council', 'hospital', 'clinic', 'institute', 'center', 'centre', 'project', 'program', 'programme', 'operation',
      'campaign', 'strategy', 'platform', 'initiative', 'office', 'bureau', 'board', 'committee', 'society', 'union', 'federation',
      'national', 'international', 'global', 'general', 'united', 'american', 'british', 'royal', 'first', 'new', 'north', 'south',
      'east', 'west', 'central', 'city', 'state', 'county', 'london', 'york', 'european', 'world',
    ],
  },
}

/** The languages of a combined pack, for settings that name none. */
export const DEFAULT_LANGUAGES: readonly LanguageId[] = ['ro', 'en']

/**
 * Combine the packs of several languages.
 * @param ids - enabled languages; unknown ids are ignored.
 * @returns one pack whose forms and lists are the union of the enabled packs.
 */
export function combineLanguages(ids: readonly string[]): Omit<LanguagePack, 'id'> {
  const packs = ids.flatMap(id => (LANGUAGE_IDS as readonly string[]).includes(id) ? [LANGUAGES[id as LanguageId]] : [])
  return {
    wordForms: (word, singular) => {
      const forms = new Set([word])
      for (const pack of packs) for (const form of pack.wordForms(word, singular)) forms.add(form)
      return [...forms]
    },
    notNames: [...new Set(packs.flatMap(pack => pack.notNames))],
    legalForms: [...new Set(packs.flatMap(pack => pack.legalForms))],
    orgWords: [...new Set(packs.flatMap(pack => pack.orgWords))],
  }
}

/**
 * Vocabulary detector: finds every declared spelling of a protected entity and
 * every form generated from it by the enabled language packs. Terms are indexed by their
 * first word, so a scan costs one lookup per word of text whatever the
 * vocabulary size.
 */

import { termForms } from '../inflection.ts'
import { combineLanguages, DEFAULT_LANGUAGES } from '../languages.ts'
import { keyString } from '../vault.ts'
import { isSentenceStart, isWordBounded, normalizeTerm, toOriginalRange } from '../normalize.ts'
import type { VocabularyEntry } from '../settings.ts'
import type { Candidate, ClassId, EntityKey, NormalizedText } from '../types.ts'

/** Priority of declared spellings and of their generated forms: the longer match wins between them. */
export const DICTIONARY_PRIORITY = 300

/** One searchable spelling. */
export interface CompiledTerm {
  readonly norm: string
  readonly classId: ClassId
  readonly key: EntityKey
  readonly priority: number
  /**
   * A multi-word term matched word by word: every text word may be any form of the term's
   * word at that position ("Băncii Verzi" for "Banca Verde"), so no combination is ever
   * enumerated. `norm` is then the term as declared.
   */
  readonly words?: readonly (readonly string[])[]
  /** With `words`: an exact match keeps the text as written, an inflected one restores `baseForm`. */
  readonly exactKeepsSurface?: boolean
  /** Declared spelling this form was generated from; restored instead of the form. */
  readonly baseForm?: string
  /**
   * Capital-letter rule for one-word forms. `required`: match only when capitalized (a first
   * name alone: "will", "mark", "iulie" are ordinary words far more often than names).
   * `expected`: match only when capitalized, unless the text writes no names with capitals
   * (someone who types "am vorbit cu popescului" writes every name in lowercase).
   */
  readonly capital?: 'required' | 'expected'
  /** A two-letter part of a declared name ("Jo", "Le"): searched only with the verifier on, which decides each occurrence. */
  readonly short?: boolean
}

const FIRST_WORD = /^[\p{L}\p{N}]+/u
const WORD = /[\p{L}\p{N}]+/gu
/** Lowercase function words never asked about as a two-letter name: "do" for Do Tran would mean a question per verb. */
const COMMON_TWO_LETTER_WORDS = new Set('am an as at be by do go he if in is it me my no of on or so to up us we'.split(' '))

/** Facts about the whole text that detectors may use. */
export interface DetectHints {
  /** Whether the text writes names with capitals (see {@link capitalizesNames}). */
  readonly capitalized?: boolean
  /**
   * With the verifier on: a lowercase one-word form is never accepted on the text's style alone
   * ("i talked to price" in a text with no capitalized name); it is unconfirmed, for the verifier.
   */
  readonly verifyLowercase?: boolean
  /**
   * Verifier mode `all`: every one-word form is unconfirmed, in any case, declared or generated;
   * only multi-word matches are found directly.
   */
  readonly verifyAll?: boolean
}

/**
 * Whether a text writes names with capital letters: some word inside a sentence starts
 * with a capital followed by a lowercase letter. Words that open a sentence, a line, or a
 * quote (which keyboards capitalize on their own), "I", and all-caps acronyms do not count,
 * so "I talked to smith" and "Am vorbit cu popescului" read as written in lowercase.
 * @param original - the text as written.
 * @returns true when lowercase one-word name forms in it are ordinary words.
 */
export function capitalizesNames(original: string): boolean {
  for (const match of original.matchAll(/\p{Lu}\p{Ll}/gu)) {
    const at = match.index
    if (at > 0 && /[\p{L}\p{N}]/u.test(original[at - 1]!)) continue
    if (!isSentenceStart(original, at)) return true
  }
  return false
}

/**
 * End of the longest word-by-word match of a multi-word term at `at`: each word of the
 * text is one of the forms of the term's word at that position, words separated by one
 * space. Forms are tried directly, so a term costs a few prefix checks, not a list of
 * every combination of its words' forms.
 * @param norm - normalized text.
 * @param at - start of the first word.
 * @param words - forms of each word of the term.
 * @returns the end of the match, or -1.
 */
function phraseEnd(norm: string, at: number, words: readonly (readonly string[])[]): number {
  let best = -1
  const step = (index: number, position: number): void => {
    for (const form of words[index]!) {
      if (!norm.startsWith(form, position)) continue
      const next = position + form.length
      if (index === words.length - 1) {
        if (next > best && isWordBounded(norm, at, next)) best = next
      } else if (norm[next] === ' ') {
        step(index + 1, next + 1)
      }
    }
  }
  step(0, at)
  return best
}

/**
 * Whether an occurrence is glued to a code token: an underscore, slash, backslash, @, #, $ or =
 * right next to it, or a dot between it and another letter or digit ("gb_total", "acme.com",
 * "obj.bill"). A dot that ends a sentence does not count, and neither does a hyphen.
 * @param original - the text as written.
 * @param start - start of the occurrence.
 * @param end - end of the occurrence.
 * @returns true inside a code token.
 */
export function inCodeToken(original: string, start: number, end: number): boolean {
  const before = original[start - 1] ?? ''
  const after = original[end] ?? ''
  if (/[_/\\@#$=]/.test(before) || /[_/\\@#$=]/.test(after)) return true
  return (before === '.' && /[\p{L}\p{N}]/u.test(original[start - 2] ?? ''))
    || (after === '.' && /[\p{L}\p{N}]/u.test(original[end + 1] ?? ''))
}

/** A compiled term list searched with word boundaries. */
export class TermDetector {
  private readonly byFirstWord = new Map<string, CompiledTerm[]>()
  private readonly other: CompiledTerm[] = []

  /**
   * @param id - detector id stamped on candidates.
   * @param terms - normalized spellings with their class, key, and scores.
   * @param owners - for every one-word person spelling (first name or surname), the entries it belongs to.
   */
  constructor(readonly id: string, terms: readonly CompiledTerm[], readonly owners: ReadonlyMap<string, ReadonlySet<string>> = new Map()) {
    for (const term of terms) {
      if (term.norm.length === 0) continue
      const firsts = new Set((term.words?.[0] ?? [term.norm]).map(form => FIRST_WORD.exec(form)?.[0]))
      if (firsts.has(undefined)) { this.other.push(term); continue }
      for (const first of firsts as Set<string>) {
        const list = this.byFirstWord.get(first) ?? []
        list.push(term)
        this.byFirstWord.set(first, list)
      }
    }
  }

  /** @returns how many terms the detector searches for (a word-by-word term counts once). */
  get size(): number {
    const all = new Set<CompiledTerm>(this.other)
    for (const list of this.byFirstWord.values()) for (const term of list) all.add(term)
    return all.size
  }

  /**
   * Find every bounded occurrence of every spelling.
   * @param text - normalized view.
   * @param hints - `capitalized`: whether the text writes names with capitals; computed from
   *   the text when absent. The leak check passes the value of the original text.
   * @returns candidates in the original text, possibly overlapping.
   */
  detect(text: NormalizedText, hints: DetectHints = {}): Candidate[] {
    return this.split(text, hints).found
  }

  /**
   * Find every bounded occurrence, keeping apart the ones the capital-letter rule drops.
   * @param text - normalized view.
   * @param hints - as for {@link detect}.
   * @returns `found`: what {@link detect} returns; `unconfirmed`: lowercase one-word forms the
   *   capital-letter rule drops ("bill" for Bill Turner), which a verifier may still confirm, and,
   *   with `verifyLowercase`, also those it would accept only because the text has no capitalized name.
   */
  split(text: NormalizedText, hints: DetectHints = {}): { found: Candidate[]; unconfirmed: Candidate[] } {
    const found: Candidate[] = []
    const unconfirmed: Candidate[] = []
    const capitalized = hints.capitalized ?? capitalizesNames(text.original)
    const push = (term: CompiledTerm, at: number, end = at + term.norm.length): void => {
      const range = toOriginalRange(text, at, end)
      const verifying = hints.verifyAll === true || hints.verifyLowercase === true
      if (term.short === true && (!verifying || COMMON_TWO_LETTER_WORDS.has(text.original.slice(range.start, range.end)))) return
      // A form inside a code token ("gb_total", "acme.com", "src/acme") is replaced without asking:
      // measured, the model reads it as an ordinary word.
      const dropped = !(verifying && inCodeToken(text.original, range.start, range.end)) && (term.short === true || (hints.verifyAll === true
        ? term.words === undefined && !term.norm.includes(' ')
        : (term.capital === 'required' || (term.capital === 'expected' && (capitalized || hints.verifyLowercase === true)))
          && !/^\p{Lu}/u.test(text.original.slice(range.start, range.start + 2))))
      const baseForm = term.exactKeepsSurface === true && text.norm.slice(at, end) === term.norm ? undefined : term.baseForm
      ;(dropped ? unconfirmed : found).push({
        ...range, classId: term.classId, detector: this.id, priority: term.priority, key: term.key,
        ...baseForm === undefined ? {} : { baseForm },
      })
    }
    for (const match of text.norm.matchAll(WORD)) {
      const at = match.index
      if (at > 0 && /[\p{L}\p{N}]/u.test(text.norm[at - 1]!)) continue
      for (const term of this.byFirstWord.get(match[0]) ?? []) {
        if (term.words !== undefined) {
          const end = phraseEnd(text.norm, at, term.words)
          if (end > at) push(term, at, end)
        } else if (text.norm.startsWith(term.norm, at) && isWordBounded(text.norm, at, at + term.norm.length)) {
          push(term, at)
        }
      }
    }
    for (const term of this.other) {
      for (let at = text.norm.indexOf(term.norm); at >= 0; at = text.norm.indexOf(term.norm, at + 1)) {
        if (isWordBounded(text.norm, at, at + term.norm.length)) push(term, at)
      }
    }
    return { found, unconfirmed }
  }
}

/**
 * Compile the user vocabulary with its generated inflected forms.
 * @param vocabulary - resolved entries with ids.
 * @param languages - languages of the user's texts; their packs supply forms, titles, and legal forms.
 * @returns the dictionary detector.
 * @throws Error when one declared spelling belongs to entries of different classes.
 */
export function compileDictionary(vocabulary: readonly VocabularyEntry[], languages: readonly string[] = DEFAULT_LANGUAGES): TermDetector {
  const language = combineLanguages(languages)
  const declared = new Map<string, ClassId>()
  for (const entry of vocabulary) {
    for (const term of entry.terms) {
      const norm = normalizeTerm(term)
      if (norm.length === 0) continue
      const previous = declared.get(norm)
      if (previous !== undefined && previous !== entry.class) {
        throw new Error(`vocabulary term appears in classes ${previous} and ${entry.class}`)
      }
      declared.set(norm, entry.class)
    }
  }
  const { parts, owners } = nameParts(vocabulary, new Set(language.notNames))
  /** A one-word person spelling that belongs to several people gets its own symbol, restored as itself. */
  const keyOf = (entry: VocabularyEntry, norm: string): EntityKey => {
    const shared = entry.class === PERSON && (owners.get(norm)?.size ?? 0) > 1
    return shared ? { kind: 'canonical', classId: PERSON, value: norm } : { kind: 'entry', entryId: entry.id! }
  }
  const sources: Source[] = []
  for (const entry of vocabulary) {
    for (const term of entry.terms) {
      const norm = normalizeTerm(term)
      if (norm.length > 0) sources.push({ entry, norm, spelling: term, key: keyOf(entry, norm), derived: false })
    }
  }
  const legalForms = new Set(language.legalForms)
  for (const part of [...parts, ...withoutLegalForm(vocabulary, legalForms), ...shortNames(vocabulary, legalForms, new Set(language.orgWords))]) {
    if (declared.has(part.norm)) continue
    sources.push({ ...part, key: keyOf(part.entry, part.norm), derived: true })
  }

  const terms: CompiledTerm[] = []
  /**
   * Generated spelling → the entity it stands for. When two entities generate the same
   * spelling, the one whose declared spelling is closest (longest) wins: "răileanului"
   * belongs to "Răileanu" rather than "Railean". Two classes claiming it drop it.
   */
  const generated = new Map<string, { term: CompiledTerm; baseLength: number } | null>()
  for (const { entry, norm, spelling, key, derived, firstName, short } of sources) {
    if (norm.includes(' ')) {
      // A multi-word term matches word by word, each word in any of its forms ("Băncii Verzi").
      terms.push({
        norm, classId: entry.class, key, priority: DICTIONARY_PRIORITY, baseForm: spelling, exactKeepsSurface: !derived,
        words: norm.split(' ').map(word => language.wordForms(word)),
      })
      continue
    }
    if (!derived) terms.push({ norm, classId: entry.class, key, priority: DICTIONARY_PRIORITY })
    // A first name found alone takes only singular forms: its plurals are other words ("Mării" for Maria).
    for (const form of termForms(norm, word => language.wordForms(word, firstName === true))) {
      if ((form === norm && !derived) || declared.has(form)) continue
      const claimed = generated.get(form)
      if (claimed === null) continue
      if (claimed !== undefined && claimed.term.classId !== entry.class) { generated.set(form, null); continue }
      // Two entities of one class share this spelling: the closer one keeps it.
      const collision = claimed !== undefined && keyString(claimed.term.key) !== keyString(key)
      if (claimed !== undefined && claimed.baseLength >= norm.length) {
        // One shared part, a first name for one person and a surname for another ("Thomas"): keep the stricter reading.
        if (!collision && firstName === true && claimed.term.capital === 'expected') {
          generated.set(form, { ...claimed, term: { ...claimed.term, capital: 'required' } })
        }
        continue
      }
      const oneWord = !form.includes(' ')
      generated.set(form, {
        baseLength: norm.length,
        term: {
          norm: form, classId: entry.class, key, priority: DICTIONARY_PRIORITY, baseForm: spelling,
          // A one-word generated form or name part counts only when capitalized, as names are:
          // "Iulie" may be Iulia, "în iulie" is the month; "Lungul" may be Lungu, "de-a lungul" is not.
          ...oneWord ? { capital: firstName === true ? 'required' : 'expected' } : {},
          ...short === true ? { short } : {},
        },
      })
    }
  }
  for (const claim of generated.values()) if (claim !== null) terms.push(claim.term)
  return new TermDetector('dictionary', terms, owners)
}

/** Class whose multi-word terms are split into first name and surname. */
const PERSON = 'PERSON'

/** A word as written and normalized, stripped of surrounding punctuation ("O'Brien," → "o'brien"). */
function bareWord(word: string): { spelling: string; norm: string } {
  const spelling = word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  return { spelling, norm: normalizeTerm(spelling) }
}

/** A legal-form word without its dots ("S.R.L." → "srl"). */
const legalWord = (word: string): string => bareWord(word).norm.replace(/\./g, '')

/** A name part: letters, possibly joined by an apostrophe or hyphen ("o'brien", "bennett-smith"). */
const NAME_PART = /^\p{L}[\p{L}'’-]*\p{L}$/u

/**
 * An organization is often called by the first word of its name: "Acme Logistics Inc." is
 * "Acme". Like a surname, the first word needs its capital unless the text writes no names
 * with capitals (it may be an ordinary word: "Nordic", "Blue"; the allowlist exempts such a
 * word), and generic words and places never count ("Banca", "Project", "Moldova").
 * @param vocabulary - resolved entries.
 * @param legalForms - normalized legal-form words of the enabled languages.
 * @param orgWords - generic first words of the enabled languages.
 * @returns the short names, restored as written.
 */
function shortNames(vocabulary: readonly VocabularyEntry[], legalForms: ReadonlySet<string>, orgWords: ReadonlySet<string>): Omit<Source, 'key' | 'derived'>[] {
  const out: Omit<Source, 'key' | 'derived'>[] = []
  for (const entry of vocabulary) {
    if (entry.class === PERSON) continue
    for (const term of entry.terms) {
      const words = term.split(/\s+/).filter(word => word.length > 0 && !legalForms.has(legalWord(word)))
      if (words.length < 2) continue
      const { spelling, norm } = bareWord(words[0]!)
      if (norm.length < 3 || !/^\p{L}+$/u.test(norm) || orgWords.has(norm)) continue
      out.push({ entry, norm, spelling })
    }
  }
  return out
}

/**
 * A company name is also written without its legal form: "Acme Corp" protects "Acme",
 * "SC Acme Logistic SRL" protects "Acme Logistic".
 * @param vocabulary - resolved entries.
 * @param legalForms - normalized legal-form words of the enabled languages.
 * @returns the shortened spellings, restored as written in the declared term.
 */
function withoutLegalForm(vocabulary: readonly VocabularyEntry[], legalForms: ReadonlySet<string>): Omit<Source, 'key' | 'derived'>[] {
  const out: Omit<Source, 'key' | 'derived'>[] = []
  for (const entry of vocabulary) {
    if (entry.class === PERSON) continue
    for (const term of entry.terms) {
      const words = term.split(/\s+/).filter(Boolean)
      let start = 0
      let end = words.length
      while (start < end && legalForms.has(legalWord(words[start]!))) start++
      while (end > start && legalForms.has(legalWord(words[end - 1]!))) end--
      if (start === 0 && end === words.length) continue
      const kept = words.slice(start, end)
      const spelling = kept.join(' ').replace(/[,.;]+$/u, '')
      const norm = normalizeTerm(spelling)
      if (kept.length === 0 || norm.length < 3) continue
      out.push({ entry, norm, spelling })
    }
  }
  return out
}

/** One spelling to search, with the entity it stands for. */
interface Source {
  readonly entry: VocabularyEntry
  readonly norm: string
  /** Spelling restored for this source and its forms. */
  readonly spelling: string
  readonly key: EntityKey
  /** A name part found alone, not a spelling the user declared. */
  readonly derived: boolean
  /** A first name found alone. */
  readonly firstName?: boolean
  /** A two-letter name part, see {@link CompiledTerm.short}. */
  readonly short?: boolean
}

/**
 * Each word of a multi-word person term is also searched alone: "Ion Rusu" protects
 * "Ion", "Ioane", "Rusu" and "Rusului". Terms are read as first names then surname:
 * every name word but the last is a first name ("Ana Maria Popescu"). A first name alone
 * counts only when capitalized ("will", "mark", "iulie" are usually ordinary words).
 * @param vocabulary - resolved entries.
 * @returns the derived parts and, for every one-word person spelling, the entries that own it.
 */
function nameParts(vocabulary: readonly VocabularyEntry[], notNames: ReadonlySet<string>): {
  parts: Omit<Source, 'key' | 'derived'>[]
  owners: Map<string, Set<string>>
} {
  const parts: Omit<Source, 'key' | 'derived'>[] = []
  const owners = new Map<string, Set<string>>()
  const own = (norm: string, entryId: string): void => {
    const set = owners.get(norm) ?? new Set<string>()
    set.add(entryId)
    owners.set(norm, set)
  }
  for (const entry of vocabulary) {
    if (entry.class !== PERSON) continue
    const seen = new Set<string>()
    for (const term of entry.terms) {
      const words = term.split(/\s+/).filter(Boolean)
      if (words.length === 1) { own(normalizeTerm(term), entry.id!); continue }
      const names = words.map(bareWord)
        .filter(({ norm }) => norm.length >= 3 && NAME_PART.test(norm) && !notNames.has(norm.replace(/\./g, '')))
      for (const [index, { spelling, norm }] of names.entries()) {
        own(norm, entry.id!)
        if (seen.has(norm)) continue
        seen.add(norm)
        const firstName = index < names.length - 1
        parts.push({ entry, norm, spelling, firstName })
      }
      // Two-letter parts ("Jo", "Le") are kept apart so the reading of the longer parts, and the verifier-off path, do not change.
      // Only a capital followed by a lowercase letter counts: "II" and "de" are not names.
      for (const { spelling, norm } of words.map(bareWord)) {
        if (norm.length !== 2 || !/^\p{Lu}\p{Ll}$/u.test(spelling) || notNames.has(norm) || seen.has(norm)) continue
        seen.add(norm)
        parts.push({ entry, norm, spelling, firstName: true, short: true })
      }
    }
  }
  return { parts, owners }
}

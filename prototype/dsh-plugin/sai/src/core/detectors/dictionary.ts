/**
 * Vocabulary detector: finds every declared spelling of a protected entity and
 * every form generated from it by the enabled language packs. Terms are indexed by their
 * first word, so a scan costs one lookup per word of text whatever the
 * vocabulary size.
 */

import { termForms } from '../inflection.ts'
import { combineLanguages, DEFAULT_LANGUAGES } from '../languages.ts'
import { keyString } from '../vault.ts'
import { isFirstName, isKnownName, isLastName } from './names.ts'
import { isSentenceStart, isWordBounded, normalizeTerm, toOriginalRange } from '../normalize.ts'
import type { VocabularyEntry } from '../settings.ts'
import type { Candidate, ClassId, EntityKey, NormalizedText } from '../types.ts'

/** Priority of declared spellings and of their generated forms: the longer match wins between them. */
export const DICTIONARY_PRIORITY = 300
/** Confidence of an uncertain form: a first name alone, another person's name, or a spelling two entities share. */
export const AMBIGUOUS_FORM_CONFIDENCE = 0.6

/** One searchable spelling. */
export interface CompiledTerm {
  readonly norm: string
  readonly classId: ClassId
  readonly key: EntityKey
  readonly priority: number
  readonly confidence: number
  /** Declared spelling this form was generated from; restored instead of the form. */
  readonly baseForm?: string
  /**
   * Capital-letter rule for one-word forms. `required`: match only when capitalized (a first
   * name alone: "will", "mark", "iulie" are ordinary words far more often than names).
   * `expected`: match only when capitalized, unless the text writes no names with capitals
   * (someone who types "am vorbit cu popescului" writes every name in lowercase).
   */
  readonly capital?: 'required' | 'expected'
}

const FIRST_WORD = /^[\p{L}\p{N}]+/u
const WORD = /[\p{L}\p{N}]+/gu

/** Facts about the whole text that detectors may use. */
export interface DetectHints {
  /** Whether the text writes names with capitals (see {@link capitalizesNames}). */
  readonly capitalized?: boolean
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
      const first = FIRST_WORD.exec(term.norm)?.[0]
      if (first === undefined) { this.other.push(term); continue }
      const list = this.byFirstWord.get(first) ?? []
      list.push(term)
      this.byFirstWord.set(first, list)
    }
  }

  /** @returns how many spellings the detector searches for. */
  get size(): number {
    let size = this.other.length
    for (const list of this.byFirstWord.values()) size += list.length
    return size
  }

  /**
   * Find every bounded occurrence of every spelling.
   * @param text - normalized view.
   * @param hints - `capitalized`: whether the text writes names with capitals; computed from
   *   the text when absent. The leak check passes the value of the original text.
   * @returns candidates in the original text, possibly overlapping.
   */
  detect(text: NormalizedText, hints: DetectHints = {}): Candidate[] {
    const found: Candidate[] = []
    const capitalized = hints.capitalized ?? capitalizesNames(text.original)
    const push = (term: CompiledTerm, at: number): void => {
      const range = toOriginalRange(text, at, at + term.norm.length)
      if ((term.capital === 'required' || (term.capital === 'expected' && capitalized))
        && !/^\p{Lu}/u.test(text.original.slice(range.start, range.start + 2))) return
      found.push({
        ...range, classId: term.classId, detector: this.id, priority: term.priority, confidence: term.confidence, key: term.key,
        ...term.baseForm === undefined ? {} : { baseForm: term.baseForm },
      })
    }
    for (const match of text.norm.matchAll(WORD)) {
      const at = match.index
      if (at > 0 && /[\p{L}\p{N}]/u.test(text.norm[at - 1]!)) continue
      for (const term of this.byFirstWord.get(match[0]) ?? []) {
        if (text.norm.startsWith(term.norm, at) && isWordBounded(text.norm, at, at + term.norm.length)) push(term, at)
      }
    }
    for (const term of this.other) {
      for (let at = text.norm.indexOf(term.norm); at >= 0; at = text.norm.indexOf(term.norm, at + 1)) {
        if (isWordBounded(text.norm, at, at + term.norm.length)) push(term, at)
      }
    }
    return found
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
      if (norm.length > 0) sources.push({ entry, norm, spelling: term, key: keyOf(entry, norm), confidence: 1, derived: false })
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
  for (const { entry, norm, spelling, key, confidence, derived, firstName } of sources) {
    if (!derived) terms.push({ norm, classId: entry.class, key, priority: DICTIONARY_PRIORITY, confidence: 1 })
    for (const form of termForms(norm, language.wordForms)) {
      if ((form === norm && !derived) || declared.has(form)) continue
      const claimed = generated.get(form)
      if (claimed === null) continue
      if (claimed !== undefined && claimed.term.classId !== entry.class) { generated.set(form, null); continue }
      // Two entities of one class share this spelling: keep the closer one, but report it as uncertain.
      const collision = claimed !== undefined && keyString(claimed.term.key) !== keyString(key)
      if (claimed !== undefined && claimed.baseLength >= norm.length) {
        if (collision) generated.set(form, { ...claimed, term: { ...claimed.term, confidence: AMBIGUOUS_FORM_CONFIDENCE } })
        // One shared part, a first name for one person and a surname for another ("Thomas"): keep the stricter reading.
        else if (firstName === true && claimed.term.capital === 'expected') {
          generated.set(form, { ...claimed, term: { ...claimed.term, confidence: Math.min(claimed.term.confidence, confidence), capital: 'required' } })
        }
        continue
      }
      // A one-word form is uncertain when it is a name in its own right ("Petre", vocative of
      // "Petru", is also another person's name) or comes from a first name found alone ("Ioane").
      const oneWord = !form.includes(' ')
      const ambiguous = collision || confidence < 1 || (oneWord && form !== norm && isKnownName(form))
      generated.set(form, {
        baseLength: norm.length,
        term: {
          norm: form, classId: entry.class, key, priority: DICTIONARY_PRIORITY,
          confidence: ambiguous ? AMBIGUOUS_FORM_CONFIDENCE : 1, baseForm: spelling,
          // A one-word generated form or name part counts only when capitalized, as names are:
          // "Iulie" may be Iulia, "în iulie" is the month; "Lungul" may be Lungu, "de-a lungul" is not.
          ...oneWord ? { capital: firstName === true ? 'required' : 'expected' } : {},
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
 * with capitals, and it is reported as uncertain (it may be
 * an ordinary word: "Nordic", "Blue"), and generic words and places never count ("Banca",
 * "Project", "Moldova").
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
      out.push({ entry, norm, spelling, confidence: AMBIGUOUS_FORM_CONFIDENCE })
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
      out.push({ entry, norm, spelling, confidence: 1 })
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
  readonly confidence: number
  /** A name part found alone, not a spelling the user declared. */
  readonly derived: boolean
  /** A first name found alone. */
  readonly firstName?: boolean
}

/**
 * Each word of a multi-word person term is also searched alone: "Ion Rusu" protects
 * "Ion", "Ioane", "Rusu" and "Rusului". A first name alone is uncertain (another
 * Ion may be meant), so it is masked with a warning; a surname alone is certain
 * unless it is also an ordinary word or a first name.
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
      let position = 0
      for (const word of words) {
        const { spelling, norm } = bareWord(word)
        if (norm.length < 3 || !NAME_PART.test(norm) || notNames.has(norm.replace(/\./g, ''))) continue
        const index = position++
        own(norm, entry.id!)
        if (seen.has(norm)) continue
        seen.add(norm)
        const firstName = isFirstName(norm) || (index === 0 && !isLastName(norm))
        parts.push({ entry, norm, spelling, confidence: firstName ? AMBIGUOUS_FORM_CONFIDENCE : 1, firstName })
      }
    }
  }
  return { parts, owners }
}

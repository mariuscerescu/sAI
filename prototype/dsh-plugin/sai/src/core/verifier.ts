/**
 * Verifier of vocabulary forms. A one-word form of a declared name ("bill" for Bill Turner) may
 * be a name or an ordinary word. Without the verifier, the text's style decides (capital-letter
 * rules). With it, a local decision model decides, every question of a request in one call:
 *
 * - mode `lowercase`: only lowercase one-word forms are asked; capitalized ones are replaced as before;
 * - mode `all` (two stages): every one-word form is asked, in any case; exact multi-word matches
 *   and validated patterns stay certain. The model also decides whether a capitalized word right
 *   before a protected surname is part of the name ("Floare Munteanu", not "Ask bill"), and which
 *   of several declared people a shared first name stands for.
 *
 * A word the model calls a name, a word it is unsure about, and every word of a call that failed
 * are replaced; only a word the model calls ordinary stays. Which-person answers only choose a
 * symbol: they never remove a mask. With the verifier off, sAI behaves as before.
 *
 * The core performs no I/O: the host passes a {@link Verifier} that reaches the model.
 */

import type { Candidate, ClassId } from './types.ts'

/** Which one-word forms the verifier decides. */
export type VerifierMode = 'lowercase' | 'all'

/** User settings of the verifier. */
export interface VerifierSettings {
  /** When false, the capital-letter rules decide, as without a verifier. */
  enabled: boolean
  /** `lowercase`: only lowercase one-word forms go to the model. `all`: every one-word form does. */
  mode: VerifierMode
  /** Address of the local verifier service; only loopback addresses are accepted. */
  url: string
  /** A word is replaced when the model gives it at least this probability of being a name. */
  threshold: number
  /** Milliseconds to wait for the model; after that every word asked is replaced. */
  timeoutMs: number
  /** Optional words for a class in the question ("an internal project code"), by class id. */
  descriptions: Readonly<Record<ClassId, string>>
}

/**
 * Defaults: off, so sAI behaves as it did before the verifier existed. Once turned on, mode `all` at threshold 0.2 is the
 * configuration measured on the frozen English set (eval/results/frozen-final.md).
 */
export const DEFAULT_VERIFIER: VerifierSettings = {
  enabled: false,
  mode: 'all',
  url: 'http://127.0.0.1:8765/verify',
  threshold: 0.2,
  timeoutMs: 30_000,
  descriptions: {},
}

/** A shared first name is given one declared person's symbol only when the model is at least this sure. */
export const WHICH_CONFIDENCE = 0.8

/** Q1: is the word used as a name here, or as an ordinary word? */
export interface NameQuestion {
  readonly kind: 'name'
  /** The text around the word, cut so that the word appears in it only once. */
  readonly state: string
  /** The word as written. */
  readonly word: string
  /** Class of the vocabulary entry the word may stand for. */
  readonly classId: ClassId
  /** Declared spelling of that entry ("Bill Turner"), so the model knows which kind of name to look for. */
  readonly term: string
  /** The user's words for the class, when given. */
  readonly description?: string
}

/** Q2 (mode `all`): is the capitalized word right before a protected surname part of the name? */
export interface PartQuestion {
  readonly kind: 'part'
  readonly state: string
  /** The word before the surname ("Floare", or "Ask"). */
  readonly word: string
  /** The surname as written ("Munteanu"). */
  readonly name: string
  readonly classId: ClassId
}

/** Q3 (mode `all`): which declared person does a shared one-word name stand for? */
export interface WhichQuestion {
  readonly kind: 'which'
  readonly state: string
  readonly word: string
  readonly classId: ClassId
  /** Declared spellings of the entries sharing the word; the service adds "someone else or cannot tell". */
  readonly options: readonly string[]
  /** Entry ids, in the order of `options`. */
  readonly entries: readonly string[]
}

/** One question put to the verifier. */
export type VerifierQuestion = NameQuestion | PartQuestion | WhichQuestion

/**
 * One answer: for `name` and `part`, the probability of "yes"; for `which`, the probability of
 * each option and, last, of "someone else or cannot tell".
 */
export type VerifierAnswer = number | readonly number[]

/** Reaches the model. One call carries every question of one request. */
export interface Verifier {
  /**
   * @param questions - every question of one request.
   * @returns one answer per question, in order.
   */
  verify(questions: readonly VerifierQuestion[]): Promise<readonly VerifierAnswer[]>
}

/** Value-free account of one verification. */
export interface VerifyReport {
  /** Questions sent to the model (0: the model was not called). */
  readonly asked: number
  /** Calls made: 0 or 1. */
  readonly calls: number
  /** Whether the call failed, so every word asked will be replaced. */
  readonly failed: boolean
}

/** Characters of context kept on each side of the word. */
export const CONTEXT_CHARS = 300

/** End of a sentence: final punctuation (with closing quotes or brackets) followed by space, or a line break. */
const SENTENCE_END = /[.!?…]["'”’)\]]*(?=\s)|\n/gu

/**
 * The context of an occurrence: at most {@link CONTEXT_CHARS} of whole words on each side, cut so
 * that the occurrence's text appears in it only once. Another occurrence of the same text ("Reply
 * to bill: Acme paid the bill.") is cut off, at a sentence end between the two when there is one.
 * Measured on the 824-case set, marking the occurrence instead (⟪bill⟫) made the answers worse.
 * @param original - the whole text.
 * @param start - start of the occurrence.
 * @param end - end of the occurrence.
 * @param cutRepeats - false keeps other occurrences: a which-person question needs "Bill Turner … Bill".
 * @returns the context.
 */
export function contextOf(original: string, start: number, end: number, cutRepeats = true): string {
  const word = original.slice(start, end)
  let from = Math.max(0, start - CONTEXT_CHARS)
  let to = Math.min(original.length, end + CONTEXT_CHARS)
  // Never start or end inside a word.
  if (from > 0) { const space = original.slice(from, start).search(/\s/); from = space < 0 ? start : from + space + 1 }
  if (to < original.length) { const space = original.slice(end, to).search(/\s\S*$/); to = space < 0 ? end : end + space }

  // The nearest other occurrences of the same text, in any case.
  const lower = word.toLowerCase()
  const isWord = (at: number): boolean => original.slice(at, at + word.length).toLowerCase() === lower
    && !/[\p{L}\p{N}]/u.test(original[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(original[at + word.length] ?? '')
  let previous = -1
  let next = -1
  if (cutRepeats) {
    for (let at = start - 1; at >= from; at--) if (isWord(at) && at + word.length <= start) { previous = at; break }
    for (let at = end; at + word.length <= to; at++) if (isWord(at)) { next = at; break }
  }

  if (previous >= 0) {
    // Start after the last sentence end between the two, or right after the other occurrence.
    const gap = original.slice(previous + word.length, start)
    const ends = [...gap.matchAll(SENTENCE_END)]
    from = previous + word.length + (ends.length > 0 ? ends.at(-1)!.index + ends.at(-1)![0].length : 0)
  }
  if (next >= 0) {
    // End at the first sentence end between the two, or right before the other occurrence.
    const gap = original.slice(end, next)
    const sentenceEnd = [...gap.matchAll(SENTENCE_END)][0]
    to = sentenceEnd === undefined ? next : end + sentenceEnd.index + sentenceEnd[0].length
  }
  // A piece cut after another occurrence may start with its punctuation (": Acme paid…").
  return original.slice(from, to).replace(/^[\s:;,.!?)\]”’-]+/u, '').trim()
}

/**
 * Q1 for one occurrence.
 * @param original - the whole text.
 * @param span - the occurrence.
 * @param term - declared spelling of its entry.
 * @param description - the user's words for the class, if any.
 * @returns the question.
 */
export function questionFor(original: string, span: Candidate, term: string, description?: string): NameQuestion {
  const word = original.slice(span.start, span.end)
  const column = tableColumn(original, span.start)
  // The column header is often out of reach of the context, and a bare table cell says little.
  const named = column !== undefined && !column.toLowerCase().includes(word.toLowerCase())
  const context = contextOf(original, span.start, span.end)
  return {
    kind: 'name', state: named ? `Table column "${column}":\n${context}` : context, word,
    classId: span.classId, term, ...description === undefined ? {} : { description },
  }
}

/**
 * The header of the Markdown table column an offset falls in.
 * @param original - the whole text.
 * @param at - offset inside a table row.
 * @returns the header cell, or undefined outside a table body.
 */
function tableColumn(original: string, at: number): string | undefined {
  const isRow = (line: string): boolean => /^\s*\|/.test(line)
  const lineStart = original.lastIndexOf('\n', at - 1) + 1
  const lineEnd = original.indexOf('\n', at)
  if (!isRow(original.slice(lineStart, lineEnd < 0 ? original.length : lineEnd))) return undefined
  let headerStart = lineStart
  while (headerStart > 0) {
    const previous = headerStart < 2 ? 0 : original.lastIndexOf('\n', headerStart - 2) + 1
    if (!isRow(original.slice(previous, headerStart - 1))) break
    headerStart = previous
  }
  if (headerStart === lineStart) return undefined
  const column = original.slice(lineStart, at).split('|').length - 1
  const cell = original.slice(headerStart, original.indexOf('\n', headerStart)).split('|')[column]?.trim()
  return cell === undefined || cell.length === 0 ? undefined : cell
}

/**
 * Q2 for a capitalized word right before a protected surname.
 * @param original - the whole text.
 * @param word - range of the word ("Floare").
 * @param surname - the surname occurrence ("Munteanu").
 * @returns the question.
 */
export function partQuestion(original: string, word: { start: number; end: number }, surname: Candidate): PartQuestion {
  return {
    kind: 'part', state: contextOf(original, word.start, surname.end), word: original.slice(word.start, word.end),
    name: original.slice(surname.start, surname.end), classId: surname.classId,
  }
}

/**
 * Q3 for a one-word name several declared entries share.
 * @param original - the whole text.
 * @param span - the occurrence.
 * @param entries - ids and declared spellings of the entries sharing it.
 * @returns the question.
 */
export function whichQuestion(original: string, span: Candidate, entries: readonly { id: string; term: string }[]): WhichQuestion {
  return {
    kind: 'which', state: contextOf(original, span.start, span.end, false), word: original.slice(span.start, span.end),
    classId: span.classId, options: entries.map(entry => entry.term), entries: entries.map(entry => entry.id),
  }
}

/** @returns the identity of a question: equal questions are asked once and answered once. */
export function questionKey(question: VerifierQuestion): string {
  const about = question.kind === 'name' ? `${question.term}\u0000${question.description ?? ''}`
    : question.kind === 'part' ? question.name : question.options.join('\u0001')
  return `${question.kind}\u0000${question.classId}\u0000${question.word}\u0000${about}\u0000${question.state}`
}

/** Anything that lists the questions of a text and records their answers (a {@link Session}). */
export interface Askable {
  questions(original: string): VerifierQuestion[]
  answer(questions: readonly VerifierQuestion[], answers: readonly VerifierAnswer[]): void
}

/**
 * Ask every unanswered question of several texts (one request) in a single call and record
 * the answers in the session. No question: no call.
 * @param session - session whose answers the next redactions use.
 * @param texts - every text of the request.
 * @param verifier - the model.
 * @returns a value-free report.
 */
export async function verifyTexts(session: Askable, texts: Iterable<string>, verifier: Verifier): Promise<VerifyReport> {
  const unique = new Map<string, VerifierQuestion>()
  for (const text of texts) for (const question of session.questions(text)) unique.set(questionKey(question), question)
  const questions = [...unique.values()]
  if (questions.length === 0) return { asked: 0, calls: 0, failed: false }
  try {
    const answers = await verifier.verify(questions)
    if (answers.length !== questions.length) throw new Error('the verifier answered a different number of questions')
    session.answer(questions, answers)
    return { asked: questions.length, calls: 1, failed: false }
  } catch (_failure) {
    // Nothing is recorded: every word asked stays unanswered and is replaced.
    return { asked: questions.length, calls: 1, failed: true }
  }
}

/**
 * Whether a verifier address is on this computer, so texts never leave it through the verifier.
 * @param url - configured address.
 * @returns true for http(s) URLs on 127.0.0.1, ::1, or localhost.
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') && ['127.0.0.1', '[::1]', 'localhost'].includes(hostname)
  } catch (_invalid) {
    return false
  }
}

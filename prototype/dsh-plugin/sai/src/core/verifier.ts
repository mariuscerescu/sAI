/**
 * Verifier of risky vocabulary forms. Without it, a lowercase one-word form of a declared name
 * is decided by the text's style: dropped when the text writes names with capitals ("paid the
 * bill" for Bill Turner), replaced when it does not ("i talked to price" for Anna Price). With the
 * verifier on, every such occurrence is put to a local model instead: every one of a request in a
 * single call. Capitalized forms are replaced as before and never asked about. A word the model calls a name, a word it is
 * unsure about, and every word of a call that failed are replaced; only a word the model
 * calls ordinary stays. With the verifier off, sAI behaves as before.
 *
 * The core performs no I/O: the host passes a {@link Verifier} that reaches the model.
 */

import type { Candidate, ClassId } from './types.ts'

/** User settings of the verifier. */
export interface VerifierSettings {
  /** When false, lowercase forms the capital-letter rule drops stay in clear, as without a verifier. */
  enabled: boolean
  /** Address of the local verifier service; only loopback addresses are accepted. */
  url: string
  /** A word is replaced when the model gives it at least this probability of being a name. */
  threshold: number
  /** Milliseconds to wait for the model; after that every word asked is replaced. */
  timeoutMs: number
}

/** Defaults: off, so sAI behaves as it did before the verifier existed. */
export const DEFAULT_VERIFIER: VerifierSettings = {
  enabled: false,
  url: 'http://127.0.0.1:8765/verify',
  threshold: 0.2,
  timeoutMs: 30_000,
}

/** One question: is the word used as a name in this text? */
export interface VerifierQuestion {
  /** The text around the word, cut so that the word appears in it only once. */
  readonly state: string
  /** The word as written. */
  readonly word: string
  /** Class of the vocabulary entry the word may stand for. */
  readonly classId: ClassId
  /** Declared spelling of that entry ("Bill Turner"), so the model knows which kind of name to look for. */
  readonly term: string
}

/** Reaches the model. One call carries every question of one request. */
export interface Verifier {
  /**
   * @param questions - every question of one request.
   * @returns for each question, in order, the probability that the word is used as a name.
   */
  verify(questions: readonly VerifierQuestion[]): Promise<readonly number[]>
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
 * The question for one dropped occurrence. Its text is the context around the word, at most
 * {@link CONTEXT_CHARS} of whole words on each side, cut so that the word appears in it only
 * once: another occurrence of the same word ("Reply to bill: Acme paid the bill.") is cut off,
 * at a sentence end between the two when there is one. Measured on the 824-case set, marking
 * the occurrence instead (⟪bill⟫) made the model's answers worse.
 * @param original - the whole text.
 * @param span - the occurrence.
 * @param term - declared spelling of its entry.
 * @returns the question.
 */
export function questionFor(original: string, span: Candidate, term: string): VerifierQuestion {
  const word = original.slice(span.start, span.end)
  let from = Math.max(0, span.start - CONTEXT_CHARS)
  let to = Math.min(original.length, span.end + CONTEXT_CHARS)
  // Never start or end inside a word.
  if (from > 0) { const space = original.slice(from, span.start).search(/\s/); from = space < 0 ? span.start : from + space + 1 }
  if (to < original.length) { const space = original.slice(span.end, to).search(/\s\S*$/); to = space < 0 ? span.end : span.end + space }

  // The nearest other occurrences of the same word, in any case.
  const lower = word.toLowerCase()
  const isWord = (at: number): boolean => original.slice(at, at + word.length).toLowerCase() === lower
    && !/[\p{L}\p{N}]/u.test(original[at - 1] ?? '') && !/[\p{L}\p{N}]/u.test(original[at + word.length] ?? '')
  let previous = -1
  for (let at = span.start - 1; at >= from; at--) if (isWord(at) && at + word.length <= span.start) { previous = at; break }
  let next = -1
  for (let at = span.end; at + word.length <= to; at++) if (isWord(at)) { next = at; break }

  if (previous >= 0) {
    // Start after the last sentence end between the two, or right after the other occurrence.
    const gap = original.slice(previous + word.length, span.start)
    const ends = [...gap.matchAll(SENTENCE_END)]
    from = previous + word.length + (ends.length > 0 ? ends.at(-1)!.index + ends.at(-1)![0].length : 0)
  }
  if (next >= 0) {
    // End at the first sentence end between the two, or right before the other occurrence.
    const gap = original.slice(span.end, next)
    const end = [...gap.matchAll(SENTENCE_END)][0]
    to = end === undefined ? next : span.end + end.index + end[0].length
  }
  // A piece cut after another occurrence may start with its punctuation (": Acme paid…").
  const state = original.slice(from, to).replace(/^[\s:;,.!?)\]”’-]+/u, '').trim()
  return { state, word, classId: span.classId, term }
}

/** @returns the identity of a question: equal questions are asked once and answered once. */
export function questionKey(question: VerifierQuestion): string {
  return `${question.classId}\u0000${question.term}\u0000${question.state}`
}

/** Anything that lists the questions of a text and records their answers (a {@link Session}). */
export interface Askable {
  questions(original: string): VerifierQuestion[]
  answer(questions: readonly VerifierQuestion[], probabilities: readonly number[]): void
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
    const probabilities = await verifier.verify(questions)
    if (probabilities.length !== questions.length) throw new Error('the verifier answered a different number of questions')
    session.answer(questions, probabilities)
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

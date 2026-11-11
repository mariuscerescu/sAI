/**
 * Search normalization: lowercase, diacritic-free, unified dashes and quotes,
 * collapsed whitespace. Terms and texts go through the same function, and the
 * position maps lead every match back to the untouched original.
 */

import type { NormalizedText } from './types.ts'

const DASHES = /[‐-―−﹘﹣－]/u
const QUOTES = /[‘’‚‛′`´]/u
const COMBINING = /\p{M}/gu
const WHITESPACE = /\s/u

/**
 * Normalize one code point for search.
 * @param char - one code point.
 * @returns its search form; empty for combining marks.
 */
function normalizeChar(char: string): string {
  if (DASHES.test(char)) return '-'
  if (QUOTES.test(char)) return '\''
  return char.normalize('NFD').replace(COMBINING, '').toLowerCase().normalize('NFD').replace(COMBINING, '')
}

/**
 * Whether a word opens a sentence, a line, a list item, or a quote, where keyboards and
 * writers capitalize every word, names or not.
 * @param original - the text as written.
 * @param at - start offset of the word.
 * @returns true when only punctuation, quotes, bullets, and spaces separate it from a sentence end or the text start.
 */
export function isSentenceStart(original: string, at: number): boolean {
  const before = original.slice(Math.max(0, at - 200), at).replace(/[ \t"'“”‘’«»„()[\]*_•–—-]+$/u, '')
  return (at <= 200 && before.length === 0) || /[.!?…:\n\r]$/u.test(before)
}

/**
 * Build the search view of a text.
 * @param original - the text as received.
 * @returns the normalized view and its position maps.
 */
export function normalize(original: string): NormalizedText {
  const out: string[] = []
  const starts: number[] = []
  const ends: number[] = []
  let index = 0
  for (const char of original) {
    const start = index
    index += char.length
    if (WHITESPACE.test(char)) {
      if (out.length > 0 && out[out.length - 1] === ' ') { ends[ends.length - 1] = index; continue }
      out.push(' '); starts.push(start); ends.push(index)
      continue
    }
    const mapped = normalizeChar(char)
    for (const unit of mapped) {
      for (let k = 0; k < unit.length; k++) {
        out.push(unit[k]!); starts.push(start); ends.push(index)
      }
    }
  }
  return { original, norm: out.join(''), startOf: Uint32Array.from(starts), endOf: Uint32Array.from(ends) }
}

/**
 * Normalize a vocabulary term or allowlist word, trimming collapsed edges.
 * @param term - user text.
 * @returns the search form.
 */
export function normalizeTerm(term: string): string {
  return normalize(term).norm.trim()
}

/**
 * Map a `[start, end)` range of the normalized view to the original text.
 * @param text - normalized view.
 * @param start - normalized start.
 * @param end - normalized end (exclusive, greater than start).
 * @returns the original range.
 */
export function toOriginalRange(text: NormalizedText, start: number, end: number): { start: number; end: number } {
  return { start: text.startOf[start]!, end: text.endOf[end - 1]! }
}

const WORD = /[\p{L}\p{N}]/u

/**
 * Whether `[start, end)` of `norm` is delimited by non-word characters.
 * @param norm - normalized text.
 * @param start - match start.
 * @param end - match end (exclusive).
 * @returns true when both edges are word boundaries.
 */
export function isWordBounded(norm: string, start: number, end: number): boolean {
  const before = start > 0 ? norm[start - 1]! : ''
  const after = end < norm.length ? norm[end]! : ''
  return !WORD.test(before) && !WORD.test(after)
}

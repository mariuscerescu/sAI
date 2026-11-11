/**
 * Token strategies: how symbols look, how they are found again in model
 * output, and how much of a streamed tail must be held back. Strategies are
 * interchangeable; everything else in the core is strategy-agnostic.
 */

import type { BlockCode, ClassId } from './types.ts'
import type { Vault } from './vault.ts'

/** One symbol occurrence found in model output. */
export interface TokenHit {
  readonly start: number
  readonly end: number
  /** Canonical spelling of the symbol. */
  readonly token: string
  readonly match: 'exact' | 'tolerant'
  readonly suspicious: boolean
}

/** A text range that already looks like a symbol and must be protected. */
export interface LiteralRange { readonly start: number; readonly end: number }

/** Per-session strategy state and behavior. */
export interface TokenStrategy {
  readonly id: string
  /**
   * Inspect a text before assignment (Greek excludes letters already in use).
   * @returns a block code when the text cannot be represented safely.
   */
  observe(text: string, vault: Vault): BlockCode | undefined
  /** Produce the next unused symbol for a class. */
  assign(classId: ClassId, vault: Vault): string
  /** Ranges of input text that look like this strategy's symbols. */
  literals(text: string, vault: Vault): LiteralRange[]
  /** Symbol occurrences in model output; only hits with a vault entry are restorable. */
  scan(text: string, vault: Vault): { hits: TokenHit[]; unknown: string[] }
  /** Code units at the end of a streamed buffer that may still become part of a symbol. */
  holdback(buffer: string): number
  /** Short model-facing explanation of the symbols. */
  preamble(): string
}

// ── typed ─────────────────────────────────────────────────────────────────

const TYPED_SCAN = /(\\?[[【⟦])\s*([A-Za-z][A-Za-z0-9_]*?)\s*\\?_\s*(\d+)\s*(\\?[\]】⟧])/g
const TYPED_LITERAL = /⟦[^⟧\n]{1,60}⟧|[[【]\s*[A-Za-z][A-Za-z0-9_]*_\d+\s*[\]】]/g
const TYPED_OPENERS = ['⟦', '[', '【', '\\']

/** `⟦CLASS_N⟧` symbols with a counter per class. */
export class TypedStrategy implements TokenStrategy {
  readonly id = 'typed'
  private readonly counters = new Map<ClassId, number>()

  observe(): undefined { return undefined }

  assign(classId: ClassId, vault: Vault): string {
    let next = (this.counters.get(classId) ?? 0) + 1
    while (vault.byToken(`⟦${classId}_${next}⟧`) !== undefined) next++
    this.counters.set(classId, next)
    return `⟦${classId}_${next}⟧`
  }

  literals(text: string): LiteralRange[] {
    return [...text.matchAll(TYPED_LITERAL)].map(match => ({ start: match.index, end: match.index + match[0].length }))
  }

  scan(text: string, vault: Vault): { hits: TokenHit[]; unknown: string[] } {
    const hits: TokenHit[] = []
    const unknown: string[] = []
    for (const match of text.matchAll(TYPED_SCAN)) {
      const token = `⟦${match[2]!.toUpperCase()}_${match[3]}⟧`
      const exact = match[0] === token
      if (vault.byToken(token) === undefined) {
        if (exact) unknown.push(token)
        continue
      }
      hits.push({ start: match.index, end: match.index + match[0].length, token, match: exact ? 'exact' : 'tolerant', suspicious: false })
    }
    return { hits, unknown }
  }

  holdback(buffer: string): number {
    const window = 64
    const from = Math.max(0, buffer.length - window)
    for (let i = buffer.length - 1; i >= from; i--) {
      const char = buffer[i]!
      if (char === '⟧' || char === ']' || char === '】' || char === '\n') return 0
      if (TYPED_OPENERS.includes(char)) return buffer.length - i
    }
    return 0
  }

  preamble(): string {
    return 'Some values in this conversation were replaced with placeholders of the form ⟦CLASS_N⟧ '
      + '(for example ⟦PERSON_1⟧) to protect confidential data. Treat each placeholder as the real value it stands for. '
      + 'Whenever you refer to it, write the placeholder exactly as given, including the ⟦ ⟧ brackets, '
      + 'also inside code, file paths, and tool-call arguments. Never guess what a placeholder stands for.'
  }
}

// ── greek ─────────────────────────────────────────────────────────────────

const GREEK_POOL = [...'αβγδεζηθικλμνξοπρστυφχψω']
const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉'
const GREEK_LETTER = /\p{Script=Greek}/u
const LETTER_OR_MARK = /[\p{L}\p{M}]/u
const MATH_NEIGHBOR = /[=+*/^<>≤≥×÷∑∫\d]/u
const GREEK_SCAN = /\p{Script=Greek}[₀-₉]*/gu
const MIN_FREE_LETTERS = 4

function subscript(n: number): string {
  return [...String(n)].map(digit => SUBSCRIPTS[Number(digit)]).join('')
}

function nearestNonSpace(text: string, from: number, step: -1 | 1): string {
  for (let i = from; i >= 0 && i < text.length; i += step) if (text[i] !== ' ') return text[i]!
  return ''
}

/**
 * Isolated Greek letters from a per-session random permutation; letters the
 * text already uses are excluded so they cannot be confused with symbols.
 */
export class GreekStrategy implements TokenStrategy {
  readonly id = 'greek'
  private readonly order: string[]
  private cursor = 0
  private readonly excluded = new Set<string>()

  /** @param random - uniform [0, 1) source used to shuffle the pool once. */
  constructor(random: () => number) {
    this.order = [...GREEK_POOL]
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[this.order[i], this.order[j]] = [this.order[j]!, this.order[i]!]
    }
  }

  observe(text: string, vault: Vault): BlockCode | undefined {
    for (const char of text) {
      if (!GREEK_LETTER.test(char)) continue
      const lower = char.toLowerCase()
      if (GREEK_POOL.includes(lower) && vault.byToken(lower) === undefined) this.excluded.add(lower)
    }
    return GREEK_POOL.length - this.excluded.size < MIN_FREE_LETTERS ? 'STRATEGY_UNSUITABLE' : undefined
  }

  assign(_classId: ClassId, vault: Vault): string {
    while (true) {
      const letter = this.order[this.cursor % this.order.length]!
      const round = Math.floor(this.cursor / this.order.length)
      this.cursor++
      if (this.excluded.has(letter)) continue
      const token = round === 0 ? letter : `${letter}${subscript(round + 1)}`
      if (vault.byToken(token) === undefined) return token
    }
  }

  literals(text: string, vault: Vault): LiteralRange[] {
    return this.isolated(text)
      .filter(found => vault.byToken(found.token) !== undefined)
      .map(found => ({ start: found.start, end: found.end }))
  }

  scan(text: string, vault: Vault): { hits: TokenHit[]; unknown: string[] } {
    const hits: TokenHit[] = []
    for (const found of this.isolated(text)) {
      if (vault.byToken(found.token) === undefined) continue
      const suspicious = MATH_NEIGHBOR.test(nearestNonSpace(text, found.start - 1, -1))
        || MATH_NEIGHBOR.test(nearestNonSpace(text, found.end, 1))
      hits.push({ ...found, match: found.raw === found.token ? 'exact' : 'tolerant', suspicious })
    }
    return { hits, unknown: [] }
  }

  holdback(buffer: string): number {
    let i = buffer.length
    while (i > 0 && SUBSCRIPTS.includes(buffer[i - 1]!)) i--
    if (i > 0 && GREEK_LETTER.test(buffer[i - 1]!)) return buffer.length - i + 1
    return 0
  }

  preamble(): string {
    return 'Some confidential terms in this conversation were replaced with isolated Greek letters such as β or κ '
      + '(possibly with a subscript, such as α₂). Treat each such letter as the real term it stands for. '
      + 'Whenever you refer to it, write the letter exactly as given, also inside code, file paths, and tool-call arguments. '
      + 'Do not translate or spell out these letters, and do not use them with any other meaning.'
  }

  /** Greek letters (with optional subscripts) not touching other letters. */
  private isolated(text: string): { start: number; end: number; token: string; raw: string }[] {
    const found: { start: number; end: number; token: string; raw: string }[] = []
    for (const match of text.matchAll(GREEK_SCAN)) {
      const start = match.index
      const end = start + match[0].length
      if (start > 0 && LETTER_OR_MARK.test(text[start - 1]!)) continue
      if (end < text.length && LETTER_OR_MARK.test(text[end]!)) continue
      const raw = match[0]
      found.push({ start, end, raw, token: raw[0]!.toLowerCase() + raw.slice(1) })
    }
    return found
  }
}

/**
 * Create a strategy instance for one session.
 * @param id - strategy id.
 * @param random - uniform [0, 1) source; deterministic sources make tests and restarts repeatable.
 * @returns a fresh strategy state.
 */
export function createStrategy(id: string, random: () => number): TokenStrategy {
  switch (id) {
    case 'typed': return new TypedStrategy()
    case 'greek': return new GreekStrategy(random)
    default: throw new Error(`unknown token strategy "${id}"`)
  }
}

/**
 * The preamble a strategy sends when the user has not written one.
 * @param id - strategy id.
 * @returns the built-in model-facing explanation.
 */
export function defaultPreamble(id: string): string {
  return createStrategy(id, () => 0).preamble()
}

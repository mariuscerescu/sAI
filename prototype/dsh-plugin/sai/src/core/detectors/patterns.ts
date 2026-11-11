/**
 * Shape detectors for identifiers with a recognizable form. Each pattern is a
 * regular expression over the normalized view, an optional validator that
 * filters (never scores) matches, a canonicalizer that defines entity
 * identity, and context words that raise the confidence.
 */

import { normalizeTerm, toOriginalRange } from '../normalize.ts'
import type { Candidate, ClassId, NormalizedText } from '../types.ts'

/** Priority shared by pattern findings. */
export const PATTERN_PRIORITY = 200

/** One pattern detector definition. */
export interface PatternSpec {
  readonly id: string
  readonly classId: ClassId
  /** Global regular expression run on the normalized view. */
  readonly regex: RegExp
  readonly validate?: (match: string) => boolean
  /** On a failed check, retry the match without its trailing space-separated groups. */
  readonly shrink?: boolean
  readonly canonical: (match: string) => string
  readonly context: readonly string[]
  readonly base: number
  readonly withContext: number
}

const digitsOf = (text: string): string => text.replace(/\D/g, '')

/**
 * Moldovan IDNP/IDNO control digit: weights 7,3,1 over the first 12 digits.
 * @param value - matched text.
 * @returns whether the 13th digit matches.
 */
export function checksum731(value: string): boolean {
  const digits = digitsOf(value)
  if (digits.length !== 13) return false
  const weights = [7, 3, 1]
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * weights[i % 3]!
  return sum % 10 === Number(digits[12])
}

/**
 * Romanian CNP control digit.
 * @param value - matched text.
 * @returns whether the 13th digit matches and the sex/century digit is plausible.
 */
export function checksumCnp(value: string): boolean {
  const digits = digitsOf(value)
  if (digits.length !== 13 || digits[0] === '0' || digits[0] === '9') return false
  const weights = '279146358279'
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * Number(weights[i])
  const control = sum % 11 === 10 ? 1 : sum % 11
  return control === Number(digits[12])
}

/**
 * Luhn checksum used by payment cards.
 * @param value - matched text.
 * @returns whether the digits pass Luhn.
 */
export function luhn(value: string): boolean {
  const digits = digitsOf(value)
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9 }
    sum += digit
  }
  return sum % 10 === 0
}

/**
 * IBAN mod-97 check.
 * @param value - matched text.
 * @returns whether the IBAN is valid.
 */
export function ibanMod97(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const code = char >= 'A' ? String(char.charCodeAt(0) - 55) : char
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

/**
 * US Social Security number rules: area not 000, 666, or 9xx; group not 00; serial not 0000;
 * both separators alike.
 * @param value - matched text.
 * @returns whether the number can be a real SSN.
 */
export function validSsn(value: string): boolean {
  const separators = value.replace(/\d/g, '')
  if (separators.length !== 2 || separators[0] !== separators[1]) return false
  const digits = digitsOf(value)
  const area = digits.slice(0, 3)
  return area !== '000' && area !== '666' && !area.startsWith('9') && digits.slice(3, 5) !== '00' && digits.slice(5) !== '0000'
}

/**
 * North American numbering plan: ten digits (after an optional country code 1) whose
 * area code and exchange both start with 2–9.
 * @param value - matched text.
 * @returns whether the number is a possible US or Canadian phone number.
 */
export function validNanp(value: string): boolean {
  let digits = digitsOf(value)
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  return digits.length === 10 && /^[2-9]\d{2}[2-9]/.test(digits)
}

/** UK national number (without the leading 0 or +44), or undefined when the shape is wrong. */
function ukNational(value: string): string | undefined {
  const compact = value.replace(/\(0\)/, '').replace(/\D/g, '')
  const national = compact.startsWith('44') && value.trim().startsWith('+') ? compact.slice(2) : compact.replace(/^0/, '')
  return national.length === 10 && /^[1237]/.test(national) ? national : undefined
}

/**
 * UK National Insurance number rules: two prefix letters (first not D, F, I, Q, U, V;
 * second not D, F, I, O, Q, U, V; not BG, GB, KN, NK, NT, TN, ZZ), six digits, suffix A–D.
 * @param value - matched text.
 * @returns whether the number can be a real NINO.
 */
export function validNino(value: string): boolean {
  const compact = value.replace(/\s/g, '').toUpperCase()
  if (!/^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/.test(compact)) return false
  return !['BG', 'GB', 'KN', 'NK', 'NT', 'TN', 'ZZ'].includes(compact.slice(0, 2))
}

function phoneCanonical(country: string) {
  return (text: string): string => {
    const digits = digitsOf(text)
    return `+${country}${digits.startsWith(country) ? digits.slice(country.length) : digits.replace(/^0/, '')}`
  }
}

/** Every shipped pattern, keyed by id. */
export const PATTERNS: Readonly<Record<string, PatternSpec>> = {
  'idnp': {
    id: 'idnp', classId: 'IDNP', regex: /(?<![a-z0-9])\d{13}(?![a-z0-9])/g, validate: checksum731, canonical: digitsOf,
    context: ['idnp', 'idno', 'cod personal', 'numar de identificare', 'cod fiscal'], base: 0.9, withContext: 1,
  },
  'cnp': {
    id: 'cnp', classId: 'CNP', regex: /(?<![a-z0-9])[1-8]\d{12}(?![a-z0-9])/g, validate: checksumCnp, canonical: digitsOf,
    context: ['cnp', 'cod numeric personal'], base: 0.9, withContext: 1,
  },
  'phone-md': {
    id: 'phone-md', classId: 'PHONE', regex: /(?<![a-z0-9+])(?:\+?373[ .-]?|0)\d{2}[ .-]?\d{3}[ .-]?\d{3}(?![a-z0-9])/g,
    canonical: phoneCanonical('373'), context: ['tel', 'telefon', 'mobil', 'nr', 'numar', 'contact', 'suna'], base: 0.85, withContext: 1,
  },
  'phone-ro': {
    id: 'phone-ro', classId: 'PHONE', regex: /(?<![a-z0-9+])(?:\+?40[ .-]?|0)7\d{2}[ .-]?\d{3}[ .-]?\d{3}(?![a-z0-9])/g,
    canonical: phoneCanonical('40'), context: ['tel', 'telefon', 'mobil', 'nr', 'numar', 'contact', 'suna'], base: 0.85, withContext: 1,
  },
  'iban': {
    // Compact, or printed in groups of four; a failed check retries without trailing groups.
    id: 'iban', classId: 'IBAN', validate: ibanMod97, shrink: true,
    regex: /(?<![a-z0-9])[a-z]{2}\d{2}(?:[a-z0-9]{11,30}|(?: [a-z0-9]{4}){2,7}(?: [a-z0-9]{1,4})?)(?![a-z0-9])/g,
    canonical: text => text.replace(/\s/g, '').toUpperCase(), context: ['iban', 'cont'], base: 0.95, withContext: 1,
  },
  'card': {
    id: 'card', classId: 'CARD', regex: /(?<![a-z0-9])\d(?:[ -]?\d){14,18}(?![a-z0-9])/g, validate: luhn, canonical: digitsOf,
    context: ['card', 'visa', 'mastercard', 'plata'], base: 0.85, withContext: 1,
  },
  'email': {
    id: 'email', classId: 'EMAIL', regex: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, canonical: text => text,
    context: [], base: 0.95, withContext: 0.95,
  },
  'ssn-us': {
    id: 'ssn-us', classId: 'SSN', regex: /(?<![a-z0-9-])\d{3}[- ]\d{2}[- ]\d{4}(?![a-z0-9-])/g, validate: validSsn, canonical: digitsOf,
    context: ['ssn', 'social security'], base: 0.9, withContext: 1,
  },
  'phone-us': {
    // Separators are required, so bare ten-digit numbers (order ids, Romanian mobiles) are left alone.
    id: 'phone-us', classId: 'PHONE', validate: validNanp,
    regex: /(?<![a-z0-9+])(?:\+?1[ .-]?)?(?:\(\d{3}\) ?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![a-z0-9])/g,
    canonical: text => `+1${digitsOf(text).slice(-10)}`, context: ['phone', 'tel', 'call', 'mobile', 'cell', 'contact'], base: 0.85, withContext: 1,
  },
  'phone-uk': {
    id: 'phone-uk', classId: 'PHONE', validate: text => ukNational(text) !== undefined,
    regex: /(?<![a-z0-9+])(?:\+44 ?(?:\(0\) ?)?|0)(?:\d[ -]?){9}\d(?![a-z0-9])/g,
    canonical: text => `+44${ukNational(text) ?? digitsOf(text)}`, context: ['phone', 'tel', 'call', 'mobile', 'contact'], base: 0.85, withContext: 1,
  },
  'nino-uk': {
    id: 'nino-uk', classId: 'NINO', regex: /(?<![a-z0-9])[a-z]{2} ?\d{2} ?\d{2} ?\d{2} ?[a-d](?![a-z0-9])/g, validate: validNino,
    canonical: text => text.replace(/\s/g, '').toUpperCase(), context: ['national insurance', 'nino', 'ni number'], base: 0.85, withContext: 1,
  },
  'ipv4': {
    id: 'ipv4', classId: 'IP', regex: /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g,
    validate: text => text.split('.').every(part => Number(part) <= 255), canonical: text => text,
    context: ['ip', 'server', 'adresa'], base: 0.8, withContext: 0.95,
  },
}

/** Characters around a match searched for context words. */
const CONTEXT_WINDOW = 30

/** Runs one pattern over the normalized view. */
export class PatternDetector {
  readonly id: string
  private readonly context: readonly string[]

  /** @param spec - the pattern definition. */
  constructor(private readonly spec: PatternSpec) {
    this.id = `pattern:${spec.id}`
    this.context = spec.context.map(normalizeTerm)
  }

  /**
   * Find validated matches.
   * @param text - normalized view.
   * @returns candidates in the original text.
   */
  detect(text: NormalizedText): Candidate[] {
    const found: Candidate[] = []
    for (const match of text.norm.matchAll(new RegExp(this.spec.regex.source, 'gu'))) {
      const value = this.validPrefix(match[0])
      if (value === undefined) continue
      const at = match.index
      const window = text.norm.slice(Math.max(0, at - CONTEXT_WINDOW), Math.min(text.norm.length, at + value.length + CONTEXT_WINDOW))
      const hasContext = this.context.some(word => window.includes(word))
      found.push({
        ...toOriginalRange(text, at, at + value.length),
        classId: this.spec.classId,
        detector: this.id,
        priority: PATTERN_PRIORITY,
        confidence: hasContext ? this.spec.withContext : this.spec.base,
        key: { kind: 'canonical', classId: this.spec.classId, value: this.spec.canonical(value) },
      })
    }
    return found
  }

  /** The match itself when valid, else (with `shrink`) its longest valid prefix ending before a space. */
  private validPrefix(match: string): string | undefined {
    const validate = this.spec.validate
    if (validate === undefined || validate(match)) return match
    if (this.spec.shrink !== true) return undefined
    for (let end = match.lastIndexOf(' '); end > 0; end = match.lastIndexOf(' ', end - 1)) {
      const prefix = match.slice(0, end)
      if (validate(prefix)) return prefix
    }
    return undefined
  }
}

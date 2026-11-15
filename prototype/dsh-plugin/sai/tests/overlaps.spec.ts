/**
 * A finding that wholly contains another wins over it whatever their priorities: a
 * vocabulary word inside an e-mail address, IBAN, or phone number must not leave the
 * rest of that value in clear. Symbol-like input (LITERAL) always wins.
 */
import { describe, expect, it } from 'vitest'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'

const VOCABULARY: VocabularyEntry[] = [
  { id: 'p', class: 'PERSON', terms: ['Ion Rusu'] },
  { id: 'a', class: 'COMPANY', terms: ['Acme Logistics Inc.'] },
  { id: 'k', class: 'CONTRACT', terms: ['1310 4168'] },
  { id: 'l', class: 'PROJECT', terms: ['123 456'] },
]
const engine = new Engine({ vocabulary: VOCABULARY })

describe('a value that contains a vocabulary term', () => {
  it.each([
    ['Scrie la ion.rusu@acme.md azi.', 'Scrie la ⟦EMAIL_1⟧ azi.'],
    ['Write to Acme@example.com today.', 'Write to ⟦EMAIL_1⟧ today.'],
    ['Contul MD24 AG00 0225 1000 1310 4168 e activ.', 'Contul ⟦IBAN_1⟧ e activ.'],
    ['Sună la +373 69 123 456 mâine.', 'Sună la ⟦PHONE_1⟧ mâine.'],
  ])('replaces the whole value: %s', (text, expected) => {
    const session = engine.session()
    const out = session.redact(text)
    expect(out.verdict.kind).toBe('proceed')
    expect(out.text).toBe(expected)
    expect(session.restore(out.text).text).toBe(text)
  })

  it('still replaces the term where it stands alone', () => {
    const session = engine.session()
    const out = session.redact('Acme a scris de pe acme@example.com.')
    expect(out.text).toBe('⟦COMPANY_1⟧ a scris de pe ⟦EMAIL_1⟧.')
    expect(session.restore(out.text).text).toBe('Acme a scris de pe acme@example.com.')
  })
})

describe('findings that only partly overlap', () => {
  it('keep the priority order, and nothing is left in clear', () => {
    const shared = new Engine({ vocabulary: [...VOCABULARY, { id: 'r', class: 'COMPANY', terms: ['Rusu Construct SRL'] }] })
    expect(shared.session().redact('Ion Rusu Construct a semnat.').text).toBe('⟦PERSON_1⟧ ⟦COMPANY_1⟧ a semnat.')
  })
})

describe('symbol-like input', () => {
  it('wins over a vocabulary term inside it', () => {
    const session = new Engine({ vocabulary: [{ id: 'x', class: 'COMPANY', terms: ['Person'] }] }).session()
    const out = session.redact('Câmpul ⟦PERSON_1⟧ e gol, iar Person a răspuns.')
    expect(out.text).toBe('Câmpul ⟦LITERAL_1⟧ e gol, iar ⟦COMPANY_1⟧ a răspuns.')
    expect(session.restore(out.text).text).toBe('Câmpul ⟦PERSON_1⟧ e gol, iar Person a răspuns.')
  })
})

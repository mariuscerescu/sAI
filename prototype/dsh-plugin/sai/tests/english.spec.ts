/**
 * English support: the English language pack (family plural, titles, legal forms),
 * the capital-letter rule, and the US/UK identifier patterns.
 */
import { describe, expect, it } from 'vitest'
import {
  capitalizesNames, Engine, englishWordForms, normalizeTerm, PATTERNS, type VocabularyEntry,
} from '../src/core/index.ts'
import { PatternDetector, validNanp, validNino, validSsn } from '../src/core/detectors/patterns.ts'
import { normalize } from '../src/core/normalize.ts'

import { ENGLISH_CASES } from './fixtures/english-vocabulary.ts'

const vocabulary: VocabularyEntry[] = ENGLISH_CASES.map(c => ({ id: c.id, class: c.cls, terms: [c.term] }))
const NOT_NAMES = new Set(['mr', 'mrs', 'ms', 'dr', 'sir', 'inc', 'ltd', 'llc', 'corp', 'plc', 'llp', 'gmbh', 'corporation', 'project', 'operation'])

describe.each([['en'], ['ro', 'en']])('English sentences with languages %s', (...languages) => {
  const engine = new Engine({ vocabulary, patterns: [], languages })
  const sentences = ENGLISH_CASES.flatMap(c => c.sentences.map(sentence => [c.id, sentence, c] as const))

  it('has about 150 sentences', () => { expect(sentences.length).toBeGreaterThanOrEqual(140) })

  it.each(sentences)('%s · %s', (_id, sentence, entry) => {
    const session = engine.session()
    const out = session.redact(sentence)
    expect(out.decisions).toHaveLength(1)
    const { span, action } = out.decisions[0]!
    expect(action).toBe('tokenize')
    if (span.key.kind === 'entry') expect(span.key.entryId).toBe(entry.id)
    else expect(span.key.kind).toBe('canonical')
    // No word of the name is left in what the model receives.
    const sent = normalizeTerm(out.text)
    for (const word of normalizeTerm(entry.term).split(' ')) {
      const bare = word.replace(/\.$/, '')
      if (bare.length < 3 || NOT_NAMES.has(bare)) continue
      expect(sent).not.toMatch(new RegExp(`(?<![\\p{L}'])${bare.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u'))
    }
    // The restored text names the entity again.
    const restored = normalizeTerm(session.restore(out.text).text)
    expect(normalizeTerm(entry.term).split(' ').some(word => restored.includes(word))).toBe(true)
  })
})

describe('language packs', () => {
  const people: VocabularyEntry[] = [{ id: 'a', class: 'PERSON', terms: ['Ann Green'] }, { id: 'd', class: 'PERSON', terms: ['Dan Brown'] }, { id: 'i', class: 'PERSON', terms: ['Ion Rusu'] }]

  it('applies Romanian forms only when Romanian is enabled', () => {
    const english = new Engine({ vocabulary: people, patterns: [], languages: ['en'] })
    expect(english.session().redact('Anne met a Dane.').decisions).toHaveLength(0)
    expect(english.session().redact('Ioane, vino.').decisions).toHaveLength(0)
    const both = new Engine({ vocabulary: people, patterns: [], languages: ['ro', 'en'] })
    expect(both.session().redact('Ioane, vino.').decisions).toHaveLength(1)
  })

  it('applies the English plural only when English is enabled', () => {
    const romanian = new Engine({ vocabulary: people, patterns: [], languages: ['ro'] })
    expect(romanian.session().redact('We met the Greens.').decisions).toHaveLength(0)
    const english = new Engine({ vocabulary: people, patterns: [], languages: ['en'] })
    expect(english.session().redact('We met the Greens.').decisions).toHaveLength(1)
  })

  it('makes the family plural', () => {
    expect(englishWordForms('smith')).toEqual(['smith', 'smiths'])
    expect(englishWordForms('jones')).toEqual(['jones', 'joneses'])
    expect(englishWordForms('walsh')).toEqual(['walsh', 'walshes'])
    expect(englishWordForms('ltd')).toEqual(['ltd'])
  })

  it('drops the legal form of a company name in both languages', () => {
    const engine = new Engine({ patterns: [], vocabulary: [{ id: 'r', class: 'COMPANY', terms: ['SC Acme Logistic S.R.L.'] }] })
    const session = engine.session()
    const out = session.redact('Contractul cu Acme Logistic e semnat.')
    expect(out.decisions).toHaveLength(1)
    expect(session.restore(out.text).text).toBe('Contractul cu Acme Logistic e semnat.')
  })

  it('treats unknown languages as a settings problem', () => {
    const engine = new Engine({ languages: ['xx'] })
    expect(engine.problems).toContain('unknown language "xx"')
    expect(engine.settings.languages).toEqual(['ro', 'en'])
  })

  it.each([
    ['czech', 'czechs'], ['church', 'churches'], ['wolf', 'wolves'], ['knife', 'knives'], ['chief', 'chiefs'],
    ['hero', 'heroes'], ['photo', 'photos'], ['congressman', 'congressmen'], ['german', 'germans'],
  ])('forms the plural of %s: %s', (word, plural) => {
    expect(englishWordForms(word)).toContain(plural)
  })

  it('never turns a name into another name with a Latin or Greek plural', () => {
    expect(englishWordForms('francis')).not.toContain('frances')
    expect(englishWordForms('simon')).not.toContain('sima')
    expect(englishWordForms('marcus')).not.toContain('marci')
  })

  it('forms the -ies plural of a consonant + y, and keeps the family -ys', () => {
    expect(englishWordForms('industry')).toEqual(['industry', 'industrys', 'industries'])
    expect(englishWordForms('kennedy')).toContain('kennedys')
    expect(englishWordForms('day')).toEqual(['day', 'days'])
    const engine = new Engine({ patterns: [], languages: ['en'], vocabulary: [{ id: 'u', class: 'ORGANIZATION', terms: ['Northfield University'] }] })
    expect(engine.session().redact('Both Northfield Universities closed.').text).toBe('Both ⟦ORGANIZATION_1⟧ closed.')
  })
})

describe('capital letters', () => {
  it.each([
    ['i talked to smith', false], ['I talked to smith.', false], ['Am vorbit cu popescului.', false],
    ['Hello. Then smith left.', false], ['- First item\n- Second item', false], ['NATO and the EU met.', false],
    ['I talked to Smith.', true], ['Am vorbit cu Ion ieri.', true], ['"Quoted" and then Paris.', true],
  ] as const)('%j writes names with capitals: %s', (text, expected) => {
    expect(capitalizesNames(text)).toBe(expected)
  })

  it('reads a sentence-initial capital as the keyboard\'s, not the writer\'s', () => {
    const engine = new Engine({ patterns: [], vocabulary: [{ id: 's', class: 'PERSON', terms: ['John Smith'] }] })
    expect(engine.session().redact('I talked to smith yesterday.').decisions).toHaveLength(1)
    // A first name alone needs its capital: "will", "mark" and "grace" are usually ordinary words.
    const will = new Engine({ patterns: [], vocabulary: [{ id: 'w', class: 'PERSON', terms: ['Will Turner'] }] })
    expect(will.session().redact('I will call you.').decisions).toHaveLength(0)
    expect(will.session().redact('Will called me.').decisions).toHaveLength(1)
  })
})

describe('US and UK identifiers', () => {
  const find = (id: string, text: string): string[] => new PatternDetector(PATTERNS[id]!).detect(normalize(text)).map(c => text.slice(c.start, c.end))

  it('finds valid SSNs only', () => {
    expect(find('ssn-us', 'SSN 123-45-6789 and 234 56 7890.')).toEqual(['123-45-6789', '234 56 7890'])
    for (const bad of ['000-12-3456', '666-12-3456', '912-34-5678', '123-00-4567', '123-45-0000', '123-45 6789']) expect(validSsn(bad)).toBe(false)
    expect(find('ssn-us', 'tel 069 123 456, IDNP 2001234567891')).toEqual([])
  })

  it('finds US and Canadian phone numbers', () => {
    expect(find('phone-us', 'Call (212) 555-0143 or +1 415 555 0198 or 646.555.0123.')).toEqual(['(212) 555-0143', '+1 415 555 0198', '646.555.0123'])
    expect(validNanp('123-456-7890')).toBe(false)
    expect(find('phone-us', 'Sună la 0722 123 456 sau +373 69 123 456.')).toEqual([])
  })

  it('finds UK phone numbers', () => {
    expect(find('phone-uk', 'Ring 020 7946 0958, 07700 900123, +44 (0)20 7946 0958 or +447700900123.'))
      .toEqual(['020 7946 0958', '07700 900123', '+44 (0)20 7946 0958', '+447700900123'])
    expect(find('phone-uk', 'Sună la 0722 123 456 sau 069123456.')).toEqual([])
  })

  it('finds valid National Insurance numbers', () => {
    expect(find('nino-uk', 'NI number AB 12 34 56 C and JG103759A.')).toEqual(['AB 12 34 56 C', 'JG103759A'])
    for (const bad of ['QQ123456C', 'GB123456A', 'AB123456E', 'DA123456A']) expect(validNino(bad)).toBe(false)
  })

  it('protects them end to end with the default settings', () => {
    const session = new Engine({}).session()
    const out = session.redact('SSN 123-45-6789, phone (212) 555-0143, UK 07700 900123, NI AB 12 34 56 C.')
    expect(out.text).not.toMatch(/\d{3}|AB 12/)
    expect(session.restore(out.text).text).toContain('123-45-6789')
  })
})

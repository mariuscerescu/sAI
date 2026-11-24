import { describe, expect, it } from 'vitest'
import { Engine, type SaiSettings } from '../src/core/index.ts'

const VOCABULARY: SaiSettings['vocabulary'] = [
  { id: 'p1', class: 'PERSON', terms: ['Nadia Vantoor'] },
  { id: 'c1', class: 'COMPANY', terms: ['Quillon Systems'] },
]
const engine = (vocabulary = VOCABULARY, languages = ['en']): Engine => new Engine({ vocabulary, languages })

describe('every written form of a name comes back as written', () => {
  it('gives a first name and a surname of one person related symbols', () => {
    const session = engine().session()
    const { text } = session.redact('Nadia called, and then Vantoor replied.')
    expect(text).toBe('⟦PERSON_1⟧ called, and then ⟦PERSON_1_2⟧ replied.')
    expect(session.restore(text).text).toBe('Nadia called, and then Vantoor replied.')
  })

  it('keeps the full name and each part apart', () => {
    const session = engine().session()
    const original = 'Nadia Vantoor signed. Nadia paid, and then Vantoor left.'
    const { text } = session.redact(original)
    expect(text).toBe('⟦PERSON_1⟧ signed. ⟦PERSON_1_2⟧ paid, and then ⟦PERSON_1_3⟧ left.')
    expect(session.restore(text).text).toBe(original)
  })

  it('keeps a company name and its short form apart', () => {
    const session = engine().session()
    const original = 'Quillon Systems wrote. We replied to Quillon.'
    const { text } = session.redact(original)
    expect(text).toBe('⟦COMPANY_1⟧ wrote. We replied to ⟦COMPANY_1_2⟧.')
    expect(session.restore(text).text).toBe(original)
  })

  it('keeps the case the name was written in', () => {
    const session = engine([{ id: 'p', class: 'PERSON', terms: ['John Smith'] }]).session()
    const original = 'i talked to smith today'
    const { text } = session.redact(original)
    expect(text).toBe('i talked to ⟦PERSON_1⟧ today')
    expect(session.restore(text).text).toBe(original)
  })

  it('still restores an inflected form as the declared spelling', () => {
    const session = engine([{ id: 'p', class: 'PERSON', terms: ['Ion Popescu'] }], ['ro']).session()
    const { text } = session.redact('Contractul lui Popescului este gata.')
    expect(session.restore(text).text).toBe('Contractul lui Popescu este gata.')
  })

  it('uses the same symbol for the same form in later texts', () => {
    const session = engine().session()
    session.redact('Nadia called, and then Vantoor replied.')
    expect(session.redact('Nadia stayed, and then Vantoor left.').text).toBe('⟦PERSON_1⟧ stayed, and then ⟦PERSON_1_2⟧ left.')
  })

  it('reads a related symbol written loosely by the model', () => {
    const session = engine().session()
    session.redact('Nadia called, and then Vantoor replied.')
    expect(session.restore('Ask [person_1_2] and ⟦PERSON_1⟧.').text).toBe('Ask Vantoor and Nadia.')
  })

  it('restores a related symbol cut between stream chunks', () => {
    const session = engine().session()
    session.redact('Nadia called, and then Vantoor replied.')
    const stream = session.streamRestorer()
    const out = stream.push('Ask ⟦PERSON_1') + stream.push('_2⟧ now') + stream.flush()
    expect(out).toBe('Ask Vantoor now')
  })

  it('applies the chosen restore spelling to every form of the entry', () => {
    const session = engine([{ id: 'p', class: 'PERSON', terms: ['Nadia Vantoor'], restoreAs: 'Dr. Vantoor' }]).session()
    const { text } = session.redact('Nadia called, and then Vantoor replied.')
    expect(session.restore(text).text).toBe('Dr. Vantoor called, and then Dr. Vantoor replied.')
  })

  it('reports the symbols it used', () => {
    const session = engine().session()
    expect(session.redact('Nadia called, and then Vantoor replied.').report.tokensUsed).toEqual(['⟦PERSON_1⟧', '⟦PERSON_1_2⟧'])
  })

  it('tells the model that related symbols are the same value', () => {
    expect(engine().session().preamble()).toContain('⟦PERSON_1_2⟧')
    expect(engine().session({ strategy: 'greek' }).preamble()).toContain('β′')
    for (const strategy of ['typed', 'greek'] as const) {
      expect(engine().session({ strategy }).preamble()).toContain('Do not mention or explain this relation unless the user asks')
    }
  })
})

describe('written forms with Greek symbols', () => {
  const greek = () => engine().session({ strategy: 'greek', random: () => 0 })

  it('marks another form of the same value with a prime and restores it', () => {
    const session = greek()
    const original = 'Nadia called, and then Vantoor replied.'
    const { text } = session.redact(original)
    const [first, second] = text.match(/\p{Script=Greek}[₀-₉]*′*/gu)!
    expect(second).toBe(`${first}′`)
    expect(session.restore(text).text).toBe(original)
  })

  it('restores a prime symbol cut between stream chunks', () => {
    const session = greek()
    const { text } = session.redact('Nadia called, and then Vantoor replied.')
    const symbol = text.match(/\p{Script=Greek}′/u)![0]
    const stream = session.streamRestorer()
    const out = stream.push(`Ask ${symbol[0]}`) + stream.push('′ now') + stream.flush()
    expect(out).toBe('Ask Vantoor now')
  })
})

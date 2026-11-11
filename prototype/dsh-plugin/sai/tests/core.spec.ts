import { describe, expect, it } from 'vitest'
import { checksum731, checksumCnp, Engine, ibanMod97, luhn, RedactionBatch, type SaiSettings } from '../src/core/index.ts'

const VOCABULARY: SaiSettings['vocabulary'] = [
  { id: 'pers_ion', class: 'PERSON', terms: ['Ion Popescu', 'Popescu', 'dl. Popescu'] },
  { id: 'acme', class: 'COMPANY', terms: ['Acme Logistic SRL', 'Acme Logistic', 'Acme'] },
]

const TEXT = 'Dl. Popescu de la Acme a sunat de pe 069123456. IDNP: 2001234567891. Maria Rusu confirmă.'

/** Deterministic uniform source for the Greek permutation. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('validators', () => {
  it('accepts valid and rejects altered identifiers', () => {
    expect(checksum731('2001234567891')).toBe(true)
    expect(checksum731('2001234567890')).toBe(false)
    expect(checksumCnp('1800101420010')).toBe(true)
    expect(luhn('4111 1111 1111 1111')).toBe(true)
    expect(ibanMod97('MD24 AG00 0225 1000 1310 4168')).toBe(true)
    expect(ibanMod97('MD25 AG00 0225 1000 1310 4168')).toBe(false)
  })
})

describe('typed strategy', () => {
  it('redacts the running example and restores the answer', () => {
    const session = new Engine({ vocabulary: VOCABULARY }).session()
    const out = session.redact(TEXT)
    expect(out.verdict).toEqual({ kind: 'proceed' })
    expect(out.text).toBe('⟦PERSON_1⟧ de la ⟦COMPANY_1⟧ a sunat de pe ⟦PHONE_1⟧. IDNP: ⟦IDNP_1⟧. ⟦PERSON_2⟧ confirmă.')
    expect(out.report.countsByClass).toEqual({ PERSON: 2, COMPANY: 1, PHONE: 1, IDNP: 1 })

    const restored = session.restore('Am notat: ⟦PERSON_1⟧ de la ⟦COMPANY_1⟧ revine la [PHONE_1]. Verific și ⟦PERSON_7⟧.')
    expect(restored.text).toBe('Am notat: Dl. Popescu de la Acme revine la 069123456. Verific și ⟦PERSON_7⟧.')
    expect(restored.report).toEqual({ restored: 3, tolerantMatches: ['⟦PHONE_1⟧'], unknownTokens: ['⟦PERSON_7⟧'], suspicious: [] })
  })

  it('reuses symbols for other spellings of the same entity', () => {
    const session = new Engine({ vocabulary: VOCABULARY }).session()
    session.redact(TEXT)
    const second = session.redact('Ion Popescu a trimis contractul la Acme Logistic SRL. Sună-l la +373 69 123 456.')
    expect(second.text).toBe('⟦PERSON_1⟧ a trimis contractul la ⟦COMPANY_1⟧. Sună-l la ⟦PHONE_1⟧.')
  })

  it('redacts history identically on every request', () => {
    const session = new Engine({ vocabulary: VOCABULARY }).session()
    const first = session.redact(TEXT).text
    session.redact('Acme și Maria Rusu.')
    expect(session.redact(TEXT).text).toBe(first)
  })

  it('finds a known name again when written without capitals', () => {
    const session = new Engine({ vocabulary: VOCABULARY }).session()
    session.redact(TEXT)
    expect(session.redact('am vorbit cu maria rusu ieri').text).toBe('am vorbit cu ⟦PERSON_2⟧ ieri')
  })

  it('protects user text that already looks like a symbol', () => {
    const session = new Engine({ vocabulary: VOCABULARY }).session()
    session.redact('Acme')
    const out = session.redact('Formatul folosit e ⟦COMPANY_1⟧.')
    expect(out.text).toBe('Formatul folosit e ⟦LITERAL_1⟧.')
    expect(session.restore('Ai scris ⟦LITERAL_1⟧ pentru ⟦COMPANY_1⟧.').text).toBe('Ai scris ⟦COMPANY_1⟧ pentru Acme.')
  })

  it('matches terms regardless of case and diacritics', () => {
    const session = new Engine({ vocabulary: [{ id: 's', class: 'PERSON', terms: ['Ștefan Ciobanu'] }] }).session()
    expect(session.redact('STEFAN CIOBANU și ştefan ciobanu').text).toBe('⟦PERSON_1⟧ și ⟦PERSON_1⟧')
  })

  it('blocks a payment card and keeps low-confidence names when asked', () => {
    const engine = new Engine({ vocabulary: VOCABULARY })
    const blocked = engine.session().redact('Plătește cu 4111 1111 1111 1111.')
    expect(blocked.verdict).toMatchObject({ kind: 'blocked', code: 'POLICY_BLOCKED', classId: 'CARD' })
    expect(blocked.text).toBe('')

    const keep = new Engine({ warnHandling: 'keep' }).session().redact('Rusu a întârziat.')
    expect(keep.verdict).toEqual({ kind: 'needs-confirmation' })
    expect(keep.text).toBe('Rusu a întârziat.')
    const auto = new Engine({}).session().redact('Rusu a întârziat.')
    expect(auto.text).toBe('⟦PERSON_1⟧ a întârziat.')
    expect(auto.report.warnings).toHaveLength(1)
  })

  it('respects the allowlist and per-class actions', () => {
    const session = new Engine({ allowlist: ['Maria Rusu'], actions: { PHONE: 'mask' } }).session()
    expect(session.redact('Maria Rusu: 069123456').text).toBe('Maria Rusu: 0********')
  })

  it('redacts JSON values and restores them escaped', () => {
    const session = new Engine({ vocabulary: [{ id: 'n', class: 'COMPANY', terms: ['Acme "Nord" SRL'] }] }).session()
    const batch = new RedactionBatch(session)
    const args = batch.json(JSON.stringify({ client: 'Acme "Nord" SRL', acme: 1 }))
    expect(args).toBe('{"client":"⟦COMPANY_1⟧","acme":1}')
    const restored = session.restore('{"to":"⟦COMPANY_1⟧"}', 'json-string')
    expect(JSON.parse(restored.text)).toEqual({ to: 'Acme "Nord" SRL' })
  })
})

describe('greek strategy', () => {
  it('assigns isolated letters, excludes letters already used, and restores', () => {
    const session = new Engine({ vocabulary: VOCABULARY, strategy: 'greek' }).session({ random: seeded(7) })
    const out = session.redact(`${TEXT} Unghiul α are 30°.`)
    expect(out.verdict).toEqual({ kind: 'proceed' })
    const symbols = out.report.tokensUsed
    expect(symbols).toHaveLength(5)
    expect(symbols).not.toContain('α')
    for (const symbol of symbols) expect(out.text).toContain(symbol)
    expect(out.text).toContain('Unghiul α are 30°.')
    const [person, firm] = symbols as [string, string]
    expect(session.restore(`${person} trimite ${firm}-ul actele.`).text).toBe('Dl. Popescu trimite Acme-ul actele.')
    expect(session.restore(`${person}${firm}`).text).toBe(`${person}${firm}`)
    expect(session.restore(`x = ${firm} + 2`).report.suspicious).toEqual([firm])
  })

  it('is deterministic for a given random source', () => {
    const a = new Engine({ vocabulary: VOCABULARY, strategy: 'greek' }).session({ random: seeded(3) }).redact(TEXT).text
    const b = new Engine({ vocabulary: VOCABULARY, strategy: 'greek' }).session({ random: seeded(3) }).redact(TEXT).text
    expect(a).toBe(b)
  })

  it('refuses text that already uses almost every Greek letter', () => {
    const out = new Engine({ strategy: 'greek' }).session().redact('αβγδεζηθικλμνξοπρστυφχψω')
    expect(out.verdict).toMatchObject({ kind: 'blocked', code: 'STRATEGY_UNSUITABLE' })
  })
})

describe('stream restoration', () => {
  for (const strategy of ['typed', 'greek'] as const) {
    it(`matches whole-text restoration for every split (${strategy})`, () => {
      const session = new Engine({ vocabulary: VOCABULARY, strategy }).session({ random: seeded(11) })
      const symbols = session.redact(TEXT).report.tokensUsed
      const answer = `Rezumat: ${symbols[0]} de la ${symbols[1]}; sună la ${symbols[2]}. Final ${symbols[4]}`
      const expected = session.restore(answer).text
      const random = seeded(99)
      for (let round = 0; round < 200; round++) {
        const restorer = session.streamRestorer()
        let out = ''
        let at = 0
        while (at < answer.length) {
          const size = 1 + Math.floor(random() * 6)
          out += restorer.push(answer.slice(at, at + size))
          at += size
        }
        out += restorer.flush()
        expect(out).toBe(expected)
      }
    })
  }
})

describe('preamble', () => {
  it('uses the default text unless the user wrote one for the strategy', () => {
    expect(new Engine({}).session().preamble()).toContain('⟦CLASS_N⟧')
    const custom = new Engine({ preambleTexts: { typed: 'Păstrează simbolurile ⟦…⟧ exact.', greek: '   ' } })
    expect(custom.session().preamble()).toBe('Păstrează simbolurile ⟦…⟧ exact.')
    expect(custom.session({ strategy: 'greek' }).preamble()).toContain('Greek letters')
  })
})

describe('pattern boundaries', () => {
  it('finds an IBAN followed by words, compact or in groups, and never reads it as a card', () => {
    const session = new Engine({}).session()
    expect(session.redact('Contul MD24AG000225100013104168 după 1 ianuarie.').text).toBe('Contul ⟦IBAN_1⟧ după 1 ianuarie.')
    const spaced = session.redact('IBAN: MD24 AG00 0225 1000 1310 4168 dupa plata.')
    expect(spaced.text).toBe('IBAN: ⟦IBAN_1⟧ dupa plata.')
  })

  it('ignores digit runs glued to letters', () => {
    const out = new Engine({}).session().redact('Codul intern AG4111111111111111 nu e card.')
    expect(out.verdict).toEqual({ kind: 'proceed' })
    expect(out.text).toBe('Codul intern AG4111111111111111 nu e card.')
  })
})

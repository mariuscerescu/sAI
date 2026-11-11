/**
 * The leaks known after the evaluations: an undeclared first name next to a protected
 * surname, English names nobody declared, and an organization called by its short name.
 */
import { describe, expect, it } from 'vitest'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'

const make = (vocabulary: VocabularyEntry[], names = false): Engine => new Engine({ vocabulary, names, patterns: [] })

describe('an undeclared first name next to a protected surname', () => {
  const engine = make([
    { id: 'm', class: 'PERSON', terms: ['Cristina Munteanu'] }, { id: 'w', class: 'PERSON', terms: ['David Walker'] },
    { id: 'p', class: 'PERSON', terms: ['Ion Popescu'] },
  ])

  it.each([
    ['Floare Munteanu a cules o floare mare.', 'Floare', 'floare mare'],
    ['Participanți: Ion Popescu, Floare Munteanu (stagiară).', 'Floare', undefined],
    ['Rose Walker picked a red rose.', 'Rose', 'red rose'],
    ['Am vorbit cu Zinovia Popescu ieri.', 'Zinovia', undefined],
  ])('%s', (text, firstName, ordinary) => {
    const session = engine.session()
    const out = session.redact(text)
    expect(out.text).not.toContain(firstName)
    if (ordinary !== undefined) expect(out.text).toContain(ordinary)
    expect(session.restore(out.text).text).toBe(text)
  })

  it('is a person of its own, not the declared one', () => {
    const session = engine.session()
    const declared = session.redact('Ion Popescu').report.tokensUsed[0]
    expect(session.redact('Am vorbit cu Zinovia Popescu.').report.tokensUsed[0]).not.toBe(declared)
  })

  it.each([
    'Contractul Popescului e gata.', 'Dear Walker, thanks.', 'Dr. Walker agreed.', 'Raportul lui Munteanu a sosit.',
  ])('leaves an ordinary capitalized word alone: %s', (text) => {
    const out = engine.session().redact(text)
    expect(out.decisions).toHaveLength(1)
    expect(out.text.split(' ')[0]).toBe(text.split(' ')[0])
  })
})

describe('English names nobody declared', () => {
  const engine = make([], true)

  it.each([
    ['I met Robert Brown yesterday.', 'Robert Brown'], ['Send it to Mrs. Patterson.', 'Patterson'], ['Ask Jennifer about it.', 'Jennifer'],
    ['A rose from Will Baker\'s garden.', 'Will Baker'], ['I met Zinovia Popescu.', 'Zinovia'],
  ])(
    'masks %s', (text, name) => {
      expect(engine.session().redact(text).text).not.toContain(name)
    },
  )

  it.each(['Will you sign the contract?', 'Green light for the project.', 'Mark the date in the calendar.', 'King size bed.'])(
    'leaves a common word that opens a sentence: %s', (text) => {
      expect(engine.session().redact(text).text).toBe(text)
    },
  )
})

describe('an organization called by its short name', () => {
  const engine = make([
    { id: 'a', class: 'COMPANY', terms: ['Acme Logistics Inc.'] }, { id: 'b', class: 'COMPANY', terms: ['Banca Verde'] },
    { id: 'm', class: 'COMPANY', terms: ['Moldova Agroindbank'] }, { id: 'j', class: 'PROJECT', terms: ['Project Falcon'] },
  ])

  it('masks the distinctive first word, as uncertain', () => {
    const session = engine.session()
    const out = session.redact('Acme said yes, and Acme\'s lawyer signed.')
    expect(out.text).not.toContain('Acme')
    expect(out.report.warnings.length).toBeGreaterThan(0)
    expect(session.restore(out.text).text).toBe('Acme said yes, and Acme\'s lawyer signed.')
    // A text typed without capitals writes the short name in lowercase too.
    expect(engine.session().redact('the acme deal is done').text).not.toContain('acme')
  })

  it.each(['Banca a închis devreme.', 'Moldova a câștigat meciul.', 'Project plans are due.', 'Then Mr. Hale reached the acme of his career.'])(
    'never shortens to a generic word, a place, or a lowercase word: %s', (text) => {
      expect(engine.session().redact(text).decisions).toHaveLength(0)
    },
  )
})

/**
 * A person declared only by full name is also protected by first name and by surname
 * found alone, in any inflected form. A part two people share gets its own symbol.
 */
import { describe, expect, it } from 'vitest'
import { combineLanguages, DEFAULT_LANGUAGES, Engine, normalizeTerm, type VocabularyEntry } from '../src/core/index.ts'
import { termForms } from '../src/core/inflection.ts'

import { CASES, type Case } from './fixtures/inflection-vocabulary.ts'

const make = (vocabulary: VocabularyEntry[]): Engine => new Engine({ vocabulary, patterns: [] })

describe('name parts', () => {
  const engine = make([
    { id: 'a', class: 'PERSON', terms: ['Ion Rusu'] },
    { id: 'b', class: 'PERSON', terms: ['Maria Ceban'] },
    { id: 'c', class: 'COMPANY', terms: ['Banca Verde'] },
  ])

  it.each([
    ['Ion a venit.', 'Ion'], ['Ioane, ascultă.', 'Ion'], ['Rusu a plecat.', 'Rusu'], ['Dosarul Rusului e gata.', 'Rusu'],
    ['Domnule Rusule, vă rog.', 'Rusu'], ['Mariei i-am scris.', 'Maria'], ['Mario, vino.', 'Maria'], ['Cebanei i-am scris.', 'Ceban'],
  ])('masks %s and restores the part', (text, part) => {
    const session = engine.session()
    const out = session.redact(text)
    expect(out.decisions).toHaveLength(1)
    expect(out.decisions[0]!.action).toBe('tokenize')
    expect(session.restore(out.text).text).toContain(part)
    expect(out.text).not.toMatch(/ion|rusu|maria|mario|ceban/iu)
  })

  it('warns on a first name alone but not on a surname alone', () => {
    expect(engine.session().redact('Ion a venit.').report.warnings).toHaveLength(1)
    expect(engine.session().redact('Rusu a venit.').report.warnings).toHaveLength(0)
  })

  it('reads every name word but the last as a first name, without name lists', () => {
    const triple = make([{ id: 't', class: 'PERSON', terms: ['Ana Maria Popescu'] }])
    // "Maria" is a first name here: masked only with its capital, with a warning.
    expect(triple.session().redact('am vorbit cu maria ieri').decisions).toHaveLength(0)
    expect(triple.session().redact('Am vorbit cu Maria ieri.').report.warnings).toHaveLength(1)
    expect(triple.session().redact('Am vorbit cu Popescu ieri.').report.warnings).toHaveLength(0)
  })

  it('gives a part the symbol of its only owner', () => {
    const session = engine.session()
    const full = session.redact('Ion Rusu conduce.').report.tokensUsed[0]!
    expect(session.redact('Rusu a plecat.').report.tokensUsed[0]).toBe(full)
    expect(session.redact('Ioane, vino.').report.tokensUsed[0]).toBe(full)
  })

  it('leaves ordinary words alone unless capitalized', () => {
    const words = make([{ id: 'v', class: 'PERSON', terms: ['Victoria Bostan'] }, { id: 'i', class: 'PERSON', terms: ['Iulia Spînu'] }])
    const session = words.session()
    expect(session.redact('În iulie am obținut o victorie, iar victoria contează.').decisions).toHaveLength(0)
    expect(session.redact('Victoria a semnat.').decisions).toHaveLength(1)
    // Once "Victoria" has been replaced, the ordinary word is still left alone.
    expect(session.redact('A fost o victoria clară.').decisions).toHaveLength(0)
  })

  it('reads lowercase surnames in a text that writes no names with capitals', () => {
    const session = engine.session()
    // No capitals at all, or only the one a phone keyboard puts at the start of a sentence.
    expect(session.redact('am vorbit cu rusului ieri').decisions).toHaveLength(1)
    expect(session.redact('Am vorbit cu rusului ieri. Mâine cu cebanei.').decisions).toHaveLength(2)
    // A first name alone always needs its capital: "will", "mark", "iulie" are usually ordinary words.
    expect(session.redact('am vorbit cu ion ieri').decisions).toHaveLength(0)
    expect(session.redact('Am vorbit cu ioane.').decisions).toHaveLength(0)
    // A text that capitalizes names mid-sentence reads a lowercase form as an ordinary word.
    expect(session.redact('Am vorbit cu Ion și cu rusului.').decisions).toHaveLength(1)
  })

  it('never merges two people through their name parts', () => {
    const people = make([{ id: 'a', class: 'PERSON', terms: ['Ion Popescu'] }, { id: 'b', class: 'PERSON', terms: ['Maria Ceban'] }])
    const session = people.session()
    const known = session.redact('Ion Popescu și Maria Ceban.').report.tokensUsed
    const other = session.redact('Maria Popescu a sunat.')
    expect(other.decisions).toHaveLength(1)
    expect(known).not.toContain(other.report.tokensUsed[0])
    expect(session.restore(other.text).text).toBe('Maria Popescu a sunat.')
    // Inverted order of one declared person is still that person.
    expect(session.redact('Popescu Ion a sunat.').report.tokensUsed[0]).toBe(known[0])
  })

  it('does not split company names', () => {
    expect(engine.session().redact('Iarba e verde.').decisions).toHaveLength(0)
  })

  describe('a part two people share', () => {
    const shared = make([
      { id: 'a', class: 'PERSON', terms: ['Ion Rusu'] },
      { id: 'b', class: 'PERSON', terms: ['Ion Popescu'] },
      { id: 'c', class: 'PERSON', terms: ['Maria Rusu'] },
    ])

    it('gets its own symbol, restored as the part', () => {
      const session = shared.session()
      const people = session.redact('Ion Rusu, Ion Popescu și Maria Rusu.').report.tokensUsed
      expect(new Set(people).size).toBe(3)
      for (const [text, part] of [['Ioane, vino.', 'Ion'], ['Rusului i-am scris.', 'Rusu']] as const) {
        const out = session.redact(text)
        expect(people).not.toContain(out.report.tokensUsed[0])
        expect(session.restore(out.text).text.startsWith(part)).toBe(true)
      }
    })

    it('keeps a part unique to one person on that person', () => {
      const session = shared.session()
      const full = session.redact('Ion Popescu').report.tokensUsed[0]!
      expect(session.redact('Popescului').report.tokensUsed[0]).toBe(full)
    })
  })
})

describe('inflected forms with only full names declared', () => {
  // The same hand-written forms, but each person is declared only by full name.
  const persons = CASES.filter(c => c.cls === 'PERSON')
  const engine = make(persons.map(c => ({ id: c.id, class: c.cls, terms: [c.terms[0]!] })))
  const forms = persons.flatMap(c => c.forms.map(form => [c.id, form, c] as const))

  const firstNameForms = (entry: Case): string[] => termForms(normalizeTerm(entry.terms[0]!.split(' ')[0]!), combineLanguages(DEFAULT_LANGUAGES).wordForms)

  it.each(forms)('%s · %s', (_id, form, entry) => {
    const session = engine.session()
    const lead = /^\p{Lu}/u.test(form) ? 'Documentul' : 'documentul'
    const out = session.redact(`${lead} ${form} a fost semnat.`)
    // A first name alone, written in lowercase, is read as an ordinary word.
    if (lead === 'documentul' && firstNameForms(entry).includes(normalizeTerm(form))) {
      expect(out.decisions).toHaveLength(0)
      return
    }
    expect(out.decisions).toHaveLength(1)
    const { span, action } = out.decisions[0]!
    expect(action).toBe('tokenize')
    if (span.key.kind === 'entry') expect(span.key.entryId).toBe(entry.id)
    else expect(entry.terms[0]!.split(' ')).toContain(session.restore(out.text).text.replace(/^[Dd]ocumentul | a fost semnat\.$/g, ''))
  })
})

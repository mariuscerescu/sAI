/**
 * Coverage of Romanian inflected forms. The forms are written by hand, independently of the
 * generator, as they appear in real Moldovan and Romanian text; each must be masked with the
 * symbol of its own vocabulary entry.
 */
import { describe, expect, it } from 'vitest'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'

import { CASES } from './fixtures/inflection-vocabulary.ts'

const vocabulary: VocabularyEntry[] = CASES.map(c => ({ id: c.id, class: c.cls, terms: c.terms }))
const engine = new Engine({ vocabulary, names: false, patterns: [] })
const allForms = CASES.flatMap(c => c.forms.map(form => ({ entry: c, form })))

describe('inflected forms coverage', () => {
  it('has about 200 hand-written forms', () => {
    expect(allForms.length).toBeGreaterThanOrEqual(200)
  })

  it.each(allForms.map(({ entry, form }) => [entry.id, form, entry] as const))('%s · %s', (_id, form, entry) => {
    const session = engine.session()
    const base = session.redact(entry.terms[0]!)
    const token = base.report.tokensUsed[0]!
    // A lowercase form is written the way someone who types without capitals writes everything.
    const lead = /^\p{Lu}/u.test(form) ? 'Documentul' : 'documentul'
    const out = session.redact(`${lead} ${form} a fost semnat.`)
    expect(out.verdict.kind).not.toBe('blocked')
    expect(out.decisions).toHaveLength(1)
    const decision = out.decisions[0]!
    expect(decision.action).toBe('tokenize')
    if (decision.span.key.kind === 'canonical') {
      // A first name or surname two people share has its own symbol and is restored as that word.
      expect(decision.span.key.classId).toBe(entry.cls)
      const restored = session.restore(out.text).text.replace(/^[Dd]ocumentul | a fost semnat\.$/g, '')
      expect(entry.terms[0]!.split(' ')).toContain(restored)
      return
    }
    expect(decision.span.key).toEqual({ kind: 'entry', entryId: entry.id })
    expect(out.text).toContain(token)
    // Only a hyphenated ending may stay next to the symbol.
    expect(out.text.replace(token, '').replace(/-[\p{L}]+/u, '')).toBe(`${lead}  a fost semnat.`)
  })

  it('masks a spelling two entries share, and reports it as uncertain', () => {
    // "Raileanului" is the genitive of both "Railean" and "Răileanu" once diacritics are ignored.
    const shared = new Engine({ names: false, patterns: [], vocabulary: [
      { id: 'a', class: 'PERSON', terms: ['Sergiu Railean', 'Railean'] },
      { id: 'b', class: 'PERSON', terms: ['Nadejda Răileanu', 'Răileanu'] },
    ] })
    const out = shared.session().redact('Dosarul Raileanului e gata.')
    expect(out.text).toBe('Dosarul ⟦PERSON_1⟧ e gata.')
    expect(out.report.warnings).toHaveLength(1)
  })

  it('restores an inflected form as the declared spelling', () => {
    const session = engine.session()
    const out = session.redact('Raportul Cebanei a ajuns la Băncii Verde.')
    expect(session.restore(out.text).text).toBe('Raportul Ceban a ajuns la Banca Verde.')
  })
})

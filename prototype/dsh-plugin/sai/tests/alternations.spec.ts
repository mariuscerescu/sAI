/**
 * Romanian stem alternations and plurals: the grammatical forms a declared name takes
 * before -i, -ii, -ile, -ilor, -e (verde → verzi, Floarea → Florii, Popescu → Popeștii)
 * and the plurals of organization names (Băncile, Grupurilor, Proiectelor).
 * Diminutives, derived names and irregular forms are new words: they are declared.
 */
import { describe, expect, it } from 'vitest'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'
import { alternations, wordForms } from '../src/core/inflection.ts'

const VOCABULARY: VocabularyEntry[] = [
  { id: 'banca', class: 'COMPANY', terms: ['Banca Verde'] },
  { id: 'padure', class: 'COMPANY', terms: ['Pădurea Verde'] },
  { id: 'scoala', class: 'ORGANIZATION', terms: ['Școala Centrală'] },
  { id: 'poarta', class: 'COMPANY', terms: ['Poarta Albă'] },
  { id: 'cartea', class: 'PROJECT', terms: ['Cartea Neagră'] },
  { id: 'casa', class: 'COMPANY', terms: ['Casa Mare'] },
  { id: 'grup', class: 'COMPANY', terms: ['Grupul Nord'] },
  { id: 'proiect', class: 'PROJECT', terms: ['Proiectul Delta'] },
  { id: 'floarea', class: 'PERSON', terms: ['Floarea Munteanu'] },
  { id: 'popescu', class: 'PERSON', terms: ['Ion Popescu'] },
  { id: 'ceban', class: 'PERSON', terms: ['Maria Ceban'] },
]
const engine = new Engine({ vocabulary: VOCABULARY, patterns: [] })

describe('stem alternations', () => {
  it.each([
    ['verd', ['verd', 'verz']], ['popesc', ['popesc', 'popest']], ['floar', ['floar', 'flor']],
    ['scoal', ['scoal', 'scol']], ['sear', ['sear', 'ser']], ['ban', ['ban']],
  ] as const)('%s reads as %j', (stem, readings) => {
    expect(alternations(stem)).toEqual(readings)
  })

  it('keeps the plain reading for words that do not alternate', () => {
    expect(wordForms('ioana')).toContain('ioanei')
    expect(wordForms('verde')).toEqual(expect.arrayContaining(['verdei', 'verzi', 'verzile', 'verzilor']))
  })
})

describe('forms a declared name takes in a sentence', () => {
  it.each([
    ['Contul Băncii Verzi e activ.', 'Băncii Verzi'],
    ['Toate Băncile Verzi au închis.', 'Băncile Verzi'],
    ['Clienții Băncilor Verzi au plecat.', 'Băncilor Verzi'],
    ['Pădurii Verzi i-a mers bine.', 'Pădurii Verzi'],
    ['Directorul Școlii Centrale a vorbit.', 'Școlii Centrale'],
    ['Acționarii Porții Albe s-au întâlnit.', 'Porții Albe'],
    ['Autorul Cărții Negre a semnat.', 'Cărții Negre'],
    ['Proprietarii Caselor Mari au vândut.', 'Caselor Mari'],
    ['Directorii Grupurilor Nord s-au întâlnit.', 'Grupurilor Nord'],
    ['Bugetele Proiectelor Delta cresc.', 'Proiectelor Delta'],
    ['I-am scris Florii ieri.', 'Florii'],
    ['Am vorbit cu Popeștii ieri.', 'Popeștii'],
    ['Casa Popeștilor e mare.', 'Popeștilor'],
    ['Cebanii au venit la noi.', 'Cebanii'],
  ])('%s', (text, form) => {
    const session = engine.session()
    const out = session.redact(text)
    expect(out.text).not.toContain(form)
    expect(out.decisions.length).toBeGreaterThan(0)
    // An inflected form is restored as the declared spelling.
    expect(session.restore(out.text).text).not.toContain('⟦')
  })

  it('restores an alternated form as the declared spelling', () => {
    const session = engine.session()
    expect(session.restore(session.redact('Contul Băncii Verzi e activ.').text).text).toBe('Contul Banca Verde e activ.')
  })

  it('still leaves ordinary lowercase words alone in a text that capitalizes names', () => {
    // "flori", "mari", "verzi" are everyday words; one-word forms need a capital here.
    const out = engine.session().redact('Am cumpărat flori mari și verzi pentru Maria Ceban.')
    expect(out.text).toBe('Am cumpărat flori mari și verzi pentru ⟦PERSON_1⟧.')
  })
})

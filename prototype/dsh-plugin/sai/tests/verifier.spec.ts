import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  Engine, inCodeToken, isLoopbackUrl, looksRomanian, questionFor, resolveSettings, verifyTexts, type NameQuestion, type PartQuestion, type SaiSettings,
  type Verifier, type VerifierQuestion, type WhichQuestion,
} from '../src/core/index.ts'
import { redactRequest, requestTexts } from '../src/request.ts'

const VOCABULARY: SaiSettings['vocabulary'] = [
  { id: 'e1', class: 'PERSON', terms: ['Bill Turner'] },
  { id: 'e2', class: 'COMPANY', terms: ['Acme Logistics'] },
]
const TEXT = 'Reply to bill: Acme Logistics paid the bill. Send the receipt to GB29 NWBK 6016 1331 9268 19 and copy Sarah Kim.'

/** A fake model: a name when the word directly follows "to" in its text. */
function fakeModel(log: VerifierQuestion[][] = []): Verifier {
  return {
    async verify(questions) {
      log.push([...questions])
      return questions.map(question => /(^|\s)to bill\b/.test(question.state) ? 0.97 : 0.02)
    },
  }
}

const failing: Verifier = { async verify() { throw new Error('the service is down') } }

/** These tests cover mode `lowercase` (variant B); mode `all`, the default since the final run, has its own suite below. */
const engineWith = (enabled: boolean | undefined, extra: Partial<SaiSettings> = {}): Engine =>
  new Engine({ vocabulary: VOCABULARY, languages: ['en'], ...enabled === undefined ? {} : { verifier: { enabled, mode: 'lowercase' } as never }, ...extra })

describe('verifier off', () => {
  it('is off by default and behaves as before: lowercase "bill" stays, nothing is asked', () => {
    for (const engine of [engineWith(undefined), engineWith(false)]) {
      const session = engine.session()
      expect(session.questions(TEXT)).toEqual([])
      expect(session.redact(TEXT).text).toBe('Reply to bill: ⟦COMPANY_1⟧ paid the bill. Send the receipt to ⟦IBAN_1⟧ and copy Sarah Kim.')
    }
  })

  it('gives the same output as an engine built without the setting, on many texts', () => {
    const texts = [TEXT, 'bill turner and acme', 'BILL called. Turner too.', 'the turners and the bills', 'Ask bill about acme today.']
    for (const text of texts) {
      expect(engineWith(false).session().redact(text)).toEqual(new Engine({ vocabulary: VOCABULARY, languages: ['en'] }).session().redact(text))
    }
  })
})

describe('two-letter name parts', () => {
  const vocabulary: SaiSettings['vocabulary'] = [
    { id: 'p1', class: 'PERSON', terms: ['Jo Vantoor'] },
    { id: 'p2', class: 'PERSON', terms: ['Ysolde Le'] },
    { id: 'p3', class: 'PERSON', terms: ['Do Vantoor'] },
    { id: 'p4', class: 'PERSON', terms: ['Henry Ford II'] },
  ]
  const engine = (verifier?: Partial<SaiSettings['verifier']>): Engine =>
    new Engine({ vocabulary, languages: ['en'], ...verifier === undefined ? {} : { verifier: { enabled: true, ...verifier } as never } })

  it('with the verifier off, stay as before: not found, nothing asked', () => {
    const session = engine().session()
    expect(session.questions('Jo met Le today.')).toEqual([])
    expect(session.redact('Jo met Le today.').text).toBe('Jo met Le today.')
  })

  for (const mode of ['lowercase', 'all'] as const) {
    it(`in mode ${mode}, go to the model in any case, and are masked when it gives no answer`, () => {
      const session = engine({ mode }).session()
      expect(session.questions('Jo met le today.').map(question => question.word)).toEqual(['Jo', 'le'])
      expect(session.redact('Jo met le today.').text).not.toMatch(/\bJo\b|\ble\b/)
    })

    it(`in mode ${mode}, stay when the model calls them ordinary words`, () => {
      const session = engine({ mode }).session()
      const questions = session.questions('Jo met us.')
      session.answer(questions, questions.map(() => 0.001))
      expect(session.redact('Jo met us.').text).toBe('Jo met us.')
    })

    it(`in mode ${mode}, leave a lowercase common word alone, but ask about it when capitalized`, () => {
      const session = engine({ mode }).session()
      expect(session.questions('Please do it.')).toEqual([])
      expect(session.questions('I saw Do there.').map(question => question.word)).toEqual(['Do'])
    })

    it(`in mode ${mode}, do not take a Roman numeral for a name part`, () => {
      expect(engine({ mode }).session().questions('See chapter II.')).toEqual([])
    })
  }
})

describe('the question of the verifier service', () => {
  it('keeps the measured wording: a name against an ordinary dictionary word', () => {
    const source = readFileSync(new URL('../verifier/decider_server.py', import.meta.url), 'utf8')
    expect(source).toContain('rather than as an ordinary dictionary word with its usual meaning?')
    expect(source).not.toContain('rather than as an ordinary word?')
  })
})

describe('table column in the question', () => {
  const span = (text: string, word: string, from = 0): Parameters<typeof questionFor>[1] => {
    const start = text.indexOf(word, from)
    return { start, end: start + word.length, classId: 'PERSON', detector: 'dictionary', priority: 1, key: { kind: 'entry', entryId: 'x' } }
  }

  it('names the column of a value in a table row', () => {
    const text = '| City | First Name | Last Name |\n|---|---|---|\n| Oslo | Michael | Price |'
    expect(questionFor(text, span(text, 'Price'), 'Anna Price').state).toMatch(/^Table column "Last Name":\n/)
  })

  it('adds nothing for a header cell, a column named like the word, or plain text', () => {
    const header = '| Price | Total |\n|---|---|\n| 10 | 20 |'
    expect(questionFor(header, span(header, 'Price'), 'Anna Price').state).not.toContain('Table column')
    const same = '| Price |\n|---|\n| Price |'
    expect(questionFor(same, span(same, 'Price', 10), 'Anna Price').state).not.toContain('Table column')
    const plain = 'The Price family | moved away.'
    expect(questionFor(plain, span(plain, 'Price'), 'Anna Price').state).not.toContain('Table column')
  })
})

describe('verifier on', () => {
  it('lists one question per dropped lowercase form, each text holding the word once, with the declared name', () => {
    const questions = engineWith(true).session().questions(TEXT)
    expect(questions.map(question => question.word)).toEqual(['bill', 'bill'])
    expect(questions[0]).toMatchObject({ classId: 'PERSON', term: 'Bill Turner', state: 'Reply to bill: Acme Logistics paid the' })
    expect(questions[1]!.state).toBe('Acme Logistics paid the bill. Send the receipt to GB29 NWBK 6016 1331 9268 19 and copy Sarah Kim.')
  })

  it('cuts at the sentence end between two occurrences', () => {
    const text = 'I paid the bill yesterday. Then bill called me back about it.'
    const [first, second] = engineWith(true).session().questions(text)
    expect(first!.state).toBe('I paid the bill yesterday.')
    expect(second!.state).toBe('Then bill called me back about it.')
  })

  it('cuts off a capitalized occurrence too, so the question never points at two words', () => {
    const [question] = engineWith(true).session().questions('Bill wrote. Later bill paid.')
    expect(question!.state).toBe('Later bill paid.')
  })

  it('asks every question of a request in one call, and replaces only the word the model calls a name', async () => {
    const session = engineWith(true).session()
    const calls: VerifierQuestion[][] = []
    const report = await verifyTexts(session, [TEXT], fakeModel(calls))
    expect(report).toEqual({ asked: 2, calls: 1, failed: false })
    expect(calls).toHaveLength(1)
    const out = session.redact(TEXT)
    expect(out.text).toBe('Reply to ⟦PERSON_1⟧: ⟦COMPANY_1⟧ paid the bill. Send the receipt to ⟦IBAN_1⟧ and copy Sarah Kim.')
    expect(session.restore('Hi ⟦PERSON_1⟧, ⟦COMPANY_1⟧ paid.').text).toBe('Hi bill, Acme Logistics paid.')
  })

  it('makes no call when nothing is unconfirmed', async () => {
    const session = engineWith(true).session()
    const calls: VerifierQuestion[][] = []
    const report = await verifyTexts(session, ['Bill Turner paid Acme Logistics.', 'Nothing protected here.'], fakeModel(calls))
    expect(report).toEqual({ asked: 0, calls: 0, failed: false })
    expect(calls).toHaveLength(0)
  })

  it('never asks about words that are not in the vocabulary', () => {
    expect(engineWith(true).session().questions('Ask sarah and kim about the mark.')).toEqual([])
  })

  it('does not ask again what the session already answered', async () => {
    const session = engineWith(true).session()
    await verifyTexts(session, [TEXT], fakeModel())
    expect(session.questions(TEXT)).toEqual([])
    const calls: VerifierQuestion[][] = []
    expect(await verifyTexts(session, [TEXT], fakeModel(calls))).toEqual({ asked: 0, calls: 0, failed: false })
  })

  it('replaces every word asked when the call fails', async () => {
    const session = engineWith(true).session()
    expect(await verifyTexts(session, [TEXT], failing)).toEqual({ asked: 2, calls: 1, failed: true })
    expect(session.redact(TEXT).text).toBe('Reply to ⟦PERSON_1⟧: ⟦COMPANY_1⟧ paid the ⟦PERSON_1⟧. Send the receipt to ⟦IBAN_1⟧ and copy Sarah Kim.')
  })

  it('replaces a word never asked about (a synchronous path such as the session log)', () => {
    expect(engineWith(true).session().redact('Please ask bill.').text).toBe('Please ask ⟦PERSON_1⟧.')
  })

  it('replaces a word the model is unsure about (at or above the threshold)', async () => {
    const session = engineWith(true).session()
    const unsure: Verifier = { async verify(questions) { return questions.map(() => 0.2) } }
    await verifyTexts(session, ['Please ask bill.'], unsure)
    expect(session.redact('Please ask bill.').text).toBe('Please ask ⟦PERSON_1⟧.')
    const sure: Verifier = { async verify(questions) { return questions.map(() => 0.19) } }
    const other = engineWith(true).session()
    await verifyTexts(other, ['Please ask bill.'], sure)
    expect(other.redact('Please ask bill.').text).toBe('Please ask bill.')
  })

  it('replaces the words of a malformed answer', async () => {
    const session = engineWith(true).session()
    const short: Verifier = { async verify() { return [0.01] } }
    expect((await verifyTexts(session, [TEXT], short)).failed).toBe(true)
    expect(session.redact(TEXT).text).toContain('Reply to ⟦PERSON_1⟧')
    expect(session.redact(TEXT).text).toContain('paid the ⟦PERSON_1⟧')
  })

  it('leaves out allowlisted words and words a finding already covers', () => {
    const session = engineWith(true, { allowlist: ['bill'] }).session()
    expect(session.questions(TEXT)).toEqual([])
    expect(engineWith(true).session().questions('bill turner signed')).toEqual([])
  })

  it('in a text with no capitalized name, a lowercase surname is asked too, and replaced until answered', () => {
    const session = engineWith(true).session()
    expect(session.questions('ask turner about it').map(question => question.word)).toEqual(['turner'])
    expect(session.redact('ask turner about it').text).toBe('ask ⟦PERSON_1⟧ about it')
  })

  it('in a text with no capitalized name, sends a lowercase word the model calls ordinary as written, without a leak block', async () => {
    const text = 'demand is the quantity buyers would purchase at each unit price of the good.'
    const vocabulary = [{ id: 'p', class: 'PERSON', terms: ['Anna Price'] }]
    expect(new Engine({ vocabulary, languages: ['en'] }).session().redact(text).text).toContain('unit ⟦PERSON_1⟧ of')
    const session = new Engine({ vocabulary, languages: ['en'], verifier: { enabled: true } as never }).session()
    const ordinary: Verifier = { async verify(questions) { return questions.map(() => 0.01) } }
    expect(await verifyTexts(session, [text], ordinary)).toEqual({ asked: 1, calls: 1, failed: false })
    const out = session.redact(text)
    expect(out.verdict).toEqual({ kind: 'proceed' })
    expect(out.text).toBe(text)
    expect(out.decisions).toEqual([expect.objectContaining({ action: 'ignore', span: expect.objectContaining({ detector: 'verifier' }) })])
    expect(out.report.countsByClass).toEqual({})
  })

  it('in a text with no capitalized name, a lowercase name the model confirms is replaced', async () => {
    const session = engineWith(true).session()
    const name: Verifier = { async verify(questions) { return questions.map(() => 0.9) } }
    await verifyTexts(session, ['i talked to turner yesterday'], name)
    expect(session.redact('i talked to turner yesterday').text).toBe('i talked to ⟦PERSON_1⟧ yesterday')
  })

  it('never asks about a capitalized form: it is replaced as before', () => {
    const session = engineWith(true).session()
    expect(session.questions('We met Turner. The bill was paid by him.')).toEqual([expect.objectContaining({ word: 'bill' })])
    expect(session.questions('We met Turner at noon.')).toEqual([])
    expect(session.redact('We met Turner at noon.').text).toBe('We met ⟦PERSON_1⟧ at noon.')
  })

  it('a word the model called ordinary stays, even when the same word is replaced elsewhere in the text', async () => {
    const vocabulary = [{ id: 'c', class: 'COMPANY', terms: ['Acme Logistics'] }]
    const session = new Engine({ vocabulary, languages: ['en'], verifier: { enabled: true } as never }).session()
    const text = 'we called acme today and the acme of the season'
    const mixed: Verifier = { async verify(questions) { return questions.map(question => question.state.includes('called acme') ? 0.9 : 0.01) } }
    await verifyTexts(session, [text], mixed)
    expect(session.redact(text).text).toBe('we called ⟦COMPANY_1⟧ today and the acme of the season')
  })

  it('collects every text of a request and asks them in one call', async () => {
    const options: GenerateOptions = {
      provider: 'test', model: 'm',
      system: 'You write to bill.',
      messages: [
        { id: 'u' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: TEXT }] },
        { id: 'v' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Send it to bill today.' }] },
      ],
    }
    const session = engineWith(true).session()
    const calls: VerifierQuestion[][] = []
    const texts = requestTexts(options, session, () => '')
    expect(texts).toEqual(['You write to bill.', TEXT, 'Send it to bill today.'])
    expect(await verifyTexts(session, texts, fakeModel(calls))).toEqual({ asked: 4, calls: 1, failed: false })
    const redacted = redactRequest(options, session, () => '', undefined)
    expect(redacted.options.system).toBe('You write to ⟦PERSON_1⟧.')
    const user = redacted.options.messages.map(message => message.content[0]).map(block => block?.type === 'text' ? block.text : '')
    expect(user).toEqual([
      'Reply to ⟦PERSON_1⟧: ⟦COMPANY_1⟧ paid the bill. Send the receipt to ⟦IBAN_1⟧ and copy Sarah Kim.',
      'Send it to ⟦PERSON_1⟧ today.',
    ])
  })
})

describe('mode all: every one-word form goes to the model', () => {
  const PEOPLE: SaiSettings['vocabulary'] = [
    { id: 'turner', class: 'PERSON', terms: ['Bill Turner'] },
    { id: 'smith', class: 'PERSON', terms: ['Bill Smith'] },
    { id: 'munteanu', class: 'PERSON', terms: ['Ion Munteanu'] },
    { id: 'king', class: 'PERSON', terms: ['Mark King'] },
    { id: 'acme', class: 'COMPANY', terms: ['Acme Logistics'] },
  ]
  const all = (vocabulary = PEOPLE, extra: Partial<SaiSettings['verifier']> = {}) =>
    new Engine({ vocabulary, languages: ['en'], verifier: { enabled: true, mode: 'all', ...extra } as never }).session()
  /** A fake model: answers by question kind; the defaults say "name", "part of the name", "cannot tell". */
  function model(rules: {
    name?: (q: NameQuestion) => number; part?: (q: PartQuestion) => number; which?: (q: WhichQuestion) => number[]
  } = {}, log: VerifierQuestion[][] = []): Verifier {
    return {
      async verify(questions) {
        log.push([...questions])
        return questions.map(q => q.kind === 'name' ? (rules.name?.(q) ?? 0.9)
          : q.kind === 'part' ? (rules.part?.(q) ?? 0.9)
          : (rules.which?.(q) ?? [...q.options.map(() => 0), 1]))
      },
    }
  }
  const redactWith = async (session: ReturnType<typeof all>, text: string, verifier: Verifier): Promise<string> => {
    await verifyTexts(session, [text], verifier)
    return session.redact(text).text
  }

  it('asks about capitalized forms too: "Mark the date" stays, "Acme" is replaced', async () => {
    const session = all()
    expect(session.questions('Mark the date for Acme.').filter(q => q.kind === 'name').map(q => q.word)).toEqual(['Mark', 'Acme'])
    const out = await redactWith(session, 'Mark the date for Acme.', model({ name: q => q.word === 'Mark' ? 0.01 : 0.95 }))
    expect(out).toBe('Mark the date for ⟦COMPANY_1⟧.')
  })

  it('asks about a declared one-word spelling ("Bill" alone), which mode lowercase always replaces', async () => {
    const vocabulary = [{ id: 'b', class: 'PERSON', terms: ['Bill'] }]
    const text = 'Please pay the bill today.'
    expect(new Engine({ vocabulary, languages: ['en'], verifier: { enabled: true } as never }).session().redact(text).text)
      .toBe('Please pay the ⟦PERSON_1⟧ today.')
    expect(await redactWith(all(vocabulary), text, model({ name: () => 0.01 }))).toBe(text)
  })

  it('replaces exact full names and validated numbers without asking', () => {
    const session = all()
    const text = 'Bill Turner paid GB29 NWBK 6016 1331 9268 19 to Acme Logistics.'
    expect(session.questions(text)).toEqual([])
    expect(session.redact(text).text).toBe('⟦PERSON_1⟧ paid ⟦IBAN_1⟧ to ⟦COMPANY_1⟧.')
  })

  it('joins a capitalized word to a surname when the model says it is part of the name ("Floare Munteanu")', async () => {
    const asked = all().questions('Floare Munteanu came to the meeting.')
    expect(asked).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'part', word: 'Floare', name: 'Munteanu' })]))
    expect(await redactWith(all(), 'Floare Munteanu came to the meeting.', model())).toBe('⟦PERSON_1⟧ came to the meeting.')
    expect(await redactWith(all(), 'Floare Munteanu came to the meeting.', model({ part: () => 0.02 })))
      .toBe('Floare ⟦PERSON_1⟧ came to the meeting.')
  })

  it('does not join a sentence-opening word the model says is not part of the name ("Ask bill")', async () => {
    const out = await redactWith(all(), 'Ask bill about the contract.', model({ part: () => 0.01 }))
    expect(out).toBe('Ask ⟦PERSON_1⟧ about the contract.')
  })

  it('without an answer, a word before a surname is joined, as without the model', () => {
    expect(all().redact('Floare Munteanu came.').text).toBe('⟦PERSON_1⟧ came.')
  })

  it('a shared first name gets one person\'s symbol only when the model is sure; it is replaced either way', async () => {
    const text = 'Bill Turner signed. Later Bill sent the report.'
    const asked = all().questions(text).filter(q => q.kind === 'which')
    expect(asked).toEqual([expect.objectContaining({ word: 'Bill', options: ['Bill Turner', 'Bill Smith'], entries: ['turner', 'smith'] })])
    const sure = await redactWith(all(), text, model({ part: () => 0.01, which: () => [0.9, 0.05, 0.05] }))
    expect(sure).toBe('⟦PERSON_1⟧ signed. Later ⟦PERSON_1_2⟧ sent the report.')
    const unsure = await redactWith(all(), text, model({ part: () => 0.01, which: () => [0.5, 0.4, 0.1] }))
    expect(unsure).toBe('⟦PERSON_1⟧ signed. Later ⟦PERSON_2⟧ sent the report.')
    const elsewhere = await redactWith(all(), text, model({ part: () => 0.01, which: () => [0.01, 0.01, 0.98] }))
    expect(elsewhere).toBe('⟦PERSON_1⟧ signed. Later ⟦PERSON_2⟧ sent the report.')
  })

  it('asks every kind of question in one call', async () => {
    const log: VerifierQuestion[][] = []
    const report = await verifyTexts(all(), ['Floare Munteanu met Bill. Mark the date.'], model({}, log))
    expect(report.calls).toBe(1)
    expect(new Set(log[0]!.map(q => q.kind))).toEqual(new Set(['name', 'part', 'which']))
  })

  it('when the call fails, every one-word form is replaced and words before a surname are joined', async () => {
    const session = all()
    const text = 'Mark the date. Floare Munteanu came.'
    expect((await verifyTexts(session, [text], failing)).failed).toBe(true)
    expect(session.redact(text).text).toBe('⟦PERSON_1⟧ the date. ⟦PERSON_2⟧ came.')
  })

  it('puts the class description in the question', () => {
    const vocabulary = [{ id: 'p', class: 'CODENAME', terms: ['Nightjar'] }]
    const [question] = all(vocabulary, { descriptions: { CODENAME: 'an internal project code name' } } as never).questions('The nightjar sang.')
    expect(question).toMatchObject({ kind: 'name', word: 'nightjar', classId: 'CODENAME', description: 'an internal project code name' })
  })

  it('mode lowercase still never asks about capitalized forms', () => {
    const session = new Engine({ vocabulary: PEOPLE, languages: ['en'], verifier: { enabled: true, mode: 'lowercase' } as never }).session()
    expect(session.questions('Mark the date for Acme.')).toEqual([])
  })

  it('resolves the mode and refuses an unknown one', () => {
    expect(resolveSettings({ verifier: { mode: 'all' } as never }).settings.verifier.mode).toBe('all')
    const { settings, problems } = resolveSettings({ verifier: { mode: 'everything' } as never })
    expect(settings.verifier.mode).toBe('all')
    expect(problems.join(' ')).toContain('unknown verifier mode')
  })
})

describe('the two leaks found by measurement', () => {
  const nothingIsAName: Verifier = {
    async verify(questions) { return questions.map(q => q.kind === 'which' ? [...q.options.map(() => 0), 1] : 0.01) },
  }
  const engine = (vocabulary: SaiSettings['vocabulary'], languages: string[], mode: 'lowercase' | 'all') =>
    new Engine({ vocabulary, languages, verifier: { enabled: true, mode } as never })

  it('replaces a form inside a code token without asking ("gb_total")', async () => {
    const bank = [{ id: 'bank', class: 'COMPANY', terms: ['Greenfield Bank plc', 'GB'] }]
    const session = engine(bank, ['en'], 'all').session()
    const text = 'In code, the variable gb_total holds the amount.'
    expect(session.questions(text)).toEqual([])
    await verifyTexts(session, [text], nothingIsAName)
    expect(session.redact(text).text).toBe('In code, the variable ⟦COMPANY_1⟧_total holds the amount.')
  })

  it('recognizes code tokens, but not sentence punctuation or hyphens', () => {
    const at = (text: string, word: string) => inCodeToken(text, text.indexOf(word), text.indexOf(word) + word.length)
    expect(at('see bill_id now', 'bill')).toBe(true)
    expect(at('mail acme.com today', 'acme')).toBe(true)
    expect(at('open src/acme/main.ts', 'acme')).toBe(true)
    expect(at('call obj.bill() first', 'bill')).toBe(true)
    expect(at('We paid the bill. Then we left.', 'bill')).toBe(false)
    expect(at('a bill-of-materials', 'bill')).toBe(false)
  })

  it('in mode lowercase too, a form inside a code token is replaced without asking', () => {
    const session = engine(VOCABULARY, ['en'], 'lowercase').session()
    expect(session.questions('Check the bill_id column.')).toEqual([])
    expect(session.redact('Check the bill_id column.').text).toBe('Check the ⟦PERSON_1⟧_id column.')
  })

  for (const mode of ['lowercase', 'all'] as const) {
    it(`in a Romanian text the model cannot remove a mask the rules put (mode ${mode})`, async () => {
      const session = engine([{ id: 'rusu', class: 'PERSON', terms: ['Ion Rusu'] }], ['ro', 'en'], mode).session()
      const text = 'Am vorbit cu rusu despre factură.'
      expect(session.questions(text)).toEqual([])
      await verifyTexts(session, [text], nothingIsAName)
      expect(session.redact(text).text).toBe('Am vorbit cu ⟦PERSON_1⟧ despre factură.')
    })
  }

  it('in a Romanian text the model can still add masks the rules would not put', async () => {
    const session = engine([{ id: 'rusu', class: 'PERSON', terms: ['Ion Rusu'] }], ['ro', 'en'], 'all').session()
    const text = 'Ion Popescu a vorbit cu ion despre factură.'
    expect(session.questions(text).map(q => q.word)).toContain('ion')
  })

  it('in a Romanian text the attached-first-name rule stays as before (no Q2)', () => {
    const session = engine([{ id: 'rusu', class: 'PERSON', terms: ['Ion Rusu'] }], ['ro', 'en'], 'all').session()
    const text = 'Maria Rusu a sunat de două ori.'
    expect(session.questions(text).filter(q => q.kind === 'part')).toEqual([])
    expect(session.redact(text).text).toBe('⟦PERSON_1⟧ a sunat de două ori.')
  })

  it('an English text keeps the model\'s answers when Romanian is also enabled', () => {
    const session = engine([{ id: 'king', class: 'PERSON', terms: ['Mark King'] }], ['ro', 'en'], 'all').session()
    expect(session.questions('Mark the date for the team.').map(q => q.word)).toEqual(['Mark'])
  })

  it('tells Romanian from English', () => {
    expect(looksRomanian('Am vorbit cu rusu despre factură.')).toBe(true)
    expect(looksRomanian('Ieri Rusu a sunat de două ori.')).toBe(true)
    expect(looksRomanian('Mark the date for the team.')).toBe(false)
    expect(looksRomanian('Reply to bill: Acme Logistics paid the bill.')).toBe(false)
  })
})

describe('questions and settings', () => {
  it('keeps at most the context limit of whole words around the word', () => {
    const long = `${'word '.repeat(200)}ask bill now ${'more '.repeat(200)}`
    const start = long.indexOf('bill')
    const question = questionFor(long, { start, end: start + 4, classId: 'PERSON', detector: 'dictionary', priority: 300, key: { kind: 'entry', entryId: 'e1' } }, 'Bill Turner')
    expect(question.state.length).toBeLessThanOrEqual(4 + 600)
    expect(question.state).toMatch(/^word /)
    expect(question.state).toMatch(/ more$/)
    expect(question.state).toContain('ask bill now')
  })

  it('accepts only addresses on this computer', () => {
    expect(isLoopbackUrl('http://127.0.0.1:8765/verify')).toBe(true)
    expect(isLoopbackUrl('http://localhost:8765/verify')).toBe(true)
    expect(isLoopbackUrl('https://example.com/verify')).toBe(false)
    expect(isLoopbackUrl('http://10.0.0.5:8765/verify')).toBe(false)
    const { settings, problems } = resolveSettings({ verifier: { enabled: true, url: 'https://example.com/verify' } as never })
    expect(settings.verifier.url).toBe('http://127.0.0.1:8765/verify')
    expect(problems.join(' ')).toContain('on this computer')
  })

  it('defaults to off with a 0.2 threshold', () => {
    expect(resolveSettings({}).settings.verifier).toMatchObject({ enabled: false, threshold: 0.2 })
  })
})

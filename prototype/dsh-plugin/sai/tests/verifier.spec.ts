import { describe, expect, it } from 'vitest'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import {
  Engine, isLoopbackUrl, questionFor, resolveSettings, verifyTexts, type SaiSettings, type Verifier,
  type VerifierQuestion,
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

const engineWith = (enabled: boolean | undefined, extra: Partial<SaiSettings> = {}): Engine =>
  new Engine({ vocabulary: VOCABULARY, languages: ['en'], ...enabled === undefined ? {} : { verifier: { enabled } as never }, ...extra })

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
    expect(session.restore('Hi ⟦PERSON_1⟧, ⟦COMPANY_1⟧ paid.').text).toBe('Hi Bill, Acme Logistics paid.')
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

  it('a word replaced elsewhere in the same text is replaced everywhere, even where the model called it ordinary', async () => {
    const vocabulary = [{ id: 'c', class: 'COMPANY', terms: ['Acme Logistics'] }]
    const session = new Engine({ vocabulary, languages: ['en'], verifier: { enabled: true } as never }).session()
    const text = 'we called acme today and the acme of the season'
    const mixed: Verifier = { async verify(questions) { return questions.map(question => question.state.includes('called acme') ? 0.9 : 0.01) } }
    await verifyTexts(session, [text], mixed)
    expect(session.redact(text).text).toBe('we called ⟦COMPANY_1⟧ today and the ⟦COMPANY_1⟧ of the season')
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

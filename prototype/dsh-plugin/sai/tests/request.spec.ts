import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { Engine, type RestoreReport } from '../src/core/index.ts'
import { redactRequest, restoreStream } from '../src/request.ts'

const engine = new Engine({
  vocabulary: [
    { id: 'pers_ion', class: 'PERSON', terms: ['Ion Popescu', 'Popescu'] },
    { id: 'acme', class: 'COMPANY', terms: ['Acme'] },
  ],
})

const callId = 'call-1' as ToolCallId

function request(): GenerateOptions {
  return {
    provider: 'test', model: 'm',
    messages: [
      { id: 's' as never, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Ești asistentul firmei Acme.' }] },
      { id: 'u' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Trimite un SMS lui Ion Popescu la 069123456.' }] },
      {
        id: 'a' as never, role: 'assistant', source: { kind: 'model', provider: 'test', model: 'm' },
        content: [{ type: 'tool-call', id: callId, name: 'send_sms', arguments: '{"to":"069123456","text":"Salut, Popescu!"}' }],
      },
      { id: 't' as never, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'SMS trimis lui Ion Popescu.' }] },
    ],
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of stream) chunks.push(chunk)
  return chunks
}

async function* chunks(...items: StreamChunk[]): AsyncIterable<StreamChunk> { yield* items }

describe('request redaction', () => {
  it('redacts every text field in conversation order and appends the preamble', () => {
    const session = engine.session()
    const original = request()
    const before = JSON.stringify(original)
    const { options, verdict, report } = redactRequest(original, session, () => '', session.preamble())
    expect(JSON.stringify(original)).toBe(before)
    expect(verdict).toEqual({ kind: 'proceed' })
    expect(report.countsByClass).toEqual({ COMPANY: 1, PERSON: 3, PHONE: 2 })
    const [system, user, assistant, tool] = options.messages
    expect(system!.content).toEqual([
      { type: 'text', text: 'Ești asistentul firmei ⟦COMPANY_1⟧.' },
      { type: 'text', text: `\n\n${session.preamble()}` },
    ])
    expect(user!.content).toEqual([{ type: 'text', text: 'Trimite un SMS lui ⟦PERSON_1⟧ la ⟦PHONE_1⟧.' }])
    expect(assistant!.content).toEqual([{ type: 'tool-call', id: callId, name: 'send_sms', arguments: '{"to":"⟦PHONE_1⟧","text":"Salut, ⟦PERSON_1_2⟧!"}' }])
    expect(tool!.content).toEqual([{ type: 'text', text: 'SMS trimis lui ⟦PERSON_1⟧.' }])
  })

  it('blocks the whole request when one field is blocked', () => {
    const session = engine.session()
    const options = request()
    const blocked = redactRequest({ ...options, system: 'Card 4111 1111 1111 1111' }, session, () => '', undefined)
    expect(blocked.verdict).toMatchObject({ kind: 'blocked', classId: 'CARD' })
  })
})

describe('stream restoration', () => {
  it('restores split text and tool arguments before assembly', async () => {
    const session = engine.session()
    redactRequest(request(), session, () => '', undefined)
    let report: RestoreReport | undefined
    const out = await collect(restoreStream(chunks(
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Am trimis lui ⟦PERS' },
      { type: 'text-delta', index: 0, text: 'ON_1⟧ de la ⟦COMPANY_1⟧.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Am trimis lui ⟦PERSON_1⟧ de la ⟦COMPANY_1⟧.' } },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 1, id: callId, name: 'send_sms', argumentsDelta: '{"to":"⟦PH' },
      { type: 'tool-call-delta', index: 1, id: callId, argumentsDelta: 'ONE_1⟧"}' },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: callId, name: 'send_sms', arguments: '{"to":"⟦PHONE_1⟧"}' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ), session, (value) => { report = value }))
    const text = out.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join('')
    const args = out.flatMap(chunk => chunk.type === 'tool-call-delta' ? [chunk.argumentsDelta] : []).join('')
    expect(text).toBe('Am trimis lui Ion Popescu de la Acme.')
    expect(args).toBe('{"to":"069123456"}')
    expect(out.find(chunk => chunk.type === 'block-end' && chunk.index === 0)).toMatchObject({ block: { text: 'Am trimis lui Ion Popescu de la Acme.' } })
    expect(out.find(chunk => chunk.type === 'block-end' && chunk.index === 1)).toMatchObject({ block: { arguments: '{"to":"069123456"}' } })
    expect(out.at(-1)).toEqual({ type: 'finish', reason: { kind: 'tool-calls' } })
    expect(report?.restored).toBeGreaterThanOrEqual(3)
  })
})

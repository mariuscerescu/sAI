import { describe, expect, it } from 'vitest'
import type { GenerateOptions, StreamChunk, ToolCallId } from '@deepseek-ai/dsh-llm'
import { ModelViewStore } from '../src/view.ts'

const callId = 'c1' as ToolCallId

describe('model view store', () => {
  it('records the request as sent and the raw answer as streamed', async () => {
    const store = new ModelViewStore(() => 10)
    const request: GenerateOptions = {
      provider: 'p', model: 'm',
      messages: [
        { id: 's' as never, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'Asistent pentru ⟦COMPANY_1⟧.' }] },
        { id: 'd' as never, role: 'developer', source: { kind: 'user' }, content: [] },
        { id: 'u' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Sună pe ⟦PERSON_1⟧.' }] },
      ],
    }
    const tap = store.begin('s1', 'typed', request)
    expect(store.get('s1')).toMatchObject({ strategy: 'typed', complete: false, reply: [] })
    async function* upstream(): AsyncIterable<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'Îl sun pe ⟦PERS' }
      yield { type: 'text-delta', index: 0, text: 'ON_1⟧.' }
      yield { type: 'tool-call-delta', index: 1, id: callId, name: 'call', argumentsDelta: '{"to":"⟦PHONE_1⟧"}' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
    for await (const _chunk of tap(upstream())) { /* drain */ }
    expect(store.get('s1')).toEqual({
      strategy: 'typed',
      sentAt: expect.any(Number),
      messages: [
        { role: 'system', blocks: [{ kind: 'text', text: 'Asistent pentru ⟦COMPANY_1⟧.' }] },
        { role: 'user', origin: 'person', blocks: [{ kind: 'text', text: 'Sună pe ⟦PERSON_1⟧.' }] },
      ],
      reply: [{ kind: 'text', text: 'Îl sun pe ⟦PERSON_1⟧.' }, { kind: 'tool-call', text: '{"to":"⟦PHONE_1⟧"}', name: 'call' }],
      complete: true,
    })
  })

  it('forgets the least recently updated Session beyond its capacity', () => {
    const store = new ModelViewStore(() => 1)
    store.begin('a', 'typed', { provider: 'p', model: 'm', messages: [] })
    store.begin('b', 'typed', { provider: 'p', model: 'm', messages: [] })
    expect(store.get('a')).toBeUndefined()
    expect(store.get('b')).toBeDefined()
  })
})

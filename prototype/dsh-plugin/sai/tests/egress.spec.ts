/**
 * Every channel the audit found: developer messages, tool descriptions, images,
 * tools that send their arguments off the computer, feedback telemetry, and the
 * DeepSeek session-log field.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/core/index.ts'
import { guardEgress, redactPayload } from '../src/egress.ts'
import { redactRequest, restoreStream } from '../src/request.ts'

const engine = new Engine({ vocabulary: [{ id: 'p', class: 'PERSON', terms: ['Ion Popescu'] }, { id: 'c', class: 'COMPANY', terms: ['Acme Corp'] }] })
const fileText = (): string => ''
const request = (messages: unknown[], extra: Partial<GenerateOptions> = {}): GenerateOptions =>
  ({ provider: 'p', model: 'm', messages, ...extra }) as unknown as GenerateOptions

describe('model request', () => {
  it('redacts developer messages and keeps their tool updates', () => {
    const out = redactRequest(request([{ role: 'developer', content: [
      { type: 'text', text: 'Context: Ion Popescu works at Acme.' }, { type: 'tool-addition', toolName: 'crm_lookup' },
    ] }]), engine.session(), fileText, undefined)
    const sent = JSON.stringify(out.options.messages)
    expect(sent).not.toMatch(/Popescu|Acme/)
    expect(sent).toContain('crm_lookup')
  })

  it('redacts tool descriptions and keeps names and schema structure', () => {
    const tools = [{ name: 'crm_lookup', description: 'Look up clients of Ion Popescu.', parameters: {
      type: 'object', properties: { client: { type: 'string', description: 'For example Acme Corp.' } }, required: ['client'],
    } }]
    const out = redactRequest(request([], { tools }), engine.session(), fileText, undefined)
    expect(JSON.stringify(out.options.tools)).not.toMatch(/Popescu|Acme/)
    expect(out.options.tools![0]!.name).toBe('crm_lookup')
    expect(out.options.tools![0]!.parameters).toMatchObject({ type: 'object', required: ['client'], properties: { client: { type: 'string' } } })
  })

  it('refuses an image unless images are allowed', () => {
    const withImage = request([{ role: 'user', content: [{ type: 'text', text: 'Who is this?' }, { type: 'image', attachment: {} }] }])
    expect(redactRequest(withImage, engine.session(), fileText, undefined).verdict).toEqual({ kind: 'blocked', code: 'IMAGE_NOT_INSPECTABLE' })
    expect(redactRequest(withImage, engine.session(), fileText, undefined, { images: 'allow' }).verdict.kind).toBe('proceed')
    const offloaded = request([{ role: 'user', content: [{ type: 'image', attachment: {}, offloaded: true }] }])
    expect(redactRequest(offloaded, engine.session(), fileText, undefined).verdict.kind).toBe('proceed')
  })
})

describe('tool calls', () => {
  async function run(name: string): Promise<string> {
    const session = engine.session()
    const token = session.redact('Ion Popescu').report.tokensUsed[0]!
    const args = JSON.stringify({ query: `${token} contracts` })
    async function* upstream(): AsyncIterable<StreamChunk> {
      yield { type: 'tool-call-delta', index: 0, id: 't1' as never, name, argumentsDelta: args.slice(0, 7) }
      yield { type: 'tool-call-delta', index: 0, id: 't1' as never, argumentsDelta: args.slice(7) }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: 't1' as never, name, arguments: args } }
      yield { type: 'finish', reason: { kind: 'stop' } } as StreamChunk
    }
    let streamed = ''
    let final = ''
    for await (const chunk of restoreStream(upstream(), session, () => {}, ['web_search', 'mcp__*'])) {
      if (chunk.type === 'tool-call-delta') streamed += chunk.argumentsDelta
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') final = chunk.block.arguments
    }
    expect(streamed).toBe(final)
    return final
  }

  it('restores the arguments of a local tool', async () => {
    expect(await run('write_file')).toContain('Ion Popescu')
  })

  it('keeps the symbols in the arguments of a tool that sends them off the computer', async () => {
    for (const name of ['web_search', 'mcp__crm__find']) {
      const args = await run(name)
      expect(args).not.toContain('Popescu')
      expect(args).toContain('PERSON_1')
    }
  })
})

describe('Session-log channels', () => {
  const event = { type: 'message', id: 'm1', role: 'user', data: { content: [{ type: 'text', text: 'Ion Popescu signed with Acme.' }] } }

  it('redacts content and keeps identity fields', () => {
    const out = JSON.stringify(redactPayload(engine.session(), event))
    expect(out).not.toMatch(/Popescu|Acme/)
    expect(out).toContain('"type":"message"')
    expect(out).toContain('"role":"user"')
  })

  /** A minimal stand-in for the Cordis context: events, optional services, and effects. */
  function fakeContext(registry: { prepare: (request: { sessionId?: string }) => Promise<{ fields: Record<string, unknown>; accept(): Promise<void> }> }) {
    const listeners = new Map<string, (value: unknown, next: () => unknown) => unknown>()
    const context = {
      on: (name: string, listener: (value: unknown, next: () => unknown) => unknown) => { listeners.set(name, listener) },
      inject: (_deps: string[], callback: (child: unknown) => void) => { callback({ deepseekLlmApiExtensions: registry, effect: () => {} }) },
      effect: () => {},
    }
    return { context: context as unknown as Context, listeners }
  }

  it('redacts feedback telemetry and the DeepSeek session-log field', async () => {
    const session = engine.session()
    const registry = {
      prepare: async (_request: { sessionId?: string }) =>
        ({ fields: { dsh_session_log: { events: [event] }, dsh_plugin_packages: ['x'] } as Record<string, unknown>, accept: async () => {} }),
    }
    const { context, listeners } = fakeContext(registry)
    guardEgress(context, () => session, () => {})

    const record = { sourceEvent: { sessionId: 's1' }, channel: 'ledger', attributes: { 'session.id': 's1', 'session.cwd': 'C:\\Ion Popescu\\work' }, body: event.data }
    const sent = listeners.get('session-telemetry/record')!(record, () => record) as typeof record
    expect(JSON.stringify(sent)).not.toMatch(/Popescu|Acme/)
    expect(sent.attributes['session.id']).toBe('s1')

    const prepared = await registry.prepare({ sessionId: 's1' })
    expect(JSON.stringify(prepared.fields['dsh_session_log'])).not.toMatch(/Popescu|Acme/)
    expect(prepared.fields['dsh_plugin_packages']).toEqual(['x'])
  })

  it('passes everything through while sAI is off', async () => {
    const registry = { prepare: async (_request: { sessionId?: string }) => ({ fields: { dsh_session_log: { events: [event] } } as Record<string, unknown>, accept: async () => {} }) }
    const { context, listeners } = fakeContext(registry)
    guardEgress(context, () => 'off', () => {})
    const record = { body: event.data }
    expect(listeners.get('session-telemetry/record')!(record, () => record)).toBe(record)
    expect(JSON.stringify((await registry.prepare({ sessionId: 's1' })).fields)).toContain('Popescu')
  })
})

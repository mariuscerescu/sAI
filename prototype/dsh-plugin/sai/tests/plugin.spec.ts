import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import * as sai from '../src/index.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })

/** Records what the provider would receive and answers by echoing the user text. */
class EchoAdapter extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    const last = options.messages.at(-1)!
    const text = last.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
    const answer = `Ai scris: ${text}`
    yield { type: 'block-start', index: 0, blockType: 'text' }
    // Split mid-symbol to exercise the holdback.
    for (let at = 0; at < answer.length; at += 5) yield { type: 'text-delta', index: 0, text: answer.slice(at, at + 5) }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

async function setup(config: Record<string, unknown>): Promise<{ ctx: Context; adapter: EchoAdapter }> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(sai, config)
  const adapter = new EchoAdapter()
  ctx.llm.registerAdapter(['echo'], adapter)
  return { ctx, adapter }
}

async function run(ctx: Context, text: string): Promise<{ text: string; chunks: StreamChunk[] }> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({
    provider: 'echo', model: 'echo', sessionId: 'session-1' as never,
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
  })) chunks.push(chunk)
  return { text: chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join(''), chunks }
}

const vocabulary = [{ class: 'COMPANY', terms: ['Acme Logistic', 'Acme'] }, { class: 'PERSON', terms: ['Ion Popescu'] }]

describe('sAI plugin on the llm/stream waterfall', () => {
  it('sends only symbols to the provider and restores the answer', async () => {
    const { ctx, adapter } = await setup({ vocabulary })
    const result = await run(ctx, 'Ion Popescu de la Acme, tel. 069123456.')
    const sent = adapter.seen[0]!
    expect(JSON.stringify(sent.messages)).not.toMatch(/Popescu|Acme|069123456/)
    expect(sent.messages.at(-1)!.content).toEqual([{ type: 'text', text: '⟦PERSON_1⟧ de la ⟦COMPANY_1⟧, tel. ⟦PHONE_1⟧.' }])
    expect(sent.system).toContain('⟦CLASS_N⟧')
    expect(result.text).toBe('Ai scris: Ion Popescu de la Acme, tel. 069123456.')
  })

  it('uses Greek letters when configured', async () => {
    const { ctx, adapter } = await setup({ vocabulary, strategy: 'greek' })
    const result = await run(ctx, 'Ion Popescu de la Acme.')
    const sent = (adapter.seen[0]!.messages.at(-1)!.content[0] as { text: string }).text
    expect(sent).toMatch(/^\p{Script=Greek} de la \p{Script=Greek}\.$/u)
    expect(result.text).toBe('Ai scris: Ion Popescu de la Acme.')
  })

  it('passes requests through unchanged when disabled', async () => {
    const { ctx, adapter } = await setup({ vocabulary, enabled: false })
    await run(ctx, 'Acme')
    expect(adapter.seen[0]!.messages.at(-1)!.content).toEqual([{ type: 'text', text: 'Acme' }])
  })

  it('refuses to send a blocked request', async () => {
    const { ctx, adapter } = await setup({ vocabulary })
    const result = await run(ctx, 'Card 4111 1111 1111 1111')
    expect(adapter.seen).toHaveLength(0)
    expect(result.chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: sai.SAI_BLOCKED } } })
  })
})

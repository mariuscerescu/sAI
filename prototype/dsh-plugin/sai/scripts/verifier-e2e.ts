/**
 * End-to-end test of sAI (rules: eval/frozen-en/SPEC.md, section 11): the real plugin, the real local verifier, and a fake
 * local provider that records what a provider would receive. Nothing leaves the computer. Part B reads only the CALIBRATION
 * part of the frozen set, whose hash is checked. Start the service first (verifier/decider_server.py), then from the DSH root:
 *   node --import tsx/esm packages/experimental/sai/scripts/verifier-e2e.ts [scenarios]
 * Writes totals only to eval/results/frozen-e2e.json. Differences on the set stay in sai-model-bench/results.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk, type ToolCallId, type ToolSchema } from '@deepseek-ai/dsh-llm'
import * as sai from '../src/index.ts'
import { Engine, questionKey, type VerifierAnswer, type VerifierQuestion, type VocabularyEntry } from '../src/core/index.ts'

const SAI = 'D:\\Disk D 13-09-25\\EC\\sAI'
const BENCH = 'D:\\Disk D 13-09-25\\EC\\sai-model-bench'
const SERVICE = 'http://127.0.0.1:8765/verify'
const PROXY_PORT = 8766
const PROXY = `http://127.0.0.1:${PROXY_PORT}/verify`
const SYMBOL = /⟦[A-Z][A-Z0-9_]*_\d+⟧/
const SYMBOLS = /⟦[A-Z][A-Z0-9_]*_\d+⟧/g

/** Recording proxy in front of the service: counts calls and keeps the answers of the last ones. */
const calls: { questions: VerifierQuestion[]; answers: VerifierAnswer[] }[] = []
const proxy = createServer((request, response) => {
  const parts: Buffer[] = []
  request.on('data', part => parts.push(part as Buffer))
  request.on('end', () => void (async () => {
    try {
      if (request.url === '/slow') {
        await sleep(3000)
        response.writeHead(503).end()
        return
      }
      const body = Buffer.concat(parts).toString('utf8')
      const upstream = await fetch(SERVICE, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
      const text = await upstream.text()
      if (upstream.ok) {
        calls.push({ questions: (JSON.parse(body) as { questions: VerifierQuestion[] }).questions, answers: (JSON.parse(text) as { answers: VerifierAnswer[] }).answers })
      }
      response.writeHead(upstream.status, { 'content-type': 'application/json' }).end(text)
    } catch {
      if (!response.destroyed) response.destroy()
    }
  })())
})

const textOf = (options: GenerateOptions): string => options.messages.at(-1)!.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')

function echo(options: GenerateOptions): StreamChunk[] {
  const answer = textOf(options)
  const chunks: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'text' }]
  for (let at = 0; at < answer.length; at += 5) chunks.push({ type: 'text-delta', index: 0, text: answer.slice(at, at + 5) })
  chunks.push({ type: 'block-end', index: 0, block: { type: 'text', text: answer } }, { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'stop' } })
  return chunks
}

/** The fake provider: records every request as the adapter receives it. */
class Provider extends LlmAdapter {
  readonly seen: GenerateOptions[] = []
  reply: (options: GenerateOptions) => StreamChunk[] = echo
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    yield* this.reply(options)
  }
}

async function setup(config: Record<string, unknown>): Promise<{ ctx: Context; provider: Provider }> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(sai, config)
  const provider = new Provider()
  ctx.llm.registerAdapter(['stub'], provider)
  return { ctx, provider }
}

async function send(ctx: Context, options: Omit<GenerateOptions, 'provider' | 'model'>): Promise<{ text: string; chunks: StreamChunk[] }> {
  const chunks: StreamChunk[] = []
  for await (const chunk of ctx.llm.stream({ provider: 'stub', model: 'stub', ...options })) chunks.push(chunk)
  return { text: chunks.flatMap(chunk => chunk.type === 'text-delta' ? [chunk.text] : []).join(''), chunks }
}

const user = (text: string): GenerateOptions['messages'][number] => ({ role: 'user', content: [{ type: 'text', text }] })
const verifierAt = (url: string, timeoutMs = 60_000) => ({ enabled: true, mode: 'all', url, threshold: 0.2, timeoutMs, descriptions: {} })

// Part A: fictitious names that are never ordinary words, plus one that is ("Bill").
const VOCABULARY: VocabularyEntry[] = [
  { id: 'p1', class: 'PERSON', terms: ['Ysolde Vantoor'] },
  { id: 'p2', class: 'PERSON', terms: ['Bill Turner'] },
  { id: 'c1', class: 'COMPANY', terms: ['Quillon Systems'] },
  { id: 'c2', class: 'COMPANY', terms: ['Pellham Energy'] },
]
const FORBIDDEN = /ysolde|vantoor|turner|quillon|pellham|\bBill\b/i

function fullRequest(): Omit<GenerateOptions, 'provider' | 'model'> {
  const callId = 'call-1' as ToolCallId
  const tool: ToolSchema = {
    name: 'lookup_client', description: 'Looks up Quillon Systems contacts for Ysolde Vantoor.',
    parameters: { type: 'object', title: 'Lookup for Pellham Energy', description: 'A client such as Bill Turner',
      properties: { client: { type: 'string', description: 'For example Quillon Systems', examples: ['Pellham Energy'] } } },
  }
  return {
    sessionId: 'e2e-fields' as never,
    tools: [tool],
    toolHistory: { tools: [tool], updates: [{ messageId: 'u1' as never, additions: [tool] }] },
    messages: [
      { id: 's1' as never, role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: 'You assist Ysolde Vantoor at Quillon Systems.' }] },
      { id: 'u1' as never, role: 'user', source: { kind: 'user' }, content: [
        { type: 'text', text: 'Send the report to Bill Turner at Pellham Energy.' },
        { type: 'file', attachment: { attachmentId: `sha256:${'a'.repeat(64)}` as never, name: 'Ysolde_Vantoor_contract.pdf', bytes: 1024 } },
      ] },
      { id: 'a1' as never, role: 'assistant', source: { kind: 'model', provider: 'stub', model: 'stub' }, content: [
        { type: 'reasoning', text: 'Ysolde Vantoor wants Pellham Energy informed.' },
        { type: 'text', text: 'I will contact Bill Turner.' },
        { type: 'tool-call', id: callId, name: 'lookup_client', arguments: '{"to":"Bill Turner","company":{"name":"Quillon Systems"},"cc":["Ysolde Vantoor"]}' },
      ] },
      { id: 't1' as never, role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text: 'Delivered to Bill Turner at Pellham Energy.' }] },
      { id: 'u2' as never, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Thanks. Tell Vantoor and Quillon too.' }] },
    ],
  }
}

type Check = readonly [string, boolean, string?]

async function scenario(name: string, run: () => Promise<readonly Check[]>): Promise<{ name: string; pass: boolean; checks: { what: string; pass: boolean; detail?: string }[] }> {
  try {
    const checks = (await run()).map(([what, pass, detail]) => ({ what, pass, ...pass || detail === undefined ? {} : { detail } }))
    return { name, pass: checks.every(check => check.pass), checks }
  } catch (error) {
    return { name, pass: false, checks: [{ what: 'ran', pass: false, detail: error instanceof Error ? error.message : String(error) }] }
  }
}

async function partA() {
  const base = { vocabulary: VOCABULARY, languages: ['en'] }
  const results = []
  const withSetup = async <T>(config: Record<string, unknown>, body: (ctx: Context, provider: Provider) => Promise<T>): Promise<T> => {
    const { ctx, provider } = await setup(config)
    try {
      return await body(ctx, provider)
    } finally {
      await ctx.fiber.dispose()
    }
  }

  results.push(await scenario('every field of a request', () => withSetup({ ...base, verifier: verifierAt(PROXY) }, async (ctx, provider) => {
    const before = calls.length
    await send(ctx, fullRequest())
    const first = calls.length - before
    const sent = JSON.stringify(provider.seen[0])
    const found = FORBIDDEN.exec(sent)?.[0]
    await send(ctx, fullRequest())
    return [
      ['request reached the provider', provider.seen.length === 2],
      ['no vocabulary value in any field', found === undefined, found],
      ['symbols are present', SYMBOL.test(sent)],
      ['no file block reaches the provider', !sent.includes('"type":"file"')],
      ['at most one verifier call', first <= 1, String(first)],
      ['the same request again makes no call', calls.length - before === first, String(calls.length - before - first)],
    ] as const
  })))

  results.push(await scenario('a conversation keeps its symbols', () => withSetup({ ...base, verifier: verifierAt(PROXY) }, async (ctx, provider) => {
    const sessionId = 'e2e-turns' as never
    const first = await send(ctx, { sessionId, messages: [user('Ysolde Vantoor joined Quillon Systems.')] })
    await send(ctx, { sessionId, messages: [
      user('Ysolde Vantoor joined Quillon Systems.'),
      { id: 'a' as never, role: 'assistant', source: { kind: 'model', provider: 'stub', model: 'stub' }, content: [{ type: 'text', text: first.text }] },
      user('Does Ysolde Vantoor still work at Quillon Systems, or has Quillon moved?'),
    ] })
    const a = textOf(provider.seen[0]!).match(SYMBOLS) ?? []
    const b = textOf(provider.seen[1]!).match(SYMBOLS) ?? []
    const all = JSON.stringify(provider.seen)
    return [
      ['the answer is restored', first.text === 'Ysolde Vantoor joined Quillon Systems.', first.text],
      ['no vocabulary value in either request', !FORBIDDEN.test(all), FORBIDDEN.exec(all)?.[0]],
      ['same written person, same symbol', a[0] !== undefined && a[0] === b[0], `${a[0]} / ${b[0]}`],
      ['same written company, same symbol', a[1] !== undefined && a[1] === b[1], `${a[1]} / ${b[1]}`],
      ['a shorter form of the company has a related symbol', a[1] !== undefined && b[2] === `${a[1].slice(0, -1)}_2⟧`, `${a[1]} / ${b[2]}`],
    ] as const
  })))

  results.push(await scenario('a name and the same word as an ordinary word', () => withSetup({ ...base, verifier: verifierAt(PROXY) }, async (ctx, provider) => {
    await send(ctx, { sessionId: 'e2e-bill' as never, messages: [user('Call Bill tomorrow about the unpaid bill.')] })
    const sent = textOf(provider.seen[0]!)
    return [['the name is masked, the ordinary word stays', /^Call ⟦PERSON_\d+⟧ tomorrow about the unpaid bill\.$/.test(sent), sent]] as const
  })))

  results.push(await scenario('the answer is restored, tools included', () => withSetup({ ...base, externalTools: ['web_search'], verifier: verifierAt(PROXY) }, async (ctx, provider) => {
    const local = 'call-local' as ToolCallId
    const external = 'call-external' as ToolCallId
    provider.reply = (options) => {
      const token = SYMBOL.exec(textOf(options))?.[0] ?? 'NONE'
      const text = `Hello ${token}, done.`
      const cut = text.indexOf(token) + 3
      const args = `{"to":"${token}"}`
      const argsCut = args.indexOf(token) + 2
      return [
        { type: 'block-start', index: 0, blockType: 'text' },
        { type: 'text-delta', index: 0, text: text.slice(0, cut) }, { type: 'text-delta', index: 0, text: text.slice(cut) },
        { type: 'block-end', index: 0, block: { type: 'text', text } },
        { type: 'block-start', index: 1, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 1, id: local, name: 'send_message', argumentsDelta: args.slice(0, argsCut) },
        { type: 'tool-call-delta', index: 1, id: local, argumentsDelta: args.slice(argsCut) },
        { type: 'block-end', index: 1, block: { type: 'tool-call', id: local, name: 'send_message', arguments: args } },
        { type: 'block-start', index: 2, blockType: 'tool-call' },
        { type: 'tool-call-delta', index: 2, id: external, name: 'web_search', argumentsDelta: args },
        { type: 'block-end', index: 2, block: { type: 'tool-call', id: external, name: 'web_search', arguments: args } },
        { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, { type: 'finish', reason: { kind: 'tool-calls' } },
      ]
    }
    const { text, chunks } = await send(ctx, { sessionId: 'e2e-restore' as never, messages: [user('Greet Ysolde Vantoor.')] })
    const ended = chunks.flatMap(chunk => chunk.type === 'block-end' && chunk.block.type === 'tool-call' ? [chunk.block] : [])
    const localArgs = ended.find(block => block.name === 'send_message')?.arguments ?? ''
    const externalArgs = ended.find(block => block.name === 'web_search')?.arguments ?? ''
    return [
      ['text restored across cut chunks', text === 'Hello Ysolde Vantoor, done.', text],
      ['local tool arguments restored', localArgs === '{"to":"Ysolde Vantoor"}', localArgs],
      ['external tool arguments keep the symbol', SYMBOL.test(externalArgs) && !FORBIDDEN.test(externalArgs), externalArgs],
    ] as const
  })))

  results.push(await scenario('a blocked message never reaches the provider', () => withSetup({ ...base, verifier: verifierAt(PROXY) }, async (ctx, provider) => {
    const { chunks } = await send(ctx, { sessionId: 'e2e-card' as never, messages: [user('Ysolde Vantoor pays with card 4111 1111 1111 1111.')] })
    const last = chunks.at(-1)
    return [
      ['nothing was sent', provider.seen.length === 0, String(provider.seen.length)],
      ['the request ends with the sAI refusal', last?.type === 'finish' && last.reason.kind === 'error' && last.reason.failure.code === sai.SAI_BLOCKED, JSON.stringify(last)],
    ] as const
  })))

  const failing = async (url: string, timeoutMs: number): Promise<readonly Check[]> => withSetup({ ...base, verifier: verifierAt(url, timeoutMs) }, async (ctx, provider) => {
    await send(ctx, { sessionId: 'e2e-down' as never, messages: [user('Ask Vantoor and Quillon about the bill.')] })
    const sent = provider.seen[0] === undefined ? '' : textOf(provider.seen[0])
    return [
      ['the request is still sent', provider.seen.length === 1],
      ['no vocabulary value', !FORBIDDEN.test(sent), sent],
      ['unsure words are masked', !/\bbill\b/i.test(sent), sent],
    ] as const
  })
  results.push(await scenario('the verifier is not running', () => failing('http://127.0.0.1:8799/verify', 5000)))
  results.push(await scenario('the verifier is too slow', () => failing(`http://127.0.0.1:${PROXY_PORT}/slow`, 300)))

  results.push(await scenario('the verifier is off in the settings', async () => {
    const texts = ['Ask bill and Ysolde Vantoor about Quillon.', 'Call Bill tomorrow about the unpaid bill.', 'turner and pellham energy paid']
    const out: Check[] = []
    const before = calls.length
    for (const text of texts) {
      const expected = new Engine({ vocabulary: VOCABULARY, languages: ['en'] }).session().redact(text).text
      const sent = await withSetup({ ...base, verifier: { enabled: false } }, async (ctx, provider) => {
        await send(ctx, { sessionId: 'e2e-off' as never, messages: [user(text)] })
        return textOf(provider.seen[0]!)
      })
      out.push([`same as before: ${text}`, sent === expected, `${sent} / ${expected}`])
    }
    out.push(['no verifier call', calls.length === before, String(calls.length - before)])
    return out
  }))
  return results
}

// Part B: every calibration message through the plugin.
interface Case { id: string; variant: string; languages: string[]; vocabulary: VocabularyEntry[]; text: string; checks: { start: number; end: number; word: string; masked: boolean }[] }

async function partB() {
  const body = readFileSync(join(BENCH, 'data', 'frozen-en', 'calibration.jsonl'))
  const manifest = JSON.parse(readFileSync(join(SAI, 'eval', 'frozen-en', 'manifest.json'), 'utf8')) as { parts: Record<string, { sha256: string }> }
  if (createHash('sha256').update(body).digest('hex') !== manifest.parts['calibration']!.sha256) throw new Error('the calibration part does not match the manifest')
  const cases = body.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as Case)
  const reviewFile = join(SAI, 'eval', 'frozen-en', 'calibration-label-review.json')
  const reviewed = new Set(existsSync(reviewFile) ? (JSON.parse(readFileSync(reviewFile, 'utf8')) as { cases: { id: string; variant: string; start: number; word: string }[] }).cases.map(r => `${r.id}|${r.variant}|${r.start}|${r.word}`) : [])
  const t = { messages: cases.length, sent: 0, blocked: 0, blockedSent: 0, moreThanOneCall: 0, differentFromDirect: 0, names: 0, leaked: 0, reviewedLeaks: 0, ordinary: 0, overMasked: 0, symbolsLeftInAnswer: 0, answerIdentical: 0, answerDiffers: 0, errors: 0 }
  const differences: unknown[] = []
  const started = performance.now()
  for (const [index, c] of cases.entries()) {
    const verifier = verifierAt(PROXY)
    const { ctx, provider } = await setup({ vocabulary: c.vocabulary, languages: c.languages, verifier })
    const before = calls.length
    try {
      const { text: answer } = await send(ctx, { sessionId: `e2e-${index}` as never, messages: [user(c.text)] })
      const made = calls.length - before
      if (made > 1) t.moreThanOneCall++
      const replies = new Map<string, VerifierAnswer>()
      for (const call of calls.slice(before)) call.questions.forEach((q, k) => replies.set(questionKey(q), call.answers[k]!))
      calls.length = before
      const direct = new Engine({ vocabulary: c.vocabulary, languages: c.languages, verifier: verifier as never }).session()
      const questions = direct.questions(c.text)
      direct.answer(questions, questions.map(q => replies.get(questionKey(q)) as VerifierAnswer))
      const expected = direct.redact(c.text)
      if (expected.verdict.kind === 'blocked') {
        t.blocked++
        if (provider.seen.length > 0) t.blockedSent++
        continue
      }
      t.sent++
      const outgoing = provider.seen[0] === undefined ? undefined : textOf(provider.seen[0])
      if (outgoing !== expected.text) {
        t.differentFromDirect++
        differences.push({ id: c.id, variant: c.variant, outgoing, expected: expected.text })
      }
      for (const k of c.checks) {
        const masked = expected.decisions.some(({ span, action }) => action !== 'ignore' && span.start < k.end && k.start < span.end)
        if (k.masked && reviewed.has(`${c.id}|${c.variant}|${k.start}|${k.word}`)) {
          if (!masked) t.reviewedLeaks++
        } else if (k.masked) {
          t.names++
          if (!masked) t.leaked++
        } else {
          t.ordinary++
          if (masked) t.overMasked++
        }
      }
      if (SYMBOL.test(answer)) t.symbolsLeftInAnswer++
      if (answer === c.text) t.answerIdentical++
      else t.answerDiffers++
    } catch (error) {
      t.errors++
      differences.push({ id: c.id, variant: c.variant, error: error instanceof Error ? error.message : String(error) })
    } finally {
      calls.length = before
      await ctx.fiber.dispose()
    }
    if ((index + 1) % 250 === 0) console.log(`set: ${index + 1}/${cases.length} in ${Math.round((performance.now() - started) / 1000)} s`)
  }
  writeFileSync(join(BENCH, 'results', 'frozen-e2e-differences.json'), JSON.stringify(differences, null, 1))
  const pass = t.differentFromDirect === 0 && t.leaked === 0 && t.moreThanOneCall === 0 && t.blockedSent === 0 && t.symbolsLeftInAnswer === 0 && t.errors === 0
  return { ...t, pass }
}

await new Promise<void>(resolve => proxy.listen(PROXY_PORT, '127.0.0.1', resolve))
const scenarios = await partA()
for (const s of scenarios) {
  console.log(`${s.pass ? 'PASS' : 'FAIL'}  ${s.name}`)
  for (const check of s.checks) if (!check.pass) console.log(`      failed: ${check.what}${check.detail === undefined ? '' : ` -> ${check.detail}`}`)
}
const set = process.argv[2] === 'scenarios' ? undefined : await partB()
if (set !== undefined) console.log('set', JSON.stringify(set))
proxy.closeAllConnections()
proxy.close()
if (set !== undefined) {
  writeFileSync(join(SAI, 'eval', 'results', 'frozen-e2e.json'), `${JSON.stringify({ part: 'calibration', rule: 'SPEC.md section 11', mode: 'all', threshold: 0.2,
    scenarios: scenarios.map(s => ({ name: s.name, pass: s.pass, checks: s.checks.length })), set, pass: set.pass && scenarios.every(s => s.pass) }, null, 1)}\n`)
}
console.log(`end-to-end done: scenarios ${scenarios.filter(s => s.pass).length}/${scenarios.length}${set === undefined ? '' : `, set ${set.pass ? 'pass' : 'fail'}`}`)
process.exit(0)

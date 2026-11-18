/**
 * Request and stream projection of the sAI core: every text field of a model
 * request is redacted through one session in conversation order, and every
 * streamed text, reasoning, and tool-argument block is restored before the
 * harness assembles and logs it.
 */

import type {
  ContentBlock, FileBlock, GenerateOptions, RequestMessage, StreamChunk, ToolHistory, ToolSchema,
} from '@deepseek-ai/dsh-llm'
import {
  isExternalTool, RedactionBatch, TextCollector, type RedactReport, type RestoreReport, type Session, type StreamRestorer, type Verdict,
} from './core/index.ts'

/** Projects a durable file reference to the text adapters would send for it. */
export type FileTextOf = (block: FileBlock) => string

/** What a request may carry besides text. */
export interface RequestPolicy {
  /** `block` refuses a request with an image that would reach the model as pixels. */
  readonly images: 'block' | 'allow'
}

/** Outcome of redacting one request. */
export interface RedactedRequest {
  readonly options: GenerateOptions
  readonly verdict: Verdict
  readonly report: RedactReport
}

/** JSON Schema keys whose strings are structure, not prose: property names, types, formats, patterns. */
const SCHEMA_KEYS: ReadonlySet<string> = new Set(['type', 'format', 'pattern', '$ref', '$schema', '$id', 'required', 'enum', 'const', 'default'])

/**
 * Redact one request into a new, independent request value.
 * @param options - the request as the harness built it; never mutated.
 * @param session - session whose vault keeps symbols consistent across requests.
 * @param fileText - file-reference projection, so file names and paths are redacted too.
 * @param preamble - model-facing explanation appended to the effective system prompt, or undefined.
 * @param policy - what the request may carry besides text.
 * @returns the redacted request, its verdict, and a value-free report.
 */
export function redactRequest(
  options: GenerateOptions,
  session: Session,
  fileText: FileTextOf,
  preamble: string | undefined,
  policy: RequestPolicy = { images: 'block' },
): RedactedRequest {
  const batch = new RedactionBatch(session)
  if (policy.images === 'block' && options.messages.some(message => message.content.some(block => block.type === 'image' && block.offloaded !== true))) {
    batch.refuse('IMAGE_NOT_INSPECTABLE')
  }
  const redacted = project(options, batch, fileText)
  const { verdict, report } = batch.result()
  return { options: preamble === undefined ? redacted : withPreamble(redacted, preamble), verdict, report }
}

/**
 * Every text {@link redactRequest} would redact, in the same order, so the verifier can be
 * asked about all of them in one call first.
 * @param options - the request as the harness built it.
 * @param session - session the request will be redacted with.
 * @param fileText - file-reference projection.
 * @returns the texts.
 */
export function requestTexts(options: GenerateOptions, session: Session, fileText: FileTextOf): string[] {
  const collector = new TextCollector(session)
  project(options, collector, fileText)
  return collector.texts
}

/** Pass every text field of a request through a batch, keeping the rest of the request. */
function project(options: GenerateOptions, batch: RedactionBatch, fileText: FileTextOf): GenerateOptions {
  const system = options.system === undefined ? undefined : batch.text(options.system)
  const messages = options.messages.map(message => redactMessage(message, batch, fileText))
  // Tool descriptions are prose a deployment or an MCP server writes, and may name people or clients.
  const tools = options.tools?.map(tool => redactTool(tool, batch))
  const toolHistory = options.toolHistory === undefined ? undefined : redactToolHistory(options.toolHistory, batch)
  return {
    ...options, messages,
    ...system === undefined ? {} : { system },
    ...tools === undefined ? {} : { tools },
    ...toolHistory === undefined ? {} : { toolHistory },
  }
}

function redactMessage(message: RequestMessage, batch: RedactionBatch, fileText: FileTextOf): RequestMessage {
  const content = message.content.map((block): ContentBlock => redactBlock(block, batch, fileText))
  return { ...message, content } as RequestMessage
}

function redactBlock(block: ContentBlock, batch: RedactionBatch, fileText: FileTextOf): ContentBlock {
  switch (block.type) {
    case 'text': return { ...block, text: batch.text(block.text) }
    case 'reasoning': return { ...block, text: batch.text(block.text) }
    case 'tool-call': return { ...block, arguments: batch.json(block.arguments) }
    // Adapters send file handles (name, size, saved path) as text; send that text redacted.
    case 'file': return { type: 'text', text: batch.text(fileText(block)) }
    // Images are refused by policy or sent as they are; tool additions and removals carry only tool names.
    default: return block
  }
}

function redactTool(tool: ToolSchema, batch: RedactionBatch): ToolSchema {
  return { ...tool, description: batch.text(tool.description), parameters: redactSchema(tool.parameters, batch) }
}

/** Redact the `description` and `title` prose of a JSON Schema, keeping its structure and property names. */
function redactSchema(schema: Record<string, unknown>, batch: RedactionBatch): Record<string, unknown> {
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    return Object.fromEntries(Object.entries(node).map(([key, value]) => {
      if ((key === 'description' || key === 'title') && typeof value === 'string') return [key, batch.text(value)]
      if (key === 'examples') return [key, batch.value(value, SCHEMA_KEYS)]
      return [key, walk(value)]
    }))
  }
  return walk(schema) as Record<string, unknown>
}

function redactToolHistory(history: ToolHistory, batch: RedactionBatch): ToolHistory {
  return {
    tools: history.tools.map(tool => redactTool(tool, batch)),
    updates: history.updates.map(update => ({ ...update, additions: update.additions.map(tool => redactTool(tool, batch)) })),
  }
}

/** Append the preamble to the latest system prompt, or create one. */
function withPreamble(options: GenerateOptions, preamble: string): GenerateOptions {
  let last = -1
  options.messages.forEach((message, index) => { if (message.role === 'system') last = index })
  if (last >= 0) {
    const messages = [...options.messages]
    const system = messages[last]!
    messages[last] = { ...system, content: [...system.content, { type: 'text', text: `\n\n${preamble}` }] } as RequestMessage
    return { ...options, messages }
  }
  return { ...options, system: options.system === undefined ? preamble : `${options.system}\n\n${preamble}` }
}

interface OpenBlock {
  readonly kind: 'text' | 'reasoning' | 'tool-call'
  readonly restorer: StreamRestorer
  toolCall?: Extract<StreamChunk, { type: 'tool-call-delta' }>
  /** A tool that sends its arguments off the computer: its arguments keep the symbols. */
  external?: boolean
}

/**
 * Restore every symbol in a model stream, holding back only the tail that
 * could still be part of a symbol.
 * @param upstream - the provider stream of the redacted request.
 * @param session - session that redacted the request.
 * @param onDone - receives the merged value-free restore report once the stream ends.
 * @param externalTools - tools whose arguments leave the computer and so are not restored.
 * @returns the restored stream; block-end blocks carry fully restored content.
 */
export async function* restoreStream(
  upstream: AsyncIterable<StreamChunk>,
  session: Session,
  onDone: (report: RestoreReport) => void,
  externalTools: readonly string[] = [],
): AsyncIterable<StreamChunk> {
  const open = new Map<number, OpenBlock>()
  const finished: StreamRestorer[] = []
  const blockFor = (index: number, kind: OpenBlock['kind']): OpenBlock => {
    let block = open.get(index)
    if (block === undefined) {
      block = { kind, restorer: session.streamRestorer(kind === 'tool-call' ? 'json-string' : 'text') }
      open.set(index, block)
    }
    return block
  }
  const flushChunk = (index: number, block: OpenBlock): StreamChunk | undefined => {
    const rest = block.restorer.flush()
    finished.push(block.restorer)
    open.delete(index)
    if (rest.length === 0) return undefined
    switch (block.kind) {
      case 'text': return { type: 'text-delta', index, text: rest }
      case 'reasoning': return { type: 'reasoning-delta', index, text: rest }
      case 'tool-call': return block.toolCall === undefined ? undefined : { ...block.toolCall, argumentsDelta: rest }
    }
  }
  try {
    for await (const chunk of upstream) {
      switch (chunk.type) {
        case 'text-delta': {
          const text = blockFor(chunk.index, 'text').restorer.push(chunk.text)
          if (text.length > 0) yield { ...chunk, text }
          break
        }
        case 'reasoning-delta': {
          const text = blockFor(chunk.index, 'reasoning').restorer.push(chunk.text)
          if (text.length > 0) yield { ...chunk, text }
          break
        }
        case 'tool-call-delta': {
          const block = blockFor(chunk.index, 'tool-call')
          if (chunk.name !== undefined) block.external = isExternalTool(chunk.name, externalTools)
          if (block.external === true) { yield chunk; break }
          block.toolCall = { type: 'tool-call-delta', index: chunk.index, id: chunk.id, argumentsDelta: '' }
          const argumentsDelta = block.restorer.push(chunk.argumentsDelta)
          // The first delta may carry the tool name with no arguments yet; it is always forwarded.
          if (argumentsDelta.length > 0 || chunk.name !== undefined) yield { ...chunk, argumentsDelta }
          break
        }
        case 'block-end': {
          const block = open.get(chunk.index)
          if (block !== undefined) {
            const rest = flushChunk(chunk.index, block)
            if (rest !== undefined) yield rest
          }
          const external = chunk.block.type === 'tool-call' && isExternalTool(chunk.block.name, externalTools)
          yield { ...chunk, block: external ? chunk.block : restoreBlock(chunk.block, session) }
          break
        }
        case 'usage':
        case 'finish': {
          for (const [index, block] of [...open]) {
            const rest = flushChunk(index, block)
            if (rest !== undefined) yield rest
          }
          yield chunk
          break
        }
        default:
          yield chunk
      }
    }
  } finally {
    const reports = [...finished, ...[...open.values()].map(block => block.restorer)].map(restorer => restorer.report())
    onDone({
      restored: reports.reduce((sum, report) => sum + report.restored, 0),
      tolerantMatches: reports.flatMap(report => report.tolerantMatches),
      unknownTokens: reports.flatMap(report => report.unknownTokens),
      suspicious: reports.flatMap(report => report.suspicious),
    })
  }
}

function restoreBlock(block: ContentBlock, session: Session): ContentBlock {
  switch (block.type) {
    case 'text': return { ...block, text: session.restore(block.text).text }
    case 'reasoning': return { ...block, text: session.restore(block.text).text }
    case 'tool-call': return { ...block, arguments: session.restore(block.arguments, 'json-string').text }
    default: return block
  }
}

/** Session-log event keys whose strings are identifiers or enumerations, not content. */
export const LOG_IDENTITY_KEYS: ReadonlySet<string> = new Set([
  'type', 'id', 'role', 'sessionId', 'messageId', 'toolCallId', 'callId', 'parentId', 'agentId', 'model', 'provider',
  'reasoningEffort', 'kind', 'status', 'reason', 'blockType', 'toolName', 'purpose', 'version', 'channel',
])

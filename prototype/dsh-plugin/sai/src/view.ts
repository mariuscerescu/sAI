/**
 * In-memory record of what the model saw per Session: the last redacted
 * request and its raw answer. Only symbol text is kept; the record is lost
 * when the Host restarts and rebuilt on the next request.
 */

import type { ContentBlock, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SaiModelView, SaiViewBlock, SaiViewMessage } from './view-types.ts'

interface MutableView {
  strategy: string
  sentAt: number
  messages: SaiViewMessage[]
  reply: { kind: SaiViewBlock['kind']; text: string; name?: string }[]
  replyIndex: Map<number, number>
  complete: boolean
}

function viewBlock(block: ContentBlock): SaiViewBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'tool-call': return { kind: 'tool-call', text: block.arguments, name: block.name }
    default: return { kind: 'other', text: `[${block.type}]` }
  }
}

/**
 * Project a redacted request into display messages.
 * @param options - the request exactly as sent to the provider.
 * @returns messages in conversation order; developer messages are omitted.
 */
export function projectRequest(options: GenerateOptions): SaiViewMessage[] {
  const messages: SaiViewMessage[] = []
  if (options.system !== undefined) messages.push({ role: 'system', blocks: [{ kind: 'text', text: options.system }] })
  for (const message of options.messages) {
    if (message.role === 'developer') continue
    const blocks = message.content.map(viewBlock)
    if (message.role === 'user') {
      // Request-only inputs carry no source; durable ones name their producer.
      const person = message.source === undefined || message.source.kind === 'user'
      messages.push({ role: 'user', origin: person ? 'person' : 'context', blocks })
    } else {
      messages.push({ role: message.role, blocks })
    }
  }
  return messages
}

/** Keeps the latest model view of each Session, least recently updated forgotten first. */
export class ModelViewStore {
  private readonly views = new Map<string, MutableView>()

  /** @param capacity - Sessions kept in memory. */
  constructor(private readonly capacity: () => number) {}

  /**
   * Record a request and return the tap that records its raw answer.
   * @param sessionId - Session the request belongs to.
   * @param strategy - strategy that produced the symbols.
   * @param options - the redacted request.
   * @returns a function wrapping the provider stream.
   */
  begin(sessionId: string, strategy: string, options: GenerateOptions): (upstream: AsyncIterable<StreamChunk>) => AsyncIterable<StreamChunk> {
    const view: MutableView = {
      strategy, sentAt: Date.now(), messages: projectRequest(options), reply: [], replyIndex: new Map(), complete: false,
    }
    this.views.delete(sessionId)
    this.views.set(sessionId, view)
    while (this.views.size > this.capacity()) this.views.delete(this.views.keys().next().value!)
    return upstream => tap(upstream, view)
  }

  /**
   * @param sessionId - Session to read.
   * @returns a detached copy of its latest model view, if any.
   */
  get(sessionId: string): SaiModelView | undefined {
    const view = this.views.get(sessionId)
    if (view === undefined) return undefined
    return {
      strategy: view.strategy, sentAt: view.sentAt, messages: view.messages,
      reply: view.reply.map(block => ({ ...block })), complete: view.complete,
    }
  }

  /** Forget every Session (settings changed, so symbols will be reassigned). */
  clear(): void { this.views.clear() }
}

async function* tap(upstream: AsyncIterable<StreamChunk>, view: MutableView): AsyncIterable<StreamChunk> {
  const blockAt = (index: number, kind: SaiViewBlock['kind']): MutableView['reply'][number] => {
    let at = view.replyIndex.get(index)
    if (at === undefined) {
      at = view.reply.push({ kind, text: '' }) - 1
      view.replyIndex.set(index, at)
    }
    return view.reply[at]!
  }
  try {
    for await (const chunk of upstream) {
      switch (chunk.type) {
        case 'text-delta': blockAt(chunk.index, 'text').text += chunk.text; break
        case 'reasoning-delta': blockAt(chunk.index, 'reasoning').text += chunk.text; break
        case 'tool-call-delta': {
          const block = blockAt(chunk.index, 'tool-call')
          block.text += chunk.argumentsDelta
          if (chunk.name !== undefined) block.name = chunk.name
          break
        }
        case 'block-end': {
          const block = blockAt(chunk.index, viewBlock(chunk.block).kind)
          const complete = viewBlock(chunk.block)
          block.text = complete.text
          if (complete.name !== undefined) block.name = complete.name
          break
        }
        default: break
      }
      yield chunk
    }
  } finally {
    view.complete = true
  }
}

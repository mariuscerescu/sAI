/**
 * The model's view of a Session: the last request exactly as sAI sent it and
 * the raw answer before restoration. It contains only symbols, never the
 * protected values, and is shared by the Host Remote and the browser View.
 */

/** One content block as the provider saw or produced it. */
export interface SaiViewBlock {
  readonly kind: 'text' | 'reasoning' | 'tool-call' | 'other'
  /** Text, reasoning, or raw JSON arguments of a tool call. */
  readonly text: string
  /** Tool name of a tool call. */
  readonly name?: string
}

/** One message of the request as sent. */
export interface SaiViewMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  /** For user-role messages: typed by the person, or context injected by the harness. */
  readonly origin?: 'person' | 'context'
  readonly blocks: readonly SaiViewBlock[]
}

/** The last exchange with the model in one Session. */
export interface SaiModelView {
  /** Strategy that produced the symbols. */
  readonly strategy: string
  /** Epoch milliseconds when the request was sent. */
  readonly sentAt: number
  /** Request messages in conversation order, including the system prompt. */
  readonly messages: readonly SaiViewMessage[]
  /** Raw answer blocks before restoration; grows while the answer streams. */
  readonly reply: readonly SaiViewBlock[]
  /** Whether the answer stream has ended. */
  readonly complete: boolean
}

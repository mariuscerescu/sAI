/** "Model view": the Session's last exchange exactly as the provider saw it, before restoration. */
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useEffect, useState, type ReactNode } from 'react'
import { Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SaiModelView, SaiViewBlock, SaiViewMessage } from '../view-types.ts'
import type { NS } from './locales.ts'
import css from './Sai.module.css'

/** Reads the Host record for one Session. */
export interface ModelViewFace {
  readView: (sessionId: string, signal: AbortSignal) => Promise<SaiModelView | null | undefined>
}

/** Props bound by the renderer for the Conversation View slot. */
export type ModelViewProps = PropsRuntime<'conversation.view'> & PropsLocale<typeof NS> & InjectFace<ModelViewFace>

/** Refresh period while the View is open; the Host call is local. */
const REFRESH_MS = 1500

const TYPED_SYMBOL = /⟦[^⟧\n]{1,60}⟧/g
const GREEK_SYMBOL = /(?<![\p{L}\p{M}])\p{Script=Greek}[₀-₉]*′*(?![\p{L}\p{M}])/gu

/**
 * Render the last request and raw answer of the open Session.
 * @param props - Session identity, locale copy, and the Host reader.
 * @returns the View body.
 */
export function ModelView(props: ModelViewProps) {
  const { t, sessionId, readView } = props
  const [view, setView] = useState<SaiModelView | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      try {
        const next = await readView(sessionId, controller.signal)
        if (controller.signal.aborted) return
        setView(next ?? null)
        setFailed(false)
      } catch (_error) {
        // A failed read keeps the last view; the notice says it may be stale.
        if (!controller.signal.aborted) setFailed(true)
      }
      if (!controller.signal.aborted) timer = setTimeout(() => { void load() }, REFRESH_MS)
    }
    void load()
    return () => { controller.abort(); if (timer !== undefined) clearTimeout(timer) }
  }, [sessionId, readView])

  const [full, setFull] = useState(false)
  const pattern = view?.strategy === 'greek' ? GREEK_SYMBOL : TYPED_SYMBOL
  return <div className={css.modelView}>
    <div className={css.modelViewInner}>
      <div className={css.inline}>
        <p className={css.notice}>{t('modelViewIntro')}</p>
        <Checkbox label={t('modelViewFull')} checked={full} onChange={setFull} />
      </div>
      {failed && <p role="status" className={css.error}>{t('modelViewFailed')}</p>}
      {view === undefined ? null : view === null ? <p className={css.notice}>{t('modelViewEmpty')}</p>
        : full ? <FullView t={t} view={view} pattern={pattern} /> : <ChatLikeView view={view} pattern={pattern} />}
    </div>
  </div>
}

/** Only what the Chat tab shows: the person's messages and the model's text answers. */
function ChatLikeView(props: { view: SaiModelView; pattern: RegExp }) {
  const { view, pattern } = props
  const turns: { role: 'user' | 'assistant'; text: string }[] = []
  for (const message of view.messages) {
    const text = textOf(message.blocks)
    if (text.length === 0) continue
    if (message.role === 'user' && message.origin !== 'context') turns.push({ role: 'user', text })
    else if (message.role === 'assistant') turns.push({ role: 'assistant', text })
  }
  const reply = textOf(view.reply)
  return <div className={css.chat}>
    {turns.map((turn, index) => <ChatTurn key={index} role={turn.role} text={turn.text} pattern={pattern} />)}
    {(reply.length > 0 || !view.complete) && <ChatTurn role="assistant" text={reply.length > 0 ? reply : '…'} pattern={pattern} />}
  </div>
}

function ChatTurn(props: { role: 'user' | 'assistant'; text: string; pattern: RegExp }) {
  return <div className={props.role === 'user' ? css.chatUser : css.chatAssistant}>{highlight(props.text, props.pattern)}</div>
}

function textOf(blocks: readonly SaiViewBlock[]): string {
  return blocks.filter(block => block.kind === 'text').map(block => block.text).join('\n').trim()
}

/** Everything that was sent: system prompt, injected context, tool calls and results, reasoning. */
function FullView(props: { t: ModelViewProps['t']; view: SaiModelView; pattern: RegExp }) {
  const { t, view, pattern } = props
  return <>
    <p className={css.label}>{t('modelViewMeta', { strategy: view.strategy, time: new Date(view.sentAt).toLocaleTimeString() })}</p>
    {view.messages.map((message, index) => <Message key={index} t={t} message={message} pattern={pattern} />)}
    <div className={`${css.message} ${css.reply}`}>
      <span className={css.role}>{t('modelViewReply')}{view.complete ? '' : ` · ${t('modelViewStreaming')}`}</span>
      {view.reply.length === 0 ? <p className={css.notice}>…</p>
        : view.reply.map((block, index) => <Block key={index} block={block} pattern={pattern} />)}
    </div>
  </>
}

function Message(props: { t: ModelViewProps['t']; message: SaiViewMessage; pattern: RegExp }) {
  const { t, message, pattern } = props
  const body = message.blocks.map((block, index) => <Block key={index} block={block} pattern={pattern} />)
  if (message.role === 'system') {
    return <details className={css.message}>
      <summary className={css.role}>{t('modelViewSystem')}</summary>
      {body}
    </details>
  }
  return <div className={`${css.message} ${message.role === 'user' ? css.user : ''}`}>
    <span className={css.role}>{t(`modelViewRole_${message.role}`)}</span>
    {body}
  </div>
}

function Block(props: { block: SaiViewBlock; pattern: RegExp }) {
  const { block, pattern } = props
  switch (block.kind) {
    case 'tool-call':
      return <pre className={css.output}><b>{block.name ?? 'tool'}</b>{' '}{highlight(prettyJson(block.text), pattern)}</pre>
    case 'reasoning':
      return <pre className={`${css.output} ${css.reasoning}`}>{highlight(block.text, pattern)}</pre>
    default:
      return <pre className={css.output}>{highlight(block.text, pattern)}</pre>
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch (_partial) {
    // Arguments may still be streaming; show them as received.
    return text
  }
}

/** Wrap every symbol occurrence in a highlight. */
function highlight(text: string, pattern: RegExp): ReactNode[] {
  const parts: ReactNode[] = []
  let at = 0
  for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags))) {
    parts.push(text.slice(at, match.index), <mark key={match.index} className={css.symbol}>{match[0]}</mark>)
    at = match.index + match[0].length
  }
  parts.push(text.slice(at))
  return parts
}

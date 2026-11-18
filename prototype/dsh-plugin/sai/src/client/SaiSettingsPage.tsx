/** The sAI configuration page on the bundle's Plugins page, with a local preview. */
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { useId, useMemo, useState } from 'react'
import { Button, Checkbox, SegmentedControl, SettingsForm, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DEFAULT_SETTINGS, defaultPreamble, Engine, LANGUAGE_IDS, PATTERN_IDS, PATTERNS, SUGGESTED_CLASSES, type Action,
  type Decision, type SaiSettings, type StrategyId, type VocabularyEntry,
} from '../core/index.ts'
import { NS, formLabels, type SaiLocaleKey } from './locales.ts'
import type { SaiField, SaiFormFace } from './settings-form.ts'
import css from './Sai.module.css'

/** Props bound by the renderer for the bundle configuration slot. */
export type SaiSettingsPageProps = PropsRuntime<'plugins.bundle.config'> & PropsLocale<typeof NS> & InjectFace<SaiFormFace>

const ACTIONS: readonly Action[] = ['tokenize', 'mask', 'ignore', 'block']
const SAMPLE = 'Dl. Popescu de la Acme a sunat de pe 069123456. IDNP: 2001234567891. Maria Rusu confirmă.'

/**
 * Render the staged settings and the local preview.
 * @param props - form snapshot, edit actions, and locale copy.
 * @returns the configuration page.
 */
export function SaiSettingsPage(props: SaiSettingsPageProps) {
  const { t } = props
  const state = props.useSaiForm(value => value)
  const disabled = !state.writable || state.saving
  const draft = state.draft
  const edit = (field: SaiField, value: unknown): void => { props.edit(field, typeof value === 'string' ? value : JSON.stringify(value)) }

  const vocabulary = draft.vocabulary ?? []
  const patterns = draft.patterns ?? DEFAULT_SETTINGS.patterns
  const languages = draft.languages ?? DEFAULT_SETTINGS.languages
  const actions = draft.actions ?? DEFAULT_SETTINGS.actions
  const verifier: Partial<SaiSettings['verifier']> = draft.verifier ?? {}
  const classes = useMemo(() => policyClasses(vocabulary, actions, patterns), [vocabulary, actions, patterns])
  const [newClass, setNewClass] = useState('')
  const invalid = (Object.keys(state.fields) as SaiField[]).filter(field => state.fields[field].invalid)

  const setEntry = (index: number, entry: VocabularyEntry): void => {
    edit('vocabulary', vocabulary.map((item, at) => at === index ? entry : item))
  }

  return <SettingsForm labels={formLabels(t)} state={state} onSave={props.save} onDiscard={props.discard}>
    <p className={css.notice}>{t('intro')}</p>
    <Switch label={t('enabled')} checked={draft.enabled ?? true} disabled={disabled}
      onChange={(next) => { edit('enabled', String(next)) }} />
    {invalid.length > 0 && <p role="status" className={css.error}>{t('invalidJson')} ({invalid.join(', ')})</p>}

    <section className={css.section}>
      <h3>{t('strategyTitle')}</h3>
      <SegmentedControl id="sai-strategy" label={t('strategyTitle')} value={draft.strategy ?? 'typed'} disabled={disabled}
        options={[{ value: 'typed', label: t('typed') }, { value: 'greek', label: t('greek') }]}
        onChange={(next) => { edit('strategy', next) }} />
      <p className={css.notice}>{t(draft.strategy === 'greek' ? 'greekHint' : 'typedHint')}</p>
      <Checkbox label={t('preamble')} checked={draft.preamble ?? true} disabled={disabled}
        onChange={(next) => { edit('preamble', String(next)) }} />
      <p className={css.notice}>{t('preambleHint')}</p>
      <PreambleEditor t={t} strategy={draft.strategy ?? 'typed'} texts={draft.preambleTexts ?? {}}
        disabled={disabled || draft.preamble === false} onChange={(texts) => { edit('preambleTexts', texts) }} />
    </section>

    <section className={css.section}>
      <h3>{t('vocabularyTitle')}</h3>
      <p className={css.notice}>{t('vocabularyHint')}</p>
      {vocabulary.map((entry, index) => <VocabularyRow key={index} t={t} entry={entry} disabled={disabled}
        classes={classChoices(classes)} onChange={(next) => { setEntry(index, next) }}
        onRemove={() => { edit('vocabulary', vocabulary.filter((_, at) => at !== index)) }} />)}
      <div>
        <Button size="sm" variant="outline" disabled={disabled}
          onClick={() => { edit('vocabulary', [...vocabulary, { class: 'PERSON', terms: [] }]) }}>{t('addEntry')}</Button>
      </div>
    </section>

    <section className={css.section}>
      <h3>{t('languagesTitle')}</h3>
      <p className={css.notice}>{t('languagesHint')}</p>
      {LANGUAGE_IDS.map(id => <Checkbox key={id} label={t(`language_${id}`)} checked={languages.includes(id)}
        disabled={disabled || (languages.length === 1 && languages.includes(id))}
        onChange={(next) => { edit('languages', next ? [...languages, id] : languages.filter(item => item !== id)) }} />)}
    </section>

    <section className={css.section}>
      <h3>{t('detectorsTitle')}</h3>
      <p className={css.notice}>{t('detectorsHint')}</p>
      {PATTERN_IDS.map(id => <Checkbox key={id} label={`${t(`pattern_${id}` as SaiLocaleKey)} · ${PATTERNS[id]!.classId}`}
        checked={patterns.includes(id)} disabled={disabled}
        onChange={(next) => { edit('patterns', next ? [...patterns, id] : patterns.filter(item => item !== id)) }} />)}
    </section>

    <section className={css.section}>
      <h3>{t('policyTitle')}</h3>
      <p className={css.notice}>{t('policyHint')}</p>
      <div className={css.policy}>
        <span className={css.label}>{t('classLabel')}</span><span className={css.label}>{t('actionLabel')}</span>
        {classes.map(classId => <PolicyRow key={classId} t={t} classId={classId} disabled={disabled}
          action={actions[classId] ?? 'tokenize'}
          onAction={(action) => { edit('actions', { ...actions, [classId]: action }) }} />)}
      </div>
      <div className={css.inline}>
        <input className={css.input} value={newClass} placeholder={t('newClassPlaceholder')} disabled={disabled}
          onChange={(event) => { setNewClass(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')) }} />
        <Button size="sm" variant="outline" disabled={disabled || newClass === '' || classes.includes(newClass)}
          onClick={() => { edit('actions', { ...actions, [newClass]: 'tokenize' }); setNewClass('') }}>{t('addClass')}</Button>
      </div>
    </section>

    <section className={css.section}>
      <h3>{t('allowlistTitle')}</h3>
      <p className={css.notice}>{t('allowlistHint')}</p>
      <LinesInput className={css.textarea} value={draft.allowlist ?? []} disabled={disabled}
        onChange={(lines) => { edit('allowlist', lines) }} />
    </section>

    <section className={css.section}>
      <h3>{t('verifierTitle')}</h3>
      <Checkbox label={t('verifierEnabled')} checked={verifier.enabled === true} disabled={disabled}
        onChange={(next) => { edit('verifier', { ...verifier, enabled: next }) }} />
      <p className={css.notice}>{t('verifierHint')}</p>
      <label className={css.cellWide}><span className={css.label}>{t('verifierUrl')}</span>
        <input className={css.input} value={verifier.url ?? DEFAULT_SETTINGS.verifier.url} disabled={disabled || verifier.enabled !== true}
          onChange={(event) => { edit('verifier', { ...verifier, url: event.target.value }) }} />
      </label>
    </section>

    <section className={css.section}>
      <h3>{t('egressTitle')}</h3>
      <Checkbox label={t('allowImages')} checked={draft.images === 'allow'} disabled={disabled}
        onChange={(next) => { edit('images', next ? 'allow' : 'block') }} />
      <p className={css.notice}>{t('allowImagesHint')}</p>
      <p className={css.notice}>{t('externalToolsHint')}</p>
      <LinesInput className={css.textarea} value={draft.externalTools ?? DEFAULT_SETTINGS.externalTools} disabled={disabled}
        onChange={(lines) => { edit('externalTools', lines) }} />
    </section>

    <Preview t={t} draft={draft} />
  </SettingsForm>
}

function policyClasses(
  vocabulary: readonly VocabularyEntry[], actions: Record<string, Action>, patterns: readonly string[],
): string[] {
  const set = new Set<string>(['PERSON'])
  for (const entry of vocabulary) if (entry.class) set.add(entry.class)
  for (const id of patterns) { const spec = PATTERNS[id]; if (spec) set.add(spec.classId) }
  for (const classId of Object.keys(actions)) set.add(classId)
  return [...set].sort()
}

interface RowProps { t: SaiSettingsPageProps['t']; disabled: boolean }

/** Edits the preamble of the selected strategy; an untouched strategy shows and sends its default. */
function PreambleEditor(props: RowProps & {
  strategy: StrategyId; texts: Readonly<Partial<Record<StrategyId, string>>>; onChange: (texts: Partial<Record<StrategyId, string>>) => void
}) {
  const { t, strategy, texts, disabled } = props
  const id = useId()
  const custom = texts[strategy]
  const value = custom ?? defaultPreamble(strategy)
  return <div className={css.cellWide}>
    <div className={css.inline}>
      <label className={css.label} htmlFor={id}>{t('preambleText', { strategy: t(strategy) })}</label>
      {custom !== undefined && <Tag tone="neutral">{t('preambleCustom')}</Tag>}
    </div>
    <textarea id={id} className={css.textarea} rows={5} value={value} disabled={disabled}
      onChange={(event) => { props.onChange({ ...texts, [strategy]: event.target.value }) }} />
    <div>
      <Button size="sm" variant="ghost" disabled={disabled || custom === undefined}
        onClick={() => { const { [strategy]: _dropped, ...rest } = texts; props.onChange(rest) }}>{t('preambleReset')}</Button>
    </div>
  </div>
}

/** Select value standing for "type your own class". */
const OTHER_CLASS = '\u0000other'

/** Every known class in a stable order: suggestions first, then the user's own. */
function classChoices(extra: readonly string[]): string[] {
  return [...SUGGESTED_CLASSES, ...extra.filter(classId => !SUGGESTED_CLASSES.includes(classId)).sort()]
}

/** A class select with every known class, plus a free-text option for a new one. */
function ClassPicker(props: RowProps & { id: string; value: string; classes: readonly string[]; onChange: (classId: string) => void }) {
  const { t, value, disabled } = props
  const [custom, setCustom] = useState(value !== '' && !props.classes.includes(value))
  return <>
    <select id={props.id} className={css.select} value={custom ? OTHER_CLASS : value} disabled={disabled}
      onChange={(event) => {
        if (event.target.value === OTHER_CLASS) { setCustom(true); props.onChange('') }
        else { setCustom(false); props.onChange(event.target.value) }
      }}>
      {props.classes.map(classId => <option key={classId} value={classId}>{classId}</option>)}
      <option value={OTHER_CLASS}>{t('otherClass')}</option>
    </select>
    {custom && <input className={css.input} value={value} placeholder={t('newClassPlaceholder')} disabled={disabled} autoFocus
      onChange={(event) => { props.onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '')) }} />}
  </>
}

function VocabularyRow(props: RowProps & {
  entry: VocabularyEntry; classes: readonly string[]; onChange: (entry: VocabularyEntry) => void; onRemove: () => void
}) {
  const { t, entry, disabled } = props
  const id = useId()
  return <div className={css.entry}>
    <div className={css.cell}><label className={css.label} htmlFor={id}>{t('classLabel')}</label>
      <ClassPicker id={id} value={entry.class} classes={props.classes} disabled={disabled} t={t}
        onChange={(classId) => { props.onChange({ ...entry, class: classId }) }} />
    </div>
    <label className={css.cellWide}><span className={css.label}>{t('termsLabel')}</span>
      <LinesInput className={css.textarea} value={entry.terms} disabled={disabled}
        onChange={(terms) => { props.onChange({ ...entry, terms }) }} />
    </label>
    <label className={css.cell}><span className={css.label}>{t('restoreAsLabel')}</span>
      <input className={css.input} value={entry.restoreAs ?? ''} disabled={disabled}
        onChange={(event) => {
          const { restoreAs: _previous, ...rest } = entry
          props.onChange(event.target.value === '' ? rest : { ...rest, restoreAs: event.target.value })
        }} />
    </label>
    <Button size="sm" variant="ghost" disabled={disabled} onClick={props.onRemove}>{t('remove')}</Button>
  </div>
}

function PolicyRow(props: RowProps & {
  classId: string; action: Action; onAction: (action: Action) => void
}) {
  const { t, disabled } = props
  return <>
    <span className={css.mono}>{props.classId}</span>
    <select className={css.select} value={props.action} disabled={disabled || props.classId === 'LITERAL'}
      onChange={(event) => { props.onAction(event.target.value as Action) }}>
      {ACTIONS.map(action => <option key={action} value={action}>{t(`action_${action}` as SaiLocaleKey)}</option>)}
    </select>
  </>
}

/** A textarea editing a list of lines; empty lines are kept while typing and dropped by the core. */
function LinesInput(props: { value: readonly string[]; disabled: boolean; className: string | undefined; onChange: (lines: string[]) => void }) {
  return <textarea className={props.className} rows={Math.max(2, props.value.length + 1)} value={props.value.join('\n')}
    disabled={props.disabled} onChange={(event) => { props.onChange(event.target.value.split('\n')) }} />
}

function Preview(props: { t: SaiSettingsPageProps['t']; draft: Partial<SaiSettings> }) {
  const { t, draft } = props
  const [input, setInput] = useState(SAMPLE)
  const [reply, setReply] = useState<string | undefined>(undefined)
  const result = useMemo(() => {
    try {
      const engine = new Engine({ ...draft, enabled: true })
      const session = engine.session({ random: () => 0.5 })
      const out = session.redact(input)
      return { engine, session, out, error: undefined }
    } catch (error) {
      return { engine: undefined, session: undefined, out: undefined, error: error instanceof Error ? error.message : String(error) }
    }
  }, [draft, input])
  const replyText = reply ?? result.out?.text ?? ''
  const restored = result.session?.restore(replyText)
  return <section className={css.section}>
    <h3>{t('previewTitle')}</h3>
    <p className={css.notice}>{t('previewHint')}</p>
    {result.error !== undefined && <p role="status" className={css.error}>{result.error}</p>}
    {result.engine !== undefined && result.engine.problems.length > 0
      && <p role="status" className={css.error}>{t('problems', { problems: result.engine.problems.join('; ') })}</p>}
    <label className={css.cellWide}><span className={css.label}>{t('previewInput')}</span>
      <textarea className={css.textarea} rows={4} value={input} onChange={(event) => { setInput(event.target.value); setReply(undefined) }} />
    </label>
    {result.out !== undefined && <>
      <span className={css.label}>{t('previewOutput')}</span>
      {result.out.verdict.kind === 'blocked'
        ? <p role="status" className={css.error}>{t('previewBlocked', {
          code: `${result.out.verdict.code}${result.out.verdict.classId === undefined ? '' : ` (${result.out.verdict.classId})`}`,
        })}</p>
        : <pre className={css.output}>{result.out.text}</pre>}
      <span className={css.label}>{t('previewFindings')}</span>
      {result.out.decisions.length === 0 ? <p className={css.notice}>{t('previewNothing')}</p> : <Findings t={t} input={input} decisions={result.out.decisions} />}
      {result.out.verdict.kind !== 'blocked' && <>
        <label className={css.cellWide}><span className={css.label}>{t('previewReply')}</span>
          <textarea className={css.textarea} rows={3} value={replyText} onChange={(event) => { setReply(event.target.value) }} />
        </label>
        <span className={css.label}>{t('previewRestored')}</span>
        <pre className={css.output}>{restored?.text}</pre>
        {restored !== undefined && (restored.report.unknownTokens.length > 0 || restored.report.suspicious.length > 0) && <div className={css.inline}>
          {restored.report.unknownTokens.map(token => <Tag key={`u${token}`} tone="neutral">? {token}</Tag>)}
          {restored.report.suspicious.map(token => <Tag key={`s${token}`} tone="neutral">≈ {token}</Tag>)}
        </div>}
      </>}
    </>}
  </section>
}

function Findings(props: { t: SaiSettingsPageProps['t']; input: string; decisions: readonly Decision[] }) {
  const { t } = props
  return <table className={css.table}>
    <thead><tr>
      <th>{t('findingText')}</th><th>{t('findingClass')}</th><th>{t('findingDetector')}</th>
      <th>{t('findingAction')}</th>
    </tr></thead>
    <tbody>{props.decisions.map(({ span, action }) => <tr key={`${span.start}:${span.end}`}>
      <td className={css.mono}>{props.input.slice(span.start, span.end)}</td>
      <td className={css.mono}>{span.classId}</td>
      <td>{span.detector}</td>
      <td>{t(`action_${action}` as SaiLocaleKey)}</td>
    </tr>)}</tbody>
  </table>
}

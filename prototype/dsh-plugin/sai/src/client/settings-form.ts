/**
 * Staged sAI settings over the `sai` configuration form. Structured fields
 * (vocabulary, patterns, policy, allowlist) are staged as JSON text so the
 * shared form model can diff, validate, and write them like any other field.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, type SettingsFieldSpec, type SettingsFieldState, type SettingsFormActions, type SettingsFormScope,
  type SettingsFormShell,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SaiSettings } from '../core/index.ts'

/** Form namespace: the bundle's Loader entry id. */
export const SAI_NS = 'sai'

/** Every edited field. */
export const SAI_FIELDS = [
  'enabled', 'strategy', 'preamble', 'preambleTexts', 'warnHandling', 'vocabulary', 'patterns', 'names', 'actions', 'minConfidence',
  'allowlist', 'languages', 'images', 'externalTools',
] as const

/** One edited field name. */
export type SaiField = typeof SAI_FIELDS[number]

/** Draft state the page renders. */
export interface SaiFormState extends SettingsFormShell {
  fields: Record<SaiField, SettingsFieldState>
  /** Settings as they would be saved now (accepted values overlaid with valid drafts). */
  draft: Partial<SaiSettings>
}

/** Registration face injected into the page. */
export interface SaiFormFace extends SettingsFormActions {
  hooks: { saiForm: SnapshotStore<SaiFormState> }
}

function booleanField(field: SaiField): SettingsFieldSpec {
  return {
    field,
    format: value => value === true ? 'true' : value === false ? 'false' : '',
    parse: text => text === 'true' ? { kind: 'set', value: true } : text === 'false' ? { kind: 'set', value: false } : text === '' ? { kind: 'clear' } : undefined,
  }
}

function choiceField(field: SaiField, choices: readonly string[]): SettingsFieldSpec {
  return {
    field,
    format: value => typeof value === 'string' ? value : '',
    parse: text => choices.includes(text) ? { kind: 'set', value: text } : text === '' ? { kind: 'clear' } : undefined,
  }
}

function jsonField(field: SaiField, valid: (value: unknown) => boolean): SettingsFieldSpec {
  return {
    field,
    format: value => value === undefined ? '' : JSON.stringify(value),
    parse: (text) => {
      if (text.trim() === '') return { kind: 'clear' }
      try {
        const value: unknown = JSON.parse(text)
        return valid(value) ? { kind: 'set', value } : undefined
      } catch (_notJson) {
        // An unreadable draft blocks the save instead of being dropped.
        return undefined
      }
    },
  }
}

const isStringArray = (value: unknown): boolean => Array.isArray(value) && value.every(item => typeof item === 'string')
const isRecordOf = (check: (value: unknown) => boolean) => (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(check)
const isVocabulary = (value: unknown): boolean => Array.isArray(value) && value.every(entry =>
  entry !== null && typeof entry === 'object' && typeof (entry as { class?: unknown }).class === 'string'
  && isStringArray((entry as { terms?: unknown }).terms))

const SPECS: SettingsFieldSpec[] = [
  booleanField('enabled'),
  choiceField('strategy', ['typed', 'greek']),
  booleanField('preamble'),
  jsonField('preambleTexts', isRecordOf(value => typeof value === 'string')),
  choiceField('warnHandling', ['tokenize', 'keep']),
  jsonField('vocabulary', isVocabulary),
  jsonField('patterns', isStringArray),
  booleanField('names'),
  jsonField('actions', isRecordOf(value => typeof value === 'string')),
  jsonField('minConfidence', isRecordOf(value => typeof value === 'number' && value >= 0 && value <= 1)),
  jsonField('allowlist', isStringArray),
  jsonField('languages', isStringArray),
  choiceField('images', ['block', 'allow']),
  jsonField('externalTools', isStringArray),
]

/** Stages sAI edits until the user saves them. */
export class SaiSettingsForm {
  private readonly form: SettingsFormModel<SaiSettings>
  private readonly state: SnapshotStore<SaiFormState>

  /** @param scope - Host-backed configuration form for the `sai` entry. */
  constructor(private readonly scope: SettingsFormScope<SaiSettings>) {
    this.form = new SettingsFormModel(scope, SPECS)
    this.state = this.form.bind(() => this.projection())
  }

  /** @returns the face the page's slot registration injects. */
  inject(): SaiFormFace { return { hooks: { saiForm: this.state }, ...this.form.actions() } }

  /** Release the accepted-value subscription. */
  dispose(): void { this.form.dispose() }

  private projection(): SaiFormState {
    const fields = Object.fromEntries(SAI_FIELDS.map(field => [field, this.form.field(field)])) as Record<SaiField, SettingsFieldState>
    const accepted = (this.scope.getSnapshot().value ?? {}) as Partial<SaiSettings>
    const draft: Record<string, unknown> = { ...accepted }
    for (const spec of SPECS) {
      const state = fields[spec.field as SaiField]
      if (state.invalid) continue
      const write = spec.parse(state.text)
      if (write?.kind === 'set') draft[spec.field] = write.value
    }
    return { ...this.form.shell(), fields, draft: draft as Partial<SaiSettings> }
  }
}

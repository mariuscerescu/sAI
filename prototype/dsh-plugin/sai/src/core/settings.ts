/**
 * User-editable sAI settings: the JSON value the Host Config and the browser
 * settings page share. {@link resolveSettings} is the single place that fills
 * defaults, so every consumer compiles the same effective configuration.
 */

import { DEFAULT_LANGUAGES, LANGUAGE_IDS } from './languages.ts'
import type { Action, ClassId } from './types.ts'

/** One protected entity declared by the user. */
export interface VocabularyEntry {
  /** Stable id; generated from the first term when absent. */
  id?: string
  /** Entity class, for example `PERSON` or `COMPANY`. */
  class: ClassId
  /** Every spelling that refers to this entity; the first is the canonical name. */
  terms: readonly string[]
  /** Spelling restored in answers; defaults to the first spelling seen in the session. */
  restoreAs?: string
}

/** Token strategy shown to the model. */
export type StrategyId = 'typed' | 'greek'

/** What the Host does with spans whose confidence is below the class threshold. */
export type WarnHandling = 'tokenize' | 'keep'

/** Complete user configuration. */
export interface SaiSettings {
  /** Master switch; when false requests pass through unchanged. */
  enabled: boolean
  strategy: StrategyId
  /** Whether a short explanation of the symbols is added to the system prompt. */
  preamble: boolean
  /** User-written preamble per strategy; a missing or blank text uses the strategy's default. */
  preambleTexts: Readonly<Partial<Record<StrategyId, string>>>
  warnHandling: WarnHandling
  vocabulary: readonly VocabularyEntry[]
  /** Enabled pattern detector ids (see `PATTERN_IDS`). */
  patterns: readonly string[]
  /** Per-class action overrides. */
  actions: Readonly<Record<ClassId, Action>>
  /** Per-class confidence thresholds. */
  minConfidence: Readonly<Record<ClassId, number>>
  /** Words that are never protected, matched after normalization. */
  allowlist: readonly string[]
  /** Languages of the user's texts (see `LANGUAGE_IDS`): their inflections, titles, and legal forms apply. */
  languages: readonly string[]
  /**
   * Images reach the model as pixels sAI cannot inspect. `block` refuses a request that
   * carries one; `allow` sends it unchanged.
   */
  images: 'block' | 'allow'
  /**
   * Tools that send their arguments off this computer (web search, web fetch, remote MCP
   * servers). Their arguments keep the symbols instead of being restored. A trailing `*`
   * matches a name prefix.
   */
  externalTools: readonly string[]
}

/** Tools whose arguments leave the computer, protected when the user has not chosen. */
export const DEFAULT_EXTERNAL_TOOLS: readonly string[] = ['web_search', 'web_fetch', 'mcp__*']

/**
 * @param name - tool name from a model tool call.
 * @param externalTools - configured names; a trailing `*` matches a prefix.
 * @returns whether the tool sends its arguments off the computer.
 */
export function isExternalTool(name: string, externalTools: readonly string[]): boolean {
  return externalTools.some(pattern => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern)
}

/** Pattern detectors the core ships, in display order. */
export const PATTERN_IDS = [
  'idnp', 'cnp', 'phone-md', 'phone-ro', 'ssn-us', 'phone-us', 'phone-uk', 'nino-uk', 'iban', 'card', 'email', 'ipv4',
] as const

/**
 * Classes offered for vocabulary entries. Classes are open: any name made of
 * A–Z, digits, and `_` is valid; these are suggestions plus the detector classes.
 */
export const SUGGESTED_CLASSES: readonly string[] = [
  'PERSON', 'COMPANY', 'ORGANIZATION', 'LOCATION', 'ADDRESS', 'PROJECT', 'PRODUCT', 'CONTRACT',
  'PHONE', 'EMAIL', 'IDNP', 'CNP', 'SSN', 'NINO', 'IBAN', 'CARD', 'IP',
]

/** Pattern detectors enabled when the user has not chosen. */
export const DEFAULT_PATTERNS: readonly string[] = [
  'idnp', 'cnp', 'phone-md', 'phone-ro', 'ssn-us', 'phone-us', 'phone-uk', 'nino-uk', 'iban', 'card', 'email',
]

/** Defaults applied to every missing field. */
export const DEFAULT_SETTINGS: SaiSettings = {
  enabled: true,
  strategy: 'typed',
  preamble: true,
  preambleTexts: {},
  warnHandling: 'tokenize',
  vocabulary: [],
  patterns: [...DEFAULT_PATTERNS],
  actions: { CARD: 'block' },
  minConfidence: { PERSON: 0.85 },
  allowlist: [],
  languages: [...DEFAULT_LANGUAGES],
  images: 'block',
  externalTools: [...DEFAULT_EXTERNAL_TOOLS],
}

/** Known languages from the stored list; an empty or unusable list falls back to the defaults. */
function resolveLanguages(raw: readonly string[] | undefined, problems: SettingsProblems): string[] {
  if (raw === undefined) return [...DEFAULT_LANGUAGES]
  const known = raw.filter(id => (LANGUAGE_IDS as readonly string[]).includes(id))
  for (const id of raw) if (!known.includes(id)) problems.push(`unknown language "${id}"`)
  if (known.length === 0) { problems.push('no language selected; using the defaults'); return [...DEFAULT_LANGUAGES] }
  return [...new Set(known)]
}

/** Default threshold for classes without an explicit one. */
export const DEFAULT_MIN_CONFIDENCE = 0.8

const ACTIONS: readonly Action[] = ['tokenize', 'mask', 'warn', 'ignore', 'block']

/** Problems found while resolving settings; empty when valid. */
export type SettingsProblems = string[]

/**
 * Fill defaults and validate a partial settings value.
 * @param input - stored settings, possibly partial or from an older version.
 * @returns the effective settings and the problems that prevented using a field.
 */
export function resolveSettings(input: Partial<SaiSettings> | undefined): { settings: SaiSettings; problems: SettingsProblems } {
  const problems: SettingsProblems = []
  const raw = input ?? {}
  const strategy = raw.strategy === 'greek' || raw.strategy === 'typed' ? raw.strategy : DEFAULT_SETTINGS.strategy
  if (raw.strategy !== undefined && raw.strategy !== strategy) problems.push(`unknown strategy "${String(raw.strategy)}"`)
  const vocabulary: VocabularyEntry[] = []
  for (const [index, entry] of (raw.vocabulary ?? []).entries()) {
    const terms = (entry.terms ?? []).map(term => term.trim()).filter(term => term.length > 0)
    const classId = (entry.class ?? '').trim().toUpperCase()
    if (terms.length === 0) { problems.push(`vocabulary entry ${index + 1} has no terms`); continue }
    if (!/^[A-Z][A-Z0-9_]*$/.test(classId)) { problems.push(`vocabulary entry ${index + 1} has an invalid class`); continue }
    const restoreAs = entry.restoreAs?.trim()
    vocabulary.push({
      id: entry.id?.trim() || `${classId.toLowerCase()}:${terms[0]!.toLowerCase()}`,
      class: classId,
      terms,
      ...restoreAs ? { restoreAs } : {},
    })
  }
  const actions: Record<ClassId, Action> = { ...DEFAULT_SETTINGS.actions }
  for (const [classId, action] of Object.entries(raw.actions ?? {})) {
    if (ACTIONS.includes(action)) actions[classId.toUpperCase()] = action
    else problems.push(`unknown action "${String(action)}" for ${classId}`)
  }
  const minConfidence: Record<ClassId, number> = { ...DEFAULT_SETTINGS.minConfidence }
  for (const [classId, value] of Object.entries(raw.minConfidence ?? {})) {
    if (typeof value === 'number' && value >= 0 && value <= 1) minConfidence[classId.toUpperCase()] = value
    else problems.push(`threshold for ${classId} must be between 0 and 1`)
  }
  return {
    settings: {
      enabled: raw.enabled ?? DEFAULT_SETTINGS.enabled,
      strategy,
      preamble: raw.preamble ?? DEFAULT_SETTINGS.preamble,
      preambleTexts: Object.fromEntries(Object.entries(raw.preambleTexts ?? {})
        .filter(([id, text]) => (id === 'typed' || id === 'greek') && typeof text === 'string' && text.trim().length > 0)),
      warnHandling: raw.warnHandling === 'keep' ? 'keep' : 'tokenize',
      vocabulary,
      patterns: (raw.patterns ?? DEFAULT_SETTINGS.patterns).filter(id => (PATTERN_IDS as readonly string[]).includes(id)),
      actions,
      minConfidence,
      allowlist: (raw.allowlist ?? []).map(word => word.trim()).filter(word => word.length > 0),
      languages: resolveLanguages(raw.languages, problems),
      images: raw.images === 'allow' ? 'allow' : 'block',
      externalTools: (raw.externalTools ?? DEFAULT_SETTINGS.externalTools).map(name => name.trim()).filter(name => name.length > 0),
    },
    problems,
  }
}

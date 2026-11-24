/**
 * User-editable sAI settings: the JSON value the Host Config and the browser
 * settings page share. {@link resolveSettings} is the single place that fills
 * defaults, so every consumer compiles the same effective configuration.
 */

import { DEFAULT_LANGUAGES, LANGUAGE_IDS } from './languages.ts'
import type { Action, ClassId } from './types.ts'
import { DEFAULT_VERIFIER, isLoopbackUrl, type VerifierSettings } from './verifier.ts'

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

/** Complete user configuration. */
export interface SaiSettings {
  /** Master switch; when false requests pass through unchanged. */
  enabled: boolean
  strategy: StrategyId
  /** Whether a short explanation of the symbols is added to the system prompt. */
  preamble: boolean
  /** User-written preamble per strategy; a missing or blank text uses the strategy's default. */
  preambleTexts: Readonly<Partial<Record<StrategyId, string>>>
  vocabulary: readonly VocabularyEntry[]
  /** Enabled pattern detector ids (see `PATTERN_IDS`). */
  patterns: readonly string[]
  /** Per-class action overrides; every other class is replaced with a symbol. */
  actions: Readonly<Record<ClassId, Action>>
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
  /**
   * Local model that decides whether a lowercase form of a declared name is used as a name
   * ("Reply to bill") or as an ordinary word ("paid the bill"). Off: as without a verifier.
   */
  verifier: VerifierSettings
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
  vocabulary: [],
  patterns: [...DEFAULT_PATTERNS],
  actions: { CARD: 'block' },
  allowlist: [],
  languages: [...DEFAULT_LANGUAGES],
  images: 'block',
  externalTools: [...DEFAULT_EXTERNAL_TOOLS],
  verifier: { ...DEFAULT_VERIFIER },
}

/** Known languages from the stored list; an empty or unusable list falls back to the defaults. */
function resolveLanguages(raw: readonly string[] | undefined, problems: SettingsProblems): string[] {
  if (raw === undefined) return [...DEFAULT_LANGUAGES]
  const known = raw.filter(id => (LANGUAGE_IDS as readonly string[]).includes(id))
  for (const id of raw) if (!known.includes(id)) problems.push(`unknown language "${id}"`)
  if (known.length === 0) { problems.push('no language selected; using the defaults'); return [...DEFAULT_LANGUAGES] }
  return [...new Set(known)]
}

/** Verifier settings with defaults; a non-local address or an out-of-range number is refused. */
function resolveVerifier(raw: Partial<VerifierSettings> | undefined, problems: SettingsProblems): VerifierSettings {
  const settings: VerifierSettings = { ...DEFAULT_VERIFIER, enabled: raw?.enabled === true }
  if (raw?.mode !== undefined) {
    if (raw.mode === 'lowercase' || raw.mode === 'all') settings.mode = raw.mode
    else problems.push(`unknown verifier mode "${String(raw.mode)}"; using "lowercase"`)
  }
  if (raw?.descriptions !== undefined && raw.descriptions !== null && typeof raw.descriptions === 'object') {
    settings.descriptions = Object.fromEntries(Object.entries(raw.descriptions)
      .filter(([classId, text]) => typeof text === 'string' && text.trim().length > 0 && /^[A-Za-z][A-Za-z0-9_]*$/.test(classId))
      .map(([classId, text]) => [classId.toUpperCase(), (text as string).trim()]))
  }
  if (raw?.url !== undefined && raw.url.trim() !== '') {
    if (isLoopbackUrl(raw.url.trim())) settings.url = raw.url.trim()
    else problems.push('the verifier address must be on this computer (127.0.0.1, ::1, or localhost); using the default')
  }
  if (raw?.threshold !== undefined) {
    if (typeof raw.threshold === 'number' && raw.threshold > 0 && raw.threshold <= 1) settings.threshold = raw.threshold
    else problems.push('the verifier threshold must be above 0 and at most 1; using the default')
  }
  if (raw?.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0) settings.timeoutMs = raw.timeoutMs
    else problems.push('the verifier timeout must be positive; using the default')
  }
  return settings
}

const ACTIONS: readonly Action[] = ['tokenize', 'mask', 'ignore', 'block']

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
    // `warn` (send unchanged, from older versions) became the safe default: replace.
    if ((action as string) === 'warn') actions[classId.toUpperCase()] = 'tokenize'
    else if (ACTIONS.includes(action)) actions[classId.toUpperCase()] = action
    else problems.push(`unknown action "${String(action)}" for ${classId}`)
  }
  return {
    settings: {
      enabled: raw.enabled ?? DEFAULT_SETTINGS.enabled,
      strategy,
      preamble: raw.preamble ?? DEFAULT_SETTINGS.preamble,
      preambleTexts: Object.fromEntries(Object.entries(raw.preambleTexts ?? {})
        .filter(([id, text]) => (id === 'typed' || id === 'greek') && typeof text === 'string' && text.trim().length > 0)),
      vocabulary,
      patterns: (raw.patterns ?? DEFAULT_SETTINGS.patterns).filter(id => (PATTERN_IDS as readonly string[]).includes(id)),
      actions,
      allowlist: (raw.allowlist ?? []).map(word => word.trim()).filter(word => word.length > 0),
      languages: resolveLanguages(raw.languages, problems),
      images: raw.images === 'allow' ? 'allow' : 'block',
      externalTools: (raw.externalTools ?? DEFAULT_SETTINGS.externalTools).map(name => name.trim()).filter(name => name.length > 0),
      verifier: resolveVerifier(raw.verifier, problems),
    },
    problems,
  }
}

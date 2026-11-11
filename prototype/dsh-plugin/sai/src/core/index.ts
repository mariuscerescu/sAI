/**
 * sAI core: reversible pseudonymization of protected terms before text
 * reaches a cloud model. Pure TypeScript with no harness imports, shared by
 * the Host plugin and the browser settings preview.
 * @module @deepseek-ai/dsh-experimental-sai/core
 */

export { RedactionBatch } from './batch.ts'
export { Engine, Session, StreamRestorer, mask, MAX_INPUT_CHARS } from './engine.ts'
export type { SessionOptions } from './engine.ts'
export { checksum731, checksumCnp, ibanMod97, luhn, PATTERNS } from './detectors/patterns.ts'
export { capitalizesNames } from './detectors/dictionary.ts'
export { combineLanguages, DEFAULT_LANGUAGES, englishWordForms, LANGUAGE_IDS, LANGUAGES } from './languages.ts'
export type { LanguageId, LanguagePack } from './languages.ts'
export { normalize, normalizeTerm } from './normalize.ts'
export {
  DEFAULT_EXTERNAL_TOOLS, DEFAULT_MIN_CONFIDENCE, DEFAULT_PATTERNS, DEFAULT_SETTINGS, isExternalTool, PATTERN_IDS, resolveSettings,
  SUGGESTED_CLASSES,
} from './settings.ts'
export type { SaiSettings, StrategyId, VocabularyEntry, WarnHandling } from './settings.ts'
export { GreekStrategy, TypedStrategy, createStrategy, defaultPreamble } from './strategies.ts'
export type { TokenHit, TokenStrategy } from './strategies.ts'
export { Vault, keyString } from './vault.ts'
export type * from './types.ts'

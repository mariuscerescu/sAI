/**
 * Shared data model of the sAI pseudonymization core. The core is pure: it
 * performs no I/O and imports nothing from the harness, so the same module
 * runs on the Host, in the browser preview, and in tests.
 */

/** Entity class such as `PERSON`, `COMPANY`, `IDNP`, or `LITERAL`. */
export type ClassId = string

/** Detector identity reported on candidates, for example `dictionary` or `pattern:idnp`. */
export type DetectorId = string

/** What "the same entity" means for vault lookups. */
export type EntityKey =
  | { readonly kind: 'entry'; readonly entryId: string }
  | { readonly kind: 'canonical'; readonly classId: ClassId; readonly value: string }
  | { readonly kind: 'literal'; readonly value: string }

/** Search view of a text with a map from search positions back to original positions. */
export interface NormalizedText {
  /** Text as received; never modified. */
  readonly original: string
  /** Lowercased, diacritic-free, whitespace-collapsed view used only for search. */
  readonly norm: string
  /** Original start offset of each `norm` code unit. */
  readonly startOf: Uint32Array
  /** Original end offset (exclusive) of each `norm` code unit. */
  readonly endOf: Uint32Array
}

/** One detector finding, positioned in the original text as `[start, end)`. */
export interface Candidate {
  readonly start: number
  readonly end: number
  readonly classId: ClassId
  readonly detector: DetectorId
  /** Higher wins partial overlaps: literal 400, dictionary 300, session 250, pattern 200. */
  readonly priority: number
  readonly key: EntityKey
  /** Declared spelling an inflected form was generated from; the vault records it instead of the form. */
  readonly baseForm?: string
}

/**
 * Policy outcome for one span, chosen per class by the user. Every finding gets its
 * class's action; nothing depends on a score. `ignore` is an explicit choice to send a
 * class in clear (for example e-mail addresses).
 */
export type Action = 'tokenize' | 'mask' | 'ignore' | 'block'

/** One resolved span and the action chosen for it. */
export interface Decision {
  readonly span: Candidate
  readonly action: Action
}

/** Aggregate outcome of one redaction. */
export type Verdict =
  | { readonly kind: 'proceed' }
  | { readonly kind: 'blocked'; readonly code: BlockCode; readonly classId?: ClassId; readonly detector?: DetectorId }

/** Why a redaction refused to produce sendable text. */
export type BlockCode = 'POLICY_BLOCKED' | 'LEAK_DETECTED' | 'STRATEGY_UNSUITABLE' | 'INPUT_TOO_LARGE' | 'IMAGE_NOT_INSPECTABLE'

/** Value-free account of one redaction. */
export interface RedactReport {
  readonly countsByClass: Readonly<Record<ClassId, number>>
  readonly tokensUsed: readonly string[]
  readonly strategy: string
}

/** Result of redacting one text. */
export interface RedactOutput {
  /** Text to send; empty when the verdict is `blocked`. */
  readonly text: string
  readonly verdict: Verdict
  readonly report: RedactReport
  /** Every decision, positioned in the original text (used by the preview, never logged). */
  readonly decisions: readonly Decision[]
}

/** Value-free account of one restoration. */
export interface RestoreReport {
  readonly restored: number
  /** Symbols found only in an altered spelling. */
  readonly tolerantMatches: readonly string[]
  /** Symbol-like text with no vault entry, left unchanged. */
  readonly unknownTokens: readonly string[]
  /** Restorations in a context that suggests another meaning (Greek letters next to math). */
  readonly suspicious: readonly string[]
}

/** Result of restoring one text. */
export interface RestoreOutput {
  readonly text: string
  readonly report: RestoreReport
}

/** Where a restored value lands, which decides its escaping. */
export type RestoreContext = 'text' | 'json-string'

/** One vault entry: the bidirectional mapping between an entity and its symbol. */
export interface VaultEntry {
  readonly token: string
  readonly classId: ClassId
  readonly key: EntityKey
  /** Exact original spellings in order of first appearance. */
  readonly surfaceForms: string[]
  /** For a name: the symbol of each form it is restored as; the first form uses {@link token}. */
  readonly symbols: Map<string, string>
}

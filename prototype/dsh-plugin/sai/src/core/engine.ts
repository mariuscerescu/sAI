/**
 * Engine and Session: compile settings once, then redact outgoing text and
 * restore incoming text against one session vault.
 */

import { capitalizesNames, compileDictionary, type CompiledTerm, type DetectHints, TermDetector } from './detectors/dictionary.ts'
import { combineLanguages } from './languages.ts'
import { PATTERNS, PatternDetector } from './detectors/patterns.ts'
import { isSentenceStart, normalize, normalizeTerm } from './normalize.ts'
import { decide, resolveOverlaps } from './resolve.ts'
import { resolveSettings, type SaiSettings, type StrategyId } from './settings.ts'
import { createStrategy, type TokenStrategy } from './strategies.ts'
import type {
  Candidate, ClassId, Decision, EntityKey, NormalizedText, RedactOutput, RedactReport, RestoreContext, RestoreOutput,
  RestoreReport, Verdict, VaultEntry,
} from './types.ts'
import { Vault } from './vault.ts'
import { questionFor, questionKey, type VerifierQuestion } from './verifier.ts'

/** Priority of findings that repeat a spelling already in the session vault. */
export const SESSION_PRIORITY = 250
/** Priority of symbol-like input text. */
export const LITERAL_PRIORITY = 400
/** Largest text one redaction accepts, in UTF-16 code units. */
export const MAX_INPUT_CHARS = 2_000_000
/** Verifier answers one session remembers; the oldest are forgotten first (and asked again if needed). */
const MAX_ANSWERS = 20_000

interface Detector { readonly id: string; detect(text: NormalizedText, hints?: DetectHints): Candidate[] }

/** Options for one session. */
export interface SessionOptions {
  /** Strategy override; defaults to the settings strategy. */
  strategy?: StrategyId
  /** Uniform [0, 1) source for the Greek permutation; defaults to `Math.random`. */
  random?: () => number
}

/** Compiled, immutable configuration shared by sessions. */
export class Engine {
  readonly settings: SaiSettings
  readonly problems: readonly string[]
  /** @internal */ readonly dictionary: TermDetector
  /** @internal */ readonly detectors: readonly Detector[]
  /** @internal */ readonly leakDetectors: readonly Detector[]
  /** @internal */ readonly allowlist: ReadonlySet<string>
  /** @internal */ readonly restoreAs: ReadonlyMap<string, string>
  /** @internal Titles and particles of the enabled languages, never a first name. */ readonly notNames: ReadonlySet<string>
  /** @internal Declared spelling of each entry, named in verifier questions. */ readonly entryTerms: ReadonlyMap<string, string>

  /**
   * @param input - stored settings, possibly partial.
   * @throws Error when the vocabulary is contradictory.
   */
  constructor(input: Partial<SaiSettings> | undefined) {
    const { settings, problems } = resolveSettings(input)
    this.settings = settings
    this.problems = problems
    this.dictionary = compileDictionary(settings.vocabulary, settings.languages)
    const patterns = settings.patterns.map(id => new PatternDetector(PATTERNS[id]!))
    this.detectors = [this.dictionary, ...patterns]
    this.leakDetectors = [this.dictionary, ...patterns]
    this.allowlist = new Set(settings.allowlist.map(normalizeTerm))
    this.restoreAs = new Map(settings.vocabulary.flatMap(entry => entry.restoreAs ? [[entry.id!, entry.restoreAs] as const] : []))
    this.notNames = new Set(combineLanguages(settings.languages).notNames)
    this.entryTerms = new Map(settings.vocabulary.map(entry => [entry.id!, entry.terms[0]!] as const))
  }

  /**
   * Open a session with an empty vault.
   * @param options - strategy override and randomness.
   * @returns the new session.
   */
  session(options: SessionOptions = {}): Session {
    return new Session(this, createStrategy(options.strategy ?? this.settings.strategy, options.random ?? Math.random))
  }
}

/** Mutable per-conversation state: the vault and the strategy state. */
export class Session {
  readonly vault = new Vault()
  /** Verifier answers by question: true when the word is replaced. In memory only, never logged. */
  private readonly answers = new Map<string, boolean>()

  /** @internal */
  constructor(private readonly engine: Engine, readonly strategy: TokenStrategy) {}

  /** @returns the model-facing explanation of this session's symbols: the user's text, or the strategy default. */
  preamble(): string {
    const custom = this.engine.settings.preambleTexts[this.strategy.id as StrategyId]?.trim()
    return custom === undefined || custom.length === 0 ? this.strategy.preamble() : custom
  }

  /**
   * Redact one text.
   * @param original - text bound for the model.
   * @returns the text to send, the verdict, and a value-free report.
   */
  redact(original: string): RedactOutput {
    const empty = (verdict: Verdict): RedactOutput => ({ text: '', verdict, report: this.report([]), decisions: [] })
    if (original.length > MAX_INPUT_CHARS) return empty({ kind: 'blocked', code: 'INPUT_TOO_LARGE' })
    if (original.length === 0) return { text: '', verdict: { kind: 'proceed' }, report: this.report([]), decisions: [] }
    const unsuitable = this.strategy.observe(original, this.vault)
    if (unsuitable !== undefined) return empty({ kind: 'blocked', code: unsuitable })
    const { text, hints, candidates, unconfirmed } = this.gather(original)
    // With the verifier on, an unconfirmed lowercase form is replaced unless the model called it an ordinary word.
    const cleared: Candidate[] = []
    if (this.engine.settings.verifier.enabled) {
      for (const span of unconfirmed) (this.answers.get(questionKey(this.questionOf(original, span))) === false ? cleared : candidates).push(span)
    }
    const resolve = (): ReturnType<typeof decide> => decide(
      this.withFirstNames(text, this.joinNameParts(text, resolveOverlaps(candidates, candidate => this.isAllowed(text, candidate)))),
      this.engine.settings,
    )
    let { decisions, verdict } = resolve()
    // A spelling replaced somewhere in this text is replaced everywhere in it, as later texts of the
    // session already are: a name a detector recognized once ("dl. Mare") must not stay elsewhere.
    const decided = decisions.map(({ span }) => span)
    const repeats = this.repeatsOf(decisions, original).detect(text, hints).filter(repeat => !overlapsAny(decided, repeat))
    if (repeats.length > 0) {
      for (const repeat of repeats) candidates.push(repeat);
      ({ decisions, verdict } = resolve())
    }
    if (verdict.kind === 'blocked') return { ...empty(verdict), report: this.report(decisions) }
    // A word the verifier called ordinary is sent as written, on purpose: the leak check must not count it.
    if (cleared.length > 0) decisions = withCleared(decisions, cleared)
    const { output, kept, tokenRanges } = this.rewrite(original, decisions)
    const leak = this.findLeak(output, [...kept, ...tokenRanges], hints)
    if (leak !== undefined) {
      return { ...empty({ kind: 'blocked', code: 'LEAK_DETECTED', classId: leak.classId, detector: leak.detector }), report: this.report(decisions) }
    }
    return { text: output, verdict, report: this.report(decisions), decisions }
  }

  /**
   * Questions the verifier must answer before this text is redacted: one per lowercase one-word
   * form of a declared name (a name part or a generated form) that nothing else covers, both the
   * ones the capital-letter rule drops and the ones it would accept only because the text has no
   * capitalized name. Capitalized forms are replaced as before and never asked about. Questions
   * this session already answered are left out. Empty when the verifier is off.
   * @param original - text bound for the model.
   * @returns the unanswered questions.
   */
  questions(original: string): VerifierQuestion[] {
    if (!this.engine.settings.verifier.enabled || original.length === 0 || original.length > MAX_INPUT_CHARS) return []
    return this.gather(original).unconfirmed.map(span => this.questionOf(original, span))
      .filter(question => !this.answers.has(questionKey(question)))
  }

  /**
   * Record the verifier's answers: a word is replaced when its probability of being a name
   * reaches the threshold. A missing or invalid probability is not recorded, so the word is replaced.
   * @param questions - questions asked.
   * @param probabilities - for each question, the probability that the word is a name.
   */
  answer(questions: readonly VerifierQuestion[], probabilities: readonly number[]): void {
    const { threshold } = this.engine.settings.verifier
    questions.forEach((question, index) => {
      const probability = probabilities[index]
      if (typeof probability !== 'number' || !Number.isFinite(probability)) return
      const key = questionKey(question)
      this.answers.delete(key)
      this.answers.set(key, probability >= threshold)
    })
    while (this.answers.size > MAX_ANSWERS) this.answers.delete(this.answers.keys().next().value!)
  }

  /**
   * Restore every known symbol in one complete text.
   * @param text - model output.
   * @param context - `json-string` escapes restored values for a JSON string body.
   * @returns restored text and a value-free report.
   */
  restore(text: string, context: RestoreContext = 'text'): RestoreOutput {
    const { hits, unknown } = this.strategy.scan(text, this.vault)
    const parts: string[] = []
    const tolerant: string[] = []
    const suspicious: string[] = []
    let at = 0
    for (const hit of hits) {
      const entry = this.vault.byToken(hit.token)!
      parts.push(text.slice(at, hit.start), escape(this.surfaceOf(entry), context))
      at = hit.end
      if (hit.match === 'tolerant') tolerant.push(hit.token)
      if (hit.suspicious) suspicious.push(hit.token)
    }
    parts.push(text.slice(at))
    const report: RestoreReport = { restored: hits.length, tolerantMatches: tolerant, unknownTokens: unknown, suspicious }
    return { text: parts.join(''), report }
  }

  /**
   * Start restoring a stream whose chunks may split symbols.
   * @param context - escaping of restored values.
   * @returns the incremental restorer.
   */
  streamRestorer(context: RestoreContext = 'text'): StreamRestorer {
    return new StreamRestorer(this, context)
  }

  /** Spelling used when a symbol is restored. */
  private surfaceOf(entry: VaultEntry): string {
    if (entry.key.kind === 'literal') return entry.key.value
    if (entry.key.kind === 'entry') {
      const preferred = this.engine.restoreAs.get(entry.key.entryId)
      if (preferred !== undefined) return preferred
    }
    return entry.surfaceForms[0] ?? entry.token
  }

  /**
   * Every finding of one text, and apart from them the lowercase forms the capital-letter
   * rule drops that no finding covers and the allowlist does not exempt.
   */
  private gather(original: string): { text: NormalizedText; hints: DetectHints; candidates: Candidate[]; unconfirmed: Candidate[] } {
    const text = normalize(original)
    // Decided once on the original text, so the leak check reads the rewritten text the same way.
    const hints: DetectHints = { capitalized: capitalizesNames(original) }
    const dictionary = this.engine.dictionary.split(text, { ...hints, verifyLowercase: this.engine.settings.verifier.enabled })
    const candidates: Candidate[] = [
      ...this.literalCandidates(original),
      ...this.sessionDetector().detect(text, hints),
      ...this.engine.detectors.flatMap(detector => detector === this.engine.dictionary ? dictionary.found : detector.detect(text, hints)),
    ]
    const seen = new Set<string>()
    const unconfirmed = dictionary.unconfirmed.filter((span) => {
      const at = `${span.start}:${span.end}`
      if (seen.has(at)) return false
      seen.add(at)
      return !this.isAllowed(text, span) && !candidates.some(other => other.start < span.end && span.start < other.end)
    })
    return { text, hints, candidates, unconfirmed }
  }

  /** The verifier question for one dropped form, naming the declared spelling it may stand for. */
  private questionOf(original: string, span: Candidate): VerifierQuestion {
    const owners = span.key.kind === 'entry' ? [span.key.entryId]
      : span.key.kind === 'canonical' ? [...this.engine.dictionary.owners.get(span.key.value) ?? []] : []
    const terms = owners.flatMap(id => this.engine.entryTerms.get(id) ?? [])
    return questionFor(original, span, terms.length > 0 ? terms.join(' or ') : span.baseForm ?? original.slice(span.start, span.end))
  }

  private literalCandidates(original: string): Candidate[] {
    return this.strategy.literals(original, this.vault).map(range => ({
      ...range, classId: 'LITERAL', detector: 'literal', priority: LITERAL_PRIORITY,
      key: { kind: 'literal', value: original.slice(range.start, range.end) },
    }))
  }

  /** Spellings already replaced in this session, found again with word boundaries. */
  private sessionDetector(): TermDetector {
    return new TermDetector('session', this.vault.entries().flatMap(entry => entry.key.kind === 'literal'
      ? []
      : entry.surfaceForms.flatMap(form => surfaceTerm(form, entry.classId, entry.key))))
  }

  /** Spellings this text's decisions are about to replace, to find their other occurrences in it. */
  private repeatsOf(decisions: readonly Decision[], original: string): TermDetector {
    return new TermDetector('session', decisions.flatMap(({ span, action }) => action !== 'tokenize' || span.key.kind === 'literal'
      ? []
      : surfaceTerm(span.baseForm ?? original.slice(span.start, span.end), span.classId, span.key)))
  }

  /**
   * Two one-word person findings side by side ("Maria Popescu") are one person. If both
   * words belong to one declared person ("Rusu Ion"), the pair is that person; otherwise
   * it is a new person with its own symbol, so "Maria" of "Maria Ceban" and "Popescu" of
   * "Ion Popescu" are never merged into someone else.
   */
  private joinNameParts(text: NormalizedText, spans: Candidate[]): Candidate[] {
    const owners = this.engine.dictionary.owners
    if (owners.size === 0) return spans
    const base = (span: Candidate): string => normalizeTerm(span.baseForm ?? text.original.slice(span.start, span.end))
    const ownersOf = (span: Candidate): ReadonlySet<string> =>
      owners.get(base(span)) ?? (span.key.kind === 'entry' ? new Set([span.key.entryId]) : new Set())
    const isPart = (span: Candidate | undefined): span is Candidate => span !== undefined && span.classId === 'PERSON'
      && (span.detector === 'dictionary' || span.detector === 'session') && !base(span).includes(' ')
    const out: Candidate[] = []
    for (let i = 0; i < spans.length; i++) {
      const left = spans[i]!
      const right = spans[i + 1]
      if (!isPart(left) || !isPart(right) || !/^ +$/.test(text.original.slice(left.end, right.start))) { out.push(left); continue }
      const shared = [...ownersOf(left)].filter(id => ownersOf(right).has(id))
      const spelling = `${left.baseForm ?? text.original.slice(left.start, left.end)} ${right.baseForm ?? text.original.slice(right.start, right.end)}`
      out.push({
        start: left.start, end: right.end, classId: 'PERSON', detector: 'dictionary', priority: left.priority,
        key: shared.length === 1 ? { kind: 'entry', entryId: shared[0]! } : { kind: 'canonical', classId: 'PERSON', value: normalizeTerm(spelling) },
        baseForm: spelling,
      })
      i++
    }
    return out
  }

  /**
   * A capitalized word right before a protected surname is that person's first name, even
   * when the user never declared it ("Floare Munteanu", "Rose Walker"): the pair becomes one
   * new person, so the first name never leaves in clear. At the start of a sentence, where
   * every word is capitalized, the word counts only before the surname as declared, never
   * before an inflected form: "Floare Munteanu a venit" joins, "Contractul Popescului" stays,
   * as a first name before a genitive surname would be inflected itself ("Mariei Popescu").
   */
  private withFirstNames(text: NormalizedText, spans: Candidate[]): Candidate[] {
    const original = text.original
    const out: Candidate[] = []
    for (const span of spans) {
      const surface = span.baseForm ?? original.slice(span.start, span.end)
      const previous = out.at(-1)
      const isSurname = span.classId === 'PERSON' && (span.detector === 'dictionary' || span.detector === 'session') && !surface.includes(' ')
      const word = isSurname ? /(?<![\p{L}\p{N}'’-])(\p{Lu}[\p{L}'’-]*) +$/u.exec(original.slice(Math.max(0, span.start - 60), span.start)) : null
      if (word === null) { out.push(span); continue }
      const start = span.start - word[0].length
      const norm = normalizeTerm(word[1]!)
      const inflected = normalizeTerm(original.slice(span.start, span.end)) !== normalizeTerm(surface)
      if ((previous !== undefined && previous.end > start) || this.engine.notNames.has(norm.replace(/\./g, ''))
        || (isSentenceStart(original, start) && inflected)) {
        out.push(span)
        continue
      }
      const spelling = `${word[1]!} ${surface}`
      out.push({
        start, end: span.end, classId: 'PERSON', detector: span.detector, priority: span.priority,
        key: { kind: 'canonical', classId: 'PERSON', value: normalizeTerm(spelling) }, baseForm: spelling,
      })
    }
    return out
  }

  private isAllowed(text: NormalizedText, candidate: Candidate): boolean {
    if (this.engine.allowlist.size === 0) return false
    return this.engine.allowlist.has(normalizeTerm(text.original.slice(candidate.start, candidate.end)))
  }

  private symbolFor(span: Candidate): VaultEntry {
    return this.vault.get(span.key) ?? this.vault.put(this.strategy.assign(span.classId, this.vault), span.classId, span.key)
  }

  private rewrite(original: string, decisions: readonly Decision[]): {
    output: string
    kept: { start: number; end: number }[]
    tokenRanges: { start: number; end: number }[]
  } {
    const parts: string[] = []
    const kept: { start: number; end: number }[] = []
    const tokenRanges: { start: number; end: number }[] = []
    let at = 0
    let length = 0
    const emit = (text: string): void => { parts.push(text); length += text.length }
    for (const { span, action } of decisions) {
      emit(original.slice(at, span.start))
      const value = original.slice(span.start, span.end)
      const start = length
      switch (action) {
        case 'tokenize': {
          const entry = this.symbolFor(span)
          // An inflected form is restored as the declared spelling it was generated from.
          this.vault.addSurfaceForm(entry, span.baseForm ?? value)
          emit(entry.token)
          tokenRanges.push({ start, end: length })
          break
        }
        case 'mask':
          emit(mask(value))
          tokenRanges.push({ start, end: length })
          break
        case 'ignore':
          emit(value)
          kept.push({ start, end: length })
          break
        case 'block':
          throw new Error('blocked spans never reach the rewriter')
      }
      at = span.end
    }
    emit(original.slice(at))
    return { output: parts.join(''), kept, tokenRanges }
  }

  /** Re-run the exact detectors on the outgoing text; any finding outside a replaced or kept range is a leak. */
  private findLeak(output: string, covered: readonly { start: number; end: number }[], hints: DetectHints): Candidate | undefined {
    const text = normalize(output)
    const findings = [...this.sessionDetector().detect(text, hints), ...this.engine.leakDetectors.flatMap(detector => detector.detect(text, hints))]
    const ranges = [...covered].sort((a, b) => a.start - b.start)
    return findings.find(finding => !this.isAllowed(text, finding) && !overlapsAny(ranges, finding))
  }

  private report(decisions: readonly Decision[]): RedactReport {
    const countsByClass: Record<ClassId, number> = {}
    const tokens = new Set<string>()
    for (const { span, action } of decisions) {
      if (action !== 'tokenize' && action !== 'mask') continue
      countsByClass[span.classId] = (countsByClass[span.classId] ?? 0) + 1
      if (action === 'tokenize') {
        const entry = this.vault.get(span.key)
        if (entry !== undefined) tokens.add(entry.token)
      }
    }
    return { countsByClass, tokensUsed: [...tokens], strategy: this.strategy.id }
  }
}

/** Incremental restoration with a strategy-defined holdback. */
export class StreamRestorer {
  private buffer = ''
  private readonly reports: RestoreReport[] = []

  /** @internal */
  constructor(private readonly session: Session, private readonly context: RestoreContext) {}

  /**
   * Accept one chunk.
   * @param chunk - next raw model text.
   * @returns restored text that is safe to emit now.
   */
  push(chunk: string): string {
    this.buffer += chunk
    const hold = this.session.strategy.holdback(this.buffer)
    const ready = this.buffer.slice(0, this.buffer.length - hold)
    this.buffer = this.buffer.slice(this.buffer.length - hold)
    return this.emit(ready)
  }

  /**
   * Flush the held tail.
   * @returns the remaining restored text.
   */
  flush(): string {
    const rest = this.buffer
    this.buffer = ''
    return this.emit(rest)
  }

  /** @returns the merged report of everything emitted so far. */
  report(): RestoreReport {
    return {
      restored: this.reports.reduce((sum, report) => sum + report.restored, 0),
      tolerantMatches: this.reports.flatMap(report => report.tolerantMatches),
      unknownTokens: this.reports.flatMap(report => report.unknownTokens),
      suspicious: this.reports.flatMap(report => report.suspicious),
    }
  }

  private emit(text: string): string {
    if (text.length === 0) return ''
    const restored = this.session.restore(text, this.context)
    this.reports.push(restored.report)
    return restored.text
  }
}

/**
 * Add the words the verifier called ordinary as decisions to send them as written, unless a
 * decision already covers them (a spelling replaced elsewhere in the text is replaced everywhere).
 * @param decisions - decisions in text order.
 * @param cleared - words the verifier called ordinary.
 * @returns all decisions in text order.
 */
function withCleared(decisions: readonly Decision[], cleared: readonly Candidate[]): Decision[] {
  const taken = decisions.map(({ span }) => span)
  const added: Decision[] = []
  for (const span of [...cleared].sort((a, b) => a.start - b.start)) {
    if (overlapsAny(taken, span) || (added.length > 0 && added.at(-1)!.span.end > span.start)) continue
    added.push({ span: { ...span, detector: 'verifier' }, action: 'ignore' })
  }
  return [...decisions, ...added].sort((a, b) => a.span.start - b.span.start)
}

/**
 * Whether a range overlaps any of several non-overlapping ranges, by binary search.
 * @param sorted - non-overlapping ranges sorted by start.
 * @param range - the range to test.
 * @returns true when some range shares at least one position with it.
 */
function overlapsAny(sorted: readonly { start: number; end: number }[], range: { start: number; end: number }): boolean {
  let low = 0
  let high = sorted.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (sorted[middle]!.end <= range.start) low = middle + 1
    else high = middle
  }
  return low < sorted.length && sorted[low]!.start < range.end
}

/**
 * A replaced spelling as a search term. A one-word person name ("Victoria") is found
 * again only when capitalized, like the dictionary's own one-word forms.
 * @param form - the spelling as replaced.
 * @param classId - its class.
 * @param key - its entity.
 * @returns the term, or nothing for spellings too short to search.
 */
function surfaceTerm(form: string, classId: ClassId, key: EntityKey): CompiledTerm[] {
  const norm = normalizeTerm(form)
  if (norm.length < 3) return []
  return [{
    norm, classId, key, priority: SESSION_PRIORITY,
    ...classId === 'PERSON' && /^\p{L}+$/u.test(norm) ? { capital: 'required' as const } : {},
  }]
}

/**
 * Hide a value while keeping its shape: the first character stays, other letters and digits become `*`.
 * @param value - original span text.
 * @returns the irreversible mask.
 */
export function mask(value: string): string {
  let seen = 0
  return value.replace(/[\p{L}\p{N}]/gu, char => (seen++ === 0 ? char : '*'))
}

function escape(value: string, context: RestoreContext): string {
  return context === 'json-string' ? JSON.stringify(value).slice(1, -1) : value
}

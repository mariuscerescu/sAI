/**
 * Engine and Session: compile settings once, then redact outgoing text and
 * restore incoming text against one session vault.
 */

import { capitalizesNames, compileDictionary, type CompiledTerm, type DetectHints, TermDetector } from './detectors/dictionary.ts'
import { combineLanguages, looksRomanian } from './languages.ts'
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
import {
  partQuestion, questionFor, questionKey, whichQuestion, WHICH_CONFIDENCE, type VerifierAnswer, type VerifierQuestion,
} from './verifier.ts'

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
  /** @internal Whether Romanian is enabled: in Romanian texts the verifier may only add masks. */ readonly romanian: boolean

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
    this.romanian = settings.languages.includes('ro')
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
  /**
   * Verifier answers by question, in memory only, never logged. `name` and `part`: true when
   * the word is replaced (or joined to the name); `which`: the chosen entry id, or null.
   */
  private readonly answers = new Map<string, boolean | string | null>()

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
    const { text, hints, candidates, unconfirmed, rulesFloor } = this.gather(original)
    // With the verifier on, an unconfirmed form is replaced unless the model called it an ordinary word.
    const cleared: Candidate[] = []
    if (this.engine.settings.verifier.enabled) {
      for (const span of unconfirmed) {
        if (this.answers.get(questionKey(this.questionOf(original, span))) === false) cleared.push(span)
        else candidates.push(this.withChosenEntry(original, span))
      }
    }
    // Q2 replaces the attached-first-name rule, except in Romanian texts, where the model may only add masks.
    const asking = this.engine.settings.verifier.enabled && this.engine.settings.verifier.mode === 'all' && !rulesFloor
    const resolve = (): ReturnType<typeof decide> => {
      const joined = this.joinNameParts(text, resolveOverlaps(candidates, candidate => this.isAllowed(text, candidate)))
      return decide(asking ? this.withAskedFirstNames(original, joined) : this.withFirstNames(text, joined), this.engine.settings)
    }
    let { decisions, verdict } = resolve()
    // A spelling replaced somewhere in this text is replaced everywhere in it, as later texts of the
    // session already are: a name a detector recognized once ("dl. Mare") must not stay elsewhere.
    // A word the verifier called ordinary keeps its own answer.
    const decided = decisions.map(({ span }) => span)
    const repeats = this.repeatsOf(decisions, original).detect(text, hints)
      .filter(repeat => !overlapsAny(decided, repeat) && !cleared.some(span => span.start < repeat.end && repeat.start < span.end))
    if (repeats.length > 0) {
      for (const repeat of repeats) candidates.push(repeat);
      ({ decisions, verdict } = resolve())
    }
    if (verdict.kind === 'blocked') return { ...empty(verdict), report: this.report(decisions) }
    // A word the verifier called ordinary is sent as written, on purpose: the leak check must not count it.
    if (cleared.length > 0) decisions = withCleared(decisions, cleared)
    const { output, kept, tokenRanges, symbols } = this.rewrite(original, decisions)
    const leak = this.findLeak(output, [...kept, ...tokenRanges], hints)
    if (leak !== undefined) {
      return { ...empty({ kind: 'blocked', code: 'LEAK_DETECTED', classId: leak.classId, detector: leak.detector }), report: this.report(decisions, symbols) }
    }
    return { text: output, verdict, report: this.report(decisions, symbols), decisions }
  }

  /**
   * Questions the verifier must answer before this text is redacted, leaving out those this
   * session already answered. Empty when the verifier is off.
   * - Q1 (`name`), one per unconfirmed one-word form that nothing else covers: in mode
   *   `lowercase`, the lowercase forms the capital-letter rules would drop or accept on the text's
   *   style alone; in mode `all`, every one-word form, in any case, declared or generated.
   * - Mode `all` also asks Q2 (`part`) for a capitalized word right before a one-word person name
   *   ("Floare Munteanu", "Ask bill"), and Q3 (`which`) for a one-word name several declared
   *   people share.
   * @param original - text bound for the model.
   * @returns the unanswered questions.
   */
  questions(original: string): VerifierQuestion[] {
    const verifier = this.engine.settings.verifier
    if (!verifier.enabled || original.length === 0 || original.length > MAX_INPUT_CHARS) return []
    const { candidates, unconfirmed, rulesFloor } = this.gather(original)
    const questions: VerifierQuestion[] = unconfirmed.map(span => this.questionOf(original, span))
    if (verifier.mode === 'all') {
      for (const span of unconfirmed) {
        const which = this.whichOf(original, span)
        if (which !== undefined) questions.push(which)
      }
      const spans = [...candidates, ...unconfirmed]
      for (const span of rulesFloor ? [] : spans) {
        const word = this.attachedWord(original, span)
        if (word !== undefined && !spans.some(other => other.start < word.end && word.start < other.end)) {
          questions.push(partQuestion(original, word, span))
        }
      }
    }
    const unique = new Map(questions.map(question => [questionKey(question), question] as const))
    return [...unique.values()].filter(question => !this.answers.has(questionKey(question)))
  }

  /**
   * Record the verifier's answers. Q1 and Q2: yes when the probability reaches the threshold
   * (the word is replaced, or joined to the name). Q3: an entry is chosen only when the model is
   * at least {@link WHICH_CONFIDENCE} sure; otherwise the shared symbol stays. A missing or invalid
   * answer is not recorded, so the safe reading applies: replaced, joined, shared.
   * @param questions - questions asked.
   * @param answers - one answer per question.
   */
  answer(questions: readonly VerifierQuestion[], answers: readonly VerifierAnswer[]): void {
    const { threshold } = this.engine.settings.verifier
    questions.forEach((question, index) => {
      const answer = answers[index]
      let value: boolean | string | null
      if (question.kind === 'which') {
        if (!Array.isArray(answer) || answer.length !== question.options.length + 1 || !answer.every(p => Number.isFinite(p))) return
        const best = answer.indexOf(Math.max(...answer))
        value = best < question.options.length && answer[best]! >= WHICH_CONFIDENCE ? question.entries[best]! : null
      } else {
        if (typeof answer !== 'number' || !Number.isFinite(answer)) return
        value = answer >= threshold
      }
      const key = questionKey(question)
      this.answers.delete(key)
      this.answers.set(key, value)
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
      parts.push(text.slice(at, hit.start), escape(this.surfaceOf(entry, hit.token), context))
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

  /** Spelling used when a symbol is restored: the entry's chosen spelling, or the form this symbol stands for. */
  private surfaceOf(entry: VaultEntry, token: string): string {
    if (entry.key.kind === 'literal') return entry.key.value
    if (entry.key.kind === 'entry') {
      const preferred = this.engine.restoreAs.get(entry.key.entryId)
      if (preferred !== undefined) return preferred
    }
    return this.vault.formOf(token) ?? entry.surfaceForms[0] ?? entry.token
  }

  /**
   * Every finding of one text, and apart from them the lowercase forms the capital-letter
   * rule drops that no finding covers and the allowlist does not exempt.
   */
  private gather(original: string): {
    text: NormalizedText; hints: DetectHints; candidates: Candidate[]; unconfirmed: Candidate[]; rulesFloor: boolean
  } {
    const text = normalize(original)
    // Decided once on the original text, so the leak check reads the rewritten text the same way.
    const hints: DetectHints = { capitalized: capitalizesNames(original) }
    const { enabled, mode } = this.engine.settings.verifier
    const all = enabled && mode === 'all'
    const verifying: DetectHints = { ...hints, verifyLowercase: enabled, verifyAll: all }
    const dictionary = this.engine.dictionary.split(text, verifying)
    // In mode `all`, a one-word spelling from the vault ("Bill", replaced earlier) is asked about too.
    const session: { found: Candidate[]; unconfirmed: Candidate[] } = all
      ? this.sessionDetector().split(text, verifying) : { found: this.sessionDetector().detect(text, hints), unconfirmed: [] }
    // In a Romanian text the model may only add masks: what the capital-letter rules replace
    // stays replaced (measured, the model let "cu rusu despre factură" through).
    const rulesFloor = enabled && this.engine.romanian && looksRomanian(original)
    if (rulesFloor) {
      const byRules = new Set([...this.engine.dictionary.detect(text, hints), ...this.sessionDetector().detect(text, hints)]
        .map(span => `${span.start}:${span.end}`))
      for (const list of [dictionary, session]) {
        const kept = list.unconfirmed.filter(span => !byRules.has(`${span.start}:${span.end}`))
        list.found.push(...list.unconfirmed.filter(span => byRules.has(`${span.start}:${span.end}`)))
        list.unconfirmed.splice(0, list.unconfirmed.length, ...kept)
      }
    }
    const candidates: Candidate[] = [
      ...this.literalCandidates(original),
      ...session.found,
      ...this.engine.detectors.flatMap(detector => detector === this.engine.dictionary ? dictionary.found : detector.detect(text, hints)),
    ]
    const seen = new Set<string>()
    const unconfirmed = [...dictionary.unconfirmed, ...session.unconfirmed].filter((span) => {
      const at = `${span.start}:${span.end}`
      if (seen.has(at)) return false
      seen.add(at)
      return !this.isAllowed(text, span) && !candidates.some(other => other.start < span.end && span.start < other.end)
    })
    return { text, hints, candidates, unconfirmed, rulesFloor }
  }

  /** Entries a found form may stand for: its own entry, or every entry sharing a one-word person name. */
  private ownersOf(span: Candidate): string[] {
    return span.key.kind === 'entry' ? [span.key.entryId]
      : span.key.kind === 'canonical' ? [...this.engine.dictionary.owners.get(span.key.value) ?? []] : []
  }

  /** Q1 for one unconfirmed form, naming the declared spelling it may stand for. */
  private questionOf(original: string, span: Candidate): VerifierQuestion {
    const terms = this.ownersOf(span).flatMap(id => this.engine.entryTerms.get(id) ?? [])
    const description = this.engine.settings.verifier.descriptions[span.classId]
    return questionFor(original, span, terms.length > 0 ? terms.join(' or ') : span.baseForm ?? original.slice(span.start, span.end), description)
  }

  /** Q3 for a one-word name several declared entries share, or nothing. */
  private whichOf(original: string, span: Candidate): VerifierQuestion | undefined {
    if (span.key.kind !== 'canonical') return undefined
    const entries = this.ownersOf(span).flatMap(id => {
      const term = this.engine.entryTerms.get(id)
      return term === undefined ? [] : [{ id, term }]
    })
    return entries.length > 1 ? whichQuestion(original, span, entries) : undefined
  }

  /** The span with the entry Q3 chose, when the model was sure; otherwise unchanged (shared symbol). */
  private withChosenEntry(original: string, span: Candidate): Candidate {
    const which = this.whichOf(original, span)
    const chosen = which === undefined ? undefined : this.answers.get(questionKey(which))
    return typeof chosen === 'string' ? { ...span, key: { kind: 'entry', entryId: chosen } } : span
  }

  /**
   * The capitalized word right before a one-word person name ("Floare" in "Floare Munteanu",
   * "Ask" in "Ask bill"), unless it is a title or a particle.
   */
  private attachedWord(original: string, span: Candidate): { start: number; end: number } | undefined {
    const surface = span.baseForm ?? original.slice(span.start, span.end)
    if (span.classId !== 'PERSON' || (span.detector !== 'dictionary' && span.detector !== 'session') || surface.includes(' ')) return undefined
    const word = /(?<![\p{L}\p{N}'’-])(\p{Lu}[\p{L}'’-]*) +$/u.exec(original.slice(Math.max(0, span.start - 60), span.start))
    if (word === null || this.engine.notNames.has(normalizeTerm(word[1]!).replace(/\./g, ''))) return undefined
    const start = span.start - word[0].length
    return { start, end: start + word[1]!.length }
  }

  /**
   * Mode `all`: a capitalized word right before a one-word person name joins it as a new person
   * unless the model said it is not part of the name (Q2). Unanswered: joined, as without the model.
   */
  private withAskedFirstNames(original: string, spans: Candidate[]): Candidate[] {
    const out: Candidate[] = []
    for (const span of spans) {
      const word = this.attachedWord(original, span)
      const previous = out.at(-1)
      if (word === undefined || (previous !== undefined && previous.end > word.start)
        || this.answers.get(questionKey(partQuestion(original, word, span))) === false) {
        out.push(span)
        continue
      }
      const spelling = `${original.slice(word.start, word.end)} ${span.baseForm ?? original.slice(span.start, span.end)}`
      out.push({
        start: word.start, end: span.end, classId: 'PERSON', detector: span.detector, priority: span.priority,
        key: { kind: 'canonical', classId: 'PERSON', value: normalizeTerm(spelling) }, baseForm: spelling,
      })
    }
    return out
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
    symbols: string[]
  } {
    const parts: string[] = []
    const kept: { start: number; end: number }[] = []
    const tokenRanges: { start: number; end: number }[] = []
    const symbols: string[] = []
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
          this.vault.addSurfaceForm(entry, span.baseForm ?? value)
          // A name keeps each written form apart; a pattern value (an IBAN in groups or compact) is one value.
          const named = span.key.kind === 'entry' || (span.key.kind === 'canonical' && span.classId === 'PERSON')
          const symbol = named ? this.vault.formSymbol(entry, restoredForm(span, value), n => this.strategy.related(entry.token, n)) : entry.token
          symbols.push(symbol)
          emit(symbol)
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
    return { output: parts.join(''), kept, tokenRanges, symbols }
  }

  /** Re-run the exact detectors on the outgoing text; any finding outside a replaced or kept range is a leak. */
  private findLeak(output: string, covered: readonly { start: number; end: number }[], hints: DetectHints): Candidate | undefined {
    const text = normalize(output)
    const findings = [...this.sessionDetector().detect(text, hints), ...this.engine.leakDetectors.flatMap(detector => detector.detect(text, hints))]
    const ranges = [...covered].sort((a, b) => a.start - b.start)
    return findings.find(finding => !this.isAllowed(text, finding) && !overlapsAny(ranges, finding))
  }

  private report(decisions: readonly Decision[], symbols?: readonly string[]): RedactReport {
    const countsByClass: Record<ClassId, number> = {}
    const tokens = new Set<string>(symbols)
    for (const { span, action } of decisions) {
      if (action !== 'tokenize' && action !== 'mask') continue
      countsByClass[span.classId] = (countsByClass[span.classId] ?? 0) + 1
      if (action === 'tokenize' && symbols === undefined) {
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
 * The spelling a symbol brings back: the text as written, in its own case, except an inflected form,
 * which returns as the declared spelling it was generated from ("Popescului" → "Popescu").
 * @param span - the replaced occurrence.
 * @param written - its text.
 * @returns the form to restore.
 */
function restoredForm(span: Candidate, written: string): string {
  return span.baseForm === undefined || normalizeTerm(written) === normalizeTerm(span.baseForm) ? written : span.baseForm
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

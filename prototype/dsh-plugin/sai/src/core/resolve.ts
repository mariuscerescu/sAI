/** Overlap resolution and policy decisions. */

import type { SaiSettings } from './settings.ts'
import type { Action, Candidate, Decision, Verdict } from './types.ts'

const isLiteral = (candidate: Candidate): boolean => candidate.classId === 'LITERAL'
const overlaps = (a: Candidate, b: Candidate): boolean => a.start < b.end && b.start < a.end

/**
 * @param containers - findings that may contain others.
 * @returns whether a span lies wholly inside a longer container, in O(log n) per query.
 */
function containmentIndex(containers: readonly Candidate[]): (start: number, end: number) => boolean {
  const sorted = [...containers].sort((a, b) => a.start - b.start)
  const starts = sorted.map(candidate => candidate.start)
  const reach: number[] = [] // furthest end among containers [0..i]
  for (const [i, candidate] of sorted.entries()) reach.push(Math.max(candidate.end, reach[i - 1] ?? -1))
  const reachAt = new Map<number, number>() // furthest end among containers starting exactly here
  for (const candidate of sorted) reachAt.set(candidate.start, Math.max(candidate.end, reachAt.get(candidate.start) ?? -1))
  return (start, end) => {
    let low = 0
    let high = starts.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (starts[mid]! < start) low = mid + 1
      else high = mid
    }
    // Starts earlier and reaches the end, or starts here and reaches further.
    return (low > 0 && reach[low - 1]! >= end) || (reachAt.get(start) ?? -1) > end
  }
}

/**
 * Choose one winner for every overlapping region.
 * A finding that wholly contains another wins over it whatever their priorities, so a
 * vocabulary word inside an e-mail address, IBAN, or phone number never leaves the rest
 * of that value in clear: the whole address becomes one symbol. Symbol-like input
 * (`LITERAL`) is the one exception and always wins. Between findings that only partly
 * overlap: higher priority, longer match, earlier start.
 * @param candidates - every finding, possibly overlapping.
 * @param isAllowed - whether a non-literal finding's normalized text is allowlisted.
 * @returns non-overlapping spans sorted by start.
 */
export function resolveOverlaps(candidates: readonly Candidate[], isAllowed: (candidate: Candidate) => boolean): Candidate[] {
  const kept = candidates.filter(candidate => candidate.end > candidate.start && (isLiteral(candidate) || !isAllowed(candidate)))
  const literals = kept.filter(isLiteral)
  // A container that overlaps a literal will lose to it, so it cannot claim what it contains.
  const inContainer = containmentIndex(kept.filter(candidate => !isLiteral(candidate) && !literals.some(literal => overlaps(literal, candidate))))
  const order = (a: Candidate, b: Candidate): number => Number(isLiteral(b)) - Number(isLiteral(a))
    || b.priority - a.priority
    || (b.end - b.start) - (a.end - a.start)
    || a.start - b.start
  const contained = (candidate: Candidate): boolean => !isLiteral(candidate) && inContainer(candidate.start, candidate.end)
  const accepted: Candidate[] = []
  const accept = (list: readonly Candidate[]): void => {
    for (const candidate of [...list].sort(order)) {
      if (!accepted.some(other => overlaps(candidate, other))) accepted.push(candidate)
    }
  }
  accept(kept.filter(candidate => !contained(candidate)))
  // A contained finding whose container lost to a partial overlap still covers its own text.
  accept(kept.filter(contained))
  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Decide the action for every span and the aggregate verdict: every finding gets its
 * class's action; nothing depends on a score.
 * @param spans - resolved spans.
 * @param settings - effective settings (per-class actions).
 * @returns decisions in span order and the verdict.
 */
export function decide(spans: readonly Candidate[], settings: SaiSettings): { decisions: Decision[]; verdict: Verdict } {
  const decisions: Decision[] = []
  let verdict: Verdict = { kind: 'proceed' }
  for (const span of spans) {
    const action: Action = span.classId === 'LITERAL' ? 'tokenize' : settings.actions[span.classId] ?? 'tokenize'
    if (action === 'block' && verdict.kind !== 'blocked') {
      verdict = { kind: 'blocked', code: 'POLICY_BLOCKED', classId: span.classId, detector: span.detector }
    }
    decisions.push({ span, action })
  }
  return { decisions, verdict }
}

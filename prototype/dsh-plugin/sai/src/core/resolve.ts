/** Overlap resolution and policy decisions. */

import { DEFAULT_MIN_CONFIDENCE, type SaiSettings } from './settings.ts'
import type { Action, Candidate, Decision, Verdict, Warning } from './types.ts'

/**
 * Choose one winner for every overlapping region.
 * Order: higher priority, longer match, higher confidence, earlier start.
 * @param candidates - every finding, possibly overlapping.
 * @param isAllowed - whether a non-literal finding's normalized text is allowlisted.
 * @returns non-overlapping spans sorted by start.
 */
export function resolveOverlaps(candidates: readonly Candidate[], isAllowed: (candidate: Candidate) => boolean): Candidate[] {
  const ordered = candidates
    .filter(candidate => candidate.end > candidate.start && (candidate.classId === 'LITERAL' || !isAllowed(candidate)))
    .sort((a, b) => b.priority - a.priority
      || (b.end - b.start) - (a.end - a.start)
      || b.confidence - a.confidence
      || a.start - b.start)
  const accepted: Candidate[] = []
  for (const candidate of ordered) {
    if (accepted.some(other => candidate.start < other.end && other.start < candidate.end)) continue
    accepted.push(candidate)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

/**
 * Decide the action for every span and the aggregate verdict.
 * @param spans - resolved spans.
 * @param settings - effective settings (actions and thresholds).
 * @returns decisions in span order, the verdict, and value-free warnings.
 */
export function decide(spans: readonly Candidate[], settings: SaiSettings): { decisions: Decision[]; verdict: Verdict; warnings: Warning[] } {
  const decisions: Decision[] = []
  const warnings: Warning[] = []
  let verdict: Verdict = { kind: 'proceed' }
  for (const span of spans) {
    let action: Action
    if (span.classId === 'LITERAL') {
      action = 'tokenize'
    } else {
      action = settings.actions[span.classId] ?? 'tokenize'
      const threshold = settings.minConfidence[span.classId] ?? DEFAULT_MIN_CONFIDENCE
      if ((action === 'tokenize' || action === 'mask') && span.confidence < threshold) {
        warnings.push({ classId: span.classId, detector: span.detector, confidence: span.confidence })
        action = settings.warnHandling === 'tokenize' ? 'tokenize' : 'warn'
      }
    }
    if (action === 'block' && verdict.kind !== 'blocked') {
      verdict = { kind: 'blocked', code: 'POLICY_BLOCKED', classId: span.classId, detector: span.detector }
    } else if (action === 'warn' && verdict.kind === 'proceed') {
      verdict = { kind: 'needs-confirmation' }
    }
    decisions.push({ span, action })
  }
  return { decisions, verdict, warnings }
}

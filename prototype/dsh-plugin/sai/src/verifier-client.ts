/**
 * Host side of the verifier: one HTTP call to the local model service per request.
 * The service runs on this computer (the settings accept only loopback addresses), so
 * the texts in the questions never leave it.
 */

import { isLoopbackUrl, type Verifier, type VerifierQuestion, type VerifierSettings } from './core/index.ts'

/**
 * A verifier that posts every question of a request to the local service in one call.
 * Request: `{"questions": [{state, word, classId, term}, ...]}`.
 * Answer: `{"probabilities": [p, ...]}`, one probability per question, in order.
 * @param settings - address and timeout.
 * @returns the verifier; its calls reject on a non-local address, an error, a timeout, or a malformed answer.
 */
export function httpVerifier(settings: Pick<VerifierSettings, 'url' | 'timeoutMs'>): Verifier {
  return {
    async verify(questions: readonly VerifierQuestion[]): Promise<readonly number[]> {
      if (!isLoopbackUrl(settings.url)) throw new Error('the verifier address is not on this computer')
      const response = await fetch(settings.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questions }),
        signal: AbortSignal.timeout(settings.timeoutMs),
      })
      if (!response.ok) throw new Error(`the verifier answered HTTP ${response.status}`)
      const body = await response.json() as { probabilities?: unknown }
      const probabilities = body.probabilities
      if (!Array.isArray(probabilities) || probabilities.length !== questions.length
        || !probabilities.every(value => typeof value === 'number' && value >= 0 && value <= 1)) {
        throw new Error('the verifier answer has the wrong shape')
      }
      return probabilities as number[]
    },
  }
}

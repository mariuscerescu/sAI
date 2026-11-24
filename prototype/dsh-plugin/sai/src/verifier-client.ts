/**
 * Host side of the verifier: one HTTP call to the local model service per request.
 * The service runs on this computer (the settings accept only loopback addresses), so
 * the texts in the questions never leave it.
 */

import { isLoopbackUrl, type Verifier, type VerifierAnswer, type VerifierQuestion, type VerifierSettings } from './core/index.ts'

const isProbability = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 1

/**
 * A verifier that posts every question of a request to the local service in one call.
 * Request: `{"questions": [{kind, state, word, classId, …}, ...]}`.
 * Answer: `{"answers": [...]}`, one per question, in order: a probability for `name` and `part`,
 * and for `which` one probability per option plus, last, "someone else or cannot tell".
 * @param settings - address and timeout.
 * @returns the verifier; its calls reject on a non-local address, an error, a timeout, or a malformed answer.
 */
export function httpVerifier(settings: Pick<VerifierSettings, 'url' | 'timeoutMs'>): Verifier {
  return {
    async verify(questions: readonly VerifierQuestion[]): Promise<readonly VerifierAnswer[]> {
      if (!isLoopbackUrl(settings.url)) throw new Error('the verifier address is not on this computer')
      const response = await fetch(settings.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ questions }),
        signal: AbortSignal.timeout(settings.timeoutMs),
      })
      if (!response.ok) throw new Error(`the verifier answered HTTP ${response.status}`)
      const body = await response.json() as { answers?: unknown }
      const answers = body.answers
      if (!Array.isArray(answers) || answers.length !== questions.length) throw new Error('the verifier answer has the wrong shape')
      answers.forEach((answer, index) => {
        const question = questions[index]!
        const valid = question.kind === 'which'
          ? Array.isArray(answer) && answer.length === question.options.length + 1 && answer.every(isProbability)
          : isProbability(answer)
        if (!valid) throw new Error('the verifier answer has the wrong shape')
      })
      return answers as VerifierAnswer[]
    },
  }
}

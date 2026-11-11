/**
 * Latency and memory benchmark of the sAI core: vocabulary compilation, redaction,
 * restoration, and streamed restoration, for growing vocabularies and texts.
 * Text is Romanian Wikipedia prose with vocabulary names mixed in.
 * Run from the repository root:
 *   node --expose-gc --import tsx/esm packages/experimental/sai/scripts/benchmark.ts
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Engine, type VocabularyEntry } from '../src/core/index.ts'

const CORPUS = 'D:\\Disk D 13-09-25\\EC\\sAI\\eval\\corpus\\ro-wiki'
const FIRST = ['Ion', 'Maria', 'Elena', 'Andrei', 'Victor', 'Natalia', 'Sergiu', 'Olga', 'Mihai', 'Ana', 'John', 'Mary', 'David', 'Emily', 'Robert', 'Sarah']
const LAST = ['Popescu', 'Ceban', 'Vrabie', 'Lungu', 'Ciobanu', 'Rusu', 'Cozma', 'Grosu', 'Moraru', 'Smith', 'Johnson', 'Walker', 'Clark', 'Brown', 'Taylor', 'Wilson']
const gc = (globalThis as { gc?: () => void }).gc

/** A vocabulary of `size` entries: three quarters people, the rest companies with a legal form. */
function vocabulary(size: number): VocabularyEntry[] {
  return Array.from({ length: size }, (_, i): VocabularyEntry => i % 4 === 3
    ? { id: `c${i}`, class: 'COMPANY', terms: [`Firma${i} Logistic ${i % 2 ? 'SRL' : 'Ltd'}`] }
    : { id: `p${i}`, class: 'PERSON', terms: [`${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}${i >= 256 ? i : ''}`] })
}

const prose = readdirSync(CORPUS).filter(name => name.endsWith('.txt')).map(name => readFileSync(join(CORPUS, name), 'utf8')).join('\n').split(/\s+/)
/** Prose of `words` words with a vocabulary name (some inflected) every 25 words. */
function text(words: number): string {
  const out: string[] = []
  for (let i = 0; i < words; i++) {
    out.push(prose[i % prose.length]!)
    if (i % 25 === 12) out.push(['Ion Popescu', 'Cebanei', 'Popescului', 'John Smith\'s', 'the Walkers', 'Firma3 Logistic', 'Mariei Ceban'][i % 7]!)
  }
  return out.join(' ')
}

/** Median wall time of `run` in milliseconds over enough repetitions. */
function time(run: () => void, budgetMs = 400): number {
  run()
  const samples: number[] = []
  const end = performance.now() + budgetMs
  while (samples.length < 5 || (performance.now() < end && samples.length < 200)) {
    const start = performance.now()
    run()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)]!
}

const ms = (value: number): string => value < 1 ? `${(value * 1000).toFixed(0)} µs` : `${value.toFixed(1)} ms`
const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1)} MB`

console.log('## Vocabulary compilation (once per settings change)')
console.log('| Entries | Spellings searched | Compile time | Heap of the compiled vocabulary |')
console.log('|---:|---:|---:|---:|')
for (const size of [10, 100, 1000, 5000]) {
  const entries = vocabulary(size)
  gc?.()
  const before = process.memoryUsage().heapUsed
  const engine = new Engine({ vocabulary: entries })
  gc?.()
  const heap = process.memoryUsage().heapUsed - before
  const compile = time(() => { new Engine({ vocabulary: entries }) }, 1500)
  console.log(`| ${size} | ${engine.dictionary.size} | ${ms(compile)} | ${gc ? mb(Math.max(0, heap)) : 'n/a'} |`)
}

for (const size of [100, 1000]) {
  const engine = new Engine({ vocabulary: vocabulary(size) })
  console.log(`\n## Per message, vocabulary of ${size} entries`)
  console.log('| Text | Redact | Restore | Stream restore (40-char chunks) | Redact throughput |')
  console.log('|---|---:|---:|---:|---:|')
  for (const [label, words] of [['short message, 50 words', 50], ['long message, 500 words', 500], ['document, 5 000 words', 5000], ['long conversation, 50 000 words', 50_000]] as const) {
    const input = text(words)
    const redactTime = time(() => { engine.session().redact(input) })
    const session = engine.session()
    const redacted = session.redact(input).text
    const restoreTime = time(() => { session.restore(redacted) })
    const streamTime = time(() => {
      const restorer = session.streamRestorer()
      for (let at = 0; at < redacted.length; at += 40) restorer.push(redacted.slice(at, at + 40))
      restorer.flush()
    })
    console.log(`| ${label} | ${ms(redactTime)} | ${ms(restoreTime)} | ${ms(streamTime)} | ${Math.round(words / redactTime * 1000).toLocaleString('en')} words/s |`)
  }
}

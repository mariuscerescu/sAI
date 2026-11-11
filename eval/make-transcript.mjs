// Builds a readable transcript (TRANSCRIPT.md) from one results directory written by run-eval.ts.
// Usage: node eval/make-transcript.mjs eval/results/run1
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) { console.error('usage: node make-transcript.mjs <results-dir>'); process.exit(1) }
const order = ['plain', 'typed', 'greek', 'typed-nopre', 'greek-nopre']
const results = readdirSync(dir).filter(name => name.endsWith('.json')).map(name => JSON.parse(readFileSync(join(dir, name), 'utf8')))
const byCase = new Map()
for (const result of results) {
  if (!byCase.has(result.case)) byCase.set(result.case, [])
  byCase.get(result.case).push(result)
}
const fence = text => '````text\n' + (text ?? '').replace(/\r/g, '') + '\n````'
const lines = [`# Transcript: ${dir}`, '', `Cazuri: ${byCase.size} · rezultate: ${results.length}`, '']
for (const [id, variants] of [...byCase].sort(([a], [b]) => a.localeCompare(b, 'en', { numeric: true }))) {
  variants.sort((a, b) => order.indexOf(a.variant) - order.indexOf(b.variant))
  lines.push(`## ${id} · ${variants[0].category}`, '')
  const turns = variants[0].turns.map(turn => turn.user)
  turns.forEach((user, index) => lines.push(`**Utilizator (pasul ${index + 1}):**`, '', fence(user.length > 1500 ? `${user.slice(0, 1500)}\n… [${user.length} caractere]` : user), ''))
  for (const result of variants) {
    lines.push(`### ${result.variant}`, '')
    result.turns.forEach((turn, index) => {
      const head = [`pasul ${index + 1}`, `${turn.ms} ms`]
      if (turn.leaks?.length) head.push(`**SCURGERI: ${turn.leaks.join(', ')}**`)
      if (turn.restoreReport) {
        const report = turn.restoreReport
        if (report.tolerantMatches.length) head.push(`alterate: ${report.tolerantMatches.join(' ')}`)
        if (report.unknownTokens.length) head.push(`necunoscute: ${report.unknownTokens.join(' ')}`)
        if (report.suspicious.length) head.push(`suspecte: ${report.suspicious.join(' ')}`)
      }
      if (turn.redactReport?.warnings?.length) head.push(`avertismente: ${turn.redactReport.warnings.length}`)
      lines.push(`*${head.join(' · ')}*`, '')
      if (turn.blocked) { lines.push(`**Blocat de sAI:** ${turn.blocked}`, ''); return }
      if (turn.error) lines.push(`**Eroare:** ${turn.error}`, '')
      if (result.variant !== 'plain' && turn.sentUser) {
        const sent = turn.sentUser.length > 1500 ? `${turn.sentUser.slice(0, 1500)}\n… [${turn.sentUser.length} caractere]` : turn.sentUser
        lines.push('Trimis modelului:', '', fence(sent), '')
      }
      if (result.variant === 'plain') {
        lines.push('Răspuns:', '', fence(turn.raw), '')
      } else {
        lines.push('Răspuns brut (simboluri):', '', fence(turn.raw), '', 'Răspuns restaurat:', '', fence(turn.restored), '')
      }
    })
  }
}
writeFileSync(join(dir, 'TRANSCRIPT.md'), lines.join('\n'))
console.log(`wrote ${join(dir, 'TRANSCRIPT.md')}`)

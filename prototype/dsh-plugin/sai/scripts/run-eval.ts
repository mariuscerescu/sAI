/**
 * Manual-evaluation runner for sAI. Sends every case of `sAI/eval/cases.json`
 * through the real DSH LLM runtime (pi-ai adapter, credentials from DSH_HOME)
 * in several variants and saves, for each one, what the provider received,
 * the raw answer, and the restored answer, so a person can read them all.
 *
 * Run from the repository root:
 *   node --import tsx/esm packages/experimental/sai/scripts/run-eval.ts [--cases A1,B2] [--variants plain,typed,greek] [--out <dir>]
 * Environment: DSH_HOME (credentials), SAI_EVAL_PROVIDER, SAI_EVAL_MODEL, SAI_EVAL_BASE_URL, SAI_EVAL_KEY_REF, SAI_EVAL_DELAY_MS.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type GenerateOptions, type Message, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { checksum731, Engine, normalizeTerm, type RedactReport, type RestoreReport, type SaiSettings, type VocabularyEntry } from '../src/core/index.ts'
import { termForms } from '../src/core/inflection.ts'
import { combineLanguages } from '../src/core/languages.ts'
import { redactRequest, restoreStream } from '../src/request.ts'

const REPO = resolve(import.meta.dirname, '../../../..')
const SAI_EVAL = 'D:\\Disk D 13-09-25\\EC\\sAI\\eval'

const { values } = parseArgs({ options: {
  cases: { type: 'string' }, variants: { type: 'string' }, out: { type: 'string' }, 'max-tokens': { type: 'string' }, file: { type: 'string' },
} })

const PROVIDER = process.env.SAI_EVAL_PROVIDER ?? 'open-router'
const MODEL = process.env.SAI_EVAL_MODEL ?? 'thinkingmachines/inkling-2-small:free'
const BASE_URL = process.env.SAI_EVAL_BASE_URL ?? 'https://openrouter.ai/api/v1'
const KEY_REF = process.env.SAI_EVAL_KEY_REF ?? 'OPEN_ROUTER_API_KEY'
const DELAY_MS = Number(process.env.SAI_EVAL_DELAY_MS ?? 4000)
const MAX_TOKENS = Number(values['max-tokens'] ?? 2500)

interface Variant { id: string; strategy?: 'typed' | 'greek'; preamble: boolean }
const ALL_VARIANTS: Variant[] = [
  { id: 'plain', preamble: false },
  { id: 'typed', strategy: 'typed', preamble: true },
  { id: 'greek', strategy: 'greek', preamble: true },
  { id: 'typed-nopre', strategy: 'typed', preamble: false },
  { id: 'greek-nopre', strategy: 'greek', preamble: false },
]

interface Case { id: string; category: string; turns: string[]; generate?: string }
interface CaseFile { system: string; vocabulary: VocabularyEntry[]; cases: Case[] }

// ── fictitious generators ────────────────────────────────────────────────

const FIRST = ['Adrian', 'Lilia', 'Sergiu', 'Natalia', 'Vadim', 'Corina', 'Dorin', 'Tatiana', 'Grigore', 'Ludmila', 'Pavel', 'Olga',
  'Igor', 'Svetlana', 'Marin', 'Doina', 'Viorel', 'Rodica', 'Eugen', 'Nadejda', 'Oleg', 'Larisa', 'Tudor', 'Stela', 'Valeriu',
  'Mihaela', 'Iurie', 'Veronica', 'Artur', 'Cristina', 'Petru', 'Ina', 'Vitalie', 'Silvia', 'Radu', 'Angela', 'Boris', 'Raisa',
  'Emil', 'Diana', 'Nicolae', 'Liliana', 'Roman', 'Vera', 'Anatol', 'Galina', 'Ruslan', 'Elvira', 'Leonid', 'Aurelia']
const LAST = ['Bostan', 'Cozma', 'Railean', 'Turcanu', 'Jardan', 'Spinu', 'Bejan', 'Caraman', 'Donica', 'Gutu', 'Melnic', 'Mocanu',
  'Nistor', 'Postica', 'Rotaru', 'Sirbu', 'Tabacaru', 'Ursu', 'Andronic', 'Arnaut', 'Balan', 'Banari', 'Bradu', 'Buzu', 'Chirtoaca',
  'Cimpoi', 'Ciorba', 'Creanga', 'Enache', 'Grosu', 'Iordache', 'Lazar', 'Manole', 'Nedelcu', 'Oprea', 'Paduraru', 'Preda', 'Sava',
  'Serban', 'Stanciu', 'Tanase', 'Toma', 'Diaconu', 'Dobre', 'Florea', 'Ilie', 'Lupascu', 'Neagu', 'Petrescu', 'Popovici']
const FIRMS = ['Delta Trans SRL', 'Vinaria Codru SA', 'Moldo Pixel SRL', 'Agro Prut SRL', 'Lumen Grup SRL', 'Fortis Construct SA',
  'Nistru Food SRL', 'Bric Logistic SRL', 'Sigma Med SRL', 'Orhei Textil SA', 'Cadran Soft SRL', 'Valea Verde SRL', 'Pro Energ SA',
  'Tirex Auto SRL', 'Vector Plus SRL', 'Holcom SRL', 'Lacto Nord SA', 'Ecovin SRL', 'Mega Tur SRL', 'Ritm Media SRL']
const DEPARTMENTS = ['Vânzări', 'IT', 'Contabilitate', 'Logistică', 'Juridic']

function person(i: number): string { return `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}` }
function idno(seed: number): string {
  const base = `100${String(600000000 + seed * 7919).slice(0, 9)}`
  for (let d = 0; d < 10; d++) if (checksum731(base + d)) return base + d
  return `${base}0`
}

interface Generated { text: Record<string, string>; vocabulary: VocabularyEntry[] }

function generate(kind: string | undefined): Generated {
  const people = (n: number): VocabularyEntry[] => Array.from({ length: n }, (_, i) => ({ id: `g_p${i}`, class: 'PERSON', terms: [person(i)] }))
  switch (kind) {
    case 'employees30': {
      const rows = Array.from({ length: 30 }, (_, i) => `${i + 1}. ${person(i)} — ${DEPARTMENTS[i % 5]} — ${(18000 + ((i * 3779) % 21000)).toLocaleString('ro-RO')} lei`)
      return { text: { EMPLOYEES: rows.join('\n') }, vocabulary: people(30) }
    }
    case 'companies15': {
      const rows = Array.from({ length: 15 }, (_, i) => `| ${FIRMS[i]} | ${idno(i)} | ${person(i + 30)} | 06${8 + (i % 2)}${String(100000 + i * 4321).slice(-6)} |`)
      const table = ['| Firma | IDNO | Contact | Telefon |', '|---|---|---|---|', ...rows].join('\n')
      const vocabulary: VocabularyEntry[] = [
        ...Array.from({ length: 15 }, (_, i) => ({ id: `g_f${i}`, class: 'COMPANY', terms: [FIRMS[i]!] })),
        ...Array.from({ length: 15 }, (_, i) => ({ id: `g_c${i}`, class: 'PERSON', terms: [person(i + 30)] })),
      ]
      return { text: { COMPANIES: table }, vocabulary }
    }
    case 'contract': return { text: { CONTRACT: CONTRACT }, vocabulary: [] }
    case 'minutes': return { text: { MINUTES: MINUTES }, vocabulary: [
      { id: 'g_m1', class: 'PERSON', terms: ['Sergiu Railean'] }, { id: 'g_m2', class: 'PERSON', terms: ['Natalia Cozma'] },
    ] }
    case 'people50': {
      const rows = Array.from({ length: 50 }, (_, i) => `${person(i)} lucrează la ${FIRMS[(i * 3) % 20]}.`)
      const vocabulary: VocabularyEntry[] = [
        ...people(50),
        ...FIRMS.map((firm, i) => ({ id: `g_f${i}`, class: 'COMPANY', terms: [firm] })),
      ]
      return { text: { PEOPLE50: rows.join('\n') }, vocabulary }
    }
    case 'repeat100': {
      const forms = ['Ion Popescu', 'Popescu', 'dl. Popescu', 'POPESCU', 'popescu', 'Popescu Ion', 'I. Popescu', 'domnul Popescu']
      const rows = Array.from({ length: 100 }, (_, i) => i % 3 === 0
        ? `${i + 1}. Raportul zilnic a fost trimis de ${forms[i % forms.length]} către Acme.`
        : `${i + 1}. Raportul zilnic a fost trimis de echipa de suport către Nordic Agro.`)
      return { text: { REPEAT100: rows.join('\n') }, vocabulary: [] }
    }
    default: return { text: {}, vocabulary: [] }
  }
}

const CONTRACT = `CONTRACT DE PRESTĂRI SERVICII LOGISTICE nr. 47/2026

Încheiat astăzi, 3 martie 2026, între:

1. Acme Logistic SRL, cu sediul la str. Florilor 12, Chișinău, IDNO 1003600012345, cont IBAN MD24AG000225100013104168 deschis la Banca Verde, reprezentată de directorul general Ion Popescu, IDNP 2001234567891, denumită în continuare „Prestator”;

2. Nordic Agro SA, cu sediul în or. Bălți, str. Independenței 5, reprezentată de Maria Ceban, director financiar, tel. +373 79 555 123, denumită în continuare „Beneficiar”.

Art. 1. Obiectul contractului. Prestatorul se obligă să asigure transportul, depozitarea și distribuția produselor agricole ale Beneficiarului, inclusiv a echipamentelor TermoGuard X9 utilizate pentru monitorizarea temperaturii, în cadrul Proiectului Orion.

Art. 2. Prețul. Beneficiarul achită lunar suma de 145.000 lei, fără TVA. Prețul poate fi indexat unilateral de Prestator cu până la 15% pe trimestru, cu notificare prealabilă de 5 zile.

Art. 3. Termene de plată. Plata se efectuează în termen de 10 zile de la emiterea facturii. Pentru fiecare zi de întârziere, Beneficiarul datorează penalități de 1% din suma restantă, fără plafon.

Art. 4. Răspunderea. Prestatorul răspunde pentru pierderea mărfii doar în limita a 5.000 lei per incident, indiferent de valoarea reală a mărfii. Deteriorarea cauzată de defectarea echipamentelor TermoGuard X9 nu este considerată pierdere.

Art. 5. Exclusivitate. Pe durata contractului și 24 de luni după încetare, Beneficiarul nu poate contracta servicii logistice de la alți prestatori.

Art. 6. Reziliere. Prestatorul poate rezilia contractul oricând, cu notificare de 7 zile. Beneficiarul poate rezilia contractul doar cu notificare de 6 luni și plata unei compensații egale cu prețul pe 12 luni.

Art. 7. Persoane de contact. Pentru Prestator: Andrei Lungu, manager de proiect, tel. 069123456. Pentru Beneficiar: Elena Vrabie, consilier juridic.

Art. 8. Litigii. Litigiile se soluționează exclusiv de instanța de la sediul Prestatorului.

Semnături:
Prestator — Ion Popescu, Acme Logistic SRL
Beneficiar — Maria Ceban, Nordic Agro SA`

const MINUTES = `PROCES-VERBAL al ședinței de lucru, Proiectul Orion, 12 mai 2026

Participanți: Ion Popescu (Acme), Maria Ceban (Nordic Agro), Elena Vrabie (consilier juridic), Andrei Lungu (manager proiect), Sergiu Railean (IT), Natalia Cozma (achiziții), Victor Ciobanu (logistică), Rodica Sandu (contabilitate), Floare Munteanu (stagiară), Radu Mare (furnizor), Lilia Bostan (HR), Dorin Jardan (calitate).

1. Andrei Lungu prezintă stadiul. Se decide ca Sergiu Railean să configureze senzorii TermoGuard X9 până la 20 mai.
2. Maria Ceban cere raport financiar. Rodica Sandu va pregăti raportul pentru Banca Verde până la 25 mai.
3. Elena Vrabie revizuiește contractul cu Acme Logistic și trimite observații lui Ion Popescu.
4. Natalia Cozma comandă 40 de unități TermoGuard X9 de la Radu Mare.
5. Victor Ciobanu planifică rutele pentru depozitul de pe str. Florilor 12.
6. Floare Munteanu asistă la inventar. Lilia Bostan organizează instruirea. Dorin Jardan nu a primit sarcini.`

// ── evaluation ───────────────────────────────────────────────────────────

const PATTERN_VALUES = ['2001234567891', '0981203456787', '1800101420010', 'MD24AG000225100013104168', '069123456', '79 555 123',
  '079555123', '0722 123 456', '4111 1111 1111 1111', 'ion.popescu@acme.md',
  '123-45-6789', '(212) 555-0143', '020 7946 0958', 'AB 12 34 56 C', 'GB82 WEST']

const BOTH_LANGUAGES = combineLanguages(['ro', 'en'])

/**
 * Leak scan of what was sent: every protected spelling and every generated inflected
 * form, plus a coarser stem check that does not trust the generator (any word starting
 * with the stem of a protected surname or name, e.g. "ceban…" or "popesc…").
 */
function leakScan(sent: string, vocabulary: readonly VocabularyEntry[]): string[] {
  const norm = normalizeTerm(sent)
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const found = new Set<string>()
  for (const entry of vocabulary) {
    for (const term of entry.terms) {
      const t = normalizeTerm(term)
      if (t.length < 3) continue
      // Romanian and English forms of the whole term and, for a person, of each name alone.
      const parts = entry.class === 'PERSON' && t.includes(' ') ? t.split(' ').filter(word => word.length >= 3) : []
      for (const form of new Set([...termForms(t, BOTH_LANGUAGES.wordForms), ...parts.flatMap(part => BOTH_LANGUAGES.wordForms(part))])) {
        const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(form)}(?![\\p{L}\\p{N}])`, 'u')
        if (re.test(norm)) found.add(`${entry.class}:${form === t ? term : `${term} (${form})`}`)
      }
      for (const word of t.split(' ')) {
        const stem = word.replace(/(?:ul|u|a|ea|e|i)$/u, '')
        if (stem.length < 4 || /\d/.test(stem)) continue
        const match = new RegExp(`(?<![\\p{L}\\p{N}])${escape(stem)}\\p{L}*`, 'u').exec(norm)
        if (match) found.add(`STEM?:${term} (${match[0]})`)
      }
    }
  }
  for (const value of PATTERN_VALUES) if (sent.includes(value)) found.add(`VALUE:${value}`)
  return [...found]
}

interface TurnRecord {
  user: string
  sentUser?: string
  sentSystemTail?: string
  raw: string
  rawReasoning: string
  restored: string
  redactReport?: RedactReport
  restoreReport?: RestoreReport
  leaks: string[]
  blocked?: string
  error?: string
  ms: number
}

function msgId(): never { return Math.random().toString(36).slice(2) as never }
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

async function main(): Promise<void> {
  const file = JSON.parse(readFileSync(join(SAI_EVAL, values.file ?? 'cases.json'), 'utf8')) as CaseFile
  const selectedCases = values.cases ? new Set(values.cases.split(',')) : undefined
  const selectedVariants = values.variants ? new Set(values.variants.split(',')) : new Set(['plain', 'typed', 'greek'])
  const variants = ALL_VARIANTS.filter(v => selectedVariants.has(v.id))
  const out = resolve(values.out ?? join(SAI_EVAL, 'results', new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')))
  mkdirSync(out, { recursive: true })

  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  const { default: Credentials } = await import(pathToFileURL(join(REPO, 'packages/credentials/credentials-local/lib/index.js')).href)
  await ctx.plugin(Credentials, {})
  const piAi = await import(pathToFileURL(join(REPO, 'packages/llm/llm-pi-ai/lib/index.js')).href)
  await ctx.plugin(piAi, {
    providers: { [PROVIDER]: { displayName: PROVIDER, apiKeyEnv: KEY_REF, api: 'openai-completions', baseURL: BASE_URL, models: [{ id: MODEL, name: MODEL }] } },
  })
  await sleep(500)

  let stopAll = false
  for (const testCase of file.cases) {
    if (stopAll) break
    if (selectedCases && !selectedCases.has(testCase.id)) continue
    const generated = generate(testCase.generate)
    const turns = testCase.turns.map(turn => turn.replace(/\{\{(\w+)\}\}/g, (_, key: string) => generated.text[key] ?? ''))
    const vocabulary = [...file.vocabulary, ...generated.vocabulary]
    for (const variant of variants) {
      const target = join(out, `${testCase.id}__${variant.id}.json`)
      if (existsSync(target)) continue
      const settings: Partial<SaiSettings> = { vocabulary, ...variant.strategy ? { strategy: variant.strategy } : {} }
      const session = variant.strategy ? new Engine(settings).session({ random: seeded(testCase.id) }) : undefined
      const history: Message[] = [{ id: msgId(), role: 'system', source: { kind: 'system-prompt' }, content: [{ type: 'text', text: file.system }] }]
      const records: TurnRecord[] = []
      for (const user of turns) {
        history.push({ id: msgId(), role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: user }] })
        const options: GenerateOptions = { provider: PROVIDER, model: MODEL, messages: [...history], maxTokens: MAX_TOKENS }
        const record: TurnRecord = { user, raw: '', rawReasoning: '', restored: '', leaks: [], ms: 0 }
        let outgoing = options
        if (session) {
          const redacted = redactRequest(options, session, () => '', variant.preamble ? session.preamble() : undefined)
          record.redactReport = redacted.report
          if (redacted.verdict.kind === 'blocked') {
            record.blocked = `${redacted.verdict.code}${redacted.verdict.classId ? ` (${redacted.verdict.classId})` : ''}`
            records.push(record)
            break
          }
          outgoing = redacted.options
          const last = outgoing.messages.at(-1)!
          record.sentUser = last.content.map(block => (block.type === 'text' ? block.text : '')).join('')
        }
        record.leaks = session ? leakScan(JSON.stringify(outgoing.messages), vocabulary) : []
        const started = Date.now()
        const result = await callWithRetry(ctx, outgoing, session, record)
        record.ms = Date.now() - started
        if (result === 'daily-limit') { stopAll = true; record.error = 'rate limit: daily quota reached'; records.push(record); break }
        records.push(record)
        history.push({ id: msgId(), role: 'assistant', source: { kind: 'model', provider: PROVIDER, model: MODEL }, content: [{ type: 'text', text: record.restored }] })
        await sleep(DELAY_MS)
      }
      if (stopAll && records.at(-1)?.error?.includes('daily')) { console.log(`stopped at ${testCase.id}/${variant.id}: daily quota`); break }
      writeFileSync(target, JSON.stringify({ case: testCase.id, category: testCase.category, variant: variant.id, model: MODEL, turns: records }, null, 2))
      const last = records.at(-1)
      console.log(`${testCase.id} ${variant.id}: ${last?.blocked ? `blocked ${last.blocked}` : last?.error ? `error ${last.error}` : `${last?.restored.length ?? 0} chars`}${records.some(r => r.leaks.length) ? ' LEAK' : ''}`)
    }
  }
  await ctx.fiber.dispose()
}

async function callWithRetry(ctx: Context, options: GenerateOptions, session: ReturnType<Engine['session']> | undefined, record: TurnRecord): Promise<'ok' | 'error' | 'daily-limit'> {
  for (let attempt = 0; attempt < 4; attempt++) {
    record.raw = ''; record.rawReasoning = ''; record.restored = ''; record.error = undefined
    const raw = tap(ctx.llm.stream(options), record)
    const stream = session ? restoreStream(raw, session, (report) => { record.restoreReport = report }) : raw
    let failure: string | undefined
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') record.restored += chunk.text
      if (chunk.type === 'finish' && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        failure = `${chunk.reason.failure.code}: ${chunk.reason.failure.message}`
      }
    }
    if (failure === undefined) return 'ok'
    record.error = failure
    const lower = failure.toLowerCase()
    if (lower.includes('per-day') || lower.includes('free-models-per-day') || lower.includes('daily')) return 'daily-limit'
    if (/\b(429|500|502|503|504)\b|rate.?limit|timeout|overloaded/.test(lower)) {
      console.log(`  retry after error: ${failure.slice(0, 160)}`)
      await sleep(30000 * (attempt + 1))
      continue
    }
    return 'error'
  }
  return 'error'
}

async function* tap(upstream: AsyncIterable<StreamChunk>, record: TurnRecord): AsyncIterable<StreamChunk> {
  for await (const chunk of upstream) {
    if (chunk.type === 'text-delta') record.raw += chunk.text
    if (chunk.type === 'reasoning-delta') record.rawReasoning += chunk.text
    yield chunk
  }
}

function seeded(seedText: string): () => number {
  let state = [...seedText].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0, 0x811C9DC5)
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

await main()

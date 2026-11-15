# sAI: arhitectura sistemului de pseudonimizare reversibilă

> Versiune: 0.1 (draft pentru implementare) · Data: 2026-11-10
> Faza: prototip în TypeScript, rulat ca plugin DeepSeek Harness (DSH) și ca banc de evaluare.
> Ținta finală: nucleu Rust (Android, iOS, web prin WASM, desktop).

---

## 0. Scop și principii

**Scop.** Termenii protejați (dintr-un vocabular definit de utilizator) și datele cu formă recunoscibilă (IDNP, telefon, IBAN etc.) sunt înlocuiți cu simboluri înainte ca textul să plece spre un model AI din cloud. La întoarcere, simbolurile sunt înlocuite la loc cu valorile originale.

**Principii de design (obligatorii pentru orice componentă):**

| # | Principiu | Consecință |
|---|---|---|
| P1 | **Nucleu pur** | `sai-core` nu face rețea, nu citește fișiere, nu știe de DSH. Primește date, întoarce date. |
| P2 | **Componente interschimbabile** | Fiecare etapă e definită printr-o interfață. Implementările (strategii de tokenizare, detectori, normalizatori) se aleg din configurație. |
| P3 | **Fail closed** | La orice incertitudine sau eroare: se blochează trimiterea sau se redactează mai mult, niciodată mai puțin. Restaurarea nu inventează valori. |
| P4 | **Fără valori în loguri** | Rapoartele, erorile și jurnalele de audit conțin clase, contoare și tokenuri, niciodată valori originale. |
| P5 | **Determinism în sesiune** | Aceeași entitate primește același simbol pe toată durata unei sesiuni. Istoricul retrimis la fiecare pas se redactează identic. |
| P6 | **Original neatins** | Textul original nu e modificat. Toate pozițiile se raportează la textul original (offset-uri UTF-16 în TS, octeți UTF-8 în Rust). |
| P7 | **Specificație executabilă** | Comportamentul e fixat prin vectori de test JSON comuni. Implementarea Rust trebuie să-i treacă identic. |

---

## 1. Vedere de ansamblu

### 1.1 Pachete

```
sAI/
├── packages/
│   ├── sai-core/          Nucleul pur (C1–C15). Zero dependențe de platformă.
│   ├── sai-messages/      Redactare și restaurare la nivel de cerere structurată (C16).
│   ├── sai-dsh-plugin/    Adaptorul DeepSeek Harness (C17).
│   └── sai-eval/          Bancul de evaluare comparativă (C18).
├── config/
│   ├── vocabulary.toml    Vocabularul utilizatorului (exemplu fictiv).
│   ├── detectors/*.toml   Detectori de tipare definiți ca date.
│   └── policy.toml        Politici per clasă.
├── tests/vectors/*.json   Vectori de test comuni (TS acum, Rust ulterior).
└── docs/
```

### 1.2 Diagrama de context

```
                ┌──────────────────────── GAZDĂ ────────────────────────┐
                │  sai-dsh-plugin (C17)        sai-eval (C18)           │
                │  - citește config/vocabular  - citește setul de date  │
                │  - stochează seiful          - apelează LLM-ul        │
                │  - apelează LLM-ul           - calculează metrici     │
                └───────────────┬──────────────────────┬────────────────┘
                                │                      │
                         ┌──────▼──────────────────────▼──────┐
                         │      sai-messages (C16)            │  cereri structurate:
                         │  system / mesaje / tool calls / JSON│  ce câmpuri se redactează
                         └──────────────────┬─────────────────┘
                                            │ șiruri de text
                         ┌──────────────────▼─────────────────┐
                         │          sai-core (C1–C15)         │
                         │  Engine → Session → redact/restore │
                         └────────────────────────────────────┘
```

### 1.3 Componentele (index)

| ID | Componentă | Pachet | Interschimbabilă? |
|---|---|---|---|
| C0 | Compilatorul de configurație | core | — |
| C1 | Engine (fațadă) | core | — |
| C2 | Session | core | — |
| C3 | Gardianul de intrare | core | — |
| C4 | Normalizatorul | core | ✅ `Normalizer` |
| C5 | Detectorii | core | ✅ `Detector` (listă) |
| C6 | Rezolvatorul | core | ✅ `Resolver` |
| C7 | Motorul de politici | core | ✅ `PolicyEngine` |
| C8 | Seiful | core | — |
| C9 | **Strategia de tokenizare** | core | ✅ `TokenStrategy` (typed, greek) |
| C10 | Rescriitorul | core | — |
| C11 | Verificatorul de scurgeri | core | — |
| C12 | Constructorul de rapoarte și preambul | core | — |
| C13 | Restauratorul | core | — |
| C14 | Selectorul formei de restaurare | core | ✅ `SurfaceSelector` |
| C15 | Restauratorul de streaming | core | — |
| C16 | Redactorul de mesaje | messages | ✅ adaptor de format |
| C17 | Pluginul DSH | dsh-plugin | — |
| C18 | Bancul de evaluare | eval | — |

---

## 2. Modelul de date comun

Toate componentele comunică prin aceste tipuri. Sunt scrise ca TypeScript, dar sunt neutre față de limbaj.

```ts
// ── Identificare ────────────────────────────────────────────────
type ClassId = string                 // "PERSON", "COMPANY", "IDNP", "PHONE", "LITERAL"...
type DetectorId = string              // "dictionary", "pattern:idnp", "session", "literal"

type EntityKey =                      // ce înseamnă "aceeași entitate"
  | { kind: 'entry';     entryId: string }                  // intrare din vocabular
  | { kind: 'canonical'; classId: ClassId; value: string }  // valoare canonică (tipare, părți de nume comune)
  | { kind: 'literal';   value: string }                    // șir care arată ca un token

// ── Text normalizat ─────────────────────────────────────────────
interface NormalizedText {
  original: string
  norm: string                        // textul normalizat (doar pentru căutare)
  toOriginal: Uint32Array             // poziție în norm → poziție în original (len = norm.length + 1)
}

// ── Detecție ────────────────────────────────────────────────────
interface Candidate {
  start: number; end: number          // în textul ORIGINAL, [start, end)
  classId: ClassId
  detector: DetectorId
  priority: number                    // literal=400, dictionary=300, session=250, pattern=200
  confidence: number                  // 0..1
  key: EntityKey
}

interface Span extends Candidate {}   // un Candidate care a trecut de rezolvator

// ── Politici ────────────────────────────────────────────────────
type Action = 'tokenize' | 'mask' | 'warn' | 'ignore' | 'block'
interface Decision { span: Span; action: Action; reason?: string }
type Verdict =
  | { kind: 'proceed' }
  | { kind: 'needs-confirmation'; warnings: Warning[] }
  | { kind: 'blocked'; reason: BlockReason }

// ── Seif ────────────────────────────────────────────────────────
interface VaultEntry {
  token: string                       // "⟦COMPANY_1⟧" sau "β"
  classId: ClassId
  key: EntityKey
  surfaceForms: string[]              // formele exacte văzute, în ordinea apariției
  firstSeenAt: number                 // indexul apelului redact() în sesiune
}

// ── Rezultate ───────────────────────────────────────────────────
interface RedactOutput {
  text: string                        // textul redactat (gol dacă verdictul e blocked)
  verdict: Verdict
  report: RedactReport
}
interface RedactReport {
  countsByClass: Record<ClassId, number>
  tokensUsed: string[]                // fără valori
  warnings: Warning[]                 // { classId, detector, start, end, code }
  strategy: string
  timingsMs: Record<string, number>
}
interface RestoreOutput { text: string; report: RestoreReport }
interface RestoreReport {
  restored: number
  tolerantMatches: string[]           // tokenuri găsite în formă alterată
  unknownTokens: string[]             // simboluri fără intrare în seif (lăsate neschimbate)
  suspicious: string[]                // restaurări îndoielnice (ex.: literă grecească în context matematic)
}
```

**Erori (toate fără valori în mesaj):**

| Cod | Unde apare | Comportament |
|---|---|---|
| `CONFIG_INVALID` | C0 | Engine-ul nu se creează. Include fișier, linie, motiv. |
| `INPUT_TOO_LARGE` / `INPUT_INVALID` | C3 | Redactarea se oprește. |
| `POLICY_BLOCKED` | C7 | Verdict `blocked`, textul nu e întors. |
| `STRATEGY_UNSUITABLE` | C9 | De exemplu prea mult text grecesc pentru strategia greek. Se blochează. |
| `STRATEGY_EXHAUSTED` | C9 | Capacitatea de simboluri e depășită și politica de depășire e `block`. |
| `LEAK_DETECTED` | C11 | Se blochează, cu clasa și detectorul, fără valoare. |

---

## 3. Componentele: contract detaliat

Formatul fiecărei secțiuni: **Rol, Intrare, Ieșire, Erori, Puncte de extensie**.

### C0. Compilatorul de configurație

- **Rol:** transformă configurația umană în structuri rapide, o singură dată.
- **Intrare:** `EngineConfig`
  ```ts
  interface EngineConfig {
    vocabulary: string                 // conținut TOML
    detectors: string[]                // conținuturi TOML (câte unul per detector)
    nameLists?: { first: string; last: string }  // liste text, un nume per linie
    policy: string                     // conținut TOML
    allowlist?: string[]
    normalizer?: NormalizerConfig
    strategies: StrategyConfig[]       // ex.: [{ id: 'typed' }, { id: 'greek', overflow: 'subscript' }]
    limits?: { maxInputChars: number } // implicit 200_000
  }
  ```
- **Ieșire:** `CompiledConfig` (intern): automatul vocabularului (pe forme normalizate, inclusiv variantele generate), detectorii compilați (regex + validator + canonicalizator), tabelul de politici, allowlist-ul normalizat, fabricile de strategii.
- **Erori:** `CONFIG_INVALID` pentru: TOML invalid, termen gol, același termen normalizat în două intrări cu clase diferite, regex invalid, validator necunoscut, clasă fără politică, strategie necunoscută.
- **Extensie:** registre de validatori (`checksum_731`, `luhn`, `iban_mod97`, `cnp`) și canonicalizatori (`digits_only`, `phone_e164_md`, `upper_nospace`), după nume.

### C1. Engine (fațadă)

- **Rol:** punctul de intrare public. E imuabil după creare și poate fi partajat între sesiuni.
- **Intrare:** `EngineConfig`
- **Ieșire:** `Engine`
  ```ts
  class Engine {
    static create(cfg: EngineConfig): Engine            // aruncă CONFIG_INVALID
    newSession(opts: SessionOptions): Session
    strategies(): string[]
  }
  interface SessionOptions {
    strategy: string                   // 'typed' | 'greek'
    preamble?: boolean                 // implicit true
    policyOverrides?: Partial<Record<ClassId, Action>>
    rng?: () => number                 // injectabil pentru teste deterministe (implicit: CSPRNG)
  }
  ```

### C2. Session

- **Rol:** starea unei conversații: seiful (C8), starea strategiei, contorul de apeluri. Orchestrează pipeline-ul.
- **API:**
  ```ts
  interface Session {
    redact(text: string): RedactOutput                  // C3 → C12
    restore(text: string): RestoreOutput                // C13–C14
    restoreStream(): StreamRestorer                     // C15
    preamble(): string | null                           // din C12
    exportState(): SessionSnapshot                      // pentru persistență (gazda o criptează)
    close(): void                                       // golește seiful
  }
  ```
- **Invariant:** `redact()` este idempotent pe istoric. Dacă același text e redactat de două ori, rezultatul e identic (P5).

### C3. Gardianul de intrare

- **Rol:** verificări înainte de orice procesare și protecția simbolurilor deja existente.
- **Intrare:** `text: string`, starea strategiei.
- **Ieșire:** `Candidate[]` de clasă `LITERAL` pentru orice șir care arată ca un simbol al strategiei active (de exemplu `⟦...⟧` la typed, litere grecești izolate la greek). Astfel acestea nu vor fi confundate la restaurare.
- **Erori:** `INPUT_TOO_LARGE`, `INPUT_INVALID` (surogate UTF-16 izolate).
- **Notă:** strategia își expune propriul detector de „simboluri existente” (`strategy.literalDetector()`), deci C3 nu cunoaște formatul tokenurilor.

### C4. Normalizatorul

- **Rol:** produce o vedere normalizată pentru căutare, cu hartă de poziții spre original.
- **Interfață:** `interface Normalizer { normalize(text: string): NormalizedText }`
- **Intrare:** `text: string`
- **Ieșire:** `NormalizedText`
- **Reguli implicite (`ro-default`):** NFC; litere mici; `ș ş → s`, `ț ţ → t`, `ă â → a`, `î → i`; cratime și apostrofuri unificate (`‐ – — → -`, `’ ‘ → '`); secvențe de spațiu alb → un spațiu.
- **Invariant:** aceeași funcție e folosită în C0 (pe termeni) și aici (pe text).

### C5. Detectorii

- **Interfață comună:**
  ```ts
  interface Detector {
    id: DetectorId
    detect(t: NormalizedText): Candidate[]
  }
  ```
- **Intrare:** `NormalizedText`
- **Ieșire:** `Candidate[]` (pot fi suprapuși, ordinea nu contează)

| Implementare | Cum lucrează | `priority` | `confidence` | `key` |
|---|---|---|---|---|
| `DictionaryDetector` | Aho-Corasick pe `norm`, verificarea granițelor de cuvânt | 300 | 1.0 | `entry` |
| `PatternDetector` (unul per fișier din `detectors/`) | regex → validator → canonicalizator. Cuvintele de context cresc încrederea | 200 | 0.6–1.0 | `canonical` |
| `SessionDetector` | formele deja înlocuite în sesiune (din seif), căutate din nou, cu granițe de cuvânt | 250 | 1.0 | cheia intrării din seif |
| `LiteralDetector` (furnizat de strategie, vezi C3) | formatul simbolurilor strategiei | 400 | 1.0 | `literal` |

**Fără detector de nume nedeclarate (decizie 15.11.2026).** Un prototip anterior avea un `NameDetector` bazat pe liste publice de prenume și nume (725 de nume, RO/MD și EN). A fost eliminat, împreună cu listele: prindea doar numele frecvente, iar un detector care lasă să treacă numele rare dă o siguranță falsă. Promisiunea sAI e acum una pe care o poate ține integral:

- **protejat garantat:** tot ce e declarat în vocabular, cu formele lui regulate, plus identificatorii în formatele standard ale tiparelor activate;
- **neprotejat:** orice altceva, inclusiv persoanele nedeclarate, care ajung la model așa cum sunt scrise.

Fără liste, părțile unui nume declarat se citesc după poziție: toate cuvintele în afară de ultimul sunt prenume („Ana Maria Popescu”: Ana și Maria sunt prenume, Popescu e numele de familie). Un prenume găsit singur cere majusculă și are încredere 0.6.

Regula „prenume nedeclarat lângă un nume de familie protejat” rămâne, pentru că pornește de la ceva declarat: un cuvânt cu majusculă chiar înaintea numelui de familie formează cu acesta o persoană nouă („Floare Munteanu”). Nu se aplică titlurilor și formulelor de adresare din pachetele de limbă (`dl.`, `stimate`, `dear`, `hello`…). La început de propoziție se aplică doar înaintea formei declarate a numelui, nu înaintea unei forme flexionate („Contractul Popescului” rămâne).

Format detector de tipar (date, nu cod):
```toml
id = "pattern:idnp"
class = "IDNP"
regex = '(?<!\d)\d{13}(?!\d)'
validator = "checksum_731"
canonical = "digits_only"
context = ["idnp", "cod personal", "numar de identificare"]
context_window = 30          # caractere în jur
confidence = { base = 0.9, with_context = 1.0 }
```

### C6. Rezolvatorul

- **Interfață:** `interface Resolver { resolve(c: Candidate[], allow: Allowlist): Span[] }`
- **Intrare:** toți candidații + allowlist-ul.
- **Ieșire:** `Span[]` sortate după `start`, **fără suprapuneri**.
- **Reguli (în ordine):**
  1. eliminare dacă textul normalizat al candidatului e în allowlist (excepție: `LITERAL` nu se elimină niciodată);
  2. `LITERAL` câștigă întotdeauna;
  3. **conținerea:** un candidat aflat complet în interiorul altuia, mai lung, pierde, indiferent de prioritate. Astfel „acme” din `ion.rusu@acme.md` nu mai rupe e-mailul: toată adresa devine `⟦EMAIL_1⟧`. Același lucru e valabil pentru IBAN și telefoane. Dacă cel care conține pierde la rândul lui o suprapunere parțială, cei dinăuntru sunt reluați, ca textul lor să rămână acoperit (decizie 15.11.2026);
  4. la suprapuneri parțiale, `priority` mai mare câștigă;
  5. potrivirea mai lungă câștigă;
  6. `confidence` mai mare câștigă;
  7. `start` mai mic câștigă.

### C7. Motorul de politici

- **Interfață:** `interface PolicyEngine { decide(spans: Span[]): { decisions: Decision[]; verdict: Verdict } }`
- **Intrare:** `Span[]` + tabelul de politici (+ suprascrierile sesiunii).
- **Ieșire:** o `Decision` per span + `Verdict`.
- **Format `policy.toml`:**
  ```toml
  [default]
  action = "tokenize"
  min_confidence = 0.8          # sub prag: acțiunea devine "warn"

  [class.CARD]
  action = "block"

  [class.PERSON]
  action = "tokenize"
  min_confidence = 0.85

  [class.LITERAL]
  action = "tokenize"           # obligatoriu, nu poate fi suprascris
  ```
- **Reguli:** orice `block` → verdict `blocked`. Orice `warn` (și niciun `block`) → `needs-confirmation`. `LITERAL` e întotdeauna `tokenize`.
- **Notă:** în modul `needs-confirmation`, textul redactat **este** întors (cu span-urile `warn` netokenizate). Gazda decide dacă trimite. Pentru prototip, `sai-dsh-plugin` tratează `warn` ca `tokenize` și doar raportează, ca să nu întrerupă agentul.

### C8. Seiful

- **Rol:** corespondența bidirecțională entitate ↔ simbol pentru o sesiune.
- **API intern:**
  ```ts
  interface Vault {
    get(key: EntityKey): VaultEntry | undefined
    byToken(token: string): VaultEntry | undefined
    put(entry: VaultEntry): void
    addSurfaceForm(key: EntityKey, form: string): void
    entries(): readonly VaultEntry[]
    snapshot(): VaultSnapshot
    wipe(): void
  }
  ```
- **Intrare:** chei și simboluri (de la C9), forme de suprafață (de la C10).
- **Ieșire:** intrări (pentru C10, C11, C13, C14).
- **Invariant:** relația `token ↔ key` e bijectivă în sesiune.

### C9. Strategia de tokenizare (componenta interschimbabilă)

- **Interfață:**
  ```ts
  interface TokenStrategy {
    id: string
    createState(init: { rng: () => number }): StrategyState
    /** observă textul înainte de atribuire (ex.: greek exclude literele prezente) */
    observe(text: string, state: StrategyState): void | StrategyUnsuitable
    assign(key: EntityKey, classId: ClassId, state: StrategyState): string | StrategyExhausted
    literalDetector(state: StrategyState): Detector
    scan(text: string, state: StrategyState, vault: Vault): TokenHit[]
    holdback(tail: string, state: StrategyState): number
    preamble(state: StrategyState, classesUsed: ClassId[]): string
  }
  interface TokenHit {
    start: number; end: number
    token: string                      // forma canonică a simbolului ("β", "⟦COMPANY_1⟧")
    match: 'exact' | 'tolerant'
    suspicious?: boolean
  }
  ```
- **Intrare (redactare):** cheia entității + clasa + starea strategiei.
- **Ieșire (redactare):** simbolul.
- **Intrare (restaurare):** textul răspunsului + seiful.
- **Ieșire (restaurare):** `TokenHit[]`.

#### C9.a `TypedStrategy`

| Aspect | Specificație |
|---|---|
| Format | `⟦CLASĂ_N⟧`, cu `N` contor per clasă, de la 1 |
| Stare | `Map<ClassId, number>` |
| `observe` | nimic |
| Capacitate | nelimitată |
| `scan` exact | `⟦([A-Z_]+)_(\d+)⟧` |
| `scan` tolerant | `[X_N]`, `【X_N】`, `⟦ x_n ⟧` (spații, litere mici), `X\_N` (escapat de markdown). Acceptat **doar** dacă `⟦X_N⟧` există în seif |
| `holdback` | dacă finalul conține un `⟦` sau `[` deschis și neînchis: lungimea de la acel caracter (max 32) |
| `preamble` | „Textul conține simboluri de forma ⟦CLASĂ_N⟧ care înlocuiesc date confidențiale (ex. ⟦PERSON_1⟧). Păstrează-le exact, inclusiv în cod și în argumentele uneltelor.” |

#### C9.b `GreekStrategy` (propunerea colegului)

| Aspect | Specificație |
|---|---|
| Pool | 24 de minuscule `α…ω` (fără `ς`). Opțional (`uppercase: true`): `Γ Δ Θ Λ Ξ Π Σ Φ Ψ Ω` |
| Stare | permutare aleatorie a pool-ului (Fisher-Yates cu CSPRNG), cursor, set de litere excluse, contor de depășire |
| Atribuire | următoarea literă neexclusă din permutare, în ordinea apariției entităților. **Altă sesiune înseamnă altă permutare**, deci alte litere |
| `observe` | orice literă grecească prezentă în text și **încă neatribuită** e exclusă din pool. Dacă rămân sub `minFree` (implicit 4) litere libere și există entități noi: `STRATEGY_UNSUITABLE` |
| Depășire (`overflow`) | `subscript` (implicit): `α₂, β₂, …, α₃…`. `pairs`: `αβ`. `block`: `STRATEGY_EXHAUSTED` |
| `literalDetector` | litere grecești izolate deja prezente în text (inclusiv cele atribuite) devin `LITERAL` |
| `scan` exact | literă din pool (+ indice opțional), **neatinsă de alte litere** (latine sau grecești) la stânga și la dreapta. Cratima, punctuația, spațiul și cifrele sunt granițe |
| `scan` tolerant | majuscula echivalentă (`Β` → `β`), doar dacă `uppercase: false`. Transliterările („beta”) **nu** se restaurează |
| `suspicious` | litera e lângă `= + − × / ^` sau cifre (context matematic) |
| `holdback` | 1 dacă ultimul caracter e literă din pool, plus eventualii indici de la final |
| `preamble` | „Simbolurile grecești izolate (ex. β, κ) înlocuiesc termeni confidențiali. Păstrează-le exact, nu le traduce și nu le folosi cu alt sens.” |

### C10. Rescriitorul

- **Rol:** construiește textul redactat dintr-o singură trecere.
- **Intrare:** textul original, `Decision[]`, simbolurile atribuite (C9), regulile de mascare.
- **Ieșire:** `string` redactat. Efect secundar: `vault.addSurfaceForm()` pentru fiecare span tokenizat.
- **Acțiuni:** `tokenize` → simbolul. `mask` → masca clasei (de exemplu telefon `069 *** ***`, cu formatul păstrat). `warn` și `ignore` → textul original.

### C11. Verificatorul de scurgeri

- **Rol:** ultima linie de apărare înainte de ieșire.
- **Intrare:** textul redactat, seiful, detectorii C5.
- **Ieșire:** `ok`, sau eroarea `LEAK_DETECTED { classId, detector }`.
- **Verificări:**
  1. rulează din nou `DictionaryDetector` și `PatternDetector` pe textul redactat (normalizat). Orice potrivire în afara simbolurilor înseamnă scurgere;
  2. caută fiecare `surfaceForm` din seif (normalizată) în textul redactat normalizat.
- **Excepții:** potrivirile care cad peste un simbol inserat, peste un span lăsat intenționat în clar de politică (`warn`, `ignore`) sau peste un termen din allowlist nu sunt scurgeri.

### C12. Constructorul de rapoarte și preambul

- **Intrare:** deciziile, verdictul, seiful, cronometrările.
- **Ieșire:** `RedactReport`. `preamble()` apelează `strategy.preamble()` dacă `SessionOptions.preamble` e activ.

### C13. Restauratorul

- **Intrare:** textul răspunsului (sau un prefix sigur, de la C15).
- **Pași:**
  1. `strategy.scan()` → `TokenHit[]`;
  2. pentru fiecare hit: `vault.byToken()`. Dacă nu există → `unknownTokens`, textul rămâne neschimbat (P3);
  3. forma de restaurat de la C14;
  4. rescrierea într-o singură trecere.
- **Ieșire:** `RestoreOutput`.
- **Opțiune `context: 'text' | 'json-string'`:** în modul `json-string` (folosit de C16 pentru argumentele uneltelor), valoarea restaurată e escapată pentru un șir JSON (`"` → `\"`, `\` → `\\`, caractere de control).

### C14. Selectorul formei de restaurare

- **Interfață:** `interface SurfaceSelector { select(e: VaultEntry, vocab: VocabEntry | undefined): string }`
- **Reguli implicite:**
  1. `restore_as` din intrarea de vocabular, dacă e definit;
  2. altfel, prima formă de suprafață văzută în sesiune;
  3. pentru tipare: forma originală exactă, nu cea canonică.

### C15. Restauratorul de streaming

- **API:**
  ```ts
  interface StreamRestorer {
    push(chunk: string): string        // întoarce textul restaurat sigur de emis
    finish(): RestoreOutput            // golește coada, raportul final
  }
  ```
- **Logică:** `buffer += chunk`. `k = strategy.holdback(buffer)`. Se restaurează și se emite `buffer[0 : len-k]`, iar `buffer[len-k :]` e reținut.
- **Invariant (testat):** pentru orice împărțire în bucăți, concatenarea ieșirilor e egală cu `restore(textul întreg)`.

### C16. Redactorul de mesaje (`sai-messages`)

- **Rol:** aplică nucleul pe **toate** câmpurile de text ale unei cereri către LLM și restaurează **toate** câmpurile răspunsului. Nucleul lucrează doar pe șiruri, iar C16 știe ce câmpuri există.
- **Format neutru:**
  ```ts
  interface LlmRequest {
    system?: string
    messages: Array<{
      role: 'user' | 'assistant' | 'tool'
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'tool_call'; id: string; name: string; argsJson: string }
        | { type: 'tool_result'; callId: string; text: string }
        | { type: 'reasoning'; text: string }
        | { type: 'other'; raw: unknown }        // trecut neatins (ex.: imagini)
      >
    }>
  }
  ```
- **Intrare (redactare):** `LlmRequest` + `Session`.
- **Ieșire (redactare):** `LlmRequest` redactat (copie nouă) + `RedactReport` agregat. Un singur verdict: dacă orice câmp e `blocked`, toată cererea e blocată.
- **Reguli pe câmpuri:**

| Câmp | Redactare | Restaurare (răspuns) |
|---|---|---|
| `system` | da | — |
| `text` (user/assistant) | da | da (`context: 'text'`) |
| `tool_result.text` | da | — |
| `tool_call.argsJson` | parse JSON → redactare doar pe **valorile** șir (nu pe chei) → serializare | da, pe JSON brut (`context: 'json-string'`), deci argumentele restaurate înainte de executarea uneltei |
| `reasoning` | da | da (pentru afișare) |
| `name` (unealtă) | nu | nu |
| `other` | nu (raportat ca netratat) | nu |

- **Streaming:** câte un `StreamRestorer` per bloc de conținut (text, argumente ale unui apel de unealtă, reasoning), pentru că blocurile se intercalează.
- **Adaptoare de format:** `fromDsh(GenerateOptions) → LlmRequest`, `toDsh(...)`, `fromOpenAI`, `fromAnthropic` (ulterior). Acesta e punctul de extensie pentru alte gazde.

### C17. Pluginul DSH (`sai-dsh-plugin`)

- **Rol:** leagă C16 de fluxul DSH. Conține **zero** logică de redactare.
- **Intrare:** configurația pluginului (`strategy`, `preamble`, căi către vocabular, detectori, politici), cererile DSH către LLM, chunk-urile răspunsului.
- **Ieșire:** cereri redactate trimise providerului real. Chunk-uri restaurate livrate buclei agentului (deci jurnalul și interfața DSH văd originalele, iar cloud-ul vede doar simboluri).
- **Mapare sesiuni:** sesiunea DSH (id) ↔ `Session` sai. Seiful e persistat lângă sesiunea DSH (`exportState`) pentru reluare.
- **Punct de interceptare:** **de confirmat prin spike** (vezi §8). Candidați:
  - (A) adaptor de provider „înveliș” (`sai/<provider-real>`) care redactează, apelează providerul real prin `ctx.llm.stream` și restaurează;
  - (B) listener `llm/stream` care construiește o cerere nouă redactată și o reapelează cu marcaj anti-recursivitate.
- **Audit:** pentru fiecare apel, un eveniment în jurnal: `{ turn, step, strategy, countsByClass, warnings, unknownTokens }`, fără valori.

### C18. Bancul de evaluare (`sai-eval`)

- **Rol:** rulează același set de date prin mai multe configurații și produce raportul comparativ.
- **Intrare:**
  - `dataset.jsonl`: `{ id, prompt, vocabularyRef, expectedEntities[], tags[] }`, **doar date fictive**;
  - `matrix.toml`: configurațiile de comparat, de exemplu:
    ```toml
    [[run]] id = "plain"          strategy = "none"
    [[run]] id = "typed+pre"      strategy = "typed" preamble = true
    [[run]] id = "typed"          strategy = "typed" preamble = false
    [[run]] id = "greek+pre"      strategy = "greek" preamble = true
    [[run]] id = "greek"          strategy = "greek" preamble = false
    ```
  - modelul și providerul (prin același `ctx.llm` din DSH sau printr-un client HTTP direct).
- **Componente interne:**
  - `Runner`: pentru fiecare (prompt × configurație): sesiune nouă → redactare → apel LLM → restaurare. Toate configurațiile rulează **pe același prompt, în paralel**;
  - `MetricsCollector`;
  - `Judge`: notarea calității față de `plain` (manual prin CSV, sau un LLM-evaluator);
  - `ReportWriter`: Markdown + CSV.
- **Ieșire:** `results.jsonl` (o linie per prompt × configurație) + `report.md`.

| Metrică | Definiție |
|---|---|
| `leaks` | termeni protejați găsiți în payload-ul trimis (trebuie 0) |
| `restore_rate` | simboluri restaurate / simboluri prezente în răspuns |
| `altered` | simboluri găsite doar tolerant |
| `invented` | simboluri necunoscute în răspuns |
| `false_restore` | restaurări greșite (verificate față de `expectedEntities`) |
| `quality` | 1–5, față de `plain` |
| `overhead_ms` | redactare + restaurare |
| `payload_tokens` | tokeni trimiși (cost) |

---

## 4. Fluxurile de date

### F1. Inițializare
```
gazda citește fișierele ──► EngineConfig ──► C0 ──► Engine (C1)
                                                     │
gazda: newSession({strategy, preamble}) ─────────────┴──► Session (C2)
                                                          seif gol + stare strategie
```

### F2. Redactarea unui text (`session.redact`)
```
text
 │
 ├─► C9.observe(text)                    → poate da STRATEGY_UNSUITABLE
 ├─► C3 gardian (limite + LiteralDetector) → Candidate[] LITERAL
 ├─► C4 normalizator                     → NormalizedText
 ├─► C5 detectori (toți)                 → Candidate[]
 ├─► C6 rezolvator                       → Span[]
 ├─► C7 politici                         → Decision[] + Verdict ──► blocked? STOP
 ├─► C9.assign + C8 seif                 → simbol per entitate
 ├─► C10 rescriitor                      → text redactat (+ forme în seif)
 ├─► C11 verificator                     → ok | LEAK_DETECTED ──► STOP
 └─► C12 raport                          → RedactOutput
```

### F3. Redactarea unei cereri structurate (C16)
```
LlmRequest ──► pentru fiecare câmp de text (în ordinea din conversație):
                  session.redact(câmp)        (aceeași sesiune → simboluri consecvente)
             ──► agregare verdict (orice blocked → cerere blocată)
             ──► LlmRequest redactat + preambul inserat în system
```
Ordinea „în ordinea din conversație” e importantă la strategia greek: atribuirea se face în ordinea primei apariții, deci istoricul retrimis primește aceleași litere (P5).

### F4. Restaurarea unui răspuns complet
```
text răspuns ──► C9.scan ──► C8 byToken ──► C14 formă ──► rescriere ──► RestoreOutput
                              └─ necunoscut → lăsat neschimbat + raport
```

### F5. Restaurarea în streaming
```
chunk ──► C15.push ──► holdback(C9) ──► prefix sigur ──► F4 ──► emis spre gazdă
...
final ──► C15.finish ──► restul ──► F4 ──► raport final
```

### F6. Apelurile de unelte (agent)
```
model emite tool_call(argsJson în bucăți)
   ──► C16: StreamRestorer dedicat, context 'json-string'
   ──► argumente restaurate (originale, escapate JSON)
   ──► DSH execută unealta cu valorile REALE
   ──► rezultatul uneltei intră în istoric (original)
   ──► la pasul următor F3 îl redactează înainte de trimitere
```

### F7. Închiderea și reluarea sesiunii
```
close()                ──► seif șters
exportState()          ──► SessionSnapshot (seif + stare strategie) ──► gazda îl stochează
Engine.resume(snap)    ──► Session cu aceleași atribuiri (inclusiv permutarea greek)
```

---

## 5. Rularea în paralel a celor două strategii

- **În bancul de evaluare (C18):** fiecare configurație primește **sesiunea ei**, pe același prompt. Rulează în paralel, cu același model.
- **În DSH (C17):** o conversație folosește **o singură** strategie spre model (modelul trebuie să vadă un singur sistem de simboluri). Opțional, **modul „umbră”** (`shadow: ["greek"]`): strategia secundară redactează aceeași cerere doar local. Rezultatul ei se scrie în jurnalul de audit pentru inspecție (fără valori) și nu e trimis.

---

## 6. Configurația utilizatorului

`vocabulary.toml`:
```toml
version = 1

[[entry]]
id = "pers_ion"
class = "PERSON"
terms = ["Ion Popescu", "Popescu", "dl. Popescu"]
forms = ["Popescului", "lui Popescu"]   # flexiuni explicite (opțional)
restore_as = "Ion Popescu"              # opțional

[[entry]]
id = "acme"
class = "COMPANY"
terms = ["Acme Logistic SRL", "Acme Logistic", "Acme"]
```

Pentru prototip, vocabularul și seiful stau local, în fișiere. În ținta Rust și pe mobil, stocarea criptată (Keychain sau Keystore) e responsabilitatea gazdei (P1).

---

## 7. Puncte de extensie (rezumat)

| Interfață | Implementări acum | Posibile ulterior |
|---|---|---|
| `Normalizer` | `ro-default` | lematizare RO |
| `Detector` | dictionary, session, pattern (IDNP/IDNO, CNP, telefoane MD/RO/SUA/UK, SSN, NINO, IBAN, card, e-mail, IP), literal | doar detectori care pot fi garantați pentru ce promit (vezi C5) |
| `Resolver` | `priority-longest` | — |
| `PolicyEngine` | `table` | reguli contextuale |
| `TokenStrategy` | `typed`, `greek` | substitute realiste (Faker), coduri inventate |
| `SurfaceSelector` | `restore-as-or-first` | acord gramatical |
| Adaptor de format (C16) | DSH | OpenAI, Anthropic, proxy HTTP |

---

## 8. Decizii deschise

| # | Întrebare | Propunere |
|---|---|---|
| D1 | Punctul de interceptare DSH: adaptor înveliș (A) sau `llm/stream` (B)? | **Rezolvat: B.** Waterfall-ul `llm/stream` nu permite trimiterea unei cereri modificate prin `next()`, iar cererile buclei sunt înghețate. Pluginul scurtcircuitează deci lanțul: construiește o copie redactată, o trimite prin `ctx.llm.stream()` (marcată într-un `WeakSet`, ca să nu fie redactată de două ori) și restaurează streamul primit. Funcționează pentru orice provider, fără un provider „sai/…” separat. |
| D2 | DSH are invariantul „ce vede modelul ⟺ ce e în jurnal”. Redactarea îl încalcă intenționat. | Acceptat: jurnalul local păstrează originalele, doar firul spre cloud e redactat. |
| D3 | Alte apeluri LLM din DSH (titlul sesiunii, compactarea, subagenții) | **Rezolvat:** toate trec prin `llm/stream`, deci toate sunt redactate. Apelurile fără `sessionId` primesc o sesiune efemeră. |
| D4 | Persistența seifului la reluarea sesiunii DSH | **Prototip: seif doar în memorie.** Istoricul e retrimis complet la fiecare cerere, deci un seif pierdut se reconstruiește identic: typed numerotează în ordinea apariției, iar greek folosește o permutare derivată din `sessionId` și dintr-un secret per proces. După o repornire, literele grecești pot fi altele. Persistența criptată rămâne pentru ținta finală. |
| D5 | `warn` în DSH: confirmare de la utilizator sau tokenizare automată? | **Rezolvat prin setarea `warnHandling`:** `tokenize` (implicit: înlocuiește și raportează) sau `keep` (trimite neschimbat). |
| D6 | Flexiuni lipite de simboluri (`⟦COMPANY_1⟧-ului`, `β-ului`) | Lăsate ca atare. Măsurate în evaluare. |
| D7 | Offset-uri: unități UTF-16 (TS) vs octeți UTF-8 (Rust) | Vectorii de test folosesc **indici de caractere Unicode** (code points). Fiecare implementare convertește. |

---

## 9. Ordinea de implementare

| Etapă | Conținut | Criteriu de terminare |
|---|---|---|
| E1 | Monorepo TS, modelul de date (§2), schelet `sai-core` | build + test runner verzi |
| E2 | C0, C4, C5 (dictionary + pattern), vectori de detecție | vectorii de detecție trec |
| E3 | C6, C7, C8, C10, C11, C12 + **ambele strategii** (C9.a, C9.b) | ciclul redactare→restaurare trece pentru ambele |
| E4 | C13, C14, C15 | invariantul de streaming trece pe împărțiri aleatorii |
| E5 | C16 + vectori pentru cereri structurate și JSON | argumentele uneltelor restaurate corect |
| E6 | Spike DSH (D1–D3), în paralel cu E2–E5 | un apel real prin DSH, redactat și restaurat |
| E7 | C17 | conversație DSH cu ambele strategii, comutabile |
| E8 | C18 + set de date fictiv + raport | `report.md` pentru prezentare |

---

## 10. Implementarea actuală (prototip în DSH)

Codul stă în checkout-ul Alterego-DSH, ca pachete experimentale:

| Pachet | Conținut |
|---|---|
| `packages/experimental/sai` (`@deepseek-ai/dsh-experimental-sai`) | `src/core/`: nucleul pur (C0–C15, `RedactionBatch` pentru C16), fără importuri din DSH. `src/request.ts`: C16 pe tipurile DSH. `src/index.ts`: C17 (Config, interceptarea `llm/stream`). `src/client/`: pagina de setări cu previzualizare locală. |
| `packages/experimental/sai-bundle` | Bundle-ul opțional care apare în **Plugins → Experimental plugins**. Adaugă rândul `sai` în compoziție. |

Setările (`SaiSettings`) sunt câmpuri „volatile” ale pluginului, editate de pe pagina bundle-ului și salvate în profil. Câmpurile sunt `enabled`, `strategy`, `preamble`, `preambleTexts`, `warnHandling`, `vocabulary`, `patterns`, `actions`, `minConfidence`, `allowlist`, `languages`, `images`, `externalTools`. Câmpul `names` (detectorul de nume din liste) a fost eliminat pe 15.11.2026; dacă apare într-o configurație salvată, e ignorat. Pagina rulează nucleul și în browser, ca să arate pe loc cum ar fi redactat un text de test cu setările curente, inclusiv cele nesalvate.

Numele claselor sunt în engleză. Clasele sunt deschise: orice nume format din A–Z, cifre și `_` e valid. Pagina propune un set predefinit (`SUGGESTED_CLASSES`): `PERSON`, `COMPANY`, `ORGANIZATION`, `LOCATION`, `ADDRESS`, `PROJECT`, `PRODUCT`, `CONTRACT` și clasele detectorilor (`PHONE`, `EMAIL`, `IDNP`, `CNP`, `IBAN`, `CARD`, `IP`). Opțiunea „Other” permite o clasă nouă.

Diferențe față de specificație, deliberate pentru prototip:
- dicționarul caută termenii unul câte unul (`indexOf`), nu cu Aho-Corasick; e suficient pentru vocabulare de ordinul sutelor de termeni;
- pozițiile sunt în unități UTF-16; vectorii comuni cu Rust (D7) nu sunt încă extrași;
- `exportState` / reluarea seifului (F7) nu sunt implementate, vezi D4.

# sAI: raportul primei evaluări (run1)

> **Model:** `thinkingmachines/inkling-2-small:free` (OpenRouter), prin runtime-ul LLM din DSH.
> **Variante:** plain (fără sAI, referință), typed (`⟦CLASS_N⟧`) și greek (litere izolate), ambele cu preambul.
> **Set:** 49 de cazuri (eval/cases.json), date fictive.
> **Metodă:** toate răspunsurile au fost citite manual. Transcriptul complet e în `results/run1/TRANSCRIPT.md`.
> Notele de mai jos sunt judecata mea după lectură, nu un scor automat.

---

## 1. Concluzia pe scurt

1. **Mecanismul de bază funcționează.** Pe sarcini de lucru obișnuite (e-mailuri, tabele, JSON, YAML, SQL, rezumatul unui contract, analiză juridică, calcule, grupare a 50 de persoane), ambele strategii au dat răspunsuri **de aceeași calitate ca plain**. Simbolurile s-au păstrat și s-au restaurat corect.
2. **Am găsit scurgeri reale, toate în detecție, nu în strategie.** Cea mai importantă: **formele flexionate din română trec nemascate** („Cebanei”, „Popescului”, „Mariei”, „Băncii Verde”). Problema e a sAI, nu a modelului, și se poate corecta.
3. **Typed e mai sigur decât greek.** Când sarcina e imposibilă fără valoarea reală, typed **refuză onest**. Greek, care nu transmite nici clasa entității, a dat de 4 ori un **răspuns fals, dar plauzibil** (eșec tăcut). Cel mai clar exemplu: a „sortat alfabetic” 30 de angajați după litera grecească.
4. **Restaurarea poate strica textul** când simbolul a fost lipit de alte caractere: e-mailuri, identificatori de cod, „Maria Popescu”. Rezultatul arată corect, dar e greșit.
5. **Defect găsit și corectat în timpul testului:** un IBAN urmat de text era citit drept card și bloca toată cererea (E3, I1, I2). L-am corectat și am rulat cazurile din nou; acum trec.

---

## 2. Rezultate pe cazuri

✅ corect · ⚠️ degradat sau ciudat, dar fără scurgere · ❌ scurgere sau răspuns greșit · 🛑 blocat de sAI

| Caz | Ce testează | Typed | Greek | Observație |
|---|---|---|---|---|
| A1 | e-mail către „dl. Popescu” | ⚠️ | ⚠️ | „dl.” face parte din termen și dispare cu numele: „Bună ziua, Ion Popescu” în loc de „Stimate domnule Popescu”. Greek tutuiește și semnează „Acme”. |
| A2 | două roluri | ✅ | ✅ | |
| A3 | flexiuni greșite intenționat | ❌ | ❌ | **Scurgere:** „Popescului”, „Cebanei” trimise în clar. |
| A4 | genitiv/dativ | ⚠️ | ⚠️ | Modelul nu știe genul: restaurat „lui Maria Ceban”; greek: „lui Acme Logistic”. |
| B1 | organigramă | ❌ | ❌ | **Scurgere** „Cebanei”. Typed răspunde corect. Greek tratează firma (ρ) ca persoană și răspunde greșit „nimeni”. |
| B2 | procente indirecte | ✅ | ✅ | 18% în toate variantele. |
| B3 | registru de datorii | ❌ | ❌ | **Scurgere** „Cebanei”. Forma flexionată îl încurcă pe model: typed o ia drept altă persoană, greek drept un debitor separat. Ambele tabele sunt greșite. |
| B4 | memorie în 3 pași | ❌ | ❌ | **Scurgere** „Băncii Verde”. La pasul 3, modelul nu leagă „Banca Verde” (simbol) de „Băncii Verde” (text clar). Restaurat: „Banca Verde este Banca Verde”. |
| C1 | 30 de angajați, maxim pe departament | ✅ | ✅ | Greek cu indici (`σ₂`) a funcționat perfect. |
| C2 | sortare alfabetică (imposibilă) | ✅ | ❌ | Typed refuză onest. **Greek sortează după litera grecească** (α, β, β₂, γ…) și prezintă rezultatul drept sortare după nume: listă restaurată plauzibilă, dar complet greșită. |
| C3 | tabel → JSON, 60 de simboluri | ✅ | ✅ | IDNO-urile apar cu clasa IDNP (detalii cosmetice). |
| D1 | α și β statistice | ✅ | ✅ | Greek a exclus corect α și β din simboluri. |
| D2 | Δ și π | ✅ | ✅ | |
| D3 | traducere în greacă | ✅ | ✅ | Cuvintele grecești reale (multi-literă) nu au fost confundate cu simbolurile. |
| D4 | 24 de litere grecești | ✅ | 🛑 | Greek refuză corect (`STRATEGY_UNSUITABLE`). |
| D5 | ψ și Ω fără nume | ✅ | ✅ | Nimic restaurat greșit. |
| E1 | funcție Python cu e-mail | ❌ | ❌ | E-mailul a fost tăiat de termenii din vocabular. Restaurat: `ion.Ion Popescu@Acme Logistic.md`. |
| E2 | refactorizare cu `AcmeClient`, `popescu_id` | ❌ | ❌ | **Scurgere** „AcmeClient”. Typed redenumește atributul. Greek produce **cod Python invalid**: `self.Ion Popescu_id`. |
| E3 | SQL cu IBAN | ✅ | ✅ | După corecția IBAN. |
| E4 | YAML | ✅ | ✅ | |
| E5 | regex pentru un nume | ⚠️ | ⚠️ | Regex-ul restaurat caută „I. Ion Popescu”: sens greșit. |
| F1 | inițiale | ❌ | ❌ | **Scurgere** „Mariei”. Ambele refuză. |
| F2 | număr de litere | ✅ | ❌ | Typed refuză. **Greek inventează „5 litere”.** |
| F3 | data nașterii din CNP | ✅ | ✅ | Refuz. Textul restaurat sună absurd: „nu pot vedea cifrele din 1800101420010”. |
| F4 | e-mail din tipar | ⚠️ | ⚠️ | Tiparul „prenume.nume@firma.md” e detectat ca EMAIL și ascuns, deci cerința devine imposibilă. |
| F5 | pronume el/ea | ✅ | ⚠️ | Typed refuză să ghicească. Greek ghicește (corect, din noroc). |
| F6 | validare IBAN | ✅ | ✅ | Refuz, cu meta-text ciudat după restaurare. |
| G1 | traducere EN/FR/RU | ✅ | ✅ | |
| G2 | MAJUSCULE | ⚠️ | ⚠️ | Numele restaurate rămân cu forma originală: „Maria Ceban DE LA Nordic Agro”. |
| G3 | text inversat | ✅ | ❌ | Typed explică. **Greek dă „invers: Banca Verde”**, adică textul neinversat, prezentat ca rezultat. |
| G4 | acrostih | ⚠️ | ❌ | Greek scrie un acrostih fără legătură cu literele. |
| G5 | bold pe persoane | ✅ | ⚠️ | Greek pune și firma în ghilimele: nu știe care simbol e persoană. |
| H1 | IDNP și telefon | ✅ | ✅ | |
| H2 | același telefon în 2 formate | ⚠️ | ⚠️ | Răspuns corect din motivul greșit („același simbol”). Formatul original al celui de-al doilea număr se pierde. |
| H3 | card | 🛑 | 🛑 | Blocat corect. |
| H4 | vârsta din IDNP | ✅ | ✅ | Refuz onest. |
| H5 | sume | ✅ | ✅ | |
| I1 | rezumat contract | ✅ | ✅ | Calitate egală cu plain. |
| I2 | clauze dezavantajoase | ✅ | ✅ | Greek chiar mai detaliat. |
| I3 | 12 participanți | ⚠️ | ⚠️ | **Scurgere parțială:** prenumele „Floare” rămâne în clar. Restul e corect. |
| J1 | simboluri scrise de utilizator | ✅ | ✅ | Typed le protejează ca `⟦LITERAL_n⟧`. |
| J2 | „scrie numele reale” | ✅ | ✅ | Modelul nu le cunoaște. Meta-text restaurat confuz. |
| J3 | litere mici, fără simboluri | ⚠️ | ⚠️ | Preambulul îl face pe model să refuze o transformare legitimă. |
| J4 | membri inventați | ✅ | ✅ | |
| J5 | κ, β, ρ ca variabile | ✅ | ✅ | |
| K1 | Maria Popescu vs Ion Popescu | ❌ | ❌ | **Contopire:** „Maria Ion Popescu”. Prenumele „Maria” trece în clar. |
| K2 | Floare, Mare | ⚠️ | ⚠️ | „Floare” trece în clar. „Radu Mare” e prins corect. |
| K3 | cinematograful Orion vs Proiectul Orion | ❌ | ❌ | Două sensuri devin același simbol, iar modelul nu le mai distinge. |
| K4 | nume în chirilică | ❌ | ❌ | **Scurgere:** „Иван Попеску” nu e în vocabular. |
| K5 | abrevierea BV și `bv_total` | ⚠️ | ⚠️ | Variabila devine `BV_total`: cod modificat. |
| X1 | 50 de persoane, 20 de firme | ✅ | ✅ | Greek cu indici `α₃` a funcționat perfect. |
| X3 | 34 de mențiuni în 8 forme | ⚠️ | ⚠️ | Număr corect. Restaurat: „Ion Popescu Ion”, „I. Ion Popescu”. |

**Bilanț (52 de cazuri):**

| | Typed | Greek |
|---|---|---|
| ✅ corect | 29 | 23 |
| ⚠️ degradat | 12 | 13 |
| ❌ scurgere sau greșit | 10 | 14 |
| 🛑 blocat | 1 | 2 |

Toate cele 10 ❌ din coloana typed sunt **defecte ale detecției sau ale restaurării**, comune ambelor strategii. Cele 4 ❌ în plus la greek (C2, F2, G3, G4) și o parte din ⚠️ vin din faptul că modelul **nu vede clasa** entității și tratează literele ca litere.

---

## 3. Scurgeri (critice)

| # | Ce a scăpat | Cazuri | Cauză | Corecție propusă |
|---|---|---|---|---|
| S1 | Flexiuni: „Cebanei”, „Popescului”, „Mariei”, „Băncii Verde” | A3, B1, B3, B4, F1 | Dicționarul caută doar forma exactă. Verificatorul independent din script le-a ratat și el. | Generarea automată a flexiunilor românești pentru fiecare cuvânt al termenului (`-ul/-ului/-ei/-ii/-lui`, `-a → -ei/-ii`), aplicată și în verificatorul de scurgeri. |
| S2 | Nume lipite de alte cuvinte în cod: `AcmeClient` | E2 | Fără granițe de cuvânt, termenul nu e găsit. | Detecție în identificatori camelCase și snake_case, cu avertisment sau blocare la tokenizare parțială. |
| S3 | Prenume lângă un nume protejat: „Maria”, „Floare” | F1, I3, K1, K2 | Detectorul de nume extinde potrivirea doar spre dreapta. | Extinderea spre stânga: prenume din listă sau cuvânt cu majusculă lipit de un nume protejat. |
| S4 | Transliterare în chirilică | K4 | Nu e în vocabular. | Transliterarea automată a termenilor (latină ↔ chirilică) la compilarea vocabularului. |

---

## 4. Restaurări care strică sensul (eșecuri tăcute)

| # | Simptom | Cazuri | Corecție propusă |
|---|---|---|---|
| R1 | E-mail tăiat de termeni: `ion.Ion Popescu@Acme Logistic.md` | E1 | La suprapunere, o potrivire care o conține complet pe alta (e-mail, IBAN) câștigă indiferent de prioritate. |
| R2 | Identificatori de cod stricați: `Ion Popescu_id`, `BV_total` | E2, K5 | Considerarea lui `_` drept caracter de cuvânt. Simbolurile nu se inserează în interiorul identificatorilor. |
| R3 | Forme compuse: „Popescu Ion” devine „Ion Popescu Ion”, „I. Popescu” devine „I. Ion Popescu” | X3, E5 | Termenul cel mai lung câștigă deja; trebuie adăugate formele inversate și cu inițială, iar restaurarea să păstreze forma văzută în acel loc, nu `restoreAs`. |
| R4 | Două entități diferite cu un cuvânt comun: „Maria Ion Popescu”, Orion cinema = Orion proiect | K1, K3 | Termenii scurți și ambigui (doar „Popescu”, doar „Orion”) ar trebui marcați ca „doar în context” sau cu avertisment. |
| R5 | Titlul se pierde: „dl. Popescu” devine „Ion Popescu” | A1, G1 | Titlurile (`dl.`, `dna`) nu se includ în termeni; rămân în text și dau modelului genul. |
| R6 | Meta-text absurd după restaurare: „nu pot vedea cifrele din 1800101420010” | F3, F6, J2, B4 | Instrucțiune în preambul: modelul să nu comenteze simbolurile ca simboluri. Alternativ, restaurarea marchează vizual valorile restaurate. |

---

## 5. Typed vs greek

| Aspect | Typed | Greek |
|---|---|---|
| Sarcini obișnuite (tabele, cod, rezumate, calcule) | la fel de bine ca plain | la fel de bine ca plain |
| Sarcini imposibile fără valoare | refuză onest (C2, F2, F5, G3) | **inventează** (C2 sortează după litera grecească, F2, G3, G4) sau ghicește (F5) |
| Raționament care depinde de tipul entității | corect (B1) | confundă firme cu persoane (B1, G5) |
| Volum mare | ✅ până la 70 de entități | ✅ indici până la `α₃`, fără erori |
| Text cu litere grecești reale | nicio problemă | excluderea funcționează; blochează corect peste 20 de litere (D4) |
| Semnalul „suspect” | — | prea zgomotos: `**π**` (bold markdown) e marcat suspect |
| Confidențialitate | modelul vede clasa (PERSON, COMPANY) | modelul nu vede nici clasa |

**Recomandare:** typed ca implicit. Greek merită păstrat doar dacă ascunderea clasei e o cerință; costul sunt mai multe eșecuri tăcute.

---

## 6. Probleme de infrastructură (nu țin de sAI)

- **Modelul gratuit** consumă uneori toată limita de 2.500 de tokeni pe raționament și nu mai răspunde, inclusiv în plain. Cu 8.000 de tokeni, cazurile au trecut.
- **B3 și C2:** erori repetate de conexiune la provider, inclusiv o cerere care a stat deschisă aproape două ore. A treia încercare a reușit.

---

## 7. Pașii următori propuși

1. Corectarea S1–S4 și R1–R5. S1 (flexiunile) e cea mai importantă.
2. Verificatorul de scurgeri din script să caute și formele flexionate și transliterate, ca să nu mai rateze ce a ratat aici.
3. Run2 pe același set, plus variantele fără preambul, ca să vedem cât contează preambulul.
4. Categoria L (agent cu unelte), testată manual în aplicație.

# sAI Desktop: specificațiile aplicației

> Versiune: 0.1 (schiță, pentru discuție) · Data: 2026-11-18
> Ce este: o aplicație desktop care rulează sAI ca proxy local între aplicațiile AI de pe calculator (Claude Desktop, Claude Code, Codex) și furnizorii lor din cloud.
> Pornește de la: nucleul sAI existent (`prototype/dsh-plugin/sai/src/core`), verificatorul local ([CERCETARE-MODELE.md](CERCETARE-MODELE.md), [verificator-en.md](../eval/results/verificator-en.md)) și analiza aplicației desktop Coral 1.8.0 (inspirație pentru interfață, nu cod).

---

## 0. Scop și principii

**Scop.** Utilizatorul lucrează în aplicațiile AI obișnuite. sAI stă între ele și cloud: înlocuiește valorile protejate cu simboluri înainte ca cererea să plece și pune valorile la loc în răspuns, inclusiv în argumentele uneltelor pe care aplicația le rulează local. Utilizatorul controlează totul dintr-o aplicație desktop: vocabularul, ce se întâmplă cu fiecare clasă de date, aprobările și jurnalul.

**Principii (obligatorii pentru orice componentă):**

| # | Principiu | Consecință |
|---|---|---|
| D1 | **Protejăm doar ce e declarat** | Vocabularul și tiparele activate. Un cuvânt care nu e în vocabular nu e protejat. Nu există detecție a numelor nedeclarate. |
| D2 | **La îndoială, se maschează** | Verificator nesigur, eroare, răspuns lipsă, cerere neînțeleasă: se maschează sau se blochează, niciodată invers. |
| D3 | **Fail closed** | Dacă sAI nu poate redacta o cerere (format necunoscut, câmp pe care nu-l poate citi, eroare internă), cererea nu pleacă. |
| D4 | **Fără valori în jurnale** | Jurnalul salvat, rapoartele, erorile și eventuala telemetrie conțin clase, contoare și coduri, niciodată valori originale sau textul utilizatorului. |
| D5 | **Totul local** | Proxy-ul și verificatorul ascultă doar pe 127.0.0.1. Singurul trafic spre exterior e cererea redactată către furnizorul ales de utilizator și verificarea de actualizări. |
| D6 | **Determinism în conversație** | Aceeași entitate are același simbol pe toată conversația; istoricul retrimis se redactează identic, așa că prompt caching-ul furnizorului continuă să funcționeze. |
| D7 | **Oprit înseamnă ca înainte** | Verificatorul oprit: sAI se comportă exact ca fără el. sAI întreg oprit: proxy-ul refuză cererile (nu le trimite în clar), iar aplicația spune cum se scoate proxy-ul din client. |

**Ce nu este (în afara scopului):**
- nu e un gateway MCP și nu execută unelte (asta face Coral);
- nu interceptează traficul criptat al aplicațiilor web (chatgpt.com, claude.ai în browser) și nu folosește certificate false: lucrează doar cu aplicațiile care acceptă oficial un furnizor sau un gateway configurat de utilizator;
- nu ghicește nume nedeclarate (GLiNER2-PII și `locate` au rămas la ~88% recall, vezi testul 6 din [modele-ai-en.md](../eval/results/modele-ai-en.md)).

---

## 1. Clienți suportați și cum se conectează

| Client | Mecanism | API vorbit de proxy | Stare |
|---|---|---|---|
| **Claude Desktop** (Chat, Cowork, Code) | „Third-party inference”: `inferenceProvider: gateway`, `inferenceGatewayBaseUrl`, cheie în `inferenceGatewayApiKey` (din aplicație: Developer → Configure Third-Party Inference, sau prin MDM) | Anthropic Messages: `POST /v1/messages` cu streaming și unelte; `GET /v1/models` opțional | Documentat oficial ([claude.com/docs](https://claude.com/docs/third-party/claude-desktop/gateway)) |
| **Claude Code** (terminal) | `ANTHROPIC_BASE_URL` | Anthropic Messages | Documentat oficial |
| **Codex** (aplicația și CLI) | furnizor propriu în `~/.codex/config.toml` (`model_providers.<id>.base_url`, `env_key`), chei la nivelul de sus pentru aplicația desktop | OpenAI Responses (de confirmat) | Doar ghiduri ale unor terți; **de verificat în documentația OpenAI** |
| Clienți compatibili OpenAI Chat Completions | `base_url` propriu | `POST /v1/chat/completions` | Etapa 3 |

**Consecințe pe care aplicația le spune utilizatorului la conectare:**
- În modul gateway, Claude Desktop nu mai folosește autentificarea claude.ai: tokenii se plătesc cu cheia API a utilizatorului, nu din abonament. La fel, probabil, Codex cu un furnizor propriu (de confirmat).
- Gateway-ul trebuie să păstreze `cache_control` și să nu schimbe promptul de sistem sau lista de unelte de la un pas la altul, altfel furnizorul reprocesează toată conversația la fiecare pas (documentația Anthropic cere ca `cache_read_input_tokens` să fie mult peste zero după prima cerere).

---

## 2. Arhitectura

```
 Claude Desktop ─┐                         ┌────────────── sAI Desktop ──────────────┐
 Claude Code ────┼── HTTP 127.0.0.1 ──────►│ Proxy local                              │── HTTPS ──► Anthropic / OpenAI
 Codex ──────────┘   (cheie per client)    │  adaptoare API → nucleu sAI → furnizor   │◄── SSE ───
                                           │        ▲                     │           │
                                           │        │ 1 apel / cerere     ▼           │
                                           │  Serviciul verificatorului   Jurnal      │
                                           │  (Decider-Flash v1.3, local) (fără valori)│
                                           │                                          │
                                           │  Interfața (setări, politici, activitate,│
                                           │  aprobări) ── Depozit criptat (vocabular,│
                                           │  seifuri, chei)                          │
                                           └──────────────────────────────────────────┘
```

### 2.1 Componentele

| # | Componentă | Rol | Ce refolosește |
|---|---|---|---|
| A1 | **Proxy local** | Ascultă pe 127.0.0.1, autentifică clientul, alege adaptorul după rută, trimite cererea redactată la furnizor, restaurează fluxul. | — |
| A2 | **Adaptoarele API** | Câte unul pe API (Anthropic Messages, OpenAI Responses, mai târziu Chat Completions). Știu ce câmpuri sunt text, ce câmpuri sunt structură și cum arată evenimentele de flux. | modelul `RedactionBatch` / `TextCollector` din `request.ts` |
| A3 | **Nucleul sAI** | Redactare, verificator, seif, restaurare. Neschimbat ca principiu: pur, fără I/O. | `src/core` integral (`Engine`, `Session`, `verifyTexts`, `StreamRestorer`) |
| A4 | **Serviciul verificatorului** | Procesul `decider_server.py`, pornit, oprit și supravegheat de aplicație. | `verifier/decider_server.py`, `verifier-client.ts` |
| A5 | **Depozitul** | Setări, vocabular, seifurile conversațiilor, cheile clienților și ale furnizorilor, jurnalul. Criptat cu o cheie din seiful sistemului de operare. | — |
| A6 | **Interfața** | Paginile din secțiunea 4. | pagina de setări și previzualizarea din `src/client` |
| A7 | **Supraveghetorul** | Pornește proxy-ul și verificatorul la deschiderea aplicației (opțional la pornirea sistemului), le verifică starea, le repornește, afișează iconița din bara de sistem. | — |

**Tehnologie (propunere, de decis):** Electron, ca Coral: proxy-ul rulează în Node și refolosește direct nucleul TypeScript și streaming-ul existent; interfața refolosește componentele React. Alternativa e Tauri (aplicație mai mică), dar proxy-ul ar rula tot ca proces Node separat. Ținta pe termen lung rămâne nucleul Rust din [ARHITECTURA.md](ARHITECTURA.md).

### 2.2 Fluxul unei cereri

1. **Primire.** Clientul trimite cererea la `http://127.0.0.1:<port>/...`. Proxy-ul verifică cheia clientului (secțiunea 5); fără cheie validă: `401`.
2. **Conversația.** Proxy-ul găsește seiful conversației (2.3). Seiful ține simbolurile stabile între pași.
3. **Textele.** Adaptorul adună toate textele cererii: promptul de sistem, mesajele, rezultatele uneltelor, argumentele apelurilor de unelte din istoric, descrierile și schemele uneltelor.
4. **Verificatorul** (dacă e pornit). Toate cuvintele neconfirmate din toate textele merg la model **într-un singur apel**. Fără cuvinte neconfirmate, niciun apel. Răspunsurile se memorează în seiful conversației.
5. **Redactarea.** Fiecare text trece prin `Session.redact`. Se aplică politica fiecărei clase (secțiunea 4.3).
6. **Politica „Întreabă”.** Dacă o clasă cu politica „Întreabă” apare în cerere, cererea așteaptă în Aprobări (4.5). Aprobat: continuă. Refuzat sau expirat: clientul primește o eroare.
7. **Verdict.** Blocat (clasă blocată, imagine, scurgere detectată, format necunoscut): clientul primește o eroare în formatul API-ului său, cu un mesaj fără valori, de exemplu „sAI a blocat cererea: CARD. Schimbă politica în sAI Desktop → Politici.”
8. **Trimitere.** Cererea redactată pleacă la furnizor cu cheia furnizorului din depozit. Câmpurile pe care adaptorul nu le citește ca text se trimit neschimbate doar dacă sunt pe lista de câmpuri structurale a adaptorului; un câmp necunoscut care conține text blochează cererea (D3).
9. **Restaurarea în flux.** Evenimentele de flux sunt rescrise din mers: textul, raționamentul și argumentele uneltelor (inclusiv bucățile JSON parțiale) trec prin `StreamRestorer`, care ține câteva caractere până când un simbol e complet. Argumentele uneltelor externe (4.3) rămân cu simboluri.
10. **Jurnal.** La final se scrie o înregistrare fără valori (secțiunea 6).

### 2.3 Identificarea conversației

API-urile nu trimit un id de conversație ca DSH. Propunere, în ordine:
1. un id explicit, dacă clientul îl trimite (de verificat ce trimite fiecare client: `metadata.user_id` la Anthropic, antete specifice la Codex);
2. altfel, amprenta începutului conversației: promptul de sistem + primul mesaj al utilizatorului (după redactare, ca amprenta să nu conțină valori);
3. seifurile expiră după o perioadă fără activitate (implicit 7 zile) și se pot șterge din interfață.

**De decis:** un singur seif pe utilizator ar fi mai simplu și ar păstra caching-ul, dar furnizorul ar vedea că `⟦PERSON_3⟧` apare în conversații diferite. Recomandarea e seif pe conversație.

### 2.4 Cerințe speciale pe API-uri

- **Raționamentul semnat (Anthropic `thinking`).** Blocurile de raționament au semnătură și trebuie retrimise exact cum le-a produs furnizorul. Proxy-ul restaurează raționamentul pentru client, deci clientul îl retrimite cu valori reale; proxy-ul trebuie să-l înlocuiască cu blocul original, cu simboluri. Soluție: seiful conversației ține o hartă „bloc restaurat → bloc original” (după hash). Fără potrivire: blocul se redactează și, dacă furnizorul îl refuză, se elimină din istoric, cu avertisment în jurnal.
- **Prompt caching.** Redactarea trebuie să dea exact același text la fiecare pas pentru istoric. Explicația simbolurilor (preambulul) e fixă pe conversație. Jurnalul afișează `cache_read_input_tokens` ca semnal de sănătate.
- **Unelte rulate la furnizor** (de exemplu căutarea web a furnizorului): primesc simboluri. E sigur, dar rezultatele pot fi mai slabe; interfața spune asta la politica „Unelte externe”.
- **Imagini și documente atașate:** sAI nu le poate citi. Politică separată: blochează (implicit), trimite, întreabă.
- **Modele:** `GET /v1/models` se trimite la furnizor neschimbat.

---

## 3. Cerințe nefuncționale

| Cerință | Țintă |
|---|---|
| Timp adăugat fără verificator | sub 5 ms pe cerere obișnuită (nucleul face sub 3 ms azi) |
| Timp adăugat cu verificator | doar când există cuvinte neconfirmate: ~150 ms pe apel pe GPU (măsurat 136 ms mediană pe propoziții, 551 ms pe articole întregi); primul apel după pornire ~1,2 s |
| Primul caracter în flux | întârziat cu cel mult lungimea unui simbol (holdback-ul `StreamRestorer`) |
| Memorie | proxy sub 300 MB; verificatorul separat, ~3 GB VRAM, oprit implicit |
| Platforme | Windows întâi, apoi macOS |
| Fără internet | merge tot, mai puțin furnizorul din cloud |
| Robustețe | proxy-ul repornește singur; o cerere în curs la repornire primește eroare, nu e trimisă în clar |

---

## 4. Interfața

Bara laterală: Acasă · Vocabular · Politici · Activitate · Aprobări · Conectează aplicații · Furnizori · Verificator · Previzualizare · Setări. Tema: luminoasă, întunecată sau a sistemului. Textele explică întotdeauna consecința unei acțiuni într-o propoziție (stilul Coral: „Cancellation stops the whole run. It does not undo completed external effects.”).

### 4.1 Acasă (starea)

- **Proxy:** pornit/oprit, adresa, câte cereri azi, câte blocate.
- **Verificator:** oprit / se încarcă / gata (model, memorie VRAM, ultimul apel, durata lui) / eroare.
- **Vocabular:** câte intrări, câți termeni compilați, problemele de setări (de exemplu „adresa verificatorului trebuie să fie pe acest calculator”).
- **Clienți:** ce aplicații au trimis cereri recent.
- **Atenționări:** cereri care așteaptă aprobare, caching care nu funcționează, cheie de furnizor lipsă.

### 4.2 Vocabular

- Tabel cu intrările: clasă, scrieri (una pe rând), „restaurează ca”, căutare.
- **Formele generate:** la fiecare intrare, un panou care arată ce caută sAI efectiv (bucățile numelui, formele flexionate, regula de majusculă), adică `CompiledTerm[]`. Utilizatorul vede de ce un cuvânt e sau nu e prins.
- Import și export (fișier criptat cu o parolă aleasă la export).
- Lista „Niciodată protejat” (allowlist).

### 4.3 Politici (după pagina Tools din Coral)

Pentru fiecare clasă, un buton segmentat cu pictogramă și o propoziție de efect:

| Opțiune | Efect afișat |
|---|---|
| **Simbol** (implicit) | „Valoarea pleacă înlocuită cu un simbol și revine în răspuns.” |
| **Mască** | „Valoarea e ascunsă definitiv; modelul vede doar forma ei.” |
| **Trimite** | „Valoarea pleacă așa cum e scrisă.” |
| **Întreabă** (nou) | „Cererea așteaptă aprobarea ta în Aprobări.” |
| **Blochează** | „Cererea nu pleacă.” |

- Grupuri care se pot strânge: **Vocabular** (PERSON, COMPANY, …), **Tipare** (IBAN, CARD, …, cu comutatorul de activare al tiparului în același rând), **Altele** (imagini și documente atașate, unelte externe).
- Căutare și „Aplică politica pe cele selectate” (bulk).
- **Unelte externe:** lista numelor de unelte ale căror argumente rămân cu simboluri (implicit `web_search`, `web_fetch`, `mcp__*`), cu explicația de mai sus.
- Implicit: CARD → Blochează, imaginile → Blochează, restul → Simbol (ca azi).

### 4.4 Activitate (după pagina Activity din Coral)

Listă live, cu „Urmărește ultima cerere” și filtre (client, verdict, clasă, interval).

| Coloană | Exemplu |
|---|---|
| Ora | 14:32:08 |
| Client | Claude Desktop · Code |
| Găsite | PERSON 2 · COMPANY 1 · IBAN 1 |
| Verificator | 3 întrebări, 1 lăsat ca atare, 142 ms |
| Verdict | Trimis / Blocat: CARD / Respins în Aprobări |
| Timp sAI | 4 ms |
| Caching | 12.400 tokeni citiți din cache |

**Detaliu** (panou lateral):
- înregistrarea de mai sus, completă, plus codul de eroare al furnizorului dacă există;
- **„Ce a văzut modelul”**: textul redactat al cererii și tabelul deciziilor (poziție, clasă, detector, acțiune), cu valorile originale afișate local. Acest detaliu e **doar în memorie**, cât timp conversația e activă, ca „Model view” din DSH, și nu se scrie pe disc.

Păstrarea jurnalului: implicit 30 de zile, configurabil, buton „Șterge jurnalul”, export CSV fără valori.

### 4.5 Aprobări (după pagina Approvals din Coral)

- **„Așteaptă răspunsul tău”:** cererile cu politica „Întreabă” și, opțional, cererile blocate pe care utilizatorul le poate trimite o singură dată. Fiecare arată clientul, clasele găsite și valorile (local), cu butoanele **Trimite o dată** și **Refuză**, plus un comentariu opțional.
- Expirare: implicit 2 minute; expirată = refuzată. Clientul primește o eroare clară.
- Notificare de sistem când apare o cerere nouă.
- **Istoric:** cine a decis, când, rezultatul. Fără valori.

### 4.6 Conectează aplicații (după Quick start din Coral)

Câte un card pe client, cu pașii și butoane „Copiază”:
- **Claude Desktop:** adresa gateway-ului și cheia clientului de pus în Configure Third-Party Inference; pentru firme, cheile MDM `inferenceProvider`, `inferenceGatewayBaseUrl`, `inferenceGatewayApiKey`.
- **Claude Code:** comanda cu `ANTHROPIC_BASE_URL` (și cheia).
- **Codex:** blocul `config.toml`.
- **Testează conexiunea:** după ce utilizatorul a configurat clientul, aplicația arată prima cerere primită de la el.
- **Cheile clienților** (după pagina Agents din Coral): una pe aplicație, cu expirare, suspendare și înlocuire. O cheie nouă se arată o singură dată.

### 4.7 Furnizori

Cheile API pentru Anthropic și OpenAI (salvate în seiful sistemului de operare), adresa furnizorului (implicit cea oficială), un test de conexiune. Avertisment despre facturare (secțiunea 1).

### 4.8 Verificator

- Pornit/oprit (implicit oprit), dosarul modelului, GPU sau CPU, pragul (avansat, implicit 0,2), timpul maxim de așteptare.
- Starea serviciului, butoane Pornește/Oprește, ultimul apel.
- Ce face, în două propoziții: „Bucățile de nume scrise cu literă mică (de exemplu „bill” pentru Bill Turner) sunt verificate de un model de pe acest calculator. Cuvintele scrise cu majusculă sunt protejate mereu.”
- Notă: măsurat doar pe engleză până acum.

### 4.9 Previzualizare

Pagina de previzualizare existentă: text de intrare → text trimis → răspuns de test → răspuns restaurat, plus tabelul deciziilor. Folosește aceleași setări și același verificator ca proxy-ul.

### 4.10 Setări

Strategia de simboluri (typed / greek), textul explicației simbolurilor, limbile textelor, portul proxy-ului, pornirea la deschiderea sesiunii, păstrarea jurnalului, tema, actualizări. **Date de utilizare:** aplicația nu trimite telemetrie. Pagina spune explicit acest lucru, după modelul paginii „Usage data” din Coral, care enumeră ce nu se trimite niciodată.

---

## 5. Securitate și confidențialitate

| Risc | Măsură |
|---|---|
| Alt program de pe calculator folosește proxy-ul | Proxy-ul ascultă doar pe 127.0.0.1 și cere o cheie per client. Cererile fără cheie primesc `401`. |
| Vocabularul și seifurile citite de pe disc | Depozit criptat (AES-GCM) cu o cheie ținută în seiful sistemului de operare (Windows Credential Manager, macOS Keychain). Rezolvă rândul „Pe disc” din tabelul „Ce nu e prins” de pe tabla „Arhitectura sAI”. |
| Cheile furnizorilor | Doar în seiful sistemului de operare, niciodată în fișiere de configurare sau în jurnal. |
| Valori în jurnal sau în rapoarte de eroare | D4. Detaliul „Ce a văzut modelul” stă doar în memorie. Erorile interne se raportează cu cod și clasă. |
| Verificatorul ca a doua ieșire spre exterior | Adresa verificatorului acceptă doar 127.0.0.1, ::1 sau localhost (deja implementat în `isLoopbackUrl`). |
| Proxy oprit, client încă configurat | Clientul primește eroare de conexiune: nimic nu pleacă în clar (D7). |
| Actualizări | Pachete semnate; verificarea de actualizări e singura cerere în afară, în afara celor către furnizor. |

---

## 6. Datele salvate

| Ce | Unde | Conține valori? |
|---|---|---|
| Setări (politici, limbi, strategie, port) | fișier de setări | nu |
| Vocabular | depozit criptat | **da** |
| Seifurile conversațiilor (simbol ↔ valoare, răspunsurile verificatorului, harta blocurilor de raționament) | depozit criptat, cu expirare | **da** |
| Chei clienți și furnizori | seiful sistemului de operare | secrete |
| Jurnalul de activitate | bază de date locală (SQLite) | nu |
| Istoricul aprobărilor | bază de date locală | nu |

**Înregistrarea din jurnal** (`ActivityRecord`):
`id`, `time`, `client` (aplicație și cheie), `api` (messages / responses), `model`, `conversation` (amprenta, nu textul), `countsByClass`, `verifier: {asked, cleared, failed, ms}`, `verdict: {kind, code?, classId?}`, `approval?: {decision, by, at}`, `saiMs`, `upstream: {status, ms, inputTokens, outputTokens, cacheReadTokens}`, `restore: {restored, unknownTokens, tolerantMatches}`.

---

## 7. Etape

| Etapă | Conținut | Gata când |
|---|---|---|
| **M1. Proxy pentru Claude** | Proxy Anthropic Messages (flux, unelte, raționament semnat), seif pe conversație, setări și vocabular (paginile existente), Previzualizare, Acasă minimală, chei de furnizor. Fără verificator. | Claude Code și Claude Desktop (Chat și Code) lucrează prin proxy; caching-ul funcționează; nicio valoare din vocabular nu ajunge la furnizor în testele de contract. |
| **M2. Politici, Activitate, Aprobări** | Pagina Politici cu „Întreabă”, jurnalul fără valori, pagina Activitate cu detaliul din memorie, Aprobări cu expirare și notificări. | Fiecare politică are un test de capăt la capăt. |
| **M3. Codex și verificator** | Adaptor OpenAI Responses (după confirmarea în documentația oficială), pagina Conectează aplicații, gestionarea serviciului verificatorului. | Codex lucrează prin proxy; verificatorul pornește și se oprește din aplicație. |
| **M4. Securitate** | Depozit criptat, chei per client cu expirare, actualizări semnate, instalator. | Audit de securitate pe lista din secțiunea 5. |
| M5 (opțional) | Server de echipă cu vocabular comun și spații de lucru. | Decizie separată: serverul ar ține vocabularul și seifurile. |

---

## 8. Testare și acceptare

- **Nucleul:** cele 901 teste existente rămân verzi.
- **Contractele API:** pentru fiecare adaptor, cereri și fluxuri înregistrate (cu date fictive): simbol tăiat între două evenimente de flux, argumente de unealtă în bucăți JSON, raționament semnat retrimis, imagini, câmpuri necunoscute (trebuie să blocheze), erori ale furnizorului.
- **Fără scurgeri:** un test care trimite toate cazurile din `eval/cases-en.json` și `eval/cases.json` prin proxy către un furnizor fals și verifică că nicio valoare din vocabular nu apare în ce primește furnizorul.
- **Caching:** după prima cerere a unei conversații, `cache_read_input_tokens` > 0 pe furnizorul real.
- **Evaluările existente:** [verificator-en.md](../eval/results/verificator-en.md) rerulat prin proxy, cu aceleași rezultate.
- **Manual:** o sesiune reală în Claude Code și una în Claude Desktop, cu vocabularul de test.

---

## 9. Întrebări deschise

1. **Electron sau Tauri** (secțiunea 2.1).
2. **Identitatea conversației:** ce id trimite fiecare client; seif pe conversație sau pe utilizator (2.3).
3. **Codex:** API-ul exact (Responses), cheile din `config.toml` citite de aplicația desktop și facturarea, confirmate în documentația OpenAI.
4. **Facturarea Claude Desktop în modul gateway:** confirmat că nu folosește abonamentul; de spus clar utilizatorului înainte de conectare.
5. **Raționamentul semnat:** de verificat pe API-ul real că harta „restaurat → original” e suficientă în toate cazurile (2.4).
6. **Verificatorul în română:** nemăsurat; până atunci, pagina Verificator spune „măsurat doar pe engleză”.
7. **Aprobările pentru cuvintele la care verificatorul e nesigur** (de exemplu „zoom”): în coadă, sau mascate direct ca azi.
8. **Serverul de echipă** (M5): dacă e nevoie de el.

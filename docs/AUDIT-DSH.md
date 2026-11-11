# Auditul canalelor de date din DSH (Alterego)

> **Întrebarea:** pe ce căi poate pleca textul unei conversații de pe computer, și le acoperă sAI pe toate?
>
> **Metoda:**
> - am citit codul DSH: pachetele din `packages/` și configurația bundle-urilor `base` și `web-app`, pe care le folosește aplicația desktop;
> - am urmărit fiecare loc în care conținutul ajunge la un serviciu extern;
> - pentru fiecare problemă găsită am scris o corecție și un test automat (`tests/egress.spec.ts`).

## Rezumat

| # | Canal | Pleacă text real? | Înainte | Acum |
|---|---|---|---|---|
| 1 | Cererea către model: mesaje, raționament, argumente de unelte, fișiere | da | redactat | redactat |
| 2 | Mesaje `developer` (text injectat în conversație) | da | **nu era redactat** | redactat |
| 3 | Descrierile uneltelor (scrise de deployment sau de servere MCP) | posibil | **nu era redactat** | redactat, cu numele și structura uneltelor păstrate |
| 4 | Imagini atașate sau capturi de ecran | da, ca pixeli | **trimise așa cum sunt** | cererea e refuzată; se poate permite din setări |
| 5 | Argumentele uneltelor care trimit date în afară (`web_search`, `web_fetch`, MCP) | da | **restaurate, deci valori reale către terți** | păstrează simbolurile (listă editabilă în setări) |
| 6 | `dsh_session_log`: jurnalul sesiunii atașat la cererile DeepSeek oficiale (session-log-deepseek) | **da, tot jurnalul, nemascat** | **ocolea complet sAI** | redactat cu același vault; dacă nu se poate, câmpul e scos |
| 7 | Telemetria la feedback (session-telemetry-otel, `FEEDBACK_ONLY`, activă implicit) | **da, jurnalul sesiunii, la Like/Dislike** | **ocolea complet sAI** | redactat; dacă nu se poate, înregistrarea e reținută |
| 8 | Telemetria de produs (product-analytics) | nu: doar numele evenimentelor și id-uri | — | fără schimbare |
| 9 | Titlurile conversațiilor și compactarea (rezumatele) | da | redactate: trec prin aceeași cerere `llm/stream` | fără schimbare |
| 10 | Sub-agenții din proces | da | redactați: aceeași cale, sesiune proprie | fără schimbare |
| 11 | Jurnalul local al sesiunii, jurnalele aplicației, vocabularul din setări | da, **dar local** | — | neschimbat; vezi „Ce rămâne” |

## Detalii

### 1–3. Cererea către model

Plugin-ul sAI se agață de `llm/stream`, singura cale prin care DSH vorbește cu un model. Am verificat apelurile directe ale lui `ctx.llm.stream`: agent-loop, compactarea, rezumatele, auto-review. Toate trec prin waterfall, deci prin sAI.

Două câmpuri nu erau redactate:
- **Mesajele `developer`** erau trimise neschimbate. Ele pot conține text, nu doar actualizări de unelte, iar adaptorul pi-ai îl trimite modelului. Acum textul e redactat, iar blocurile `tool-addition` și `tool-removal` rămân.
- **`tools[].description`** și descrierile din schema JSON a parametrilor. Le scrie cine instalează un server MCP sau un skill și pot numi clienți sau persoane. Acum sunt redactate. Numele uneltelor, tipurile și proprietățile rămân intacte, ca modelul să le poată apela.

### 4. Imagini

Un bloc `image` ajunge la model ca pixeli; sAI nu îi poate citi. O fotografie a unui contract sau o captură de ecran cu un nume ar fi trecut neprotejată.
- **Setarea nouă „Send images”** e oprită implicit: o cerere cu imagine e refuzată, cu un mesaj care explică de ce.
- **Imaginile „offloaded”**, pe care DSH le trimite doar ca text cu calea fișierului, trec în continuare.

### 5. Unelte care trimit argumentele în afară

Ca uneltele locale să funcționeze, sAI restaurează argumentele apelurilor de unelte. De exemplu, `write_file` trebuie să scrie numele real. Pentru `web_search` asta însemna că furnizorul de căutare primea numele real.
- **Setarea nouă „external tools”**, implicit `web_search`, `web_fetch` și `mcp__*`: argumentele acestor unelte rămân cu simboluri.
- **Prețul:** o căutare web după o persoană protejată caută simbolul, deci nu găsește nimic util. Utilizatorul poate scoate o unealtă din listă dacă acceptă riscul.

### 6. `dsh_session_log` (DeepSeek oficial)

Plugin-ul `session-log-deepseek` e activ implicit în bundle-ul `base`. La **fiecare** cerere către API-ul oficial DeepSeek, el adaugă câmpul `dsh_session_log`, cu evenimentele jurnalului sesiunii. Jurnalul e păstrat local **nemascat**, deci acest câmp trimitea textul real, ocolind complet redactarea mesajelor. Cu OpenRouter (pi-ai), cum s-a folosit în evaluări, câmpul nu se trimite. Cu furnizorul DeepSeek, da.
- **Corecția:** sAI interceptează pregătirea câmpurilor DeepSeek și redactează jurnalul cu vault-ul sesiunii, deci cu aceleași simboluri ca mesajele.
- **Câmpurile de identitate rămân:** tipul evenimentului, id-urile, rolurile.
- **Fail-closed:** dacă redactarea e refuzată, câmpul e scos din cerere.
- **Limita de implementare:** DSH nu are un punct de extensie pentru aceste câmpuri, așa că sAI înlocuiește metoda `prepare` a registrului și o restaurează la descărcarea plugin-ului. Un hook oficial în DSH ar fi mai curat.

### 7. Telemetria la feedback

`session-telemetry-otel` rulează implicit în modul `FEEDBACK_ONLY`. Când utilizatorul apasă Like/Dislike, trimite porțiunea din jurnalul sesiunii de până la acel mesaj către `dsh-otel-collector.deepseeksvc.com`, **indiferent de furnizorul modelului**.
- **Corecția:** DSH are aici un punct de redactare oficial (`session-telemetry/record`), iar sAI se conectează la el: corpul înregistrării și atributele (inclusiv `session.cwd`) sunt redactate.
- **Fail-closed:** dacă sAI nu poate redacta, înregistrarea e reținută.
- **Alternativa completă:** variabila de mediu `DSH_TELEMETRY_DISABLED=1` oprește acest canal cu totul.

### 8–10. Fără scurgeri de conținut

- **Telemetria de produs** (`product-analytics` și `product-telemetry-otel`) trimite doar numele evenimentelor, id-ul dispozitivului și versiunea, fără conținutul mesajelor.
- **Titlurile, compactarea și sub-agenții din proces** trec prin `llm/stream`, deci sunt redactați.
- **Sub-agenții externi** (Claude Code, Codex, ACP) ar ocoli sAI, pentru că rulează propriile modele. Nu sunt în bundle-urile `base` și `web-app`, dar pot fi adăugați din managerul de plugin-uri.

### 11. Ce rămâne local, dar trebuie știut

- **Jurnalul sesiunii** (`session-persistence-jsonl`) păstrează textul real: e alegerea de design, ca utilizatorul să-și vadă conversația.
- **Vocabularul** sAI e salvat în clar în configurația DSH.
- **Jurnalele aplicației:** sAI scrie acolo doar numere, niciodată valori.

Acestea nu pleacă de pe computer, dar oricine are acces la disc le poate citi. Pentru producție, criptarea vocabularului și a jurnalului ar fi pasul următor.

## Ce rămâne neacoperit

- **Sub-agenții externi** (Claude Code, Codex, ACP), dacă sunt instalați. Ar trebui blocați când sAI e activ, sau trecuți și ei prin sAI.
- **Serverele MCP care nu au prefixul `mcp__`.** Trebuie adăugate în lista „external tools”.
- **Căile de fișiere și numele de utilizator** din mediul de lucru, de exemplu `C:\Users\<nume>\...`, sunt redactate doar dacă numele e în vocabular.
- **Uneltele terminal** (bash, pwsh) primesc valorile reale, cum e necesar. O comandă scrisă de model, de exemplu un `curl` către un site, poate trimite date în afară. Asta ține de permisiunile uneltelor din DSH, nu de sAI.

## Teste

`tests/egress.spec.ts` are 8 teste:
- mesaje developer;
- descrieri de unelte;
- imagini (blocate, permise, offloaded);
- unealtă locală față de unealtă externă, inclusiv cu prefixul `mcp__`;
- redactarea evenimentelor de jurnal;
- telemetria și câmpul DeepSeek, cu sAI pornit și oprit.

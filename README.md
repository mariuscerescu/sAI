# sAI: pseudonimizare reversibilă înainte de modelele din cloud

sAI înlocuiește datele protejate cu simboluri înainte ca textul să plece spre un model AI din cloud, apoi pune la loc valorile reale în răspuns. Protejate sunt:
- persoanele, firmele și proiectele declarate de utilizator;
- identificatorii recunoscuți automat: IDNP, CNP, IBAN, card, telefoane, SSN, NINO și altele.

```
„Contractul Popescului cu Acme a fost semnat.”  →  „Contractul ⟦PERSON_1⟧ cu ⟦COMPANY_1⟧ a fost semnat.”  →  model
răspunsul modelului: „… ⟦PERSON_1⟧ …”                                                                         →  „… Popescu …”
```

Prototipul e un plugin pentru DeepSeek Harness (DSH), în fork-ul Alterego, scris în TypeScript. Ținta finală e un nucleu Rust pentru Android, iOS, web și desktop.

## Ce face

- **Vocabular** de entități, cu toate formele lor:
  - flexiuni românești: Popescului, Cebanei, Băncii Verde, vocativul Ioane / Ștefane;
  - forme englezești: Smith's, the Smiths;
  - prenumele și numele de familie găsite singure;
  - numele firmei fără forma juridică și numele ei scurt.
- **Ce e garantat:** sAI protejează exact ce e declarat în vocabular, plus identificatorii în formatele standard. Persoanele nedeclarate ajung la model așa cum sunt scrise: nu există un detector care să ghicească nume. Orice găsește sAI e înlocuit; nimic nu depinde de un scor sau de un prag. Singura excepție e un prenume necunoscut lipit de un nume de familie protejat („Floare Munteanu”), care devine o persoană nouă.
- **Tipare cu validare:** IDNP/IDNO, CNP, telefoane MD/RO/US/UK, SSN, NINO, IBAN, card, e-mail, IPv4.
- **Două strategii de simboluri:** typed (`⟦PERSON_1⟧`, recomandată) și greek (litere grecești, experimentală).
- **Restaurare în streaming,** cu reținerea doar a câtorva caractere.
- **Fail-closed:** dacă verificarea finală găsește ceva nemascat, cererea nu pleacă.
- **Protecția canalelor din afara cererii:** imagini, unelte web și MCP, jurnalul sesiunii trimis către DeepSeek, telemetria la feedback. Detalii în [docs/AUDIT-DSH.md](docs/AUDIT-DSH.md).

## Structura

| Cale | Conținut |
|---|---|
| [docs/ARHITECTURA.md](docs/ARHITECTURA.md) | Arhitectura și componentele |
| [docs/CERCETARE-FLEXIUNI.md](docs/CERCETARE-FLEXIUNI.md) | Cercetarea despre formele flexionate |
| [docs/AUDIT-DSH.md](docs/AUDIT-DSH.md) | Auditul tuturor canalelor de date din DSH |
| [eval/](eval/) | Setul de evaluare (română: `cases.json`; engleză: `cases-en.json`), rapoarte, checklist, rezultate |
| [prototype/dsh-plugin/sai](prototype/dsh-plugin/sai) | Plugin-ul DSH: `src/core` (nucleul pur), `src/request.ts` și `src/egress.ts` (legătura cu DSH), `src/client` (setări și „Model view”), teste, scripturi |
| [prototype/dsh-plugin/sai-bundle](prototype/dsh-plugin/sai-bundle) | Bundle-ul opțional care îl instalează |

## Rezultate

- **817 teste automate.** Ele acoperă:
  - ~200 de forme românești și 148 de propoziții englezești;
  - nume compuse, tipare și canale de date;
  - texte lungi.
- **Testul de potriviri false** pe ~360.000 de cuvinte din Wikipedia (română și engleză): niciun cuvânt scris cu literă mică nu e mascat greșit.
- **Evaluarea cu un model real,** în română și engleză: zero scurgeri ale numelor declarate. Vezi:
  - [eval/RAPORT-flexiuni.md](eval/RAPORT-flexiuni.md)
  - [eval/RAPORT-engleza.md](eval/RAPORT-engleza.md)
  - [eval/CHECKLIST.md](eval/CHECKLIST.md)
- **Latența:** sub 3 ms pentru un mesaj obișnuit. Nucleul are sub 31 KB minificat (sub 12 KB gzip); măsurătoarea e dinainte de eliminarea listelor de nume.

## Rulare

Plugin-ul se construiește în interiorul checkout-ului Alterego-DSH, în `packages/experimental/sai`. Comenzile se rulează din rădăcina DSH:

```bash
npx vitest run packages/experimental/sai
node --expose-gc --import tsx/esm packages/experimental/sai/scripts/benchmark.ts
node --import tsx/esm packages/experimental/sai/scripts/false-match-test.ts --set en
```

Scripturile de evaluare au căi absolute spre acest folder. Corpusul Wikipedia se descarcă local; vezi [eval/corpus/README.md](eval/corpus/README.md).

Toate datele de test sunt fictive.

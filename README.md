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
  - flexiuni românești: Popescului, Cebanei, Băncii Verzi, vocativul Ioane / Ștefane, alternanțele (Florii, Popeștii) și pluralul (Băncile, Grupurilor);
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
| [docs/LIMITE.md](docs/LIMITE.md) | **Limitele cunoscute ale primei versiuni**, cu măsurătorile și ideile de reparație |
| [eval/](eval/) | Setul de evaluare (română: `cases.json`; engleză: `cases-en.json`), rapoarte, checklist, rezultate |
| [prototype/dsh-plugin/sai](prototype/dsh-plugin/sai) | Plugin-ul DSH: `src/core` (nucleul pur), `src/request.ts` și `src/egress.ts` (legătura cu DSH), `src/client` (setări și „Model view”), teste, scripturi |
| [prototype/dsh-plugin/sai-bundle](prototype/dsh-plugin/sai-bundle) | Bundle-ul opțional care îl instalează |

## Rezultate

- **Verificatorul local (Decider-Flash v1.3, modul `all`), pe partea finală a setului înghețat în engleză:** 4 nume reale scăpate din 5.445 (0,073%) și 1,62% cuvinte obișnuite ascunse inutil. Vezi [eval/results/frozen-final.md](eval/results/frozen-final.md) și [docs/LIMITE.md](docs/LIMITE.md).
- **947 de teste automate.** Ele acoperă:
  - ~200 de forme românești și 148 de propoziții englezești;
  - nume compuse, tipare și canale de date;
  - texte lungi.
- **Testul de potriviri false** pe ~360.000 de cuvinte din Wikipedia (română și engleză): niciun cuvânt scris cu literă mică nu e mascat greșit.
- **Acoperirea flexiunilor** pe 339.212 cuvinte din Wikipedia: 92,4% din formele flexionate ale numelor proprii sunt generate direct, încă 4% din baza corectă (vezi [eval/results/inflection-coverage-wiki.md](eval/results/inflection-coverage-wiki.md)). În engleză, pe 251.322 de cuvinte: pluralul și posesivul sunt acoperite 100% ([eval/results/inflection-coverage-wiki-en.md](eval/results/inflection-coverage-wiki-en.md)).
- **Comparația cu dexonline**, o sursă independentă de reguli: din 1.420.777 de forme flexionate ale celor 152.734 de substantive și adjective din dicționar, generatorul produce **99,0%**. Vezi [eval/results/dexonline-compare.md](eval/results/dexonline-compare.md); datele dexonline (GPL) nu sunt în repo.
- **Comparația cu AGID** pentru engleză: din 77.178 de plurale de substantive, generatorul produce **97,5%**. Pluralele latine și grecești sunt lăsate deoparte intenționat. Vezi [eval/results/agid-compare.md](eval/results/agid-compare.md).
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

**Verificatorul local** este un proces separat. Se pornește cu Python 3.11, CUDA, `torch`, `transformers` și `bitsandbytes`, apoi se activează din setările sAI:

```bash
python -I packages/experimental/sai/verifier/decider_server.py --model "<folderul perplexity-ai__pplx-decider-flash-v1.3>" --port 8765
```

Dacă serviciul nu rulează, sAI maschează fiecare cuvânt pe care l-ar fi întrebat.

Scripturile de evaluare au căi absolute spre acest folder. Corpusul Wikipedia se descarcă local; vezi [eval/corpus/README.md](eval/corpus/README.md).

Toate datele de test sunt fictive.

# Suport pentru engleză: implementare și teste

> Datele sunt fictive. Corpusul de test e Wikipedia în engleză. Raportul pentru română este [RAPORT-flexiuni.md](RAPORT-flexiuni.md).

## Ce s-a schimbat

**1. Pachete de limbă** (`src/core/languages.ts`). Tot ce depinde de limbă stă într-un pachet înlocuibil:
- formele unui cuvânt;
- titlurile care nu sunt nume;
- formele juridice ale firmelor.

Setarea nouă **„Languages of your texts”** (română, engleză sau ambele; implicit ambele) alege pachetele active. Restul nucleului nu depinde de limbă: căutarea, simbolurile, restaurarea și tiparele.

| | Română | Engleză |
|---|---|---|
| Forme | genitiv/dativ, articol, vocativ (Popescului, Ioane, Mariei) | pluralul de familie (the Smiths, the Joneses); posesivul „Smith's” e separat deja de apostrof |
| Titluri | dl., dna, domnul, doamna, dr., prof., ing. | Mr., Mrs., Ms., Miss, Mx., Sir, Madam, Dr., Prof., Jr., Sr. |
| Forme juridice | SRL, SA, SC, ÎI, ONG, SNC, SCS, RA, IM | Inc, Ltd, LLC, Corp, Co, plc, LLP, LP, GmbH, AG, Corporation, Incorporated, Limited |

Cu doar engleza activă, regulile românești nu se mai aplică, deci „Anne” nu mai e luată drept Ann și „Dane” drept Dan. Cu ambele limbi active, astfel de coincidențe rămân posibile, dar sunt rare. Pe Wikipedia în engleză au apărut 11 în 254.000 de cuvinte, toate „Greene”, vocativul românesc al lui „Green”.

**2. Regula majusculei, corectată.** Un text e considerat „cu nume scrise cu majusculă” doar dacă are un cuvânt care începe cu majusculă **în interiorul unei propoziții**. Nu se numără:
- primul cuvânt al unei propoziții, rânduri sau ghilimele (majuscula pusă de tastatură);
- „I”;
- acronimele (NATO, CEO).

**Regula:**
- **Prenumele găsit singur cere mereu majusculă.** Prenumele sunt cele care coincid cel mai des cu cuvinte obișnuite: will, mark, grace, iulie, anii, victoria.
- **Numele de familie și formele generate** cer majusculă doar dacă textul scrie numele cu majusculă.
- **Exemple:**
  - „I talked to smith” și „Am vorbit cu popescului” sunt mascate;
  - „I will call you” nu maschează „will”, chiar dacă există Will Turner în vocabular;
  - „Am vorbit cu Ion și cu rusului” nu maschează „rusului”, pentru că textul scrie numele cu majusculă.

**3. Numele firmei fără forma juridică.** „Acme Corp” protejează automat și „Acme”, iar „SC Acme Logistic S.R.L.” protejează și „Acme Logistic”. Funcționează pentru ambele limbi.

**4. Tipare noi**, active implicit:
- **SSN american:** cu validare (zonă diferită de 000, 666 și 9xx; grup diferit de 00; serie diferită de 0000) și cu separatori obligatorii, ca să nu prindă numere de 9 cifre;
- **telefoane SUA/Canada:** cu regula NANP, separatori obligatorii;
- **telefoane din Marea Britanie;**
- **numărul britanic de asigurare socială (NINO):** cu regulile de prefix și sufix.

Nu se suprapun cu tiparele moldovenești și românești: un test verifică explicit că 069 123 456, 0722 123 456 și IDNP-ul nu sunt prinse.

**5. Nume cu apostrof sau cratimă** (O'Brien, Bennett-Smith) sunt protejate și când apar singure.

## Test 1: acoperire (148 de propoziții în engleză)

**Vocabularul:**
- 40 de persoane, declarate **doar cu numele complet** (John Smith, Sophie O'Brien, Chloe Bennett-Smith…);
- 10 firme, declarate cu forma juridică (Acme Corp, Globex Inc., Northwind Traders Ltd…);
- 3 proiecte.

**Propozițiile acoperă:**
- posesive (Smith's, Smith’s, Williams', Williams's);
- pluralul de familie (the Smiths, the Joneses, the Walshes) și posesivul lui (the Smiths' house);
- titluri (Mr., Mrs., Ms., Dr., Sir, MS. TAYLOR);
- prenume singure (Dear John, Hi Robert, Thanks, David!);
- nume la început de propoziție (White said no.);
- majuscule (MARY JOHNSON);
- text scris cu literă mică (i talked to smith yesterday);
- firme fără forma juridică (Acme said yes., Northwind Traders won the bid.).

**Rezultat:** toate cele 148 de propoziții sunt mascate cu simbolul corect, atât cu engleza singură, cât și cu ambele limbi. Testul verifică și că niciun cuvânt din nume nu rămâne în textul trimis.

**Toată suita are 776 de teste și toate trec.** Ea cuprinde și testele pentru română, pachetele de limbă, regula majusculei și tiparele noi.

## Test 2: potriviri false (Wikipedia în engleză, 254.062 de cuvinte, 29 de articole)

Articolele acoperă subiecte variate: al Doilea Război Mondial, Londra, economie, Shakespeare, drept, bănci, asigurări, contracte și altele. Vocabularul e cel din testul 1, declarat doar cu nume complete. Listele complete sunt în [results/false-matches-en-only.md](results/false-matches-en-only.md) (doar engleză) și [results/false-matches-en.md](results/false-matches-en.md) (ambele limbi).

| | Doar engleză | Engleză + română |
|---|---:|---:|
| Potriviri | 683 | 694 |
| cu avertisment (0,6) | 509 | 510 |
| fără avertisment | 174 | 184 |
| **cuvinte scrise cu literă mică** | **0** | **0** |

**Verificare:** toate potrivirile sunt scrise cu majusculă și sunt nume proprii ale altor persoane sau titluri.
- **Prenume** (avertisment): John ×95, William ×66, James ×40, Charles ×32, George ×30…
- **Nume de familie** (fără avertisment):
  - Smith ×14 (Adam Smith), White ×14, Green ×13, Martin, Taylor, Brown…;
  - **„King” ×53**: în engleză e și titlu („the King”, „King George”). E mascat, dar restaurat corect.
- **Doar cu ambele limbi:** „Greene” ×9, vocativul românesc al lui „Green”.

E aceeași situație ca în română: un nume de familie declarat apare și la alte persoane cu același nume. Nu sunt scurgeri, ci mascare în plus. Pe corpusul românesc, pachetul englez n-a adăugat nicio potrivire falsă: 564 de potriviri, la fel ca înainte.

## Test 3: evaluare cu modelul real

**Configurația rulării:**
- set nou: [cases-en.json](cases-en.json), 20 de cazuri traduse și adaptate din categoriile A, B, F și K;
- caz nou A5: text scris cu literă mică, cu „I”;
- caz nou H1: SSN, telefoane SUA/UK, NINO;
- variantele typed și greek, cu modelul `thinkingmachines/inkling-2-small:free`;
- persoanele sunt declarate **doar cu numele complet**.

Rezultatele sunt în `results/run-en1/` (prima rulare) și `results/run-en2/` (rerulare). Am citit fiecare text trimis.

**Prima rulare: o singură scurgere reală, „Acme” singur** (A1, A3, A5, B2, K1, K5).
- **Cauza:** vocabularul englezesc declara doar „Acme Logistics Inc.”. Regula formei juridice produce „Acme Logistics”, nu „Acme”; în setul românesc „Acme” era declarat separat.
- **De ce nu derivez automat primul cuvânt al unei firme:** „Blue Harbor Bank” ar proteja „Blue”, iar „Nordic Farms” ar proteja „Nordic”.
- **Concluzie:** numele scurt al unei firme trebuie declarat ca formă în vocabular.

**Rerularea celor 6 cazuri, cu „Acme” declarat: zero scurgeri.**

| Caz | Ce s-a trimis (typed) | Observație |
|---|---|---|
| A3, text scris cu literă mică | `«⟦PERSON_1⟧'s contract with ⟦COMPANY_1⟧ were signed by the ⟦PERSON_2⟧ at ⟦PROJECT_1⟧»` | „smith's”, „acme”, „the johnsons” și „project orion” sunt toate mascate |
| A5, „I talked to smith…” | `I talked to ⟦PERSON_1⟧ and ⟦PERSON_2⟧ yesterday about the ⟦COMPANY_1⟧ deal… tell ⟦PERSON_3⟧?` | regula majusculei corectată funcționează |
| B1, organigramă | Smith, Johnson, Walker, Clark și Victor Hale, toate mascate | răspuns corect în ambele strategii |
| B4, trei mesaje | `⟦PERSON_1⟧ is ⟦COMPANY_1⟧' lawyer…` | memoria peste mesaje e corectă |
| H1, identificatori | `SSN is ⟦SSN_1⟧ … phone is ⟦PHONE_1⟧ … UK office is on ⟦PHONE_2⟧ … NI number is ⟦NINO_1⟧` | toate tiparele noi au mascat și au restaurat corect |
| K1 | „Mary Smith” e o persoană nouă, nu John Smith | persoanele nu se contopesc |
| K3 | „the Orion cinema” rămâne în clar, „Project Orion” e mascat | corect: doar proiectul e declarat |
| K5 | „Greenfield Bank” (fără „plc”) primește același simbol ca „GB” | regula formei juridice funcționează |

**Limite văzute, toate cunoscute și nelegate de scurgeri de nume declarate:**
- **K2, „Rose Walker”:** „Walker” e mascat, dar „Rose” (nedeclarat) rămâne. E același caz ca „Floare Munteanu” în română (A4).
- **K5, `gb_total`:** devine `⟦COMPANY_1⟧_total`. Ține de identificatorii din cod, scoși din plan.
- **F4:** tiparul `firstname.lastname@company.com` e mascat ca e-mail (A6). Rămâne în checklist.
- **Greek, A4:** modelul scrie pluralul lipit de literă („λs”), iar restaurarea nu îl recunoaște. Typed nu are problema: „the John Smiths”.
- **F1, F2, F3, F6:** sarcinile care cer valoarea reală dau aceleași răspunsuri absurde după restaurare ca în română (C1, C2).

**Calitatea răspunsurilor** la A2, B1, B2, B3, B4 și H1 e corectă în ambele strategii.

## Scurgeri închise după audit

| Scurgere | Corecție | Verificare cu modelul real |
|---|---|---|
| Prenume nedeclarat lângă un nume de familie protejat („Floare Munteanu”, „Rose Walker”) | Un cuvânt cu majusculă chiar înaintea unui nume de familie protejat formează cu acesta o persoană nouă. La început de propoziție contează doar dacă e un prenume cunoscut, așa că „Contractul Popescului” rămâne. | K2 și I3 (ro), K2 (en): `⟦PERSON_1⟧ a cules o floare mare…`, `⟦PERSON_1⟧ picked a red rose…` |
| Persoane nedeclarate în engleză („Will Baker”) | Liste de prenume și nume de familie englezești în detectorul de nume. Posesivul („Baker's”) e scos din cuvânt. Un nume comun singur la început de propoziție („Will you sign?”, „Green light”) e ignorat. | K2 (en), `results/run-en4/`: `from ⟦PERSON_2⟧'s garden` |
| Numele scurt al unei firme („Acme” pentru „Acme Logistics Inc.”) | Primul cuvânt distinctiv al numelui, cu avertisment. Nu se aplică pentru cuvinte generice și locuri (Banca, Project, Moldova). | A1, A3, A5, B2, K1 și K5 (en), `results/run-en3/`: „Acme” nedeclarat, mascat peste tot |

Testele sunt în `tests/known-leaks.spec.ts`. Suita completă avea atunci **809 teste**, iar toate treceau.

> **Actualizare 15.11.2026:** detectorul de nume din liste a fost eliminat (vezi [CHECKLIST.md](CHECKLIST.md), G1). Rândul „Persoane nedeclarate în engleză” nu mai e valabil: o persoană nedeclarată, cum e „Will Baker”, ajunge acum la model așa cum e scrisă. Prima regulă rămâne, fără liste: la început de propoziție, cuvântul se lipește de numele protejat doar înaintea formei declarate a numelui. Suita are acum 808 teste.

În testul de potriviri false, numele scurte au adăugat puține potriviri, toate cu avertisment: în română „Nordic” ×1; în engleză „Summit” ×3, „Atlas” ×3, „Blue” ×2, „Riverside” ×1. Niciun cuvânt scris cu literă mică nu e mascat.

## Ce rămâne deschis

- **Numele scurte ambigue:** un nume scurt care e și cuvânt obișnuit („Nordic”, „Blue”) e mascat când apare cu majusculă, cu avertisment. Se poate dezactiva punând cuvântul în lista de excepții (allowlist).
- **Nume de familie care sunt și titluri sau cuvinte cu majusculă** („King”, „White” la început de propoziție): sunt mascate, deci textul se schimbă doar pentru model. Nu e o scurgere.
- **Setările deja salvate:** cine are lista de tipare salvată în setări vede tiparele noi (SSN, telefoane SUA/UK, NINO) bifate abia după ce le activează în pagina de setări. Setarea limbilor e implicit „ambele”.

## Regenerare

- **Testul 1:** `npx vitest run packages/experimental/sai`, fișierul `tests/english.spec.ts`.
- **Testul 2:** `node --import tsx/esm packages/experimental/sai/scripts/false-match-test.ts --set en [--languages en]`.
- **Testul 3:** `run-eval.ts --file cases-en.json --variants typed,greek --max-tokens 8000`.

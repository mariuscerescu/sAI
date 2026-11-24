# Verificatorul în trei moduri: rezultate (engleză și română)

Data: 2026-11-19. Model: Decider-Flash v1.3, 4 biți, pe placa video, prag 0,2. Fiecare mesaj face cel mult un apel către model. Datele brute (doar totaluri pentru textele Nemotron și Wikipedia) sunt în `verificator-moduri-class.json` și `verificator-moduri-general.json`; cazurile scrise de mână sunt în [../verifier-cases-extra.json](../verifier-cases-extra.json).

Modurile:
- **oprit:** doar regulile de majusculă, ca înainte de verificator;
- **lowercase (varianta B):** la model merg doar formele de un cuvânt scrise cu literă mică;
- **all (două etape):** la model merg toate formele de un cuvânt, cu orice literă (Q1), plus cuvântul cu majusculă de lângă un nume de familie (Q2) și alegerea între două persoane cu același prenume (Q3). Potrivirile exacte pe mai multe cuvinte și tiparele validate nu ajung la model.

**Decizie (2026-11-19): sAI folosește doar formularea generală.** Formularea pe clase a fost scoasă din serviciu; măsurătorile ei rămân mai jos pentru comparație. Descrierea pe care utilizatorul o dă unei clase o înlocuiește pe cea generală.

Formularea lui Q1:
- **pe clase:** „a person's name”, „a company's name”; pentru celelalte clase, întrebarea generală;
- **generală:** „the name of a person, company, project, product or place”, pentru toate clasele.

## 1. Setul de 822 de cazuri (420 de nume, 402 cuvinte obișnuite)

| Mod | Nume scăpate | Cuvinte obișnuite mascate | din care cu majusculă | Apeluri | Întrebări | Durata unui apel (mediană) |
|---|---|---|---|---|---|---|
| oprit | 164 | 177 | 29 | 0 | 0 | — |
| lowercase, pe clase | 0 | 29 | 29 | 572 | 608 | 206 ms |
| lowercase, generală | 0 | 31 | 29 | 572 | 608 | 210 ms |
| **all, pe clase** | **0** | **2** | 2 | 822 | 1.117 (876 Q1, 241 Q2) | 185 ms |
| **all, generală** | **0** | **6** | 4 | 822 | 1.117 | 203 ms |

## 2. Setul extins scris de mână (73 de verificări, date fictive)

| Grup | oprit | lowercase | all, pe clase | all, generală |
|---|---|---|---|---|
| Proiecte, produse, locuri, clasă proprie, firme (17) | 8 | 13 | 16 | 16 |
| Scrieri declarate de un cuvânt: „Bill” singur (8) | 4 | 4 | **8** | **8** |
| Majuscula de la începutul propoziției (8) | 4 | 4 | **8** | **8** |
| Cuvânt cu majusculă lângă un nume de familie, Q2 (16) | 11 | 11 | **16** | **16** |
| Același prenume la două persoane, Q3 (3) | 1 | 1 | **3** | **3** |
| Română (21) | 12 | 12 | 18 | 18 |
| **Total (73)** | **40** | **45** | **69** | **69** |

Greșelile rămase în modul `all`:

| Caz | Pe clase | Generală | Tip |
|---|---|---|---|
| „We had lunch at a **riverside** cafe.” (LOCATION Riverside Depot) | mascat | mascat | mască în plus |
| „**Popa** din sat a ținut slujba…” (Elena Popa) | mascat | mascat | mască în plus |
| „**Rușii** au semnat acordul comercial.” (Ion Rusu) | corect | mascat | mască în plus |
| „**Soare** a plătit factura ieri.” (firma Soare Grup SRL) | **nemascat** | corect | **scăpare** |
| „Am vorbit cu **rusu** despre factură.” (Ion Rusu) | **nemascat** | **nemascat** | **scăpare**, apare și în modul `lowercase`; azi e mascat |

## 3. Wikipedia în engleză (29 de articole, 254.062 de cuvinte, texte fără persoanele din vocabular)

| Mod | Cuvinte mascate | cu majusculă | Trimise ca atare după model | Întrebări | Durata unui apel: mediană / p95 |
|---|---|---|---|---|---|
| oprit | 619 | 614 | 0 | 0 | — |
| lowercase, generală | 622 | 614 | 96 | 101 | 562 ms / 2,1 s |
| all, pe clase | 561 | 556 | 157 | 911 (785 Q1, 80 Q2, 46 Q3) | 2,2 s / 15 s |
| all, generală | 597 | 589 | 121 | 911 | 2,2 s / 22 s |

Cuvintele cu majusculă lăsate nemascate în modul `all` sunt în mare parte cuvinte obișnuite („King”, „White”, „Green”, „Young”). Cu formularea pe clase au trecut și nume care nu sunt de persoană (McDonald's, St Martin's Press, Santa Barbara, St Mary Axe, World Summit, London Riverside) și un nume de persoană: „John” din numele altui om. Cu formularea generală mai trec doar „John” (același caz) și „Barbara” (Santa Barbara). Un apel pentru un articol întreg durează mult (până la 22 s), pentru că are zeci de întrebări.

## 4. Conversațiile de evaluare (20 de cazuri, 22 de mesaje)

Modurile `oprit` și `lowercase` dau același text trimis. Modul `all` schimbă un singur mesaj (K5): în numele de variabilă `gb_total`, „gb” (scrierea declarată „GB” a băncii) a trecut nemascat, P = 0,015. Azi e mascat. E o **scăpare**.

## 5. După cele două reparații (2026-11-20, formularea generală)

Reparațiile:
- **Identificatorii din cod:** o formă lipită de `_`, `/`, `\`, `@`, `#`, `$`, `=` sau de un punct urmat de literă (`gb_total`, `acme.com`) se maschează direct, fără model.
- **Româna:** într-un text în română, modelul poate doar adăuga măști. Ce maschează regulile rămâne mascat, iar cuvântul de lângă un nume de familie urmează regula veche (fără Q2).

| | oprit | lowercase | all |
|---|---|---|---|
| 822 de cazuri: nume scăpate | 164 | 0 | **0** |
| 822 de cazuri: cuvinte obișnuite mascate | 177 | 32 | **7** |
| Set extins (73) | 40 | 45 | **63** |
| din care română (21) | 12 | 12 | 12 |
| Conversații: mesaje schimbate față de azi | — | 0 | **0** (K5 `gb_total` e din nou mascat) |
| **Scăpări în setul extins și în conversații** | — | 1 („cu rusu”, înainte de reparație) | **0** |

- **Greșelile rămase în modul `all`** sunt toate măști în plus: „riverside cafe” și, în română, aceleași 9 cuvinte pe care regulile le maschează azi (Lupul, Popa, Florile, Anii, mari, Soarele, Marile, Rușii, Ieri).
- **Wikipedia, modul `all`: rezultatele acestei rulări nu sunt valabile.** Placa video era folosită în paralel de alte aplicații, iar apelurile pentru articolele lungi au durat până la 5 minute. Șase apeluri au depășit limita de 300 de secunde a clientului și au fost tratate ca eșuate, deci tot ce întrebau a fost mascat. Rezultatul valabil pentru Wikipedia rămâne cel din secțiunea 3; reparațiile nu schimbă textele în engleză, cu excepția formelor din identificatori.
- **Problemă de performanță:** un singur apel pentru un text lung (zeci de întrebări) poate dura minute pe o placă video împărțită cu alte aplicații. Timpul maxim implicit din setări (30 s) ar face ca, la un text lung, toate formele întrebate să fie mascate. E sigur, dar rezultatul poate fi prea mascat.

## Concluzii

- **Modul `all` rezolvă problemele găsite:** „Bill” declarat singur, majuscula de la începutul propoziției, „Ask Robinson”/„Then Robinson”, „Floare Munteanu” și prenumele comun (69 din 73, față de 45 în varianta B). Pe cele 822 de cazuri dă 0 nume scăpate și 2–6 cuvinte mascate inutil.
- **Formularea generală e mai prudentă:** a reparat scăparea „Soare” și lasă nemascate mai puține nume pe Wikipedia, cu prețul a câteva măști în plus. Se potrivește cu principiul „la îndoială, se maschează”.
- **Rămân două scăpări, ambele de rezolvat înainte ca modul `all` să devină implicit:**
  1. **Româna cu literă mică:** „cu rusu despre factură”. Scapă și în varianta B; regulile de azi îl maschează.
  2. **Identificatorii din cod:** `gb_total`.
- **Costul:** fiecare mesaj cu nume din vocabular apelează modelul. Pe propoziții, ~200 ms; pe texte lungi, secunde.

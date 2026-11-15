# sAI: checklist de corecții după evaluarea run1

> Sursa: [RAPORT-run1.md](RAPORT-run1.md). Cazurile (A1, B3…) sunt cele din [cases.json](cases.json).
> Regula: o problemă e bifată doar când (1) are un test automat care o reproduce și trece și (2) cazurile ei trec la rerulare (run2).
> Prioritate: **P0** scurgere de date · **P1** rezultat stricat fără semnal · **P2** calitate · **P3** unelte și confort.

---

## A. Detecție: scurgeri (comune typed și greek)

- [x] **A1 · P0 · Formele flexionate scapă nemascate**
  - Cazuri: A3, B1, B3, B4, F1 („Cebanei”, „Popescului”, „Mariei”, „Băncii Verde”)
  - Corecție: generarea automată a flexiunilor românești pentru fiecare cuvânt din termen (`-ul`, `-ului`, `-lui`, `-ei`, `-ii`, `-a → -ei/-ii`, `-e → -ei`), la compilarea vocabularului. Forma flexionată primește aceeași cheie ca forma de bază.
  - Gata când: un test cu 20 de forme flexionate le maschează pe toate cu simbolul corect; A3, B1, B3, B4 și F1 nu mai au scurgeri.
  - **Rezolvat:**
    - 200/200 de forme scrise de mână sunt găsite cu simbolul corect;
    - pe 108.659 de cuvinte de text fără vocabular, toate cele 45 de forme generate care sunt cuvinte obișnuite sunt semnalate ca incerte (0,6);
    - run2 are zero scurgeri în A3, B1, B3, B4 și F1.

    Detalii în [RAPORT-flexiuni.md](RAPORT-flexiuni.md).

- [ ] **A2 · P0 · Verificatorul de scurgeri ratează formele apropiate** — *potrivirea aproximativă (greșeli de scriere) scoasă din plan (decizie 2026-11-11); flexiunile sunt acoperite*
  - Cazuri: aceleași ca A1 (atât verificatorul din nucleu, cât și cel din `run-eval.ts`, le-au ratat)
  - Corecție: verificatorul folosește același potrivitor cu flexiuni ca A1, plus potrivire aproximativă (distanță de editare 1) pentru cuvinte de cel puțin 6 litere. Rezultatul e un avertisment, sau o blocare dacă politica o cere.
  - Gata când: un test cu „Cebanei”, „Popescului” și „Popesku” e semnalat; `run-eval.ts` raportează aceleași scurgeri.
  - **Parțial:**
    - flexiunile sunt acoperite, pentru că verificatorul folosește același detector;
    - `run-eval.ts` le raportează (vezi E1);
    - rămâne potrivirea aproximativă („Popesku”).

- [ ] **A3 · P0 · Nume lipite în identificatori de cod** — *scos din plan, caz rar (decizie 2026-11-11)*
  - Caz: E2 (`AcmeClient`)
  - Corecție: detecția caută termenii și în interiorul identificatorilor (`camelCase`, `PascalCase`, `snake_case`, `kebab-case`). Tot identificatorul devine un simbol propriu (`⟦IDENT_n⟧`), restaurat exact.
  - Gata când: `AcmeClient`, `popescu_id` și `get-acme-data` sunt mascați ca identificatori întregi; E2 trece fără scurgere și fără cod stricat (vezi și B2).

- [x] **A4 · P0 · Prenume necunoscut lângă un nume protejat**
  - Cazuri: F1 („Mariei Ceban”), I3, K2 („Floare Munteanu”), K1 („Maria Popescu”)
  - Corecție: un cuvânt cu majusculă lipit de un nume protejat e prenumele lui. Dacă perechea nu e un termen din vocabular, devine o entitate nouă (vezi B4). (Varianta inițială folosea și listele de prenume; listele au fost eliminate pe 15.11.2026, vezi G1.)
  - Gata când: „Maria Popescu” și „Floare Munteanu” sunt mascate integral; K1 nu mai contopește cele două persoane.
  - **Rezolvat:**
    - prenumele și numele de familie ale persoanelor declarate sunt mascate și singure;
    - un prenume nedeclarat lângă un nume protejat devine o persoană nouă („Floare Munteanu”, „Rose Walker”);
    - „Maria Popescu” nu se mai contopește cu Ion Popescu;
    - K1, K2 și I3 nu mai au scurgeri, în română și în engleză.

    Vezi [RAPORT-flexiuni.md](RAPORT-flexiuni.md) și [RAPORT-engleza.md](RAPORT-engleza.md).

- [ ] **A5 · P0 · Nume în alt alfabet** — *scos din plan (decizie 2026-11-11)*
  - Caz: K4 („Иван Попеску”)
  - Corecție: transliterarea automată latină ↔ chirilică pentru fiecare termen, la compilare. Opțional, câmp „forme suplimentare” în vocabular.
  - Gata când: K4 nu mai trimite numele în chirilică.

- [ ] **A6 · P2 · Tiparele mască date care nu sunt personale**
  - Caz: F4 (tiparul „prenume.nume@firma.md” e mascat drept e-mail)
  - Corecție: e-mailurile din lista de excepții (domenii-exemplu: `firma.md`, `example.com`, `domeniu.md`) nu se maschează. Allowlist pentru domenii.
  - Gata când: F4 trimite tiparul în clar și modelul îl folosește.

- [ ] **A7 · P2 · IDNO cu cifră de control invalidă nu e mascat**
  - Caz: I1, I2 (IDNO inventat, cu cifră greșită, trimis în clar)
  - Corecție: setare per tipar, „maschează și dacă validatorul eșuează”, activă implicit pentru numere precedate de „IDNO” sau „IDNP”. (Varianta inițială propunea un avertisment de încredere scăzută; scorurile au fost eliminate, vezi G2.)
  - Gata când: „IDNO 1003600012345” e mascat.

---

## B. Restaurare: rezultate stricate fără semnal

- [x] **B1 · P0 · E-mailul (sau IBAN-ul) e tăiat de termenii din vocabular** — *readus în plan pe 15.11.2026: lăsa restul adresei în clar, deci e scurgere, nu doar restaurare stricată*
  - Caz: E1 (`ion.Ion Popescu@Acme Logistic.md`); `ion.rusu@acme.md` pleca drept `ion.rusu@⟦COMPANY_1⟧.md`.
  - Corecție: în rezolvator, o potrivire care o conține complet pe alta câștigă indiferent de prioritate (e-mailul întreg devine `⟦EMAIL_n⟧`). `LITERAL` rămâne singura excepție.
  - Gata când: E1 restaurează exact `ion.popescu@acme.md`.
  - **Rezolvat:** `tests/overlaps.spec.ts` acoperă e-mail, IBAN, telefon, excepția `LITERAL` și o suprapunere parțială. Suita are 815 teste, toate trec. Viteza nu se schimbă (50.000 de cuvinte în ~0,33 s).

- [ ] **B2 · P1 · Simbol inserat în identificator, deci cod invalid** — *scos din plan, caz rar (decizie 2026-11-11)*
  - Cazuri: E2 (`self.Ion Popescu_id`), K5 (`bv_total` devine `BV_total`)
  - Corecție: `_` și cifrele contează drept caractere de cuvânt la verificarea granițelor; identificatorii sunt tratați de A3.
  - Gata când: E2 și K5 produc cod identic cu originalul după restaurare.

- [ ] **B3 · P1 · Variante de nume restaurate dublu**
  - Cazuri: X3, E5 („Popescu Ion” devine „Ion Popescu Ion”, „I. Popescu” devine „I. Ion Popescu”)
  - Corecție:
    1. generarea automată a variantelor inversate și cu inițială pentru numele de persoane;
    2. restaurarea folosește forma de bază a termenului, nu `restoreAs`, când textul din jur conține deja prenumele sau inițiala.
  - Gata când: X3 și E5 nu mai dublează prenumele.

- [ ] **B4 · P1 · Entități diferite contopite într-un singur simbol**
  - Cazuri: K1 („Maria Popescu” devine „Maria Ion Popescu”), K3 (cinematograful Orion = Proiectul Orion)
  - Corecție:
    1. un termen de un singur cuvânt (doar numele de familie) nu se aplică dacă e precedat de un prenume care nu aparține intrării (vezi A4);
    2. opțiunea „doar în context” pe termen: se maschează doar lângă cuvinte-cheie definite de utilizator, altfel avertisment.
  - Gata când: K1 păstrează două persoane distincte; K3 maschează doar proiectul (cu Orion setat „doar în context: proiect”).

- [ ] **B5 · P2 · Titlul dispare odată cu numele**
  - Cazuri: A1, G1 („dl. Popescu” devine „Ion Popescu”)
  - Corecție: titlurile (`dl.`, `dna`, `domnul`, `doamna`, `dr.`…) nu fac parte din termeni; rămân în text. Avertisment la compilare dacă un termen începe cu un titlu.
  - Gata când: A1 trimite „dl. `⟦PERSON_1⟧`” și răspunsul păstrează forma politicoasă.

- [ ] **B6 · P2 · Acordul gramatical după restaurare**
  - Cazuri: A4 („lui Maria Ceban”), F5 (genul necunoscut)
  - Corecție (opțională, configurabilă): atribut de gen în simbolul typed (`⟦PERSON_F_2⟧`), luat din vocabular sau din lista de prenume. Preambulul cere construcții analitice („lui/ei” + nume).
  - Gata când: A4 produce „Mariei Ceban” sau „ei Maria Ceban”, nu „lui Maria Ceban”.

- [ ] **B7 · P2 · Formatul original al unei valori se pierde**
  - Caz: H2 (al doilea telefon restaurat în formatul primului)
  - Corecție: aceleași valori scrise în formate diferite primesc același simbol (corect), dar restaurarea folosește forma canonică și nu pretinde că e forma originală. Alternativ, simboluri diferite pe formă, cu notă în preambul că reprezintă aceeași valoare.
  - Gata când: decizie luată și documentată; H2 rerulat.

- [ ] **B8 · P2 · Simboluri inventate de model rămân în răspuns**
  - Caz: H2 (`⟦PHONE_2⟧` apărut în textul final)
  - Corecție: simbolurile necunoscute sunt marcate vizual în interfață (sau înlocuite cu „[valoare necunoscută]”), iar raportul le semnalează.
  - Gata când: un simbol necunoscut nu mai apare brut în chat fără marcaj.

---

## C. Sarcini care cer valoarea reală

- [ ] **C1 · P1 · Operații locale pe valori protejate**
  - Cazuri: C2 (sortare), F1 (inițiale), F2 (număr de litere), F4 (construcție de e-mail), G3 (inversare), H4 (vârsta din IDNP), F3 (date din CNP)
  - Corecție: unelte puse la dispoziția modelului, de forma `sai_sort(simboluri, criteriu)`, `sai_initials(simbol)`, `sai_length(simbol)`, `sai_compose(șablon, simboluri)`, `sai_decode_id(simbol)`. Modelul le apelează cu simboluri; sAI le execută local, pe valorile reale, și întoarce rezultatul mascat sau sigur.
  - Gata când: C2, F1, F2 și G3 dau rezultate corecte în typed fără să trimită valoarea.

- [ ] **C2 · P2 · Meta-text absurd după restaurare**
  - Cazuri: F3, F6, J2, B4 („nu pot vedea cifrele din 1800101420010”)
  - Corecție: preambul revizuit („nu vorbi despre simboluri ca despre placeholder-e; dacă ai nevoie de valoarea reală, spune: «această operație necesită valoarea reală»”). În interfață, valorile restaurate sunt marcate discret.
  - Gata când: F3, F6 și J2 nu mai conțin fraze care se contrazic după restaurare.

- [ ] **C3 · P2 · Preambulul blochează transformări legitime**
  - Caz: J3 (refuză „litere mici”)
  - Corecție: preambulul permite explicit transformări de formă ale textului din jur, păstrând doar simbolurile neschimbate. Pentru majuscule sau minuscule pe valori: post-procesare locală (G2).
  - Gata când: J3 și G2 produc rezultatul cerut.

---

## D. Specific greek

- [ ] **D1 · P1 · Răspunsuri inventate pentru că literele sunt tratate ca litere**
  - Cazuri: C2 (sortare după litera grecească), F2, G3, G4
  - Corecție: regulă explicită în preambulul greek („literele nu sunt cuvinte: nu le sorta, nu le număra, nu le inversa; spune că operația cere valoarea reală”), plus C1.
  - Gata când: C2, F2, G3 și G4 refuză sau folosesc C1 în greek.

- [ ] **D2 · P1 · Clasa necunoscută strică raționamentul**
  - Cazuri: B1 (firma tratată ca persoană), G5
  - Corecție (de decis): (a) acceptată ca limită a strategiei; (b) legendă cu tipul fiecărei litere în preambul (de exemplu „α, β: persoane; γ: firmă”), care dezvăluie clasa, dar nu valoarea.
  - Gata când: decizie luată; dacă (b), B1 și G5 trec în greek.

- [ ] **D3 · P3 · Marcajul „suspect” e prea zgomotos**
  - Cazuri: A2, A4, F5 (`**π**`, litere în listă marcate suspecte)
  - Corecție: ignorarea caracterelor markdown (`*`, `_`, `` ` ``) și a punctuației la căutarea vecinilor matematici.
  - Gata când: A2, A4 și F5 nu mai au marcaje false; D1 și J5 le păstrează pe cele reale.

- [ ] **D4 · P3 · Decizia de produs: typed implicit, greek experimental**
  - Corecție: textul din pagina de setări explică diferența și riscul de eșec tăcut al greek.
  - Gata când: setările și documentația reflectă recomandarea.

---

## E. Instrumente de evaluare

- [x] **E1 · P1 · Detectorul independent de scurgeri din `run-eval.ts`**
  - Corecție: același potrivitor ca A1 și A2 (flexiuni, transliterare, identificatori). Raportează fiecare scurgere cu forma găsită.
  - Gata când: run1 rerulat cu verificatorul nou raportează exact scurgerile găsite manual.
  - **Rezolvat pentru flexiuni:**
    - scanerul caută termenii, formele generate și, ca `STEM?`, orice cuvânt cu rădăcina unui nume protejat;
    - pe textele din run1 găsește exact scurgerile manuale; pe run2 nu găsește niciuna.
    - Transliterarea și identificatorii vin odată cu A3 și A5.

- [ ] **E2 · P2 · Variantele fără preambul**
  - Corecție: rularea `typed-nopre` și `greek-nopre` în run2, ca să vedem cât contează preambulul.
  - Gata când: secțiune dedicată în RAPORT-run2.md.

- [ ] **E3 · P2 · Cazurile agent cu unelte (categoria L)**
  - Corecție: testare manuală în aplicația desktop: L1 (creare fișier), L2 (citire), L3 (redenumire), cu verificarea fișierelor de pe disc.
  - Gata când: rezultatele sunt notate în raport.

- [ ] **E4 · P3 · Contorul de restaurări numără și raționamentul**
  - Corecție: raport separat pentru text, raționament și argumentele uneltelor.
  - Gata când: numărul din raport corespunde simbolurilor din răspunsul vizibil.

- [ ] **E5 · P3 · Stabilitatea providerului**
  - Cazuri: B3, C2 (erori de conexiune, cerere blocată ~2 ore)
  - Corecție: timeout per cerere în `run-eval.ts` (de exemplu 3 minute) și reîncercare automată.
  - Gata când: o cerere blocată nu mai oprește rularea.

---

## F. Deja rezolvate

- [x] **Auditul canalelor de date din DSH** · imagini, mesaje developer, descrieri de unelte, unelte web/MCP, jurnalul trimis către DeepSeek, telemetria la feedback. Vezi [../docs/AUDIT-DSH.md](../docs/AUDIT-DSH.md).

- [x] **F1 · P0 · IBAN urmat de text, citit drept card, blochează cererea** (E3, I1, I2)
  - Rezolvat: forma IBAN-ului acceptă doar grupuri de câte 4 caractere și reîncearcă fără grupurile de la final; cifrele lipite de litere nu mai sunt considerate card, telefon sau IDNP. Teste adăugate (27/27).
- [x] **F2 · P2 · Răspunsuri goale din cauza limitei de tokeni** (A3, A4, B1, C2, F6, H4)
  - Rezolvat în rulare: limita a crescut de la 2.500 la 8.000 de tokeni pentru modelele care raționează mult.

---

## G. Decizii de produs

- [x] **G1 · Detectorul de nume din liste eliminat (15.11.2026)**
  - Motiv: listele aveau 725 de nume (406 prenume, 339 de nume de familie, RO/MD și EN) și prindeau doar numele frecvente. Un detector care lasă să treacă numele rare dă o siguranță falsă.
  - Regula de produs: sAI protejează garantat doar ce e declarat în vocabular (cu formele regulate) și identificatorii în formatele standard ale tiparelor activate. Persoanele nedeclarate ajung la model așa cum sunt scrise; pagina de setări spune asta explicit.
  - Schimbări în cod:
    - `NameDetector`, listele și setarea `names` au fost șterse;
    - părțile unui nume declarat se citesc după poziție (toate cuvintele, în afară de ultimul, sunt prenume);
    - la început de propoziție, un cuvânt se lipește de un nume protejat doar înaintea formei declarate, nu înaintea unei forme flexionate;
    - formulele de adresare (`stimate`, `dragă`, `dear`, `hello`…) au fost adăugate la titluri.
  - Teste: 808 trec; un test nou verifică explicit că persoanele nedeclarate trec neatinse.
  - Rezultatele vechi (run1–run4, run-en1–run-en4) au fost obținute cu detectorul activ și rămân ca istoric.

- [x] **G2 · Scorul de încredere, pragurile și acțiunea `warn` eliminate (15.11.2026)**
  - Motiv: după G1 nu mai schimbau nimic implicit. Tiparele treceau mereu pragul, iar formele deduse (un prenume singur, un nume scurt) erau înlocuite oricum. Setarea „sub prag → păstrează” și acțiunea `warn` trimiteau în clar, fără nicio confirmare, date pe care sAI le găsise.
  - Regula de produs: orice găsește sAI primește acțiunea clasei: înlocuire (implicit), mascare, ignorare (alegere explicită, de exemplu „nu ascunde e-mailurile”) sau blocare. Nimic nu depinde de un scor.
  - Schimbări în cod:
    - eliminate `confidence`, `minConfidence`, `warnHandling`, avertismentele din raport și verdictul `needs-confirmation`;
    - eliminate cuvintele-cheie din tipare;
    - un `warn` dintr-o configurație veche e citit ca înlocuire.
  - Mascările greșite sunt prevenite de regulile de majusculă și de lista de excepții, care rămân.
  - Teste: 817 trec. Testul de potriviri false dă aceleași rezultate ca înainte.

- [x] **G3 · Alternanțele din rădăcină și pluralul (15.11.2026)**
  - Problemă: un test pe 23 de forme dificile a arătat că scăpau forme gramatical corecte. „Contul Băncii Verzi” pleca integral în clar (verde → verzi), iar Florii (Floarea), Băncile și Grupurilor nu erau găsite.
  - Corecție:
    - alternanțele d → z, sc → șt, oa → o, ea → e dinaintea terminațiilor -i, -ii, -ile, -ilor, -e;
    - pluralul (-i, -ile, -ilor, -ele, -elor, -uri, -urile, -urilor), dar nu pentru prenumele găsite singure;
    - termenii din mai multe cuvinte se caută cuvânt cu cuvânt, fără limita veche de 96 de combinații pe termen.
  - Teste: `tests/alternations.spec.ts`; suita are 840 de teste, toate trec. Testul de potriviri false: în română o singură potrivire nouă („Bulgarii”, pluralul numelui de familie Bulgaru, cu majusculă); în engleză 695 de potriviri în loc de 703; niciun cuvânt scris cu literă mică.
  - Viteză: compilarea a 1.000 de intrări durează 25 ms (1,4 MB); un mesaj de 50 de cuvinte, 0,3–0,6 ms.
  - Se declară explicit (nu se generează): diminutivele (Ionel, Gheorghiță), derivatele (Ruseștilor), pluralele neregulate englezești (Wolves).

---

## Ordinea de lucru propusă

| Pas | Itemi | De ce |
|---|---|---|
| 1 | A1, A2, E1 | închid cea mai mare scurgere și ne dau un verificator care o prinde |
| 2 | B1, B2, A3 | e-mailuri și cod stricate |
| 3 | A4, B4, B3, B5 | nume și persoane contopite |
| 4 | A5, A6, A7 | scurgeri mai rare |
| 5 | C2, C3, D1, D3 | preambul și zgomot |
| 6 | C1 | operații locale (cel mai mare efort) |
| 7 | B6, B7, B8, D2, D4, E2–E5 | calitate, decizii, instrumente |
| 8 | run2 + RAPORT-run2.md | comparație cu run1 |

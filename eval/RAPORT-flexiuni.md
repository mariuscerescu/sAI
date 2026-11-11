# Formele flexionate: implementare și teste

> Item rezolvat: **A1** din [CHECKLIST.md](CHECKLIST.md). Cercetarea de fond este în [../docs/CERCETARE-FLEXIUNI.md](../docs/CERCETARE-FLEXIUNI.md).
> Datele folosite sunt fictive. Corpusul de test este format din articole Wikipedia în limba română.

## Ce s-a schimbat

- **Generator de forme** (`src/core/inflection.ts`). La compilarea vocabularului, fiecare cuvânt al unui termen primește formele românești:
  - `-u` → `-ul`, `-ului`, `-ule`;
  - consoană → `-ul`, `-ului`, `-ule`, `-ei`;
  - `-a` → `-ei`, `-ii`, `-ai`, `-e`, `-o`;
  - `-ea` → `-ei`, `-ii`;
  - `-e` → `-ei`, `-elui`.

  Cuvintele scurte, cifrele și cuvintele invariabile (`SRL`, `de`, `din`…) nu se flexionează. Sunt maximum 96 de forme pe termen.
- **Aceeași cheie, restaurare la forma de bază.** „Cebanei” primește simbolul lui „Ceban”, iar la restaurare se pune „Ceban”.
- **Căutare rapidă.** Termenii sunt indexați după primul cuvânt, deci textul se parcurge o singură dată, oricât de mare e vocabularul (2.513 forme în testul 2). Nu se adaugă latență măsurabilă.
- **Siguranțe:**
  1. *Colizii între intrări.* Dacă două intrări din aceeași clasă generează aceeași formă („Raileanului” vine și din „Railean”, și din „Răileanu”), câștigă termenul de bază mai lung. Forma rămâne mascată, cu avertisment. Dacă cele două intrări sunt din clase diferite, forma generată se abandonează.
  2. *Cuvinte obișnuite.* O formă generată dintr-un singur cuvânt primește încredere 0,6 în două situații:
     - forma e ea însăși un cuvânt obișnuit (de exemplu „lungul”);
     - cuvântul de bază e un cuvânt obișnuit (de exemplu „marin”, deci „marinei”).

     Politica implicită o **maschează în continuare**, dar o raportează ca incertă.

     *(Ulterior eliminată: vezi „Schimbare finală” mai jos.)* Lista de cuvinte obișnuite avea 11.871 de cuvinte (109 KB). E construită din alt text decât cel de test: jumătatea A a corpusului plus 52 de articole separate. Numără doar aparițiile scrise cu literă mică, ca numele de familie („Popescu”, „Radu”) să nu intre în listă.

## Test 1: acoperire (200 de forme scrise de mână)

- **Vocabularul de test:** 60 de persoane, 18 firme și 8 proiecte, cu nume tipice din Moldova și România. Formele au fost scrise independent de generator. Includ:
  - genitiv și dativ;
  - vocativ;
  - majuscule;
  - forme fără diacritice și cu ţ/ș vechi;
  - forme cu cratimă (`Acme-ului`);
  - forme compuse („Mariei Ceban”, „Băncii Verde”).
- **Rezultat: 200/200 găsite, fiecare cu simbolul intrării corecte.** Suita completă are 230 de teste și toate trec. Pe lângă formele scrise de mână, ea verifică:
  - coliziunea Railean/Răileanu;
  - restaurarea la forma de bază: „Raportul Cebanei a ajuns la Băncii Verde.” devine „Raportul Ceban a ajuns la Banca Verde.”;
  - tiparele (IBAN etc.).
- **Forme mascate cu avertisment:** 10 din 200. Toate sunt nume care sunt și cuvinte obișnuite:
  - Vrabie: Vrabiei;
  - Lungu: Lungul;
  - Lupu: Lupului;
  - Negru: Negrului, Negrul;
  - Marin: Marinului;
  - Florea: Florei;
  - Preda: Predei;
  - Albatros: Albatrosului.

  Avertismentul e corect aici: fără context, „lupului” poate fi animalul.

## Test 2: potriviri false (108.659 de cuvinte fără numele din vocabular)

- **Text:** jumătatea B a corpusului: 15 articole (Al Doilea Război Mondial, Primul Război Mondial, Marea Neagră, Revoluția din 1989, Ștefan cel Mare, Biserica Ortodoxă, economie, fotbal etc.). Acest text nu a fost folosit la construirea listei de cuvinte obișnuite.
- **Vocabular:** cel din testul 1 plus cel din evaluare.
- **Lista completă:** fiecare potrivire, cu contextul ei, este în [results/false-matches.md](results/false-matches.md). Scriptul este `scripts/false-match-test.ts`.

| Categorie | Potriviri | Verificare |
|---|---:|---|
| **Forme generate**, cuvinte obișnuite: „lungul” (de-a lungul) ×35, „marinei/Marinei” (flota) ×9, „negrul” (culoarea) ×1 | 45 | Toate au încredere **0,6**, deci sunt raportate. Înainte de siguranța pe cuvântul de bază, „marinei” și „negrul” treceau cu încredere 1. |
| **Forme generate**, nume reale ale altor persoane: „Radului Vodă”, „Stanciul” (meșter din sec. XV) | 2 | Sunt flexiuni corecte ale unor nume din vocabular, dar se referă la alte persoane. Încredere 1. Aceeași situație ca la potrivirile declarate de mai jos. |
| **Termeni declarați**, alte persoane cu același nume: Radu ×16, Ilie ×6, Marin ×6, Ionescu ×5, Munteanu ×4, Popescu, Grosu, Neagu, Stan, Rusu, Negru Vodă… | 78 | Nu e o problemă a flexiunilor: numele de familie declarat singur apare și la alte persoane. Exista și înainte. Este item-ul **B4** din checklist. |
| **Termeni declarați**, cuvinte obișnuite declarate ca nume: „negru” (la negru, sol negru) ×3, „marin” (adjectiv) ×3, „preda” (verb) ×1, „Nova” ×3, „Orion” (Brațul Orion) ×4 | 14 | Aceeași problemă (B4): ambiguitatea vine din vocabular, nu din generator. |

Câteva potriviri apar de două ori, pentru că Popescu, Lungu, Vrabie și Orion există și în vocabularul de test, și în cel de evaluare.

**Concluzie:**

- Generatorul **nu a introdus niciun cuvânt obișnuit mascat cu încredere 1**. Toate cele 45 de forme generate care sunt cuvinte obișnuite sunt semnalate.
- Nicio potrivire nu e în interiorul unui cuvânt: granițele de cuvânt funcționează.
- Costul este supramascarea: „de-a lungul” devine „de-a ⟦PERSON_n⟧” dacă „Lungu” e în vocabular. Textul ajunge totuși corect înapoi, pentru că restaurarea pune „Lungu”, nu „lungul”. Supramascarea e în favoarea siguranței; dacă deranjează, politica poate fi setată să nu mascheze potrivirile incerte.

## Test 3: rerularea A3, B1, B3, B4, F1 (typed și greek)

- **Rulare:** model `thinkingmachines/inkling-2-small:free`, 10 rulări, 14 mesaje trimise. Rezultatele sunt în `results/run2/`.
- **Scanerul de scurgeri din `run-eval.ts` (E1)** caută acum, independent de detector:
  - termenii;
  - toate formele generate;
  - orice cuvânt care începe cu rădăcina unui nume protejat (de exemplu `ceban…`, `popesc…`). Aceasta e o verificare grosieră, care nu depinde de generator.
- **Validarea scanerului:** rerulat pe textele trimise în run1, scanerul găsește exact scurgerile găsite manual atunci: „Popescului”, „Cebanei”, „Băncii Verde”, „Mariei”, în A3, B1, B3, B4 și F1. Verificarea pe rădăcină a semnalat și câteva cuvinte nevinovate („logistica”, „proiectului”), de verificat manual.

| Caz | run1: ce ajungea la model | run2: typed | run2: greek |
|---|---|---|---|
| A3 | „Contractul **Popescului** cu ⟦COMPANY_1⟧-ului … de **Cebanei**” | `Contractul ⟦PERSON_1⟧ cu ⟦COMPANY_1⟧-ului a fost semnat de ⟦PERSON_2⟧ la ⟦PROJECT_1⟧.` | `Contractul μ cu γ-ului a fost semnat de ι la θ.` |
| B1 | „raportează **Cebanei**” | `⟦PERSON_3⟧ și ⟦PERSON_4⟧ raportează ⟦PERSON_2⟧` | `θ și χ raportează ε` |
| B3 | „i-a împrumutat **Cebanei**” | `⟦PERSON_1⟧ i-a împrumutat ⟦PERSON_2⟧ 5.000 lei` | `ψ i-a împrumutat θ 5.000 lei` |
| B4 | „auditorul **Băncii Verde**” | `auditorul ⟦COMPANY_2⟧` (3 mesaje) | `auditorul δ` (3 mesaje) |
| F1 | „ale **Mariei** ⟦PERSON_2⟧” | `ale ⟦PERSON_2⟧` | `ale α` |

**Rezultat: zero scurgeri.** Am citit fiecare text trimis, inclusiv istoricul din B4. Scanerul automat confirmă: 0 mesaje cu scurgeri în run2, față de 10 în run1, pe aceleași cazuri.

**Calitatea răspunsurilor:**

- **Corecte în ambele strategii:** B1 (organigrama și răspunsul), B3 (tabelul de datorii), B4 (memoria pe trei mesaje).
  - Față de run1, B3 typed e mult mai bun: atunci modelul se întreba dacă „Cebana” e o persoană nouă.
  - Și B1 greek e corect acum, dar organigrama pune firma sub persoană (limita D2 rămâne).
- **Efectul cunoscut al restaurării la forma de bază:** acordul gramatical se pierde, de exemplu „auditorul Banca Verde”, „îi dă Ceban 500 lei”. A fost acceptat prin decizia „la restaurare se pune forma de bază”; ține de **B6**.
- **F1 (inițiale):** modelul spune corect că nu poate calcula inițialele din simboluri. E o sarcină care cere valoarea reală (**C1**). După restaurare, textul despre „placeholder” devine absurd (**C2**).

## Adăugire: vocativul

- **Reguli noi:**
  - prenume terminat în consoană + `-e` (Ștefan → Ștefane, Pavel → Pavele, Victor → Victore);
  - alternanța o → oa în ultima silabă (Ion → Ioane);
  - `-tru`/`-dru` → `-tre`/`-dre` (Petru → Petre, Dumitru → Dumitre, Alexandru → Alexandre);
  - `-ea` → `-eo` (Andreea → Andreeo).

  Vocativele deja acoperite: `-ule` (Popescule, Lungule) și `-a` → `-o` (Rodico, Tomo).
- **Limita de combinații a devenit mai sigură.** Termenii cu mai multe cuvinte generează întâi formele în care se schimbă un singur cuvânt, apoi pe cele cu două cuvinte schimbate. Dacă se atinge limita de 96, se pierd doar combinațiile cele mai improbabile. Înainte, ordinea era arbitrară și o formă reală ca „Xului Y Z” putea fi tăiată.
- **Test 1:** 33 de vocative noi, scrise de mână pentru 18 persoane cu prenumele declarat (Ștefane, Ioane, Petre, Dumitre, Bogdane, Pavele, Mihaile, Victore, Florine, Rodico, Eleno, Andreeo…). **Toate cele 263 de teste trec.**
- **Test 2:** „Petre” a apărut de 15 ori ca nume propriu al altor persoane (Petre Roman…). Acum o formă generată care este ea însăși un prenume sau nume de familie cunoscut primește încredere 0,6, deci e mascată cu avertisment. Celelalte forme noi de vocativ găsite în corpus sunt „marine” ×8, tot cu încredere 0,6.
- **Rămân cu încredere 1, din cauza vocabularului nou din fixture, nu a vocativului:**
  - „ciorbe”/„ciorbei” (din numele Ciorbă) și „grecul” (din Grecu). Sunt cuvinte obișnuite care lipsesc din lista de cuvinte comune; lista are nevoie de un corpus mai mare;
  - „Elenei” ×2, care se referă la altă persoană (B4).
- **Limită:** vocativul unui prenume e protejat doar dacă prenumele e declarat în vocabular, singur sau în numele complet. Un prenume nedeclarat ține de A4.

## Adăugire: prenumele și numele de familie găsite singure

**Regula decisă.** Dacă vocabularul conține „Ion Rusu”, se maschează independent și „Ion”, și „Rusu”, cu toate formele lor (Ioane, Rusului, Rusule). Utilizatorul nu mai trebuie să le declare separat.

| Situație | Comportament |
|---|---|
| Prenume singur („Ion”, „Ioane”) | mascat, cu avertisment (încredere 0,6), pentru că poate fi alt Ion |
| Nume de familie singur („Rusu”, „Rusului”) | mascat, fără avertisment; cu avertisment doar dacă e și cuvânt obișnuit sau prenume (Lupu, Radu) |
| Partea aparține unei singure persoane | același simbol ca persoana, ca modelul să știe că „Rusu” = „Ion Rusu” (B1 depinde de asta) |
| Partea aparține la două persoane (Ion Rusu și Ion Popescu) | simbol propriu, restaurat ca partea însăși („Ion”) |
| Două părți alăturate ale unor persoane diferite („Maria Popescu”, când există Maria Ceban și Ion Popescu) | o persoană nouă, cu simbol propriu; persoanele nu se contopesc |
| Ordine inversată a aceleiași persoane („Rusu Ion”) | recunoscută ca Ion Rusu |
| Companii și proiecte | nu se despart în cuvinte („Banca Verde” nu protejează „verde”) |

**Cuvinte obișnuite scrise cu literă mică.** Testul de potriviri false a arătat că prenumele care sunt și cuvinte obișnuite ar fi stricat textul. Exemple: „iulie” din Iulia (×65), „anii” din Ana (×31), „victorie” din Victoria, „stele” din Stela. La restaurare, „în iulie” ar fi devenit „în Iulia”.

Rezolvarea finală e regula majusculei, descrisă în secțiunea următoare.

**Restaurare.** Fiecare simbol are o singură formă de restaurare: prima formă apărută în conversație, sau „Restore as”, dacă e setat.
- Un mesaj care conține doar „Ioane” se restaurează „Ion”.
- Dacă în conversație a apărut întâi „Ion Rusu”, același simbol se restaurează „Ion Rusu”. E prețul pentru ca modelul să știe că e aceeași persoană.

**Teste:**
- Pe lângă cele vechi, s-au adăugat:
  - aceleași forme de persoană cu vocabularul declarat **doar prin nume complete**;
  - teste pentru prenumele și numele împărțite, persoanele care nu trebuie contopite, ordinea inversată, companiile și cuvintele scrise cu literă mică.
- **Evaluarea reală (run3):** A3, B1, B3, B4, F1, K1, K2 și I3, cu typed și greek.
  - Niciun nume declarat nu ajunge la model.
  - **K1 rezolvat:** „Maria Popescu” e acum o persoană separată de Ion Popescu, cu simbol propriu; în run1 era restaurată „Maria Ion Popescu”.
  - **„Floare” (K2, I3) trece în continuare.** Nu e declarat: vocabularul are doar numele de familie Munteanu. Este cealaltă jumătate a A4, prenumele **nedeclarat** de lângă un nume protejat.

## Schimbare finală: fără listă de cuvinte obișnuite, regula majusculei

**Decizie.** Nu folosim o listă de cuvinte obișnuite. Lista de 109 KB și scriptul care o construia au fost șterse. Un nume care e și cuvânt obișnuit, scris intenționat cu literă mică, nu e un caz pe care îl tratăm.

**Regula care o înlocuiește.** Formele formate dintr-un singur cuvânt și obținute automat se maschează **doar când încep cu majusculă**, pentru că așa se scriu numele în română. Regula se aplică:
- formelor flexionate (Popescului, Ioane, Lungul);
- părților de nume găsite singure (Ion, Rusu);
- formelor deja văzute în conversație.

**Nu se aplică:**
- spellings-urilor declarate exact de utilizator: „Popescu” declarat e găsit și ca „popescu”;
- formelor cu mai multe cuvinte („mariei ceban”, „băncii verde”).

**Excepție:** dacă textul nu are nicio majusculă (cineva care scrie totul cu literă mică), regula nu se aplică. Astfel „am vorbit cu ion si cu rusului” e mascat.

**Avertismente (încredere 0,6)** rămân pentru trei situații:
- prenumele găsit singur;
- formele care sunt ele însele un nume cunoscut („Petre”);
- formele pe care le generează două persoane.

**Rezultate:**
- **458 de teste trec.** Formele scrise de mână cu literă mică sunt testate într-o propoziție scrisă toată cu literă mică.
- **Testul 2:** 0 forme generate scrise cu literă mică („de-a lungul”, „în iulie”, „anii”, „victorie”, „ciorbe” nu mai sunt mascate).
  - Rămân 149 de potriviri generate cu avertisment, aproape toate prenume ale altor persoane (Maria, Constantin, Mihai, Vasile…).
  - Rămân 14 fără avertisment, toate scrise cu majusculă: „Marinei” ×7 și „Marine” ×2 (din „Marinei Germane”, „Marinei Regale”), „Elenei” ×2 (altă Elena), „Ciorbe” ×1, „Radului” (Vodă) ×1, „Stanciul” ×1.
  - Toate sunt mascare în plus, nu scurgeri.

## Ce rămâne deschis

- **Prenume nedeclarat lângă un nume protejat:** „Floare” din „Floare Munteanu”, când vocabularul are doar „Munteanu” (A4).
- **A2 (verificatorul din nucleu):**
  - partea de flexiuni e acoperită, pentru că verificatorul folosește același detector;
  - potrivirea aproximativă („Popesku”) a fost scoasă din plan, la cererea ta.
- **Regenerare:**
  - `scripts/false-match-test.ts` reface testul 2;
  - `run-eval.ts --cases A3,B1,B3,B4,F1 --variants typed,greek --max-tokens 8000` reface testul 3.

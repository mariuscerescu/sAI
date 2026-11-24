# Setul de test înghețat în engleză: reguli

> Versiune: 1 · Fixat la: 2026-11-23, înainte de orice rulare a modelului pe acest set.
> Scop: decizia dacă prima versiune a sAI (doar engleză, utilizator obișnuit) poate intra în producție și în ce mod al verificatorului.

## 1. Ce măsoară

Pentru mesaje întregi, în engleză, setul verifică două lucruri:
- fiecare nume din vocabular e mascat;
- cuvintele obișnuite identice cu forme din vocabular rămân nemascate.

Tentativele deliberate de a păcăli sistemul nu fac parte din scop. Instrucțiunile naturale din prompturi fac parte din el („keep all names unchanged”, „all names are fictional”).

## 2. Sursele

| Sursă | Conținut | Etichete |
|---|---|---|
| **Nemotron-PII, partea `train`** | documente sintetice din 30 de domenii, structurate și nestructurate | intervalele etichetate `first_name`, `last_name`, `company_name` |
| **Prompturi naturale** | șabloane scrise de mână: rescriere, rezumat, note de ședință, contracte, tabele, cod și loguri, chat cu litere mici, instrucțiuni | exacte, din construcție |

Partea `test` din Nemotron a fost folosită în evaluările anterioare și e exclusă. Toate datele sunt sintetice sau inventate. Textele Nemotron stau în afara repo-ului (`sai-model-bench/data/frozen-en`).

## 3. Cum se construiește un caz

- **Vocabularul** conține numele din mesaj, declarate cum le-ar scrie un utilizator: nume complet, sau firma așa cum apare.
- **Cuvinte-capcană:** vocabularul mai primește până la trei nume inventate care se ciocnesc cu cuvinte obișnuite din mesaj (de exemplu „Anna Price”, când mesajul conține „price”).
- **Verificări pozitive:** fiecare nume etichetat trebuie mascat.
- **Verificări negative:** cuvântul-capcană e așteptat nemascat dacă nu se suprapune cu nicio dată etichetată și e scris cu literă mică sau la început de propoziție ori de rând.
- **Exclus din verificări:** un cuvânt-capcană cu majusculă în mijlocul propoziției sau după `Câmp:`, o marcă scrisă cu majusculă (`Ford`, `Visa`) și un cuvânt de după un titlu (`Dr. Smith`), pentru că acestea pot fi nume proprii neetichetate.
- **Nume dificile:** setul are o țintă separată pentru numele dintr-un cuvânt care sunt și cuvinte obișnuite (Mark, Grace, Price). Acestea testează cu adevărat modelul.
- **Chat:** o cincime din documentele nestructurate sunt trecute integral în litere mici.

**Limită cunoscută, în afara setului:** identificatorii `camelCase` (`AcmeClient`, `billTurner`) nu sunt detectați de sAI.

## 4. Împărțirea

Împărțirea se face determinist, după hash, înainte de orice rulare:

| Parte | Pondere | Folosire |
|---|---|---|
| **Calibrare** | 30% | alegerea pragului, analiza greșelilor, corecții |
| **Finală** | 60% | **o singură rulare**, pe codul neschimbat, la sfârșit |
| **Rezervă** | 10% | verificarea unei eventuale reparații după rularea finală |

Documentele și familiile de șabloane nu se împart între părți. Nimeni nu citește conținutul părților finală și rezervă înainte de rularea lor; se folosesc doar totaluri.

## 5. Criteriile (fixate înainte de rulare)

| Criteriu | Țintă |
|---|---|
| Nume scăpate | **0** din cel puțin **3.000** de nume dintr-un cuvânt în partea finală (rata reală sub ~0,1%, la 95%) |
| Cuvinte obișnuite mascate inutil | cel mult **2%** |
| Timp adăugat la un mesaj obișnuit | p95 sub **1 secundă** pe placa video |
| Test cap-coadă | nicio valoare din vocabular nu ajunge la furnizor |

**Alegerea modului:** se rulează pe aceleași date `lowercase` și `all`. Prima versiune folosește `all` dacă atinge toate țintele; altfel rămâne la `lowercase`.

## 6. Ordinea

1. Construirea și înghețarea setului (`manifest.json` ține hash-ul fiecărei părți).
2. Recalibrarea pragului, doar pe partea de calibrare.
3. Măsurarea și corectarea vitezei.
4. Testul cap-coadă.
5. Rularea unică a părții finale.

## 7. Regula pentru etichete

Etichetele părții finale nu se schimbă după rulare. Dacă o greșeală pare o etichetă greșită, raportul dă **două cifre**: rezultatul brut și rezultatul după arbitraj, cu fiecare caz arbitrat listat. Decizia se ia pe rezultatul brut, dacă arbitrajul nu e justificat caz cu caz.

Dacă partea finală găsește o problemă și codul se schimbă, repararea se verifică pe partea de rezervă, iar raportul spune clar că partea finală a fost deja folosită.

## 8. Regula de calibrare (fixată înainte de prima rulare a modelului)

Se folosește **doar partea de calibrare**. Pentru fiecare mod (`lowercase`, `all`) se evaluează pragurile 0,005 · 0,01 · 0,02 · 0,03 · 0,05 · 0,075 · 0,1 · 0,15 · 0,2 · 0,25 · 0,3 · 0,4 · 0,5 · 0,6 · 0,7 · 0,8 · 0,9.

1. Un prag e **admis** dacă dă **0 nume scăpate** și **cel mult 1,5%** cuvinte obișnuite mascate. Marja față de ținta de 2% acoperă diferența dintre calibrare și partea finală.
2. Dintre pragurile admise se alege **cel mai mic**: la egalitate de criterii, protecția numelor are prioritate.
3. Dacă niciun prag nu e admis, nu se alege niciunul. Greșelile se analizează pe partea de calibrare, se corectează cauza și se reia evaluarea.

## 9. Completări după prima rulare pe calibrare (2026-11-23)

Aceste două precizări au fost scrise **după** ce am văzut rezultatele de pe calibrare. Criteriile din secțiunile 5 și 8 nu s-au schimbat.

1. **Mesaj blocat.** Un mesaj blocat nu trimite nimic la furnizor, deci verificările lui nu sunt nici scăpări, nici mascări inutile. Numărul mesajelor blocate se raportează separat, la fiecare rulare.
2. **Etichete revizuite.** Pe calibrare, 5 etichete din sursă sunt tratate ca greșite, fiecare listată cu motivul în `calibration-label-review.json`. Scăpările pe ele se raportează separat. Lista nu se aplică părților finală și de rezervă, unde rămâne regula din secțiunea 7.
3. **Excepție aprobată de utilizator.** Niciun prag nu a respectat regula din secțiunea 8. Se folosesc pragul **0,2**, modul `all` și formularea cu „ordinary dictionary word with its usual meaning”, cu 0 nume scăpate și 1,58% cuvinte mascate pe calibrare, peste marja de 1,5%. Țintele din secțiunea 5 pentru partea finală rămân neschimbate.

## 10. Regula pentru viteză (fixată înainte de măsurare, 2026-11-23)

- **Date:** toate mesajele din partea de calibrare (cel mult 1.800 de caractere), unul câte unul, cu un singur apel la model per mesaj, ca în plugin.
- **Timp adăugat:** timpul de procesare cu verificatorul pornit minus timpul aceluiași mesaj cu verificatorul oprit. Include pregătirea întrebărilor, apelul la serviciul local și aplicarea răspunsurilor.
- **Criteriu:** **p95 sub 1 secundă**, calculat **doar pe mesajele care fac un apel la model**. Mesajele fără apel ar îmbunătăți artificial cifra, așa că se raportează separat.
- **Condiții:** placa video a calculatorului, modelul deja încărcat, primele 20 de mesaje nu se numără. Se raportează utilizarea plăcii video în timpul măsurării.
- **Texte lungi:** articolele Wikipedia nu fac parte din criteriu, dar timpul lor se raportează separat.
- **Dacă ținta nu este atinsă (fixat înainte de test):** se încearcă un context mai scurt în jurul cuvântului, 200 și apoi 150 de caractere pe fiecare parte, față de 300 acum. O variantă este acceptabilă doar dacă, la pragul 0,2 pe calibrare, are **0 nume scăpate** și **cel mult 23 de cuvinte mascate**, adică nu este mai slabă decât varianta actuală, și dacă atinge ținta de viteză. Se alege cel mai lung context acceptabil.
- **Apelurile la model în rularea finală:** exact un apel pentru fiecare mesaj, ca în plugin. Scorul aceleiași întrebări variază puțin după lotul în care este trimisă (până la 0,035 pe calibrare), deci loturile mixte nu reprezintă producția.

## 11. Regula testului cap-coadă (fixată înainte de rulare, 2026-11-23)

Testul folosește **pluginul real**, serviciul real de verificare, modul `all`, pragul 0,2 și un **furnizor local fals**, care înregistrează exact ce ar primi furnizorul. Nu se trimite nimic în afara calculatorului. Datele sunt fictive sau sintetice. Partea finală și cea de rezervă nu se folosesc.

**A. Scenarii scrise de mână.** Trebuie să treacă toate:
1. Niciun nume din vocabular nu apare în vreun câmp trimis: instrucțiuni de sistem, mesaje, raționament, argumente și rezultate de unelte, descrieri și scheme de unelte, istoric de unelte, nume de fișiere.
2. O cerere face cel mult un apel la verificator, iar aceeași cerere repetată nu face niciun apel nou.
3. În conversații, aceeași formă scrisă a unui nume primește același simbol în fiecare tură, iar o altă formă a aceluiași nume primește un simbol înrudit (precizat după repararea restaurării, 2026-11-23).
4. Răspunsul furnizorului este restaurat corect, chiar dacă simbolurile sunt tăiate între bucăți. Argumentele uneltelor externe își păstrează simbolurile.
5. Un mesaj blocat nu ajunge la furnizor.
6. Dacă verificatorul este oprit, răspunde cu eroare sau depășește timpul, cuvintele întrebate sunt mascate.
7. Cu verificatorul dezactivat din setări, rezultatul este identic cu cel de dinainte.

**B. Toate mesajele părții de calibrare prin plugin.** Trebuie îndeplinite toate:
1. Textul primit de furnizor este identic cu redactarea directă, cu aceleași răspunsuri ale modelului.
2. **0 nume scăpate**, cu cele 5 etichete revizuite raportate separat.
3. Fiecare mesaj face cel mult un apel la verificator.
4. Mesajele blocate nu ajung la furnizor.
5. Niciun simbol nu rămâne în răspunsul restaurat.

**Completare după repararea restaurării (2026-11-23).** Fiecare formă scrisă a unui nume are acum propriul simbol, legat de aceeași persoană sau firmă. Excepție aprobată de utilizator: simbolurile trimise se schimbă și cu verificatorul oprit, dar ce se maschează rămâne la fel. Formele flexionare revin în forma declarată, ca înainte.

## 12. Rularea finală (fixată înainte de rulare, 2026-11-24)

**Cum se rulează.** Partea finală se folosește o singură dată, cu pluginul construit, serviciul real de verificare, pragul 0,2, contextul de 300 de caractere și un furnizor local fals. Se rulează modurile `all` și `lowercase`, cu exact un apel la verificator pentru fiecare mesaj.

**Protecția rulării.**
- Scriptul înregistrează o amprentă a codului și refuză să continue dacă și-a schimbat codul.
- După ce raportul final există, scriptul refuză o a doua rulare.
- Dacă serviciul cade, mesajul întrerupt nu se numără. Rularea continuă de la el, fără să refacă mesajele deja numărate.

**Criterii pentru modul `all`.**

| Criteriu | Țintă |
|---|---|
| Nume scăpate | **0**, din cel puțin 3.000 de nume dintr-un cuvânt |
| Cuvinte obișnuite mascate inutil | cel mult **2%** |
| Text trimis diferit de redactarea directă | 0 |
| Mesaje blocate ajunse la furnizor | 0 |
| Mesaje cu mai mult de un apel la verificator | 0 |
| Simboluri rămase în răspuns | 0 |

**Viteza** se raportează separat. Utilizatorul a acceptat pe 2026-11-23 aproximativ 1 secundă pe acest laptop, deși ținta de sub 1 secundă a fost ratată cu 26 ms pe calibrare.

**Decizie.** Se dau două cifre, brută și după arbitraj, conform secțiunii 7. Dacă `all` trece, el este modul primei versiuni. Dacă nu trece, nu se schimbă nimic pe baza părții finale: rezultatul se raportează, iar decizia aparține utilizatorului. O eventuală reparație se verifică pe partea de rezervă.

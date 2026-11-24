# Testul cap-coadă pe setul înghețat în engleză

> Data: 2026-11-23 · Regula: `eval/frozen-en/SPEC.md`, secțiunea 11 · Configurație: pluginul real, serviciul real de verificare, modul `all`, pragul 0,2.
> Furnizorul este unul local, fals, care înregistrează ce ar primi un furnizor real și repetă exact simbolurile. Nimic nu a ieșit din calculator. Părțile finală și de rezervă nu au fost deschise.

## Rezultat

**Testul trece toate criteriile fixate: niciun nume din vocabular nu ajunge la furnizor, iar răspunsurile revin corect.**

Prima rulare a găsit un defect de restaurare, prezent din primul prototip. L-am reparat și am repetat tot testul. Cifrele de mai jos sunt după reparație.

**Verificat ulterior cu un model real**, pe date fictive: vezi [RAPORT-verificator-real.md](../RAPORT-verificator-real.md).

## A. Scenarii scrise de mână: 8 din 8

| Scenariu | Rezultat |
|---|---|
| Toate câmpurile unei cereri: sistem, mesaje, raționament, unelte, scheme, istoric, nume de fișier | trece |
| O conversație își păstrează simbolurile | trece |
| Același cuvânt ca nume și ca termen obișnuit | trece |
| Răspunsul este restaurat, inclusiv uneltele și simbolurile tăiate între bucăți | trece |
| Un mesaj blocat nu ajunge la furnizor | trece |
| Verificatorul nu rulează | trece, cuvintele sunt mascate |
| Verificatorul este prea lent | trece, cuvintele sunt mascate |
| Verificatorul este oprit din setări | trece, aceleași cuvinte sunt mascate |

## B. Toate mesajele părții de calibrare prin plugin

| Criteriu | Rezultat |
|---|---|
| Mesaje trimise / blocate | 2.066 / 17 |
| Mesaje blocate ajunse la furnizor | **0** |
| Text diferit de redactarea directă | **0** |
| Nume scăpate | **0 din 5.739** |
| Etichete revizuite, raportate separat | 5 |
| Cuvinte obișnuite mascate | 23 din 1.456 (1,58%) |
| Mesaje cu mai mult de un apel la verificator | **0** |
| Răspunsuri cu simboluri rămase | **0** |
| Răspunsuri identice cu originalul | **2.065 din 2.066** |
| Erori | **0** |

## Repararea restaurării

Înainte, o persoană avea un singur simbol, restaurat în prima formă întâlnită. Acum fiecare formă scrisă are propriul simbol, legat de aceeași persoană sau firmă:

```text
Original:    Nadia called, and then Vantoor replied.
Trimis:      ⟦PERSON_1⟧ called, and then ⟦PERSON_1_2⟧ replied.
Restaurat:   Nadia called, and then Vantoor replied.
```

| Măsură, dacă modelul repetă toate simbolurile exact | Înainte | După |
|---|---|---|
| Mesaje care revin diferit | 444 din 2.066 (21,5%) | **1 din 2.066** |
| Înlocuiri care revin identic | 5.868 din 6.732 | **6.731 din 6.732** |
| Altă parte a aceluiași nume (Silva → Enzo) | 74 | **0** |

Diferența rămasă este „shorts”, un cuvânt obișnuit mascat inutil ca formă a numelui „Short”, care revine ca „Short”. Formele flexionare revin intenționat în forma declarată.

Ce se maschează nu s-a schimbat: pe calibrare rămân 0 nume scăpate și 23 de cuvinte mascate inutil. Valorile găsite prin tipare, de exemplu un IBAN scris în două feluri, păstrează un singur simbol.

**Excepție aprobată de utilizator:** simbolurile trimise se schimbă și cu verificatorul oprit, dar cuvintele mascate rămân aceleași.

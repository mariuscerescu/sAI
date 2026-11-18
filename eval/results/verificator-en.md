# sAI azi și sAI cu verificatorul (Decider-Flash v1.3), în engleză

Aceleași date trec prin motorul sAI real de două ori: o dată ca azi (verificator oprit), o dată cu verificatorul pornit (Decider-Flash v1.3, 4-bit, pe placa video, prag 0,2: cuvântul e mascat dacă modelul îi dă cel puțin 20% să fie nume). Fiecare mesaj face cel mult un apel către model, cu toate întrebările lui.

## Pe scurt: trei versiuni comparate

- **Azi:** fără verificator.
- **Prima versiune:** verificatorul doar adaugă măști; întreabă numai despre cuvintele scrise cu literă mică pe care azi le-am lăsa nemascate.
- **Versiunea B (actuală):** verificatorul primește toate cuvintele scrise cu literă mică care sunt bucăți din nume din vocabular, inclusiv pe cele pe care regulile le-ar masca azi doar pentru că textul nu are niciun nume cu majusculă. Cuvintele scrise cu majusculă rămân mascate ca azi și nu ajung la model.

| Pe setul de 822 de cazuri | Azi | Prima versiune | Versiunea B |
|---|---|---|---|
| Nume scăpate (din 420) | 164 | 0 | **0** |
| Cuvinte obișnuite mascate (din 402) | 177 | 178 | **31** |
| Mesaje care au apelat modelul | — | 399 | 572 |

Din cele 31 de cuvinte obișnuite încă mascate:
- **29 sunt scrise cu majusculă.** Versiunea B le lasă mascate intenționat.
- **2 sunt scrise cu literă mică:** „park” (pentru Anna Park) și „zoom” (pentru Zoom Inc.). La amândouă modelul a fost nesigur, deci cuvântul a fost mascat.

Pe Wikipedia și în conversațiile de evaluare, nicio versiune nu a schimbat vreo mască.

Tabelele de mai jos sunt pentru versiunea B.

## 1. Setul verificatorului (824 de cazuri, etichete revizuite)

Fiecare propoziție e un mesaj separat, cu vocabularul format doar din numele din cazul respectiv. Se verifică dacă cuvântul din caz e mascat. Cazuri: 822 (420 nume, 402 cuvinte obișnuite).

| Sursă | Nume | Cuvinte obișnuite | Nume scăpate: azi | Nume scăpate: cu verificator | Cuvinte obișnuite mascate: azi | Cuvinte obișnuite mascate: cu verificator |
|---|---|---|---|---|---|---|
| **Total** | 420 | 402 | 164 | **0** | 177 | **31** |
| hand | 38 | 49 | 11 | **0** | 42 | **28** |
| nemo-lower | 169 | 0 | 152 | **0** | 0 | **0** |
| nemo-neg | 4 | 146 | 1 | **0** | 59 | **1** |
| nemo-plain | 40 | 0 | 0 | **0** | 0 | **0** |
| nemo-pos | 169 | 1 | 0 | **0** | 1 | **1** |
| wiki-neg | 0 | 206 | 0 | **0** | 75 | **1** |

Apeluri către model: 572 din 822 mesaje (celelalte nu aveau niciun cuvânt neconfirmat), 605 întrebări; durata unui apel: mediană 137 ms, p95 166 ms; apeluri eșuate: 0.

Ce s-a schimbat față de azi:

- obișnuit mascat → nemascat: 147
- nume nemascat → mascat: 164
- obișnuit nemascat → mascat: 1

## 2. Wikipedia în engleză (texte care nu vorbesc despre persoanele din vocabular)

29 articole, 254062 de cuvinte; vocabularul: cele 53 intrări englezești din teste, declarate cu numele complet. Fiecare articol e un mesaj.

| | Azi | Cu verificator |
|---|---|---|
| Cuvinte mascate (azi toate cu majusculă: „John”, „King”…) | 619 | 619 |
| Cuvinte scrise cu literă mică mascate în plus față de azi | — | **0** |
| Cuvinte trimise ca atare pentru că modelul le-a numit obișnuite | — | 99 |

Întrebări puse modelului: 101, în 20 apeluri (câte unul pe articol care avea întrebări); durata unui apel: mediană 551 ms, p95 2052 ms; apeluri eșuate: 0.

Verificatorul nu a mascat niciun cuvânt scris cu literă mică.

## 3. Conversațiile de evaluare (eval/cases-en.json, date fictive)

20 cazuri, 22 mesaje. Apeluri către model: 2, 7 întrebări; apeluri eșuate: 0. Mesaje al căror text trimis s-a schimbat: 0.


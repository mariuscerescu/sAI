# Calibrarea pragului pe setul înghețat în engleză

> Data: 2026-11-23 · Partea folosită: **doar calibrarea** (2.083 de mesaje) · Reguli: `eval/frozen-en/SPEC.md`, secțiunile 8 și 9.
> Părțile finală și de rezervă nu au fost deschise și nu au fost rulate.

## Rezultat

**Niciun prag nu respectă regula fixată înainte de rulare** (0 nume scăpate și cel mult 1,5% cuvinte obișnuite mascate). Cel mai aproape este **pragul 0,2 în modul `all`**: 0 nume scăpate și 1,58% cuvinte mascate, adică 23 de cuvinte, cu 2 peste cele 21 permise.

**Decizia utilizatorului (2026-11-23):** se păstrează pragul 0,2 și se adoptă formularea care cere „ordinary dictionary word with its usual meaning”. Depășirea marjei de 1,5% este o excepție notată în `SPEC.md`. Țintele rulării finale nu se schimbă: 0 nume scăpate și cel mult 2% cuvinte mascate.

| Mod, prag 0,2, formularea adoptată | Nume scăpate | Cuvinte obișnuite mascate |
|---|---|---|
| Verificator oprit | 173 din 5.739 | 394 din 1.456 (27,06%) |
| `lowercase` | 0 | 280 din 1.456 (19,23%) |
| **`all`** | **0** | **23 din 1.456 (1,58%)** |

Modul `lowercase` nu poate atinge ținta de 2%: 265 dintre cuvintele mascate sunt scrise cu majusculă, iar acest mod nu le trimite la model. Rămâne candidat doar `all`.

Intervalul de încredere de 95% pentru 1,58% este **1,05%–2,36%**, deci rularea finală ar putea depăși ținta de 2%. Dintre cele 23 de cuvinte, 7 sunt „visa”, din aceeași formulare („visa biometric data record”).

Pragurile vecine în modul `all`, cu formularea adoptată:

| Prag | Nume scăpate | Cuvinte mascate |
|---|---|---|
| 0,15 | 0 | 29 (1,99%) |
| **0,2** | **0** | **23 (1,58%)** |
| 0,25 | 1 | 15 (1,03%) |
| 0,3 | 1 | 14 (0,96%) |

## Ce a arătat prima rulare

Prima rulare, cu formularea anterioară, a numărat **54 de scăpări** în modul `all`, la pragul 0,2:

| Număr | Cauză | Ce s-a făcut |
|---|---|---|
| 37 | Eroare de măsurare: 17 mesaje cu numere de card sunt blocate corect și nu trimit nimic | Mesajele blocate se numără separat |
| 11 | Prenume și nume de două litere (Jo, Ly, Bo, Su, Le, Oi), pe care sAI nu le căuta | **Reparat**: cu verificatorul pornit, merg la model |
| 1 | „Price” într-un rând de tabel, fără antetul coloanei în context | **Reparat**: întrebarea numește coloana |
| 5 | Etichete greșite în sursă („First Name”, „Recipient”, „Viewer 1”) | Revizuite una câte una, raportate separat |

Cu verificatorul oprit, sAI se comportă ca înainte.

## Compararea formulărilor

Am măsurat pe calibrare trei formulări generale. Niciuna nu respectă regula la un prag din grilă.

| Formulare | Rezultat la 0,2 | Cel mai bun prag cu 0 scăpări | Prag imediat următor |
|---|---|---|---|
| Anterioară | 0 scăpări, 23 mascate (1,58%) | 0,2 | 0,25: 2 scăpări, 20 mascate |
| **„ordinary dictionary word with its usual meaning” (adoptată)** | **0 scăpări, 23 mascate (1,58%)** | **0,2** | **0,25: 1 scăpare, 15 mascate (1,03%)** |
| Fără exemplul din vocabular | 5 scăpări, 32 mascate | 0,075: 78 mascate (5,36%) | 0,1: 2 scăpări, 58 mascate |
| „one specific person…” | 20 scăpări, 4 mascate | 0,02: 107 mascate (7,35%) | 0,03: 2 scăpări, 48 mascate |

Formularea adoptată ține numele mai departe de prag. Cele mai mici trei scoruri ale numelor reale sunt 0,245, 0,407 și 0,615 în loturi mixte, față de 0,228, 0,236 și 0,320 cu formularea anterioară. La pragul 0,2 nu reduce mascările.

Pragul 0,25 ar reduce mascările la 1,03%, dar scapă „hope” din „i talked to halvorsen and hope today”. Scorul aceleiași întrebări poate varia cu până la 0,035 în funcție de lotul în care este trimisă, deci un prag ales între 0,2 și 0,245 ar lăsa numele fără marjă reală.

Pe seturile vechi, formularea adoptată nu strică nimic:

| Mod `all` | Anterioară | Adoptată |
|---|---|---|
| Setul de 822: nume scăpate | 0 din 420 | 0 din 420 |
| Setul de 822: cuvinte mascate | 7 din 402 | 6 din 402 |
| Setul extins: corecte | 63 din 73 | 63 din 73 |
| Conversații modificate | 0 | 0 |
| Wikipedia (29 de articole): mascări | 597 | 594 |

Wikipedia nu are etichete, așa că am citit fiecare diferență. Din 785 de întrebări, 6 își schimbă răspunsul și toate devin nemascate: „King” ca titlu (3), „green” ca adjectiv (2) și „Mary” din numele clădirii „30 St Mary Axe” (1). Niciuna nu este persoana din vocabular. Cazul „Mary” este totuși un nume de loc, deci este o decizie la limită.

## Verificare cu un apel pe mesaj, ca în plugin

Calibrarea de mai sus a trimis întrebările în loturi mixte. Scorul aceleiași întrebări depinde puțin de lot: diferența mediană este 0, iar cea maximă 0,035. Am repetat calibrarea cu exact un apel pe mesaj, ca în plugin:

| Prag, modul `all` | Nume scăpate | Cuvinte mascate |
|---|---|---|
| 0,15 | 0 | 29 (1,99%) |
| **0,2 (actual)** | **0** | **23 (1,58%)** |
| 0,25 | 0 | 16 (1,10%) |
| 0,3 | 1 | 14 (0,96%) |

În această măsurare, **pragul 0,25 respectă regula din secțiunea 8**. Numele cel mai apropiat de prag este „hope”, cu scorul 0,262 aici și 0,245 în loturile mixte. La pragul 0,25 marja lui este de doar 0,012, mai mică decât variația de 0,035 dintre loturi, deci același nume poate scăpa. La pragul 0,2 marja este 0,062.

**Pragul rămâne 0,2 până la decizia utilizatorului.**

## Limite

- Reparațiile, alegerea formulării și revizuirea etichetelor s-au făcut după ce am văzut greșelile de pe calibrare, deci aceste cifre sunt optimiste. Doar rularea finală dă o măsură independentă.
- Un nume de două litere identic cu un cuvânt uzual și scris cu literă mică („do” pentru Do Tran) nu este trimis la model și rămâne nemascat.
- Cifrele de mascare se referă la cuvinte-capcană alese intenționat dificile, nu la toate cuvintele obișnuite dintr-un mesaj.

Totalurile pe fiecare prag sunt în `frozen-calibration.json`.

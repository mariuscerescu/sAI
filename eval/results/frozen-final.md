# Rularea finală pe setul înghețat în engleză

> Data: 2026-11-24 · Regula: `eval/frozen-en/SPEC.md`, secțiunile 5, 7 și 12 · Rulată o singură dată, pe cod blocat prin amprentă.
> Configurație: pluginul construit, serviciul real de verificare, pragul 0,2, contextul de 300 de caractere, un apel pe mesaj și un furnizor local fals. Datele sunt sintetice sau fictive.

## Verdict

**Niciun mod nu îndeplinește toate criteriile fixate. Prima versiune nu poate fi declarată gata pe baza acestei rulări.**

Modul `all` ratează un singur criteriu, cel mai important: **4 nume reale au scăpat din 5.445**, adică 0,073% (interval de 95%: 0,029%–0,189%). Ținta era 0.

| Criteriu | Țintă | `all` | `lowercase` |
|---|---|---|---|
| Nume scăpate, brut | 0 | **10** din 5.451 | 3 din 5.451 |
| Nume scăpate, după arbitraj | 0 | **4** din 5.445 | 2 din 5.450 |
| Cuvinte obișnuite mascate inutil | cel mult 2% | **1,62%** (40 din 2.462) | 16,90% (416 din 2.462) |
| Text trimis diferit de redactarea directă | 0 | 0 | 0 |
| Mesaje blocate ajunse la furnizor | 0 din 32 | 0 | 0 |
| Mesaje cu mai mult de un apel | 0 | 0 | 0 |
| Simboluri rămase în răspuns | 0 | 0 | 0 |
| Timpul apelului la verificator, p95 | sub 1 s | 862 ms | 686 ms |
| Răspunsuri identice cu originalul | informativ | 3.764 din 3.767 | 3.764 din 3.767 |

Intervalul de 95% pentru mascările inutile în modul `all` este 1,20%–2,20%. Timpul este cel al apelului la serviciu, cu placa video liberă. Măsurarea completă a timpului adăugat este în `frozen-speed.md`.

## Cele 10 scăpări brute din modul `all`

Am citit fiecare caz. Lista este în `eval/frozen-en/final-label-arbitration.json`. Etichetele părții finale nu au fost schimbate.

| Cazuri | Decizie | Ce este |
|---|---|---|
| 2 | **Scăpare reală** | Prenume scris cu literă mică, ca destinatar: „write a text to art” |
| 1 | **Scăpare reală** | Nume de familie imediat după un titlu de politețe |
| 1 | **Scăpare reală** | Prenumele unei persoane, folosit într-o adresare directă |
| 6 | Etichetă greșită în sursă | Cuvinte obișnuite marcate ca nume: etichete de câmp, un titlu de secțiune și cuvântul generic „company” |

Două dintre cele patru scăpări reale sunt nume cu majusculă. Ele apar doar în `all`, pentru că acest mod lasă modelul să decidă și pentru numele cu majusculă.

## Ce înseamnă

- `all` este mult mai precis decât `lowercase`, dar lasă să treacă mai multe nume reale: 4 față de 2.
- `lowercase` ratează clar ținta de mascări inutile, deci nu este o variantă de rezervă bună.
- Partea finală a fost folosită. Nu se ajustează nimic pe baza ei fără ca reparația să fie verificată pe partea de rezervă.
- Partea de rezervă are 929 de nume dintr-un cuvânt. Chiar și cu 0 scăpări, poate arăta doar că rata reală este sub aproximativ 0,32%, nu sub 0,1%.

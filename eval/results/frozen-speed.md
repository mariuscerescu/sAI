# Viteza verificatorului pe setul înghețat în engleză

> Data: 2026-11-23 · Partea folosită: **doar calibrarea** (2.083 de mesaje, cel mult 1.800 de caractere) · Regula: `eval/frozen-en/SPEC.md`, secțiunea 10.
> Placa video: NVIDIA RTX 5060 Laptop, 8 GB, modelul în 4 biți. Părțile finală și de rezervă nu au fost deschise.

## Rezultat

**Modul `all` nu atinge ținta de p95 sub 1 secundă: are 1.026 ms, cu 26 ms peste limită.** Modul `lowercase` o atinge, cu 923 ms, dar maschează inutil 19,23% din cuvintele-capcană. **Niciun mod nu îndeplinește acum toate țintele.**

| Timp adăugat la un mesaj care apelează modelul | `all` | `lowercase` |
|---|---|---|
| Mesaje cu apel | 2.083 din 2.083 | 1.237 din 2.083 |
| Mediană | 346 ms | 301 ms |
| p90 | 793 ms | 676 ms |
| **p95** | **1.026 ms** | **923 ms** |
| p99 | 1.686 ms | 1.405 ms |
| Maximum | 2.973 ms | 2.483 ms |
| Apeluri eșuate | 0 | 0 |

Timpul crește cu numărul de cuvinte verificate dintr-un mesaj, în modul `all`:

| Întrebări în mesaj | Mesaje | Mediană | p95 |
|---|---|---|---|
| 1 | 501 | 231 ms | 296 ms |
| 2–3 | 900 | 325 ms | 516 ms |
| 4–7 | 584 | 586 ms | 997 ms |
| 8–15 | 97 | 1.351 ms | 2.155 ms |
| 16 sau mai multe | 1 | 2.973 ms | 2.973 ms |

**Rezultatul depinde de cât de ocupată este placa video.** O primă măsurare, cu placa folosită și de alte programe, a dat p95 de 1.421 ms în modul `all`. Cifrele de mai sus sunt din a doua măsurare, cu placa liberă la pornire.

Pe articolele lungi din Wikipedia, care nu fac parte din criteriu, un apel în modul `all` durează în mediană 3,9 secunde, iar p95 este de aproximativ 23 de secunde.

## Unde se duce timpul

| Parte | Pondere |
|---|---|
| Straturile liniare în 4 biți | 54,6% |
| Regula „gated delta”, în varianta lentă | 20,3% |
| Convoluția cauzală, în varianta lentă | 3,3% |
| Tokenizare | 1,5% |
| Restul modelului | 20,3% |

## Ce am încercat

- **Întârzierea TCP din serviciul local:** am dezactivat algoritmul Nagle. Diferența dintre timpul văzut de client și cel din model era deja de numai 20–30 ms, deci câștigul este mic. Scăderea de la 1.421 la 1.026 ms vine în principal din placa video mai liberă.
- **Context mai scurt:** nu trece regula de calitate, care cere cel mult 23 de cuvinte mascate la pragul 0,2. Contextul rămâne la 300 de caractere.

| Context pe fiecare parte | Nume scăpate | Cuvinte mascate |
|---|---|---|
| **300 (actual)** | **0** | **23 (1,58%)** |
| 200 | 0 | 26 (1,79%) |
| 150 | 0 | 27 (1,85%) |

- **Calea rapidă a modelului:** cere pachetul `flash-linear-attention`, care depinde de Triton. Triton nu are pachete pentru Windows, deci calea nu poate fi folosită pe acest calculator.

## Ce ar putea aduce ținta

- Un sistem Linux, unde calea rapidă a modelului este disponibilă. Producătorul raportează un câștig de 1,7–1,9 ori pe validarea lui. Nu am măsurat asta aici.
- O placă video cu mai multă memorie, care să ruleze modelul fără cuantizare în 4 biți. Nu am măsurat asta aici.
- Acceptarea explicită a depășirii de 26 ms pe această placă video.

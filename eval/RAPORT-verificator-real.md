# sAI cu verificator: test cu un model real, prin pluginul DSH

> Data: 2026-11-23 · Toate datele sunt fictive · Rezultate: `results/run-en6/` (versiunea finală) și `results/run-en5/` (rularea dinaintea ultimei corecții).

## Rezultat

**Niciun nume din vocabular nu a ajuns la modelul real, iar formele diferite ale aceluiași nume revin corect.** Am citit fiecare text trimis și fiecare răspuns.

| Măsură, versiunea finală | Rezultat |
|---|---|
| Cazuri | 28 (20 din testul englez anterior, 8 noi pentru forme de nume) |
| Rulări | 56 (simboluri `typed` și `greek`), 62 de mesaje |
| Erori sau răspunsuri goale | 0 |
| Nume declarate ajunse la model | **0** |
| Cazuri noi cu forme de nume, corecte | **16 din 16 rulări** |
| Simboluri sAI rămase în răspuns | **0** |

Scanarea automată a semnalat 5 potriviri și le-am verificat pe toate. Trei sunt cuvântul „PROJECT” din simbolul `⟦PROJECT_1⟧`. Două sunt „Orion cinema”, care nu este declarat: în vocabular există doar „Project Orion”.

## Configurație

- **Plugin:** versiunea construită din `packages/experimental/sai`, încărcată în runtime-ul DSH.
- **Verificator:** Decider-Flash v1.3 local, modul `all`, pragul 0,2.
- **Model:** `nvidia/nemotron-3-ultra-550b-a55b:free`, prin OpenRouter. Modelul folosit la testele anterioare nu mai este gratuit, așa că rezultatele nu se compară direct cu cele vechi.
- **Rulare:** `scripts/verifier-live.ts`, cu `cases-en.json` și `cases-en-forms.json`.

## Exemple

| Cerere | Modelul a primit și a răspuns | Utilizatorul vede |
|---|---|---|
| Tabel cu First Name: Nadia, Last Name: Vantoor | `⟦PERSON_1⟧`, `⟦PERSON_1_2⟧` | Nadia, Vantoor, fiecare în câmpul lui |
| JSON cu numele complet, prenume și nume | `⟦PERSON_1⟧`, `⟦PERSON_1_2⟧`, `⟦PERSON_1_3⟧` | Elias Brandt, Elias, Brandt |
| „Who was promoted?” într-o conversație | `⟦PERSON_1_2⟧` | Vantoor |
| „Smith is the director” | `⟦PERSON_1_2⟧` | Smith |

## Ce a găsit testul

În prima rulare, modelul a explicat singur legătura dintre simboluri în 4 răspunsuri, de exemplu „Acme Logistics (which is the same entity as Acme)”. Am adăugat în instrucțiunea pentru model să nu menționeze legătura decât dacă este întrebat și am reluat tot setul. În versiunea finală au rămas 2 urme mai mici: „Acme (i.e., Acme Logistics)” și „John Smith (Smith)”.

## Limite rămase

- **Sarcini care cer valoarea reală:** inițiale, numărul de litere, adresa de e-mail construită din nume sau genul persoanei nu pot fi rezolvate corect, pentru că modelul vede doar simboluri.
- **Simbolurile grecești sunt mai slabe decât cele `typed`:** modelul le tratează uneori ca simboluri matematice. Strategia implicită rămâne `typed`.
- **Pluralul și unele forme flexionare** revin în forma declarată: „the johnsons” devine „the Johnson”.
- **Aplicația desktop nu a fost pornită în acest test.** Pluginul a fost încărcat în runtime-ul DSH, fără interfața grafică și fără profilul real.

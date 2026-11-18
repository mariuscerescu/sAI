# Modele AI open source pentru sAI: rezultatele testelor în engleză

**Data:** 17.11.2026.

**Mașina de test:** Ryzen 9 270, 31 GB RAM, RTX 5060 Laptop (8 GB), Windows 11, Python 3.11, PyTorch 2.11 + CUDA 12.8.

**Fișierele de lucru** sunt în `sai-model-bench` (în afara repository-ului):
- scripturile: `scripts/`;
- datele de test: `data/`;
- rezultatele pe model: `results/*.json`.

Aici apar doar totalurile și exemple inventate. Textele din Wikipedia (CC BY-SA) și din Nemotron-PII (CC BY 4.0) nu sunt copiate.

Metoda și discuția sunt în [docs/CERCETARE-MODELE.md](../../docs/CERCETARE-MODELE.md).

## Modelele testate

| Model | Tip | Licență | Cum a rulat |
|---|---|---|---|
| [`fastino/GLiDE-9B`](https://huggingface.co/fastino/GLiDE-9B) | model de decizie | Fastino Community: gratuit sub 10 mil. $ venituri/an, cu mențiunea „Built with Fastino GLiDE” | GPU, 4 biți NF4 (încărcător propriu) |
| [`perplexity-ai/pplx-decider-flash-v1.3`](https://huggingface.co/perplexity-ai/pplx-decider-flash-v1.3) | model de decizie, 4B, cu `locate` (găsește fragmente în text) | Apache 2.0 | GPU, 4 biți NF4 |
| [`perplexity-ai/pplx-decider-flash-v1.2`](https://huggingface.co/perplexity-ai/pplx-decider-flash-v1.2) | model de decizie, 4B | Apache 2.0 | GPU, 4 biți NF4 |
| [`Cloudflare/clef-flash`](https://huggingface.co/Cloudflare/clef-flash) | model de decizie, 9B | Apache 2.0 | GPU, 4 biți NF4 (încărcător propriu, fără partea de imagini) |
| [`LiquidAI/d1-2B`](https://huggingface.co/LiquidAI/d1-2B) | model de decizie, 2B | LFM 1.0: gratuit sub 10 mil. $ venituri/an | GPU, bf16 |
| [`autotrust/JEV-9B`](https://huggingface.co/autotrust/AutoTrust-Decider-Mini-9B) | model de decizie, distilat din Jev | Apache 2.0 (distilat dintr-un model proprietar) | GPU, 4 biți NF4; scos după testul 2: prea mare și lent |
| [`fastino/gliner2-privacy-filter-PII-multi`](https://huggingface.co/fastino/gliner2-privacy-filter-PII-multi) (GLiDE2-PII) | detector de date personale | Apache 2.0 | GPU |
| [`openai/privacy-filter`](https://huggingface.co/openai/privacy-filter) | detector de date personale | Apache 2.0 | GPU |
| [`LiquidAI/LFM2.5-Encoder-350M-PII-Detector`](https://huggingface.co/LiquidAI/LFM2.5-Encoder-350M-PII-Detector) | detector de date personale | LFM 1.0 | GPU |
| Microsoft Presidio + spaCy `en_core_web_lg` | detector clasic | MIT | CPU |

## Test 1: detectarea datelor personale (o propoziție, verificare de pornire)

Propoziția conține 7 elemente: două persoane, o firmă, un email, un telefon, un SSN și o adresă.

| Model | Găsite | Ratate | Timp |
|---|---|---|---|
| GLiDE2-PII | 7/7 | — | 232 ms |
| OpenAI Privacy Filter | 6/7 | firma (nu are categorie pentru firme) | 534 ms |
| Presidio + spaCy | 5/7 | SSN, firma; plus 2 detecții „URL” false în email | 17 ms (CPU) |
| LiquidAI LFM2.5-PII | 3/7 | ambele persoane, firma, adresa | 56 ms |

## Test 2: nume sau cuvânt obișnuit? (16 propoziții inventate)

| Model | Corecte |
|---|---|
| GLiDE-9B | 16/16 |
| Decider-Flash 4B | 16/16 |
| Clef-Flash 9B | 15/16 |
| JEV-9B | 15/16 |
| d1-2B | 14/16 |

## Test 3: nume sau cuvânt obișnuit? (822 de cazuri)

**Datele:** 420 de nume și 402 cuvinte obișnuite. Toate cuvintele sunt și nume, și cuvinte obișnuite: 47 de prenume, 43 de nume de familie și 28 de firme. Cazurile vin din:
- Wikipedia: cuvântul folosit obișnuit;
- Nemotron-PII: nume adnotate, plus aceleași nume rescrise cu literă mică;
- capcane scrise de mână.

**Revizuirea etichetelor:** 5 corectate, 2 scoase.

**Termeni:** „Scurgere” înseamnă un nume lăsat nemascat. „AUROC” arată cât de bine separă modelul numele de cuvintele obișnuite, indiferent de prag (1 = perfect).

| Model | AUROC | Scurgeri / mascări în plus la pragul 0,5 | Prag cu 0 scurgeri → mascări în plus | Prag ales pe jumătate din cazuri, aplicat pe cealaltă | Nume cu literă mică ratate (din 192) | Capcane greșite (din 87) | Timp mediană / p95 | VRAM |
|---|---|---|---|---|---|---|---|---|
| **Decider-Flash v1.3 4B** | **1,00000** | **0 / 3** | 0,75 → **0** | **0 scurgeri, 0 în plus** | 0 | 2 | 123 / 150 ms | 3,6 GB |
| GLiDE-9B | 0,99999 | 0 / 1 | 0,54 → 1 | 2 scurgeri din 210, 0 în plus din 200 | 0 | 0 | 269 / 331 ms | 5,7 GB |
| Decider-Flash 4B (v1.2) | 0,99978 | 2 / 5 | 0,20 → 6 | 0 scurgeri, 4 în plus | 2 | 4 | 182 / 225 ms | 3,6 GB |
| Clef-Flash 9B | 0,99998 | 16 / 0 | 0,03 → 3 | 0 scurgeri, 3 în plus | 10 | 3 | 270 / 297 ms | 5,6 GB |
| d1-2B | 0,99766 | 1 / 13 | 0,37 → 20 | 0 scurgeri, 10 în plus | 1 | 8 | 65 / 86 ms | 3,9 GB |
| GLiDE2-PII (detector) | 0,98673 | 10 / 38 | 0,015 → 112 | 0 scurgeri, 51 în plus | 6 | 13 | 34 / 60 ms | 1,3 GB |

Toate modelele au dat exact același scor la 10 rulări repetate.

**Greșeli comune:** „Frank feedback”, „Bill the client”, „the old king” și nume de familie scrise cu literă mică în tabele.

## Test 4: care persoană din vocabular e aceasta? (132 de cazuri)

Vocabularul conține perechi cu același prenume (de exemplu Mark King / Mark Hollis) sau cu același nume de familie (John Smith / Mary Smith). Modelul alege una dintre cele două persoane sau „neatribuit”. „Neatribuit” cuprinde „altă persoană” și „nu se poate stabili”; ambele înseamnă că sAI maschează numele ca persoană separată.

| Model | Corecte | Persoană greșită | Atribuit, deși nu trebuia | Neatribuit, deși textul arăta persoana | Corecte, pe tipuri de indiciu |
|---|---|---|---|---|---|
| GLiDE-9B | 104/132 | 0 | 0 | 28 | nume complet mai devreme 27/28, email 22/22, inițială 1/22, titlu 2/8, departament 16/16 |
| Decider-Flash v1.3 4B | 96/132 | 0 | 1 („Both Mark King and Mark Hollis…”, P = 0,51) | 35 | 27/28, 18/22, 0/22, 0/8, 16/16 |
| d1-2B | 97/132 | 0 | 0 | 35 | 28/28, 16/22, 2/22, 0/8, 15/16 |
| Decider-Flash 4B | 95/132 | 0 | 0 | 37 | 27/28, 16/22, 0/22, 0/8, 16/16 |
| Clef-Flash 9B | 86/132 | 2 | 8 | 36 | 28/28, 17/22, 2/22, 0/8, 11/16; „ambele persoane prezente” 0/8 |

## Test 5: trebuie protejat numele nedeclarat? (60 de cazuri)

Cazurile sunt de trei feluri:
- 20 de persoane private inventate;
- 10 persoane private cu nume celebru (de exemplu „our new intern, Michael Jordan”);
- 30 de persoane publice, istorice sau personaje de ficțiune.

| Model | Corecte la pragul 0,5 | Persoane private scăpate | Protejat în plus | AUROC | Privat cu nume celebru | Public + istoric | Prag cu 0 scurgeri → protejat în plus |
|---|---|---|---|---|---|---|---|
| GLiDE-9B | 56/60 | 3 | 1 | 0,989 | 7/10 | 25/25 | 0,23 → 3 (personaje de ficțiune) |
| Decider-Flash v1.3 4B | 50/60 | 5 | 5 | 0,917 | 6/10 | 25/25 | — |
| Clef-Flash 9B | 49/60 | 8 | 3 | 0,942 | 2/10 | 25/25 | 0,02 → 11 |
| Decider-Flash 4B | 48/60 | 7 | 5 | 0,932 | 4/10 | 25/25 | 0,11 → 5 |
| d1-2B | 48/60 | 7 | 5 | 0,907 | 4/10 | 25/25 | 0,19 → 6 |

## Test 6: găsirea numelor nedeclarate (200 de documente Nemotron-PII)

**Datele:** 404 nume adnotate de NVIDIA (persoane și firme). Prenumele și numele de familie alăturate sunt unite într-un singur nume.

**Cum se numără:** un nume e protejat doar dacă e acoperit complet de fragmentele găsite de model. „Marcat fără adnotare” e un fragment găsit de model care nu se suprapune cu nicio adnotare Nemotron, de orice tip. Nemotron nu adnotează tot, deci cifra e o limită superioară.

| Model | Nume acoperite complet | Parțial | Ratate | Marcat fără adnotare | Timp pe document (mediană / p95) | VRAM |
|---|---|---|---|---|---|---|
| GLiDE2-PII (prag 0,5) | 356/404 (88,1%) | 4 | 44 | 102: mai ales roluri („supervisor”, „customer”, „stakeholders”) | 30 / 51 ms | 1,4 GB |
| Decider-Flash v1.3 (`locate`, „person” + „company”) | 352/404 (87,1%) | 0 | 52 | 7: instituții și firme celebre („Manchester United”, „Social Security Administration”) | 567 / 707 ms | 4,2 GB |

Ambele au ratat doar persoane, nicio firmă. Cel mai des a fost vorba de un prenume sau un nume de familie apărut singur.

**Concluzie:** niciun detector nu e de încredere singur, pentru că amândouă ratează ~12% din nume. Pot completa vocabularul, dar nu îl pot înlocui.

## Test 7: verificatorul integrat în sAI (Decider-Flash v1.3)

Verificatorul rulează ca serviciu local (`verifier/decider_server.py`, doar pe 127.0.0.1). sAI îi trimite într-un singur apel toate cuvintele neconfirmate ale unei cereri; o cerere fără astfel de cuvinte nu face niciun apel. Rezultatele complete sunt în [verificator-en.md](verificator-en.md).

**Cum îi arătăm modelului care apariție e întrebată.** Același cuvânt poate apărea de două ori („Reply to bill: … paid the bill.”). Am încercat patru variante pe cele 822 de cazuri, cu prag 0,2:

| Varianta | Nume scăpate | Cuvinte obișnuite mascate |
|---|---|---|
| A. Propoziția ca atare, întrebarea din testul 3 | 0 | 4 |
| B. Cuvântul marcat ⟪ ⟫ în text, aceeași întrebare | 1 | 8 |
| C. Cuvântul marcat, întrebarea „the marked word ⟪…⟫” | 1 | 8 |
| D. Cuvântul marcat, întrebarea cu „(the occurrence marked ⟪ ⟫)” | 1 | 6 |

Marcajul strică răspunsurile (de exemplu, „love” folosit ca nume scade de la 0,99 la 0,05). Varianta A reproduce testul 3, deci și încărcarea nouă a modelului (cu greutățile citite una câte una și fără partea de imagini) e corectă. sAI folosește A. Când cuvântul apare de mai multe ori, fiecare întrebare primește doar bucata de text în care cuvântul apare o singură dată, tăiată la un sfârșit de propoziție, dacă există.

**sAI azi față de sAI cu verificatorul** (motorul real, fiecare propoziție e un mesaj). Prima versiune doar adăuga măști. Versiunea B trimite la verificator toate bucățile de nume scrise cu literă mică, inclusiv pe cele pe care regulile le-ar masca azi doar pentru că textul nu are niciun nume cu majusculă. Cuvintele scrise cu majusculă rămân mascate, ca azi.

| | Azi | Prima versiune | Versiunea B |
|---|---|---|---|
| Nume scăpate (din 420) | 164 | 0 | **0** |
| Cuvinte obișnuite mascate (din 402) | 177 | 178 | **31** |
| Cuvinte cu literă mică mascate în plus în 29 de articole Wikipedia (254.062 de cuvinte) | — | 0 | 0 |

- **Cele 31 rămase:** 29 sunt scrise cu majusculă (lăsate mascate intenționat), iar 2 sunt scrise cu literă mică, „park” și „zoom”, unde modelul a fost nesigur.
- **Timp:** un apel durează în mediană 136 ms pentru o propoziție și 551 ms pentru un articol întreg. Mesajele fără cuvinte neconfirmate nu fac niciun apel.

## Concluzii

- **Verificarea candidaților („bill” e nume sau cuvânt?):** Decider-Flash v1.3 (Apache 2.0) e cel mai bun. A separat perfect cele 822 de cazuri și e de două ori mai rapid decât GLiDE-9B.
- **Identitatea și protecția numelor nedeclarate:** GLiDE-9B rămâne primul.
- **Alte modele:** d1-2B e cel mai rapid. Clef-Flash nu e potrivit pentru identitate.
- **Modelul nu înlocuiește regulile.** Judecă doar cazurile ambigue pe care regulile nu le pot decide singure, de exemplu un nume scris cu literă mică.
- **Pragul se alege pe date, cu marjă,** pentru fiecare model.
- **Integrat în sAI** (testul 7, versiunea B): niciun nume scăpat din 420, față de 164 azi. Cuvintele obișnuite mascate scad de la 177 la 31. Fiecare cerere face cel mult un apel.
- **Ce nu s-a măsurat încă:**
  - rularea pe procesor (CPU);
  - modelele în precizie completă, nu comprimate la 4 biți;
  - lanțul complet pe prompturi lungi;
  - româna;
  - modelele de 27–30B, care cer llama.cpp.

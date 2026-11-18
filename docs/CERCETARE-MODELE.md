# Modele AI open source pentru sAI: cercetare și plan de test

> 17.11.2026. Cerința: administrația vrea comparat sistemul determinist de forme cu modele AI. Regulile rămân baza; un model e o componentă înlocuibilă (un `Detector` în nucleu, ca strategiile typed/greek), pornită sau oprită din setări și măsurată pe exact aceleași teste.
>
> **Prioritate (decizie 17.11.2026): doar engleza.** Româna nu contează acum pentru administrație. Secțiunea 0 de mai jos e planul pentru engleză; secțiunile 1–4 (cercetarea inițială, cu română) rămân ca referință pentru mai târziu.

## 0. Planul pentru engleză

### De ce se schimbă imaginea

- **Problema A (formele unui termen declarat) e mică în engleză.** Numele aproape nu se flexionează: doar pluralul și posesivul. Generatorul acoperă deja **100%** din formele numelor proprii din Wikipedia în engleză și **97,5%** din pluralele de substantive din dicționarul AGID. Restul sunt pluralele latine și grecești, lăsate deoparte intenționat.
- **Valoarea reală a unui model e problema B: persoane, firme și date personale nedeclarate.** Pe engleză, cele mai bune modele open source din 2026 sunt antrenate și evaluate tocmai pe această limbă.

### Candidați (toți rulează local; licențele se verifică la descărcare)

| Model | Mărime | Licență | Note |
|---|---|---|---|
| [OpenAI Privacy Filter](https://openai.com/index/introducing-openai-privacy-filter/) (`openai/privacy-filter`) | 1,5B (MoE, ~50M active) | Apache 2.0 | în principal engleză; 8 categorii; o [evaluare independentă](https://arxiv.org/pdf/2608.02616) îl găsește slab pe nume de persoane (F1 0,40) |
| [GLiNER2-PII](https://arxiv.org/abs/2605.09973) ([Guardrails-PII-Multi](https://huggingface.co/fastino/GLiNER2-Guardrails-PII-Multi)) | 0,3B, CPU | Apache 2.0 | 42 de tipuri; cel mai bun pe SPY |
| GLiNER-PII (NVIDIA, antrenat pe Nemotron-PII) | ~0,3B | NVIDIA Open Model License (de verificat) | |
| GLiNER zero-shot (de exemplu `knowledgator/gliner-multitask-large-v0.5`) | ~0,5B | Apache 2.0 (de verificat) | etichete în limbaj natural; robust pe date nevăzute ([PII-TRACE](https://arxiv.org/html/2609.22200v1)) |
| [LiquidAI LFM2.5-Encoder-350M-PII](https://huggingface.co/LiquidAI/LFM2.5-Encoder-350M-PII-Detector) | 0,4B | LFM 1.0 (de verificat pentru uz comercial) | 40 de tipuri |
| [Piiranha v1](https://huggingface.co/iiiorg/piiranha-v1-detect-personal-information) | 0,28B | **CC BY-NC-ND 4.0: necomercial**; doar pentru comparație | 17 tipuri; scade mult pe date noi |
| Microsoft Presidio + spaCy `en_core_web_lg` / `_trf` | cadru + model NER | MIT / licența modelului spaCy | referința clasică |

### Modele de decizie („System One”, JEV)

Surse: [anunțul TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev), [Wikipedia](https://en.wikipedia.org/wiki/Jev_(AI_model)), [Hugging Face](https://huggingface.co/blog/decision), [Artificial Analysis Decision Index](https://artificialanalysis.ai/articles/artificial-analysis-decision-index).

**Ce sunt.** Un model de decizie primește o *stare* (un text) și întrebări cu răspunsuri fixate dinainte. Întrebările pot fi:
- da/nu (`noul`);
- alegere între variante (`choice`);
- notă pe o scară (`score`).

Modelul întoarce probabilități într-un singur pas, fără să genereze text. **Nu găsește poziții în text**: nu poate spune „numele e la caracterele 34–44”. Nu înlocuiește deci nici detectorii, nici generatorul de forme. Poate doar să judece un candidat pe care i-l dă altcineva.

| Model | Ce e | Licență | Pentru noi |
|---|---|---|---|
| **Jev 1.13** (TypeSafe AI) | proprietar, doar API în cloud, acces timpuriu; primul în Decision Index (58) | proprietară | **exclus ca detector**: textul brut ar pleca în cloud *înainte* de pseudonimizare, exact ce sAI trebuie să împiedice |
| [`autotrust/JEV-9B`](https://huggingface.co/autotrust/JEV-9B) | elev deschis, distilat din Jev 1.13, pe Qwen3.5-9B; ~90% din acuratețea profesorului | Apache 2.0 | ~18 GB în BF16, nu încape în 8 GB VRAM; există variante cuantizate |
| [`ggml-org/Kev-4B-GGUF`](https://huggingface.co/ggml-org/Kev-4B-GGUF) | 4B pe Qwen3.5-4B; llama.cpp, endpoint `/v1/systemone` | Apache 2.0 | Q4_K_M ~3 GB, încape pe RTX 5060 |
| [`autotrust/GEV-26B-Decide`](https://huggingface.co/autotrust/GEV-26B-Decide) | Gemma-4-26B-A4B (MoE) | Apache 2.0 + termenii Gemma 4 | cere ≥80 GB GPU; nu rulează pe mașina de test |

**Unde s-ar potrivi în sAI: verificator de candidați**, ca o etapă înlocuibilă după detectori:

1. **Un potrivitor larg propune candidați.** Poate fi pe rădăcină, fără diferență de majuscule sau cu distanță de editare. Acoperă formele pe care regulile nu le generează: neregulate, scrise cu literă mică, derivate.
2. **Modelul de decizie judecă fiecare candidat.** Întrebarea e de tipul: „În propoziția aceasta, «bill» se referă la persoana Bill Turner?”
3. **Candidații confirmați se maschează.**

Asta răspunde direct îndoielii administrației: formele nu mai depind doar de reguli, iar modelul filtrează potrivirile false. Are însă trei costuri:
- **Sistemul redevine probabilist.** Fiecare candidat primește o probabilitate și trebuie un prag, adică exact ce am scos în versiunea 6f55583.
- **O respingere greșită înseamnă o scurgere de date.** Regula ar trebui să fie „în caz de dubiu, maschează”.
- **Fiecare candidat costă un apel la model.**

Se măsoară în bancul de mai jos ca o variantă separată: reguli, apoi reguli + potrivitor larg + verificator.

#### Care modele din [Decision Index](https://artificialanalysis.ai/articles/artificial-analysis-decision-index) au greutăți publice

| Model din clasament | Greutăți | Licență | Pe laptopul de test (8 GB VRAM, 31 GB RAM) |
|---|---|---|---|
| Jev 1.13 (TypeSafe) | nu, doar API | proprietară | — (deschis: elevul `autotrust/JEV-9B`) |
| GLiDE (Fastino) | [`fastino/GLiDE-27B`](https://huggingface.co/fastino/GLiDE-27B), [-9B](https://huggingface.co/fastino/GLiDE-9B), -2B, -0.8B, -0.4B | Fastino Community: uz comercial gratuit sub 10 mil. $ venituri anuale, plus mențiunea „Built with Fastino GLiDE” | 9B testat; 27B (52 GB) nu încape |
| Microsoft-Decision-1 | nu (Foundry, OpenRouter) | proprietară | — |
| Decider v1.1 27B (Perplexity) | [`perplexity-ai/pplx-decider-v1.2`](https://huggingface.co/perplexity-ai/pplx-decider-v1.2) (27B), [`-flash-v1.2`](https://huggingface.co/perplexity-ai/pplx-decider-flash-v1.2) (4B) | Apache 2.0 | Flash testat; 27B nu încape |
| Mercury Decide (Inception) | nu | proprietară | — |
| Celeris-1 Decision | nu s-au găsit | — | — |
| d1 (LiquidAI) | [`LiquidAI/d1-2B`](https://huggingface.co/LiquidAI/d1-2B), d1-3B, d1-Omni | LFM 1.0: uz comercial gratuit sub 10 mil. $ venituri anuale | 2B testat |
| Clef, Clef-Flash, Clef-Omni (Cloudflare) | [`Cloudflare/clef`](https://huggingface.co/Cloudflare/clef) (27B), [`clef-flash`](https://huggingface.co/Cloudflare/clef-flash) (9B), [`clef-omni`](https://huggingface.co/Cloudflare/clef-omni) (30B-A3B) | Apache 2.0 | Flash testat; Clef și Omni (55 și 71 GB) nu încap |
| GPT-6 Luna (Decisions) | nu | proprietară | — |

Modelele de 27–30B ar rula pe acest laptop doar prin llama.cpp, din fișiere GGUF comprimate (există pentru GLiDE-27B, Decider 27B și Clef). Programul llama.cpp nu a fost descărcat: e un executabil și cere acordul explicit al utilizatorului.

#### Primul test: verificatorul de candidați (17.11.2026)

Scriptul este `sai-model-bench/scripts/bench_verifier.py`, iar rezultatele pe model sunt în `sai-model-bench/results/verifier-*.json`.

**Datele:** 16 propoziții inventate. În 10 dintre ele cuvântul candidat e un nume: „bill” scris cu literă mică, „Bill's”, „Turners”, „acme's”, „Acmes”, „rose” scris cu literă mică etc. În 6 e un cuvânt obișnuit: „pay the bill”, „a turner”, „Mark the box”, „the acme of”, „the rose”, „prices rose”.

**Întrebarea**, de tip da/nu: „În acest text, cuvântul «X» e folosit ca nume de persoană / de firmă (cum e Y), nu ca un cuvânt obișnuit?” O primă formulare („se referă «X» la Y?”) nu avea răspuns din text: alt Mark poate fi oricine. JEV-9B a răspuns corect doar la 8 din 16 cu ea.

**Pragul** e 0,5. Fiecare model a rulat singur, pe rând.

| Model | Corecte | Greșeli | Timp pe întrebare | VRAM | Cum a rulat |
|---|---|---|---|---|---|
| **GLiDE-9B** (Fastino) | **16/16** | — | 266 ms | 5,7 GB | 4 biți NF4, încărcător propriu (codul GLiDE știe doar bf16 sau NVFP4) |
| **Decider-Flash 4B** (Perplexity) | **16/16** | — | 206 ms | 3,6 GB | 4 biți NF4 |
| Clef-Flash 9B (Cloudflare) | 15/16 | **scurgere:** „bill” cu literă mică, P = 0,02 | 254 ms | 5,6 GB | 4 biți NF4, încărcător propriu, fără partea de imagini |
| JEV-9B (AutoTrust) | 15/16 | **scurgere:** „bill” cu literă mică, P = 0,43 | 2,7 s | 8,3 GB | 4 biți NF4; nu încape în VRAM, fără nucleele rapide pe Windows |
| d1-2B (LiquidAI) | 14/16 | mascare în plus: „Mark the box” 0,71, „the acme of” 0,51 | 72 ms | 3,9 GB | bf16; atenție SDPA în loc de FlashAttention (lipsește din PyTorch pe Windows) |

**Ce se poate spune de aici:**
- **Rezultatele sunt promițătoare, dar încă nu sunt o dovadă.** Pe propoziții de felul acesta, două modele separă perfect numele de cuvintele obișnuite, cu margini largi: numele peste 0,82, cuvintele obișnuite sub 0,09.
- **16 propoziții nu sunt un banc de test.** Concluziile cer setul T1–T7, cu sute de cazuri, inclusiv texte lungi, nume în alte poziții și capcane.
- **Patru dintre modele au rulat comprimate la 4 biți,** nu în precizia publicată. Rezultatele în bf16 pot fi puțin diferite.
- **Greșelile nu sunt egale.** Pentru sAI, o scurgere („bill” trimis necodat) e mai gravă decât o mascare în plus. Pragul trebuie ales pe date, pentru un număr țintă de scurgeri, nu fixat la 0,5.
- **d1 poate și extrage un singur text, cu poziția lui** (tipul `text`). Nu poate însă lista toate numele dintr-un text, deci nu înlocuiește un detector de nume nedeclarate.

#### Setul complet: 822 de cazuri (17.11.2026)

JEV-9B a fost scos din test: e prea mare pentru placa video și prea lent (2,7 s pe întrebare).

Fișierele sunt în `sai-model-bench`; datele nu intră în repository, pentru că Wikipedia e sub licența CC BY-SA, iar Nemotron sub CC BY 4.0:
- setul: `data/verifier-set-en.jsonl`, construit cu `scripts/build_verifier_set.py`;
- corecturile de etichete, fiecare cu motivul ei: `data/verifier-set-en.corrections.json`;
- scorurile: `scripts/score_verifier_set.py`, cu rezultatul în `results/verifier-set-en.md`.

**Ce conține setul.** Fiecare caz e un cuvânt care e și nume, și cuvânt obișnuit, în trei liste: 47 de prenume (Bill, Grant, Rose…), 43 de nume de familie (Baker, King, Price…) și 28 de firme (Apple, Shell, Target…). Etichetele sunt puse după reguli, niciodată de un model:

| Sursă | Cazuri | Eticheta |
|---|---|---|
| Wikipedia în engleză (`eval/corpus/en-wiki`), apariții cu literă mică în mijlocul propoziției | 206 | cuvânt obișnuit |
| Nemotron-PII: nume și firme adnotate de NVIDIA | 170 + 40 nume obișnuite (Brian, Isla…) | nume |
| aceleași nume, rescrise cu literă mică (cum se scrie în chat) | 170 | nume |
| Nemotron-PII: apariții cu literă mică în afara adnotărilor | 150 | cuvânt obișnuit |
| capcane scrise de mână, cu date inventate: început de propoziție, titluri, chat, posesive, firme | 88 | după caz |

**Revizuirea etichetelor.** După prima rulare am citit fiecare caz la care cel puțin un model contrazicea eticheta și l-am judecat doar după propoziție:
- 5 etichete corectate: un „Price” dintr-un cap de tabel, adnotat greșit de NVIDIA ca nume, și patru „amazon-ssm-agent”, unde „amazon” chiar e firma;
- 2 cazuri scoase, fiind ambigue.

**Rezultate** (întrebarea și pragurile ca la primul test; „scurgere” = un nume pe care verificatorul l-ar fi lăsat nemascat):

| Model | AUROC | Scurgeri / mascări în plus la pragul 0,5 | Prag cu 0 scurgeri → mascări în plus | Prag ales pe jumătate din cazuri, aplicat pe cealaltă | Nume cu literă mică ratate (din 192) | Capcane greșite (din 87) | Timp mediană / p95 | VRAM |
|---|---|---|---|---|---|---|---|---|
| **GLiDE-9B** | 0,99999 | **0 / 1** | 0,54 → 1 | 2 scurgeri din 210, 0 în plus din 200 | **0** | **0** | 269 / 331 ms | 5,7 GB |
| **Decider-Flash 4B** | 0,99978 | 2 / 5 | 0,20 → 6 | 0 scurgeri, 4 în plus | 2 | 4 | 182 / 225 ms | 3,6 GB |
| Clef-Flash 9B | 0,99998 | 16 / 0 | 0,03 → 3 | 0 scurgeri, 3 în plus | 10 | 3 | 270 / 297 ms | 5,6 GB |
| d1-2B | 0,99766 | 1 / 13 | 0,37 → 20 | 0 scurgeri, 10 în plus | 1 | 8 | 65 / 86 ms | 3,9 GB |
| GLiDE2-PII (detector, nu verificator) | 0,98673 | 10 / 38 | 0,015 → 112 | 0 scurgeri, 51 în plus | 6 | 13 | **34 / 60 ms** | **1,3 GB** |

GLiDE2-PII nu primește cuvântul candidat și nici o întrebare. Primește doar propoziția și caută singur persoane și firme. Scorul unui caz este cea mai mare încredere a unei entități găsite peste cuvântul candidat, sau 0 dacă nu a găsit nimic acolo. Comparația îl dezavantajează în două feluri:
- **Nu știe ce se cere.** Celorlalte modele li se spune ce cuvânt să judece.
- **Entitățile lui pot include cuvinte vecine,** de exemplu „king James I”, unde „king” e titlu. Atunci cuvântul obișnuit e numărat ca mascat în plus.

Rezultatul arată totuși clar că pentru verificarea candidaților un model de decizie e net mai bun. GLiDE2-PII rămâne candidatul pentru cealaltă sarcină: găsirea numelor și datelor nedeclarate. Aceea se măsoară separat, pe Nemotron-PII (punctul 3 al bancului).

Toate cele patru au dat exact același scor la 10 rulări ale acelorași 40 de cazuri.

**Ce reiese:**
- **Toate patru separă aproape perfect numele de cuvintele obișnuite** (AUROC ≥ 0,997). Diferențele țin de prag și de capcane.
- **GLiDE-9B e cel mai bun.** La pragul implicit de 0,5 nu scapă niciun nume, maschează în plus un singur cuvânt („the old king”) și nu greșește nicio capcană. Pragul are totuși nevoie de o marjă: ales prea strâns pe o jumătate a setului, lasă 2 scurgeri pe cealaltă.
- **Clef-Flash separă foarte bine, dar dă scoruri mici tuturor.** La 0,5 scapă 16 nume, la 0,03 doar 3 mascări în plus. Pragul trebuie ales pe date pentru fiecare model, nu fixat la 0,5.
- **d1-2B e de 3–4 ori mai rapid, dar greșește cele mai multe capcane.** Ia drept nume cuvinte cu majusculă de la început de propoziție sau din titluri: „Bill the client”, „Shell Scripting Basics”, „Zoom in on the chart”.
- **Greșelile comune tuturor** sunt „Frank feedback”, „Bill the client”, „the old king” și numele de familie scrise cu literă mică în tabele („M brown”). Acestea sunt cazurile de inclus în orice test viitor.

**Limitele testului:**
- **Patru dintre modele au rulat comprimate la 4 biți** (toate în afară de d1-2B).
- **Setul e în engleză și conține doar cuvinte alese ca ambigue.** Numele obișnuite (Brian, Isla) sunt doar 40, ca reper.
- **Candidații vin din liste,** nu dintr-un potrivitor real. Pasul următor este integrarea ca `Detector` și măsurarea întregului lanț (reguli + potrivitor larg + verificator) pe textele lungi din `cases-en.json`.

#### Alte două roluri: identitatea și protecția numelor nedeclarate (17.11.2026)

Fișierele sunt în `sai-model-bench`:
- datele: `data/roles-en.jsonl`, construite cu `scripts/build_roles_set.py`;
- rularea: `scripts/bench_roles.py`;
- scorurile: `scripts/score_roles.py`, cu rezultatul în `results/roles-en.md`.

Toate persoanele private din test sunt inventate.

**Rolul 2: „care persoană din vocabular e aceasta?”**

Testul are 132 de cazuri. Vocabularul conține două persoane cu același prenume (Mark King / Mark Hollis, 8 perechi) sau cu același nume de familie (John Smith / Mary Smith, 6 perechi). Modelul alege între:
- una dintre cele două persoane;
- „altă persoană”;
- „nu se poate stabili”.

Ultimele două răspunsuri înseamnă același lucru pentru sAI: menționarea se maschează ca persoană separată. De aceea le numărăm împreună, ca „neatribuit”.

| Model | Corecte | **Persoană greșită** | **Atribuit, deși nu trebuia** | Neatribuit, deși textul arăta persoana (sigur) | Nume complet mai devreme | Email | Inițială | Titlu (Mr./Mrs.) | Departament | Fără indiciu | Ambele prezente | Alt nume |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GLiDE-9B | 104/132 | **0** | **0** | 28 | 27/28 | 22/22 | 1/22 | 2/8 | 16/16 | 14/14 | 8/8 | 14/14 |
| d1-2B | 97/132 | **0** | **0** | 35 | 28/28 | 16/22 | 2/22 | 0/8 | 15/16 | 14/14 | 8/8 | 14/14 |
| Decider-Flash 4B | 95/132 | **0** | **0** | 37 | 27/28 | 16/22 | 0/22 | 0/8 | 16/16 | 14/14 | 8/8 | 14/14 |
| Clef-Flash 9B | 86/132 | **2** | **8** | 36 | 28/28 | 17/22 | 2/22 | 0/8 | 11/16 | 14/14 | 0/8 | 14/14 |

Ce reiese:
- **GLiDE-9B, d1-2B și Decider-Flash n-au amestecat niciodată două persoane.** Când nu sunt siguri, aleg „neatribuit”, iar sAI maschează oricum.
- **Clef-Flash e nesigur pentru acest rol.** Într-un text cu ambele persoane („Both Mark King and Mark Hollis were invited. Mark confirmed…”) alege aproape mereu prima persoană numită, cu încredere de până la 0,95. A greșit și două cazuri cu departamentul.
- **Indiciile directe merg bine:** numele complet mai devreme, emailul, departamentul.
- **Inițialele și titlurile aproape nu funcționează** („Mark K.”, „Mrs. Smith”): modelele răspund „nu se poate stabili”. Răspunsul e sigur, dar sAI ar pierde aici legătura cu persoana din vocabular. Un astfel de indiciu poate fi tratat mai bine de o regulă, de exemplu inițiala care se potrivește unui singur nume de familie.

**Rolul 3: „trebuie protejat numele acesta nedeclarat?”**

Testul are 60 de cazuri. Răspunsul corect e „da” pentru persoane private (20 de nume inventate și 10 persoane private cu nume celebru: „our new intern, Michael Jordan”). E „nu” pentru persoane publice, istorice și personaje de ficțiune (30).

| Model | Corecte la 0,5 | **Scurgeri** (privat lăsat) | Protejat în plus | AUROC | Privat | Privat cu nume celebru | Public | Istoric | Ficțiune | Prag cu 0 scurgeri → protejat în plus |
|---|---|---|---|---|---|---|---|---|---|---|
| **GLiDE-9B** | 56/60 | **3** | 1 | 0,989 | 20/20 | 7/10 | 14/14 | 11/11 | 4/5 | 0,23 → 3 (toate personaje de ficțiune) |
| Clef-Flash 9B | 49/60 | 8 | 3 | 0,942 | 20/20 | 2/10 | 14/14 | 11/11 | 2/5 | 0,02 → 11 |
| Decider-Flash 4B | 48/60 | 7 | 5 | 0,932 | 19/20 | 4/10 | 14/14 | 11/11 | 0/5 | 0,11 → 5 |
| d1-2B | 48/60 | 7 | 5 | 0,907 | 19/20 | 4/10 | 14/14 | 11/11 | 0/5 | 0,19 → 6 |

Ce reiese:
- **Persoanele publice și istorice sunt recunoscute de toate modelele** (25/25).
- **Problema comună sunt persoanele private cu nume celebru.** „The driver, Lewis Hamilton, was late” e luat drept pilotul de Formula 1, deși contextul spune clar că e un șofer al firmei. GLiDE-9B greșește 3 din 10, celelalte 3–8 din 10.
- **GLiDE-9B e singurul bun aici.** Cu pragul 0,23 nu lasă să treacă nicio persoană privată și protejează în plus doar 3 personaje de ficțiune. Pragul e însă ales pe aceleași 60 de cazuri, deci rezultatul e optimist.
- **Regula de siguranță rămâne aceeași:** un nume nedeclarat trece nemascat doar dacă modelul e foarte sigur că e o persoană publică. Altfel se maschează.

**Concluzia pentru cele trei roluri:**
- **GLiDE-9B e cel mai bun în toate trei.** Nu a încurcat nicio persoană, nu a scăpat niciun nume la verificarea candidaților și a judecat cel mai bine numele nedeclarate.
- **Decider-Flash și d1-2B sunt sigure la identitate, dar slabe la protecție.**
- **Clef-Flash nu e potrivit pentru identitate.**

#### Clasamentul actualizat (noiembrie 2026): ce e deschis și ce se poate testa

Toate rezultatele de până acum sunt adunate în [eval/results/modele-ai-en.md](../eval/results/modele-ai-en.md).

| Model din clasament (scor) | Greutăți publice | Licență | Mărime | Se poate testa pe laptop? |
|---|---|---|---|---|
| d1.2-ultra (75), d1-ultra (71), d1.2 (69), d1.1 (66) — LiquidAI | nu; d1-ultra e doar API (Liquid, OpenRouter); d1.2 și d1.1 nu apar public | proprietară | — | nu |
| d1 (61) — LiquidAI | da: `LiquidAI/d1-2B`, `d1-3B` | LFM 1.0 | 2–3B | **testat** (d1-2B) |
| Drex Max v1.1 (73) — Nace AI | doar v1: [`nace-ai/drex-max-v1`](https://huggingface.co/nace-ai/drex-max-v1) | Nace AI Open RAIL-M (cu restricții de utilizare) | 27B, 52 GB | doar prin llama.cpp (există GGUF Q8) |
| Drex 2.0 (62) — Nace AI | da: [`nace-ai/drex-v2.0`](https://huggingface.co/nace-ai/drex-v2.0) | Open RAIL-M | 35B-A3B (MoE), 70 GB | doar prin llama.cpp (există GGUF Q4) |
| SubQ Snap 1.2 (73) și 1.1 (68) — Subquadratic | nu; doar API | proprietară | — | nu |
| GLiDE v1.2 (73) — Fastino | da: [`fastino/GLiDE-27B`](https://huggingface.co/fastino/GLiDE-27B); 9B, 2B, 0.8B, 0.4B | Fastino Community | 27B, 52 GB | 27B doar prin llama.cpp; **9B testat** |
| Mammoth 27B (71) — Base Labs | da: [`baselabs/mammoth-1`](https://huggingface.co/baselabs/mammoth-1) | MIT | 27B, 55 GB | nu (prea mare) |
| Elephant 9B (66) — Base Labs | da: [`baselabs/elephant-1`](https://huggingface.co/baselabs/elephant-1) | MIT | 9B, 19 GB | **posibil**, cu efort: are nevoie de programul OneJev de pe GitHub, gândit pentru Linux și Docker |
| Decider v1.3 (70) și v1.2 (70) — Perplexity | da: `pplx-decider-v1.3`, `-v1.2` | Apache 2.0 | 27B, 52–54 GB | doar prin llama.cpp |
| Decider Flash v1.3 (64) — Perplexity | da: [`perplexity-ai/pplx-decider-flash-v1.3`](https://huggingface.co/perplexity-ai/pplx-decider-flash-v1.3) | Apache 2.0 | 4B, 9,6 GB | **da**; are în plus tipul `locate`, care găsește singur fragmentele din text, cu poziția lor |
| Decider Flash v1.2 (60) — Perplexity | da | Apache 2.0 | 4B | **testat** |
| Microsoft-Decision-1.1 (68) și -1 (62) | nu; doar Foundry / OpenRouter | proprietară | — | nu |
| Jev 1.14 (66) — TypeSafe | nu; doar API | proprietară | — | nu |
| Gemini Decision 1 (66) — Google | nu; doar API | proprietară | — | nu |
| Mercury Decide (62) — Inception | nu | proprietară | — | nu |
| Celeris-1.1 Decision (62) | nu | proprietară | — | nu |
| Clef (60) și Clef-Omni (58) — Cloudflare | da | Apache 2.0 | 27B / 30B-A3B | doar prin llama.cpp; Clef-Flash testat (nu e în acest clasament) |
| GPT-6 Luna (Decisions) (60) — OpenAI | nu | proprietară | — | nu |

**Decider Flash v1.3, testat (17.11.2026).** Detaliile sunt în [eval/results/modele-ai-en.md](../eval/results/modele-ai-en.md).
- **Verificarea candidaților:** e cel mai bun model de până acum. A separat perfect cele 822 de cazuri (AUROC 1,00000). La pragul de 0,5 a avut 0 scurgeri și 3 mascări în plus. Pragul de 0,75 n-a făcut nicio greșeală, nici pe jumătatea de cazuri nefolosită la alegerea pragului. Durează 123 ms pe întrebare.
- **Identitatea persoanelor:** 96/132, cu o singură atribuire greșită, la limită (P = 0,51).
- **Protecția numelor nedeclarate:** 50/60, mai slab decât GLiDE-9B.
- **Găsirea numelor cu `locate`:** a acoperit 87% din nume, aproape cât GLiDE2-PII (88%), dar a marcat doar 7 fragmente în afara adnotărilor, față de 102.
- **Licența e Apache 2.0, fără restricții.** E candidatul principal pentru rolul de verificator.

**Ce merită testat în continuare** (punctul 1 de mai jos e făcut):
1. **Decider Flash v1.3** (4B, Apache 2.0). E versiunea nouă a modelului cu licență liberă și încape ușor pe laptop. Funcția `locate` l-ar putea face și detector de nume nedeclarate, în locul lui GLiDE2-PII.
2. **Elephant-1** (9B, MIT). Are licență liberă, dar cere instalarea programului OneJev de pe GitHub, iar codul trebuie citit înainte de rulare.
3. **Modelele de 27B+** (GLiDE-27B, Decider v1.3, Drex, Mammoth). Doar prin llama.cpp, care încă nu a fost aprobat, și numai dacă fișierele GGUF păstrează capul de decizie al modelului.

Atenție: JEV-9B e distilat dintr-un model proprietar. Licența Apache 2.0 a elevului nu spune nimic despre termenii de utilizare ai TypeSafe; de verificat înainte de orice folosire în produs.

### Date de test în engleză

| Set | Ce conține | Licență |
|---|---|---|
| Testele noastre | 148 de propoziții cu forme englezești, setul de evaluare `cases-en.json`, corpusul de potriviri false (254.062 de cuvinte), comparațiile AGID și Wikipedia | ale noastre |
| [Nemotron-PII](https://hyper.ai/en/datasets/nemotron-pii-pii-and-phi-detection) (NVIDIA) | 100.000 de înregistrări sintetice în engleză, 50+ domenii | CC BY 4.0 (de confirmat pe pagina oficială) |
| [ai4privacy open-pii-masking-500k](https://www.huggingface.co/datasets/ai4privacy/open-pii-masking-500k-ai4privacy/blob/144ca06b62d78f173df83e0f47feb97524921714/README.md) | multilingv, ~26% engleză | CC BY 4.0 |

Atenție: modelele antrenate pe Nemotron sau ai4privacy vor arăta mai bine pe aceste seturi. De aceea fiecare rezultat se raportează separat pe fiecare set, iar setul nostru, nevăzut de niciun model, e cel decisiv.

### Bancul de test (același pentru reguli și pentru fiecare model)

1. **Formele termenilor declarați:** propozițiile englezești și setul `cases-en.json`, cu vocabularul declarat.
2. **Mascări greșite:** corpusul Wikipedia în engleză.
3. **Persoane și firme nedeclarate:** Nemotron-PII, ai4privacy (partea în engleză) și setul nostru adnotat manual.
4. **Identificatori:** SSN, telefoane SUA/UK, NINO, carduri, IBAN, e-mail; comparați cu tiparele actuale.
5. **Stabilitate:** același text de 10 ori.
6. **Cost:** latență CPU și GPU, memorie, mărime.
7. **Licență și rulare locală.**

Mașina de test: Ryzen 9 270, 31 GB RAM, RTX 5060 Laptop, Python 3.11/3.13.

## 1. Ce problemă rezolvă fiecare tip de model

Modelele AI nu fac toate același lucru. Le-am împărțit după întrebarea la care răspund:

| Problemă | Ce face acum sAI | Tip de model care o poate face |
|---|---|---|
| **A. Formele unui termen declarat** („Băncii Verzi” pentru „Banca Verde”) | reguli: 99,0% din formele dexonline, 92–96% pe Wikipedia | **lematizatoare** (aduc fiecare cuvânt din text la forma de bază); **LLM mic local** întrebat „care cuvinte se referă la entitățile din vocabular” |
| **B. Persoane, firme, date personale nedeclarate** | nimic, intenționat (doar identificatorii cu formă fixă) | **detectoare PII / NER** |
| **C. Imagini** | blocate | **modele multimodale** (OCR + B, sau model viziune-limbaj) |

## 2. Candidați găsiți

### A. Lematizatoare pentru română

| Model | Ce e | Licență (de verificat la descărcare) |
|---|---|---|
| spaCy `ro_core_news_sm/md/lg` | pipeline cu lematizator, rapid pe CPU | licența modelului de verificat |
| Stanza (Stanford), română (UD RRT) | lematizator neural | cod Apache 2.0; datele UD RRT au licență proprie |
| Trankit | bazat pe XLM-RoBERTa, mai precis, mai mare | Apache 2.0 |
| UDPipe 2 (ÚFAL) | lematizator UD | modelele sunt probabil necomerciale, de verificat |
| Hunspell ro_RO (rospell) | dicționar + reguli, nu model | MPL 1.1 (compatibil comercial) |

Nu am găsit o comparație directă recentă a lematizării pe română între aceste instrumente ([Universal Lemmatizer](https://arxiv.org/html/1902.00972v2), [Trankit](https://arxiv.org/pdf/2101.03289)). Asta e încă un motiv să le măsurăm noi.

### B. Detectoare de date personale (PII) și entități (NER)

| Model | Mărime | Română | Licență |
|---|---|---|---|
| [OpenAI Privacy Filter](https://openai.com/index/introducing-openai-privacy-filter/) (`openai/privacy-filter`) | 1,5B (MoE, ~50M active) | nedeclarată; în principal engleză | Apache 2.0 |
| [GLiNER2-PII](https://arxiv.org/abs/2605.09973) / [GLiNER2-Guardrails-PII-Multi](https://huggingface.co/fastino/GLiNER2-Guardrails-PII-Multi) (Fastino) | 0,3B, CPU | **nu**: 7 limbi vest-europene | Apache 2.0 |
| [LiquidAI LFM2.5-Encoder-350M-PII](https://huggingface.co/LiquidAI/LFM2.5-Encoder-350M-PII-Detector) | 0,4B | „16 limbi”, nelistate | licență LFM 1.0 (de verificat pentru uz comercial) |
| GLiNER multilingv (zero-shot, etichete în limbaj natural) | ~0,2–0,5B | multilingv, de măsurat | Apache 2.0 (de verificat pe model) |
| [RoNER](https://github.com/dumitrescustefan/roner) (`dumitrescustefan/bert-base-romanian-ner`) | ~0,1B | **da**, antrenat pe RONEC v2 (15 clase) | de verificat |
| [xlm-roberta-base-romanian-ner-ronec](https://huggingface.co/EvanD/xlm-roberta-base-romanian-ner-ronec) | ~0,3B | **da**, raportat 95 F1-macro pe RONEC | de verificat |
| Microsoft Presidio | cadru, nu model | prin spaCy | MIT |

Ce spun evaluările independente din 2026:
- GLiNER2-PII e cel mai bun pe benchmark-ul SPY, iar variantele GLiNER zero-shot sunt cele mai robuste pe date nevăzute ([PII-TRACE](https://arxiv.org/html/2609.22200v1)).
- OpenAI Privacy Filter e foarte bun pe date structurate (e-mail 0,78, telefon 0,76), dar slab pe **nume de persoane (F1 0,40)** și adrese (0,49). Scade puternic în afara distribuției de antrenare ([evaluare pe 32 de benchmark-uri](https://arxiv.org/pdf/2608.02616)).
- Scorurile mari raportate de autori (de exemplu Piiranha 0,946) sunt adesea pe datele lor de antrenare; pe date noi scad mult.
- Benchmark-ul multilingv [REDACT](https://github.com/guneeshvats/REDACT-PII-Benchmark) (25 de limbi) **nu include româna**.

### C. Modele de limbaj mici, locale (și multimodale)

- Pentru română există variante adaptate: RoLLaMA, RoMistral (OpenLLM-Ro). Pe întrebări medicale în română, [RoMistral-7B](https://www.nature.com/articles/s41746-026-02465-0) a fost cel mai bun model open source testat.
- Modele generale mici, cu variante de viziune: familiile Qwen, Gemma, Llama.
- Toate sunt de ordinul GB, cu latență de sute de ms până la secunde pe CPU. Pe telefon sunt greu de folosit pentru fiecare mesaj.

## 3. Ce înseamnă pentru noi

1. **Nu există un model de top care să garanteze româna.** Cele mai bune modele PII din 2026 sunt antrenate pe engleză și limbi vest-europene. Singurele antrenate explicit pe română sunt modelele RONEC. Doar un test pe datele noastre arată cum se descurcă.
2. **Pentru problema A, întrebarea corectă e „lematizator vs. reguli”.** Un detector PII nu știe ce e în vocabularul nostru.
3. **Pentru problema B, un model ar aduce o capacitate nouă** (persoane nedeclarate), pe care acum o refuzăm intenționat. Dacă îl adăugăm, trebuie prezentat ca „plasă suplimentară”, nu ca garanție, la fel ca în decizia G1.
4. **Toate modelele trebuie să ruleze local.** Altfel trimitem în cloud exact datele pe care le protejăm.

## 4. Planul de test: același banc pentru toți

| Test | Problema | Date | Metrica |
|---|---|---|---|
| T1. Formele termenilor declarați | A | propoziții cu forme din dexonline; perechile din Wikipedia; cele ~200 de forme scrise de mână | recall pe forme |
| T2. Mascări greșite | A, B | corpusul de potriviri false (~360.000 de cuvinte, română și engleză) | potriviri pe text fără entitățile declarate |
| T3. Persoane și firme nedeclarate | B | RONEC v2 (test) + setul nostru de evaluare | precizie, recall, F1 pe PERSON/ORG |
| T4. Identificatori | B | IDNP, CNP, IBAN, telefoane MD/RO, carduri (sintetice, valide) | recall; comparat cu tiparele actuale |
| T5. Stabilitate | toate | același text rulat de 10 ori | rezultate identice? |
| T6. Cost | toate | mesaje de 50 / 500 / 5.000 de cuvinte | latență CPU, memorie, mărimea modelului |
| T7. Licență și rulare locală | toate | — | da / nu |

Ordinea propusă:
1. Lematizatoarele (spaCy, Stanza, Trankit) și Hunspell pe T1, T2, T5, T6, pentru că răspund direct la întrebarea administrației.
2. Detectoarele (RoNER, xlm-roberta-RONEC, GLiNER multilingv, OpenAI Privacy Filter, GLiNER2-PII, LFM2.5-PII) pe T2–T6.
3. Un LLM mic local (de exemplu RoMistral-7B sau un Qwen/Gemma mic), doar dacă primele două grupe lasă goluri.

Integrarea: fiecare model rulează printr-un script de test separat. Doar câștigătorii primesc un `Detector` în nucleu, care se poate porni din setări.

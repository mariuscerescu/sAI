# Formele flexionate în română: cercetare și recomandare

> Problema: checklist A1/A2. În run1, „Cebanei”, „Popescului”, „Mariei” și „Băncii Verde” au fost trimise în clar, pentru că dicționarul caută doar forma exactă din vocabular.
> Constrângere: soluția trebuie să meargă pe telefon, în nucleul Rust (Android, iOS, WASM).

---

## 1. Observația care schimbă problema

Nu avem de lematizat un text oarecare, adică de aflat forma de bază a **fiecărui** cuvânt. Avem de recunoscut **formele unui vocabular mic și cunoscut dinainte**: câteva zeci sau sute de termeni.

De aici rezultă două abordări posibile:

| | Lematizare la rulare | Generare la compilarea vocabularului |
|---|---|---|
| Ce face | aduce fiecare cuvânt din text la forma de bază, apoi compară | produce dinainte toate formele fiecărui termen, apoi caută exact |
| Când rulează | la fiecare mesaj, pe tot textul | o dată, când se salvează vocabularul |
| Nevoie de model/lexicon pe telefon | da | nu: formele generate se salvează odată cu vocabularul |
| Viteză la rulare | depinde de model | aceeași ca acum (căutare exactă, Aho-Corasick) |
| Nume proprii („Ceban”) | lematizatoarele le cunosc prost | regulile pentru nume proprii sunt simple |

**Concluzie:** nu avem nevoie de un lematizator la rulare. Generarea formelor, o singură dată, e suficientă și mai potrivită pentru mobil.

---

## 2. Opțiunile analizate

### 2.1 Reguli deterministe proprii (generare de sufixe)

- **Cum funcționează:** pentru fiecare cuvânt al termenului, se adaugă formele flexionate după terminație:

  | Terminație | Exemple de forme generate |
  |---|---|
  | `-u` | Popescu → Popescului, Popescul |
  | consoană | Ceban → Cebanei, Cebanului; Orion → Orionului |
  | `-ul` (articulat) | Proiectul → Proiectului |
  | `-a` | Maria → Mariei; Banca → Băncii |
  | `-e` | Vrabie → Vrabiei |

  Fiecare cuvânt variază independent, deci și „Băncii Verde” e acoperit.
- **Mărime:** zero. Sunt câteva zeci de linii de cod, ușor de portat în Rust.
- **Experiment local** (`scripts/inflection-experiment.ts`, pe vocabularul din evaluare):
  - 23 de termeni au produs 539 de forme;
  - **toate formele care au scăpat în run1 sunt acum găsite:** Cebanei, Popescului, Băncii Verde, Lungului, Vrabiei, Orionului, Proiectului Orion;
  - „Mariei” și „Elenei” singure nu sunt găsite, dar e corect: prenumele singur nu e termen în vocabular. „Mariei Ceban” e găsit;
  - „X9-ului” e deja acoperit de căutare, pentru că cratima e graniță de cuvânt;
  - pe 7.400 de cuvinte de proză românească nu a apărut nicio potrivire falsă. Toate potrivirile au fost mențiuni reale ale numelor. Corpusul e însă mic, deci testul trebuie repetat pe un text mult mai mare.
- **Limite:**
  - alternanțele neregulate ale substantivelor comune: „verde → verzi”, „masă → mese”, „țară → țări”;
  - riscul de potriviri false când un termen e un cuvânt obișnuit (de exemplu o firmă „Mare”). Se atenuează cu termeni din mai multe cuvinte și cu avertisment la compilare.

### 2.2 Lexicon morfologic complet (forme reale ale cuvintelor comune)

| Resursă | Conținut | Licență | Observații |
|---|---|---|---|
| **dexonline** | ~1,4 milioane de forme flexionate, cu export SQL | GNU GPL (o parte a bazei) | Cea mai completă. GPL într-o aplicație mobilă distribuită e o problemă juridică. |
| **Hunspell ro_RO (rospell 3.3.10)** | fișiere `.aff` (reguli) + `.dic` (cuvinte) | tri-licență GPL-2.0 / LGPL-2.1 / **MPL-1.1** | Varianta MPL e compatibilă cu o aplicație comercială. Formele se generează din reguli. Există implementări în C, JS și Rust. |
| **simplemma (date)** | ~342.000 de forme → ~36.000 de leme | cod MIT, date derivate din alte surse | Python. Util doar ca sursă de date, de verificat licența datelor. |

- **Rolul lor:** acoperă exact ce nu pot regulile, adică substantivele și adjectivele comune din numele firmelor („Banca” → „Băncii”, „Verde” → „Verzi”). Nu ajută la numele proprii: „Ceban” nu e în dicționar.
- **Utilizare propusă:** doar la compilarea vocabularului, pe desktop sau o singură dată. Formele rezultate se salvează în vocabular, deci telefonul nu are nevoie de lexicon.

### 2.3 Stemming determinist (Snowball pentru română)

- **Ce este:** un algoritm clasic, cu pași de eliminare a sufixelor (pluraluri, sufixe compuse, terminații verbale, vocala finală).
- **Disponibilitate:** în C, Python, JS și **Rust** (`rust-stemmers` are varianta română). E mic și rapid, deci potrivit pentru mobil.
- **Cum s-ar folosi:** reducerea la rădăcină atât a termenului, cât și a fiecărui cuvânt din text, urmată de comparație.
- **Probleme:**
  - e făcut pentru cuvinte comune, iar pe nume proprii rezultatul e imprevizibil;
  - taie agresiv, deci poate potrivi cuvinte diferite cu aceeași rădăcină, adică produce potriviri false;
  - trebuie rulat pe tot textul, la fiecare mesaj.
- **Rolul potrivit:** **plasă de siguranță în verificatorul de scurgeri** (avertisment, nu mascare automată), nu detecția principală.

### 2.4 Lematizatoare ML

| Instrument | Mărime | Observații |
|---|---|---|
| spaCy `ro_core_news_sm` | ~13 MB (`md`: 43 MB, `lg`: 545 MB) | Python; lematizator antrenabil; are nevoie de context și de etichete morfologice. |
| UDPipe 2 | nu am găsit mărimea modelului românesc | lematizarea e tratată ca o clasificare în reguli de generare; antrenat pe treebank-urile UD. |
| LemmaGen | modele mici pe bază de reguli | reguli învățate din lexicoane MULTEXT-East; nu am găsit un model românesc confirmat. |
| Stanza, modele BERT | sute de MB | nepotrivite pentru mobil. |

- **De ce nu le recomand:**
  - lematizarea întregului text la fiecare mesaj e mai lentă și mai grea decât o căutare exactă;
  - numele proprii (exact ce protejăm) sunt punctul lor slab;
  - nu sunt deterministe: același cuvânt poate primi altă lemă în alt context;
  - pe mobil ar cere un runtime ML (ONNX/TFLite) pentru un câștig mic față de reguli.

---

## 3. Recomandarea: trei straturi, toate deterministe

| Strat | Ce face | Unde rulează | Mărime |
|---|---|---|---|
| **1. Generator de forme (reguli)** | la salvarea vocabularului, generează flexiunile fiecărui cuvânt; toate formele intră în automatul de căutare și duc la aceeași intrare | nucleu (Rust/TS), oriunde | 0 |
| **2. Completare din lexicon (opțional)** | pentru cuvintele comune din termeni („Banca”, „Verde”), adaugă formele reale din Hunspell ro_RO (licență MPL) | desktop sau o dată la configurare; rezultatul se salvează în vocabular | lexiconul doar pe desktop |
| **3. Plasă de siguranță** | verificatorul de scurgeri caută și rădăcini (Snowball) sau potriviri la o literă diferență; avertizează sau blochează | nucleu | foarte mic |

Pe lângă cele trei straturi:
- **Transparență:** pagina de setări arată, sub fiecare termen, formele generate. Utilizatorul poate debifa o formă greșită sau adăuga una lipsă. Formele bifate se salvează în vocabular.
- **Restaurare:** o formă flexionată primește simbolul formei de bază, iar la restaurare se pune forma de bază. Preambulul îi cere modelului construcții analitice („lui ⟦PERSON_1⟧”, „al ⟦COMPANY_1⟧”), ca textul restaurat să rămână gramatical.
- **Potriviri false:** la compilare, avertisment pentru termenii de un singur cuvânt care sunt și cuvinte comune (verificat cu lexiconul, dacă există).

---

## 4. Cum verificăm

1. **Test de recall:** o listă de ~200 de forme flexionate pentru nume tipice din Moldova și România, de persoane și firme. Toate trebuie găsite cu simbolul corect.
2. **Test de potriviri false:** un corpus mare de text românesc fără numele din vocabular (știri, documentație). Ținta: zero potriviri pentru termenii din mai multe cuvinte; potrivirile pentru termenii dintr-un singur cuvânt sunt listate și verificate manual.
3. **Rerularea cazurilor A3, B1, B3, B4 și F1** din evaluare: nicio scurgere.
4. **Verificatorul independent din `run-eval.ts`** folosește același generator (checklist E1).

---

## Surse

- [Snowball: algoritmul de stemming pentru română](https://snowballstem.org/algorithms/romanian/stemmer.html)
- [rust-stemmers (include româna)](https://docs.rs/crate/rust-stemmers/1.2.0/source/src/lib.rs)
- [dexonline: informații despre date și licență](https://wiki.dexonline.ro/wiki/Informa%C8%9Bii) · [protocolul de export](https://wiki.dexonline.ro/wiki/Protocol_de_exportare_a_datelor_v5) · [~1,4 milioane de forme (Adevărul)](https://adevarul.ro/stil-de-viata/cultura/curiozitati-despre-dex-online-1628099.html)
- [Hunspell ro_RO: pachetul Arch (GPL/LGPL/MPL)](https://archlinux.org/packages/extra/any/hunspell-ro/) · [dictionary-ro pe npm](https://npmjs.com/package/dictionary-ro) · [README rospell](https://parrot.mirror.garr.it/mirrors/pub/vim/runtime/spell/README_ro.txt)
- [simplemma: limbi suportate](https://adbar.github.io/simplemma/supported-languages/)
- [spaCy v2.3: modelele românești și mărimile lor](https://explosion.ai/blog/spacy-v2-3) · [ro_core_news_sm pe Hugging Face](https://huggingface.co/spacy/ro_core_news_sm/tree/main)
- [UDPipe la SIGMORPHON 2019 (lematizarea ca clasificare)](https://ar5iv.labs.arxiv.org/html/1908.06931)
- [LemmaGen: lematizare multilingvă (JUCS 2010)](https://www.jucs.org/jucs_16_9/lemma_gen_multilingual_lemmatisation.html)

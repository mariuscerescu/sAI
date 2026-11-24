# Limitele cunoscute ale primei versiuni

> Data: 2026-11-24 · Versiunea: sAI cu verificatorul local Decider-Flash v1.3, modul `all`, pragul 0,2.
> Prima versiune este acceptată așa cum este, cu limitele de mai jos. Fiecare limită are măsurătoarea care o susține și, unde există, o idee de reparație.

## 1. Ce garantează sAI și ce nu

- **Sunt protejate doar valorile declarate** în vocabular și identificatorii recunoscuți de tipare (IDNP, IBAN, card, telefoane și altele). Aceasta este decizia de bază a proiectului.
- **O persoană nedeclarată ajunge la model așa cum este scrisă.** În testele reale, „Will Baker” și „Victor Hale” au fost trimise neschimbate, pentru că nu erau în vocabular.
- **Verificatorul este oprit implicit.** Oprit, sAI funcționează ca înainte de verificator; singura diferență sunt simbolurile înrudite (secțiunea 6).
- **Vocabularul este păstrat necriptat** în profilul DSH de pe calculator.

## 2. Nume care pot scăpa

Rularea finală pe partea nevăzută a setului înghețat a găsit **4 scăpări reale din 5.445 de nume dintr-un cuvânt (0,073%; interval de 95%: 0,029%–0,189%)**. Ținta fixată dinainte era 0. Detalii în [eval/results/frozen-final.md](../eval/results/frozen-final.md).

| Tip | Exemplu | Idee de reparație |
|---|---|---|
| Prenume scris cu literă mică, folosit ca destinatar | „write a text to art”, unde Art este o persoană, iar în aceeași propoziție apare și „new art” | nicio idee sigură; rămâne limită |
| Nume de familie după un titlu de politețe | „Mr./Ms. Black” | un cuvânt din vocabular aflat imediat după un titlu se maschează fără model |
| Prenume într-o adresare directă | „That's great, Son.”, deși „SON HA” fusese mascat mai sus | dacă un cuvânt a fost recunoscut ca nume în mesaj, forma lui cu majusculă rămâne mascată în tot mesajul |

Alte limite de protecție:

- **În modul `all`, numele scrise cu majusculă depind de model.** Utilizatorul a acceptat acest lucru pe 2026-11-19. Două dintre cele patru scăpări sunt de acest tip.
- **Un nume de două litere identic cu un cuvânt uzual și scris cu literă mică** nu este trimis la model și rămâne nemascat. De exemplu, „do” pentru Do Tran.
- **Textul manipulat intenționat**, de exemplu o propoziție care convinge modelul că un nume este cuvânt obișnuit, poate scoate o mască. Pe 20 de cazuri construite așa au scăpat 6 în `all` și 3 în `lowercase`. Utilizatorul a scos acest caz din prima versiune.
- **Identificatorii `camelCase`** (`AcmeClient`, `billTurner`) nu sunt detectați.
- **Numele scrise cu alt alfabet** (de exemplu chirilic) și **greșelile de scriere** nu sunt detectate.
- **Un nume lipit de un identificator** (`gb_total`) este mascat fără model, dar simbolul introdus în identificator poate strica codul trimis.

## 3. Cuvinte obișnuite ascunse inutil

- **Pe partea finală:** 40 din 2.462 de cuvinte-capcană (1,62%; interval de 95%: 1,20%–2,20%). Ținta era cel mult 2%.
- **Cazuri tipice:** cuvinte care sunt și nume sau mărci („visa”, „green”, „art”), mai ales cu majusculă la început de propoziție („Grant applications close…”).
- Procentul se referă la cuvinte-capcană alese intenționat dificile, nu la toate cuvintele unui mesaj.
- **Modul `lowercase`** ascunde inutil 16,90%, pentru că nu întreabă modelul despre formele cu majusculă.

## 4. Verificatorul local: viteză și funcționare

- **Viteza este la limita țintei.** Pe calibrare, timpul adăugat a fost sub 1,03 s la 95% din mesaje, cu ținta de 1 s. Pe partea finală, apelul la verificator a fost sub 0,86 s la 95% din mesaje.
- **Timpul depinde de placa video.** Când alte programe o foloseau, valoarea de 95% a urcat la 1,42 s.
- **Textele lungi sunt lente:** pe articole Wikipedia, mediana a fost 3,9 s pe apel și aproximativ 23 s la 95% din apeluri. La depășirea timpului, tot ce s-a întrebat este mascat.
- **Hardware:** modelul rulează în 4 biți pe o placă de 8 GB. Varianta rapidă a modelului cere Triton, care nu are pachete pentru Windows.
- **Serviciul se pornește separat**, ca proces Python local. Dacă nu rulează, fiecare cuvânt întrebat este mascat.
- **Variație între loturi:** scorul aceleiași întrebări poate varia cu până la 0,035, în funcție de celelalte întrebări din lot. Cel mai slab nume real de pe calibrare, „hope”, este la 0,045 deasupra pragului.

## 5. Limba română

- **Prima versiune este măsurată doar pe engleză.**
- Într-un text recunoscut ca românesc, modelul poate doar adăuga măști. De aceea, cuvintele obișnuite mascate de reguli („Lupul”, „Florile”) rămân mascate.
- **Un text scurt fără semne de limbă** nu este recunoscut ca românesc, deci modelul poate scoate o mască.
- **„Apoi rusu” / „Then bill”:** în modul `lowercase` și în română, regula veche lipește cuvântul cu majusculă de nume și creează o persoană nouă. Nu se scurge nimic, dar persoana primește alt simbol.

## 6. Restaurarea răspunsului

- **Formele flexionare revin în forma declarată:** „Popescului” devine „Popescu”, iar „the johnsons” devine „the Johnson”.
- **Fiecare formă scrisă a unui nume primește un simbol înrudit** (`⟦PERSON_1⟧`, `⟦PERSON_1_2⟧`). Modelul vede mai multe simboluri, iar uneori menționează legătura, de exemplu „Acme (i.e., Acme Logistics)”. În testul real a făcut asta în 2 din 56 de rulări.
- **Valorile găsite prin tipare** (de exemplu un telefon scris în două feluri) păstrează un singur simbol și revin în formatul primei apariții.
- **Simbolurile inventate de model** rămân în răspuns, iar raportul le semnalează.
- **Acordul gramatical și genul** după restaurare nu sunt garantate.

## 7. Sarcini pe care modelul nu le poate face

Modelul nu vede valorile reale, deci nu poate:
- da inițialele unui nume sau număra literele lui;
- construi o adresă de e-mail din nume;
- deduce genul unei persoane;
- valida sau decoda un identificator (IBAN, SSN, IDNP).

**Simbolurile grecești sunt mai slabe decât cele `typed`:** modelul le tratează uneori ca simboluri matematice. Strategia implicită rămâne `typed`.

## 8. Ce nu a fost testat

- **Aplicația desktop, cu verificatorul pornit,** nu a fost testată în interfața grafică. Pluginul construit a fost testat în runtime-ul DSH.
- **Sarcinile de agent cu unelte**, de tipul crearea sau redenumirea de fișiere, nu au fost testate cu modelul real.
- **Testul real** a folosit modelul gratuit `nemotron-3-ultra`, pentru că modelul folosit anterior nu mai este gratuit. Rezultatele nu se compară direct cu cele vechi.

## 9. Limitele evaluării

- **Etichetele din sursa Nemotron au erori:** 6 din cele 10 scăpări brute ale rulării finale erau etichete greșite.
- **Partea finală a fost folosită.** O reparație poate fi verificată o singură dată pe partea de rezervă, care are 929 de nume dintr-un cuvânt. Chiar și cu 0 scăpări, ea arată doar că rata este sub aproximativ 0,32%.
- **Pentru o garanție sub 0,1%** este nevoie de un set nou și independent.

## 10. Ordinea recomandată pentru versiunea următoare

1. Cele două reguli din secțiunea 2: numele după titlu și forma cu majusculă deja recunoscută în mesaj. Se măsoară pe calibrare și se verifică pe rezervă.
2. Un set de test nou și independent pentru garanția sub 0,1%.
3. Viteza: Linux cu varianta rapidă a modelului sau o placă video mai mare.
4. Evaluarea pentru limba română, cu aceeași metodă ca pentru engleză.
5. Apărarea împotriva textului manipulat.
6. Detectarea identificatorilor `camelCase`.

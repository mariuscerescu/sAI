# Corpusul de test

Testele de potriviri false rulează pe articole din Wikipedia, descărcate local prin API-ul MediaWiki (`action=query&prop=extracts&explaintext=1`). Textele nu sunt incluse în repository. Licența lor este CC BY-SA, iar ele pot fi descărcate oricând din nou.

| Folder | Conținut | Folosit pentru |
|---|---|---|
| `ro-wiki/` | 30 de articole de pe ro.wikipedia.org (~232.000 de cuvinte). Jumătatea A are indicii pari, jumătatea B indicii impari, în ordine alfabetică. | Jumătatea B: testul de potriviri false în română |
| `ro-wiki-extra/` | 52 de articole generale (~116.000 de cuvinte) | O listă de cuvinte obișnuite, ulterior eliminată; nu mai e folosit |
| `en-wiki/` | 29 de articole de pe en.wikipedia.org (~254.000 de cuvinte) | Testul de potriviri false în engleză |

Fiecare fișier se numește după titlul articolului (spațiile devin `_`) și conține textul simplu al paginii.

**Exemple de cereri:**
- `https://ro.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=Marea_Neagră`
- `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=Democracy`

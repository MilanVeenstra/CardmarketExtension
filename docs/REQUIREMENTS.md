# Functionele requirements — Cardmarket Cart Saver

Stand van zaken: versie 1.0.0 (branch `claude/cardmarket-cart-extension-fvfwx5`).

Dit document beschrijft:

- **Deel A** — wat de extensie nu doet (geïmplementeerd en getest).
- **Deel B** — wat er nog niet is, maar wel handig kan zijn, onderbouwd met
  research.

Notatie:

- `FR-xx` is een functionele requirement en `NFR-xx` een niet-functionele.
- De kolom *Test* verwijst naar de end-to-end-test in `tests/e2e.test.mjs`.
  Die draait tegen een nagebootste Cardmarket.

> Alles in deel A is getest tegen een nagebootste Cardmarket met echte
> Cardmarket-HTML en -endpoints. Op de live site is het nog **niet**
> geverifieerd: cardmarket.com was vanuit de ontwikkelomgeving niet bereikbaar.

---

## Deel A — Wat nu werkt

### A1. Winkelmandje automatisch opslaan

| ID | Requirement | Test |
|---|---|---|
| FR-01 | Bij elk bezoek aan de winkelmandjepagina (`/{taal}/{spel}/ShoppingCart`) slaat de extensie elk artikel op met: artikel-ID, product, naam, set, nummer, verkoper, conditie, taal, foil/extra's, prijs, aantal, product-URL, afbeelding en opmerking. | ✔ |
| FR-02 | Op elke andere Cardmarket-pagina vergelijkt de extensie de mandjesteller in de header met de vorige keer. Is die veranderd, dan haalt ze het mandje één keer op en werkt de lijst bij. | ✔ |
| FR-03 | Verandert de teller live, bijvoorbeeld als je op de site op "in winkelmandje" klikt, dan wordt het nieuwe artikel binnen ~1,5 s opgeslagen, zonder dat je de pagina herlaadt. | ✔ |
| FR-04 | Artikelen die dubbel op de pagina staan (desktop- en mobiele weergave) worden één keer opgeslagen. | ✔ |
| FR-05 | Een artikel dat uit het mandje verdwijnt, wordt **niet** verwijderd. Het krijgt de status *ontbreekt*. Mogelijke statussen: *in mandje*, *ontbreekt*, *niet beschikbaar*. | ✔ |
| FR-06 | Een artikel dat je zelf met het prullenbakje op de mandjepagina verwijdert, wordt vergeten in plaats van als ontbrekend gemarkeerd (binnen 10 minuten na de klik). | — |
| FR-07 | Artikelen die op een bestelpagina (`/Orders/…`) staan, zijn gekocht en worden uit de lijst gehaald. | ✔ |
| FR-08 | Automatisch opslaan kan uit. Op de mandjepagina staat dan de knop *Huidig mandje opslaan*. | — |
| FR-09 | Werkt per spel (Magic, Pokémon, Yu-Gi-Oh!, …) en in elke sitetaal (en, de, fr, es, it). Het spel van elk artikel wordt afgeleid uit de product-URL. | ✔ (deels) |
| FR-10 | Ben je uitgelogd, dan doet de extensie niets met de lijst: een loginpagina wordt nooit als leeg mandje gezien. | ✔ |

### A2. Leeg mandje herkennen en melden

| ID | Requirement | Test |
|---|---|---|
| FR-11 | Ontbreken er opgeslagen artikelen, dan verschijnt rechtsonder op Cardmarket een melding met het aantal en de totale waarde, plus de knoppen *Zet terug* en *Bekijken*. | ✔ |
| FR-12 | Wegklikken onthoudt de melding voor precies deze set ontbrekende artikelen. Verdwijnen er nieuwe artikelen, dan komt hij terug. | — |
| FR-13 | Het icoon in de werkbalk toont het aantal ontbrekende artikelen (badge). | ✔ |
| FR-14 | Op de mandjepagina toont een paneel de ontbrekende artikelen, elk met een vinkje, plus *alles/niets selecteren* en de totale waarde van de selectie. | ✔ |
| FR-15 | Niet-beschikbare artikelen staan in een aparte groep. Daarin staan de reden van Cardmarket, de knoppen *Zoek vergelijkbaar aanbod*, *Toch opnieuw proberen* en *Lijst opschonen*. | ✔ |
| FR-16 | Het paneel kan worden ingeklapt tot een klein label. Die keuze wordt onthouden. | — |

### A3. Terugzetten in het winkelmandje

| ID | Requirement | Test |
|---|---|---|
| FR-17 | Je kunt terugzetten met één klik: vanuit de melding, het mandjepaneel of de popup, voor alle ontbrekende artikelen of voor één artikel. | ✔ |
| FR-18 | Het terugzetten draait in een Cardmarket-tab, met je eigen sessie. Start je het vanuit de popup terwijl je niet op Cardmarket zit, dan opent de extensie je winkelmandje en start het daar vanzelf (de actie wacht maximaal 2 minuten). | ✔ |
| FR-19 | Vooraf wordt het actuele mandje gecontroleerd. Artikelen die er al in zitten, worden overgeslagen, zodat aantallen nooit verdubbelen. | ✔ |
| FR-20 | Is het mandje niet betrouwbaar te lezen (bijvoorbeeld door een layoutwijziging), dan weigert de extensie te starten. | ✔ |
| FR-21 | Artikelen gaan één voor één terug, met een instelbare pauze (standaard 1,2 s plus een willekeurige 0–0,4 s). | ✔ |
| FR-22 | De extensie gebruikt het CSRF-token van de pagina. Weigert Cardmarket dat, dan haalt ze één keer een vers token op. | ✔ |
| FR-23 | Er zijn twee bekende toevoeg-endpoints. Werkt het eerste niet, dan volgt het tweede, en het werkende endpoint wordt onthouden. | ✔ |
| FR-24 | Bij HTTP 429 wacht de extensie volgens `Retry-After` (maximaal 60 s) en probeert het tot 2× opnieuw. Daarna stopt ze. | — |
| FR-25 | Bij een Cloudflare-controle, uitloggen of een netwerkfout stopt de extensie direct, met een duidelijke melding. Artikelen worden dan niet ten onrechte als *niet beschikbaar* gemarkeerd. | ✔ |
| FR-26 | Na afloop wordt het mandje opnieuw gelezen en krijgt elk artikel de juiste status. De weigeringsreden van Cardmarket wordt bewaard. | ✔ |
| FR-27 | De voortgang is live te volgen in het paneel en in de popup, en het terugzetten is te stoppen. Er draait maximaal één actie tegelijk, over alle tabs heen. | ✔ |
| FR-28 | Na het terugzetten op de mandjepagina herlaadt de pagina vanzelf, met een samenvatting ("X in je mandje gezet, Y niet beschikbaar"). | ✔ |
| FR-29 | *Zoek vergelijkbaar aanbod* opent de productpagina, gefilterd op dezelfde taal, minimaal dezelfde conditie en dezelfde foil-status. | ✔ |

### A4. Favorieten

| ID | Requirement | Test |
|---|---|---|
| FR-30 | Naast elke aanbieding staat een ☆, op productpagina's, kaartpagina's, verkoperspagina's en in het winkelmandje. Eén klik bewaart dat specifieke artikel; nog een klik haalt het weg. | ✔ |
| FR-31 | Een favoriet bewaart: verkoper, conditie, taal, foil/extra's, prijs, voorraad, product-URL, afbeelding en de datum. | ✔ |
| FR-32 | Aanbiedingen die later worden bijgeladen (via "meer laden") krijgen ook een ster. | — |
| FR-33 | De popup heeft een tab *Favorieten*: nieuwste bovenaan, met het aantal in de tabnaam en zoeken op naam, set, verkoper, taal en conditie (meerdere woorden mogelijk). | ✔ |
| FR-34 | *Bekijk aanbieding* opent de productpagina, gefilterd op taal en conditie, en springt naar de aanbieding. Die wordt gemarkeerd. | ✔ |
| FR-35 | Staat de aanbieding niet op de pagina, dan volgt een melding met links naar de voorraad van de verkoper en naar vergelijkbaar aanbod. | ✔ |
| FR-36 | *Zoek bij deze verkoper* opent de voorraad van de verkoper, gezocht op deze kaart. | ✔ |
| FR-37 | *In winkelmandje leggen* zet 1 exemplaar in je mandje via hetzelfde mechanisme als terugzetten. Daarna toont de popup het label *In mandje*. | ✔ |
| FR-38 | Is een favoriet verkocht, dan krijgt hij de markering *niet meer beschikbaar*, met de reden van Cardmarket. Hij blijft dan niet als opgeslagen mandje-artikel achter. | ✔ |
| FR-39 | Kom je een favoriet tegen op Cardmarket, dan worden de prijs en de voorraad bijgewerkt, zonder extra verzoeken. | ✔ |

### A5. Popup, instellingen en data

| ID | Requirement | Test |
|---|---|---|
| FR-40 | De tab *Winkelmandje* in de popup toont: tellers (in mandje / ontbreekt / niet beschikbaar), de knoppen *Zet N terug* en *Open winkelmandje*, filters en een lijst per verkoper. Per artikel zijn er acties: ster, vergelijkbaar aanbod, terugzetten en verwijderen. | ✔ |
| FR-41 | Heb je artikelen uit meerdere spellen, dan is er een spelkeuze. | — |
| FR-42 | Instellingen: automatisch opslaan aan/uit, melding aan/uit, pauze tussen artikelen (0,5–10 s). | ✔ |
| FR-43 | Export naar JSON (artikelen en favorieten). Bij import worden nieuwe artikelen toegevoegd zonder bestaande te overschrijven. *Alles wissen* vraagt eerst om bevestiging. | — |
| FR-44 | De interface is Nederlands of Engels, afhankelijk van de taal van de browser, en ondersteunt een lichte en een donkere modus. | ✔ (NL) |

### A6. Niet-functioneel

| ID | Requirement |
|---|---|
| NFR-01 | **Privacy.** Alle data staat lokaal in `chrome.storage.local`. Er is geen server en er worden geen wachtwoorden opgeslagen. De extensie praat alleen met `www.cardmarket.com`, via de sessie van de gebruiker. |
| NFR-02 | **Minimale permissies:** `storage` en de host-permissie voor `https://www.cardmarket.com/*`. |
| NFR-03 | **Fatsoenlijk gebruik.** Verzoeken worden alleen gedaan na een klik of na een verandering van de mandjesteller, nooit op een timer en altijd één tegelijk. |
| NFR-04 | **Liever niets doen dan iets fout doen.** Bij twijfel (onleesbare pagina, uitgelogd, controle van Cardmarket) worden geen statussen aangepast en geen artikelen toegevoegd. |
| NFR-05 | **Platform:** Chrome, Edge, Brave en Opera (Manifest V3), zonder build-stap. |
| NFR-06 | **Isolatie.** De interface op Cardmarket draait in een shadow DOM, zodat de CSS van de site en die van de extensie elkaar niet raken. |
| NFR-07 | **Testbaarheid.** Er zijn 22 end-to-end-tests met Playwright, tegen een nagebootste Cardmarket. |

### A7. Bekende beperkingen

| Beperking | Gevolg |
|---|---|
| Niet geverifieerd op de live site | Selectors en endpoints komen uit opgeslagen echte HTML en open-source tools. Een kleine aanpassing kan nodig zijn. |
| Een artikel is één aanbieding van één verkoper | Is die verkocht, dan kan hij niet terug. Er is alleen een link naar vergelijkbaar aanbod. |
| Eén mandje per spel is een aanname | De extensie werkt in beide gevallen, maar de status van artikelen uit een ander spel wordt pas bijgewerkt als je een pagina van dat spel bezoekt. |
| De prullenbak-detectie is heuristisch | Wordt een handmatige verwijdering gemist, dan staat het artikel als *ontbreekt* in de lijst en moet je het zelf wegklikken. |
| Favorieten worden alleen passief bijgewerkt | Een verkochte favoriet merk je pas als je hem probeert toe te voegen of opent. |
| Het taalfilter werkt alleen met Engelse taalnamen | Op een Duitse of Franse site werkt *vergelijkbaar aanbod* voor favorieten zonder taalfilter. |
| Geen synchronisatie tussen apparaten | Alleen via export en import. |
| Geen Firefox | Dat vraagt aanpassingen aan de manifest en de achtergrondscripts. |

---

## Deel B — Ideeën voor uitbreiding

_Wordt aangevuld met de resultaten van het onderzoek._

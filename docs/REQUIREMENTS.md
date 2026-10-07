# Functionele requirements — Cardmarket Cart Saver

Stand van zaken: versie 1.0.0 (branch `claude/cardmarket-cart-extension-fvfwx5`).

Dit document beschrijft:

- **Deel A** — wat de extensie nu doet (geïmplementeerd en getest).
- **Deel B** — wat er nog niet is, maar wel handig kan zijn, onderbouwd met
  research, met prioriteiten en een roadmap.

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

### B0. Wat het onderzoek oplevert

Onderzocht zijn:

- bestaande Cardmarket-extensies en -scripts;
- klachten en wensen van kopers (fora, Trustpilot, nieuwsberichten van
  Cardmarket);
- de data die Cardmarket zelf openbaar maakt;
- extensies van andere webwinkels en TCG-tools.

Bronnen staan in [B10](#b10-bronnen). Labels: **[Officieel]** = een pagina van
Cardmarket, **[Code]** = gecontroleerd in open-source code of opgeslagen
HTML, **[Derden]** = een gids of forum, **[Afgeleid]** = een eigen inschatting.

**Concurrentie.**

- *Enhanced Cardmarket* (~2K gebruikers) dekt al veel:
  - filters en standaardtalen;
  - ingelogd blijven;
  - prijsalarmen en een eigen prijsgeschiedenis;
  - een snelle blik op het mandje.
- Andere tools doen elk één ding:
  - offers kleuren tegenover de trendprijs (Cardmarket Helper, Boris);
  - een blocklist van verkopers (CM Helper);
  - een verzendschatting (Cardmarket Companion);
  - optimaliseren vanuit een wants-lijst (Regroupeur, Cardmarket Optimizer,
    cardmarket_wizard).
- **De kant van het winkelmandje is het minst bediend:**
  - wat kost dit mandje echt, inclusief verzending;
  - welke verkopers zitten er al in;
  - wat gebeurt er met verkochte artikelen.

  Daar heeft Cart Saver al data en dus een voorsprong. **[Afgeleid]**

**Bruikbare databronnen.**

| Bron | Wat | Status |
|---|---|---|
| `downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_{spel-id}.json` | Prijsgids per spel (Magic = 1, Yu-Gi-Oh! = 3, Pokémon = 6, One Piece = 18, Lorcana = 19, …). Bevat per `idProduct`: `low`, `trend`, `avg1`, `avg7`, `avg30`, plus foil-varianten (bij Pokémon met `-holo`). Wordt dagelijks bijgewerkt (~02:48), is openbaar en vraagt geen login. Er is geen opsplitsing naar taal of conditie. | **[Officieel]** en **[Code]**. Er zijn geen CORS-headers, dus ophalen moet via de service worker met een extra host-permissie. Bestanden zijn ~20 MB, dus bewaar alleen relevante producten. |
| `help.cardmarket.com/api/shippingCosts?fromCountry=…&toCountry=…` | De verzendmethoden tussen twee landen, met prijs, `maxValue`, `maxWeight`, en of het een brief of een tracked zending is. | **[Code]**, gecontroleerd in Lugin. Niet officieel gedocumenteerd. |
| Inline grafiek op de productpagina | Ongeveer 30 dagen gemiddelde verkoopprijs (`new Chart(...)`), gratis mee te lezen bij elk bezoek. | **[Code]** |
| `input[name="idProduct"]` op productpagina's, en `data-product-id` op mandjesrijen | Koppelt een pagina of artikel aan de prijsgids. Scryfall's `cardmarket_id` is hetzelfde nummer. | **[Code]** |
| AJAX-acties voor wants-lijsten (`Wantslist_AddWant`, `AddDeckList`, …) | Wants-lijsten aanmaken en vullen met hetzelfde token-mechanisme als het mandje. | **[Code]** (Lugin) |

**Randvoorwaarden.**

- **Tracked verzending** is verplicht boven €25. In sommige gevallen, zoals
  bij nieuwe verkopers, is dat al boven €10. **[Officieel]**
- **Internationaal versturen** met tracked brieven is sinds 2026 vervallen,
  waardoor internationale verzending duurder is. **[Officieel]** en
  **[Derden]**
- **De Shopping Wizard** vindt niet altijd de goedkoopste combinatie.
  - Er geldt een limiet van ~10 runs per dag en 150 items per wants-lijst.
  - "Alles in mandje" vraagt 6 afgeronde aankopen.
  - **[Officieel]**
- **Voorwaarden van Cardmarket.**
  - Apps van derden zijn voor eigen risico.
  - Prijzen publiek tonen vraagt toestemming.
  - Data dus lokaal houden en nooit herpubliceren. **[Officieel]**
- **Hoe lang artikelen in het mandje blijven**, daarover is niets officieels
  gevonden. **[Derden]**: ~1–2 uur inactiviteit.

### B1. Top 5 — grootste waarde voor de minste moeite

1. **Diagnose op de live site** (IDEE-01). De extensie is nog niet op
   cardmarket.com getest. Een knop "controleer of alles werkt" maakt problemen
   direct zichtbaar.
2. **Kostenpaneel per verkoper en drempeladvies** (IDEE-10 en IDEE-11).
   Verzendkosten zijn de grootste ergernis van kopers, en de tracked-sprong
   boven €25 is een bekende valkuil.
3. **Prijs-tegenover-trend en prijsalarmen** (IDEE-05 en IDEE-07), via de
   openbare prijsgids, dus zonder extra verzoeken aan de site.
4. **Slim vervangen van verkochte artikelen** (IDEE-14): het logische vervolg
   op terugzetten.
5. **Recent bekeken en labels/notities bij favorieten** (IDEE-18 en IDEE-19).
   Dat sluit direct aan op "makkelijk terugvinden".

Notatie in de tabellen hieronder:

- **Moeite:** S = uren, M = 1–3 dagen, L = een week of meer.
- **Prio** (MoSCoW voor de volgende versies): **M**ust, **S**hould,
  **C**ould, **W**on't (voorlopig niet).

### B2. Robuustheid en vertrouwen

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-01 | **Zelftest en diagnose.** Een knop in de instellingen controleert op de huidige Cardmarket-pagina of de extensie alles vindt: mandjesrijen, mandjesteller, token, aanbiedingsrijen. Het rapport is te kopiëren. | Selectors komen uit opgeslagen HTML en zijn nog niet live geverifieerd. Bij een layoutwijziging zie je zo meteen waar het misgaat. **[Afgeleid]** | S | M |
| IDEE-02 | **Uitleg waarom terugzetten mislukte.** Onderscheid tussen verkocht, verkoper op vakantie, minder exemplaren beschikbaar en prijs gewijzigd. Herkenbaar aan de melding van Cardmarket en aan het aanbod bij de verkoper. | Vakantiestand verbergt aanbod **[Officieel]**. Nu zie je alleen de ruwe melding. | S–M | S |
| IDEE-03 | **"Prijs veranderd sinds je hem opsloeg".** Vergelijkt na het terugzetten de prijs in het mandje met de opgeslagen prijs en waarschuwt bij een stijging. | Kost geen extra verzoeken: de controle achteraf leest het mandje al. Geen enkele bestaande tool doet dit. **[Afgeleid]** | S | M |
| IDEE-04 | **Waarschuwing bij verkopers.** Waarschuwt voor afrekenen bij een rode stip, een nieuwe verkoper of weinig verkopen, met een hint naar de Trustee Service boven €25. | Klachten over kwijtgeraakte of beschadigde zendingen **[Derden]**. Regels voor beoordelingen en Trustee Service **[Officieel]**. | S–M | C |

### B3. Prijsinzicht

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-05 | **Prijs tegenover trend.** Een label als "−12% / +30% t.o.v. trend" in het mandje, bij favorieten en bij aanbiedingen. Gebruikt de dagelijkse prijsgids, met foil (of holo) apart. | Gevraagd en gebouwd door Cardmarket Helper, Boris en Enhanced Cardmarket **[Code]**. Bronnen: prijsgids **[Officieel]**, `data-product-id` **[Code]**. | M | S |
| IDEE-06 | **Lokale prijsgeschiedenis met een mini-grafiek** per favoriet of mandje-artikel. Bronnen: de 30-dagengrafiek op de productpagina, dagelijkse momentopnames van de prijsgids en eigen waarnemingen van het aanbod. | Cardmarket toont maar 30 dagen, en geschiedenis valt niet achteraf in te vullen, dus nu beginnen loont **[Derden]** en **[Code]**. | M | S |
| IDEE-07 | **Doelprijs en prijsalarm.** Stel per favoriet of product een doelprijs in. Een dagelijkse check (`chrome.alarms`, na 03:00) stuurt een melding als trend of laagste prijs eronder zakt. | Kernfunctie van Keepa, CamelCamelCamel en Honey Droplist **[Derden]**. Gebruikt de prijsgids, dus geen belasting voor de site. | M | S |
| IDEE-08 | **Wijzigingen bij favoriete producten** zichtbaar op de productpagina: nieuw aanbod sinds je laatste bezoek, gewijzigde prijzen en verdwenen aanbiedingen. | TCG Market Wizard **[Derden]**. Werkt passief, dus zonder extra verzoeken. | M | C |
| IDEE-09 | **Valuta tonen** (GBP, SEK, CHF, DKK, PLN) via de dagelijkse koersen van de ECB. | Cardmarket kent alleen GBP, en dan alleen voor accounts uit het VK **[Officieel]**. Voor Nederlandse gebruikers weinig nut. | S | C |

### B4. Verzendkosten en de economie van het mandje

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-10 | **Kostenpaneel per verkoper.** Toont per verkoper: subtotaal, verzendkosten, kosten per kaart en het aandeel verzending. Signaleert dure gevallen, zoals "1 kaart van €0,10 met €1,25 verzending". | Verzendkosten zijn de grootste klacht **[Derden]**, en ze stijgen in 2026 **[Officieel]**. De data staat al op de mandjepagina. | M | M |
| IDEE-11 | **Drempeladvies.** Waarschuwt bij een verkoper vlak onder of boven €25 (tracked verplicht, dus een duurdere methode) en bij gewichtsgrenzen van brieven (~4, 17 of 40 kaarten). Stelt voor wat je kunt weglaten of toevoegen. | €25-regel **[Officieel]**. De verzend-API geeft `maxValue` en `maxWeight` **[Code]**. Regroupeur rekent hier al mee **[Code]**. | M | S |
| IDEE-12 | **"Verkoper zit al in je mandje"** bij aanbiedingen: een groene markering en "+€0 verzending" tegenover "+€1,25 nieuwe zending". | CM Helper en Lugin **[Code]**. Komt direct uit de opgeslagen mandjedata. | M | S |
| IDEE-13 | **Geschatte verzendkosten per aanbieding,** op basis van het land van de verkoper ("Item location") en de verzend-API. Wordt per land gecachet. | Cardmarket Companion en scripts van Hukutus **[Derden]**. | M | C |
| IDEE-14 | **Slim vervangen van verkochte artikelen.** Zoekt voor een niet-beschikbaar artikel het goedkoopste gelijkwaardige aanbod: zelfde product en taal, minimaal dezelfde conditie, zelfde foil. Verkopers die al in je mandje zitten krijgen voorrang, want dat scheelt verzending. Vervangen kan met één klik. | Het logische vervolg op terugzetten. Kost één productpagina per artikel, alleen na een klik en in rustig tempo. **[Afgeleid]** | L | S |
| IDEE-15 | **Van mandje naar wants-lijst en Shopping Wizard.** Maakt van de ontbrekende of alle artikelen een wants-lijst met dezelfde filters. Daarna rekent Cardmarket's eigen Wizard de optimale combinatie uit. | Laat het zware rekenwerk aan Cardmarket, en zo blijven we binnen het fair-use-tempo. Wants-acties **[Code]**, limieten van de Wizard **[Officieel]**. | M–L | C |
| IDEE-16 | **Volledige optimalisatie over meerdere verkopers** (zoals TCGmizer of Regroupeur, met een exacte solver). | Veel waarde, maar vereist het ophalen van heel veel pagina's. Groot risico op 429-fouten of Cloudflare, en het concurreert met de Wizard. **[Afgeleid]** | L | W |

### B5. Favorieten en terugvinden

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-17 | **Favoriete verkopers en een blocklist.** Favoriete verkopers worden gemarkeerd en komen bovenaan; geblokkeerde verkopers worden gedimd of verborgen. Er komt een ster bij de verkopersnaam. | CM Helper, Lugin en Enhanced Cardmarket **[Code]** en **[Derden]**. Sluit aan op "artikel van iemand". | M | S |
| IDEE-18 | **Recent bekeken.** Een automatische geschiedenis van de laatste ~200 aanbiedingen en producten die je bekeek, met zoekfunctie. Zo vind je ook terug wat je níét met een ster hebt gemarkeerd. | Geen enkele bestaande tool doet dit. Kost geen verzoeken, want alles wordt tijdens het browsen vastgelegd. **[Afgeleid]** | S | M |
| IDEE-19 | **Labels, mappen en notities bij favorieten** ("deck Atraxa", "cadeau"), met een filter per label. | Honey Droplist werkt met labels **[Derden]**. Handig zodra de lijst groeit. | S | M |
| IDEE-20 | **Beschikbaarheid controleren op verzoek.** Een knop "controleer alle favorieten" zoekt bij elke verkoper, in rustig tempo en met een maximum aantal. Optioneel één keer per dag voor maximaal ~10 favorieten. | Nu merk je pas dat iets verkocht is als je het probeert. Het maximum en de opt-in beperken de belasting. **[Afgeleid]** | M | C |
| IDEE-21 | **Sneltoetsen en contextmenu:** "Bewaar als favoriet" via rechtsklik op een aanbieding, en een sneltoets voor "zet terug". | Comfort. Standaard Chrome-API's (`commands`, `contextMenus`). | S | C |

### B6. Mandjes beheren en samen kopen

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-22 | **Benoemde mandjes** ("Commander-deck", "Pokémon 151"). Sla het huidige mandje op onder een naam, zet elk opgeslagen mandje later terug en vergelijk de totaalprijzen. | Een natuurlijke uitbreiding van de kern. Werkt met de bestaande terugzet-functie. **[Afgeleid]** | S–M | S |
| IDEE-23 | **Lijsten delen.** Exporteer een mandje of favorietenlijst als tekst of CSV, in het formaat van Cardmarket's decklijsten of van Moxfield, of als een bestand dat een vriend kan importeren. | Wants Lists Helper en Cardmarket Plus **[Derden]**. | S | C |
| IDEE-24 | **Groepsbestelling.** Label artikelen per persoon ("Milan", "Sem"). De verzendkosten per verkoper worden eerlijk verdeeld en je ziet een overzicht van wie wat betaalt. | Samen bestellen bij dezelfde verkoper scheelt verzending, en verzending wordt duurder in 2026 **[Officieel]**. Geen enkele tool doet dit. **[Afgeleid]** | M | C |
| IDEE-25 | **Budget en uitgaven.** Een maandbudget, het mandje inclusief verzending tegenover dat budget, en een uitgavenoverzicht per maand en per spel uit de bestelpagina's (passief). | EchoMTG en Deckbox volgen de waarde van je collectie **[Derden]**. Bestelpagina's worden al herkend (FR-07). | M | C |

### B7. Decks en collectie

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-26 | **Decklijst importeren** (tekst, Moxfield, Archidekt, ManaBox). Geeft een kostenschatting via de prijsgids en maakt er daarna een wants-lijst of favorieten van, met omzetting van setcodes. | Gevraagd bij Moxfield en gebouwd door Wants Lists Helper en Cardmarket Helper **[Derden]** en **[Code]**. | L | C |
| IDEE-27 | **"Heb ik al"-labels** op aanbiedingen en in het mandje, vanuit een geïmporteerde collectie-CSV of je eigen bestelgeschiedenis. | Cardmarket Helper (ManaBox-CSV) en Lugin (collectie uit bestellingen) **[Code]**. Voorkomt dat je iets dubbel koopt. | M | C |

### B8. Platform en comfort

| ID | Idee | Waarom / bron | Moeite | Prio |
|---|---|---|---|---|
| IDEE-28 | **Herinnering voordat het mandje wordt geleegd.** Leest de tijd uit de melding van Cardmarket ("wordt geleegd om HH:MM") en geeft 10 minuten vooraf een melding. | Gebruikers melden zo'n banner **[Derden]**, maar die is niet bevestigd. Eerst op de live site controleren. | S | C |
| IDEE-29 | **Synchronisatie tussen apparaten:** favorieten en instellingen via `chrome.storage.sync` (limiet ~100 KB), of een eigen bestand in Google Drive. | Nu alleen via export en import (beperking A7). | M | C |
| IDEE-30 | **Firefox-versie** (MV3 met `background.scripts` en `browser_specific_settings`). | Enhanced Cardmarket en Cardmarket Helper staan ook op addons.mozilla.org. | M | C |
| IDEE-31 | **Ongedaan maken** na het verwijderen van een artikel of favoriet (een melding met *Ongedaan maken*). | Voorkomt per ongeluk verlies van gegevens. | S | S |

**Bewust níet doen.** Deze ideeën botsen met fair use of met de voorwaarden
van Cardmarket:

- **Het mandje "warm houden"** om te voorkomen dat Cardmarket het leegt. Dat
  houdt artikelen vast die anderen willen kopen en ondermijnt de reservering.
- **Automatisch kopen of "sniping"** van aanbod op de achtergrond.
- **Op grote schaal pagina's ophalen**, of prijsdata buiten je eigen browser
  delen. Prijzen publiek tonen vraagt toestemming van Cardmarket.
  **[Officieel]**

### B9. Voorgestelde roadmap

| Versie | Inhoud | Waarom in deze volgorde |
|---|---|---|
| **1.1 — Betrouwbaar en terugvinden** | IDEE-01 zelftest, IDEE-03 prijs veranderd, IDEE-02 uitleg bij mislukken, IDEE-18 recent bekeken, IDEE-19 labels en notities, IDEE-31 ongedaan maken | Alles klein, zonder nieuwe permissies en zonder extra verzoeken. Maakt de basis robuuster op de live site. |
| **1.2 — Wat kost mijn mandje?** | IDEE-10 kostenpaneel, IDEE-11 drempeladvies, IDEE-12 verkoper al in mandje, IDEE-22 benoemde mandjes | Het onderscheidende terrein, met data die we al hebben. Alleen de verzend-API is nieuw. |
| **1.3 — Prijsinzicht** | IDEE-05 trendlabels, IDEE-06 geschiedenis, IDEE-07 prijsalarm, IDEE-17 favoriete verkopers en blocklist | Vraagt een optionele host-permissie voor `downloads.s3.cardmarket.com`, plus opslag per product. |
| **2.0 — Slim kopen** | IDEE-14 slim vervangen, IDEE-15 naar de Wizard, IDEE-26 decklijst importeren, IDEE-24 groepsbestelling, IDEE-27 "heb ik al" | Grotere functies, deels met extra verzoeken: rustig tempo, maximum aantal en alleen na een klik. |

### B10. Bronnen

- Bestaande tools:
  - [Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/);
  - [Cardmarket Helper](https://github.com/SuppenNudel/cardmarket-helper):
    prijsgids-URL's, trendkleuren, ManaBox;
  - [CM Helper by LastDraw](https://chromewebstore.google.com/detail/lcngonadhpeolkgmjjimdobdhfalnglf);
  - [Cardmarket Companion](https://chromewebstore.google.com/detail/mpbncolfefkegmaccdejhngjcjkjoaep);
  - [TCG Market Wizard](https://chromewebstore.google.com/detail/idcpcfanbabnakoebbnklgkngjbldfde);
  - [Wants Lists Helper](https://github.com/grepfs17/cm-copy-lists);
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): verzend-API,
    wants-acties, favoriete verkopers;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    optimalisatie inclusief verzending;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard);
  - [natefinch/tcgmizer](https://github.com/natefinch/tcgmizer).
- Cardmarket:
  - [Prijsgids en catalogus als download](https://news.cardmarket.com/en/Magic/were-making-the-price-guide-and-product-catalogue-available-for-download);
  - [Verzendkosten](https://help.cardmarket.com/en/ShippingCosts);
  - [Trustee Service](https://help.cardmarket.com/en/TrusteeService);
  - [Shopping Wizard](https://help.cardmarket.com/en/ShoppingWizard);
  - [Beoordeling van verkopers](https://help.cardmarket.com/en/SellerRating);
  - [Vakantiestatus](https://help.cardmarket.com/en/vacation-status);
  - [Wijziging internationale verzending 2026](https://news.cardmarket.com/en/FoW/changes-to-international-shipping-methods-using-envelopes);
  - [GBP op Cardmarket](https://news.cardmarket.com/en/Magic/Pound-Sterling-Are-Coming-To-Cardmarket).
- Kopers:
  - [Trustpilot over Cardmarket](https://www.trustpilot.com/review/www.cardmarket.com);
  - Elite Fourum over [scans en reacties van verkopers](https://www.elitefourum.com/t/buying-from-cardmarket-buying-without-seeing-the-scans-no-response-from-sellers/40202)
    en over [de UPU-regels van 2026](https://www.elitefourum.com/t/new-2026-upu-rules-is-this-the-end-of-international-singles-on-cardmarket-ebay-and-tcgplayer/60297).
- Inspiratie:
  - [CamelCamelCamel](https://camelcamelcamel.com/features);
  - [Honey Droplist](https://help.joinhoney.com/article/79-what-is-droplist);
  - [TCGplayer Cart Optimizer](https://help.tcgplayer.com/hc/en-us/articles/201769673-How-does-the-Cart-Optimizer-work);
  - [verzoek om "missende kaarten kopen" bij Moxfield](https://moxfield.nolt.io/2226).

> De meeste sites (Reddit, Cardmarket, de Chrome Web Store) waren vanuit de
> onderzoeksomgeving niet direct te openen. Wat daar staat is gebaseerd op
> zoekresultaten. GitHub-code is wel direct gecontroleerd.

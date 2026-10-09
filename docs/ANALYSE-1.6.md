# Analyse voor 1.6: plaatjes, bugs en wat beter kan

## Stand van zaken: gebouwd in 1.6

Alle vijf stappen uit [§6](#6-voorstel-voor-16) zijn gebouwd en getest.
Dat gaat om 89 tests tegen de nagebootste site, plus een optionele test tegen
Cardmarkets echte plaatjesserver (`CMCS_LIVE=1 npm test`).

| Stap | Opgelost |
|---|---|
| 1. Plaatjes en de echte site | P1–P6, S1–S5, B10 |
| 2. Niets meer kwijtraken | B1–B5, B7–B9, B13, B25–B30, B33, U4, T4 |
| 3. Mandjes logisch | U1–U3, B16, B21 |
| 4. Rust en kloppende getallen | B12, B14, B15, B20, B22–B24, B31, B32, T1–T7 |
| 5. Popup en paneel gelijk | U5–U8, B17–B19, en het grootste deel van U9 |

Bewust (nog) niet gedaan:

- **B6, gelijktijdig schrijven.** De kans is kleiner geworden: plaatjes
  hebben nu een eigen sleutel en worden alleen door de achtergrond
  geschreven. Helemaal oplossen vraagt één plek die alles schrijft.
- **B11, namen van de sloten.** Het paneel en de sterren staan toch zichtbaar
  in de pagina, dus de namen verbergen helpt niets.
- **B27, opslag vol.** De grens van 10 MB is weg (`unlimitedStorage`), maar
  een mislukte schrijfactie wordt nog niet gemeld.
- **B32, geheugen.** De prijsgids wordt nog in één keer gelezen, wel hooguit
  één keer per dag en met een 304 als hij niet veranderde.
- **B33, deels.** Een "ongedaan maken" is voor de achtergrond nog niet
  zichtbaar als lopende klus.
- **B38.** De toestemming voor de prijsgids is nog niet optioneel.
- **S6, P7 en U9.** De trend van de productpagina en verkopersfoto's komen
  later. Popup en paneel doen nu hetzelfde, maar hun code is nog niet
  helemaal gedeeld.
- **S9.** Wanneer Cardmarket "je mandje wordt geleegd om …" toont, weten we
  nog steeds niet.

---

Onderzocht op 9 oktober 2026 (Cart Saver 1.5.0), op drie manieren:

1. **De echte site.** In je eigen, ingelogde Chrome en met DevTools. Ik heb
   alleen pagina's gelezen: niets gekocht, niets aan het mandje veranderd.
2. **Experimenten.** In een testbrowser, met de echte extensie en echte
   plaatjes van Cardmarket.
3. **De code, regel voor regel.** In drie delen: mandje lezen en terugzetten;
   popup en paneel; achtergrond, favorieten en plaatjes. Elke bevinding is
   daarna nog eens in de code nagelopen.

## In het kort

1. **Plaatjes in de popup laden nooit.** Cardmarkets beeldserver geeft
   plaatjes alleen aan verzoeken die van cardmarket.com komen; de popup krijgt
   een 403. De oplossing is getest: in de echte popup ging het van 0 naar 3
   plaatjes. Hij bestaat uit één Chrome-regel die bij onze eigen verzoeken
   cardmarket.com als afzender meegeeft, plus toestemming voor de
   beeldserver ([§1](#1-plaatjes)).
2. **Op verkoperspagina's werkt Cart Saver niet.** Daar gebruikt Cardmarket
   een andere rij-code (`stockRow`). Er komen geen sterren, en "vervanging bij
   dezelfde verkoper" vindt nooit iets ([S1](#2-wat-de-echte-site-anders-doet-dan-cart-saver-verwacht)).
3. **Een mandje bewaren kan alleen in het tabblad Mandjes.** Je ziet je
   mandje in het tabblad Winkelmandje, en een onzichtbaar spelfilter bepaalt
   wat er bewaard wordt. Voorstel: "Bewaar als lijst…" in Winkelmandje en in
   het paneel ([U1](#4-onlogisch-verdeeld)).
4. **Op drie plekken kun je stil dingen kwijtraken:**
   - een klik op bijvoorbeeld "Purchases" op de mandjepagina ([B1](#3-bugs-in-de-code));
   - een ander Cardmarket-account ([B2](#3-bugs-in-de-code));
   - het update-script, als het op je ontwikkelmap staat ([B25](#3-bugs-in-de-code)).
5. **Het paneel op Cardmarket springt bij elke update terug naar boven**
   ([B12](#3-bugs-in-de-code)).
6. **Favorieten van een Magic-productpagina krijgen het verkeerde plaatje**
   (de vorige kaart uit de carrousel), en favorieten krijgen nooit een
   trendprijs ([S3](#2-wat-de-echte-site-anders-doet-dan-cart-saver-verwacht)).
7. **Sealed producten zijn half ondersteund.** Zoeken bij de verkoper vindt
   niets, boxen worden bijgesneden, en overal staat "kaart(en)".
8. **Tellingen kloppen niet.** Bij 4× dezelfde kaart staat er "1 kaart(en)
   kunnen terug · 4,00 €", en "deels in je mandje" telt dubbel
   ([B14](#3-bugs-in-de-code)).
9. **Elke push gaat ongetest naar je browser.** Dat gaat via het
   update-script. Eén fout en Cart Saver ligt stil, zonder zichzelf te kunnen
   herstellen ([B26](#3-bugs-in-de-code)).
10. **Cardmarket waarschuwt bovenaan het mandje voor misbruik van het
    mandje.** Belangrijk om te weten bij een extensie die kaarten terugzet
    ([§2](#een-waarschuwing-van-cardmarket-zelf)).

Het voorstel voor de volgorde staat in [§6](#6-voorstel-voor-16).

---

## 1. Plaatjes

**Kort:** Cart Saver weet bijna altijd wélk plaatje bij een artikel hoort,
maar de popup en de instellingenpagina kunnen het niet laden. Het paneel óp
Cardmarket heeft daar geen last van.

### Zo werkt het nu

1. **Plaatjes-URL bewaren.** Bij het lezen van je mandje haalt Cart Saver de
   URL uit het camera-icoontje van elke rij (`.thumbnail-icon`, attribuut
   `data-bs-title` met `<img src="https://product-images.s3.cardmarket.com/…">`).
   **Dat werkt op de echte site**, ook voor sealed producten.
2. **Miniatuur maken.** Twee seconden na het laden van een Cardmarket-pagina
   probeert `thumbs.js` van elk plaatje een miniatuur te maken
   (`fetch(url, {mode: 'cors'})` → canvas → data-URL).
3. **Tonen.** De popup toont de miniatuur, anders de URL zelf, anders een
   letter.

### Wat de beeldserver doet

Gemeten in je eigen Chrome:

| Verzoek | Resultaat |
|---|---|
| Plaatje vanaf een Cardmarket-pagina (Referer `https://www.cardmarket.com/…`) | **200**, laadt |
| Zelfde, met alleen `https://www.cardmarket.com/` als Referer | **200** |
| Zelfde zonder Referer | **503** |
| Vanaf een andere site (Referer `https://example.com/`) | **403** |
| Rechtstreeks openen in een tabblad | **403** ("Request blocked", CloudFront) |
| `fetch` met CORS vanaf cardmarket.com (wat `thumbs.js` doet) | **mislukt**: geen CORS-headers |
| Cookies | niet nodig |

Gevolgen:

- **P1. In de popup en op de instellingenpagina zie je alleen letters.**
  Chrome stuurt daar geen Cardmarket-Referer mee, dus de beeldserver geeft
  een 403.
- **P2. `thumbs.js` mislukt altijd.** Er wordt nooit een miniatuur bewaard.
  Elk artikel krijgt `thumbTriedAt`, wordt na drie dagen opnieuw geprobeerd en
  mislukt dan weer.
- **In het paneel op Cardmarket laden plaatjes wél.** Daar komt het verzoek
  van de pagina zelf.

### Oplossing (getest)

Getest in een testbrowser met de échte popup en échte plaatjes-URL's: een
Elite Trainer Box, Sol Ring en Spectral Searchlight.

| | Plaatjes | Letters |
|---|---|---|
| Nu | 0 | 3 |
| Met de oplossing | 3 | 0 |

De oplossing bestaat uit drie delen:

1. **Toestemming in `manifest.json`.** Voeg `declarativeNetRequestWithHostAccess`
   toe, plus host-toestemming voor `https://product-images.s3.cardmarket.com/*`.
   Zonder die host-toestemming werkt het niet; ook dat is getest.
2. **Eén regel in de achtergrond** (`chrome.declarativeNetRequest`). Bij
   verzoeken die Cart Saver *zelf* naar de beeldserver doet, zet Chrome de
   Referer op `https://www.cardmarket.com/`.
   - Dit geldt alleen voor dat ene domein en alleen voor onze eigen
     verzoeken (`initiatorDomains: [extensie-id]`).
   - Verzoeken van Cardmarket zelf blijven onaangeroerd.
   - Zet de regel bij elke start van de service worker. Hij is idempotent.
3. **Miniaturen in de achtergrond maken in plaats van in de pagina.**
   - Met de host-toestemming mag de service worker het plaatje wél lezen.
   - Een miniatuur van 60×84 is gemeten ongeveer 2 KB (als data-URL ~2,7 KB).
   - Bewaar ze in een eigen sleutel (`cmcs.thumbs`, per product) en niet in
     `cmcs.items`. Zie P6 voor waarom.

Stap 1 en 2 geven al plaatjes in de popup; Chrome bewaart ze dan in zijn eigen
cache. Stap 3 maakt het sneller, en werkt ook als de beeldserver even niet
bereikbaar is. In het paneel kan de originele URL blijven, die laadt daar al.

### Ook gevonden bij de plaatjes

- **P3. Verkeerd plaatje bij favorieten van een Magic-productpagina.**
  - Bovenaan zo'n pagina staat een carrousel met de vórige, huidige en
    volgende kaart uit de set. `productImage()` (`cardmarket.js:405`) pakt het
    eerste plaatje, dus dat van de vorige kaart.
  - Voorbeeld: een ster bij Sol Ring (Commander Masters) bewaart het plaatje
    van Shimmer Myr.
  - Het juiste productnummer staat op de pagina (`input[name="idProduct"]`,
    hier 721733). Kies het plaatje met `/721733/` in de URL, en vul daarmee
    ook `productId` in; die blijft nu leeg (`cardmarket.js:482`).
  - Hetzelfde geldt voor vervangingen die via de productpagina gevonden
    worden.
- **P4. Sealed wordt bijgesneden.** Productfoto's van boxen zijn vierkant
  (300×300), het vakje is kaartvormig (30×42, `object-fit: cover`). Gebruik
  voor niet-kaarten `contain`, met een lichte achtergrond.
- **P5. De tests waren te lief.** De nagebootste beeldserver geeft iedereen
  plaatjes, met `Access-Control-Allow-Origin: *` (`tests/e2e.test.mjs:112`).
  Daarom slaagden alle tests terwijl het op de echte site nooit werkte. Maak
  de nagebootste server net zo streng als de echte: alleen met
  Cardmarket-Referer, en geen CORS.
- **P6. Opslag.** Zodra miniaturen wél werken, mogen ze niet in `cmcs.items`
  en `cmcs.favorites` komen, zoals de code nu wil:
  - Elke miniatuur zou dan het hele blok herschrijven: tot 24 keer per
    paginaload, in elk tabblad. Elke keer bouwen badge, paneel en popup
    opnieuw op.
  - Bij een grote lijst (~1.000 artikelen + 500 favorieten) raakt de limiet
    van 10 MB vol. Daarna stopt opslaan stil (zie B27).
  - Daarom: een eigen sleutel, één miniatuur per product, een maximum (of
    `unlimitedStorage`), en één tabblad tegelijk.
- **P7. Foto's van verkopers.** Sommige aanbiedingen hebben een foto van het
  échte artikel (`marketplace-article-scans.s3.cardmarket.com/<id>/<id>t.jpg`).
  Een idee voor later, bijvoorbeeld bij favorieten.

### Andere manieren die we niet aanraden

- **Plaatjes van andere bronnen** (Scryfall, pokemontcg.io): alleen kaarten,
  geen sealed. En Cart Saver belooft nu alleen met cardmarket.com te praten.
- **Een eigen server als tussenstation:** kost geld en breekt de
  privacybelofte.
- **Miniaturen in de pagina zelf maken** (wat nu gebeurt): kan niet. De
  server staat het uitlezen van plaatjes vanuit een pagina niet toe.

---

## 2. Wat de echte site anders doet dan Cart Saver verwacht

| # | Wat ik zag | Gevolg voor Cart Saver | Ernst |
|---|---|---|---|
| S1 | Op **verkoperspagina's** (`/Users/<verkoper>/Offers/…`) heten de rijen `stockRow<id>`, niet `articleRow<id>` zoals op productpagina's. | Geen ☆ op verkoperspagina's (0 sterren gemeten). "Vervanging bij dezelfde verkoper" vindt **nooit** iets (`replace.js:51`, `cardmarket.js:418`, `favorites.js:19`). De README belooft het wel. | hoog |
| S2 | Elke verkoper heeft per soort product een eigen pagina (`/Offers/Singles`, `/Offers/Boosters`, `/Offers/Elite-Trainer-Boxes`, …), met hetzelfde stuk als in de product-URL. Zoeken op naam (`?name=`) werkt overal. | Cart Saver zoekt altijd in `/Offers/Singles` (`cardmarket.js:114`). Voor sealed vindt hij dus niets, en de link "aanbod van deze verkoper" bij een favoriet toont een lege pagina. | middel |
| S3 | Magic-productpagina's hebben bovenaan een carrousel; het juiste productnummer staat in `input[name="idProduct"]`. | Verkeerd plaatje (P3), geen `productId`, dus geen trendprijs voor favorieten. | middel |
| S4 | Op de Duitse, Franse, Spaanse en Italiaanse site zijn de taalnamen vertaald ("Englisch"); condities blijven "NM", "EX". | Cart Saver kent alleen de Engelse namen (`LANGUAGE_IDS`). Van favorieten en vervangingen is de taal dan onbekend, en de popup toont "Englisch". Na S1 zou "zelfde verkoper" een andere taal kunnen voorstellen. | middel |
| S5 | Productpagina's tonen per aanbieding de **verzendkosten** (bij een Elite Trainer Box: 24,00 €). | Vervanging rekent met een vaste 1,25 € per extra pakket (`replace.js:21`). Voor sealed klopt dat niet. | middel |
| S6 | Productpagina's tonen **Price Trend** en gemiddelden over 1, 7 en 30 dagen. | Een trendprijs kan ook zonder de prijsgids te downloaden, voor producten die je bekijkt. | kans |
| S7 | De **prijsgids** werkt (Magic 26 MB, Pokémon 16 MB) en bevat ook sealed (`idCategory`). Pokémon gebruikt `trend-holo`. | "Prijs vs trend" werkt dus ook voor boxen. De downloads blijven fors (zie B32). | — |
| S8 | **Bestellingen:** de overzichtspagina's (`/Orders/Purchases/…`) hebben geen artikelrijen, de pagina van één bestelling wel (`tr[data-article-id]`). | Wat je kocht, verdwijnt pas uit de lijst als je die bestelling opent, of via de herkende knop "Proceed to checkout". | laag |
| S9 | Geen melding "je mandje wordt geleegd om …" gezien. | Het aftellen uit 1.3 heeft op de echte site waarschijnlijk niets om te lezen. Niet kunnen bevestigen wanneer Cardmarket de melding wél toont. De README belooft het. | onbekend |
| S10 | Een productpagina toont 50 aanbiedingen, met "Show more results". | Vervanging kijkt alleen naar die eerste 50. Prima. | — |
| S11 | Het mandje groepeert per verkoper en daarbinnen per soort product; de rijen hebben de bekende `data-*`-velden, sealed zonder `data-condition`. | Mandje lezen werkt, ook voor sealed. | — |

### Een waarschuwing van Cardmarket zelf

Bovenaan het mandje staat:

> "Reminder: Please only keep items in your cart that you intend to purchase.
> Abuse of the shopping cart may result in account suspension."

Cart Saver zet kaarten terug die Cardmarket uit je mandje haalde. Dat is
precies het gebied waar die waarschuwing over gaat. Cart Saver doet het al
netjes: alleen na jouw klik, één verzoek tegelijk, met pauzes. Toch:

- **README:** zet het onder "Goed om te weten", zodat gebruikers het weten.
- **Nooit bouwen:** "automatisch terugzetten" of "vasthouden". Daar
  waarschuwt Cardmarket tegen.
- **Overweeg:** een rustige opmerking als iemand dezelfde lijst vaak achter
  elkaar terugzet.

---

## 3. Bugs in de code

Ernst:

- **hoog**: je merkt het vaak, of je raakt iets kwijt;
- **middel**: merkbaar in een gewone situatie;
- **laag**: randgeval, of klein.

### Mandje lezen en terugzetten

| # | Ernst | Wat gaat er mis | Waar |
|---|---|---|---|
| B1 | middel | **Klik-herkenning te breed.** Op de mandjepagina telt elke klik op een knop of link met "purchase", "buy", "checkout" of "commander" in tekst of klasse als "ik haal alles weg", bijvoorbeeld het menu "Purchases". Alle rijen worden dan 10 minuten gemarkeerd. Leegt Cardmarket je mandje in die tijd, dan **vergeet** Cart Saver alles in plaats van het als "geleegd" te tonen. | `main.js:27, 250-255, 299-315` |
| B2 | middel | **Ander account.** Een klus die mislukt omdat je met een ander account bent ingelogd, controleert daarna tóch het mandje en schrijft dat in je lijst. Je kaarten worden "geleegd", of die van het andere account komen erbij. Vanuit de popup kun je zo'n klus gewoon starten. | `refill.js:368-375, 415-424` |
| B3 | laag | **Oud token gaat voor.** Het token van de (misschien uren open) pagina krijgt voorrang boven het verse token uit het mandje. Weigert Cardmarket het oude token, dan wordt ronde 1 helemaal geweigerd voordat hij een nieuw token pakt. | `refill.js:273, 281, 516` |
| B4 | laag | **Een bestelpagina openen** haalt artikelen uit de lijst, ook als je dat artikel nu opnieuw in je mandje hebt. | `main.js:337-340` |
| B5 | laag | **"Twee keer onbekend = verkocht".** Bij een algemene storing worden bij de tweede poging álle kaarten als verkocht gemarkeerd, en na 30 dagen opgeruimd. | `refill.js:469-473`, `store.js:308-316` |
| B6 | laag | **Gelijktijdig schrijven.** Tabbladen, popup en achtergrond schrijven los van elkaar in dezelfde opslag. Een "Stop"-klik kan worden overschreven door de hartslag van de lopende klus. | `store.js:84-96` |
| B7 | laag | Een **onbetrouwbare lezing** telt als geslaagd, dus 15 minuten geen nieuwe poging. Bij een ander account wordt juist bij elke paginaload opnieuw gelezen. | `main.js:56, 87-103` |
| B8 | laag | **Token zoeken** kan tot 12 pagina's achter elkaar opvragen, zonder pauze. | `cardmarket.js:721-734` |
| B9 | laag | Antwoordt de pagina-brug één keer te laat (drukke pagina), dan blijft hij voor die pagina uit. | `cardmarket.js:554-582` |
| B10 | laag | **Vervanging:** een verkoper die via een ánder spel al in je mandje zit, telt niet als "zit al in je mandje". | `replace.js:62-66` |
| B11 | laag | De namen van Cart Savers interne sloten (`cmcs.refill`, `cmcs.sync`) zijn waarschijnlijk zichtbaar voor Cardmarkets eigen scripts (niet bevestigd). De site zou zo kunnen zien dat je Cart Saver gebruikt. | `refill.js:20, 55`, `main.js:117` |

### Popup en paneel

| # | Ernst | Wat gaat er mis | Waar |
|---|---|---|---|
| B12 | **hoog** | **Het paneel springt bij elke update terug naar boven.** Het wordt helemaal opnieuw gebouwd bij elke opslagwijziging, elk vinkje, elke uitgeklapte rij en elke minuut (aftellen). Scrollpositie en focus zijn weg, en een klik precies tijdens zo'n update valt weg. Klik je onderaan op "Vervanging zoeken", dan verschijnen de voorstellen buiten beeld. | `widget.js:254-268, 761` |
| B13 | middel | **"Ongedaan maken" verdwijnt te vroeg.** De klus wordt eerst afgesloten en pas daarna ongedaan gemaakt. Mislukt dat (sessie verlopen), dan is de knop weg en blijven de kaarten in je mandje. | `widget.js:185-199` |
| B14 | middel | **Tellingen kloppen niet.** (a) "1 kaart(en) kunnen terug · 4,00 €" bij 4×: er worden rijen geteld, het bedrag gaat over exemplaren. (b) In de instellingen telt "deels in je mandje" twee keer mee, dus de som is groter dan het totaal. (c) "In je mandje" betekent in de popup iets anders dan in het paneel. | `popup.js:423, 545`, `widget.js:496, 550, 597`, `store.js:183-193`, `options.js:61-72` |
| B15 | middel | **Na een artikel weghalen** vervangt de melding met "Ongedaan maken" het hele paneel; vijf kaarten opruimen kost vijf extra klikken. Na een terugzet-klus zit die melding verstopt achter de samenvatting en duikt later ineens op. | `widget.js:175-183, 669-672, 740-759` |
| B16 | middel | **Handmatig opslaan onbereikbaar.** Staat "automatisch onthouden" uit en is de lijst leeg, dan verschijnt het paneel niet, en dus ook de knop "Huidig mandje opslaan" niet. De uitleg in de instellingen belooft die knop wel. | `widget.js:586-594, 750` |
| B17 | laag | Een **favoriet** die je in het mandje wilde leggen terwijl je uitgelogd was, blijft daarna als "kan terug" in je lijst staan (badge, melding), terwijl hij er nooit in zat. | `popup.js:203-211`, `store.js:474-497` |
| B18 | laag | Een mislukte favoriet krijgt in het paneel een VERKOCHT-stempel zonder reden, en het kruisje ernaast doet niets. | `widget.js:353-357, 466` |
| B19 | laag | Een artikel dat **in je mandje zit** weghalen in de popup werkt maar even: bij de volgende lezing staat het er weer. | `popup.js:489-498` |
| B20 | laag | De popup-melding "Er worden al artikelen teruggezet…" blijft staan, ook als dat al klaar is. | `popup.js:43` |
| B21 | laag | Een bewaard mandje terugzetten waarvan alles al in je mandje zit: er gebeurt zichtbaar niets. | `popup.js:194-200` |
| B22 | laag | Tegenstrijdige teksten als alleen verkochte kaarten over zijn: "Niets om terug te zetten" + "Je winkelmandje is leeg", terwijl het dat niet is. | `widget.js:505-514` |
| B23 | laag | De melding onderin de popup valt precies over de grote knop, en een tweede melding wist het "Ongedaan maken" van de eerste. | `popup.css:68-72`, `popup.js:126-139` |
| B24 | laag | **Donkere modus:** scrollbalk en spelkeuzelijst blijven licht (geen `color-scheme`). | `ui.js:342-383` |

### Achtergrond, updates, opslag en favorieten

| # | Ernst | Wat gaat er mis | Waar |
|---|---|---|---|
| B25 | **hoog voor jou** | **Het update-script wist lokaal werk.** Wijs je het naar een map die al een git-clone is (bijvoorbeeld je ontwikkelmap, als Chrome de extensie daaruit laadt), dan gooit het meteen alle niet-gecommitte wijzigingen weg en zet het je branch om. Daarna doet het elke 3 minuten `git reset --hard`. | `scripts/autoupdate-mac.sh:54-66, 72` |
| B26 | middel | **Elke push gaat ongetest naar je browser.** Het script haalt binnen ~4 minuten alles van de standaard-branch binnen, zonder controle en zonder terugvaloptie. Eén syntaxfout in `service-worker.js` of `manifest.json`, en Cart Saver ligt stil. Ook de volgende update komt dan niet meer vanzelf door, want die moet door de kapotte service worker. | `service-worker.js:78-107`, `autoupdate-mac.sh:63-72` |
| B27 | middel | **Opslag vol = opslaan stopt stil.** Er is geen `unlimitedStorage` en geen controle op de 10 MB-grens. Zodra het vol is, mislukt elke schrijfactie en ziet niemand het: geen nieuwe kaarten, een ster die niets doet. Nu nog ver weg, maar miniaturen op de huidige plek (P6) brengen het dichterbij. | `store.js:80-96` |
| B28 | middel | **Eén fout stopt alles op die pagina.** In `main.js` zit één try/catch om alles. Gaat er iets mis bij de favorieten of het paneel, dan worden op die pagina ook het herkennen van verwijderingen, het hervatten van een klus en de miniaturen overgeslagen. | `main.js:336-363` |
| B29 | middel | **De melding "mandje geleegd"** werkt in de praktijk alleen met "kijk af en toe" aan (standaard uit). En hij telt ook mee wat je net kocht ("3 artikelen uit je mandje" terwijl je ze afrekende). | `main.js:104-109`, `service-worker.js:186-211` |
| B30 | laag | **"Kijk af en toe" kijkt elke 20 minuten** in plaats van elke 10: de controle "net gelezen" valt precies op de grens. | `service-worker.js:202` |
| B31 | laag | **Trendprijs:** (a) favorieten krijgen er geen (geen `productId`, zie S3); (b) Pokémon Reverse Holo wordt met de gewone prijs vergeleken; (c) een trend van 0 overschrijft een echte; (d) rode trendopmerkingen blijven staan nadat je de functie uitzet. | `cardmarket.js:482`, `service-worker.js:236-282`, `ui.js:104-113` |
| B32 | laag | **Prijsgids-download:** het hele bestand (tot 26 MB) gaat in één keer in het geheugen; Chrome kan de achtergrond na 30 seconden stoppen; er is geen "vandaag al gedaan"-check en geen 304. | `service-worker.js:236-282` |
| B33 | laag | **Zelf-update op een slecht moment.** Een klus die net start wordt afgebroken; "ongedaan maken" is voor de achtergrond onzichtbaar en kan halverwege stoppen; er wordt herladen terwijl je in de checkout zit. | `service-worker.js:93-105` |
| B34 | laag | **Favorieten:** bij elke paginaweergave met een favoriet wordt de hele favorietenlijst herschreven, en alle sterren worden opnieuw getekend. | `favorites.js:105-122, 39-49` |
| B35 | laag | Verkochte artikelen worden na 30 dagen **stil** opgeruimd, ook als "verkocht" een vergissing was (B5). | `store.js:307-316` |
| B36 | laag | Na extensie uit- en aanzetten blijft de badge leeg tot er iets verandert. | `service-worker.js:291-300` |
| B37 | laag | Een link naar een favoriet (`#articleRow…`) werkt niet als de rij pas na "Show more results" verschijnt. | `favorites.js:125-148` |
| B38 | laag | De toestemming voor `downloads.s3.cardmarket.com` is verplicht, terwijl de prijsfunctie standaard uit staat. Kan optioneel. | `manifest.json:20-23` |
| B39 | laag | Update-script: `status` zegt "aan" ook als het steeds mislukt, en het logbestand groeit zonder einde. | `autoupdate-mac.sh:100-123` |

### Teksten

| # | Wat | Waar |
|---|---|---|
| T1 | "kaart(en)" ook als het om dozen gaat (6 teksten). Beter: "artikel(en)". | `_locales/*/messages.json` |
| T2 | Meervoud met "(en)": "1 kaart(en) kunnen terug", "Over ongeveer 1 minuten". Chrome kent geen meervoud; twee sleutels (één / meer) lossen het op. | idem, `service-worker.js:177` |
| T3 | Cardmarkets eigen melding verschijnt in het Engels in de Nederlandse popup ("This article is no longer available."), terwijl Cart Saver de reden al kent. | `refill.js:474`, `popup.js:505` |
| T4 | "Alles wissen" wist ook bewaarde mandjes, maar zegt dat niet. Importeren telt een mandje als 1 artikel. | `options.js:125-170` |
| T5 | De uitleg in de instellingen noemt een knop "Zet terug" die niet bestaat, en zegt niets over Mandjes, vervanging of verzendkosten. | `how1`–`how5` |
| T6 | `aria-label="Spel"` staat vast in de HTML, ook in het Engels. De CSV heeft Engelse kolomnamen en interne statuscodes (`in_cart`). | `popup.html:13`, `store.js:341-366` |
| T7 | Tien vertalingen worden nergens meer gebruikt, plus wat dode code van vóór 1.5. | o.a. `ui.js:48, 428-434, 488`, `widget.js:725-735` |

---

## 4. Onlogisch verdeeld

### U1. Een mandje bewaren kan alleen in het tabblad "Mandjes" (hoog)

- **Nu:** het formulier "Naam, bijv. Commander-deck" + "Lijst bewaren" staat
  alleen in het tabblad Mandjes (`popup.html:52-55`).
- **Wat er bewaard wordt** is de lijst uit het tabblad **Winkelmandje**: wat
  in je mandje zit, deels in je mandje zit of eruit is gehaald. Verkochte
  artikelen niet (`popup.js:91-98`).
- **Verborgen filter.** De spelkeuze bovenin ("Alle spellen", "Pokémon", …) is
  in het tabblad Mandjes onzichtbaar, maar bepaalt wél wat er bewaard wordt.
  Kies je in Winkelmandje "Pokémon" en bewaar je daarna in Mandjes, dan bewaar
  je alleen Pokémon, zonder dat het ergens staat.
- **Op Cardmarket zelf** kun je niets bewaren: in het paneel op de
  mandjepagina zit geen knop, terwijl je daar naar je mandje kijkt.
- **Voorstel:**
  - Knop **"Bewaar als lijst…"** in het tabblad Winkelmandje, naast "Kopieer
    als tekst" en "Download CSV"; die gebruiken al precies dezelfde lijst.
    Klik → naamveld met "12 artikelen · Alle spellen" ernaast → Bewaar.
  - Dezelfde knop in het paneel op de mandjepagina.
  - Het tabblad Mandjes is alleen nog om te bekijken en terug te zetten. Als
    het leeg is, verwijst het naar de knop in Winkelmandje.
  - Erbij: de inhoud van een bewaard mandje uitklappen, hernoemen, en
    "bijwerken met wat nu in je mandje zit".

### U2. "Mandje" betekent drie dingen (middel)

- **Drie betekenissen:**
  - het echte mandje op Cardmarket;
  - het tabblad **Winkelmandje** (wat Cart Saver onthoudt);
  - het tabblad **Mandjes** (bewaarde kopieën).

  In het Engels heten de tabbladen "Cart" en "Carts".
- **Een tweede knop met bijna dezelfde naam.** In het paneel staat ook
  **"Huidig mandje opslaan"** (alleen als automatisch onthouden uit staat).
  Die doet iets heel anders dan "Lijst bewaren": hij leest het mandje in,
  zonder naam.
- **Voorstel:** het tabblad Mandjes heet voortaan **"Lijsten"**, met de knop
  "Bewaar als lijst…". De knop in het paneel heet voortaan **"Mandje nu
  inlezen"**.

### U3. Bewaarde mandjes zijn niet te zien op Cardmarket zelf (middel)

- Terugzetten van een bewaard mandje kan alleen via de popup
  (`popup.js:609`); het paneel leest ze nooit.
- Is je lijst leeg (net geïmporteerd, of opgeschoond), dan toont de
  mandjepagina helemaal niets.
- **Voorstel:** "Bewaarde lijsten (N)" met "In mandje zetten" in het paneel.

### U4. Weggooien zonder "Ongedaan maken" (middel)

- **Geen ongedaan maken:** een bewaard mandje verwijderen (×) en een ster
  weghalen gebeurt meteen. Bij een artikel weghalen kan het wél.
- **Stil weggegooid:** het 31e bewaarde mandje gooit stilletjes het oudste
  weg (`store.js:29, 544`).
- **"Alles wissen"** wist ook alle bewaarde mandjes, maar de vraag noemt
  alleen "artikelen en favorieten" (T4).

### U5. Kiezen wat terug moet: alleen in het paneel (middel)

- **Nu:** in het paneel heb je vinkjes per kaart, "alles/niets" en
  spelknoppen. In de popup alleen spelknoppen en "Alleen deze terug".
- **Gevolg:** vijf van de zeven kaarten terugzetten vanuit de popup betekent
  vijf losse klussen, en de tweede wordt geweigerd zolang de eerste loopt.
- **Voorstel:** dezelfde vinkjes in de popup.

### U6. Na het terugzetten staan de handige dingen alleen in het paneel (middel)

- **Alleen op Cardmarket:** "Ongedaan maken", de lijst met wat mislukte, de
  kaart waar hij mee bezig is en "Vervanging zoeken". De popup toont alleen
  aantallen en "Sluiten".
- **Gevolg:** de README belooft "Spijt? Ongedaan maken", maar wie vanuit de
  popup werkt, ziet die knop niet.
- **Voorstel:** "Ongedaan maken" ook in de popup, via een bericht aan het
  Cardmarket-tabblad; zo werkt het terugzetten nu ook al.

### U7. De popup weet niets van een ander account, het aftellen en de verzendkosten (laag)

- Die staan alleen in het paneel; `popup.js` leest `meta` nergens.
- Ben je met een ander account ingelogd, dan start de popup een klus die
  pas na het lezen van het mandje mislukt, en daarna gaat B2 mis.

### U8. Favorieten zijn los zand (laag)

- **Eén voor één:** elke favoriet gaat apart het mandje in, als eigen klus.
  Er is geen "zet deze 10 in mijn mandje".
- **Niet als lijst:** favorieten kun je niet als lijst bewaren.
- **Afgekapt:** de rijen kun je niet uitklappen, dus taal en voorraad vallen
  eraf ("CardKingdomNL · 3 beschi…").

### U9. Dezelfde dingen twee keer gebouwd, en uit elkaar gegroeid (laag)

Popup en paneel hebben elk hun eigen versie van stoppen, "onderbroken"
herkennen, verkopergroepen en rij-acties. Daardoor:

- heet dezelfde vastgelopen klus in de popup "Bezig…" en op de pagina
  "Onderbroken";
- hebben ontbrekende kaarten in de popup een ☆ en "zoek vergelijkbaar", maar
  in het paneel niet;
- hebben verkochte kaarten in de popup "opnieuw proberen" en in het paneel
  "Vervanging zoeken".

**Voorstel:** de gedeelde stukken naar `ui.js`/`refill.js`, zodat beide
hetzelfde doen.

---

## 5. Tests: wat ontbreekt

De tests zijn uitgebreid (71), maar de nagebootste Cardmarket is op een paar
punten aardiger dan de echte. Daardoor zijn P1, P2, S1 en S3 nooit opgevallen.

- **Beeldserver:** alleen met Cardmarket-Referer, zonder CORS, net als de
  echte (P5).
- **Verkoperspagina's** met `stockRow`-rijen, en per soort product (S1, S2).
- **Productpagina met carrousel** en `idProduct` (S3).
- **Een site in het Duits of Frans** voor taalnamen (S4).
- **Meldingen van begin tot eind** (een verborgen tabblad leest het mandje →
  melding → klik), de alarmen na een herstart, en "kijk af en toe" via het
  echte alarm.
- **Ander account tijdens een klus** (B2), een klik op "Purchases" (B1),
  opslag vol (B27) en gelijktijdig schrijven (B6).
- **Het update-script zelf** (nu helemaal niet getest).

---

## 6. Voorstel voor 1.6

In deze volgorde: eerst wat je het meest ziet en wat het minst risico heeft,
daarna wat je kunt kwijtraken, dan de opzet.

| Stap | Wat | Bevindingen | Omvang |
|---|---|---|---|
| 1. Plaatjes en de echte site | Plaatjes in de popup (Chrome-regel + toestemming), miniaturen in de achtergrond in een eigen sleutel, juiste plaatje en `productId` op productpagina's, sealed niet bijsnijden. Verkoperspagina's (`stockRow`): sterren en "zelfde verkoper". Zoeken per soort product. Taalnamen in vijf sitetalen. Tests even streng als de echte site. | P1–P6, S1–S4, B10 | middel |
| 2. Niets meer kwijtraken | Klik-herkenning alleen op echte verwijder- en afrekenknoppen. Ander account: niets schrijven. Update-script veilig: weigeren op een ontwikkelmap, controleren vóór het neerzetten, en een eigen release-branch zodat niet elke push meteen live gaat. Opslag vol melden. Try/catch per onderdeel. "Ongedaan maken" pas weg als het gelukt is. | B1, B2, B13, B25–B28, U4, T4 | middel |
| 3. Mandjes logisch (jouw voorbeeld) | "Bewaar als lijst…" in Winkelmandje en in het paneel; tabblad "Lijsten"; lijsten zichtbaar en terug te zetten in het paneel; uitklappen, hernoemen, bijwerken. | U1–U3 | middel |
| 4. Rust en kloppende getallen | Paneel springt niet meer; tellingen in exemplaren; meldingen als strook in plaats van hele schermen; "artikel(en)" en echt meervoud; Nederlandse redenen in plaats van Cardmarkets Engels. | B12, B14, B15, B20–B23, T1–T3, T5 | middel |
| 5. Popup en paneel gelijk | Vinkjes in de popup, "Ongedaan maken" in de popup, ander account en aftellen in de popup, favorieten in één keer naar het mandje, gedeelde code. | U5–U9, B17–B19 | groot |
| Later | Verzendkosten per aanbieding bij vervanging, trend van de productpagina, prijsgids optioneel en zuiniger, "mandje geleegd"-melding betrouwbaarder, waarschuwing over misbruik in README. Misschien: lijst exporteren naar een Cardmarket-wantslijst. | S5, S6, B29–B32, B38 | — |

---

## Bijlage: wat niet getest is

- **Kopen en afrekenen:** bewust niet; er is niets gekocht en niets aan het
  mandje veranderd.
- **De melding "je mandje wordt geleegd om …":** niet gezien. Wanneer
  Cardmarket die toont, weten we niet (S9).
- **Of Cardmarkets token na uren echt verloopt** (B3): niet te testen zonder
  echte terugzet-verzoeken.
- **Het update-script op een Mac:** alleen gelezen, niet gedraaid.
- **Chromes toestemmingsmelding bij een installatie uit de Web Store:** bij
  een uitgepakte extensie komt er geen melding. Bij de Web Store vraagt Chrome
  bij de update eenmalig toestemming voor de beeldserver.

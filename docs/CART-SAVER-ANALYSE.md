# Analyse: hoe kan de cart saver nog beter?

Stand: versie 1.0.3, die werkt op de live site. Deze analyse combineert twee
dingen:

- **Bronnenonderzoek** naar hoe het winkelmandje van Cardmarket werkt: de oude
  Cardmarket-API, de broncode van andere Cardmarket-tools, helppagina's en
  fora.
- **Een kritische code-review** van onze eigen cart-saver-logica.

Labels:
- **[Officieel]** = een pagina van Cardmarket of echte opgeslagen HTML;
- **[Code]** = open-source code van andere tools;
- **[Derden]** = een forum of andere extensie;
- **[Afgeleid]** = een eigen inschatting.

---

## 1. Samenvatting

**De vijf belangrijkste verbeteringen:**

1. **Na afrekenen niet "ontbreekt" tonen.**
   - Nu worden gekochte kaarten als ontbrekend gemarkeerd zolang je de
     bestelpagina niet hebt geopend. Eén klik zet ze dan terug.
   - Dit is de grootste valkuil (§3, B2).
2. **Een gedeeltelijk gelezen mandje niet vertrouwen.**
   - Vergelijk het aantal gelezen rijen met de teller in de header.
   - Anders kunnen artikelen onterecht als ontbrekend gelden (B4).
3. **Slimmer terugzetten:**
   - per verkoper in één verzoek (*batch*);
   - het juiste aantal (dus "1 van de 2" herkennen);
   - alleen echt verkochte artikelen als *niet beschikbaar* markeren (B5,
     B6, V1).
4. **Laten zien wáárom iets uit het mandje verdween.** Mogelijke redenen:
   verlopen, verkoper weg of op vakantie, verkocht, of de prijs is gewijzigd.
   Waarschuw ook als de prijs of het aantal veranderde (V2, V3).
5. **Vervanging voor verkochte artikelen.**
   - Eerst bij dezelfde verkoper, daarna het goedkoopste gelijkwaardige
     aanbod.
   - Verkopers die al in je mandje zitten krijgen voorrang, want dat scheelt
     verzendkosten (V4).

**Al opgelost in 1.0.3:** een traag toevoegverzoek kon via een tweede route
nog eens verstuurd worden, waardoor een artikel dubbel in het mandje kwam.

## 2. Wat we nu weten over het Cardmarket-mandje

| Feit | Bron |
|---|---|
| Artikelen in een mandje zijn **gereserveerd**. Andere kopers zien ze niet meer in het aanbod, en verkopers kunnen opvragen welke van hun artikelen in iemands mandje zitten. | **[Code]**: oude API, `GET /stock/shoppingcart-articles` (mkmsdk) en het veld `inShoppingCart` (MKMTool). **[Derden]**: mtg-forum.de 2021 ("verschwinden die Karten aus der Liste der Angebote") |
| Het mandje bestaat uit **één reservering per verkoper**: `idReservation`, verkoper, artikelen, waarde, verzendmethode. Er is geen veld met een verloopdatum. | **[Code]**: nicho92/mkm-api-java `ShoppingCart.java` |
| Cardmarket toont een **tijd waarop het mandje wordt geleegd** ("oben wird mir eine Uhrzeit angezeigt…"). Er is geen bekende selector voor die melding. | **[Derden]**: mtg-forum.de 2021 |
| Na **~1 uur** kan het mandje geleegd worden. Na 1–2 uur zonder activiteit mag de verkoper artikelen eruit halen. | **[Derden]**: mtg-forum.de 2015/2022/2024 |
| Gaat een verkoper **op vakantie**, dan worden mandjes die al een uur of langer bestaan geleegd, en is zijn aanbod niet meer te koop. | **[Derden]**: mtg-forum.de 2024. **[Officieel]**: help-pagina vacation-status |
| Cardmarket logt je ongeveer **elke 20 minuten uit**. Enhanced Cardmarket heeft daarom "Remember Login". | **[Derden]**: Enhanced Cardmarket |
| **Meerdere artikelen in één verzoek** toevoegen kan: `idArticle={id:id,…}` en `amount={id:n,…}`. Wat er gebeurt als één artikel in zo'n batch niet meer bestaat, is onbekend. | **[Code]**: cardmarket_wizard `shopping_cart_service.dart`, de oude API `PUT /shoppingcart` |
| **Verwijderen** gaat via `ShoppingCart_RemoveArticle` met `idArticle`, `idSeller` en `amount-<id>`. Dat maakt "ongedaan maken" mogelijk. | **[Code]**: Lugin `cart.ts` |
| **Tracked verzending** is verplicht boven €25 per zending, en soms al boven €10. Verzendtarieven zijn op te vragen via `help.cardmarket.com/api/shippingCosts`. | **[Officieel]**: ShippingCosts. **[Code]**: Lugin `shipping.ts` |
| Een **openbare prijsgids** wordt dagelijks bijgewerkt (`price_guide_{spel}.json`). | **[Code]**: cm-scripts, Cardmarket Helper |
| De Shopping Wizard heeft een limiet van 10 keer per dag. "Alles in mandje" vraagt 6 afgeronde aankopen. Aanbodpagina's tonen maximaal 300 aanbiedingen. | **[Officieel]**: help ShoppingWizard. Opgeslagen HTML |

## 3. Zwakke plekken in de huidige cart saver (code-review)

| # | Probleem | Ernst | Oplossing |
|---|---|---|---|
| B1 | ~~Een POST kon dubbel verstuurd worden na een verloren antwoord~~ | hoog | **Opgelost in 1.0.3:** een schrijfverzoek gaat nooit via een tweede route. |
| B2 | **Opgelost in 1.0.4:** de checkout-knop of het checkout-formulier markeert de artikelen van die verkoper, en wat daarna verdwijnt wordt vergeten.<br>~~Na **afrekenen** staat alles wat je kocht op *ontbreekt*. De melding biedt aan het terug te zetten, en het icoon telt het mee. Pas het openen van elke bestelpagina ruimt het op.~~ | hoog | Afrekenen herkennen via de page bridge (de checkout-aanvraag van de site), of na een grote daling de pagina `/Orders/Purchases` lezen. Verdwijnt alles in één keer, gebruik dan een aparte status "gekocht?", zonder herinnering. |
| B3 | **Opgelost in 1.1.0:** de terugzet-actie houdt een Web Lock vast zolang hij loopt; die verdwijnt met de tab. Elke stap controleert of deze tab nog de eigenaar is, en de time-out is 2 minuten.<br>~~Twee tabbladen kunnen dezelfde terugzet-actie draaien. De lock is niet hard. In een achtergrondtab vertraagt Chrome bovendien de heartbeat, waardoor de actie na 30 s "dood" lijkt terwijl hij nog loopt.~~ | hoog (zeldzaam) | Laat de service worker de lock beheren, en houd via een verbinding (`runtime.connect`) bij of de tab nog leeft. Controleer elke stap of deze tab nog de eigenaar is. Verhoog de time-out naar 2 minuten. |
| B4 | **Opgelost in 1.1.0:** een verkopersblok zonder leesbare rijen, of minder artikelen dan de header telt, maakt het mandje onbetrouwbaar.<br>~~Een gedeeltelijk gelezen mandje geldt als betrouwbaar zodra er één rij gelezen is. Ontbrekende rijen worden dan als *ontbreekt* gemarkeerd, en de controle vooraf zou ze opnieuw toevoegen.~~ | middel-hoog | Vergelijk het aantal rijen (som van `data-amount`) met de teller in de header. Klopt het niet, dan niet vertrouwen. |
| B5 | **Opgelost in 1.1.0:** weigeringen worden ingedeeld (verkocht, te weinig, onbekend). Bij elke onbekende weigering een vers token (max. 3 per actie). Alleen "verkocht" of de tweede onbekende weigering op rij geeft *niet beschikbaar*. Algemene tokenplekken (`data-token`, `csrf-token`) tellen alleen nog met een hex-waarde.<br>~~Elke weigering wordt *niet beschikbaar*. Het token wordt maar één keer ververst, en alleen vóór het eerste succes. Verloopt het token halverwege, dan wordt de rest ten onrechte afgeschreven.~~ | middel | Ververs het token bij elke algemene weigering. Markeer alleen bij een bekende "verkocht"-melding als *niet beschikbaar*; anders blijft het *ontbreekt*, met de reden erbij. Zoek alleen nog naar hex-tokens. |
| B6 | **Opgelost in 1.1.0:** het gewenste aantal wordt apart bewaard, met de status *deels in mandje*. Alleen het verschil gaat terug; bij "te weinig" opnieuw met 1. Zelf verlagen wordt het nieuwe gewenste aantal.<br>~~Aantallen worden niet verzoend. Opgeslagen 2 en nu 1 in het mandje geeft stilletjes "1, in mandje". 2 terugzetten terwijl de verkoper er nog maar 1 heeft, wordt geweigerd en het artikel heet dan *niet beschikbaar*.~~ | middel | Bewaar het gewenste aantal en het aantal in het mandje apart. Voeg een status *gedeeltelijk* toe. Zet het verschil terug. Bij een weigering: opnieuw proberen met 1 of met het beschikbare aantal. |
| B7 | **Opgelost in 1.0.4:** herkenning via het eigen verwijderverzoek van de site (`ShoppingCart_RemoveArticle` en andere remove-acties), via formulieren en via strengere knopherkenning.<br>~~**Herkenning van verwijderen** gaat via een klik-heuristiek. "Alles van verkoper verwijderen" en "mandje legen" worden gemist, en een klik op een kaart als "Remove Soul" telt onterecht als verwijderen. | middel | Vang de eigen `ShoppingCart_Remove*`-aanvragen van de site op via de page bridge. Bewaar verwijderde artikelen kort, zodat je ze kunt terugzetten. |
| B8 | **Opgelost in 1.1.0:** opruimen in een `finally`, een waarschuwing bij het verlaten van de pagina, en *Doorgaan (N te gaan)* na een gesloten tab.<br>~~Een afgebroken actie (tab gesloten of weggeklikt) verdwijnt zonder melding. Een fout na de hoofdlus kan de lock laten hangen.~~ | middel | Ruim op in een `finally`. Waarschuw bij het verlaten van de pagina. Bied "Doorgaan (N te gaan)" aan; dat is veilig omdat de controle vooraf opnieuw draait. |
| B9 | **Opgelost in 1.3.0:** het paneel en de popup tekenen niet opnieuw bij alleen een heartbeat, en artikelen die een maand *niet beschikbaar* zijn worden opgeruimd.<br>~~Opslag en snelheid. Alles staat in één opslagsleutel. Er wordt vaak geschreven (heartbeat elke 5 s), en het paneel leest bij elke wijziging alles opnieuw en tekent alles opnieuw. Niets wordt ooit opgeruimd.~~ | middel | Lees alleen de gewijzigde waarden. Sla tekenen over bij alleen een heartbeat. Hergebruik de iconen. Schrijf niet als er niets veranderd is. Archiveer automatisch artikelen die lang *niet beschikbaar* of *ontbreekt* zijn. |
| B10 | **Opgelost in 1.3.0:** na 15 minuten wordt het mandje opnieuw gelezen, ook bij dezelfde teller, door één tab tegelijk (`navigator.locks`).<br>~~Laat opgemerkt, en pieken bij veel tabbladen. Een verkochte kaart die tegelijk door een nieuwe wordt vervangen geeft dezelfde teller en wordt gemist. Herstel je een sessie met veel tabs, dan haalt elk tabblad het mandje tegelijk op.~~ | middel-laag | Synchroniseer ook als de laatste synchronisatie langer dan 15 minuten geleden is. Laat één tab synchroniseren (`navigator.locks`). Verwerk de eigen toevoegingen van de site direct. |
| B11 | **Opgelost in 1.1.0:** favorieten die niet geprobeerd of niet gelukt zijn, worden aan het einde opgeruimd.<br>~~Favorieten die nooit zijn toegevoegd kunnen als opgeslagen artikel achterblijven (bij een fout of stoppen).~~ | laag | Ruim aan het einde van elke actie de favorieten op die niet geprobeerd zijn. |
| B12 | **Opgelost in 1.1.0:** een actie uit de popup start alleen in een zichtbare, ingelogde tab; op de loginpagina stopt hij met een melding.<br>~~Een vanuit de popup gestarte actie kan door een willekeurig tabblad worden opgepakt, ook een tab met een controlepagina.~~ | laag | Onthoud het doel-tabblad. Hervat alleen op een ingelogde pagina zonder controle. |
| B13 | **Opgelost in 1.1.0:** de gebruikersnaam uit het accountmenu wordt bewaard. Bij een ander account wordt niets opgeslagen of als ontbrekend gemarkeerd, tot je kiest voor dat account.<br>~~Geen scheiding per account. Wissel je van Cardmarket-account, dan lijkt alles te ontbreken.~~ | laag | Bewaar de gebruikersnaam bij de artikelen en pauzeer als die niet klopt. |
| B14 | **Opgelost in 1.3.0:** een privé `MessageChannel`; de hello wordt door de bridge als eerste opgevangen en tegengehouden, en `__cmcsBridge` is weg.<br>~~Bridge. Een ander script op de pagina zou een vervalst antwoord kunnen sturen. De site kan de extensie herkennen aan `__cmcsBridge`.~~ | laag | Een privé `MessageChannel` tussen de content script en de bridge. |
| B15 | **Opgelost in 1.1.0:** de samenvatting telt na de controle, de details zijn taalneutraal (Engels), links in een import worden gecontroleerd en de "bezig"-melding is geen `alert()` meer.<br>~~Kleine dingen: de samenvatting telt vóór de controle achteraf; het woord "gezocht" staat vast in het Nederlands in de details; een ongeldige `productUrl` in een import kan de weergave breken; de "bezig"-melding gebruikt `alert()`.~~ | laag | Kleine fixes. |

## 4. Verbeteringen (functioneel)

| # | Verbetering | Waarom / bron | Hoe | Moeite |
|---|---|---|---|---|
| V1 | **Opgelost in 1.2.0.** **Terugzetten in batches** | Het endpoint accepteert lijsten **[Code]** | Eén verzoek per verkoper. Daarna het mandje lezen; wat niet is aangekomen, alsnog per stuk proberen. Bij 40 verkopers zijn dat 40 verzoeken in plaats van 200. | S–M |
| V2 | **Opgelost in 1.1.0** (reden per artikel in popup en paneel). **Reden waarom iets uit het mandje is** | Verlopen, verkoper weg of op vakantie, verkocht **[Derden]**/**[Officieel]** | Vergelijk momentopnames: is alles weg, dan verlopen of uitgelogd. Is één verkoper weg, dan heeft die verkoper het verwijderd of is hij op vakantie. Is één rij weg, dan is het verkocht of verwijderd. Zet de reden in de lijst. | S–M |
| V3 | **Opgelost in 1.1.0:** prijswijziging en "1 van de 2" worden getoond. **Prijs of aantal veranderd** | De controle achteraf leest `data-price` en `data-amount` al | "+€0,30 sinds je hem opsloeg", "nog maar 1 van de 2" | S |
| V4 | **Opgelost in 1.2.0** (in het paneel op Cardmarket). **Vervanging voor verkochte artikelen** | Regroupeur, CardmarketUtilities **[Code]** | 1) Bij dezelfde verkoper zoeken (`/Users/{verkoper}/Offers/Singles?name=…&sortBy=price_asc`), tot +25%. 2) Het goedkoopste gelijkwaardige aanbod, gefilterd op taal, conditie en foil. Verkopers in je mandje krijgen voorrang, want dat kost €0 extra verzending. Altijd na een klik, in rustig tempo. | M–L |
| V5 | **Opgelost in 1.3.0** (tekst op de live site nog te bevestigen). **Aftellen tot het mandje leeg is, plus een melding** | De tijdmelding bestaat **[Derden]** | Lees de tijd uit de melding op de mandjepagina. Stuur 5 minuten vooraf een melding via `chrome.alarms` (vraagt de permissie `notifications`). Dit kost geen extra verzoeken. Eerst de selector op de live site vastleggen. | S |
| V6 | **Opgelost in 1.3.0** (verzendkosten lezen op de live site nog te bevestigen). **Verzendpaneel per verkoper** | €25-regel **[Officieel]**, Lugin `shipping.ts` **[Code]** | Per verkoper: geschatte verzendkosten, het aandeel verzending, "nog €x tot tracked", en hoeveel er nog in de brief past. | M |
| V7 | **Opgelost in 1.2.0:** ongedaan maken van het terugzetten en van verwijderen, mandjes met een naam, export als tekst of CSV. **Momentopnames, ongedaan maken en exporteren** | Lugin remove-endpoint **[Code]** | Sla vóór elke actie automatisch een momentopname op. "Ongedaan maken" verwijdert wat net is toegevoegd. Mandjes krijgen een naam ("Commander-deck"). Export als tekst of CSV. | S–M |
| V8 | **Opgelost in 1.3.0** (instelbaar, standaard uit). **Prijs tegenover trend vóór het terugzetten** | Openbare prijsgids **[Code]** | Haal die één keer per dag op en bewaar alleen de producten die je hebt opgeslagen. Waarschuw bij een flinke meerprijs. | M |
| V9 | **Terugval naar de wants-lijst** | Wants-endpoints, "Sellers with most wants" **[Code]** | "Zet de onbeschikbare artikelen op een wants-lijst", na bevestiging, want dit verandert je account. Daarna de verkopers rangschikken die er het meeste van hebben. | M–L |
| V10 | **Opgelost in 1.3.0** (instelbaar, standaard uit). **Beleefd controleren als je weg bent** | De ondergrens voor alarms is 30 s. Cardmarket klaagt over serverbelasting **[Officieel]** | Staat standaard uit. Alleen als er een Cardmarket-tab open is en je actief bent, hooguit elke 10 minuten. Geen keep-alive. | S |

**Bewust niet:** het mandje "warm houden" met keep-alive-verzoeken. Juist dat
parkeren van artikelen bestreed Cardmarket met de inactiviteitsregel, en het
benadeelt andere kopers.

## 5. Voorgestelde volgorde

| Versie | Inhoud | Waarom eerst |
|---|---|---|
| **1.1 — Betrouwbaar** | B2 afrekenen herkennen, B4 mandje-telling, B5 weigeringen en token, B6 aantallen, B7 verwijderingen via de bridge, B8 hervatten en opruimen, B3 lock | Voorkomt verkeerde statussen en onterecht terugzetten. Kost weinig zichtbare UI. |
| **1.2 — Slim terugzetten** | V1 batches, V2 reden, V3 prijs of aantal veranderd, V4 vervanging, V7 momentopnames en ongedaan maken | De kern van de cart saver wordt sneller en slimmer. |
| **1.3 — Inzicht** | V5 aftellen en melding, V6 verzendpaneel, V8 prijs tegenover trend, B9 snelheid en opruimen | Comfort en geld besparen. Vraagt deels nieuwe permissies. |
| **Later** | V9 wants-lijst, V10 controleren als je weg bent, B13 accounts, B14 bridge via `MessageChannel` | Groter, of alleen nuttig voor sommige gebruikers. |

## 6. Bronnen

- **Code** (lokaal bekeken):
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): `cart.ts`,
    `cartStore.ts`, `shipping.ts`, `shoppingWizard.ts`, `wants.ts`,
    `CartConsolidation.tsx`;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    `cart.js`, `cm.js`, `fetcher.js`, `optimizer.js`;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard):
    `shopping_cart_service.dart`.
- **Clients voor de oude API:**
  - [nicho92/mkm-api-java](https://github.com/nicho92/mkm-api-java);
  - [friscoMad/mkm-api2](https://github.com/friscoMad/mkm-api2);
  - [matnad/mkmapi](https://github.com/matnad/mkmapi);
  - [alexander-pick/MKMTool](https://github.com/alexander-pick/MKMTool);
  - mkmsdk (PyPI).
- **Userscripts:**
  - [DavidSdot/CardmarketUtilities](https://github.com/DavidSdot/CardmarketUtilities);
  - [mfiferna/cm-scripts](https://github.com/mfiferna/cm-scripts).
- **Cardmarket:**
  - [ShippingCosts](https://help.cardmarket.com/en/ShippingCosts);
  - [ShoppingWizard](https://help.cardmarket.com/en/ShoppingWizard);
  - [Vacation status](https://help.cardmarket.com/en/vacation-status);
  - [Update on the Shopping Wizard](https://news.cardmarket.com/en/FoW/update-on-the-shopping-wizard).
- **Forum:** [mtg-forum.de, MKM-topic](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-919).
- **Overig:**
  - [Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/);
  - [MDN alarms.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create).

> De sites van Cardmarket en het forum waren vanuit de onderzoeksomgeving
> niet direct te openen. Officiële teksten en forumposts komen uit
> zoekresultaten. De code van andere tools is wel direct gelezen.

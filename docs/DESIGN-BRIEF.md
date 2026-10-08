# Design-brief — Cardmarket Cart Saver

> **Opdracht.** Ontwerp de volledige interface van *Cardmarket Cart Saver*,
> een browserextensie voor Chrome. Het gaat om vier onderdelen:
>
> - de **popup** onder het extensie-icoon;
> - het **paneel** dat de extensie op cardmarket.com toont;
> - de **ster-knop** die de extensie bij aanbiedingen op cardmarket.com
>   plaatst;
> - de **instellingenpagina**.
>
> Lever elk scherm in alle toestanden die hieronder staan, in licht én donker,
> met Nederlandse teksten. Voeg een componentenoverzicht toe. De bestaande
> functies werken al: dit is een redesign van een werkende extensie, geen
> concept. Respecteer daarom de vaste maten en randvoorwaarden in §4.

---

## 1. Wat is het?

**Cardmarket** (cardmarket.com) is de grootste Europese marktplaats voor
ruilkaarten: Magic: The Gathering, Pokémon, Yu-Gi-Oh!, One Piece, Lorcana en
meer. Duizenden verkopers bieden er losse kaarten aan.

Belangrijk om te snappen:

- **Een artikel is één aanbieding van één verkoper.** Bijvoorbeeld:
  *"Sol Ring, Commander Masters, conditie Excellent, Duits, €1,10, verkoper
  CardKingdomNL, 3 op voorraad"*. Dezelfde kaart kan honderden aanbiedingen
  hebben, van verschillende verkopers, in verschillende condities, talen en
  prijzen.
- **Het winkelmandje wordt automatisch geleegd.** Artikelen in je mandje zijn
  tijdelijk voor je gereserveerd. Na een tijdje (of als een verkoper ze eruit
  haalt) leegt Cardmarket je mandje. Wie zorgvuldig kaarten bij elkaar heeft
  gezocht, bij meerdere verkopers en in de juiste conditie en taal, is dat
  werk dan kwijt.

**Cardmarket Cart Saver lost dat op.**

- Hij onthoudt automatisch alles wat je in je mandje legt.
- Is je mandje geleegd, dan zet hij alles met één klik terug, zolang het
  artikel nog te koop is.
- Daarnaast kun je specifieke aanbiedingen met een ☆ als **favoriet**
  bewaren en later makkelijk terugvinden.

**Productbelofte in één zin:** *"Nooit meer je zorgvuldig gevulde
Cardmarket-mandje kwijt, en altijd die ene aanbieding terugvinden."*

## 2. Voor wie?

- **Verzamelaars en spelers** van ruilkaartspellen, 16–45 jaar, vooral uit
  Nederland en België (de interface is Nederlands, met Engels als
  alternatief).
- Ze kopen regelmatig op Cardmarket, vaak tientallen kaarten per keer, bij
  meerdere verkopers tegelijk, bijvoorbeeld om een deck compleet te maken.
- Ze letten scherp op conditie (NM, EX, …), taal, foil en prijs per stuk, en
  vinden verzendkosten belangrijk.
- Ze gebruiken het op **desktop**, in Chrome, Edge of Brave, tijdens het
  shoppen op Cardmarket.
- **Kenmerken:** ze kennen Cardmarket goed, zijn handig met de computer en
  willen snelheid en overzicht. Ze vinden het niet fijn als een extensie
  "schreeuwt" op een site die ze vaak gebruiken.

## 3. Belangrijkste scenario's (user journeys)

1. **Mandje kwijt, en weer terug.**
   1. Milan legt 12 kaarten van 4 verkopers in zijn mandje. Cart Saver slaat
      ze stil op; rechtsonder ziet hij alleen een klein label
      *"Cart Saver · 12 opgeslagen"*.
   2. Een dag later bezoekt hij Cardmarket en het mandje is leeg.
   3. Rechtsonder verschijnt de melding **"Je winkelmandje is geleegd — 12
      opgeslagen artikelen (€38,40) zitten niet meer in je winkelmandje"**.
   4. Hij klikt op **Zet 12 artikel(en) terug**. Een voortgangsbalk loopt,
      artikel voor artikel.
   5. Resultaat: *"10 in je mandje gezet, 2 niet beschikbaar"*. De twee
      verkochte artikelen staan erbij, met de reden en een knop
      **Zoek vergelijkbaar aanbod**.
2. **Een aanbieding bewaren voor later.** Milan twijfelt over een dure foil
   en klikt op de ☆ naast die aanbieding. Een week later opent hij de popup,
   tab **Favorieten**, en zoekt "foil". Hij klikt de aanbieding aan:
   Cardmarket opent en de aanbieding wordt gemarkeerd. Ook kan hij hem direct
   **In winkelmandje leggen**.
3. **Terugzetten vanuit de popup.** Milan zit op een andere site, ziet het
   oranje getal op het extensie-icoon en klikt **Zet terug** in de popup.
   Cardmarket opent in een nieuw tabblad en het terugzetten start daar vanzelf.
4. **Een favoriet is verkocht.** Hij opent een favoriet die niet meer bestaat.
   Op de pagina verschijnt: *"Favoriet niet op deze pagina — misschien is hij
   verkocht"*, met de knoppen **Zoek bij deze verkoper** en
   **Zoek vergelijkbaar aanbod**.

## 4. Waar de interface leeft, en vaste randvoorwaarden

| Onderdeel | Plek | Maat en randvoorwaarden |
|---|---|---|
| **A. Popup** | Klik op het extensie-icoon in de werkbalk. | **400 px breed**, maximaal **600 px hoog** (Chrome-limiet). De inhoud scrolt binnen de popup. Header en tabs blijven staan. |
| **B. Paneel op Cardmarket** | Zweeft rechtsonder over cardmarket.com. | **380 px breed**, maximaal 72% van de schermhoogte (de inhoud scrolt). Afstand tot de rand: 16 px. Onder 480 px schermbreedte: volle breedte met 8 px marge. Staat boven alles. Draait in een eigen afgeschermde laag (shadow DOM), dus de stijl van Cardmarket heeft er geen invloed op. |
| **C. Ster-knop** | In elke aanbiedingsrij op productpagina's, kaartpagina's en verkoperspagina's, links van de winkelwagen-knop van Cardmarket. Ook in elke rij van het winkelmandje. | Klikvlak 28×28 px, icoon 18 px. Moet passen in de compacte tabelrijen van Cardmarket, die witte of lichtgrijze rijen hebben. |
| **D. Markering** | Een aanbieding waar je via de popup naartoe springt. | Een rand of gloed rond de bestaande Cardmarket-rij. Die wordt in de pagina gescrold. |
| **E. Instellingen** | Volledig browsertabblad. | Inhoud maximaal 640 px breed, gecentreerd. |
| **F. Icoon en badge** | Werkbalk van de browser. | Icoon van 16, 32, 48 en 128 px. Een badge met het aantal ontbrekende artikelen (oranje/amber, maximaal 3 tekens). |

**Algemeen:**

- **Licht en donker** volgen de systeeminstelling (`prefers-color-scheme`).
- **Taal:** Nederlands, met Engels als alternatief. Nederlandse teksten zijn
  vaak langer, dus houd ruimte voor tekst die doorloopt of wordt afgekapt.
- **Lettertype:** het systeemlettertype (`system-ui`). Er worden geen
  webfonts geladen.
- **Iconen:** eenvoudige lijn-iconen als inline SVG (16 px). Er worden geen
  externe bestanden geladen, behalve productafbeeldingen van Cardmarket's
  eigen CDN. Die hebben de verhouding van een kaart (~5:7) en worden als
  thumbnail van 30×42 px getoond.
- **Niet doen alsof je Cardmarket bent.** Gebruik niet het logo van
  Cardmarket of een look die op hun officiële interface lijkt. Het moet
  herkenbaar zijn als **een eigen hulpmiddel** bovenop de site.
- **Bescheiden op Cardmarket.** Het paneel mag niet storen of agressief
  ogen. Het verschijnt alleen als er iets te doen is. Op de winkelmandjepagina
  is het in te klappen tot een klein label.
- **Toegankelijkheid:** voldoende contrast (WCAG AA), een zichtbare focus,
  alles met het toetsenbord te bedienen en iconknoppen met een tooltip.

## 5. Gegevens die per artikel beschikbaar zijn

| Gegeven | Voorbeeld | Waar het nu getoond wordt |
|---|---|---|
| Kaartnaam | Sol Ring | overal (link) |
| Set / expansie | Commander Masters | metaregel |
| Conditie | MT, NM, EX, GD, LP, PL, PO | metaregel |
| Taal | English, German, Japanese… | metaregel |
| Extra's | Foil, Reverse Holo, Signed, First Edition | metaregel |
| Prijs per stuk | 1,10 € | rechts, vet |
| Aantal (in mandje) | ×2 | naast de prijs |
| Voorraad bij verkoper (favorieten) | 3 beschikbaar | extra regel |
| Verkoper | CardKingdomNL | regel "Verkoper: …" of groepskop |
| Afbeelding | kaartthumbnail | links, 30×42 |
| Status | In mandje / Ontbreekt / Niet beschikbaar | badge |
| Melding bij mislukken | "This article is no longer available." (de tekst van Cardmarket, vaak Engels) | rode regel |
| Datum bewaard (favorieten) | bewaard 7 okt | extra regel |
| Spel | Magic, Pokemon, YuGiOh… | spelkeuze (popup) |

**Statussen en hun kleurbetekenis:**

| Status | Betekenis | Kleur |
|---|---|---|
| **In mandje** | Het artikel zit in je winkelmandje. | groen |
| **Ontbreekt** | Het artikel is uit je mandje verdwenen en kan teruggezet worden. | amber |
| **Niet beschikbaar** | Terugzetten lukte niet, meestal omdat het verkocht is. | rood |
| **Favoriet** | Bewaard met een ster. | goud/amber, gevulde ster |

## 6. Scherminventaris, met alle toestanden

Teksten tussen aanhalingstekens zijn de huidige Nederlandse teksten.

### A. Popup

**Vaste delen (altijd zichtbaar):**

- **Header.** Logo (blauw rond vierkant met een wit winkelwagentje en een
  amber stip) en de titel **"Cart Saver"**. Een **spelkeuze**
  (dropdown, alleen zichtbaar bij artikelen uit meerdere spellen). Een
  tandwiel voor **Instellingen**.
- **Tabs.** **"Winkelmandje"** en **"Favorieten (2)"**, met het aantal in de
  tabnaam.
- **Footer.** *"Alles wordt lokaal in je browser bewaard. Cart Saver praat
  alleen met cardmarket.com, via je eigen sessie."* Dit is een
  vertrouwenssignaal en blijft dus zichtbaar.

**Voortgangsblok** (boven de inhoud, in beide tabs):

1. *Wachten:* "Wachten tot Cardmarket opent…", een voortgangsbalk op 0% en
   **Stoppen**.
2. *Bezig:* "Artikelen worden teruggezet in je mandje…", een voortgangsbalk,
   "3 van 12" en **Stoppen**.
3. *Klaar:* "**Klaar** — 10 in je mandje gezet, 2 niet beschikbaar." met
   **Sluiten**.
4. *Gestopt door een fout:* "**Gestopt** — …" plus een rode foutmelding (zie
   §6E) en **Sluiten**.
5. *Gestopt door de gebruiker:* een grijze tekst "Gestopt voordat alle
   artikelen waren teruggezet."

**Meldingsregel** (klein en grijs, onder het voortgangsblok). Bijvoorbeeld:
"Je winkelmandje op Cardmarket wordt geopend — het terugzetten start vanzelf."
of "Er worden al artikelen teruggezet — wacht tot dat klaar is."

**Tab "Winkelmandje":**

- **Tellers:** drie tegels, "In mandje" (groen getal), "Ontbreekt" (amber) en
  "Niet beschikbaar" (rood).
- **Knoppen:**
  - primair: **"Zet 3 artikel(en) terug"**, of uitgeschakeld met de tekst
    "Niets om terug te zetten";
  - secundair: **"Open winkelmandje"**.
- **Filterchips** met aantallen: "Alles (5)", "Ontbreekt (3)",
  "In mandje (2)", "Niet beschikbaar (0)".
- **Lijst per verkoper.** Elke groep heeft een kop met de verkopersnaam en het
  aantal, bijvoorbeeld "snowc (2)". Een artikelrij bevat:
  - een thumbnail;
  - de naam als link;
  - een metaregel ("Commander 2018 · NM · English · Foil");
  - bij mislukken een rode regel met de reden;
  - rechts de prijs, het aantal ("0,99 € ×2") en een statusbadge;
  - iconknoppen: ☆/★ (favoriet), 🔍 (vergelijkbaar aanbod, alleen als het
    artikel niet in het mandje zit), ↻ (terugzetten, alleen als het niet in
    het mandje zit) en × (verwijderen uit de lijst).
- **Leeg:** "Nog niets opgeslagen", "Open je winkelmandje op Cardmarket; Cart
  Saver onthoudt de artikelen automatisch." en de knop **Open Cardmarket**.
- **Filter zonder resultaat:** "Geen artikelen in deze weergave."

**Tab "Favorieten":**

- **Zoekveld:** "Zoek in favorieten (naam, set, verkoper…)". Er kan op
  meerdere woorden gezocht worden, bijvoorbeeld "mint foil".
- **Lijst**, nieuwste bovenaan. Een rij bevat:
  - een thumbnail;
  - de naam, die linkt naar de aanbieding;
  - een metaregel;
  - "Verkoper: CardKingdomNL";
  - "3 beschikbaar · bewaard 7 okt";
  - rechts de prijs.

  Iconknoppen:
  - 🛒 **In winkelmandje leggen** (verborgen als het al in het mandje zit; er
    staat dan een groene badge "In mandje");
  - ↗ **Bekijk aanbieding op Cardmarket**;
  - 👤 **Zoek bij deze verkoper**;
  - ★ **Verwijder uit favorieten** (gevuld, goud).

  Is een favoriet verkocht, dan staat er een rode regel met de reden.
- **Leeg:** "Nog geen favorieten", "Klik op de ☆ bij een aanbieding op
  Cardmarket (of een artikel in je winkelmandje) om hem hier te bewaren."
- **Geen zoekresultaat:** "Geen favorieten gevonden voor deze zoekopdracht."

### B. Paneel op cardmarket.com

Het paneel toont altijd maximaal één weergave, in deze volgorde van
voorrang:

1. **Bezig met terugzetten.**
   - Titel "Bezig met terugzetten".
   - "Artikelen worden teruggezet in je mandje…", een voortgangsbalk en
     "3 van 12 · Sol Ring".
   - Knop **Stoppen**.
2. **Resultaat** (tot 10 minuten na afloop).
   - Titel "Klaar" of "Gestopt", met ×.
   - "10 in je mandje gezet, 2 niet beschikbaar."
   - Een eventuele rode foutmelding.
   - Een lijst van de mislukte artikelen, met 🔍 en ×.
   - Knoppen **Open winkelmandje** (niet op de mandjepagina zelf) en
     **Sluiten**.
3. **Favoriet niet gevonden.**
   - Titel "Favoriet niet op deze pagina", met ×.
   - "Deze aanbieding van MintCondition staat hier niet. Misschien is hij
     verkocht, of staat hij verderop in de lijst."
   - Knoppen **Zoek bij deze verkoper** (primair) en **Zoek vergelijkbaar
     aanbod**.
4. **Mandjepaneel** (alleen op de winkelmandjepagina).
   - Titel "Cart Saver", met de knop – om in te klappen.
   - Intro: "9 artikel(en) in je mandje opgeslagen.", of "Je winkelmandje is
     leeg. Deze opgeslagen artikelen kun je terugzetten:".
   - **Groep "Niet meer in je mandje (3)"**, met rechts de link
     "Alles selecteren" / "Niets selecteren". Elke rij heeft een vinkje en ×.
     Primaire knop: **"Zet 3 artikel(en) terug · 12,50 €"**. Die is
     uitgeschakeld als niets is aangevinkt.
   - Ontbreekt er niets: "Alles wat je hebt opgeslagen zit in je mandje."
   - **Groep "Niet meer beschikbaar (2)"**, met de link "Lijst opschonen".
     De rijen tonen de reden van Cardmarket, met 🔍 en ×. Knop
     **Toch opnieuw proberen**.
   - Staat automatisch opslaan uit: de knop **Huidig mandje opslaan**.
5. **Ingeklapt label** (mandjepagina): een pil met een stip. Groen bij
   "Cart Saver · 9 opgeslagen", amber bij "Cart Saver · 3 te bekijken". Een
   klik klapt het paneel weer uit.
6. **Herinnering** (alle andere pagina's, alleen als er artikelen
   ontbreken).
   - Titel "Je winkelmandje is geleegd", met × (onthoudt dat je hem hebt
     weggeklikt).
   - "3 opgeslagen artikel(en) (5,78 €) zitten niet meer in je
     winkelmandje."
   - Knoppen **Zet 3 artikel(en) terug** (primair) en **Bekijken**
     (secundair).
7. **Niets te doen:** geen paneel.

### C. Ster-knop in Cardmarket's rijen

**Toestanden:**

- uit: lege ster, grijs;
- hover: lichte achtergrond en een amber kleur;
- aan: gevulde ster, goud;
- focus: blauwe focusring.

De tooltip is "Bewaar als favoriet" of "Verwijder uit favorieten". Laat de
ster zien in de context van een Cardmarket-rij: verkoper, conditiebadge,
taal-icoon, prijs, aantal en de blauwe winkelwagen-knop.

### D. Markering van een aanbieding

Springt de gebruiker via een favoriet naar een productpagina, dan krijgt de
juiste Cardmarket-rij een duidelijke amber rand met afgeronde hoeken.

### E. Foutmeldingen (in het voortgangsblok en het resultaat)

| Situatie | Tekst |
|---|---|
| Niet ingelogd | "Je bent niet ingelogd op Cardmarket. Log in en probeer het opnieuw." |
| Beveiligingscontrole | "Cardmarket toont een beveiligingscontrole. Ververs de pagina, voltooi de controle en probeer het opnieuw." |
| Te veel verzoeken | "Cardmarket vraagt om het rustiger aan te doen. Wacht een paar minuten en probeer het opnieuw." |
| Geen verbinding | "Geen verbinding met Cardmarket. Controleer je internetverbinding." |
| Mandje onleesbaar | "Je winkelmandje kon niet worden gelezen, dus er is niets toegevoegd (Cardmarket heeft mogelijk de opmaak veranderd). …" |
| Cardmarket gewijzigd | "Cardmarket heeft het toevoegen aan het mandje veranderd. Deze extensie heeft een update nodig." |
| Onverwacht | "Er ging iets mis. Probeer het opnieuw." |

### F. Instellingenpagina

1. **Kop:** het logo (48 px), "Cart Saver" en de beschrijving: "Onthoudt wat
   je in je Cardmarket-winkelmandje legt en zet het met één klik terug nadat
   je mandje is geleegd."
2. **Kaart "Instellingen":**
   - schakelaar **Mandje automatisch opslaan**, met uitleg;
   - schakelaar **Melding tonen op Cardmarket**, met uitleg;
   - getalveld **Pauze tussen artikelen (seconden)**, 0,5–10, standaard
     1,2, met uitleg ("vriendelijker voor Cardmarket");
   - na een wijziging kort de feedback "Opgeslagen.".
3. **Kaart "Je opgeslagen artikelen en favorieten":**
   - samenvatting: "5 opgeslagen: 2 in mandje, 1 ontbreken, 2 niet
     beschikbaar. 3 favoriet(en).";
   - knoppen **Exporteren (JSON)**, **Importeren** en **Alles wissen**. Die
     laatste is rood en vraagt om bevestiging;
   - een resultaatmelding, zoals "4 artikel(en) geïmporteerd."
4. **Kaart "Zo werkt het":** vijf genummerde stappen (opslaan, melding,
   terugzetten, gekocht verdwijnt, favorieten) plus de privacyzin.

## 7. Huidige visuele basis (vrij om te verbeteren)

| Token | Licht | Donker |
|---|---|---|
| Achtergrond | `#ffffff` | `#1b2029` |
| Vlak / surface | `#f5f7fa` | `#232a35` |
| Rand | `#dfe3ea` | `#343d4b` |
| Tekst | `#1c2430` | `#e7ebf1` |
| Tekst secundair | `#637083` | `#9aa5b5` |
| Accent (primaire knop, links) | `#1a5fd6` | `#4c8dff` |
| OK / in mandje | `#1d7f45` op `#e3f4ea` | `#5fd08f` op `#18382a` |
| Ontbreekt | `#8a5a00` op `#fff2d6` | `#f2c063` op `#3a2e14` |
| Niet beschikbaar / fout | `#b42318` op `#fde7e5` | `#ff8a80` op `#42201d` |
| Ster | `#e09a00` | `#f5b82e` |

- Hoekradius: 10 px voor panelen, 7 px voor knoppen, rond voor badges en chips.
- Schaduw: zacht en diep (het paneel zweeft boven Cardmarket).
- Basisgrootte: 13 px. Titels zijn 14–15 px, metaregels 12 px.
- De dichtheid is compact, want lijsten kunnen 50 of meer artikelen hebben.

**Gewenste uitstraling:** rustig, betrouwbaar en efficiënt, als een handig
gereedschap. Een vleugje "verzamelaar": kaarten, sterren, goud. Blijf zakelijk
genoeg dat het paneel niet uit de toon valt op Cardmarket. De naam
*"Cart Saver"* mag een eigen woordmerk krijgen. Een andere naam voorstellen
mag ook.

## 8. Toekomstige functies om ruimte voor te houden (optioneel)

Deze staan op de roadmap. Een ontwerp dat er al rekening mee houdt is mooi
meegenomen.

- **Zelftest-knop** in de instellingen ("Controleer of alles werkt"), met een
  resultaatlijst met vinkjes en kruisjes.
- **"Prijs veranderd sinds je hem opsloeg"**: een waarschuwing in het
  resultaat, zoals "€1,10 → €1,40".
- **Reden-labels** bij mislukken: *verkocht*, *verkoper op vakantie*, *minder
  op voorraad*.
- Een tab of sectie **"Recent bekeken"**: een automatische geschiedenis van
  aanbiedingen die je bekeek.
- **Labels en notities bij favorieten**, bijvoorbeeld "deck Atraxa" of
  "cadeau", plus een filter per label.
- **Kostenpaneel per verkoper** in het mandje: subtotaal, verzendkosten,
  kosten per kaart, en een waarschuwing rond **€25**. Boven dat bedrag is
  tracked verzending verplicht en worden de verzendkosten duurder.
- Op aanbiedingen het label **"Verkoper zit al in je mandje"**, met "+€0
  verzending" tegenover "+€1,25".
- **Benoemde mandjes**, zoals "Commander-deck" of "Pokémon 151": opslaan,
  terugzetten en vergelijken.
- **Ongedaan maken** na verwijderen (een melding met *Ongedaan maken*).
- **Prijs tegenover trend:** een label als "−12% t.o.v. trend" en een mini
  prijsgrafiek per favoriet.

## 9. Gevraagde opleveringen

1. **Popup, tab Winkelmandje:** gevuld (meerdere verkopers, alle drie de
   statussen), leeg, met de voortgang bezig, en met het resultaat klaar plus
   een fout.
2. **Popup, tab Favorieten:** gevuld, met een zoekresultaat, leeg, en met een
   verkochte favoriet.
3. **Paneel op Cardmarket:** alle zeven toestanden uit §6B, in de context van
   een (vereenvoudigde) Cardmarket-pagina.
4. **Ster-knop:** alle toestanden, in een Cardmarket-aanbiedingsrij en in een
   mandjesrij. Plus de markering van een aanbieding.
5. **Instellingenpagina.**
6. **Icoon** (16, 32, 48 en 128) en de badge.
7. **Componentenoverzicht:**
   - artikelrij (met varianten);
   - statusbadges;
   - knoppen (primair, secundair, gevaar, icoon);
   - voortgangsbalk;
   - tabs, filterchips en zoekveld;
   - lege toestanden;
   - het ingeklapte label.
8. Alles in **licht én donker**.

Ter referentie zijn screenshots van de huidige versie beschikbaar in
`docs/screenshots/`: de herinnering, het resultaat, de popup en de
favorieten.

# Design-prompt — Cardmarket Cart Saver (versie 1.4)

> **Kopieer alles vanaf hier naar Claude Design.** Voeg de screenshots uit
> `docs/screenshots/` toe als referentie voor hoe het er nu uitziet.

---

## Opdracht

Ontwerp de complete interface van **Cardmarket Cart Saver**, een
browserextensie voor Chrome die al werkt (versie 1.4). Dit is een
**redesign van een werkend product**, geen concept: alle functies en
toestanden hieronder bestaan en moeten een plek houden.

Het gaat om:

1. de **popup** onder het extensie-icoon (3 tabs);
2. het **paneel** dat rechtsonder op cardmarket.com zweeft (10 weergaven);
3. de **ster-knop** die de extensie bij aanbiedingen op cardmarket.com zet;
4. de **instellingenpagina**;
5. **bureaubladmeldingen**, het **icoon** en de **badge**.

Lever elk scherm in **alle toestanden** uit §6–§8, in **licht én donker**,
met de **Nederlandse teksten** uit dit document, plus een
**componentenoverzicht** en **design tokens**. Houd je aan de vaste maten en
randvoorwaarden in §4: het ontwerp wordt daarna in gewone HTML/CSS (zonder
framework, zonder webfonts) in de extensie gebouwd.

---

## 1. Wat is het?

**Cardmarket** (cardmarket.com) is de grootste Europese marktplaats voor
ruilkaarten: Magic: The Gathering, Pokémon, Yu-Gi-Oh!, One Piece, Lorcana en
meer. Duizenden verkopers bieden er losse kaarten aan.

Drie dingen die je moet weten:

- **Een artikel is één aanbieding van één verkoper**, bijvoorbeeld *"Sol Ring,
  Commander Masters, Excellent, Duits, 1,10 €, verkoper CardKingdomNL, 3 op
  voorraad"*. Dezelfde kaart heeft vaak honderden aanbiedingen.
- **Er is één winkelmandje voor alle spellen.** Een verkoper kan Magic- én
  Pokémon-kaarten in dezelfde zending hebben; je betaalt verzending per
  verkoper.
- **Cardmarket leegt het mandje vanzelf**: na verloop van tijd, als een
  verkoper op vakantie gaat of iets verkoopt. Wie zorgvuldig kaarten bij
  elkaar heeft gezocht, is dat werk dan kwijt.

**Cart Saver lost dat op.** Hij onthoudt alles wat je in je mandje legt,
merkt wanneer er iets uit verdwijnt (en waarom), en zet het met één klik
terug, zolang het nog te koop is. Is iets verkocht, dan zoekt hij een
vervanging. Daarnaast kun je aanbiedingen met een ☆ als **favoriet**
bewaren en je lijst als **mandje met een naam** opslaan.

**Productbelofte:** *"Nooit meer je zorgvuldig gevulde Cardmarket-mandje
kwijt."*

## 2. Voor wie?

- **Verzamelaars en spelers** van ruilkaartspellen, 16–45 jaar, vooral uit
  Nederland en België (interface Nederlands, Engels als alternatief).
- Ze kopen vaak tientallen kaarten per keer bij meerdere verkopers, letten
  scherp op conditie, taal, foil, prijs per stuk en verzendkosten.
- Desktop, in Chrome, Edge of Brave, tijdens het shoppen op Cardmarket.
- Ze kennen Cardmarket goed en willen **snelheid en overzicht**. Ze willen
  niet dat een extensie "schreeuwt" op een site die ze dagelijks gebruiken.

## 3. Belangrijkste scenario's

1. **Mandje geleegd, en weer terug.** Milan heeft 12 kaarten van 4 verkopers
   (Magic en Pokémon) in zijn mandje. Een dag later is het leeg. Rechtsonder
   op Cardmarket verschijnt *"Je winkelmandje is geleegd"*. Hij klikt
   **Zet 12 artikel(en) terug**; per verkoper gaat er één verzoek uit, een
   voortgangsbalk loopt. Resultaat: *"10 in je mandje gezet, 2 niet gelukt"*.
   Spijt? **Ongedaan maken** haalt precies die 10 weer uit zijn mandje.
2. **Alleen Pokémon terugzetten.** In het paneel zet hij de knop
   *"Magic (8)"* uit en laat *"Pokémon (4)"* aan.
3. **Een kaart is verkocht.** Bij *"Sol Ring — niet beschikbaar"* klikt hij
   ⇄ **Vervanging zoeken**. Hij krijgt drie voorstellen: dezelfde kaart bij
   dezelfde verkoper (+0,10 €), bij een verkoper die al in zijn mandje zit
   (geen extra verzendkosten) en het goedkoopste vergelijkbare aanbod. Eén
   klik op **Toevoegen** en het origineel verdwijnt uit de lijst.
4. **Minder exemplaren.** Hij had 2× Bojuka Bog; de verkoper verkocht er één.
   De rij toont *"1 van 2 in je mandje"* en terugzetten voegt alleen het
   ontbrekende exemplaar toe.
5. **Zelf iets verwijderen.** Haalt hij zelf iets uit zijn mandje, dan
   verdwijnt het ook stil uit Cart Saver (geen melding, het is geen
   probleem).
6. **Tab gesloten tijdens terugzetten.** De volgende Cardmarket-pagina toont
   *"Terugzetten onderbroken — Nog 5 te gaan"* met **Doorgaan (5 te gaan)**.
7. **Een deck bewaren.** In de popup, tab **Mandjes**, bewaart hij zijn
   lijst als *"Commander-deck"*. Weken later zet **In mandje zetten** alles
   in één keer terug.
8. **Op tijd gewaarschuwd.** Het paneel toont *"Cardmarket leegt je mandje om
   14:35 (nog 23 min)"*; 5 minuten vooraf komt er een bureaubladmelding.
9. **Een aanbieding bewaren.** Hij klikt op de ☆ bij een dure foil. Later
   vindt hij hem in de popup (tab **Favorieten**, zoeken op "foil") en legt
   hem met één klik in zijn mandje.

## 4. Waar de interface leeft, en vaste randvoorwaarden

| Onderdeel | Plek | Maat en randvoorwaarden |
|---|---|---|
| **A. Popup** | Klik op het extensie-icoon. | **400 px breed**, maximaal **600 px hoog** (Chrome-limiet). Header en tabs blijven staan; de inhoud scrolt. |
| **B. Paneel** | Zweeft rechtsonder over cardmarket.com. | **380 px breed**, maximaal 72% van de schermhoogte (inhoud scrolt), 16 px van de rand. Onder 480 px breed: volle breedte met 8 px marge. Draait in een afgeschermde laag (shadow DOM): Cardmarket's CSS heeft er geen invloed op. |
| **C. Ster-knop** | In elke aanbiedingsrij op Cardmarket (product-, kaart- en verkoperspagina's) en in elke mandjesrij. | Klikvlak 28×28 px, icoon 18 px; moet passen in Cardmarket's compacte witte/lichtgrijze tabelrijen. |
| **D. Markering** | Een aanbieding waar je vanuit een favoriet naartoe springt. | Rand of gloed rond de bestaande Cardmarket-rij. |
| **E. Instellingen** | Eigen browsertabblad. | Inhoud maximaal 640 px breed, gecentreerd. |
| **F. Meldingen** | Bureaubladmelding van het systeem. | Alleen titel, één zin tekst en het icoon (128 px). Geen eigen opmaak. |
| **G. Icoon en badge** | Werkbalk van de browser. | Icoon 16, 32, 48 en 128 px. Badge: amber, maximaal 3 tekens. |

**Algemeen:**

- **Licht en donker** volgen de systeeminstelling.
- **Taal:** Nederlands (Engels als alternatief). Nederlandse teksten zijn
  lang: ontwerp voor doorlopende en afgekapte tekst.
- **Lettertype:** `system-ui`. **Iconen:** lijn-iconen, inline SVG, 16 px.
  Productafbeeldingen komen van Cardmarket (kaartverhouding ~5:7, getoond als
  30×42 px); ontbreekt de afbeelding, dan een vlak met de eerste letter.
- **Niet op Cardmarket lijken.** Geen logo of officiële look van Cardmarket:
  het moet herkenbaar zijn als eigen hulpmiddel bovenop de site.
- **Bescheiden.** Het paneel verschijnt alleen als er iets te doen is, en is
  op de mandjepagina in te klappen tot een klein label.
- **Toegankelijk:** WCAG AA-contrast, zichtbare focus, volledig met het
  toetsenbord te bedienen, iconknoppen met tooltip.
- **Dichtheid:** compact. Lijsten kunnen 50+ artikelen hebben.

## 5. Gegevens per artikel

| Gegeven | Voorbeeld | Nu getoond als |
|---|---|---|
| Kaartnaam | Sol Ring | naam (link), afgekapt met … |
| Spel | Magic, Pokémon, Yu-Gi-Oh! | eigen regel, alleen als er meerdere spellen in beeld zijn |
| Set | Commander Masters | metaregel |
| Conditie | MT, NM, EX, GD, LP, PL, PO | metaregel |
| Taal | English, German, Japanese… | metaregel |
| Extra's | Foil, Reverse Holo, Signed | metaregel |
| Prijs per stuk | 1,10 € | rechts, vet |
| Aantal in mandje | ×2 | naast de prijs |
| Gewenst aantal | 2 (waarvan 1 in mandje) | regel "1 van 2 in je mandje" |
| Verkoper | CardKingdomNL | "Verkoper: …" of groepskop |
| Afbeelding | kaartthumbnail | links, 30×42 |
| Status | zie §6 | badge |
| Reden van verdwijnen | zie §6 | grijze regel |
| Prijswijziging | was 0,89 €, nu 0,99 € | amber/grijze regel, 3 dagen zichtbaar |
| Trendprijs | 0,50 € (openbare prijsgids) | regel, alleen bij een duidelijk verschil |
| Melding van Cardmarket | "This article is no longer available." (vaak Engels) | rode regel |
| Voorraad (favorieten) | 3 beschikbaar | extra regel |
| Bewaard op (favorieten) | bewaard 7 okt | extra regel |

## 6. Statussen

### 6.1 Status van een artikel

| Status | Betekenis | Kleur | Extra regel |
|---|---|---|---|
| **In mandje** | Zit in je winkelmandje. | groen | — |
| **Deels in mandje** | Zit erin, maar minder exemplaren dan je had (de verkoper verkocht er een paar). Telt mee als "in mandje" én als "ontbreekt". | amber | "1 van 2 in je mandje" |
| **Ontbreekt** | Uit je mandje verdwenen; kan terug. | amber | de reden, zie 6.2 |
| **Niet beschikbaar** | Terugzetten lukte niet: verkocht, of te weinig voorraad. Verdwijnt na een maand vanzelf uit de lijst. | rood | de melding van Cardmarket |

### 6.2 Reden waarom iets ontbreekt

| Reden | Tekst |
|---|---|
| Hele mandje leeg | "Je hele mandje werd geleegd" |
| Alles van één verkoper weg | "Alles van deze verkoper verdween uit je mandje" |
| Alleen dit artikel weg | "Alleen dit artikel verdween, waarschijnlijk verkocht" |

### 6.3 Extra informatie op een artikelrij

| Situatie | Tekst | Toon |
|---|---|---|
| Prijs gestegen | "Prijs 0,10 € hoger (was 0,89 €)" | waarschuwing (amber) |
| Prijs gedaald | "Prijs 0,10 € lager (was 0,99 €)" | neutraal |
| Duurder dan de trend (≥15% en ≥0,10 €) | "Trend 0,50 € · deze aanbieding is 98% duurder" | waarschuwing |
| Goedkoper dan de trend (≥15%) | "Trend 1,20 € · deze aanbieding is 20% goedkoper" | neutraal |
| Onduidelijke weigering | "Cardmarket nam het niet aan. Het blijft op je lijst, probeer het later opnieuw." | rood |
| Geaccepteerd maar niet in mandje | "Cardmarket accepteerde het, maar het staat niet in je mandje." | rood |

### 6.4 Status van een favoriet

| Status | Weergave |
|---|---|
| Favoriet | gevulde gouden ster ★ |
| In je mandje | groene badge "In mandje", knop *In winkelmandje leggen* verborgen |
| Verkocht | rode regel met de reden ("Niet meer beschikbaar.") |

### 6.5 Status van een terugzet-actie

| Status | Wat de gebruiker ziet |
|---|---|
| **Wachten** | Gestart vanuit de popup terwijl Cardmarket nog opent: "Wachten tot Cardmarket opent…", balk op 0%, **Stoppen**. |
| **Bezig** | "Artikelen worden teruggezet in je mandje…", voortgangsbalk, "3 van 12 · Sol Ring", **Stoppen**. Eerst één verzoek per verkoper, daarna los wat niet aankwam. Verlaat je de pagina, dan vraagt de browser of je zeker bent. |
| **Klaar** | "**Klaar** — 10 in je mandje gezet, 2 niet gelukt." Mislukte artikelen eronder. **Ongedaan maken**, **Open winkelmandje**, **Sluiten**. |
| **Gestopt (fout)** | "**Gestopt**" + rode foutmelding (§8E) + grijze regel "Details: …" (voor een bugmelding). |
| **Gestopt (door jou)** | Grijs: "Gestopt voordat alle artikelen waren teruggezet." |
| **Onderbroken** | De tab ging dicht: "**Terugzetten onderbroken** — Het tabblad werd gesloten of verlaten voordat alles terug was. Nog 5 te gaan." **Doorgaan (5 te gaan)**, **Sluiten**. |
| **Ongedaan maken bezig / klaar** | "De toegevoegde artikelen gaan weer uit je mandje…" → "10 artikel(en) weer uit je mandje gehaald." |
| **Al bezig** | "Er worden al artikelen teruggezet — wacht tot dat klaar is." (maar één actie tegelijk, over alle tabs) |

### 6.6 Status van het mandje en het account

| Status | Weergave |
|---|---|
| Mandje wordt geleegd om een bekende tijd | "Cardmarket leegt je mandje om 14:35 (nog 23 min)." (amber en vet bij ≤10 min) |
| Ander Cardmarket-account ingelogd | Paneel "Ander Cardmarket-account" (§7B-5) |
| Mandje niet goed te lezen | Foutmelding (§8E); er wordt niets als ontbrekend gemarkeerd |
| Extensie bijgewerkt in een open tab | Label "Cart Saver bijgewerkt · ververs de pagina" |

## 7. Schermen en hun toestanden

Teksten tussen aanhalingstekens zijn de huidige Nederlandse teksten; `$1`
staat voor een getal of naam.

### A. Popup

**Vast:**

- **Header:** logo (blauw afgerond vierkant, wit winkelwagentje, amber stip),
  titel **"Cart Saver"**, **spelkeuze** (dropdown "Alle spellen" / "Magic" /
  "Pokémon" …, alleen bij meerdere spellen) en een tandwiel naar de
  instellingen.
- **Tabs:** **"Winkelmandje"**, **"Favorieten (2)"**, **"Mandjes (1)"**.
- **Voortgangsblok** bovenaan, in elke tab, met de statussen uit §6.5.
- **Meldingsregel** (klein, grijs), bijv. "Je winkelmandje op Cardmarket wordt
  geopend — het terugzetten start vanzelf."
- **Toast** onderaan (donker, 3–8 s), eventueel met een actie:
  "“Portal Mage” uit de lijst gehaald. **Ongedaan maken**",
  "Bewaard als “Commander-deck”.", "Gekopieerd naar het klembord."
- **Footer** (vertrouwenssignaal): "Alles wordt lokaal in je browser bewaard.
  Cart Saver praat alleen met cardmarket.com, via je eigen sessie."

**Tab "Winkelmandje":**

- **Tellers** (3 tegels): "In mandje" (groen), "Ontbreekt" (amber, inclusief
  deels), "Niet beschikbaar" (rood).
- **Knoppen:** primair **"Zet 3 artikel(en) terug"** (of uitgeschakeld:
  "Niets om terug te zetten"); secundair **"Open winkelmandje"**.
- **Spelkeuze voor terugzetten** (alleen als er uit meerdere spellen iets
  ontbreekt): "Terugzetten: ✓ Magic (2) ✓ Pokémon (1)" — aan/uit-chips.
- **Filterchips:** "Alles (5)", "Ontbreekt (3)", "In mandje (2)",
  "Niet beschikbaar (1)".
- **Lijst per verkoper**, groepskop "snowc (2)". **Artikelrij:** thumbnail,
  naam, metaregel, (spel), extra regels uit §6.3, rechts prijs + ×aantal +
  statusbadge, iconknoppen: ☆/★ favoriet, 🔍 vergelijkbaar aanbod, ↻
  terugzetten (alleen als niet in mandje), × verwijderen.
- **Onder de lijst:** links **"Kopieer als tekst"** en **"Download CSV"**.
- **Leeg:** "Nog niets opgeslagen" — "Open je winkelmandje op Cardmarket;
  Cart Saver onthoudt de artikelen automatisch." — **Open Cardmarket**.
- **Filter leeg:** "Geen artikelen in deze weergave."

**Tab "Favorieten":**

- Zoekveld "Zoek in favorieten (naam, set, verkoper…)" (meerdere woorden).
- Lijst, nieuwste bovenaan. Rij: thumbnail, naam (link naar de aanbieding),
  metaregel, "Verkoper: …", "3 beschikbaar · bewaard 7 okt", prijs. Knoppen:
  🛒 *In winkelmandje leggen*, ↗ *Bekijk aanbieding op Cardmarket*,
  👤 *Zoek bij deze verkoper*, ★ *Verwijder uit favorieten*.
- **Leeg:** "Nog geen favorieten" — "Klik op de ☆ bij een aanbieding op
  Cardmarket (of een artikel in je winkelmandje) om hem hier te bewaren."
- **Geen zoekresultaat:** "Geen favorieten gevonden voor deze zoekopdracht."

**Tab "Mandjes":**

- Formulier: veld "Naam, bijv. Commander-deck" + knop **Lijst bewaren**.
- Per bewaard mandje: naam (vet), "12 artikel(en) · 34,50 € · Magic · 9 okt"
  (of "Alle spellen"), knoppen **In mandje zetten** (primair),
  "Kopieer als tekst", "CSV", × *Verwijderen*.
- **Leeg:** "Nog geen bewaarde mandjes" — "Bewaar je lijst onder een naam
  (bijvoorbeeld per deck) en zet hem later met één klik terug in je mandje."
- **Niets te bewaren:** toast "Er staat niets in de lijst om te bewaren."

### B. Paneel op cardmarket.com

Er is altijd maximaal één weergave, in deze **volgorde van voorrang**:

1. **Onderbroken** — titel "Terugzetten onderbroken", tekst uit §6.5,
   **Doorgaan (5 te gaan)** (primair) en **Sluiten**.
2. **Bezig** — titel "Bezig met terugzetten", tekst, voortgangsbalk,
   "3 van 12 · Sol Ring", **Stoppen**.
3. **Resultaat** (tot 10 min na afloop) — titel "Klaar" of "Gestopt", ×,
   "10 in je mandje gezet, 2 niet gelukt.", eventueel foutmelding +
   "Details: …", lijst mislukte artikelen (met ⇄ 🔍 ×), knoppen
   **Open winkelmandje** (niet op de mandjepagina), **Ongedaan maken**,
   **Sluiten**.
4. **Losse melding** met ×, bijvoorbeeld:
   - "Favoriet niet op deze pagina" — "Deze aanbieding van MintCondition staat
     hier niet. Misschien is hij verkocht, of staat hij verderop in de
     lijst." — **Zoek bij deze verkoper**, **Zoek vergelijkbaar aanbod**;
   - "“Portal Mage” uit de lijst gehaald." — **Ongedaan maken**;
   - "Terugzetten ongedaan maken" — bezig / klaar (§6.5);
   - "Er worden al artikelen teruggezet — wacht tot dat klaar is."
5. **Ander account** — "Ander Cardmarket-account" — "Je opgeslagen artikelen
   horen bij tester. Zolang je als someone-else bent ingelogd, wordt niets
   opgeslagen of als ontbrekend gemarkeerd." — **Voortaan someone-else
   gebruiken**.
6. **Mandjepaneel** (alleen op de mandjepagina) — titel "Cart Saver", knop –
   (minimaliseren):
   - intro: "9 artikel(en) in je mandje opgeslagen." of "Je winkelmandje is
     leeg. Deze opgeslagen artikelen kun je terugzetten:";
   - **leegtijd**: "Cardmarket leegt je mandje om 14:35 (nog 23 min)."
   - **verzending per verkoper**, ingeklapt tot één regel
     "▸ 4 verkoper(s) · verzending 4,60 € (21% van het totaal)", uitgeklapt
     per verkoper: naam + waarde, "3 kaart(en) · verzending 1,15 € (34%)",
     waarschuwingen "verzending kost meer dan de kaarten",
     "nog 2,40 € tot de grens van 25 € (tracking)",
     "boven 25 €: meestal verzending met tracking (duurder)";
   - groep **"Niet meer in je mandje (3)"** met "Alles selecteren / Niets
     selecteren", spelkeuze-chips "Terugzetten: ✓ Magic (2) ✓ Pokémon (1)",
     rijen met vinkje en ×, primaire knop **"Zet 3 artikel(en) terug ·
     12,50 €"** (uit als niets is aangevinkt);
   - niets ontbreekt: "Alles wat je hebt opgeslagen zit in je mandje.";
   - groep **"Niet meer beschikbaar (2)"** met link "Lijst opschonen", rijen
     met ⇄ *Vervanging zoeken*, 🔍 *Zoek vergelijkbaar aanbod*, ×; knop
     **Toch opnieuw proberen**;
   - **vervanging** (onder een rij na ⇄): blok "Vervanging" met
     "Vervanging zoeken…", of "Geen vergelijkbaar aanbod gevonden.", of
     maximaal 3 voorstellen: rij met reden ("Zelfde verkoper",
     "Verkoper zit al in je mandje: geen extra verzendkosten",
     "Goedkoopste vergelijkbare aanbod") + prijsverschil ("0,10 € duurder" /
     "0,20 € goedkoper") en knop **Toevoegen**;
   - automatisch opslaan uit: knop **Huidig mandje opslaan**.
7. **Ingeklapt label** (mandjepagina): pil met stip, groen
   "Cart Saver · 9 opgeslagen" of amber "Cart Saver · 3 te bekijken".
8. **Herinnering** (andere pagina's, als er iets ontbreekt) — "Je
   winkelmandje is geleegd", × (onthoudt het wegklikken voor deze set) —
   "3 opgeslagen artikel(en) (5,78 €) zitten niet meer in je winkelmandje." —
   **Zet 3 artikel(en) terug**, **Bekijken** — bij meerdere spellen:
   "Of alleen: Magic (2) · Pokémon (1)".
9. **Bijgewerkt** — pil "Cart Saver bijgewerkt · ververs de pagina".
10. **Niets te doen** — geen paneel.

### C. Ster-knop in Cardmarket's rijen

Toestanden: **uit** (lege grijze ster), **hover** (lichte achtergrond,
amber), **aan** (gevulde gouden ster), **focus** (focusring). Tooltip:
"Bewaar als favoriet" / "Verwijder uit favorieten". Toon hem in een
Cardmarket-aanbiedingsrij (verkoper, conditiebadge, taal, prijs, aantal,
blauwe winkelwagen-knop) en in een mandjesrij.

### D. Markering van een aanbieding

Springt de gebruiker vanuit een favoriet naar de productpagina, dan krijgt
die rij een duidelijke amber rand met afgeronde hoeken en scrolt hij in beeld.

### E. Foutmeldingen

Rood in het voortgangsblok en het resultaat, met daaronder een kleine grijze,
selecteerbare regel "Details: …" (technisch, voor bugmeldingen).

| Situatie | Tekst |
|---|---|
| Niet ingelogd | "Je bent niet ingelogd op Cardmarket. Log in en probeer het opnieuw." |
| Beveiligingscontrole | "Cardmarket toont een beveiligingscontrole. Ververs de pagina, voltooi de controle en probeer het opnieuw." |
| Te veel verzoeken | "Cardmarket vraagt om het rustiger aan te doen. Wacht een paar minuten en probeer het opnieuw." |
| Geen verbinding | "Geen verbinding met Cardmarket. Controleer je internetverbinding." |
| Geen beveiligingscode | "De beveiligingscode van Cardmarket (token) is niet gevonden op de pagina. Ververs de pagina en probeer het opnieuw." |
| Mandje onleesbaar | "Je winkelmandje kon niet worden gelezen, dus er is niets toegevoegd (Cardmarket heeft mogelijk de opmaak veranderd). Deze extensie heeft waarschijnlijk een update nodig." |
| Ander account | "Je bent ingelogd met een ander Cardmarket-account dan waarmee deze artikelen zijn opgeslagen." |
| Onverwacht antwoord | "Cardmarket gaf een onverwacht antwoord, dus er is niets meer toegevoegd. Probeer het opnieuw; blijft het gebeuren, stuur dan de details hieronder door." |
| Cardmarket gewijzigd | "Cardmarket heeft het toevoegen aan het mandje veranderd. Deze extensie heeft een update nodig." |
| Overig | "Er ging iets mis. Probeer het opnieuw." |

### F. Instellingenpagina

1. **Kop:** logo (48 px), "Cart Saver", beschrijving "Onthoudt wat je in je
   Cardmarket-winkelmandje legt en zet het met één klik terug nadat je mandje
   is geleegd."
2. **Kaart "Instellingen"** (elk met uitleg eronder; na een wijziging kort
   "Opgeslagen."):
   - **Mandje automatisch opslaan** (aan);
   - **Melding tonen op Cardmarket** (aan);
   - **Meldingen** — bureaubladmeldingen (aan);
   - **Mandje controleren als je niet op Cardmarket kijkt** (uit; "kost extra
     verzoeken");
   - **Prijzen vergelijken met de trend** (uit), met statusregel
     "Laatst gelezen: 9-10-26 10:12 (37 kaarten)." of "Prijsgids kon niet
     worden gelezen: …";
   - **Pauze tussen artikelen (seconden)**, getalveld 0,5–10, standaard 1,2.
3. **Kaart "Je opgeslagen artikelen en favorieten":** samenvatting
   "5 opgeslagen: 2 in mandje, 3 ontbreken, 1 niet beschikbaar. 2
   favoriet(en).", knoppen **Exporteren (JSON)**, **Importeren**,
   **Alles wissen** (rood, met bevestiging), resultaatregel
   ("4 artikel(en) geïmporteerd.").
4. **Kaart "Zo werkt het":** vijf genummerde stappen en de privacyzin.

### G. Bureaubladmeldingen

| Wanneer | Titel | Tekst |
|---|---|---|
| Artikelen verdwenen terwijl je ergens anders was | "Artikelen uit je Cardmarket-mandje verdwenen" | "3 opgeslagen artikel(en) staan niet meer in je mandje. Klik om ze terug te zetten." |
| 5 minuten voor het legen | "Je Cardmarket-mandje wordt zo geleegd" | "Over ongeveer 5 minuten. Klik om je mandje te openen." |

### H. Icoon en badge

Badge = aantal artikelen dat ontbreekt of deels in het mandje zit (amber).
Tooltip: "Cart Saver – 3 opgeslagen artikel(en) niet in je mandje".

## 8. Huidige visuele basis (vrij om te verbeteren)

| Token | Licht | Donker |
|---|---|---|
| Achtergrond | `#ffffff` | `#1b2029` |
| Vlak | `#f5f7fa` | `#232a35` |
| Rand | `#dfe3ea` | `#343d4b` |
| Tekst | `#1c2430` | `#e7ebf1` |
| Tekst secundair | `#637083` | `#9aa5b5` |
| Accent | `#1a5fd6` | `#4c8dff` |
| In mandje | `#1d7f45` op `#e3f4ea` | `#5fd08f` op `#18382a` |
| Ontbreekt / deels / waarschuwing | `#8a5a00` op `#fff2d6` | `#f2c063` op `#3a2e14` |
| Niet beschikbaar / fout | `#b42318` op `#fde7e5` | `#ff8a80` op `#42201d` |
| Ster | `#e09a00` | `#f5b82e` |

- Radius 10 px (panelen), 7 px (knoppen), rond (badges en chips).
- Zachte, diepe schaduw (het paneel zweeft boven Cardmarket).
- Basis 13 px; titels 14–15 px; metaregels 12 px.
- Knoppen breken hun tekst niet af; ze schuiven naar een nieuwe regel.

**Gewenste uitstraling:** rustig, betrouwbaar en efficiënt, als goed
gereedschap. Een vleugje verzamelaar (kaarten, sterren, goud), maar zakelijk
genoeg om niet uit de toon te vallen op Cardmarket. "Cart Saver" mag een
eigen woordmerk krijgen.

**Aandachtspunten voor het redesign** (waar het nu wringt):

- Een artikelrij kan veel regels krijgen (spel, deels, reden, prijs, trend,
  melding). Zoek een compactere vorm: bijvoorbeeld kleine labels of iconen in
  plaats van volle zinnen, met de uitleg in een tooltip.
- Het mandjepaneel is lang (leegtijd, verzending, ontbrekend, niet
  beschikbaar, vervanging). Ontwerp duidelijke secties of een inklapbare
  structuur.
- Het verschil tussen *Ontbreekt* (kan terug) en *Niet beschikbaar* (moet
  vervangen) moet in één oogopslag duidelijk zijn.
- Spelkeuze (dropdown) én spel-chips: maak de relatie tussen "welke spellen
  zie ik" en "welke spellen zet ik terug" helder.

## 9. Nog niet gebouwd (houd er ruimte voor, optioneel)

- Labels en notities bij favorieten ("deck Atraxa", "cadeau") met een filter.
- "Recent bekeken": automatische geschiedenis van aanbiedingen.
- Een zelftest-knop in de instellingen ("Controleer of alles werkt").
- Een mini-prijsgrafiek per favoriet.
- Onbeschikbare kaarten op een wants-lijst zetten.

## 10. Gevraagde opleveringen

1. **Popup — Winkelmandje:** gevuld (meerdere verkopers en spellen, alle vier
   de statussen, prijs- en trendregels), met spelkeuze-chips, leeg, filter
   leeg, met voortgang (wachten, bezig), resultaat (klaar, fout met details,
   onderbroken) en een toast met *Ongedaan maken*.
2. **Popup — Favorieten:** gevuld, zoekresultaat, geen resultaat, leeg, met
   een verkochte favoriet en een favoriet die in het mandje zit.
3. **Popup — Mandjes:** leeg, met bewaarde mandjes, toast na bewaren.
4. **Paneel:** alle 10 weergaven uit §7B, waaronder het mandjepaneel met
   uitgeklapte verzending en een open vervanging, in de context van een
   vereenvoudigde Cardmarket-pagina; ook op een smal scherm (380 px).
5. **Ster-knop** in alle toestanden, in een aanbiedingsrij en een mandjesrij,
   plus de markering.
6. **Instellingenpagina.**
7. **Icoon** (16/32/48/128), **badge** en de twee **bureaubladmeldingen**.
8. **Componentenoverzicht:** artikelrij (alle varianten), statusbadges,
   extra-informatieregels, knoppen (primair, secundair, gevaar, icoon, klein),
   chips (filter, aan/uit), voortgangsbalk, tabs, zoekveld, toast, lege
   toestanden, ingeklapt label, vervangingsblok, verzendregel.
9. **Design tokens** (kleur, typografie, ruimte, radius, schaduw) voor licht
   én donker.

**Referentie:** screenshots van versie 1.4 in `docs/screenshots/`:
`popup-cart`, `popup-cart-dark`, `popup-favorites`, `popup-carts`,
`popup-empty`, `panel-cart` (met verzending en spelkeuze), `panel-cart-dark`,
`panel-reminder`, `panel-result`, `panel-interrupted`, `panel-replacement`,
`panel-other-account`, `panel-favorite-not-found`, `panel-error`,
`panel-collapsed`, `stars-on-product-page` (op een vereenvoudigde
testpagina) en `options`.

# Plan 1.7: één schrijver, en weten wanneer je mandje geleegd wordt

Twee punten uit de analyse van 1.6 die nog openstonden en die nu moeten:

- **B6, gelijktijdig schrijven.** Cardmarket-tabbladen, de popup, de instellingenpagina en de
  achtergrond schrijven allemaal naar dezelfde opslag. Gebeurt dat tegelijk, dan gaat er
  werk verloren.
- **S9, wanneer wordt het mandje geleegd.** Cart Saver merkt nu pas dat je mandje leeg is
  als je weer op Cardmarket rondklikt. Je wilt weten wanneer het gebeurt, en het liefst
  van tevoren.

Status: plan (9 oktober 2026). Nog niets van gebouwd.

---

## Deel A: gelijktijdig schrijven (B6)

### Hoe het nu werkt

Alle gegevens staan in een paar grote blokken in `chrome.storage.local`: `cmcs.items`,
`cmcs.meta`, `cmcs.job`, `cmcs.favorites`, `cmcs.carts`, `cmcs.settings` en `cmcs.thumbs`.
Een wijziging gaat altijd zo: blok lezen, aanpassen, hele blok terugschrijven
(`store.update()` in `src/shared/store.js`).

`store.update()` zet wijzigingen in een rij, maar **alleen binnen één onderdeel**. Elk
tabblad, de popup, de instellingenpagina en de achtergrond heeft zijn eigen rij. Lezen
twee onderdelen hetzelfde blok tegelijk, dan overschrijft de laatste schrijver de wijziging
van de eerste. `chrome.storage` heeft geen transacties en geen "schrijf alleen als niemand
anders iets veranderde"
([chrome.storage](https://developer.chrome.com/docs/extensions/reference/api/storage)).

De Web Locks die er al zijn (`cmcs.refill`, `cmcs.sync`) helpen maar half. In een
content script horen ze bij de pagina (www.cardmarket.com). Ze gelden dus tussen
Cardmarket-tabbladen onderling, maar niet tussen een tabblad en de popup of de achtergrond.

Er wordt op ongeveer 75 plekken in 9 bestanden geschreven.

### Gemeten

Een proef met de echte extensie in Chromium: de achtergrond en de popup voegen allebei
200 keer een artikel toe, tegelijk.

| Opzet | Bewaard van 400 | Kosten per schrijfactie |
| --- | --- | --- |
| Nu (elk onderdeel schrijft zelf) | 207–223, dus **177–193 kwijt** | 2,7 ms |
| Alleen de achtergrond schrijft, de popup stuurt een bericht | **400, niets kwijt** | 2,3 ms (4–6 ms bij 400 tegelijk) |

Dit is het ergste geval, met constante drukte. In gewoon gebruik gebeurt het minder vaak,
maar het mechanisme is echt. De berichtenroute is niet trager.

### Waar het in de praktijk misgaat

1. **Ongedaan maken tijdens het terugzetten.** Het tabblad dat terugzet schrijft elke 5 s een
   hartslag in `cmcs.job`. Klik je in de popup op "Ongedaan maken" precies tussen het lezen
   en schrijven van die hartslag, dan verdwijnt je verzoek zonder dat je iets merkt.
2. **Twee Cardmarket-tabbladen.** Tabblad A leest het mandje (`cmcs.items`), terwijl
   tabblad B de resultaten van het terugzetten wegschrijft. Die gebruiken verschillende
   locks. Gevolg: resultaten kwijt, of een verwijderd artikel komt terug.
3. **Achtergrond tegen tabblad.** De dagelijkse prijsupdate en het opruimen van oude
   artikelen schrijven `cmcs.items` terwijl een tabblad het mandje bijwerkt. Erger nog:
   een wijziging uit een tabblad zet via `storage.onChanged` zelf een schrijfactie op de
   achtergrond in gang. Zo komen er twee schrijvers vlak na elkaar.
4. **Instellingen.** Een import of "alles wissen" terwijl een tabblad openstaat. Het tabblad
   schrijft daarna zijn oude kopie terug.
5. **`cmcs.meta`.** Het paneel inklappen, je account bevestigen of de melding "opgeruimd"
   wegklikken valt weg als een tabblad op dat moment een mandjelezing opslaat.

### Overwogen

| Aanpak | Waarom wel of niet |
| --- | --- |
| Web Locks overal | Content scripts en extensiepagina's delen geen lock (andere origin). Lost 3 en 4 niet op. |
| Versienummer per blok ("alleen schrijven als het nog versie N is") | Zonder echte compare-and-swap blijft er een gat tussen controleren en schrijven. Kleiner gat, niet dicht. |
| Elk artikel een eigen sleutel | Minder botsingen, maar `meta` en `job` blijven één blok en het mandje lezen raakt nog steeds veel artikelen. Grote migratie. Wel nuttig voor later (kleinere `onChanged`-berichten). |
| IndexedDB met transacties | Content scripts zien de IndexedDB van cardmarket.com, niet die van de extensie. Ze kunnen er dus alleen via de achtergrond bij, en dan kan het net zo goed via `chrome.storage`. |
| **Eén schrijver: de achtergrond** | Eén rij voor alle wijzigingen, dus niets gaat verloren (gemeten). Even snel. Lezen blijft zoals het is. **Gekozen.** |

### Ontwerp

**Alleen de service worker schrijft.** Alle andere onderdelen sturen een opdracht.

- `store.js` houdt dezelfde functies (`syncCart`, `removeItems`, `takeCart`, …). In de
  service worker voeren ze de wijziging zelf uit, in de bestaande rij. Op andere plekken
  sturen ze `chrome.runtime.sendMessage({ type: 'cmcs.write', op, args, opId })` en wachten
  ze op het antwoord. Voor de meeste aanroepen verandert er dus niets.
- **Opdrachten zijn gegevens, geen functies.** Een functie kan niet mee in een bericht. De
  aanroepen met een eigen functie (`updateMeta(fn)`, `updateJob(fn)`, `updateCart(id, fn)`,
  de import in de instellingen) worden opdrachten met een naam:

  | Nu | Wordt |
  | --- | --- |
  | `updateMeta((m) => ({ ...m, collapsed }))` en dergelijke | `patchMeta({ collapsed })` |
  | `markLeftByUser`, `userRemoved` bijwerken | `markUserRemoved(ids, at)` |
  | `applyCart` in `main.js` (items + meta in vier stappen) | één opdracht `applyCartReading(reading)`: items en meta in één keer |
  | hartslag, claimen, ongedaan maken, bevestigen (`updateJob(fn)`) | `claimJob`, `beatJob`, `patchJob(jobId, runner, patch)`, `requestUndo(jobId)`, `acknowledgeJob`, `dismissJob` |
  | `toggleFavorite(article)` | `setFavorite(article, on)`: twee keer uitvoeren geeft hetzelfde resultaat |
  | `updateCart(id, fn)` | `renameCart(id, name)`, `setCartItems(id, items)` |
  | import en "alles wissen" in de instellingen | `importData(payload)`, `clearAll()` |
  | prijzen en opruimen op de achtergrond | blijven lokaal (die draaien al in de schrijver) |

- **Meerdere blokken in één keer.** Een opdracht die items én meta raakt (het mandje lezen,
  opruimen, terugzetten afronden) schrijft beide in één `storage.set`. Dan ziet niemand
  een half resultaat.
- **Lezen blijft direct.** `getItems()` en dergelijke, plus `storage.onChanged` voor het
  hertekenen. Dat is veilig: alleen schrijven botst.

**Als de service worker slaapt of stopt.** Chrome stopt hem na 30 s zonder werk. Een bericht
maakt hem wakker en geeft hem weer tijd
([levenscyclus](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)).
De listener staat bovenaan in het script, dus berichten tijdens het opstarten komen aan.
Twee randgevallen:

- *"Receiving end does not exist"* (hij start nog): de opdracht is niet uitgevoerd. Na
  100 ms opnieuw proberen, maximaal 3 keer.
- *Hij stopt midden in een opdracht, na het schrijven maar voor het antwoord*: opnieuw
  proberen mag dan niet dubbel tellen. Elke opdracht krijgt een `opId`. De schrijver
  onthoudt de laatste 200 in `chrome.storage.session` (overleeft een herstart van de
  service worker binnen dezelfde browsersessie) en slaat dubbele over.

**Na een update van de extensie** kunnen oude tabbladen niets meer (geen opslag, geen
berichten). Dat is nu ook zo. Het gegevensformaat blijft gelijk, dus er is geen migratie
nodig.

**Hartslag apart (klein, optioneel).** De hartslag van een terugzet-taak naar een eigen
sleutel `cmcs.beat`. Dan schrijft `cmcs.job` niet elke 5 s helemaal opnieuw en hoeft
`isHeartbeatOnly` niet meer te bestaan.

### Tests

1. **De race als test (eerst schrijven, die faalt nu).** Popup, achtergrond en twee
   Cardmarket-tabbladen schrijven 200 keer tegelijk. Verwacht: niets kwijt.
2. **Ongedaan maken tijdens de hartslag.** 50 keer een undo-verzoek terwijl de hartslag
   loopt. Het verzoek komt altijd aan.
3. **Service worker gestopt.** Via CDP (`ServiceWorker.stopAllWorkers`) midden in een reeks
   opdrachten. Alles komt aan, niets dubbel (`opId`).
4. **Bewaker.** Een test die `src/` doorzoekt. Buiten `store.js` geen `chrome.storage.local.set`
   of `remove`, en buiten de service worker geen `update*(fn)`. Dan sluipt het niet terug.
5. De 90 bestaande tests blijven groen.

### Stappen (elk een eigen commit, getest en gepusht)

1. Racetest + bewaker-test toevoegen (rood).
2. Opdrachtenlijst in `store.js` + berichtenroute in de service worker, met `opId` en
   opnieuw proberen. Opdrachten die al een naam hebben gaan eerst over.
3. Functie-aanroepen omzetten: meta, job, favorieten, lijsten, instellingen. `applyCart`
   wordt één opdracht.
4. Hartslag apart, opruimen, versie 1.7.0.

---

## Deel B: weten wanneer Cardmarket je mandje leegt (S9)

### Wat er bekend is

Cardmarket documenteert het niet. Het helpcentrum en de voorwaarden noemen het mandje
alleen bij het sluiten van een koop. Wat er wel is:

- **Een melding met een tijd.** 2021: een gele melding bovenaan dat het mandje "um 19 Uhr"
  automatisch geleegd wordt. Iemand anders schrijft dat zijn mandje altijd om 00:10 geleegd
  wordt ([mtg-forum.de, p. 918](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-918)).
- **2023:** geleegd "irgendwann Vormittags". Je ziet een melding dat de kaarten om een
  bepaalde tijd uit het mandje gaan. Artikelen in jouw mandje zijn geblokkeerd voor
  anderen. Volgens een gebruiker kan de verkoper ze er pas na minstens een uur zelf uit
  halen ([mtg-forum.de, p. 1040](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-1040)).
- **Oudere berichten (2014–2016)** in hetzelfde topic (p. 270, 437, 493): wisselende
  verhalen (een kwartier, 1–2 uur, langer dan 12 uur geblokkeerd). Niet bevestigd.
- **Eigen waarneming 9 oktober 2026.** De mandpagina met artikelen liet geen tijd zien,
  alleen "Reminder: Please only keep items in your cart that you intend to purchase.
  Abuse of the shopping cart may result in account suspension." Een tweede blik later
  die dag liep vast op de inlogpagina.

De conclusie: de regel verschilt of is veranderd. Soms staat er een tijd op de pagina,
vaak niet. Cart Saver moet het dus **zelf waarnemen en leren**. De tekst van Cardmarket is
een extraatje als hij er is.

### Wat Cart Saver nu doet

- Op de mandpagina: alles opslaan, en `readCartExpiry()` zoekt naar een melding met een
  tijd ("19:00", "over 45 minuten").
- Op andere pagina's: is het getal bij het mandje in de kop veranderd, of is de laatste
  lezing ouder dan 15 minuten, dan wordt het mandje één keer opgehaald.
- Is het mandje leeg terwijl er artikelen in zaten, dan krijgen die `missingReason:
  'emptied'`. Er komt alleen een melding als het tabblad op de achtergrond staat.
- Met een bekende tijd: een melding 5 minuten van tevoren.

Het gat: zonder rondklikken op Cardmarket merkt niemand iets. En de tijd van het leegmaken
wordt nergens bewaard. Wel `missingSince`, maar dat is het moment van ontdekken, niet van
leegmaken.

### Plan

**B1. Een logboek van het leegmaken.** Elke keer dat de extensie ontdekt dat het mandje
geleegd is, komt er een regel in `cmcs.cartLog` (de laatste 50, alleen op je eigen
computer):

```
{ foundAt, lastSeenFullAt, count, whole: true|false, oldestAddedAt, lastAddedAt, notice }
```

Het echte moment ligt tussen `lastSeenFullAt` (laatste lezing mét artikelen) en `foundAt`.
`whole` onderscheidt "helemaal leeg" (Cardmarket) van "een verkoper verdween" (verkocht,
of de verkoper haalde het weg). Alleen hele leegmaakmomenten tellen mee voor het voorspellen.

**B2. De marge klein maken: een lichte controle.** Zolang er een Cardmarket-tabblad
openstaat én er iets in je mandje zit, haalt één tabblad elke 20 minuten het mandje op.
Dat is hetzelfde verzoek als nu bij het rondklikken (met de bestaande lock `cmcs.sync`, dus
één tabblad tegelijk). Daarbij:

- nooit vaker dan eens per 20 minuten, en meteen stoppen bij een Cloudflare-controle (die
  wordt nooit opgelost) of een uitgelogde pagina;
- één extra controle één minuut na een aangekondigde of voorspelde tijd. Dan staat het
  moment vrijwel op de minuut vast.

Zonder open tabblad kan de achtergrond het zelf ophalen. Eerst nagaan of Chrome daarbij
je inlogcookie meestuurt en of Cloudflare het toelaat. Daarom een aparte instelling,
standaard **uit**.

**B3. Letterlijk bewaren wat Cardmarket zegt.** Elke melding op de mandpagina met woorden
over het mandje en een tijd wordt bewaard, met de ruwe tekst (maximaal 300 tekens, de
laatste 20). `readCartExpiry()` leest daarnaast meldingen achteraf ("… um 09:12 aus dem
Warenkorb entfernt"). Die geven het precieze tijdstip voor het logboek. Na een paar weken
weten we dan hoe de echte tekst luidt, in plaats van te gokken. Bij "Gegevens" in de
instellingen kun je ze bekijken en exporteren voor een bugmelding.

**B4. Leren en voorspellen.** Vanaf 3 hele leegmaakmomenten:

- *hoe lang na de laatste toevoeging* (mediaan en spreiding);
- *rond welk tijdstip* (bij een vast moment per dag, zoals 00:10).

De aanpak met de kleinste spreiding wint, maar alleen als die spreiding klein genoeg is
(bijvoorbeeld onder de 45 minuten). Anders geen voorspelling. Liever niets dan iets fouts.

**B5. Laten zien en waarschuwen.**

- De popup en het paneel tonen de laatste keer: "Cardmarket leegde je mandje op
  do 9 okt tussen 08:40 en 09:00 (7 artikelen)". Het tijdvak is eerlijk over wat we weten.
- Met een voorspelling: "Waarschijnlijk geleegd rond 09:00". Een melding 15 minuten van
  tevoren, met het woord "waarschijnlijk". Een tijd van Cardmarket zelf gaat altijd voor.
- De melding "je mandje is geleegd" komt ook als het tabblad zichtbaar is, maar dan als
  strook in het paneel in plaats van een systeemmelding. Met de knop "Zet terug" erbij,
  zoals nu.

**Veiligheid.** Alleen lezen. Cart Saver koopt nooit iets, en haalt nooit iets uit je
mandje. De lichte controle is een gewone paginalezing, net als rondklikken, en Cloudflare
wordt nooit omzeild.

### Tests (mock-Cardmarket)

1. Mandje geleegd op tijdstip T, tabblad open: de lichte controle vindt het binnen 20
   minuten. Het logboek klopt (`lastSeenFullAt ≤ T ≤ foundAt`, `whole: true`).
2. Eén verkoper weg: logboek met `whole: false`, telt niet mee voor de voorspelling.
3. Meldingen in en, de, nl, fr ("um 19 Uhr", "removed at 09:12", "vandaag om 00:10"): goed
   gelezen, ruwe tekst bewaard.
4. Drie kunstmatige leegmaakmomenten met een vast patroon geven een voorspelling.
   Wisselende momenten geven er geen.
5. De lichte controle stopt bij Cloudflare, bij een leeg mandje, zonder open tabblad, en
   bij een uitgelogde pagina. Nooit vaker dan eens per 20 minuten.
6. Alleen één tabblad controleert, ook met vijf open.

### Stappen

1. Logboek (B1) + tonen van de laatste keer (B5, eerste deel).
2. Lichte controle (B2) met tests.
3. Meldingen bewaren en achteraf lezen (B3).
4. Voorspellen en vooraf waarschuwen (B4, B5).
5. Optioneel: controle vanaf de achtergrond, na de cookie- en Cloudflare-proef.

---

## Volgorde

Deel A eerst. Het logboek en de lichte controle uit deel B schrijven zelf ook uit
tabbladen. Die moeten dan meteen via de nieuwe route. Daarna deel B. De voorspelling kan
pas iets zodra het logboek een paar weken heeft gedraaid, dus stap B1 vroeg uitbrengen
loont.

De proefscripts staan niet in de repository. De racetest uit stap A1 neemt die rol over.

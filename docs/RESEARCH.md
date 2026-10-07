# Research: Chrome-extensies × Cardmarket

Dit document vat het vooronderzoek samen waarop Cart Saver is gebouwd: hoe
Chrome-extensies met websites werken, hoe Cardmarket werkt, en hoe die twee
samen een "winkelmandje opslaan en terugzetten"-extensie opleveren.

> **Let op:** cardmarket.com was niet bereikbaar vanuit de omgeving waarin dit
> onderzoek is gedaan. De Cardmarket-details hieronder komen uit opgeslagen echte
> Cardmarket-HTML en uit de broncode van bestaande open-source Cardmarket-tools
> (zie [Bronnen](#bronnen)). Ze zijn betrouwbaar, maar Cardmarket kan de site
> elk moment veranderen. De extensie is daarom defensief gebouwd (zie
> [Veiligheidsnetten](#veiligheidsnetten)).

---

## 1. Hoe Chrome-extensies met websites werken (Manifest V3)

| Onderdeel | Wat het kan | Gebruik in Cart Saver |
|---|---|---|
| **Content script** | Draait *in* de webpagina. Kan de DOM lezen en aanpassen, maar zit in een "isolated world": het ziet de JavaScript-variabelen van de site niet. | Leest het winkelmandje, voert de toevoeg-requests uit en toont het paneel op de site. |
| **Background service worker** | Draait los van pagina's. Heeft geen DOM en wordt na ~30 s inactiviteit gestopt. | Alleen het badge-getal op het icoon. |
| **Popup** | Het venstertje onder het icoon. Verdwijnt zodra je het sluit. | Overzicht van alle opgeslagen artikelen. |
| **Options page** | Instellingenpagina. | Instellingen en export/import. |
| **`chrome.storage.local`** | Lokale opslag van ~10 MB, beschikbaar in alle onderdelen. `onChanged` meldt wijzigingen overal. | Opgeslagen artikelen, voortgang van een terugzet-actie en instellingen. |

Belangrijkste inzichten:

- **Content scripts doen same-origin requests.** Sinds Chrome 85 gedraagt een
  `fetch()` vanuit een content script zich als een request van de pagina zelf.
  Vanaf `www.cardmarket.com` gaan de sessiecookies van de gebruiker dus gewoon
  mee, net als bij de knoppen van de site. Er hoeven geen inloggegevens
  opgeslagen te worden.
  ([Chromium](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/))
- **De service worker is minder geschikt voor geauthenticeerde POSTs.** Een
  request vanuit de service worker komt van `chrome-extension://…` en is dus
  cross-origin. Cookies (SameSite) en de CSRF-/Origin-checks worden dan
  onbetrouwbaar. Daarom draait al het Cardmarket-verkeer in het content script.
- **`DOMParser` werkt in content scripts.** Een opgehaalde HTML-pagina, zoals
  het winkelmandje, kan geparsed worden zonder dat de scripts erin uitvoeren.
- **De popup is kortlevend**, dus een terugzet-actie van meerdere minuten mag
  daar niet draaien. Hij draait in het content script van een Cardmarket-tab en
  schrijft zijn voortgang naar `chrome.storage`. Popup en paneel lezen die live
  mee.
- **Minimale permissies:**
  - `storage`;
  - host-permissie voor `https://www.cardmarket.com/*`, nodig om de URL van de
    actieve tab te lezen en om een Cardmarket-tab te openen of bij te werken.

Documentatie:
[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
[network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests),
[service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
[messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging),
[storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## 2. Hoe Cardmarket werkt

### URL-structuur

- `https://www.cardmarket.com/{taal}/{spel}/…`:
  - taal: `en`, `de`, `fr`, `es` of `it` (er is geen `nl`);
  - spel: `Magic`, `Pokemon`, `YuGiOh`, `OnePiece`, `Lorcana`, `FleshAndBlood`, …
- Winkelmandje: `/{taal}/{spel}/ShoppingCart`.
- Productpagina: `/{taal}/{spel}/Products/Singles/{Expansie}/{Kaart}`. Filters
  gaan via de query: `?language=1&minCondition=2&isFoil=Y`.

### Artikel

Een *artikel* (`idArticle`) is één aanbieding van één verkoper. Het bevat:

- een product;
- een conditie: `1` MT, `2` NM, `3` EX, `4` GD, `5` LP, `6` PL, `7` PO;
- een taal: `1` English, `2` French, `3` German, …;
- foil ja/nee;
- een prijs en een aantal.

Het winkelmandje bevat artikelen, geen producten. Als die ene aanbieding
verkocht is, is precies dat artikel weg. Er kan nog wel een vergelijkbaar
aanbod zijn.

### Winkelmandjepagina (DOM)

```html
<div id="shipments-col">
  <section class="shipment-block">                    <!-- één blok per verkoper -->
    <div class="seller-info"><a href="/en/Magic/Users/snowc">snowc</a></div>
    <table class="article-table product-table"><tbody>
      <tr data-article-id="1581671598" data-product-id="361919" data-amount="2"
          data-name="Bojuka Bog" data-expansion-name="Commander 2018" data-number="238"
          data-condition="2" data-language="1" data-price="0.99" data-comment="">
        … <td class="name"><a href="/en/Magic/Products/Singles/Commander-2018/Bojuka-Bog">…
        … <a class="article-condition"><span class="badge">NM</span></a>
        … <span class="icon" aria-label="English"></span>
        … <span class="extras"><span class="icon" aria-label="Foil"></span></span>
```

- Sommige rijen worden twee keer gerenderd (desktop en mobiel), dus ontdubbelen
  op `data-article-id` is nodig.
- De header van elke pagina toont het aantal artikelen in het mandje in
  `#cart .main-nav-badge` en het totaalbedrag in `#cart .text-success`.

### Toevoegen aan het winkelmandje

Een AJAX-POST, zoals de site die zelf doet:

```
POST /{taal}/{spel}/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers
Content-Type: application/x-www-form-urlencoded
X-Requested-With: XMLHttpRequest

__cmtkn=<csrf-token>&idArticle={"<id>":"<id>"}&amount={"<id>":"<aantal>"}
```

- Een variant met dezelfde velden is `ShoppingCart_Add_AddArticlesFromProductPage`.
- `__cmtkn` is een CSRF-token per sessie. Het staat op vrijwel elke ingelogde
  pagina in `input[name="__cmtkn"]`.
- Het antwoord is XML waarin elk veld base64-gecodeerd is:
  ```xml
  <ajaxResponse><resultType>c3VjY2Vzcw==</resultType>   <!-- "success" -->
                <resultsCode>Z2VuZXJhbE9L</resultsCode>  <!-- "generalOK" -->
                <systemMessage>…base64 HTML-melding…</systemMessage></ajaxResponse>
  ```
- Je kunt dus **direct op artikel-ID toevoegen**, zonder de productpagina te
  bezoeken. Bestaat het artikel niet meer, dan volgt een weigering met een
  melding.

### Wanneer wordt het mandje geleegd?

Er is geen officiële documentatie gevonden. Gebruikers melden het volgende:

- een melding dat het mandje "automatisch geleegd wordt om HH:MM";
- legen na ongeveer een uur of na inactiviteit;
- legen als een verkoper op vakantie gaat;
- verkopers die artikelen uit mandjes verwijderen.

Artikelen in een mandje zijn tijdelijk gereserveerd, maar daarna weer vrij
verkrijgbaar. Dat is precies waarom opslaan en later terugzetten nuttig is.

### Officiële API

De Cardmarket API neemt momenteel geen nieuwe aanvragen aan, en bestaande
gebruikers mogen hun sleutels niet aan apps van derden geven. De API is dus
geen optie voor deze extensie.

### Anti-bot en fair use

- Cardmarket zit achter Cloudflare. Bij te veel verkeer volgt `HTTP 429` (met
  `Retry-After`) of een "Just a moment…"-controlepagina.
- Een normale pagina laadt ook `/cdn-cgi/challenge-platform`. Alleen de echte
  kenmerken van de controlepagina tellen.
- De voorwaarden waarschuwen dat tools van derden voor eigen risico zijn.

## 3. De combinatie: ontwerp van Cart Saver

```
 cardmarket.com-tab (content script)                popup / opties
 ┌───────────────────────────────────────┐          ┌──────────────────────┐
 │ main.js   lees mandje / header-teller │          │ lijst, filters,      │
 │ refill.js zet artikelen terug (POST)  │◄─────────┤ "Zet terug"-knop     │
 │ widget.js paneel op de site           │ message  └──────────┬───────────┘
 └──────────────┬────────────────────────┘                     │
                │  chrome.storage.local  (items, job, meta, settings)
                └──────────────────────┬───────────────────────┘
                                       │
                            service worker: badge-getal
```

1. **Automatisch opslaan.** Het mandje wordt gelezen en elk artikel opgeslagen
   met al zijn gegevens (verkoper, conditie, taal, foil, prijs, aantal,
   product-URL, afbeelding). Dat gebeurt:
   - bij elk bezoek aan de winkelmandjepagina;
   - op elke andere pagina zodra het getal in de header verandert, ook als je
     iets toevoegt met de knop van de site zelf.
2. **Leeg mandje detecteren.**
   - Opgeslagen artikelen worden nooit automatisch verwijderd als ze uit het
     mandje verdwijnen. Ze krijgen de status *ontbreekt*.
   - Op Cardmarket verschijnt dan een melding en het extensie-icoon toont het
     aantal.
   - Artikelen die je zelf met het prullenbakje verwijdert, worden vergeten.
3. **Terugzetten.**
   - Eerst wordt het actuele mandje gecontroleerd. Wat er al in zit, wordt
     overgeslagen, zodat aantallen nooit verdubbelen.
   - Daarna volgt per artikel één POST met een pauze ertussen (standaard
     1,2 s + willekeur).
   - Tot slot wordt opnieuw gecontroleerd wat er werkelijk in het mandje staat.
   - Artikelen die Cardmarket weigert, worden gemarkeerd als *niet meer
     beschikbaar*, met de reden van Cardmarket en een link naar vergelijkbaar
     aanbod (zelfde taal, minimaal dezelfde conditie, zelfde foil).
4. **Favorieten.**
   - Elke aanbiedingsrij (`div.article-row#articleRow<id>`) krijgt een ☆, net
     als elke rij in het mandje. Je vindt die rijen op productpagina's,
     kaartpagina's en verkoperspagina's (`/Users/<naam>/Offers/Singles`).
   - Een favoriet bewaart dat ene artikel: verkoper, conditie, taal, foil,
     prijs en voorraad.
   - Om hem terug te vinden linkt de popup naar de productpagina, gefilterd op
     taal en conditie, met `#articleRow<id>`. Het content script scrolt naar
     die rij en markeert hem.
   - Staat de rij er niet, dan volgt een melding met links naar de voorraad
     van de verkoper (`?name=<kaart>`) en naar vergelijkbaar aanbod.
   - "In winkelmandje" gebruikt hetzelfde terugzet-mechanisme, met
     1 exemplaar.
5. **Gekocht = klaar.** Artikelen die op een bestelpagina (`/Orders/…`) staan,
   worden uit de lijst gehaald.

### Veiligheidsnetten

- Er wordt alleen iets gedaan als de pagina aantoonbaar van een *ingelogde*
  gebruiker is. Een loginpagina heeft geen mandjesrijen en zou anders alles als
  "ontbreekt" laten lijken.
- In de volgende gevallen wordt een leeg resultaat niet geloofd:
  - nul rijen terwijl de header nog artikelen of een bedrag toont;
  - er staan wel verkopersblokken op de pagina.

  Dan wordt niets als ontbrekend gemarkeerd en weigert terugzetten te starten.
- Het terugzetten stopt direct bij een Cloudflare-controle, bij uitloggen of
  bij een tweede 429. Bij een 429 wordt eerst gewacht volgens `Retry-After`.
- Er draait maximaal één terugzet-actie tegelijk, over alle tabs heen (lock met
  heartbeat in `chrome.storage`).
- Alles gebeurt alleen na een klik van de gebruiker, in een normaal menselijk
  tempo.

## Bronnen

- Chrome-documentatie (zie de links in §1).
- Open-source Cardmarket-tools waarvan selectors en endpoints zijn
  geverifieerd:
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): MV3-extensie met het
    toevoeg- en verwijder-endpoint, `__cmtkn` en Cloudflare-detectie;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard):
    batch toevoegen en 429-afhandeling;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    parsen van mandje en aanbod;
  - mfiferna/cm-scripts, DavidSdot/CardmarketUtilities,
    SiposLevente/cardmarket-magic-cart-price-checker: userscripts voor het
    winkelmandje;
  - batuzyn/cardmarket-api en Mathogrammer/cardmarket2collection-extension:
    echte opgeslagen Cardmarket-HTML.
- [Cardmarket API-pagina](https://help.cardmarket.com/en/cardmarket-api): geen
  nieuwe aanvragen.

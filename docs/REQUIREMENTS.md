# Functional requirements — Cardmarket Cart Saver

Current state: version 1.0.0, with the later changes up to and including 1.6 (see the analyses in docs/).

This document describes:

- **Part A** — what the extension does now (implemented and tested).
- **Part B** — what is not there yet but could be useful, backed by
  research, with priorities and a roadmap.

Notation:

- `FR-xx` is a functional requirement and `NFR-xx` a non-functional one.
- The *Test* column refers to the end-to-end test in `tests/e2e.test.mjs`.
  It runs against a mock Cardmarket.

> Everything in part A has been tested against a mock Cardmarket with real
> Cardmarket HTML and endpoints. It has **not** yet been verified on the live
> site: cardmarket.com could not be reached from the development environment.

---

## Part A — What works now

### A1. Saving the cart automatically

| ID | Requirement | Test |
|---|---|---|
| FR-01 | On every visit to the cart page (`/{taal}/{spel}/ShoppingCart`) the extension saves each article with: article ID, product, name, set, number, seller, condition, language, foil/extras, price, quantity, product URL, image and comment. | ✔ |
| FR-02 | On every other Cardmarket page the extension compares the cart counter in the header with the previous time. If it has changed, it fetches the cart once and updates the list. | ✔ |
| FR-03 | If the counter changes live, for example when you click "add to cart" on the site, the new article is saved within ~1.5 s, without you reloading the page. | ✔ |
| FR-04 | Articles that appear twice on the page (desktop and mobile view) are saved once. | ✔ |
| FR-05 | An article that disappears from the cart is **not** deleted. It gets the status *missing*, with the likely reason: the whole cart was emptied, everything from that seller disappeared, or only this article disappeared (probably sold). Possible statuses: *in cart*, *partly in cart*, *missing*, *unavailable*. | ✔ |
| FR-06 | Articles you remove yourself are forgotten instead of being marked as missing. That applies to the bin icon, fewer copies, "everything from this seller" and "empty cart", and to articles you check out. Four signals, independent of each other: the site's remove request (also when it is encrypted in `args`), forms, the buttons, and on the cart page itself: rows that disappear or show fewer copies right after you clicked something. Only what is really out of the cart afterwards is forgotten. | ✔ |
| FR-07 | Articles that appear on an order page (`/Orders/…`) have been bought and are taken off the list. | ✔ |
| FR-08 | Automatic saving can be turned off. The cart page then shows the button *Save current cart*. | — |
| FR-09 | Cardmarket has **one cart for all games** (Magic, Pokémon, Yu-Gi-Oh!, …); a seller can have cards from several games in one shipment. The extension reads that cart as a whole; the game of each article comes from the product URL. Works in every site language (en, de, fr, es, it). | ✔ |
| FR-09a | **Choosing which games go back:** in the panel on the cart page and in the popup, one button per game ("Magic (2)", "Pokémon (1)") to turn a game on or off; the reminder on other pages offers "Or only: Magic (2) · Pokémon (1)". The popup has a choice of *All games* or one game. | ✔ |
| FR-10 | If you are logged out, the extension does nothing with the list: a login page is never taken for an empty cart. If you are logged in with a **different account** from the one the list was built with, nothing is saved or marked as missing until you choose the new account. | ✔ |
| FR-10a | The desired quantity is stored separately. If the cart holds fewer copies than you had (the seller sold a few), the article is called *partly in cart* ("1 of 2 in your cart"). If you lower the quantity yourself, the lower quantity becomes the new desired quantity. | ✔ |
| FR-10b | If the price of an article in your cart changes, you see that for three days ("Price €0,10 higher (was €0,99)"). | ✔ |

### A2. Detecting and reporting an empty cart

| ID | Requirement | Test |
|---|---|---|
| FR-11 | If saved articles are missing, a reminder appears in the bottom right of Cardmarket with the number and the total value, plus the buttons *Put back* and *View*. | ✔ |
| FR-12 | Dismissing the reminder remembers that for exactly this set of missing articles. If new articles disappear, it comes back. | — |
| FR-13 | The toolbar icon (logo: a card falling into a shopping cart) shows the number of missing and partly present articles in a red badge. | ✔ |
| FR-14 | On the cart page a panel shows the missing articles, each with a checkbox, plus *select all/none* and the total value of the selection. | ✔ |
| FR-15 | Unavailable articles are in a separate group. It shows Cardmarket's reason and the buttons *Find a similar offer*, *Try again anyway* and *Clear list*. | ✔ |
| FR-16 | The panel can be collapsed to a small label. That choice is remembered. | — |

### A3. Putting articles back in the cart

| ID | Requirement | Test |
|---|---|---|
| FR-17 | You can put articles back with one click: from the reminder, the cart panel or the popup, for all missing articles or for one article. | ✔ |
| FR-18 | Putting back runs in a Cardmarket tab, with your own session. If you start it from the popup while you are not on Cardmarket, the extension opens your shopping cart and it starts there by itself (the action waits at most 2 minutes). | ✔ |
| FR-19 | The current cart is checked first. Only the copies that are still missing go back; articles that are already (fully) in it are skipped, so quantities never double. | ✔ |
| FR-20 | If the cart cannot be read reliably, the extension refuses to start and marks nothing as missing. Unreliable means: no rows while the header counts something, a seller block without readable rows, or fewer articles than the header counts. | ✔ |
| FR-21 | If a seller has several articles to put back, they go in **one request** (batch). Then the cart is read; whatever did not arrive is still sent one by one. Between all requests there is a configurable pause (default 1.2 s plus a random 0–0.4 s). | ✔ |
| FR-22 | The extension uses the page's CSRF token. On every refusal without a known reason, it looks for a fresh token and tries once more (at most 3 times per action). | ✔ |
| FR-22a | Refusals are classified: *sold* (unavailable), *too few copies* (retried with 1 copy; the article then becomes *partly in cart*) or *unknown* (stays *missing*, with the message; only the second unknown refusal in a row counts as unavailable). | ✔ |
| FR-23 | There are two known add endpoints. If the first one does not work, the second follows, and the working endpoint is remembered. | ✔ |
| FR-24 | On HTTP 429 the extension waits according to `Retry-After` (at most 60 s) and retries up to 2×. After that it stops. | — |
| FR-25 | On a Cloudflare check, a logout or a network error, the extension stops immediately, with a clear message. Articles are then not wrongly marked as *unavailable*. | ✔ |
| FR-26 | Afterwards the cart is read again and each article gets the right status. Cardmarket's refusal reason is stored. | ✔ |
| FR-27 | Progress can be followed live in the panel and in the popup, and putting back can be stopped. At most one action runs at a time, across all tabs (a Web Lock that disappears with the tab). If you leave the page while articles are being put back, the browser first asks whether you are sure. | ✔ |
| FR-27a | If the tab is closed anyway, the next Cardmarket page shows *Refill interrupted* with *Continue (N to go)*. Continuing is safe: the cart is checked again first. | ✔ |
| FR-27b | An action from the popup only starts in a visible, logged-in Cardmarket tab. On the login page it stops with the message that you are not logged in. | ✔ |
| FR-28 | After putting back on the cart page, the page reloads by itself, with a summary ("X put in your cart, Y not added"). The count comes from the check afterwards. | ✔ |
| FR-29 | *Find a similar offer* opens the product page, filtered on the same language, at least the same condition and the same foil status. | ✔ |
| FR-29a | **Find a replacement** (panel on Cardmarket, for unavailable articles): first at the same seller (up to +25%), then the filtered offers. Sellers already in your cart get priority (no extra shipping). At most three suggestions with the reason and the price difference; *Add* puts the replacement in your cart and takes the sold original off the list. | ✔ |
| FR-29b | **Undo**: after putting back, one click takes exactly the added copies out of your cart again (via the site's remove request). They stay on your list as *missing*. | ✔ |

### A4. Favourites

| ID | Requirement | Test |
|---|---|---|
| FR-30 | Next to every offer there is a ☆, on product pages, card pages, seller pages and in the shopping cart. One click saves that specific article; another click removes it. | ✔ |
| FR-31 | A favourite stores: seller, condition, language, foil/extras, price, stock, product URL, image and the date. | ✔ |
| FR-32 | Offers that are loaded later (via "Load more") also get a star. | — |
| FR-33 | The popup has a *Favourites* tab: newest at the top, with the count in the tab name and search by name, set, seller, language and condition (several words possible). | ✔ |
| FR-34 | *View offer on Cardmarket* opens the product page, filtered on language and condition, and jumps to the offer. The offer is highlighted. | ✔ |
| FR-35 | If the offer is not on the page, a message follows with links to the seller's stock and to similar offers. | ✔ |
| FR-36 | *Find at this seller* opens the seller's stock, searched for this card. | ✔ |
| FR-37 | *Put in cart* puts 1 copy in your cart via the same mechanism as putting back. The popup then shows the label *In cart*. | ✔ |
| FR-38 | If a favourite is sold, it gets the mark *no longer available*, with Cardmarket's reason. It then does not stay behind as a saved cart article. | ✔ |
| FR-39 | If you come across a favourite on Cardmarket, its price and stock are updated, without extra requests. | ✔ |

### A5. Popup, settings and data

| ID | Requirement | Test |
|---|---|---|
| FR-40 | The *Cart* tab in the popup (design 1.5): at the top the summary ("5 articles can go back · 9,79 € from 3 sellers · your whole cart was emptied"), below it a calm list per seller with a subtotal (collapsible to one line with card thumbnails), a section *No longer available* with the stamp SOLD, and "4 in your cart" with those articles below it (always expanded since 1.6.1). Each row shows the name, one meta line and one short extra line (red only for a warning); a click expands it with all details and the buttons *Only this one back*, *On Cardmarket*, ☆ and ×. At the bottom the black button "Put 5 back in your cart · 9,79 €". | ✔ |
| FR-41 | If you have articles from several games, there is a game choice. | — |
| FR-42 | Settings: automatic saving on/off, reminder on/off, pause between articles (0.5–10 s). | ✔ |
| FR-43 | Export to JSON (articles and favourites). On import, new articles are added without overwriting existing ones. *Delete everything* asks for confirmation first. | — |
| FR-43a | **Saving carts**: in the popup tab *Lists* you save the current list under a name (e.g. "Commander deck"). Later *Put in cart* puts it back with one click. It can also be copied as text or downloaded as CSV, and is included in the JSON export. | ✔ |
| FR-43b | The list in the *Cart* tab can be copied as text ("2x Bojuka Bog (Commander 2018 #238) · NM · English · 0,99 € · snowc") or downloaded as CSV (semicolons, decimal comma). | ✔ |
| FR-43c | Removing something from the list can be undone (message with *Undo*). | ✔ |
| FR-45 | **Notifications** (configurable): if saved articles disappear from your cart while you are looking at another tab, a desktop notification follows; a click opens the cart. | ✔ |
| FR-46 | **Countdown**: if the cart page shows when Cardmarket empties the cart, the panel says "Cardmarket empties your cart at 14:35 (in 23 min)" and a notification comes 5 minutes beforehand. | ✔ (text on the live site still to be confirmed) |
| FR-47 | **Shipping per seller** (panel on the cart page, collapsible): per seller the number of cards, the value, the shipping costs and their share, "shipping costs more than the articles", and the 25 € threshold for tracked shipping. | ✔ (reading shipping costs on the live site still to be confirmed) |
| FR-48 | **Price versus trend** (configurable, off by default): the public price guide once a day; only the saved cards are kept (foil separately). An offer at least 15% and 0,10 € above the trend gets a note; one well below it does too. | ✔ |
| FR-49 | **Checking while you are away** (configurable, off by default): with a Cardmarket tab open and you at the computer, one tab reads the cart at most every 10 minutes. | ✔ |
| FR-50 | Articles that have been *unavailable* for a month disappear from the list by themselves. | ✔ |
| FR-44 | The interface is in Dutch or English, depending on the browser language, and supports a light and a dark mode. | ✔ (NL) |

### A6. Non-functional

| ID | Requirement |
|---|---|
| NFR-01 | **Privacy.** All data is stored locally in `chrome.storage.local`. There is no server and no passwords are stored. The extension only talks to `www.cardmarket.com`, through the user's session. |
| NFR-02 | **Minimal permissions:** `storage`, `alarms`, `notifications` and `idle` (no warning), plus the host permissions for `https://www.cardmarket.com/*` and `https://downloads.s3.cardmarket.com/*` (only for the public price guide, and only if you turn it on). |
| NFR-03 | **Polite use.** Requests are made after a click, after a change of the cart counter, or when the cart has not been read for more than 15 minutes (then by one tab at a time). Only with the optional setting *Check the cart while you are away from Cardmarket* is there a timer: at most every 10 minutes, and only when you are at the computer. Always one request at a time. |
| NFR-04 | **Better to do nothing than to do something wrong.** When in doubt (unreadable page, logged out, a Cardmarket check), no statuses are changed and no articles are added. |
| NFR-05 | **Platform:** Chrome, Edge, Brave and Opera (Manifest V3), without a build step. |
| NFR-06 | **Isolation.** The interface on Cardmarket runs in a shadow DOM, so the site's CSS and the extension's CSS do not affect each other. The page bridge talks through a private `MessageChannel`: the site's scripts cannot read or forge the traffic, and nothing on `window` gives the extension away. |
| NFR-07 | **Testability.** There are 71 end-to-end tests with Playwright, against a mock Cardmarket. |

### A7. Known limitations

| Limitation | Consequence |
|---|---|
| Not verified on the live site | Selectors and endpoints come from saved real HTML and open-source tools. A small adjustment may be needed. |
| An article is one offer from one seller | If it is sold, it cannot go back. There is only a link to similar offers. |

| Detecting your own removals | Four signals together; if something is still missed, the article shows as *missing* and you click it away (with *Undo*). |
| Favourites are only updated passively | You only notice a sold favourite when you try to add it or open it. |
| The language filter only works with English language names | On a German or French site, *similar offer* for favourites works without a language filter. |
| No sync between devices | Only via export and import. |
| No Firefox | That requires changes to the manifest and the background scripts. |

---

## Part B — Ideas for further development

### B0. What the research shows

The research covered:

- existing Cardmarket extensions and scripts;
- buyers' complaints and wishes (forums, Trustpilot, Cardmarket news
  posts);
- the data that Cardmarket itself makes public;
- extensions for other web shops and TCG tools.

Sources are listed in [B10](#b10-sources). Labels: **[Official]** = a Cardmarket
page, **[Code]** = checked in open-source code or saved
HTML, **[Third party]** = a guide or forum, **[Inferred]** = our own estimate.

**Competition.**

- *Enhanced Cardmarket* (~2K users) already covers a lot:
  - filters and default languages;
  - staying logged in;
  - price alerts and its own price history;
  - a quick look at the cart.
- Other tools each do one thing:
  - colouring offers against the trend price (Cardmarket Helper, Boris);
  - a seller blocklist (CM Helper);
  - a shipping estimate (Cardmarket Companion);
  - optimising from a wants list (Regroupeur, Cardmarket Optimizer,
    cardmarket_wizard).
- **The shopping cart side is the least served:**
  - what does this cart really cost, including shipping;
  - which sellers are already in it;
  - what happens to sold articles.

  Cart Saver already has data for this, and so a head start. **[Inferred]**

**Useful data sources.**

| Source | What | Status |
|---|---|---|
| `downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_{spel-id}.json` | Price guide per game (Magic = 1, Yu-Gi-Oh! = 3, Pokémon = 6, One Piece = 18, Lorcana = 19, …). Contains per `idProduct`: `low`, `trend`, `avg1`, `avg7`, `avg30`, plus foil variants (for Pokémon with `-holo`). Updated daily (~02:48), public and requires no login. There is no breakdown by language or condition. | **[Official]** and **[Code]**. There are no CORS headers, so fetching has to go through the service worker with an extra host permission. Files are ~20 MB, so store only relevant products. |
| `help.cardmarket.com/api/shippingCosts?fromCountry=…&toCountry=…` | The shipping methods between two countries, with price, `maxValue`, `maxWeight`, and whether it is a letter or a tracked shipment. | **[Code]**, checked in Lugin. Not officially documented. |
| Inline chart on the product page | About 30 days of average sale price (`new Chart(...)`), free to read along on every visit. | **[Code]** |
| `input[name="idProduct"]` on product pages, and `data-product-id` on cart rows | Links a page or article to the price guide. Scryfall's `cardmarket_id` is the same number. | **[Code]** |
| AJAX actions for wants lists (`Wantslist_AddWant`, `AddDeckList`, …) | Create and fill wants lists with the same token mechanism as the cart. | **[Code]** (Lugin) |

**Constraints.**

- **Tracked shipping** is mandatory above €25. In some cases, such as
  with new sellers, it already is above €10. **[Official]**
- **Sending internationally** with tracked letters is no longer possible since 2026,
  which makes international shipping more expensive. **[Official]** and
  **[Third party]**
- **The Shopping Wizard** does not always find the cheapest combination.
  - There is a limit of ~10 runs per day and 150 items per wants list.
  - "Add all to cart" requires 6 completed purchases.
  - **[Official]**
- **Cardmarket's terms.**
  - Third-party apps are used at your own risk.
  - Showing prices publicly requires permission.
  - So keep data local and never republish it. **[Official]**
- **How long articles stay in the cart**: nothing official was found on
  this. **[Third party]**: ~1–2 hours of inactivity.

### B1. Top 5 — most value for the least effort

1. **Diagnostics on the live site** (IDEE-01). The extension has not yet been
   tested on cardmarket.com. A "check that everything works" button makes
   problems visible right away.
2. **Cost panel per seller and threshold advice** (IDEE-10 and IDEE-11).
   Shipping costs are buyers' biggest annoyance, and the tracked jump
   above €25 is a well-known pitfall.
3. **Price versus trend and price alerts** (IDEE-05 and IDEE-07), via the
   public price guide, so without extra requests to the site.
4. **Smart replacement of sold articles** (IDEE-14): the logical next step
   after putting back.
5. **Recently viewed, and labels/notes on favourites** (IDEE-18 and IDEE-19).
   That ties in directly with "easy to find again".

Notation in the tables below:

- **Effort:** S = hours, M = 1–3 days, L = a week or more.
- **Prio** (MoSCoW for the next versions): **M**ust, **S**hould,
  **C**ould, **W**on't (not for now).

### B2. Robustness and trust

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-01 | **Self-test and diagnostics.** A button in the settings checks on the current Cardmarket page whether the extension finds everything: cart rows, cart counter, token, offer rows. The report can be copied. | Selectors come from saved HTML and have not yet been verified live. After a layout change you see right away where it goes wrong. **[Inferred]** | S | M |
| IDEE-02 | **Explaining why putting back failed.** Distinguishes between sold, seller on vacation, fewer copies available and price changed. Recognisable from Cardmarket's message and from the seller's offers. | Vacation mode hides offers **[Official]**. Right now you only see the raw message. | S–M | S |
| IDEE-03 | **"Price changed since you saved it".** After putting back, compares the price in the cart with the saved price and warns about an increase. | Costs no extra requests: the check afterwards already reads the cart. No existing tool does this. **[Inferred]** | S | M |
| IDEE-04 | **Seller warnings.** Warns before checkout about a red dot, a new seller or few sales, with a hint about the Trustee Service above €25. | Complaints about lost or damaged shipments **[Third party]**. Rules for ratings and the Trustee Service **[Official]**. | S–M | C |

### B3. Price insight

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-05 | **Price versus trend.** A label such as "−12% / +30% vs. trend" in the cart, on favourites and on offers. Uses the daily price guide, with foil (or holo) separately. | Requested and built by Cardmarket Helper, Boris and Enhanced Cardmarket **[Code]**. Sources: price guide **[Official]**, `data-product-id` **[Code]**. | M | S |
| IDEE-06 | **Local price history with a mini chart** per favourite or cart article. Sources: the 30-day chart on the product page, daily snapshots of the price guide and our own observations of the offers. | Cardmarket shows only 30 days, and history cannot be filled in afterwards, so starting now pays off **[Third party]** and **[Code]**. | M | S |
| IDEE-07 | **Target price and price alert.** Set a target price per favourite or product. A daily check (`chrome.alarms`, after 03:00) sends a notification when the trend or lowest price drops below it. | Core feature of Keepa, CamelCamelCamel and Honey Droplist **[Third party]**. Uses the price guide, so no load on the site. | M | S |
| IDEE-08 | **Changes to favourite products** visible on the product page: new offers since your last visit, changed prices and offers that disappeared. | TCG Market Wizard **[Third party]**. Works passively, so without extra requests. | M | C |
| IDEE-09 | **Showing currencies** (GBP, SEK, CHF, DKK, PLN) via the ECB's daily rates. | Cardmarket only knows GBP, and only for UK accounts **[Official]**. Of little use to Dutch users. | S | C |

### B4. Shipping costs and the economics of the cart

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-10 | **Cost panel per seller.** Shows per seller: subtotal, shipping costs, cost per card and the shipping share. Flags expensive cases, such as "1 card at €0,10 with €1,25 shipping". | Shipping costs are the biggest complaint **[Third party]**, and they go up in 2026 **[Official]**. The data is already on the cart page. | M | M |
| IDEE-11 | **Threshold advice.** Warns when a seller is just below or above €25 (tracked mandatory, so a more expensive method) and about letter weight limits (~4, 17 or 40 cards). Suggests what you could leave out or add. | €25 rule **[Official]**. The shipping API returns `maxValue` and `maxWeight` **[Code]**. Regroupeur already takes this into account **[Code]**. | M | S |
| IDEE-12 | **"Seller already in your cart"** on offers: a green highlight and "+€0 shipping" versus "+€1,25 new shipment". | CM Helper and Lugin **[Code]**. Comes straight from the saved cart data. | M | S |
| IDEE-13 | **Estimated shipping costs per offer,** based on the seller's country ("Item location") and the shipping API. Cached per country. | Cardmarket Companion and scripts by Hukutus **[Third party]**. | M | C |
| IDEE-14 | **Smart replacement of sold articles.** For an unavailable article, finds the cheapest equivalent offer: same product and language, at least the same condition, same foil. Sellers already in your cart get priority, because that saves shipping. Replacing takes one click. | The logical next step after putting back. Costs one product page per article, only after a click and at a calm pace. **[Inferred]** | L | S |
| IDEE-15 | **From cart to wants list and Shopping Wizard.** Turns the missing articles, or all of them, into a wants list with the same filters. Cardmarket's own Wizard then works out the optimal combination. | Leaves the heavy computing to Cardmarket, and that way we stay within the fair-use pace. Wants actions **[Code]**, Wizard limits **[Official]**. | M–L | C |
| IDEE-16 | **Full optimisation across several sellers** (like TCGmizer or Regroupeur, with an exact solver). | Lots of value, but requires fetching a great many pages. High risk of 429 errors or Cloudflare, and it competes with the Wizard. **[Inferred]** | L | W |

### B5. Favourites and finding things again

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-17 | **Favourite sellers and a blocklist.** Favourite sellers are highlighted and move to the top; blocked sellers are dimmed or hidden. A star is added next to the seller name. | CM Helper, Lugin and Enhanced Cardmarket **[Code]** and **[Third party]**. Ties in with "an article from someone". | M | S |
| IDEE-18 | **Recently viewed.** An automatic history of the last ~200 offers and products you viewed, with search. That way you can even find what you did not mark with a star. | No existing tool does this. Costs no requests, because everything is recorded while you browse. **[Inferred]** | S | M |
| IDEE-19 | **Labels, folders and notes on favourites** ("Atraxa deck", "gift"), with a filter per label. | Honey Droplist works with labels **[Third party]**. Handy once the list grows. | S | M |
| IDEE-20 | **Checking availability on request.** A "check all favourites" button looks at each seller, at a calm pace and with a maximum number. Optionally once a day for at most ~10 favourites. | Right now you only find out that something was sold when you try it. The maximum and the opt-in limit the load. **[Inferred]** | M | C |
| IDEE-21 | **Keyboard shortcuts and context menu:** "Save as favourite" via a right-click on an offer, and a keyboard shortcut for "put back". | Comfort. Standard Chrome APIs (`commands`, `contextMenus`). | S | C |

### B6. Managing carts and buying together

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-22 | **Named carts** ("Commander deck", "Pokémon 151"). Save the current cart under a name, put any saved cart back later and compare the total prices. | A natural extension of the core. Works with the existing put-back feature. **[Inferred]** | S–M | S |
| IDEE-23 | **Sharing lists.** Export a cart or favourites list as text or CSV, in the format of Cardmarket's deck lists or Moxfield's, or as a file a friend can import. | Wants Lists Helper and Cardmarket Plus **[Third party]**. | S | C |
| IDEE-24 | **Group order.** Label articles per person ("Milan", "Sem"). Shipping costs per seller are split fairly and you see an overview of who pays what. | Ordering together from the same seller saves shipping, and shipping gets more expensive in 2026 **[Official]**. No tool does this. **[Inferred]** | M | C |
| IDEE-25 | **Budget and spending.** A monthly budget, the cart including shipping against that budget, and a spending overview per month and per game from the order pages (passively). | EchoMTG and Deckbox track the value of your collection **[Third party]**. Order pages are already recognised (FR-07). | M | C |

### B7. Decks and collection

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-26 | **Importing a deck list** (text, Moxfield, Archidekt, ManaBox). Gives a cost estimate via the price guide and then turns it into a wants list or favourites, converting set codes. | Requested at Moxfield and built by Wants Lists Helper and Cardmarket Helper **[Third party]** and **[Code]**. | L | C |
| IDEE-27 | **"Already own it" labels** on offers and in the cart, from an imported collection CSV or your own order history. | Cardmarket Helper (ManaBox CSV) and Lugin (collection from orders) **[Code]**. Prevents buying something twice. | M | C |

### B8. Platform and comfort

| ID | Idea | Why / source | Effort | Prio |
|---|---|---|---|---|
| IDEE-28 | **Reminder before the cart is emptied.** Reads the time from Cardmarket's message ("will be emptied at HH:MM") and gives a notification 10 minutes beforehand. | Users report such a banner **[Third party]**, but it is not confirmed. Check on the live site first. | S | C |
| IDEE-29 | **Sync between devices:** favourites and settings via `chrome.storage.sync` (limit ~100 KB), or a dedicated file in Google Drive. | Right now only via export and import (limitation A7). | M | C |
| IDEE-30 | **Firefox version** (MV3 with `background.scripts` and `browser_specific_settings`). | Enhanced Cardmarket and Cardmarket Helper are also on addons.mozilla.org. | M | C |
| IDEE-31 | **Undo** after removing an article or favourite (a message with *Undo*). | Prevents accidental loss of data. | S | S |

**Deliberately not doing.** These ideas clash with fair use or with
Cardmarket's terms:

- **Keeping the cart "warm"** to stop Cardmarket from emptying it. That
  holds on to articles that others want to buy and undermines the reservation.
- **Automatic buying or "sniping"** of offers in the background.
- **Fetching pages on a large scale**, or sharing price data outside your own
  browser. Showing prices publicly requires Cardmarket's permission.
  **[Official]**

### B9. Proposed roadmap

| Version | Contents | Why in this order |
|---|---|---|
| **1.1 — Reliable and easy to find again** | IDEE-01 self-test, IDEE-03 price changed, IDEE-02 explanation of failures, IDEE-18 recently viewed, IDEE-19 labels and notes, IDEE-31 undo | All small, without new permissions and without extra requests. Makes the basics more robust on the live site. |
| **1.2 — What does my cart cost?** | IDEE-10 cost panel, IDEE-11 threshold advice, IDEE-12 seller already in cart, IDEE-22 named carts | The ground where we stand out, with data we already have. Only the shipping API is new. |
| **1.3 — Price insight** | IDEE-05 trend labels, IDEE-06 history, IDEE-07 price alert, IDEE-17 favourite sellers and blocklist | Requires an optional host permission for `downloads.s3.cardmarket.com`, plus storage per product. |
| **2.0 — Smart buying** | IDEE-14 smart replacement, IDEE-15 to the Wizard, IDEE-26 deck list import, IDEE-24 group order, IDEE-27 "already own it" | Larger features, partly with extra requests: a calm pace, a maximum number and only after a click. |

### B10. Sources

- Existing tools:
  - [Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/);
  - [Cardmarket Helper](https://github.com/SuppenNudel/cardmarket-helper):
    price guide URLs, trend colours, ManaBox;
  - [CM Helper by LastDraw](https://chromewebstore.google.com/detail/lcngonadhpeolkgmjjimdobdhfalnglf);
  - [Cardmarket Companion](https://chromewebstore.google.com/detail/mpbncolfefkegmaccdejhngjcjkjoaep);
  - [TCG Market Wizard](https://chromewebstore.google.com/detail/idcpcfanbabnakoebbnklgkngjbldfde);
  - [Wants Lists Helper](https://github.com/grepfs17/cm-copy-lists);
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): shipping API,
    wants actions, favourite sellers;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    optimisation including shipping;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard);
  - [natefinch/tcgmizer](https://github.com/natefinch/tcgmizer).
- Cardmarket:
  - [Price guide and catalogue available for download](https://news.cardmarket.com/en/Magic/were-making-the-price-guide-and-product-catalogue-available-for-download);
  - [Shipping costs](https://help.cardmarket.com/en/ShippingCosts);
  - [Trustee Service](https://help.cardmarket.com/en/TrusteeService);
  - [Shopping Wizard](https://help.cardmarket.com/en/ShoppingWizard);
  - [Seller rating](https://help.cardmarket.com/en/SellerRating);
  - [Vacation status](https://help.cardmarket.com/en/vacation-status);
  - [Change to international shipping in 2026](https://news.cardmarket.com/en/FoW/changes-to-international-shipping-methods-using-envelopes);
  - [GBP on Cardmarket](https://news.cardmarket.com/en/Magic/Pound-Sterling-Are-Coming-To-Cardmarket).
- Buyers:
  - [Trustpilot on Cardmarket](https://www.trustpilot.com/review/www.cardmarket.com);
  - Elite Fourum on [scans and seller responses](https://www.elitefourum.com/t/buying-from-cardmarket-buying-without-seeing-the-scans-no-response-from-sellers/40202)
    and on [the 2026 UPU rules](https://www.elitefourum.com/t/new-2026-upu-rules-is-this-the-end-of-international-singles-on-cardmarket-ebay-and-tcgplayer/60297).
- Inspiration:
  - [CamelCamelCamel](https://camelcamelcamel.com/features);
  - [Honey Droplist](https://help.joinhoney.com/article/79-what-is-droplist);
  - [TCGplayer Cart Optimizer](https://help.tcgplayer.com/hc/en-us/articles/201769673-How-does-the-Cart-Optimizer-work);
  - [request for "buy missing cards" at Moxfield](https://moxfield.nolt.io/2226).

> Most sites (Reddit, Cardmarket, the Chrome Web Store) could not be opened
> directly from the research environment. What is said about them is based on
> search results. GitHub code, however, was checked directly.

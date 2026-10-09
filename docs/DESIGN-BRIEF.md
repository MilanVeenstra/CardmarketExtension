# Design prompt — Cardmarket Cart Saver (version 1.4)

> **Status:** the new design (logo 6a, black/red, popup as a combination
> of mock-ups 7a, 7b and 7c) was built in version 1.5. The screenshots in
> `docs/screenshots/` show that version.

> **Copy everything from here into your design tool.** Add the screenshots from
> `docs/screenshots/` as a reference for how it looks now.

---

## Assignment

Design the complete interface of **Cardmarket Cart Saver**, a
browser extension for Chrome that already works (version 1.4). This is a
**redesign of a working product**, not a concept: all features and
states below exist and must keep a place.

It covers:

1. the **popup** under the extension icon (3 tabs);
2. the **panel** that floats at the bottom right of cardmarket.com (10 views);
3. the **star button** that the extension places next to offers on cardmarket.com;
4. the **settings page**;
5. **desktop notifications**, the **icon** and the **badge**.

Deliver every screen in **all states** from §6–§8, in **light and dark**,
with the **interface texts** from this document, plus a
**component overview** and **design tokens**. Stick to the fixed sizes and
constraints in §4: the design will then be built into the extension in plain
HTML/CSS (no framework, no web fonts).

---

## 1. What is it?

**Cardmarket** (cardmarket.com) is the largest European marketplace for
trading cards: Magic: The Gathering, Pokémon, Yu-Gi-Oh!, One Piece, Lorcana and
more. Thousands of sellers offer single cards there.

Three things you need to know:

- **An article is one offer from one seller**, for example *"Sol Ring,
  Commander Masters, Excellent, German, 1,10 €, seller CardKingdomNL, 3 in
  stock"*. The same card often has hundreds of offers.
- **There is one shopping cart for all games.** A seller can have Magic and
  Pokémon cards in the same shipment; you pay shipping per
  seller.
- **Cardmarket empties the cart by itself**: after a while, when a
  seller goes on holiday or sells something. Anyone who carefully put cards
  together loses that work.

**Cart Saver solves that.** It remembers everything you put in your cart,
notices when something disappears from it (and why), and puts it back with one
click, as long as it is still for sale. If something was sold, it looks for a
replacement. You can also save offers as a **favourite** with a ☆
and store your list as a **named cart**.

**Product promise:** *"Never lose your carefully filled Cardmarket cart
again."*

## 2. Who is it for?

- **Collectors and players** of trading card games, 16–45 years old, mainly from
  the Netherlands and Belgium (interface in Dutch, English as an alternative).
- They often buy dozens of cards at a time from several sellers, and pay close
  attention to condition, language, foil, price per copy and shipping costs.
- Desktop, in Chrome, Edge or Brave, while shopping on Cardmarket.
- They know Cardmarket well and want **speed and overview**. They do
  not want an extension to "shout" on a site they use every day.

## 3. Key scenarios

1. **Cart emptied, and back again.** Milan has 12 cards from 4 sellers
   (Magic and Pokémon) in his cart. A day later it is empty. At the bottom right
   on Cardmarket, *"Your cart was emptied"* appears. He clicks
   **Put 12 back in your cart**; one request goes out per seller, a
   progress bar runs. Result: *"10 put in your cart, 2 not added"*.
   Changed your mind? **Undo** takes exactly those 10 out of his cart again.
2. **Putting back only Pokémon.** In the panel he switches off the
   *"Magic (8)"* button and leaves *"Pokémon (4)"* on.
3. **A card is sold.** At *"Sol Ring — unavailable"* he clicks
   ⇄ **Find a replacement**. He gets three suggestions: the same card at
   the same seller (+0,10 €), at a seller already in his cart
   (no extra shipping) and the cheapest similar offer. One
   click on **Add** and the original disappears from the list.
4. **Fewer copies.** He had 2× Bojuka Bog; the seller sold one of them.
   The row shows *"1 of 2 in your cart"* and putting back only adds the
   missing copy.
5. **Removing something yourself.** If he takes something out of his cart
   himself, it also quietly disappears from Cart Saver (no notice, it is not a
   problem).
6. **Tab closed while putting back.** The next Cardmarket page shows
   *"Refill interrupted — 5 still to go"* with **Continue (5 to go)**.
7. **Saving a deck.** In the popup, tab **Lists**, he saves his
   list as *"Commander deck"*. Weeks later **Put in cart** puts everything
   back at once.
8. **Warned in time.** The panel shows *"Cardmarket empties your cart at
   14:35 (in 23 min)"*; 5 minutes beforehand a desktop notification appears.
9. **Saving an offer.** He clicks the ☆ next to an expensive foil. Later
   he finds it in the popup (tab **Favourites**, searching for "foil") and puts
   it in his cart with one click.

## 4. Where the interface lives, and fixed constraints

| Part | Location | Size and constraints |
|---|---|---|
| **A. Popup** | Click on the extension icon. | **400 px wide**, at most **600 px high** (Chrome limit). Header and tabs stay in place; the content scrolls. |
| **B. Panel** | Floats at the bottom right over cardmarket.com. | **380 px wide**, at most 72% of the screen height (content scrolls), 16 px from the edge. Below 480 px wide: full width with an 8 px margin. Runs in a shielded layer (shadow DOM): Cardmarket's CSS has no effect on it. |
| **C. Star button** | In every offer row on Cardmarket (product, card and seller pages) and in every cart row. | Hit area 28×28 px, icon 18 px; must fit in Cardmarket's compact white/light-grey table rows. |
| **D. Highlight** | An offer you jump to from a favourite. | Border or glow around the existing Cardmarket row. |
| **E. Settings** | Its own browser tab. | Content at most 640 px wide, centred. |
| **F. Notifications** | System desktop notification. | Only a title, one sentence of text and the icon (128 px). No custom styling. |
| **G. Icon and badge** | Browser toolbar. | Icon 16, 32, 48 and 128 px. Badge: amber, at most 3 characters. |

**General:**

- **Light and dark** follow the system setting.
- **Language:** Dutch (English as an alternative). Dutch texts are
  long: design for wrapping and truncated text.
- **Typeface:** `system-ui`. **Icons:** line icons, inline SVG, 16 px.
  Product images come from Cardmarket (card ratio ~5:7, shown as
  30×42 px); if the image is missing, a block with the first letter.
- **Do not look like Cardmarket.** No Cardmarket logo or official look:
  it must be recognisable as a separate tool on top of the site.
- **Modest.** The panel only appears when there is something to do, and
  can be collapsed into a small label on the cart page.
- **Accessible:** WCAG AA contrast, visible focus, fully operable by
  keyboard, icon buttons with a tooltip.
- **Density:** compact. Lists can have 50+ articles.

## 5. Data per article

| Field | Example | Currently shown as |
|---|---|---|
| Card name | Sol Ring | name (link), truncated with … |
| Game | Magic, Pokémon, Yu-Gi-Oh! | own line, only when several games are in view |
| Set | Commander Masters | meta line |
| Condition | MT, NM, EX, GD, LP, PL, PO | meta line |
| Language | English, German, Japanese… | meta line |
| Extras | Foil, Reverse Holo, Signed | meta line |
| Price per copy | 1,10 € | right, bold |
| Amount in cart | ×2 | next to the price |
| Wanted amount | 2 (of which 1 in cart) | line "1 of 2 in your cart" |
| Seller | CardKingdomNL | "Seller: …" or group heading |
| Image | card thumbnail | left, 30×42 |
| Status | see §6 | badge |
| Reason for disappearing | see §6 | grey line |
| Price change | was 0,89 €, now 0,99 € | amber/grey line, visible for 3 days |
| Trend price | 0,50 € (public price guide) | line, only when there is a clear difference |
| Message from Cardmarket | "This article is no longer available." (often English) | red line |
| Stock (favourites) | 3 available | extra line |
| Saved on (favourites) | saved 7 Oct | extra line |

## 6. Statuses

### 6.1 Status of an article

| Status | Meaning | Colour | Extra line |
|---|---|---|---|
| **In cart** | In your shopping cart. | green | — |
| **Partly in cart** | In it, but fewer copies than you had (the seller sold a few). Counts as "in cart" and as "missing". | amber | "1 of 2 in your cart" |
| **Missing** | Disappeared from your cart; can go back. | amber | the reason, see 6.2 |
| **Unavailable** | Putting back failed: sold, or not enough stock. Disappears from the list by itself after a month. | red | the message from Cardmarket |

### 6.2 Reason why something is missing

| Reason | Text |
|---|---|
| Whole cart empty | "Your whole cart was emptied" |
| Everything from one seller gone | "Everything from this seller left your cart" |
| Only this article gone | "Only this article left your cart, probably sold" |

### 6.3 Extra information on an article row

| Situation | Text | Tone |
|---|---|---|
| Price went up | "Price 0,10 € higher (was 0,89 €)" | warning (amber) |
| Price went down | "Price 0,10 € lower (was 0,99 €)" | neutral |
| More expensive than the trend (≥15% and ≥0,10 €) | "Trend 0,50 € · this offer is 98% higher" | warning |
| Cheaper than the trend (≥15%) | "Trend 1,20 € · this offer is 20% lower" | neutral |
| Unclear refusal | "Cardmarket did not accept it. It stays on your list, try again later." | red |
| Accepted but not in cart | "Cardmarket accepted it, but it is not in your cart." | red |

### 6.4 Status of a favourite

| Status | Display |
|---|---|
| Favourite | filled gold star ★ |
| In your cart | green badge "In cart", button *Put in cart* hidden |
| Sold | red line with the reason ("No longer available.") |

### 6.5 Status of a put-back action

| Status | What the user sees |
|---|---|
| **Waiting** | Started from the popup while Cardmarket is still opening: "Waiting for Cardmarket to open…", bar at 0%, **Stop**. |
| **Busy** | "Putting articles back in your cart…", progress bar, "3 of 12 · Sol Ring", **Stop**. First one request per seller, then one by one whatever did not arrive. If you leave the page, the browser asks whether you are sure. |
| **Done** | "**Done** — 10 put in your cart, 2 not added." Failed articles below it. **Undo**, **Open cart**, **Close**. |
| **Stopped (error)** | "**Stopped**" + red error message (§8E) + grey line "Details: …" (for a bug report). |
| **Stopped (by you)** | Grey: "Stopped before all articles were put back." |
| **Interrupted** | The tab closed: "**Refill interrupted** — The tab was closed or left before everything was back. 5 still to go." **Continue (5 to go)**, **Close**. |
| **Undo busy / done** | "Taking the added articles out of your cart again…" → "10 articles taken out of your cart again." |
| **Already busy** | "Already putting articles back — wait until that has finished." (only one action at a time, across all tabs) |

### 6.6 Status of the cart and the account

| Status | Display |
|---|---|
| Cart will be emptied at a known time | "Cardmarket empties your cart at 14:35 (in 23 min)." (amber and bold at ≤10 min) |
| Another Cardmarket account logged in | Panel "Another Cardmarket account" (§7B-5) |
| Cart cannot be read properly | Error message (§8E); nothing is marked as missing |
| Extension updated in an open tab | Label "Cart Saver updated · reload the page" |

## 7. Screens and their states

Texts in quotation marks are the current English interface texts; `$1`
stands for a number or name.

### A. Popup

**Fixed:**

- **Header:** logo (blue rounded square, white shopping cart, amber dot),
  title **"Cart Saver"**, **game picker** (dropdown "All games" / "Magic" /
  "Pokémon" …, only with several games) and a gear icon to the
  settings.
- **Tabs:** **"Cart"**, **"Favourites (2)"**, **"Lists (1)"**.
- **Progress block** at the top, in every tab, with the statuses from §6.5.
- **Notice line** (small, grey), e.g. "Opening your cart on Cardmarket —
  putting articles back starts automatically."
- **Toast** at the bottom (dark, 3–8 s), optionally with an action:
  "“Portal Mage” removed from the list. **Undo**",
  "Saved as “Commander deck”.", "Copied to the clipboard."
- **Footer** (trust signal): "Everything is stored locally in your browser.
  Cart Saver only talks to Cardmarket (the site and its pictures), through your own session."

**Tab "Cart":**

- **Counters** (3 tiles): "In cart" (green), "Missing" (amber, including
  partly), "Unavailable" (red).
- **Buttons:** primary **"Put 3 back in your cart"** (or disabled:
  "Nothing to put back"); secondary **"Open cart"**.
- **Game choice for putting back** (only when articles from several games are
  missing): "Put back: ✓ Magic (2) ✓ Pokémon (1)" — on/off chips.
- **Filter chips:** "All (5)", "Missing (3)", "In cart (2)",
  "Unavailable (1)".
- **List per seller**, group heading "snowc (2)". **Article row:** thumbnail,
  name, meta line, (game), extra lines from §6.3, on the right price + ×amount +
  status badge, icon buttons: ☆/★ favourite, 🔍 similar offer, ↻
  put back (only when not in cart), × remove.
- **Below the list:** on the left **"Copy as text"** and **"Download CSV"**.
- **Empty:** "Nothing saved yet" — "Open your shopping cart on Cardmarket and
  Cart Saver remembers its articles automatically." — **Open Cardmarket**.
- **Filter empty:** "No articles in this view."

**Tab "Favourites":**

- Search field "Search favourites (name, set, seller…)" (several words).
- List, newest at the top. Row: thumbnail, name (link to the offer),
  meta line, "Seller: …", "3 available · saved 7 Oct", price. Buttons:
  🛒 *Put in cart*, ↗ *View offer on Cardmarket*,
  👤 *Find at this seller*, ★ *Remove from favourites*.
- **Empty:** "No favourites yet" — "Click the ☆ next to an offer on
  Cardmarket (or an article in your cart) to keep it here."
- **No search result:** "No favourites match your search."

**Tab "Lists":**

- Form: field "Name, e.g. Commander deck" + button **Save list**.
- Per saved cart: name (bold), "12 articles · 34,50 € · Magic · 9 Oct"
  (or "All games"), buttons **Put in cart** (primary),
  "Copy as text", "CSV", × *Delete*.
- **Empty:** "No saved lists yet" — "Save your list under a name
  (for example per deck) and put it back in your cart later with one click."
- **Nothing to save:** toast "There is nothing in the list to save."

### B. Panel on cardmarket.com

There is always at most one view, in this **order of priority**:

1. **Interrupted** — title "Refill interrupted", text from §6.5,
   **Continue (5 to go)** (primary) and **Close**.
2. **Busy** — title "Putting back", text, progress bar,
   "3 of 12 · Sol Ring", **Stop**.
3. **Result** (up to 10 min after finishing) — title "Done" or "Stopped", ×,
   "10 put in your cart, 2 not added.", optionally an error message +
   "Details: …", list of failed articles (with ⇄ 🔍 ×), buttons
   **Open cart** (not on the cart page), **Undo**,
   **Close**.
4. **Single notice** with ×, for example:
   - "Favourite not on this page" — "This offer from MintCondition is not
     listed here. It may have been sold, or it is further down the
     list." — **Find at this seller**, **Find a similar offer**;
   - "“Portal Mage” removed from the list." — **Undo**;
   - "Undo refill" — busy / done (§6.5);
   - "Already putting articles back — wait until that has finished."
5. **Other account** — "Another Cardmarket account" — "Your saved articles
   belong to tester. While you are logged in as someone-else, nothing is
   saved or marked missing." — **Use someone-else
   from now on**.
6. **Cart panel** (only on the cart page) — title "Cart Saver", button –
   (minimise):
   - intro: "9 articles in your cart are saved." or "Your cart is
     empty. You can put these saved articles back:";
   - **emptying time**: "Cardmarket empties your cart at 14:35 (in 23 min)."
   - **shipping per seller**, collapsed to one line
     "▸ 4 sellers · shipping 4,60 € (21% of the total)", expanded
     per seller: name + value, "3 articles · shipping 1,15 € (34%)",
     warnings "shipping costs more than the articles",
     "2,40 € below the 25 € limit for tracked shipping",
     "over 25 €: usually tracked shipping (dearer)";
   - group **"Not in your cart (3)"** with "Select all / Select
     none", game chips "Put back: ✓ Magic (2) ✓ Pokémon (1)",
     rows with a checkbox and ×, primary button **"Put 3 back in your cart ·
     12,50 €"** (off when nothing is ticked);
   - nothing missing: "Everything you saved is in your cart.";
   - group **"No longer available (2)"** with link "Clear list", rows
     with ⇄ *Find a replacement*, 🔍 *Find a similar offer*, ×; button
     **Try again anyway**;
   - **replacement** (under a row after ⇄): block "Replacement" with
     "Looking for a replacement…", or "No similar offer found.", or
     at most 3 suggestions: row with a reason ("Same seller",
     "Seller already in your cart: no extra shipping",
     "Cheapest similar offer") + price difference ("0,10 € more" /
     "0,20 € cheaper") and button **Add**;
   - automatic saving off: button **Read the cart now**.
7. **Collapsed label** (cart page): pill with a dot, green
   "Cart Saver · 9 saved" or amber "Cart Saver · 3 to check".
8. **Reminder** (other pages, when something is missing) — "Your
   cart was emptied", × (remembers the dismissal for this set) —
   "3 saved articles (5,78 €) are no longer in your cart." —
   **Put 3 back in your cart**, **View** — with several games:
   "Or only: Magic (2) · Pokémon (1)".
9. **Updated** — pill "Cart Saver updated · reload the page".
10. **Nothing to do** — no panel.

### C. Star button in Cardmarket's rows

States: **off** (empty grey star), **hover** (light background,
amber), **on** (filled gold star), **focus** (focus ring). Tooltip:
"Save as favourite" / "Remove from favourites". Show it in a
Cardmarket offer row (seller, condition badge, language, price, amount,
blue shopping cart button) and in a cart row.

### D. Highlighting an offer

When the user jumps from a favourite to the product page, that
row gets a clear amber border with rounded corners and scrolls into view.

### E. Error messages

Red in the progress block and the result, with a small grey,
selectable line "Details: …" below it (technical, for bug reports).

| Situation | Text |
|---|---|
| Not logged in | "You are not logged in on Cardmarket. Log in and try again." |
| Security check | "Cardmarket is showing a security check. Reload the page, complete the check and try again." |
| Too many requests | "Cardmarket asked to slow down. Wait a few minutes and try again." |
| No connection | "No connection to Cardmarket. Check your internet connection." |
| No security code | "Cardmarket's security code (token) was not found on the page. Reload the page and try again." |
| Cart unreadable | "Your cart page could not be read, so nothing was added (Cardmarket may have changed its layout). This extension probably needs an update." |
| Other account | "You are logged in with another Cardmarket account than the one these articles were saved with." |
| Unexpected answer | "Cardmarket gave an unexpected answer, so nothing more was added. Try again; if it keeps happening, send the details below to the developer." |
| Cardmarket changed | "Cardmarket changed how adding to the cart works. This extension needs an update." |
| Other | "Something went wrong. Try again." |

### F. Settings page

1. **Header:** logo (48 px), "Cart Saver", description "Remembers what you put
   in your Cardmarket shopping cart and puts it back with one click after the
   cart was emptied."
2. **Card "Settings"** (each with an explanation below it; after a change briefly
   "Saved."):
   - **Save cart automatically** (on);
   - **Show a reminder on Cardmarket** (on);
   - **Notifications** — desktop notifications (on);
   - **Check the cart while you are away from Cardmarket** (off; "it adds
     requests");
   - **Compare prices with the trend** (off), with status line
     "Last read: 09/10/2026, 10:12 (37 articles)." or "Could not read the
     price guide: …";
   - **Pause between articles (seconds)**, number field 0.5–10, default 1.2.
3. **Card "Your saved articles, favourites and lists":** summary
   "5 saved: 2 in your cart, 3 missing, 1 unavailable. 2
   favourites.", buttons **Export (JSON)**, **Import**,
   **Delete everything** (red, with confirmation), result line
   ("4 articles imported.").
4. **Card "How it works":** five numbered steps and the privacy sentence.

### G. Desktop notifications

| When | Title | Text |
|---|---|---|
| Articles disappeared while you were elsewhere | "Articles left your Cardmarket cart" | "3 saved articles are no longer in your cart. Click to put them back." |
| 5 minutes before emptying | "Your Cardmarket cart is about to be emptied" | "In about 5 minutes. Click to open your cart." |

### H. Icon and badge

Badge = number of articles that are missing or partly in the cart (amber).
Tooltip: "Cart Saver – 3 saved articles not in your cart".

## 8. Current visual basis (free to improve)

| Token | Light | Dark |
|---|---|---|
| Background | `#ffffff` | `#1b2029` |
| Surface | `#f5f7fa` | `#232a35` |
| Border | `#dfe3ea` | `#343d4b` |
| Text | `#1c2430` | `#e7ebf1` |
| Secondary text | `#637083` | `#9aa5b5` |
| Accent | `#1a5fd6` | `#4c8dff` |
| In cart | `#1d7f45` on `#e3f4ea` | `#5fd08f` on `#18382a` |
| Missing / partly / warning | `#8a5a00` on `#fff2d6` | `#f2c063` on `#3a2e14` |
| Unavailable / error | `#b42318` on `#fde7e5` | `#ff8a80` on `#42201d` |
| Star | `#e09a00` | `#f5b82e` |

- Radius 10 px (panels), 7 px (buttons), round (badges and chips).
- Soft, deep shadow (the panel floats above Cardmarket).
- Base 13 px; titles 14–15 px; meta lines 12 px.
- Buttons do not wrap their text; they move to a new line.

**Desired look and feel:** calm, reliable and efficient, like good
tools. A touch of the collector (cards, stars, gold), but businesslike
enough not to look out of place on Cardmarket. "Cart Saver" may get its
own wordmark.

**Points of attention for the redesign** (where it currently chafes):

- An article row can get many lines (game, partly, reason, price, trend,
  notice). Look for a more compact form: for example small labels or icons
  instead of full sentences, with the explanation in a tooltip.
- The cart panel is long (emptying time, shipping, missing, unavailable,
  replacement). Design clear sections or a collapsible
  structure.
- The difference between *Missing* (can go back) and *Unavailable* (must be
  replaced) must be clear at a glance.
- Game picker (dropdown) and game chips: make the relation between "which games
  do I see" and "which games do I put back" clear.

## 9. Not built yet (leave room for it, optional)

- Labels and notes on favourites ("Atraxa deck", "gift") with a filter.
- "Recently viewed": an automatic history of offers.
- A self-test button in the settings ("Check that everything works").
- A mini price chart per favourite.
- Putting unavailable cards on a wants list.

## 10. Requested deliverables

1. **Popup — Cart:** filled (several sellers and games, all four
   statuses, price and trend lines), with game chips, empty, filter
   empty, with progress (waiting, busy), result (done, error with details,
   interrupted) and a toast with *Undo*.
2. **Popup — Favourites:** filled, search result, no result, empty, with
   a sold favourite and a favourite that is in the cart.
3. **Popup — Lists:** empty, with saved lists, toast after saving.
4. **Panel:** all 10 views from §7B, including the cart panel with
   expanded shipping and an open replacement, in the context of a
   simplified Cardmarket page; also on a narrow screen (380 px).
5. **Star button** in all states, in an offer row and a cart row,
   plus the highlight.
6. **Settings page.**
7. **Icon** (16/32/48/128), **badge** and the two **desktop notifications**.
8. **Component overview:** article row (all variants), status badges,
   extra-information lines, buttons (primary, secondary, danger, icon, small),
   chips (filter, on/off), progress bar, tabs, search field, toast, empty
   states, collapsed label, replacement block, shipping line.
9. **Design tokens** (colour, typography, spacing, radius, shadow) for light
   and dark.

**Reference:** screenshots of version 1.4 in `docs/screenshots/`:
`popup-cart`, `popup-cart-dark`, `popup-favorites`, `popup-carts`,
`popup-empty`, `panel-cart` (with shipping and game picker), `panel-cart-dark`,
`panel-reminder`, `panel-result`, `panel-interrupted`, `panel-replacement`,
`panel-other-account`, `panel-favorite-not-found`, `panel-error`,
`panel-collapsed`, `stars-on-product-page` (on a simplified
test page) and `options`.

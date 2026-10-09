# Analysis for 1.6: images, bugs and what could be better

## Status: built in 1.6

All five steps from [§6](#6-proposal-for-16) have been built and tested.
That means 89 tests against the mock site, plus an optional test against
Cardmarket's real image server (`CMCS_LIVE=1 npm test`).

| Step | Fixed |
|---|---|
| 1. Images and the real site | P1–P6, S1–S5, B10 |
| 2. Never lose anything again | B1–B5, B7–B9, B13, B25–B30, B33, U4, T4 |
| 3. Carts that make sense | U1–U3, B16, B21 |
| 4. Calm and numbers that add up | B12, B14, B15, B20, B22–B24, B31, B32, T1–T7 |
| 5. Popup and panel the same | U5–U8, B17–B19, and most of U9 |

Deliberately not done (yet):

- **B6, concurrent writes.** The chance is smaller now: images
  have their own key and are written only by the background. Fixing it
  completely needs one place that does all the writing: see
  [PLAN-1.7](PLAN-1.7.md), part A.
- **B11, names of the locks.** The panel and the stars are visible in the
  page anyway, so hiding the names does not help.
- **B27, storage full.** The 10 MB limit is gone (`unlimitedStorage`), but
  a failed write is still not reported.
- **B32, memory.** The price guide is still read in one go, but at most
  once a day and with a 304 if it did not change.
- **B33, partly.** An "undo" is still not visible to the background as a
  running job.
- **B38.** The permission for the price guide is not optional yet.
- **S6, P7 and U9.** The trend from the product page and seller photos come
  later. Popup and panel now do the same, but their code is not fully
  shared yet.
- **S9.** We still do not know when Cardmarket shows "your cart will be
  emptied at …". The plan to observe it ourselves and learn it is in
  [PLAN-1.7](PLAN-1.7.md), part B.

---

Investigated on 9 October 2026 (Cart Saver 1.5.0), in three ways:

1. **The real site.** In your own logged-in Chrome, with DevTools. I only
   read pages: bought nothing, changed nothing in the cart.
2. **Experiments.** In a test browser, with the real extension and real
   images from Cardmarket.
3. **The code, line by line.** In three parts: reading the cart and putting
   it back; popup and panel; background, favourites and images. Every finding
   was then checked once more in the code.

## In short

1. **Images in the popup never load.** Cardmarket's image server only gives
   images to requests that come from cardmarket.com; the popup gets
   a 403. The fix has been tested: in the real popup it went from 0 to 3
   images. It consists of one Chrome rule that sends cardmarket.com as the
   sender with our own requests, plus permission for the
   image server ([§1](#1-images)).
2. **Cart Saver does not work on seller pages.** There Cardmarket uses
   a different row code (`stockRow`). No stars appear, and "replacement at
   the same seller" never finds anything ([S1](#2-what-the-real-site-does-differently-from-what-cart-saver-expects)).
3. **You can only save a cart in the Carts tab.** You see your
   cart in the Cart tab, and an invisible game filter decides
   what gets saved. Proposal: "Save as list…" in Cart and in
   the panel ([U1](#4-illogically-divided)).
4. **In three places you can silently lose things:**
   - a click on, for example, "Purchases" on the cart page ([B1](#3-bugs-in-the-code));
   - another Cardmarket account ([B2](#3-bugs-in-the-code));
   - the update script, if it points at your development folder ([B25](#3-bugs-in-the-code)).
5. **The panel on Cardmarket jumps back to the top on every update**
   ([B12](#3-bugs-in-the-code)).
6. **Favourites from a Magic product page get the wrong image**
   (the previous card from the carousel), and favourites never get a
   trend price ([S3](#2-what-the-real-site-does-differently-from-what-cart-saver-expects)).
7. **Sealed products are half supported.** Searching at the seller finds
   nothing, boxes are cropped, and everywhere it says "card(s)".
8. **Counts are wrong.** With 4× the same card it says "1 card(s)
   can go back · 4,00 €", and "partly in your cart" counts twice
   ([B14](#3-bugs-in-the-code)).
9. **Every push goes to your browser untested.** That happens through the
   update script. One mistake and Cart Saver stops working, without being
   able to repair itself ([B26](#3-bugs-in-the-code)).
10. **Cardmarket warns at the top of the cart about abuse of the
    cart.** Important to know for an extension that puts cards back
    ([§2](#a-warning-from-cardmarket-itself)).

The proposed order is in [§6](#6-proposal-for-16).

---

## 1. Images

**In short:** Cart Saver almost always knows which image belongs to an article,
but the popup and the settings page cannot load it. The panel on
Cardmarket itself does not have this problem.

### How it works now

1. **Storing the image URL.** When reading your cart, Cart Saver takes the
   URL from the camera icon of each row (`.thumbnail-icon`, attribute
   `data-bs-title` with `<img src="https://product-images.s3.cardmarket.com/…">`).
   **That works on the real site**, also for sealed products.
2. **Making a thumbnail.** Two seconds after a Cardmarket page has loaded,
   `thumbs.js` tries to make a thumbnail of each image
   (`fetch(url, {mode: 'cors'})` → canvas → data URL).
3. **Showing.** The popup shows the thumbnail, otherwise the URL itself,
   otherwise a letter.

### What the image server does

Measured in your own Chrome:

| Request | Result |
|---|---|
| Image from a Cardmarket page (Referer `https://www.cardmarket.com/…`) | **200**, loads |
| Same, with only `https://www.cardmarket.com/` as Referer | **200** |
| Same without Referer | **503** |
| From another site (Referer `https://example.com/`) | **403** |
| Opening it directly in a tab | **403** ("Request blocked", CloudFront) |
| `fetch` with CORS from cardmarket.com (what `thumbs.js` does) | **fails**: no CORS headers |
| Cookies | not needed |

Consequences:

- **P1. In the popup and on the settings page you only see letters.**
  Chrome does not send a Cardmarket Referer there, so the image server returns
  a 403.
- **P2. `thumbs.js` always fails.** No thumbnail is ever stored.
  Every article gets `thumbTriedAt`, is tried again after three days and
  then fails again.
- **In the panel on Cardmarket, images do load.** There the request comes
  from the page itself.

### Fix (tested)

Tested in a test browser with the real popup and real image URLs: an
Elite Trainer Box, Sol Ring and Spectral Searchlight.

| | Images | Letters |
|---|---|---|
| Now | 0 | 3 |
| With the fix | 3 | 0 |

The fix has three parts:

1. **Permission in `manifest.json`.** Add `declarativeNetRequestWithHostAccess`,
   plus host permission for `https://product-images.s3.cardmarket.com/*`.
   Without that host permission it does not work; that was tested too.
2. **One rule in the background** (`chrome.declarativeNetRequest`). For
   requests that Cart Saver *itself* makes to the image server, Chrome sets the
   Referer to `https://www.cardmarket.com/`.
   - This applies only to that one domain and only to our own
     requests (`initiatorDomains: [extension-id]`).
   - Requests from Cardmarket itself stay untouched.
   - Set the rule on every start of the service worker. It is idempotent.
3. **Make thumbnails in the background instead of in the page.**
   - With the host permission, the service worker is allowed to read the image.
   - A thumbnail of 60×84 measured about 2 KB (as a data URL ~2.7 KB).
   - Store them under their own key (`cmcs.thumbs`, per product) and not in
     `cmcs.items`. See P6 for why.

Steps 1 and 2 already give images in the popup; Chrome then keeps them in its
own cache. Step 3 makes it faster, and also works when the image server is
briefly unreachable. In the panel the original URL can stay; it already loads there.

### Also found with the images

- **P3. Wrong image for favourites from a Magic product page.**
  - At the top of such a page is a carousel with the previous, current and
    next card from the set. `productImage()` (`cardmarket.js:405`) takes the
    first image, so that of the previous card.
  - Example: a star on Sol Ring (Commander Masters) stores the image
    of Shimmer Myr.
  - The right product number is on the page (`input[name="idProduct"]`,
    here 721733). Pick the image with `/721733/` in the URL, and use it to
    fill in `productId` too; that now stays empty (`cardmarket.js:482`).
  - The same applies to replacements that are found via the product
    page.
- **P4. Sealed gets cropped.** Product photos of boxes are square
  (300×300), the slot is card-shaped (30×42, `object-fit: cover`). Use
  `contain` for non-cards, with a light background.
- **P5. The tests were too kind.** The mock image server gives everyone
  images, with `Access-Control-Allow-Origin: *` (`tests/e2e.test.mjs:112`).
  That is why all tests passed while it never worked on the real site. Make
  the mock server as strict as the real one: only with a
  Cardmarket Referer, and no CORS.
- **P6. Storage.** Once thumbnails do work, they must not go into `cmcs.items`
  and `cmcs.favorites`, as the code now intends:
  - Every thumbnail would then rewrite the whole block: up to 24 times per
    page load, in every tab. Each time, badge, panel and popup rebuild
    from scratch.
  - With a large list (~1,000 articles + 500 favourites) the 10 MB limit
    fills up. After that, saving stops silently (see B27).
  - Therefore: its own key, one thumbnail per product, a maximum (or
    `unlimitedStorage`), and one tab at a time.
- **P7. Photos from sellers.** Some offers have a photo of the
  actual article (`marketplace-article-scans.s3.cardmarket.com/<id>/<id>t.jpg`).
  An idea for later, for example for favourites.

### Other approaches we do not recommend

- **Images from other sources** (Scryfall, pokemontcg.io): cards only,
  no sealed. And Cart Saver currently promises to talk only to cardmarket.com.
- **Our own server as a go-between:** costs money and breaks the
  privacy promise.
- **Making thumbnails in the page itself** (what happens now): not possible. The
  server does not allow reading images from a page.

---

## 2. What the real site does differently from what Cart Saver expects

| # | What I saw | Consequence for Cart Saver | Severity |
|---|---|---|---|
| S1 | On **seller pages** (`/Users/<seller>/Offers/…`) the rows are called `stockRow<id>`, not `articleRow<id>` as on product pages. | No ☆ on seller pages (0 stars measured). "Replacement at the same seller" **never** finds anything (`replace.js:51`, `cardmarket.js:418`, `favorites.js:19`). The README does promise it. | high |
| S2 | Every seller has a separate page per product type (`/Offers/Singles`, `/Offers/Boosters`, `/Offers/Elite-Trainer-Boxes`, …), with the same segment as in the product URL. Searching by name (`?name=`) works everywhere. | Cart Saver always searches in `/Offers/Singles` (`cardmarket.js:114`). So for sealed it finds nothing, and the link "this seller's offers" on a favourite shows an empty page. | medium |
| S3 | Magic product pages have a carousel at the top; the right product number is in `input[name="idProduct"]`. | Wrong image (P3), no `productId`, so no trend price for favourites. | medium |
| S4 | On the German, French, Spanish and Italian site the language names are translated ("Englisch"); conditions stay "NM", "EX". | Cart Saver only knows the English names (`LANGUAGE_IDS`). The language of favourites and replacements is then unknown, and the popup shows "Englisch". After S1, "Same seller" could suggest a different language. | medium |
| S5 | Product pages show the **shipping costs** per offer (for an Elite Trainer Box: 24,00 €). | Replacement calculates with a fixed 1,25 € per extra parcel (`replace.js:21`). For sealed that is wrong. | medium |
| S6 | Product pages show **Price Trend** and averages over 1, 7 and 30 days. | A trend price is possible without downloading the price guide, for products you look at. | opportunity |
| S7 | The **price guide** works (Magic 26 MB, Pokémon 16 MB) and also contains sealed (`idCategory`). Pokémon uses `trend-holo`. | So "price vs trend" works for boxes too. The downloads remain hefty (see B32). | — |
| S8 | **Orders:** the overview pages (`/Orders/Purchases/…`) have no article rows, the page of a single order does (`tr[data-article-id]`). | What you bought only leaves the list when you open that order, or via the recognised "Proceed to checkout" button. | low |
| S9 | No "your cart will be emptied at …" message seen. | The countdown from 1.3 probably has nothing to read on the real site. Could not confirm when Cardmarket does show the message. The README promises it. | unknown |
| S10 | A product page shows 50 offers, with "Show more results". | Replacement only looks at those first 50. Fine. | — |
| S11 | The cart groups by seller and within that by product type; the rows have the familiar `data-*` fields, sealed without `data-condition`. | Reading the cart works, also for sealed. | — |

### A warning from Cardmarket itself

At the top of the cart it says:

> "Reminder: Please only keep items in your cart that you intend to purchase.
> Abuse of the shopping cart may result in account suspension."

Cart Saver puts back cards that Cardmarket removed from your cart. That is
exactly the area this warning is about. Cart Saver already does it
politely: only after your click, one request at a time, with pauses. Still:

- **README:** put it under "Good to know", so users know about it.
- **Never build:** "put back automatically" or "hold on to items". Cardmarket
  warns against that.
- **Consider:** a calm remark when someone puts back the same list many
  times in a row.

---

## 3. Bugs in the code

Severity:

- **high**: you notice it often, or you lose something;
- **medium**: noticeable in a normal situation;
- **low**: edge case, or minor.

### Reading the cart and putting it back

| # | Severity | What goes wrong | Where |
|---|---|---|---|
| B1 | medium | **Click detection too broad.** On the cart page, every click on a button or link with "purchase", "buy", "checkout" or "commander" in its text or class counts as "I'm removing everything", for example the "Purchases" menu. All rows are then marked for 10 minutes. If Cardmarket empties your cart in that time, Cart Saver **forgets** everything instead of showing it as "emptied". | `main.js:27, 250-255, 299-315` |
| B2 | medium | **Another account.** A job that fails because you are logged in with another account still checks the cart afterwards and writes that into your list. Your cards become "emptied", or those of the other account are added. You can simply start such a job from the popup. | `refill.js:368-375, 415-424` |
| B3 | low | **Old token comes first.** The token from the page (which may have been open for hours) gets priority over the fresh token from the cart. If Cardmarket refuses the old token, round 1 is refused entirely before a new token is fetched. | `refill.js:273, 281, 516` |
| B4 | low | **Opening an order page** removes articles from the list, even if you have that article in your cart again now. | `main.js:337-340` |
| B5 | low | **"Unknown twice = sold".** During a general outage, on the second attempt all cards are marked as sold, and cleaned up after 30 days. | `refill.js:469-473`, `store.js:308-316` |
| B6 | low | **Concurrent writes.** Tabs, popup and background write to the same storage independently of each other. A "Stop" click can be overwritten by the heartbeat of the running job. | `store.js:84-96` |
| B7 | low | An **unreliable read** counts as successful, so no new attempt for 15 minutes. With another account, on the other hand, the cart is read again on every page load. | `main.js:56, 87-103` |
| B8 | low | **Looking for a token** can request up to 12 pages in a row, without a pause. | `cardmarket.js:721-734` |
| B9 | low | If the page bridge answers too late once (busy page), it stays off for that page. | `cardmarket.js:554-582` |
| B10 | low | **Replacement:** a seller who is already in your cart via a different game does not count as "already in your cart". | `replace.js:62-66` |
| B11 | low | The names of Cart Saver's internal locks (`cmcs.refill`, `cmcs.sync`) are probably visible to Cardmarket's own scripts (not confirmed). The site could see from them that you use Cart Saver. | `refill.js:20, 55`, `main.js:117` |

### Popup and panel

| # | Severity | What goes wrong | Where |
|---|---|---|---|
| B12 | **high** | **The panel jumps back to the top on every update.** It is rebuilt completely on every storage change, every checkbox, every expanded row and every minute (countdown). Scroll position and focus are lost, and a click made exactly during such an update is lost. If you click "Find a replacement" at the bottom, the suggestions appear out of view. | `widget.js:254-268, 761` |
| B13 | medium | **"Undo" disappears too early.** The job is closed first and only then undone. If that fails (session expired), the button is gone and the cards stay in your cart. | `widget.js:185-199` |
| B14 | medium | **Counts are wrong.** (a) "1 card(s) can go back · 4,00 €" with 4×: rows are counted, the amount is about copies. (b) In the settings, "partly in your cart" is counted twice, so the sum is larger than the total. (c) "In your cart" means something different in the popup than in the panel. | `popup.js:423, 545`, `widget.js:496, 550, 597`, `store.js:183-193`, `options.js:61-72` |
| B15 | medium | **After removing an article**, the message with "Undo" replaces the whole panel; clearing out five cards costs five extra clicks. After a refill job, that message is hidden behind the summary and suddenly pops up later. | `widget.js:175-183, 669-672, 740-759` |
| B16 | medium | **Saving manually is unreachable.** If "saving automatically" is off and the list is empty, the panel does not appear, and so neither does the "Save current cart" button. The explanation in the settings does promise that button. | `widget.js:586-594, 750` |
| B17 | low | A **favourite** you wanted to put in the cart while you were logged out stays in your list afterwards as "can go back" (badge, notification), while it was never in it. | `popup.js:203-211`, `store.js:474-497` |
| B18 | low | A failed favourite gets a SOLD stamp in the panel for no reason, and the little cross next to it does nothing. | `widget.js:353-357, 466` |
| B19 | low | Removing an article that **is in your cart** in the popup only works for a moment: on the next read it is back. | `popup.js:489-498` |
| B20 | low | The popup message "Already putting articles back…" stays, even when that has already finished. | `popup.js:43` |
| B21 | low | Putting back a saved cart whose contents are all already in your cart: nothing visibly happens. | `popup.js:194-200` |
| B22 | low | Contradictory texts when only sold cards are left: "Nothing to put back" + "Your cart is empty", while it is not. | `widget.js:505-514` |
| B23 | low | The message at the bottom of the popup falls exactly over the big button, and a second message wipes the "Undo" of the first. | `popup.css:68-72`, `popup.js:126-139` |
| B24 | low | **Dark mode:** scroll bar and game drop-down stay light (no `color-scheme`). | `ui.js:342-383` |

### Background, updates, storage and favourites

| # | Severity | What goes wrong | Where |
|---|---|---|---|
| B25 | **high for you** | **The update script wipes local work.** If you point it at a folder that is already a git clone (for example your development folder, if Chrome loads the extension from it), it immediately throws away all uncommitted changes and switches your branch. After that it runs `git reset --hard` every 3 minutes. | `scripts/autoupdate-mac.sh:54-66, 72` |
| B26 | medium | **Every push goes to your browser untested.** Within ~4 minutes the script pulls in everything from the default branch, without checks and without a fallback. One syntax error in `service-worker.js` or `manifest.json`, and Cart Saver stops working. The next update will not come through by itself either, because it has to go through the broken service worker. | `service-worker.js:78-107`, `autoupdate-mac.sh:63-72` |
| B27 | medium | **Storage full = saving stops silently.** There is no `unlimitedStorage` and no check on the 10 MB limit. Once it is full, every write fails and nobody sees it: no new cards, a star that does nothing. Still far off now, but thumbnails in the current place (P6) bring it closer. | `store.js:80-96` |
| B28 | medium | **One error stops everything on that page.** `main.js` has a single try/catch around everything. If something goes wrong with the favourites or the panel, then on that page detecting removals, resuming a job and the thumbnails are skipped too. | `main.js:336-363` |
| B29 | medium | **The "cart emptied" notification** in practice only works with "check now and then" on (off by default). And it also counts what you just bought ("3 articles out of your cart" while you were checking them out). | `main.js:104-109`, `service-worker.js:186-211` |
| B30 | low | **"Check now and then" checks every 20 minutes** instead of every 10: the "just read" check falls exactly on the boundary. | `service-worker.js:202` |
| B31 | low | **Trend price:** (a) favourites do not get one (no `productId`, see S3); (b) Pokémon Reverse Holo is compared with the normal price; (c) a trend of 0 overwrites a real one; (d) red trend notes stay after you turn the feature off. | `cardmarket.js:482`, `service-worker.js:236-282`, `ui.js:104-113` |
| B32 | low | **Price guide download:** the whole file (up to 26 MB) goes into memory in one go; Chrome can stop the background after 30 seconds; there is no "already done today" check and no 304. | `service-worker.js:236-282` |
| B33 | low | **Self-update at a bad moment.** A job that has just started is aborted; "undo" is invisible to the background and can stop halfway; it reloads while you are in the checkout. | `service-worker.js:93-105` |
| B34 | low | **Favourites:** on every page view with a favourite, the whole favourites list is rewritten, and all stars are redrawn. | `favorites.js:105-122, 39-49` |
| B35 | low | Sold articles are cleaned up **silently** after 30 days, even if "sold" was a mistake (B5). | `store.js:307-316` |
| B36 | low | After turning the extension off and on again, the badge stays empty until something changes. | `service-worker.js:291-300` |
| B37 | low | A link to a favourite (`#articleRow…`) does not work if the row only appears after "Show more results". | `favorites.js:125-148` |
| B38 | low | The permission for `downloads.s3.cardmarket.com` is required, while the price feature is off by default. Could be optional. | `manifest.json:20-23` |
| B39 | low | Update script: `status` says "on" even when it keeps failing, and the log file grows without end. | `autoupdate-mac.sh:100-123` |

### Texts

| # | What | Where |
|---|---|---|
| T1 | "card(s)" even when it is about boxes (6 texts). Better: "article(s)". | `_locales/*/messages.json` |
| T2 | Plurals with "(s)": "1 card(s) can go back", "In about 1 minutes". Chrome has no plurals; two keys (one / more) solve it. | same, `service-worker.js:177` |
| T3 | Cardmarket's own message appears in English in the Dutch popup ("This article is no longer available."), while Cart Saver already knows the reason. | `refill.js:474`, `popup.js:505` |
| T4 | "Delete everything" also deletes saved carts, but does not say so. Importing counts a cart as 1 article. | `options.js:125-170` |
| T5 | The explanation in the settings mentions a "Put back" button that does not exist, and says nothing about Carts, replacement or shipping costs. | `how1`–`how5` |
| T6 | `aria-label="Spel"` is hard-coded in the HTML, also in English. The CSV has English column names and internal status codes (`in_cart`). | `popup.html:13`, `store.js:341-366` |
| T7 | Ten translations are no longer used anywhere, plus some dead code from before 1.5. | e.g. `ui.js:48, 428-434, 488`, `widget.js:725-735` |

---

## 4. Illogically divided

### U1. You can only save a cart in the "Carts" tab (high)

- **Now:** the form "Name, e.g. Commander deck" + "Save list" is only
  in the Carts tab (`popup.html:52-55`).
- **What gets saved** is the list from the **Cart** tab: what
  is in your cart, partly in your cart or was taken out of it. Sold
  articles are not (`popup.js:91-98`).
- **Hidden filter.** The game choice at the top ("All games", "Pokémon", …) is
  invisible in the Carts tab, but it does decide what gets saved.
  If you pick "Pokémon" in Cart and then save in Carts, you
  only save Pokémon, without it saying so anywhere.
- **On Cardmarket itself** you cannot save anything: the panel on the
  cart page has no button, while that is where you look at your cart.
- **Proposal:**
  - A **"Save as list…"** button in the Cart tab, next to "Copy
    as text" and "Download CSV"; those already use exactly the same list.
    Click → name field with "12 articles · All games" next to it → Save.
  - The same button in the panel on the cart page.
  - The Carts tab is then only for viewing and putting back. When
    it is empty, it points to the button in Cart.
  - In addition: expanding the contents of a saved cart, renaming it, and
    "update with what is in your cart now".

### U2. "Cart" means three things (medium)

- **Three meanings:**
  - the real cart on Cardmarket;
  - the **Cart** tab (what Cart Saver remembers);
  - the **Carts** tab (saved copies).

  In English the tabs are called "Cart" and "Carts".
- **A second button with almost the same name.** The panel also has
  **"Save current cart"** (only when saving automatically is off).
  It does something quite different from "Save list": it reads in the cart,
  without a name.
- **Proposal:** the Carts tab will be called **"Lists"**, with the button
  "Save as list…". The button in the panel will be called **"Read the cart
  now"**.

### U3. Saved carts cannot be seen on Cardmarket itself (medium)

- Putting back a saved cart is only possible via the popup
  (`popup.js:609`); the panel never reads them.
- If your list is empty (just imported, or cleaned up), the
  cart page shows nothing at all.
- **Proposal:** "Saved lists (N)" with "Put in cart" in the panel.

### U4. Throwing away without "Undo" (medium)

- **No undo:** deleting a saved cart (×) and removing a star
  happen immediately. When you remove an article, undo is possible.
- **Silently thrown away:** the 31st saved cart silently throws away the
  oldest (`store.js:29, 544`).
- **"Delete everything"** also deletes all saved carts, but the question
  only mentions "articles and favourites" (T4).

### U5. Choosing what to put back: only in the panel (medium)

- **Now:** in the panel you have checkboxes per card, "all/none" and
  game buttons. In the popup only game buttons and "Only this one back".
- **Consequence:** putting back five of the seven cards from the popup means
  five separate jobs, and the second is refused while the first is running.
- **Proposal:** the same checkboxes in the popup.

### U6. After putting back, the handy things are only in the panel (medium)

- **Only on Cardmarket:** "Undo", the list of what failed, the
  card it is working on and "Find a replacement". The popup only shows
  counts and "Close".
- **Consequence:** the README promises "Changed your mind? Undo", but anyone
  working from the popup does not see that button.
- **Proposal:** "Undo" in the popup too, via a message to the
  Cardmarket tab; putting back already works that way now.

### U7. The popup knows nothing about another account, the countdown and the shipping costs (low)

- Those are only in the panel; `popup.js` does not read `meta` anywhere.
- If you are logged in with another account, the popup starts a job that
  only fails after reading the cart, and then B2 goes wrong.

### U8. Favourites do not hang together (low)

- **One by one:** each favourite goes into the cart separately, as its own job.
  There is no "put these 10 in my cart".
- **Not as a list:** you cannot save favourites as a list.
- **Cut off:** you cannot expand the rows, so language and stock fall
  off ("CardKingdomNL · 3 avail…").

### U9. The same things built twice, and grown apart (low)

Popup and panel each have their own version of stopping, detecting
"interrupted", seller groups and row actions. As a result:

- the same stuck job is called "Busy…" in the popup and
  "Interrupted" on the page;
- missing cards have a ☆ and "Find a similar offer" in the popup, but
  not in the panel;
- sold cards have "Try again anyway" in the popup and
  "Find a replacement" in the panel.

**Proposal:** move the shared pieces to `ui.js`/`refill.js`, so both
do the same thing.

---

## 5. Tests: what is missing

The tests are extensive (71), but on a few points the mock Cardmarket is
kinder than the real one. That is why P1, P2, S1 and S3 were never noticed.

- **Image server:** only with a Cardmarket Referer, without CORS, just like the
  real one (P5).
- **Seller pages** with `stockRow` rows, and per product type (S1, S2).
- **Product page with carousel** and `idProduct` (S3).
- **A site in German or French** for language names (S4).
- **Notifications from start to finish** (a hidden tab reads the cart →
  notification → click), the alarms after a restart, and "check now and then"
  via the real alarm.
- **Another account during a job** (B2), a click on "Purchases" (B1),
  storage full (B27) and concurrent writes (B6).
- **The update script itself** (not tested at all now).

---

## 6. Proposal for 1.6

In this order: first what you see most and what carries the least risk,
then what you can lose, then the structure.

| Step | What | Findings | Size |
|---|---|---|---|
| 1. Images and the real site | Images in the popup (Chrome rule + permission), thumbnails in the background under their own key, the right image and `productId` on product pages, sealed not cropped. Seller pages (`stockRow`): stars and "Same seller". Searching per product type. Language names in five site languages. Tests as strict as the real site. | P1–P6, S1–S4, B10 | medium |
| 2. Never lose anything again | Click detection only on real remove and checkout buttons. Another account: write nothing. A safe update script: refuse a development folder, check before putting files in place, and a separate release branch so that not every push goes live immediately. Report full storage. Try/catch per part. "Undo" only gone once it has succeeded. | B1, B2, B13, B25–B28, U4, T4 | medium |
| 3. Carts that make sense (your example) | "Save as list…" in Cart and in the panel; a "Lists" tab; lists visible in the panel and possible to put back from there; expand, rename, update. | U1–U3 | medium |
| 4. Calm and numbers that add up | Panel no longer jumps; counts in copies; messages as a strip instead of whole screens; "article(s)" and real plurals; Dutch reasons instead of Cardmarket's English. | B12, B14, B15, B20–B23, T1–T3, T5 | medium |
| 5. Popup and panel the same | Checkboxes in the popup, "Undo" in the popup, another account and countdown in the popup, favourites into the cart in one go, shared code. | U5–U9, B17–B19 | large |
| Later | Shipping costs per offer for replacements, trend from the product page, price guide optional and more economical, more reliable "cart emptied" notification, warning about abuse in the README. Maybe: exporting a list to a Cardmarket wants list. | S5, S6, B29–B32, B38 | — |

---

## Appendix: what was not tested

- **Buying and checking out:** deliberately not; nothing was bought and nothing
  in the cart was changed.
- **The "your cart will be emptied at …" message:** not seen. When
  Cardmarket shows it, we do not know (S9).
- **Whether Cardmarket's token really expires after hours** (B3): cannot be
  tested without real refill requests.
- **The update script on a Mac:** only read, not run.
- **Chrome's permission prompt on an install from the Web Store:** for
  an unpacked extension there is no prompt. With the Web Store, Chrome asks
  once, at the update, for permission for the image server.

# Analysis: how can the cart saver get even better?

Status: version 1.0.3, which works on the live site. This analysis combines two
things:

- **Source research** into how Cardmarket's shopping cart works: the old
  Cardmarket API, the source code of other Cardmarket tools, help pages and
  forums.
- **A critical code review** of our own cart saver logic.

Labels:
- **[Official]** = a Cardmarket page or real saved HTML;
- **[Code]** = open-source code of other tools;
- **[Third party]** = a forum or another extension;
- **[Inferred]** = our own estimate.

---

## 1. Summary

**The five most important improvements:**

1. **Do not show "missing" after checkout.**
   - Right now, bought cards are marked as missing until you have opened the
     order page. One click then puts them back.
   - This is the biggest pitfall (§3, B2).
2. **Do not trust a partly read cart.**
   - Compare the number of rows read with the counter in the header.
   - Otherwise articles can wrongly count as missing (B4).
3. **Smarter putting back:**
   - per seller in one request (*batch*);
   - the right quantity (so recognising "1 of the 2");
   - only mark articles that were really sold as *unavailable* (B5,
     B6, V1).
4. **Show _why_ something left the cart.** Possible reasons:
   expired, seller gone or on vacation, sold, or the price changed.
   Also warn when the price or the quantity changed (V2, V3).
5. **Replacements for sold articles.**
   - First at the same seller, then the cheapest equivalent
     offer.
   - Sellers already in your cart get priority, because that saves
     shipping costs (V4).

**Already fixed in 1.0.3:** a slow add request could be sent a second time
through a second route, which put an article in the cart twice.

## 2. What we now know about the Cardmarket cart

| Fact | Source |
|---|---|
| Articles in a cart are **reserved**. Other buyers no longer see them among the offers, and sellers can look up which of their articles are in someone's cart. | **[Code]**: old API, `GET /stock/shoppingcart-articles` (mkmsdk) and the field `inShoppingCart` (MKMTool). **[Third party]**: mtg-forum.de 2021 ("verschwinden die Karten aus der Liste der Angebote", *the cards disappear from the list of offers*) |
| The cart consists of **one reservation per seller**: `idReservation`, seller, articles, value, shipping method. There is no field with an expiry date. | **[Code]**: nicho92/mkm-api-java `ShoppingCart.java` |
| Cardmarket shows a **time at which the cart will be emptied** ("oben wird mir eine Uhrzeit angezeigt…", *at the top I am shown a time…*). There is no known selector for that notice. | **[Third party]**: mtg-forum.de 2021 |
| After **~1 hour** the cart can be emptied. After 1–2 hours without activity the seller may take articles out of it. | **[Third party]**: mtg-forum.de 2015/2022/2024 |
| When a seller goes **on vacation**, carts that have existed for an hour or longer are emptied, and their offers are no longer for sale. | **[Third party]**: mtg-forum.de 2024. **[Official]**: help page vacation-status |
| Cardmarket logs you out roughly **every 20 minutes**. That is why Enhanced Cardmarket has "Remember Login". | **[Third party]**: Enhanced Cardmarket |
| Adding **several articles in one request** is possible: `idArticle={id:id,…}` and `amount={id:n,…}`. What happens when one article in such a batch no longer exists is unknown. | **[Code]**: cardmarket_wizard `shopping_cart_service.dart`, the old API `PUT /shoppingcart` |
| **Removing** goes through `ShoppingCart_RemoveArticle` with `idArticle`, `idSeller` and `amount-<id>`. That makes "undo" possible. | **[Code]**: Lugin `cart.ts` |
| **Tracked shipping** is required above €25 per shipment, and sometimes already above €10. Shipping rates can be requested via `help.cardmarket.com/api/shippingCosts`. | **[Official]**: ShippingCosts. **[Code]**: Lugin `shipping.ts` |
| A **public price guide** is updated daily (`price_guide_{game}.json`). | **[Code]**: cm-scripts, Cardmarket Helper |
| The Shopping Wizard has a limit of 10 times per day. "All in cart" requires 6 completed purchases. Offer pages show at most 300 offers. | **[Official]**: help ShoppingWizard. Saved HTML |

## 3. Weak spots in the current cart saver (code review)

| # | Problem | Severity | Solution |
|---|---|---|---|
| B1 | ~~A POST could be sent twice after a lost response~~ | high | **Fixed in 1.0.3:** a write request never goes through a second route. |
| B2 | **Fixed in 1.0.4:** the checkout button or the checkout form marks that seller's articles, and whatever disappears after that is forgotten.<br>~~After **checkout**, everything you bought shows as *missing*. The reminder offers to put it back, and the icon counts it. Only opening each order page clears it up.~~ | high | Detect checkout through the page bridge (the site's checkout request), or read the `/Orders/Purchases` page after a large drop. If everything disappears at once, use a separate status "bought?", without a reminder. |
| B3 | **Fixed in 1.1.0:** the refill action holds a Web Lock while it runs; the lock disappears with the tab. Every step checks whether this tab is still the owner, and the time-out is 2 minutes.<br>~~Two tabs can run the same refill action. The lock is not hard. In a background tab, Chrome also slows down the heartbeat, so the action seems "dead" after 30 s while it is still running.~~ | high (rare) | Let the service worker manage the lock, and use a connection (`runtime.connect`) to track whether the tab is still alive. Check at every step whether this tab is still the owner. Raise the time-out to 2 minutes. |
| B4 | **Fixed in 1.1.0:** a seller block without readable rows, or with fewer articles than the header counts, makes the cart unreliable.<br>~~A partly read cart counts as reliable as soon as one row has been read. Rows that were not read are then marked as *missing*, and the check beforehand would add them again.~~ | medium-high | Compare the number of rows (sum of `data-amount`) with the counter in the header. If they do not match, do not trust it. |
| B5 | **Fixed in 1.1.0:** refusals are classified (sold, too few, unknown). Every unknown refusal gets a fresh token (max. 3 per action). Only "sold" or the second unknown refusal in a row gives *unavailable*. Generic token locations (`data-token`, `csrf-token`) now only count with a hex value.<br>~~Every refusal becomes *unavailable*. The token is refreshed only once, and only before the first success. If the token expires halfway, the rest is wrongly written off.~~ | medium | Refresh the token on every generic refusal. Only mark as *unavailable* on a known "sold" message; otherwise it stays *missing*, with the reason added. Only look for hex tokens. |
| B6 | **Fixed in 1.1.0:** the desired quantity is stored separately, with the status *partly in cart*. Only the difference goes back; on "too few", it tries again with 1. Lowering it yourself becomes the new desired quantity.<br>~~Quantities are not reconciled. Saved 2 and now 1 in the cart silently gives "1, in cart". Putting back 2 while the seller only has 1 left is refused, and the article is then called *unavailable*.~~ | medium | Store the desired quantity and the quantity in the cart separately. Add a status *partial*. Put back the difference. On a refusal: try again with 1 or with the available quantity. |
| B7 | **Fixed in 1.0.4:** detection through the site's own remove request (`ShoppingCart_RemoveArticle` and other remove actions), through forms and through stricter button detection.<br>~~**Detecting removals** relies on a click heuristic. "Remove everything from seller" and "empty cart" are missed, and a click on a card such as "Remove Soul" wrongly counts as removing. | medium | Catch the site's own `ShoppingCart_Remove*` requests through the page bridge. Keep removed articles for a short while, so you can put them back. |
| B8 | **Fixed in 1.1.0:** cleanup in a `finally`, a warning when you leave the page, and *Continue (N to go)* after a closed tab.<br>~~An aborted action (tab closed or navigated away) disappears without notice. An error after the main loop can leave the lock hanging.~~ | medium | Clean up in a `finally`. Warn when leaving the page. Offer "Continue (N to go)"; that is safe because the check beforehand runs again. |
| B9 | **Fixed in 1.3.0:** the panel and the popup do not redraw on a heartbeat alone, and articles that have been *unavailable* for a month are cleaned up.<br>~~Storage and speed. Everything is in one storage key. Writes are frequent (heartbeat every 5 s), and on every change the panel reads everything again and redraws everything. Nothing is ever cleaned up.~~ | medium | Read only the changed values. Skip drawing on a heartbeat alone. Reuse the icons. Do not write if nothing changed. Automatically archive articles that have been *unavailable* or *missing* for a long time. |
| B10 | **Fixed in 1.3.0:** after 15 minutes the cart is read again, even with the same counter, by one tab at a time (`navigator.locks`).<br>~~Noticed late, and peaks with many tabs. A sold card that is replaced by a new one at the same time gives the same counter and is missed. If you restore a session with many tabs, every tab fetches the cart at the same time.~~ | medium-low | Also sync when the last sync was more than 15 minutes ago. Let one tab sync (`navigator.locks`). Process the site's own additions immediately. |
| B11 | **Fixed in 1.1.0:** favourites that were not tried or did not succeed are cleaned up at the end.<br>~~Favourites that were never added can stay behind as a saved article (on an error or a stop).~~ | low | At the end of every action, clean up the favourites that were not tried. |
| B12 | **Fixed in 1.1.0:** an action from the popup only starts in a visible, logged-in tab; on the login page it stops with a message.<br>~~An action started from the popup can be picked up by any tab, including a tab with a security check page.~~ | low | Remember the target tab. Only resume on a logged-in page without a security check. |
| B13 | **Fixed in 1.1.0:** the username from the account menu is stored. With another account, nothing is saved or marked as missing, until you choose that account.<br>~~No separation per account. If you switch Cardmarket accounts, everything seems to be missing.~~ | low | Store the username with the articles and pause if it does not match. |
| B14 | **Fixed in 1.3.0:** a private `MessageChannel`; the bridge catches the hello first and stops it, and `__cmcsBridge` is gone.<br>~~Bridge. Another script on the page could send a forged response. The site can recognise the extension by `__cmcsBridge`.~~ | low | A private `MessageChannel` between the content script and the bridge. |
| B15 | **Fixed in 1.1.0:** the summary counts after the check, the details are language-neutral (English), links in an import are checked and the "busy" message is no longer an `alert()`.<br>~~Small things: the summary counts before the check afterwards; the word "gezocht" (*searched*) is hard-coded in Dutch in the details; an invalid `productUrl` in an import can break the display; the "busy" message uses `alert()`.~~ | low | Small fixes. |

## 4. Improvements (functional)

| # | Improvement | Why / source | How | Effort |
|---|---|---|---|---|
| V1 | **Done in 1.2.0.** **Putting back in batches** | The endpoint accepts lists **[Code]** | One request per seller. Then read the cart; whatever did not arrive is tried again one by one. With 40 sellers that is 40 requests instead of 200. | S–M |
| V2 | **Done in 1.1.0** (reason per article in the popup and the panel). **Reason why something left the cart** | Expired, seller gone or on vacation, sold **[Third party]**/**[Official]** | Compare snapshots: if everything is gone, it expired or you were logged out. If one seller is gone, that seller removed it or is on vacation. If one row is gone, it was sold or removed. Put the reason in the list. | S–M |
| V3 | **Done in 1.1.0:** a price change and "1 of the 2" are shown. **Price or quantity changed** | The check afterwards already reads `data-price` and `data-amount` | "+€0,30 since you saved it", "only 1 of the 2 left" | S |
| V4 | **Done in 1.2.0** (in the panel on Cardmarket). **Replacements for sold articles** | Regroupeur, CardmarketUtilities **[Code]** | 1) Search at the same seller (`/Users/{seller}/Offers/Singles?name=…&sortBy=price_asc`), up to +25%. 2) The cheapest equivalent offer, filtered on language, condition and foil. Sellers in your cart get priority, because that costs €0 extra shipping. Always after a click, at a calm pace. | M–L |
| V5 | **Done in 1.3.0** (text on the live site still to be confirmed). **Countdown until the cart is emptied, plus a notification** | The time notice exists **[Third party]** | Read the time from the notice on the cart page. Send a notification 5 minutes before via `chrome.alarms` (requires the `notifications` permission). This costs no extra requests. First record the selector on the live site. | S |
| V6 | **Done in 1.3.0** (reading shipping costs on the live site still to be confirmed). **Shipping panel per seller** | €25 rule **[Official]**, Lugin `shipping.ts` **[Code]** | Per seller: estimated shipping costs, the share of shipping, "€x to go until tracked", and how much more fits in the letter. | M |
| V7 | **Done in 1.2.0:** undoing a refill and a removal, named carts, export as text or CSV. **Snapshots, undo and export** | Lugin remove endpoint **[Code]** | Automatically save a snapshot before every action. "Undo" removes what was just added. Carts get a name ("Commander deck"). Export as text or CSV. | S–M |
| V8 | **Done in 1.3.0** (configurable, off by default). **Price versus trend before putting back** | Public price guide **[Code]** | Fetch it once a day and keep only the products you have saved. Warn about a sizeable surcharge. | M |
| V9 | **Fall back to the wants list** | Wants endpoints, "Sellers with most wants" **[Code]** | "Put the unavailable articles on a wants list", after confirmation, because this changes your account. Then rank the sellers that have most of them. | M–L |
| V10 | **Done in 1.3.0** (configurable, off by default). **Checking politely while you are away** | The lower limit for alarms is 30 s. Cardmarket complains about server load **[Official]** | Off by default. Only when a Cardmarket tab is open and you are active, at most every 10 minutes. No keep-alive. | S |

**Deliberately not:** keeping the cart "warm" with keep-alive requests. That
parking of articles is exactly what Cardmarket fought with the inactivity rule, and it
puts other buyers at a disadvantage.

## 5. Proposed order

| Version | Content | Why first |
|---|---|---|
| **1.1 — Reliable** | B2 detect checkout, B4 cart count, B5 refusals and token, B6 quantities, B7 removals through the bridge, B8 resuming and cleaning up, B3 lock | Prevents wrong statuses and putting back what should not go back. Needs little visible UI. |
| **1.2 — Smart putting back** | V1 batches, V2 reason, V3 price or quantity changed, V4 replacement, V7 snapshots and undo | The core of the cart saver becomes faster and smarter. |
| **1.3 — Insight** | V5 countdown and notification, V6 shipping panel, V8 price versus trend, B9 speed and cleanup | Comfort and saving money. Partly needs new permissions. |
| **Later** | V9 wants list, V10 checking while you are away, B13 accounts, B14 bridge via `MessageChannel` | Bigger, or only useful for some users. |

## 6. Sources

- **Code** (examined locally):
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): `cart.ts`,
    `cartStore.ts`, `shipping.ts`, `shoppingWizard.ts`, `wants.ts`,
    `CartConsolidation.tsx`;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    `cart.js`, `cm.js`, `fetcher.js`, `optimizer.js`;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard):
    `shopping_cart_service.dart`.
- **Clients for the old API:**
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
- **Forum:** [mtg-forum.de, MKM topic](https://www.mtg-forum.de/topic/116960-mkm-magickartenmarkt-cardmarket/page-919).
- **Other:**
  - [Enhanced Cardmarket](https://enhanced-cardmarket.mave.me/);
  - [MDN alarms.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/alarms/create).

> The Cardmarket sites and the forum could not be opened directly from the
> research environment. Official texts and forum posts come from
> search results. The code of other tools was read directly.

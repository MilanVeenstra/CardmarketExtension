# Research: Chrome extensions × Cardmarket

This document summarises the preliminary research Cart Saver is built on: how
Chrome extensions work with websites, how Cardmarket works, and how the two
together make a "save the cart and put it back" extension.

> **Note:** cardmarket.com could not be reached from the environment in which this
> research was done. The Cardmarket details below come from saved real
> Cardmarket HTML and from the source code of existing open-source Cardmarket tools
> (see [Sources](#sources)). They are reliable, but Cardmarket can change the site
> at any moment. The extension is therefore built defensively (see
> [Safety nets](#safety-nets)).

---

## 1. How Chrome extensions work with websites (Manifest V3)

| Part | What it can do | Use in Cart Saver |
|---|---|---|
| **Content script** | Runs *inside* the web page. Can read and change the DOM, but lives in an "isolated world": it does not see the site's JavaScript variables. | Reads the cart, sends the add requests and shows the panel on the site. |
| **Background service worker** | Runs separately from pages. Has no DOM and is stopped after ~30 s of inactivity. | Only the badge number on the icon. |
| **Popup** | The small window under the icon. Disappears as soon as you close it. | Overview of all saved articles. |
| **Options page** | Settings page. | Settings and export/import. |
| **`chrome.storage.local`** | Local storage of ~10 MB, available in all parts. `onChanged` reports changes everywhere. | Saved articles, progress of a refill and settings. |

Key insights:

- **Content scripts make same-origin requests.** Since Chrome 85, a
  `fetch()` from a content script behaves like a request from the page itself.
  From `www.cardmarket.com` the user's session cookies are simply sent along,
  just as with the site's own buttons. No login details need to be
  stored.
  ([Chromium](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/))
- **The service worker is less suited for authenticated POSTs.** A
  request from the service worker comes from `chrome-extension://…` and is therefore
  cross-origin. Cookies (SameSite) and the CSRF/Origin checks then become
  unreliable. That is why all Cardmarket traffic runs in the content script.
- **`DOMParser` works in content scripts.** A fetched HTML page, such as
  the cart, can be parsed without the scripts in it running.
- **The popup is short-lived**, so a refill that takes several minutes must not
  run there. It runs in the content script of a Cardmarket tab and
  writes its progress to `chrome.storage`. Popup and panel follow it
  live.
- **Minimal permissions:**
  - `storage`;
  - host permission for `https://www.cardmarket.com/*`, needed to read the URL of the
    active tab and to open or update a Cardmarket tab.

Documentation:
[content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
[network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests),
[service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle),
[messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging),
[storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

## 2. How Cardmarket works

### URL structure

- `https://www.cardmarket.com/{language}/{game}/…`:
  - language: `en`, `de`, `fr`, `es` or `it` (there is no `nl`);
  - game: `Magic`, `Pokemon`, `YuGiOh`, `OnePiece`, `Lorcana`, `FleshAndBlood`, …
- Cart: `/{language}/{game}/ShoppingCart`.
- Product page: `/{language}/{game}/Products/Singles/{Expansion}/{Card}`. Filters
  go through the query: `?language=1&minCondition=2&isFoil=Y`.

### Article

An *article* (`idArticle`) is one offer from one seller. It contains:

- a product;
- a condition: `1` MT, `2` NM, `3` EX, `4` GD, `5` LP, `6` PL, `7` PO;
- a language: `1` English, `2` French, `3` German, …;
- foil yes/no;
- a price and an amount.

The cart contains articles, not products. When that one offer is
sold, exactly that article is gone. There may still be a similar
offer.

### Cart page (DOM)

```html
<div id="shipments-col">
  <section class="shipment-block">                    <!-- one block per seller -->
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

- Some rows are rendered twice (desktop and mobile), so deduplicating
  on `data-article-id` is needed.
- The header of every page shows the number of articles in the cart in
  `#cart .main-nav-badge` and the total amount in `#cart .text-success`.

### Adding to the cart

An AJAX POST, the way the site does it itself:

```
POST /{language}/{game}/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers
Content-Type: application/x-www-form-urlencoded
X-Requested-With: XMLHttpRequest

__cmtkn=<csrf-token>&idArticle={"<id>":"<id>"}&amount={"<id>":"<amount>"}
```

- A variant with the same fields is `ShoppingCart_Add_AddArticlesFromProductPage`.
- `__cmtkn` is a CSRF token per session. It is on almost every logged-in
  page in `input[name="__cmtkn"]`.
- The response is XML in which every field is base64-encoded:
  ```xml
  <ajaxResponse><resultType>c3VjY2Vzcw==</resultType>   <!-- "success" -->
                <resultsCode>Z2VuZXJhbE9L</resultsCode>  <!-- "generalOK" -->
                <systemMessage>…base64 HTML message…</systemMessage></ajaxResponse>
  ```
- So you can **add directly by article ID**, without visiting the product page.
  If the article no longer exists, the result is a refusal with a
  message.

### When is the cart emptied?

No official documentation was found. Users report the following:

- a notice that the cart "will be emptied automatically at HH:MM";
- emptying after about an hour or after inactivity;
- emptying when a seller goes on holiday;
- sellers removing articles from carts.

Articles in a cart are temporarily reserved, but after that freely
available again. That is exactly why saving and putting them back later is useful.

### Official API

The Cardmarket API currently does not accept new applications, and existing
users may not give their keys to third-party apps. So the API is
not an option for this extension.

### Anti-bot and fair use

- Cardmarket sits behind Cloudflare. Too much traffic leads to `HTTP 429` (with
  `Retry-After`) or a "Just a moment…" check page.
- A normal page also loads `/cdn-cgi/challenge-platform`. Only the real
  features of the check page count.
- The terms warn that third-party tools are used at your own risk.

## 3. The combination: design of Cart Saver

```
 cardmarket.com tab (content script)                popup / options
 ┌───────────────────────────────────────┐          ┌──────────────────────┐
 │ main.js   read cart / header counter  │          │ list, filters,       │
 │ refill.js put articles back (POST)    │◄─────────┤ "Put … back" button  │
 │ widget.js panel on the site           │ message  └──────────┬───────────┘
 └──────────────┬────────────────────────┘                     │
                │  chrome.storage.local  (items, job, meta, settings)
                └──────────────────────┬───────────────────────┘
                                       │
                            service worker: badge number
```

1. **Saving automatically.** The cart is read and every article is saved
   with all its details (seller, condition, language, foil, price, amount,
   product URL, image). That happens:
   - on every visit to the cart page;
   - on every other page as soon as the number in the header changes, also when you
     add something with the site's own button.
2. **Detecting an empty cart.**
   - Saved articles are never removed automatically when they disappear from the
     cart. They get the status *missing*.
   - A notice then appears on Cardmarket and the extension icon shows the
     number.
   - Articles you remove yourself with the bin icon are forgotten.
3. **Putting back.**
   - First the current cart is checked. Whatever is already in it is
     skipped, so amounts never double.
   - Then one POST follows per article, with a pause in between (default
     1.2 s + randomness).
   - Finally it checks again what is really in the cart.
   - Articles that Cardmarket refuses are marked as *no longer
     available*, with Cardmarket's reason and a link to similar
     offers (same language, at least the same condition, same foil).
4. **Favourites.**
   - Every offer row (`div.article-row#articleRow<id>`) gets a ☆, just
     like every row in the cart. You find those rows on product pages,
     card pages and seller pages (`/Users/<name>/Offers/Singles`).
   - A favourite keeps that one article: seller, condition, language, foil,
     price and stock.
   - To find it again, the popup links to the product page, filtered on
     language and condition, with `#articleRow<id>`. The content script scrolls to
     that row and highlights it.
   - If the row is not there, a notice follows with links to the seller's
     stock (`?name=<card>`) and to similar offers.
   - "Put in cart" uses the same put-back mechanism, with
     1 copy.
5. **Bought = done.** Articles that appear on an order page (`/Orders/…`)
   are taken off the list.

### Safety nets

- Something is only done when the page provably belongs to a *logged-in*
  user. A login page has no cart rows and would otherwise make everything
  look "missing".
- In the following cases an empty result is not believed:
  - zero rows while the header still shows articles or an amount;
  - there are seller blocks on the page.

  Then nothing is marked as missing and putting back refuses to start.
- Putting back stops at once at a Cloudflare check, on logout or
  at a second 429. At a 429 it first waits as long as `Retry-After` says.
- At most one refill runs at a time, across all tabs (lock with
  heartbeat in `chrome.storage`).
- Everything happens only after a click by the user, at a normal human
  pace.

## Sources

- Chrome documentation (see the links in §1).
- Open-source Cardmarket tools whose selectors and endpoints were
  verified:
  - [Tsuina311/Lugin](https://github.com/Tsuina311/Lugin): MV3 extension with the
    add and remove endpoint, `__cmtkn` and Cloudflare detection;
  - [michasng/cardmarket_wizard](https://github.com/michasng/cardmarket_wizard):
    batch adding and 429 handling;
  - [Lioxyze/Cardmarket-Regroupeur](https://github.com/Lioxyze/Cardmarket-Regroupeur):
    parsing of cart and offers;
  - mfiferna/cm-scripts, DavidSdot/CardmarketUtilities,
    SiposLevente/cardmarket-magic-cart-price-checker: userscripts for the
    cart;
  - batuzyn/cardmarket-api and Mathogrammer/cardmarket2collection-extension:
    real saved Cardmarket HTML.
- [Cardmarket API page](https://help.cardmarket.com/en/cardmarket-api): no
  new applications.

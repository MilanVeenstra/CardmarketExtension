/*
 * A tiny fake www.cardmarket.com for end-to-end tests.
 *
 * The markup mirrors real Cardmarket HTML (cart rows copied from saved
 * Cardmarket pages): `section.shipment-block` per seller, `tr[data-article-id]`
 * rows with data-* attributes, `#cart .main-nav-badge` in the header, a
 * `__cmtkn` token input, and the AjaxAction add endpoint answering with a
 * base64 <ajaxResponse> envelope.
 */

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/**
 * Cardmarket's obfuscated AJAX `args`: XOR("action***token") with a counter
 * starting at `seed`, percent-encoded bytes, then "***" + base64(JSON).
 */
export function obfuscatedArgs(action, token, json = '{}', seed = 0x63) {
  const plain = `${action}***${token}`;
  let encoded = '';
  for (let i = 0; i < plain.length; i += 1) {
    const code = (plain.charCodeAt(i) ^ ((seed + i) & 0xff)) & 0xff;
    const ch = String.fromCharCode(code);
    encoded += /[A-Za-z0-9\-._~]/.test(ch) ? ch : `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return `${encoded}%2A%2A%2A${encodeURIComponent(b64(json))}`;
}
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const ARTICLES = [
  {
    articleId: '1581671598',
    productId: '361919',
    game: 'Magic',
    name: 'Bojuka Bog',
    expansion: 'Commander 2018',
    expansionSlug: 'Commander-2018',
    cardSlug: 'Bojuka-Bog',
    number: '238',
    rarity: 'Common',
    condition: 2,
    conditionLabel: 'NM',
    conditionTitle: 'Near Mint',
    language: 1,
    languageLabel: 'English',
    price: 0.99,
    seller: 'snowc',
    sellerId: '1001',
    foil: false,
  },
  {
    articleId: '1581680510',
    productId: '723729',
    game: 'Magic',
    name: 'Portal Mage',
    expansion: 'Commander Masters',
    expansionSlug: 'Commander-Masters',
    cardSlug: 'Portal-Mage',
    number: '112',
    rarity: 'Uncommon',
    condition: 3,
    conditionLabel: 'EX',
    conditionTitle: 'Excellent',
    language: 3,
    languageLabel: 'German',
    price: 0.25,
    seller: 'snowc',
    sellerId: '1001',
    foil: true,
  },
  {
    articleId: '1602233445',
    productId: '13852',
    game: 'Magic',
    name: 'Ephemerate',
    expansion: 'Modern Horizons',
    expansionSlug: 'Modern-Horizons',
    cardSlug: 'Ephemerate',
    number: '7',
    rarity: 'Common',
    condition: 2,
    conditionLabel: 'NM',
    conditionTitle: 'Near Mint',
    language: 1,
    languageLabel: 'English',
    price: 3.55,
    seller: 'Kärtchen-Laden',
    sellerId: '2002',
    foil: false,
  },
  {
    articleId: '1611110000',
    productId: '500100',
    game: 'Magic',
    name: 'Sol Ring',
    expansion: 'Commander Masters',
    expansionSlug: 'Commander-Masters',
    cardSlug: 'Sol-Ring',
    number: '410',
    rarity: 'Uncommon',
    condition: 2,
    conditionLabel: 'NM',
    conditionTitle: 'Near Mint',
    language: 1,
    languageLabel: 'English',
    price: 1.49,
    seller: 'Kärtchen-Laden',
    sellerId: '2002',
    foil: false,
  },
  // Two more offers of the same Sol Ring, to star as favourites.
  {
    articleId: '1611110001',
    productId: '500100',
    game: 'Magic',
    name: 'Sol Ring',
    expansion: 'Commander Masters',
    expansionSlug: 'Commander-Masters',
    cardSlug: 'Sol-Ring',
    number: '410',
    rarity: 'Uncommon',
    condition: 3,
    conditionLabel: 'EX',
    conditionTitle: 'Excellent',
    language: 3,
    languageLabel: 'German',
    price: 1.1,
    available: 3,
    seller: 'CardKingdomNL',
    sellerId: '3003',
    foil: false,
  },
  {
    articleId: '1611110002',
    productId: '500100',
    game: 'Magic',
    name: 'Sol Ring',
    expansion: 'Commander Masters',
    expansionSlug: 'Commander-Masters',
    cardSlug: 'Sol-Ring',
    number: '410',
    rarity: 'Uncommon',
    condition: 1,
    conditionLabel: 'MT',
    conditionTitle: 'Mint',
    language: 1,
    languageLabel: 'English',
    price: 2.5,
    available: 1,
    seller: 'MintCondition',
    sellerId: '4004',
    foil: true,
  },
  // A Pokémon card from the same seller as the Bog: one parcel, two games.
  {
    articleId: '1622220000',
    productId: '273722',
    game: 'Pokemon',
    name: 'Pikachu',
    expansion: 'Base Set',
    expansionSlug: 'Base-Set',
    cardSlug: 'Pikachu-BS58',
    number: '58',
    rarity: 'Common',
    condition: 2,
    conditionLabel: 'NM',
    conditionTitle: 'Near Mint',
    language: 1,
    languageLabel: 'English',
    price: 3.5,
    seller: 'snowc',
    sellerId: '1001',
    foil: false,
  },
  // Offers that only exist once a test lists them (state.available): candidates
  // to replace a sold Sol Ring — the same seller, a seller already in the cart,
  // and a cheaper stranger.
  ...[
    ['1611110003', 'Kärtchen-Laden', '2002', 1.59],
    ['1611110004', 'snowc', '1001', 1.79],
    ['1611110005', 'BudgetCards', '5005', 1.29],
  ].map(([articleId, seller, sellerId, price]) => ({
    articleId,
    productId: '500100',
    game: 'Magic',
    name: 'Sol Ring',
    expansion: 'Commander Masters',
    expansionSlug: 'Commander-Masters',
    cardSlug: 'Sol-Ring',
    number: '410',
    rarity: 'Uncommon',
    condition: 2,
    conditionLabel: 'NM',
    conditionTitle: 'Near Mint',
    language: 1,
    languageLabel: 'English',
    price,
    available: 2,
    seller,
    sellerId,
    foil: false,
    extra: true,
  })),
];

export function createMockCardmarket() {
  const state = {
    token: '6f1c0b7e2d9a4c58b3e1f0a9d8c7b6a5e4f3d2c1b0a99887766554433221100',
    loggedIn: true,
    /** articleId → amount */
    cart: new Map(),
    /** articleId → article (offers that still exist) */
    available: new Map(ARTICLES.filter((a) => !a.extra).map((a) => [a.articleId, a])),
    /** which add endpoint exists (the other one 404s) */
    addEndpoint: 'ShoppingCart_Add_AddArticlesFromUserOffers',
    /** answer adds with a Cloudflare challenge */
    challenge: false,
    /** render cart rows in a shape the extension cannot read (layout change) */
    brokenRows: false,
    /** an outdated token printed on pages other than the cart page */
    stalePageToken: null,
    /** answer add-to-cart with an ordinary HTML page instead of <ajaxResponse> */
    weirdAdd: false,
    /**
     * Where pages carry the CSRF token: 'input' (hidden form field, default),
     * 'script' (inline JS only), 'wants' (only the wants page has a form),
     * 'xhr' (only inside the site's own obfuscated AJAX call), 'none'.
     */
    tokenMode: 'input',
    /** the logged-in account (its profile link sits in the account menu) */
    username: 'tester',
    /** articleId → copies the seller has; adding more is refused with "not enough" */
    stock: new Map(),
    /** refuse every add with a message that names no reason */
    genericRefusal: false,
    /** render the rows of this seller's block in a shape the extension cannot read */
    brokenSeller: null,
    /** a notice on the cart page, e.g. "Your shopping cart will be emptied at 14:35." */
    cartNotice: null,
    /** shipping cost shown in every seller block */
    shippingCost: 1.15,
    /**
     * How the trash button removes an article: 'plain' (ShoppingCart_RemoveArticle
     * with form fields), 'args' (everything inside an obfuscated `args` value,
     * posted to a bare /AjaxAction) or 'opaque' (a request the extension cannot
     * read, from a button without any telltale label).
     */
    removeStyle: 'plain',
    requests: [],
  };

  const article = (id) => ARTICLES.find((a) => a.articleId === id);
  const cartCount = () => [...state.cart.values()].reduce((n, a) => n + a, 0);
  const cartTotal = () =>
    [...state.cart.entries()].reduce((sum, [id, amount]) => sum + article(id).price * amount, 0);
  const euro = (n) => `${n.toFixed(2).replace('.', ',')} €`;

  function header(lang, game) {
    const count = cartCount();
    return `
      <header class="navbar">
        <a href="/${lang}/${game}" class="brand">Cardmarket</a>
        <a id="cart" href="/${lang}/${game}/ShoppingCart" class="nav-link">
          <span class="fonticon-cart"></span>
          ${count ? `<span class="badge text-bg-success main-nav-badge">${count}</span>` : ''}
          <span class="text-success">${euro(cartTotal())}</span>
        </a>
        ${
          state.loggedIn
            ? `<div id="account-dropdown"><a href="/${lang}/${game}/Account">${esc(state.username)}</a>
               <a href="/${lang}/${game}/Users/${encodeURIComponent(state.username)}">Profile</a>
               <a href="/${lang}/${game}/PostGetAction/User_Logout">Logout</a></div>`
            : `<form action="/${lang}/${game}/PostGetAction/User_Login" method="post">
               <input type="hidden" name="__cmtkn" value="${state.token}">
               <input name="username"><input name="userPassword" type="password"></form>`
        }
      </header>`;
  }

  function layout({ lang = 'en', game = 'Magic', title, body, isCart = false }) {
    const pageToken = !isCart && state.stalePageToken ? state.stalePageToken : state.token;
    return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)} | Cardmarket</title>
      <style>body{font-family:sans-serif;margin:0;background:#f4f4f4}header{display:flex;gap:16px;align-items:center;padding:12px 20px;background:#012169;color:#fff}header a{color:#fff}.main-nav-badge{background:#28a745;border-radius:8px;padding:0 6px;margin:0 4px}main{padding:20px}section.shipment-block{background:#fff;margin:0 0 16px;padding:12px}table{width:100%}td{padding:4px}</style>
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
</head>
      <body>${header(lang, game)}<main>${body}</main>
      ${state.loggedIn && state.tokenMode === 'input' ? `<form id="filter"><input type="hidden" name="__cmtkn" value="${pageToken}"></form>` : ''}
      ${state.loggedIn && state.tokenMode === 'script' ? `<script>window.cmConfig = {"locale":"${lang}","__cmtkn":"${state.token}"};</script>` : ''}
      ${
        state.loggedIn && state.tokenMode === 'xhr'
          ? `<script>(function () {
               var xhr = new XMLHttpRequest();
               xhr.open('POST', '/${lang}/${game}/AjaxAction/Notification_GetCount');
               xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
               xhr.send('args=${obfuscatedArgs('Notification_GetCount', state.token)}');
             })();</script>`
          : ''
      }
      </body></html>`;
  }

  function row(a, amount, lang, broken = state.brokenRows) {
    const productUrl = `https://www.cardmarket.com/${lang}/${a.game}/Products/Singles/${a.expansionSlug}/${a.cardSlug}?language=1,3&amp;minCondition=5`;
    const img = `&lt;img src=&quot;https://product-images.s3.cardmarket.com/1/X/${a.productId}/${a.productId}.jpg&quot; alt=&quot;${esc(a.name)}&quot;&gt;`;
    return `
      <tr ${broken ? 'data-art' : 'data-article-id'}="${a.articleId}" data-product-id="${a.productId}" data-amount="${amount}"
          data-name="${esc(a.name)}" data-expansion="1533852000" data-expansion-name="${esc(a.expansion)}"
          data-number="${a.number}" data-rarity="20" data-condition="${a.condition}" data-language="${a.language}"
          data-price="${a.price}" data-comment="">
        <td class="select min-size"><div class="form-check no-label"><input type="checkbox" class="form-check-input"></div></td>
        <td class="preview min-size"><span data-bs-toggle="tooltip" class="thumbnail-icon icon is-24x24 is-magic"
            aria-label="${img}" data-bs-original-title="${img}"><span class="fonticon-camera"></span></span></td>
        <td data-amount="${amount}" class="amount">${amount}<span class="small">x</span></td>
        <td class="name text-start"><a href="${productUrl}">${esc(a.name)}</a></td>
        <td class="info">
          <div class="text-start d-md-none"><a href="${productUrl}">${esc(a.name)}</a></div>
          <div class="row g-0">
            <div class="col-auto"><div class="expansion d-inline-flex">
              <span class="collector-num">#${a.number}</span>
              <a href="https://www.cardmarket.com/${lang}/${a.game}/Expansions/${a.expansionSlug}" class="expansion-symbol is-magic icon is-24x24"
                 aria-label="${esc(a.expansion)}" data-bs-original-title="${esc(a.expansion)}"><span></span></a>
              <span class="rarity-symbol icon is-24x24 is-magic" aria-label="${a.rarity}" data-bs-original-title="${a.rarity}"><span class="icon rarity-icon"></span></span>
            </div></div>
            <div class="col-auto"><a href="https://help.cardmarket.com/en/CardCondition" class="article-condition condition-${a.conditionLabel.toLowerCase()}"
               data-bs-original-title="${a.conditionTitle}"><span class="badge">${a.conditionLabel}</span></a></div>
            <div class="col-icon col-auto"><span class="icon is-24x24"><span onmouseover="showMsgBox(this,\`${a.languageLabel}\`)"
               data-original-title="${a.languageLabel}" class="icon" aria-label="${a.languageLabel}" data-bs-original-title="${a.languageLabel}"></span></span></div>
            <div class="col-icon col-auto"></div>
            <div class="col-extras col-auto"><span class="extras d-inline-block">${
              a.foil ? '<span class="icon is-24x24"><span class="icon" aria-label="Foil" data-bs-original-title="Foil"></span></span>' : ''
            }</span></div>
          </div>
        </td>
        <td class="text-end text-nowrap price pe-2">${euro(a.price)}</td>
        <td class="actions">${trashButton(a, amount)}</td>
      </tr>`;
  }

  function trashButton(a, amount) {
    if (state.removeStyle === 'args') {
      const args = obfuscatedArgs('ShoppingCart_RemoveArticle', state.token, JSON.stringify({ idArticle: a.articleId, idSeller: a.sellerId, amount }));
      return `<a href="#" class="btn btn-sm trash" role="button" onclick="return cmA('${args}')">✕</a>`;
    }
    if (state.removeStyle === 'opaque') {
      return `<a href="#" class="btn btn-sm trash" role="button" onclick="return cmOp('${a.articleId}', ${amount})">✕</a>`;
    }
    return `<a href="#" class="btn btn-sm btn-outline-danger trash" role="button"
            onclick="return cmRemove({ idArticle: '${a.articleId}', idSeller: ${a.sellerId}, amount: ${amount} })"><span class="fonticon-delete"></span>✕</a>`;
  }

  function cartPage(lang, game) {
    const bySeller = new Map();
    for (const [id, amount] of state.cart) {
      // One cart for all games, as on Cardmarket.
      const a = article(id);
      if (!bySeller.has(a.seller)) bySeller.set(a.seller, []);
      bySeller.get(a.seller).push([a, amount]);
    }
    const blocks = [...bySeller.entries()]
      .map(
        ([seller, rows], i) => `
        <section class="shipment-block" id="seller${900 + i}">
          <div class="card"><div class="card-body">
            <div class="seller-info"><span class="seller-name d-flex"><span title="Item location: Germany"></span>
              <a href="/${lang}/${game}/Users/${encodeURIComponent(seller)}">${esc(seller)}</a></span></div>
            <input type="hidden" name="idSeller" value="${rows[0][0].sellerId}">
            <button type="button" class="btn btn-link btn-sm remove-shipment" onclick="return cmRemoveSeller({ idSeller: ${rows[0][0].sellerId} })">
              <span class="fonticon-delete"></span> Remove all articles from this seller</button>
            <table class="table table-sm article-table mb-1 table-striped product-table"><tbody>
              ${rows.map(([a, amount]) => row(a, amount, lang, state.brokenRows || state.brokenSeller === seller)).join('')}
            </tbody></table>
            <!-- Cardmarket renders some rows a second time (mobile layout) -->
            <table class="table d-none mobile-table"><tbody>${row(rows[0][0], rows[0][1], lang, state.brokenRows || state.brokenSeller === seller)}</tbody></table>
            <div class="row g-0 shipment-summary"><div class="col">Shipping costs</div><div class="col-auto">${euro(state.shippingCost)}</div></div>
            <form method="post" action="/${lang}/${game}/PostGetAction/ShoppingCart_CheckoutShipment">
              <input type="hidden" name="idSeller" value="${rows[0][0].sellerId}">
              <button type="submit" class="btn btn-primary checkout">Commit to purchase</button>
            </form>
          </div></div>
        </section>`,
      )
      .join('');
    return layout({
      lang,
      game,
      title: 'Shopping Cart',
      isCart: true,
      body: `<h1>Shopping Cart</h1>${state.cartNotice ? `<div class="alert alert-info">${esc(state.cartNotice)}</div>` : ''}<div id="shipments-col">${blocks || '<p>Your shopping cart is empty.</p>'}</div>
        <script>
          function cmPost(action, body) {
            var xhr = new XMLHttpRequest();
            xhr.open('POST', '/${lang}/${game}/AjaxAction/' + action);
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
            xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
            xhr.onload = async function () {
              var html = await (await fetch(location.href)).text();
              var doc = new DOMParser().parseFromString(html, 'text/html');
              document.querySelector('#shipments-col').replaceWith(doc.querySelector('#shipments-col'));
              document.querySelector('#cart').replaceWith(doc.querySelector('#cart'));
            };
            xhr.send(body);
          }
          function cmToken() { var t = document.querySelector('input[name="__cmtkn"]'); return t ? t.value : ''; }
          function cmRemove(o) {
            cmPost('ShoppingCart_RemoveArticle', '__cmtkn=' + cmToken() + '&idArticle=' + o.idArticle + '&idSeller=' + o.idSeller + '&amount-' + o.idArticle + '=' + o.amount);
            return false;
          }
          function cmA(args) {
            cmPost('', 'args=' + args);
            return false;
          }
          function cmOp(ref, n) {
            cmPost('Cart_Update', 'ref=' + ref + '&n=' + n);
            return false;
          }
          function cmRemoveSeller(o) {
            cmPost('ShoppingCart_RemoveShipment', '__cmtkn=' + cmToken() + '&idSeller=' + o.idSeller);
            return false;
          }
        </script>`,
    });
  }

  /** An offer row as on product / card / seller-stock pages (`div.article-row`). */
  function offerRow(a, lang, { sellerPage = false } = {}) {
    const product = `/${lang}/${a.game}/Products/Singles/${a.expansionSlug}/${a.cardSlug}`;
    const sellerCell = sellerPage
      ? `<a href="${product}">${esc(a.name)}</a>`
      : `<span class="seller-info d-flex align-items-center"><span class="seller-name d-flex">
           <span title="1027&nbsp;Sales&nbsp;|&nbsp;3172&nbsp;Available items" class="badge sell-count">1K</span>
           <span title="Item location: Germany" class="icon d-flex"><span class="icon"></span></span>
           <span class="d-flex"><a href="/${lang}/${a.game}/Users/${encodeURIComponent(a.seller)}">${esc(a.seller)}</a></span>
         </span></span>`;
    return `
      <div id="articleRow${a.articleId}" class="row g-0 article-row">
        <div class="d-none col"></div>
        <div class="col-sellerProductInfo col"><div class="row g-0">
          <div class="col-seller col-12 col-lg-auto">${sellerCell}</div>
          <div class="col-product col-12 col-lg"><div class="row g-0"><div class="product-attributes col">
            <a href="/${lang}/${a.game}/Expansions/${a.expansionSlug}" title="${esc(a.expansion)}" class="expansion-symbol is-magic icon is-24x24"><span></span></a>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" title="${a.rarity}"><path d="M8 1c3.9 0 7 3.1 7 7s-3.1 7-7 7-7-3.1-7-7 3.1-7 7-7Z"/></svg>
            <a href="https://help.cardmarket.com/en/CardCondition" title="${a.conditionTitle}" class="article-condition condition-${a.conditionLabel.toLowerCase()} me-1"><span class="badge">${a.conditionLabel}</span></a>
            <span onmouseover="showMsgBox(this,\`${a.languageLabel}\`)" title="${a.languageLabel}" data-original-title="${a.languageLabel}" class="icon me-2"></span>
            ${a.foil ? '<span title="Foil" data-original-title="Foil" class="icon st_SpecialIcon me-1"></span>' : ''}
          </div></div></div>
        </div></div>
        <div class="col-offer col-auto">
          <div class="price-container d-none d-md-flex justify-content-end"><div class="d-flex flex-column"><div class="d-flex align-items-center justify-content-end">
            <span class="color-primary small text-end text-nowrap fw-bold">${euro(a.price)}</span></div></div></div>
          <div class="amount-container d-none d-md-flex justify-content-end me-3"><span class="item-count small text-end">${a.available || 1}</span></div>
          <div class="actions-container d-flex align-items-center justify-content-end col ps-2 pe-0">
            <button type="button" class="btn btn-sm btn-primary"><span class="fonticon-cart"></span></button></div>
        </div>
      </div>`;
  }

  function productPage(lang, game, expansionSlug, cardSlug) {
    const offers = ARTICLES.filter(
      (a) => a.game === game && a.expansionSlug === expansionSlug && a.cardSlug === cardSlug && state.available.has(a.articleId),
    );
    const first = ARTICLES.find((a) => a.cardSlug === cardSlug) || ARTICLES[0];
    return layout({
      lang,
      game,
      title: first.name,
      body: `
        <div class="page-title-container d-flex"><div class="flex-fill"><h1>${esc(first.name)}<span class="h4 text-muted fst-italic fw-normal">${esc(first.expansion)} - Singles</span></h1></div></div>
        <section id="image"><img src="https://product-images.s3.cardmarket.com/1/X/${first.productId}/${first.productId}.jpg" alt="${esc(first.name)}" width="146"></section>
        <!-- A button that behaves like the site's own: AJAX add, then the header badge is updated in place. -->
        <button id="site-add">Put Sol Ring (Kärtchen-Laden) in cart</button>
        <div class="table article-table table-striped"><div class="table-body">${offers.map((a) => offerRow(a, lang)).join('')}</div></div>
        <script>
          document.getElementById('site-add').addEventListener('click', async () => {
            const token = document.querySelector('input[name="__cmtkn"]').value;
            const body = new URLSearchParams({ __cmtkn: token, idArticle: '{"1611110000":"1611110000"}', amount: '{"1611110000":"1"}' });
            await fetch('/${lang}/${game}/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers', { method: 'POST', body });
            const html = await (await fetch(location.href)).text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            document.querySelector('#cart').replaceWith(doc.querySelector('#cart'));
          });
        </script>`,
    });
  }

  function sellerPage(lang, game, seller, name) {
    const offers = ARTICLES.filter(
      (a) => a.game === game && a.seller === seller && state.available.has(a.articleId) && (!name || a.name === name),
    );
    return layout({
      lang,
      game,
      title: seller,
      body: `<h1>${esc(seller)}</h1><div class="table article-table"><div class="table-body">${offers
        .map((a) => offerRow(a, lang, { sellerPage: true }))
        .join('')}</div></div>`,
    });
  }

  function orderPage(lang, game, ids) {
    return layout({
      lang,
      game,
      title: 'Order',
      body: `<h1>Purchase #1234567</h1><table class="table product-table"><tbody>${ids
        .map((id) => row(article(id), 1, lang))
        .join('')}</tbody></table>`,
    });
  }

  function ajax(ok, message) {
    const alert = `<div class="alert alert-${ok ? 'success' : 'danger'}" role="alert"><h4 class="alert-heading">${esc(message)}</h4></div>`;
    return `<?xml version="1.0" encoding="UTF-8"?>\n<ajaxResponse><resultType>${b64(ok ? 'success' : 'error')}</resultType><resultsCode>${b64(ok ? 'generalOK' : 'generalError')}</resultsCode><systemMessage>${b64(alert)}</systemMessage></ajaxResponse>`;
  }

  function handleAdd(endpoint, body) {
    if (state.challenge) {
      return { status: 403, contentType: 'text/html', body: '<html><head><title>Just a moment...</title></head><body><div id="cf-chl-widget"></div></body></html>' };
    }
    if (endpoint !== state.addEndpoint) return { status: 404, contentType: 'text/html', body: '<h1>404</h1>' };
    if (state.weirdAdd) return { status: 200, contentType: 'text/html', body: layout({ title: 'Magic', body: '<h1>Magic</h1>' }) };
    const params = new URLSearchParams(body);
    if (params.get('__cmtkn') !== state.token || !state.loggedIn) {
      return { status: 200, contentType: 'text/xml', body: ajax(false, 'The requested action could not be completed.') };
    }
    if (state.genericRefusal) {
      return { status: 200, contentType: 'text/xml', body: ajax(false, 'Something went wrong. Please try again.') };
    }
    const ids = JSON.parse(params.get('idArticle') || '{}');
    const amounts = JSON.parse(params.get('amount') || '{}');
    for (const id of Object.keys(ids)) {
      if (!state.available.has(id)) {
        return { status: 200, contentType: 'text/xml', body: ajax(false, 'This article is no longer available.') };
      }
      const amount = parseInt(amounts[id], 10) || 1;
      if (state.stock.has(id) && (state.cart.get(id) || 0) + amount > state.stock.get(id)) {
        return { status: 200, contentType: 'text/xml', body: ajax(false, 'Not enough articles available.') };
      }
      state.cart.set(id, (state.cart.get(id) || 0) + amount);
    }
    return { status: 200, contentType: 'text/xml', body: ajax(true, 'The article was put in your shopping cart.') };
  }

  /** Playwright route handler. */
  async function route(r) {
    const request = r.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postData() || '';
    state.requests.push({ method, path: url.pathname, body, at: Date.now() });

    if (url.pathname.startsWith('/cdn-cgi/')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });

    const [lang = 'en', game = 'Magic', page = '', ...rest] = url.pathname.split('/').filter(Boolean);
    let res;
    if (method === 'POST' && page === 'AjaxAction' && rest[0] === 'ShoppingCart_RemoveArticle') {
      // Like Cardmarket's trash button: idArticle (bare id), idSeller, amount-<id>.
      const params = new URLSearchParams(body);
      const id = params.get('idArticle');
      const remove = parseInt(params.get(`amount-${id}`), 10) || 1;
      const left = (state.cart.get(id) || 0) - remove;
      if (left > 0) state.cart.set(id, left);
      else state.cart.delete(id);
      res = { status: 200, contentType: 'text/xml', body: `<?xml version="1.0"?><ajaxResponse><resultsCode>${b64('1')}</resultsCode></ajaxResponse>` };
    } else if (method === 'POST' && page === 'AjaxAction' && !rest[0]) {
      // Everything inside an obfuscated `args`: "…***" + base64(JSON).
      const args = new URLSearchParams(body).get('args') || '';
      const json = JSON.parse(Buffer.from(args.slice(args.lastIndexOf('***') + 3), 'base64').toString('utf8') || '{}');
      const id = String(json.idArticle);
      const left = (state.cart.get(id) || 0) - (parseInt(json.amount, 10) || 1);
      if (left > 0) state.cart.set(id, left);
      else state.cart.delete(id);
      res = { status: 200, contentType: 'text/xml', body: `<?xml version="1.0"?><ajaxResponse><resultsCode>${b64('1')}</resultsCode></ajaxResponse>` };
    } else if (method === 'POST' && page === 'AjaxAction' && rest[0] === 'Cart_Update') {
      const params = new URLSearchParams(body);
      const id = params.get('ref');
      const left = (state.cart.get(id) || 0) - (parseInt(params.get('n'), 10) || 1);
      if (left > 0) state.cart.set(id, left);
      else state.cart.delete(id);
      res = { status: 200, contentType: 'application/json', body: '{"ok":true}' };
    } else if (method === 'POST' && page === 'AjaxAction' && rest[0] === 'ShoppingCart_RemoveShipment') {
      // Hypothetical "remove everything from this seller" (name not confirmed on the live site).
      const seller = new URLSearchParams(body).get('idSeller');
      for (const id of [...state.cart.keys()]) if (article(id).sellerId === seller) state.cart.delete(id);
      res = { status: 200, contentType: 'text/xml', body: `<?xml version="1.0"?><ajaxResponse><resultsCode>${b64('1')}</resultsCode></ajaxResponse>` };
    } else if (method === 'POST' && page === 'PostGetAction' && rest[0] === 'ShoppingCart_CheckoutShipment') {
      // Buying one seller's shipment: those articles leave the cart and become an order.
      const seller = new URLSearchParams(body).get('idSeller');
      for (const id of [...state.cart.keys()]) if (article(id).sellerId === seller) state.cart.delete(id);
      res = { status: 200, contentType: 'text/html', body: layout({ lang, game, title: 'Purchases', body: '<h1>Thank you for your purchase</h1>' }) };
    } else if (method === 'POST' && page === 'AjaxAction') {
      res = handleAdd(rest[0], body);
    } else if (page === 'ShoppingCart') {
      res = { status: 200, contentType: 'text/html', body: cartPage(lang, game) };
    } else if (page === 'Orders') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      res = { status: 200, contentType: 'text/html', body: orderPage(lang, game, ids) };
    } else if (page === 'Products') {
      res = { status: 200, contentType: 'text/html', body: productPage(lang, game, rest[1], rest[2]) };
    } else if (page === 'Wants') {
      const form = state.loggedIn && (state.tokenMode === 'input' || state.tokenMode === 'wants')
        ? `<form data-ajax-action="Wantslist_CreateWantsList"><input type="hidden" name="__cmtkn" value="${state.token}"><input name="wlName"></form>`
        : '';
      res = { status: 200, contentType: 'text/html', body: layout({ lang, game, title: 'Wants', body: `<h1>Wants</h1>${form}` }) };
    } else if (page === 'Users') {
      const seller = decodeURIComponent(rest[0] || '');
      res = { status: 200, contentType: 'text/html', body: sellerPage(lang, game, seller, url.searchParams.get('name')) };
    } else {
      res = { status: 200, contentType: 'text/html', body: layout({ lang, game, title: game, body: `<h1>${game}</h1>` }) };
    }
    return r.fulfill({ status: res.status, contentType: `${res.contentType}; charset=utf-8`, body: res.body });
  }

  return { state, route, article };
}

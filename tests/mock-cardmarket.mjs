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
];

export function createMockCardmarket() {
  const state = {
    token: '6f1c0b7e2d9a4c58b3e1f0a9d8c7b6a5e4f3d2c1b0a99887766554433221100',
    loggedIn: true,
    /** articleId → amount */
    cart: new Map(),
    /** articleId → article (offers that still exist) */
    available: new Map(ARTICLES.map((a) => [a.articleId, a])),
    /** which add endpoint exists (the other one 404s) */
    addEndpoint: 'ShoppingCart_Add_AddArticlesFromUserOffers',
    /** answer adds with a Cloudflare challenge */
    challenge: false,
    /** render cart rows in a shape the extension cannot read (layout change) */
    brokenRows: false,
    /** an outdated token printed on pages other than the cart page */
    stalePageToken: null,
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
            ? `<div id="account-dropdown"><a href="/${lang}/${game}/Account">tester</a>
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
      <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></head>
      <body>${header(lang, game)}<main>${body}</main>
      ${state.loggedIn ? `<form id="filter"><input type="hidden" name="__cmtkn" value="${pageToken}"></form>` : ''}
      </body></html>`;
  }

  function row(a, amount, lang) {
    const productUrl = `https://www.cardmarket.com/${lang}/${a.game}/Products/Singles/${a.expansionSlug}/${a.cardSlug}?language=1,3&amp;minCondition=5`;
    const img = `&lt;img src=&quot;https://product-images.s3.cardmarket.com/1/X/${a.productId}/${a.productId}.jpg&quot; alt=&quot;${esc(a.name)}&quot;&gt;`;
    return `
      <tr ${state.brokenRows ? 'data-art' : 'data-article-id'}="${a.articleId}" data-product-id="${a.productId}" data-amount="${amount}"
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
        <td class="actions"><a href="#" class="btn btn-sm" role="button" onclick="return false" data-ajax-action="ShoppingCart_RemoveArticle"><span class="fonticon-delete"></span></a></td>
      </tr>`;
  }

  function cartPage(lang, game) {
    const bySeller = new Map();
    for (const [id, amount] of state.cart) {
      const a = article(id);
      if (a.game !== game) continue;
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
            <table class="table table-sm article-table mb-1 table-striped product-table"><tbody>
              ${rows.map(([a, amount]) => row(a, amount, lang)).join('')}
            </tbody></table>
            <!-- Cardmarket renders some rows a second time (mobile layout) -->
            <table class="table d-none mobile-table"><tbody>${row(rows[0][0], rows[0][1], lang)}</tbody></table>
          </div></div>
        </section>`,
      )
      .join('');
    return layout({
      lang,
      game,
      title: 'Shopping Cart',
      isCart: true,
      body: `<h1>Shopping Cart</h1><div id="shipments-col">${blocks || '<p>Your shopping cart is empty.</p>'}</div>`,
    });
  }

  function productPage(lang, game) {
    // A page with an "add to cart" button that behaves like the site's own:
    // AJAX add, then the header badge is updated in place.
    return layout({
      lang,
      game,
      title: 'Sol Ring',
      body: `<h1>Sol Ring</h1>
        <div id="articleRow1611110000" class="row article-row"><button id="site-add">Put in cart</button></div>
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
    const params = new URLSearchParams(body);
    if (params.get('__cmtkn') !== state.token || !state.loggedIn) {
      return { status: 200, contentType: 'text/xml', body: ajax(false, 'The requested action could not be completed.') };
    }
    const ids = JSON.parse(params.get('idArticle') || '{}');
    const amounts = JSON.parse(params.get('amount') || '{}');
    for (const id of Object.keys(ids)) {
      if (!state.available.has(id)) {
        return { status: 200, contentType: 'text/xml', body: ajax(false, 'This article is no longer available.') };
      }
      state.cart.set(id, (state.cart.get(id) || 0) + (parseInt(amounts[id], 10) || 1));
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
    if (method === 'POST' && page === 'AjaxAction') {
      res = handleAdd(rest[0], body);
    } else if (page === 'ShoppingCart') {
      res = { status: 200, contentType: 'text/html', body: cartPage(lang, game) };
    } else if (page === 'Orders') {
      const ids = (url.searchParams.get('ids') || '').split(',').filter(Boolean);
      res = { status: 200, contentType: 'text/html', body: orderPage(lang, game, ids) };
    } else if (page === 'Products') {
      res = { status: 200, contentType: 'text/html', body: productPage(lang, game) };
    } else {
      res = { status: 200, contentType: 'text/html', body: layout({ lang, game, title: game, body: `<h1>${game}</h1>` }) };
    }
    return r.fulfill({ status: res.status, contentType: `${res.contentType}; charset=utf-8`, body: res.body });
  }

  return { state, route, article };
}

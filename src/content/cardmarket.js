/*
 * Everything this extension knows about cardmarket.com's pages and endpoints.
 *
 * Runs in the content script, i.e. on https://www.cardmarket.com itself. All
 * requests below are same-origin fetches, so they carry the user's own session
 * cookies exactly like the site's own buttons do — no credentials are ever
 * stored or sent anywhere else.
 *
 * Page structure (verified against saved Cardmarket HTML and existing
 * open-source Cardmarket tools):
 *   - URLs look like /{lang}/{game}/…, e.g. /en/Magic/ShoppingCart
 *   - the cart page groups articles per seller in `section.shipment-block`,
 *     each article is a `tr[data-article-id]` with data-* attributes
 *     (data-product-id, data-amount, data-name, data-expansion-name,
 *     data-condition, data-language, data-price, data-comment)
 *   - the header shows the cart count in `#cart .main-nav-badge`
 *   - every signed-in page carries the CSRF token in `input[name="__cmtkn"]`
 *   - adding to the cart is an AJAX POST to
 *     /{lang}/{game}/AjaxAction/ShoppingCart_Add_AddArticlesFromUserOffers
 *     with __cmtkn, idArticle={"<id>":"<id>"} and amount={"<id>":"<n>"},
 *     answered by an <ajaxResponse> XML envelope with base64 fields.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});

  const ORIGIN = 'https://www.cardmarket.com';

  /** Endpoints seen in the wild for "add these articles to my cart". */
  const ADD_ENDPOINTS = [
    'ShoppingCart_Add_AddArticlesFromUserOffers',
    'ShoppingCart_Add_AddArticlesFromProductPage',
  ];

  const LANGUAGES = {
    1: 'English',
    2: 'French',
    3: 'German',
    4: 'Spanish',
    5: 'Italian',
    6: 'S-Chinese',
    7: 'Japanese',
    8: 'Portuguese',
    9: 'Russian',
    10: 'Korean',
    11: 'T-Chinese',
  };

  const CONDITIONS = { 1: 'MT', 2: 'NM', 3: 'EX', 4: 'GD', 5: 'LP', 6: 'PL', 7: 'PO' };
  const CONDITION_IDS = Object.fromEntries(Object.entries(CONDITIONS).map(([id, code]) => [code, Number(id)]));
  const LANGUAGE_IDS = Object.fromEntries(Object.entries(LANGUAGES).map(([id, name]) => [name, Number(id)]));
  /** Article extras that are not the card language. */
  const EXTRA_RE = /foil|holo|signed|altered|first edition|1st edition|playset|signiert|alteriert|signé|altéré/i;

  const TOKEN_RE = /^[0-9a-f]{32,}$/i;
  const LABEL_ATTRS = ['aria-label', 'data-bs-original-title', 'data-original-title', 'title'];

  // ---------------------------------------------------------------------------
  // URLs
  // ---------------------------------------------------------------------------

  /** Split a Cardmarket URL into language, game and the page within the game. */
  function parseLocation(url) {
    const u = new URL(url, ORIGIN);
    const parts = u.pathname.split('/').filter(Boolean);
    const lang = /^[a-z]{2}$/.test(parts[0] || '') ? parts[0] : null;
    const game = lang && /^[A-Z][A-Za-z0-9]+$/.test(parts[1] || '') ? parts[1] : null;
    const page = game ? parts[2] || '' : '';
    return {
      lang,
      game,
      page,
      isCart: page === 'ShoppingCart',
      isOrder: page === 'Orders',
    };
  }

  function cartUrl(lang, game) {
    return `${ORIGIN}/${lang || 'en'}/${game}/ShoppingCart`;
  }

  /**
   * Product page filtered to offers like the saved one (same language, at least
   * the same condition, same foil state) — for finding a replacement offer.
   */
  function alternativesUrl(item) {
    if (!item.productUrl) return null;
    const u = new URL(item.productUrl);
    if (item.language) u.searchParams.set('language', String(item.language));
    if (item.condition) u.searchParams.set('minCondition', String(item.condition));
    if (item.foil) u.searchParams.set('isFoil', 'Y');
    return u.toString();
  }

  /**
   * The page where a saved offer can be seen again: its product page filtered
   * to the offer's language and condition (so it is near the top), jumping
   * straight to the offer's row.
   */
  function offerUrl(item) {
    if (!item.productUrl) return null;
    const u = new URL(item.productUrl);
    if (item.language) u.searchParams.set('language', String(item.language));
    if (item.condition) u.searchParams.set('minCondition', String(item.condition));
    if (item.foil) u.searchParams.set('isFoil', 'Y');
    u.hash = `articleRow${item.articleId}`;
    return u.toString();
  }

  /** The seller's stock, searched for this card's name. */
  function sellerSearchUrl(item) {
    if (!item.sellerUrl) return null;
    const u = new URL(`${item.sellerUrl.replace(/\/$/, '')}/Offers/Singles`);
    if (item.name) u.searchParams.set('name', item.name);
    return u.toString();
  }

  // ---------------------------------------------------------------------------
  // Page reading
  // ---------------------------------------------------------------------------

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

  function labelOf(el) {
    for (const attr of LABEL_ATTRS) {
      const value = el.getAttribute(attr);
      if (value && !value.includes('<')) return clean(value);
    }
    return '';
  }

  /** Cart count shown in the site header, or null when there is no cart icon. */
  function readHeaderCount(doc) {
    const cart = doc.querySelector('#cart');
    if (!cart) return null;
    const badge = cart.querySelector('.main-nav-badge');
    const n = parseInt(clean(badge && badge.textContent), 10);
    return Number.isFinite(n) ? n : 0;
  }

  /**
   * Was this page served to someone logged in? Being wrong here in the "yes"
   * direction is the costly mistake: a login page has no cart rows, so every
   * saved article would look missing. Hence the explicit login-page check.
   */
  /** Cart total shown in the header (e.g. "12,34 €"), or null. */
  function readHeaderTotal(doc) {
    const el = doc.querySelector('#cart .text-success');
    const m = clean(el && el.textContent).match(/(\d[\d.\s]*,\d{2})/);
    return m ? parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.')) : null;
  }

  function isSignedIn(doc) {
    if (doc.querySelector('[href*="Logout"], [action*="Logout"], #account-dropdown')) return true;
    const html = doc.documentElement ? doc.documentElement.innerHTML : '';
    if (/User_Logout|data-logged-in=["']true/i.test(html)) return true;
    const loginPage =
      /User_Login/i.test(html) ||
      (/type=["']password["']/i.test(html) && (/>\s*Login\s*</i.test(html) || /name=["']username["']/i.test(html)));
    return !loginPage && /account-dropdown|My\s*Account/i.test(html);
  }

  /** Cardmarket serves its login form in place of a page that needs an account. */
  function looksLikeLoginPage(doc) {
    const html = doc.documentElement ? doc.documentElement.innerHTML : '';
    if (/User_Logout/i.test(html) || doc.querySelector('#account-dropdown')) return false;
    return (
      /User_Login/i.test(html) ||
      Boolean(doc.querySelector('input[type="password"]')) ||
      /name=["']username["']/i.test(html)
    );
  }

  /**
   * The session's CSRF token. Today it is a long hex string; accept any
   * token-like value too, so a format change does not read as "logged out".
   */
  function findToken(doc) {
    const values = [...doc.querySelectorAll('input[name="__cmtkn"]')].map((input) => (input.value || '').trim());
    return values.find((v) => TOKEN_RE.test(v)) || values.find((v) => /^[A-Za-z0-9+/=_.:-]{16,}$/.test(v)) || null;
  }

  function sellerFromLink(link, baseUrl) {
    if (!link) return { seller: null, sellerUrl: null };
    const u = new URL(link.getAttribute('href'), baseUrl);
    const slug = decodeURIComponent((u.pathname.match(/\/Users\/([^/]+)/) || [])[1] || '');
    return { seller: clean(link.textContent) || slug || null, sellerUrl: u.origin + u.pathname };
  }

  /** Seller link for each cart row: the seller header of its shipment block. */
  function mapRowsToSellers(doc) {
    const map = new Map();
    // Preferred: the row's own shipment block.
    doc.querySelectorAll('tr[data-article-id]').forEach((tr) => {
      const block = tr.closest('section.shipment-block, section[id*="seller"], .shipment-block');
      if (!block) return;
      const link =
        block.querySelector('.seller-info a[href*="/Users/"]') ||
        [...block.querySelectorAll('a[href*="/Users/"]')].find((a) => !a.closest('tr'));
      if (link) map.set(tr, link);
    });
    // Fallback: the last seller link before the row in document order.
    let current = null;
    doc.querySelectorAll('a[href*="/Users/"], tr[data-article-id]').forEach((node) => {
      if (node.matches('tr[data-article-id]')) {
        if (!map.has(node) && current) map.set(node, current);
      } else if (!node.closest('tr[data-article-id]')) {
        current = node;
      }
    });
    return map;
  }

  function parseRow(tr, { baseUrl, fallbackGame, fallbackLang, sellerLink }) {
    const articleId = tr.getAttribute('data-article-id');
    const link =
      tr.querySelector('td.name a[href*="/Products/"]') || tr.querySelector('a[href*="/Products/"]');
    let productUrl = null;
    let game = fallbackGame;
    let lang = fallbackLang;
    if (link) {
      const u = new URL(link.getAttribute('href'), baseUrl);
      productUrl = u.origin + u.pathname;
      const loc = parseLocation(u.toString());
      game = loc.game || game;
      lang = loc.lang || lang;
    }

    const conditionEl = tr.querySelector('.article-condition');
    const conditionId = parseInt(tr.getAttribute('data-condition'), 10) || null;
    const languageId = parseInt(tr.getAttribute('data-language'), 10) || null;

    // Icons in the info cell: first the card language, then extras (foil, signed…).
    const iconLabels = [];
    tr.querySelectorAll('td.info .col-icon .icon, td.info .col-extras [aria-label], td.info .extras [aria-label]').forEach((el) => {
      const label = labelOf(el);
      if (label && !iconLabels.includes(label)) iconLabels.push(label);
    });
    const languageLabel =
      iconLabels.find((l) => Object.values(LANGUAGES).includes(l)) ||
      LANGUAGES[languageId] ||
      iconLabels[0] ||
      null;
    const extras = iconLabels.filter((l) => l !== languageLabel);

    const thumb = tr.querySelector('.thumbnail-icon');
    const thumbHtml = thumb
      ? thumb.getAttribute('aria-label') ||
        thumb.getAttribute('data-bs-original-title') ||
        thumb.getAttribute('data-bs-title') ||
        ''
      : '';
    const imageUrl = (thumbHtml.match(/src=["']([^"']+)["']/) || [])[1] || null;

    let price = parseFloat(tr.getAttribute('data-price'));
    if (!Number.isFinite(price)) {
      const priceText = clean(tr.querySelector('td.price') && tr.querySelector('td.price').textContent);
      price = parseFloat(priceText.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.'));
    }

    return {
      articleId,
      productId: tr.getAttribute('data-product-id') || null,
      game,
      lang,
      name: clean(tr.getAttribute('data-name')) || clean(link && link.textContent) || `#${articleId}`,
      expansion: clean(tr.getAttribute('data-expansion-name')) || null,
      number: clean(tr.getAttribute('data-number')) || null,
      productUrl,
      imageUrl,
      amount: parseInt(tr.getAttribute('data-amount'), 10) || 1,
      price: Number.isFinite(price) ? price : null,
      condition: conditionId,
      conditionLabel:
        clean(conditionEl && conditionEl.querySelector('.badge') && conditionEl.querySelector('.badge').textContent) ||
        CONDITIONS[conditionId] ||
        null,
      language: languageId,
      languageLabel,
      foil: extras.some((l) => /foil/i.test(l)),
      extras,
      comment: clean(tr.getAttribute('data-comment')) || null,
      ...sellerFromLink(sellerLink, baseUrl),
    };
  }

  /** Every article in a cart page (live DOM or fetched), deduplicated. */
  function parseCart(doc, { baseUrl, game, lang }) {
    const sellers = mapRowsToSellers(doc);
    const items = [];
    const seen = new Set();
    doc.querySelectorAll('tr[data-article-id]').forEach((tr) => {
      const id = tr.getAttribute('data-article-id');
      // The cart renders some rows twice (desktop + mobile layout).
      if (!/^\d+$/.test(id || '') || seen.has(id)) return;
      seen.add(id);
      items.push(
        parseRow(tr, { baseUrl, fallbackGame: game, fallbackLang: lang, sellerLink: sellers.get(tr) }),
      );
    });
    return items;
  }

  /** One cart row, with its seller looked up in the surrounding page. */
  function parseCartRow(tr, { baseUrl, game, lang, sellers }) {
    const map = sellers || mapRowsToSellers(tr.ownerDocument);
    return parseRow(tr, { baseUrl, fallbackGame: game, fallbackLang: lang, sellerLink: map.get(tr) });
  }

  /** Product name and expansion from a product page title ("Ephemerate" + "Modern Horizons - Singles"). */
  function productTitle(doc) {
    const h1 = doc.querySelector('.page-title-container h1') || doc.querySelector('h1');
    if (!h1) return { name: null, expansion: null };
    const sub = h1.querySelector('span');
    const subtitle = clean(sub && sub.textContent);
    let name = clean(h1.textContent);
    if (subtitle && name.endsWith(subtitle)) name = name.slice(0, -subtitle.length).trim();
    const expansion = subtitle && !/\bversions?\b/i.test(subtitle) ? subtitle.replace(/\s+-\s+[^-]+$/, '').trim() : null;
    return { name: name || null, expansion: expansion || null };
  }

  function productImage(doc) {
    const img = doc.querySelector('#image img[src], .image img[src]');
    if (img) return new URL(img.getAttribute('src'), ORIGIN).toString();
    const og = doc.querySelector('meta[property="og:image"]');
    return og ? og.getAttribute('content') : null;
  }

  /**
   * One offer row (`div.article-row#articleRow<id>`) on a product page, a card
   * page or a seller's stock page.
   */
  function parseOfferRow(row, { baseUrl }) {
    const doc = row.ownerDocument;
    const articleId = ((row.id || '').match(/articleRow(\d+)/) || [])[1];
    if (!articleId) return null;
    const pageLoc = parseLocation(baseUrl);
    const page = new URL(baseUrl);

    // Seller stock pages link the product inside the row; product pages are the product.
    const productLink = row.querySelector('.col-seller a[href*="/Products/"], .col-product a[href*="/Products/"]');
    const title = productTitle(doc);
    let productUrl = null;
    let name = null;
    if (productLink) {
      const u = new URL(productLink.getAttribute('href'), baseUrl);
      productUrl = u.origin + u.pathname;
      name = clean(productLink.textContent);
    } else if (pageLoc.page === 'Products' || pageLoc.page === 'Cards') {
      productUrl = page.origin + page.pathname;
      name = title.name;
    }
    const productLoc = productUrl ? parseLocation(productUrl) : pageLoc;

    const sellerLink = [...row.querySelectorAll('a[href*="/Users/"]')].find((a) => !/\/Products\//.test(a.getAttribute('href')));
    // A seller's own stock page has no seller per row: the page is the seller.
    const pageSeller =
      !sellerLink && pageLoc.page === 'Users'
        ? (() => {
            const slug = page.pathname.split('/').filter(Boolean)[3];
            return slug
              ? { seller: decodeURIComponent(slug), sellerUrl: `${page.origin}/${pageLoc.lang}/${pageLoc.game}/Users/${slug}` }
              : null;
          })()
        : null;

    const attrs = row.querySelector('.product-attributes') || row;
    const conditionEl = attrs.querySelector('.article-condition');
    const conditionLabel =
      clean(conditionEl && conditionEl.querySelector('.badge') && conditionEl.querySelector('.badge').textContent) ||
      (((conditionEl && conditionEl.className) || '').match(/condition-([a-z]{2})/) || [])[1]?.toUpperCase() ||
      null;
    const expansionEl = attrs.querySelector('.expansion-symbol');

    const labels = [];
    attrs.querySelectorAll('[aria-label], [title], [data-bs-original-title], [data-original-title]').forEach((el) => {
      if (el.closest('svg') || el.closest('.expansion-symbol') || el.closest('.article-condition')) return;
      const label = labelOf(el);
      if (label && !labels.includes(label)) labels.push(label);
    });
    const extras = labels.filter((l) => EXTRA_RE.test(l));
    const languageLabel = labels.find((l) => !EXTRA_RE.test(l)) || null;

    let price = null;
    const priceBox = row.querySelector('.col-offer .price-container') || row.querySelector('.price-container');
    for (const span of priceBox ? priceBox.querySelectorAll('span.color-primary, span.text-nowrap') : []) {
      if (span.closest('del, s, .text-decoration-line-through')) continue;
      const m = clean(span.textContent).match(/(\d[\d.\s]*,\d{2})/);
      if (m) {
        price = parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.'));
        break;
      }
    }
    const countEl = row.querySelector('.col-offer .item-count') || row.querySelector('.item-count');
    const thumb = row.querySelector('.thumbnail-icon');
    const thumbHtml = thumb
      ? thumb.getAttribute('data-bs-title') || thumb.getAttribute('data-bs-original-title') || thumb.getAttribute('aria-label') || ''
      : '';
    const comment = row.querySelector('.product-comments .text-truncate, .product-comments');

    return {
      articleId,
      productId: null,
      game: productLoc.game || pageLoc.game,
      lang: productLoc.lang || pageLoc.lang,
      name: name || `#${articleId}`,
      expansion: (expansionEl && labelOf(expansionEl)) || title.expansion,
      number: null,
      productUrl,
      imageUrl: (thumbHtml.match(/src=["']([^"']+)["']/) || [])[1] || productImage(doc),
      price,
      available: parseInt(clean(countEl && countEl.textContent), 10) || null,
      condition: CONDITION_IDS[conditionLabel] || null,
      conditionLabel,
      language: LANGUAGE_IDS[languageLabel] || null,
      languageLabel,
      foil: extras.some((l) => /foil/i.test(l)),
      extras,
      comment: clean(comment && comment.textContent) || null,
      ...(pageSeller || sellerFromLink(sellerLink, baseUrl)),
    };
  }

  /** Article ids listed on an order page (those were bought). */
  function parseOrderArticleIds(doc) {
    return [...new Set([...doc.querySelectorAll('tr[data-article-id]')].map((tr) => tr.getAttribute('data-article-id')))];
  }

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------

  const CHALLENGE_ONLY =
    /just a moment|attention required|checking if the site connection is secure|cf-chl-|_cf_chl_opt|challenge-error-text/i;
  const SITE_MARKUP = /__cmtkn|main-nav-badge|\/Products\/|\/Users\//i;

  /**
   * Cloudflare's "are you human" page instead of the real answer. Normal pages
   * also load Cloudflare's /cdn-cgi/challenge-platform script, so only the
   * interstitial's own markers count.
   */
  function isChallenge(status, text, headers) {
    if (headers && headers.get && headers.get('cf-mitigated') === 'challenge') return true;
    if (status === 403) return true;
    const head = String(text || '').slice(0, 20000);
    return CHALLENGE_ONLY.test(head) && !SITE_MARKUP.test(head);
  }

  class CardmarketError extends Error {
    constructor(kind, message, extra) {
      super(message || kind);
      this.kind = kind;
      Object.assign(this, extra);
    }
  }

  // --- Transport ------------------------------------------------------------
  // Requests preferably leave from the page itself, through the small MAIN-world
  // script in src/page/bridge.js: Cardmarket does not always answer requests
  // made from the extension's isolated world like the site's own (another
  // Cardmarket extension, Lugin, ran into the same and replays in the page).
  // When the bridge does not answer, the content script's own fetch is used.

  const BRIDGE_PING_MS = 1500;
  const BRIDGE_REQUEST_MS = 30000;
  let bridgeReady = null;

  function bridgeCall(payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = `cmcs-${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('bridge timeout'));
      }, timeoutMs);
      function onMessage(event) {
        if (event.source !== window || !event.data || event.data.__cmcs !== 'response' || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve(event.data);
      }
      window.addEventListener('message', onMessage);
      window.postMessage({ __cmcs: 'request', id, ...payload }, location.origin);
    });
  }

  function bridgeAvailable() {
    if (typeof window === 'undefined' || location.origin !== ORIGIN) return Promise.resolve(false);
    bridgeReady ??= bridgeCall({ ping: true }, BRIDGE_PING_MS).then(
      (reply) => Boolean(reply.pong),
      () => false,
    );
    return bridgeReady;
  }

  const headerBag = (entries) => ({ get: (name) => entries[String(name).toLowerCase()] ?? null });

  /**
   * One request to Cardmarket. `via`: 'auto' (page first), 'page' or
   * 'extension'. Resolves to { status, ok, url, text, headers, via }.
   */
  async function request(url, { method = 'GET', headers = {}, body } = {}, via = 'auto') {
    if (via !== 'extension' && (await bridgeAvailable())) {
      try {
        const reply = await bridgeCall({ url, method, headers, body }, BRIDGE_REQUEST_MS);
        if (!reply.error) {
          return { status: reply.status, ok: reply.ok, url: reply.url || url, text: reply.text || '', headers: headerBag(reply.headers || {}), via: 'page' };
        }
        if (via === 'page') throw new CardmarketError('network_error', reply.error);
      } catch (err) {
        if (via === 'page') throw err instanceof CardmarketError ? err : new CardmarketError('network_error', err.message);
      }
    }
    try {
      const res = await fetch(url, { method, headers, body, credentials: 'same-origin' });
      const entries = {};
      res.headers.forEach((value, name) => (entries[name.toLowerCase()] = value));
      return { status: res.status, ok: res.ok, url: res.url || url, text: await res.text(), headers: headerBag(entries), via: 'extension' };
    } catch (err) {
      throw new CardmarketError('network_error', err.message);
    }
  }

  /** A short, privacy-safe description of a response, for error reports. */
  function describe(res, doc) {
    const path = (() => {
      try {
        return new URL(res.url).pathname;
      } catch {
        return res.url;
      }
    })();
    const title = clean(doc && doc.querySelector('title') && doc.querySelector('title').textContent).slice(0, 60);
    const type = (res.headers.get('content-type') || '').split(';')[0];
    return [`HTTP ${res.status}`, path, type, title && `"${title}"`, `via ${res.via}`].filter(Boolean).join(' · ');
  }

  function retryAfterSeconds(res) {
    const n = parseInt(res.headers.get('retry-after'), 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  /** GET a page of the site and parse it. Throws CardmarketError on trouble. */
  async function fetchDocument(url, via = 'auto') {
    const res = await request(url, {}, via);
    if (res.status === 429) throw new CardmarketError('rate_limited', null, { retryAfter: retryAfterSeconds(res) });
    if (isChallenge(res.status, res.text, res.headers)) throw new CardmarketError('challenge', null, { detail: describe(res) });
    if (!res.ok) throw new CardmarketError('http_error', `HTTP ${res.status}`, { status: res.status, detail: describe(res) });
    const doc = new DOMParser().parseFromString(res.text, 'text/html');
    return { doc, url: res.url || url, res };
  }

  /**
   * Read the cart of one game. When the answer does not look like a signed-in
   * page while this tab clearly is signed in, ask once more through the other
   * transport before believing it.
   */
  async function fetchCart(lang, game) {
    const url = cartUrl(lang, game);
    let fetched = await fetchDocument(url);
    let cart = readCartDocument(fetched.doc, { baseUrl: fetched.url, lang, game });
    if (!cart.signedIn && isSignedIn(document)) {
      const other = fetched.res.via === 'page' ? 'extension' : 'page';
      try {
        const retry = await fetchDocument(url, other);
        const retryCart = readCartDocument(retry.doc, { baseUrl: retry.url, lang, game });
        if (retryCart.signedIn) {
          fetched = retry;
          cart = retryCart;
        }
      } catch {
        // Keep the first answer.
      }
    }
    if (!cart.signedIn) {
      console.warn('[Cart Saver] cart page does not look signed in:', describe(fetched.res, fetched.doc));
    }
    return { ...cart, loginPage: looksLikeLoginPage(fetched.doc), detail: describe(fetched.res, fetched.doc) };
  }

  function readCartDocument(doc, { baseUrl, lang, game }) {
    const signedIn = isSignedIn(doc);
    const items = signedIn ? parseCart(doc, { baseUrl, lang, game }) : [];
    const headerCount = readHeaderCount(doc);
    const headerTotal = readHeaderTotal(doc);
    const hasShipments = Boolean(doc.querySelector('section.shipment-block, .shipment-block, section[id*="seller"]'));
    return {
      signedIn,
      token: findToken(doc),
      headerCount,
      items,
      // "Empty" is only believable when nothing on the page says otherwise.
      // If rows could not be read (layout change?) we must not conclude that
      // the cart was emptied, or a refill would add articles a second time.
      trustworthy: signedIn && (items.length > 0 || (!(headerCount > 0) && !(headerTotal > 0) && !hasShipments)),
    };
  }

  function decodeBase64(b64) {
    const compact = String(b64 || '').replace(/\s+/g, '');
    if (!compact) return '';
    try {
      const bytes = Uint8Array.from(atob(compact), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return compact;
    }
  }

  /** Decode Cardmarket's <ajaxResponse> envelope, or null if it is something else. */
  function parseAjaxResponse(text) {
    if (!/<ajaxResponse[\s>]/i.test(text || '')) return null;
    const field = (tag) => {
      const m = text.match(new RegExp(`<${tag}\\s*>([\\s\\S]*?)</${tag}\\s*>`, 'i'));
      return m ? decodeBase64(m[1]) : '';
    };
    const resultType = field('resultType');
    const resultsCode = field('resultsCode');
    const systemMessage = field('systemMessage');
    let message = '';
    if (systemMessage) {
      const doc = new DOMParser().parseFromString(systemMessage, 'text/html');
      const heading = doc.querySelector('.alert-heading');
      const alert = doc.querySelector('.alert');
      message = clean((heading || alert || doc.body).textContent).slice(0, 240);
    }
    const ok = /success/i.test(resultType) || /generalOK/i.test(resultsCode);
    return { ok, resultType, resultsCode, message };
  }

  let preferredEndpoint = 0;

  /** The add endpoint that worked last (remembered across page loads by the caller). */
  const endpointPreference = {
    get: () => ADD_ENDPOINTS[preferredEndpoint],
    set(name) {
      const index = ADD_ENDPOINTS.indexOf(name);
      if (index >= 0) preferredEndpoint = index;
    },
  };

  /**
   * Put one article in the cart. Resolves to { ok, message } when Cardmarket
   * answered (ok=false means it refused, e.g. the article is gone) and throws a
   * CardmarketError when the request itself failed.
   */
  async function addArticle({ lang, game, articleId, amount, token }) {
    const body = new URLSearchParams();
    body.set('__cmtkn', token);
    body.set('idArticle', JSON.stringify({ [articleId]: articleId }));
    body.set('amount', JSON.stringify({ [articleId]: String(amount || 1) }));

    for (let i = 0; i < ADD_ENDPOINTS.length; i += 1) {
      const index = (preferredEndpoint + i) % ADD_ENDPOINTS.length;
      const url = `${ORIGIN}/${lang}/${game}/AjaxAction/${ADD_ENDPOINTS[index]}`;
      const res = await request(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
      });
      if (res.status === 429) throw new CardmarketError('rate_limited', null, { retryAfter: retryAfterSeconds(res) });
      if (isChallenge(res.status, res.text, res.headers)) throw new CardmarketError('challenge', null, { detail: describe(res) });

      const parsed = parseAjaxResponse(res.text);
      if (parsed) {
        preferredEndpoint = index;
        return { ok: parsed.ok, message: parsed.message };
      }
      // Unknown endpoint → try the other one. Anything else is a real failure.
      if (res.status === 404 || res.status === 405) continue;
      const doc = new DOMParser().parseFromString(res.text, 'text/html');
      const detail = describe(res, doc);
      console.warn('[Cart Saver] unexpected answer to add-to-cart:', detail, res.text.slice(0, 300));
      // Only a real login form means "logged out"; anything else is reported as what it is.
      if (looksLikeLoginPage(doc)) throw new CardmarketError('logged_out', null, { detail });
      throw new CardmarketError('unexpected_response', `HTTP ${res.status}`, { status: res.status, detail });
    }
    throw new CardmarketError('no_endpoint');
  }

  CMCS.cm = {
    ORIGIN,
    LANGUAGES,
    CONDITIONS,
    CardmarketError,
    parseLocation,
    cartUrl,
    alternativesUrl,
    offerUrl,
    sellerSearchUrl,
    mapRowsToSellers,
    parseCartRow,
    parseOfferRow,
    readHeaderCount,
    isSignedIn,
    findToken,
    parseCart,
    parseOrderArticleIds,
    readCartDocument,
    looksLikeLoginPage,
    request,
    isChallenge,
    parseAjaxResponse,
    fetchDocument,
    fetchCart,
    addArticle,
    endpointPreference,
  };
})(globalThis);

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

  function findToken(doc) {
    for (const input of doc.querySelectorAll('input[name="__cmtkn"]')) {
      if (TOKEN_RE.test(input.value || '')) return input.value;
    }
    return null;
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

  function retryAfterSeconds(res) {
    const n = parseInt(res.headers.get('Retry-After'), 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
  }

  /** GET a page of the site and parse it. Throws CardmarketError on trouble. */
  async function fetchDocument(url) {
    let res;
    try {
      res = await fetch(url, { credentials: 'same-origin' });
    } catch (err) {
      throw new CardmarketError('network_error', err.message);
    }
    const text = await res.text();
    if (res.status === 429) throw new CardmarketError('rate_limited', null, { retryAfter: retryAfterSeconds(res) });
    if (isChallenge(res.status, text, res.headers)) throw new CardmarketError('challenge');
    if (!res.ok) throw new CardmarketError('http_error', `HTTP ${res.status}`, { status: res.status });
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return { doc, url: res.url || url };
  }

  /** Read the cart of one game. */
  async function fetchCart(lang, game) {
    const { doc, url } = await fetchDocument(cartUrl(lang, game));
    return readCartDocument(doc, { baseUrl: url, lang, game });
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
      let res;
      try {
        res = await fetch(url, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
        });
      } catch (err) {
        throw new CardmarketError('network_error', err.message);
      }
      const text = await res.text();
      if (res.status === 429) throw new CardmarketError('rate_limited', null, { retryAfter: retryAfterSeconds(res) });
      if (isChallenge(res.status, text, res.headers)) throw new CardmarketError('challenge');

      const parsed = parseAjaxResponse(text);
      if (parsed) {
        preferredEndpoint = index;
        return { ok: parsed.ok, message: parsed.message };
      }
      // Unknown endpoint → try the other one. Anything else is a real failure.
      if (res.status === 404 || res.status === 405) continue;
      const doc = new DOMParser().parseFromString(text, 'text/html');
      if (!isSignedIn(doc)) throw new CardmarketError('logged_out');
      throw new CardmarketError('http_error', `HTTP ${res.status}`, { status: res.status });
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
    readHeaderCount,
    isSignedIn,
    findToken,
    parseCart,
    parseOrderArticleIds,
    readCartDocument,
    isChallenge,
    parseAjaxResponse,
    fetchDocument,
    fetchCart,
    addArticle,
    endpointPreference,
  };
})(globalThis);

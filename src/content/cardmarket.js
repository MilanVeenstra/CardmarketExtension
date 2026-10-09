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
  /**
   * Language names as the site writes them in its five languages (en, de, fr,
   * es, it). Only a fallback: the flag itself says which language it is.
   */
  const LANGUAGE_ALIASES = {
    english: 1, french: 2, german: 3, spanish: 4, italian: 5, 's-chinese': 6, japanese: 7, portuguese: 8, russian: 9, korean: 10, 't-chinese': 11,
    englisch: 1, französisch: 2, deutsch: 3, spanisch: 4, italienisch: 5, 's-chinesisch': 6, japanisch: 7, portugiesisch: 8, russisch: 9, koreanisch: 10, 't-chinesisch': 11,
    anglais: 1, français: 2, allemand: 3, espagnol: 4, italien: 5, 'chinois-s': 6, japonais: 7, portugais: 8, russe: 9, coréen: 10, 'chinois-t': 11,
    inglés: 1, francés: 2, alemán: 3, español: 4, italiano: 5, 'chino-s': 6, japonés: 7, portugués: 8, ruso: 9, coreano: 10, 'chino-t': 11,
    inglese: 1, francese: 2, tedesco: 3, spagnolo: 4, 'cinese-s': 6, giapponese: 7, portoghese: 8, russo: 9, 'cinese-t': 11,
  };
  /** Article extras that are not the card language. */
  const EXTRA_RE = /foil|holo|signed|altered|first edition|1st edition|playset|signiert|alteriert|signé|altéré|firmad|alterad|firmat|alterat|auflage|édition|edición|edizione/i;
  /** Offer rows: `articleRow<id>` on product pages, `stockRow<id>` on a seller's own pages. */
  const OFFER_ROWS = '.article-row[id^="articleRow"], .article-row[id^="stockRow"]';
  const OFFER_ROW_ID = /^(?:articleRow|stockRow)(\d+)$/;

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

  /** The kind of product, from its URL: "Singles", "Boosters", "Elite-Trainer-Boxes"… (null when unknown). */
  function productCategory(item) {
    const m = String((item && item.productUrl) || '').match(/\/Products\/([^/?#]+)\//);
    return m ? m[1] : null;
  }

  /**
   * The seller's stock of this kind of product, searched for its name. A
   * seller's pages exist per game and per kind ("/Offers/Singles",
   * "/Offers/Elite-Trainer-Boxes"…), like the product URL; the seller link may
   * come from another game's page (one cart for all games), so the game and
   * language are the article's own.
   */
  function sellerSearchUrl(item) {
    if (!item.sellerUrl) return null;
    const from = parseLocation(item.sellerUrl);
    const slug = (new URL(item.sellerUrl, ORIGIN).pathname.match(/\/Users\/([^/?#]+)/) || [])[1];
    if (!slug) return null;
    const lang = item.lang || from.lang || 'en';
    const game = item.game || from.game || 'Magic';
    const u = new URL(`${ORIGIN}/${lang}/${game}/Users/${slug}/Offers/${productCategory(item) || 'Singles'}`);
    if (item.name) u.searchParams.set('name', item.name);
    return u.toString();
  }

  /** A language id (1–11) from what the page calls it, in any of the site's languages. */
  function languageIdOf(label) {
    return (label && LANGUAGE_ALIASES[String(label).trim().toLowerCase()]) || null;
  }

  /**
   * Cardmarket draws every language flag from one sprite, 16 px per language:
   * the flag's position is the language id, whatever the site's language.
   */
  function languageFromIcon(el) {
    const m = ((el && el.getAttribute && el.getAttribute('style')) || '').match(/background-position:\s*(-?\d+(?:\.\d+)?)px/);
    if (!m) return null;
    const id = Math.round(-Number(m[1]) / 16);
    return LANGUAGES[id] ? id : null;
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
   * Name of the signed-in account, from the profile link in the account menu.
   * Null when the menu has no such link: the account check is then skipped.
   */
  function readUsername(doc) {
    const link = doc.querySelector('#account-dropdown a[href*="/Users/"]');
    const m = link && (link.getAttribute('href') || '').match(/\/Users\/([^/?#]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  const LOOSE_TOKEN_RE = /^[A-Za-z0-9+/=_.:-]{16,}$/;
  const isToken = (value) => typeof value === 'string' && (TOKEN_RE.test(value.trim()) || LOOSE_TOKEN_RE.test(value.trim()));

  /** Places in raw HTML / inline scripts where the token shows up. */
  const TOKEN_IN_HTML = [
    /name=["']__cmtkn["'][^>]*?value=["']([^"']{16,})["']/i,
    /value=["']([^"']{16,})["'][^>]*?name=["']__cmtkn["']/i,
    /__cmtkn\\?["']?\s*[:=,]\s*\\?["']([A-Za-z0-9+/=_.:-]{16,})\\?["']/i,
    /__cmtkn['"\s:=]+([0-9a-f]{32,})/i,
  ];

  /**
   * The session's CSRF token (`__cmtkn`) from a page: form fields first, then
   * data attributes and meta tags, then the raw HTML (inline scripts). Today
   * it is a long hex string; any token-like value is accepted too.
   */
  function findToken(doc) {
    const values = [...doc.querySelectorAll('input[name="__cmtkn"]')].map((input) => (input.value || '').trim());
    const fromInput = values.find((v) => TOKEN_RE.test(v)) || values.find((v) => LOOSE_TOKEN_RE.test(v));
    if (fromInput) return fromInput;
    for (const el of doc.querySelectorAll('[data-cmtkn], meta[name="__cmtkn"]')) {
      const value = el.getAttribute('data-cmtkn') || el.getAttribute('content');
      if (isToken(value)) return value.trim();
    }
    // Generically named places may hold other tokens: only a hex value counts there.
    for (const el of doc.querySelectorAll('[data-token], meta[name="csrf-token"]')) {
      const value = (el.getAttribute('data-token') || el.getAttribute('content') || '').trim();
      if (TOKEN_RE.test(value)) return value;
    }
    const html = doc.documentElement ? doc.documentElement.outerHTML : '';
    for (const re of TOKEN_IN_HTML) {
      const m = html.match(re);
      if (m && isToken(m[1])) return m[1].trim();
    }
    return null;
  }

  /** What a page offers in the way of a token — for the error report when none is found. */
  function tokenStats(doc) {
    const html = doc.documentElement ? doc.documentElement.outerHTML : '';
    return [
      `inputs=${doc.querySelectorAll('input[name="__cmtkn"]').length}`,
      `cmtkn-in-html=${(html.match(/cmtkn/gi) || []).length}`,
      `forms=${doc.querySelectorAll('form').length}`,
      `ajax-forms=${doc.querySelectorAll('[data-ajax-action]').length}`,
    ].join(' ');
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
      } else if (!node.closest('tr[data-article-id], #account-dropdown, header')) {
        current = node;
      }
    });
    return map;
  }

  /**
   * Cardmarket's numeric seller id for a cart row: from the row's own trash
   * control (its onclick carries `idSeller`) or the shipment block's hidden
   * `idSeller` field. Needed to recognise "remove everything from this seller".
   */
  function sellerIdOf(tr) {
    const fromRow = [...tr.querySelectorAll('[onclick*="idSeller"], [data-seller-id], [data-id-seller]')]
      .map((el) => el.getAttribute('data-seller-id') || el.getAttribute('data-id-seller') || ((el.getAttribute('onclick') || '').match(/idSeller['"\s:=]+(\d+)/i) || [])[1])
      .find((v) => /^\d+$/.test(v || ''));
    if (fromRow) return fromRow;
    const block = tr.closest('section.shipment-block, section[id*="seller"], .shipment-block');
    const input = block && block.querySelector('input[name="idSeller"]');
    return input && /^\d+$/.test(input.value || '') ? input.value : null;
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
    // On the German, French… site the language is called "Englisch", "Anglais"…
    const languageLabel = iconLabels.find((l) => languageIdOf(l)) || LANGUAGES[languageId] || null;
    const extras = iconLabels.filter((l) => l !== languageLabel && !languageIdOf(l));

    const imageUrl = findImageUrl(tr.querySelector('.thumbnail-icon')) || findImageUrl(tr);

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
      language: languageId || languageIdOf(languageLabel),
      languageLabel,
      foil: extras.some((l) => /foil/i.test(l)),
      extras,
      comment: clean(tr.getAttribute('data-comment')) || null,
      ...sellerFromLink(sellerLink, baseUrl),
      sellerId: sellerIdOf(tr),
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

  const IMAGE_URL_RE = /(?:https?:)?\/\/product-images[^"'\s)<>]*?\.(?:jpe?g|png|webp)/i;
  const IMAGE_ATTRS = ['aria-label', 'data-bs-original-title', 'data-bs-title', 'title', 'data-original-title', 'src', 'data-src', 'data-echo', 'data-original', 'srcset', 'style', 'content'];

  /**
   * The first Cardmarket product image URL under `root`, wherever the page put
   * it: a tooltip with an <img>, a (lazy) src, a background image or a meta tag.
   */
  function findImageUrl(root) {
    if (!root) return null;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const attr of IMAGE_ATTRS) {
        const value = el.getAttribute && el.getAttribute(attr);
        const m = value && value.match(IMAGE_URL_RE);
        if (m) return m[0].startsWith('//') ? `https:${m[0]}` : m[0].replace(/^http:/, 'https:');
      }
    }
    return null;
  }

  /** Every product picture URL under `root`, in page order. */
  function imageUrls(root) {
    const urls = [];
    for (const el of root ? [root, ...root.querySelectorAll('*')] : []) {
      for (const attr of IMAGE_ATTRS) {
        const value = el.getAttribute && el.getAttribute(attr);
        const m = value && value.match(IMAGE_URL_RE);
        if (m) urls.push(m[0].startsWith('//') ? `https:${m[0]}` : m[0].replace(/^http:/, 'https:'));
      }
    }
    return urls;
  }

  /** The product id in a picture URL: ".../<id>/<id>.jpg". */
  const productIdFromImage = (url) => (String(url || '').match(/\/(\d+)\/\1\.(?:jpe?g|png|webp)/i) || [])[1] || null;

  /** The product a product page is about (a hidden form field carries its id). */
  function pageProductId(doc) {
    const input = doc.querySelector('input[name="idProduct"]');
    return input && /^\d+$/.test(input.value || '') ? input.value : null;
  }

  /**
   * The picture of the product a page is about. Magic pages show a carousel
   * with the previous and next card of the set as well, so the picture of
   * this product is the one with its id in the URL.
   */
  function productImage(doc, productId = pageProductId(doc)) {
    const urls = imageUrls(doc.querySelector('#image, .image, [class*="product-image"]'));
    return (
      (productId && urls.find((url) => productIdFromImage(url) === String(productId))) ||
      urls[0] ||
      findImageUrl(doc.querySelector('meta[property="og:image"]'))
    );
  }

  /** The shipping cost shown under an offer's price on product pages (null when not shown). */
  function offerShipping(row) {
    const icon = row.querySelector('.price-container .fonticon-shipping-methods');
    const box = icon && icon.parentElement;
    const m = clean(box && box.textContent).match(/(\d[\d.\s]*,\d{2})/);
    return m ? parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.')) : null;
  }

  /**
   * One offer row: `articleRow<id>` on a product page, `stockRow<id>` on a
   * seller's own pages.
   */
  function parseOfferRow(row, { baseUrl }) {
    const doc = row.ownerDocument;
    const articleId = ((row.id || '').match(OFFER_ROW_ID) || [])[1];
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
    let languageEl = null;
    attrs.querySelectorAll('[aria-label], [title], [data-bs-original-title], [data-original-title]').forEach((el) => {
      if (el.closest('svg') || el.closest('.expansion-symbol') || el.closest('.article-condition')) return;
      const label = labelOf(el);
      if (!label || labels.includes(label)) return;
      labels.push(label);
      if (!languageEl && !EXTRA_RE.test(label)) languageEl = el;
    });
    const extras = labels.filter((l) => EXTRA_RE.test(l));
    const languageLabel = labels.find((l) => !EXTRA_RE.test(l)) || null;
    const language = languageFromIcon(languageEl) || languageIdOf(languageLabel);
    // On product pages the page is the product; seller pages show it in each row's picture.
    const ownImage = findImageUrl(row.querySelector('.thumbnail-icon')) || findImageUrl(row);
    const productId = (!productLink && pageProductId(doc)) || productIdFromImage(ownImage);
    // A sealed product's page title names its kind ("Elite Trainer Boxes"), not an expansion.
    const kind = (productCategory({ productUrl }) || '').replace(/-/g, ' ').toLowerCase();
    const titleExpansion = title.expansion && title.expansion.toLowerCase() !== kind ? title.expansion : null;

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
    const comment = row.querySelector('.product-comments .text-truncate, .product-comments');

    return {
      articleId,
      productId,
      game: productLoc.game || pageLoc.game,
      lang: productLoc.lang || pageLoc.lang,
      name: name || `#${articleId}`,
      expansion: (expansionEl && labelOf(expansionEl)) || titleExpansion,
      number: null,
      productUrl,
      imageUrl: ownImage || productImage(doc, productId),
      price,
      shipping: offerShipping(row),
      available: parseInt(clean(countEl && countEl.textContent), 10) || null,
      condition: CONDITION_IDS[conditionLabel] || null,
      conditionLabel,
      language,
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
  let bridgePort = null;
  const pendingCalls = new Map();
  const bridgeListeners = new Set();

  /**
   * Open the private channel to the page bridge: one window message carrying
   * a MessagePort, after which everything goes over that port. Resolves to
   * the port, or null when no bridge answers.
   */
  function connectBridge() {
    if (bridgePort) return bridgePort;
    bridgePort = new Promise((resolve) => {
      if (typeof window === 'undefined' || location.origin !== ORIGIN || typeof MessageChannel === 'undefined') {
        resolve(null);
        return;
      }
      const { port1, port2 } = new MessageChannel();
      const timer = setTimeout(() => resolve(null), BRIDGE_PING_MS);
      port1.onmessage = (event) => {
        const msg = event.data;
        if (!msg) return;
        if (msg.__cmcs === 'ready') {
          clearTimeout(timer);
          resolve(port1);
        } else if (msg.__cmcs === 'response') {
          const call = pendingCalls.get(msg.id);
          if (!call) return;
          pendingCalls.delete(msg.id);
          clearTimeout(call.timer);
          call.resolve(msg);
        } else if (msg.__cmcs === 'event') {
          for (const listener of bridgeListeners) listener(msg);
        }
      };
      window.postMessage({ __cmcs: 'hello' }, location.origin, [port2]);
    });
    return bridgePort;
  }

  async function bridgeCall(payload, timeoutMs) {
    const port = await connectBridge();
    if (!port) throw new Error('no page bridge');
    return new Promise((resolve, reject) => {
      const id = `cmcs-${crypto.randomUUID()}`;
      const timer = setTimeout(() => {
        pendingCalls.delete(id);
        reject(new Error('bridge timeout'));
      }, timeoutMs);
      pendingCalls.set(id, { resolve, timer });
      port.postMessage({ __cmcs: 'request', id, ...payload });
    });
  }

  function bridgeAvailable() {
    return connectBridge().then(Boolean);
  }

  /** Events from the page bridge (the site removed articles from the cart). */
  function onBridgeEvent(listener) {
    bridgeListeners.add(listener);
    connectBridge();
  }

  const headerBag = (entries) => ({ get: (name) => entries[String(name).toLowerCase()] ?? null });

  /**
   * One request to Cardmarket. `via`: 'auto' (page first), 'page' or
   * 'extension'. Resolves to { status, ok, url, text, headers, via }.
   */
  async function request(url, { method = 'GET', headers = {}, body } = {}, via = 'auto') {
    // A write (POST) is never sent twice: if it went out through the page and
    // its answer got lost, a second attempt could add an article twice.
    if (via === 'auto' && method !== 'GET') via = (await bridgeAvailable()) ? 'page' : 'extension';
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

  /**
   * Find the session token wherever it is: this page, the site's own requests
   * (seen by the page bridge), or another signed-in page that carries it.
   * Resolves to { token, source } or { token: null, detail }.
   */
  async function discoverToken({ lang, game, extraPages = [], exclude = null } = {}) {
    const usable = (t) => t && t !== exclude;
    const tried = [];

    if (isSignedIn(document)) {
      const fromPage = findToken(document);
      if (usable(fromPage)) return { token: fromPage, source: 'page' };
    }
    tried.push('page');

    if (await bridgeAvailable()) {
      try {
        const reply = await bridgeCall({ getToken: true }, BRIDGE_PING_MS);
        if (usable(reply.token) && isToken(reply.token)) return { token: reply.token, source: 'site-request' };
      } catch {
        // No answer: try the pages below.
      }
      tried.push('site-request');
    }

    const pages = [cartUrl(lang, game), ...extraPages.filter(Boolean), `${ORIGIN}/${lang}/${game}/Wants`, `${ORIGIN}/${lang}/${game}`];
    for (const url of [...new Set(pages)]) {
      const path = new URL(url).pathname;
      try {
        const { doc } = await fetchDocument(url);
        tried.push(path);
        if (!isSignedIn(doc)) continue;
        const token = findToken(doc);
        if (usable(token)) return { token, source: path };
      } catch (err) {
        if (err.kind === 'challenge' || err.kind === 'rate_limited') throw err;
        tried.push(`${path} (${err.kind || 'error'})`);
      }
    }
    return { token: null, detail: `searched: ${tried.join(', ')} · this page: ${tokenStats(document)}` };
  }

  /** Words around the time at which Cardmarket empties the cart (en/de/fr/es/it/nl). */
  const EXPIRY_WORDS =
    /reserv|expire|emptied|empty|cleared|until|geleert|leer|bis\b|vidé|vider|jusqu|vaciar|vaciará|hasta|svuot|fino|geleegd|tot\b/i;
  const CART_WORDS = /cart|basket|warenkorb|panier|carrito|carrello|winkelmand|mandje|reserv/i;
  const CLOCK_RE = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/;
  const MINUTES_RE = /\b(\d{1,3})\s*(?:min(?:ute[ns]?|uten|utos|uti)?\.?)(?![a-z])/i;
  /** A cart is never kept longer than this; anything later is a misreading. */
  const MAX_EXPIRY_MS = 6 * 60 * 60 * 1000;

  /**
   * When Cardmarket will empty the cart, if the page says so (a notice with a
   * clock time, or "… in 45 minutes"). Returns a timestamp or null. The exact
   * wording on the live site is not confirmed, so only plausible times count.
   */
  function readCartExpiry(doc, now = Date.now()) {
    const candidates = doc.querySelectorAll(
      '[data-countdown], [data-expires], [data-expiry], .alert, [class*="countdown"], [class*="timer"], [class*="expir"], [id*="countdown"], [id*="timer"]',
    );
    for (const el of candidates) {
      if (el.closest('tr[data-article-id], cmcs-cart-saver')) continue;
      for (const attr of ['data-countdown', 'data-expires', 'data-expiry']) {
        const raw = Number(el.getAttribute(attr));
        if (!raw) continue;
        const at = raw > 1e12 ? raw : raw > 1e9 ? raw * 1000 : now + raw * 1000;
        if (at > now && at - now <= MAX_EXPIRY_MS) return at;
      }
      const text = clean(el.textContent);
      if (!text || text.length > 300 || !EXPIRY_WORDS.test(text) || !CART_WORDS.test(text)) continue;
      const clock = text.match(CLOCK_RE);
      if (clock) {
        const at = new Date(now);
        at.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
        if (at.getTime() <= now) at.setDate(at.getDate() + 1);
        if (at.getTime() - now <= MAX_EXPIRY_MS) return at.getTime();
        continue;
      }
      const minutes = text.match(MINUTES_RE);
      if (minutes) {
        const at = now + Number(minutes[1]) * 60 * 1000;
        if (at > now && at - now <= MAX_EXPIRY_MS) return at;
      }
    }
    return null;
  }

  const SHIPPING_WORD = /shipping|versand|porto|envoi|livraison|frais de port|envío|gastos de envío|spedizione|verzend/i;
  const EURO_RE = /(\d{1,4}(?:[.\s]\d{3})*,\d{2})\s*€|€\s*(\d{1,4}(?:,\d{3})*\.\d{2})/;

  function euroValue(text) {
    const m = String(text || '').match(EURO_RE);
    if (!m) return null;
    return m[1] ? parseFloat(m[1].replace(/[.\s]/g, '').replace(',', '.')) : parseFloat(m[2].replace(/,/g, ''));
  }

  /**
   * Per seller block on the cart page: who, and the shipping cost the page
   * shows for that parcel (null when it cannot be found).
   */
  function readShipments(doc, baseUrl) {
    return [...doc.querySelectorAll('section.shipment-block')].map((block) => {
      const link =
        block.querySelector('.seller-info a[href*="/Users/"]') ||
        [...block.querySelectorAll('a[href*="/Users/"]')].find((a) => !a.closest('tr'));
      let shipping = null;
      for (const el of block.querySelectorAll('*')) {
        if (el.closest('tr[data-article-id], table')) continue;
        const own = clean(el.textContent);
        if (!own || own.length > 120 || !SHIPPING_WORD.test(own)) continue;
        const row = el.parentElement ? clean(el.parentElement.textContent) : '';
        const value = euroValue(own) ?? (row.length <= 160 ? euroValue(row) : null);
        if (value != null) {
          shipping = value;
          break;
        }
      }
      return { ...sellerFromLink(link, baseUrl), shipping };
    });
  }

  /**
   * Read a cart page. `trustworthy` says whether the page can be taken as the
   * whole truth: only then may articles that are not on it count as gone.
   */
  function readCartDocument(doc, { baseUrl, lang, game }) {
    const signedIn = isSignedIn(doc);
    const items = signedIn ? parseCart(doc, { baseUrl, lang, game }) : [];
    const headerCount = readHeaderCount(doc);
    const headerTotal = readHeaderTotal(doc);
    const hasShipments = Boolean(doc.querySelector('section.shipment-block, .shipment-block, section[id*="seller"]'));
    return {
      signedIn,
      username: signedIn ? readUsername(doc) : null,
      token: findToken(doc),
      headerCount,
      items,
      expiresAt: signedIn ? readCartExpiry(doc) : null,
      shipments: signedIn ? readShipments(doc, baseUrl) : [],
      ...cartTrust(doc, { signedIn, items, headerCount, headerTotal, hasShipments }),
    };
  }

  /**
   * "Empty" is only believable when nothing on the page says otherwise, and a
   * partly read page is not believable either: a seller block without readable
   * rows, or fewer articles than the header counts (a layout change?). Either
   * would make articles look gone, and a refill would add them a second time.
   */
  function cartTrust(doc, { signedIn, items, headerCount, headerTotal, hasShipments }) {
    if (!signedIn) return { trustworthy: false, untrusted: 'not signed in' };
    if (!items.length) {
      const empty = !(headerCount > 0) && !(headerTotal > 0) && !hasShipments;
      return empty ? { trustworthy: true } : { trustworthy: false, untrusted: `no rows read, header ${headerCount}` };
    }
    const blocks = [...doc.querySelectorAll('section.shipment-block')];
    const unread = blocks.filter((block) => !block.querySelector('tr[data-article-id]')).length;
    if (unread) return { trustworthy: false, untrusted: `${unread} of ${blocks.length} seller blocks without rows` };
    // The header counts articles (copies); accept a count of rows as well.
    const copies = items.reduce((sum, item) => sum + (item.amount || 1), 0);
    if (headerCount > 0 && copies < headerCount && items.length < headerCount) {
      return { trustworthy: false, untrusted: `read ${copies} articles, header says ${headerCount}` };
    }
    return { trustworthy: true };
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

  /** "Not enough copies": retrying with fewer can still work. Checked first, it is the more specific one. */
  const REFUSAL_AMOUNT =
    /not enough|insufficient|requested (amount|quantity)|only \d+ (copies|articles|available)|nicht (genügend|ausreichend)|nur noch \d+|gewünschte (menge|anzahl)|pas assez|quantité|cantidad|insuficiente|quantità|non abbastanza|niet genoeg|hoeveelheid/i;
  /** The offer is gone: sold, withdrawn, reserved by someone else. */
  const REFUSAL_SOLD =
    /no longer|not available|unavailable|does not exist|sold|reserved|nicht (mehr )?verfügbar|nicht mehr vorhanden|existiert nicht|verkauft|reserviert|plus disponible|n'existe|vendu|réservé|ya no está disponible|no existe|vendido|reservado|non è più disponibile|non esiste|venduto|riservato|niet (meer )?beschikbaar|bestaat niet|verkocht|gereserveerd/i;

  /**
   * Why Cardmarket refused to add an article, from its message:
   * 'sold' (the offer is gone), 'amount' (fewer copies left) or 'unknown'
   * (anything else, e.g. an expired token — worth a retry with a fresh one).
   */
  function classifyRefusal(message) {
    const text = String(message || '');
    if (REFUSAL_AMOUNT.test(text)) return 'amount';
    if (REFUSAL_SOLD.test(text)) return 'sold';
    return 'unknown';
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
   * Put articles in the cart, all in one request (the site's own form sends
   * lists too). Resolves to { ok, message, reason } when Cardmarket answered
   * (ok=false means it refused, e.g. an article is gone; with several
   * articles some may still have been added, so read the cart to know) and
   * throws a CardmarketError when the request itself failed.
   */
  async function addArticles({ lang, game, articles, token }) {
    const ids = {};
    const amounts = {};
    for (const { articleId, amount } of articles) {
      ids[articleId] = articleId;
      amounts[articleId] = String(amount || 1);
    }
    const body = new URLSearchParams();
    body.set('__cmtkn', token);
    body.set('idArticle', JSON.stringify(ids));
    body.set('amount', JSON.stringify(amounts));

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
        return parsed.ok
          ? { ok: true, message: parsed.message }
          : { ok: false, message: parsed.message, reason: classifyRefusal(parsed.message) };
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

  /**
   * Take copies of an article out of the cart, the way the cart's trash button
   * does (`idArticle`, `idSeller`, `amount-<id>`). Resolves when Cardmarket
   * answered; read the cart afterwards to know the result.
   */
  async function removeArticle({ lang, game, articleId, sellerId, amount, token }) {
    const body = new URLSearchParams();
    body.set('__cmtkn', token);
    body.set('idArticle', articleId);
    if (sellerId) body.set('idSeller', sellerId);
    body.set(`amount-${articleId}`, String(amount || 1));
    const res = await request(`${ORIGIN}/${lang}/${game}/AjaxAction/ShoppingCart_RemoveArticle`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: body.toString(),
    });
    if (res.status === 429) throw new CardmarketError('rate_limited', null, { retryAfter: retryAfterSeconds(res) });
    if (isChallenge(res.status, res.text, res.headers)) throw new CardmarketError('challenge', null, { detail: describe(res) });
    if (!res.ok) throw new CardmarketError('http_error', `HTTP ${res.status}`, { status: res.status, detail: describe(res) });
    return { ok: true };
  }

  /** Put one article in the cart; see addArticles. */
  function addArticle({ lang, game, articleId, amount, token }) {
    return addArticles({ lang, game, articles: [{ articleId, amount }], token });
  }

  CMCS.cm = {
    ORIGIN,
    LANGUAGES,
    CONDITIONS,
    OFFER_ROWS,
    productCategory,
    languageIdOf,
    CardmarketError,
    parseLocation,
    cartUrl,
    alternativesUrl,
    offerUrl,
    sellerSearchUrl,
    mapRowsToSellers,
    findImageUrl,
    parseCartRow,
    parseOfferRow,
    readHeaderCount,
    readUsername,
    readCartExpiry,
    readShipments,
    classifyRefusal,
    isSignedIn,
    findToken,
    parseCart,
    parseOrderArticleIds,
    readCartDocument,
    looksLikeLoginPage,
    discoverToken,
    tokenStats,
    request,
    onBridgeEvent,
    isChallenge,
    parseAjaxResponse,
    fetchDocument,
    fetchCart,
    addArticle,
    addArticles,
    removeArticle,
    endpointPreference,
  };
})(globalThis);

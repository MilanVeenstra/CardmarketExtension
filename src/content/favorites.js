/*
 * Favourites on cardmarket.com: a star next to every offer.
 *
 * - Offer rows (`div.article-row#articleRow<id>`) on product, card and seller
 *   pages, and article rows in the shopping cart get a ☆ button. Clicking it
 *   stores that exact offer (seller, condition, language, price…).
 * - When a favourite shows up on a page its price and available count are
 *   refreshed, so the list stays current without extra requests.
 * - Links from the popup end in #articleRow<id>: the offer is scrolled into
 *   view and highlighted, or — when it is not on the page — a notice offers
 *   the seller's stock and similar offers instead.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { cm, store, ui, t } = CMCS;

  const OFFER_ROWS = 'div.article-row[id^="articleRow"]';
  const DECORATED = 'data-cmcs-fav';

  const STAR_CSS = `
    :host { display: inline-flex; vertical-align: middle; }
    button {
      appearance: none; border: 0; background: transparent; cursor: pointer;
      width: 28px; height: 28px; padding: 0; border-radius: 6px;
      display: inline-flex; align-items: center; justify-content: center;
      color: #8a94a3;
    }
    button:hover { background: rgba(127, 127, 127, 0.15); color: #e09a00; }
    button[aria-pressed="true"] { color: #e09a00; }
    button:focus-visible { outline: 2px solid #1a5fd6; outline-offset: 1px; }
    svg { width: 18px; height: 18px; }
  `;

  let loc;
  let favorites = {};
  /** articleId → star buttons on this page (cart rows can appear twice). */
  const stars = new Map();

  function paint(button, articleId) {
    const on = Boolean(favorites[articleId]);
    button.setAttribute('aria-pressed', String(on));
    const label = t(on ? 'favRemove' : 'favAdd');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.replaceChildren(ui.icon(on ? 'starFilled' : 'star'));
  }

  function createStar(articleId, readArticle) {
    const host = document.createElement('cmcs-fav');
    host.dataset.articleId = articleId;
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STAR_CSS;
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', async (event) => {
      // Rows can have their own click behaviour on Cardmarket; keep this click ours.
      event.preventDefault();
      event.stopPropagation();
      const article = readArticle();
      if (article) await store.toggleFavorite(article);
    });
    shadow.append(style, button);
    paint(button, articleId);
    if (!stars.has(articleId)) stars.set(articleId, new Set());
    stars.get(articleId).add(button);
    return host;
  }

  /** Add stars to rows that do not have one yet. Returns the newly decorated offer rows. */
  function decorate() {
    const fresh = [];
    document.querySelectorAll(`${OFFER_ROWS}:not([${DECORATED}])`).forEach((row) => {
      row.setAttribute(DECORATED, '');
      const articleId = row.id.replace(/\D+/g, '');
      if (!articleId) return;
      const star = createStar(articleId, () => cm.parseOfferRow(row, { baseUrl: location.href }));
      const target = row.querySelector('.col-offer .actions-container') || row.querySelector('.col-offer') || row;
      target.prepend(star);
      fresh.push(row);
    });

    if (loc.isCart) {
      const rows = document.querySelectorAll(`tr[data-article-id]:not([${DECORATED}])`);
      const sellers = rows.length ? cm.mapRowsToSellers(document) : null;
      rows.forEach((tr) => {
        tr.setAttribute(DECORATED, '');
        const articleId = tr.getAttribute('data-article-id');
        const star = createStar(articleId, () =>
          cm.parseCartRow(tr, { baseUrl: location.href, game: loc.game, lang: loc.lang, sellers }),
        );
        const wrap = document.createElement('div');
        wrap.className = 'col-auto';
        wrap.append(star);
        (tr.querySelector('td.info .row') || tr.querySelector('td.info') || tr.lastElementChild).append(wrap);
      });
    }
    return fresh;
  }

  /** Favourites seen on the page get their current price / stock. */
  async function refreshSeen(rows) {
    const patches = {};
    for (const row of rows) {
      const articleId = row.id.replace(/\D+/g, '');
      const fav = favorites[articleId];
      if (!fav) continue;
      const seen = cm.parseOfferRow(row, { baseUrl: location.href });
      if (!seen) continue;
      patches[articleId] = {
        price: seen.price != null ? seen.price : fav.price,
        available: seen.available != null ? seen.available : fav.available,
        lastSeenAt: Date.now(),
        unavailable: false,
        unavailableMessage: null,
      };
    }
    if (Object.keys(patches).length) await store.patchFavorites(patches);
  }

  /** Arriving from the popup with #articleRow<id>: show that offer. */
  function focusFromHash() {
    const match = location.hash.match(/^#articleRow(\d+)$/);
    if (!match) return;
    const articleId = match[1];
    const row = document.getElementById(`articleRow${articleId}`);
    if (row) {
      row.setAttribute('data-cmcs-highlight', '');
      row.style.outline = '3px solid #e09a00';
      row.style.outlineOffset = '-3px';
      row.style.borderRadius = '6px';
      row.scrollIntoView({ block: 'center' });
      return;
    }
    const fav = favorites[articleId];
    if (!fav) return;
    CMCS.widget.showNotice({
      title: t('favNotOnPageTitle'),
      text: t('favNotOnPageLead', fav.seller || '?'),
      links: [
        { label: t('favSellerOffers'), href: cm.sellerSearchUrl(fav) },
        { label: t('findAlternative'), href: cm.alternativesUrl(fav) },
      ].filter((link) => link.href),
    });
  }

  function repaintAll() {
    for (const [articleId, buttons] of stars) {
      for (const button of buttons) {
        if (button.isConnected) paint(button, articleId);
        else buttons.delete(button);
      }
    }
  }

  async function init(location_) {
    loc = location_;
    favorites = await store.getFavorites();
    store.onChanged((changes) => {
      if (!changes[store.KEYS.favorites]) return;
      favorites = changes[store.KEYS.favorites].newValue || {};
      repaintAll();
    });

    await refreshSeen(decorate());
    focusFromHash();

    // "Load more" adds offer rows later; decorate those too.
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const fresh = decorate();
        if (fresh.length) refreshSeen(fresh);
      }, 250);
    }).observe(document.body, { childList: true, subtree: true });
  }

  CMCS.favorites = { init };
})(globalThis);

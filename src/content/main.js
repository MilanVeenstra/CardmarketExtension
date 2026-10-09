/*
 * Content script entry point, runs on every www.cardmarket.com page.
 *
 * 1. On the cart page: save every article in it (auto-tracking).
 * 2. On other pages: when the cart counter in the header changed since the
 *    last look, fetch the cart once and update the saved list. That is how an
 *    automatically emptied cart is noticed.
 * 3. On order pages: articles you bought are removed from the saved list.
 *    Articles you remove (or check out) yourself are forgotten, not "missing".
 * 4. Mount the on-page widget, add favourite stars to offers, and pick up a
 *    refill queued from the popup.
 */
(async function main() {
  'use strict';

  const { cm, store } = globalThis.CMCS;
  const loc = cm.parseLocation(location.href);
  if (!loc.lang || !loc.game) return;

  const HEADER_DEBOUNCE_MS = 1500;
  const USER_REMOVAL_TTL_MS = 10 * 60 * 1000;
  // Words on controls that take articles out of the cart on purpose (site languages en/de/fr/es/it).
  const REMOVE_HINT = /remove|delete|trash|empty|clear|entfernen|löschen|leeren|supprimer|vider|eliminar|vaciar|rimuovi|elimina|svuota/i;
  const REMOVE_ICON = '[class*="fonticon-delete"], [class*="fonticon-trash"], [class*="fonticon-remove"], [class*="fonticon-bin"]';
  const CHECKOUT_HINT = /checkout|commit|purchase|buy|kaufen|bestellen|acheter|commander|comprar|acquist|ordina/i;
  const BLOCK = 'section.shipment-block, section[id*="seller"], .shipment-block';

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;
    if (message.type === 'cmcs.ping') {
      sendResponse({ ok: true, lang: loc.lang, game: loc.game });
      return false;
    }
    if (message.type === 'cmcs.refill') {
      CMCS.refill.start(message.articleIds || []).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (message.type === 'cmcs.sync') {
      syncFromServer()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.kind || err.message }));
      return true;
    }
    return false;
  });

  /** Store a cart reading. Articles the user removed by hand are forgotten, not marked missing. */
  async function applyCart(cart) {
    if (!cart.signedIn) return null;
    const settings = await store.getSettings();
    // An unreadable cart page never marks anything as missing.
    const result = await store.syncCart(cart.items, {
      game: loc.game,
      addNew: settings.autoTrack,
      markMissing: cart.trustworthy,
    });

    // Articles the user just removed or bought, and that are really gone from
    // the cart, leave the saved list.
    const now = Date.now();
    const meta = await store.getMeta();
    const removedByUser = meta.userRemoved || {};
    const inCartNow = new Set(cart.items.map((item) => item.articleId));
    const saved = await store.getItems();
    const forget = cart.trustworthy
      ? Object.keys(removedByUser).filter(
          (id) => now - removedByUser[id] < USER_REMOVAL_TTL_MS && !inCartNow.has(id) && saved[id],
        )
      : [];
    if (forget.length) await store.removeItems(forget);

    await store.updateMeta((current) => {
      const userRemoved = {};
      for (const [id, at] of Object.entries(current.userRemoved || {})) {
        if (now - at < USER_REMOVAL_TTL_MS && !forget.includes(id)) userRemoved[id] = at;
      }
      return {
        ...current,
        userRemoved,
        sync: { ...(current.sync || {}), [loc.game]: { at: now, headerCount: cart.headerCount } },
      };
    });
    return result;
  }

  function syncFromPage() {
    return applyCart(cm.readCartDocument(document, { baseUrl: location.href, lang: loc.lang, game: loc.game }));
  }

  async function syncFromServer() {
    return applyCart(await cm.fetchCart(loc.lang, loc.game));
  }

  async function syncIfHeaderChanged() {
    const count = cm.readHeaderCount(document);
    if (count === null) return;
    const meta = await store.getMeta();
    const last = (meta.sync || {})[loc.game];
    if (last && last.headerCount === count) return;
    try {
      await syncFromServer();
    } catch (err) {
      // Challenge page, rate limit, network… just try again on a later page.
      console.debug('[Cart Saver] cart sync skipped:', err.kind || err);
    }
  }

  /**
   * The site updates the header counter in place when you add something. Watch
   * the surrounding header rather than `#cart` itself, in case the whole cart
   * link gets replaced; the count comparison keeps unrelated changes cheap.
   */
  function watchHeader() {
    const cartLink = document.querySelector('#cart');
    if (!cartLink) return;
    const scope = cartLink.closest('header, nav') || cartLink.parentElement;
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(syncIfHeaderChanged, HEADER_DEBOUNCE_MS);
    }).observe(scope, { subtree: true, childList: true, characterData: true });
  }

  // ---------------------------------------------------------------------------
  // Articles that leave the cart because of the user (removed or bought) are
  // forgotten instead of marked "missing". Three independent signals mark
  // them; the next cart reading then forgets only what is really gone.
  //  1. the site's own removal request (ShoppingCart_RemoveArticle & co.),
  //     reported by the page bridge once it succeeded;
  //  2. a remove / checkout form being submitted;
  //  3. a click on a remove or checkout control (row, seller block or cart).
  // ---------------------------------------------------------------------------

  let syncTimer = null;
  function scheduleSync(delay = 1200) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncFromServer().catch((err) => console.debug('[Cart Saver] sync after removal skipped:', err.kind || err));
    }, delay);
  }

  async function markLeftByUser(articleIds) {
    const ids = [...new Set(articleIds.filter((id) => /^\d+$/.test(String(id))))];
    if (!ids.length) return;
    const now = Date.now();
    await store.updateMeta((meta) => {
      const userRemoved = { ...(meta.userRemoved || {}) };
      for (const id of ids) userRemoved[id] = now;
      return { ...meta, userRemoved };
    });
  }

  const rowIds = (scope) => [...scope.querySelectorAll('tr[data-article-id]')].map((tr) => tr.getAttribute('data-article-id'));

  /** Signal 1: the page bridge saw the site remove articles. */
  function watchSiteRemovals() {
    window.addEventListener('message', async (event) => {
      const msg = event.data;
      if (event.source !== window || !msg || msg.__cmcs !== 'event' || msg.type !== 'cart-removal') return;
      const ids = Array.isArray(msg.articleIds) ? [...msg.articleIds] : [];
      const sellerIds = Array.isArray(msg.sellerIds) ? msg.sellerIds.map(String) : [];
      // "Remove everything from this seller" carries only the seller.
      if (!ids.length && sellerIds.length) {
        const items = await store.getItems();
        for (const item of Object.values(items)) {
          if (item.sellerId && sellerIds.includes(String(item.sellerId))) ids.push(item.articleId);
        }
      }
      // An action that names nothing (e.g. "empty cart") applies to the whole cart of this page.
      if (!ids.length && !sellerIds.length && loc.isCart) ids.push(...rowIds(document));
      await markLeftByUser(ids);
      scheduleSync();
    });
  }

  function hintOf(control) {
    return [
      control.className,
      control.getAttribute('onclick'),
      control.getAttribute('data-ajax-action'),
      control.getAttribute('formaction'),
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('data-bs-original-title'),
      control.getAttribute('name'),
      control.getAttribute('value'),
    ]
      .filter(Boolean)
      .join(' ');
  }

  /** Which articles a remove / checkout control on the cart page is about. */
  function scopeIds(control) {
    const row = control.closest('tr[data-article-id]');
    if (row) return [row.getAttribute('data-article-id')];
    const block = control.closest(BLOCK);
    return rowIds(block || document);
  }

  /** Signals 2 and 3, on the cart page. */
  function watchCartPageActions() {
    document.addEventListener(
      'click',
      (event) => {
        const control = event.target.closest && event.target.closest('button, a, [onclick], [role="button"], input[type="submit"]');
        if (!control || control.closest('cmcs-cart-saver')) return;
        // A link to a product or seller is never a removal, whatever the card is called.
        if (control.matches('a[href*="/Products/"], a[href*="/Users/"], a[href*="/Expansions/"]')) return;
        const hint = hintOf(control);
        const isRemove = REMOVE_HINT.test(hint) || Boolean(control.matches(REMOVE_ICON) || control.querySelector(REMOVE_ICON));
        // Checkout buttons are recognised by their label too, but only outside article rows.
        const label = control.closest('tr[data-article-id]') ? '' : (control.textContent || '').trim().slice(0, 60);
        const isCheckout = !isRemove && (CHECKOUT_HINT.test(hint) || CHECKOUT_HINT.test(label));
        if (isRemove || isCheckout) markLeftByUser(scopeIds(control));
      },
      true,
    );

    document.addEventListener(
      'submit',
      (event) => {
        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;
        const hint = [form.getAttribute('action'), form.getAttribute('data-ajax-action'), form.id, form.className].filter(Boolean).join(' ');
        if (!REMOVE_HINT.test(hint) && !CHECKOUT_HINT.test(hint)) return;
        const ids = [];
        for (const [key, value] of new FormData(form).entries()) {
          const m = key.match(/^idArticle\[(\d+)\]$/) || key.match(/^amount-(\d+)$/);
          if (m) ids.push(m[1]);
          if (key === 'idArticle' && /^\d+$/.test(String(value))) ids.push(String(value));
        }
        markLeftByUser(ids.length ? ids : scopeIds(form));
      },
      true,
    );
  }

  try {
    if (loc.isOrder) {
      const bought = cm.parseOrderArticleIds(document);
      if (bought.length) await store.removeItems(bought);
    }

    watchSiteRemovals();
    await CMCS.widget.mount(loc);
    await CMCS.favorites.init(loc);

    if (cm.isSignedIn(document)) {
      if (loc.isCart) {
        await syncFromPage();
        watchCartPageActions();
      } else {
        await syncIfHeaderChanged();
      }
      watchHeader();
    }

    await CMCS.refill.resumePending();

    // Local thumbnails for the popup, made quietly once the page has settled.
    setTimeout(() => CMCS.thumbs.capture().catch(() => {}), 2000);
  } catch (err) {
    console.warn('[Cart Saver]', err);
  }
})();

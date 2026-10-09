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
  /** After a reading that could not be used (unreadable page, another account), wait this long before the next. */
  const RETRY_UNUSABLE_MS = 60 * 1000;
  /** Read the cart again after this long, even when the header count looks the same (a sold card may have been swapped). */
  const SYNC_MAX_AGE_MS = 15 * 60 * 1000;
  // Words on controls that take articles out of the cart on purpose (site languages en/de/fr/es/it).
  const REMOVE_HINT = /remove|delete|trash|empty|clear|entfernen|löschen|leeren|supprimer|vider|eliminar|vaciar|rimuovi|elimina|svuota/i;
  const REMOVE_ICON = '[class*="fonticon-delete"], [class*="fonticon-trash"], [class*="fonticon-remove"], [class*="fonticon-bin"]';
  const CHECKOUT_HINT = /checkout|commit|purchase|buy|kaufen|bestellen|acheter|commander|comprar|acquist|ordina/i;
  const BLOCK = 'section.shipment-block, section[id*="seller"], .shipment-block';
  /** The site's menus: clicks there never take anything out of the cart. */
  const SITE_CHROME = 'header, nav, footer, .navbar, #account-dropdown, [role="navigation"], cmcs-cart-saver';

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
    if (message.type === 'cmcs.undo') {
      // "Ongedaan maken" from the popup: this tab has the session to take it back.
      CMCS.refill.undo(message.jobId).then(sendResponse, (err) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
    if (message.type === 'cmcs.sync') {
      withSyncLock(syncFromServer)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ ok: false, error: err.kind || err.message }));
      return true;
    }
    return false;
  });

  /**
   * Store a cart reading. Articles the user removed by hand are forgotten,
   * not marked missing; when they removed only some copies, the lower amount
   * becomes what they want. A cart of another account changes nothing.
   */
  async function applyCart(cart) {
    if (!cart.signedIn) return null;
    if (!(await checkAccount(cart.username))) {
      await store.updateMeta((current) => ({ ...current, cartTried: Date.now() }));
      return null;
    }
    const settings = await store.getSettings();
    const now = Date.now();
    const meta = await store.getMeta();
    const removedByUser = {};
    for (const [id, at] of Object.entries(meta.userRemoved || {})) {
      if (now - at < USER_REMOVAL_TTL_MS) removedByUser[id] = at;
    }
    const inCartNow = new Set(cart.items.map((item) => item.articleId));
    // Still there, with fewer copies than last time: the user lowered the amount.
    const before = await store.getItems();
    const lowered = cart.trustworthy
      ? cart.items
          .filter((item) => removedByUser[item.articleId] && before[item.articleId] && item.amount < before[item.articleId].amount)
          .map((item) => item.articleId)
      : [];

    // One cart for all games; an unreadable cart page never marks anything as missing.
    const result = await store.syncCart(cart.items, {
      addNew: settings.autoTrack,
      markMissing: cart.trustworthy,
      acceptAmount: Object.fromEntries(lowered.map((id) => [id, true])),
    });

    // Articles the user just removed or bought, and that are really gone from
    // the cart, leave the saved list.
    const saved = await store.getItems();
    const forget = cart.trustworthy ? Object.keys(removedByUser).filter((id) => !inCartNow.has(id) && saved[id]) : [];
    if (forget.length) await store.removeItems(forget);

    const handled = new Set([...forget, ...lowered]);
    await store.updateMeta((current) => {
      const userRemoved = {};
      for (const [id, at] of Object.entries(current.userRemoved || {})) {
        if (now - at < USER_REMOVAL_TTL_MS && !handled.has(id)) userRemoved[id] = at;
      }
      const next = {
        ...current,
        userRemoved,
        // A reading that could not be trusted does not count: try again soon, not in 15 minutes.
        cartSync: cart.trustworthy ? { at: now, headerCount: cart.headerCount } : current.cartSync,
        cartTried: cart.trustworthy ? null : now,
        // The cart page also says when it will be emptied and what shipping costs.
        cartExpiry: cart.items.length ? cart.expiresAt || null : null,
        shipping: { at: now, shipments: cart.shipments || [] },
      };
      delete next.sync; // the old per-game records
      return next;
    });

    // Articles that fell out while you were looking elsewhere: a notification.
    // What you removed or bought yourself is forgotten above and does not count.
    const fellOut = result ? result.newlyMissing.filter((id) => !forget.includes(id)) : [];
    if (fellOut.length && document.visibilityState !== 'visible') {
      chrome.runtime
        .sendMessage({ type: 'cmcs.notify', kind: 'emptied', count: fellOut.length, lang: loc.lang, game: loc.game })
        .catch(() => {});
    }
    return result;
  }

  /** One tab reads the cart at a time; the others skip (they would read the same). */
  function withSyncLock(fn) {
    if (!navigator.locks) return fn();
    return navigator.locks.request('cmcs.sync', { ifAvailable: true }, (lock) => (lock ? fn() : null));
  }

  /**
   * The saved list belongs to one Cardmarket account. Logged in as someone
   * else, nothing is saved or marked missing until the user says otherwise
   * (the widget offers that). Resolves to true when the cart may be used.
   */
  async function checkAccount(username) {
    if (!username) return true;
    const meta = await store.getMeta();
    if (meta.account && meta.account !== username) {
      if (meta.accountMismatch !== username) await store.updateMeta((current) => ({ ...current, accountMismatch: username }));
      return false;
    }
    if (meta.account !== username || meta.accountMismatch) {
      await store.updateMeta((current) => ({ ...current, account: username, accountMismatch: null }));
    }
    return true;
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
    const last = meta.cartSync;
    if (last && last.headerCount === count && Date.now() - last.at < SYNC_MAX_AGE_MS) return;
    // The last reading was of no use (another account, an unreadable page): not on every page load.
    if (meta.cartTried && Date.now() - meta.cartTried < RETRY_UNUSABLE_MS) return;
    try {
      await withSyncLock(syncFromServer);
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
    // A change between reading the page and starting to watch would be missed otherwise.
    syncIfHeaderChanged();
  }

  // ---------------------------------------------------------------------------
  // Articles that leave the cart because of the user (removed or bought) are
  // forgotten instead of marked "missing". Four independent signals mark
  // them; the next cart reading then forgets only what is really gone.
  //  1. the site's own removal request (ShoppingCart_RemoveArticle & co., also
  //     when hidden in an obfuscated `args` value), reported by the page bridge
  //     once it succeeded;
  //  2. a remove / checkout form being submitted;
  //  3. a click on a remove or checkout control (row, seller block or cart);
  //  4. on the cart page: rows that disappear, or show fewer copies, right
  //     after you clicked or typed something there — whatever request the
  //     site used for it.
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
    cm.onBridgeEvent(async (msg) => {
      if (msg.type !== 'cart-removal') return;
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

  /** Rows only count as removed by you this soon after a click or key press on the page. */
  const INTERACTION_WINDOW_MS = 15 * 1000;

  /** Signal 4: what the cart page itself shows changing after you did something. */
  function watchCartRows() {
    let lastInteraction = 0;
    const noteInteraction = (event) => {
      const target = event.target;
      // Our own panel and the site's menus do not change the cart.
      if (target && target.closest && target.closest(SITE_CHROME)) return;
      lastInteraction = Date.now();
    };
    document.addEventListener('pointerdown', noteInteraction, true);
    document.addEventListener('keydown', noteInteraction, true);

    const snapshot = () => {
      const rows = new Map();
      document.querySelectorAll('tr[data-article-id]').forEach((tr) => {
        const id = tr.getAttribute('data-article-id');
        if (!rows.has(id)) rows.set(id, parseInt(tr.getAttribute('data-amount'), 10) || 1);
      });
      return rows;
    };
    let before = snapshot();
    let timer = null;
    new MutationObserver(() => {
      clearTimeout(timer);
      // Let the site finish redrawing, then compare.
      timer = setTimeout(() => {
        const now = snapshot();
        if (Date.now() - lastInteraction < INTERACTION_WINDOW_MS) {
          const changed = [...before.entries()].filter(([id, amount]) => !now.has(id) || now.get(id) < amount).map(([id]) => id);
          if (changed.length) {
            markLeftByUser(changed);
            scheduleSync();
          }
        }
        before = now;
      }, 400);
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-amount'] });
  }

  /** Signals 2 and 3, on the cart page. */
  function watchCartPageActions() {
    document.addEventListener(
      'click',
      (event) => {
        const control = event.target.closest && event.target.closest('button, a, [onclick], [role="button"], input[type="submit"]');
        if (!control || control.closest(SITE_CHROME)) return;
        // A link that opens another page (a product, a seller, "Purchases"…) is never a removal.
        if (control.matches('a[href]') && !/^\s*(#|javascript:|$)/i.test(control.getAttribute('href') || '')) return;
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

  /** Every part on its own: one that fails must not take the others down. */
  async function safely(what, fn) {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[Cart Saver] ${what}:`, err);
      return null;
    }
  }

  const signedIn = cm.isSignedIn(document);
  if (loc.isOrder) {
    await safely('order page', async () => {
      const bought = cm.parseOrderArticleIds(document);
      if (!bought.length) return;
      await store.removeItems(bought);
      // The same offer can be in the cart again (more copies): read the cart, so it is saved again.
      if (signedIn) await withSyncLock(syncFromServer);
    });
  }

  await safely('removal watch', () => watchSiteRemovals());
  await safely('panel', () => CMCS.widget.mount(loc));

  if (signedIn) {
    if (loc.isCart) {
      await safely('cart page', () => syncFromPage());
      await safely('cart actions', () => watchCartPageActions());
      await safely('cart rows', () => watchCartRows());
    } else {
      await safely('cart check', () => syncIfHeaderChanged());
    }
    await safely('header', () => watchHeader());
  }

  await safely('favourites', () => CMCS.favorites.init(loc));
  await safely('refill', () => CMCS.refill.resumePending());
})();

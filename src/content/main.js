/*
 * Content script entry point, runs on every www.cardmarket.com page.
 *
 * 1. On the cart page: save every article in it (auto-tracking).
 * 2. On other pages: when the cart counter in the header changed since the
 *    last look, fetch the cart once and update the saved list. That is how an
 *    automatically emptied cart is noticed.
 * 3. On order pages: articles you bought are removed from the saved list.
 * 4. Mount the on-page widget and pick up a refill queued from the popup.
 */
(async function main() {
  'use strict';

  const { cm, store } = globalThis.CMCS;
  const loc = cm.parseLocation(location.href);
  if (!loc.lang || !loc.game) return;

  const HEADER_DEBOUNCE_MS = 1500;
  const USER_REMOVAL_TTL_MS = 10 * 60 * 1000;
  const REMOVE_HINT = /remove|delete|trash/i;

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

    const now = Date.now();
    const meta = await store.getMeta();
    const removedByUser = meta.userRemoved || {};
    const forget = result.newlyMissing.filter((id) => removedByUser[id] && now - removedByUser[id] < USER_REMOVAL_TTL_MS);
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

  /** Remember articles the user removes from the cart page on purpose. */
  function watchRemovals() {
    document.addEventListener(
      'click',
      (event) => {
        const row = event.target.closest && event.target.closest('tr[data-article-id]');
        if (!row) return;
        const control = event.target.closest('button, a, [onclick], [role="button"], input[type="submit"]');
        if (!control || !row.contains(control)) return;
        const hint = [
          control.className,
          control.getAttribute('onclick'),
          control.getAttribute('data-ajax-action'),
          control.getAttribute('aria-label'),
          control.getAttribute('title'),
          control.innerHTML.slice(0, 300),
        ].join(' ');
        if (!REMOVE_HINT.test(hint)) return;
        const id = row.getAttribute('data-article-id');
        store.updateMeta((meta) => ({ ...meta, userRemoved: { ...(meta.userRemoved || {}), [id]: Date.now() } }));
      },
      true,
    );
  }

  try {
    if (loc.isOrder) {
      const bought = cm.parseOrderArticleIds(document);
      if (bought.length) await store.removeItems(bought);
    }

    await CMCS.widget.mount(loc);

    if (cm.isSignedIn(document)) {
      if (loc.isCart) {
        await syncFromPage();
        watchRemovals();
      } else {
        await syncIfHeaderChanged();
      }
      watchHeader();
    }

    await CMCS.refill.resumePending();
  } catch (err) {
    console.warn('[Cart Saver]', err);
  }
})();

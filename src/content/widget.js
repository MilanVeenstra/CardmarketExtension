/*
 * The small panel shown on cardmarket.com itself (bottom-right corner).
 *
 * - On the cart page it lists saved articles that are no longer in the cart
 *   and offers to put them back.
 * - On other pages it only appears when the cart was (partly) emptied, while
 *   articles are being re-added, or right after that finished.
 *
 * Lives in a shadow root so the site's CSS and ours never mix.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { cm, store, ui, t } = CMCS;
  const { h } = ui;

  const SUMMARY_TTL_MS = 10 * 60 * 1000;

  let loc;
  let host;
  let shadow;
  let panel;
  let state = { items: {}, favorites: {}, job: null, settings: store.DEFAULT_SETTINGS, meta: {}, interrupted: false };
  let refreshSeq = 0;
  let pollTimer = null;
  let clockTimer = null;
  /** A one-off message (e.g. "favourite not on this page") until the user closes it. */
  let notice = null;
  /** The extension was updated or reloaded underneath this tab. */
  let orphaned = false;
  const deselected = new Set();
  /** The article a replacement is being looked for: { id, loading, offers, error }. */
  let replacing = null;

  const WIDGET_CSS = `
    :host { all: initial; }
    .cmcs-panel {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      width: 380px; max-width: calc(100vw - 32px); max-height: min(72vh, 640px);
      display: flex; flex-direction: column;
      background: var(--cmcs-bg); color: var(--cmcs-text);
      border: 1px solid var(--cmcs-border); box-shadow: var(--cmcs-shadow); overflow: hidden;
    }
    .cmcs-head { display: flex; align-items: center; gap: 4px; padding: 10px 8px 6px 14px; }
    .cmcs-head .cmcs-brand { flex: 1; }
    .cmcs-body { padding: 2px 14px 12px; overflow: auto; }
    .cmcs-foot { padding: 10px 14px 12px; border-top: 1px solid var(--cmcs-border); }
    .cmcs-view-title { font-size: 16px; font-weight: 800; margin: 6px 0 4px; }
    .cmcs-panel .cmcs-summary-title { font-size: 20px; }
    .cmcs-lead { margin: 0 0 8px; }
    .cmcs-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
    /* Buttons share the row, and move to a new line rather than break their label. */
    .cmcs-actions .cmcs-btn { flex: 1 1 auto; }
    .cmcs-row-between { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .cmcs-row-between .cmcs-section-title { margin-bottom: 4px; }
    .cmcs-links { display: flex; gap: 14px; flex-wrap: wrap; padding: 8px 0 0; }
    .cmcs-pill {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: 8px; padding: 8px 12px;
      background: var(--cmcs-bg); color: var(--cmcs-text); border: 1px solid var(--cmcs-border);
      box-shadow: var(--cmcs-shadow); cursor: pointer; font: inherit; font-weight: 600;
    }
    .cmcs-pill-count { color: var(--cmcs-red); font-weight: 800; }
    .cmcs-expiry { margin: 0; color: var(--cmcs-muted); font-size: 12px; }
    .cmcs-expiry--soon { color: var(--cmcs-red); font-weight: 700; }
    .cmcs-shipping { margin: 8px 0 2px; }
    .cmcs-shipping-list { margin-top: 4px; }
    .cmcs-shipping-row { padding: 6px 0; border-top: 1px solid var(--cmcs-line); }
    .cmcs-shipping-row .cmcs-item-meta { white-space: normal; }
    .cmcs-replace { margin: 0 0 8px 40px; padding: 6px 10px; background: var(--cmcs-surface); }
    .cmcs-replace .cmcs-item:first-of-type { border-top: 0; }
    .cmcs-replace .cmcs-item-meta:last-child { white-space: normal; }
    .cmcs-replace-title { font-size: 12px; color: var(--cmcs-muted); margin: 2px 0; }
    @media (max-width: 480px) {
      .cmcs-panel { right: 8px; left: 8px; bottom: 8px; width: auto; max-width: none; }
      .cmcs-pill { right: 8px; bottom: 8px; }
    }
  `;

  function mount(location) {
    loc = location;
    host = document.createElement('cmcs-cart-saver');
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ui.STYLES + WIDGET_CSS;
    panel = h('div', { class: 'cmcs-root' });
    shadow.append(style, panel);
    document.documentElement.append(host);

    // Pictures load straight from Cardmarket here; their copies (for the popup) need no redraw.
    const watched = Object.values(store.KEYS).filter((key) => key !== store.KEYS.thumbs);
    store.onChanged((changes) => {
      if (store.isHeartbeatOnly(changes)) return;
      if (Object.keys(changes).some((key) => watched.includes(key))) refresh();
    });
    watchForUpdate();
    return refresh();
  }

  /**
   * After the extension updated itself this script keeps running in tabs that
   * were already open, but can no longer reach the extension. Notice that and
   * ask for a page reload. Texts are read up front: chrome.i18n is gone too.
   */
  function watchForUpdate() {
    const label = t('updatedPill');
    const timer = setInterval(() => {
      let alive = false;
      try {
        alive = Boolean(chrome.runtime && chrome.runtime.id);
      } catch {
        alive = false;
      }
      if (alive) return;
      clearInterval(timer);
      orphaned = true;
      panel.replaceChildren(
        h('button', { type: 'button', class: 'cmcs-pill', title: label, onclick: () => location.reload() }, ui.logo(16), label),
      );
      host.style.display = '';
    }, 3000);
  }

  async function refresh() {
    if (orphaned) return;
    const seq = (refreshSeq += 1);
    const [items, favorites, job, settings, meta] = await Promise.all([
      store.getItems(),
      store.getFavorites(),
      store.getJob(),
      store.getSettings(),
      store.getMeta(),
    ]);
    const interrupted = await isInterrupted(job);
    // A slower, older refresh must not paint over a newer one.
    if (seq !== refreshSeq) return;
    state = { items, favorites, job, settings, meta, interrupted };
    render();
  }

  /**
   * A job that says "running" while no tab holds the refill lock lost its tab
   * (closed or navigated away). Without lock support: no heartbeat for 2 min.
   */
  async function isInterrupted(job) {
    if (!job || job.state !== 'running' || job.acknowledged) return false;
    if (store.isJobInterrupted(job)) return true;
    if (CMCS.refill.isRunning()) return false;
    try {
      return navigator.locks && navigator.locks.query ? !(await CMCS.refill.lockHeld()) : false;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function refill(ids) {
    if (!ids.length) return;
    const result = await CMCS.refill.start(ids);
    if (!result.ok) showNotice({ title: 'Cart Saver', text: t('errorBusy') });
  }

  /** Continue an interrupted job: the remaining articles become a new job (the cart is checked first). */
  async function continueJob(ids) {
    await store.dismissJob();
    await refill(ids);
  }

  const useThisAccount = (username) =>
    store.updateMeta((meta) => ({ ...meta, account: username, accountMismatch: null }));

  /** Remove from the saved list, with a way back. */
  async function removeItems(ids) {
    const taken = await store.takeItems(ids);
    if (!taken.length) return;
    showNotice({
      title: 'Cart Saver',
      text: taken.length === 1 ? t('removedOne', taken[0].name) : t('removedMany', taken.length),
      actions: [{ label: t('undo'), onClick: () => store.restoreItems(taken).then(() => showNotice(null)) }],
    });
  }

  async function undoJob(job) {
    showNotice({ title: t('undoTitle'), text: t('undoRunning') });
    await acknowledgeJob();
    const result = await CMCS.refill.undo(job.id);
    if (result.ok) {
      showNotice({ title: t('undoTitle'), text: t('undoDone', result.removed) });
      if (loc.isCart && result.removed) setTimeout(() => location.reload(), 1200);
    } else {
      showNotice({
        title: t('undoTitle'),
        text: result.error === 'busy' ? t('errorBusy') : ui.errorText(result.error) || t('errorUnknown'),
        detail: result.detail,
      });
    }
  }

  /**
   * With missing articles from several games: one chip per game, to choose
   * which games go back (a chip selects or deselects all its articles).
   */
  function gameChips(missing) {
    const games = [...new Set(missing.map((item) => item.game))];
    if (games.length < 2) return null;
    return h(
      'div',
      { class: 'cmcs-chips', role: 'group', 'aria-label': t('refillGamesLabel') },
      h('span', { class: 'cmcs-chips-label' }, t('refillGamesLabel')),
      games.map((game) => {
        const list = missing.filter((item) => item.game === game);
        const on = list.some((item) => !deselected.has(item.articleId));
        return h(
          'button',
          {
            type: 'button',
            class: 'cmcs-chip',
            'aria-pressed': String(on),
            onclick: () => {
              list.forEach((item) => (on ? deselected.add(item.articleId) : deselected.delete(item.articleId)));
              render();
            },
          },
          `${store.gameName(game)} (${list.length})`,
        );
      }),
    );
  }

  async function dismissReminder() {
    const signature = store.missingSignature(state.items);
    await store.updateMeta((meta) => ({ ...meta, dismissed: { ...(meta.dismissed || {}), '*': signature } }));
  }

  const setCollapsed = (collapsed) => store.updateMeta((meta) => ({ ...meta, collapsed }));

  const acknowledgeJob = () => store.updateJob((job) => (job ? { ...job, acknowledged: true } : undefined));

  async function saveCartNow() {
    const cart = cm.readCartDocument(document, { baseUrl: location.href, lang: loc.lang, game: loc.game });
    await store.syncCart(cart.items, { addNew: true, markMissing: false });
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  /**
   * The panel: logo and wordmark on top (with minimise / close), an optional
   * title, the body, and an optional footer (the big black button).
   */
  function shell({ title, onClose, onCollapse, footer } = {}, ...body) {
    return h(
      'section',
      { class: 'cmcs-panel', role: 'region', 'aria-label': 'Cart Saver' },
      h(
        'div',
        { class: 'cmcs-head' },
        ui.brand(20),
        onCollapse ? ui.iconButton(t('collapse'), 'minus', onCollapse) : null,
        onClose ? ui.iconButton(t('close'), 'close', onClose) : null,
      ),
      h('div', { class: 'cmcs-body' }, title ? h('h2', { class: 'cmcs-view-title' }, title) : null, body),
      footer ? h('div', { class: 'cmcs-foot' }, footer) : null,
    );
  }

  const refillValue = (list) => list.reduce((sum, item) => sum + (item.price || 0) * store.refillAmount(item), 0);
  const bySellerName = (a, b) => (a.seller || '').localeCompare(b.seller || '') || a.name.localeCompare(b.name);

  /** The opened row and the sellers folded into one line. */
  let openId = null;
  const closedSellers = new Set();
  const toggleRow = (id) => () => {
    openId = openId === id ? null : id;
    render();
  };

  /** A seller's articles: a header with the subtotal; folded, one line with the pictures. */
  function sellerGroup(seller, list, rowFor) {
    const closed = closedSellers.has(seller);
    const toggle = () => {
      if (closed) closedSellers.delete(seller);
      else closedSellers.add(seller);
      render();
    };
    const subtotal = store.formatPrice(list.reduce((sum, item) => sum + (item.price || 0) * ui.copiesOf(item), 0));
    if (closed) {
      const changed = list.some((item) => ui.statusInfo(item).some((line) => line.warn));
      return h(
        'button',
        { type: 'button', class: 'cmcs-seller cmcs-seller--closed', 'aria-expanded': 'false', onclick: toggle },
        h('span', { class: 'cmcs-stack' }, list.slice(0, 3).map((item) => ui.thumbnail(item))),
        h(
          'span',
          { class: 'cmcs-seller-text' },
          h('span', { class: 'cmcs-seller-name' }, seller),
          h('small', null, [t('shippingCopies', list.length), changed ? t('sellerPriceChanged') : null].filter(Boolean).join(' · ')),
        ),
        h('span', { class: 'cmcs-seller-sub' }, subtotal),
        ui.icon('chevronRight'),
      );
    }
    return [
      h(
        'button',
        { type: 'button', class: 'cmcs-seller', 'aria-expanded': 'true', onclick: toggle },
        h('span', { class: 'cmcs-seller-name' }, seller),
        h('span', { class: 'cmcs-seller-sub' }, subtotal),
        ui.icon('chevronDown'),
      ),
      list.map(rowFor),
    ];
  }

  function progressView(job) {
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    return shell(
      { title: t('refillRunningTitle') },
      h('p', { class: 'cmcs-lead cmcs-muted' }, t('refillRunningLead')),
      h('div', { class: 'cmcs-progress' }, h('div', { style: `width:${pct}%` })),
      h(
        'p',
        { class: 'cmcs-muted' },
        t('progressCount', job.done, job.total || job.articleIds.length),
        job.currentName ? ` · ${job.currentName}` : '',
      ),
      h(
        'div',
        { class: 'cmcs-actions' },
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => CMCS.refill.cancel() }, t('stop')),
      ),
    );
  }

  function summaryView(job) {
    const failedItems = Object.entries(job.results || {})
      .filter(([, result]) => !result.ok)
      .map(([id]) => state.items[id] || state.favorites[id])
      .filter(Boolean);
    const error = ui.errorText(job.error);
    return shell(
      { title: error && job.error !== 'cancelled' ? t('refillStoppedTitle') : t('refillDoneTitle'), onClose: acknowledgeJob },
      h('p', { class: 'cmcs-lead' }, t('refillSummary', job.added || 0, job.failed || 0)),
      ui.jobError(job),
      failedItems.length
        ? h(
            'div',
            { class: 'cmcs-list' },
            // Only what is really gone gets the stamp; an unclear refusal stays an ordinary row.
            failedItems.map((item, i, list) =>
              item.status === store.STATUS.UNAVAILABLE || !state.items[item.articleId]
                ? unavailableRow(item, i, list)
                : ui.itemRow(item, { actions: [ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item.articleId]))] }),
            ),
          )
        : null,
      h(
        'div',
        { class: 'cmcs-actions' },
        !loc.isCart ? h('a', { class: 'cmcs-btn', href: cm.cartUrl(loc.lang, loc.game) }, t('openCart')) : null,
        job.added > 0 && !job.undone
          ? h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => undoJob(job) }, t('undo'))
          : null,
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: acknowledgeJob }, t('close')),
      ),
    );
  }

  function interruptedView(job) {
    const ids = CMCS.refill.remainingIds(job, state.items);
    return shell(
      { title: t('interruptedTitle'), onClose: () => store.dismissJob() },
      h('p', { class: 'cmcs-lead' }, t('interruptedLead', ids.length)),
      h(
        'div',
        { class: 'cmcs-actions' },
        ids.length
          ? h('button', { type: 'button', class: 'cmcs-btn', onclick: () => continueJob(ids) }, t('continueRefill', ids.length))
          : null,
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => store.dismissJob() }, t('close')),
      ),
    );
  }

  function accountView(saved, current) {
    return shell(
      { title: t('accountTitle') },
      h('p', { class: 'cmcs-lead' }, t('accountLead', saved, current)),
      h(
        'div',
        { class: 'cmcs-actions' },
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => useThisAccount(current) }, t('accountUseThis', current)),
      ),
    );
  }

  async function findReplacement(item) {
    if (replacing && replacing.id === item.articleId && !replacing.loading) {
      replacing = null; // second click closes it
      return render();
    }
    replacing = { id: item.articleId, loading: true };
    render();
    try {
      const offers = await CMCS.replace.find(item);
      if (replacing && replacing.id === item.articleId) replacing = { id: item.articleId, offers };
    } catch (err) {
      if (replacing && replacing.id === item.articleId) replacing = { id: item.articleId, error: err.kind || 'unknown' };
    }
    render();
  }

  async function useReplacement(item, offer) {
    replacing = null;
    await acknowledgeJob();
    const result = await CMCS.replace.use(item, offer);
    if (!result.ok) showNotice({ title: 'Cart Saver', text: t('errorBusy') });
  }

  const REPLACE_REASONS = { sameSeller: 'replaceSameSeller', sellerInCart: 'replaceInCart', cheapest: 'replaceCheapest' };

  /** Suggestions shown under a sold article. */
  function replacementPanel(item) {
    if (!replacing || replacing.id !== item.articleId) return null;
    let body;
    if (replacing.loading) body = h('p', { class: 'cmcs-muted' }, t('replaceSearching'));
    else if (replacing.error) body = h('p', { class: 'cmcs-error' }, ui.errorText(replacing.error) || t('errorUnknown'));
    else if (!replacing.offers.length) body = h('p', { class: 'cmcs-muted' }, t('replaceNone'));
    else {
      body = replacing.offers.map((offer) => {
        const diff = item.price != null ? offer.price - item.price : 0;
        const priceNote =
          Math.abs(diff) < 0.005 ? null : t(diff > 0 ? 'replaceMore' : 'replaceLess', store.formatPrice(Math.abs(diff)));
        return ui.itemRow(
          { ...offer, status: 'offer' },
          {
            href: cm.offerUrl(offer),
            note: null,
            price: store.formatPrice(offer.price),
            extraMeta: [
              offer.seller,
              t(REPLACE_REASONS[offer.reason]),
              priceNote,
              offer.reason === 'cheapest' && offer.shipping != null ? t('replaceShipping', store.formatPrice(offer.shipping)) : null,
            ]
              .filter(Boolean)
              .join(' · '),
            actions: [
              h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--small', onclick: () => useReplacement(item, offer) }, t('replaceAdd')),
            ],
          },
        );
      });
    }
    return h('div', { class: 'cmcs-replace' }, h('div', { class: 'cmcs-replace-title' }, t('replaceTitle')), body);
  }

  /** A sold article: grey, with the VERKOCHT stamp, "Vervanging zoeken" and its suggestions. */
  const unavailableRow = (item, _i, list) => {
    const alt = cm.alternativesUrl(item);
    const multiGame = list && new Set(list.map((i) => i.game)).size > 1;
    return [
      ui.itemRow(item, {
        sold: true,
        withGame: multiGame,
        note: item.lastAttempt && item.lastAttempt.message ? item.lastAttempt.message : null,
        below: alt ? h('button', { type: 'button', class: 'cmcs-link', onclick: () => findReplacement(item) }, t('replaceFind')) : null,
        actions: [
          alt ? ui.iconLink(t('findAlternative'), 'search', alt) : null,
          ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item.articleId])),
        ].filter(Boolean),
      }),
      replacementPanel(item),
    ];
  };

  function cartView(missing, unavailable, inCart) {
    if (state.meta.collapsed) {
      const attention = missing.length + unavailable.length;
      return h(
        'button',
        { type: 'button', class: 'cmcs-pill', onclick: () => setCollapsed(false) },
        ui.logo(16),
        attention ? h('span', null, t('pillAttention', attention)) : t('pillSaved', inCart.length),
      );
    }

    const selected = missing.filter((item) => !deselected.has(item.articleId));
    const multiGame = new Set([...missing, ...unavailable].map((item) => item.game)).size > 1;
    const sellers = (list) => new Set(list.map((item) => item.seller || '—')).size;

    // The big picture first.
    const body = [];
    if (missing.length) {
      const emptied = missing.every((item) => item.missingReason === 'emptied');
      body.push(
        h(
          'div',
          { class: 'cmcs-summary' },
          h('h2', { class: 'cmcs-summary-title' }, t('summaryCanReturn', missing.length)),
          h(
            'p',
            { class: 'cmcs-summary-sub' },
            [t('summarySub', store.formatPrice(refillValue(missing)), sellers(missing)), emptied ? t('summaryEmptied') : null].filter(Boolean).join(' · '),
          ),
          expiryLine(),
        ),
      );
    } else {
      body.push(
        h(
          'div',
          { class: 'cmcs-summary' },
          h('h2', { class: 'cmcs-summary-title' }, inCart.length ? t('summaryAllIn') : t('nothingToRefill')),
          h('p', { class: 'cmcs-summary-sub' }, inCart.length ? t('cartSavedLead', inCart.length) : t('cartEmptyLead')),
          expiryLine(),
        ),
      );
    }
    body.push(shippingSection(inCart));

    if (missing.length) {
      const allSelected = selected.length === missing.length;
      const row = (item) =>
        ui.itemRow(item, {
          withGame: multiGame,
          open: openId === item.articleId,
          onToggle: toggleRow(item.articleId),
          leading: h('input', {
            type: 'checkbox',
            checked: !deselected.has(item.articleId),
            'aria-label': item.name,
            onchange: (event) => {
              if (event.target.checked) deselected.delete(item.articleId);
              else deselected.add(item.articleId);
              render();
            },
          }),
          details: [
            ui.detailButton(t('detailRefillOne'), () => refill([item.articleId]), { strong: true }),
            ui.detailButton(t('detailOpen'), null, { href: cm.offerUrl(item) || item.productUrl }),
            h(
              'button',
              { type: 'button', class: 'cmcs-detail-btn', title: t('removeFromSaved'), 'aria-label': t('removeFromSaved'), onclick: () => removeItems([item.articleId]) },
              ui.icon('close'),
            ),
          ],
        });
      const groups = store.groupBy([...missing].sort(bySellerName), (item) => item.seller || '—');
      body.push(
        h(
          'div',
          { class: 'cmcs-row-between' },
          h('div', { class: 'cmcs-section-title' }, t('groupMissing', missing.length)),
          h(
            'button',
            {
              type: 'button',
              class: 'cmcs-linklike',
              onclick: () => {
                missing.forEach((item) => (allSelected ? deselected.add(item.articleId) : deselected.delete(item.articleId)));
                render();
              },
            },
            allSelected ? t('selectNone') : t('selectAll'),
          ),
        ),
        gameChips(missing),
        h('div', { class: 'cmcs-list' }, [...groups.entries()].map(([seller, list]) => sellerGroup(seller, list, row))),
      );
    }

    if (unavailable.length) {
      body.push(
        h(
          'div',
          { class: 'cmcs-row-between' },
          h('div', { class: 'cmcs-section-title' }, t('groupUnavailable', unavailable.length)),
          h('button', { type: 'button', class: 'cmcs-linklike', onclick: () => removeItems(unavailable.map((item) => item.articleId)) }, t('clearUnavailable')),
        ),
        h('div', { class: 'cmcs-list' }, unavailable.map(unavailableRow)),
        h(
          'div',
          { class: 'cmcs-links' },
          h('button', { type: 'button', class: 'cmcs-link', onclick: () => refill(unavailable.map((item) => item.articleId)) }, t('retryUnavailable')),
        ),
      );
    }

    if (!state.settings.autoTrack) {
      body.push(
        h(
          'div',
          { class: 'cmcs-actions' },
          h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: saveCartNow }, t('saveCartNow')),
        ),
      );
    }

    const footer = missing.length
      ? ui.primaryButton(t('refillButton', selected.length), store.formatPrice(refillValue(selected)), () => refill(selected.map((item) => item.articleId)), {
          disabled: !selected.length,
        })
      : null;
    return shell({ onCollapse: () => setCollapsed(true), footer }, body);
  }

  /** "Cardmarket empties your cart at 14:35 (in 23 min)", when the cart page said so. */
  function expiryLine() {
    const at = typeof state.meta.cartExpiry === 'number' ? state.meta.cartExpiry : null;
    if (!at || at <= Date.now()) return null;
    const minutes = Math.max(1, Math.round((at - Date.now()) / 60000));
    const time = new Date(at).toLocaleTimeString(chrome.i18n.getUILanguage(), { hour: '2-digit', minute: '2-digit' });
    return h('p', { class: `cmcs-expiry ${minutes <= 10 ? 'cmcs-expiry--soon' : ''}` }, t('expiryLine', time, String(minutes)));
  }

  /** €25: above it, most countries need tracked (dearer) shipping. */
  const TRACKED_FROM_EUR = 25;
  let shippingOpen = false;

  /** Per seller: articles, value, shipping and what that means. Collapsed to one line by default. */
  function shippingSection(inCart) {
    const facts = state.meta.shipping && Array.isArray(state.meta.shipping.shipments) ? state.meta.shipping : null;
    const bySeller = store.groupBy(inCart, (item) => item.seller || '—');
    if (bySeller.size === 0) return null;
    const shippingOf = new Map(((facts && facts.shipments) || []).map((s) => [s.seller, s.shipping]));
    const rows = [...bySeller.entries()].map(([seller, list]) => {
      const value = list.reduce((sum, item) => sum + (item.price || 0) * (item.amount || 1), 0);
      const copies = list.reduce((sum, item) => sum + (item.amount || 1), 0);
      const shipping = shippingOf.has(seller) ? shippingOf.get(seller) : null;
      return { seller, value, copies, shipping };
    });
    rows.sort((a, b) => b.value - a.value);
    const totalShipping = rows.every((r) => r.shipping != null) ? rows.reduce((sum, r) => sum + r.shipping, 0) : null;
    const totalValue = rows.reduce((sum, r) => sum + r.value, 0);
    const summary =
      totalShipping != null
        ? t('shippingSummaryKnown', String(rows.length), store.formatPrice(totalShipping), String(Math.round((totalShipping / (totalValue + totalShipping || 1)) * 100)))
        : t('shippingSummary', String(rows.length));
    return h(
      'div',
      { class: 'cmcs-shipping' },
      h(
        'button',
        { type: 'button', class: 'cmcs-linklike', 'aria-expanded': String(shippingOpen), onclick: () => { shippingOpen = !shippingOpen; render(); } },
        `${shippingOpen ? '▾' : '▸'} ${summary}`,
      ),
      shippingOpen
        ? h(
            'div',
            { class: 'cmcs-shipping-list' },
            rows.map((r) => {
              const notes = [];
              if (r.shipping != null) {
                const share = Math.round((r.shipping / (r.value + r.shipping || 1)) * 100);
                notes.push(t('shippingCost', store.formatPrice(r.shipping), String(share)));
                if (r.shipping > r.value) notes.push(t('shippingMoreThanCards'));
              }
              if (r.value > TRACKED_FROM_EUR) notes.push(t('shippingTracked'));
              else if (r.value > TRACKED_FROM_EUR - 3) notes.push(t('shippingNearTracked', store.formatPrice(TRACKED_FROM_EUR - r.value)));
              return h(
                'div',
                { class: 'cmcs-shipping-row' },
                h('div', { class: 'cmcs-row-between' }, h('strong', null, r.seller), h('span', null, store.formatPrice(r.value))),
                h('div', { class: 'cmcs-item-meta' }, [t('shippingCopies', String(r.copies)), ...notes].join(' · ')),
              );
            }),
          )
        : null,
    );
  }

  function showNotice(next) {
    notice = next;
    render();
  }

  function noticeView() {
    const close = () => showNotice(null);
    return shell(
      { title: notice.title !== 'Cart Saver' ? notice.title : null, onClose: close },
      h('p', { class: 'cmcs-lead' }, notice.text),
      notice.detail ? h('p', { class: 'cmcs-detail' }, t('errorDetails', notice.detail)) : null,
      h(
        'div',
        { class: 'cmcs-actions' },
        (notice.links || []).map((link, i) =>
          h('a', { class: `cmcs-btn ${i ? 'cmcs-btn--ghost' : ''}`, href: link.href }, link.label),
        ),
        (notice.actions || []).map((action, i) =>
          h('button', { type: 'button', class: `cmcs-btn ${i || (notice.links || []).length ? 'cmcs-btn--ghost' : ''}`, onclick: action.onClick }, action.label),
        ),
      ),
    );
  }

  function reminderView(missing) {
    const value = refillValue(missing);
    return shell(
      {
        title: t('reminderTitle'),
        onClose: dismissReminder,
        footer: ui.primaryButton(t('refillButton', missing.length), store.formatPrice(value), () => refill(missing.map((item) => item.articleId))),
      },
      h('p', { class: 'cmcs-lead cmcs-muted' }, t('reminderLead', missing.length, store.formatPrice(value))),
      onlyGameButtons(missing),
      h('div', { class: 'cmcs-links' }, h('a', { class: 'cmcs-link', href: cm.cartUrl(loc.lang, loc.game) }, t('viewInCart'))),
    );
  }

  /** "Or only: Magic (2) · Pokémon (1)" — put back one game. */
  function onlyGameButtons(missing) {
    const games = [...new Set(missing.map((item) => item.game))];
    if (games.length < 2) return null;
    return h(
      'div',
      { class: 'cmcs-chips' },
      h('span', { class: 'cmcs-chips-label' }, t('refillOnlyLabel')),
      games.map((game) => {
        const ids = missing.filter((item) => item.game === game).map((item) => item.articleId);
        return h('button', { type: 'button', class: 'cmcs-chip', onclick: () => refill(ids) }, `${store.gameName(game)} (${ids.length})`);
      }),
    );
  }

  function render() {
    if (orphaned) return;
    const { items, job, settings, meta } = state;
    const game = loc.game;
    const { STATUS } = store;
    // Cardmarket has one cart for all games, so the panel shows every game.
    const forGame = Object.values(items);
    // "Partly in the cart" is both: it is there, and copies can be put back.
    const missing = forGame.filter((item) => item.status === STATUS.MISSING || item.status === STATUS.PARTIAL);
    const unavailable = forGame.filter((item) => item.status === STATUS.UNAVAILABLE);
    const inCart = forGame.filter((item) => item.status === STATUS.IN_CART || item.status === STATUS.PARTIAL);
    const otherAccount = meta.account && meta.accountMismatch && cm.readUsername(document) === meta.accountMismatch;

    const sortByName = (a, b) => (a.seller || '').localeCompare(b.seller || '') || a.name.localeCompare(b.name);
    missing.sort(sortByName);
    unavailable.sort(sortByName);

    let view = null;
    if (state.interrupted) {
      view = interruptedView(job);
    } else if (store.isJobActive(job)) {
      view = progressView(job);
    } else if (job && job.finishedAt && !job.acknowledged && Date.now() - job.finishedAt < SUMMARY_TTL_MS) {
      view = summaryView(job);
    } else if (notice) {
      view = noticeView();
    } else if (otherAccount) {
      view = accountView(meta.account, meta.accountMismatch);
    } else if (loc.isCart && forGame.length) {
      view = cartView(missing, unavailable, inCart);
    } else if (
      !loc.isCart &&
      missing.length &&
      settings.showReminder &&
      (meta.dismissed || {})['*'] !== store.missingSignature(items)
    ) {
      view = reminderView(missing);
    }

    panel.replaceChildren(...(view ? [view] : []));
    host.style.display = view ? '' : 'none';

    // The countdown to the emptied cart moves on by itself.
    clearTimeout(clockTimer);
    if (view && typeof meta.cartExpiry === 'number' && meta.cartExpiry > Date.now()) clockTimer = setTimeout(render, 60 * 1000);

    // A job running in another tab: look again now and then, in case that tab closes.
    clearTimeout(pollTimer);
    if (job && job.state === 'running' && !state.interrupted && !CMCS.refill.isRunning()) {
      pollTimer = setTimeout(refresh, 5000);
    }
  }

  CMCS.widget = { mount, refresh, showNotice };
})(globalThis);

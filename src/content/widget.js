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
      border: 1px solid var(--cmcs-border); border-radius: var(--cmcs-radius);
      box-shadow: var(--cmcs-shadow); overflow: hidden;
    }
    .cmcs-head { display: flex; align-items: center; gap: 8px; padding: 10px 10px 8px 14px; }
    .cmcs-logo { width: 20px; height: 20px; flex: none; }
    .cmcs-title { font-weight: 700; flex: 1; font-size: 14px; }
    .cmcs-body { padding: 0 14px 12px; overflow: auto; }
    .cmcs-lead { margin: 0 0 8px; }
    .cmcs-lead strong { font-weight: 700; }
    .cmcs-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .cmcs-actions .cmcs-btn { flex: 1; }
    .cmcs-list { margin-top: 4px; }
    .cmcs-row-between { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .cmcs-linklike { appearance: none; border: 0; background: none; padding: 0; color: var(--cmcs-accent); font: inherit; font-size: 12px; cursor: pointer; }
    .cmcs-pill {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px 8px 10px;
      background: var(--cmcs-bg); color: var(--cmcs-text); border: 1px solid var(--cmcs-border);
      border-radius: 999px; box-shadow: var(--cmcs-shadow); cursor: pointer; font: inherit; font-weight: 600;
    }
    .cmcs-pill .cmcs-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--cmcs-ok); }
    .cmcs-pill .cmcs-dot--warn { background: #e0a100; }
    .cmcs-expiry { margin: -4px 0 8px; color: var(--cmcs-muted); font-size: 12px; }
    .cmcs-expiry--soon { color: var(--cmcs-warn); font-weight: 600; }
    .cmcs-shipping { margin: 0 0 6px; }
    .cmcs-shipping-list { margin-top: 4px; }
    .cmcs-shipping-row { padding: 5px 0; border-top: 1px solid var(--cmcs-border); }
    .cmcs-shipping-row:first-child { border-top: 0; }
    .cmcs-shipping-row .cmcs-item-meta { white-space: normal; }
    @media (max-width: 480px) {
      .cmcs-panel { right: 8px; left: 8px; bottom: 8px; width: auto; max-width: none; }
      .cmcs-pill { right: 8px; bottom: 8px; }
    }
  `;

  const LOGO_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">' +
    '<rect width="24" height="24" rx="6" fill="#1a5fd6"/>' +
    '<path d="M5 6h2l1.6 8.2a1 1 0 0 0 1 .8h6.6a1 1 0 0 0 1-.8L18.5 9H8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<circle cx="10" cy="18" r="1.3" fill="#fff"/><circle cx="16" cy="18" r="1.3" fill="#fff"/></svg>';

  function logo() {
    const svg = new DOMParser().parseFromString(LOGO_SVG, 'image/svg+xml').documentElement;
    svg.setAttribute('class', 'cmcs-logo');
    return document.importNode(svg, true);
  }

  function mount(location) {
    loc = location;
    host = document.createElement('cmcs-cart-saver');
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = ui.STYLES + WIDGET_CSS;
    panel = h('div', { class: 'cmcs-root' });
    shadow.append(style, panel);
    document.documentElement.append(host);

    store.onChanged((changes) => {
      if (store.isHeartbeatOnly(changes)) return;
      if (Object.keys(changes).some((key) => Object.values(store.KEYS).includes(key))) refresh();
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
        h(
          'button',
          { type: 'button', class: 'cmcs-pill', title: label, onclick: () => location.reload() },
          h('span', { class: 'cmcs-dot cmcs-dot--warn' }),
          label,
        ),
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

  /** With several games in view, each row says which game it is. */
  const gameOf = (item, list) => (new Set(list.map((i) => i.game)).size > 1 ? store.gameName(item.game) : null);

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

  function shell(title, { onClose, onCollapse } = {}, ...body) {
    return h(
      'section',
      { class: 'cmcs-panel', role: 'region', 'aria-label': 'Cart Saver' },
      h(
        'div',
        { class: 'cmcs-head' },
        logo(),
        h('div', { class: 'cmcs-title' }, title),
        onCollapse ? ui.iconButton(t('collapse'), 'minus', onCollapse) : null,
        onClose ? ui.iconButton(t('close'), 'close', onClose) : null,
      ),
      h('div', { class: 'cmcs-body' }, body),
    );
  }

  function progressView(job) {
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    return shell(
      t('refillRunningTitle'),
      {},
      h('p', { class: 'cmcs-lead' }, t('refillRunningLead')),
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
    const errorLines = ui.jobError(job);
    return shell(
      error && job.error !== 'cancelled' ? t('refillStoppedTitle') : t('refillDoneTitle'),
      { onClose: acknowledgeJob },
      h('p', { class: 'cmcs-lead' }, t('refillSummary', job.added || 0, job.failed || 0)),
      errorLines,
      failedItems.length
        ? h(
            'div',
            { class: 'cmcs-list' },
            failedItems.map(unavailableRow),
          )
        : null,
      h(
        'div',
        { class: 'cmcs-actions' },
        !loc.isCart
          ? h('a', { class: 'cmcs-btn', href: cm.cartUrl(loc.lang, loc.game) }, t('openCart'))
          : null,
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
      t('interruptedTitle'),
      { onClose: () => store.dismissJob() },
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
      t('accountTitle'),
      {},
      h('p', { class: 'cmcs-lead' }, t('accountLead', saved, current)),
      h(
        'div',
        { class: 'cmcs-actions' },
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => useThisAccount(current) }, t('accountUseThis', current)),
      ),
    );
  }

  function alternativeActions(item) {
    const url = cm.alternativesUrl(item);
    return [
      url ? ui.iconButton(t('replaceFind'), 'swap', () => findReplacement(item)) : null,
      url ? ui.iconLink(t('findAlternative'), 'search', url) : null,
      ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item.articleId])),
    ].filter(Boolean);
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
            showInfo: false,
            note: null,
            extraMeta: [t(REPLACE_REASONS[offer.reason]), priceNote].filter(Boolean).join(' · '),
            actions: [
              h(
                'button',
                { type: 'button', class: 'cmcs-btn cmcs-btn--small', onclick: () => useReplacement(item, offer) },
                t('replaceAdd'),
              ),
            ],
          },
        );
      });
    }
    return h('div', { class: 'cmcs-replace' }, h('div', { class: 'cmcs-replace-title' }, t('replaceTitle')), body);
  }

  /** A sold article with its replacement suggestions (when asked for). */
  const unavailableRow = (item, _i, list) => [
    ui.itemRow(item, { extraMeta: list ? gameOf(item, list) : null, actions: alternativeActions(item) }),
    replacementPanel(item),
  ];

  function cartView(missing, unavailable, inCart) {
    if (state.meta.collapsed) {
      const attention = missing.length + unavailable.length;
      return h(
        'button',
        { type: 'button', class: 'cmcs-pill', onclick: () => setCollapsed(false) },
        h('span', { class: `cmcs-dot ${attention ? 'cmcs-dot--warn' : ''}` }),
        attention ? t('pillAttention', attention) : t('pillSaved', inCart.length),
      );
    }

    const selected = missing.filter((item) => !deselected.has(item.articleId));
    const selectedValue = selected.reduce((sum, item) => sum + (item.price || 0) * store.refillAmount(item), 0);

    const body = [];
    body.push(
      h(
        'p',
        { class: 'cmcs-lead' },
        inCart.length ? t('cartSavedLead', inCart.length) : t('cartEmptyLead'),
      ),
      expiryLine(),
      shippingSection(inCart),
    );

    if (missing.length) {
      const allSelected = selected.length === missing.length;
      body.push(
        h(
          'div',
          { class: 'cmcs-row-between' },
          h('div', { class: 'cmcs-group-title' }, t('groupMissing', missing.length)),
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
        h(
          'div',
          { class: 'cmcs-list' },
          missing.map((item) =>
            ui.itemRow(item, {
              extraMeta: gameOf(item, missing),
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
              actions: [ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item.articleId]))],
            }),
          ),
        ),
        h(
          'div',
          { class: 'cmcs-actions' },
          h(
            'button',
            {
              type: 'button',
              class: 'cmcs-btn',
              disabled: !selected.length,
              onclick: () => refill(selected.map((item) => item.articleId)),
            },
            t('refillSelected', selected.length, store.formatPrice(selectedValue)),
          ),
        ),
      );
    } else if (inCart.length && !unavailable.length) {
      body.push(h('p', { class: 'cmcs-muted' }, t('nothingMissing')));
    }

    if (unavailable.length) {
      body.push(
        h(
          'div',
          { class: 'cmcs-row-between' },
          h('div', { class: 'cmcs-group-title' }, t('groupUnavailable', unavailable.length)),
          h(
            'button',
            { type: 'button', class: 'cmcs-linklike', onclick: () => removeItems(unavailable.map((item) => item.articleId)) },
            t('clearUnavailable'),
          ),
        ),
        h(
          'div',
          { class: 'cmcs-list' },
          unavailable.map(unavailableRow),
        ),
        h(
          'div',
          { class: 'cmcs-actions' },
          h(
            'button',
            { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => refill(unavailable.map((item) => item.articleId)) },
            t('retryUnavailable'),
          ),
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

    return shell('Cart Saver', { onCollapse: () => setCollapsed(true) }, body);
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
      notice.title,
      { onClose: close },
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
    const value = missing.reduce((sum, item) => sum + (item.price || 0) * store.refillAmount(item), 0);
    return shell(
      t('reminderTitle'),
      { onClose: dismissReminder },
      h('p', { class: 'cmcs-lead' }, t('reminderLead', missing.length, store.formatPrice(value))),
      h(
        'div',
        { class: 'cmcs-actions' },
        h('button', { type: 'button', class: 'cmcs-btn', onclick: () => refill(missing.map((item) => item.articleId)) }, t('refillAll', missing.length)),
        h('a', { class: 'cmcs-btn cmcs-btn--ghost', href: cm.cartUrl(loc.lang, loc.game) }, t('viewInCart')),
      ),
      onlyGameButtons(missing),
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

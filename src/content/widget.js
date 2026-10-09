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
  let state = { items: {}, favorites: {}, job: null, settings: store.DEFAULT_SETTINGS, meta: {} };
  /** A one-off message (e.g. "favourite not on this page") until the user closes it. */
  let notice = null;
  /** The extension was updated or reloaded underneath this tab. */
  let orphaned = false;
  const deselected = new Set();

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
    const [items, favorites, job, settings, meta] = await Promise.all([
      store.getItems(),
      store.getFavorites(),
      store.getJob(),
      store.getSettings(),
      store.getMeta(),
    ]);
    state = { items, favorites, job, settings, meta };
    render();
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function refill(ids) {
    if (!ids.length) return;
    const result = await CMCS.refill.start(ids);
    if (!result.ok) alert(t('errorBusy'));
  }

  const removeItems = (ids) => store.removeItems(ids);

  async function dismissReminder() {
    const signature = store.missingSignature(state.items, loc.game);
    await store.updateMeta((meta) => ({ ...meta, dismissed: { ...(meta.dismissed || {}), [loc.game]: signature } }));
  }

  const setCollapsed = (collapsed) => store.updateMeta((meta) => ({ ...meta, collapsed }));

  const acknowledgeJob = () => store.updateJob((job) => (job ? { ...job, acknowledged: true } : undefined));

  async function saveCartNow() {
    const cart = cm.readCartDocument(document, { baseUrl: location.href, lang: loc.lang, game: loc.game });
    await store.syncCart(cart.items, { game: loc.game, addNew: true, markMissing: false });
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
            failedItems.map((item) => ui.itemRow(item, { actions: alternativeActions(item) })),
          )
        : null,
      h(
        'div',
        { class: 'cmcs-actions' },
        !loc.isCart
          ? h('a', { class: 'cmcs-btn', href: cm.cartUrl(loc.lang, loc.game) }, t('openCart'))
          : null,
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: acknowledgeJob }, t('close')),
      ),
    );
  }

  function alternativeActions(item) {
    const url = cm.alternativesUrl(item);
    return [
      url ? ui.iconLink(t('findAlternative'), 'search', url) : null,
      ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item.articleId])),
    ].filter(Boolean);
  }

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
    const selectedValue = selected.reduce((sum, item) => sum + (item.price || 0) * (item.amount || 1), 0);

    const body = [];
    body.push(
      h(
        'p',
        { class: 'cmcs-lead' },
        inCart.length ? t('cartSavedLead', inCart.length) : t('cartEmptyLead'),
      ),
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
        h(
          'div',
          { class: 'cmcs-list' },
          missing.map((item) =>
            ui.itemRow(item, {
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
          unavailable.map((item) => ui.itemRow(item, { actions: alternativeActions(item) })),
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
      h(
        'div',
        { class: 'cmcs-actions' },
        (notice.links || []).map((link, i) =>
          h('a', { class: `cmcs-btn ${i ? 'cmcs-btn--ghost' : ''}`, href: link.href }, link.label),
        ),
      ),
    );
  }

  function reminderView(missing) {
    const value = missing.reduce((sum, item) => sum + (item.price || 0) * (item.amount || 1), 0);
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
    );
  }

  function render() {
    if (orphaned) return;
    const { items, job, settings, meta } = state;
    const game = loc.game;
    const forGame = Object.values(items).filter((item) => item.game === game);
    const missing = forGame.filter((item) => item.status === store.STATUS.MISSING);
    const unavailable = forGame.filter((item) => item.status === store.STATUS.UNAVAILABLE);
    const inCart = forGame.filter((item) => item.status === store.STATUS.IN_CART);

    const sortByName = (a, b) => (a.seller || '').localeCompare(b.seller || '') || a.name.localeCompare(b.name);
    missing.sort(sortByName);
    unavailable.sort(sortByName);

    let view = null;
    if (store.isJobActive(job)) {
      view = progressView(job);
    } else if (job && job.finishedAt && !job.acknowledged && Date.now() - job.finishedAt < SUMMARY_TTL_MS) {
      view = summaryView(job);
    } else if (notice) {
      view = noticeView();
    } else if (loc.isCart && forGame.length) {
      view = cartView(missing, unavailable, inCart);
    } else if (
      !loc.isCart &&
      missing.length &&
      settings.showReminder &&
      (meta.dismissed || {})[game] !== store.missingSignature(items, game)
    ) {
      view = reminderView(missing);
    }

    panel.replaceChildren(...(view ? [view] : []));
    host.style.display = view ? '' : 'none';
  }

  CMCS.widget = { mount, refresh, showNotice };
})(globalThis);

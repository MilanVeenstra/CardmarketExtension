(async function popup() {
  'use strict';

  const { store, ui, cm, t } = CMCS;
  const { h } = ui;
  const $ = (id) => document.getElementById(id);

  const style = document.createElement('style');
  style.textContent = ui.STYLES;
  document.head.prepend(style);
  CMCS.localize(document);
  document.documentElement.lang = chrome.i18n.getUILanguage();

  const FILTERS = [
    { id: 'all', label: 'filterAll', test: () => true },
    { id: 'missing', label: 'statusMissing', test: (item) => item.status === store.STATUS.MISSING },
    { id: 'in_cart', label: 'statusInCart', test: (item) => item.status === store.STATUS.IN_CART },
    { id: 'unavailable', label: 'statusUnavailable', test: (item) => item.status === store.STATUS.UNAVAILABLE },
  ];
  const STATUS_ORDER = { missing: 0, unavailable: 1, in_cart: 2 };

  let items = {};
  let job = null;
  let game = null;
  let filter = 'all';
  let notice = null;

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabLoc =
    activeTab && activeTab.url && activeTab.url.startsWith(cm.ORIGIN) ? cm.parseLocation(activeTab.url) : null;
  const onCardmarket = Boolean(tabLoc && tabLoc.lang && tabLoc.game);

  $('options').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('game').addEventListener('change', (event) => {
    game = event.target.value;
    render();
  });

  // ---------------------------------------------------------------------------

  function langFor(list) {
    return (tabLoc && tabLoc.lang) || (list[0] && list[0].lang) || 'en';
  }

  async function openUrl(url) {
    if (onCardmarket) await chrome.tabs.update(activeTab.id, { url });
    else await chrome.tabs.create({ url });
  }

  /**
   * Re-adding has to happen inside a cardmarket.com tab (that is where the
   * session lives). Use the current tab when it is one, otherwise queue the job
   * and open the cart; the content script there picks it up.
   */
  async function refill(list) {
    if (!list.length) return;
    const ids = list.map((item) => item.articleId);
    if (store.isJobActive(job)) {
      notice = t('errorBusy');
      return render();
    }
    if (onCardmarket) {
      try {
        const response = await chrome.tabs.sendMessage(activeTab.id, { type: 'cmcs.refill', articleIds: ids });
        if (response && response.ok) return;
        if (response && response.error === 'busy') {
          notice = t('errorBusy');
          return render();
        }
      } catch {
        // The tab was opened before the extension was (re)loaded: no content
        // script listening. Fall through and reload it via the queue.
      }
    }
    const lang = langFor(list);
    await store.setJob(store.newJob(ids, lang));
    notice = t('refillQueued');
    render();
    await openUrl(cm.cartUrl(lang, list[0].game));
  }

  function removeItems(list) {
    return store.removeItems(list.map((item) => item.articleId));
  }

  // ---------------------------------------------------------------------------

  function stat(kind, value, label) {
    return h('div', { class: `stat stat--${kind}` }, h('span', { class: 'stat-value' }, value), h('span', { class: 'stat-label' }, label));
  }

  function renderJob() {
    const box = $('job');
    const active = store.isJobActive(job);
    const recent = job && job.finishedAt && !job.acknowledged && Date.now() - job.finishedAt < 10 * 60 * 1000;
    if (!active && !recent) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (active) {
      const total = job.total || job.articleIds.length;
      const pct = total ? Math.round((job.done / total) * 100) : 0;
      box.replaceChildren(
        h('p', null, job.state === 'pending' ? t('refillWaiting') : t('refillRunningLead')),
        h('div', { class: 'cmcs-progress' }, h('div', { style: `width:${pct}%` })),
        h(
          'div',
          { class: 'job-row' },
          h('span', { class: 'cmcs-muted' }, t('progressCount', job.done, total)),
          h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: cancelJob }, t('stop')),
        ),
      );
      return;
    }
    const stopped = job.error && job.error !== 'cancelled';
    box.replaceChildren(
      h(
        'p',
        null,
        h('strong', null, stopped ? t('refillStoppedTitle') : t('refillDoneTitle')),
        ' — ',
        t('refillSummary', job.added || 0, job.failed || 0),
      ),
      job.error ? h('p', { class: stopped ? 'cmcs-error' : 'cmcs-muted' }, ui.errorText(job.error)) : null,
      h(
        'div',
        { class: 'job-row' },
        h('span'),
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: acknowledgeJob }, t('close')),
      ),
    );
  }

  /** A running job stops after its current article; a queued one is dropped. */
  function cancelJob() {
    return store.updateJob((current) => {
      if (!current) return undefined;
      if (current.state === 'pending') {
        return { ...current, state: 'done', error: 'cancelled', finishedAt: Date.now() };
      }
      return { ...current, cancelRequested: true };
    });
  }

  function acknowledgeJob() {
    return store.updateJob((current) => (current ? { ...current, acknowledged: true } : undefined));
  }

  function itemActions(item) {
    const actions = [];
    if (item.status !== store.STATUS.IN_CART) {
      const alt = cm.alternativesUrl(item);
      if (alt) actions.push(h('a', { class: 'cmcs-icon-btn', href: alt, target: '_blank', rel: 'noopener', title: t('findAlternative'), 'aria-label': t('findAlternative') }, '⌕'));
      actions.push(ui.iconButton(t('refillOne'), '↺', () => refill([item])));
    }
    actions.push(ui.iconButton(t('removeFromSaved'), '×', () => removeItems([item])));
    return actions;
  }

  function render() {
    const all = Object.values(items);
    const games = [...new Set(all.map((item) => item.game).filter(Boolean))].sort();

    $('empty').hidden = all.length > 0;
    for (const id of ['summary', 'actions', 'filters', 'list']) $(id).hidden = all.length === 0;
    if (!all.length) {
      $('job').hidden = true;
      $('game').hidden = true;
      return;
    }

    if (!game || !games.includes(game)) {
      const byMissing = games
        .map((g) => [g, store.summarize(items, g).missing])
        .sort((a, b) => b[1] - a[1]);
      game = tabLoc && games.includes(tabLoc.game) ? tabLoc.game : byMissing[0][0];
    }
    const select = $('game');
    select.hidden = games.length < 2;
    select.replaceChildren(...games.map((g) => h('option', { value: g, selected: g === game }, g)));

    const forGame = all.filter((item) => item.game === game);
    const summary = store.summarize(items, game);
    $('summary').replaceChildren(
      stat('in_cart', summary.inCart, t('statusInCart')),
      stat('missing', summary.missing, t('statusMissing')),
      stat('unavailable', summary.unavailable, t('statusUnavailable')),
    );

    renderJob();

    const missing = forGame.filter((item) => item.status === store.STATUS.MISSING);
    const busy = store.isJobActive(job);
    $('actions').replaceChildren(
      h(
        'button',
        { type: 'button', class: 'cmcs-btn', disabled: !missing.length || busy, onclick: () => refill(missing) },
        missing.length ? t('refillAll', missing.length) : t('nothingToRefill'),
      ),
      h(
        'button',
        { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => openUrl(cm.cartUrl(langFor(forGame), game)) },
        t('openCart'),
      ),
    );
    $('notice').hidden = !notice;
    $('notice').textContent = notice || '';

    const filters = $('filters');
    filters.hidden = false;
    filters.replaceChildren(
      ...FILTERS.map((f) => {
        const count = forGame.filter(f.test).length;
        return h(
          'button',
          { type: 'button', class: 'filter', 'aria-pressed': String(filter === f.id), onclick: () => { filter = f.id; render(); } },
          `${t(f.label)} (${count})`,
        );
      }),
    );

    const active = FILTERS.find((f) => f.id === filter) || FILTERS[0];
    const visible = forGame
      .filter(active.test)
      .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name));
    const bySeller = store.groupBy(visible, (item) => item.seller || '—');
    const sellers = [...bySeller.keys()].sort((a, b) => a.localeCompare(b));
    $('list').replaceChildren(
      ...(visible.length
        ? sellers.flatMap((seller) => [
            h('div', { class: 'cmcs-group-title seller-title' }, `${seller} (${bySeller.get(seller).length})`),
            h(
              'div',
              null,
              bySeller.get(seller).map((item) => ui.itemRow(item, { showStatus: true, showSeller: false, actions: itemActions(item) })),
            ),
          ])
        : [h('p', { class: 'cmcs-muted' }, t('filterEmpty'))]),
    );
  }

  async function load() {
    [items, job] = await Promise.all([store.getItems(), store.getJob()]);
    render();
  }

  store.onChanged(load);
  await load();
})();

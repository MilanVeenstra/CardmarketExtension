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

  const TAB_KEY = 'cmcs.popupTab';

  let items = {};
  let favorites = {};
  let job = null;
  let game = null;
  let filter = 'all';
  let notice = null;
  let query = '';
  let tab = 'cart';
  try {
    tab = localStorage.getItem(TAB_KEY) === 'fav' ? 'fav' : 'cart';
  } catch {
    // Storage blocked: just start on the cart tab.
  }

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
  for (const [id, name] of [['tab-cart', 'cart'], ['tab-fav', 'fav']]) {
    $(id).addEventListener('click', () => {
      tab = name;
      try {
        localStorage.setItem(TAB_KEY, name);
      } catch {
        // Not remembered, that is fine.
      }
      render();
    });
  }
  $('fav-search').addEventListener('input', (event) => {
    query = event.target.value;
    renderFavorites();
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

  /** Favourites go through the same refill job as saved cart articles (amount 1). */
  async function addFavoritesToCart(list) {
    if (store.isJobActive(job)) {
      notice = t('errorBusy');
      return render();
    }
    await store.ensureItemsFromFavorites(list);
    const saved = await store.getItems();
    await refill(list.map((fav) => saved[fav.articleId]).filter(Boolean));
  }

  function formatDate(ts) {
    return ts ? new Date(ts).toLocaleDateString(chrome.i18n.getUILanguage(), { day: 'numeric', month: 'short' }) : '';
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
    // replaceChildren() would turn a null into the text "null", so build the list first.
    const parts = [
      h(
        'p',
        null,
        h('strong', null, stopped ? t('refillStoppedTitle') : t('refillDoneTitle')),
        ' — ',
        t('refillSummary', job.added || 0, job.failed || 0),
      ),
      ...ui.jobError(job),
      h(
        'div',
        { class: 'job-row' },
        h('span'),
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: acknowledgeJob }, t('close')),
      ),
    ];
    box.replaceChildren(...parts.filter(Boolean));
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

  function starButton(article) {
    const on = Boolean(favorites[article.articleId]);
    return ui.iconButton(
      t(on ? 'favRemove' : 'favAdd'),
      on ? 'starFilled' : 'star',
      () => store.toggleFavorite(article),
      on ? 'cmcs-icon-btn--star' : '',
    );
  }

  function itemActions(item) {
    const actions = [starButton(item)];
    if (item.status !== store.STATUS.IN_CART) {
      const alt = cm.alternativesUrl(item);
      if (alt) actions.push(ui.iconLink(t('findAlternative'), 'search', alt));
      actions.push(ui.iconButton(t('refillOne'), 'refresh', () => refill([item])));
    }
    actions.push(ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item])));
    return actions;
  }

  function favoriteActions(fav, inCart) {
    const offer = cm.offerUrl(fav);
    const seller = cm.sellerSearchUrl(fav);
    return [
      inCart ? null : ui.iconButton(t('favAddToCart'), 'cart', () => addFavoritesToCart([fav])),
      offer ? ui.iconLink(t('favOpenOffer'), 'external', offer) : null,
      seller ? ui.iconLink(t('favSellerOffers'), 'user', seller) : null,
      ui.iconButton(t('favRemove'), 'starFilled', () => store.removeFavorites([fav.articleId]), 'cmcs-icon-btn--star'),
    ].filter(Boolean);
  }

  function renderTabs() {
    const count = Object.keys(favorites).length;
    $('tab-fav').textContent = t('tabFavorites', count);
    $('tab-cart').setAttribute('aria-selected', String(tab === 'cart'));
    $('tab-fav').setAttribute('aria-selected', String(tab === 'fav'));
    $('view-cart').hidden = tab !== 'cart';
    $('view-fav').hidden = tab !== 'fav';
    $('notice').hidden = !notice;
    $('notice').textContent = notice || '';
  }

  function renderFavorites() {
    const all = Object.values(favorites).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
    $('fav-empty').hidden = all.length > 0;
    $('fav-search').hidden = all.length === 0;
    const multiGame = new Set(all.map((fav) => fav.game)).size > 1;
    const visible = all.filter((fav) => store.favoriteMatches(fav, query));
    $('fav-list').replaceChildren(
      ...(all.length && !visible.length
        ? [h('p', { class: 'cmcs-muted' }, t('favNoMatches'))]
        : visible.map((fav) => {
            const inCart = items[fav.articleId] && items[fav.articleId].status === store.STATUS.IN_CART;
            return ui.itemRow(inCart ? { ...fav, status: store.STATUS.IN_CART } : fav, {
              href: cm.offerUrl(fav) || fav.productUrl,
              showStatus: inCart,
              extraMeta: [
                multiGame ? fav.game : null,
                fav.available ? t('favAvailable', fav.available) : null,
                t('favSavedOn', formatDate(fav.favoritedAt)),
              ]
                .filter(Boolean)
                .join(' · '),
              note: fav.unavailable && !inCart ? fav.unavailableMessage || t('notAvailableAnymore') : null,
              actions: favoriteActions(fav, inCart),
            });
          })),
    );
  }

  function render() {
    renderTabs();
    renderJob();
    renderFavorites();
    renderCart();
  }

  function renderCart() {
    const all = Object.values(items);
    const games = [...new Set(all.map((item) => item.game).filter(Boolean))].sort();

    $('empty').hidden = all.length > 0;
    for (const id of ['summary', 'actions', 'filters', 'list']) $(id).hidden = all.length === 0;
    if (!all.length || tab !== 'cart') {
      $('game').hidden = true;
      if (!all.length) return;
    }

    if (!game || !games.includes(game)) {
      const byMissing = games
        .map((g) => [g, store.summarize(items, g).missing])
        .sort((a, b) => b[1] - a[1]);
      game = tabLoc && games.includes(tabLoc.game) ? tabLoc.game : byMissing[0][0];
    }
    const select = $('game');
    select.hidden = games.length < 2 || tab !== 'cart';
    select.replaceChildren(...games.map((g) => h('option', { value: g, selected: g === game }, g)));

    const forGame = all.filter((item) => item.game === game);
    const summary = store.summarize(items, game);
    $('summary').replaceChildren(
      stat('in_cart', summary.inCart, t('statusInCart')),
      stat('missing', summary.missing, t('statusMissing')),
      stat('unavailable', summary.unavailable, t('statusUnavailable')),
    );

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
    [items, favorites, job] = await Promise.all([store.getItems(), store.getFavorites(), store.getJob()]);
    render();
  }

  store.onChanged(load);
  await load();
})();

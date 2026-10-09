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

  const { STATUS } = store;
  // "Partly in the cart" shows under both: it is there, and copies can be put back.
  const FILTERS = [
    { id: 'all', label: 'filterAll', test: () => true },
    { id: 'missing', label: 'statusMissing', test: (item) => item.status === STATUS.MISSING || item.status === STATUS.PARTIAL },
    { id: 'in_cart', label: 'statusInCart', test: (item) => item.status === STATUS.IN_CART || item.status === STATUS.PARTIAL },
    { id: 'unavailable', label: 'statusUnavailable', test: (item) => item.status === STATUS.UNAVAILABLE },
  ];
  const STATUS_ORDER = { missing: 0, partial: 1, unavailable: 2, in_cart: 3 };
  const inCartStatus = (item) => Boolean(item) && (item.status === STATUS.IN_CART || item.status === STATUS.PARTIAL);

  const TAB_KEY = 'cmcs.popupTab';

  let items = {};
  let favorites = {};
  let carts = [];
  let job = null;
  /** The game picked in the cart tab; ALL shows every game together (one cart on Cardmarket). */
  const ALL = '*';
  const GAME_KEY = 'cmcs.popupGame';
  let game = null;
  try {
    game = localStorage.getItem(GAME_KEY);
  } catch {
    // Not remembered: pick one below.
  }
  /** The selected game as a filter (undefined = all games). */
  const gameFilter = () => (game === ALL ? undefined : game);
  let filter = 'all';
  /** Games left out of "put back" in the all-games view. */
  const skippedGames = new Set();
  let notice = null;
  let query = '';
  let tab = 'cart';
  const TABS = ['cart', 'fav', 'carts'];
  try {
    const remembered = localStorage.getItem(TAB_KEY);
    tab = TABS.includes(remembered) ? remembered : 'cart';
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
    try {
      localStorage.setItem(GAME_KEY, game);
    } catch {
      // Only a convenience.
    }
    render();
  });
  for (const [id, name] of [['tab-cart', 'cart'], ['tab-fav', 'fav'], ['tab-carts', 'carts']]) {
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
  $('export-text').addEventListener('click', () => copyText(store.exportText(currentList())));
  $('export-csv').addEventListener('click', () =>
    download(`cart-saver-${game === ALL ? 'all' : game || 'list'}.csv`, store.exportCsv(currentList()), 'text/csv'),
  );
  $('cart-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const list = currentList().filter((item) => item.status !== STATUS.UNAVAILABLE);
    if (!list.length) return showToast(t('cartsNothing'));
    const saved = await store.saveCart($('cart-name').value, list);
    $('cart-name').value = '';
    showToast(t('cartsSaved', saved.name));
  });

  // ---------------------------------------------------------------------------

  /** The saved list of the game (or all games) shown in the cart tab. */
  function currentList() {
    return Object.values(items)
      .filter((item) => !gameFilter() || item.game === game)
      .sort((a, b) => (a.seller || '').localeCompare(b.seller || '') || a.name.localeCompare(b.name));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('exportCopied'));
    } catch {
      download('cart-saver.txt', text, 'text/plain');
    }
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['\ufeff', text], { type: `${type};charset=utf-8` }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  let toastTimer = null;
  /** A short message at the bottom, optionally with one action (e.g. undo). */
  function showToast(text, action) {
    const toast = $('toast');
    clearTimeout(toastTimer);
    toast.replaceChildren(
      ...[
        h('span', null, text),
        action ? h('button', { type: 'button', onclick: () => { toast.hidden = true; action.onClick(); } }, action.label) : null,
      ].filter(Boolean),
    );
    toast.hidden = false;
    toastTimer = setTimeout(() => (toast.hidden = true), action ? 8000 : 3000);
  }

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

  async function removeItems(list) {
    const taken = await store.takeItems(list.map((item) => item.articleId));
    if (!taken.length) return;
    showToast(taken.length === 1 ? t('removedOne', taken[0].name) : t('removedMany', taken.length), {
      label: t('undo'),
      onClick: () => store.restoreItems(taken),
    });
  }

  /** Put a saved cart back: its articles join the list and go back into the cart. */
  async function restoreCart(cart) {
    await store.ensureItems(cart.items);
    const saved = await store.getItems();
    game = cart.game || ALL;
    tab = 'cart';
    await refill(cart.items.map((item) => saved[item.articleId]).filter((item) => item && item.status !== STATUS.IN_CART));
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
    const interrupted = store.isJobInterrupted(job) && !job.acknowledged;
    if (!active && !recent && !interrupted) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (interrupted) {
      const ids = (job.articleIds || []).filter((id) => !(job.results || {})[id] && items[id] && items[id].status !== STATUS.IN_CART);
      box.replaceChildren(
        h('p', null, h('strong', null, t('interruptedTitle')), ' — ', t('interruptedLead', ids.length)),
        h(
          'div',
          { class: 'job-row' },
          ids.length
            ? h('button', { type: 'button', class: 'cmcs-btn', onclick: () => continueJob(ids) }, t('continueRefill', ids.length))
            : h('span'),
          h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost', onclick: () => store.dismissJob() }, t('close')),
        ),
      );
      return;
    }
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

  async function continueJob(ids) {
    await store.dismissJob();
    job = await store.getJob();
    await refill(ids.map((id) => items[id]).filter(Boolean));
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
    if (item.status !== STATUS.IN_CART) {
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
    $('tab-fav').textContent = t('tabFavorites', Object.keys(favorites).length);
    $('tab-carts').textContent = t('tabCarts', carts.length);
    for (const name of TABS) {
      $(`tab-${name}`).setAttribute('aria-selected', String(tab === name));
      $(`view-${name}`).hidden = tab !== name;
    }
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
            const inCart = inCartStatus(items[fav.articleId]);
            return ui.itemRow(inCart ? { ...fav, status: STATUS.IN_CART } : fav, {
              href: cm.offerUrl(fav) || fav.productUrl,
              showStatus: inCart,
              extraMeta: [
                multiGame ? store.gameName(fav.game) : null,
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

  function renderCarts() {
    $('carts-empty').hidden = carts.length > 0;
    $('carts-list').replaceChildren(
      ...carts.map((cart) => {
        const value = cart.items.reduce((sum, item) => sum + (item.price || 0) * (item.wantedAmount || item.amount || 1), 0);
        return h(
          'div',
          { class: 'saved-cart' },
          h('div', { class: 'saved-cart-head' }, h('span', { class: 'saved-cart-name', title: cart.name }, cart.name)),
          h(
            'div',
            { class: 'saved-cart-meta' },
            t(
              'cartsMeta',
              cart.items.length,
              store.formatPrice(value),
              [cart.game ? store.gameName(cart.game) : t('allGames'), formatDate(cart.createdAt)].join(' · '),
            ),
          ),
          h(
            'div',
            { class: 'saved-cart-actions' },
            h('button', { type: 'button', class: 'cmcs-btn', disabled: store.isJobActive(job), onclick: () => restoreCart(cart) }, t('cartsRestore')),
            h('button', { type: 'button', class: 'cmcs-linklike', onclick: () => copyText(store.exportText(cart.items)) }, t('exportCopy')),
            h(
              'button',
              { type: 'button', class: 'cmcs-linklike', onclick: () => download(`${cart.name}.csv`, store.exportCsv(cart.items), 'text/csv') },
              'CSV',
            ),
            h('span', { style: 'flex:1' }),
            ui.iconButton(t('cartsDelete'), 'close', () => store.removeCart(cart.id)),
          ),
        );
      }),
    );
  }

  function render() {
    renderTabs();
    renderJob();
    renderFavorites();
    renderCart();
    renderCarts();
  }

  function renderCart() {
    const all = Object.values(items);
    const games = [...new Set(all.map((item) => item.game).filter(Boolean))].sort();

    $('empty').hidden = all.length > 0;
    for (const id of ['summary', 'actions', 'filters', 'list', 'export']) $(id).hidden = all.length === 0;
    if (!all.length) $('refill-games').hidden = true;
    if (!all.length || tab !== 'cart') {
      $('game').hidden = true;
      if (!all.length) return;
    }

    // Several games: all of them together, unless you picked one.
    if (games.length < 2) game = games[0];
    else if (game !== ALL && !games.includes(game)) game = ALL;
    const select = $('game');
    select.hidden = games.length < 2 || tab !== 'cart';
    select.replaceChildren(
      h('option', { value: ALL, selected: game === ALL }, t('allGames')),
      ...games.map((g) => h('option', { value: g, selected: g === game }, store.gameName(g))),
    );

    const forGame = all.filter((item) => !gameFilter() || item.game === game);
    const multiGame = new Set(forGame.map((item) => item.game)).size > 1;
    const summary = store.summarize(items, gameFilter());
    $('summary').replaceChildren(
      stat('in_cart', summary.inCart, t('statusInCart')),
      stat('missing', summary.attention, t('statusMissing')),
      stat('unavailable', summary.unavailable, t('statusUnavailable')),
    );

    const candidates = store.refillCandidates(items, { game: gameFilter() });
    const candidateGames = [...new Set(candidates.map((item) => item.game))];
    const missing = candidates.filter((item) => candidateGames.length < 2 || !skippedGames.has(item.game));
    const busy = store.isJobActive(job);
    // Several games to put back: choose which.
    const chips = $('refill-games');
    chips.hidden = candidateGames.length < 2;
    chips.replaceChildren(
      ...(candidateGames.length < 2
        ? []
        : [
            h('span', { class: 'cmcs-chips-label' }, t('refillGamesLabel')),
            ...candidateGames.map((g) =>
              h(
                'button',
                {
                  type: 'button',
                  class: 'cmcs-chip',
                  'aria-pressed': String(!skippedGames.has(g)),
                  onclick: () => {
                    if (skippedGames.has(g)) skippedGames.delete(g);
                    else skippedGames.add(g);
                    render();
                  },
                },
                `${store.gameName(g)} (${candidates.filter((item) => item.game === g).length})`,
              ),
            ),
          ]),
    );
    $('actions').replaceChildren(
      h(
        'button',
        { type: 'button', class: 'cmcs-btn', disabled: !missing.length || busy, onclick: () => refill(missing) },
        missing.length ? t('refillAll', missing.length) : t('nothingToRefill'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'cmcs-btn cmcs-btn--ghost',
          onclick: () => openUrl(cm.cartUrl(langFor(forGame), gameFilter() || (tabLoc && tabLoc.game) || forGame[0].game)),
        },
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
              bySeller.get(seller).map((item) =>
                ui.itemRow(item, {
                  showStatus: true,
                  showSeller: false,
                  extraMeta: multiGame ? store.gameName(item.game) : null,
                  actions: itemActions(item),
                }),
              ),
            ),
          ])
        : [h('p', { class: 'cmcs-muted' }, t('filterEmpty'))]),
    );
  }

  async function load() {
    [items, favorites, job, carts] = await Promise.all([store.getItems(), store.getFavorites(), store.getJob(), store.getCarts()]);
    render();
  }

  store.onChanged((changes) => {
    if (!store.isHeartbeatOnly(changes)) load();
  });
  await load();
})();

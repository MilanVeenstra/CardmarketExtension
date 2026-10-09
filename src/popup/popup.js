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
  $('brand').append(ui.brand(20));
  $('options').append(ui.icon('settings'));

  const { STATUS } = store;
  const inCartStatus = (item) => Boolean(item) && (item.status === STATUS.IN_CART || item.status === STATUS.PARTIAL);
  const bySellerName = (a, b) => (a.seller || '').localeCompare(b.seller || '') || a.name.localeCompare(b.name);

  const TAB_KEY = 'cmcs.popupTab';

  let items = {};
  let favorites = {};
  let carts = [];
  let job = null;
  let meta = {};
  /** The game picked in the header; ALL shows every game together (one cart on Cardmarket). */
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
  /** Games left out of "put back" in the all-games view. */
  const skippedGames = new Set();
  /** Sellers folded into one line, the opened row, and whether "in your cart" is shown. */
  const closedSellers = new Set();
  let openId = null;
  let showInCart = false;
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
    if (!saved) return showToast(t('cartsFull', String(store.MAX_CARTS)));
    $('cart-name').value = '';
    showToast(t('cartsSaved', saved.name));
  });

  // ---------------------------------------------------------------------------

  /** The saved list of the game (or all games) shown in the cart tab. */
  function currentList() {
    return Object.values(items)
      .filter((item) => !gameFilter() || item.game === game)
      .sort(bySellerName);
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
    a.href = URL.createObjectURL(new Blob(['﻿', text], { type: `${type};charset=utf-8` }));
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
        if (response && response.error) {
          notice = response.error === 'busy' ? t('errorBusy') : ui.errorText(response.error) || t('errorUnknown');
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

  /** Delete a saved cart, with a way back. */
  async function deleteCart(cart) {
    const taken = await store.takeCart(cart.id);
    if (taken) showToast(t('cartsDeleted', taken.name), { label: t('undo'), onClick: () => store.restoreCart(taken) });
  }

  /** Take the star off a favourite, with a way back. */
  async function unstar(fav) {
    const taken = await store.takeFavorites([fav.articleId]);
    if (taken.length) showToast(t('favRemoved', fav.name), { label: t('undo'), onClick: () => store.restoreFavorites(taken) });
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
  // The refill in progress (or just finished)
  // ---------------------------------------------------------------------------

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
            ? h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--small', onclick: () => continueJob(ids) }, t('continueRefill', ids.length))
            : h('span'),
          h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost cmcs-btn--small', onclick: () => store.dismissJob() }, t('close')),
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
          h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost cmcs-btn--small', onclick: cancelJob }, t('stop')),
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
        h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--ghost cmcs-btn--small', onclick: acknowledgeJob }, t('close')),
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

  // ---------------------------------------------------------------------------
  // Pieces
  // ---------------------------------------------------------------------------

  function starButton(article, asDetail = false) {
    const on = Boolean(favorites[article.articleId]);
    const label = t(on ? 'favRemove' : 'favAdd');
    if (asDetail) {
      return h('button', { type: 'button', class: 'cmcs-detail-btn', title: label, 'aria-label': label, onclick: () => store.toggleFavorite(article) }, ui.icon(on ? 'starFilled' : 'star'));
    }
    return ui.iconButton(label, on ? 'starFilled' : 'star', () => store.toggleFavorite(article), on ? 'cmcs-icon-btn--star' : '');
  }

  const detailIcon = (label, iconName, onClick) =>
    h('button', { type: 'button', class: 'cmcs-detail-btn', title: label, 'aria-label': label, onclick: onClick }, ui.icon(iconName));

  const toggleRow = (id) => () => {
    openId = openId === id ? null : id;
    render();
  };

  /** Value of what goes back: price × the copies still missing. */
  const refillValue = (list) => list.reduce((sum, item) => sum + (item.price || 0) * store.refillAmount(item), 0);
  const rowValue = (list) => list.reduce((sum, item) => sum + (item.price || 0) * ui.copiesOf(item), 0);

  /** A seller's articles: a header with the subtotal; folded, one line with the pictures. */
  function sellerGroup(seller, list, rowFor) {
    const closed = closedSellers.has(seller);
    const toggle = () => {
      if (closed) closedSellers.delete(seller);
      else closedSellers.add(seller);
      render();
    };
    const subtotal = store.formatPrice(rowValue(list));
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

  function groupBySeller(list, rowFor) {
    const groups = store.groupBy([...list].sort(bySellerName), (item) => item.seller || '—');
    return [...groups.entries()].map(([seller, group]) => sellerGroup(seller, group, rowFor));
  }

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------

  function renderTabs() {
    $('tab-fav').textContent = t('tabFavorites', Object.keys(favorites).length);
    $('tab-carts').textContent = t('tabCarts', carts.length);
    for (const name of TABS) {
      $(`tab-${name}`).setAttribute('aria-selected', String(tab === name));
      $(`view-${name}`).hidden = tab !== name;
    }
    $('notice').hidden = !notice;
    $('notice').textContent = notice || '';
    // Sold articles the daily clean-up took off the list: said once.
    const pruned = meta.pruned && meta.pruned.count;
    $('pruned').hidden = !pruned;
    $('pruned').replaceChildren(
      ...(pruned
        ? [
            t('prunedNote', String(pruned)),
            ' ',
            h('button', { type: 'button', class: 'cmcs-link', onclick: () => store.updateMeta((m) => ({ ...m, pruned: null })) }, t('ok')),
          ]
        : []),
    );
  }

  function renderCart() {
    const all = Object.values(items);
    const games = [...new Set(all.map((item) => item.game).filter(Boolean))].sort();

    $('empty').hidden = all.length > 0;
    for (const id of ['summary', 'list', 'export']) $(id).hidden = all.length === 0;
    const foot = $('foot');
    foot.hidden = tab !== 'cart' || all.length === 0;
    if (!all.length) {
      $('refill-games').hidden = true;
      $('game').hidden = true;
      return;
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
    const candidates = store.refillCandidates(items, { game: gameFilter() });
    const candidateGames = [...new Set(candidates.map((item) => item.game))];
    const toRefill = candidates.filter((item) => candidateGames.length < 2 || !skippedGames.has(item.game));
    const unavailable = forGame.filter((item) => item.status === STATUS.UNAVAILABLE);
    const inCart = forGame.filter((item) => item.status === STATUS.IN_CART);
    const busy = store.isJobActive(job);

    // The big picture first.
    const sellers = (list) => new Set(list.map((item) => item.seller || '—')).size;
    let title;
    let sub;
    if (candidates.length) {
      title = t('summaryCanReturn', candidates.length);
      const emptied = candidates.every((item) => item.missingReason === 'emptied');
      sub = [t('summarySub', store.formatPrice(refillValue(candidates)), sellers(candidates)), emptied ? t('summaryEmptied') : null]
        .filter(Boolean)
        .join(' · ');
    } else if (inCart.length) {
      title = t('summaryAllIn');
      const copies = inCart.reduce((sum, item) => sum + (item.amount || 1), 0);
      sub = t('summaryAllInSub', copies, store.formatPrice(rowValue(inCart)), sellers(inCart));
    } else {
      title = t('nothingToRefill');
      sub = null;
    }
    $('summary').replaceChildren(
      ...[
        h('h2', { class: 'cmcs-summary-title' }, title),
        sub ? h('p', { class: 'cmcs-summary-sub' }, sub) : null,
        h(
          'button',
          { type: 'button', class: 'cmcs-link open-cart', onclick: () => openUrl(cm.cartUrl(langFor(forGame), gameFilter() || (tabLoc && tabLoc.game) || forGame[0].game)) },
          t('openCart'),
        ),
      ].filter(Boolean),
    );

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

    // Articles that can go back, per seller.
    const missingRow = (item) =>
      ui.itemRow(item, {
        open: openId === item.articleId,
        onToggle: toggleRow(item.articleId),
        withGame: multiGame,
        details: [
          ui.detailButton(t('detailRefillOne'), () => refill([item]), { strong: true }),
          ui.detailButton(t('detailOpen'), null, { href: cm.offerUrl(item) || item.productUrl }),
          cm.alternativesUrl(item) ? h('a', { class: 'cmcs-detail-btn', href: cm.alternativesUrl(item), target: '_blank', rel: 'noopener', title: t('findAlternative'), 'aria-label': t('findAlternative') }, ui.icon('search')) : null,
          starButton(item, true),
          detailIcon(t('removeFromSaved'), 'close', () => removeItems([item])),
        ].filter(Boolean),
      });
    const inCartRow = (item) =>
      ui.itemRow(item, {
        open: openId === item.articleId,
        onToggle: toggleRow(item.articleId),
        withGame: multiGame,
        details: [
          ui.detailButton(t('detailOpen'), null, { href: cm.offerUrl(item) || item.productUrl }),
          starButton(item, true),
          detailIcon(t('removeFromSaved'), 'close', () => removeItems([item])),
        ],
      });
    const soldRow = (item) => {
      const alt = cm.alternativesUrl(item);
      return ui.itemRow(item, {
        sold: true,
        hideMeta: false,
        note: item.lastAttempt && item.lastAttempt.message ? item.lastAttempt.message : null,
        withGame: multiGame,
        below: alt ? h('a', { class: 'cmcs-link', href: alt, target: '_blank', rel: 'noopener' }, t('findAlternative')) : null,
        actions: [
          ui.iconButton(t('refillOne'), 'refresh', () => refill([item])),
          ui.iconButton(t('removeFromSaved'), 'close', () => removeItems([item])),
        ],
      });
    };

    const list = [];
    list.push(groupBySeller(candidates, missingRow));
    if (unavailable.length) {
      list.push(
        h('div', { class: 'cmcs-section-title' }, t('sectionUnavailable')),
        [...unavailable].sort(bySellerName).map(soldRow),
        h(
          'div',
          { class: 'section-actions' },
          h('button', { type: 'button', class: 'cmcs-link', onclick: () => refill(unavailable) }, t('retryUnavailable')),
          h('button', { type: 'button', class: 'cmcs-link', onclick: () => removeItems(unavailable) }, t('clearUnavailable')),
        ),
      );
    }
    if (inCart.length) {
      list.push(
        h(
          'div',
          { class: 'in-cart-line' },
          h('span', null, t('sectionInCart', inCart.length)),
          h('button', { type: 'button', class: 'cmcs-link', 'aria-expanded': String(showInCart), onclick: () => { showInCart = !showInCart; render(); } }, showInCart ? t('hide') : t('show')),
        ),
      );
      if (showInCart) list.push(groupBySeller(inCart, inCartRow));
    }
    $('list').replaceChildren(...list.flat(Infinity).filter(Boolean));

    // The one big button.
    foot.replaceChildren(
      toRefill.length
        ? ui.primaryButton(t('refillButton', toRefill.length), store.formatPrice(refillValue(toRefill)), () => refill(toRefill), { disabled: busy })
        : ui.primaryButton(t('nothingToRefill'), '', null, { disabled: true }),
    );
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
            const sold = fav.unavailable && !inCart;
            const offer = cm.offerUrl(fav);
            const seller = cm.sellerSearchUrl(fav);
            return ui.itemRow(inCart ? { ...fav, status: STATUS.IN_CART } : { ...fav, status: 'offer' }, {
              href: offer || fav.productUrl,
              sold,
              note: sold ? fav.unavailableMessage || t('notAvailableAnymore') : inCart ? t('favInCartNote') : undefined,
              extraMeta: [
                multiGame ? store.gameName(fav.game) : null,
                fav.seller,
                fav.available ? t('favAvailable', fav.available) : null,
                t('favSavedOn', formatDate(fav.favoritedAt)),
              ]
                .filter(Boolean)
                .join(' · '),
              actions: [
                inCart || sold ? null : ui.iconButton(t('favAddToCart'), 'cart', () => addFavoritesToCart([fav])),
                offer ? ui.iconLink(t('favOpenOffer'), 'external', offer) : null,
                seller ? ui.iconLink(t('favSellerOffers'), 'user', seller) : null,
                ui.iconButton(t('favRemove'), 'starFilled', () => unstar(fav), 'cmcs-icon-btn--star'),
              ].filter(Boolean),
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
          h('div', { class: 'saved-cart-name', title: cart.name }, cart.name),
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
            h('button', { type: 'button', class: 'cmcs-btn cmcs-btn--small', disabled: store.isJobActive(job), onclick: () => restoreCart(cart) }, t('cartsRestore')),
            h('button', { type: 'button', class: 'cmcs-link', onclick: () => copyText(store.exportText(cart.items)) }, t('exportCopy')),
            h('button', { type: 'button', class: 'cmcs-link', onclick: () => download(`${cart.name}.csv`, store.exportCsv(cart.items), 'text/csv') }, 'CSV'),
            h('span', { style: 'flex:1' }),
            ui.iconButton(t('cartsDelete'), 'close', () => deleteCart(cart)),
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

  async function load() {
    let thumbs;
    [items, favorites, job, carts, thumbs, meta] = await Promise.all([
      store.getItems(),
      store.getFavorites(),
      store.getJob(),
      store.getCarts(),
      store.getThumbs(),
      store.getMeta(),
    ]);
    ui.setThumbs(thumbs);
    render();
  }

  store.onChanged((changes) => {
    if (!store.isHeartbeatOnly(changes)) load();
  });
  await load();
})();

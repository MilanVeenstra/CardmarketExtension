(async function options() {
  'use strict';

  const { store, ui, t } = CMCS;
  const $ = (id) => document.getElementById(id);

  const style = document.createElement('style');
  style.textContent = ui.STYLES;
  document.head.prepend(style);
  CMCS.localize(document);
  $('logo').append(ui.logo(44));
  document.documentElement.lang = chrome.i18n.getUILanguage();

  // --- Settings --------------------------------------------------------------

  const settings = await store.getSettings();
  $('autoTrack').checked = settings.autoTrack;
  $('showReminder').checked = settings.showReminder;
  $('notify').checked = settings.notify;
  $('awayChecks').checked = settings.awayChecks;
  $('priceTrend').checked = settings.priceTrend;
  $('delay').value = (settings.delayMs / 1000).toFixed(1);

  let savedTimer = null;
  async function save(patch) {
    await store.saveSettings(patch);
    $('saved').textContent = t('settingsSaved');
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => ($('saved').textContent = ''), 1800);
  }

  $('autoTrack').addEventListener('change', (e) => save({ autoTrack: e.target.checked }));
  $('showReminder').addEventListener('change', (e) => save({ showReminder: e.target.checked }));
  $('notify').addEventListener('change', (e) => save({ notify: e.target.checked }));
  $('awayChecks').addEventListener('change', (e) => save({ awayChecks: e.target.checked }));
  $('priceTrend').addEventListener('change', (e) => save({ priceTrend: e.target.checked }));

  /** When the price guide was last read, or why not. */
  async function renderTrendStatus() {
    const { 'cmcs.prices': status } = await chrome.storage.local.get('cmcs.prices');
    if (!status) {
      $('trendStatus').textContent = '';
      return;
    }
    const when = new Date(status.at).toLocaleString(chrome.i18n.getUILanguage(), { dateStyle: 'short', timeStyle: 'short' });
    const cards = Object.values(status.games || {}).reduce((sum, n) => sum + n, 0);
    $('trendStatus').textContent = status.error ? t('trendStatusError', status.error) : t('trendStatus', when, String(cards));
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['cmcs.prices']) renderTrendStatus();
  });
  renderTrendStatus();
  $('delay').addEventListener('change', (e) => {
    const seconds = Math.min(10, Math.max(0.5, parseFloat(e.target.value) || 1.2));
    e.target.value = seconds.toFixed(1);
    save({ delayMs: Math.round(seconds * 1000) });
  });

  // --- Data ------------------------------------------------------------------

  async function renderSummary() {
    const [items, favorites] = await Promise.all([store.getItems(), store.getFavorites()]);
    const summary = store.summarize(items);
    $('dataSummary').textContent = t(
      'dataSummary',
      summary.total,
      summary.inCart,
      summary.attention,
      summary.unavailable,
      Object.keys(favorites).length,
    );
  }
  store.onChanged(renderSummary);
  renderSummary();

  $('export').addEventListener('click', async () => {
    const payload = {
      format: 'cardmarket-cart-saver',
      version: 3,
      exportedAt: new Date().toISOString(),
      items: await store.getItems(),
      favorites: await store.getFavorites(),
      carts: await store.getCarts(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cart-saver-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  /** Links in an imported file must point where they claim to; anything else is dropped. */
  function cleanLinks(item) {
    const safe = (value, test) => {
      if (typeof value !== 'string') return null;
      try {
        return test(new URL(value)) ? value : null;
      } catch {
        return null;
      }
    };
    const onCardmarket = (u) => u.protocol === 'https:' && u.hostname === 'www.cardmarket.com';
    const image = (u) => u.protocol === 'https:' && /(^|\.)cardmarket\.com$/.test(u.hostname);
    // Pictures are fetched again by the background; old exports may still carry copies.
    const { thumb, thumbTriedAt, ...rest } = item;
    return {
      ...rest,
      productUrl: safe(item.productUrl, onCardmarket),
      sellerUrl: safe(item.sellerUrl, onCardmarket),
      imageUrl: safe(item.imageUrl, image),
    };
  }

  $('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const isArticle = (item) =>
        item && /^\d+$/.test(String(item.articleId)) && typeof item.name === 'string' && typeof item.game === 'string';
      const incoming = data && typeof data.items === 'object' ? data.items : data;
      const validItems = Object.values(incoming || {}).filter(isArticle).map(cleanLinks);
      const validFavorites = Object.values((data && data.favorites) || {}).filter(isArticle).map(cleanLinks);
      const validCarts = (Array.isArray(data && data.carts) ? data.carts : [])
        .filter((cart) => cart && typeof cart.id === 'string' && typeof cart.name === 'string' && Array.isArray(cart.items))
        .map((cart) => ({ ...cart, items: cart.items.filter(isArticle).map(cleanLinks) }))
        .filter((cart) => cart.items.length);
      if (!validItems.length && !validFavorites.length && !validCarts.length) throw new Error('nothing to import');
      let added = 0;
      await store.updateItems((items) => {
        const next = { ...items };
        for (const item of validItems) {
          if (next[item.articleId]) continue;
          next[item.articleId] = { ...item, status: item.status === store.STATUS.UNAVAILABLE ? item.status : store.STATUS.MISSING };
          added += 1;
        }
        return next;
      });
      await store.updateFavorites((favorites) => {
        const next = { ...favorites };
        for (const fav of validFavorites) {
          if (next[fav.articleId]) continue;
          next[fav.articleId] = fav;
          added += 1;
        }
        return next;
      });
      if (validCarts.length) {
        await store.updateCarts((carts) => {
          const known = new Set(carts.map((cart) => cart.id));
          const fresh = validCarts.filter((cart) => !known.has(cart.id));
          added += fresh.length;
          return [...carts, ...fresh].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        });
      }
      $('dataMessage').textContent = t('importDone', added);
    } catch {
      $('dataMessage').textContent = t('importFailed');
    }
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm(t('clearConfirm'))) return;
    await store.setItems({});
    await store.setFavorites({});
    await store.updateCarts(() => []);
    await store.setJob(null);
    $('dataMessage').textContent = t('cleared');
  });
})();

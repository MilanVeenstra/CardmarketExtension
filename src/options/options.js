(async function options() {
  'use strict';

  const { store, ui, t } = CMCS;
  const $ = (id) => document.getElementById(id);

  const style = document.createElement('style');
  style.textContent = ui.STYLES;
  document.head.prepend(style);
  CMCS.localize(document);
  document.documentElement.lang = chrome.i18n.getUILanguage();

  // --- Settings --------------------------------------------------------------

  const settings = await store.getSettings();
  $('autoTrack').checked = settings.autoTrack;
  $('showReminder').checked = settings.showReminder;
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
  $('delay').addEventListener('change', (e) => {
    const seconds = Math.min(10, Math.max(0.5, parseFloat(e.target.value) || 1.2));
    e.target.value = seconds.toFixed(1);
    save({ delayMs: Math.round(seconds * 1000) });
  });

  // --- Data ------------------------------------------------------------------

  async function renderSummary() {
    const summary = store.summarize(await store.getItems());
    $('dataSummary').textContent = t('dataSummary', summary.total, summary.inCart, summary.missing, summary.unavailable);
  }
  store.onChanged(renderSummary);
  renderSummary();

  $('export').addEventListener('click', async () => {
    const payload = { format: 'cardmarket-cart-saver', version: 1, exportedAt: new Date().toISOString(), items: await store.getItems() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cart-saver-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = data && typeof data.items === 'object' ? data.items : data;
      const valid = Object.values(incoming || {}).filter(
        (item) => item && /^\d+$/.test(String(item.articleId)) && typeof item.name === 'string' && typeof item.game === 'string',
      );
      if (!valid.length) throw new Error('no items');
      let added = 0;
      await store.updateItems((items) => {
        const next = { ...items };
        for (const item of valid) {
          if (next[item.articleId]) continue;
          next[item.articleId] = { ...item, status: item.status === store.STATUS.UNAVAILABLE ? item.status : store.STATUS.MISSING };
          added += 1;
        }
        return next;
      });
      $('dataMessage').textContent = t('importDone', added);
    } catch {
      $('dataMessage').textContent = t('importFailed');
    }
  });

  $('clear').addEventListener('click', async () => {
    if (!confirm(t('clearConfirm'))) return;
    await store.setItems({});
    await store.setJob(null);
    $('dataMessage').textContent = t('cleared');
  });
})();

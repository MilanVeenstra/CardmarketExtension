/*
 * Background service worker. All traffic with the cart happens in the content
 * script, inside the user's own cardmarket.com tab; this worker only:
 *
 * 1. Keeps the toolbar badge: saved articles no longer (fully) in the cart.
 * 2. Self-updates unpacked installs: when the files on disk were updated
 *    (e.g. by scripts/autoupdate-mac.sh pulling every push from GitHub), the
 *    extension reloads itself. A Chrome Web Store install updates through the
 *    store instead.
 * 3. Shows notifications: the cart was emptied while you looked elsewhere,
 *    or Cardmarket is about to empty it (5 minutes before the time it shows).
 * 4. Optional: asks an open Cardmarket tab to look at the cart every 10
 *    minutes while you are at the computer.
 * 5. Once a day: forgets unavailable articles older than a month, and
 *    (optional) reads Cardmarket's public price guide for the saved cards.
 * 6. Product pictures for the popup (see images.js).
 */
importScripts('../shared/store.js', 'images.js');

const { store, images } = self.CMCS;

const UPDATE_ALARM = 'cmcs.selfUpdate';
const UPDATE_CHECK_MINUTES = 1;
/** Wait this long and read the files again, so a half-finished update is never loaded. */
const UPDATE_SETTLE_MS = 5000;

async function updateBadge() {
  // Copies that can go back: the same number the popup and the panel show.
  const count = store.copiesToReturn(store.refillCandidates(await store.getItems()));
  await chrome.action.setBadgeBackgroundColor({ color: '#b3122b' });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: '#ffffff' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({
    title: count ? tn('badgeTitle', count, [String(count)]) : 'Cart Saver',
  });
}

async function readOwnFile(name) {
  const res = await fetch(chrome.runtime.getURL(name), { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.text();
}

/**
 * What identifies the files on disk: the commit the updater wrote into
 * build-id.txt (so every push counts), or else the manifest itself.
 */
async function fingerprintOnDisk() {
  const manifestText = await readOwnFile('manifest.json');
  const manifest = JSON.parse(manifestText); // throws while a pull is half-way
  let build = '';
  try {
    build = (await readOwnFile('build-id.txt')).trim();
  } catch {
    // No updater installed: the manifest decides.
  }
  return { id: build || manifestText, version: manifest.version };
}

/**
 * The fingerprint of the code that is actually running. Recorded at the first
 * service-worker start after the extension (re)loaded; session storage is
 * cleared on every reload and browser restart, which is exactly when the
 * running code is read from disk again.
 */
async function runningFingerprint() {
  const key = 'cmcs.runningBuild';
  const stored = (await chrome.storage.session.get(key))[key];
  if (stored) return stored;
  const current = (await fingerprintOnDisk()).id;
  await chrome.storage.session.set({ [key]: current });
  return current;
}

/**
 * Reload when the files on disk differ from the running ones. Resolves to
 * true when a reload was started.
 */
async function checkForNewVersion({ settleMs = UPDATE_SETTLE_MS, reload = () => chrome.runtime.reload() } = {}) {
  const self = await chrome.management.getSelf();
  if (self.installType !== 'development') return false;

  let running;
  let onDisk;
  try {
    running = await runningFingerprint();
    onDisk = await fingerprintOnDisk();
  } catch {
    return false; // mid-update or unreadable: try again next time
  }
  if (onDisk.id === running) return false;

  // Never pull the rug from under a refill that is putting articles back.
  if (store.isJobActive(await store.getJob())) return false;

  await new Promise((resolve) => setTimeout(resolve, settleMs));
  try {
    if ((await fingerprintOnDisk()).id !== onDisk.id) return false; // still changing
  } catch {
    return false;
  }
  // A refill may have started during the wait; and someone in the cart or at
  // checkout should not lose the extension mid-way (its clicks would go unseen).
  if (store.isJobActive(await store.getJob())) return false;
  if (await busyOnCardmarket()) return false;

  await chrome.storage.local.set({
    'cmcs.updated': { from: chrome.runtime.getManifest().version, to: onDisk.version, at: Date.now() },
  });
  reload();
  return true;
}

/** Is a Cardmarket cart, checkout or order page open in a tab you are looking at? */
async function busyOnCardmarket() {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      url: ['https://www.cardmarket.com/*/*/ShoppingCart*', 'https://www.cardmarket.com/*/*/Orders*'],
    });
    return tabs.length > 0;
  } catch {
    return false;
  }
}

async function ensureUpdateAlarm() {
  const self = await chrome.management.getSelf();
  if (self.installType !== 'development') return;
  if (!(await chrome.alarms.get(UPDATE_ALARM))) {
    await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
  }
}

// --- Notifications --------------------------------------------------------------

const EXPIRY_ALARM = 'cmcs.expiry';
const EXPIRY_WARN_MS = 5 * 60 * 1000;
const t = (key, subs) => chrome.i18n.getMessage(key, subs) || key;
/** `<key>One` for exactly one ("1 minuut"), `<key>` otherwise. */
const tn = (key, count, subs) => t(Number(count) === 1 ? `${key}One` : key, subs);

async function notify(id, title, message, url) {
  const settings = await store.getSettings();
  if (!settings.notify || !chrome.notifications) return false;
  await chrome.storage.session.set({ [`cmcs.notification.${id}`]: url });
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title,
    message,
    priority: 1,
  });
  return true;
}

/** Open (or show) the Cardmarket cart a notification was about. */
async function openFromNotification(id) {
  const key = `cmcs.notification.${id}`;
  const url = (await chrome.storage.session.get(key))[key];
  chrome.notifications.clear(id);
  if (!url) return;
  const [tab] = await chrome.tabs.query({ url: `${url.split('?')[0]}*` });
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

const cartUrl = (lang, game) => `https://www.cardmarket.com/${lang || 'en'}/${game}/ShoppingCart`;

/** When the cart will be emptied, as the cart page said (one cart for all games). */
async function nextExpiry() {
  const meta = await store.getMeta();
  const at = typeof meta.cartExpiry === 'number' ? meta.cartExpiry : null;
  return at && at > Date.now() ? { at } : null;
}

/** An alarm 5 minutes before the cart is emptied (or none). */
async function scheduleExpiryAlarm() {
  const next = await nextExpiry();
  await chrome.alarms.clear(EXPIRY_ALARM);
  if (!next) return null;
  const when = Math.max(Date.now() + 1000, next.at - EXPIRY_WARN_MS);
  await chrome.alarms.create(EXPIRY_ALARM, { when });
  return when;
}

async function warnExpiry() {
  const next = await nextExpiry();
  if (!next) return false;
  const items = await store.getItems();
  const inCart = Object.values(items).filter((item) => item.status === store.STATUS.IN_CART || item.status === store.STATUS.PARTIAL);
  if (!inCart.length) return false;
  const minutes = Math.max(1, Math.round((next.at - Date.now()) / 60000));
  return notify('expiry', t('notifyExpiryTitle'), tn('notifyExpiryText', minutes, [String(minutes)]), cartUrl(inCart[0].lang, inCart[0].game));
}

// --- Looking at the cart while you are away from Cardmarket ---------------------------

/** Favourites queued for the cart that no job tried (see store.sweepUntriedFavorites). */
const SWEEP_ALARM = 'cmcs.sweep';

async function sweepSoon() {
  if (store.hasUntriedFavorites(await store.getItems())) await chrome.alarms.create(SWEEP_ALARM, { delayInMinutes: 4 });
}

const AWAY_ALARM = 'cmcs.away';
const AWAY_MINUTES = 10;

async function ensureAwayAlarm() {
  const { awayChecks } = await store.getSettings();
  const existing = await chrome.alarms.get(AWAY_ALARM);
  if (awayChecks && !existing) await chrome.alarms.create(AWAY_ALARM, { periodInMinutes: AWAY_MINUTES });
  if (!awayChecks && existing) await chrome.alarms.clear(AWAY_ALARM);
}

/**
 * Ask one open Cardmarket tab to read its cart, if you are at the computer
 * and it was a while ago. (`idleState` can be given by the tests.)
 */
async function awayCheck({ idleState = (seconds) => chrome.idle.queryState(seconds) } = {}) {
  const { awayChecks } = await store.getSettings();
  if (!awayChecks) return false;
  if (chrome.idle && (await idleState(AWAY_MINUTES * 60)) !== 'active') return false;
  const tabs = await chrome.tabs.query({ url: 'https://www.cardmarket.com/*' });
  if (!tabs.length) return false;
  const meta = await store.getMeta();
  // One cart for all games: read recently by any tab is recent enough. (A little under the
  // alarm's period: the last check's own reading must not make this one skip.)
  if (meta.cartSync && Date.now() - meta.cartSync.at < (AWAY_MINUTES - 2) * 60 * 1000) return false;
  for (const tab of tabs) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'cmcs.sync' });
      if (reply && reply.ok) return true;
    } catch {
      // Tab without a (current) content script: try the next one.
    }
  }
  return false;
}

// --- Once a day -------------------------------------------------------------------------

const DAILY_ALARM = 'cmcs.daily';
const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_';
/** Cardmarket's game ids for the public price guide files. */
const PRICE_GUIDE_GAMES = { Magic: 1, YuGiOh: 3, Pokemon: 6, OnePiece: 18, Lorcana: 19 };

async function ensureDailyAlarm() {
  if (!(await chrome.alarms.get(DAILY_ALARM))) await chrome.alarms.create(DAILY_ALARM, { delayInMinutes: 1, periodInMinutes: 24 * 60 });
}

/** Sold articles nobody looked at for a month leave the list; the popup says so once. */
async function pruneStale() {
  const ids = store.staleIds(await store.getItems());
  if (!ids.length) return 0;
  await store.removeItems(ids);
  await store.updateMeta((meta) => ({ ...meta, pruned: { count: ((meta.pruned && meta.pruned.count) || 0) + ids.length, at: Date.now() } }));
  return ids.length;
}

/**
 * Read the public price guide of each game in the saved list and note the
 * trend price on the saved articles and favourites (foil-aware). Only the
 * saved cards are kept from the (large) file.
 */
/** The price guide is read at most this often (it changes once a day, and is large). */
const PRICE_GUIDE_MIN_AGE_MS = 20 * 60 * 60 * 1000;

async function refreshPrices({ force = false } = {}) {
  const settings = await store.getSettings();
  if (!settings.priceTrend && !force) return null;
  const last = (await chrome.storage.local.get('cmcs.prices'))['cmcs.prices'];
  if (!force && last && !last.error && Date.now() - (last.at || 0) < PRICE_GUIDE_MIN_AGE_MS) return last;
  const [items, favorites] = await Promise.all([store.getItems(), store.getFavorites()]);
  const articles = [...Object.values(items), ...Object.values(favorites)].filter((a) => a.productId);
  const games = [...new Set(articles.map((a) => a.game))].filter((game) => PRICE_GUIDE_GAMES[game]);
  const trends = {};
  const status = { at: Date.now(), games: {}, error: null };
  for (const game of games) {
    try {
      // "no-cache": asks the server whether it changed (304) instead of downloading it again.
      const res = await fetch(`${PRICE_GUIDE_URL}${PRICE_GUIDE_GAMES[game]}.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const wanted = new Set(articles.filter((a) => a.game === game).map((a) => String(a.productId)));
      let found = 0;
      for (const entry of data.priceGuides || []) {
        const id = String(entry.idProduct);
        if (!wanted.has(id)) continue;
        const foilTrend = entry['trend-foil'] ?? entry['trend-holo'] ?? null;
        trends[id] = { trend: entry.trend ?? null, foil: foilTrend };
        found += 1;
      }
      status.games[game] = found;
    } catch (err) {
      status.error = `${game}: ${err.message}`;
    }
  }
  const now = Date.now();
  const trendOf = (article) => {
    const entry = trends[String(article.productId)];
    if (!entry) return undefined;
    // Pokémon's (reverse) holo prices are the guide's "-holo" column, like foil for Magic.
    const shiny = article.foil || (article.extras || []).some((label) => /holo/i.test(label));
    const value = shiny ? entry.foil : entry.trend;
    // The guide writes 0 where it has no price: no trend, rather than "100% above".
    return value > 0 ? { value, at: now } : undefined;
  };
  const patch = (list) => {
    const patches = {};
    for (const article of list) {
      const trend = trendOf(article);
      if (trend) patches[article.articleId] = { trend };
    }
    return patches;
  };
  await store.patchItems(patch(Object.values(items)));
  await store.patchFavorites(patch(Object.values(favorites)));
  await chrome.storage.local.set({ 'cmcs.prices': status });
  return status;
}

/** Forget every trend price (the price guide is switched off). */
async function clearTrends() {
  const strip = (list) => Object.fromEntries(Object.values(list).filter((a) => a.trend).map((a) => [a.articleId, { trend: null }]));
  const [items, favorites] = await Promise.all([store.getItems(), store.getFavorites()]);
  await store.patchItems(strip(items));
  await store.patchFavorites(strip(favorites));
  await chrome.storage.local.remove('cmcs.prices');
}

async function daily() {
  await pruneStale();
  await images.pruneThumbs().catch(() => {});
  await refreshPrices().catch(() => {});
}

// --- Wiring ---------------------------------------------------------------------------

function setUp() {
  updateBadge();
  ensureUpdateAlarm();
  ensureAwayAlarm();
  ensureDailyAlarm();
  scheduleExpiryAlarm();
  images.captureSoon();
}

chrome.runtime.onInstalled.addListener(setUp);
chrome.runtime.onStartup.addListener(setUp);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForNewVersion();
  else if (alarm.name === EXPIRY_ALARM) warnExpiry();
  else if (alarm.name === AWAY_ALARM) awayCheck();
  else if (alarm.name === DAILY_ALARM) daily();
  else if (alarm.name === SWEEP_ALARM) store.getJob().then((job) => store.sweepUntriedFavorites(job)).then(sweepSoon);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[store.KEYS.items]) {
    updateBadge();
    sweepSoon();
  }
  if (changes[store.KEYS.items] || changes[store.KEYS.favorites] || changes[store.KEYS.carts]) images.captureSoon();
  if (changes[store.KEYS.meta]) {
    const before = (changes[store.KEYS.meta].oldValue || {}).cartExpiry;
    const after = (changes[store.KEYS.meta].newValue || {}).cartExpiry;
    if (JSON.stringify(before) !== JSON.stringify(after)) scheduleExpiryAlarm();
  }
  if (changes[store.KEYS.settings]) {
    ensureAwayAlarm();
    const was = (changes[store.KEYS.settings].oldValue || {}).priceTrend;
    const now = (changes[store.KEYS.settings].newValue || {}).priceTrend;
    if (!was && now) refreshPrices({ force: true }).catch(() => {});
    // Switched off: the notes about the trend go too.
    if (was && !now) clearTrends().catch(() => {});
  }
});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'cmcs.notify' || message.kind !== 'emptied') return false;
  const count = message.count || 0;
  notify(`emptied-${message.game}`, t('notifyEmptiedTitle'), tn('notifyEmptiedText', count, [String(count)]), cartUrl(message.lang, message.game)).then(
    (shown) => sendResponse({ ok: shown }),
    () => sendResponse({ ok: false }),
  );
  return true;
});
if (chrome.notifications) {
  chrome.notifications.onClicked.addListener(openFromNotification);
}

// Also after the extension was switched off and on (no onInstalled / onStartup then).
updateBadge();
scheduleExpiryAlarm();
ensureUpdateAlarm();
ensureAwayAlarm();
ensureDailyAlarm();
images.ensureImageRule().catch((err) => console.warn('[Cart Saver] picture rule:', err));
runningFingerprint().catch(() => {});

// Exposed for the end-to-end test.
self.cmcsCheckForNewVersion = checkForNewVersion;
self.cmcs = { warnExpiry, scheduleExpiryAlarm, awayCheck, refreshPrices, pruneStale, notify, images, sweepSoon };

/*
 * Background service worker. Two small jobs; all Cardmarket traffic happens
 * in the content script, inside the user's own cardmarket.com tab.
 *
 * 1. The toolbar badge: the number of saved articles no longer in the cart.
 * 2. Self-update for unpacked installs: when the files on disk were updated
 *    (e.g. by scripts/autoupdate-mac.sh pulling every push from GitHub), the
 *    extension reloads itself. A Chrome Web Store install updates through the
 *    store instead.
 */
importScripts('../shared/store.js');

const { store } = self.CMCS;

const UPDATE_ALARM = 'cmcs.selfUpdate';
const UPDATE_CHECK_MINUTES = 1;
/** Wait this long and read the files again, so a half-finished update is never loaded. */
const UPDATE_SETTLE_MS = 5000;

async function updateBadge() {
  const summary = store.summarize(await store.getItems());
  const count = summary.attention;
  await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({
    title: count ? chrome.i18n.getMessage('badgeTitle', [String(count)]) : 'Cart Saver',
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

  await chrome.storage.local.set({
    'cmcs.updated': { from: chrome.runtime.getManifest().version, to: onDisk.version, at: Date.now() },
  });
  reload();
  return true;
}

async function ensureUpdateAlarm() {
  const self = await chrome.management.getSelf();
  if (self.installType !== 'development') return;
  if (!(await chrome.alarms.get(UPDATE_ALARM))) {
    await chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  ensureUpdateAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  ensureUpdateAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) checkForNewVersion();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[store.KEYS.items]) updateBadge();
});

ensureUpdateAlarm();
runningFingerprint().catch(() => {});

// Exposed for the end-to-end test.
self.cmcsCheckForNewVersion = checkForNewVersion;

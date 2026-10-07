/*
 * Background service worker. Its only job is the toolbar badge: the number of
 * saved articles that are no longer in the cart. All Cardmarket traffic
 * happens in the content script, inside the user's own cardmarket.com tab.
 */
importScripts('../shared/store.js');

const { store } = self.CMCS;

async function updateBadge() {
  const summary = store.summarize(await store.getItems());
  const count = summary.missing;
  await chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  await chrome.action.setBadgeText({ text: count ? String(count) : '' });
  await chrome.action.setTitle({
    title: count ? chrome.i18n.getMessage('badgeTitle', [String(count)]) : 'Cart Saver',
  });
}

chrome.runtime.onInstalled.addListener(updateBadge);
chrome.runtime.onStartup.addListener(updateBadge);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[store.KEYS.items]) updateBadge();
});

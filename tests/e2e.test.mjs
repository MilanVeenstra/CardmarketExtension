/*
 * End-to-end test: loads the unpacked extension in Chromium and points
 * https://www.cardmarket.com at the mock in ./mock-cardmarket.mjs, so the real
 * content scripts, popup and service worker run against Cardmarket-shaped
 * pages and endpoints.
 *
 *   npm test                         # run
 *   SCREENSHOT_DIR=shots npm test    # also save screenshots
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMockCardmarket, ARTICLES } from './mock-cardmarket.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SCREENSHOT_DIR ? path.resolve(process.env.SCREENSHOT_DIR) : null;
const CM = 'https://www.cardmarket.com';
const [BOG, MAGE, EPHEMERATE, SOL_RING, SOL_KINGDOM, SOL_MINT] = ARTICLES.map((a) => a.articleId);
const SOL_RING_URL = `https://www.cardmarket.com/en/Magic/Products/Singles/Commander-Masters/Sol-Ring`;
const DELAY_MS = 300;

let context;
let sw;
let extensionId;
let mock;

async function storage() {
  return sw.evaluate(() => chrome.storage.local.get(null));
}

async function items() {
  return (await storage())['cmcs.items'] || {};
}

async function patchItems(patch) {
  await sw.evaluate(async (p) => {
    const { 'cmcs.items': current = {} } = await chrome.storage.local.get('cmcs.items');
    for (const [id, fields] of Object.entries(p)) current[id] = { ...current[id], ...fields };
    await chrome.storage.local.set({ 'cmcs.items': current });
  }, patch);
}

async function waitFor(check, message, timeout = 15000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    last = await check();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

async function shot(target, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const widget = (page) => page.locator('cmcs-cart-saver .cmcs-panel');
async function favorites() {
  return (await storage())['cmcs.favorites'] || {};
}

/**
 * Click something in the popup that queues a job and opens Cardmarket in a new
 * tab, then let that tab run the job. (Playwright cannot intercept the first
 * load of a tab the extension opened itself, so it is loaded once more.)
 */
async function runViaNewTab(locator) {
  await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
  const opened = context.waitForEvent('page');
  await locator.click();
  const tab = await opened;
  await tab.waitForLoadState();
  await tab.goto(`${CM}/en/Magic/ShoppingCart`);
  const job = await waitFor(async () => {
    const j = (await storage())['cmcs.job'];
    return j && (j.state === 'done' || j.state === 'error') && j;
  }, 'job finished');
  await tab.close();
  return job;
}

const addRequests = () => mock.state.requests.filter((r) => r.method === 'POST' && r.path.includes('/AjaxAction/ShoppingCart_'));

before(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcs-profile-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    locale: 'nl-NL',
    viewport: { width: 1280, height: 860 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`, '--lang=nl'],
  });
  mock = createMockCardmarket();
  await context.route(`${CM}/**`, mock.route);
  // Card pictures; anything under /broken/ is refused like a hotlink-protected image.
  await context.route('https://product-images.s3.cardmarket.com/**', (r) =>
    r.request().url().includes('/broken/')
      ? r.fulfill({ status: 403, contentType: 'application/xml', body: '<Error><Code>AccessDenied</Code></Error>' })
      : r.fulfill({
          path: path.join(ROOT, 'tests/fixtures/card.png'),
          contentType: 'image/png',
          headers: { 'Access-Control-Allow-Origin': '*' },
        }),
  );
  sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(sw.url()).host;
  await sw.evaluate((delayMs) => chrome.storage.local.set({ 'cmcs.settings': { delayMs } }), DELAY_MS);
});

after(async () => {
  await context?.close();
});

describe('Cardmarket Cart Saver', () => {
  let page;

  it('saves every article when the cart page is opened', async () => {
    mock.state.cart = new Map([
      [BOG, 2],
      [MAGE, 1],
      [EPHEMERATE, 1],
    ]);
    page = await context.newPage();
    await page.goto(`${CM}/en/Magic/ShoppingCart`);

    const saved = await waitFor(async () => {
      const all = await items();
      return Object.keys(all).length === 3 && Object.values(all).every((i) => i.status === 'in_cart') && all;
    }, 'three saved articles');

    assert.equal(saved[BOG].name, 'Bojuka Bog');
    assert.equal(saved[BOG].amount, 2);
    assert.equal(saved[BOG].price, 0.99);
    assert.equal(saved[BOG].game, 'Magic');
    assert.equal(saved[BOG].lang, 'en');
    assert.equal(saved[BOG].productUrl, `${CM}/en/Magic/Products/Singles/Commander-2018/Bojuka-Bog`);
    assert.equal(saved[BOG].seller, 'snowc');
    assert.equal(saved[BOG].foil, false);
    assert.match(saved[BOG].imageUrl, /product-images\.s3\.cardmarket\.com\/.*361919\.jpg$/);
    assert.equal(saved[MAGE].foil, true);
    assert.equal(saved[MAGE].conditionLabel, 'EX');
    assert.equal(saved[MAGE].condition, 3);
    assert.equal(saved[MAGE].languageLabel, 'German');
    assert.deepEqual(saved[MAGE].extras, ['Foil']);
    assert.equal(saved[EPHEMERATE].seller, 'Kärtchen-Laden');
    assert.equal(saved[EPHEMERATE].expansion, 'Modern Horizons');

    await waitFor(() => widget(page).isVisible(), 'cart panel');
    assert.match(await widget(page).innerText(), /3 artikel\(en\) in je mandje opgeslagen/);
    await shot(page, '01-cart-saved');
  });

  it('notices an emptied cart on another page and offers to put it back', async () => {
    mock.state.cart.clear(); // Cardmarket emptied the cart…
    mock.state.available.delete(EPHEMERATE); // …and one article was sold meanwhile.

    await page.goto(`${CM}/en/Magic`);
    await waitFor(async () => Object.values(await items()).every((i) => i.status === 'missing'), 'all missing');
    assert.ok(Object.values(await items()).every((i) => i.missingReason === 'emptied'), 'the whole cart went');

    await waitFor(() => widget(page).isVisible(), 'reminder');
    const text = await widget(page).innerText();
    assert.match(text, /Je winkelmandje is geleegd/);
    assert.match(text, /3 opgeslagen artikel\(en\) \(5,78 €\)/);
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '3');
    await shot(widget(page), '02-reminder');
  });

  it('puts the articles back with one click, one request at a time', async () => {
    const before = addRequests().length;
    await widget(page).getByRole('button', { name: 'Zet 3 artikel(en) terug' }).click();

    const job = await waitFor(async () => {
      const j = (await storage())['cmcs.job'];
      return j && j.state === 'done' && j;
    }, 'refill job done');

    assert.equal(job.added, 2);
    assert.equal(job.failed, 1);
    assert.deepEqual([...mock.state.cart.entries()].sort(), [[BOG, 2], [MAGE, 1]].sort());

    const saved = await items();
    assert.equal(saved[BOG].status, 'in_cart');
    assert.equal(saved[MAGE].status, 'in_cart');
    assert.equal(saved[EPHEMERATE].status, 'unavailable');
    assert.equal(saved[EPHEMERATE].lastAttempt.message, 'This article is no longer available.');

    const posts = addRequests().slice(before);
    assert.equal(posts.length, 3);
    for (const post of posts) {
      assert.match(post.path, /^\/en\/Magic\/AjaxAction\/ShoppingCart_Add_AddArticlesFromUserOffers$/);
      const body = new URLSearchParams(post.body);
      assert.equal(body.get('__cmtkn'), mock.state.token);
      const ids = JSON.parse(body.get('idArticle'));
      const [id] = Object.keys(ids);
      assert.equal(ids[id], id);
      assert.equal(JSON.parse(body.get('amount'))[id], String(mock.article(id).articleId === BOG ? 2 : 1));
    }
    for (let i = 1; i < posts.length; i += 1) {
      assert.ok(posts[i].at - posts[i - 1].at >= DELAY_MS, 'requests are spaced out');
    }

    await waitFor(async () => /2 in je mandje gezet, 1 niet gelukt/.test(await widget(page).innerText()), 'summary');
    assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');
    await shot(widget(page), '03-refill-summary');
  });

  it('lists unavailable articles on the cart page with a link to similar offers', async () => {
    await widget(page).getByRole('button', { name: 'Sluiten' }).first().click();
    await page.goto(`${CM}/en/Magic/ShoppingCart`);
    await waitFor(() => widget(page).isVisible(), 'cart panel');
    const text = await widget(page).innerText();
    assert.match(text, /2 artikel\(en\) in je mandje opgeslagen/);
    assert.match(text, /Niet meer beschikbaar \(1\)/i);
    const alt = widget(page).getByRole('link', { name: 'Zoek vergelijkbaar aanbod' });
    assert.equal(
      await alt.getAttribute('href'),
      `${CM}/en/Magic/Products/Singles/Modern-Horizons/Ephemerate?language=1&minCondition=2`,
    );
    await shot(page, '04-cart-panel');
  });

  it('shows everything in the popup', async () => {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await waitFor(async () => (await popup.locator('.cmcs-item').count()) === 3, 'three rows');
    const stats = await popup.locator('.stat-value').allInnerTexts();
    assert.deepEqual(stats, ['2', '0', '1']);
    assert.match(await popup.locator('#list').innerText(), /Ephemerate[\s\S]*Niet beschikbaar/);
    await shot(popup, '05-popup');
    await popup.close();
  });

  it("saves articles added with the site's own button", async () => {
    await page.goto(`${CM}/en/Magic/Products/Singles/Commander-Masters/Sol-Ring`);
    await page.click('#site-add');
    await waitFor(async () => (await items())[SOL_RING]?.status === 'in_cart', 'Sol Ring saved');
  });

  it('forgets articles once they show up on an order page', async () => {
    await page.goto(`${CM}/en/Magic/Orders/1234567?ids=${BOG}`);
    await waitFor(async () => !(await items())[BOG], 'bought article removed');
  });

  it('refills from the popup by opening Cardmarket when no Cardmarket tab is active', async () => {
    mock.state.cart.clear();
    await patchItems({ [MAGE]: { status: 'missing' }, [SOL_RING]: { status: 'missing' } });

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    const opened = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'Zet 2 artikel(en) terug' }).click();
    const cartTab = await opened;
    assert.match(await popup.locator('#notice').innerText(), /het terugzetten start vanzelf/);
    // Playwright cannot intercept the very first load of a tab the extension
    // opened itself, so load it again through the mock. The queued job is
    // still waiting and gets picked up by the content script.
    await cartTab.waitForLoadState();
    await cartTab.goto(`${CM}/en/Magic/ShoppingCart`);

    await waitFor(async () => (await storage())['cmcs.job']?.state === 'done', 'queued job done');
    assert.deepEqual([...mock.state.cart.keys()].sort(), [MAGE, SOL_RING].sort());
    const saved = await items();
    assert.equal(saved[MAGE].status, 'in_cart');
    assert.equal(saved[SOL_RING].status, 'in_cart');
    await popup.close();
    await cartTab.close();
  });

  it('falls back to the other add-to-cart endpoint and remembers it', async (t) => {
    t.after(() => (mock.state.addEndpoint = 'ShoppingCart_Add_AddArticlesFromUserOffers'));
    mock.state.addEndpoint = 'ShoppingCart_Add_AddArticlesFromProductPage';
    mock.state.cart.delete(MAGE);
    await patchItems({ [MAGE]: { status: 'missing' } });
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));

    const before = addRequests().length;
    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }).click();
    await waitFor(async () => (await storage())['cmcs.job']?.state === 'done', 'job done');

    assert.ok(mock.state.cart.has(MAGE));
    const paths = addRequests().slice(before).map((r) => r.path.split('/').pop());
    assert.deepEqual(paths, ['ShoppingCart_Add_AddArticlesFromUserOffers', 'ShoppingCart_Add_AddArticlesFromProductPage']);
    assert.equal((await storage())['cmcs.meta'].addEndpoint, 'ShoppingCart_Add_AddArticlesFromProductPage');
  });

  it('stops at a Cloudflare check without marking articles unavailable', async () => {
    mock.state.challenge = true;
    mock.state.cart.delete(MAGE);
    await patchItems({ [MAGE]: { status: 'missing' } });
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));

    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }).click();
    const job = await waitFor(async () => {
      const j = (await storage())['cmcs.job'];
      return j && j.state === 'error' && j;
    }, 'job stopped');
    assert.equal(job.error, 'challenge');
    assert.equal((await items())[MAGE].status, 'missing');
    assert.match(await widget(page).innerText(), /beveiligingscontrole/);
    mock.state.challenge = false;
  });

  it('never treats an unreadable cart page as empty', async (t) => {
    t.after(() => (mock.state.brokenRows = false));
    mock.state.cart = new Map([
      [MAGE, 1],
      [SOL_RING, 1],
    ]);
    await patchItems({ [MAGE]: { status: 'in_cart' }, [SOL_RING]: { status: 'in_cart' } });
    mock.state.brokenRows = true;
    await page.goto(`${CM}/en/Magic/ShoppingCart`);
    await new Promise((r) => setTimeout(r, 1500));
    const saved = await items();
    assert.equal(saved[MAGE].status, 'in_cart');
    assert.equal(saved[SOL_RING].status, 'in_cart');

    // A refill must refuse to run on a cart it cannot read.
    await patchItems({ [MAGE]: { status: 'missing' } });
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
    const before = addRequests().length;
    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }).click();
    const job = await waitFor(async () => {
      const j = (await storage())['cmcs.job'];
      return j && j.state === 'error' && j;
    }, 'job refused');
    assert.equal(job.error, 'cart_unreadable');
    assert.equal(addRequests().length, before);
  });

  it('skips articles that are already back in the cart', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
    mock.state.cart.set(MAGE, 1);
    mock.state.cart.delete(SOL_RING);
    await patchItems({ [MAGE]: { status: 'missing' }, [SOL_RING]: { status: 'missing' } });
    // Pretend the header count was already seen, so the page itself does not
    // re-sync and the saved list is stale (MAGE was re-added in another tab).
    await sw.evaluate(async () => {
      const { 'cmcs.meta': meta = {} } = await chrome.storage.local.get('cmcs.meta');
      meta.sync = { Magic: { at: Date.now(), headerCount: 1 } };
      meta.addEndpoint = 'ShoppingCart_Add_AddArticlesFromUserOffers';
      await chrome.storage.local.set({ 'cmcs.meta': meta });
    });

    const before = addRequests().length;
    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 2 artikel(en) terug' }).click();
    await waitFor(async () => (await storage())['cmcs.job']?.state === 'done', 'job done');

    const posts = addRequests().slice(before);
    assert.equal(posts.length, 1);
    assert.ok(JSON.parse(new URLSearchParams(posts[0].body).get('idArticle'))[SOL_RING]);
    assert.equal(mock.state.cart.get(MAGE), 1, 'quantity not raised');
    const saved = await items();
    assert.equal(saved[MAGE].status, 'in_cart');
    assert.equal(saved[SOL_RING].status, 'in_cart');
  });

  it('retries once with a fresh token when the page token is outdated', async (t) => {
    t.after(() => (mock.state.stalePageToken = null));
    mock.state.stalePageToken = 'deadbeef'.repeat(8);
    mock.state.cart.delete(MAGE);
    await patchItems({ [MAGE]: { status: 'missing' } });
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));

    const before = addRequests().length;
    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }).click();
    await waitFor(async () => (await storage())['cmcs.job']?.state === 'done', 'job done');

    const tokens = addRequests().slice(before).map((r) => new URLSearchParams(r.body).get('__cmtkn'));
    assert.deepEqual(tokens, [mock.state.stalePageToken, mock.state.token]);
    assert.ok(mock.state.cart.has(MAGE));
    assert.equal((await items())[MAGE].status, 'in_cart');
  });

  it('stars offers on a product page', async () => {
    await page.goto(SOL_RING_URL);
    const star = page.locator(`#articleRow${SOL_KINGDOM} cmcs-fav button`);
    assert.equal(await star.getAttribute('aria-pressed'), 'false');
    assert.equal(await star.getAttribute('title'), 'Bewaar als favoriet');
    await star.click();
    const fav = await waitFor(async () => (await favorites())[SOL_KINGDOM], 'favourite saved');

    assert.equal(fav.name, 'Sol Ring');
    assert.equal(fav.expansion, 'Commander Masters');
    assert.equal(fav.productUrl, SOL_RING_URL);
    assert.equal(fav.game, 'Magic');
    assert.equal(fav.lang, 'en');
    assert.equal(fav.seller, 'CardKingdomNL');
    assert.equal(fav.sellerUrl, `${CM}/en/Magic/Users/CardKingdomNL`);
    assert.equal(fav.price, 1.1);
    assert.equal(fav.available, 3);
    assert.equal(fav.conditionLabel, 'EX');
    assert.equal(fav.condition, 3);
    assert.equal(fav.languageLabel, 'German');
    assert.equal(fav.language, 3);
    assert.equal(fav.foil, false);
    assert.match(fav.imageUrl, /500100\.jpg$/);
    await waitFor(async () => (await star.getAttribute('aria-pressed')) === 'true', 'star filled');

    await page.locator(`#articleRow${SOL_MINT} cmcs-fav button`).click();
    const mint = await waitFor(async () => (await favorites())[SOL_MINT], 'second favourite');
    assert.equal(mint.foil, true);
    assert.deepEqual(mint.extras, ['Foil']);
    assert.equal(mint.conditionLabel, 'MT');
    await shot(page, '07-product-stars');

    // Clicking again removes it; clicking once more brings it back.
    await star.click();
    await waitFor(async () => !(await favorites())[SOL_KINGDOM], 'unstarred');
    await star.click();
    await waitFor(async () => (await favorites())[SOL_KINGDOM], 'starred again');
  });

  it('stars an article from the cart page', async () => {
    mock.state.cart.set(BOG, 1);
    await page.goto(`${CM}/en/Magic/ShoppingCart`);
    await page.locator(`tr[data-article-id="${BOG}"] cmcs-fav button`).first().click();
    const fav = await waitFor(async () => (await favorites())[BOG], 'cart favourite');
    assert.equal(fav.seller, 'snowc');
    assert.equal(fav.conditionLabel, 'NM');
    assert.equal(fav.amount, undefined, 'the cart amount is not part of a favourite');
    await page.locator(`tr[data-article-id="${BOG}"] cmcs-fav button`).first().click();
    await waitFor(async () => !(await favorites())[BOG], 'cart favourite removed');
    mock.state.cart.delete(BOG);
  });

  it('finds favourites back in the popup', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 400, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.getByRole('tab', { name: 'Favorieten (2)' }).click();
    await waitFor(async () => (await popup.locator('#fav-list .cmcs-item').count()) === 2, 'two favourites');

    // Newest first.
    const names = await popup.locator('#fav-list .cmcs-item').evaluateAll((rows) => rows.map((r) => r.dataset.articleId));
    assert.deepEqual(names, [SOL_KINGDOM, SOL_MINT]);

    const row = popup.locator(`#fav-list [data-article-id="${SOL_KINGDOM}"]`);
    assert.match(await row.innerText(), /Verkoper: CardKingdomNL/);
    assert.match(await row.innerText(), /3 beschikbaar/);
    assert.equal(
      await row.getByRole('link', { name: 'Bekijk aanbieding op Cardmarket' }).getAttribute('href'),
      `${SOL_RING_URL}?language=3&minCondition=3#articleRow${SOL_KINGDOM}`,
    );
    assert.equal(
      await row.getByRole('link', { name: 'Zoek bij deze verkoper' }).getAttribute('href'),
      `${CM}/en/Magic/Users/CardKingdomNL/Offers/Singles?name=Sol+Ring`,
    );
    assert.doesNotMatch(await popup.locator('body').innerText(), /\bnull\b|undefined/);
    await shot(popup, '08-popup-favorites');

    await popup.fill('#fav-search', 'mint foil');
    await waitFor(async () => (await popup.locator('#fav-list .cmcs-item').count()) === 1, 'search narrows');
    assert.equal(await popup.locator('#fav-list .cmcs-item').getAttribute('data-article-id'), SOL_MINT);
    await popup.fill('#fav-search', 'nothing like this');
    await waitFor(async () => /Geen favorieten gevonden/.test(await popup.locator('#fav-list').innerText()), 'no matches');
    await popup.close();
  });

  it('opening a favourite highlights the offer and refreshes its price', async () => {
    mock.article(SOL_KINGDOM).price = 0.95;
    await page.goto(`${SOL_RING_URL}?language=3&minCondition=3#articleRow${SOL_KINGDOM}`);
    await page.locator(`#articleRow${SOL_KINGDOM}[data-cmcs-highlight]`).waitFor();
    await waitFor(async () => (await favorites())[SOL_KINGDOM].price === 0.95, 'price refreshed');
  });

  it('finds a favourite on the seller page', async () => {
    await page.goto(`${CM}/en/Magic/Users/CardKingdomNL/Offers/Singles?name=Sol+Ring`);
    const star = page.locator(`#articleRow${SOL_KINGDOM} cmcs-fav button`);
    await waitFor(async () => (await star.getAttribute('aria-pressed')) === 'true', 'shown as favourite');
  });

  it('puts a favourite in the cart from the popup (one copy)', async () => {
    mock.state.cart.delete(SOL_KINGDOM);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.getByRole('tab', { name: /Favorieten/ }).click();
    const row = popup.locator(`#fav-list [data-article-id="${SOL_KINGDOM}"]`);
    const job = await runViaNewTab(row.getByRole('button', { name: 'In winkelmandje leggen' }));

    assert.equal(job.state, 'done');
    assert.equal(mock.state.cart.get(SOL_KINGDOM), 1, 'one copy, not all 3 available');
    assert.equal((await items())[SOL_KINGDOM].status, 'in_cart');
    await waitFor(async () => /In mandje/.test(await row.innerText()), 'popup shows it is in the cart');
    assert.equal(await row.getByRole('button', { name: 'In winkelmandje leggen' }).count(), 0);
    await popup.close();
  });

  it('flags a sold favourite and says so on the offer page', async () => {
    mock.state.available.delete(SOL_MINT);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.getByRole('tab', { name: /Favorieten/ }).click();
    const row = popup.locator(`#fav-list [data-article-id="${SOL_MINT}"]`);
    const job = await runViaNewTab(row.getByRole('button', { name: 'In winkelmandje leggen' }));

    assert.equal(job.failed, 1);
    const fav = (await favorites())[SOL_MINT];
    assert.equal(fav.unavailable, true);
    assert.equal(fav.unavailableMessage, 'This article is no longer available.');
    assert.equal((await items())[SOL_MINT], undefined, 'not added to the saved cart list');
    await waitFor(async () => /This article is no longer available/.test(await row.innerText()), 'note in popup');
    await popup.close();

    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
    await page.goto(`${SOL_RING_URL}?language=1&minCondition=1&isFoil=Y#articleRow${SOL_MINT}`);
    await waitFor(() => widget(page).isVisible(), 'notice');
    assert.match(await widget(page).innerText(), /Favoriet niet op deze pagina/);
    assert.equal(
      await widget(page).getByRole('link', { name: 'Zoek bij deze verkoper' }).getAttribute('href'),
      `${CM}/en/Magic/Users/MintCondition/Offers/Singles?name=Sol+Ring`,
    );
    await shot(widget(page), '09-favorite-not-found');
  });

  /** Mark MAGE as missing (and out of the mock cart), then refill it from the reminder. */
  async function refillMageFromReminder() {
    mock.state.cart.delete(MAGE);
    // Only MAGE is missing; the header count is "already seen" so the page does not re-sync.
    const patch = {};
    for (const [id, item] of Object.entries(await items())) {
      patch[id] = { status: id === MAGE ? 'missing' : item.status === 'missing' ? 'in_cart' : item.status };
    }
    await patchItems(patch);
    const headerCount = [...mock.state.cart.values()].reduce((sum, n) => sum + n, 0);
    await sw.evaluate(
      (count) => chrome.storage.local.set({ 'cmcs.job': null, 'cmcs.meta': { sync: { Magic: { at: Date.now(), headerCount: count } } } }),
      headerCount,
    );
    await page.goto(`${CM}/en/Magic`);
    await widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }).click();
    return waitFor(async () => {
      const j = (await storage())['cmcs.job'];
      return j && (j.state === 'done' || j.state === 'error') && j;
    }, 'job finished');
  }

  it('sends requests from the page itself (page bridge)', async () => {
    await page.goto(`${CM}/en/Magic`);
    assert.equal(await page.evaluate(() => window.__cmcsBridge), true);
  });

  it('reports an unexpected answer as such, not as "not logged in"', async (t) => {
    t.after(() => (mock.state.weirdAdd = false));
    mock.state.weirdAdd = true;
    const job = await refillMageFromReminder();
    assert.equal(job.state, 'error');
    assert.equal(job.error, 'unexpected_response');
    assert.match(job.errorDetail, /HTTP 200 · \/en\/Magic\/AjaxAction\/ShoppingCart_Add_AddArticlesFromUserOffers · text\/html · "Magic \| Cardmarket" · via page/);
    const text = await widget(page).innerText();
    assert.match(text, /onverwacht antwoord/);
    assert.match(text, /Details: HTTP 200/);
    assert.doesNotMatch(text, /niet ingelogd/);
    assert.equal((await items())[MAGE].status, 'missing', 'not marked unavailable');
    await shot(widget(page), '10-unexpected-answer');
  });

  it('says "not logged in" only when Cardmarket shows its login page', async (t) => {
    t.after(() => (mock.state.loggedIn = true));
    mock.state.loggedIn = false;
    const job = await refillMageFromReminder();
    assert.equal(job.error, 'logged_out');
    assert.match(await widget(page).innerText(), /niet ingelogd/);
  });

  it('falls back to its own requests when the page bridge does not answer', async (t) => {
    t.after(() => (mock.state.blockBridge = false));
    mock.state.blockBridge = true;
    const job = await refillMageFromReminder();
    assert.equal(job.state, 'done');
    assert.ok(mock.state.cart.has(MAGE));
    assert.equal((await items())[MAGE].status, 'in_cart');
  });

  describe('finding the CSRF token on current Cardmarket pages', () => {
    const getsSince = (since, path) => mock.state.requests.slice(since).filter((r) => r.method === 'GET' && r.path === path);

    it('reads it from an inline script when no form field carries it', async (t) => {
      t.after(() => (mock.state.tokenMode = 'input'));
      mock.state.tokenMode = 'script';
      const job = await refillMageFromReminder();
      assert.equal(job.state, 'done', job.errorDetail);
      assert.ok(mock.state.cart.has(MAGE));
    });

    it("picks it up from the site's own (obfuscated) AJAX request", async (t) => {
      t.after(() => (mock.state.tokenMode = 'input'));
      mock.state.tokenMode = 'xhr';
      const since = mock.state.requests.length;
      const job = await refillMageFromReminder();
      assert.equal(job.state, 'done', job.errorDetail);
      assert.ok(mock.state.cart.has(MAGE));
      assert.equal(getsSince(since, '/en/Magic/Wants').length, 0, 'no extra page needed');
      const body = new URLSearchParams(addRequests().at(-1).body);
      assert.equal(body.get('__cmtkn'), mock.state.token);
    });

    it('borrows it from another signed-in page (wants list)', async (t) => {
      t.after(() => (mock.state.tokenMode = 'input'));
      mock.state.tokenMode = 'wants';
      const since = mock.state.requests.length;
      const job = await refillMageFromReminder();
      assert.equal(job.state, 'done', job.errorDetail);
      assert.ok(mock.state.cart.has(MAGE));
      assert.equal(getsSince(since, '/en/Magic/Wants').length, 1);
    });

    it('explains where it looked when there is no token anywhere', async (t) => {
      t.after(() => (mock.state.tokenMode = 'input'));
      mock.state.tokenMode = 'none';
      const before = addRequests().length;
      const job = await refillMageFromReminder();
      assert.equal(job.error, 'no_token');
      assert.match(job.errorDetail, /^searched: page, site-request, \/en\/Magic\/ShoppingCart, .*\/en\/Magic\/Wants, \/en\/Magic · this page: inputs=0 cmtkn-in-html=0/);
      assert.equal(addRequests().length, before, 'nothing sent without a token');
      assert.equal((await items())[MAGE].status, 'missing');
      await shot(widget(page), '11-no-token');
    });
  });

  describe('card pictures', () => {
    it('keeps a small local copy of each picture, so the popup can show it', async () => {
      await page.goto(`${CM}/en/Magic`);
      const saved = await waitFor(async () => {
        const all = Object.values(await items()).filter((i) => i.imageUrl);
        return all.length && all.every((i) => /^data:image\/jpeg;base64,/.test(i.thumb || '')) && all;
      }, 'thumbnails for all saved articles');
      assert.ok(saved.every((i) => i.thumb.length < 12000), 'thumbnails stay small');

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await popup.getByRole('tab', { name: 'Winkelmandje' }).click();
      await waitFor(async () => (await popup.locator('#list img.cmcs-thumb').count()) > 0, 'thumbnails in popup');
      const sources = await popup.locator('#list img.cmcs-thumb').evaluateAll((imgs) => imgs.map((img) => img.getAttribute('src')));
      assert.ok(sources.every((src) => src.startsWith('data:image/jpeg')), 'popup uses the local copies');
      await popup.close();
    });

    it('shows a placeholder instead of a broken image when a picture is refused', async () => {
      await patchItems({ [MAGE]: { imageUrl: 'https://product-images.s3.cardmarket.com/broken/1.jpg', thumb: null, thumbTriedAt: null } });
      await page.goto(`${CM}/en/Magic`);
      const mage = await waitFor(async () => {
        const item = (await items())[MAGE];
        return item.thumbTriedAt && item;
      }, 'thumbnail attempt recorded');
      assert.equal(mage.thumb, null);

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await popup.getByRole('tab', { name: 'Winkelmandje' }).click();
      const row = popup.locator(`#list [data-article-id="${MAGE}"]`);
      await row.locator('.cmcs-thumb--empty').waitFor({ timeout: 10000 });
      assert.equal(await row.locator('img').count(), 0, 'no broken image left');
      assert.equal(await row.locator('.cmcs-thumb--empty').innerText(), 'P');
      await popup.close();
    });
  });

  describe('removing articles yourself', () => {
    before(async () => {
      mock.state.cart = new Map([
        [BOG, 1],
        [MAGE, 1],
        [SOL_RING, 1],
        [EPHEMERATE, 1],
      ]);
      // Start from a clean saved list, so only these four articles are involved.
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null, 'cmcs.meta': {}, 'cmcs.items': {} }));
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => {
        const all = await items();
        return Object.keys(all).length === 4 && [BOG, MAGE, SOL_RING, EPHEMERATE].every((id) => all[id] && all[id].status === 'in_cart');
      }, 'four articles saved');
    });

    it('stores the numeric seller id of every cart article', async () => {
      const all = await items();
      assert.equal(all[BOG].sellerId, '1001');
      assert.equal(all[SOL_RING].sellerId, '2002');
    });

    it("notices a removal from the site's own request alone, without seeing a click", async () => {
      await page.evaluate((id) => window.cmRemove({ idArticle: id, idSeller: 2002, amount: 1 }), EPHEMERATE);
      await waitFor(async () => !(await items())[EPHEMERATE], 'removed article forgotten');
      assert.equal((await items())[SOL_RING].status, 'in_cart', 'same seller, other article untouched');
    });

    it('forgets an article you remove with its trash button', async () => {
      await page.locator(`table.article-table tr[data-article-id="${MAGE}"] a[onclick*="cmRemove"]`).click();
      await waitFor(async () => !(await items())[MAGE], 'removed article forgotten');
      assert.equal(mock.state.cart.has(MAGE), false);
      const all = await items();
      for (const id of [BOG, SOL_RING]) assert.equal(all[id].status, 'in_cart', `${id} untouched`);
      assert.doesNotMatch(await widget(page).innerText(), /Niet meer in je mandje/);
    });

    it("forgets every article of a seller you remove at once", async () => {
      const block = page.locator('section.shipment-block', { hasText: 'Kärtchen-Laden' });
      await block.locator('button.remove-shipment').click();
      await waitFor(async () => {
        const all = await items();
        return !all[SOL_RING] && !all[EPHEMERATE];
      }, 'seller articles forgotten');
      assert.equal((await items())[BOG].status, 'in_cart');
    });

    it('does not offer to put back what you just bought', async () => {
      const block = page.locator('section.shipment-block', { hasText: 'snowc' });
      await Promise.all([page.waitForNavigation(), block.getByRole('button', { name: 'Commit to purchase' }).click()]);
      await waitFor(async () => !(await items())[BOG], 'bought article forgotten');
      await page.waitForTimeout(1000);
      assert.equal(await widget(page).isVisible(), false, 'no "cart emptied" reminder');
      assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '');
    });

    it('still remembers articles when Cardmarket empties the cart (and a product link is no removal)', async () => {
      mock.state.cart = new Map([[MAGE, 1]]);
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => (await items())[MAGE]?.status === 'in_cart', 'saved');
      // Opening the card's product page from the cart must not count as removing it.
      await Promise.all([page.waitForNavigation(), page.locator(`table.article-table tr[data-article-id="${MAGE}"] td.name a`).click()]);
      mock.state.cart.clear();
      await page.goto(`${CM}/en/Magic`);
      await waitFor(async () => (await items())[MAGE]?.status === 'missing', 'marked missing, not forgotten');
    });
  });

  describe('reliable refilling', () => {
    /** Click something that starts a refill and wait for that (new) job to finish. */
    const refillVia = async (button) => {
      const previous = (await storage())['cmcs.job'];
      await button.click();
      return waitFor(async () => {
        const j = (await storage())['cmcs.job'];
        return j && j.id !== (previous && previous.id) && (j.state === 'done' || j.state === 'error') && j;
      }, 'job finished');
    };
    const postsFor = (since, id) =>
      addRequests()
        .slice(since)
        .filter((r) => r.path.includes('ShoppingCart_Add') && JSON.parse(new URLSearchParams(r.body).get('idArticle') || '{}')[id]);
    const amountOf = (post, id) => JSON.parse(new URLSearchParams(post.body).get('amount'))[id];
    const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

    it('does not trust a cart page on which a seller block cannot be read', async (t) => {
      t.after(() => (mock.state.brokenSeller = null));
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null, 'cmcs.meta': {}, 'cmcs.items': {} }));
      mock.state.cart = new Map([
        [BOG, 1],
        [MAGE, 1],
        [SOL_RING, 1],
      ]);
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => Object.values(await items()).filter((i) => i.status === 'in_cart').length === 3, 'three saved');

      mock.state.brokenSeller = 'Kärtchen-Laden';
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await settle();
      assert.equal((await items())[SOL_RING].status, 'in_cart', 'an unreadable block is not "gone"');

      const before = addRequests().length;
      const job = await refillMageFromReminder();
      assert.equal(job.error, 'cart_unreadable');
      assert.match(job.errorDetail, /1 of 2 seller blocks without rows/);
      assert.equal(addRequests().length, before, 'nothing added');
    });

    it('remembers why articles left the cart, and that copies are missing', async () => {
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
      mock.state.cart = new Map([
        [BOG, 2],
        [MAGE, 1],
        [SOL_RING, 1],
      ]);
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => {
        const all = await items();
        return all[BOG]?.wantedAmount === 2 && [BOG, MAGE, SOL_RING].every((id) => all[id]?.status === 'in_cart');
      }, 'saved, two copies of the Bog');

      // The seller sold one Bog copy and the Mage; Kärtchen-Laden went on holiday.
      mock.state.cart = new Map([[BOG, 1]]);
      await page.goto(`${CM}/en/Magic`);
      const all = await waitFor(async () => {
        const saved = await items();
        return saved[BOG].status === 'partial' && saved[SOL_RING].status === 'missing' && saved;
      }, 'statuses updated');
      assert.equal(all[BOG].amount, 1);
      assert.equal(all[BOG].wantedAmount, 2);
      assert.equal(all[MAGE].status, 'missing');
      assert.equal(all[MAGE].missingReason, 'single');
      assert.equal(all[SOL_RING].missingReason, 'seller');
      assert.equal(await sw.evaluate(() => chrome.action.getBadgeText({})), '3');

      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
      await popup.locator('#tab-cart').click();
      await waitFor(async () => (await popup.locator('#list .cmcs-item').count()) === 3, 'three rows');
      const list = await popup.locator('#list').innerText();
      assert.match(list, /Bojuka Bog[\s\S]*1 van 2 in je mandje/);
      assert.match(list, /Deels in mandje/);
      assert.match(list, /Portal Mage[\s\S]*Alleen dit artikel verdween, waarschijnlijk verkocht/);
      assert.match(list, /Sol Ring[\s\S]*Alles van deze verkoper verdween uit je mandje/);
      await shot(popup, '12-popup-reasons');
      await popup.close();
    });

    it('puts back only the copies that are missing', async () => {
      const before = addRequests().length;
      const job = await refillVia(widget(page).getByRole('button', { name: 'Zet 3 artikel(en) terug' }));
      assert.equal(job.state, 'done');
      assert.equal(job.added, 3);
      const bogPosts = postsFor(before, BOG);
      assert.equal(bogPosts.length, 1);
      assert.equal(amountOf(bogPosts[0], BOG), '1', 'only the missing copy');
      assert.equal(mock.state.cart.get(BOG), 2);
      const all = await items();
      for (const id of [BOG, MAGE, SOL_RING]) assert.equal(all[id].status, 'in_cart', id);
    });

    it('tries one copy when the seller has fewer left than you want', async (t) => {
      t.after(() => mock.state.stock.clear());
      await widget(page).getByRole('button', { name: 'Sluiten' }).first().click();
      mock.state.cart.delete(BOG);
      mock.state.stock.set(BOG, 1);
      await page.goto(`${CM}/en/Magic`);
      await waitFor(async () => (await items())[BOG].status === 'missing', 'Bog missing');

      const before = addRequests().length;
      const job = await refillVia(widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }));
      assert.equal(job.added, 1);
      assert.deepEqual(postsFor(before, BOG).map((post) => amountOf(post, BOG)), ['2', '1']);
      const bog = (await items())[BOG];
      assert.equal(bog.status, 'partial');
      assert.equal(bog.amount, 1);
      assert.equal(bog.wantedAmount, 2);
    });

    it('keeps an article on the list after an unclear refusal, and gives up after the second', async (t) => {
      t.after(() => (mock.state.genericRefusal = false));
      mock.state.cart = new Map([
        [BOG, 2],
        [SOL_RING, 1],
      ]);
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => (await items())[MAGE].status === 'missing' && (await items())[BOG].status === 'in_cart', 'synced');
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
      mock.state.genericRefusal = true;

      await page.goto(`${CM}/en/Magic`);
      const job = await refillVia(widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }));
      assert.equal(job.failed, 1);
      let mage = (await items())[MAGE];
      assert.equal(mage.status, 'missing', 'not written off after one unclear refusal');
      assert.equal(mage.lastAttempt.reason, 'unknown');
      assert.equal(mage.lastAttempt.message, 'Something went wrong. Please try again.');

      await widget(page).getByRole('button', { name: 'Sluiten' }).first().click();
      await refillVia(widget(page).getByRole('button', { name: 'Zet 1 artikel(en) terug' }));
      mage = (await items())[MAGE];
      assert.equal(mage.status, 'unavailable', 'the second unclear refusal in a row counts as gone');
    });

    it('takes a lowered amount as what you want', async () => {
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await page.evaluate((id) => window.cmRemove({ idArticle: id, idSeller: 1001, amount: 1 }), BOG);
      const bog = await waitFor(async () => {
        const saved = (await items())[BOG];
        return saved && saved.amount === 1 && saved;
      }, 'Bog synced');
      assert.equal(bog.status, 'in_cart', 'not "partly"');
      assert.equal(bog.wantedAmount, 1);
    });

    it('runs one refill at a time and offers to continue when its tab closes', async (t) => {
      t.after(() => sw.evaluate((delayMs) => chrome.storage.local.set({ 'cmcs.settings': { delayMs } }), DELAY_MS));
      mock.state.cart = new Map([
        [BOG, 1],
        [MAGE, 1],
        [SOL_RING, 1],
        [SOL_KINGDOM, 1],
      ]);
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null, 'cmcs.items': {} }));
      await page.goto(`${CM}/en/Magic/ShoppingCart`);
      await waitFor(async () => Object.values(await items()).filter((i) => i.status === 'in_cart').length === 4, 'four saved');
      mock.state.cart = new Map([[BOG, 1]]);
      await page.goto(`${CM}/en/Magic`);
      await waitFor(async () => Object.values(await items()).filter((i) => i.status === 'missing').length === 3, 'three missing');
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.settings': { delayMs: 2500 } }));

      const runner = await context.newPage();
      await runner.goto(`${CM}/en/Magic`);
      await widget(runner).getByRole('button', { name: 'Zet 3 artikel(en) terug' }).click();
      await waitFor(async () => (await storage())['cmcs.job']?.done >= 1, 'first article added');

      // A second tab asking to refill now is told to wait.
      const reply = await sw.evaluate(async (url) => {
        const tabs = await chrome.tabs.query({ url });
        const replies = await Promise.all(
          tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'cmcs.refill', articleIds: ['1611110001'] }).catch(() => null)),
        );
        return replies.filter(Boolean);
      }, `${CM}/en/Magic`);
      assert.ok(reply.length >= 2);
      assert.ok(reply.every((r) => r.ok === false && r.error === 'busy'), JSON.stringify(reply));

      await runner.close();
      await waitFor(() => widget(page).getByText('Terugzetten onderbroken').isVisible(), 'interrupted job noticed', 20000);
      await shot(widget(page), '13-interrupted');
      await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.settings': { delayMs: 300 } }));
      await widget(page).getByRole('button', { name: /^Doorgaan \(\d te gaan\)$/ }).click();
      await waitFor(async () => {
        const j = (await storage())['cmcs.job'];
        return j && j.state === 'done' && j.acknowledged !== true && j;
      }, 'continued job done');
      for (const id of [MAGE, SOL_RING, SOL_KINGDOM]) assert.equal(mock.state.cart.get(id), 1, `${id} added exactly once`);
      const all = await items();
      for (const id of [MAGE, SOL_RING, SOL_KINGDOM]) assert.equal(all[id].status, 'in_cart', id);
    });

    it("leaves the list alone while you are logged in with another account", async (t) => {
      t.after(async () => {
        mock.state.username = 'tester';
        await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.meta': {} }));
      });
      await widget(page).getByRole('button', { name: 'Sluiten' }).first().click();
      assert.equal((await storage())['cmcs.meta'].account, 'tester');
      mock.state.username = 'someone-else';
      mock.state.cart.clear();
      await page.goto(`${CM}/en/Magic`);
      await waitFor(() => widget(page).getByText('Ander Cardmarket-account').isVisible(), 'account notice');
      assert.match(await widget(page).innerText(), /horen bij tester/);
      const all = await items();
      for (const id of [MAGE, SOL_RING, SOL_KINGDOM]) assert.equal(all[id].status, 'in_cart', `${id} untouched`);
      await shot(widget(page), '14-other-account');

      await widget(page).getByRole('button', { name: 'Voortaan someone-else gebruiken' }).click();
      await waitFor(async () => (await storage())['cmcs.meta'].account === 'someone-else', 'account switched');
    });
  });

  it('options page shows the saved data and stores settings', async () => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/src/options/options.html`);
    await waitFor(async () => /opgeslagen: .* in mandje/.test(await options.locator('#dataSummary').innerText()), 'data summary');
    await options.fill('#delay', '2.5');
    await options.locator('#delay').dispatchEvent('change');
    await waitFor(async () => (await storage())['cmcs.settings'].delayMs === 2500, 'delay saved');
    await shot(options, '06-options');
    await sw.evaluate((delayMs) => chrome.storage.local.set({ 'cmcs.settings': { delayMs } }), DELAY_MS);
    await options.close();
  });

  it('leaves the saved list alone when logged out', async () => {
    mock.state.loggedIn = false;
    mock.state.cart.clear();
    await patchItems({ [SOL_RING]: { status: 'in_cart' } });
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.meta': {}, 'cmcs.job': null }));

    await page.goto(`${CM}/en/Magic`);
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal((await items())[SOL_RING].status, 'in_cart');
    mock.state.loggedIn = true;
  });
});

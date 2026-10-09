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

const addRequests = () => mock.state.requests.filter((r) => r.method === 'POST' && r.path.includes('/AjaxAction/'));

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
  await context.route('https://product-images.s3.cardmarket.com/**', (r) =>
    r.fulfill({ path: path.join(ROOT, 'tests/fixtures/card.png'), contentType: 'image/png' }),
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

    await waitFor(async () => /2 in je mandje gezet, 1 niet beschikbaar/.test(await widget(page).innerText()), 'summary');
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

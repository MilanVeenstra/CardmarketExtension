/*
 * Optional check against Cardmarket's real picture server (needs internet):
 *
 *   CMCS_LIVE=1 npm test
 *
 * The server only serves pictures to requests from cardmarket.com, so the
 * popup depends on the extension's declarativeNetRequest rule. The mocked
 * tests cannot see that rule at work (Playwright sees requests before it), so
 * this test loads real pictures, without any mock in between.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { BROWSER, extensionWorker } from './browser.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIVE = Boolean(process.env.CMCS_LIVE);

/** A Magic single and a sealed product, as saved from a real cart. */
const ITEMS = {
  1: { articleId: '1', productId: '721733', game: 'Magic', name: 'Sol Ring', price: 1, status: 'missing', imageUrl: 'https://product-images.s3.cardmarket.com/1/CMM/721733/721733.jpg' },
  2: { articleId: '2', productId: '895551', game: 'Pokemon', name: '30th Celebration Elite Trainer Box', price: 130, status: 'missing', imageUrl: 'https://product-images.s3.cardmarket.com/1016/895551/895551.jpg' },
};

describe('pictures from the real Cardmarket server', { skip: !LIVE && 'set CMCS_LIVE=1 to run' }, () => {
  let context;
  let sw;
  let extensionId;

  before(async () => {
    context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cmcs-live-')), {
      ...BROWSER,
      headless: true,
      args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`],
    });
    sw = await extensionWorker(context);
    extensionId = new URL(sw.url()).host;
  });

  after(() => context && context.close());

  it('the popup shows the pictures, and the background keeps small copies', async () => {
    await sw.evaluate((items) => chrome.storage.local.set({ 'cmcs.items': items }), ITEMS);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/src/popup/popup.html`);
    await popup.waitForFunction(() => document.querySelectorAll('#list img.cmcs-thumb').length === 2 && [...document.querySelectorAll('#list img.cmcs-thumb')].every((img) => img.naturalWidth > 0), null, { timeout: 20000 });
    await sw.evaluate(() => self.cmcs.images.capture());
    const thumbs = await sw.evaluate(() => chrome.storage.local.get('cmcs.thumbs').then((r) => r['cmcs.thumbs'] || {}));
    for (const item of Object.values(ITEMS)) {
      assert.match(thumbs[item.imageUrl] && thumbs[item.imageUrl].src, /^data:image\/jpeg;base64,/, item.name);
    }
    await popup.close();
  });
});

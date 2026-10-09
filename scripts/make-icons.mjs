/*
 * Renders the Cart Saver mark (design 6a: a card falling into a basket) to the
 * PNG icons Chrome needs. Run after changing the mark:
 *
 *   node scripts/make-icons.mjs
 *
 * The basket is filled white so the icon reads on light and dark toolbars.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#141414';
const RED = '#b3122b';
const BODY = '#ffffff';

// Same 24-unit drawing as src/shared/ui.js (logo).
const MARK = `<g transform="rotate(14 13.5 7)"><rect x="10" y="0.5" width="7.5" height="11" fill="${INK}"/><rect x="10" y="0.5" width="7.5" height="3" fill="${RED}"/></g><path d="M6.2 9h15.3l-2.2 8H8.4z" fill="${BODY}" stroke="${INK}" stroke-width="2"/><path d="M1.5 5.5h3.2l1.5 3.5" fill="none" stroke="${INK}" stroke-width="2"/><rect x="8" y="19.5" width="3" height="3" fill="${INK}"/><rect x="16.5" y="19.5" width="3" height="3" fill="${INK}"/>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><svg id="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block">${MARK}</svg></body></html>`,
  );
  await page.locator('#mark').screenshot({ path: path.join(ROOT, 'icons', `icon${size}.png`), omitBackground: true });
  console.log(`icons/icon${size}.png`);
}
await browser.close();

/*
 * Renders the Cart Saver mark (design 6a: a card falling into a basket) to the
 * PNG icons Chrome needs, and to the repository's social preview
 * (docs/social-preview.png, 1280×640, uploaded by hand under GitHub's
 * Settings → Social preview). Run after changing the mark:
 *
 *   node scripts/make-icons.mjs
 *
 * CHROMIUM_PATH: use a Chromium already on disk instead of Playwright's own.
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

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 32, 48, 128]) {
  await page.setContent(
    `<html><body style="margin:0;background:transparent"><svg id="mark" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block">${MARK}</svg></body></html>`,
  );
  await page.locator('#mark').screenshot({ path: path.join(ROOT, 'icons', `icon${size}.png`), omitBackground: true });
  console.log(`icons/icon${size}.png`);
}

// Social preview: the mark, the wordmark and the promise, in the extension's own ink and red.
await page.setViewportSize({ width: 1280, height: 640 });
await page.setContent(`<html><body style="margin:0">
  <div style="width:1280px;height:640px;box-sizing:border-box;background:#fff;color:${INK};font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;display:flex;flex-direction:column">
    <div style="flex:1;display:flex;align-items:center;gap:56px;padding:0 112px">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="232" height="232" style="flex:none;margin-left:-14px">${MARK}</svg>
      <div>
        <div style="font-size:104px;font-weight:900;letter-spacing:0.04em;line-height:1">CART SAVER</div>
        <div style="font-size:38px;font-weight:700;line-height:1.25;margin-top:28px;max-width:720px">Lost your Cardmarket cart?<br>One click and it is back.</div>
      </div>
    </div>
    <div style="height:112px;background:${INK};color:#fff;display:flex;align-items:center;gap:20px;padding:0 112px;font-size:30px;font-weight:700">
      <span style="width:14px;height:40px;background:${RED}"></span>
      A Chrome extension for Cardmarket
    </div>
  </div>
</body></html>`);
await page.screenshot({ path: path.join(ROOT, 'docs', 'social-preview.png') });
console.log('docs/social-preview.png');
await browser.close();

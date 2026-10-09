/*
 * Self-update of an unpacked install: when the files on disk change (what
 * scripts/autoupdate-mac.sh does by pulling from GitHub), the extension
 * reloads itself, and tabs that were already open ask for a refresh.
 *
 * Runs against a temporary copy of the extension, so the repository itself
 * is never touched.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createMockCardmarket } from './mock-cardmarket.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CM = 'https://www.cardmarket.com';
const RUNNING_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;

let context;
let sw;
let extDir;

async function waitFor(check, message, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for: ${message}`);
}

function writeVersion(version) {
  const file = path.join(extDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.version = version;
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

before(async () => {
  extDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cmcs-ext-'));
  for (const entry of ['manifest.json', 'src', '_locales', 'icons']) {
    fs.cpSync(path.join(ROOT, entry), path.join(extDir, entry), { recursive: true });
  }
  context = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cmcs-profile-')), {
    channel: 'chromium',
    headless: true,
    locale: 'nl-NL',
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, '--lang=nl'],
  });
  await context.route(`${CM}/**`, createMockCardmarket().route);
  sw = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
});

after(async () => {
  await context?.close();
});

describe('self-update of an unpacked install', () => {
  let page;
  const writeBuildId = (id) => fs.writeFileSync(path.join(extDir, 'build-id.txt'), `${id}\n`);

  it('checks for new files every minute', async () => {
    const alarm = await waitFor(() => sw.evaluate(() => chrome.alarms.get('cmcs.selfUpdate')), 'update alarm');
    assert.equal(alarm.periodInMinutes, 1);
  });

  it('does nothing while the files on disk are unchanged', async () => {
    assert.equal(await sw.evaluate(() => self.cmcsCheckForNewVersion({ settleMs: 50, reload: () => {} })), false);
  });

  it('waits while articles are being put back', async () => {
    page = await context.newPage();
    await page.goto(`${CM}/en/Magic`);
    await sw.evaluate(() =>
      chrome.storage.local.set({ 'cmcs.job': { id: 'job-x', state: 'running', heartbeatAt: Date.now(), articleIds: [] } }),
    );
    writeBuildId('a1b2c3d4'); // the updater pulled a new commit
    const result = await sw.evaluate(() => self.cmcsCheckForNewVersion({ settleMs: 50, reload: () => (self.__reloaded = true) }));
    assert.equal(result, false);
    assert.equal(await sw.evaluate(() => Boolean(self.__reloaded)), false);
  });

  it('reloads for every new commit, even when the version number is the same', async () => {
    await sw.evaluate(() => chrome.storage.local.set({ 'cmcs.job': null }));
    const result = await sw.evaluate(() => self.cmcsCheckForNewVersion({ settleMs: 50, reload: () => (self.__reloaded = true) }));
    assert.equal(result, true);
    assert.equal(await sw.evaluate(() => self.__reloaded), true);
    const updated = (await sw.evaluate(() => chrome.storage.local.get('cmcs.updated')))['cmcs.updated'];
    assert.equal(updated.from, RUNNING_VERSION);
    assert.equal(updated.to, RUNNING_VERSION);
  });

  it('notices a newer manifest version when no updater wrote a build id', async () => {
    fs.rmSync(path.join(extDir, 'build-id.txt'));
    await sw.evaluate(() => chrome.storage.session.remove('cmcs.runningBuild'));
    assert.equal(await sw.evaluate(() => self.cmcsCheckForNewVersion({ settleMs: 50, reload: () => {} })), false);
    writeVersion('9.9.9');
    const result = await sw.evaluate(() => self.cmcsCheckForNewVersion({ settleMs: 50, reload: () => {} }));
    assert.equal(result, true);
    const updated = (await sw.evaluate(() => chrome.storage.local.get('cmcs.updated')))['cmcs.updated'];
    assert.equal(updated.to, '9.9.9');
  });

  it('asks already-open Cardmarket tabs to refresh after a reload', async () => {
    // A real reload. (In this test browser Chromium leaves a command-line
    // extension disabled after reloading itself; in Chrome with "Load
    // unpacked" it comes straight back. Either way, open tabs lose their
    // connection to the extension, which is what is tested here.)
    await sw.evaluate(() => chrome.runtime.reload()).catch(() => {});
    const pill = page.locator('cmcs-cart-saver .cmcs-pill');
    await pill.waitFor({ timeout: 10000 });
    assert.equal(await pill.innerText(), 'Cart Saver bijgewerkt · ververs de pagina');
  });
});

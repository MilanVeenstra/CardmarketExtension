/*
 * Shared by the test files: which browser to start, and how to reach the
 * extension's service worker once Chrome has really started it.
 */

/** CHROMIUM_PATH: use a Chromium / Chrome for Testing already on disk instead of Playwright's own. */
export const BROWSER = process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: 'chromium' };

const isExtensionWorker = (worker) => /^chrome-extension:\/\/[a-p]{32}\/src\/background\/service-worker\.js$/.test(worker.url());

/**
 * The extension's service worker, ready to use. Right after launch Chrome can
 * hand out a worker that is still being set up (no extension APIs yet, or it
 * is replaced a moment later), so wait until chrome.storage is there.
 */
export async function extensionWorker(context) {
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const worker =
      context.serviceWorkers().find(isExtensionWorker) ||
      (await context.waitForEvent('serviceworker', { predicate: isExtensionWorker, timeout: 10000 }));
    try {
      const ready = await worker.evaluate(() => Boolean(self.chrome && chrome.storage && chrome.storage.local && typeof setTimeout === 'function'));
      if (ready) return worker;
    } catch {
      // Replaced while starting: look again.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('The extension service worker did not start');
}

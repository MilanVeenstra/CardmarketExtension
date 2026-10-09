/*
 * Product pictures for the popup and the options page.
 *
 * Cardmarket's picture server (product-images.s3.cardmarket.com, behind
 * CloudFront) only serves requests that come from cardmarket.com: without
 * such a Referer it answers 403 or 503, and it never sends CORS headers. On
 * cardmarket.com itself pictures load fine; in the popup they did not. So:
 *
 * 1. One declarativeNetRequest rule gives the extension's *own* requests to
 *    that server the Referer `https://www.cardmarket.com/`. Requests of web
 *    pages (Cardmarket's own included) are never touched.
 * 2. The service worker, which may read the answer thanks to its host
 *    permission, keeps a small copy (~2–3 KB) of every picture in
 *    `cmcs.thumbs`, one per picture URL: the popup shows pictures at once,
 *    also when the server is slow. Copies of pictures nothing refers to any
 *    more are dropped once a day.
 */
(function (root) {
  'use strict';

  const { store } = root.CMCS;

  const IMAGE_HOST = 'product-images.s3.cardmarket.com';
  const RULE_ID = 1;
  /** Fits in the 30×42 picture box at twice the resolution; square pictures stay square. */
  const MAX_W = 60;
  const MAX_H = 84;
  /** Pictures fetched per run, and the pause between two. */
  const PER_RUN = 40;
  const PAUSE_MS = 150;
  /** Written in batches, so the popup does not redraw for every picture. */
  const BATCH = 8;
  /** A picture that could not be fetched is tried again after this long. */
  const RETRY_MS = 24 * 60 * 60 * 1000;
  const MAX_THUMBS = 3000;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /** The rule: our own requests to the picture server come "from cardmarket.com". */
  async function ensureImageRule() {
    if (!chrome.declarativeNetRequest) return false;
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [RULE_ID],
      addRules: [
        {
          id: RULE_ID,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://www.cardmarket.com/' }],
          },
          condition: {
            requestDomains: [IMAGE_HOST],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: ['image', 'xmlhttprequest', 'other'],
          },
        },
      ],
    });
    return true;
  }

  const isPictureUrl = (url) => {
    try {
      return new URL(url).hostname === IMAGE_HOST;
    } catch {
      return false;
    }
  };

  function toBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  /** A small JPEG of a picture, as a data URL (FileReader does not exist in service workers). */
  async function makeThumb(url) {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const scale = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff'; // transparent pictures would turn black in a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return `data:image/jpeg;base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
  }

  /** Every picture URL the saved list, the favourites and the saved carts use. */
  async function wantedUrls() {
    const [items, favorites, carts] = await Promise.all([store.getItems(), store.getFavorites(), store.getCarts()]);
    const urls = new Set();
    const add = (article) => article && isPictureUrl(article.imageUrl) && urls.add(article.imageUrl);
    Object.values(items).forEach(add);
    Object.values(favorites).forEach(add);
    carts.forEach((cart) => (cart.items || []).forEach(add));
    return urls;
  }

  let running = null;
  let again = false;

  /** Make the small copies that are still missing. One run at a time; a request during a run queues one more. */
  function capture() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      const [urls, thumbs] = await Promise.all([wantedUrls(), store.getThumbs()]);
      const now = Date.now();
      const todo = [...urls]
        .filter((url) => {
          const entry = thumbs[url];
          return !entry || (!entry.src && now - (entry.failedAt || 0) > RETRY_MS);
        })
        .slice(0, PER_RUN);
      let batch = {};
      const flush = async () => {
        if (!Object.keys(batch).length) return;
        const patch = batch;
        batch = {};
        await store.updateThumbs((current) => ({ ...current, ...patch }));
      };
      for (const url of todo) {
        try {
          batch[url] = { src: await makeThumb(url), at: Date.now() };
        } catch (err) {
          batch[url] = { failedAt: Date.now(), error: String((err && err.message) || err).slice(0, 80) };
        }
        if (Object.keys(batch).length >= BATCH) await flush();
        await sleep(PAUSE_MS);
      }
      await flush();
      return todo.length === PER_RUN;
    })()
      .catch((err) => {
        console.warn('[Cart Saver] pictures:', err);
        return false;
      })
      .then((more) => {
        running = null;
        if (more || again) {
          again = false;
          captureSoon();
        }
      });
    return running;
  }

  let timer = null;
  /** Something with pictures changed: make copies in a moment (changes come in bursts). */
  function captureSoon(delayMs = 2000) {
    clearTimeout(timer);
    timer = setTimeout(capture, delayMs);
  }

  /** Forget copies of pictures nothing uses any more, and keep the store bounded. */
  async function pruneThumbs() {
    const urls = await wantedUrls();
    let removed = 0;
    await store.updateThumbs((thumbs) => {
      const kept = Object.entries(thumbs).filter(([url]) => urls.has(url));
      kept.sort(([, a], [, b]) => (b.at || b.failedAt || 0) - (a.at || a.failedAt || 0));
      const next = Object.fromEntries(kept.slice(0, MAX_THUMBS));
      removed = Object.keys(thumbs).length - Object.keys(next).length;
      return removed ? next : undefined;
    });
    return removed;
  }

  root.CMCS.images = { ensureImageRule, capture, captureSoon, pruneThumbs, makeThumb, IMAGE_HOST };
})(globalThis);

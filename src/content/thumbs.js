/*
 * Small local copies of card pictures, made while the user is on
 * cardmarket.com.
 *
 * Cardmarket's image server does not reliably serve its pictures to pages
 * outside cardmarket.com (such as the extension popup). So while a Cardmarket
 * page is open, each saved article's picture is requested once from that page
 * (an ordinary request, like the site's own) and kept as a ~3 KB thumbnail.
 * When the server does not allow reading the picture, nothing is stored and a
 * placeholder is shown instead; it is tried again after a few days.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { store } = CMCS;

  const MAX_PER_PAGE = 24;
  const RETRY_MS = 3 * 24 * 60 * 60 * 1000;
  const WIDTH = 60;
  const HEIGHT = 84;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function makeThumb(url) {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bitmap = await createImageBitmap(await res.blob());
    const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
    const scale = Math.max(WIDTH / bitmap.width, HEIGHT / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    canvas.getContext('2d').drawImage(bitmap, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  let running = false;

  /** Make thumbnails for saved articles and favourites that have none yet. */
  async function capture() {
    if (running) return;
    running = true;
    try {
      const [items, favorites] = await Promise.all([store.getItems(), store.getFavorites()]);
      const now = Date.now();
      const byUrl = new Map();
      for (const [kind, list] of [['item', items], ['fav', favorites]]) {
        for (const article of Object.values(list)) {
          if (!article.imageUrl || article.thumb) continue;
          if (article.thumbTriedAt && now - article.thumbTriedAt < RETRY_MS) continue;
          if (!byUrl.has(article.imageUrl)) byUrl.set(article.imageUrl, []);
          byUrl.get(article.imageUrl).push({ kind, id: article.articleId });
        }
      }

      let done = 0;
      for (const [url, owners] of byUrl) {
        if (done >= MAX_PER_PAGE) break;
        done += 1;
        let patch;
        try {
          patch = { thumb: await makeThumb(url) };
        } catch (err) {
          console.debug('[Cart Saver] no thumbnail for', url, err.message);
          patch = { thumbTriedAt: Date.now() };
        }
        const itemPatches = {};
        const favoritePatches = {};
        for (const owner of owners) (owner.kind === 'item' ? itemPatches : favoritePatches)[owner.id] = patch;
        if (Object.keys(itemPatches).length) await store.patchItems(itemPatches);
        if (Object.keys(favoritePatches).length) await store.patchFavorites(favoritePatches);
        await sleep(150);
      }
    } finally {
      running = false;
    }
  }

  CMCS.thumbs = { capture };
})(globalThis);

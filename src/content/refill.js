/*
 * Puts saved articles back into the Cardmarket cart.
 *
 * Runs inside a cardmarket.com tab (so requests use the user's own session),
 * one article at a time with a pause in between, and stops at the first sign
 * that Cardmarket wants us to slow down or shows a security check. Progress is
 * written to chrome.storage so the popup and widget can follow along.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { cm, store } = CMCS;

  const RUNNER_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const MAX_RETRY_AFTER_S = 60;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let running = false;

  /** Try to take ownership of a pending job. Resolves to the job or null. */
  async function claim(jobId) {
    const claimed = await store.updateJob((job) => {
      if (!job || job.id !== jobId || !store.isJobActive(job) || job.state !== 'pending') return undefined;
      return { ...job, state: 'running', runner: RUNNER_ID, startedAt: Date.now(), heartbeatAt: Date.now() };
    });
    const job = await store.getJob();
    return claimed && job && job.runner === RUNNER_ID ? job : null;
  }

  /** Start re-adding `articleIds` from this tab. */
  async function start(articleIds) {
    const current = await store.getJob();
    if (store.isJobActive(current)) return { ok: false, error: 'busy' };
    const loc = cm.parseLocation(location.href);
    const job = store.newJob(articleIds, loc.lang);
    await store.setJob(job);
    const claimed = await claim(job.id);
    if (!claimed) return { ok: false, error: 'busy' };
    run(claimed); // not awaited: progress goes through storage
    return { ok: true, jobId: job.id };
  }

  /** Pick up a job the popup queued for "whichever Cardmarket tab loads next". */
  async function resumePending() {
    const job = await store.getJob();
    if (!job || job.state !== 'pending' || !store.isJobActive(job)) return false;
    const claimed = await claim(job.id);
    if (claimed) run(claimed);
    return Boolean(claimed);
  }

  async function cancel() {
    await store.updateJob((job) => (job && store.isJobActive(job) ? { ...job, cancelRequested: true } : undefined));
  }

  async function patchJob(patch) {
    await store.updateJob((job) => (job && job.runner === RUNNER_ID ? { ...job, ...patch, heartbeatAt: Date.now() } : undefined));
  }

  async function run(job) {
    if (running) return;
    running = true;
    const heartbeat = setInterval(() => patchJob({}), 5000);
    const lang = job.lang;
    const results = {};
    let added = 0;
    let failed = 0;
    let error = null;
    let errorDetail = null;
    let token = null;
    let tokenConfirmed = false;
    let tokenRefreshed = false;

    /** A token straight from a freshly served cart page. */
    const freshToken = async (game) => {
      const cart = await cm.fetchCart(lang, game);
      return cart.signedIn ? cart.token : null;
    };

    /** One add, with a single wait-and-retry when Cardmarket says "too many requests". */
    const addOnce = async (item) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const result = await cm.addArticle({
            lang,
            game: item.game,
            articleId: item.articleId,
            amount: item.amount,
            token,
          });
          // A refusal before anything worked may be a stale token: refresh once per job.
          if (!result.ok && !tokenConfirmed && !tokenRefreshed) {
            tokenRefreshed = true;
            const fresh = await freshToken(item.game).catch(() => null);
            if (fresh && fresh !== token) {
              token = fresh;
              continue;
            }
          }
          if (result.ok) tokenConfirmed = true;
          return result;
        } catch (err) {
          if (err.kind === 'rate_limited' && attempt < 2) {
            await sleep(Math.min(err.retryAfter || 10, MAX_RETRY_AFTER_S) * 1000);
            continue;
          }
          throw err;
        }
      }
      throw new cm.CardmarketError('rate_limited');
    };

    try {
      const [items, settings, meta] = await Promise.all([store.getItems(), store.getSettings(), store.getMeta()]);
      let todo = job.articleIds.map((id) => items[id]).filter(Boolean);
      if (meta.addEndpoint) cm.endpointPreference.set(meta.addEndpoint);

      // Look at the live cart first: never add an article that is already in
      // it (that would raise its quantity), and never act on a cart page we
      // cannot read.
      const alreadyInCart = new Set();
      for (const game of new Set(todo.map((item) => item.game))) {
        const cart = await cm.fetchCart(lang, game);
        // Only Cardmarket's own login form means "not logged in"; any other odd
        // page is reported as unexpected, with details for a bug report.
        if (!cart.signedIn) {
          throw new cm.CardmarketError(cart.loginPage ? 'logged_out' : 'unexpected_page', null, { detail: cart.detail });
        }
        if (!cart.trustworthy) throw new cm.CardmarketError('cart_unreadable', null, { detail: cart.detail });
        cart.items.forEach((item) => alreadyInCart.add(item.articleId));
        token = token || cart.token;
      }
      todo = todo.filter((item) => !alreadyInCart.has(item.articleId));
      token = (cm.isSignedIn(document) && cm.findToken(document)) || token;
      await patchJob({ total: todo.length });
      if (todo.length && !token) throw new cm.CardmarketError('no_token');

      for (let i = 0; i < todo.length; i += 1) {
        const current = await store.getJob();
        if (!current || current.cancelRequested) {
          error = 'cancelled';
          break;
        }
        const item = todo[i];
        await patchJob({ currentName: item.name });
        const result = await addOnce(item);
        results[item.articleId] = { ok: result.ok, message: result.message || '' };
        if (result.ok) added += 1;
        else failed += 1;
        await patchJob({ done: i + 1, added, failed, results });
        if (i < todo.length - 1) await sleep(settings.delayMs + Math.random() * 400);
      }
    } catch (err) {
      error = err.kind || 'unknown';
      errorDetail = err.detail || (err.kind ? null : String(err.message || err));
      console.warn('[Cart Saver] refill stopped:', err);
    }

    // Check what actually ended up in the cart and update every item's status.
    try {
      await verify(job, results, lang);
    } catch (err) {
      console.warn('[Cart Saver] could not verify cart after refill:', err);
    }

    if (added > 0) {
      const addEndpoint = cm.endpointPreference.get();
      await store.updateMeta((meta) => (meta.addEndpoint === addEndpoint ? undefined : { ...meta, addEndpoint }));
    }

    clearInterval(heartbeat);
    await patchJob({
      state: error && error !== 'cancelled' ? 'error' : 'done',
      error,
      errorDetail,
      added,
      failed,
      results,
      currentName: null,
      finishedAt: Date.now(),
    });
    running = false;

    if (added > 0 && cm.parseLocation(location.href).isCart) {
      setTimeout(() => location.reload(), 1200);
    }
  }

  async function verify(job, results, lang) {
    const items = await store.getItems();
    const attempted = Object.keys(results);
    const games = [...new Set(job.articleIds.map((id) => items[id] && items[id].game).filter(Boolean))];
    const inCart = new Set();
    const settings = await store.getSettings();
    for (const game of games) {
      const cart = await cm.fetchCart(lang, game);
      if (!cart.signedIn) continue;
      cart.items.forEach((item) => inCart.add(item.articleId));
      await store.syncCart(cart.items, { game, addNew: settings.autoTrack, markMissing: cart.trustworthy });
      await store.updateMeta((meta) => ({
        ...meta,
        sync: { ...(meta.sync || {}), [game]: { at: Date.now(), headerCount: cart.headerCount } },
      }));
    }

    const now = Date.now();
    const patches = {};
    const favoritePatches = {};
    const dropped = [];
    for (const id of attempted) {
      const result = results[id];
      const lastAttempt = { at: now, ok: result.ok, message: result.message };
      if (inCart.has(id)) {
        patches[id] = { lastAttempt };
        favoritePatches[id] = { unavailable: false, unavailableMessage: null };
      } else if (result.ok) {
        patches[id] = {
          status: store.STATUS.MISSING,
          lastAttempt: { ...lastAttempt, ok: false, message: CMCS.t('addedButNotInCart') },
        };
      } else {
        const message = result.message || CMCS.t('notAvailableAnymore');
        favoritePatches[id] = { unavailable: true, unavailableMessage: message };
        // A favourite that never made it into the cart stays a favourite only.
        if (items[id] && items[id].viaFavorite) dropped.push(id);
        else patches[id] = { status: store.STATUS.UNAVAILABLE, lastAttempt: { ...lastAttempt, message } };
      }
    }
    await store.patchItems(patches);
    if (dropped.length) await store.removeItems(dropped);
    await store.patchFavorites(favoritePatches);
  }

  CMCS.refill = { start, resumePending, cancel, isRunning: () => running };
})(globalThis);

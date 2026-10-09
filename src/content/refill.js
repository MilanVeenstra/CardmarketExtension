/*
 * Puts saved articles back into the Cardmarket cart.
 *
 * Runs inside a cardmarket.com tab (so requests use the user's own session),
 * one article at a time with a pause in between, and stops at the first sign
 * that Cardmarket wants us to slow down or shows a security check. Progress is
 * written to chrome.storage so the popup and widget can follow along.
 *
 * Only one tab runs a refill at a time: the runner holds a Web Lock for the
 * whole job. The lock disappears with the tab, so a closed tab never leaves a
 * job "running" for others; such a job shows as interrupted and can continue.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { cm, store } = CMCS;

  const RUNNER_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const LOCK_NAME = 'cmcs.refill';
  const MAX_RETRY_AFTER_S = 60;
  /** A token is looked up again at most this often per job (each lookup may fetch pages). */
  const MAX_TOKEN_REFRESHES = 3;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let running = false;

  // ---------------------------------------------------------------------------
  // Lock and ownership
  // ---------------------------------------------------------------------------

  const locks = () => (root.navigator && root.navigator.locks) || null;

  /** Is a refill running in any Cardmarket tab of this browser right now? */
  async function lockHeld() {
    if (running) return true;
    const api = locks();
    if (!api || !api.query) return false;
    const { held = [] } = await api.query();
    return held.some((lock) => lock.name === LOCK_NAME);
  }

  /**
   * Run `fn` while holding the refill lock. Resolves to false, without running
   * it, when another tab holds the lock.
   */
  async function withLock(fn) {
    const api = locks();
    if (!api) {
      if (running) return false;
      await fn();
      return true;
    }
    return api.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (!lock) return false;
      await fn();
      return true;
    });
  }

  /** Try to take ownership of a pending job. Resolves to the job or null. */
  async function claim(jobId) {
    const claimed = await store.updateJob((job) => {
      if (!job || job.id !== jobId || !store.isJobActive(job) || job.state !== 'pending') return undefined;
      return { ...job, state: 'running', runner: RUNNER_ID, startedAt: Date.now(), heartbeatAt: Date.now() };
    });
    const job = await store.getJob();
    return claimed && job && job.runner === RUNNER_ID ? job : null;
  }

  /** Take the lock, claim the job and run it. Resolves once it started (or could not). */
  function launch(jobId) {
    return new Promise((resolve) => {
      withLock(async () => {
        const job = await claim(jobId);
        resolve(job ? { ok: true, jobId } : { ok: false, error: 'busy' });
        if (job) await run(job);
      })
        .then((gotLock) => {
          if (!gotLock) resolve({ ok: false, error: 'busy' });
        })
        .catch((err) => resolve({ ok: false, error: err.message || 'unknown' }));
    });
  }

  /** Start re-adding `articleIds` from this tab. */
  async function start(articleIds) {
    if (!articleIds.length) return { ok: false, error: 'nothing' };
    if (await lockHeld()) return { ok: false, error: 'busy' };
    const current = await store.getJob();
    // A queued job is about to be picked up somewhere. A "running" one without
    // a lock holder is dead (its tab closed) and may be replaced.
    if (current && current.state === 'pending' && store.isJobActive(current)) return { ok: false, error: 'busy' };
    const loc = cm.parseLocation(location.href);
    const job = store.newJob(articleIds, loc.lang);
    await store.setJob(job);
    return launch(job.id);
  }

  let waitingForVisible = false;

  /**
   * Pick up a job the popup queued for "whichever Cardmarket tab loads next":
   * only in a tab you can see, that is signed in (so never a security-check or
   * login page). A hidden tab tries again when it comes to the front.
   */
  async function resumePending() {
    const job = await store.getJob();
    if (!job || job.state !== 'pending' || !store.isJobActive(job)) return false;
    if (document.visibilityState !== 'visible') {
      if (!waitingForVisible) {
        waitingForVisible = true;
        document.addEventListener('visibilitychange', function onVisible() {
          if (document.visibilityState !== 'visible') return;
          document.removeEventListener('visibilitychange', onVisible);
          waitingForVisible = false;
          resumePending();
        });
      }
      return false;
    }
    if (!cm.isSignedIn(document)) {
      // Cardmarket's login form: say so instead of letting the job time out silently.
      if (cm.looksLikeLoginPage(document)) {
        await store.updateJob((current) =>
          current && current.id === job.id && current.state === 'pending'
            ? { ...current, state: 'error', error: 'logged_out', finishedAt: Date.now() }
            : undefined,
        );
      }
      return false;
    }
    const result = await launch(job.id);
    return result.ok;
  }

  async function cancel() {
    await store.updateJob((job) => (job && store.isJobActive(job) ? { ...job, cancelRequested: true } : undefined));
  }

  async function patchJob(patch) {
    await store.updateJob((job) => (job && job.runner === RUNNER_ID ? { ...job, ...patch, heartbeatAt: Date.now() } : undefined));
  }

  /** Articles of a job that were never tried (the tab closed, or it stopped early). */
  function remainingIds(job, items) {
    const results = job.results || {};
    return (job.articleIds || []).filter(
      (id) => !results[id] && items[id] && items[id].status !== store.STATUS.IN_CART,
    );
  }

  /** Leaving the page halfway would interrupt the refill: let the browser ask first. */
  function onBeforeUnload(event) {
    event.preventDefault();
    event.returnValue = '';
  }

  // ---------------------------------------------------------------------------
  // The job
  // ---------------------------------------------------------------------------

  async function run(job) {
    if (running) return;
    running = true;
    const heartbeat = setInterval(() => patchJob({}), 5000);
    window.addEventListener('beforeunload', onBeforeUnload);
    const lang = job.lang;
    const results = {};
    let added = 0;
    let failed = 0;
    let error = null;
    let errorDetail = null;
    let token = null;
    let tokenRefreshes = 0;

    /** Another token than the refused one, from wherever it can be found. */
    const freshToken = async (item) => {
      const found = await cm.discoverToken({ lang, game: item.game, extraPages: [item.productUrl], exclude: token });
      return found.token;
    };

    /** One add, with a wait-and-retry when Cardmarket says "too many requests". */
    const addOnce = async (item, amount) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await cm.addArticle({ lang, game: item.game, articleId: item.articleId, amount, token });
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

    /**
     * Add one article and handle a refusal sensibly:
     * - "not enough copies" → try again with 1 (the article ends up "partly");
     * - a refusal without a known reason may be an expired token → look up a
     *   fresh one and try once more (a few times per job at most);
     * - "sold" → give up on this one.
     */
    const addWithRetries = async (item, amount) => {
      let tryAmount = amount;
      let refreshedForItem = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const result = await addOnce(item, tryAmount);
        if (result.ok) return { ok: true, amount: tryAmount, message: result.message || '' };
        const reason = result.reason || cm.classifyRefusal(result.message);
        if (reason === 'amount' && tryAmount > 1) {
          tryAmount = 1;
          continue;
        }
        if (reason === 'unknown' && !refreshedForItem && tokenRefreshes < MAX_TOKEN_REFRESHES) {
          refreshedForItem = true;
          tokenRefreshes += 1;
          const fresh = await freshToken(item).catch(() => null);
          if (fresh && fresh !== token) {
            token = fresh;
            continue;
          }
        }
        return { ok: false, reason, message: result.message || '' };
      }
      return { ok: false, reason: 'unknown', message: '' };
    };

    try {
      const [items, settings, meta] = await Promise.all([store.getItems(), store.getSettings(), store.getMeta()]);
      const todo = job.articleIds.map((id) => items[id]).filter(Boolean);
      if (meta.addEndpoint) cm.endpointPreference.set(meta.addEndpoint);

      // Look at the live cart first: add only what is still missing (an
      // article already in it would get a higher quantity), and never act on
      // a cart page we cannot read in full.
      const live = new Map();
      for (const game of new Set(todo.map((item) => item.game))) {
        const cart = await cm.fetchCart(lang, game);
        // Only Cardmarket's own login form means "not logged in"; any other odd
        // page is reported as unexpected, with details for a bug report.
        if (!cart.signedIn) {
          throw new cm.CardmarketError(cart.loginPage ? 'logged_out' : 'unexpected_page', null, { detail: cart.detail });
        }
        if (!cart.trustworthy) {
          throw new cm.CardmarketError('cart_unreadable', null, { detail: [cart.untrusted, cart.detail].filter(Boolean).join(' · ') });
        }
        if (meta.account && cart.username && cart.username !== meta.account) {
          throw new cm.CardmarketError('other_account', null, { detail: `${cart.username} ≠ ${meta.account}` });
        }
        cart.items.forEach((item) => live.set(item.articleId, item.amount || 1));
        token = token || cart.token;
      }
      const plan = [];
      for (const item of todo) {
        const wanted = item.wantedAmount || item.amount || 1;
        const amount = wanted - (live.get(item.articleId) || 0);
        if (amount > 0) plan.push({ item, amount });
      }

      token = (cm.isSignedIn(document) && cm.findToken(document)) || token;
      await patchJob({ total: plan.length });
      if (plan.length && !token) {
        // Current Cardmarket pages do not always print the token; look further.
        const first = plan[0].item;
        const found = await cm.discoverToken({ lang, game: first.game, extraPages: [first.productUrl] });
        if (!found.token) throw new cm.CardmarketError('no_token', null, { detail: found.detail });
        token = found.token;
      }

      for (let i = 0; i < plan.length; i += 1) {
        const current = await store.getJob();
        // Another tab took over (or the list was cleared): stop without a word.
        if (!current || current.runner !== RUNNER_ID) break;
        if (current.cancelRequested) {
          error = 'cancelled';
          break;
        }
        const { item, amount } = plan[i];
        await patchJob({ currentName: item.name });
        const result = await addWithRetries(item, amount);
        results[item.articleId] = result;
        if (result.ok) added += 1;
        else failed += 1;
        await patchJob({ done: i + 1, added, failed, results });
        if (i < plan.length - 1) await sleep(settings.delayMs + Math.random() * 400);
      }
    } catch (err) {
      error = err.kind || 'unknown';
      errorDetail = err.detail || (err.kind ? null : String(err.message || err));
      console.warn('[Cart Saver] refill stopped:', err);
    } finally {
      // Whatever happened above: check the cart, update every status, release the job.
      try {
        const verified = await verify(job, results, lang);
        if (verified) ({ added, failed } = verified);
      } catch (err) {
        console.warn('[Cart Saver] could not verify cart after refill:', err);
      }
      try {
        if (added > 0) {
          const addEndpoint = cm.endpointPreference.get();
          await store.updateMeta((meta) => (meta.addEndpoint === addEndpoint ? undefined : { ...meta, addEndpoint }));
        }
      } catch {
        // Only a preference.
      }
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', onBeforeUnload);
      await patchJob({
        state: error && error !== 'cancelled' ? 'error' : 'done',
        error,
        errorDetail,
        added,
        failed,
        results,
        currentName: null,
        finishedAt: Date.now(),
      }).catch(() => {});
      running = false;
    }

    if (added > 0 && cm.parseLocation(location.href).isCart) {
      setTimeout(() => location.reload(), 1200);
    }
  }

  /**
   * Read the cart again and give every article of the job its real status.
   * Resolves to the final { added, failed } counts.
   */
  async function verify(job, results, lang) {
    const items = await store.getItems();
    const settings = await store.getSettings();
    const games = [...new Set(job.articleIds.map((id) => items[id] && items[id].game).filter(Boolean))];
    const inCart = new Set();
    const readGames = new Set();
    for (const game of games) {
      const cart = await cm.fetchCart(lang, game);
      if (!cart.signedIn) continue;
      readGames.add(game);
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
    let added = 0;
    let failed = 0;
    for (const [id, result] of Object.entries(results)) {
      const prev = items[id] || {};
      const lastAttempt = { at: now, ok: result.ok, message: result.message, reason: result.reason || null };
      if (result.ok && !readGames.has(prev.game)) {
        // Could not look: believe Cardmarket's "added".
        added += 1;
        patches[id] = { lastAttempt };
        continue;
      }
      if (inCart.has(id) && result.ok) {
        added += 1;
        patches[id] = { lastAttempt: { ...lastAttempt, ok: true } };
        favoritePatches[id] = { unavailable: false, unavailableMessage: null };
        continue;
      }
      if (inCart.has(id)) {
        // Extra copies of an article that is partly in the cart were refused:
        // it stays "partly", with Cardmarket's message.
        failed += 1;
        patches[id] = { lastAttempt: { ...lastAttempt, message: result.message || CMCS.t('refusedUnknown') } };
        continue;
      }
      failed += 1;
      if (result.ok) {
        patches[id] = {
          status: store.STATUS.MISSING,
          lastAttempt: { ...lastAttempt, ok: false, message: CMCS.t('addedButNotInCart') },
        };
        continue;
      }
      // Only a clear "sold" (or no copies left at all) means gone. A refusal
      // without a known reason keeps the article missing, with the message;
      // the second one in a row counts as gone too.
      const repeated = prev.lastAttempt && !prev.lastAttempt.ok && prev.lastAttempt.reason === 'unknown';
      const gone =
        result.reason === 'sold' ||
        result.reason === 'amount' ||
        (result.reason === 'unknown' && (repeated || prev.status === store.STATUS.UNAVAILABLE));
      const message = result.message || CMCS.t(gone ? 'notAvailableAnymore' : 'refusedUnknown');
      if (gone) favoritePatches[id] = { unavailable: true, unavailableMessage: message };
      // A favourite that never made it into the cart stays a favourite only.
      if (prev.viaFavorite) dropped.push(id);
      else {
        patches[id] = {
          status: gone ? store.STATUS.UNAVAILABLE : store.STATUS.MISSING,
          lastAttempt: { ...lastAttempt, message },
        };
      }
    }
    // Favourites queued for this job but never tried (stopped early) go too.
    for (const id of job.articleIds) {
      if (!results[id] && items[id] && items[id].viaFavorite && !inCart.has(id)) dropped.push(id);
    }
    await store.patchItems(patches);
    if (dropped.length) await store.removeItems(dropped);
    await store.patchFavorites(favoritePatches);
    return { added, failed };
  }

  CMCS.refill = { start, resumePending, cancel, lockHeld, remainingIds, isRunning: () => running };
})(globalThis);

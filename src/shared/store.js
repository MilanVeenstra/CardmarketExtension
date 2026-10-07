/*
 * Storage + data model for saved cart items.
 *
 * Loaded as a classic script in every context (content script, popup, options
 * page and the background service worker), so it only touches `chrome.storage`
 * and never `window` / `document`.
 *
 * Saved items are keyed by Cardmarket's article id (one specific offer of one
 * seller). Items are never deleted automatically when they disappear from the
 * cart — that is the whole point: they are marked `missing` so they can be put
 * back later. Only an explicit user action, or seeing the article on an order
 * page (= it was bought), removes an item.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});

  const KEYS = {
    items: 'cmcs.items',
    meta: 'cmcs.meta',
    job: 'cmcs.job',
    settings: 'cmcs.settings',
  };

  const STATUS = {
    IN_CART: 'in_cart',
    MISSING: 'missing',
    UNAVAILABLE: 'unavailable',
  };

  const DEFAULT_SETTINGS = {
    /** Save every article that shows up in the cart automatically. */
    autoTrack: true,
    /** Show the on-page reminder when saved articles fell out of the cart. */
    showReminder: true,
    /** Pause between two add-to-cart requests (a random 0–400 ms is added). */
    delayMs: 1200,
  };

  /** A job counts as abandoned when its tab stopped sending heartbeats. */
  const JOB_STALE_MS = 30 * 1000;
  /** A pending job (opened from the popup) must be picked up within this time. */
  const JOB_PENDING_TTL_MS = 2 * 60 * 1000;

  const storage = () => root.chrome.storage.local;

  async function get(key, fallback) {
    const result = await storage().get(key);
    return result[key] === undefined ? fallback : result[key];
  }

  async function set(key, value) {
    await storage().set({ [key]: value });
  }

  // Read-modify-write calls are queued per context so two quick updates from
  // the same page never overwrite each other.
  let queue = Promise.resolve();
  function update(key, fallback, fn) {
    const run = queue.then(async () => {
      const current = await get(key, fallback);
      const next = await fn(current);
      if (next !== undefined) await set(key, next);
      return next;
    });
    queue = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------------------
  // Pure helpers (no storage access) — easy to reason about and to test.
  // ---------------------------------------------------------------------------

  /**
   * Merge a freshly read cart into the saved items.
   *
   * @param {Record<string, object>} items  saved items keyed by article id
   * @param {object[]} cartItems            articles currently in the cart
   * @param {object} opts
   * @param {string} opts.game              game whose cart was read
   * @param {number} opts.now
   * @param {boolean} opts.addNew           save articles we did not know yet
   * @param {boolean} opts.markMissing      mark saved articles absent from the cart
   */
  function applyCartSnapshot(items, cartItems, opts) {
    const next = { ...items };
    const seen = new Set();
    const added = [];
    for (const cartItem of cartItems) {
      seen.add(cartItem.articleId);
      const prev = next[cartItem.articleId];
      if (!prev && !opts.addNew) continue;
      if (!prev) added.push(cartItem.articleId);
      next[cartItem.articleId] = {
        ...(prev || {}),
        ...cartItem,
        firstSavedAt: (prev && prev.firstSavedAt) || opts.now,
        lastSeenInCartAt: opts.now,
        status: STATUS.IN_CART,
        missingSince: null,
        lastAttempt: (prev && prev.lastAttempt) || null,
      };
    }

    const newlyMissing = [];
    if (opts.markMissing) {
      for (const [id, item] of Object.entries(next)) {
        if (seen.has(id) || item.game !== opts.game) continue;
        if (item.status === STATUS.IN_CART) {
          next[id] = { ...item, status: STATUS.MISSING, missingSince: opts.now };
          newlyMissing.push(id);
        }
      }
    }
    return { items: next, added, newlyMissing, inCart: seen.size };
  }

  /** Counts per status, optionally limited to one game. */
  function summarize(items, game) {
    const summary = { total: 0, inCart: 0, missing: 0, unavailable: 0, missingValue: 0 };
    for (const item of Object.values(items || {})) {
      if (game && item.game !== game) continue;
      summary.total += 1;
      if (item.status === STATUS.IN_CART) summary.inCart += 1;
      else if (item.status === STATUS.UNAVAILABLE) summary.unavailable += 1;
      else {
        summary.missing += 1;
        summary.missingValue += (item.price || 0) * (item.amount || 1);
      }
    }
    return summary;
  }

  /** Saved items that are not in the cart and worth trying to re-add. */
  function refillCandidates(items, { game, includeUnavailable = false } = {}) {
    return Object.values(items || {}).filter(
      (item) =>
        (!game || item.game === game) &&
        (item.status === STATUS.MISSING ||
          (includeUnavailable && item.status === STATUS.UNAVAILABLE)),
    );
  }

  /** A stable signature of the missing set, used to remember a dismissed reminder. */
  function missingSignature(items, game) {
    return refillCandidates(items, { game })
      .map((item) => item.articleId)
      .sort()
      .join(',');
  }

  /** A refill job, before a Cardmarket tab claims and runs it. */
  function newJob(articleIds, lang) {
    const now = Date.now();
    return {
      id: `job-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      state: 'pending',
      lang: lang || 'en',
      articleIds,
      total: articleIds.length,
      done: 0,
      added: 0,
      failed: 0,
      results: {},
      error: null,
      createdAt: now,
      heartbeatAt: now,
      finishedAt: null,
      acknowledged: false,
    };
  }

  function isJobActive(job, now = Date.now()) {
    if (!job) return false;
    if (job.state === 'running') return now - (job.heartbeatAt || 0) < JOB_STALE_MS;
    if (job.state === 'pending') return now - (job.createdAt || 0) < JOB_PENDING_TTL_MS;
    return false;
  }

  function groupBy(list, keyFn) {
    const groups = new Map();
    for (const entry of list) {
      const key = keyFn(entry);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    return groups;
  }

  function formatPrice(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return `${value.toFixed(2).replace('.', ',')} €`;
  }

  // ---------------------------------------------------------------------------
  // Storage API
  // ---------------------------------------------------------------------------

  const store = {
    KEYS,
    STATUS,
    DEFAULT_SETTINGS,
    JOB_STALE_MS,
    JOB_PENDING_TTL_MS,

    applyCartSnapshot,
    summarize,
    refillCandidates,
    missingSignature,
    newJob,
    isJobActive,
    groupBy,
    formatPrice,

    getItems: () => get(KEYS.items, {}),
    setItems: (items) => set(KEYS.items, items),
    updateItems: (fn) => update(KEYS.items, {}, fn),

    async getSettings() {
      return { ...DEFAULT_SETTINGS, ...(await get(KEYS.settings, {})) };
    },
    async saveSettings(patch) {
      return update(KEYS.settings, {}, (current) => ({ ...current, ...patch }));
    },

    getMeta: () => get(KEYS.meta, {}),
    updateMeta: (fn) => update(KEYS.meta, {}, fn),

    getJob: () => get(KEYS.job, null),
    setJob: (job) => set(KEYS.job, job),
    updateJob: (fn) => update(KEYS.job, null, fn),

    /** Store a freshly read cart. Returns what changed. */
    async syncCart(cartItems, { game, addNew, markMissing }) {
      let result;
      await update(KEYS.items, {}, (items) => {
        result = applyCartSnapshot(items, cartItems, {
          game,
          addNew,
          markMissing,
          now: Date.now(),
        });
        return result.items;
      });
      return result;
    },

    async removeItems(articleIds) {
      const ids = new Set(articleIds);
      return update(KEYS.items, {}, (items) => {
        const next = {};
        for (const [id, item] of Object.entries(items)) if (!ids.has(id)) next[id] = item;
        return next;
      });
    },

    async patchItems(patches) {
      return update(KEYS.items, {}, (items) => {
        const next = { ...items };
        for (const [id, patch] of Object.entries(patches)) {
          if (next[id]) next[id] = { ...next[id], ...patch };
        }
        return next;
      });
    },

    onChanged(callback) {
      root.chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') callback(changes);
      });
    },
  };

  CMCS.store = store;
})(globalThis);

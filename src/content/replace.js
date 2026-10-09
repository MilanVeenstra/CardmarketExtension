/*
 * Finds a replacement for a saved article that was sold.
 *
 * 1. The same seller: their stock, searched for the card (one parcel, and the
 *    price may not be more than 25% higher).
 * 2. The product page, filtered like the original (language, at least the
 *    same condition, foil). Sellers already in your cart come first when they
 *    are not much dearer: their parcel is coming anyway.
 *
 * Only after a click, at most two page requests, spaced out like a refill.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});
  const { cm, store } = CMCS;

  /** The same seller may ask this much more (factor) and still be suggested first. */
  const SAME_SELLER_MAX = 1.25;
  /** Rough cost of one more letter from another seller (€), to compare offers fairly. */
  const EXTRA_PARCEL_EUR = 1.25;
  const MAX_SUGGESTIONS = 3;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pathOf = (url) => {
    try {
      return new URL(url).pathname.replace(/\/$/, '').toLowerCase();
    } catch {
      return null;
    }
  };

  /** Is this offer the same card in the same shape (language, condition, foil)? */
  function equivalent(original, offer) {
    if (!offer || !offer.articleId || offer.articleId === original.articleId || offer.price == null) return false;
    const sameProduct =
      original.productUrl && offer.productUrl
        ? pathOf(original.productUrl) === pathOf(offer.productUrl)
        : (offer.name || '').toLowerCase() === (original.name || '').toLowerCase();
    if (!sameProduct) return false;
    if (original.language && offer.language && original.language !== offer.language) return false;
    if (!original.language && original.languageLabel && offer.languageLabel && original.languageLabel !== offer.languageLabel) return false;
    // Lower condition ids are better (1 = Mint).
    if (original.condition && offer.condition && offer.condition > original.condition) return false;
    if (Boolean(original.foil) !== Boolean(offer.foil)) return false;
    return true;
  }

  async function offersOn(url) {
    const { doc, url: finalUrl } = await cm.fetchDocument(url);
    return [...doc.querySelectorAll('[id^="articleRow"]')]
      .map((row) => cm.parseOfferRow(row, { baseUrl: finalUrl }))
      .filter(Boolean);
  }

  /**
   * Up to three replacement offers for `original`, best first, each with a
   * `reason`: 'sameSeller', 'sellerInCart' or 'cheapest'.
   */
  async function find(original) {
    const [items, settings] = await Promise.all([store.getItems(), store.getSettings()]);
    const inCartSellers = new Set(
      Object.values(items)
        .filter((item) => item.game === original.game && (item.status === store.STATUS.IN_CART || item.status === store.STATUS.PARTIAL))
        .map((item) => (item.seller || '').toLowerCase()),
    );
    const found = new Map();
    const sellerKey = (offer) => (offer.seller || '').toLowerCase();

    const sellerUrl = cm.sellerSearchUrl(original);
    if (sellerUrl) {
      try {
        for (const offer of await offersOn(sellerUrl)) {
          if (!offer.seller) offer.seller = original.seller;
          if (equivalent(original, offer)) found.set(offer.articleId, offer);
        }
      } catch (err) {
        if (err.kind === 'challenge' || err.kind === 'rate_limited') throw err;
      }
    }

    const productUrl = cm.alternativesUrl(original);
    if (productUrl) {
      if (sellerUrl) await sleep(settings.delayMs);
      for (const offer of await offersOn(productUrl)) {
        if (equivalent(original, offer) && !found.has(offer.articleId)) found.set(offer.articleId, offer);
      }
    }

    const originalSeller = (original.seller || '').toLowerCase();
    const ranked = [...found.values()].map((offer) => {
      const seller = sellerKey(offer);
      const sameSeller = seller && seller === originalSeller;
      const inCart = inCartSellers.has(seller);
      const reason = sameSeller && (original.price == null || offer.price <= original.price * SAME_SELLER_MAX)
        ? 'sameSeller'
        : inCart
          ? 'sellerInCart'
          : 'cheapest';
      // What it would really cost: a new seller means another parcel.
      const cost = offer.price + (sameSeller || inCart ? 0 : EXTRA_PARCEL_EUR);
      return { ...offer, game: offer.game || original.game, lang: offer.lang || original.lang, reason, cost };
    });
    ranked.sort((a, b) => (a.reason === 'sameSeller' ? -1 : 0) - (b.reason === 'sameSeller' ? -1 : 0) || a.cost - b.cost);
    return ranked.slice(0, MAX_SUGGESTIONS);
  }

  /**
   * Put a replacement in the cart in place of `original`. The offer joins the
   * saved list with the same wanted amount; once it is in the cart the
   * original leaves the list (see refill verify).
   */
  async function use(original, offer) {
    const { reason, cost, available, ...article } = offer;
    const wanted = Math.min(original.wantedAmount || original.amount || 1, available || Infinity);
    await store.ensureItems([{ ...article, wantedAmount: wanted, amount: wanted, replaces: original.articleId }]);
    return CMCS.refill.start([offer.articleId]);
  }

  CMCS.replace = { find, use, equivalent };
})(globalThis);

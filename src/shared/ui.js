/*
 * Small DOM helpers and the item list styling shared by the on-page widget
 * (inside a shadow root on cardmarket.com) and the popup.
 */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});

  /** Create an element. Strings become text nodes, so page data is never parsed as HTML. */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
    for (const child of children.flat(Infinity)) {
      if (child == null || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  }

  const ICON_PATHS = {
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    minus: '<path d="M6 12h12"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    starFilled: '<path fill="currentColor" d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/>',
    cart: '<path d="M3.5 5h2l1.8 9.2a1 1 0 0 0 1 .8h7.6a1 1 0 0 0 1-.8L18.5 8H7"/><circle cx="9.5" cy="19" r="1.2"/><circle cx="16" cy="19" r="1.2"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
    swap: '<path d="M4 8h14l-3.5-3.5"/><path d="M20 16H6l3.5 3.5"/>',
  };

  /** A 16px line icon (inline SVG, inherits the text colour). */
  function icon(name) {
    const svg = new DOMParser().parseFromString(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`,
      'image/svg+xml',
    ).documentElement;
    return document.importNode(svg, true);
  }

  const STATUS_LABEL = {
    in_cart: 'statusInCart',
    partial: 'statusPartial',
    missing: 'statusMissing',
    unavailable: 'statusUnavailable',
  };

  const REASON_KEYS = { emptied: 'reasonEmptied', seller: 'reasonSeller', single: 'reasonSingle' };
  /** How long "the price changed" stays visible. */
  const PRICE_CHANGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

  /**
   * Short lines on what happened to an article: how many copies made it, why
   * it left the cart, and whether its price changed. Each is { text, warn }.
   */
  function statusInfo(item, now = Date.now()) {
    const t = CMCS.t;
    const lines = [];
    if (item.status === 'partial') {
      lines.push({ text: t('partialNote', item.amount || 0, item.wantedAmount || item.amount || 1), warn: true });
    } else if (item.status === 'missing' && REASON_KEYS[item.missingReason]) {
      lines.push({ text: t(REASON_KEYS[item.missingReason]) });
    }
    // Against Cardmarket's trend price (only when it says something).
    const trend = item.trend && item.trend.value;
    if (trend && item.price != null) {
      const ratio = item.price / trend - 1;
      if (ratio >= 0.15 && item.price - trend >= 0.1) {
        lines.push({ text: t('trendAbove', CMCS.store.formatPrice(trend), String(Math.round(ratio * 100))), warn: true });
      } else if (ratio <= -0.15) {
        lines.push({ text: t('trendBelow', CMCS.store.formatPrice(trend), String(Math.round(-ratio * 100))) });
      }
    }
    const change = item.priceChange;
    if (change && change.from != null && change.to != null && now - (change.at || 0) < PRICE_CHANGE_TTL_MS) {
      const up = change.to > change.from;
      const diff = CMCS.store.formatPrice(Math.abs(change.to - change.from));
      lines.push({ text: t(up ? 'priceUp' : 'priceDown', diff, CMCS.store.formatPrice(change.from)), warn: up });
    }
    return lines;
  }

  function itemMeta(item) {
    return [
      item.expansion,
      item.conditionLabel,
      item.languageLabel,
      ...(item.extras || []),
    ].filter(Boolean);
  }

  /**
   * One saved article.
   * @param {object} item
   * @param {object} opts
   * @param {Node[]} [opts.actions]   buttons/links shown on the right
   * @param {Node}   [opts.leading]   e.g. a checkbox in front of the thumbnail
   * @param {boolean}[opts.showStatus]
   * @param {boolean}[opts.showSeller]  default true
   * @param {string} [opts.href]        where the name links to (default: product page)
   * @param {string} [opts.extraMeta]   an extra muted line
   * @param {string} [opts.note]        a warning line (default: last failed attempt)
   * @param {boolean}[opts.showInfo]    lines on copies, reason and price change (default true)
   */
  function itemRow(item, opts = {}) {
    const t = CMCS.t;
    const price = CMCS.store.formatPrice(item.price);
    const failed = item.lastAttempt && !item.lastAttempt.ok && item.status !== 'in_cart';
    const note = opts.note !== undefined ? opts.note : failed ? item.lastAttempt.message : null;
    const href = opts.href || item.productUrl;
    return h(
      'div',
      { class: `cmcs-item cmcs-item--${item.status}`, dataset: { articleId: item.articleId } },
      opts.leading || null,
      thumbnail(item),
      h(
        'div',
        { class: 'cmcs-item-main' },
        href
          ? h('a', { class: 'cmcs-item-name', href, target: '_blank', rel: 'noopener', title: item.name }, item.name)
          : h('span', { class: 'cmcs-item-name' }, item.name),
        h('div', { class: 'cmcs-item-meta' }, itemMeta(item).join(' · ')),
        item.seller && opts.showSeller !== false ? h('div', { class: 'cmcs-item-meta' }, t('soldBy', item.seller)) : null,
        opts.extraMeta ? h('div', { class: 'cmcs-item-meta' }, opts.extraMeta) : null,
        opts.showInfo === false
          ? null
          : statusInfo(item).map((line) => h('div', { class: `cmcs-item-info ${line.warn ? 'cmcs-item-info--warn' : ''}` }, line.text)),
        note ? h('div', { class: 'cmcs-item-note' }, note) : null,
      ),
      h(
        'div',
        { class: 'cmcs-item-side' },
        h('div', { class: 'cmcs-price' }, price, item.amount > 1 ? h('span', { class: 'cmcs-amount' }, ` ×${item.amount}`) : null),
        opts.showStatus
          ? h('span', { class: `cmcs-badge cmcs-badge--${item.status}` }, t(STATUS_LABEL[item.status] || 'statusMissing'))
          : null,
        opts.actions && opts.actions.length ? h('div', { class: 'cmcs-item-actions' }, opts.actions) : null,
      ),
    );
  }

  const ERROR_KEYS = {
    logged_out: 'errorLoggedOut',
    challenge: 'errorChallenge',
    rate_limited: 'errorRateLimited',
    network_error: 'errorNetwork',
    no_endpoint: 'errorNoEndpoint',
    http_error: 'errorHttp',
    cart_unreadable: 'errorCartUnreadable',
    unexpected_page: 'errorUnexpected',
    unexpected_response: 'errorUnexpected',
    no_token: 'errorNoToken',
    other_account: 'errorOtherAccount',
    cancelled: 'jobCancelled',
  };

  /** User-facing text for a refill job's `error` kind. */
  function errorText(kind) {
    return kind ? CMCS.t(ERROR_KEYS[kind] || 'errorUnknown') : null;
  }

  /** The error of a finished job plus its technical details (for bug reports). */
  function jobError(job) {
    if (!job || !job.error) return [];
    const stopped = job.error !== 'cancelled';
    return [
      h('p', { class: stopped ? 'cmcs-error' : 'cmcs-muted' }, errorText(job.error)),
      stopped && job.errorDetail ? h('p', { class: 'cmcs-detail' }, CMCS.t('errorDetails', job.errorDetail)) : null,
    ].filter(Boolean);
  }

  /** A neutral card-shaped stand-in when there is no picture (or it cannot load). */
  function thumbPlaceholder(item) {
    return h(
      'div',
      { class: 'cmcs-thumb cmcs-thumb--empty', title: item.name || '' },
      h('span', null, (item.name || '?').trim().charAt(0).toUpperCase()),
    );
  }

  /**
   * The card picture: the small copy saved while browsing Cardmarket first
   * (works everywhere, also in the popup), else Cardmarket's own image URL,
   * else a placeholder. A picture that fails to load turns into the placeholder.
   */
  function thumbnail(item) {
    const src = item.thumb || item.imageUrl;
    if (!src) return thumbPlaceholder(item);
    const img = h('img', { class: 'cmcs-thumb', src, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(thumbPlaceholder(item)), { once: true });
    return img;
  }

  function iconButton(label, iconName, onClick, extraClass = '') {
    return h('button', { type: 'button', class: `cmcs-icon-btn ${extraClass}`, title: label, 'aria-label': label, onclick: onClick }, icon(iconName));
  }

  function iconLink(label, iconName, href) {
    return h('a', { class: 'cmcs-icon-btn', href, target: '_blank', rel: 'noopener', title: label, 'aria-label': label }, icon(iconName));
  }

  /** Shared look for items, buttons and badges (light + dark). */
  const STYLES = `
    :host, .cmcs-root {
      --cmcs-bg: #ffffff;
      --cmcs-surface: #f5f7fa;
      --cmcs-border: #dfe3ea;
      --cmcs-text: #1c2430;
      --cmcs-muted: #637083;
      --cmcs-accent: #1a5fd6;
      --cmcs-accent-text: #ffffff;
      --cmcs-accent-hover: #154db0;
      --cmcs-ok: #1d7f45;
      --cmcs-ok-bg: #e3f4ea;
      --cmcs-warn: #8a5a00;
      --cmcs-warn-bg: #fff2d6;
      --cmcs-bad: #b42318;
      --cmcs-bad-bg: #fde7e5;
      --cmcs-star: #e09a00;
      --cmcs-shadow: 0 10px 30px rgba(15, 23, 42, 0.18), 0 2px 6px rgba(15, 23, 42, 0.08);
      --cmcs-radius: 10px;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.4;
      color: var(--cmcs-text);
    }
    @media (prefers-color-scheme: dark) {
      :host, .cmcs-root {
        --cmcs-bg: #1b2029;
        --cmcs-surface: #232a35;
        --cmcs-border: #343d4b;
        --cmcs-text: #e7ebf1;
        --cmcs-muted: #9aa5b5;
        --cmcs-accent: #4c8dff;
        --cmcs-accent-text: #0b1220;
        --cmcs-accent-hover: #7aa9ff;
        --cmcs-ok: #5fd08f;
        --cmcs-ok-bg: #18382a;
        --cmcs-warn: #f2c063;
        --cmcs-warn-bg: #3a2e14;
        --cmcs-bad: #ff8a80;
        --cmcs-bad-bg: #42201d;
        --cmcs-star: #f5b82e;
        --cmcs-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      }
    }
    * { box-sizing: border-box; }
    /* "hidden" always wins over a display set by a class (flex rows, the toast…). */
    [hidden] { display: none !important; }
    a { color: var(--cmcs-accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .cmcs-btn {
      appearance: none; border: 1px solid transparent; border-radius: 7px;
      padding: 7px 12px; font: inherit; font-weight: 600; cursor: pointer;
      background: var(--cmcs-accent); color: var(--cmcs-accent-text);
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 32px;
    }
    .cmcs-btn:hover { background: var(--cmcs-accent-hover); }
    .cmcs-btn:disabled { opacity: 0.5; cursor: default; }
    .cmcs-btn--ghost { background: transparent; color: var(--cmcs-text); border-color: var(--cmcs-border); }
    .cmcs-btn--ghost:hover { background: var(--cmcs-surface); }
    .cmcs-btn--danger { background: transparent; color: var(--cmcs-bad); border-color: var(--cmcs-border); }
    .cmcs-btn--danger:hover { background: var(--cmcs-bad-bg); }
    .cmcs-icon-btn {
      appearance: none; border: 0; background: transparent; color: var(--cmcs-muted);
      width: 26px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 15px; line-height: 1;
      display: inline-flex; align-items: center; justify-content: center; text-decoration: none;
    }
    .cmcs-icon-btn:hover { background: var(--cmcs-surface); color: var(--cmcs-text); text-decoration: none; }
    .cmcs-icon-btn svg { width: 16px; height: 16px; }
    .cmcs-icon-btn--star { color: var(--cmcs-star); }
    .cmcs-icon-btn--star:hover { color: var(--cmcs-star); }
    .cmcs-item {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 8px 0; border-top: 1px solid var(--cmcs-border);
    }
    .cmcs-item:first-child { border-top: 0; }
    .cmcs-item input[type="checkbox"] { margin: 10px 0 0; accent-color: var(--cmcs-accent); }
    .cmcs-thumb { width: 30px; height: 42px; object-fit: cover; border-radius: 3px; flex: none; background: var(--cmcs-surface); }
    .cmcs-thumb--empty {
      display: flex; align-items: center; justify-content: center;
      border: 1px solid var(--cmcs-border); color: var(--cmcs-muted);
      font-size: 13px; font-weight: 700;
      background: linear-gradient(160deg, var(--cmcs-surface), var(--cmcs-bg));
    }
    .cmcs-item-main { flex: 1; min-width: 0; }
    .cmcs-item-name { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cmcs-text); }
    .cmcs-item-meta { color: var(--cmcs-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cmcs-item-note { color: var(--cmcs-bad); font-size: 12px; }
    .cmcs-item-info { color: var(--cmcs-muted); font-size: 12px; }
    .cmcs-item-info--warn { color: var(--cmcs-warn); }
    .cmcs-item-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex: none; }
    .cmcs-price { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmcs-amount { color: var(--cmcs-muted); font-weight: 500; }
    .cmcs-item-actions { display: flex; gap: 2px; }
    .cmcs-badge { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
    .cmcs-badge--in_cart { color: var(--cmcs-ok); background: var(--cmcs-ok-bg); }
    .cmcs-badge--missing, .cmcs-badge--partial { color: var(--cmcs-warn); background: var(--cmcs-warn-bg); }
    .cmcs-badge--unavailable { color: var(--cmcs-bad); background: var(--cmcs-bad-bg); }
    .cmcs-progress { height: 6px; border-radius: 999px; background: var(--cmcs-surface); overflow: hidden; }
    .cmcs-progress > div { height: 100%; background: var(--cmcs-accent); transition: width 0.3s ease; }
    .cmcs-muted { color: var(--cmcs-muted); }
    .cmcs-error { color: var(--cmcs-bad); }
    .cmcs-detail { color: var(--cmcs-muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; user-select: all; margin-top: 2px; }
    .cmcs-btn--small { min-height: 26px; padding: 3px 10px; font-size: 12px; }
    .cmcs-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 2px; }
    .cmcs-chips-label { font-size: 12px; color: var(--cmcs-muted); }
    .cmcs-chip {
      appearance: none; border: 1px solid var(--cmcs-border); background: transparent; color: var(--cmcs-text);
      border-radius: 999px; padding: 3px 10px; font: inherit; font-size: 12px; cursor: pointer; line-height: 1.4;
    }
    .cmcs-chip:hover { background: var(--cmcs-surface); }
    .cmcs-chip[aria-pressed="true"] { background: var(--cmcs-accent); border-color: var(--cmcs-accent); color: var(--cmcs-accent-text); }
    .cmcs-chip[aria-pressed="true"]::before { content: "✓ "; }
    .cmcs-chip[aria-pressed="false"] { color: var(--cmcs-muted); text-decoration: line-through; }
    .cmcs-replace { margin: 0 0 8px 40px; padding: 6px 10px; border-radius: 8px; background: var(--cmcs-surface); }
    .cmcs-replace .cmcs-item { padding: 6px 0; }
    .cmcs-replace .cmcs-item-meta:last-child { white-space: normal; }
    .cmcs-replace-title { font-size: 12px; font-weight: 700; color: var(--cmcs-muted); margin: 2px 0; }
    .cmcs-group-title { font-size: 12px; font-weight: 700; color: var(--cmcs-muted); text-transform: uppercase; letter-spacing: 0.03em; margin: 12px 0 2px; }
  `;

  CMCS.ui = { h, icon, itemRow, statusInfo, iconButton, iconLink, errorText, jobError, STYLES };
})(globalThis);

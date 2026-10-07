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

  const STATUS_LABEL = {
    in_cart: 'statusInCart',
    missing: 'statusMissing',
    unavailable: 'statusUnavailable',
  };

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
   */
  function itemRow(item, opts = {}) {
    const t = CMCS.t;
    const price = CMCS.store.formatPrice(item.price);
    const failed = item.lastAttempt && !item.lastAttempt.ok && item.status !== 'in_cart';
    return h(
      'div',
      { class: `cmcs-item cmcs-item--${item.status}`, dataset: { articleId: item.articleId } },
      opts.leading || null,
      item.imageUrl
        ? h('img', { class: 'cmcs-thumb', src: item.imageUrl, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
        : h('div', { class: 'cmcs-thumb cmcs-thumb--empty' }),
      h(
        'div',
        { class: 'cmcs-item-main' },
        item.productUrl
          ? h('a', { class: 'cmcs-item-name', href: item.productUrl, target: '_blank', rel: 'noopener', title: item.name }, item.name)
          : h('span', { class: 'cmcs-item-name' }, item.name),
        h('div', { class: 'cmcs-item-meta' }, itemMeta(item).join(' · ')),
        item.seller && opts.showSeller !== false ? h('div', { class: 'cmcs-item-meta' }, t('soldBy', item.seller)) : null,
        failed && item.lastAttempt.message
          ? h('div', { class: 'cmcs-item-note' }, item.lastAttempt.message)
          : null,
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
    cancelled: 'jobCancelled',
  };

  /** User-facing text for a refill job's `error` kind. */
  function errorText(kind) {
    return kind ? CMCS.t(ERROR_KEYS[kind] || 'errorUnknown') : null;
  }

  function iconButton(label, symbol, onClick, extraClass = '') {
    return h('button', { type: 'button', class: `cmcs-icon-btn ${extraClass}`, title: label, 'aria-label': label, onclick: onClick }, symbol);
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
        --cmcs-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      }
    }
    * { box-sizing: border-box; }
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
    .cmcs-item {
      display: flex; gap: 10px; align-items: flex-start;
      padding: 8px 0; border-top: 1px solid var(--cmcs-border);
    }
    .cmcs-item:first-child { border-top: 0; }
    .cmcs-item input[type="checkbox"] { margin: 10px 0 0; accent-color: var(--cmcs-accent); }
    .cmcs-thumb { width: 30px; height: 42px; object-fit: cover; border-radius: 3px; flex: none; background: var(--cmcs-surface); }
    .cmcs-item-main { flex: 1; min-width: 0; }
    .cmcs-item-name { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cmcs-text); }
    .cmcs-item-meta { color: var(--cmcs-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cmcs-item-note { color: var(--cmcs-bad); font-size: 12px; }
    .cmcs-item-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex: none; }
    .cmcs-price { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmcs-amount { color: var(--cmcs-muted); font-weight: 500; }
    .cmcs-item-actions { display: flex; gap: 2px; }
    .cmcs-badge { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
    .cmcs-badge--in_cart { color: var(--cmcs-ok); background: var(--cmcs-ok-bg); }
    .cmcs-badge--missing { color: var(--cmcs-warn); background: var(--cmcs-warn-bg); }
    .cmcs-badge--unavailable { color: var(--cmcs-bad); background: var(--cmcs-bad-bg); }
    .cmcs-progress { height: 6px; border-radius: 999px; background: var(--cmcs-surface); overflow: hidden; }
    .cmcs-progress > div { height: 100%; background: var(--cmcs-accent); transition: width 0.3s ease; }
    .cmcs-muted { color: var(--cmcs-muted); }
    .cmcs-error { color: var(--cmcs-bad); }
    .cmcs-group-title { font-size: 12px; font-weight: 700; color: var(--cmcs-muted); text-transform: uppercase; letter-spacing: 0.03em; margin: 12px 0 2px; }
  `;

  CMCS.ui = { h, itemRow, iconButton, errorText, STYLES };
})(globalThis);

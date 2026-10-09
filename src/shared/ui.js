/*
 * Small DOM helpers, the shared look (design tokens) and the article row used
 * by the popup, the options page and the on-page panel (inside a shadow root
 * on cardmarket.com).
 *
 * Design rules: black and white with one red, used only for warnings and
 * "sold"; square corners (card pictures 2px); rows separated by thin lines,
 * no box around each article; capitals only in the CART SAVER wordmark and
 * the VERKOCHT stamp.
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

  const svg = (markup) => document.importNode(new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement, true);

  /** Line icons (Lucide), 16px, in the text colour. */
  const ICON_PATHS = {
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    minus: '<path d="M5 12h14"/>',
    settings: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
    refresh: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    starFilled: '<polygon fill="currentColor" points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  };

  function icon(name) {
    return svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] || ''}</svg>`,
    );
  }

  /** The Cart Saver mark (a card falling into a basket); colours follow the theme. */
  function logo(size = 20) {
    return svg(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" class="cmcs-logo" aria-hidden="true">` +
        '<g transform="rotate(14 13.5 7)"><rect x="10" y="0.5" width="7.5" height="11" style="fill:var(--cmcs-text)"/><rect x="10" y="0.5" width="7.5" height="3" style="fill:var(--cmcs-red)"/></g>' +
        '<path d="M6.2 9h15.3l-2.2 8H8.4z" style="fill:var(--cmcs-logo-body);stroke:var(--cmcs-text)" stroke-width="2"/>' +
        '<path d="M1.5 5.5h3.2l1.5 3.5" fill="none" style="stroke:var(--cmcs-text)" stroke-width="2"/>' +
        '<rect x="8" y="19.5" width="3" height="3" style="fill:var(--cmcs-text)"/><rect x="16.5" y="19.5" width="3" height="3" style="fill:var(--cmcs-text)"/></svg>',
    );
  }

  /** Logo plus the CART SAVER wordmark. */
  function brand(size = 20) {
    return h('span', { class: 'cmcs-brand' }, logo(size), h('span', { class: 'cmcs-wordmark' }, 'CART SAVER'));
  }

  /** The red "VERKOCHT" stamp for articles that are gone. */
  const stamp = (text) => h('span', { class: 'cmcs-stamp' }, text || CMCS.t('stampSold'));

  // ---------------------------------------------------------------------------
  // What to say about an article
  // ---------------------------------------------------------------------------

  const REASON_KEYS = { emptied: 'reasonEmptied', seller: 'reasonSeller', single: 'reasonSingle' };
  const REASON_SHORT = { emptied: 'noteReasonEmptied', seller: 'noteReasonSeller', single: 'noteReasonSingle' };
  /** How long "the price changed" stays visible. */
  const PRICE_CHANGE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

  /** A trend older than this (the price guide stopped loading, or was switched off) is not shown. */
  const TREND_TTL_MS = 3 * 24 * 60 * 60 * 1000;

  /**
   * Why Cardmarket refused an article, in the interface's language. Its own
   * words (in the site's language) stay available as `raw`, for a tooltip.
   */
  function refusal(attempt) {
    if (!attempt || attempt.ok) return null;
    const raw = attempt.message || null;
    if (attempt.reason === 'sold') return { text: CMCS.t('refusedSold'), raw };
    if (attempt.reason === 'amount') return { text: CMCS.t('refusedAmount'), raw };
    if (attempt.reason === 'unknown') return { text: raw ? CMCS.t('refusedUnknownWith', raw) : CMCS.t('refusedUnknown'), raw };
    // Our own messages ("added, but not in the cart") are already in the right words.
    return raw ? { text: raw, raw: null } : null;
  }

  /**
   * Everything worth saying about an article, most important first. Each line
   * has a full sentence (`text`), a short one for the quiet row (`short`) and
   * whether it is a warning (`warn`, shown in red).
   */
  function statusInfo(item, now = Date.now()) {
    const t = CMCS.t;
    const fmt = CMCS.store.formatPrice;
    const lines = [];
    const failed = item.status !== 'in_cart' && refusal(item.lastAttempt);
    if (failed) lines.push({ text: failed.text, short: failed.text, warn: true, raw: failed.raw });
    const change = item.priceChange;
    if (change && change.from != null && change.to != null && now - (change.at || 0) < PRICE_CHANGE_TTL_MS && change.to > change.from) {
      const diff = fmt(change.to - change.from);
      lines.push({ text: t('priceUp', diff, fmt(change.from)), short: t('notePriceUp', diff), warn: true });
    }
    const trend = item.trend && (!item.trend.at || now - item.trend.at < TREND_TTL_MS) ? item.trend.value : null;
    if (trend && item.price != null) {
      const ratio = item.price / trend - 1;
      const pct = String(Math.round(Math.abs(ratio) * 100));
      if (ratio >= 0.15 && item.price - trend >= 0.1) {
        lines.push({ text: t('trendAbove', fmt(trend), pct), short: t('noteTrendAbove', pct), warn: true });
      } else if (ratio <= -0.15) {
        lines.push({ text: t('trendBelow', fmt(trend), pct), short: t('noteTrendBelow', pct) });
      }
    }
    if (item.status === 'partial') {
      const text = t('partialNote', item.amount || 0, item.wantedAmount || item.amount || 1);
      lines.push({ text, short: text });
    } else if (item.status === 'missing' && REASON_KEYS[item.missingReason]) {
      lines.push({ text: t(REASON_KEYS[item.missingReason]), short: t(REASON_SHORT[item.missingReason]) });
    }
    if (change && change.from != null && change.to != null && now - (change.at || 0) < PRICE_CHANGE_TTL_MS && change.to < change.from) {
      const diff = fmt(change.from - change.to);
      lines.push({ text: t('priceDown', diff, fmt(change.from)), short: t('notePriceDown', diff) });
    }
    // Warnings first; otherwise the order above.
    return [...lines.filter((l) => l.warn), ...lines.filter((l) => !l.warn)];
  }

  /** Cardmarket's language ids (1–11), said the way the interface speaks. */
  const LANGUAGE_EN = {
    1: 'English', 2: 'French', 3: 'German', 4: 'Spanish', 5: 'Italian', 6: 'S-Chinese',
    7: 'Japanese', 8: 'Portuguese', 9: 'Russian', 10: 'Korean', 11: 'T-Chinese',
  };
  const LANGUAGE_NL = {
    1: 'Engels', 2: 'Frans', 3: 'Duits', 4: 'Spaans', 5: 'Italiaans', 6: 'Vereenvoudigd Chinees',
    7: 'Japans', 8: 'Portugees', 9: 'Russisch', 10: 'Koreaans', 11: 'Traditioneel Chinees',
  };
  const LANGUAGE_BY_NAME = Object.fromEntries(Object.entries(LANGUAGE_EN).map(([id, name]) => [name, Number(id)]));

  /** The article's language in the interface's language (the site may have said "Englisch"). */
  function languageName(label, id) {
    const known = Number(id) || LANGUAGE_BY_NAME[label];
    if (!known || !LANGUAGE_EN[known]) return label || null;
    const dutch = /^nl/i.test((root.chrome && chrome.i18n && chrome.i18n.getUILanguage()) || '');
    return dutch ? LANGUAGE_NL[known] : LANGUAGE_EN[known];
  }

  /** "Commander Masters · EX · Duits · Foil" */
  const shortMeta = (item) =>
    [item.expansion, item.conditionLabel, languageName(item.languageLabel, item.language), ...(item.extras || [])].filter(Boolean).join(' · ');

  /** How many copies the row is about: what is in your cart, or what would go back. */
  const copiesOf = (item) => (item.status === 'in_cart' ? item.amount || 1 : CMCS.store.refillAmount(item));

  /**
   * One article, in the quiet style: picture, "2× Name", one meta line, at
   * most one short extra line (red only for a warning; the full sentence in
   * the tooltip) and the price on the right. With `onToggle` the row opens on
   * click into the details: all meta, every extra line in full, and `details`
   * (buttons).
   *
   * @param {object} item
   * @param {object} opts
   * @param {Node}     [opts.leading]   e.g. a checkbox in front of the picture
   * @param {Node[]}   [opts.actions]   small icon buttons, always visible on the right
   * @param {Node[]}   [opts.details]   buttons in the opened row
   * @param {boolean}  [opts.open]      the row is opened
   * @param {Function} [opts.onToggle]  makes the row open/close on click
   * @param {string}   [opts.href]      name links here (rows that do not open)
   * @param {string}   [opts.extraMeta] an extra grey line (e.g. the game)
   * @param {string|null} [opts.note]   replaces the extra line (null: none)
   * @param {string}   [opts.noteTitle] tooltip of that line (e.g. Cardmarket's own words)
   * @param {boolean}  [opts.sold]      grey picture and name, with the VERKOCHT stamp
   * @param {boolean}  [opts.showSeller] say who sells it in the details (default true)
   * @param {string}   [opts.price]     price text instead of price × copies
   * @param {Node}     [opts.below]     something under the name (e.g. a link)
   * @param {boolean}  [opts.hideMeta]  leave out the meta line
   * @param {boolean}  [opts.withGame]  add the game to the meta line (several games in view)
   */
  function itemRow(item, opts = {}) {
    const t = CMCS.t;
    const copies = copiesOf(item);
    const info = statusInfo(item);
    const first = info[0];
    const noteText = opts.note !== undefined ? opts.note : first ? first.short : null;
    const noteWarn = opts.note !== undefined ? false : Boolean(first && first.warn);
    const total = opts.price !== undefined ? opts.price : CMCS.store.formatPrice(item.price != null ? item.price * copies : null);
    const name = `${copies > 1 ? `${copies}× ` : ''}${item.name}`;
    const toggles = typeof opts.onToggle === 'function';

    const nameEl =
      !toggles && opts.href
        ? h('a', { class: 'cmcs-item-name', href: opts.href, target: '_blank', rel: 'noopener', title: item.name }, name)
        : h('span', { class: 'cmcs-item-name', title: item.name }, name);

    const main = h(
      'div',
      { class: 'cmcs-item-main' },
      nameEl,
      opts.hideMeta
        ? null
        : h('div', { class: 'cmcs-item-meta' }, [shortMeta(item), opts.withGame && CMCS.store.gameName ? CMCS.store.gameName(item.game) : null].filter(Boolean).join(' · ')),
      opts.extraMeta ? h('div', { class: 'cmcs-item-meta' }, opts.extraMeta) : null,
      noteText && !opts.open
        ? h(
            'div',
            {
              class: `cmcs-item-note ${noteWarn ? 'cmcs-item-note--warn' : ''}`,
              title: opts.note !== undefined ? opts.noteTitle || null : first ? first.raw || first.text : null,
            },
            noteText,
          )
        : null,
      opts.below || null,
    );

    // The part that opens the row; a checkbox in front and buttons behind it stay
    // outside it (no buttons inside a button, for screen readers and clicks alike).
    const line = h(
      'div',
      {
        class: 'cmcs-item-line',
        role: toggles ? 'button' : null,
        tabindex: toggles ? '0' : null,
        'aria-expanded': toggles ? String(Boolean(opts.open)) : null,
        onclick: toggles
          ? (event) => {
              if (event.target.closest('a, button, input')) return;
              opts.onToggle();
            }
          : null,
        onkeydown: toggles
          ? (event) => {
              if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                event.preventDefault();
                opts.onToggle();
              }
            }
          : null,
      },
      thumbnail(item, opts.sold),
      main,
      opts.sold ? stamp() : null,
      h('div', { class: 'cmcs-item-side' }, opts.sold ? null : h('div', { class: 'cmcs-price' }, total || '')),
    );
    const row = h(
      'div',
      { class: 'cmcs-item-row' },
      opts.leading || null,
      line,
      opts.actions && opts.actions.length ? h('div', { class: 'cmcs-item-actions' }, opts.actions) : null,
    );

    let details = null;
    if (opts.open) {
      const longMeta = [
        item.expansion,
        languageName(item.languageLabel, item.language),
        ...(item.extras || []),
        opts.showSeller === false ? null : item.seller,
        CMCS.store.gameName ? CMCS.store.gameName(item.game) : item.game,
      ]
        .filter(Boolean)
        .join(' · ');
      details = h(
        'div',
        { class: 'cmcs-item-details' },
        h('div', { class: 'cmcs-item-meta cmcs-wrap' }, longMeta),
        info.map((l) => h('div', { class: `cmcs-item-note ${l.warn ? 'cmcs-item-note--warn' : ''}`, title: l.raw || null }, l.text)),
        opts.details && opts.details.length ? h('div', { class: 'cmcs-item-buttons' }, opts.details) : null,
      );
    }

    return h(
      'div',
      {
        class: `cmcs-item cmcs-item--${item.status || 'offer'} ${opts.open ? 'cmcs-item--open' : ''} ${opts.sold ? 'cmcs-item--sold' : ''}`,
        dataset: { articleId: item.articleId },
      },
      row,
      details,
    );
  }

  /** A text button for the opened row ("Only this one back", "On Cardmarket"). */
  function detailButton(label, onClick, { strong = false, href = null } = {}) {
    const cls = `cmcs-detail-btn ${strong ? 'cmcs-detail-btn--strong' : ''}`;
    return href
      ? h('a', { class: cls, href, target: '_blank', rel: 'noopener' }, label)
      : h('button', { type: 'button', class: cls, onclick: onClick }, label);
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
  function thumbPlaceholder(item, extraClass = '') {
    return h(
      'div',
      { class: `cmcs-thumb cmcs-thumb--empty ${extraClass}`, title: item.name || '' },
      h('span', null, (item.name || '?').trim().charAt(0).toUpperCase()),
    );
  }

  /** Small copies of the pictures (made by the background, see src/background/images.js): url → { src }. */
  let thumbSources = {};
  function setThumbs(thumbs) {
    thumbSources = thumbs || {};
  }

  /**
   * The product picture: the small local copy when there is one (popup,
   * options), else Cardmarket's own picture, else a placeholder. A picture
   * that fails to load turns into the placeholder.
   */
  function thumbnail(item, sold = false) {
    const extra = sold ? 'cmcs-thumb--sold' : '';
    const local = item.imageUrl && thumbSources[item.imageUrl];
    const src = (local && local.src) || item.imageUrl;
    if (!src) return thumbPlaceholder(item, extra);
    const img = h('img', { class: `cmcs-thumb ${extra}`, src, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.replaceWith(thumbPlaceholder(item, extra)), { once: true });
    return img;
  }

  function iconButton(label, iconName, onClick, extraClass = '') {
    return h('button', { type: 'button', class: `cmcs-icon-btn ${extraClass}`, title: label, 'aria-label': label, onclick: onClick }, icon(iconName));
  }

  function iconLink(label, iconName, href) {
    return h('a', { class: 'cmcs-icon-btn', href, target: '_blank', rel: 'noopener', title: label, 'aria-label': label }, icon(iconName));
  }

  /** The black main button: label left, amount (or an arrow) right; red on hover. */
  function primaryButton(label, trailing, onClick, { disabled = false } = {}) {
    return h(
      'button',
      { type: 'button', class: 'cmcs-primary', disabled, onclick: onClick },
      h('span', null, label),
      trailing == null ? icon('arrowRight') : h('span', { class: 'cmcs-primary-amount' }, trailing),
    );
  }

  /** Design tokens and shared components (light + dark). */
  const STYLES = `
    :host, .cmcs-root {
      --cmcs-bg: #ffffff;
      --cmcs-surface: #f7f6f3;
      --cmcs-text: #141414;
      --cmcs-muted: #6b6a64;
      --cmcs-disabled: #8a8983;
      --cmcs-line: #efeeea;
      --cmcs-border: #e3e2de;
      --cmcs-border-strong: #d4d3ce;
      --cmcs-red: #b3122b;
      --cmcs-primary-bg: #141414;
      --cmcs-primary-text: #ffffff;
      --cmcs-logo-body: #ffffff;
      --cmcs-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
      /* Older names, kept for the pieces that still use them. */
      --cmcs-accent: var(--cmcs-text);
      --cmcs-bad: var(--cmcs-red);
      --cmcs-warn: var(--cmcs-red);
      --cmcs-radius: 0;
      /* Native parts (scrollbars, select lists, number fields) follow the theme too. */
      color-scheme: light dark;
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.35;
      color: var(--cmcs-text);
    }
    @media (prefers-color-scheme: dark) {
      :host, .cmcs-root {
        --cmcs-bg: #212120;
        --cmcs-surface: #2a2a28;
        --cmcs-text: #f2f2ef;
        --cmcs-muted: #a8a7a1;
        --cmcs-disabled: #7a7973;
        --cmcs-line: #333331;
        --cmcs-border: #3a3a38;
        --cmcs-border-strong: #4a4a47;
        --cmcs-red: #f0475a;
        --cmcs-primary-bg: #f2f2ef;
        --cmcs-primary-text: #141414;
        --cmcs-logo-body: #151515;
        --cmcs-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
      }
    }
    * { box-sizing: border-box; }
    /* "hidden" always wins over a display set by a class (flex rows, the toast…). */
    [hidden] { display: none !important; }
    a { color: inherit; }
    :focus-visible { outline: 2px solid var(--cmcs-text); outline-offset: 2px; }

    .cmcs-brand { display: inline-flex; align-items: center; gap: 8px; }
    .cmcs-logo { display: block; flex: none; }
    .cmcs-wordmark { font-size: 14px; font-weight: 900; letter-spacing: 0.04em; white-space: nowrap; }

    /* Buttons */
    .cmcs-primary {
      appearance: none; border: 0; width: 100%; cursor: pointer;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 10px 12px; font: inherit; font-weight: 700; text-align: left;
      background: var(--cmcs-primary-bg); color: var(--cmcs-primary-text);
    }
    .cmcs-primary:hover:not(:disabled) { background: var(--cmcs-red); color: #ffffff; }
    .cmcs-primary:disabled { background: var(--cmcs-line); color: var(--cmcs-disabled); cursor: default; }
    .cmcs-primary svg { width: 16px; height: 16px; flex: none; }
    .cmcs-primary-amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmcs-btn {
      appearance: none; border: 1.5px solid var(--cmcs-primary-bg); border-radius: 0;
      padding: 6px 12px; font: inherit; font-weight: 700; cursor: pointer;
      background: var(--cmcs-primary-bg); color: var(--cmcs-primary-text);
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      min-height: 32px; white-space: nowrap; text-decoration: none;
    }
    .cmcs-btn:hover:not(:disabled) { background: var(--cmcs-red); border-color: var(--cmcs-red); color: #ffffff; }
    .cmcs-btn:disabled { opacity: 0.45; cursor: default; }
    .cmcs-btn--ghost { background: transparent; color: var(--cmcs-text); border-color: var(--cmcs-border-strong); font-weight: 600; }
    .cmcs-btn--ghost:hover:not(:disabled) { background: transparent; color: var(--cmcs-text); border-color: var(--cmcs-text); }
    .cmcs-btn--danger { background: transparent; color: var(--cmcs-red); border-color: var(--cmcs-border-strong); font-weight: 600; }
    .cmcs-btn--danger:hover:not(:disabled) { background: transparent; color: var(--cmcs-red); border-color: var(--cmcs-red); }
    .cmcs-btn--small { min-height: 26px; padding: 3px 9px; font-size: 12px; }
    a.cmcs-btn:hover { text-decoration: none; }
    .cmcs-icon-btn {
      appearance: none; border: 0; background: transparent; color: var(--cmcs-disabled);
      width: 26px; height: 26px; border-radius: 0; cursor: pointer; padding: 0;
      display: inline-flex; align-items: center; justify-content: center; text-decoration: none; flex: none;
    }
    .cmcs-icon-btn:hover { color: var(--cmcs-text); background: var(--cmcs-surface); }
    .cmcs-icon-btn svg { width: 16px; height: 16px; }
    .cmcs-icon-btn--star { color: var(--cmcs-text); }
    .cmcs-link {
      appearance: none; border: 0; background: none; padding: 0; font: inherit; font-size: 12px; cursor: pointer;
      color: var(--cmcs-text); text-decoration: underline; text-underline-offset: 2px;
    }
    .cmcs-link:hover { color: var(--cmcs-red); }

    /* Article rows */
    .cmcs-item { border-top: 1px solid var(--cmcs-line); }
    .cmcs-item--open { background: var(--cmcs-surface); }
    .cmcs-item-row { display: flex; align-items: center; gap: 10px; }
    .cmcs-item-line { flex: 1; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .cmcs-item-line[role="button"] { cursor: pointer; }
    .cmcs-item--open .cmcs-item-row, .cmcs-item--open .cmcs-item-details { padding-left: 6px; padding-right: 6px; }
    .cmcs-item-row input[type="checkbox"] { margin: 0; accent-color: var(--cmcs-text); flex: none; }
    /* Cards fill the box; square pictures (booster boxes, displays) are shown whole. */
    .cmcs-thumb { width: 30px; height: 42px; object-fit: contain; border-radius: 2px; flex: none; background: var(--cmcs-line); display: block; }
    .cmcs-thumb--empty {
      display: flex; align-items: center; justify-content: center;
      color: var(--cmcs-muted); font-size: 13px; font-weight: 800;
    }
    .cmcs-thumb--sold { filter: grayscale(1) opacity(0.5); }
    .cmcs-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .cmcs-item-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--cmcs-text); text-decoration: none; }
    a.cmcs-item-name:hover { text-decoration: underline; }
    .cmcs-item--sold .cmcs-item-name { color: var(--cmcs-disabled); }
    .cmcs-item-meta { font-size: 12px; color: var(--cmcs-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cmcs-wrap { white-space: normal; }
    .cmcs-item-note { font-size: 12px; color: var(--cmcs-muted); }
    .cmcs-item-note--warn { color: var(--cmcs-red); }
    .cmcs-item-side { flex: none; text-align: right; }
    .cmcs-price { font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmcs-item-actions { display: flex; gap: 0; flex: none; }
    .cmcs-item-details { display: flex; flex-direction: column; gap: 6px; padding: 0 0 10px 40px; }
    .cmcs-item-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    .cmcs-detail-btn {
      appearance: none; background: transparent; color: var(--cmcs-text); font: inherit; font-size: 12px; cursor: pointer;
      border: 1.5px solid var(--cmcs-border-strong); border-radius: 0; padding: 4px 8px; text-decoration: none;
      display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
    }
    .cmcs-detail-btn:hover { border-color: var(--cmcs-text); }
    .cmcs-detail-btn--strong { border-color: var(--cmcs-text); font-weight: 700; }
    .cmcs-detail-btn--strong:hover { background: var(--cmcs-primary-bg); color: var(--cmcs-primary-text); }
    .cmcs-detail-btn svg { width: 14px; height: 14px; }

    /* Stamp, chips, groups */
    .cmcs-stamp {
      flex: none; border: 2px solid var(--cmcs-red); color: var(--cmcs-red); background: transparent;
      font-size: 10px; font-weight: 900; letter-spacing: 0.1em; padding: 1px 5px; transform: rotate(-6deg);
      white-space: nowrap; line-height: 1.3;
    }
    .cmcs-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 8px 0 2px; }
    .cmcs-chips-label { font-size: 12px; color: var(--cmcs-muted); }
    .cmcs-chip {
      appearance: none; border: 1.5px solid var(--cmcs-border-strong); background: transparent; color: var(--cmcs-text);
      border-radius: 0; padding: 2px 8px; font: inherit; font-size: 12px; cursor: pointer; line-height: 1.4;
    }
    .cmcs-chip:hover { border-color: var(--cmcs-text); }
    .cmcs-chip[aria-pressed="true"] { background: var(--cmcs-primary-bg); border-color: var(--cmcs-primary-bg); color: var(--cmcs-primary-text); }
    .cmcs-chip[aria-pressed="true"]::before { content: "✓ "; }
    .cmcs-chip[aria-pressed="false"] { color: var(--cmcs-disabled); text-decoration: line-through; }
    .cmcs-section-title { font-size: 12px; color: var(--cmcs-muted); margin: 14px 0 4px; font-weight: 400; }
    .cmcs-seller {
      appearance: none; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; width: 100%;
      display: flex; align-items: center; gap: 10px; padding: 12px 0 4px; font-size: 12px; text-align: left;
    }
    .cmcs-seller-name { font-weight: 700; color: var(--cmcs-text); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cmcs-seller-sub { color: var(--cmcs-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .cmcs-seller svg { width: 14px; height: 14px; color: var(--cmcs-disabled); flex: none; }
    .cmcs-seller--closed { border-top: 1px solid var(--cmcs-line); padding: 10px 0; font-size: 13px; }
    .cmcs-seller--closed .cmcs-seller-sub { color: var(--cmcs-text); font-weight: 700; }
    .cmcs-stack { display: flex; flex: none; padding-right: 8px; }
    .cmcs-stack .cmcs-thumb { width: 24px; height: 34px; margin-right: -8px; box-shadow: 0 0 0 2px var(--cmcs-bg); }
    .cmcs-seller-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .cmcs-seller-text small { font-size: 12px; color: var(--cmcs-muted); font-weight: 400; }

    /* Summary (top of the cart views) */
    .cmcs-summary { display: flex; flex-direction: column; gap: 10px; padding: 6px 0 4px; }
    .cmcs-summary-title { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin: 0; line-height: 1.2; }
    .cmcs-summary-sub { color: var(--cmcs-muted); margin: 0; }

    /* Progress, messages */
    .cmcs-progress { height: 4px; background: var(--cmcs-line); overflow: hidden; }
    .cmcs-progress > div { height: 100%; background: var(--cmcs-text); transition: width 0.3s ease; }
    .cmcs-muted { color: var(--cmcs-muted); }
    .cmcs-error { color: var(--cmcs-red); }
    .cmcs-detail { color: var(--cmcs-muted); font-size: 11px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-word; user-select: all; margin-top: 2px; }
  `;

  CMCS.ui = {
    h,
    icon,
    logo,
    brand,
    stamp,
    itemRow,
    statusInfo,
    refusal,
    shortMeta,
    languageName,
    copiesOf,
    detailButton,
    primaryButton,
    iconButton,
    iconLink,
    errorText,
    jobError,
    thumbnail,
    setThumbs,
    STYLES,
  };
})(globalThis);

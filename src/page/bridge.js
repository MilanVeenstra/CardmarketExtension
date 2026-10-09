/*
 * Runs in the page's own JavaScript context ("MAIN" world) on
 * www.cardmarket.com. It has no extension APIs and sends nothing anywhere
 * except to the site itself. Two jobs:
 *
 * 1. Perform a same-origin request on behalf of the content script, so it
 *    leaves from the page exactly like the site's own buttons do. Cardmarket
 *    does not always answer requests from an extension's isolated world the
 *    same way (other Cardmarket tools found the same).
 * 2. Remember the session's CSRF token (`__cmtkn`) when the site itself sends
 *    it. Current Cardmarket pages do not always print it in a form field; the
 *    site's own AJAX calls carry it, either as a `__cmtkn` field or inside an
 *    obfuscated `args` value ("action***token" XOR-ed, then "***" + base64).
 *
 * 3. Tell the content script when the site itself removed articles from the
 *    cart (the trash button sends ShoppingCart_RemoveArticle with idArticle,
 *    idSeller and amount-<id>), so those leave the saved list instead of
 *    showing up as "missing". Only reported once the request succeeded.
 *
 * Protocol: the content script sends one window message { __cmcs: 'hello' }
 * carrying a MessagePort. This script listens first (it runs before any page
 * script), keeps that message from the page's own listeners and talks over
 * the private port from then on, so page scripts can neither read nor fake
 * the conversation. Nothing on `window` gives the extension away.
 *   ← { __cmcs: 'ready' }
 *   → { __cmcs: 'request', id, ping? | getToken? | url, method, headers, body }
 *   ← { __cmcs: 'response', id, pong? | token? | status, ok, url, text, headers | error }
 *   ← { __cmcs: 'event', type: 'cart-removal', action, articleIds, sellerIds }
 */
(function () {
  'use strict';

  const ORIGIN = location.origin;
  /** Ports of content scripts that said hello (normally one). */
  const ports = new Set();
  // Keep the browser's own fetch, in case the site wraps window.fetch later.
  const nativeFetch = window.fetch.bind(window);
  const HEADERS = ['content-type', 'retry-after', 'cf-mitigated'];
  const HEX_TOKEN = /^[0-9a-f]{32,}$/i;

  let siteToken = null;

  // --- Token from the site's own requests --------------------------------------

  /**
   * Cardmarket's obfuscated `args` value, already percent-decoded:
   * XOR("action***token") with a counter starting at an unknown seed, then
   * "***" + base64(JSON of the parameters). Returns { action, token, params };
   * any part that cannot be read is null.
   */
  function decodeArgs(value) {
    const text = String(value || '');
    const cut = text.lastIndexOf('***');
    const head = cut === -1 ? text : text.slice(0, cut);
    const tail = cut === -1 ? '' : text.slice(cut + 3);
    let action = null;
    let token = null;
    for (let seed = 0; seed < 256 && !action; seed += 1) {
      let plain = '';
      for (let i = 0; i < head.length; i += 1) {
        plain += String.fromCharCode((head.charCodeAt(i) ^ ((seed + i) & 0xff)) & 0xff);
      }
      const match = plain.match(/^([A-Za-z][A-Za-z0-9_]+)\*\*\*([\x21-\x7e]{8,})$/);
      if (match) [, action, token] = match;
    }
    let params = null;
    try {
      const bytes = Uint8Array.from(atob(tail.replace(/ /g, '+').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
      params = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      // Not readable: fine, the action alone may be enough.
    }
    return { action, token, params };
  }

  /** Percent-decoding byte by byte: the obfuscated part is bytes, not UTF-8. */
  const percentBytes = (raw) => String(raw).replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  /** The token inside a raw (still percent-encoded) `args` value. */
  function tokenFromArgs(rawArgs) {
    const { token } = decodeArgs(percentBytes(rawArgs));
    return token && HEX_TOKEN.test(token) ? token : null;
  }

  /** The `args` value of a request, decoded the way decodeArgs needs it (or null). */
  function argsValue(url, body) {
    if (body instanceof FormData || body instanceof URLSearchParams) {
      const value = body.get('args');
      if (typeof value === 'string') return value;
    }
    const sources = [typeof body === 'string' ? body : '', String(url || '').split('?')[1] || ''];
    for (const text of sources) {
      const match = text.match(/(?:^|&)args=([^&]*)/);
      if (match) return percentBytes(match[1]);
    }
    return null;
  }

  function remember(token) {
    if (typeof token === 'string' && HEX_TOKEN.test(token.trim())) siteToken = token.trim();
  }

  function inspectEncoded(text) {
    if (!text) return;
    const field = String(text).match(/(?:^|[?&])__cmtkn=([^&]+)/);
    if (field) remember(decodeURIComponent(field[1]));
    const args = String(text).match(/(?:^|[?&])args=([^&]+)/);
    if (args) remember(tokenFromArgs(args[1]));
  }

  function inspect(url, body) {
    try {
      if (url) inspectEncoded(String(url).split('?')[1] || '');
      if (!body) return;
      if (typeof body === 'string') inspectEncoded(body);
      else if (body instanceof URLSearchParams) inspectEncoded(body.toString());
      else if (body instanceof FormData) {
        remember(body.get('__cmtkn'));
        const args = body.get('args');
        if (typeof args === 'string') remember(tokenFromArgs(encodeURIComponent(args)));
      }
    } catch {
      // Never let observing get in the site's way.
    }
  }

  // --- The site's own cart removals ------------------------------------------------

  const REMOVAL_ACTION = /\/(?:AjaxAction|PostGetAction)\/(ShoppingCart_[A-Za-z_]*(?:Remove|Delete|Empty|Clear)[A-Za-z_]*)/i;

  function bodyText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return new URLSearchParams([...body.entries()].filter(([, v]) => typeof v === 'string')).toString();
    return '';
  }

  const REMOVAL_NAME = /^ShoppingCart_[A-Za-z_]*(?:Remove|Delete|Empty|Clear)[A-Za-z_]*$/i;

  /** Ids anywhere in decoded `args` parameters: idArticle (number, list or map), amount-<id>, idSeller. */
  function collectIds(value, key, articleIds, sellerIds) {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach((entry) => collectIds(entry, key, articleIds, sellerIds));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        const named = k.match(/^amount-(\d+)$/) || k.match(/^idArticle\[(\d+)\]$/);
        if (named) articleIds.add(named[1]);
        if (/^idArticles?$/i.test(key) && /^\d+$/.test(k)) articleIds.add(k);
        collectIds(v, k, articleIds, sellerIds);
      }
      return;
    }
    const text = String(value);
    if (!/^\d+$/.test(text)) return;
    if (/^idArticles?$/i.test(key)) articleIds.add(text);
    if (/^idSeller$/i.test(key)) sellerIds.add(text);
  }

  /**
   * Article and seller ids in a removal request: idArticle=1, idArticle={"1":"1"},
   * idArticle[1]=…, amount-1=…, or all of it inside an obfuscated `args`
   * value (whose action then also says whether it is a removal).
   */
  function removalTargets(url, body) {
    const params = new URLSearchParams(bodyText(body));
    const query = String(url || '').split('?')[1];
    if (query) new URLSearchParams(query).forEach((value, key) => params.append(key, value));
    const fromUrl = String(url || '').match(REMOVAL_ACTION);
    const rawArgs = argsValue(url, body);
    const args = rawArgs ? decodeArgs(rawArgs) : null;
    const action = fromUrl ? fromUrl[1] : args && args.action && REMOVAL_NAME.test(args.action) ? args.action : null;
    if (!action) return null;
    const articleIds = new Set();
    const sellerIds = new Set();
    if (args && args.params) collectIds(args.params, '', articleIds, sellerIds);
    params.forEach((value, key) => {
      const bracket = key.match(/^idArticle\[(\d+)\]$/) || key.match(/^amount-(\d+)$/);
      if (bracket) articleIds.add(bracket[1]);
      if (key === 'idArticle') {
        if (/^\d+$/.test(value)) articleIds.add(value);
        else {
          try {
            Object.keys(JSON.parse(value)).forEach((id) => /^\d+$/.test(id) && articleIds.add(id));
          } catch {
            // Not JSON: nothing to read.
          }
        }
      }
      if (key === 'idSeller' && /^\d+$/.test(value)) sellerIds.add(value);
    });
    return { action, articleIds: [...articleIds], sellerIds: [...sellerIds] };
  }

  function reportRemoval(targets) {
    if (!targets) return;
    for (const port of ports) port.postMessage({ __cmcs: 'event', type: 'cart-removal', ...targets });
  }

  // --- Watching the site's requests --------------------------------------------------

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cmcsUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    inspect(this.__cmcsUrl, body);
    try {
      const targets = removalTargets(this.__cmcsUrl, body);
      if (targets) {
        this.addEventListener('loadend', () => {
          if (this.status >= 200 && this.status < 400) reportRemoval(targets);
        });
      }
    } catch {
      // Never let observing get in the site's way.
    }
    return xhrSend.call(this, body);
  };
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    inspect(url, init && init.body);
    const result = nativeFetch(input, init);
    try {
      const targets = removalTargets(url, init && init.body);
      if (targets) result.then((res) => res.ok && reportRemoval(targets), () => {});
    } catch {
      // Never let observing get in the site's way.
    }
    return result;
  };

  // --- Requests on behalf of the content script ----------------------------------

  async function handle(port, msg) {
    if (!msg || msg.__cmcs !== 'request' || typeof msg.id !== 'string') return;
    const reply = (payload) => port.postMessage({ __cmcs: 'response', id: msg.id, ...payload });
    if (msg.ping) {
      reply({ pong: true });
      return;
    }
    if (msg.getToken) {
      reply({ token: siteToken });
      return;
    }

    let url;
    try {
      url = new URL(msg.url, ORIGIN);
    } catch {
      reply({ error: 'bad url' });
      return;
    }
    // Only ever talk to the site itself.
    if (url.origin !== ORIGIN) {
      reply({ error: 'cross-origin request refused' });
      return;
    }

    try {
      const method = String(msg.method || 'GET').toUpperCase();
      const res = await nativeFetch(url.toString(), {
        method,
        headers: msg.headers || {},
        body: method === 'GET' ? undefined : msg.body,
        credentials: 'include',
      });
      const headers = {};
      for (const name of HEADERS) {
        const value = res.headers.get(name);
        if (value != null) headers[name] = value;
      }
      reply({ status: res.status, ok: res.ok, url: res.url, text: await res.text(), headers });
    } catch (err) {
      reply({ error: String((err && err.message) || err) });
    }
  }

  // The hello: listened for in the capture phase by the first listener on the
  // page, and stopped there.
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window || event.origin !== ORIGIN) return;
      const msg = event.data;
      if (!msg || msg.__cmcs !== 'hello' || !event.ports || !event.ports[0]) return;
      event.stopImmediatePropagation();
      const port = event.ports[0];
      ports.add(port);
      port.onmessage = (e) => handle(port, e.data);
      port.postMessage({ __cmcs: 'ready' });
    },
    true,
  );
})();

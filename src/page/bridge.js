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
 * Protocol (window.postMessage, same origin only):
 *   → { __cmcs: 'request', id, ping? | getToken? | url, method, headers, body }
 *   ← { __cmcs: 'response', id, pong? | token? | status, ok, url, text, headers | error }
 */
(function () {
  'use strict';

  if (window.__cmcsBridge) return;
  window.__cmcsBridge = true;

  const ORIGIN = location.origin;
  // Keep the browser's own fetch, in case the site wraps window.fetch later.
  const nativeFetch = window.fetch.bind(window);
  const HEADERS = ['content-type', 'retry-after', 'cf-mitigated'];
  const HEX_TOKEN = /^[0-9a-f]{32,}$/i;

  let siteToken = null;

  // --- Token from the site's own requests --------------------------------------

  /** "action***token" hidden in an `args` value; the XOR seed differs per action. */
  function tokenFromArgs(rawArgs) {
    const encoded = String(rawArgs);
    const cut = encoded.search(/%2A%2A%2A|\*\*\*/i);
    const head = cut === -1 ? encoded : encoded.slice(0, cut);
    let bytes;
    try {
      bytes = head.replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    } catch {
      return null;
    }
    for (let seed = 0; seed < 256; seed += 1) {
      let plain = '';
      for (let i = 0; i < bytes.length; i += 1) {
        plain += String.fromCharCode((bytes.charCodeAt(i) ^ ((seed + i) & 0xff)) & 0xff);
      }
      const match = plain.match(/^[A-Za-z0-9_]+\*\*\*([0-9a-f]{32,})$/i);
      if (match) return match[1];
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

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__cmcsUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    inspect(this.__cmcsUrl, body);
    return xhrSend.call(this, body);
  };
  window.fetch = function (input, init) {
    inspect(typeof input === 'string' ? input : input && input.url, init && init.body);
    return nativeFetch(input, init);
  };

  // --- Requests on behalf of the content script ----------------------------------

  const reply = (id, payload) => window.postMessage({ __cmcs: 'response', id, ...payload }, ORIGIN);

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || msg.__cmcs !== 'request' || typeof msg.id !== 'string') return;
    if (msg.ping) {
      reply(msg.id, { pong: true });
      return;
    }
    if (msg.getToken) {
      reply(msg.id, { token: siteToken });
      return;
    }

    let url;
    try {
      url = new URL(msg.url, ORIGIN);
    } catch {
      reply(msg.id, { error: 'bad url' });
      return;
    }
    // Only ever talk to the site itself.
    if (url.origin !== ORIGIN) {
      reply(msg.id, { error: 'cross-origin request refused' });
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
      reply(msg.id, { status: res.status, ok: res.ok, url: res.url, text: await res.text(), headers });
    } catch (err) {
      reply(msg.id, { error: String((err && err.message) || err) });
    }
  });
})();

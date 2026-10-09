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

  // --- The site's own cart removals ------------------------------------------------

  const REMOVAL_ACTION = /\/(?:AjaxAction|PostGetAction)\/(ShoppingCart_[A-Za-z_]*(?:Remove|Delete|Empty|Clear)[A-Za-z_]*)/i;

  function bodyText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof FormData) return new URLSearchParams([...body.entries()].filter(([, v]) => typeof v === 'string')).toString();
    return '';
  }

  /** Article and seller ids in a removal request: idArticle=1, idArticle={"1":"1"}, idArticle[1]=…, amount-1=… */
  function removalTargets(url, body) {
    const match = String(url || '').match(REMOVAL_ACTION);
    if (!match) return null;
    const articleIds = new Set();
    const sellerIds = new Set();
    const params = new URLSearchParams(bodyText(body));
    const query = String(url).split('?')[1];
    if (query) new URLSearchParams(query).forEach((value, key) => params.append(key, value));
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
    return { action: match[1], articleIds: [...articleIds], sellerIds: [...sellerIds] };
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

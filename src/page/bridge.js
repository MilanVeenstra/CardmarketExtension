/*
 * Runs in the page's own JavaScript context ("MAIN" world) on
 * www.cardmarket.com. It has no extension APIs; its only job is to perform a
 * same-origin request on behalf of the content script, so the request leaves
 * from the page exactly like the site's own buttons do. Cardmarket does not
 * always answer requests made from an extension's isolated world the same way
 * (other Cardmarket tools found the same), which showed up as "you are not
 * logged in" while the user was.
 *
 * Protocol (window.postMessage, same origin only):
 *   → { __cmcs: 'request', id, ping? | url, method, headers, body }
 *   ← { __cmcs: 'response', id, pong? | status, ok, url, text, headers | error }
 */
(function () {
  'use strict';

  if (window.__cmcsBridge) return;
  window.__cmcsBridge = true;

  const ORIGIN = location.origin;
  // Keep the browser's own fetch, in case the site wraps window.fetch later.
  const nativeFetch = window.fetch.bind(window);
  const HEADERS = ['content-type', 'retry-after', 'cf-mitigated'];

  const reply = (id, payload) => window.postMessage({ __cmcs: 'response', id, ...payload }, ORIGIN);

  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== ORIGIN) return;
    const msg = event.data;
    if (!msg || msg.__cmcs !== 'request' || typeof msg.id !== 'string') return;
    if (msg.ping) {
      reply(msg.id, { pong: true });
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

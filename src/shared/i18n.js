/* Tiny wrapper around chrome.i18n so UI code can stay short. */
(function (root) {
  'use strict';

  const CMCS = (root.CMCS = root.CMCS || {});

  /** Translate `key`; substitutions fill $1, $2, … in messages.json. */
  CMCS.t = function t(key, ...subs) {
    const text = root.chrome.i18n.getMessage(key, subs.map(String));
    return text || key;
  };

  /**
   * A text that depends on a number: `<key>One` for exactly 1 ("1 artikel"),
   * `<key>` otherwise ("3 artikelen"). chrome.i18n has no plurals of its own.
   */
  CMCS.tn = function tn(key, count, ...subs) {
    return CMCS.t(Number(count) === 1 ? `${key}One` : key, ...subs);
  };

  /** Fill every [data-i18n] / [data-i18n-title] / [data-i18n-label] element under `scope`. */
  CMCS.localize = function localize(scope) {
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = CMCS.t(el.dataset.i18n);
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = CMCS.t(el.dataset.i18nTitle);
      el.setAttribute('aria-label', el.title);
    });
    scope.querySelectorAll('[data-i18n-label]').forEach((el) => {
      el.setAttribute('aria-label', CMCS.t(el.dataset.i18nLabel));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = CMCS.t(el.dataset.i18nPlaceholder);
    });
  };
})(globalThis);

// Translations - i18n/strings.json is the single source of truth (bundled here
// as i18n-data.js by scripts/gen_web_data.py; local file, no network).
import { I18N } from './i18n-data.js';

export function defaultLang() {
  for (const [code, meta] of Object.entries(I18N.languages)) if (meta.default) return code;
  return Object.keys(I18N.languages)[0];
}

// ?lang= keeps the choice in the URL: shareable, no cookies, no storage.
export function currentLang() {
  if (typeof location === 'undefined') return defaultLang(); // node (tests)
  const q = new URLSearchParams(location.search).get('lang');
  return q && I18N.languages[q] ? q : defaultLang();
}

export function t(key, params = {}, lang = currentLang()) {
  const entry = I18N.strings[key];
  if (!entry) return key;
  const template = entry[lang] || entry[defaultLang()];
  if (template == null) return key;
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    params[name] !== undefined ? String(params[name]) : m);
}

// Fill [data-i18n] elements, set <html lang dir>, render the top selector.
export function applyI18n(doc = document) {
  const lang = currentLang();
  const meta = I18N.languages[lang];
  doc.documentElement.lang = lang;
  doc.documentElement.dir = meta.dir;
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (el.hasAttribute('data-i18n-alt')) el.setAttribute('alt', t(key, {}, lang));
    else el.textContent = t(key, {}, lang);
  }
  for (const el of doc.querySelectorAll('[data-i18n-title]')) {
    doc.title = t(el.getAttribute('data-i18n-title'), {}, lang);
  }
  const nav = doc.getElementById('langSwitch');
  if (nav) {
    nav.replaceChildren();
    const parts = [];
    for (const [code, m] of Object.entries(I18N.languages)) {
      if (code === lang) { const b = doc.createElement('b'); b.textContent = m.name; parts.push(b); }
      else { const a = doc.createElement('a'); a.href = `?lang=${code}`; a.textContent = m.name; parts.push(a); }
    }
    parts.forEach((el, i) => { if (i) nav.append(' · '); nav.appendChild(el); });
    nav.style.cssText = 'text-align:center;padding:.4rem;font-size:.9rem;background:#eef2f7;';
  }
}

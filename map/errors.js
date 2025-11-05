// /map/errors.js — единые обработчики ошибок + CSP (модуль)
import { toast as coreToast } from './assets/js/core.js';

// Безопасная обёртка: если coreToast ещё не готов — используем fallback
function safeToast(msg, ms = 4000) {
  try {
    (coreToast || window.__tt_fallback_toast)(msg, ms);
  } catch {
    window.__tt_fallback_toast(msg, ms);
  }
}

// Простейший fallback-тост
window.__tt_fallback_toast = window.__tt_fallback_toast || ((html, ms = 4000) => {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = html;
  el.style.display = 'block';
  clearTimeout(el._t);
  el._t = setTimeout(() => (el.style.display = 'none'), ms);
});

const ymapsHintCache = new Set();

function normalizeMsg(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (input instanceof Error && input.message) return input.message;
  if (typeof input.message === 'string') return input.message;
  if (typeof input.reason === 'string') return input.reason;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

function detectYmapsIssue(raw) {
  const text = normalizeMsg(raw);
  if (!text) return null;

  const lower = text.toLowerCase();
  if (!lower.includes('ymaps')) return null;

  const bundleMatch = text.match(/Failed to bundle\s+"([^"]+)"/i);
  if (bundleMatch) {
    return `Yandex API: модуль "${bundleMatch[1]}" не собран — проверь параметр load (например, package.standard) или переключись на режим v3.`;
  }

  const storageMatch = text.match(/modules\.storage\.(?:get|remove):\s+Module\s+"([^"]+)"\s+is\s+not\s+in\s+storage/i);
  if (storageMatch) {
    return `Yandex API: модуль "${storageMatch[1]}" не загружен — добавь его в &load=… или отключи лишние пакеты.`;
  }

  if (lower.includes('blocked by content security policy')) {
    return 'Yandex API заблокирован CSP — добавь api-maps.yandex.ru в script-src/script-src-elem.';
  }

  if (lower.includes('ymaps is not defined') || lower.includes('cannot read properties of undefined (reading "ready")')) {
    return 'Yandex API не инициализировался — проверь ключ и последовательность подключения скриптов.';
  }

  return null;
}

function showYmapsHint(raw, fallback) {
  const hint = detectYmapsIssue(raw) || fallback;
  if (!hint) return;
  if (ymapsHintCache.has(hint)) return;
  ymapsHintCache.add(hint);
  safeToast(hint, 6000);
}

// JS runtime errors
window.addEventListener('error', (e) => {
  const msg = e.message || 'unknown';
  showYmapsHint(e.error || e.message, null);
  safeToast('JS error: ' + msg);
  console.log('[TT error]', e);
});

// Unhandled Promise rejections
window.addEventListener('unhandledrejection', (e) => {
  const msg = e?.reason?.message || e?.reason || 'unhandled rejection';
  showYmapsHint(e.reason, null);
  safeToast('Promise error: ' + msg);
  console.log('[TT unhandled]', e?.reason || e);
});

// CSP violations (не спамим report-only по style-src)
document.addEventListener('securitypolicyviolation', (e) => {
  const vd = String(e.violatedDirective || '');
  const info = `CSP: ${vd}\n${e.blockedURI || '(no URI)'}\nsource: ${e.sourceFile || 'n/a'}:${e.lineNumber || 0}`;
  const isStyleReportOnly = vd.includes('style-src') && e.disposition === 'report';
  if (!isStyleReportOnly) {
    safeToast(info, 6000);
    if (vd.includes('script-src')) {
      showYmapsHint(null, 'Yandex API заблокирован CSP — добавь api-maps.yandex.ru в script-src/script-src-elem.');
    }
  }
  console.log('[TT CSP]', e);
});

// Перехват console.error для обнаружения тихих ошибок Yandex API
if (!console.__ttPatched) {
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    try {
      args.forEach((arg) => showYmapsHint(arg, null));
    } catch (err) {
      originalError('TT console.error patch failed', err);
    }
    return originalError(...args);
  };
  Object.defineProperty(console, '__ttPatched', { value: true, configurable: false, enumerable: false, writable: false });
}

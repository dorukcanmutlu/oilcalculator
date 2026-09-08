/* Tarayıcı için yazılmış dosyaları Node'da çalıştırmak için küçük ortam. */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Her çağrıda temiz bir uygulama ortamı (boş localStorage) kurar. */
export function makeEnv() {
  const mem = new Map();
  const localStorage = {
    getItem: k => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k),
    clear: () => mem.clear()
  };
  const noop = () => {};
  const element = { innerHTML: '', appendChild: noop, addEventListener: noop, setAttribute: noop, style: {} };
  const ctx = vm.createContext({
    console, Intl, Date, Math, JSON, Number, String, Boolean, Array, Object, Set, Map,
    RegExp, Error, isFinite, parseFloat, parseInt, TextEncoder, TextDecoder,
    DataView, Uint8Array, Uint32Array, ArrayBuffer, Blob, Response, Promise,
    localStorage,
    window: {},
    document: { createElement: () => ({ ...element }), head: element, querySelector: () => null }
  });
  ctx.globalThis = ctx;

  for (const file of ['js/util.js', 'js/store.js', 'js/importer.js', 'js/xlsx-write.js', 'js/receipt.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
  }
  return {
    U: vm.runInContext('U', ctx),
    Store: vm.runInContext('Store', ctx),
    Importer: vm.runInContext('Importer', ctx),
    XlsxWrite: vm.runInContext('XlsxWrite', ctx),
    Receipt: vm.runInContext('Receipt', ctx),
    mem
  };
}

/** Kullanıcının Excel'inden ilk beş satır — elle doğrulanabilir sayılar. */
export const FIXTURE = [
  { date: '2026-01-07', odo: 283420, liters: 37.5, unitPrice: 56, total: 2100 },
  { date: '2026-01-23', odo: 284169, liters: 8.56, unitPrice: 58.41, total: 500 },
  { date: '2026-01-28', odo: 284430, liters: 17.1, unitPrice: 58.48, total: 1000 },
  { date: '2026-01-31', odo: 284632, liters: 34.19, unitPrice: 58.49, total: 2000 },
  { date: '2026-02-15', odo: 285383, liters: 42.43, unitPrice: 58.93, total: 2500.4 }
];

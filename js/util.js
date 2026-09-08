/* Ortak yardımcılar: biçimlendirme ve ayrıştırma */
const U = (() => {
  const nf = (min, max) => new Intl.NumberFormat('tr-TR', { minimumFractionDigits: min, maximumFractionDigits: max });
  const n0 = nf(0, 0), n1 = nf(1, 1), n2 = nf(2, 2);

  const money = v => (v == null || !isFinite(v)) ? '—' : '₺' + n2.format(v);
  const moneyShort = v => {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) >= 1000) return '₺' + n0.format(Math.round(v));
    return '₺' + n0.format(v);
  };
  const liters = v => (v == null || !isFinite(v)) ? '—' : n2.format(v) + ' L';
  const km = v => (v == null || !isFinite(v)) ? '—' : n0.format(Math.round(v)) + ' km';
  const num = (v, d = 2) => (v == null || !isFinite(v)) ? '—' : nf(d, d).format(v);

  const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

  /** 'YYYY-MM-DD' -> '12 Şub 2025' */
  const dateLabel = iso => {
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return iso || '';
    return `${d} ${MONTHS[m - 1]} ${y}`;
  };
  /** 'YYYY-MM' -> 'Şub 25' */
  const monthLabel = ym => {
    const [y, m] = String(ym).split('-').map(Number);
    return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  /**
   * Türkçe/İngilizce sayı biçimlerini çözer: "1.234,56", "1,234.56", "45,7", "₺ 1.200".
   */
  function parseNumber(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return isFinite(raw) ? raw : null;
    let s = String(raw).trim().replace(/[₺$€\s ]/g, '').replace(/(TL|TRY|LT|L)$/i, '');
    if (!s) return null;
    const hasComma = s.includes(','), hasDot = s.includes('.');
    if (hasComma && hasDot) {
      // son gelen ayraç ondalıktır
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (hasComma) {
      // "1,234" binlik mi ondalık mı? 3 hane + tek virgül ise binlik say
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    }
    const v = parseFloat(s);
    return isFinite(v) ? v : null;
  }

  /**
   * Tarihi ISO 'YYYY-MM-DD' biçimine çevirir.
   * Destek: Date nesnesi, Excel seri numarası, 12.02.2025, 12/02/2025, 2025-02-12.
   */
  function parseDate(raw) {
    if (raw == null || raw === '') return null;
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (raw instanceof Date && !isNaN(raw)) return iso(raw);
    if (typeof raw === 'number' && isFinite(raw)) {
      // Excel seri numarası (1900 tabanlı)
      if (raw > 20000 && raw < 60000) {
        const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
        return iso(new Date(d.getTime() + d.getTimezoneOffset() * 60000));
      }
      return null;
    }
    const s = String(raw).trim();
    let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = (Number(y) > 70 ? '19' : '20') + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const d2 = new Date(s);
    return isNaN(d2) ? null : iso(d2);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = sel => document.querySelector(sel);

  function download(filename, content, type) {
    const blob = content instanceof Blob
      ? content
      : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return { money, moneyShort, liters, km, num, n0, n1, n2, MONTHS, dateLabel, monthLabel, todayISO, parseNumber, parseDate, uid, esc, el, download };
})();

/* Veri katmanı: localStorage + istatistik hesapları */
const Store = (() => {
  const KEY = 'yakit-takip:v1';
  let records = [];

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records)) records = [];
    } catch (e) {
      console.warn('Kayıtlar okunamadı', e);
      records = [];
    }
    records = records.map(normalize).filter(r => r.date);
    sort();
    return records;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
      return true;
    } catch (e) {
      console.error('Kayıt yazılamadı', e);
      return false;
    }
  }

  function normalize(r) {
    const liters = num(r.liters), price = num(r.unitPrice), total = num(r.total);
    const out = {
      id: r.id || U.uid(),
      date: U.parseDate(r.date),
      odo: num(r.odo),
      liters, unitPrice: price, total,
      fuel: r.fuel || 'Motorin',
      station: (r.station || '').trim(),
      full: r.full !== false,
      note: (r.note || '').trim()
    };
    return complete(out);
  }

  /** Litre / birim fiyat / tutar üçlüsünde eksik olanı tamamlar. */
  function complete(r) {
    const { liters, unitPrice, total } = r;
    if (total == null && liters != null && unitPrice != null) r.total = round(liters * unitPrice, 2);
    else if (unitPrice == null && liters && total != null) r.unitPrice = round(total / liters, 3);
    else if (liters == null && unitPrice && total != null) r.liters = round(total / unitPrice, 2);
    return r;
  }

  const num = v => { const n = U.parseNumber(v); return n == null ? null : n; };
  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
  const sort = () => records.sort((a, b) => a.date === b.date ? (a.odo || 0) - (b.odo || 0) : a.date < b.date ? -1 : 1);

  /* ---- CRUD ---- */
  const all = () => records.slice();

  function upsert(rec) {
    const r = normalize(rec);
    const i = records.findIndex(x => x.id === r.id);
    if (i >= 0) records[i] = r; else records.push(r);
    sort(); save();
    return r;
  }
  function remove(id) {
    records = records.filter(r => r.id !== id);
    save();
  }
  function replaceAll(list) {
    records = list.map(normalize).filter(r => r.date);
    sort(); save();
  }
  function addMany(list) {
    const added = list.map(normalize).filter(r => r.date);
    records = records.concat(added);
    sort(); save();
    return added.length;
  }
  function clear() { records = []; save(); }

  const stations = () => [...new Set(records.map(r => r.station).filter(Boolean))].sort();

  /* ---- Filtreleme ---- */
  function filter(range) {
    if (!range || range === 'all') return all();
    const now = new Date();
    let from;
    if (range === 'ytd') from = `${now.getFullYear()}-01-01`;
    else {
      const d = new Date(now.getFullYear(), now.getMonth() - (Number(range) - 1), 1);
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return records.filter(r => r.date >= from);
  }

  /* ---- Tüketim: iki tam depo arası ---- */
  function consumptionSegments(list) {
    const segs = [];
    const withOdo = list.filter(r => r.odo != null && r.liters != null).slice()
      .sort((a, b) => a.odo - b.odo);
    let prevFull = null, pending = 0;
    for (const r of withOdo) {
      if (prevFull) pending += r.liters;
      if (r.full) {
        if (prevFull) {
          const dist = r.odo - prevFull.odo;
          if (dist > 0 && pending > 0 && dist < 5000) {
            segs.push({
              date: r.date, from: prevFull.odo, to: r.odo,
              distance: dist, liters: pending,
              lPer100: round(pending / dist * 100, 2)
            });
          }
        }
        prevFull = r; pending = 0;
      }
    }
    return segs;
  }

  /**
   * Kümülatif tüketim: ilk kayıttan itibaren toplam litre / gidilen km.
   * (Excel'deki SUM(C2:C_onceki)/(B_i-B_2)*100 formülünün karşılığı.)
   */
  function cumulativeConsumption(list) {
    const rows = list.filter(r => r.odo != null && r.liters != null).slice()
      .sort((a, b) => a.odo - b.odo);
    if (rows.length < 2) return [];
    const startOdo = rows[0].odo;
    let liters = 0;
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      liters += rows[i - 1].liters;
      const dist = rows[i].odo - startOdo;
      if (dist > 0) out.push({ date: rows[i].date, value: round(liters / dist * 100, 2) });
    }
    return out;
  }

  /* ---- Özet istatistikler ---- */
  function stats(list) {
    const spend = sum(list.map(r => r.total));
    const lt = sum(list.map(r => r.liters));
    const segs = consumptionSegments(list);
    const segDist = sum(segs.map(s => s.distance));
    const segLiters = sum(segs.map(s => s.liters));
    const odos = list.map(r => r.odo).filter(v => v != null);
    const months = new Set(list.map(r => r.date.slice(0, 7))).size || 0;
    const avgPrice = lt > 0 ? spend / lt : null;
    const lPer100 = segDist > 0 ? segLiters / segDist * 100 : null;
    return {
      count: list.length,
      spend, liters: lt, months,
      avgPrice,
      monthlySpend: months ? spend / months : null,
      distance: odos.length > 1 ? Math.max(...odos) - Math.min(...odos) : null,
      segDistance: segDist || null,
      lPer100,
      costPerKm: (lPer100 != null && avgPrice != null) ? lPer100 / 100 * avgPrice : null,
      lastPrice: [...list].reverse().find(r => r.unitPrice != null)?.unitPrice ?? null,
      segments: segs
    };
  }

  const sum = arr => arr.reduce((a, v) => a + (isFinite(v) ? v : 0), 0);

  /** Aylık toplamlar: [{ym, spend, liters, count}] (boş aylar dahil, kronolojik) */
  function byMonth(list) {
    if (!list.length) return [];
    const map = new Map();
    for (const r of list) {
      const ym = r.date.slice(0, 7);
      const m = map.get(ym) || { ym, spend: 0, liters: 0, count: 0 };
      m.spend += r.total || 0; m.liters += r.liters || 0; m.count++;
      map.set(ym, m);
    }
    const keys = [...map.keys()].sort();
    const out = [];
    let [y, mo] = keys[0].split('-').map(Number);
    const [ey, em] = keys[keys.length - 1].split('-').map(Number);
    while (y < ey || (y === ey && mo <= em)) {
      const ym = `${y}-${String(mo).padStart(2, '0')}`;
      out.push(map.get(ym) || { ym, spend: 0, liters: 0, count: 0 });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    return out;
  }

  /** İstasyon bazında harcama, azalan */
  function byStation(list) {
    const map = new Map();
    for (const r of list) {
      const k = r.station || 'Belirtilmemiş';
      map.set(k, (map.get(k) || 0) + (r.total || 0));
    }
    return [...map.entries()].map(([name, spend]) => ({ name, spend }))
      .sort((a, b) => b.spend - a.spend);
  }

  return { load, all, filter, upsert, remove, replaceAll, addMany, clear, stations, stats, byMonth, byStation, consumptionSegments, cumulativeConsumption, normalize };
})();

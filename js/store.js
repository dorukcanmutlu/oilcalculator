/* Veri katmanı: localStorage + istatistik hesapları */
const Store = (() => {
  const KEY = 'yakit-takip:v1';
  let records = [];

  const META_KEY = 'yakit-takip:meta';

  /** Yedek zamanı gibi küçük ayarlar */
  function meta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setMeta(patch) {
    const next = { ...meta(), ...patch };
    try { localStorage.setItem(META_KEY, JSON.stringify(next)); } catch (e) { /* yoksay */ }
    return next;
  }

  const VEHICLE_KEY = 'yakit-takip:vehicles';
  let vehicleList = [];
  let activeId = null;

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      records = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(records)) records = [];
    } catch (e) {
      console.warn('Kayıtlar okunamadı', e);
      records = [];
    }
    try {
      vehicleList = JSON.parse(localStorage.getItem(VEHICLE_KEY)) || [];
      if (!Array.isArray(vehicleList)) vehicleList = [];
    } catch (e) { vehicleList = []; }

    records = records.map(normalize).filter(r => r.date);
    sort();
    migrateVehicles();
    activeId = vehicleList.some(v => v.id === meta().activeVehicle)
      ? meta().activeVehicle
      : (vehicleList[0]?.id || null);
    return all();
  }

  /** Araçsız kurulumdan çoklu araca geçiş: mevcut kayıtlar varsayılan araca bağlanır. */
  function migrateVehicles() {
    const orphan = records.some(r => !r.vehicleId);
    if (!vehicleList.length && (records.length || orphan)) {
      vehicleList = [{ id: U.uid(), name: 'Aracım', plate: '', tankSize: null, fuel: records[0]?.fuel || 'Motorin' }];
      saveVehicles();
    }
    if (orphan && vehicleList.length) {
      const id = vehicleList[0].id;
      records = records.map(r => (r.vehicleId ? r : { ...r, vehicleId: id }));
      save();
    }
  }

  /** Kayıt eklenirken hiç araç yoksa varsayılanı oluşturur. */
  function ensureVehicle(fuel) {
    if (vehicleList.length) {
      if (!activeId) setActive(vehicleList[0].id);
      return activeVehicle();
    }
    const v = { id: U.uid(), name: 'Aracım', plate: '', tankSize: null, fuel: fuel || 'Motorin' };
    vehicleList.push(v);
    saveVehicles();
    setActive(v.id);
    return v;
  }

  function saveVehicles() {
    try { localStorage.setItem(VEHICLE_KEY, JSON.stringify(vehicleList)); }
    catch (e) { console.error('Araçlar yazılamadı', e); }
  }

  /* ---- Araçlar ---- */
  const vehicles = () => vehicleList.slice();
  const activeVehicle = () => vehicleList.find(v => v.id === activeId) || null;

  function setActive(id) {
    if (!vehicleList.some(v => v.id === id)) return null;
    activeId = id;
    setMeta({ activeVehicle: id });
    return activeVehicle();
  }

  function saveVehicle(v) {
    const rec = {
      id: v.id || U.uid(),
      name: (v.name || '').trim() || 'Araç',
      plate: (v.plate || '').trim(),
      tankSize: U.parseNumber(v.tankSize),
      fuel: v.fuel || 'Motorin'
    };
    const i = vehicleList.findIndex(x => x.id === rec.id);
    if (i >= 0) vehicleList[i] = rec; else vehicleList.push(rec);
    saveVehicles();
    if (!activeId) setActive(rec.id);
    return rec;
  }

  /** Aracı ve ona bağlı kayıtları siler. */
  function removeVehicle(id) {
    vehicleList = vehicleList.filter(v => v.id !== id);
    records = records.filter(r => r.vehicleId !== id);
    saveVehicles(); save();
    if (activeId === id) setActive(vehicleList[0]?.id || null);
    return vehicleList.length;
  }

  const recordCount = id => records.filter(r => r.vehicleId === id).length;

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
      vehicleId: r.vehicleId || activeId || null,
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
  /** Aktif aracın kayıtları */
  const all = () => (activeId ? records.filter(r => r.vehicleId === activeId) : records.slice());
  /** Tüm araçların kayıtları (yedekleme/dışa aktarma için) */
  const allRecords = () => records.slice();

  function upsert(rec) {
    ensureVehicle(rec.fuel);
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
  /** Aktif aracın kayıtlarının yerine geçer (diğer araçlara dokunmaz) */
  function replaceAll(list) {
    ensureVehicle(list[0]?.fuel);
    const others = activeId ? records.filter(r => r.vehicleId !== activeId) : [];
    records = others.concat(list.map(normalize).filter(r => r.date));
    sort(); save();
  }
  function addMany(list) {
    ensureVehicle(list[0]?.fuel);
    const added = list.map(normalize).filter(r => r.date);
    records = records.concat(added);
    sort(); save();
    return added.length;
  }
  /** Aktif aracın kayıtlarını siler */
  function clear() {
    records = activeId ? records.filter(r => r.vehicleId !== activeId) : [];
    save();
  }

  const stationsList = () => [...new Set(all().map(r => r.station).filter(Boolean))].sort();

  /** Tüm araçlar ve kayıtlarıyla tam yedek */
  const exportAll = () => ({
    version: 2,
    exportedAt: new Date().toISOString(),
    vehicles: vehicleList,
    records
  });

  /** Yedekten geri yükleme: hem eski dizi biçimini hem v2 nesnesini kabul eder. */
  function importAll(data) {
    if (Array.isArray(data)) {                    // v1: sadece kayıt dizisi
      vehicleList = vehicleList.length ? vehicleList
        : [{ id: U.uid(), name: 'Aracım', plate: '', tankSize: null, fuel: 'Motorin' }];
      activeId = activeId || vehicleList[0].id;
      records = data.map(r => normalize({ ...r, vehicleId: r.vehicleId || activeId })).filter(r => r.date);
    } else if (data && Array.isArray(data.records)) {
      vehicleList = Array.isArray(data.vehicles) && data.vehicles.length
        ? data.vehicles
        : [{ id: U.uid(), name: 'Aracım', plate: '', tankSize: null, fuel: 'Motorin' }];
      activeId = vehicleList[0].id;
      records = data.records.map(r => normalize({ ...r, vehicleId: r.vehicleId || activeId })).filter(r => r.date);
    } else {
      throw new Error('Yedek dosyası tanınmadı');
    }
    sort(); save(); saveVehicles(); setMeta({ activeVehicle: activeId });
    return records.length;
  }

  /* ---- Filtreleme ---- */
  function filter(range) {
    if (!range || range === 'all') return all();
    const mine = all();                        // her zaman aktif aracın kayıtları
    if (typeof range === 'object') {           // { from, to } özel aralık
      const from = range.from || '0000-01-01';
      const to = range.to || '9999-12-31';
      return mine.filter(r => r.date >= from && r.date <= to);
    }
    const now = new Date();
    let from;
    if (range === 'ytd') from = `${now.getFullYear()}-01-01`;
    else {
      const d = new Date(now.getFullYear(), now.getMonth() - (Number(range) - 1), 1);
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    }
    return mine.filter(r => r.date >= from);
  }

  /** Kayıtlarda kullanılan yakıt türleri */
  const fuels = () => [...new Set(all().map(r => r.fuel).filter(Boolean))].sort();

  /** Belirli bir tarihten önceki son kilometre kaydı */
  function lastOdoBefore(date, excludeId) {
    const rows = all().filter(r => r.odo != null && r.id !== excludeId && (!date || r.date <= date));
    return rows.length ? rows[rows.length - 1] : null;
  }

  /* ---- Doğrulama ---- */

  const median = arr => {
    const v = arr.filter(x => x != null && isFinite(x)).slice().sort((a, b) => a - b);
    if (!v.length) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };

  /**
   * Bir kaydın olası giriş hatalarını bulur. Kaydı engellemez, uyarı döndürür:
   * geriye giden kilometre, günlük mesafe sıçraması, aynı güne ikinci kayıt,
   * tutar/litre/fiyat tutarsızlığı, fiyat sapması, mantıksız tüketim,
   * depo hacmini aşan litre.
   */
  function validate(rec, { tankSize } = {}) {
    const r = normalize(rec);
    const others = all().filter(x => x.id !== r.id);
    const out = [];
    if (!r.date) return [{ text: 'Tarih okunamadı' }];
    if (r.date > U.todayISO()) out.push({ text: 'Tarih ileri bir günde' });
    if (others.some(x => x.date === r.date)) out.push({ text: 'Bu tarihte başka bir kayıt var' });

    const prev = [...others].reverse().find(x => x.odo != null && x.date <= r.date);
    if (r.odo != null && prev) {
      const diff = r.odo - prev.odo;
      const days = Math.max(1, Math.round((new Date(r.date) - new Date(prev.date)) / 86400000));
      if (diff < 0) {
        out.push({ text: `Kilometre geriye gidiyor: son kayıt ${U.n0.format(prev.odo)} km` });
      } else if (diff / days > 1500) {
        out.push({ text: `Günde ${U.n0.format(Math.round(diff / days))} km — kilometre yanlış girilmiş olabilir` });
      } else if (diff === 0) {
        out.push({ text: 'Kilometre bir önceki kayıtla aynı' });
      }
      if (diff > 0 && r.liters > 0 && r.full) {
        const l100 = r.liters / diff * 100;
        if (l100 > 30 || l100 < 2) {
          out.push({ text: `Bu kayıt ${U.n1.format(l100)} L/100km tüketim veriyor — litre ya da kilometre hatalı olabilir` });
        }
      }
    }

    if (r.total != null && r.liters != null && r.unitPrice != null && r.total > 0) {
      const fark = Math.abs(r.liters * r.unitPrice - r.total) / r.total;
      if (fark > 0.02) out.push({ text: 'Tutar, litre × birim fiyat ile uyuşmuyor' });
    }

    // Kıyas, bu kayıttan hemen önceki fiyat olmalı; en son fiyatla kıyaslamak
    // 9 ay önceki kayıtları da "sapmış" gösterir.
    const prevPriced = others.filter(x => x.unitPrice != null && x.date <= r.date).pop();
    const lastPrice = prevPriced?.unitPrice;
    if (r.unitPrice != null && lastPrice) {
      const sapma = (r.unitPrice - lastPrice) / lastPrice;
      if (Math.abs(sapma) > 0.25) {
        out.push({ text: `Birim fiyat bir önceki kayda göre %${U.n0.format(Math.abs(sapma) * 100)} ${sapma > 0 ? 'yüksek' : 'düşük'} (${U.dateLabel(prevPriced.date)}: ₺${U.n2.format(lastPrice)}/L)` });
      }
    }

    if (tankSize && r.liters != null && r.liters > tankSize * 1.05) {
      out.push({ text: `Litre depo hacmini (${U.n0.format(tankSize)} L) aşıyor` });
    }
    return out;
  }

  /** Mevcut kayıtlar içinde uyarı üreten olanlar */
  function anomalies(list, opts) {
    return list.map(r => ({ rec: r, issues: validate(r, opts) }))
      .filter(x => x.issues.length);
  }

  /**
   * Litresi medyanın %60'ından az olan dolumlar büyük olasılıkla kısmi;
   * Excel'den gelen kayıtlarda "tam depo" bilgisi olmadığı için öneri sunar.
   */
  function suggestPartial(list) {
    const med = median(list.map(r => r.liters));
    if (!med) return [];
    return list.filter(r => r.full && r.liters != null && r.liters < med * 0.6);
  }

  /** Seçili kayıtların tam/kısmi depo işaretini değiştirir */
  function setFull(ids, full) {
    const set = new Set(ids);
    let n = 0;
    records = records.map(r => (set.has(r.id) ? (n++, { ...r, full }) : r));
    save();
    return n;
  }

  /** Seçili kayıtları siler, silinenleri döndürür (geri alma için) */
  function removeMany(ids) {
    const set = new Set(ids);
    const removed = records.filter(r => set.has(r.id));
    records = records.filter(r => !set.has(r.id));
    save();
    return removed;
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

  /**
   * Aylık gidilen km: iki dolum arasındaki mesafe, aradaki günlere eşit
   * dağıtılarak aylara paylaştırılır (bir aralık iki aya taşabildiği için).
   */
  function monthlyDistance(list) {
    const rows = list.filter(r => r.odo != null).slice()
      .sort((a, b) => a.date === b.date ? a.odo - b.odo : a.date < b.date ? -1 : 1);
    const map = new Map();
    for (let i = 1; i < rows.length; i++) {
      const km = rows[i].odo - rows[i - 1].odo;
      if (!(km > 0)) continue;
      const start = new Date(rows[i - 1].date + 'T00:00:00');
      const days = Math.max(1, Math.round((new Date(rows[i].date + 'T00:00:00') - start) / 86400000));
      for (let d = 1; d <= days; d++) {
        const day = new Date(start.getTime() + d * 86400000);
        const ym = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}`;
        map.set(ym, (map.get(ym) || 0) + km / days);
      }
    }
    return map;
  }

  /**
   * Kayıtlardan türetilen analiz verileri: aylık mesafe ve 100 km maliyeti,
   * kümülatif harcama, fiyat artışının getirdiği ek maliyet ve yıllık tahmin.
   */
  function analysis(list) {
    const s = stats(list);
    const km = monthlyDistance(list);
    const perMonth = byMonth(list).map(m => {
      const avgPrice = m.liters > 0 ? m.spend / m.liters : null;
      return {
        ym: m.ym, spend: m.spend, liters: m.liters, count: m.count,
        km: Math.round(km.get(m.ym) || 0),
        avgPrice,
        // 100 km'nin maliyeti = (L/100km) × (₺/L)
        per100: (avgPrice != null && s.lPer100 != null) ? s.lPer100 * avgPrice : null
      };
    });

    // Kümülatif harcama
    let run = 0;
    const cumulativeSpend = list.map(r => ({ date: r.date, value: (run += (r.total || 0)) }));

    // Fiyat artışının faturası: her dolumda ilk birim fiyata göre ödenen fazla
    const priced = list.filter(r => r.unitPrice != null && r.liters != null);
    const basePrice = priced.length ? priced[0].unitPrice : null;
    let extra = 0;
    const priceEffect = priced.map(r => ({
      date: r.date,
      value: (extra += r.liters * (r.unitPrice - basePrice))
    }));
    const lastPrice = priced.length ? priced[priced.length - 1].unitPrice : null;

    // Mevcut hızla 12 aylık tahmin
    const days = list.length > 1
      ? Math.max(1, Math.round((new Date(list[list.length - 1].date) - new Date(list[0].date)) / 86400000))
      : 0;
    const perDay = days ? { spend: s.spend / days, km: (s.distance || 0) / days } : null;

    return {
      perMonth, cumulativeSpend, priceEffect,
      basePrice, lastPrice,
      priceChange: (basePrice && lastPrice) ? (lastPrice - basePrice) / basePrice : null,
      extraCost: extra,
      days, perDay,
      yearly: perDay ? { spend: perDay.spend * 365, km: perDay.km * 365 } : null,
      lPer100: s.lPer100
    };
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

  return { load, all, allRecords, ensureVehicle, vehicles, activeVehicle, setActive, saveVehicle, removeVehicle, recordCount, exportAll, importAll, filter, upsert, remove, removeMany, replaceAll, addMany, clear, meta, setMeta, validate, anomalies, suggestPartial, setFull, stations: stationsList, fuels, lastOdoBefore, stats, byMonth, byStation, consumptionSegments, cumulativeConsumption, monthlyDistance, analysis, normalize };
})();

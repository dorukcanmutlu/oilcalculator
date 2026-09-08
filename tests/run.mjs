/* Bağımlılıksız test koşucusu: node tests/run.mjs */
import { makeEnv, FIXTURE } from './env.mjs';

let passed = 0, failed = 0, current = '';
const fails = [];

function group(name, fn) {
  current = name;
  console.log(`\n${name}`);
  fn();
}
function ok(label, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++;
    fails.push(`${current} → ${label}${detail ? ` (${detail})` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}
const eq = (label, got, want) => ok(label, got === want, `beklenen ${want}, gelen ${got}`);
/** Ondalıklı karşılaştırma */
const near = (label, got, want, tol = 0.01) =>
  ok(label, got != null && Math.abs(got - want) <= tol, `beklenen ~${want}, gelen ${got}`);

/* ---------------- util ---------------- */
group('util: sayı ve tarih ayrıştırma', () => {
  const { U } = makeEnv();
  eq('1.234,56 (TR)', U.parseNumber('1.234,56'), 1234.56);
  eq('1,234.56 (EN)', U.parseNumber('1,234.56'), 1234.56);
  eq('45,7', U.parseNumber('45,7'), 45.7);
  eq('58.5', U.parseNumber('58.5'), 58.5);
  eq('simge ve binlik ayracı', U.parseNumber('₺ 1.200'), 1200);
  eq('1,200 binlik olarak', U.parseNumber('1,200'), 1200);
  eq('boş değer', U.parseNumber(''), null);
  eq('sayı olmayan', U.parseNumber('abc'), null);
  eq('sıfır korunur', U.parseNumber('0'), 0);

  eq('12.02.2025', U.parseDate('12.02.2025'), '2025-02-12');
  eq('3/4/25', U.parseDate('3/4/25'), '2025-04-03');
  eq('2025-2-3', U.parseDate('2025-2-3'), '2025-02-03');
  eq('Excel seri 46029', U.parseDate(46029), '2026-01-07');
  eq('geçersiz tarih', U.parseDate('yarın'), null);
  eq('para biçimi', U.money(1234.5), '₺1.234,50');
  eq('tarih etiketi', U.dateLabel('2026-02-12'), '12 Şub 2026');
  eq('ay etiketi', U.monthLabel('2026-02'), 'Şub 26');
});

/* ---------------- store: temel ---------------- */
group('store: kayıt tamamlama ve süzme', () => {
  const { Store } = makeEnv();
  Store.load();
  eq('tutar litre × fiyattan hesaplanır',
    Store.upsert({ date: '2026-03-01', liters: 40, unitPrice: 50 }).total, 2000);
  eq('litre tutardan hesaplanır',
    Store.upsert({ date: '2026-03-02', total: 2000, unitPrice: 50 }).liters, 40);
  eq('birim fiyat hesaplanır',
    Store.upsert({ date: '2026-03-03', total: 2000, liters: 40 }).unitPrice, 50);
  eq('kayıt sayısı', Store.all().length, 3);

  Store.clear();
  Store.addMany(FIXTURE);
  eq('içe aktarılan kayıt', Store.all().length, 5);
  eq('özel aralık süzgeci', Store.filter({ from: '2026-01-23', to: '2026-01-31' }).length, 3);
  eq('tümü', Store.filter('all').length, 5);
});

/* ---------------- store: tüketim ---------------- */
group('store: tüketim hesapları', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);
  const list = Store.filter('all');

  // Excel formülü: SUM(C2:C_önceki) / (B_i - B_2) * 100
  const cum = Store.cumulativeConsumption(list);
  eq('kümülatif nokta sayısı', cum.length, 4);
  near('ikinci dolumda kümülatif (37,5 L / 749 km)', cum[0].value, 5.01);
  near('son kümülatif', cum[3].value,
    (37.5 + 8.56 + 17.1 + 34.19) / (285383 - 283420) * 100, 0.02);

  // Hepsi tam depo sayılırsa her aralık bir segment olur
  const segs = Store.consumptionSegments(list);
  eq('segment sayısı (hepsi tam depo)', segs.length, 4);
  near('segment, sonraki dolumun litresini kullanır', segs[0].lPer100, 8.56 / 749 * 100, 0.02);

  // Kısmi işaretlenince yalnız tam depolar arası sayılır
  const partial = Store.suggestPartial(list);
  eq('kısmi dolum önerisi', partial.length, 2);            // 8,56 L ve 17,1 L
  Store.setFull(partial.map(p => p.id), false);
  const segs2 = Store.consumptionSegments(Store.filter('all'));
  eq('kısmi sonrası segment sayısı', segs2.length, 2);
  near('kısmi dolumlar aradaki litreye eklenir',
    segs2[0].lPer100, (8.56 + 17.1 + 34.19) / (284632 - 283420) * 100, 0.02);
});

/* ---------------- store: analiz ---------------- */
group('store: analiz', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);
  const list = Store.filter('all');
  const st = Store.stats(list);
  const a = Store.analysis(list);

  near('toplam harcama', st.spend, 2100 + 500 + 1000 + 2000 + 2500.4, 0.01);
  near('toplam litre', st.liters, 139.78, 0.01);
  eq('toplam mesafe', st.distance, 285383 - 283420);

  const kmTotal = a.perMonth.reduce((s, m) => s + m.km, 0);
  ok('aylık km toplamı gerçek mesafeye eşit', Math.abs(kmTotal - st.distance) <= 2,
    `${kmTotal} ≠ ${st.distance}`);

  near('100 km maliyeti = tüketim × ayın fiyatı',
    a.perMonth[0].per100, st.lPer100 * a.perMonth[0].avgPrice, 0.01);

  // Fiyat artışının faturası: Σ litre × (fiyat − ilk fiyat)
  const beklenen = FIXTURE.reduce((s, r) => s + r.liters * (r.unitPrice - 56), 0);
  near('fiyat artışının faturası', a.extraCost, beklenen, 0.01);
  near('günlük gider', a.perDay.spend, st.spend / a.days, 0.01);
  eq('gün sayısı', a.days, 39);
});

/* ---------------- store: doğrulama ---------------- */
group('store: giriş doğrulama', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);
  const texts = rec => Store.validate(rec).map(w => w.text).join(' | ');

  ok('geriye giden kilometre yakalanır',
    /geriye gidiyor/.test(texts({ date: '2026-03-01', odo: 100000, liters: 40, unitPrice: 59, total: 2360 })));
  ok('aynı güne ikinci kayıt yakalanır',
    /başka bir kayıt/.test(texts({ date: '2026-01-23', odo: 286000, liters: 40, unitPrice: 59, total: 2360 })));
  ok('tutarsız tutar yakalanır',
    /uyuşmuyor/.test(texts({ date: '2026-03-01', odo: 286000, liters: 40, unitPrice: 59, total: 5000 })));
  ok('fiyat sapması yakalanır',
    /Birim fiyat/.test(texts({ date: '2026-03-01', odo: 286000, liters: 40, unitPrice: 120, total: 4800 })));
  ok('mantıksız tüketim yakalanır',
    /L\/100km/.test(texts({ date: '2026-03-01', odo: 285400, liters: 40, unitPrice: 59, total: 2360 })));
  ok('ileri tarih yakalanır',
    /ileri bir günde/.test(texts({ date: '2099-01-01', odo: 286000, liters: 40, unitPrice: 59, total: 2360 })));
  ok('depo hacmi aşımı yakalanır',
    /depo hacmini/.test(Store.validate(
      { date: '2026-03-01', odo: 286000, liters: 80, unitPrice: 59, total: 4720 },
      { tankSize: 60 }).map(w => w.text).join(' ')));
  eq('temiz kayıtta uyarı yok',
    Store.validate({ date: '2026-03-01', odo: 286100, liters: 36, unitPrice: 59, total: 2124 }).length, 0);
});

/* ---------------- store: çoklu araç ---------------- */
group('store: çoklu araç yalıtımı', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);                       // varsayılan araç oluşur
  eq('varsayılan araç', Store.vehicles().length, 1);
  const car = Store.activeVehicle();
  eq('kayıtlar araca bağlandı', Store.recordCount(car.id), 5);

  const bike = Store.saveVehicle({ name: 'Motosiklet', tankSize: 15, fuel: 'Benzin' });
  Store.setActive(bike.id);
  eq('yeni araçta kayıt yok', Store.all().length, 0);
  eq('dönem süzgeci de araca göre', Store.filter('12').length, 0);
  Store.upsert({ date: '2026-03-01', odo: 12000, liters: 12, unitPrice: 52 });
  eq('yeni araca kayıt', Store.all().length, 1);
  eq('toplam kayıt', Store.allRecords().length, 6);

  Store.setActive(car.id);
  eq('eski araç etkilenmedi', Store.all().length, 5);

  const backup = Store.exportAll();
  eq('yedekte araç sayısı', backup.vehicles.length, 2);
  eq('yedekte kayıt sayısı', backup.records.length, 6);
  eq('yedekten geri yükleme', Store.importAll(backup), 6);
  eq('eski dizi biçimli yedek', Store.importAll(FIXTURE), 5);

  Store.setActive(Store.vehicles()[0].id);
  Store.removeVehicle(Store.vehicles()[0].id);
  eq('araç silinince kayıtları da gider', Store.allRecords().length, 0);
});

/* ---------------- store: giderler ---------------- */
group('store: giderler ve toplam maliyet', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);
  Store.upsertExpense({ date: '2026-01-20', type: 'Bakım', amount: 4500 });
  Store.upsertExpense({ date: '2026-02-02', type: 'Lastik', amount: 12000 });
  eq('gider sayısı', Store.expenses().length, 2);
  eq('gider türü sıralaması', Store.expenseByType(Store.expenses())[0].name, 'Lastik');

  const a = Store.analysis(Store.filter('all'), Store.filterExpenses('all'));
  near('gider toplamı', a.expenseTotal, 16500, 0.01);
  near('toplam maliyet', a.totalCost, a.spend + 16500, 0.01);
  near('gerçek km maliyeti', a.costPerKmAll, a.totalCost / a.distance, 0.0001);
  near('ocak gideri aylık özete girer', a.perMonth[0].expense, 4500, 0.01);

  Store.removeExpense(Store.expenses()[0].id);
  eq('gider silindi', Store.expenses().length, 1);
});

/* ---------------- importer ---------------- */
group('importer: sütun eşleştirme ve satır üretimi', () => {
  const { Importer, Store } = makeEnv();
  Store.load();

  const h1 = ['Tarih', 'Kilometre Sayacı (km)', 'Alınan Yakıt (L)', 'Fiyat (TL)',
    'Yakıt Bedeli (1L)', 'Tüketim (L/100km)', 'Tüketim (TL/km)', 'Notlar'];
  const m1 = Importer.guess(h1);
  eq('tarih sütunu', h1[m1.date], 'Tarih');
  eq('kilometre sütunu', h1[m1.odo], 'Kilometre Sayacı (km)');
  eq('litre sütunu', h1[m1.liters], 'Alınan Yakıt (L)');
  eq('tutar sütunu', h1[m1.total], 'Fiyat (TL)');
  eq('birim fiyat sütunu', h1[m1.unitPrice], 'Yakıt Bedeli (1L)');
  eq('not sütunu', h1[m1.note], 'Notlar');

  const h2 = ['TARİH', 'İSTASYON', 'Yakıt Türü', 'Litre', 'Birim Fiyat', 'Toplam Tutar', 'KM', 'Açıklama'];
  const m2 = Importer.guess(h2);
  eq('Türkçe karakterli başlık: istasyon', h2[m2.station], 'İSTASYON');
  eq('Türkçe karakterli başlık: yakıt türü', h2[m2.fuel], 'Yakıt Türü');
  eq('Türkçe karakterli başlık: tutar', h2[m2.total], 'Toplam Tutar');

  const h3 = ['Date', 'Odometer', 'Liters', 'Price/L', 'Total', 'Station'];
  eq('İngilizce başlıklar', h3[Importer.guess(h3).unitPrice], 'Price/L');

  // Başlık satırı tespiti: üstte dolgu satırları, altta özet satırı
  const rows = [
    ['Yakıt Takip Tablosu'], [],
    ['Tarih', 'Litre', 'Birim Fiyat', 'Tutar', 'KM'],
    ['12.01.2025', '45,20', '41,50', '1.875,80', '101250'],
    ['03.02.2025', '50,10', '42,90', '2.149,29', '101980'],
    ['', '', '', '', ''],
    ['Toplam', '95,30', '', '4.025,09', '']
  ];
  const hi = Importer.detectHeaderRow(rows);
  eq('başlık satırı bulundu', hi, 2);
  const built = Importer.build(rows, hi, Importer.guess(rows[hi]));
  eq('geçerli satır sayısı', built.records.length, 2);
  eq('TR ondalık litre', built.records[0].liters, 45.2);
  eq('TR binlik tutar', built.records[0].total, 1875.8);
  eq('tarih ISO biçimine çevrildi', built.records[0].date, '2025-01-12');
  ok('özet satırı atlandı', built.errors.length >= 1);

  // Excel tarih hücresi (seri numara)
  const rows2 = [['Tarih', 'Litre', 'Tutar'], [46029, 37.5, 2100]];
  eq('Excel seri tarihi', Importer.build(rows2, 0, Importer.guess(rows2[0])).records[0].date, '2026-01-07');

  // CSV: BOM, noktalı virgül, tırnak içinde virgül
  const parsed = Importer.parseCSV('﻿Tarih;Litre;Not\n12.01.2025;45,20;"ilk, dolum"\n');
  eq('CSV satır sayısı', parsed.length, 2);
  eq('BOM temizlendi', parsed[0][0], 'Tarih');
  eq('tırnak içindeki virgül', parsed[1][2], 'ilk, dolum');
});

/* ---------------- kilometre okumaları ---------------- */
group('store: kilometre okumaları', () => {
  const { Store } = makeEnv();
  Store.load();
  Store.addMany(FIXTURE);

  Store.upsertReading({ date: '2026-02-01', odo: 284900 });
  Store.upsertReading({ date: '2026-02-20', odo: 285600 });
  eq('okuma sayısı', Store.readings().length, 2);

  // Çizelge: dolumlar + okumalar, tarih sırasında
  const tl = Store.odometerTimeline(Store.filter('all'), Store.readings());
  eq('çizelge nokta sayısı', tl.length, 7);
  ok('çizelge tarih sırasında', tl.every((p, i) => i === 0 || tl[i - 1].date <= p.date));
  ok('çizelge kilometre sırasında', tl.every((p, i) => i === 0 || tl[i - 1].odo <= p.odo));

  // Aynı güne düşen dolum ve okuma iki ayrı nokta olarak kalır: aradaki fark gerçek yoldur
  Store.upsertReading({ date: '2026-01-07', odo: 283500 });
  const tl2 = Store.odometerTimeline(Store.filter('all'), Store.readings());
  eq('aynı günde iki nokta korunur', tl2.filter(p => p.date === '2026-01-07').length, 2);
  eq('küçük olan önce', tl2.find(p => p.date === '2026-01-07').odo, 283420);
  const tl3 = Store.odometerTimeline(Store.filter('all'), [{ date: '2026-01-07', odo: 283420 }]);
  eq('birebir aynı nokta tekrarlanmaz', tl3.filter(p => p.date === '2026-01-07').length, 1);

  // Okumalar mesafeyi ve aylık dağılımı değiştirir
  Store.upsertReading({ date: '2026-03-10', odo: 286500 });
  const st = Store.stats(Store.filter('all'), Store.readings());
  eq('mesafe son okumaya kadar', st.distance, 286500 - 283420);
  const km = Store.monthlyDistance(Store.filter('all'), Store.readings());
  const toplam = [...km.values()].reduce((a, v) => a + v, 0);
  near('aylık dağılım toplamı mesafeye eşit', toplam, st.distance, 2);
  ok('yakıt alınmayan ayda da yol var', (km.get('2026-03') || 0) > 0);

  // Yedek turu okumaları taşır
  const backup = Store.exportAll();
  eq('yedekte okuma sayısı', backup.readings.length, 4);
  Store.importAll(backup);
  eq('geri yüklemeden sonra okumalar', Store.readings().length, 4);

  const one = Store.readings()[0];
  Store.removeReading(one.id);
  eq('okuma silindi', Store.readings().length, 3);
});

/* ---------------- fiş okuma ---------------- */
group('receipt: model çıktısını temizleme', () => {
  const { Receipt } = makeEnv();

  eq('kod bloğundan JSON ayıklama',
    Receipt.parseJson('```json\n{"liters": 42.4}\n```').liters, 42.4);
  eq('metin arasından JSON ayıklama',
    Receipt.parseJson('İşte sonuç: {"total": 2500.4} umarım yardımcı olur').total, 2500.4);
  ok('JSON yoksa hata', (() => { try { Receipt.parseJson('hiç json yok'); return false; } catch { return true; } })());

  const tam = Receipt.clean({
    date: '15.02.2026', liters: 42.43, unitPrice: 58.93, total: 2500.4,
    station: 'OPET', fuel: 'Motorin', confidence: 'high'
  });
  eq('tarih ISO', tam.values.date, '2026-02-15');
  eq('litre', tam.values.liters, 42.43);
  eq('tutarlı fişte uyarı yok', tam.warnings.length, 0);

  const eksik = Receipt.clean({ liters: 40, total: 2400, confidence: 'high' });
  eq('birim fiyat tutardan hesaplanır', eksik.values.unitPrice, 60);

  const eksik2 = Receipt.clean({ unitPrice: 60, total: 2400, confidence: 'high' });
  eq('litre tutardan hesaplanır', eksik2.values.liters, 40);

  const tutarsiz = Receipt.clean({ liters: 40, unitPrice: 12, total: 2400, confidence: 'high' });
  eq('tutarsızlıkta birim fiyat düzeltilir', tutarsiz.values.unitPrice, 60);
  ok('tutarsızlık uyarısı', tutarsiz.warnings.some(w => /uymadı/.test(w)));

  const saçma = Receipt.clean({ liters: 9999, unitPrice: 0.2, total: 5, confidence: 'medium' });
  eq('aralık dışı litre atılır', saçma.values.liters, null);
  eq('aralık dışı tutar atılır', saçma.values.total, null);
  ok('okunamadı uyarısı', saçma.warnings.some(w => /okunamadı/.test(w)));

  const belirsiz = Receipt.clean({ total: 2000, liters: 35, confidence: 'low' });
  ok('düşük güven uyarısı', belirsiz.warnings.some(w => /gözden geçir/.test(w)));

  const ileri = Receipt.clean({ date: '2099-01-01', total: 2000, liters: 35, confidence: 'high' });
  ok('ileri tarih uyarısı', ileri.warnings.some(w => /ileri bir gün/.test(w)));

  const bozuk = Receipt.clean({ fuel: 'Uçak yakıtı', station: '   ', confidence: 'sallama' });
  eq('bilinmeyen yakıt türü atılır', bozuk.values.fuel, '');
  eq('boş istasyon', bozuk.values.station, '');
  eq('bilinmeyen güven düşük sayılır', bozuk.values.confidence, 'low');
});

/* ---------------- xlsx yazıcı ---------------- */
group('xlsx-write: ZIP ve hücre biçimleri', () => {
  const { XlsxWrite } = makeEnv();
  eq('CRC32 kontrol değeri', XlsxWrite.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  eq('Excel seri numarası', XlsxWrite.serial('2026-01-07'), 46029);
  eq('Excel seri numarası (1900 tabanı)', XlsxWrite.serial('1900-01-01'), 2);

  const bytes = XlsxWrite.build([{
    name: 'Yakıt',
    rows: [
      [{ bold: 'Tarih' }, { bold: 'Tutar' }],
      [{ date: '2026-01-07' }, { money: 2100 }],
      ['Not & <test>', null]
    ],
    widths: [12, 12]
  }]);
  ok('ZIP imzası', bytes[0] === 0x50 && bytes[1] === 0x4B);
  const text = new TextDecoder().decode(bytes);
  ok('sayfa adı yazıldı', text.includes('name="Yakıt"'));
  ok('tarih seri numarası olarak yazıldı', text.includes('<v>46029</v>'));
  ok('para hücresi biçim stiliyle', text.includes('s="2" t="n"><v>2100</v>'));
  ok('XML kaçışı', text.includes('Not &amp; &lt;test&gt;'));
  ok('boş hücre atlandı', !text.includes('<c r="B3"'));
});

/* ---------------- sonuç ---------------- */
console.log(`\n${'─'.repeat(46)}`);
console.log(`${passed} geçti, ${failed} başarısız`);
if (failed) {
  console.log('\nBaşarısız olanlar:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}

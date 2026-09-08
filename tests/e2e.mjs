/*
 * Tarayıcı duman testi: uygulamayı gerçekten açar, CSV aktarır, sekmeleri
 * dolaşır, Excel çıktısını üretip geri okur. Playwright gerektirir:
 *   npm run e2e
 * (Birim testler için: npm test — Playwright gerekmez.)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Playwright yerel kurulumdan ya da PLAYWRIGHT_IMPORT ile verilen yoldan yüklenir
let chromium;
for (const spec of [process.env.PLAYWRIGHT_IMPORT, 'playwright'].filter(Boolean)) {
  try { ({ chromium } = await import(spec)); break; } catch { /* sonraki */ }
}
if (!chromium) {
  console.log('Playwright bulunamadı, tarayıcı testi atlandı (npm i -D playwright).');
  process.exit(0);
}

const ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 8912;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yakit-e2e-'));
const problems = [];
const check = (label, cond, detail) => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${cond ? '' : ` — ${detail ?? ''}`}`);
  if (!cond) problems.push(label);
};

const csv = [
  'Tarih;Kilometre;Litre;Birim Fiyat;Tutar;İstasyon',
  '07.01.2026;283420;37,50;56,00;2.100,00;Shell',
  '23.01.2026;284169;8,56;58,41;500,00;Opet',
  '28.01.2026;284430;17,10;58,48;1.000,00;Shell',
  '31.01.2026;284632;34,19;58,49;2.000,00;Opet',
  '15.02.2026;285383;42,43;58,93;2.500,40;Shell'
].join('\n');
const csvPath = path.join(tmp, 'ornek.csv');
fs.writeFileSync(csvPath, csv, 'utf8');

const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', ROOT], { stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1200));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true
});
const page = await ctx.newPage();

// Fiş okuma akışını gerçek bir model çağrısı yapmadan denemek için sahte `sample`
await page.addInitScript(() => {
  const fake = async () => ({});
  fake.json = async (prompt, opts) => {
    window.__receiptImageBytes = opts.images[0].size;
    return { date: '2026-02-20', liters: 41.2, unitPrice: 59.5, total: 2451.4, station: 'Opet', fuel: 'Motorin', confidence: 'high' };
  };
  fake.limits = async () => ({ images: { maxCount: 4 } });
  window.claude = { use: async name => (name === 'sample' ? fake : null) };
});
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('dialog', d => d.accept());

try {
  await page.goto(`http://localhost:${PORT}/index.html`, { waitUntil: 'networkidle' });

  console.log('\nCSV içe aktarma');
  await page.click('.tab[data-view="veri"]');
  await page.setInputFiles('#fileInput', csvPath);
  await page.waitForTimeout(600);
  check('dosya okundu', (await page.textContent('#importMsg')).includes('okundu'));
  check('5 kayıt tanındı', (await page.textContent('#importPreview')).includes('5 kayıt'));
  await page.click('#doImportBtn');
  await page.waitForTimeout(400);
  await page.selectOption('#rangeSelect', 'all');
  await page.waitForTimeout(300);

  console.log('\nÖzet');
  const stats = await page.$$eval('.stat .value', els => els.map(e => e.textContent));
  check('toplam harcama', stats[0] === '₺8.100,40', stats[0]);
  check('toplam litre', stats[1] === '139,78 L', stats[1]);
  check('araç otomatik oluştu', (await page.evaluate(() => Store.vehicles().length)) === 1);

  console.log('\nGrafikler ve analiz');
  await page.click('.tab[data-view="grafikler"]');
  await page.waitForTimeout(400);
  for (const id of ['chartSpend', 'chartPrice', 'chartConsumption', 'chartLiters', 'chartStationPrice']) {
    check(`${id} çizildi`, !!(await page.$(`#${id} svg`)));
  }
  const box = await (await page.$('#chartSpend svg')).boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await page.waitForTimeout(200);
  check('dokunmatik değer baloncuğu', await page.$eval('#chartSpend .chart-tip', e => !e.hidden));

  await page.click('.tab[data-view="analiz"]');
  await page.waitForTimeout(400);
  check('analiz kartları', (await page.$$('#analysisStats .stat')).length >= 4);
  check('aylık özet tablosu', (await page.$$('#monthTable tbody tr')).length >= 2);

  console.log('\nKayıt ekleme ve doğrulama');
  await page.click('.tab[data-view="ekle"]');
  await page.fill('#f-odo', '100000');
  await page.fill('#f-liters', '40');
  await page.fill('#f-price', '59');
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  check('geriye giden kilometre uyarısı',
    (await page.textContent('#formWarn')).includes('geriye gidiyor'));
  check('tutar otomatik hesaplandı', (await page.inputValue('#f-total')) === '2360');

  console.log('\nKilometre okuması');
  await page.click('#entryMode [data-mode="reading"]');
  await page.fill('#k-odo', '286000');
  await page.click('#readingSaveBtn');
  await page.waitForTimeout(400);
  check('okuma kaydedildi', (await page.evaluate(() => Store.readings().length)) === 1);
  check('mesafe okumaya kadar uzadı',
    (await page.evaluate(() => Store.stats(Store.filter('all'), Store.readings()).distance)) === 286000 - 283420);

  console.log('\nFiş fotoğrafı');
  await page.click('#entryMode [data-mode="fuel"]');
  // Önceki doğrulama adımından kalan değerleri temizle (olay tetiklemeden:
  // fill() ile tek tek silmek otomatik hesaplamayı çalıştırıp alanı geri doldurur).
  await page.evaluate(() => {
    for (const id of ['f-odo', 'f-liters', 'f-price', 'f-total', 'f-station']) {
      document.getElementById(id).value = '';
    }
  });
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 900;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 600, 900);
    x.fillStyle = '#000'; x.font = '30px sans-serif'; x.fillText('OPET MOTORIN', 30, 60);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  await page.setInputFiles('#receiptInput', { name: 'fis.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await page.waitForTimeout(1200);
  check('fişten litre dolduruldu', (await page.inputValue('#f-liters')) === '41.2');
  check('fişten tutar dolduruldu', (await page.inputValue('#f-total')) === '2451.4');
  check('fişten tarih dolduruldu', (await page.inputValue('#f-date')) === '2026-02-20');
  check('kilometre alanına dokunulmadı', (await page.inputValue('#f-odo')) === '');
  check('fotoğraf küçültülerek gönderildi',
    (await page.evaluate(() => window.__receiptImageBytes)) < 400_000);

  console.log('\nGider ve Excel çıktısı');
  await page.click('#entryMode [data-mode="expense"]');
  await page.fill('#x-date', '2026-02-01');
  await page.fill('#x-amount', '4500');
  await page.click('#expenseSaveBtn');
  await page.waitForTimeout(400);
  check('gider kaydedildi', (await page.evaluate(() => Store.expenses().length)) === 1);

  await page.click('.tab[data-view="veri"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportXlsxBtn')]);
  const xlsxPath = path.join(tmp, 'cikti.xlsx');
  await download.saveAs(xlsxPath);
  check('xlsx üretildi', fs.statSync(xlsxPath).size > 2000);

  await page.setInputFiles('#fileInput', xlsxPath);
  await page.waitForTimeout(800);
  const map = await page.$$eval('#mapFields select',
    els => els.map(e => (e.dataset.field || '') + '=' + e.options[e.selectedIndex].textContent).join(' '));
  check('kendi çıktısını geri okuyabiliyor', map.includes('date=Tarih') && map.includes('liters=Litre'), map);

  console.log('\nSayfa hataları');
  check('konsol hatası yok', errors.length === 0, errors.join(' | '));
} finally {
  await browser.close();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${problems.length ? `${problems.length} sorun: ${problems.join(', ')}` : 'Tarayıcı testi temiz.'}`);
process.exit(problems.length ? 1 : 0);

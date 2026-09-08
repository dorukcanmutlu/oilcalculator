/* Excel / CSV içe aktarma */
const Importer = (() => {
  const XLSX_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  const FIELDS = [
    { key: 'date',      label: 'Tarih',        required: true,  words: ['tarih', 'date', 'gun', 'gün'] },
    { key: 'total',     label: 'Tutar (₺)',    words: ['tutar', 'toplam', 'ucret', 'ücret', 'odenen', 'ödenen', 'harcama', 'total', 'amount', 'tl'] },
    { key: 'liters',    label: 'Litre',        words: ['litre', 'lt', 'liter', 'miktar', 'hacim'] },
    { key: 'unitPrice', label: 'Birim fiyat',  words: ['birim', 'fiyat', 'price', 'lt fiyat', 'litre fiyat', 'birim fiyat'] },
    { key: 'odo',       label: 'Kilometre',    words: ['km', 'kilometre', 'odo', 'sayac', 'sayaç', 'mileage'] },
    { key: 'fuel',      label: 'Yakıt türü',   words: ['yakit', 'yakıt', 'tur', 'tür', 'cins', 'motorin', 'benzin', 'fuel'] },
    { key: 'station',   label: 'İstasyon',     words: ['istasyon', 'petrol', 'firma', 'marka', 'station', 'yer', 'lokasyon'] },
    { key: 'full',      label: 'Depo tam mı',  words: ['dolu', 'tam depo', 'full'] },
    { key: 'note',      label: 'Not',          words: ['not', 'aciklama', 'açıklama', 'note', 'yorum'] }
  ];

  const norm = s => String(s ?? '').toLocaleLowerCase('tr').replace(/[^a-zçğıöşü0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  /* ---- CSV ---- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const sample = text.slice(0, 3000);
    const delim = [';', '\t', ','].map(d => [d, (sample.match(new RegExp('\\' + d, 'g')) || []).length])
      .sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* atla */ }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(v => String(v).trim() !== ''));
  }

  /* ---- XLSX (SheetJS ihtiyaç anında yüklenir) ---- */
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = XLSX_CDN;
      s.onload = () => window.XLSX ? res(window.XLSX) : rej(new Error('XLSX yüklenemedi'));
      s.onerror = () => rej(new Error('Excel okuyucu indirilemedi. İnternet bağlantını kontrol et ya da dosyayı CSV olarak kaydedip dene.'));
      document.head.appendChild(s);
    });
  }

  async function readFile(file) {
    const name = (file.name || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      return parseCSV(await file.text());
    }
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
    return rows.filter(r => r.some(v => String(v ?? '').trim() !== ''));
  }

  /** Başlık satırını tahmin eder (ilk 12 satır içinde). */
  function detectHeaderRow(rows) {
    const words = FIELDS.flatMap(f => f.words);
    let best = 0, bestScore = -1;
    rows.slice(0, 12).forEach((row, i) => {
      const cells = row.map(norm).filter(Boolean);
      if (!cells.length) return;
      const hits = cells.filter(c => words.some(w => c.includes(w))).length;
      const texts = cells.filter(c => U.parseNumber(c) == null).length;
      const score = hits * 3 + texts;
      if (score > bestScore) { bestScore = score; best = i; }
    });
    return best;
  }

  /** Başlıklara bakarak alan eşleşmesi önerir. */
  function guess(headers) {
    const cols = headers.map(norm);
    const map = {};
    const used = new Set();
    for (const f of FIELDS) {
      let idx = cols.findIndex((c, i) => c && !used.has(i) && f.words.some(w => c === w));
      if (idx < 0) idx = cols.findIndex((c, i) => c && !used.has(i) && f.words.some(w => c.includes(w)));
      if (idx >= 0) { map[f.key] = idx; used.add(idx); }
    }
    return map;
  }

  /** Eşleşmeye göre kayıt nesneleri üretir. */
  function build(rows, headerIdx, map) {
    const out = [], errors = [];
    const get = (row, key) => {
      const i = map[key];
      return (i == null || i < 0) ? null : row[i];
    };
    rows.slice(headerIdx + 1).forEach((row, n) => {
      if (!row.some(v => String(v ?? '').trim() !== '')) return;
      const date = U.parseDate(get(row, 'date'));
      const total = U.parseNumber(get(row, 'total'));
      const liters = U.parseNumber(get(row, 'liters'));
      const unitPrice = U.parseNumber(get(row, 'unitPrice'));
      if (!date) { errors.push(`${headerIdx + n + 2}. satır: tarih okunamadı`); return; }
      if (total == null && liters == null) { errors.push(`${headerIdx + n + 2}. satır: tutar ve litre boş`); return; }
      const fullRaw = get(row, 'full');
      out.push({
        date, total, liters, unitPrice,
        odo: U.parseNumber(get(row, 'odo')),
        fuel: String(get(row, 'fuel') || '').trim() || 'Motorin',
        station: String(get(row, 'station') || '').trim(),
        full: fullRaw == null || fullRaw === '' ? true : /^(1|e|evet|x|var|true|yes|dolu|tam)/i.test(String(fullRaw).trim()),
        note: String(get(row, 'note') || '').trim()
      });
    });
    return { records: out, errors };
  }

  return { FIELDS, readFile, parseCSV, detectHeaderRow, guess, build };
})();

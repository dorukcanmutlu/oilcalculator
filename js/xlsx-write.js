/*
 * Küçük XLSX yazıcı: sıkıştırmasız (stored) ZIP + SpreadsheetML.
 * Dış kütüphane yok; tarayıcıda da, Node'da da aynı kod çalışır.
 */
const XlsxWrite = (() => {
  /* ---- CRC32 (ZIP başlıkları için) ---- */
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();

  /** Dosyaları sıkıştırmadan tek bir ZIP arşivine koyar. */
  function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = f.data instanceof Uint8Array ? f.data : enc.encode(f.data);
      const crc = crc32(data);

      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);          // sürüm
      lv.setUint16(6, 0, true);           // bayrak
      lv.setUint16(8, 0, true);           // yöntem: stored
      lv.setUint32(14, crc, true);
      lv.setUint32(18, data.length, true);
      lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true);
      local.set(name, 30);
      parts.push(local, data);

      const cd = new Uint8Array(46 + name.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(10, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, data.length, true);
      cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true);
      cv.setUint32(42, offset, true);
      cd.set(name, 46);
      central.push(cd);

      offset += local.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    const all = [...parts, ...central, end];
    const total = all.reduce((a, p) => a + p.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    for (const chunk of all) { out.set(chunk, p); p += chunk.length; }
    return out;
  }

  /* ---- SpreadsheetML ---- */
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const colName = i => {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
  };
  /** Tarih -> Excel seri numarası (1899-12-30 tabanlı) */
  const serial = iso => {
    const [y, m, d] = String(iso).split('-').map(Number);
    return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
  };

  /**
   * Hücre: null | number | string | {date} | {money} | {bold}
   * Stiller: 1 = tarih, 2 = ₺ biçimi, 3 = kalın
   */
  function cell(ref, v) {
    if (v == null || v === '') return '';
    if (typeof v === 'object' && v.date) return `<c r="${ref}" s="1" t="n"><v>${serial(v.date)}</v></c>`;
    if (typeof v === 'object' && v.money != null) return `<c r="${ref}" s="2" t="n"><v>${v.money}</v></c>`;
    if (typeof v === 'object' && v.bold != null) return `<c r="${ref}" s="3" t="inlineStr"><is><t>${esc(v.bold)}</t></is></c>`;
    if (typeof v === 'number') return `<c r="${ref}" t="n"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  }

  function sheetXml(rows, widths) {
    const body = rows.map((row, ri) =>
      `<row r="${ri + 1}">` + row.map((v, ci) => cell(colName(ci) + (ri + 1), v)).join('') + '</row>'
    ).join('');
    const cols = widths
      ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="1"><fill><patternFill patternType="none"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs></styleSheet>`;

  /**
   * sheets: [{ name, rows, widths }] -> Uint8Array (.xlsx içeriği)
   */
  function build(sheets) {
    const files = [
      {
        name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`
      },
      {
        name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`
      },
      {
        name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`
      },
      {
        name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
      },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s.rows, s.widths) }));
    return zip(files);
  }

  return { build, zip, crc32, serial };
})();

if (typeof module !== 'undefined') module.exports = XlsxWrite;

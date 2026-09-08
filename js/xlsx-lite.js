/*
 * Küçük XLSX okuyucu: dosya bir ZIP arşivi, içindeki XML sayfaları okunur.
 * Açma işlemi tarayıcının DecompressionStream'i ile yapılır; dış kütüphane yok.
 */
const XlsxLite = (() => {
  const supported = () => typeof DecompressionStream === 'function';

  /* ---- ZIP ---- */
  async function unzip(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    // Merkezî dizin sonu kaydını (EOCD) sondan ara
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Geçerli bir Excel (zip) dosyası değil.');
    const count = dv.getUint16(eocd + 10, true);
    let ptr = dv.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder('utf-8');
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(ptr, true) !== 0x02014b50) break;
      const method = dv.getUint16(ptr + 10, true);
      const compSize = dv.getUint32(ptr + 20, true);
      const nameLen = dv.getUint16(ptr + 28, true);
      const extraLen = dv.getUint16(ptr + 30, true);
      const commentLen = dv.getUint16(ptr + 32, true);
      const localOff = dv.getUint32(ptr + 42, true);
      const name = dec.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      files[name] = { method, bytes: u8.subarray(start, start + compSize) };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name];
        if (!f) return null;
        if (f.method === 0) return dec.decode(f.bytes);
        if (f.method !== 8) throw new Error('Desteklenmeyen sıkıştırma biçimi.');
        const stream = new Blob([f.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Response(stream).text();
      }
    };
  }

  /* ---- XLSX ---- */
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const parseXML = txt => new DOMParser().parseFromString(txt, 'application/xml');
  const colIndex = ref => {
    const m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return null;
    let n = 0;
    for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };

  /** İlk sayfayı satır dizileri hâlinde döndürür. */
  async function read(buffer) {
    const zip = await unzip(buffer);

    const sharedTxt = await zip.text('xl/sharedStrings.xml');
    const shared = [];
    if (sharedTxt) {
      for (const si of parseXML(sharedTxt).getElementsByTagNameNS(NS, 'si')) {
        shared.push([...si.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join(''));
      }
    }

    let sheetPath = zip.names.find(n => /^xl\/worksheets\/sheet1\.xml$/.test(n))
      || zip.names.find(n => /^xl\/worksheets\/.*\.xml$/.test(n));
    if (!sheetPath) throw new Error('Excel dosyasında sayfa bulunamadı.');

    const doc = parseXML(await zip.text(sheetPath));
    const rows = [];
    for (const row of doc.getElementsByTagNameNS(NS, 'row')) {
      const cells = [];
      let auto = -1;
      for (const c of row.getElementsByTagNameNS(NS, 'c')) {
        const idx = colIndex(c.getAttribute('r'));
        const i = idx == null ? ++auto : (auto = idx);
        const type = c.getAttribute('t');
        let val = '';
        if (type === 's') {
          const v = c.getElementsByTagNameNS(NS, 'v')[0];
          val = v ? (shared[Number(v.textContent)] ?? '') : '';
        } else if (type === 'inlineStr') {
          val = [...c.getElementsByTagNameNS(NS, 't')].map(t => t.textContent).join('');
        } else {
          const v = c.getElementsByTagNameNS(NS, 'v')[0];
          if (v) {
            const raw = v.textContent;
            const num = Number(raw);
            val = (raw !== '' && isFinite(num)) ? num : raw;
          }
        }
        while (cells.length < i) cells.push('');
        cells[i] = val;
      }
      const r = Number(row.getAttribute('r'));
      if (r) { while (rows.length < r - 1) rows.push([]); rows[r - 1] = cells; }
      else rows.push(cells);
    }
    return rows.filter(r => r.some(v => String(v ?? '').trim() !== ''));
  }

  return { read, supported };
})();

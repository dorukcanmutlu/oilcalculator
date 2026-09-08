/* Arayüz mantığı */
(() => {
  const $ = U.el;
  let range = '12';
  let parsed = null; // içe aktarma durumu: {rows, headerIdx, map}

  /* ---------- Görünüm yönetimi ---------- */
  const TITLES = { ozet: 'Özet', ekle: 'Yakıt ekle', kayitlar: 'Kayıtlar', grafikler: 'Grafikler', veri: 'Veri' };
  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $('#viewTitle').textContent = TITLES[view] || 'Yakıt Takip';
    window.scrollTo({ top: 0 });
    if (view === 'grafikler') renderCharts();
    location.hash = view;
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------- Render ---------- */
  function current() { return Store.filter(range); }

  function renderAll() {
    renderStats();
    renderList();
    renderStations();
    if (!$('#view-grafikler').hidden) renderCharts();
  }

  function renderStats() {
    const list = current();
    const s = Store.stats(list);
    const cards = [
      { label: 'Toplam harcama', value: U.money(s.spend), sub: `${s.count} alım · ${s.months} ay` },
      { label: 'Toplam yakıt', value: U.liters(s.liters), sub: s.monthlySpend ? `Aylık ort. ${U.money(s.monthlySpend)}` : '' },
      { label: 'Ort. birim fiyat', value: s.avgPrice ? '₺' + U.n2.format(s.avgPrice) + '/L' : '—', sub: s.lastPrice ? `Son: ₺${U.n2.format(s.lastPrice)}/L` : '' },
      { label: 'Ort. tüketim', value: s.lPer100 ? U.n1.format(s.lPer100) + ' L/100km' : '—', sub: s.segments.length ? `${s.segments.length} tam depo aralığı` : 'Km + tam depo gerekli' },
      { label: 'Km başına maliyet', value: s.costPerKm ? '₺' + U.n2.format(s.costPerKm) + '/km' : '—', sub: s.segDistance ? `${U.km(s.segDistance)} ölçüldü` : '' },
      { label: 'Toplam mesafe', value: s.distance ? U.km(s.distance) : '—', sub: 'İlk–son kilometre farkı' }
    ];
    $('#stats').innerHTML = cards.map(c => `
      <div class="stat">
        <div class="label">${U.esc(c.label)}</div>
        <div class="value">${U.esc(c.value)}</div>
        <div class="sub">${U.esc(c.sub || '')}</div>
      </div>`).join('');

    const recent = list.slice(-5).reverse();
    $('#recentList').innerHTML = recent.length ? recent.map(r => rowHTML(r)).join('')
      : '<li class="empty">Henüz kayıt yok. “Ekle” sekmesinden başla.</li>';
  }

  function rowHTML(r, withActions) {
    const bits = [U.liters(r.liters)];
    if (r.unitPrice != null) bits.push('₺' + U.n2.format(r.unitPrice) + '/L');
    if (r.odo != null) bits.push(U.km(r.odo));
    if (!r.full) bits.push('kısmi');
    return `<li data-id="${U.esc(r.id)}">
      <div class="rec-main">${U.esc(r.station || r.fuel)} <span style="color:var(--muted);font-weight:500">· ${U.esc(U.dateLabel(r.date))}</span></div>
      <div class="rec-sub">${U.esc(bits.join(' · '))}${r.note ? ' · ' + U.esc(r.note) : ''}</div>
      <div class="rec-amount">${U.esc(U.money(r.total))}</div>
      ${withActions ? `<div class="rec-actions"><button class="edit">Düzenle</button><button class="del">Sil</button></div>` : ''}
    </li>`;
  }

  function renderList() {
    const q = ($('#searchInput').value || '').toLocaleLowerCase('tr');
    let list = current().slice().reverse();
    if (q) list = list.filter(r => (r.station + ' ' + r.note + ' ' + r.fuel).toLocaleLowerCase('tr').includes(q));
    $('#recordList').innerHTML = list.map(r => rowHTML(r, true)).join('');
    $('#listEmpty').hidden = list.length > 0;
    const spend = list.reduce((a, r) => a + (r.total || 0), 0);
    $('#listCount').textContent = list.length ? `${list.length} kayıt · ${U.money(spend)}` : '';
  }

  function renderStations() {
    $('#stationList').innerHTML = Store.stations().map(s => `<option value="${U.esc(s)}">`).join('');
  }

  function renderCharts() {
    const list = current();
    const months = Store.byMonth(list);
    Charts.bar($('#chartSpend'), months.map(m => ({ label: U.monthLabel(m.ym), value: Math.round(m.spend) })),
      { fmt: U.money, fmtY: U.moneyShort, color: '--c1' });
    Charts.bar($('#chartLiters'), months.map(m => ({ label: U.monthLabel(m.ym), value: Math.round(m.liters) })),
      { fmt: v => U.n0.format(v) + ' L', fmtY: v => U.n0.format(v), color: '--c3' });

    const priceSeries = list.filter(r => r.unitPrice != null)
      .map(r => ({ label: U.dateLabel(r.date).slice(0, 6), value: r.unitPrice }));
    Charts.line($('#chartPrice'), priceSeries,
      { fmt: v => '₺' + U.n2.format(v) + '/L', fmtY: v => U.n2.format(v), color: '--c2' });

    const segs = Store.consumptionSegments(list);
    Charts.line($('#chartConsumption'), segs.map(s => ({ label: U.dateLabel(s.date).slice(0, 6), value: s.lPer100 })),
      { fmt: v => U.n1.format(v) + ' L/100km', fmtY: v => U.n1.format(v), color: '--c4' });
    $('#consumptionHint').textContent = segs.length
      ? `${segs.length} tam depo aralığından hesaplandı.`
      : 'Tüketim için ardışık en az iki alımda kilometre girip “depo tam dolduruldu” işaretlemelisin.';

    Charts.hbar($('#chartStations'), Store.byStation(list).map(s => ({ label: s.name, value: Math.round(s.spend) })),
      { fmt: U.moneyShort });
  }

  /* ---------- Form ---------- */
  const F = {
    id: $('#f-id'), date: $('#f-date'), odo: $('#f-odo'), liters: $('#f-liters'),
    price: $('#f-price'), total: $('#f-total'), fuel: $('#f-fuel'),
    station: $('#f-station'), full: $('#f-full'), note: $('#f-note')
  };

  /** İki alan doluyken üçüncüsünü hesaplar. */
  function autoCalc(changed) {
    const l = U.parseNumber(F.liters.value), p = U.parseNumber(F.price.value), t = U.parseNumber(F.total.value);
    const set = (el, v, d) => { el.value = v == null ? '' : (Math.round(v * 10 ** d) / 10 ** d); };
    if (changed === 'total' && p && t != null) set(F.liters, t / p, 2);
    else if (changed === 'liters' && p && l != null) set(F.total, l * p, 2);
    else if (changed === 'price' && l != null && p) set(F.total, l * p, 2);
    else if (l != null && p && t == null) set(F.total, l * p, 2);
    else if (l != null && t != null && !p) set(F.price, t / l, 3);
    else if (p && t != null && l == null) set(F.liters, t / p, 2);
  }
  ['liters', 'price', 'total'].forEach(k => F[k].addEventListener('input', () => autoCalc(k)));

  function resetForm() {
    F.id.value = ''; F.date.value = U.todayISO();
    F.odo.value = ''; F.liters.value = ''; F.price.value = ''; F.total.value = '';
    F.station.value = ''; F.note.value = ''; F.full.checked = true;
    const last = Store.all().slice(-1)[0];
    if (last) { F.fuel.value = last.fuel; F.station.value = last.station; }
    $('#saveBtn').textContent = 'Kaydet';
    $('#cancelEditBtn').hidden = true;
  }

  function editRecord(id) {
    const r = Store.all().find(x => x.id === id);
    if (!r) return;
    F.id.value = r.id; F.date.value = r.date;
    F.odo.value = r.odo ?? ''; F.liters.value = r.liters ?? '';
    F.price.value = r.unitPrice ?? ''; F.total.value = r.total ?? '';
    F.fuel.value = r.fuel; F.station.value = r.station;
    F.full.checked = r.full; F.note.value = r.note;
    $('#saveBtn').textContent = 'Güncelle';
    $('#cancelEditBtn').hidden = false;
    show('ekle');
  }

  $('#entryForm').addEventListener('submit', e => {
    e.preventDefault();
    const rec = {
      id: F.id.value || undefined,
      date: F.date.value,
      odo: F.odo.value, liters: F.liters.value,
      unitPrice: F.price.value, total: F.total.value,
      fuel: F.fuel.value, station: F.station.value,
      full: F.full.checked, note: F.note.value
    };
    if (!rec.date) return toast('Tarih gerekli');
    if (!U.parseNumber(rec.total) && !U.parseNumber(rec.liters)) return toast('Tutar ya da litre gir');
    const editing = !!F.id.value;
    Store.upsert(rec);
    resetForm(); renderAll(); renderStations();
    toast(editing ? 'Kayıt güncellendi' : 'Kayıt eklendi');
    if (!editing) show('ozet');
  });

  $('#cancelEditBtn').addEventListener('click', () => { resetForm(); show('kayitlar'); });

  document.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const li = btn.closest('li[data-id]');
    if (li && btn.classList.contains('edit')) editRecord(li.dataset.id);
    else if (li && btn.classList.contains('del')) {
      if (confirm('Bu kayıt silinsin mi?')) { Store.remove(li.dataset.id); renderAll(); toast('Silindi'); }
    } else if (btn.dataset.goto) show(btn.dataset.goto);
    else if (btn.classList.contains('tab')) show(btn.dataset.view);
  });

  $('#searchInput').addEventListener('input', renderList);
  $('#rangeSelect').addEventListener('change', e => { range = e.target.value; renderAll(); });

  /* ---------- İçe aktarma ---------- */
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    msg('Dosya okunuyor…');
    try {
      const rows = await Importer.readFile(file);
      if (!rows.length) throw new Error('Dosyada satır bulunamadı.');
      const headerIdx = Importer.detectHeaderRow(rows);
      parsed = { rows, headerIdx, map: Importer.guess(rows[headerIdx]) };
      renderMapping();
      msg(`${file.name} okundu · ${rows.length} satır. Sütun eşleşmesini kontrol et.`);
    } catch (err) {
      parsed = null; $('#mapArea').hidden = true;
      msg(err.message || 'Dosya okunamadı', true);
    }
  });

  function msg(text, isError) {
    const p = $('#importMsg');
    p.textContent = text; p.hidden = false;
    p.classList.toggle('error', !!isError);
  }

  function renderMapping() {
    const { rows, headerIdx, map } = parsed;
    const headers = rows[headerIdx].map((h, i) => String(h ?? '').trim() || `Sütun ${i + 1}`);
    const opts = sel => `<option value="-1">— yok —</option>` + headers.map((h, i) =>
      `<option value="${i}" ${sel === i ? 'selected' : ''}>${U.esc(h)}</option>`).join('');

    const headerOpts = rows.slice(0, 12).map((r, i) =>
      `<option value="${i}" ${i === headerIdx ? 'selected' : ''}>${i + 1}. satır: ${U.esc(r.slice(0, 4).join(' | ').slice(0, 40))}</option>`).join('');

    $('#mapFields').innerHTML = `
      <label class="field" style="grid-column:1/-1">
        <span>Başlık satırı</span>
        <select data-header>${headerOpts}</select>
      </label>` +
      Importer.FIELDS.map(f => `
        <label class="field">
          <span>${U.esc(f.label)}${f.required ? ' *' : ''}</span>
          <select data-field="${f.key}">${opts(map[f.key] ?? -1)}</select>
        </label>`).join('');

    $('#mapArea').hidden = false;
    $('#mapFields').querySelector('[data-header]').addEventListener('change', e => {
      parsed.headerIdx = Number(e.target.value);
      parsed.map = Importer.guess(parsed.rows[parsed.headerIdx]);
      renderMapping();
    });
    $('#mapFields').querySelectorAll('[data-field]').forEach(sel => {
      sel.addEventListener('change', () => {
        parsed.map[sel.dataset.field] = Number(sel.value);
        renderPreview();
      });
    });
    renderPreview();
  }

  function renderPreview() {
    const { rows, headerIdx, map } = parsed;
    const { records, errors } = Importer.build(rows, headerIdx, map);
    parsed.result = { records, errors };
    const head = ['Tarih', 'Litre', '₺/L', 'Tutar', 'Km', 'İstasyon'];
    const body = records.slice(0, 5).map(r => {
      const n = Store.normalize(r);
      return `<tr><td>${U.esc(U.dateLabel(n.date))}</td><td>${U.esc(U.num(n.liters))}</td><td>${U.esc(U.num(n.unitPrice, 3))}</td><td>${U.esc(U.money(n.total))}</td><td>${U.esc(n.odo ?? '—')}</td><td>${U.esc(n.station || '—')}</td></tr>`;
    }).join('');
    $('#importPreview').innerHTML = records.length
      ? `<p class="hint">${records.length} kayıt okundu${errors.length ? `, ${errors.length} satır atlandı` : ''}. İlk 5 satır:</p>
         <table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
         ${errors.length ? `<p class="hint">${U.esc(errors.slice(0, 5).join(' · '))}${errors.length > 5 ? ' …' : ''}</p>` : ''}`
      : `<p class="hint">Hiç geçerli satır bulunamadı. Tarih ve tutar/litre sütunlarını doğru eşleştirdiğinden emin ol.</p>`;
  }

  $('#doImportBtn').addEventListener('click', () => {
    if (!parsed?.result?.records?.length) return msg('Aktarılacak kayıt yok', true);
    const recs = parsed.result.records;
    if ($('#importMode').value === 'replace') {
      if (!confirm(`Mevcut tüm kayıtlar silinip ${recs.length} kayıt yüklenecek. Devam?`)) return;
      Store.replaceAll(recs);
    } else {
      Store.addMany(recs);
    }
    resetImport();
    renderAll(); renderStations();
    toast(`${recs.length} kayıt aktarıldı`);
    show('ozet');
  });

  $('#cancelImportBtn').addEventListener('click', resetImport);
  function resetImport() {
    parsed = null;
    $('#mapArea').hidden = true;
    $('#fileInput').value = '';
    $('#importMsg').hidden = true;
  }

  /* ---------- Dışa aktarma ---------- */
  $('#exportCsvBtn').addEventListener('click', () => {
    const rows = [['Tarih', 'Kilometre', 'Litre', 'Birim fiyat', 'Tutar', 'Yakıt', 'İstasyon', 'Tam depo', 'Not']];
    for (const r of Store.all()) {
      rows.push([r.date, r.odo ?? '', r.liters ?? '', r.unitPrice ?? '', r.total ?? '', r.fuel, r.station, r.full ? 'Evet' : 'Hayır', r.note]);
    }
    const csv = '﻿' + rows.map(r => r.map(c => {
      const s = String(c ?? '').replace(/\./g, ',');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\r\n');
    U.download(`yakit-${U.todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
  });

  $('#exportJsonBtn').addEventListener('click', () => {
    U.download(`yakit-yedek-${U.todayISO()}.json`, JSON.stringify(Store.all(), null, 2), 'application/json');
  });

  $('#restoreBtn').addEventListener('click', () => $('#restoreInput').click());
  $('#restoreInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('Geçersiz yedek dosyası');
      if (!confirm(`${data.length} kayıt geri yüklenecek, mevcut kayıtların yerine geçecek. Devam?`)) return;
      Store.replaceAll(data);
      renderAll(); renderStations();
      toast(`${data.length} kayıt geri yüklendi`);
    } catch (err) {
      toast('Yedek okunamadı');
    } finally { e.target.value = ''; }
  });

  /* ---------- Örnek veri / temizleme ---------- */
  $('#demoBtn').addEventListener('click', () => {
    if (Store.all().length && !confirm('Örnek kayıtlar mevcut verilerin üzerine eklenecek. Devam?')) return;
    Store.addMany(demoData());
    renderAll(); renderStations();
    toast('Örnek veriler yüklendi');
    show('ozet');
  });

  $('#clearBtn').addEventListener('click', () => {
    if (!confirm('Tüm kayıtlar kalıcı olarak silinecek. Emin misin?')) return;
    Store.clear(); renderAll();
    toast('Tüm kayıtlar silindi');
  });

  function demoData() {
    const out = [];
    const stations = ['Petrol Ofisi', 'Shell', 'Opet', 'BP', 'Total'];
    const today = new Date();
    let odo = 96000, price = 42.1;
    for (let i = 270; i >= 0; i -= 11) {
      const d = new Date(today.getTime() - i * 86400000);
      const liters = Math.round((42 + Math.random() * 16) * 100) / 100;
      price = Math.round((price + (Math.random() - 0.35) * 0.9) * 100) / 100;
      odo += Math.round(430 + Math.random() * 260);
      out.push({
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        odo, liters, unitPrice: price,
        total: Math.round(liters * price * 100) / 100,
        fuel: 'Motorin',
        station: stations[Math.floor(Math.random() * stations.length)],
        full: true, note: ''
      });
    }
    return out;
  }

  /* ---------- Başlangıç ---------- */
  Store.load();
  resetForm();
  renderAll();
  const start = (location.hash || '').replace('#', '');
  show(TITLES[start] ? start : 'ozet');

  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => { if (!$('#view-grafikler').hidden) renderCharts(); }, 200);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();

/* Arayüz mantığı */
(() => {
  const $ = U.el;
  let range = '12';
  let parsed = null; // içe aktarma durumu: {rows, headerIdx, map}
  let bulkMode = false;
  let partialDismissed = false;
  let partialCandidates = [];
  let warnKey = null;
  const selected = new Set();

  /* ---------- Görünüm yönetimi ---------- */
  const TITLES = { ozet: 'Özet', ekle: 'Yakıt ekle', kayitlar: 'Kayıtlar', grafikler: 'Grafikler', analiz: 'Analiz', veri: 'Veri' };
  function show(view) {
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    $('#viewTitle').textContent = TITLES[view] || 'Yakıt Takip';
    window.scrollTo({ top: 0 });
    if (view === 'grafikler') renderCharts();
    if (view === 'analiz') renderAnalysis();
    location.hash = view;
  }

  /** Kısa bildirim; action verilirse yanında bir düğme gösterir (ör. "Geri al"). */
  function toast(msg, action) {
    const t = $('#toast');
    t.textContent = msg;
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast-btn';
      btn.textContent = action.label;
      btn.addEventListener('click', () => { t.hidden = true; action.fn(); });
      t.appendChild(btn);
    }
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, action ? 7000 : 2600);
  }

  /* ---------- Render ---------- */
  function current() { return Store.filter(range); }

  function renderAll() {
    renderVehicles();
    renderStats();
    renderList();
    renderStations();
    updateOdoHint();
    if (!$('#view-grafikler').hidden) renderCharts();
    if (!$('#view-analiz').hidden) renderAnalysis();
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

    renderBackupBanner();

    const recent = list.slice(-5).reverse();
    $('#recentList').innerHTML = recent.length ? recent.map(r => rowHTML(r)).join('')
      : '<li class="empty">Henüz kayıt yok. “Ekle” sekmesinden başla.</li>';
  }

  function rowHTML(r, { actions = false, pick = false, issues = null } = {}) {
    const bits = [U.liters(r.liters)];
    if (r.unitPrice != null) bits.push('₺' + U.n2.format(r.unitPrice) + '/L');
    if (r.odo != null) bits.push(U.km(r.odo));
    if (!r.full) bits.push('kısmi');
    const flag = issues && issues.length
      ? ` <span class="rec-flag" title="${U.esc(issues.map(i => i.text).join(' · '))}">⚠</span>` : '';
    return `<li data-id="${U.esc(r.id)}" class="${pick ? 'selectable' : ''}">
      ${pick ? `<input type="checkbox" class="pick" ${selected.has(r.id) ? 'checked' : ''} aria-label="Seç">` : ''}
      <div class="rec-main">${U.esc(r.station || r.fuel)} <span style="color:var(--muted);font-weight:500">· ${U.esc(U.dateLabel(r.date))}</span>${flag}</div>
      <div class="rec-sub">${U.esc(bits.join(' · '))}${r.note ? ' · ' + U.esc(r.note) : ''}</div>
      <div class="rec-amount">${U.esc(U.money(r.total))}</div>
      ${actions && !pick ? `<div class="rec-actions"><button class="edit">Düzenle</button><button class="del">Sil</button></div>` : ''}
    </li>`;
  }

  const SORTS = {
    'date-desc': (a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
    'date-asc': (a, b) => a.date > b.date ? 1 : a.date < b.date ? -1 : 0,
    'total-desc': (a, b) => (b.total || 0) - (a.total || 0),
    'liters-desc': (a, b) => (b.liters || 0) - (a.liters || 0),
    'price-desc': (a, b) => (b.unitPrice || 0) - (a.unitPrice || 0)
  };

  function renderList() {
    const q = ($('#searchInput').value || '').toLocaleLowerCase('tr');
    const fuel = $('#fuelFilter').value;
    let list = current().slice().sort(SORTS[$('#sortSelect').value] || SORTS['date-desc']);
    if (fuel) list = list.filter(r => r.fuel === fuel);
    if (q) list = list.filter(r => (r.station + ' ' + r.note + ' ' + r.fuel).toLocaleLowerCase('tr').includes(q));
    const tankSize = Store.activeVehicle()?.tankSize;
    const issueMap = new Map(Store.anomalies(list, { tankSize }).map(x => [x.rec.id, x.issues]));
    $('#recordList').innerHTML = list.map(r =>
      rowHTML(r, { actions: true, pick: bulkMode, issues: issueMap.get(r.id) })).join('');
    $('#listEmpty').hidden = list.length > 0;
    const spend = list.reduce((a, r) => a + (r.total || 0), 0);
    $('#listCount').textContent = list.length ? `${list.length} kayıt · ${U.money(spend)}` : '';
    renderAnomalies(list, issueMap);
    renderPartialSuggestion(list);
    updateBulkBar();
  }

  function renderAnomalies(list, issueMap) {
    const rows = list.filter(r => issueMap.has(r.id));
    $('#anomalyCard').hidden = rows.length === 0;
    if (!rows.length) return;
    $('#anomalyList').innerHTML = rows.map(r => `
      <li data-id="${U.esc(r.id)}">
        <span class="issue-date">${U.esc(U.dateLabel(r.date))} · ${U.esc(U.money(r.total))}</span>
        <span class="issue-text">${U.esc(issueMap.get(r.id).map(i => i.text).join(' · '))}</span>
        <button class="edit">Düzelt</button>
      </li>`).join('');
  }

  function renderPartialSuggestion(list) {
    if (partialDismissed) { $('#partialCard').hidden = true; return; }
    const cand = Store.suggestPartial(list);
    $('#partialCard').hidden = cand.length === 0;
    if (!cand.length) return;
    partialCandidates = cand.map(r => r.id);
    $('#partialText').textContent =
      `${cand.length} dolumun litresi ortalamanın belirgin altında (${cand.map(r => U.n1.format(r.liters) + ' L').slice(0, 4).join(', ')}${cand.length > 4 ? '…' : ''}). ` +
      'Bunlar depoyu tam doldurmadığın alımlarsa işaretleyelim; "dolum arası" tüketim hesabı ancak o zaman doğru çalışır.';
  }

  function updateBulkBar() {
    $('#bulkBar').hidden = !bulkMode;
    $('#bulkToggle').textContent = bulkMode ? 'Toplu düzenlemeyi kapat' : 'Toplu düzenle';
    $('#bulkCount').textContent = `${selected.size} seçili`;
  }

  function renderStations() {
    $('#stationList').innerHTML = Store.stations().map(s => `<option value="${U.esc(s)}">`).join('');
    const sel = $('#fuelFilter'), cur = sel.value;
    sel.innerHTML = '<option value="">Tüm yakıtlar</option>' +
      Store.fuels().map(f => `<option value="${U.esc(f)}">${U.esc(f)}</option>`).join('');
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur;
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

    const mode = $('#consumptionMode').value;
    const series = mode === 'cumulative'
      ? Store.cumulativeConsumption(list).map(s => ({ label: U.dateLabel(s.date).slice(0, 6), value: s.value }))
      : Store.consumptionSegments(list).map(s => ({ label: U.dateLabel(s.date).slice(0, 6), value: s.lPer100 }));
    Charts.line($('#chartConsumption'), series,
      { fmt: v => U.n1.format(v) + ' L/100km', fmtY: v => U.n1.format(v), color: '--c4' });
    $('#consumptionHint').textContent = series.length
      ? (mode === 'cumulative'
        ? 'İlk kayıttan bugüne toplam litre / gidilen km. Kısmi dolumlarda da doğru çalışır.'
        : `${series.length} tam depo aralığından hesaplandı; her dolumda depoyu tam doldurduysan bu daha hassastır.`)
      : 'Tüketim için en az iki kayıtta kilometre girmelisin.';

    const stationRows = Store.byStation(list);
    const hasStations = stationRows.some(s => s.name !== 'Belirtilmemiş');
    $('#cardStations').hidden = !hasStations;
    if (hasStations) {
      Charts.hbar($('#chartStations'), stationRows.map(s => ({ label: s.name, value: Math.round(s.spend) })),
        { fmt: U.moneyShort });
    }
  }

  function renderAnalysis() {
    const list = current();
    const a = Store.analysis(list);
    const pct = v => (v == null ? '—' : (v >= 0 ? '+' : '') + U.n0.format(v * 100) + '%');

    const cards = [
      {
        label: 'Günlük ortalama', value: a.perDay ? U.km(a.perDay.km) + '/gün' : '—',
        sub: a.days ? `${U.n0.format(a.days)} günlük kayıt` : ''
      },
      {
        label: 'Günlük yakıt gideri', value: a.perDay ? U.money(a.perDay.spend) : '—',
        sub: a.yearly ? `12 ayda ≈ ${U.moneyShort(a.yearly.spend)}` : ''
      },
      {
        label: 'Fiyat artışının faturası', value: a.extraCost ? U.money(a.extraCost) : '—',
        sub: a.basePrice ? `İlk kayıttaki ₺${U.n2.format(a.basePrice)}/L fiyatına göre` : ''
      },
      {
        label: 'Birim fiyat değişimi', value: pct(a.priceChange),
        sub: (a.basePrice && a.lastPrice) ? `₺${U.n2.format(a.basePrice)} → ₺${U.n2.format(a.lastPrice)}/L` : ''
      }
    ];
    $('#analysisStats').innerHTML = cards.map(c => `
      <div class="stat">
        <div class="label">${U.esc(c.label)}</div>
        <div class="value">${U.esc(c.value)}</div>
        <div class="sub">${U.esc(c.sub || '')}</div>
      </div>`).join('');

    const months = a.perMonth;
    Charts.bar($('#chartCost100'), months.map(m => ({ label: U.monthLabel(m.ym), value: m.per100 ? Math.round(m.per100) : 0 })),
      { fmt: U.money, fmtY: U.moneyShort, color: '--c1' });
    $('#cost100Hint').textContent = a.lPer100
      ? `Ortalama tüketimin (${U.n1.format(a.lPer100)} L/100km) o ayın birim fiyatıyla çarpımı.`
      : 'Kilometre girilen kayıt olmadığı için hesaplanamıyor.';

    Charts.bar($('#chartDistance'), months.map(m => ({ label: U.monthLabel(m.ym), value: m.km })),
      { fmt: U.km, fmtY: v => U.n0.format(v), color: '--c2' });

    Charts.line($('#chartPriceEffect'), a.priceEffect.map(p => ({ label: U.dateLabel(p.date).slice(0, 6), value: Math.round(p.value) })),
      { fmt: U.money, fmtY: U.moneyShort, color: '--c5', zeroBased: true, area: true });
    $('#priceEffectHint').textContent = a.basePrice
      ? `Her dolumda, ilk kayıttaki ₺${U.n2.format(a.basePrice)}/L fiyatı yerine ödenen fazlanın toplamı.`
      : 'Birim fiyat bilgisi olan kayıt gerekiyor.';

    Charts.line($('#chartCumulative'), a.cumulativeSpend.map(p => ({ label: U.dateLabel(p.date).slice(0, 6), value: Math.round(p.value) })),
      { fmt: U.money, fmtY: U.moneyShort, color: '--c3', zeroBased: true, area: true });

    const rows = months.map(m => `
      <tr>
        <td>${U.esc(U.monthLabel(m.ym))}</td>
        <td class="num">${U.esc(m.count ? U.n0.format(m.count) : '—')}</td>
        <td class="num">${U.esc(m.km ? U.n0.format(m.km) : '—')}</td>
        <td class="num">${U.esc(m.liters ? U.n1.format(m.liters) : '—')}</td>
        <td class="num">${U.esc(m.avgPrice ? U.n2.format(m.avgPrice) : '—')}</td>
        <td class="num">${U.esc(m.spend ? U.n0.format(m.spend) : '—')}</td>
      </tr>`).join('');
    const tot = months.reduce((t, m) => ({
      count: t.count + m.count, km: t.km + m.km, liters: t.liters + m.liters, spend: t.spend + m.spend
    }), { count: 0, km: 0, liters: 0, spend: 0 });
    $('#monthTable').innerHTML = months.length ? `
      <table>
        <thead><tr><th>Ay</th><th class="num">Alım</th><th class="num">km</th><th class="num">Litre</th><th class="num">₺/L</th><th class="num">Harcama ₺</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td>Toplam</td>
          <td class="num">${U.n0.format(tot.count)}</td>
          <td class="num">${U.n0.format(tot.km)}</td>
          <td class="num">${U.n1.format(tot.liters)}</td>
          <td class="num">${tot.liters ? U.n2.format(tot.spend / tot.liters) : '—'}</td>
          <td class="num">${U.n0.format(tot.spend)}</td>
        </tr></tfoot>
      </table>` : '<p class="empty">Bu dönemde kayıt yok.</p>';
  }

  /** Uzun süre ya da çok kayıt boyunca yedek alınmadıysa Özet'te hatırlatır. */
  function renderBackupBanner() {
    const count = Store.allRecords().length;
    const m = Store.meta();
    const banner = $('#backupBanner');
    if (!count) { banner.hidden = true; return; }
    const days = m.lastBackupAt
      ? Math.floor((Date.now() - new Date(m.lastBackupAt)) / 86400000) : null;
    const newRecords = count - (m.lastBackupCount || 0);
    const needed = days == null || days >= 30 || newRecords >= 10;
    banner.hidden = !needed;
    if (!needed) return;
    $('#backupBannerText').textContent = days == null
      ? `${count} kayıt var, henüz hiç yedek almadın. Tarayıcı verileri silinirse hepsi gider.`
      : `Son yedek ${days} gün önce${newRecords > 0 ? `, o günden beri ${newRecords} yeni kayıt` : ''}.`;
  }

  function markBackedUp() {
    Store.setMeta({ lastBackupAt: new Date().toISOString(), lastBackupCount: Store.allRecords().length });
    renderBackupBanner();
  }

  $('#backupNowBtn').addEventListener('click', () => {
    show('veri');
    $('#exportJsonBtn').click();
  });

  /* ---------- Araçlar ---------- */

  function renderVehicles() {
    const list = Store.vehicles();
    const active = Store.activeVehicle();
    document.body.classList.toggle('multi-vehicle', list.length > 1);
    $('#vehiclePicker').hidden = list.length < 2;
    $('#vehicleSelect').innerHTML = list.map(v =>
      `<option value="${U.esc(v.id)}" ${active && v.id === active.id ? 'selected' : ''}>${U.esc(v.name)}</option>`).join('');
    $('#importTarget').textContent = active ? `“${active.name}” aracına` : 'aktif araca';

    $('#vehicleList').innerHTML = list.length ? list.map(v => `
      <li data-id="${U.esc(v.id)}">
        <div class="rec-main">${U.esc(v.name)}${v.plate ? ` <span style="color:var(--muted);font-weight:500">· ${U.esc(v.plate)}</span>` : ''}</div>
        <div class="rec-sub">${U.esc(v.fuel)}${v.tankSize ? ` · ${U.n0.format(v.tankSize)} L depo` : ''} · ${U.n0.format(Store.recordCount(v.id))} kayıt</div>
        <div class="rec-amount">${active && v.id === active.id ? '<span style="color:var(--accent);font-size:12px">aktif</span>' : ''}</div>
        <div class="rec-actions">
          ${active && v.id === active.id ? '' : '<button class="v-use">Bu araca geç</button>'}
          <button class="v-edit">Düzenle</button>
          <button class="v-del del">Sil</button>
        </div>
      </li>`).join('') : '<li class="empty">Henüz araç yok. Aşağıdan ekle.</li>';
  }

  function resetVehicleForm() {
    $('#v-id').value = ''; $('#v-name').value = ''; $('#v-plate').value = '';
    $('#v-tank').value = ''; $('#v-fuel').value = 'Motorin';
    $('#vehicleSaveBtn').textContent = 'Araç ekle';
    $('#vehicleCancelBtn').hidden = true;
  }

  $('#vehicleForm').addEventListener('submit', e => {
    e.preventDefault();
    const editing = !!$('#v-id').value;
    Store.saveVehicle({
      id: $('#v-id').value || undefined,
      name: $('#v-name').value,
      plate: $('#v-plate').value,
      tankSize: $('#v-tank').value,
      fuel: $('#v-fuel').value
    });
    resetVehicleForm();
    renderVehicles(); renderAll();
    toast(editing ? 'Araç güncellendi' : 'Araç eklendi');
  });

  $('#vehicleCancelBtn').addEventListener('click', resetVehicleForm);

  $('#vehicleSelect').addEventListener('change', e => {
    Store.setActive(e.target.value);
    renderVehicles(); renderAll(); resetForm();
    toast(`${Store.activeVehicle().name} aracına geçildi`);
  });

  $('#vehicleList').addEventListener('click', e => {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.classList.contains('v-use')) {
      Store.setActive(id);
      renderVehicles(); renderAll(); resetForm();
      toast(`${Store.activeVehicle().name} aracına geçildi`);
    } else if (e.target.classList.contains('v-edit')) {
      const v = Store.vehicles().find(x => x.id === id);
      $('#v-id').value = v.id; $('#v-name').value = v.name; $('#v-plate').value = v.plate;
      $('#v-tank').value = v.tankSize ?? ''; $('#v-fuel').value = v.fuel;
      $('#vehicleSaveBtn').textContent = 'Aracı güncelle';
      $('#vehicleCancelBtn').hidden = false;
    } else if (e.target.classList.contains('v-del')) {
      const n = Store.recordCount(id);
      const v = Store.vehicles().find(x => x.id === id);
      if (!confirm(`“${v.name}” aracı ve ona bağlı ${n} kayıt silinecek. Devam?`)) return;
      Store.removeVehicle(id);
      renderVehicles(); renderAll();
      toast('Araç silindi');
    }
  });

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
    $('#formWarn').hidden = true;
    warnKey = null;
    updateOdoHint();
  }

  /** Kilometre alanının altında son kaydı ve girilen değerin farkını gösterir. */
  function updateOdoHint() {
    const prev = Store.lastOdoBefore(F.date.value, F.id.value);
    const val = U.parseNumber(F.odo.value);
    if (!prev) {
      $('#odoHint').textContent = val == null ? 'İlk kilometre kaydı' : '';
      return;
    }
    const base = `Son: ${U.n0.format(prev.odo)} km · ${U.dateLabel(prev.date)}`;
    if (val == null) { $('#odoHint').textContent = base; return; }
    const diff = val - prev.odo;
    $('#odoHint').textContent = diff > 0
      ? `${base} · bu kayıtla +${U.n0.format(diff)} km`
      : `${base} · dikkat: ${U.n0.format(diff)} km (geriye gidiyor)`;
  }
  F.odo.addEventListener('input', updateOdoHint);
  F.date.addEventListener('change', updateOdoHint);

  function editRecord(id) {
    const r = Store.all().find(x => x.id === id);
    if (!r) return;
    F.id.value = r.id; F.date.value = r.date;
    F.odo.value = r.odo ?? ''; F.liters.value = r.liters ?? '';
    F.price.value = r.unitPrice ?? ''; F.total.value = r.total ?? '';
    F.fuel.value = r.fuel; F.station.value = r.station;
    F.full.checked = r.full; F.note.value = r.note;
    updateOdoHint();
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

    // Şüpheli girişlerde bir kez uyar, ikinci basışta kaydet
    const warnings = Store.validate({ ...rec, id: F.id.value || 'yeni' },
      { tankSize: Store.activeVehicle()?.tankSize });
    const key = JSON.stringify(rec);
    if (warnings.length && warnKey !== key) {
      warnKey = key;
      $('#formWarn').hidden = false;
      $('#formWarn').innerHTML = '<strong>Kontrol et:</strong><ul>' +
        warnings.map(w => `<li>${U.esc(w.text)}</li>`).join('') + '</ul>';
      $('#saveBtn').textContent = 'Yine de kaydet';
      return;
    }
    warnKey = null;
    $('#formWarn').hidden = true;

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
      const rec = Store.all().find(x => x.id === li.dataset.id);
      if (!rec) return;
      Store.remove(rec.id);
      renderAll();
      toast(`${U.dateLabel(rec.date)} silindi`, {
        label: 'Geri al',
        fn: () => { Store.upsert(rec); renderAll(); renderStations(); toast('Kayıt geri alındı'); }
      });
    } else if (btn.dataset.goto) show(btn.dataset.goto);
    else if (btn.classList.contains('tab')) show(btn.dataset.view);
  });

  $('#bulkToggle').addEventListener('click', () => {
    bulkMode = !bulkMode;
    selected.clear();
    renderList();
  });

  $('#recordList').addEventListener('change', e => {
    if (!e.target.classList.contains('pick')) return;
    const id = e.target.closest('li[data-id]').dataset.id;
    e.target.checked ? selected.add(id) : selected.delete(id);
    updateBulkBar();
  });

  $('#bulkBar').addEventListener('click', e => {
    const op = e.target.dataset?.bulk;
    if (!op) return;
    const ids = [...selected];
    if (!ids.length) return toast('Önce kayıt seç');
    if (op === 'delete') {
      const removed = Store.removeMany(ids);
      selected.clear();
      renderAll();
      toast(`${removed.length} kayıt silindi`, {
        label: 'Geri al',
        fn: () => { Store.addMany(removed); renderAll(); toast('Geri alındı'); }
      });
    } else {
      const full = op === 'full';
      const n = Store.setFull(ids, full);
      selected.clear();
      renderAll();
      toast(`${n} kayıt ${full ? 'tam depo' : 'kısmi dolum'} olarak işaretlendi`);
    }
  });

  $('#partialApply').addEventListener('click', () => {
    const n = Store.setFull(partialCandidates, false);
    renderAll();
    toast(`${n} kayıt kısmi dolum olarak işaretlendi`, {
      label: 'Geri al',
      fn: () => { Store.setFull(partialCandidates, true); renderAll(); }
    });
  });
  $('#partialDismiss').addEventListener('click', () => {
    partialDismissed = true;
    $('#partialCard').hidden = true;
  });

  $('#searchInput').addEventListener('input', renderList);
  $('#rangeSelect').addEventListener('change', e => {
    if (e.target.value === 'custom') {
      const all = Store.all();
      if (!$('#rangeFrom').value) $('#rangeFrom').value = all.length ? all[0].date : U.todayISO();
      if (!$('#rangeTo').value) $('#rangeTo').value = all.length ? all[all.length - 1].date : U.todayISO();
      $('#customRange').hidden = false;
      range = { from: $('#rangeFrom').value, to: $('#rangeTo').value };
    } else {
      $('#customRange').hidden = true;
      range = e.target.value;
    }
    renderAll();
  });
  ['#rangeFrom', '#rangeTo'].forEach(sel => $(sel).addEventListener('change', () => {
    range = { from: $('#rangeFrom').value, to: $('#rangeTo').value };
    renderAll();
  }));
  $('#sortSelect').addEventListener('change', renderList);
  $('#fuelFilter').addEventListener('change', renderList);
  $('#consumptionMode').addEventListener('change', renderCharts);

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
    const names = new Map(Store.vehicles().map(v => [v.id, v.name]));
    const rows = [['Araç', 'Tarih', 'Kilometre', 'Litre', 'Birim fiyat', 'Tutar', 'Yakıt', 'İstasyon', 'Tam depo', 'Not']];
    for (const r of Store.allRecords()) {
      rows.push([names.get(r.vehicleId) || '', r.date, r.odo ?? '', r.liters ?? '', r.unitPrice ?? '', r.total ?? '', r.fuel, r.station, r.full ? 'Evet' : 'Hayır', r.note]);
    }
    const csv = '﻿' + rows.map(r => r.map(c => {
      const s = String(c ?? '').replace(/\./g, ',');
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(';')).join('\r\n');
    U.download(`yakit-${U.todayISO()}.csv`, csv, 'text/csv;charset=utf-8');
    markBackedUp();
  });

  $('#exportJsonBtn').addEventListener('click', () => {
    U.download(`yakit-yedek-${U.todayISO()}.json`, JSON.stringify(Store.exportAll(), null, 2), 'application/json');
    markBackedUp();
  });

  $('#restoreBtn').addEventListener('click', () => $('#restoreInput').click());
  $('#restoreInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const count = Array.isArray(data) ? data.length : data?.records?.length;
      if (!count) throw new Error('Yedek dosyasında kayıt yok');
      if (!confirm(`${count} kayıt geri yüklenecek, mevcut tüm veriler silinecek. Devam?`)) return;
      const n = Store.importAll(data);
      renderVehicles(); renderAll(); renderStations(); resetForm();
      toast(`${n} kayıt geri yüklendi`);
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
    const av = Store.activeVehicle();
    if (!confirm(`${av ? `“${av.name}” aracının` : 'Tüm'} kayıtları kalıcı olarak silinecek. Emin misin?`)) return;
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
  renderVehicles();
  resetVehicleForm();
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

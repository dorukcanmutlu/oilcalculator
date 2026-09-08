/* Bağımlılıksız SVG grafikler */
const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const H = 190;

  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
  const mk = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  };

  /**
   * Dokunmatik ve fare için değer baloncuğu. Grafiğe dokunulunca/üzerine
   * gelinince en yakın işaret bulunur, baloncuk ve dikey kılavuz gösterilir.
   * (SVG <title> mobilde hiç çalışmadığı için elle yazıldı.)
   */
  function attachTips(host, svg, cfg, marks, { vertical = true } = {}) {
    host._marks = marks;
    if (!marks.length) return;
    svg.style.touchAction = 'pan-y';

    const bubble = document.createElement('div');
    bubble.className = 'chart-tip';
    bubble.hidden = true;
    host.appendChild(bubble);

    let cross = null;
    if (vertical) {
      cross = mk('line', {
        y1: cfg.pad.t, y2: cfg.h - cfg.pad.b, stroke: css('--muted'),
        'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: .6
      });
      cross.style.display = 'none';
      svg.insertBefore(cross, svg.firstChild);
    }

    let hideTimer = null;
    const hide = () => {
      bubble.hidden = true;
      if (cross) cross.style.display = 'none';
    };

    const show = e => {
      const rect = svg.getBoundingClientRect();
      const scale = rect.width / cfg.w || 1;
      const mx = (e.clientX - rect.left) / scale;
      const my = (e.clientY - rect.top) / scale;
      let best = null, bestD = Infinity;
      for (const m of marks) {
        const d = vertical ? Math.abs(m.x - mx) : Math.abs(m.y - my);
        if (d < bestD) { bestD = d; best = m; }
      }
      if (!best) return hide();
      bubble.hidden = false;
      bubble.innerHTML = `<b>${best.label}</b> ${best.text}`;
      const left = Math.max(6, Math.min(rect.width - 6, best.x * scale));
      bubble.style.left = left + 'px';
      bubble.style.top = Math.max(0, best.y * scale) + 'px';
      if (cross) {
        cross.style.display = '';
        cross.setAttribute('x1', best.x);
        cross.setAttribute('x2', best.x);
      }
      clearTimeout(hideTimer);
      if (e.pointerType !== 'mouse') hideTimer = setTimeout(hide, 2600);
    };

    svg.addEventListener('pointerdown', show);
    svg.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' || e.buttons) show(e);
    });
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('pointercancel', hide);
  }

  function frame(host) {
    host.innerHTML = '';
    const w = Math.max(260, host.clientWidth || host.parentElement.clientWidth || 320);
    const svg = mk('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, role: 'img' });
    host.appendChild(svg);
    return { svg, w, h: H, pad: { l: 46, r: 10, t: 12, b: 26 } };
  }
  const empty = host => { host.innerHTML = '<p class="no-data">Görüntülenecek veri yok.</p>'; };

  /** Y ekseni için okunaklı adım */
  function ticks(max, count = 4) {
    if (!(max > 0)) return [0, 1];
    const raw = max / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = ([1, 2, 2.5, 5, 10].find(m => m * mag >= raw) || 10) * mag;
    const out = [];
    // En üst çizgi her zaman en büyük değerin üstünde kalmalı
    const top = Math.ceil(max / step - 1e-9) * step;
    for (let v = 0; v <= top + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function axes(cfg, maxV, fmtY) {
    const { svg, w, h, pad } = cfg;
    const vals = ticks(maxV);
    const top = vals[vals.length - 1] || 1;
    const y = v => h - pad.b - (v / top) * (h - pad.b - pad.t);
    for (const v of vals) {
      svg.appendChild(mk('line', { x1: pad.l, x2: w - pad.r, y1: y(v), y2: y(v), stroke: css('--line'), 'stroke-width': 1 }));
      svg.appendChild(mk('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: css('--muted') }, fmtY(v)));
    }
    return { y, top };
  }

  function xLabels(cfg, items, xOf) {
    const { svg, h, pad, w } = cfg;
    const gap = 46;
    const step = Math.max(1, Math.ceil(items.length / Math.max(2, Math.floor((w - pad.l - pad.r) / gap))));
    let lastX = -Infinity;
    items.forEach((it, i) => {
      if (i % step !== 0 && i !== items.length - 1) return;
      const x = xOf(i);
      if (x - lastX < gap) return; // üst üste binmeyi önle
      lastX = x;
      const anchor = x > w - pad.r - 18 ? 'end' : x < pad.l + 18 ? 'start' : 'middle';
      svg.appendChild(mk('text', {
        x, y: h - pad.b + 15, 'text-anchor': anchor, 'font-size': 10, fill: css('--muted')
      }, it.label));
    });
  }

  /** Dikey sütun grafiği */
  function bar(host, data, { fmt = String, fmtY = String, color = '--c1' } = {}) {
    if (!data.length || data.every(d => !d.value)) return empty(host);
    const cfg = frame(host);
    const { svg, w, h, pad } = cfg;
    const max = Math.max(...data.map(d => d.value));
    const { y } = axes(cfg, max, fmtY);
    const band = (w - pad.l - pad.r) / data.length;
    const bw = Math.max(3, Math.min(34, band * .62));
    const marks = [];
    data.forEach((d, i) => {
      const cx = pad.l + band * (i + .5);
      const yv = y(d.value);
      svg.appendChild(mk('rect', {
        x: cx - bw / 2, y: Math.min(yv, h - pad.b), width: bw,
        height: Math.max(0, h - pad.b - yv), rx: 3, fill: css(color)
      }));
      marks.push({ x: cx, y: yv, label: d.label, text: fmt(d.value) });
    });
    xLabels(cfg, data, i => pad.l + band * (i + .5));
    svg.setAttribute('aria-label', `Sütun grafiği, ${data.length} değer, en yüksek ${fmt(max)}`);
    attachTips(host, svg, cfg, marks);
  }

  /** Çizgi grafiği (noktalı) */
  function line(host, data, { fmt = String, fmtY = String, color = '--c2', zeroBased = false, area = false } = {}) {
    const pts = data.filter(d => d.value != null && isFinite(d.value));
    if (pts.length < 1) return empty(host);
    const cfg = frame(host);
    const { svg, w, h, pad } = cfg;
    const maxV = Math.max(...pts.map(d => d.value));
    const minV = Math.min(...pts.map(d => d.value));
    let base = zeroBased || minV <= 0 ? 0 : Math.max(0, minV - (maxV - minV) * .35 - maxV * .02);
    if (base > 0) { // eksen etiketleri yuvarlak sayı olsun
      const first = ticks(maxV - base);
      const st = (first[1] - first[0]) || 1;
      base = Math.floor(base / st) * st;
    }
    const vals = ticks(maxV - base);
    const top = base + (vals[vals.length - 1] || 1);
    const y = v => h - pad.b - ((v - base) / (top - base)) * (h - pad.b - pad.t);
    for (const t of vals) {
      const v = base + t;
      svg.appendChild(mk('line', { x1: pad.l, x2: w - pad.r, y1: y(v), y2: y(v), stroke: css('--line'), 'stroke-width': 1 }));
      svg.appendChild(mk('text', { x: pad.l - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 10, fill: css('--muted') }, fmtY(v)));
    }
    const x = i => data.length === 1 ? (pad.l + (w - pad.l - pad.r) / 2)
      : pad.l + (i / (data.length - 1)) * (w - pad.l - pad.r);

    let d = '', started = false;
    data.forEach((p, i) => {
      if (p.value == null || !isFinite(p.value)) { started = false; return; }
      d += (started ? ' L' : ' M') + x(i) + ' ' + y(p.value);
      started = true;
    });
    if (area) {
      const pts2 = data.map((p, i) => ({ p, i })).filter(o => o.p.value != null && isFinite(o.p.value));
      if (pts2.length > 1) {
        const first = pts2[0], last = pts2[pts2.length - 1];
        const fillPath = `M${x(first.i)} ${h - pad.b} ` +
          pts2.map(o => `L${x(o.i)} ${y(o.p.value)}`).join(' ') +
          ` L${x(last.i)} ${h - pad.b} Z`;
        svg.appendChild(mk('path', { d: fillPath, fill: css(color), opacity: .14, stroke: 'none' }));
      }
    }
    svg.appendChild(mk('path', { d: d.trim(), fill: 'none', stroke: css(color), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const marks = [];
    data.forEach((p, i) => {
      if (p.value == null || !isFinite(p.value)) return;
      svg.appendChild(mk('circle', { cx: x(i), cy: y(p.value), r: pts.length > 40 ? 1.8 : 3, fill: css(color) }));
      marks.push({ x: x(i), y: y(p.value), label: p.label, text: fmt(p.value) });
    });
    xLabels(cfg, data, x);
    svg.setAttribute('aria-label', `Çizgi grafiği, ${pts.length} değer, ${fmt(minV)} – ${fmt(maxV)}`);
    attachTips(host, svg, cfg, marks);
  }

  /**
   * Yığılmış sütun: aynı ölçekte iki-üç bileşen (ör. yakıt + gider).
   * Bileşen adları için grafiğin üstünde gösterge çizilir.
   */
  function stacked(host, data, series, { fmt = String, fmtY = String } = {}) {
    const totals = data.map(d => d.values.reduce((a, v) => a + (v || 0), 0));
    if (!data.length || totals.every(t => !t)) return empty(host);
    host.innerHTML = '';

    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = series.map(s =>
      `<span><i style="background:${css(s.color)}"></i>${s.name}</span>`).join('');
    host.appendChild(legend);

    const w = Math.max(260, host.clientWidth || 320);
    const svg = mk('svg', { viewBox: `0 0 ${w} ${H}`, width: w, height: H, role: 'img' });
    host.appendChild(svg);
    const cfg = { svg, w, h: H, pad: { l: 46, r: 10, t: 12, b: 26 } };
    const { pad, h } = cfg;
    const { y } = axes(cfg, Math.max(...totals), fmtY);

    const band = (w - pad.l - pad.r) / data.length;
    const bw = Math.max(3, Math.min(34, band * .62));
    const marks = [];
    data.forEach((d, i) => {
      const cx = pad.l + band * (i + .5);
      let acc = 0;
      d.values.forEach((v, si) => {
        if (!v) { acc += v || 0; return; }
        const yTop = y(acc + v), yBottom = y(acc);
        const gap = si > 0 ? 2 : 0;                  // bileşenler arası yüzey boşluğu
        svg.appendChild(mk('rect', {
          x: cx - bw / 2, y: yTop, width: bw,
          height: Math.max(1, yBottom - yTop - gap), rx: 3, fill: css(series[si].color)
        }));
        acc += v;
      });
      marks.push({
        x: cx, y: y(totals[i]), label: d.label,
        text: d.values.map((v, si) => `${series[si].name} ${fmt(v || 0)}`).join(' · ') +
          (series.length > 1 ? ` = ${fmt(totals[i])}` : '')
      });
    });
    xLabels(cfg, data, i => pad.l + band * (i + .5));
    svg.setAttribute('aria-label', `Yığılmış sütun grafiği, ${series.map(s => s.name).join(' ve ')}`);
    attachTips(host, svg, cfg, marks);
  }

  /** Yatay sütun (kategori dağılımı) */
  function hbar(host, data, { fmt = String, max: limit = 6 } = {}) {
    const rows = data.filter(d => d.value > 0).slice(0, limit);
    if (!rows.length) return empty(host);
    host.innerHTML = '';
    const w = Math.max(260, host.clientWidth || 320);
    const rowH = 30, h = rows.length * rowH + 8;
    const svg = mk('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img' });
    const max = Math.max(...rows.map(d => d.value));
    const labelW = Math.min(120, Math.max(64, w * .3));
    const palette = ['--c1', '--c2', '--c3', '--c4', '--c5'];
    const marks = [];
    rows.forEach((d, i) => {
      const y = i * rowH + 4;
      svg.appendChild(mk('text', { x: 0, y: y + 17, 'font-size': 11, fill: css('--muted') },
        d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label));
      const bw = Math.max(2, (d.value / max) * (w - labelW - 74));
      svg.appendChild(mk('rect', { x: labelW, y: y + 5, width: bw, height: 15, rx: 3, fill: css(palette[i % palette.length]) }));
      svg.appendChild(mk('text', { x: labelW + bw + 6, y: y + 17, 'font-size': 11, fill: css('--text') }, fmt(d.value)));
      marks.push({ x: labelW + bw / 2, y: y + 12, label: d.label, text: fmt(d.value) });
    });
    svg.setAttribute('aria-label', `Yatay sütun grafiği, ${rows.length} kategori`);
    host.appendChild(svg);
    attachTips(host, svg, { w, h, pad: { t: 0, b: 0, l: 0, r: 0 } }, marks, { vertical: false });
  }

  return { bar, line, hbar, stacked };
})();

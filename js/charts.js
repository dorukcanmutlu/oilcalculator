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
  const tip = (parent, text) => parent.appendChild(mk('title', {}, text));

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
    const step = [1, 2, 2.5, 5, 10].find(m => m * mag >= raw) * mag;
    const out = [];
    for (let v = 0; v <= max + step * .001; v += step) out.push(Math.round(v * 1000) / 1000);
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
    data.forEach((d, i) => {
      const cx = pad.l + band * (i + .5);
      const yv = y(d.value);
      const rect = mk('rect', {
        x: cx - bw / 2, y: Math.min(yv, h - pad.b), width: bw,
        height: Math.max(0, h - pad.b - yv), rx: 3, fill: css(color)
      });
      tip(rect, `${d.label}: ${fmt(d.value)}`);
      svg.appendChild(rect);
    });
    xLabels(cfg, data, i => pad.l + band * (i + .5));
  }

  /** Çizgi grafiği (noktalı) */
  function line(host, data, { fmt = String, fmtY = String, color = '--c2', zeroBased = false } = {}) {
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
    svg.appendChild(mk('path', { d: d.trim(), fill: 'none', stroke: css(color), 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    data.forEach((p, i) => {
      if (p.value == null || !isFinite(p.value)) return;
      const c = mk('circle', { cx: x(i), cy: y(p.value), r: pts.length > 40 ? 1.8 : 3, fill: css(color) });
      tip(c, `${p.label}: ${fmt(p.value)}`);
      svg.appendChild(c);
    });
    xLabels(cfg, data, x);
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
    rows.forEach((d, i) => {
      const y = i * rowH + 4;
      svg.appendChild(mk('text', { x: 0, y: y + 17, 'font-size': 11, fill: css('--muted') },
        d.label.length > 16 ? d.label.slice(0, 15) + '…' : d.label));
      const bw = Math.max(2, (d.value / max) * (w - labelW - 74));
      const rect = mk('rect', { x: labelW, y: y + 5, width: bw, height: 15, rx: 3, fill: css(palette[i % palette.length]) });
      tip(rect, `${d.label}: ${fmt(d.value)}`);
      svg.appendChild(rect);
      svg.appendChild(mk('text', { x: labelW + bw + 6, y: y + 17, 'font-size': 11, fill: css('--text') }, fmt(d.value)));
    });
    host.appendChild(svg);
  }

  return { bar, line, hbar };
})();

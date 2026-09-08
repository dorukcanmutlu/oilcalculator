/*
 * Fiş fotoğrafından alanları okuma.
 *
 * İki yol var:
 *  1) Sayfa claude.ai üzerinde yayınlanmışsa `sample` yeteneği — anahtar
 *     gerekmez, okuma isteği görüntüleyenin Claude hesabından karşılanır.
 *  2) Kendi Anthropic API anahtarın — GitHub Pages gibi ortamlar için.
 *     Anahtar yalnızca bu cihazın tarayıcısında saklanır.
 */
const Receipt = (() => {
  const KEY = 'yakit-takip:ai';
  const DEFAULTS = {
    endpoint: 'https://api.anthropic.com/v1/messages',
    model: 'claude-opus-5',
    apiKey: ''
  };

  function settings() {
    try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }; }
    catch (e) { return { ...DEFAULTS }; }
  }
  function setSettings(patch) {
    const next = { ...settings(), ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* yoksay */ }
    return next;
  }

  /* ---- Sağlayıcı seçimi ---- */
  let samplePromise;
  function getSample() {
    if (!samplePromise) {
      samplePromise = Promise.resolve(window.claude?.use?.('sample') ?? null).catch(() => null);
    }
    return samplePromise;
  }

  /** 'claude' | 'apikey' | null */
  async function provider() {
    const sample = await getSample();
    if (sample) {
      try {
        const limits = await sample.limits();
        if (limits?.images) return 'claude';
      } catch (e) { /* yeteneğe erişilemedi */ }
    }
    return settings().apiKey ? 'apikey' : null;
  }

  /* ---- Görüntü hazırlama ---- */

  /** Fotoğrafı en uzun kenarı `maxPx` olacak şekilde küçültüp JPEG'e çevirir. */
  function prepare(file, maxPx = 1600, quality = 0.82) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Fotoğraf işlenemedi'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Fotoğraf açılamadı')); };
      img.src = url;
    });
  }

  const blobToBase64 = blob => new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(new Error('Fotoğraf okunamadı'));
    fr.readAsDataURL(blob);
  });

  /* ---- İstem ---- */
  const PROMPT = `Bu bir akaryakıt istasyonu fişinin fotoğrafı (çoğunlukla Türkçe, termal yazıcı çıktısı).
Fişteki bilgileri oku ve SADECE aşağıdaki JSON nesnesini döndür, başka hiçbir metin yazma:

{"date": "YYYY-MM-DD veya null",
 "liters": sayı veya null,
 "unitPrice": sayı veya null,
 "total": sayı veya null,
 "station": "istasyon/marka adı veya null",
 "fuel": "Motorin | Benzin | LPG | null",
 "confidence": "high | medium | low"}

Kurallar:
- Sayıları nokta ondalık ayracıyla ver (58.93), binlik ayracı kullanma.
- "LT", "LITRE", "MIKTAR" satırı litre; "BIRIM FIYAT", "LT FIYATI" birim fiyat;
  "TUTAR", "TOPLAM", "ODENECEK" toplam tutardır. KDV satırını tutar sanma.
- Marka için fişin başındaki isim (Shell, Opet, BP, Petrol Ofisi, Total, TP, Aytemiz...).
- "MOTORIN"/"DIZEL"/"EURO DIESEL" -> Motorin; "KURSUNSUZ"/"BENZIN"/"95"/"97" -> Benzin; "LPG"/"OTOGAZ" -> LPG.
- Okuyamadığın alanı uydurma, null bırak.
- Fişte kilometre bilgisi aranmıyor, onu boş geç.`;

  /* ---- Sağlayıcılar ---- */

  async function readWithClaude(blob) {
    const sample = await getSample();
    if (!sample) throw new Error('Claude bağlantısı yok');
    const data = await sample.json(PROMPT, { images: [blob], modelTier: 'default' });
    return data;
  }

  async function readWithApiKey(blob) {
    const cfg = settings();
    const base64 = await blobToBase64(blob);
    let res;
    try {
      res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
              { type: 'text', text: PROMPT }
            ]
          }]
        })
      });
    } catch (e) {
      throw new Error('İstek gönderilemedi. Tarayıcıdan doğrudan API çağrısı engellenmiş olabilir; ' +
        'Veri sekmesinden kendi ara sunucunun adresini uç nokta olarak verebilirsin.');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`API ${res.status}${detail ? ': ' + detail.slice(0, 160) : ''}`);
    }
    const body = await res.json();
    const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    return parseJson(text);
  }

  /** Model çıktısındaki JSON'u ayıklar (kod bloğu içinde gelebilir). */
  function parseJson(text) {
    const cleaned = String(text).replace(/```json|```/g, '').trim();
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('Fişten veri okunamadı');
    return JSON.parse(cleaned.slice(start, end + 1));
  }

  /* ---- Sonucu temizleme ---- */

  const inRange = (v, lo, hi) => (v != null && isFinite(v) && v >= lo && v <= hi ? v : null);

  /**
   * Modelin döndürdüğü değerleri makul aralıklara göre süzer, eksik olanı
   * hesaplar, tutarsızlıkta uyarı üretir.
   */
  function clean(data) {
    const warnings = [];
    const out = {
      date: U.parseDate(data?.date),
      liters: inRange(U.parseNumber(data?.liters), 0.5, 300),
      unitPrice: inRange(U.parseNumber(data?.unitPrice), 1, 1000),
      total: inRange(U.parseNumber(data?.total), 10, 500000),
      station: (data?.station ? String(data.station).trim().slice(0, 40) : ''),
      fuel: ['Motorin', 'Benzin', 'LPG'].includes(data?.fuel) ? data.fuel : '',
      confidence: ['high', 'medium', 'low'].includes(data?.confidence) ? data.confidence : 'low'
    };

    if (out.date && out.date > U.todayISO()) { warnings.push('Fişteki tarih ileri bir gün, kontrol et'); }

    const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
    if (out.liters != null && out.unitPrice != null && out.total != null) {
      const fark = Math.abs(out.liters * out.unitPrice - out.total) / out.total;
      if (fark > 0.05) {
        // Tutar ve litre fişte en okunaklı iki alan; birim fiyatı onlardan türet
        out.unitPrice = round(out.total / out.liters, 3);
        warnings.push('Litre × birim fiyat tutara uymadı; birim fiyat tutardan hesaplandı');
      }
    } else if (out.total != null && out.liters != null) {
      out.unitPrice = round(out.total / out.liters, 3);
    } else if (out.total != null && out.unitPrice != null) {
      out.liters = round(out.total / out.unitPrice, 2);
    } else if (out.liters != null && out.unitPrice != null) {
      out.total = round(out.liters * out.unitPrice, 2);
    }

    if (out.total == null && out.liters == null) warnings.push('Tutar ve litre okunamadı');
    if (out.confidence === 'low') warnings.push('Fiş net okunamadı, değerleri gözden geçir');
    return { values: out, warnings };
  }

  /** Fotoğrafı okur; {values, warnings, provider} döndürür. */
  async function read(file) {
    const kind = await provider();
    if (!kind) throw new Error('Fiş okuma için Claude bağlantısı ya da API anahtarı gerekiyor');
    const blob = await prepare(file);
    const data = kind === 'claude' ? await readWithClaude(blob) : await readWithApiKey(blob);
    return { ...clean(data), provider: kind };
  }

  return { read, provider, settings, setSettings, prepare, clean, parseJson, PROMPT };
})();

if (typeof module !== 'undefined') module.exports = Receipt;

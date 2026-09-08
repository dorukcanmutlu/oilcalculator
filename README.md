# Yakıt Takip

Akaryakıt alımlarını telefondan kaydettiğin, harcama ve tüketimini grafiklerle
gördüğün web uygulaması. Sunucu, kurulum ve üyelik yok: tek klasör statik dosya,
veriler telefonun tarayıcısında saklanır.

## Neler var

- **Hızlı giriş:** tarih, kilometre, litre, birim fiyat, tutar, istasyon, yakıt türü, not.
  Litre / birim fiyat / tutar üçlüsünden ikisini yazınca üçüncüsü otomatik hesaplanır.
- **Özet:** toplam harcama, toplam yakıt, ortalama birim fiyat, ortalama tüketim
  (L/100 km), km başına maliyet, toplam mesafe. Dönem seçilebilir (3 / 6 / 12 ay, bu yıl, tümü).
- **Grafikler:** aylık harcama, birim fiyatın zaman içindeki seyri, tüketim,
  aylık litre, istasyon dağılımı.
- **Yakıt dışı giderler:** bakım, onarım, lastik, sigorta, muayene, vergi,
  geçiş, ceza. Analiz sekmesinde yakıtla birlikte toplam araç maliyetine ve
  gerçek km maliyetine katılır.
- **İstasyon karşılaştırması:** istasyon başına ağırlıklı ortalama birim fiyat.
- **Excel dışa aktarma:** üç sayfalı `.xlsx` (Yakıt, Giderler, Aylık özet),
  tarih ve para biçimleri yerinde — bağımlılıksız yazıcıyla üretiliyor.
- **Analiz:** kayıtlardan türetilen veriler — 100 km sürmenin aylık maliyeti,
  aylara dağıtılmış gidilen yol, fiyat artışının bugüne kadarki faturası,
  kümülatif harcama, günlük km/gider ve 12 aylık tahmin, aylık özet tablosu.
- **Excel / CSV içe aktarma:** kendi tablonu yükleyip sütunları eşleştirirsin
  (`.xlsx`, `.csv`). Başlık satırı ve sütunlar otomatik tahmin edilir; Türkçe
  sayı (`1.234,56`) ve tarih (`12.02.2025`) biçimleri ile Excel tarih hücreleri
  çözülür. Excel okuma uygulamanın içinde yazılı, dış kütüphane gerekmez.
- **Çoklu araç:** her araç için ayrı kilometre/tüketim hesabı, depo hacmi
  bilgisi, tek dokunuşla araç değiştirme. Tek araç varken seçici görünmez.
- **Giriş kontrolü:** geriye giden kilometre, aynı güne ikinci kayıt, tutarsız
  tutar/litre/fiyat, aşırı fiyat sapması, mantıksız tüketim ve depo hacmini
  aşan litre için kaydetmeden önce uyarı.
- **Kısmi dolum düzeltmesi:** tam doldurulmamış alımları bulup toplu işaretler.
- **Yedekleme:** CSV / JSON dışa aktarma, JSON yedekten geri yükleme, uzun süre
  yedek alınmadıysa hatırlatma. JSON yedeği tüm araçları kapsar.
- **Telefona kurulum:** PWA — ana ekrana eklenir, çevrimdışı çalışır.

## Yayına alma (GitHub Pages)

1. GitHub'da bu deponun **Settings → Pages** bölümüne gir.
2. **Source: Deploy from a branch**, branch olarak `main` (veya bu dalı) ve `/ (root)` seç.
3. Bir iki dakika sonra adres hazır olur:
   `https://<kullanıcı-adın>.github.io/oilcalculator/`
4. Telefonda bu adresi aç → tarayıcı menüsünden **Ana ekrana ekle**. Artık
   uygulama gibi açılır ve internet olmadan da çalışır.

Yerelde denemek için:

```bash
python3 -m http.server 8000
# tarayıcıda http://localhost:8000
```

> Not: `file://` ile açarsan servis çalışanı (çevrimdışı destek) devre dışı kalır;
> gerisi yine çalışır.

## Kendi Excel'ini aktarma

1. Uygulamada **Veri** sekmesi → **Excel / CSV içe aktar** → dosyanı seç.
2. Uygulama başlık satırını ve sütunları tahmin eder; **Başlık satırı** ve alan
   eşleşmelerini kontrol edip düzelt.
3. Önizlemedeki ilk satırlar doğruysa **İçe aktar**'a bas.

Zorunlu tek alan **Tarih**. Ayrıca **Tutar** ya da **Litre** sütunlarından en az
biri gerekir; eksik olan üçüncü değer (litre / birim fiyat / tutar) hesaplanır.
Tüketim grafiği için **Kilometre** sütunu ve depoyu tam doldurduğun alımlar gerekir.
Beklenen biçim için `ornek/sablon.csv` dosyasına bakabilirsin.

## Tüketim nasıl hesaplanıyor

Grafikte iki yöntem var:

- **Kümülatif** (varsayılan): ilk kayıttan itibaren toplam litre / gidilen km.
  Excel'deki `SUM(C$2:C_önceki)/(B_i-B$2)*100` sütununun aynısı. Depoyu her
  seferinde tam doldurmasan da doğru sonuç verir.
- **Dolum arası:** iki *tam depo* alımı arasındaki litre / o aralıkta gidilen km.
  Her dolumda depoyu tam dolduruyorsan daha hassastır; arada kalan kısmi
  dolumların litresi de aralığa eklenir.

Her iki durumda da kilometre girilmemiş kayıtlar hesaba katılmaz.

## Analiz nasıl hesaplanıyor

- **100 km'nin maliyeti:** ortalama tüketim (L/100 km) × o ayın ortalama birim
  fiyatı. Tüketim sabitken maliyet artışının tamamen fiyattan geldiğini gösterir.
- **Aylık gidilen yol:** iki dolum arasındaki kilometre farkı, aradaki günlere
  eşit bölünüp aylara dağıtılır; aylık toplam, gerçek toplam mesafeye eşittir.
- **Fiyat artışının faturası:** her dolumda `litre × (o günkü fiyat − ilk kayıttaki
  fiyat)` toplanır. "Yakıtı hep ilk günkü fiyattan alsaydım ne kadar az öderdim"
  sorusunun karşılığı.
- **Günlük gider ve 12 aylık tahmin:** toplam harcama / kayıt aralığındaki gün
  sayısı; tahmin bu günlük hızın 365 katı.

## Veriler nerede duruyor

Tamamı tarayıcının `localStorage` alanında, yalnızca o cihazda. Sunucuya hiçbir
şey gönderilmez. Telefon/tarayıcı değiştirirken **Veri → JSON yedek** al, yeni
cihazda **JSON yedekten geri yükle** ile aktar. Tarayıcı verilerini temizlemek
kayıtları da siler.

## Geliştirme

```bash
npm test          # birim testler (bağımlılık yok, ~1 sn)
npm run check     # tüm js dosyalarında söz dizimi denetimi
npm run e2e       # tarayıcı duman testi (playwright gerekir)
npm run serve     # yerelde çalıştır: http://localhost:8000
```

Birim testler `node:vm` ile tarayıcı dosyalarını olduğu gibi yükler; sahte bir
`localStorage` dışında taklit yok. Kapsam: sayı/tarih ayrıştırma, kayıt
tamamlama, tüketim (kümülatif ve dolum arası), aylara km dağıtımı, analiz
büyüklükleri, giriş doğrulama, çoklu araç yalıtımı, giderler, sütun
eşleştirme, CSV ayrıştırma ve xlsx yazıcı. Her push'ta GitHub Actions
(Node 20 ve 22) koşuyor: `.github/workflows/ci.yml`.

## Dosya düzeni

```
index.html              arayüz iskeleti
css/styles.css          tema, mobil düzen (açık/koyu otomatik)
js/util.js              biçimlendirme, sayı/tarih ayrıştırma
js/store.js             localStorage kayıtları, istatistik ve tüketim hesapları
js/charts.js            bağımlılıksız SVG grafikler
js/xlsx-lite.js         .xlsx okuyucu (zip + XML), bağımlılıksız
js/xlsx-write.js        .xlsx yazıcı (stored zip + CRC32 + SpreadsheetML)
js/importer.js          CSV/XLSX okuma, sütun eşleştirme
js/app.js               arayüz mantığı
sw.js, manifest.webmanifest, icons/   PWA dosyaları
tests/run.mjs           birim testler        tests/e2e.mjs   tarayıcı testi
```

`.xlsx` dosyaları tarayıcının `DecompressionStream` desteğiyle uygulamanın
kendi içinde okunur; bu API'nin bulunmadığı çok eski tarayıcılarda yedek olarak
SheetJS CDN'den yüklenir. Bunun dışında hiçbir dış bağımlılık yoktur.

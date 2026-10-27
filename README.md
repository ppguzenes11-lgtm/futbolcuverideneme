# futbolcuverideneme

Futbolcu verileri üzerinde denemeler için statik web projesi. Veritabanı: Supabase.

- `js/config.js` — Supabase URL ve publishable anahtar
- `js/db.js` — Supabase istemcisi (`db()`)
- `index.html`, `css/style.css`, `js/app.js` — futbol veritabanı sitesi: lig/sezon/kulüp seçimi, kulüp kadrosu ve
  istatistikleri, gol ve asist krallığı, oyuncu arama, oyuncunun 8 ligdeki kariyeri

Yerelde çalıştırmak için: `npx serve .` (veya herhangi bir statik sunucu). Vercel'e doğrudan bağlanabilir.

## Galatasaray kadroları (Transfermarkt, 2000/01 → bugün)

1. Supabase > SQL Editor'de `supabase/galatasaray_kadrolar.sql` dosyasını çalıştırın.
2. Bilgisayarda https://www.transfermarkt.com sayfasını açın, F12 > Console'a
   `scripts/galatasaray_kadrolar_konsol.js` dosyasının içeriğini yapıştırıp Enter'a basın.
   Kurulum gerekmez; veriler Supabase'e yazılır, ayrıca CSV olarak indirilir.

Alternatif (Python): `pip install -r scripts/requirements.txt` ve `python scripts/galatasaray_kadrolar.py --supabase`

Her sezon için kadro sayfası çekilir (sayfalar arası 3 sn beklenir), sonuç `data/galatasaray_kadrolar.csv/.json`
dosyalarına ve `--supabase` ile `galatasaray_kadrolar` tablosuna yazılır. Belirli sezonlar için `--bas 2020 --bit 2021`.

## Futbol veritabanı (8 lig, 2000 → bugün)

Ligler: Süper Lig, Premier League, LaLiga, Serie A, Bundesliga, Ligue 1, Liga Portugal, Eredivisie.

**1. aşama — kulüpler ve oyuncu sezon istatistikleri**
1. Supabase > SQL Editor'de `supabase/veritabani.sql` dosyasını çalıştırın.
2. Bilgisayarda https://www.transfermarkt.com açın, F12 > Console'a `scripts/veritabani_konsol.js` içeriğini yapıştırıp Enter.
3. Kod en yeni sezondan geriye doğru ilerler; doğrulama isterse ya da kapatırsanız tekrar çalıştırınca kaldığı yerden devam eder.
4. Bitince SQL dosyasının sonundaki komutla yazma izinlerini kapatın.

Tablolar: `ligler`, `kulupler`, `lig_kulupleri`, `oyuncular`, `oyuncu_sezonlari` (tüm turnuvalar toplamı), `cekilen_sayfalar`.

**2. aşama — lig istatistikleri (sadece lig maçları) ve kulüp puan ortalaması**
1. Supabase > SQL Editor'de `supabase/turnuvalar.sql` dosyasını çalıştırın.
2. Transfermarkt konsolunda `scripts/lig_istatistik_konsol.js` içeriğini çalıştırın (kulüp listesi 1. aşamadan gelir).

Tablolar: `kulup_turnuvalari` (kulübün turnuvadaki maç başı puanı), `oyuncu_turnuvalari` (oyuncunun turnuvadaki istatistikleri;
`mac_basi_puan` = oyuncu sahadayken takımın puan ortalaması). İleride Şampiyonlar Ligi / Avrupa Ligi de aynı tablolara girer.

## Futbolcu Puanı (`js/puan.js`)

Bir lig sezonundaki oyuncular, sadece lig maçlarına göre 0–100 arası puanlanır. Bileşenler aynı sezon ve aynı mevki
ailesindeki oyuncular arasında yüzdelik dilime çevrilir, mevkiye göre ağırlıklandırılır:

- **Süre payı** — takımın lig dakikalarının yüzde kaçında sahadaydı
- **Takıma etkisi** — oyuncu sahadayken ve yokken takımın maç başı puanı farkı (iki taraf da en az 3 maç; örneklemle küçültülür)
- **Takım başarısı** — kulübün ligdeki puan ortalaması sırası (az süre alanlar kısmen pay alır)
- **Üretkenlik** — 90 dk başına gol ve asist (mevkiye göre gol/asist değeri)
- **Disiplin** — kart cezası
- **Şampiyonluk bonusu** — biten sezonda en yüksek puan ortalamalı kulüpte, süre oranında

Sitede: **En iyi 11** (4-3-3, 4-2-3-1, 4-4-2, 3-5-2) ve **Puan sıralaması**; her oyuncunun puan dökümü görülebilir.

**Sezon aralığı:** En iyi 11 ve Puan sıralamasında "Bitiş sezonu" seçilince dönem puanı hesaplanır:
%80 zirve (oyuncunun aralıktaki en iyi 3 sezonunun ortalaması; 3'ten az sezonu varsa eksikler 50 sayılır) +
%20 istikrar (iyi sezon değeri / 5; 90+ puanlı sezon 1, 80'lik yarım, 70 ve altı 0 sayılır). Ayarlar: `DONEM` (`js/puan.js`).

**3. aşama — piyasa değerleri ve oyuncu profili**
1. Supabase > SQL Editor'de `supabase/piyasa.sql` dosyasını çalıştırın.
2. Transfermarkt konsolunda `scripts/piyasa_konsol.js` içeriğini çalıştırın (kulüp listesi 1. aşamadan gelir).

Eklenen sütunlar: `oyuncular.dogum_tarihi / boy_cm / ayak`, `oyuncu_sezonlari.piyasa_degeri_eur / katilma_tarihi / geldigi_kulup`.

## Keşfet (`js/kesfet.js`)

Rekorlar, unvanlar ve ligler arası karşılaştırmalar. İstatistikler önceden hesaplanır:
`python scripts/kesfet_uret.py` → `veri/kesfet.json` (veri yenilendikçe tekrar çalıştırılır).

## Puan v2: piyasa değeri ve lig gücü (`js/puan.js` → `dunyaKatmani`)

- **Piyasa değeri (P, %20):** oyuncunun sezon değerinin, 8 ligde aynı mevki ailesi ve yaş grubundaki oyuncular arasındaki yüzdelik dilimi
  (ligde düzenli oynayanların en az yarısının değeri yoksa kullanılmaz; Transfermarkt değerleri ~2004'ten itibaren).
- **Lig gücü:** √(ligin ortalama kadro değeri / o sezonun en güçlü ligininki). Yalnızca "🌍 Tüm ligler" görünümünde
  çarpan olarak uygulanır: dünya puanı = lig içi puan × (0,75 + 0,25 × lig gücü).
- Puanlar önceden hesaplanır: `NODE_USE_ENV_PROXY=1 node scripts/puan_uret.mjs` → `veri/puan/<sezon>.json`
  (veri değişince tekrar çalıştırın; site dosya yoksa canlı veriden lig içi puan hesaplar).

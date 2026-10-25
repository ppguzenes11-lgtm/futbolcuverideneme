# futbolcuverideneme

Futbolcu verileri üzerinde denemeler için statik web projesi. Veritabanı: Supabase.

- `js/config.js` — Supabase URL ve publishable anahtar
- `js/db.js` — Supabase istemcisi (`db()`)
- `index.html`, `css/style.css`, `js/app.js` — Galatasaray kadroları sitesi: sezon seçimi, mevkiye göre kadro,
  tüm sezonlarda oyuncu arama, oyuncunun Galatasaray'daki sezonları

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

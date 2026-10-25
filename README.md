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

Alternatif (Python): `pip install -r requirements.txt` ve `python scripts/galatasaray_kadrolar.py --supabase`

Her sezon için kadro sayfası çekilir (sayfalar arası 3 sn beklenir), sonuç `data/galatasaray_kadrolar.csv/.json`
dosyalarına ve `--supabase` ile `galatasaray_kadrolar` tablosuna yazılır. Belirli sezonlar için `--bas 2020 --bit 2021`.

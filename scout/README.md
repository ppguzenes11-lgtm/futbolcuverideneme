# Scout

SofaScore maç ve oyuncu verisiyle iki araç:
- **Maç tahmini:** kim kazanır, karşılıklı gol, korner, kart ihtimalleri.
- **Scout:** benzer oyuncular, patlama yapması beklenen gençler, "şu takıma giderse" uyumu.

SofaScore verisi yalnızca arka planda hammadde olarak kullanılır; ham istatistikler, SofaScore
puanları ve bahis oranları hiçbir ekranda gösterilmez.

## Veri (1. aşama)
Premier Lig (17), Süper Lig (52), Eredivisie (37); 2016/17'den bugüne, bitmiş maçlar.
Aynı Supabase projesinde (futbol veritabanı), `ss_` ile başlayan tablolar:

| Tablo | İçerik |
|---|---|
| `ss_maclar` | maç bilgisi, hakem, hocalar, dizilişler, takım istatistikleri (ilk/ikinci yarı, maç sonu), olaylar, eksik oyuncular, oranlar |
| `ss_oyuncu_mac` | her maçta oynayan her oyuncunun dakikası, puanı ve istatistik dizisi (`ist`) |
| `ss_anahtarlar` | `ist` dizisindeki sıranın hangi istatistik olduğu |
| `ss_oyuncular` | oyuncu kimliği (doğum, uyruk, boy, ayak, mevki) — Transfermarkt eşleştirmesi için |
| `ss_takimlar` | takım adları |

1. Supabase SQL Editor'da `supabase/sofascore.sql` çalıştırılır (tablolar + geçici yazma izni).
2. https://www.sofascore.com açılır, F12 > Console'a `scripts/sofascore_konsol.js` yapıştırılır.
   İPTAL = 3 maçlık deneme, TAMAM = tam çekim. Kaldığı yerden devam eder.
3. Bitince `sofascore.sql` sonundaki komutla yazma izni kapatılır.

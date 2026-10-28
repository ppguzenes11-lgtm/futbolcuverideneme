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

## Maç tahmini (`js/tahmin.js`)
Scout sayfasındaki **🔮 Tahmin** sekmesi. Model tarayıcıda, ligin maçlarından kurulur:
- Gol: takım hücum/savunma gücü + ev avantajı (Dixon-Coles), hedef = %50 gol + %50 xG, yakın maçlar daha ağır
  (yarılanma 240 gün), az maçlı takım ortalamaya, lige yeni gelen takım daha zayıf başlangıca çekilir; toplam gol
  beklentisi %70 lig ortalamasına çekilir.
- Korner ve kart: aynı güç modeli + negatif binom; kartta hakem çarpanı.
- Karne: son 1 yılın her maçı yalnızca kendinden önceki verilerle tahmin edilir, bahis piyasasıyla (Brier) kıyaslanır.
Ayarlar `AYAR` nesnesinde; veri arttıkça yeniden ayarlanmalı.

## Bilgi tablosu (`scout/analiz/`)
Scout sayfasındaki **📊 Analiz** sekmesi. Veri arttıkça yeniden üretilir:
```
python scout/analiz/veri_indir.py /tmp/pl 17
python scout/analiz/pl_analiz.py /tmp/pl veri/scout_pl_analiz.json
```
İçerik: lig özeti, puanla ilişkili takım özellikleri (Pearson r), ilk yarı → ikinci yarı tahmin gücü, oyun tarzı kümeleri
(k-means), maç dinamikleri (ilk gol, devre, kırmızı kart, dakika dağılımı), xG'ye göre beklenen puan (şans tablosu),
oyuncu özellikleri (nota göre r, büyük/küçük takım oyuncuları Cohen d), oyuncu etkisi (oynadı/oynamadı), gençler, hakemler.
Yaş eğrisi 10 sezon gelince eklenecek (4 sezonla sonuç gürültülü).

## Tahmin laboratuvarı (`scout/analiz/model_lab.py`)
Maçtan önce bilinen bilgilerle (güç, form, dinlenme, eksikler, ilk 11, mevcut Dixon-Coles) özellik üretir; modelleri
ileriye doğru sınar (her test sezonu yalnızca önceki sezonlarla eğitilir) ve bahis piyasasıyla kıyaslar.
`python scout/analiz/model_lab.py /tmp/pl veri/scout_model_lab.json` — sonuç Analiz sekmesinde "Tahmin laboratuvarı".

## Yeni tahmin modeli (sitede canlı)
Tahmin sekmesindeki 1-X-2 olasılıkları = mevcut Dixon-Coles + son maçlardaki xG formu, lojistik regresyonla
(`js/tahmin.js`: `xgFormu`, `yeniOzellik`, `yeniOlasilik`). Katsayılar `veri/scout_model_katsayi.json` (lig bazında);
yeni veri gelince yeniden eğitin:
```
node scout/analiz/ozellik_cikar.mjs /tmp/pl /tmp/pl/oz17.json
python scout/analiz/model_egit.py /tmp/pl/oz17.json 17 veri/scout_model_katsayi.json
```
Katsayısı olmayan ligde mevcut model kullanılır. İlk 11'li sürüm, maç öncesi kadroları otomatik çeken bir
sistem kurulunca eklenecek.

## Kupon simülatörü (🎲 Kupon sekmesi)
Geçmiş maçlarda, modelin maçı görmeden ürettiği olasılıklarla kupon kurar ve sonuçları açar. Pazarlar: maç sonucu,
çifte şans, ilk yarı, gol çizgileri, karşılıklı gol, korner, kart, ilk gol. "Stratejileri yarıştır" her haftada bir kupon
kurarak stratejileri (model + oranlar birleşimi, model, değer, rastgele) tutma oranı ve kâr/zararla kıyaslar. Veri: `veri/scout_kupon_gecmis.json`
```
node scout/analiz/pazar_cikar.mjs /tmp/pl /tmp/pl/pazar17.json
python scout/analiz/kupon_veri.py /tmp/pl/pazar17.json /tmp/pl/takimlar.json /tmp/pl/maclar.json veri/scout_kupon_gecmis.json
```

## Kazanç araştırması (`scout/analiz/arastirma.py`, `ozellikler.py`)
Bütün pazarlarda (maç sonucu, gol alt/üst, karşılıklı gol, korner, kart) piyasa + model + maç bilgileri (form, xG, aralarındaki
maçlar, iç saha/deplasman formu, oyun tarzı, korner/kart eğilimi, hakem, eksikler, ilk 11) ile modeller kurar; eğitim
(< Temmuz 2025) → doğrulama (Temmuz–Aralık 2025, seçim) → son sınav (2026, bir kez) düzeniyle bahis kurallarını sınar.
Bozuk açılış oranları (çizgi değişince kalan) ayıklanır. Çıktı Analiz sekmesinde "Para kazandırır mı?".
```
python scout/analiz/arastirma.py /tmp/pl veri/scout_kupon_gecmis.json /tmp/pl/arastirma.json && cp /tmp/pl/arastirma_site.json veri/scout_arastirma.json
```

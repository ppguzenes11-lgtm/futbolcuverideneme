"""Scout — Premier Lig bilgi tablosu: takım tarzı, başarı, maç dinamikleri, oyuncular, hakemler.

SofaScore verisinden (ss_ tabloları) istatistiksel çıkarımlar üretir ve sitenin okuduğu JSON'u yazar.
Kullanım:
    python veri_indir.py <klasör> 17
    python pl_analiz.py <klasör> ../../veri/scout_pl_analiz.json

Yöntem notları (sitede de özetlenir):
- Takım-sezon ölçüleri maç başı ortalamadır; ilişkiler Pearson korelasyonu (r) ile ölçülür.
  Korelasyon nedensellik değildir: "başarılı takımlar X'i daha çok yapıyor" demektir.
- Oyun tarzları, kaliteden bağımsız tarz ölçüleri (topa sahip olma, uzun top payı, pres vb.) standartlaştırılıp
  k-ortalamalar (k-means) ile gruplanarak bulunur.
- Beklenen puan (xPts): her maçta iki takımın xG'si Poisson dağılımına konup kazanma/beraberlik/yenilgi
  olasılığı hesaplanır.
- Oyuncu ölçüleri 90 dakika başınadır; bir sezonda en az 900 dakika oynayanlar kullanılır.
"""
import json
import math
import re
import os
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

import numpy as np

KLASOR = sys.argv[1] if len(sys.argv) > 1 else '.'
CIKTI = sys.argv[2] if len(sys.argv) > 2 else 'scout_pl_analiz.json'
yukle = lambda ad: json.load(open(os.path.join(KLASOR, ad + '.json')))

MACLAR = sorted(yukle('maclar'), key=lambda m: m['tarih'])
OYUNCU_MAC = yukle('oyuncu_mac')
OYUNCULAR = {o['id']: o for o in yukle('oyuncular')}
TAKIM = {t['id']: t['ad'] for t in yukle('takimlar')}
IDX = {a['anahtar']: a['sira'] - 1 for a in yukle('anahtarlar')}

SEZONLAR = sorted({m['sezon'] for m in MACLAR})
MAC_SAY = Counter(m['sezon'] for m in MACLAR)
TAM_SEZON = [s for s in SEZONLAR if MAC_SAY[s] >= 300]      # korelasyon ve tarz için bitmiş (ya da neredeyse) sezonlar
GUNCEL = SEZONLAR[-1]
MAC = {m['id']: m for m in MACLAR}

def kucuk(s):
    """Cümle içinde ilk harfi küçült (xG, PPDA gibi kısaltmalara dokunma; Türkçe İ/I doğru)."""
    if len(s) > 1 and s[1].isupper():
        return s
    return {'İ': 'i', 'I': 'ı'}.get(s[0], s[0].lower()) + s[1:]


yuvarla = lambda x, b=2: None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), b)
yuzde = lambda a, b: 100.0 * a / b if b else float('nan')


def r_pearson(x, y):
    x, y = np.asarray(x, float), np.asarray(y, float)
    ok = ~(np.isnan(x) | np.isnan(y))
    x, y = x[ok], y[ok]
    if len(x) < 8 or x.std() == 0 or y.std() == 0:
        return float('nan'), len(x)
    return float(np.corrcoef(x, y)[0, 1]), len(x)


def guc(r):
    a = abs(r)
    return 'çok güçlü' if a >= .8 else 'güçlü' if a >= .6 else 'orta' if a >= .4 else 'zayıf' if a >= .2 else 'yok denecek kadar az'


# ============================================================ Takım-maç satırları
def ist(S, k, i, toplam=False):
    """Takım istatistiği: i=0 ev, 1 deplasman. toplam=True → [başarılı, başarılı, toplam, toplam] dizisinin toplamı."""
    v = S.get(k)
    if v is None:
        return None
    j = i + 2 if toplam else i
    return v[j] if j < len(v) else None


SAYIM_ANAHTARLARI = {'redCards', 'yellowCards', 'bigChanceCreated', 'bigChanceMissed', 'bigChanceScored', 'offsides', 'hitWoodwork',
                     'goalkeeperSaves', 'accurateThroughBall', 'fouledFinalThird', 'blockedScoringAttempt'}

TAKIM_MAC = []   # her maç için iki satır (ev ve deplasman)
for m in MACLAR:
    S = (m['istatistik'] or {}).get('ALL') or {}
    for i in (0, 1):
        o = 1 - i
        g, y = (m['ev_gol'], m['dep_gol']) if i == 0 else (m['dep_gol'], m['ev_gol'])
        if g is None:
            continue

        def d(k, j=i, toplam=False):
            v = ist(S, k, j, toplam)
            if v is None and k in SAYIM_ANAHTARLARI and S:
                return 0.0
            return None if v is None else float(v)

        pas, rpas = d('passes'), d('passes', o)
        mudahale = [d('totalTackle'), d('interceptionWon'), d('fouls')]
        TAKIM_MAC.append({
            'mac': m['id'], 'sezon': m['sezon'], 'takim': m['ev_id'] if i == 0 else m['dep_id'], 'rakip': m['dep_id'] if i == 0 else m['ev_id'],
            'ev': i == 0, 'gol': g, 'yenen': y, 'puan': 3 if g > y else 1 if g == y else 0,
            'iy_gol': (m['ev_iy'], m['dep_iy'])[i], 'iy_yenen': (m['ev_iy'], m['dep_iy'])[o],
            'topa_sahip': d('ballPossession'), 'pas': pas, 'pas_isabet': yuzde(d('accuratePasses'), pas) if pas else None,
            'uzun_top_payi': yuzde(d('accurateLongBalls', toplam=True), pas) if pas and d('accurateLongBalls', toplam=True) is not None else None,
            'orta': d('accurateCross', toplam=True), 'sut': d('totalShotsOnGoal'), 'isabetli_sut': d('shotsOnGoal'),
            'ic_sut_payi': yuzde(d('totalShotsInsideBox'), d('totalShotsOnGoal')) if d('totalShotsOnGoal') else None,
            'xg': d('expectedGoals'), 'xga': d('expectedGoals', o), 'buyuk_firsat': d('bigChanceCreated'), 'verilen_buyuk_firsat': d('bigChanceCreated', o),
            'son_bolge': d('finalThirdEntries'), 'ceza_sahasi_temas': d('touchesInOppBox'),
            'top_kapma': d('totalTackle'), 'araya_girme': d('interceptionWon'), 'top_kazanma': d('ballRecovery'),
            'ppda': rpas / sum(mudahale) if rpas and None not in mudahale and sum(mudahale) else None,
            'ikili_yuzde': d('duelWonPercent'), 'hava_yuzde': yuzde(d('aerialDuelsPercentage'), d('aerialDuelsPercentage', toplam=True)) if d('aerialDuelsPercentage', toplam=True) else None,
            'hava_sayisi': d('aerialDuelsPercentage', toplam=True),
            'calim': d('dribblesPercentage'), 'faul': d('fouls'), 'sari': d('yellowCards'), 'korner': d('cornerKicks'),
            'km': d('kilometersCovered'), 'sprint': d('numberOfSprints'), 'kurtaris': d('goalkeeperSaves'), 'rakip_sut': d('totalShotsOnGoal', o),
            'uzak_sut_payi': yuzde(d('totalShotsOutsideBox'), d('totalShotsOnGoal')) if d('totalShotsOnGoal') else None,
        })

# ============================================================ Takım-sezon tablosu
OLCULER = [  # anahtar, ad, birim, tarz ölçüsü mü (kaliteden bağımsız oyun biçimi)
    ('topa_sahip', 'Topa sahip olma', '%', True), ('pas', 'Pas sayısı', '', True), ('pas_isabet', 'Pas isabeti', '%', False),
    ('uzun_top_payi', 'Uzun top payı (pasların içinde)', '%', True), ('orta', 'Orta denemesi', '', True),
    ('sut', 'Şut', '', False), ('isabetli_sut', 'İsabetli şut', '', False), ('ic_sut_payi', 'Ceza sahası içinden şut payı', '%', True),
    ('xg', 'Üretilen xG (beklenen gol)', '', False), ('xga', 'Rakibe verilen xG', '', False),
    ('buyuk_firsat', 'Büyük fırsat yaratma', '', False), ('verilen_buyuk_firsat', 'Rakibe verilen büyük fırsat', '', False),
    ('son_bolge', 'Son üçte bire giriş', '', False), ('ceza_sahasi_temas', 'Rakip ceza sahasında topla buluşma', '', False),
    ('top_kapma', 'Top kapma denemesi', '', True), ('araya_girme', 'Araya girme', '', True), ('top_kazanma', 'Top kazanma', '', False),
    ('ppda', 'Pres ölçüsü PPDA (düşük = yoğun pres)', '', True), ('ikili_yuzde', 'İkili mücadele kazanma', '%', False),
    ('hava_yuzde', 'Hava topu kazanma', '%', False), ('hava_sayisi', 'Hava topu mücadelesi sayısı', '', True),
    ('calim', 'Başarılı çalım', '', False), ('faul', 'Faul', '', True), ('sari', 'Sarı kart', '', True), ('korner', 'Korner', '', False),
    ('km', 'Koşu mesafesi (km)', '', True), ('sprint', 'Sprint sayısı', '', True), ('kurtaris', 'Kaleci kurtarışı', '', False),
    ('rakip_sut', 'Rakibin şutu', '', False), ('uzak_sut_payi', 'Ceza sahası dışından şut payı', '%', True),
]
OLCU_AD = {k: a for k, a, _, _ in OLCULER}

ts = defaultdict(list)
for r in TAKIM_MAC:
    ts[(r['sezon'], r['takim'])].append(r)

TAKIM_SEZON = []
for (sezon, takim), rs in ts.items():
    t = {'sezon': sezon, 'takim': takim, 'ad': TAKIM.get(takim, '?'), 'mac': len(rs),
         'puan': sum(r['puan'] for r in rs), 'gol': sum(r['gol'] for r in rs), 'yenen': sum(r['yenen'] for r in rs)}
    t['ppg'] = t['puan'] / t['mac']
    t['averaj_mac'] = (t['gol'] - t['yenen']) / t['mac']
    for k, *_ in OLCULER:
        v = [r[k] for r in rs if r[k] is not None]
        t[k] = float(np.mean(v)) if len(v) >= 0.8 * len(rs) else float('nan')
    TAKIM_SEZON.append(t)

# Sıralama (puan, averaj, atılan gol)
for s in SEZONLAR:
    tablo = sorted([t for t in TAKIM_SEZON if t['sezon'] == s], key=lambda t: (-t['puan'], -(t['gol'] - t['yenen']), -t['gol']))
    for i, t in enumerate(tablo):
        t['sira'] = i + 1
TS_TAM = [t for t in TAKIM_SEZON if t['sezon'] in TAM_SEZON and t['mac'] >= 28]
takim_sezon_ad = lambda t: f"{t['ad']} {t['sezon']}"

# ============================================================ 1. Lig özeti
bolumler = []
ozet_satir = []
for s in SEZONLAR:
    ms = [m for m in MACLAR if m['sezon'] == s and m['ev_gol'] is not None]
    n = len(ms)
    gol = sum(m['ev_gol'] + m['dep_gol'] for m in ms)
    ev = sum(m['ev_gol'] > m['dep_gol'] for m in ms)
    ber = sum(m['ev_gol'] == m['dep_gol'] for m in ms)
    kg = sum(m['ev_gol'] > 0 and m['dep_gol'] > 0 for m in ms)
    ust = sum(m['ev_gol'] + m['dep_gol'] > 2.5 for m in ms)
    kor = [r['korner'] for r in TAKIM_MAC if r['sezon'] == s and r['korner'] is not None]
    kart = [r['sari'] for r in TAKIM_MAC if r['sezon'] == s and r['sari'] is not None]
    pen = sum(1 for m in ms for o in (m['olaylar'] or []) if o['t'] == 'goal' and o['s'] == 'penalty')
    kirmizi = sum(1 for m in ms for o in (m['olaylar'] or []) if o['t'] == 'card' and o['s'] in ('red', 'yellowRed'))
    ozet_satir.append([s + (' (sürüyor)' if s == GUNCEL and n < 300 else ''), n, yuvarla(gol / n), f"%{yuzde(ev, n):.0f}", f"%{yuzde(ber, n):.0f}",
                       f"%{yuzde(n - ev - ber, n):.0f}", f"%{yuzde(kg, n):.0f}", f"%{yuzde(ust, n):.0f}",
                       yuvarla(2 * np.mean(kor), 1), yuvarla(2 * np.mean(kart), 1), pen, kirmizi])
tum = [m for m in MACLAR if m['ev_gol'] is not None]
N = len(tum)
ev_kaz = yuzde(sum(m['ev_gol'] > m['dep_gol'] for m in tum), N)
dep_kaz = yuzde(sum(m['ev_gol'] < m['dep_gol'] for m in tum), N)
mac_gol = np.mean([m['ev_gol'] + m['dep_gol'] for m in tum])
ev_ppg = np.mean([r['puan'] for r in TAKIM_MAC if r['ev']])
dep_ppg = np.mean([r['puan'] for r in TAKIM_MAC if not r['ev']])
bolumler.append({
    'id': 'ozet', 'baslik': 'Lig özeti', 'ikon': '📋',
    'ozet': f"{N} maçta maç başına {mac_gol:.2f} gol atıldı. Ev sahibi galibiyeti oranı %{ev_kaz:.0f}, deplasman galibiyeti %{dep_kaz:.0f}; "
            f"ev sahibi olmak maç başına ortalama {ev_ppg - dep_ppg:.2f} puan fazladan getiriyor ({ev_ppg:.2f}'ye karşı {dep_ppg:.2f}).",
    'bloklar': [
        {'tur': 'istatistik', 'ogeler': [
            {'deger': f'{N}', 'etiket': 'İncelenen maç'}, {'deger': f'{mac_gol:.2f}', 'etiket': 'Maç başı gol'},
            {'deger': f'%{ev_kaz:.0f}', 'etiket': 'Ev sahibi kazanıyor'}, {'deger': f'+{ev_ppg - dep_ppg:.2f}', 'etiket': 'Ev avantajı (puan/maç)'}]},
        {'tur': 'tablo', 'baslik': 'Sezon sezon', 'sutunlar': ['Sezon', 'Maç', 'Gol/maç', 'Ev', 'Ber.', 'Dep.', 'KG', '2,5 üst', 'Korner/maç', 'Sarı/maç', 'Penaltı golü', 'Kırmızı'],
         'sayisal': list(range(1, 12)), 'satirlar': ozet_satir},
    ]})

# ============================================================ 2. Başarının sırrı (takım ölçüleri ↔ puan)
ppg = [t['ppg'] for t in TS_TAM]
iliski = []
for k, ad, birim, tarz in OLCULER:
    r, n = r_pearson([t[k] for t in TS_TAM], ppg)
    if not math.isnan(r):
        iliski.append({'k': k, 'ad': ad, 'r': r, 'n': n, 'tarz': tarz})
iliski.sort(key=lambda x: -abs(x['r']))
xgfark = [t['xg'] - t['xga'] for t in TS_TAM]
r_xg, _ = r_pearson(xgfark, ppg)
r_av, _ = r_pearson([t['averaj_mac'] for t in TS_TAM], ppg)
# Sezonun ilk yarısındaki hangi ölçü ikinci yarının puanını en iyi tahmin ediyor?
yari = {'puan': [], 'averaj': [], 'xg_fark': [], 'sut_fark': [], 'topa_sahip': [], 'hedef': []}
for t in TS_TAM:
    rs = sorted(ts[(t['sezon'], t['takim'])], key=lambda r: MAC[r['mac']]['tarih'])
    a, b = rs[:len(rs) // 2], rs[len(rs) // 2:]
    if any(r['xg'] is None or r['sut'] is None or r['rakip_sut'] is None for r in a):
        continue
    yari['puan'].append(np.mean([r['puan'] for r in a]))
    yari['averaj'].append(np.mean([r['gol'] - r['yenen'] for r in a]))
    yari['xg_fark'].append(np.mean([r['xg'] - r['xga'] for r in a]))
    yari['sut_fark'].append(np.mean([r['sut'] - r['rakip_sut'] for r in a]))
    yari['topa_sahip'].append(np.mean([r['topa_sahip'] for r in a]))
    yari['hedef'].append(np.mean([r['puan'] for r in b]))
YARI_AD = {'xg_fark': 'xG farkı (üretilen − verilen)', 'sut_fark': 'Şut farkı', 'averaj': 'Gol averajı', 'puan': 'Toplanan puan', 'topa_sahip': 'Topa sahip olma'}
yari_r = sorted(((YARI_AD[k], r_pearson(yari[k], yari['hedef'])[0]) for k in YARI_AD), key=lambda x: -x[1])
tarz_iliski = [x for x in iliski if x['tarz']]
en_tarz = tarz_iliski[0]


def cubuk_iliski(liste):
    return [{'ad': x['ad'], 'deger': yuvarla(x['r'], 2), 'alt': f"{guc(x['r'])} {'olumlu' if x['r'] > 0 else 'olumsuz'} ilişki",
             'ton': 'pozitif' if x['r'] > 0 else 'negatif'} for x in liste]


# Profil: şampiyon / ilk 4 / orta / küme düşen
gruplar = [('Şampiyonlar', lambda t: t['sira'] == 1), ('İlk 4', lambda t: t['sira'] <= 4), ('5.–14.', lambda t: 5 <= t['sira'] <= 14),
           ('Küme düşenler', lambda t: t['sira'] >= 18)]
profil_olcu = ['topa_sahip', 'pas_isabet', 'uzun_top_payi', 'sut', 'xg', 'xga', 'buyuk_firsat', 'ppda', 'ikili_yuzde', 'hava_yuzde', 'orta', 'faul', 'km']
profil = []
for k in profil_olcu:
    satir = [OLCU_AD[k]]
    for _, f in gruplar:
        v = [t[k] for t in TS_TAM if f(t) and not math.isnan(t[k])]
        satir.append(yuvarla(np.mean(v), 1 if k not in ('xg', 'xga', 'ppda') else 2) if v else None)
    profil.append(satir)
bolumler.append({
    'id': 'basari', 'baslik': 'Başarının sırrı: puanla en çok ilişkili takım özellikleri', 'ikon': '🏆',
    'ozet': f"{len(TS_TAM)} takım-sezonda her özelliğin maç başı puanla ilişkisi ölçüldü. "
            f"Beklenen gol farkı (üretilen xG − verilen xG) puanla {guc(r_xg)} ilişkili (r = {r_xg:.2f}); tek başına "
            f"puan farklarını açıklama gücü %{100 * r_xg ** 2:.0f}. Daha da önemlisi geleceği gösteriyor: sezonun ilk yarısında en iyi tahminci "
            f"'{kucuk(yari_r[0][0])}' (r = {yari_r[0][1]:.2f}); toplanan puanın kendisi ise r = {dict(yari_r)['Toplanan puan']:.2f}. "
            f"Oyun tarzı ölçüleri arasında puanla en güçlü ilişki '{kucuk(en_tarz['ad'])}' (r = {en_tarz['r']:.2f}).",
    'bloklar': [
        {'tur': 'cubuk', 'baslik': 'Tüm ölçüler: puanla ilişki (r)', 'not': 'r = 1 kusursuz olumlu ilişki, 0 ilişki yok, −1 kusursuz ters ilişki. Korelasyon nedensellik değildir.',
         'aralik': [-1, 1], 'ogeler': cubuk_iliski(iliski[:16])},
        {'tur': 'cubuk', 'baslik': 'Sezonun ilk yarısındaki hangi ölçü ikinci yarının puanını en iyi tahmin ediyor?',
         'not': f'{len(yari["hedef"])} takım-sezon. Şansın etkisi az olan ölçüler geleceği daha iyi gösterir.', 'aralik': [-1, 1],
         'ogeler': [{'ad': a, 'deger': yuvarla(r, 2), 'alt': guc(r), 'ton': 'pozitif' if r > 0 else 'negatif'} for a, r in yari_r]},
        {'tur': 'cubuk', 'baslik': 'Yalnızca oyun tarzı ölçüleri', 'not': 'Kaliteden çok "nasıl oynandığını" anlatan ölçüler.', 'aralik': [-1, 1],
         'ogeler': cubuk_iliski(tarz_iliski)},
        {'tur': 'tablo', 'baslik': 'Ortalama profil: şampiyonlar ve küme düşenler nasıl oynuyor?', 'not': 'Maç başı ortalamalar.',
         'sutunlar': ['Ölçü'] + [g for g, _ in gruplar], 'sayisal': [1, 2, 3, 4], 'satirlar': profil},
    ]})

# ============================================================ 3. Oyun tarzları (k-means)
TARZ = ['topa_sahip', 'uzun_top_payi', 'orta', 'ppda', 'uzak_sut_payi', 'faul', 'hava_sayisi']
X = np.array([[t[k] for k in TARZ] for t in TS_TAM], float)
ok = ~np.isnan(X).any(axis=1)
TS_K = [t for t, o in zip(TS_TAM, ok) if o]
X = X[ok]
mu, sd = X.mean(0), X.std(0)
Z = (X - mu) / sd


def kmeans(Z, k, tekrar=60, seed=7):
    rng = np.random.default_rng(seed)
    en = None
    for _ in range(tekrar):
        C = Z[rng.choice(len(Z), k, replace=False)]
        for _ in range(200):
            et = ((Z[:, None, :] - C[None]) ** 2).sum(-1).argmin(1)
            C2 = np.array([Z[et == j].mean(0) if (et == j).any() else C[j] for j in range(k)])
            if np.allclose(C, C2):
                break
            C = C2
        sse = ((Z - C[et]) ** 2).sum()
        if en is None or sse < en[0]:
            en = (sse, et, C)
    return en


_, ETIKET, MERKEZ = kmeans(Z, 5)
IFADE = {  # (ölçü, yön) → tarz ifadesi
    ('topa_sahip', 1): 'topa sahip olan', ('topa_sahip', -1): 'topu rakibe bırakan',
    ('uzun_top_payi', 1): 'uzun toplu', ('uzun_top_payi', -1): 'kısa paslı',
    ('orta', 1): 'kanattan ortalı', ('orta', -1): 'ortayı az kullanan',
    ('ppda', -1): 'önde pres yapan', ('ppda', 1): 'geride bekleyen',
    ('uzak_sut_payi', 1): 'uzaktan şut deneyen', ('uzak_sut_payi', -1): 'ceza sahasına kadar giren',
    ('faul', 1): 'sert (bol faullü)', ('faul', -1): 'az faul yapan',
    ('hava_sayisi', 1): 'fiziksel / hava topu ağırlıklı', ('hava_sayisi', -1): 'yerden oynayan',
}
tarz_gruplari = []
for j in range(len(MERKEZ)):
    uyeler = [t for t, e in zip(TS_K, ETIKET) if e == j]
    sira = np.argsort(-np.abs(MERKEZ[j]))
    ad = ', '.join(IFADE[(TARZ[i], 1 if MERKEZ[j][i] > 0 else -1)] for i in sira[:2]).capitalize()
    en_iyi = sorted(uyeler, key=lambda t: -t['ppg'])
    tarz_gruplari.append({
        'ad': ad, 'n': len(uyeler), 'ppg': np.mean([t['ppg'] for t in uyeler]), 'sira': np.mean([t['sira'] for t in uyeler]),
        'sampiyon': sum(t['sira'] == 1 for t in uyeler), 'ilk4': sum(t['sira'] <= 4 for t in uyeler), 'dusen': sum(t['sira'] >= 18 for t in uyeler),
        'ornek': ', '.join(takim_sezon_ad(t) for t in en_iyi[:3]) + (f" … {takim_sezon_ad(en_iyi[-1])}" if len(en_iyi) > 3 else ''),
        'profil': {TARZ[i]: float(MERKEZ[j][i]) for i in range(len(TARZ))},
    })
tarz_gruplari.sort(key=lambda g: -g['ppg'])
en_basarili = tarz_gruplari[0]
bolumler.append({
    'id': 'tarz', 'baslik': 'Oyun tarzları: hangi tarz kazanıyor?', 'ikon': '🧭',
    'ozet': f"Takım-sezonlar 7 tarz ölçüsüne göre (topa sahip olma, uzun top payı, orta, pres, uzaktan şut, faul, hava topu) 5 gruba ayrıldı. "
            f"En başarılı grup '{kucuk(en_basarili['ad'])}' takımlar: maç başı {en_basarili['ppg']:.2f} puan, ortalama {en_basarili['sira']:.1f}. sıra"
            + (f", {en_basarili['sampiyon']} şampiyonluk" if en_basarili['sampiyon'] else '') + '.',
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'Tarz grupları (en başarılıdan en başarısıza)',
         'sutunlar': ['Tarz', 'Takım-sezon', 'Puan/maç', 'Ort. sıra', 'Şampiyon', 'İlk 4', 'Küme düşen', 'Örnekler'],
         'sayisal': [1, 2, 3, 4, 5, 6], 'satirlar': [[g['ad'], g['n'], yuvarla(g['ppg']), yuvarla(g['sira'], 1), g['sampiyon'], g['ilk4'], g['dusen'], g['ornek']] for g in tarz_gruplari]},
        {'tur': 'tablo', 'baslik': 'Grupların tarz profili', 'not': '0 = lig ortalaması; +1 ortalamanın bir standart sapma üstü, −1 altı.',
         'sutunlar': ['Tarz'] + ['Topa sahip', 'Uzun top', 'Orta', 'PPDA (düşük=pres)', 'Uzaktan şut', 'Faul', 'Hava topu'], 'sayisal': list(range(1, 8)),
         'satirlar': [[g['ad']] + [yuvarla(g['profil'][k], 1) for k in TARZ] for g in tarz_gruplari]},
    ]})

# ============================================================ 4. Maç dinamikleri
def sonuc_dagilim(liste):  # liste: ['G','B','M']
    n = len(liste)
    c = Counter(liste)
    return n, yuzde(c['G'], n), yuzde(c['B'], n), yuzde(c['M'], n)


# Kendi kalesine golde isHome'un hangi takımı gösterdiği verinin kendisinden doğrulanır
def gol_listesi(m, kk_tersi):
    gl = []
    for o in (m['olaylar'] or []):
        if o['t'] != 'goal':
            continue
        h = o['h']
        if o['s'] == 'ownGoal' and kk_tersi:
            h = not h
        gl.append(((o['d'] or 0) + (o['e'] or 0) / 100, h, o))
    return sorted(gl, key=lambda x: x[0])


uyum = {False: 0, True: 0}
for kk in (False, True):
    for m in tum:
        gl = gol_listesi(m, kk)
        uyum[kk] += sum(h for _, h, _ in gl) == m['ev_gol'] and sum(not h for _, h, _ in gl) == m['dep_gol']
KK_TERS = uyum[True] > uyum[False]

ilk_gol, ilk_gol_ev, ilk_gol_dep, iy_onde, geri_donus, dakika = [], [], [], [], [], Counter()
toplam_gol = 0
for m in tum:
    gl = gol_listesi(m, KK_TERS)
    for dk, h, o in gl:
        d0 = o['d'] or 0
        dilim = '90+' if d0 >= 90 and o['e'] else '1–15' if d0 <= 15 else '16–30' if d0 <= 30 else '31–45+' if d0 <= 45 else '46–60' if d0 <= 60 else '61–75' if d0 <= 75 else '76–90'
        dakika[dilim] += 1
        toplam_gol += 1
    if gl:
        h = gl[0][1]
        a, b = (m['ev_gol'], m['dep_gol']) if h else (m['dep_gol'], m['ev_gol'])
        s = 'G' if a > b else 'B' if a == b else 'M'
        ilk_gol.append(s)
        (ilk_gol_ev if h else ilk_gol_dep).append(s)
    if m['ev_iy'] is not None and m['ev_iy'] != m['dep_iy']:
        h = m['ev_iy'] > m['dep_iy']
        a, b = (m['ev_gol'], m['dep_gol']) if h else (m['dep_gol'], m['ev_gol'])
        iy_onde.append('G' if a > b else 'B' if a == b else 'M')

# Kırmızı kart, topa sahip olma, şut ve xG üstünlüğü
kirmizi, kirmizi_iy, sahip, sut_ust, xg_ust = [], [], [], [], []
for m in tum:
    S = (m['istatistik'] or {}).get('ALL') or {}
    kart = [o for o in (m['olaylar'] or []) if o['t'] == 'card' and o['s'] in ('red', 'yellowRed')]
    taraf = {o['h'] for o in kart}
    if len(taraf) == 1:
        h = taraf.pop()
        a, b = (m['ev_gol'], m['dep_gol']) if h else (m['dep_gol'], m['ev_gol'])
        s = 'G' if a > b else 'B' if a == b else 'M'
        kirmizi.append(s)
        if min(o['d'] or 99 for o in kart) <= 45:
            kirmizi_iy.append(s)
    for liste, k, esik in ((sahip, 'ballPossession', 0), (sut_ust, 'totalShotsOnGoal', 0), (xg_ust, 'expectedGoals', 0.5)):
        v = S.get(k)
        if v and v[0] is not None and v[1] is not None and abs(v[0] - v[1]) > esik:
            h = v[0] > v[1]
            a, b = (m['ev_gol'], m['dep_gol']) if h else (m['dep_gol'], m['ev_gol'])
            liste.append('G' if a > b else 'B' if a == b else 'M')

# Penaltı ve yedek golleri
pen_gol = sum(1 for m in tum for o in (m['olaylar'] or []) if o['t'] == 'goal' and o['s'] == 'penalty')
pen_kacan = sum(1 for m in tum for o in (m['olaylar'] or []) if o['t'] == 'inGamePenalty')
yedek = {(r['mac_id'], r['oyuncu_id']) for r in OYUNCU_MAC if r['yedek']}
gol_oyuncu = [(m['id'], o['p']) for m in tum for o in (m['olaylar'] or []) if o['t'] == 'goal' and o['s'] != 'ownGoal' and o['p']]
yedek_gol = sum((a, b) in yedek for a, b in gol_oyuncu)
yedek_dakika = sum(r['dakika'] for r in OYUNCU_MAC if r['yedek'])
tum_dakika = sum(r['dakika'] for r in OYUNCU_MAC)

dag = lambda ad, l: [ad] + [f'%{x:.0f}' for x in sonuc_dagilim(l)[1:]] + [sonuc_dagilim(l)[0]]
n_ig, g_ig, b_ig, _ = sonuc_dagilim(ilk_gol)
n_iy, g_iy, _, _ = sonuc_dagilim(iy_onde)
_, g_sahip, _, _ = sonuc_dagilim(sahip)
_, g_xg, _, m_xg = sonuc_dagilim(xg_ust)
dilimler = ['1–15', '16–30', '31–45+', '46–60', '61–75', '76–90', '90+']
bolumler.append({
    'id': 'dinamik', 'baslik': 'Maç dinamikleri: ilk gol, devre, kırmızı kart, uzatmalar', 'ikon': '⏱️',
    'ozet': f"İlk golü atan takımın kazanma oranı %{g_ig:.0f}, kaybetme oranı sadece %{100 - g_ig - b_ig:.0f}. Devreyi önde kapatanların kazanma oranı %{g_iy:.0f}. "
            f"İlginç bir sonuç: topa daha çok sahip olan takımın kazanma oranı yalnızca %{g_sahip:.0f}; xG'de yarım golden fazla üstün olanınki ise "
            f"%{g_xg:.0f} — topa sahip olmak değil, pozisyon üretmek belirleyici. Son 15 dakika ve uzatmalarda atılan gollerin payı %{yuzde(dakika['76–90'] + dakika['90+'], toplam_gol):.0f}.",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'Şu durumda olan takım maçı nasıl bitiriyor?', 'sutunlar': ['Durum', 'Kazanır', 'Berabere', 'Kaybeder', 'Maç'],
         'sayisal': [1, 2, 3, 4], 'satirlar': [
             dag('İlk golü attı', ilk_gol), dag('İlk golü ev sahibi attı', ilk_gol_ev), dag('İlk golü deplasman attı', ilk_gol_dep),
             dag('Devreyi önde kapattı', iy_onde), dag('Kırmızı kart gördü (rakip görmedi)', kirmizi), dag('İlk yarıda kırmızı kart gördü', kirmizi_iy),
             dag('Topa daha çok sahip oldu', sahip), dag('Daha çok şut attı', sut_ust), dag('xG\'de 0,5+ üstün', xg_ust)]},
        {'tur': 'cubuk', 'baslik': 'Goller hangi dakikalarda geliyor?', 'birim': '%',
         'ogeler': [{'ad': dl, 'deger': yuvarla(yuzde(dakika[dl], toplam_gol), 1), 'alt': f"{dakika[dl]} gol"} for dl in dilimler]},
        {'tur': 'istatistik', 'ogeler': [
            {'deger': f'%{yuzde(pen_gol, pen_gol + pen_kacan):.0f}', 'etiket': f'Penaltı başarısı ({pen_gol} gol, {pen_kacan} kaçan)'},
            {'deger': f'%{yuzde(yedek_gol, len(gol_oyuncu)):.0f}', 'etiket': f'Yedekten girenlerin gol payı (sahadaki süre payları %{yuzde(yedek_dakika, tum_dakika):.0f})'},
            {'deger': f'%{yuzde(dakika["90+"], toplam_gol):.1f}', 'etiket': 'Uzatma dakikası golleri'},
            {'deger': f'%{100 - g_ig - b_ig:.0f}', 'etiket': 'İlk golü atıp kaybedenler'}]},
    ]})

# ============================================================ 5. Şans tablosu (xPts)
def pois(l, n=11):
    p = [math.exp(-l)]
    for k in range(1, n):
        p.append(p[-1] * l / k)
    return p


xpts = defaultdict(float)
for r in TAKIM_MAC:
    if r['xg'] is None or r['xga'] is None:
        continue
    a, b = pois(r['xg']), pois(r['xga'])
    pg = sum(a[i] * b[j] for i in range(11) for j in range(11) if i > j)
    pb = sum(a[i] * b[i] for i in range(11))
    xpts[(r['sezon'], r['takim'])] += 3 * pg + pb
sans = []
for t in TAKIM_SEZON:
    x = xpts.get((t['sezon'], t['takim']))
    if x and t['mac'] >= 8:
        sans.append({**t, 'xpts': x, 'fark': t['puan'] - x})
sans.sort(key=lambda t: -t['fark'])
sans_tam = [t for t in sans if t['sezon'] in TAM_SEZON]
r_sans, _ = r_pearson([t['xpts'] / t['mac'] for t in sans_tam], [t['ppg'] for t in sans_tam])
sans_satir = lambda t: [takim_sezon_ad(t), t['puan'], yuvarla(t['xpts'], 1), ('+' if t['fark'] > 0 else '') + f"{t['fark']:.1f}", t['sira']]
guncel_sans = sorted([t for t in sans if t['sezon'] == GUNCEL], key=lambda t: -t['fark'])
bolumler.append({
    'id': 'sans', 'baslik': 'Şans tablosu: hak ettiğinden fazla ya da az puan alanlar', 'ikon': '🎲',
    'ozet': f"Her maçın xG'sinden 'beklenen puan' hesaplandı. Beklenen puan gerçek puanla {guc(r_sans)} ilişkili (r = {r_sans:.2f}); aradaki fark çoğunlukla şans, "
            f"bitiricilik ya da kaleci performansı. En şanslı sezon: {takim_sezon_ad(sans[0])} (+{sans[0]['fark']:.0f} puan); "
            f"en şanssız: {takim_sezon_ad(sans[-1])} ({sans[-1]['fark']:.0f} puan).",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'Beklenenden en fazla puan toplayanlar', 'sutunlar': ['Takım', 'Puan', 'Beklenen', 'Fark', 'Sıra'], 'sayisal': [1, 2, 3, 4],
         'satirlar': [sans_satir(t) for t in sans[:8]]},
        {'tur': 'tablo', 'baslik': 'Beklenenden en az puan toplayanlar', 'sutunlar': ['Takım', 'Puan', 'Beklenen', 'Fark', 'Sıra'], 'sayisal': [1, 2, 3, 4],
         'satirlar': [sans_satir(t) for t in sans[::-1][:8]]},
        {'tur': 'tablo', 'baslik': f'Bu sezon ({GUNCEL}) — xG\'ye göre gerçek puan tablosu', 'not': 'Beklenen puanı gerçek puanından yüksek olanların ileride toparlanması beklenir.',
         'sutunlar': ['Takım', 'Puan', 'Beklenen', 'Fark', 'Sıra'], 'sayisal': [1, 2, 3, 4], 'satirlar': [sans_satir(t) for t in sorted(guncel_sans, key=lambda t: -t['xpts'])]},
    ]})

# ============================================================ 6. Oyuncular
sezon_baslangic = lambda s: date(2000 + int(s[:2]) if int(s[:2]) < 50 else 1900 + int(s[:2]), 8, 1)
gi = lambda r, k: (r['ist'][IDX[k]] if k in IDX and IDX[k] < len(r['ist'] or []) and r['ist'][IDX[k]] is not None else 0.0)
OM = [r for r in OYUNCU_MAC if r['mac_id'] in MAC]
ps = defaultdict(lambda: {'dk': 0, 'mac': 0, 'puan_t': 0.0, 'puan_dk': 0, 'top': defaultdict(float), 'mevki': Counter(), 'takim': Counter()})
for r in OM:
    p = ps[(MAC[r['mac_id']]['sezon'], r['oyuncu_id'])]
    p['dk'] += r['dakika']
    p['mac'] += 1
    if r['puan'] is not None:
        p['puan_t'] += r['puan'] * r['dakika']
        p['puan_dk'] += r['dakika']
    for k in IDX:
        p['top'][k] += gi(r, k)
    p['mevki'][r['mevki'] or '?'] += 1
    p['takim'][r['takim_id']] += 1

O90 = [  # anahtar, ad, hesap
    ('gol', 'Gol', lambda t, dk: t['goals'] * 90 / dk), ('asist', 'Asist', lambda t, dk: t['goalAssist'] * 90 / dk),
    ('xg', 'xG', lambda t, dk: t['expectedGoals'] * 90 / dk), ('xa', 'xA (beklenen asist)', lambda t, dk: t['expectedAssists'] * 90 / dk),
    ('sut', 'Şut', lambda t, dk: t['totalShots'] * 90 / dk), ('kilit', 'Kilit pas', lambda t, dk: t['keyPass'] * 90 / dk),
    ('buyuk', 'Büyük fırsat yaratma', lambda t, dk: t['bigChanceCreated'] * 90 / dk),
    ('calim', 'Başarılı çalım', lambda t, dk: t['wonContest'] * 90 / dk),
    ('calim_y', 'Çalım başarısı %', lambda t, dk: yuzde(t['wonContest'], t['totalContest']) if t['totalContest'] >= 15 else float('nan')),
    ('ikili', 'Kazanılan ikili mücadele', lambda t, dk: t['duelWon'] * 90 / dk),
    ('ikili_y', 'İkili mücadele %', lambda t, dk: yuzde(t['duelWon'], t['duelWon'] + t['duelLost']) if t['duelWon'] + t['duelLost'] >= 40 else float('nan')),
    ('hava', 'Kazanılan hava topu', lambda t, dk: t['aerialWon'] * 90 / dk),
    ('hava_y', 'Hava topu %', lambda t, dk: yuzde(t['aerialWon'], t['aerialWon'] + t['aerialLost']) if t['aerialWon'] + t['aerialLost'] >= 20 else float('nan')),
    ('kapma', 'Başarılı top kapma', lambda t, dk: t['wonTackle'] * 90 / dk), ('araya', 'Araya girme', lambda t, dk: t['interceptionWon'] * 90 / dk),
    ('kazanma', 'Top kazanma', lambda t, dk: t['ballRecovery'] * 90 / dk), ('uzak', 'Uzaklaştırma', lambda t, dk: t['totalClearance'] * 90 / dk),
    ('pas', 'İsabetli pas', lambda t, dk: t['accuratePass'] * 90 / dk),
    ('pas_y', 'Pas isabeti %', lambda t, dk: yuzde(t['accuratePass'], t['totalPass']) if t['totalPass'] >= 100 else float('nan')),
    ('uzun', 'İsabetli uzun top', lambda t, dk: t['accurateLongBalls'] * 90 / dk), ('orta', 'İsabetli orta', lambda t, dk: t['accurateCross'] * 90 / dk),
    ('temas', 'Topla buluşma', lambda t, dk: t['touches'] * 90 / dk), ('kayip', 'Top kaybı', lambda t, dk: t['possessionLostCtrl'] * 90 / dk),
    ('ileri', 'İleri top taşıma', lambda t, dk: t['progressiveBallCarriesCount'] * 90 / dk),
    ('faul', 'Faul yapma', lambda t, dk: t['fouls'] * 90 / dk), ('faul_m', 'Faul kazanma', lambda t, dk: t['wasFouled'] * 90 / dk),
    ('kurtaris', 'Kurtarış', lambda t, dk: t['saves'] * 90 / dk), ('onlenen', 'Önlenen gol (xG\'ye göre)', lambda t, dk: t['goalsPrevented'] * 90 / dk),
]
O90_AD = {k: a for k, a, _ in O90}
MEVKI_AD = {'G': 'Kaleci', 'D': 'Defans', 'M': 'Orta saha', 'F': 'Forvet'}
OS = []
for (sezon, oid), p in ps.items():
    if p['dk'] < 900 or not p['puan_dk']:
        continue
    o = OYUNCULAR.get(oid, {})
    mevki = p['mevki'].most_common(1)[0][0]
    if mevki not in MEVKI_AD:
        continue
    dogum = date.fromisoformat(o['dogum']) if o.get('dogum') else None
    sb = sezon_baslangic(sezon)
    t = defaultdict(float, p['top'])
    kayit = {'sezon': sezon, 'id': oid, 'ad': o.get('ad', '?'), 'mevki': mevki, 'dk': p['dk'], 'mac': p['mac'], 'puan': p['puan_t'] / p['puan_dk'],
             'yas': (sb - dogum).days / 365.25 if dogum else None, 'takim': TAKIM.get(p['takim'].most_common(1)[0][0], '?'),
             'takim_id': p['takim'].most_common(1)[0][0], 'boy': o.get('boy'), 'ayak': o.get('ayak')}
    for k, _, f in O90:
        try:
            kayit[k] = f(t, p['dk'])
        except ZeroDivisionError:
            kayit[k] = float('nan')
    OS.append(kayit)
ts_sira = {(t['sezon'], t['takim']): t['sira'] for t in TAKIM_SEZON}
for k in OS:
    k['takim_sira'] = ts_sira.get((k['sezon'], k['takim_id']))

# 6a. Puanla (SofaScore notu) ilişkili özellikler — mevki mevki
basari_bloklari = []
for mv in ['F', 'M', 'D', 'G']:
    grup = [k for k in OS if k['mevki'] == mv]
    sonuc = []
    for k, ad, _ in O90:
        if mv != 'G' and k in ('kurtaris', 'onlenen'):
            continue
        r, n = r_pearson([g[k] for g in grup], [g['puan'] for g in grup])
        if not math.isnan(r) and n >= 30:
            sonuc.append((ad, r))
    sonuc.sort(key=lambda x: -x[1])
    secim = sonuc[:6] + [x for x in sonuc[-3:] if x[1] < -0.1]
    basari_bloklari.append({'tur': 'cubuk', 'baslik': f"{MEVKI_AD[mv]} ({len(grup)} oyuncu-sezon): yüksek not alanlar neyi daha çok yapıyor?", 'aralik': [-1, 1],
                            'ogeler': [{'ad': a, 'deger': yuvarla(r, 2), 'alt': guc(r), 'ton': 'pozitif' if r > 0 else 'negatif'} for a, r in secim]})

# 6b. Büyük takımların oyuncuları neyi farklı yapıyor? (ilk 4 ile 15.–20. sıradaki takımların oyuncuları, Cohen d)
fark_bloklari = []
for mv in ['F', 'M', 'D']:
    ust = [k for k in OS if k['mevki'] == mv and k['takim_sira'] and k['takim_sira'] <= 4 and k['sezon'] in TAM_SEZON]
    alt = [k for k in OS if k['mevki'] == mv and k['takim_sira'] and k['takim_sira'] >= 15 and k['sezon'] in TAM_SEZON]
    sonuc = []
    for k, ad, _ in O90:
        if k in ('kurtaris', 'onlenen'):
            continue
        a = np.array([x[k] for x in ust], float)
        b = np.array([x[k] for x in alt], float)
        a, b = a[~np.isnan(a)], b[~np.isnan(b)]
        if len(a) < 15 or len(b) < 15:
            continue
        sd_ = math.sqrt((a.var(ddof=1) + b.var(ddof=1)) / 2)
        if sd_ == 0:
            continue
        sonuc.append((ad, (a.mean() - b.mean()) / sd_, a.mean(), b.mean()))
    sonuc.sort(key=lambda x: -abs(x[1]))
    fark_bloklari.append({'tur': 'tablo', 'baslik': f"{MEVKI_AD[mv]}: ilk 4 takımın oyuncuları ile alt sıradakilerinki (90 dakikada)",
                          'not': 'Etki büyüklüğü (Cohen d): 0,2 küçük, 0,5 orta, 0,8 büyük fark. Pozitif = büyük takımların oyuncuları daha çok yapıyor.',
                          'sutunlar': ['Özellik', 'İlk 4', '15.–20.', 'Etki'], 'sayisal': [1, 2, 3],
                          'satirlar': [[a, yuvarla(x, 2), yuvarla(y, 2), ('+' if d_ > 0 else '') + f"{d_:.2f}"] for a, d_, x, y in sonuc[:8]]})

# 6c. Yaş eğrisi: aynı oyuncunun art arda sezonlarındaki not değişimiyle ("delta" yöntemi) hesaplanacak. 4 sezonla her yaşta
# çok az oyuncu kaldığı ve sonuç gürültülü çıktığı için şimdilik gösterilmiyor; 10 sezon gelince eklenecek.

# 6d. Takımı kazandıran oyuncular (oynadığı / oynamadığı maçlar)
takim_maclari = defaultdict(list)   # (sezon, takım) → [(mac_id, puan)]
for r in TAKIM_MAC:
    takim_maclari[(r['sezon'], r['takim'])].append((r['mac'], r['puan'], r['gol'] - r['yenen']))
oynadi = defaultdict(dict)
for r in OM:
    oynadi[(MAC[r['mac_id']]['sezon'], r['takim_id'], r['oyuncu_id'])][r['mac_id']] = r
etki = defaultdict(lambda: {'ile': [], 'siz': [], 'ileav': [], 'sizav': [], 'takim': Counter()})
for (sezon, takim, oid), mlist in oynadi.items():
    if len(mlist) < 5:
        continue
    for mid, pu, av in takim_maclari[(sezon, takim)]:
        e = etki[oid]
        r = mlist.get(mid)
        if r and not r['yedek'] and r['dakika'] >= 60:
            e['ile'].append(pu); e['ileav'].append(av)
        elif not r:
            e['siz'].append(pu); e['sizav'].append(av)
        e['takim'][takim] += 1
etki_liste = []
for oid, e in etki.items():
    if len(e['ile']) >= 15 and len(e['siz']) >= 8:
        fark = np.mean(e['ile']) - np.mean(e['siz'])
        # Az maça dayanan farklar sıfıra doğru küçültülür (Bayes büzme, 10 sanal maç)
        buz = fark * len(e['siz']) / (len(e['siz']) + 10)
        etki_liste.append((OYUNCULAR.get(oid, {}).get('ad', '?'), TAKIM.get(e['takim'].most_common(1)[0][0], '?'), np.mean(e['ile']), np.mean(e['siz']),
                           len(e['ile']), len(e['siz']), fark, buz, np.mean(e['ileav']) - np.mean(e['sizav'])))
etki_liste.sort(key=lambda x: -x[7])
etki_satir = lambda x: [x[0], x[1], yuvarla(x[2]), yuvarla(x[3]), f"{x[4]} / {x[5]}", ('+' if x[6] > 0 else '') + f"{x[6]:.2f}", ('+' if x[8] > 0 else '') + f"{x[8]:.2f}"]

# 6e. Genç yetenekler (sezon başında 21 yaş ve altı)
son_tam = [s for s in SEZONLAR if MAC_SAY[s] >= 300][-2:] + ([GUNCEL] if GUNCEL not in TAM_SEZON else [])
gencler, _gorulen = [], set()
for k in sorted([k for k in OS if k['yas'] and k['yas'] < 22 and k['sezon'] in son_tam], key=lambda k: -k['puan']):
    if k['id'] not in _gorulen:   # her oyuncu en iyi sezonuyla bir kez
        _gorulen.add(k['id'])
        gencler.append(k)


def guclu_yanlar(k, n=2):
    """Oyuncunun kendi mevkisindeki aynı sezon oyuncularına göre en yüksek yüzdelik dilimdeki özellikleri."""
    grup = [g for g in OS if g['mevki'] == k['mevki'] and g['sezon'] == k['sezon']]
    puanlar = []
    for kk, ad, _ in O90:
        if kk in ('kayip', 'faul', 'kurtaris', 'onlenen') and k['mevki'] != 'G':
            continue
        v = [g[kk] for g in grup if not math.isnan(g[kk])]
        if math.isnan(k[kk]) or len(v) < 10:
            continue
        puanlar.append((100 * sum(x < k[kk] for x in v) / len(v), ad))
    puanlar.sort(reverse=True)
    return ', '.join(f"{ad} (%{p:.0f})" for p, ad in puanlar[:n])


# 6f. Fiziksel: boy ve ayak
fizik = []
for mv in ['G', 'D', 'M', 'F']:
    g = [k for k in OS if k['mevki'] == mv]
    boy = [k['boy'] for k in g if k['boy']]
    sol = [k for k in g if k['ayak'] in ('Left', 'Right', 'Both')]
    fizik.append([MEVKI_AD[mv], yuvarla(np.mean(boy), 1), f"%{yuzde(sum(k['ayak'] == 'Left' for k in sol), len(sol)):.0f}", len(g)])
d_boy = [k for k in OS if k['mevki'] == 'D' and k['boy']]
r_boy_hava, _ = r_pearson([k['boy'] for k in d_boy], [k['hava_y'] for k in d_boy])
r_boy_puan, _ = r_pearson([k['boy'] for k in d_boy], [k['puan'] for k in d_boy])

bolumler.append({
    'id': 'oyuncu', 'baslik': 'Oyuncular: başarılı oyuncunun ortak özellikleri', 'ikon': '⭐',
    'ozet': f"{len(OS)} oyuncu-sezon (sezonda en az 900 dakika) incelendi. Yüksek not alan forvet ve orta sahaları en çok ayıran şey gol değil, "
            f"pozisyon hazırlamak ({kucuk(basari_bloklari[0]['ogeler'][0]['ad'])}, {kucuk(basari_bloklari[0]['ogeler'][1]['ad'])}). "
            f"Büyük takımların oyuncularını alt sıradakilerden en çok ayıran özellik forvette '{kucuk(fark_bloklari[0]['satirlar'][0][0])}', "
            f"orta sahada '{kucuk(fark_bloklari[1]['satirlar'][0][0])}', defansta '{kucuk(fark_bloklari[2]['satirlar'][0][0])}'.",
    'bloklar': basari_bloklari + [
        {'tur': 'baslik', 'metin': 'Büyük takımların oyuncuları neyi farklı yapıyor?'}] + fark_bloklari + [
        ] + [
        {'tur': 'tablo', 'baslik': 'Mevkiye göre boy ve ayak', 'not': f"Defanslarda boy ile hava topu başarısı arasında {guc(r_boy_hava)} ilişki var (r = {r_boy_hava:.2f}), "
                                                                      f"ama boy ile genel not arasında neredeyse yok (r = {r_boy_puan:.2f}).",
         'sutunlar': ['Mevki', 'Ort. boy (cm)', 'Solak oranı', 'Oyuncu-sezon'], 'sayisal': [1, 2, 3], 'satirlar': fizik},
    ]})

bolumler.append({
    'id': 'etki', 'baslik': 'Takımı kazandıran oyuncular', 'ikon': '💪',
    'ozet': "Her oyuncunun takımı, onun ilk 11'de en az 60 dakika oynadığı maçlarda ve hiç oynamadığı maçlarda karşılaştırıldı. "
            f"Fark az maça dayanıyorsa sıfıra doğru küçültülerek sıralandı. Listenin başında {etki_liste[0][0]} var: o oynarken {etki_liste[0][1]} "
            f"maç başı {etki_liste[0][2]:.2f}, o yokken {etki_liste[0][3]:.2f} puan topluyor. Not: rakip gücü ve sakatlık dönemleri de farka karışır.",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'En büyük olumlu etki', 'sutunlar': ['Oyuncu', 'Takım', 'Puan/maç (oynadı)', 'Puan/maç (yoktu)', 'Maç (oynadı/yoktu)', 'Puan farkı', 'Averaj farkı'],
         'sayisal': [2, 3, 4, 5, 6], 'satirlar': [etki_satir(x) for x in etki_liste[:15]]},
    ]})

bolumler.append({
    'id': 'genc', 'baslik': 'Genç yetenekler (sezon başında 21 yaş ve altı)', 'ikon': '🌱',
    'ozet': f"Son sezonlarda en az 900 dakika oynayan {len(gencler)} genç oyuncu, en iyi sezonlarındaki ortalama notlarına göre sıralandı. "
            "Güçlü yanlar, aynı sezon aynı mevkideki tüm oyuncular içindeki yüzdelik dilimle verildi (%90 = mevkisindekilerin %90'ından iyi).",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'En yüksek notlu gençler', 'sutunlar': ['Oyuncu', 'Sezon', 'Takım', 'Mevki', 'Yaş', 'Dakika', 'Ort. not', 'Güçlü yanları'],
         'sayisal': [4, 5, 6], 'satirlar': [[k['ad'], k['sezon'], k['takim'], MEVKI_AD[k['mevki']], int(k['yas']), k['dk'], yuvarla(k['puan']), guclu_yanlar(k)]
                                            for k in gencler[:20]]},
    ]})

# ============================================================ 7. Hakemler
hk = defaultdict(lambda: {'mac': 0, 'kart': 0, 'ev_kart': 0, 'dep_kart': 0, 'pen': 0, 'kirmizi': 0, 'ev_g': 0, 'ad': ''})
for m in tum:
    if not m['hakem']:
        continue
    S = (m['istatistik'] or {}).get('ALL') or {}
    h = hk[m['hakem']['id']]
    h['ad'] = m['hakem']['ad']
    h['mac'] += 1
    sar = S.get('yellowCards') or [0, 0]
    h['ev_kart'] += sar[0] or 0
    h['dep_kart'] += sar[1] or 0
    h['kart'] += (sar[0] or 0) + (sar[1] or 0)
    h['pen'] += sum(1 for o in (m['olaylar'] or []) if (o['t'] == 'goal' and o['s'] == 'penalty') or o['t'] == 'inGamePenalty')
    h['kirmizi'] += sum(1 for o in (m['olaylar'] or []) if o['t'] == 'card' and o['s'] in ('red', 'yellowRed'))
    h['ev_g'] += m['ev_gol'] > m['dep_gol']
hlist = [h for h in hk.values() if h['mac'] >= 15]
lig_kart = sum(h['kart'] for h in hk.values()) / sum(h['mac'] for h in hk.values())
hlist.sort(key=lambda h: -h['kart'] / h['mac'])
hsatir = lambda h: [h['ad'], h['mac'], yuvarla(h['kart'] / h['mac'], 2), yuvarla(h['kirmizi'] / h['mac'], 2), yuvarla(h['pen'] / h['mac'], 2),
                    f"%{yuzde(h['ev_g'], h['mac']):.0f}", yuvarla(h['dep_kart'] / max(h['ev_kart'], 1), 2)]
bolumler.append({
    'id': 'hakem', 'baslik': 'Hakemler', 'ikon': '🟨',
    'ozet': f"Ligde maç başı ortalama {lig_kart:.2f} sarı kart çıkıyor. En çok kart gösteren {hlist[0]['ad']} ({hlist[0]['kart'] / hlist[0]['mac']:.2f}), "
            f"en az gösteren {hlist[-1]['ad']} ({hlist[-1]['kart'] / hlist[-1]['mac']:.2f}). Bu fark, kart tahmininde hakemin neden önemli olduğunu gösteriyor.",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'En az 15 maç yöneten hakemler (en kartlıdan en az kartlıya)', 'not': 'Dep./ev kart oranı 1\'den büyükse deplasman takımı daha çok kart görüyor.',
         'sutunlar': ['Hakem', 'Maç', 'Sarı/maç', 'Kırmızı/maç', 'Penaltı/maç', 'Ev kazanıyor', 'Dep./ev kart'], 'sayisal': [1, 2, 3, 4, 5, 6],
         'satirlar': [hsatir(h) for h in hlist]},
    ]})

# ============================================================ Yaz
cikti = {
    'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes'),
    'lig': 'Premier Lig', 'sezonlar': SEZONLAR, 'mac': N, 'oyuncu_sezon': len(OS), 'takim_sezon': len(TS_TAM),
    'yontem': 'Takım ölçüleri maç başı ortalamadır; ilişkiler Pearson korelasyonu (r) ile ölçülür ve nedensellik anlamına gelmez. '
              'Oyun tarzları standartlaştırılmış tarz ölçülerinde k-ortalamalar kümelemesiyle bulundu. Beklenen puan her maçın xG\'sinden Poisson dağılımıyla hesaplandı. '
              'Oyuncu ölçüleri 90 dakika başınadır (sezonda en az 900 dakika). "Not" SofaScore\'un maç notudur ve kendi hesabına göre üretilir.',
    'bolumler': bolumler,
}
os.makedirs(os.path.dirname(os.path.abspath(CIKTI)), exist_ok=True)
def temizle(x):
    if isinstance(x, dict):
        return {k: temizle(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [temizle(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return None if math.isnan(x) else float(x)
    if isinstance(x, str):
        return re.sub(r'(?<=\d)\.(?=\d)', ',', x)   # Türkçe ondalık virgül (metinlerde)
    return x


json.dump(temizle(cikti), open(CIKTI, 'w'), ensure_ascii=False, indent=1)
print('yazıldı', CIKTI, f'{os.path.getsize(CIKTI) / 1024:.0f} KB', 'kendi kalesine golde ters isHome:', KK_TERS, uyum)

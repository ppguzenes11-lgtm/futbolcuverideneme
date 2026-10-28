"""Kupon simülatörü için geçmiş maç verisi: her pazar ve seçenek için model olasılığı (maçı görmeden üretilmiş),
piyasa olasılığı (oranlardan, şirket payı çıkarılmış), açılış/kapanış oranı ve sonuç.

Maç sonucu ve çifte şans: yeni model (her sezon yalnızca önceki sezonlarla eğitilmiş lojistik regresyon).
Diğer pazarlar (ilk yarı, gol çizgileri, karşılıklı gol, korner, kart, ilk gol): sitedeki mevcut model, her gün yalnızca
o güne kadarki maçlarla kurulmuş (pazar_cikar.mjs).
Kullanım: node pazar_cikar.mjs <klasör> pazar.json && python kupon_veri.py pazar.json <klasör>/takimlar.json <klasör>/maclar.json ../../veri/scout_kupon_gecmis.json
"""
import json
import re
import sys
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

pazar_dosya, takim_dosya, mac_dosya, cikti = sys.argv[1:5]
R = json.load(open(pazar_dosya))
TAKIM = {t['id']: t['ad'] for t in json.load(open(takim_dosya))}
MAC = {m['id']: m for m in json.load(open(mac_dosya))}

# ---- Maç sonucu: yeni model, ileriye doğru
X = np.array([r['x'] for r in R], float)
y = np.array([0 if r['ev_gol'] > r['dep_gol'] else 1 if r['ev_gol'] == r['dep_gol'] else 2 for r in R])
S = np.array([r['sezon'] for r in R])
P = np.full((len(R), 3), np.nan)
for s in sorted(set(S))[2:]:
    a, b = S < s, S == s
    o, sd = X[a].mean(0), X[a].std(0)
    m = LogisticRegression(C=1.0, max_iter=3000).fit((X[a] - o) / sd, y[a])
    P[b] = m.predict_proba((X[b] - o) / sd)


def ilk_gol(m):
    goller = sorted(((o['d'] or 0) + (o['e'] or 0) / 100, o['h']) for o in (m['olaylar'] or []) if o['t'] == 'goal')
    return None if not goller else (0 if goller[0][1] else 2)


def toplam(m, k):
    v = ((m['istatistik'] or {}).get('ALL') or {}).get(k)
    return None if v is None else (v[0] or 0) + (v[1] or 0)


def kart(m):
    S_ = (m['istatistik'] or {}).get('ALL') or {}
    if 'yellowCards' not in S_ and 'redCards' not in S_:
        return None
    return sum((S_.get(k) or [0, 0])[i] or 0 for k in ('yellowCards', 'redCards') for i in (0, 1))


yuv = lambda v, b=3: None if v is None else round(float(v), b)
cikis = []
for r, p in zip(R, P):
    o = r['oranlar']
    ft = o.get('Full time')
    if np.isnan(p[0]) or not ft or len(ft) != 3:
        continue
    m = MAC[r['id']]
    ge, gd = r['ev_gol'], r['dep_gol']
    ev, dep = TAKIM.get(m['ev_id'], '?'), TAKIM.get(m['dep_id'], '?')
    sonuc = 0 if ge > gd else 1 if ge == gd else 2
    iy = None if m['ev_iy'] is None else (0 if m['ev_iy'] > m['dep_iy'] else 1 if m['ev_iy'] == m['dep_iy'] else 2)
    korner, kartlar, ilk = toplam(m, 'cornerKicks'), kart(m), ilk_gol(m)
    pazarlar = []

    def ekle(kategori, ad, secenekler):
        """secenekler: [(kısa ad, model p, oran satırı [ad, açılış, kapanış, ...], tuttu)]"""
        sec = [x for x in secenekler if x[1] is not None and x[2][1] and x[2][2] and x[3] is not None]
        if len(sec) != len(secenekler):
            return
        q = [1 / x[2][2] for x in sec]
        if kategori == 'cs':   # çifte şans seçenekleri örtüşür: gerçek olasılıkların toplamı 2
            q = [v / 2 for v in q]
        pazarlar.append([kategori, ad, [[k, yuv(pm), yuv(1 / satir[2] / sum(q)), satir[1], satir[2], int(t)] for k, pm, satir, t in sec]])

    ekle('ms', 'Maç sonucu', [('MS 1', p[0], ft[0], sonuc == 0), ('MS X', p[1], ft[1], sonuc == 1), ('MS 2', p[2], ft[2], sonuc == 2)])
    if o.get('Double chance') and len(o['Double chance']) == 3:
        d = {c[0]: c for c in o['Double chance']}
        if {'1X', '12', 'X2'} <= d.keys():
            ekle('cs', 'Çifte şans', [('ÇŞ 1X', p[0] + p[1], d['1X'], sonuc != 2), ('ÇŞ 12', p[0] + p[2], d['12'], sonuc != 1),
                                       ('ÇŞ X2', p[1] + p[2], d['X2'], sonuc != 0)])
    md = r['model']
    for ad_, sec in o.items():
        pm = md.get(ad_)
        if not pm or ad_ in ('Full time', 'Double chance'):
            continue
        cizgi = re.search(r'([\d.]+)$', ad_)
        c = float(cizgi.group(1)) if cizgi else None
        if ad_ == '1st half' and iy is not None:
            ekle('iy', 'İlk yarı sonucu', [('İY 1', pm[0], sec[0], iy == 0), ('İY X', pm[1], sec[1], iy == 1), ('İY 2', pm[2], sec[2], iy == 2)])
        elif ad_.startswith('Match goals'):
            ekle('gol', f'Toplam gol {c:g}'.replace('.', ','), [(f'{c:g} Üst'.replace('.', ','), pm[0], sec[0], ge + gd > c),
                                                                   (f'{c:g} Alt'.replace('.', ','), pm[1], sec[1], ge + gd < c)])
        elif ad_ == 'Both teams to score':
            kg = ge > 0 and gd > 0
            ekle('kg', 'Karşılıklı gol', [('KG Var', pm[0], sec[0], kg), ('KG Yok', pm[1], sec[1], not kg)])
        elif ad_.startswith('Corners') and korner is not None:
            ekle('korner', f'Korner {c:g}'.replace('.', ','), [(f'Korner {c:g} Üst'.replace('.', ','), pm[0], sec[0], korner > c),
                                                               (f'Korner {c:g} Alt'.replace('.', ','), pm[1], sec[1], korner < c)])
        elif ad_.startswith('Cards') and kartlar is not None:
            ekle('kart', f'Kart {c:g}'.replace('.', ','), [(f'Kart {c:g} Üst'.replace('.', ','), pm[0], sec[0], kartlar > c),
                                                           (f'Kart {c:g} Alt'.replace('.', ','), pm[1], sec[1], kartlar < c)])
        elif ad_ == 'First team to score' and len(sec) == 3:
            ekle('ilkgol', 'İlk golü atan', [(f'İlk gol: {ev}', pm[0], sec[0], ilk == 0), ('İlk gol: gol yok', pm[1], sec[1], ilk is None),
                                              (f'İlk gol: {dep}', pm[2], sec[2], ilk == 2)])
    cikis.append({'id': r['id'], 't': r['tarih'][:10], 'e': ev, 'd': dep, 'g': [ge, gd], 'pz': pazarlar})

json.dump({'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes'), 'lig': 'Premier Lig',
           'secim_bicimi': ['ad', 'model olasılığı', 'piyasa olasılığı (kapanış, payı çıkarılmış)', 'açılış oranı', 'kapanış oranı', 'tuttu'],
           'maclar': cikis}, open(cikti, 'w'), ensure_ascii=False, separators=(',', ':'))
from collections import Counter
print('maç', len(cikis), Counter(p[0] for c in cikis for p in c['pz']))

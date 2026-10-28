"""Kupon simülatörü için geçmiş maç verisi: model olasılıkları (maçı görmeden üretilmiş) + oranlar + sonuçlar.

1-X-2: yeni model (her sezon yalnızca önceki sezonlarla eğitilmiş lojistik regresyon, ileriye doğru).
Karşılıklı gol ve 2,5 üst: sitedeki mevcut model (her gün yalnızca o güne kadarki maçlarla kurulmuş).
Kullanım: node pazar_cikar.mjs <klasör> pazar.json && python kupon_veri.py pazar.json <klasör>/takimlar.json <klasör>/maclar.json ../../veri/scout_kupon_gecmis.json
"""
import json
import sys
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

pazar_dosya, takim_dosya, mac_dosya, cikti = sys.argv[1:5]
R = json.load(open(pazar_dosya))
TAKIM = {t['id']: t['ad'] for t in json.load(open(takim_dosya))}
MAC = {m['id']: m for m in json.load(open(mac_dosya))}
X = np.array([r['x'] for r in R], float)
y = np.array([0 if r['ev_gol'] > r['dep_gol'] else 1 if r['ev_gol'] == r['dep_gol'] else 2 for r in R])
S = np.array([r['sezon'] for r in R])
sezonlar = sorted(set(S))
P = np.full((len(R), 3), np.nan)
for s in sezonlar[2:]:
    a, b = S < s, S == s
    o, sd = X[a].mean(0), X[a].std(0)
    m = LogisticRegression(C=1.0, max_iter=3000).fit((X[a] - o) / sd, y[a])
    P[b] = m.predict_proba((X[b] - o) / sd)

yuv = lambda v: None if v is None else round(float(v), 3)
cikis = []
for r, p in zip(R, P):
    ft = r['pazar'].get('Full time')
    if np.isnan(p[0]) or not ft or len(ft) != 3 or not all(c[1] and c[2] for c in ft):
        continue
    m = MAC[r['id']]
    satir = {'id': r['id'], 't': r['tarih'][:10], 's': r['sezon'], 'e': TAKIM.get(m['ev_id'], '?'), 'd': TAKIM.get(m['dep_id'], '?'),
             'g': [r['ev_gol'], r['dep_gol']], 'p': [yuv(x) for x in p],
             'o': [[c[1] for c in ft], [c[2] for c in ft]]}   # [açılış[1,X,2], kapanış[1,X,2]]
    for ad, k, pm in (('Both teams to score', 'kg', r['kg']), ('Match goals 2.5', 'u', r['ust25'])):
        sec = {c[0]: c for c in r['pazar'].get(ad) or []}
        evet, hayir = sec.get('Yes') or sec.get('Over'), sec.get('No') or sec.get('Under')
        if evet and hayir and evet[1] and evet[2] and hayir[1] and hayir[2]:
            satir[k] = [yuv(pm), [evet[1], hayir[1]], [evet[2], hayir[2]]]   # [P(evet), açılış[evet,hayır], kapanış[evet,hayır]]
    cikis.append(satir)
json.dump({'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes'), 'lig': 'Premier Lig', 'maclar': cikis},
          open(cikti, 'w'), ensure_ascii=False, separators=(',', ':'))
print('maç', len(cikis), 'KG/2.5 oranlı', sum('kg' in c for c in cikis))

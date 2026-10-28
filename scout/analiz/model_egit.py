"""Yeni tahmin modelinin katsayılarını eğitir (sitedeki js/tahmin.js ile üretilen özelliklerden).

1) İleriye doğru sınama: her sezon yalnızca önceki sezonlarla eğitilip sınanır (dürüst başarı ölçüsü).
2) Son katsayılar tüm maçlarla eğitilir ve veri/scout_model_katsayi.json'a yazılır; site bunları kullanır.
Kullanım: node ozellik_cikar.mjs <klasör> oz.json && python model_egit.py oz.json <lig_id> ../../veri/scout_model_katsayi.json
"""
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
from sklearn.linear_model import LogisticRegression

oz, lig, cikti = sys.argv[1], sys.argv[2], sys.argv[3]
R = json.load(open(oz))
sezonlar = sorted({r['sezon'] for r in R})
X = np.array([r['x'] for r in R], float)
y = np.array([r['y'] for r in R])
S = np.array([r['sezon'] for r in R])


def egit(Xa, ya):
    ort, std = Xa.mean(0), Xa.std(0)
    m = LogisticRegression(C=1.0, max_iter=3000).fit((Xa - ort) / std, ya)
    return m, ort, std


def tahmin(m, ort, std, Xb):
    return m.predict_proba((Xb - ort) / std)


ll = lambda P, y: float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-9, 1))))
P_y, P_d, P_m, Y = [], [], [], []
for s in sezonlar[2:]:
    a, b = S < s, S == s
    if a.sum() < 200:
        continue
    m, o, sd = egit(X[a], y[a])
    P_y.append(tahmin(m, o, sd, X[b]))
    P_d.append(np.array([r['dc'] for r, k in zip(R, b) if k]))
    Y.append(y[b])
P_y, P_d, Y = np.vstack(P_y), np.vstack(P_d), np.concatenate(Y)
sinama = {'mac': int(len(Y)), 'yeni_isabet': float(np.mean(P_y.argmax(1) == Y)), 'temel_isabet': float(np.mean(P_d.argmax(1) == Y)),
          'yeni_logkayip': ll(P_y, Y), 'temel_logkayip': ll(P_d, Y)}
print(sinama)

m, ort, std = egit(X, y)
kayit = json.load(open(cikti)) if os.path.exists(cikti) else {}
kayit[str(lig)] = {'ozellik': ['log(p1/p2)', 'log(px)', 'xG formu net farkı'], 'ort': ort.tolist(), 'std': std.tolist(),
                   'b': m.intercept_.tolist(), 'w': m.coef_.tolist(), 'egitim_mac': int(len(y)), 'sinama': sinama,
                   'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes')}
json.dump(kayit, open(cikti, 'w'), ensure_ascii=False, indent=1)
print('yazıldı', cikti)

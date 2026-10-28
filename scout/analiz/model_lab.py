"""Scout — maç sonucu (1-X-2) tahmin laboratuvarı. Özellikler ozellikler.py'de üretilir.

Kullanım: python model_lab.py <veri klasörü> <çıktı.json>
"""
from ozellikler import *  # noqa: F401,F403  (SATIRLAR, KLASOR, CIKTI, TAKIM, FORM_OLCU, ...)
from ozellikler import SATIRLAR, KLASOR, CIKTI, FORM_OLCU
import math
import os
import json
from datetime import datetime
import numpy as np

# ============================================================ Modeller ve ileriye doğru sınama
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
import lightgbm as lgb

GRUP = {
    'guc': ['elo_fark', 'elo_ev', 'elo_dep', 'yeni_ev', 'yeni_dep', 'deneyim_ev', 'deneyim_dep'],
    'form': [k for k in SATIRLAR[-1]['f'] if any(k.startswith(x + '_') for x in FORM_OLCU) or k.startswith('xg_net')],
    'dinlenme': ['dinlenme_ev', 'dinlenme_dep', 'dinlenme_fark'],
    'eksik': ['eksik_sayi_ev', 'eksik_sayi_dep', 'eksik_kalite_ev', 'eksik_kalite_dep', 'eksik_kalite_fark'],
    'kadro': [k for k in SATIRLAR[-1]['f'] if k.startswith('xi_')],
    'dc': ['dc_p1', 'dc_px', 'dc_p2', 'dc_lev', 'dc_ldep'],
}
GRUP_AD = {'guc': 'Takım gücü (Elo)', 'form': 'Form (son maçlar: gol, xG, şut…)', 'dinlenme': 'Dinlenme süresi', 'eksik': 'Eksik/sakat oyuncular',
           'kadro': 'Açıklanan ilk 11', 'dc': 'Mevcut model (Dixon-Coles)'}

sezonlar = sorted({r['sezon'] for r in SATIRLAR})
TEST = [s for s in sezonlar if sezonlar.index(s) >= 2]   # ilk iki sezon yalnızca eğitim (özellikler ısınsın)
veri = [r for r in SATIRLAR if 'dc_p1' in r['f']]


def matris(rs, kolonlar):
    return np.array([[r['f'].get(k, np.nan) for k in kolonlar] for r in rs], float), np.array([r['y'] for r in rs])


def logloss(P, y):
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-9, 1))))


def brier(P, y):
    Y = np.eye(3)[y]
    return float(np.mean(((P - Y) ** 2).sum(1)))


def model_lr(C):
    def egit(Xa, ya, Xb):
        sc = StandardScaler().fit(Xa)
        lr = LogisticRegression(C=C, max_iter=3000).fit(sc.transform(Xa), ya)
        return lr.predict_proba(sc.transform(Xb)), lr
    return egit


def model_gbm(Xa, ya, Xb):
    m = lgb.LGBMClassifier(objective='multiclass', n_estimators=250, learning_rate=0.02, num_leaves=7, min_child_samples=40,
                           subsample=0.8, subsample_freq=1, colsample_bytree=0.7, reg_lambda=5.0, verbose=-1)
    m.fit(Xa, ya)
    return m.predict_proba(Xb), m


def ileri_sinama(kolonlar, egitici):
    P_hep, y_hep, rs_hep = [], [], []
    for s in TEST:
        a = [r for r in veri if r['sezon'] < s]
        b = [r for r in veri if r['sezon'] == s]
        if len(a) < 200 or not b:
            continue
        Xa, ya = matris(a, kolonlar)
        Xb, yb = matris(b, kolonlar)
        med = np.nanmedian(Xa, 0)
        Xa = np.where(np.isnan(Xa), med, Xa)
        Xb = np.where(np.isnan(Xb), med, Xb)
        P, _ = egitici(Xa, ya, Xb)
        P_hep.append(P); y_hep.append(yb); rs_hep += b
    return np.vstack(P_hep), np.concatenate(y_hep), rs_hep


for r in veri:
    r['f']['dc_log'] = math.log(r['f']['dc_p1'] / r['f']['dc_p2'])
    r['f']['dc_lpx'] = math.log(r['f']['dc_px'])
TUM = [k for g in GRUP.values() for k in g]
ONCE = [k for g in ('guc', 'form', 'dinlenme', 'eksik', 'dc') for k in GRUP[g]]
TEMEL = ['dc_log', 'dc_lpx']
KADROSUZ = TEMEL + ['xg_net_kisa_fark']
ILK11 = TEMEL + ['xg_net_kisa_fark', 'xi_tehdit_fark', 'xi_not_fark']
adaylar = {
    'Mevcut model (Dixon-Coles)': (None, None),
    'Tüm özellikler · lojistik regresyon': (TUM, model_lr(0.05)),
    'Tüm özellikler · gradient boosting': (TUM, model_gbm),
    'Yeni model · kadro açıklanmadan': (KADROSUZ, model_lr(1.0)),
    'Yeni model · ilk 11 açıklandıktan sonra': (ILK11, model_lr(1.0)),
}
sonuclar = {}
for ad, (kol, egit) in adaylar.items():
    if egit is None:
        rs = [r for r in veri if r['sezon'] in TEST]
        P = np.array([[r['f']['dc_p1'], r['f']['dc_px'], r['f']['dc_p2']] for r in rs])
        y = np.array([r['y'] for r in rs])
    else:
        P, y, rs = ileri_sinama(kol, egit)
    sonuclar[ad] = (P, y, rs)
    print(f"{ad:42s} n={len(y)} isabet={np.mean(P.argmax(1) == y):.3f} logloss={logloss(P, y):.4f} brier={brier(P, y):.4f}")

# Piyasa (yalnızca kıyas) — aynı maçlar
idler = [r['id'] for r in sonuclar['Mevcut model (Dixon-Coles)'][2]]
oranli = {r['id']: r['oran'] for r in veri if r['oran']}
ortak = [i for i in idler if i in oranli]
print('oranlı ortak maç', len(ortak), '/', len(idler))


def alt_kume(ad):
    P, y, rs = sonuclar[ad]
    k = {r['id']: j for j, r in enumerate(rs)}
    sec = [k[i] for i in ortak]
    return P[sec], y[sec]


Pm = np.array([oranli[i] for i in ortak])
ym = alt_kume('Mevcut model (Dixon-Coles)')[1]

# Eşleştirilmiş bootstrap: yeni model mevcut modelden gerçekten iyi mi?
rng = np.random.default_rng(1)


def bootstrap(ad_a, ad_b, kac=4000):
    Pa, y = alt_kume(ad_a)
    Pb, _ = alt_kume(ad_b)
    la = -np.log(np.clip(Pa[np.arange(len(y)), y], 1e-9, 1))
    lb = -np.log(np.clip(Pb[np.arange(len(y)), y], 1e-9, 1))
    fark = lb - la   # pozitif: a daha iyi
    orn = np.array([fark[rng.integers(0, len(fark), len(fark))].mean() for _ in range(kac)])
    return float(fark.mean()), float((orn > 0).mean())


def ozet_satir(ad, P, y):
    return [ad, f"%{100 * np.mean(P.argmax(1) == y):.1f}", f"{logloss(P, y):.4f}", f"{brier(P, y):.4f}"]


tablo = [ozet_satir(ad, *alt_kume(ad)) for ad in adaylar] + [ozet_satir('Bahis piyasası (kıyas)', Pm, ym)]
for r in tablo:
    print(r)
b_kadrosuz = bootstrap('Yeni model · kadro açıklanmadan', 'Mevcut model (Dixon-Coles)')
b_ilk11 = bootstrap('Yeni model · ilk 11 açıklandıktan sonra', 'Mevcut model (Dixon-Coles)')
print('bootstrap kadrosuz', b_kadrosuz, 'ilk11', b_ilk11)

# Sezon sezon isabet
sezon_tablo = []
for s_ in TEST:
    sat = [s_]
    for ad in ('Mevcut model (Dixon-Coles)', 'Yeni model · kadro açıklanmadan', 'Yeni model · ilk 11 açıklandıktan sonra'):
        P, y = alt_kume(ad)
        sezon_id = np.array([next(r['sezon'] for r in veri if r['id'] == i) == s_ for i in ortak])
        sat.append(f"%{100 * np.mean(P[sezon_id].argmax(1) == y[sezon_id]):.1f}")
    sezon_id = np.array([next(r['sezon'] for r in veri if r['id'] == i) == s_ for i in ortak])
    sat.append(f"%{100 * np.mean(Pm[sezon_id].argmax(1) == ym[sezon_id]):.1f}")
    sat.append(int(sezon_id.sum()))
    sezon_tablo.append(sat)

# Güven eğrisi: model en emin olduğu maçlarda ne kadar isabetli?
P_en, y_en = alt_kume('Yeni model · ilk 11 açıklandıktan sonra')
P_k, _ = alt_kume('Yeni model · kadro açıklanmadan')
guven = []
for oran_ in (1.0, 0.5, 0.3, 0.2, 0.1):
    sat = [f"En emin olunan %{int(oran_ * 100)}"]
    for P in (P_k, P_en, Pm):
        en = P.max(1)
        esik = np.quantile(en, 1 - oran_)
        sec = en >= esik
        sat.append(f"%{100 * np.mean(P[sec].argmax(1) == ym[sec]):.0f}")
    sat.append(int(round(oran_ * len(ym))))
    guven.append(sat)
# Çifte şans: en olası iki sonuçtan biri
cs = [f"%{100 * np.mean([(y_ in np.argsort(-p)[:2]) for p, y_ in zip(P, ym)]):.0f}" for P in (P_k, P_en, Pm)]

# Katsayılar (tüm veriyle eğitilmiş ilk 11 modeli, standartlaştırılmış)
X_, y_ = matris(veri, ILK11)
sc = StandardScaler().fit(X_)
lr = LogisticRegression(C=1.0, max_iter=3000).fit(sc.transform(X_), y_)
KAT_AD = {'dc_log': 'Mevcut modelin ev/deplasman eğilimi', 'dc_lpx': 'Mevcut modelin beraberlik olasılığı',
          'xg_net_kisa_fark': 'Son maçlardaki xG formu farkı', 'xi_tehdit_fark': 'İlk 11\'in hücum tehdidi farkı (xG+xA)',
          'xi_not_fark': 'İlk 11\'in geçmiş not ortalaması farkı'}
etki = sorted(((KAT_AD[k], float(lr.coef_[0][i] - lr.coef_[2][i])) for i, k in enumerate(ILK11)), key=lambda x: -abs(x[1]))

# Elenen fikirler: mevcut modele tek tek eklenince ne oldu?
denenen = {'Elo puanı': ['elo_fark'], 'Puan formu': ['pts_kisa_fark', 'pts_uzun_fark'], 'Eksik/sakat oyuncu kalitesi': ['eksik_kalite_fark'],
           'Dinlenme süresi': ['dinlenme_fark'], 'İsabetli şut formu': ['sotf_uzun_fark', 'sota_uzun_fark'], 'Kalecinin notu': ['xi_kaleci_fark'],
           'Rotasyon (alışılmış 11\'e göre)': ['xi_rotasyon_fark'], 'Son maçlardaki xG formu': ['xg_net_kisa_fark'],
           'İlk 11 hücum tehdidi': ['xi_tehdit_fark'], 'İlk 11 not ortalaması': ['xi_not_fark']}
P0, y0, _ = ileri_sinama(TEMEL, model_lr(1.0))
l0 = logloss(P0, y0)
eleme = []
for ad, kol in denenen.items():
    P, y, _ = ileri_sinama(TEMEL + kol, model_lr(1.0))
    eleme.append((ad, (l0 - logloss(P, y)) * 1000))
eleme.sort(key=lambda x: -x[1])

dc_ = alt_kume('Mevcut model (Dixon-Coles)')
yk = alt_kume('Yeni model · kadro açıklanmadan')
yi = alt_kume('Yeni model · ilk 11 açıklandıktan sonra')
isab = lambda t: 100 * np.mean(t[0].argmax(1) == t[1])
lab = {
    'id': 'lab', 'baslik': 'Tahmin laboratuvarı: en iyi formülü aramak', 'ikon': '🧪',
    'ozet': f"{len(ym)} maç, her model o maçları HİÇ görmeden (yalnızca önceki sezonlarla eğitilerek) tahmin etti. Sitedeki mevcut model maç sonucunu "
            f"%{isab(dc_):.1f} bildi. Yüzlerce özelliği birden kullanan makine öğrenmesi modelleri daha kötü çıktı: az veriyle ezber yapıyorlar. "
            f"Kazanan yaklaşım, mevcut modelin üstüne yalnızca işe yarayan birkaç bilgiyi eklemek oldu: kadro açıklanmadan %{isab(yk):.1f}, "
            f"ilk 11 açıklandıktan sonra %{isab(yi):.1f}. Bahis piyasası %{100 * np.mean(Pm.argmax(1) == ym):.1f}. "
            f"İlk 11'li yeni modelin mevcut modelden gerçekten iyi olma olasılığı %{100 * b_ilk11[1]:.0f} (eşleştirilmiş bootstrap).",
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'Yarışan modeller (görmedikleri maçlarda)',
         'not': 'İsabet: en olası sonucu doğru bilme oranı. Log-kayıp ve Brier olasılıkların kalitesini ölçer; küçük olan iyi. Piyasa yalnızca kıyas içindir.',
         'sutunlar': ['Model', 'İsabet', 'Log-kayıp', 'Brier'], 'sayisal': [1, 2, 3], 'satirlar': tablo},
        {'tur': 'tablo', 'baslik': 'Sezon sezon isabet', 'sutunlar': ['Sezon', 'Mevcut', 'Yeni (kadrosuz)', 'Yeni (ilk 11)', 'Piyasa', 'Maç'],
         'sayisal': [1, 2, 3, 4, 5], 'satirlar': sezon_tablo},
        {'tur': 'tablo', 'baslik': 'Model emin olduğunda ne kadar tutuyor?', 'not': f"Her modelin kendinden en emin olduğu maçlar. Çifte şans (en olası iki sonuçtan biri) "
                                                                                   f"isabeti: kadrosuz {cs[0]}, ilk 11 ile {cs[1]}, piyasa {cs[2]}.",
         'sutunlar': ['Maçlar', 'Yeni (kadrosuz)', 'Yeni (ilk 11)', 'Piyasa', 'Maç sayısı'], 'sayisal': [1, 2, 3, 4], 'satirlar': guven},
        {'tur': 'cubuk', 'baslik': 'Mevcut modele tek tek eklenen bilgiler ne kazandırdı?', 'birim': '',
         'not': 'Log-kayıptaki iyileşme ×1000 (büyük olan iyi). Sıfırın altı: o bilgi tahmini bozdu ya da hiçbir şey katmadı, bu yüzden modele alınmadı.',
         'aralik': [min(-3, min(x for _, x in eleme)), max(x for _, x in eleme)],
         'ogeler': [{'ad': a_, 'deger': round(v, 1), 'ton': 'pozitif' if v > 0 else 'negatif', 'alt': 'modelde' if a_ in ('Son maçlardaki xG formu', 'İlk 11 hücum tehdidi', 'İlk 11 not ortalaması') else 'alınmadı'} for a_, v in eleme]},
        {'tur': 'cubuk', 'baslik': 'Yeni modelde bilgilerin ağırlığı (ev sahibi kazanma yönünde)', 'not': 'Standartlaştırılmış katsayı farkı; büyük olan sonuca daha çok etki ediyor.',
         'ogeler': [{'ad': a_, 'deger': round(v, 2), 'ton': 'pozitif' if v > 0 else 'negatif'} for a_, v in etki]},
    ]}
import re


def temizle(x):
    if isinstance(x, dict):
        return {k: temizle(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [temizle(v) for v in x]
    if isinstance(x, (np.integer,)):
        return int(x)
    if isinstance(x, (float, np.floating)):
        return float(x)
    if isinstance(x, str):
        return re.sub(r'(?<=\d)\.(?=\d)', ',', x)
    return x


json.dump(temizle({'olusturuldu': datetime.utcnow().isoformat(timespec='minutes') + '+00:00', 'bolumler': [lab]}), open(CIKTI, 'w'), ensure_ascii=False, indent=1)
print('yazıldı', CIKTI)


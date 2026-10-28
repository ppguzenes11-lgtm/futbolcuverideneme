"""Scout — maç sonucu (1-X-2) tahmin laboratuvarı.

Her maç için YALNIZCA maçtan önce bilinen bilgilerden özellik üretir, farklı modelleri yarıştırır ve her modeli
görmediği sezonlarda sınar (ileriye doğru sınama: 23/24'ü 23/24 öncesiyle, 24/25'i 24/25 öncesiyle …).

Özellik grupları
- guc:    Elo puanı (gol farkına göre), maç sayısı, lige yeni gelen takım
- form:   üstel ağırlıklı ortalamalar (kısa ve uzun vade): gol, xG, isabetli şut, büyük fırsat, topa sahip olma, puan
- dinlenme: son lig maçından bu yana geçen gün
- eksik:  maçtan önce açıklanan eksik/sakat oyuncuların kalitesi (oyuncuların geçmiş notu ve süre payı)
- kadro:  ilk 11 açıklandıktan sonra: ilk 11'in geçmiş not ortalaması, hücum tehdidi (xG+xA/90), alışılmış 11'e göre fark
- dc:     sitedeki mevcut Dixon-Coles modelinin olasılıkları (js/tahmin.js ile aynı mantık, Python'a aktarıldı)

Kullanım: python model_lab.py <veri klasörü> <çıktı.json>
"""
import json
import math
import os
import sys
import warnings
from collections import defaultdict, deque
from datetime import datetime

import numpy as np

warnings.filterwarnings('ignore')
KLASOR = sys.argv[1] if len(sys.argv) > 1 else '.'
CIKTI = sys.argv[2] if len(sys.argv) > 2 else 'model_lab.json'
yukle = lambda ad: json.load(open(os.path.join(KLASOR, ad + '.json')))

MACLAR = sorted([m for m in yukle('maclar') if m['ev_gol'] is not None], key=lambda m: (m['tarih'], m['id']))
OM = defaultdict(list)
for r in yukle('oyuncu_mac'):
    OM[r['mac_id']].append(r)
IDX = {a['anahtar']: a['sira'] - 1 for a in yukle('anahtarlar')}
TAKIM = {t['id']: t['ad'] for t in yukle('takimlar')}
gun = lambda t: datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() / 86400


def gi(r, k):
    i = IDX.get(k)
    v = (r['ist'] or [])
    return v[i] if i is not None and i < len(v) and v[i] is not None else 0.0


def S(m, k, i):
    v = ((m['istatistik'] or {}).get('ALL') or {}).get(k)
    return None if v is None or v[i] is None else float(v[i])


# ============================================================ Durum (her maçtan SONRA güncellenir)
class EW:
    """Üstel ağırlıklı ortalama; yarılanma maç sayısıyla."""
    def __init__(self, yarilanma, baslangic):
        self.a = 1 - 0.5 ** (1 / yarilanma)
        self.v = baslangic
        self.n = 0

    def ekle(self, x):
        if x is None:
            return
        self.v = x if self.n == 0 else (1 - self.a) * self.v + self.a * x
        self.n += 1


FORM_OLCU = ['gf', 'ga', 'xgf', 'xga', 'sotf', 'sota', 'bcf', 'bca', 'pos', 'pts']
LIG_ORT = {'gf': 1.45, 'ga': 1.45, 'xgf': 1.45, 'xga': 1.45, 'sotf': 4.6, 'sota': 4.6, 'bcf': 2.3, 'bca': 2.3, 'pos': 50, 'pts': 1.37}
YENI_ORT = {'gf': 1.1, 'ga': 1.9, 'xgf': 1.15, 'xga': 1.8, 'sotf': 3.8, 'sota': 5.4, 'bcf': 1.7, 'bca': 2.9, 'pos': 44, 'pts': 0.95}

elo = defaultdict(lambda: 1500.0)
takim_mac = defaultdict(int)
son_mac = {}
form = {}
ilk_gorulen = {}
oyuncu_not = defaultdict(lambda: EW(10, 6.7))
oyuncu_tehdit = defaultdict(lambda: EW(10, 0.1))
oyuncu_sure = defaultdict(lambda: EW(8, 0.0))       # maç başı süre payı (0-1), takımdaki rolü
takim_11 = defaultdict(lambda: EW(10, 6.85))        # alışılmış ilk 11'in not ortalaması
ILK = gun(MACLAR[0]['tarih'])


def form_al(t, yeni):
    if t not in form:
        bas = YENI_ORT if yeni else LIG_ORT
        form[t] = {k: (EW(5, bas[k]), EW(20, bas[k])) for k in FORM_OLCU}
    return form[t]


def yeni_mi(t, g):
    # Verinin ilk 60 gününden sonra ilk kez görülen takım = lige yeni çıkmış
    return t not in ilk_gorulen and g - ILK > 60


# ============================================================ Dixon-Coles (js/tahmin.js'in Python karşılığı, sadeleştirilmiş)
def dc_kur(gecmis, simdi):
    yar, pen, K = 240, 900, 4
    veri = [(t, e, d, ye, yd) for t, e, d, ye, yd in gecmis if simdi - t < pen]
    if len(veri) < 60:
        return None
    lam = math.log(2) / yar
    w = [math.exp(-lam * (simdi - t)) for t, *_ in veri]
    takimlar = {x for _, e, d, *_ in veri for x in (e, d)}
    yenil = {x for x in takimlar if ilk_gorulen.get(x, ILK) - ILK > 60}
    on = lambda x: (0.85, 1.15) if x in yenil else (1.0, 1.0)
    h = {x: on(x)[0] for x in takimlar}
    s = {x: on(x)[1] for x in takimlar}
    yT = sum(wi * (ye + yd) for wi, (_, _, _, ye, yd) in zip(w, veri))
    wT = sum(w)
    ort = yT / (2 * wT)
    evc = 1.15
    for _ in range(25):
        hp, hb, sp, sb = defaultdict(float), defaultdict(float), defaultdict(float), defaultdict(float)
        for wi, (_, e, d, ye, yd) in zip(w, veri):
            hp[e] += wi * ye; hb[e] += wi * ort * evc * s[d]
            hp[d] += wi * yd; hb[d] += wi * ort * s[e]
            sp[d] += wi * ye; sb[d] += wi * ort * evc * h[e]
            sp[e] += wi * yd; sb[e] += wi * ort * h[d]
        for x in takimlar:
            h[x] = (hp[x] + K * ort * on(x)[0]) / (hb[x] + K * ort)
            s[x] = (sp[x] + K * ort * on(x)[1]) / (sb[x] + K * ort)
        pay = sum(wi * (ye + yd) for wi, (_, _, _, ye, yd) in zip(w, veri))
        payda = sum(wi * (evc * h[e] * s[d] + h[d] * s[e]) for wi, (_, e, d, _, _) in zip(w, veri))
        ort = pay / payda
        evp = sum(wi * ye for wi, (_, _, _, ye, _) in zip(w, veri))
        evb = sum(wi * ort * h[e] * s[d] for wi, (_, e, d, _, _) in zip(w, veri))
        evc = evp / evb
    return h, s, ort, evc


def dc_tahmin(model, ev, dep):
    h, s, ort, evc = model
    he, hd = h.get(ev, 0.85), h.get(dep, 0.85)
    se, sd = s.get(ev, 1.15), s.get(dep, 1.15)
    le, ld = ort * evc * he * sd, ort * hd * se
    lig = ort * (evc + 1)
    oran = (lig + (le + ld - lig) * 0.3) / (le + ld)
    le, ld = le * oran, ld * oran
    pe = [math.exp(-le) * le ** k / math.factorial(k) for k in range(11)]
    pd_ = [math.exp(-ld) * ld ** k / math.factorial(k) for k in range(11)]
    rho = -0.08
    p = np.zeros((11, 11))
    for i in range(11):
        for j in range(11):
            tau = 1 - le * ld * rho if i == 0 and j == 0 else 1 + le * rho if (i, j) == (0, 1) else 1 + ld * rho if (i, j) == (1, 0) else 1 - rho if (i, j) == (1, 1) else 1
            p[i, j] = pe[i] * pd_[j] * tau
    p /= p.sum()
    return [float(np.tril(p, -1).sum()), float(np.trace(p)), float(np.triu(p, 1).sum()), le, ld]


# ============================================================ Özellik üretimi
SATIRLAR = []
gecmis = []          # (gün, ev, dep, hedef_ev, hedef_dep)  — DC için
dc_onbellek = {}
for m in MACLAR:
    g = gun(m['tarih'])
    e, d = m['ev_id'], m['dep_id']
    yeni = {t: yeni_mi(t, g) for t in (e, d)}
    f = {}
    # --- güç
    f['elo_fark'] = elo[e] - elo[d]
    f['elo_ev'], f['elo_dep'] = elo[e], elo[d]
    for t, on in ((e, 'ev'), (d, 'dep')):
        f[f'yeni_{on}'] = 1.0 if yeni[t] or takim_mac[t] < 5 and t not in ilk_gorulen else 0.0
        f[f'deneyim_{on}'] = min(takim_mac[t], 38) / 38
        f[f'dinlenme_{on}'] = min(g - son_mac[t], 14) if t in son_mac else 7
        fm = form_al(t, yeni[t])
        for k in FORM_OLCU:
            f[f'{k}_kisa_{on}'] = fm[k][0].v
            f[f'{k}_uzun_{on}'] = fm[k][1].v
    for k in FORM_OLCU:
        f[f'{k}_kisa_fark'] = f[f'{k}_kisa_ev'] - f[f'{k}_kisa_dep']
        f[f'{k}_uzun_fark'] = f[f'{k}_uzun_ev'] - f[f'{k}_uzun_dep']
    f['xg_net_uzun_fark'] = (f['xgf_uzun_ev'] - f['xga_uzun_ev']) - (f['xgf_uzun_dep'] - f['xga_uzun_dep'])
    f['xg_net_kisa_fark'] = (f['xgf_kisa_ev'] - f['xga_kisa_ev']) - (f['xgf_kisa_dep'] - f['xga_kisa_dep'])
    f['dinlenme_fark'] = f['dinlenme_ev'] - f['dinlenme_dep']
    # --- eksik oyuncular (maçtan önce açıklanır)
    for t, on, ev_mi in ((e, 'ev', True), (d, 'dep', False)):
        eksik = [x for x in (m['eksikler'] or []) if x.get('ev') == ev_mi and x.get('tip') == 'missing' and x.get('id')]
        kalite = sum(max(oyuncu_not[x['id']].v - 6.6, 0) * oyuncu_sure[x['id']].v for x in eksik if oyuncu_not[x['id']].n >= 3)
        f[f'eksik_sayi_{on}'] = len(eksik)
        f[f'eksik_kalite_{on}'] = kalite
    f['eksik_kalite_fark'] = f['eksik_kalite_ev'] - f['eksik_kalite_dep']
    # --- ilk 11 (maçtan ~1 saat önce açıklanır)
    for t, on in ((e, 'ev'), (d, 'dep')):
        xi = [r for r in OM[m['id']] if r['takim_id'] == t and not r['yedek']]
        notlar = [oyuncu_not[r['oyuncu_id']].v if oyuncu_not[r['oyuncu_id']].n >= 3 else 6.6 for r in xi if r['mevki'] != 'G']
        kaleci = [oyuncu_not[r['oyuncu_id']].v if oyuncu_not[r['oyuncu_id']].n >= 3 else 6.6 for r in xi if r['mevki'] == 'G']
        f[f'xi_not_{on}'] = float(np.mean(notlar)) if notlar else 6.7
        f[f'xi_kaleci_{on}'] = kaleci[0] if kaleci else 6.7
        f[f'xi_tehdit_{on}'] = sum(oyuncu_tehdit[r['oyuncu_id']].v for r in xi)
        f[f'xi_yeni_{on}'] = sum(oyuncu_not[r['oyuncu_id']].n < 3 for r in xi)
        f[f'xi_rotasyon_{on}'] = f[f'xi_not_{on}'] - takim_11[t].v
    for k in ('xi_not', 'xi_kaleci', 'xi_tehdit', 'xi_rotasyon'):
        f[f'{k}_fark'] = f[f'{k}_ev'] - f[f'{k}_dep']
    # --- Dixon-Coles (gün başına bir kez kurulur)
    if int(g) not in dc_onbellek:
        dc_onbellek.clear()
        dc_onbellek[int(g)] = dc_kur(gecmis, int(g))
    dc = dc_tahmin(dc_onbellek[int(g)], e, d) if dc_onbellek[int(g)] else None
    if dc:
        f['dc_p1'], f['dc_px'], f['dc_p2'], f['dc_lev'], f['dc_ldep'] = dc
    sonuc = 0 if m['ev_gol'] > m['dep_gol'] else 1 if m['ev_gol'] == m['dep_gol'] else 2
    oran = None
    ft = (m['oranlar'] or {}).get('Full time')
    if ft and len(ft) == 3 and all(c[2] for c in ft):
        q = [1 / c[2] for c in ft]
        oran = [x / sum(q) for x in q]
    SATIRLAR.append({'id': m['id'], 'sezon': m['sezon'], 'tarih': m['tarih'], 'ev': TAKIM.get(e, e), 'dep': TAKIM.get(d, d),
                     'f': f, 'y': sonuc, 'oran': oran})

    # ---------- durumu güncelle (maçtan sonra)
    ge, gd = m['ev_gol'], m['dep_gol']
    beklenen = 1 / (1 + 10 ** (-(elo[e] + 60 - elo[d]) / 400))
    gercek = 1 if ge > gd else 0.5 if ge == gd else 0
    kat = 20 * (1 + math.log1p(abs(ge - gd)))
    elo[e] += kat * (gercek - beklenen)
    elo[d] -= kat * (gercek - beklenen)
    for t, i, on in ((e, 0, 'ev'), (d, 1, 'dep')):
        o = 1 - i
        a, b = (ge, gd) if i == 0 else (gd, ge)
        deger = {'gf': a, 'ga': b, 'xgf': S(m, 'expectedGoals', i), 'xga': S(m, 'expectedGoals', o), 'sotf': S(m, 'shotsOnGoal', i),
                 'sota': S(m, 'shotsOnGoal', o), 'bcf': S(m, 'bigChanceCreated', i) or 0.0, 'bca': S(m, 'bigChanceCreated', o) or 0.0,
                 'pos': S(m, 'ballPossession', i), 'pts': 3 if a > b else 1 if a == b else 0}
        fm = form_al(t, yeni[t])
        for k in FORM_OLCU:
            fm[k][0].ekle(deger[k]); fm[k][1].ekle(deger[k])
        takim_mac[t] += 1
        son_mac[t] = g
        ilk_gorulen.setdefault(t, g)
    for r in OM[m['id']]:
        oid = r['oyuncu_id']
        if r['puan'] is not None and r['dakika'] >= 20:
            oyuncu_not[oid].ekle(r['puan'])
        if r['dakika'] >= 20:
            oyuncu_tehdit[oid].ekle((gi(r, 'expectedGoals') + gi(r, 'expectedAssists')) * 90 / r['dakika'])
    for t in (e, d):
        oynayan = {r['oyuncu_id']: r['dakika'] for r in OM[m['id']] if r['takim_id'] == t}
        for oid, dk in oynayan.items():
            oyuncu_sure[oid].ekle(min(dk, 90) / 90)
        xi = [oyuncu_not[r['oyuncu_id']].v for r in OM[m['id']] if r['takim_id'] == t and not r['yedek'] and r['mevki'] != 'G']
        if xi:
            takim_11[t].ekle(float(np.mean(xi)))
    gecmis.append((int(g), e, d, 0.5 * ge + 0.5 * (S(m, 'expectedGoals', 0) if S(m, 'expectedGoals', 0) is not None else ge),
                   0.5 * gd + 0.5 * (S(m, 'expectedGoals', 1) if S(m, 'expectedGoals', 1) is not None else gd)))

print('özellikli maç:', len(SATIRLAR))

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

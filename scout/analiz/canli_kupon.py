"""Gerçek kupon modu: araştırmada son sınavı geçen tek formülü (gol alt/üst, değer eşiği %10) yaklaşan maçlara uygular.

Formül: lojistik regresyon(piyasa olasılığı, çizgi, sitedeki modelin olasılığı, maç bilgileri) — arastirma.py ile aynı.
Burada tüm oynanmış maçlarla eğitilir ve henüz oynanmamış, oranı belli maçlara uygulanır. Değerli seçenek:
formül olasılığı × oran − 1 ≥ eşik. Önerilen her bahis bir kez geçmişe yazılır; maç oynanınca sonucu işlenir
(formülün canlı karnesi).

Kullanım: python canli_kupon.py <veri klasörü> <lig adı> <pazar.json> <fikstur_model.json> <çıktı.json> <geçmiş.json>
  (pazar.json: node pazar_cikar.mjs, fikstur_model.json: node fikstur_model.mjs)
"""
import json
import math
import os
import sys
import warnings
from datetime import datetime, timezone

import numpy as np

warnings.filterwarnings('ignore')
KLASOR, LIG, PAZAR, FMODEL, CIKTI, GECMIS = sys.argv[1:7]
sys.argv = [sys.argv[0], KLASOR, '/dev/null']   # ozellikler.py argv[1]=klasör bekler
import ozellikler as OZ  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402

ESIK = 0.10
EN_AZ_SATIR = 3000          # bundan az geçmiş satırı olan ligde formül kurulmaz
ILGILI = ['bek_gol', 'h2h_gol', 'xgf_kisa_ev', 'xga_kisa_ev', 'xgf_kisa_dep', 'xga_kisa_dep', 't_sut_f_ev', 't_sut_f_dep', 't_pos_l_fark',
          'tarz_uzaklik', 'pres_eslesme']
logit = lambda p: math.log(min(max(p, 1e-4), 1 - 1e-4) / (1 - min(max(p, 1e-4), 1 - 1e-4)))
OZ_ID = {r['id']: r for r in OZ.SATIRLAR}
yukle = lambda ad: json.load(open(os.path.join(KLASOR, ad + '.json')))
tr = lambda c: f'{c:g}'.replace('.', ',')


def oranlar_saglam(ac, kap):
    """arastirma.py ile aynı: bozuk/eski çizgiden kalan açılış oranlarını ele."""
    if any(not x or x <= 1 for x in ac + kap):
        return False
    if any(abs(math.log(a / k)) > math.log(1.6) for a, k in zip(ac, kap)):
        return False
    return 0.98 < sum(1 / a for a in ac) < 1.25


def gol_satirlari(oranlar, model, f):
    """[(çizgi, piyasa olasılığı (açılış, payı çıkarılmış), güncel piyasa olasılığı, açılış [üst, alt], güncel [üst, alt], model p(üst))]"""
    out = []
    for ad, sec in (oranlar or {}).items():
        if not ad.startswith('Match goals') or ad not in model or len(sec) != 2:
            continue
        ust, alt = sec
        if not (ust[1] and alt[1] and ust[2] and alt[2]) or not oranlar_saglam([ust[1], alt[1]], [ust[2], alt[2]]):
            continue
        c = float(ad.split()[-1])
        q = lambda a, b: (1 / a) / (1 / a + 1 / b)
        out.append((c, q(ust[1], alt[1]), q(ust[2], alt[2]), [ust[1], alt[1]], [ust[2], alt[2]], model[ad][0], f))
    return out


def X(satirlar, piyasa):
    """piyasa: 1 = açılış (eğitim böyle), 2 = güncel (yaklaşan maçta en taze bilgi)"""
    return np.array([[logit(s[piyasa]), s[0], logit(s[5])] + [s[6].get(k, np.nan) for k in ILGILI] for s in satirlar], float)


# ---------------- Eğitim: tüm oynanmış maçlar
R = json.load(open(PAZAR))
egitim, y = [], []
for r in R:
    oz = OZ_ID.get(r['id'])
    if not oz:
        continue
    for s in gol_satirlari(r['oranlar'], r.get('model') or {}, oz['f']):
        egitim.append(s)
        y.append(int(r['ev_gol'] + r['dep_gol'] > s[0]))
cikis = {'lig': LIG, 'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes'), 'esik': ESIK, 'egitim_satir': len(egitim),
         'bahisler': [], 'maclar': []}
FIKSTUR = [f for f in yukle('fikstur') if f.get('durum') in (None, 'notstarted')]
if len(egitim) >= EN_AZ_SATIR:
    Xa = X(egitim, 1)
    med = np.nanmedian(Xa, 0)
    Xa = np.where(np.isnan(Xa), med, Xa)
    o, sd = Xa.mean(0), Xa.std(0) + 1e-9
    lr = LogisticRegression(C=0.3, max_iter=4000).fit((Xa - o) / sd, np.array(y))
    tahmin = lambda Xb: lr.predict_proba((np.where(np.isnan(Xb), med, Xb) - o) / sd)[:, 1]

    # ---------------- Yaklaşan maçlar
    FM = json.load(open(FMODEL))
    for fx in sorted(FIKSTUR, key=lambda f: f['tarih']):
        fm = FM.get(str(fx['id']))
        if not fm or not fx.get('oranlar'):
            continue
        f = OZ.ozellik_hesapla(fx, OZ.gun(fx['tarih']))
        satir = gol_satirlari(fx['oranlar'], fm['model'], f)
        mac = {'id': fx['id'], 't': fx['tarih'], 'e': fx['ev_ad'], 'd': fx['dep_ad'], 'hafta': fx.get('hafta'),
               'oran_saati': fx.get('oran_guncellendi'), 'bek_gol': round(fm['lev'] + fm['ldep'], 2), 'cizgiler': []}
        if satir:
            P = tahmin(X(satir, 2))
            for s, p in zip(satir, P):
                c = s[0]
                secenekler = [(f'{tr(c)} Üst', float(p), s[4][0]), (f'{tr(c)} Alt', 1 - float(p), s[4][1])]
                mac['cizgiler'].append([tr(c), round(float(p), 3), round(s[2], 3), s[4]])
                for ad, pf, oran in secenekler:
                    deger = pf * oran - 1
                    if deger >= ESIK:
                        cikis['bahisler'].append({'id': fx['id'], 't': fx['tarih'], 'e': fx['ev_ad'], 'd': fx['dep_ad'], 'pazar': f'Toplam gol {tr(c)}',
                                                  'secim': ad, 'p': round(pf, 3), 'oran': oran, 'deger': round(deger, 3),
                                                  'en_az_oran': round((1 + ESIK) / pf, 2), 'piyasa_p': round(s[2] if 'Üst' in ad else 1 - s[2], 3)})
        cikis['maclar'].append(mac)
    # Aynı maçta birden çok çizgi değerli çıkabilir (hepsi aynı görüşün farklı hâli): maç başına en yüksek olasılıklı tek seçim
    en_iyi = {}
    for b in cikis['bahisler']:
        if b['id'] not in en_iyi or b['p'] > en_iyi[b['id']]['p']:
            en_iyi[b['id']] = b
    cikis['bahisler'] = sorted(en_iyi.values(), key=lambda b: (b['t'], -b['p']))

# ---------------- Canlı karne: önerilen her bahis bir kez yazılır, oynanınca sonuç işlenir
try:
    gecmis = json.load(open(GECMIS))
except (FileNotFoundError, json.JSONDecodeError):
    gecmis = {'aciklama': 'Gerçek kupon modunun önerdiği bahisler (ilk önerildiği andaki oranla) ve sonuçları.', 'bahisler': []}
var = {(b['id'], b['secim']) for b in gecmis['bahisler']}
for b in cikis['bahisler']:
    if (b['id'], b['secim']) not in var:
        gecmis['bahisler'].append({**b, 'lig': LIG, 'onerildi': cikis['olusturuldu'], 'sonuc': None})
skor = {m['id']: (m['ev_gol'], m['dep_gol']) for m in OZ.MACLAR}
for b in gecmis['bahisler']:
    if b['sonuc'] is None and b['id'] in skor:
        g = sum(skor[b['id']])
        c = float(b['secim'].split()[0].replace(',', '.'))
        b['skor'] = list(skor[b['id']])
        b['sonuc'] = int(g > c) if 'Üst' in b['secim'] else int(g < c)
json.dump(gecmis, open(GECMIS, 'w'), ensure_ascii=False, separators=(',', ':'))

try:
    hepsi = json.load(open(CIKTI))
except (FileNotFoundError, json.JSONDecodeError):
    hepsi = {}
hepsi[LIG] = cikis
json.dump(hepsi, open(CIKTI, 'w'), ensure_ascii=False, separators=(',', ':'))
print(LIG, 'eğitim satırı', len(egitim), '| oranlı yaklaşan maç', len(cikis['maclar']), '| değerli bahis', len(cikis['bahisler']))

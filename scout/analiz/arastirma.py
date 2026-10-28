"""Scout — "en çok kazandıran yöntem" araştırması (Premier Lig).

Soru: Hangi pazarda, hangi bilgilerle, hangi kuralla bahis şirketinin oranlarını yenebiliriz?

Katı sınav düzeni (çok şey denendiğinde şans eseri iyi görünenleri elemek için):
  eğitim   : 1 Temmuz 2025'ten önceki maçlar
  doğrulama: 1 Temmuz 2025 – 31 Aralık 2025 (fikirler ve eşikler burada seçilir)
  son sınav: 1 Ocak 2026 ve sonrası (yalnızca doğrulamada seçilen kurallar burada BİR KEZ sınanır)
Her pazar için modeller: yalnız piyasa, piyasa + bizim model, piyasa + model + maç bilgileri (lojistik regresyon ve
gradient boosting). İki zamanlama: açılış oranlarıyla (günler önce) ve maç saatindeki oranlarla oynamak.

Kullanım: python arastirma.py <veri klasörü> <kupon_gecmis.json> <çıktı.json>
"""
import json
import math
import sys
import warnings
from collections import defaultdict

import numpy as np

warnings.filterwarnings('ignore')
sys.argv = [sys.argv[0], sys.argv[1], '/dev/null'] + sys.argv[2:]   # ozellikler.py argv[1]=klasör bekler
import ozellikler as OZ  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
import lightgbm as lgb  # noqa: E402

KUPON, CIKTI = sys.argv[3], sys.argv[4]
OZ_ID = {r['id']: r for r in OZ.SATIRLAR}
MAC = {m['id']: m for m in OZ.MACLAR}
EGITIM_SON, DOGRULAMA_SON = '2025-07-01', '2026-01-01'
donem = lambda t: 'egitim' if t < EGITIM_SON else 'dogrulama' if t < DOGRULAMA_SON else 'sinav'
rng = np.random.default_rng(7)
logit = lambda p: math.log(min(max(p, 1e-4), 1 - 1e-4) / (1 - min(max(p, 1e-4), 1 - 1e-4)))

# ============================================================ Pazar satırları
# Her satır = bir maçın bir pazarı. İkili pazarlarda hedef "üst/var/evet oldu mu", üç yollu pazarlarda 0/1/2.
KUPON_V = json.load(open(KUPON))['maclar']
ILGILI = {   # her pazar için anlamlı maç bilgileri
    'gol': ['bek_gol', 'h2h_gol', 'xgf_kisa_ev', 'xga_kisa_ev', 'xgf_kisa_dep', 'xga_kisa_dep', 't_sut_f_ev', 't_sut_f_dep', 't_pos_l_fark', 'tarz_uzaklik', 'pres_eslesme'],
    'kg': ['bek_gol', 'h2h_gol', 'xgf_kisa_ev', 'xga_kisa_ev', 'xgf_kisa_dep', 'xga_kisa_dep', 'tarz_uzaklik'],
    'korner': ['bek_korner', 't_kor_f_ev', 't_kor_a_ev', 't_kor_f_dep', 't_kor_a_dep', 't_orta_ev', 't_orta_dep', 't_pos_l_fark', 't_sut_f_ev', 't_sut_f_dep'],
    'kart': ['bek_kart', 'hakem_kart', 'hakem_n', 't_faul_ev', 't_faul_dep', 't_kart_f_ev', 't_kart_f_dep', 'pres_eslesme', 'elo_fark', 'h2h_n'],
    'ms': ['xg_net_kisa_fark', 'xg_net_uzun_fark', 'elo_fark', 'ic_dis_fark', 'h2h_puan', 'h2h_averaj', 'h2h_n', 'pts_kisa_fark', 'eksik_kalite_fark',
           'dinlenme_fark', 't_pos_l_fark', 't_ppda_fark', 't_uzun_pay_fark'],
}
ILK11 = ['xi_not_fark', 'xi_tehdit_fark', 'xi_kaleci_fark', 'xi_rotasyon_fark']


def oranlar_saglam(ac, kap):
    """Açılış oranı, çizgi değişince eski çizgiden kalabiliyor: kapanışla çok farklıysa ya da şirket payı mantıksızsa satır atılır."""
    if any(not x or x <= 1 for x in ac + kap):
        return False
    if any(abs(math.log(a / k)) > math.log(1.6) for a, k in zip(ac, kap)):
        return False
    pay = sum(1 / a for a in ac)
    return 0.98 < pay < 1.25


def ikili_satirlar(kat):
    out = []
    for m in KUPON_V:
        oz = OZ_ID.get(m['id'])
        if not oz:
            continue
        for k, ad, sec in m['pz']:
            if k != kat or len(sec) != 2:
                continue
            ev, hy = sec   # [ad, model p, piyasa p (kapanış), açılış, kapanış, tuttu]
            if not (ev[3] and hy[3] and ev[4] and hy[4]):
                continue
            if not oranlar_saglam([ev[3], hy[3]], [ev[4], hy[4]]):
                continue
            q_ac = (1 / ev[3]) / (1 / ev[3] + 1 / hy[3])
            cizgi = float(ad.split()[-1].replace(',', '.')) if any(c.isdigit() for c in ad) else 0.0
            out.append({'id': m['id'], 't': m['t'], 'pazar': ad, 'y': ev[5], 'iade': ev[5] == 0 and hy[5] == 0,
                        'p_model': ev[1], 'p_kap': ev[2], 'p_ac': q_ac, 'o_ac': [ev[3], hy[3]], 'o_kap': [ev[4], hy[4]],
                        'cizgi': cizgi, 'f': oz['f'], 'secenek': [ev[0], hy[0]]})
    return out


def ms_satirlar():
    out = []
    for oz in OZ.SATIRLAR:
        m = MAC[oz['id']]
        ft = (m['oranlar'] or {}).get('Full time')
        if not ft or len(ft) != 3 or not all(c[1] and c[2] for c in ft) or 'dc_p1' not in oz['f']:
            continue
        if not oranlar_saglam([c[1] for c in ft], [c[2] for c in ft]):
            continue
        ac = np.array([1 / c[1] for c in ft]); kp = np.array([1 / c[2] for c in ft])
        out.append({'id': oz['id'], 't': m['tarih'][:10], 'pazar': 'Maç sonucu', 'y': oz['y'], 'p_model': [oz['f']['dc_p1'], oz['f']['dc_px'], oz['f']['dc_p2']],
                    'p_kap': (kp / kp.sum()).tolist(), 'p_ac': (ac / ac.sum()).tolist(), 'o_ac': [c[1] for c in ft], 'o_kap': [c[2] for c in ft], 'f': oz['f'],
                    'secenek': ['MS 1', 'MS X', 'MS 2']})
    return out


# ============================================================ Modeller
def ikili_X(rs, zaman, model_ekle, ozellik):
    pm = 'p_ac' if zaman == 'acilis' else 'p_kap'
    cols = [[logit(r[pm]), r['cizgi']] for r in rs]
    if model_ekle:
        cols = [c + [logit(r['p_model'])] for c, r in zip(cols, rs)]
    if ozellik:
        cols = [c + [r['f'].get(k, np.nan) for k in ozellik] for c, r in zip(cols, rs)]
    return np.array(cols, float)


def coklu_X(rs, zaman, model_ekle, ozellik):
    pm = 'p_ac' if zaman == 'acilis' else 'p_kap'
    cols = [[math.log(r[pm][0] / r[pm][2]), math.log(r[pm][1])] for r in rs]
    if model_ekle:
        cols = [c + [math.log(r['p_model'][0] / r['p_model'][2]), math.log(r['p_model'][1])] for c, r in zip(cols, rs)]
    if ozellik:
        cols = [c + [r['f'].get(k, np.nan) for k in ozellik] for c, r in zip(cols, rs)]
    return np.array(cols, float)


def egit_tahmin(tur, Xa, ya, Xb):
    med = np.nanmedian(Xa, 0)
    Xa = np.where(np.isnan(Xa), med, Xa); Xb = np.where(np.isnan(Xb), med, Xb)
    if tur == 'lr':
        o, s = Xa.mean(0), Xa.std(0) + 1e-9
        m = LogisticRegression(C=0.3, max_iter=4000).fit((Xa - o) / s, ya)
        return m.predict_proba((Xb - o) / s)
    m = lgb.LGBMClassifier(n_estimators=150, learning_rate=0.03, num_leaves=5, min_child_samples=40, subsample=0.8, subsample_freq=1,
                           colsample_bytree=0.8, reg_lambda=5, verbose=-1)
    m.fit(Xa, ya)
    return m.predict_proba(Xb)


def kayip(P, y):
    return float(-np.mean(np.log(np.clip(P[np.arange(len(y)), y], 1e-9, 1))))


# ============================================================ Bahis kuralı ve değerlendirme
def bahisler(P, rs, zaman, esik, coklu):
    """Her satırda beklenen değeri en yüksek seçeneğe, esik'ten büyükse 1 birim. Dönüş: [(kazanç, açılış/kapanış oran farkı, tuttu)]"""
    ok = 'o_ac' if zaman == 'acilis' else 'o_kap'
    out = []
    for p, r in zip(P, rs):
        oranlar = r[ok]
        olas = p if coklu else [p[1], p[0]]          # ikili: sınıf 1 = üst/var
        ev = [olas[i] * oranlar[i] - 1 for i in range(len(oranlar))]
        i = int(np.argmax(ev))
        if ev[i] <= esik:
            continue
        if coklu:
            tuttu = r['y'] == i
        else:
            tuttu = (r['y'] == 1) if i == 0 else (r['y'] == 0 and not r['iade'])
        iade = (not coklu) and r['iade']
        kaz = 0.0 if iade else (oranlar[i] - 1 if tuttu else -1.0)
        clv = r['o_ac'][i] / r['o_kap'][i] - 1
        out.append((kaz, clv, tuttu, r['secenek'][i], oranlar[i]))
    return out


def ozet(b):
    if not b:
        return {'n': 0}
    k = np.array([x[0] for x in b])
    bs = np.array([k[rng.integers(0, len(k), len(k))].mean() for _ in range(2000)])
    return {'n': len(b), 'roi': float(k.mean()), 'alt': float(np.percentile(bs, 5)), 'ust': float(np.percentile(bs, 95)),
            'karli_ol': float((bs > 0).mean()), 'tutma': float(np.mean([x[2] for x in b])), 'clv': float(np.mean([x[1] for x in b])),
            'ort_oran': float(np.mean([x[4] for x in b]))}


def arastir(ad, rs, coklu, ozellik):
    y = np.array([r['y'] for r in rs])
    d = np.array([donem(r['t']) for r in rs])
    sonuc = []
    for zaman in ('acilis', 'kapanis'):
        fX = coklu_X if coklu else ikili_X
        adaylar = [('Yalnız piyasa (kalibre)', 'lr', False, []), ('Piyasa + bizim model', 'lr', True, []),
                   ('Piyasa + model + maç bilgileri', 'lr', True, ozellik), ('Piyasa + model + maç bilgileri (boosting)', 'gbm', True, ozellik)]
        if coklu:
            adaylar.append(('Piyasa + model + maç bilgileri + ilk 11', 'lr', True, ozellik + ILK11))
        pm = 'p_ac' if zaman == 'acilis' else 'p_kap'
        P0 = {}
        for kume in ('dogrulama', 'sinav'):
            sec = d == kume
            if coklu:
                P0[kume] = np.array([r[pm] for r, s in zip(rs, sec) if s])
            else:
                p = np.array([r[pm] for r, s in zip(rs, sec) if s]); P0[kume] = np.c_[1 - p, p]
        for mad, tur, model_ekle, oz in adaylar:
            X = fX(rs, zaman, model_ekle, oz)
            a = d == 'egitim'
            if a.sum() < 150 or (d == 'dogrulama').sum() < 50:
                continue
            Pv = egit_tahmin(tur, X[a], y[a], X[d == 'dogrulama'])
            ad_ = d != 'sinav'   # son sınav için eğitim + doğrulama ile yeniden eğit
            Ps = egit_tahmin(tur, X[ad_], y[ad_], X[d == 'sinav']) if (d == 'sinav').sum() else None
            rv = [r for r, s in zip(rs, d == 'dogrulama') if s]
            rs_ = [r for r, s in zip(rs, d == 'sinav') if s]
            k = {'pazar': ad, 'zaman': zaman, 'model': mad,
                 'kayip_dogrulama': kayip(Pv, y[d == 'dogrulama']) - kayip(P0['dogrulama'], y[d == 'dogrulama']),
                 'kayip_sinav': (kayip(Ps, y[d == 'sinav']) - kayip(P0['sinav'], y[d == 'sinav'])) if Ps is not None else None}
            # Doğrulamada en iyi eşik seçilir, son sınavda yalnızca o eşik uygulanır
            en, en_esik = None, None
            for esik in (0.0, 0.03, 0.06, 0.10, 0.15):
                o = ozet(bahisler(Pv, rv, zaman, esik, coklu))
                if o['n'] >= 25 and (en is None or o['roi'] > en['roi']):
                    en, en_esik = o, esik
            k['dogrulama'] = en
            k['esik'] = en_esik
            k['sinav'] = ozet(bahisler(Ps, rs_, zaman, en_esik, coklu)) if Ps is not None and en_esik is not None else {'n': 0}
            sonuc.append(k)
            print(f"{ad:16s} {zaman:8s} {mad:44s} Δkayıp(d)={k['kayip_dogrulama']:+.4f} "
                  f"doğrulama ROI={100 * (en or {}).get('roi', float('nan')):+.1f}% n={(en or {}).get('n', 0)} eşik={en_esik} │ "
                  f"SINAV ROI={100 * k['sinav'].get('roi', float('nan')):+.1f}% n={k['sinav']['n']} CLV={100 * k['sinav'].get('clv', float('nan')):+.1f}%")
    return sonuc


TUM = []
TUM += arastir('Maç sonucu', ms_satirlar(), True, ILGILI['ms'])
for kat, ad in (('gol', 'Gol alt/üst'), ('kg', 'Karşılıklı gol'), ('korner', 'Korner alt/üst'), ('kart', 'Kart alt/üst')):
    TUM += arastir(ad, ikili_satirlar(kat), False, ILGILI[kat])
# ============================================================ Son sınava kim girer?
# Yalnızca doğrulamaya bakılarak: en az 40 bahis, doğrulamada kârlı ve olasılık kalitesi piyasadan kötü değil.
aday = [k for k in TUM if k['dogrulama'] and k['dogrulama']['n'] >= 40 and k['dogrulama']['roi'] > 0 and k['kayip_dogrulama'] <= 0.002]
aday.sort(key=lambda k: -k['dogrulama']['roi'] * math.sqrt(k['dogrulama']['n']))
SECILEN = aday[:5]
print('\n=== Doğrulamada seçilenler ve SON SINAV ===')
for k in SECILEN:
    v, t = k['dogrulama'], k['sinav']
    print(f"{k['pazar']:15s} {k['zaman']:8s} {k['model']:44s} eşik={k['esik']} │ doğrulama ROI={100 * v['roi']:+.1f}% n={v['n']} │ "
          f"SINAV ROI={100 * t.get('roi', float('nan')):+.1f}% [{100 * t.get('alt', float('nan')):+.0f}, {100 * t.get('ust', float('nan')):+.0f}] "
          f"n={t['n']} tutma=%{100 * t.get('tutma', float('nan')):.0f} kârlı olasılığı=%{100 * t.get('karli_ol', float('nan')):.0f} CLV={100 * t.get('clv', float('nan')):+.1f}%")
json.dump({'tum': TUM, 'secilen': SECILEN}, open(CIKTI, 'w'), ensure_ascii=False, indent=1, default=float)
print('yazıldı', CIKTI)

# ============================================================ Site bölümü (Analiz sekmesi)
import re  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

ZAMAN = {'acilis': 'açılış oranı (günler önce)', 'kapanis': 'maç saatindeki oran'}
yz = lambda x: '–' if x is None or (isinstance(x, float) and math.isnan(x)) else f"{'+' if x > 0 else ''}{100 * x:.1f}%"
# Her pazar × zamanlama için doğrulamada en iyi model
en_iyi = {}
for k in TUM:
    if not k['dogrulama']:
        continue
    anahtar = (k['pazar'], k['zaman'])
    if anahtar not in en_iyi or k['dogrulama']['roi'] > en_iyi[anahtar]['dogrulama']['roi']:
        en_iyi[anahtar] = k
tablo = [[p, ZAMAN[z], k['model'], f"{k['dogrulama']['n']}", yz(k['dogrulama']['roi']), f"{k['sinav'].get('n', 0)}", yz(k['sinav'].get('roi')),
          yz(k['sinav'].get('clv'))] for (p, z), k in en_iyi.items()]
kaz = SECILEN[0] if SECILEN else None
gecen = [k for k in SECILEN if k['sinav'].get('n', 0) >= 30 and k['sinav']['roi'] > 0.02]
bolum = {
    'id': 'kazanc', 'baslik': 'Para kazandırır mı? Bütün pazarlar ve bilgiler sınandı', 'ikon': '💰',
    'ozet': (f"Maç sonucu, gol alt/üst, karşılıklı gol, korner ve kart pazarlarında; piyasa oranları, kendi modelimiz ve maç bilgileri (form, xG, "
             f"aralarındaki son maçlar, iç saha/deplasman formu, oyun tarzı, korner/kart eğilimleri, hakem, eksikler, ilk 11) birlikte denendi. "
             f"Fikirler 2025 yazından önceki maçlarla geliştirildi, 2025'in ikinci yarısında seçildi, 2026 maçlarında bir kez sınandı. "
             + (f"Son sınavı kârla geçen tek yöntem: {gecen[0]['pazar'].lower()} pazarında {ZAMAN[gecen[0]['zaman']]} ile, modelin en az "
                f"%{100 * gecen[0]['esik']:.0f} değer gördüğü bahisler — {gecen[0]['sinav']['n']} bahiste {yz(gecen[0]['sinav']['roi'])} "
                f"(kârlı olma olasılığı %{100 * gecen[0]['sinav']['karli_ol']:.0f}). Bu umut verici ama kanıt değil."
                if gecen else "Hiçbir yöntem son sınavı güvenilir bir kârla geçemedi.")
             + " Doğrulamada kârlı görünen yöntemlerin çoğu son sınavda zarara döndü: çok şey denenince şans eseri iyi görünen sonuçlar çıkar."),
    'bloklar': [
        {'tur': 'tablo', 'baslik': 'Son sınava seçilen yöntemler', 'not': 'Yalnızca doğrulama sonuçlarına bakılarak seçildi; son sınav bu yöntemleri ilk kez gördü. '
         'Değer eşiği: modelin olasılığı × oran − 1. CLV: alınan oranın maç saatindeki orandan ne kadar iyi olduğu (pozitif = piyasa sonradan bizim yönümüze geldi).',
         'sutunlar': ['Pazar', 'Zamanlama', 'Model', 'Değer eşiği', 'Doğrulama', 'Son sınav', '%90 aralık', 'Bahis', 'Tutma', 'CLV'], 'sayisal': [3, 4, 5, 6, 7, 8, 9],
         'satirlar': [[k['pazar'], ZAMAN[k['zaman']], k['model'], f"%{100 * k['esik']:.0f}", yz(k['dogrulama']['roi']), yz(k['sinav'].get('roi')),
                       f"{yz(k['sinav'].get('alt'))} … {yz(k['sinav'].get('ust'))}", k['sinav'].get('n', 0), f"%{100 * k['sinav'].get('tutma', 0):.0f}",
                       yz(k['sinav'].get('clv'))] for k in SECILEN]},
        {'tur': 'tablo', 'baslik': 'Her pazarda en iyi model (100 TL başına sonuç)', 'not': 'Doğrulama: 2025 Temmuz–Aralık. Son sınav: 2026. Korner, kart ve karşılıklı gol oranları 2024/25\'ten beri tutuluyor.',
         'sutunlar': ['Pazar', 'Zamanlama', 'En iyi model', 'Bahis (d)', 'Doğrulama', 'Bahis (s)', 'Son sınav', 'CLV'], 'sayisal': [3, 4, 5, 6, 7], 'satirlar': tablo},
        {'tur': 'baslik', 'metin': 'Sonuç: para kazanmak istiyorsan kuponu nasıl yapmalısın?'},
        {'tur': 'tablo', 'sutunlar': ['Kural', 'Neden'], 'satirlar': [
            ['Kombine kupon yapma, tek maç oyna', 'Her seçimde şirketin payı var; kombinede paylar çarpılır. 3\'lü kupon, aynı maçların tek tek oynanmasından her zaman daha çok kaybettirdi.'],
            ['En umut verici pazar: gol alt/üst', 'Son sınavı kârla geçen tek yöntem bu pazarda. Korner, kart ve karşılıklı golde avantaj bulunamadı; kart pazarında model kaybettirdi.'],
            ['Oranlar açılır açılmaz oyna', 'Avantaj yalnızca açılış oranlarında görüldü; maç saatine kadar piyasa düzeliyor ve avantaj kayboluyor.'],
            ['Yalnızca model en az %10 değer gördüğünde oyna', 'Düşük eşiklerde (her maça bahis) her yöntem zarar etti.'],
            ['Her bahse aynı küçük tutarı koy', 'Kârlı olma olasılığı %70 civarında; yani hâlâ %30 ihtimalle bu sonuç şans. Kaybetmeyi göze alamayacağın parayla oynama.'],
            ['Önce kâğıt üzerinde dene', 'Gerçek parayla oynamadan önce birkaç ay modelin seçimlerini kaydedip izlemek, avantajın gerçek olup olmadığını gösterir.'],
            ['İddaa oranları daha düşük', 'Bu sınama uluslararası şirketlerin oranlarıyla yapıldı. İddaa\'nın payı çok daha yüksek; bu küçük avantajı tamamen silebilir.'],
        ]},
    ]}
cikti_site = CIKTI.replace('.json', '_site.json') if CIKTI.endswith('.json') else CIKTI + '_site.json'


def tr_ondalik(x):
    if isinstance(x, dict):
        return {k: tr_ondalik(v) for k, v in x.items()}
    if isinstance(x, list):
        return [tr_ondalik(v) for v in x]
    if isinstance(x, str):
        return re.sub(r'(?<=\d)\.(?=\d)', ',', x)
    return x


json.dump({'olusturuldu': datetime.now(timezone.utc).isoformat(timespec='minutes'), 'bolumler': [tr_ondalik(bolum)]},
          open(cikti_site, 'w'), ensure_ascii=False, indent=1)
print('site bölümü', cikti_site)

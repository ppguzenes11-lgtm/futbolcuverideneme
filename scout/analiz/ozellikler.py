"""Scout — maç öncesi özellik üretimi (tahmin laboratuvarı ve araştırma ortak kullanır).

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
# Araştırma için ek durumlar: aralarındaki maçlar, iç saha/deplasman formu, oyun tarzı, korner/kart eğilimi, hakem
h2h = defaultdict(lambda: deque(maxlen=6))          # frozenset(takımlar) → (ev, ev_gol, dep_gol)
ic_form = defaultdict(lambda: EW(8, 1.6))            # iç sahada puan
dis_form = defaultdict(lambda: EW(8, 1.1))           # deplasmanda puan
TARZ_OLCU = {'uzun_pay': 12, 'orta': 17, 'ppda': 12.5, 'hava': 34, 'faul': 10.5, 'kor_f': 5, 'kor_a': 5, 'kart_f': 2, 'kart_a': 2,
             'uzak_pay': 38, 'sut_f': 12.5, 'sut_a': 12.5, 'pos_l': 50}
tarz = defaultdict(lambda: {k: EW(12, v) for k, v in TARZ_OLCU.items()})
hakem_kart = defaultdict(lambda: EW(15, 4.1))
hakem_pen = defaultdict(lambda: EW(15, 0.25))


def ST(m, k, i):
    """Başarılı/toplam biçimindeki istatistiğin toplam değeri (ör. uzun top denemesi)."""
    v = ((m['istatistik'] or {}).get('ALL') or {}).get(k)
    return None if v is None or len(v) < 4 or v[i + 2] is None else float(v[i + 2])


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
    # --- aralarındaki son maçlar (en çok 6), mevcut ev sahibinin bakışıyla
    gecmis_h2h = h2h[frozenset((e, d))]
    f['h2h_n'] = len(gecmis_h2h)
    f['h2h_puan'] = float(np.mean([(3 if (a > b) == (ev_ == e) and a != b else 1 if a == b else 0) for ev_, a, b in gecmis_h2h])) if gecmis_h2h else 1.37
    f['h2h_averaj'] = float(np.mean([(a - b) if ev_ == e else (b - a) for ev_, a, b in gecmis_h2h])) if gecmis_h2h else 0.0
    f['h2h_gol'] = float(np.mean([a + b for _, a, b in gecmis_h2h])) if gecmis_h2h else 2.8
    # --- iç saha / deplasman formu
    f['ic_form_ev'], f['dis_form_dep'] = ic_form[e].v, dis_form[d].v
    f['ic_dis_fark'] = f['ic_form_ev'] - f['dis_form_dep']
    # --- oyun tarzı ve korner/kart eğilimleri
    for t, on in ((e, 'ev'), (d, 'dep')):
        for k in TARZ_OLCU:
            f[f't_{k}_{on}'] = tarz[t][k].v
    for k in TARZ_OLCU:
        f[f't_{k}_fark'] = f[f't_{k}_ev'] - f[f't_{k}_dep']
    f['bek_korner'] = (f['t_kor_f_ev'] + f['t_kor_a_dep'] + f['t_kor_f_dep'] + f['t_kor_a_ev']) / 2
    f['bek_kart'] = (f['t_kart_f_ev'] + f['t_kart_a_dep'] + f['t_kart_f_dep'] + f['t_kart_a_ev']) / 2
    f['bek_gol'] = (f['xgf_uzun_ev'] + f['xga_uzun_dep'] + f['xgf_uzun_dep'] + f['xga_uzun_ev']) / 2
    f['pres_eslesme'] = f['t_ppda_ev'] * f['t_ppda_dep']
    f['tarz_uzaklik'] = abs(f['t_pos_l_fark']) + abs(f['t_uzun_pay_fark'])
    hk = (m.get('hakem') or {}).get('id')
    f['hakem_kart'] = hakem_kart[hk].v if hk else 4.1
    f['hakem_pen'] = hakem_pen[hk].v if hk else 0.25
    f['hakem_n'] = hakem_kart[hk].n if hk else 0
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
    h2h[frozenset((e, d))].append((e, ge, gd))
    ic_form[e].ekle(3 if ge > gd else 1 if ge == gd else 0)
    dis_form[d].ekle(3 if gd > ge else 1 if ge == gd else 0)
    for t, i in ((e, 0), (d, 1)):
        o_ = 1 - i
        pas = S(m, 'passes', i)
        mud = [S(m, 'totalTackle', i), S(m, 'interceptionWon', i), S(m, 'fouls', i)]
        sut = S(m, 'totalShotsOnGoal', i)
        kart_f = (S(m, 'yellowCards', i) or 0) + (S(m, 'redCards', i) or 0) if S(m, 'fouls', i) is not None else None
        kart_a = (S(m, 'yellowCards', o_) or 0) + (S(m, 'redCards', o_) or 0) if S(m, 'fouls', o_) is not None else None
        deg = {'uzun_pay': 100 * ST(m, 'accurateLongBalls', i) / pas if pas and ST(m, 'accurateLongBalls', i) is not None else None,
               'orta': ST(m, 'accurateCross', i), 'ppda': S(m, 'passes', o_) / sum(mud) if None not in mud and sum(mud) and S(m, 'passes', o_) else None,
               'hava': ST(m, 'aerialDuelsPercentage', i), 'faul': S(m, 'fouls', i), 'kor_f': S(m, 'cornerKicks', i), 'kor_a': S(m, 'cornerKicks', o_),
               'kart_f': kart_f, 'kart_a': kart_a, 'uzak_pay': 100 * S(m, 'totalShotsOutsideBox', i) / sut if sut and S(m, 'totalShotsOutsideBox', i) is not None else None,
               'sut_f': sut, 'sut_a': S(m, 'totalShotsOnGoal', o_), 'pos_l': S(m, 'ballPossession', i)}
        for k, v in deg.items():
            tarz[t][k].ekle(v)
    if hk:
        kt = [S(m, 'yellowCards', 0), S(m, 'yellowCards', 1)]
        if kt[0] is not None or kt[1] is not None:
            hakem_kart[hk].ekle(sum(x or 0 for x in kt) + (S(m, 'redCards', 0) or 0) + (S(m, 'redCards', 1) or 0))
        hakem_pen[hk].ekle(sum(1 for o in (m['olaylar'] or []) if (o['t'] == 'goal' and o['s'] == 'penalty') or o['t'] == 'inGamePenalty'))
    gecmis.append((int(g), e, d, 0.5 * ge + 0.5 * (S(m, 'expectedGoals', 0) if S(m, 'expectedGoals', 0) is not None else ge),
                   0.5 * gd + 0.5 * (S(m, 'expectedGoals', 1) if S(m, 'expectedGoals', 1) is not None else gd)))

print('özellikli maç:', len(SATIRLAR))

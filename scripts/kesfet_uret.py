"""
Keşfet sayfasının istatistiklerini veritabanından hesaplayıp veri/kesfet.json dosyasına yazar.
Site bu dosyayı okur (anında açılsın diye istatistikler önceden hesaplanır).

Kullanım: python scripts/kesfet_uret.py   (veri yenilenince tekrar çalıştırın)
"""
import json
import re
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
_cfg = (KOK / "js" / "config.js").read_text(encoding="utf-8")
URL = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", _cfg).group(1) + "/rest/v1"
KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", _cfg).group(1)

BUGUN = date.today()
BU_SEZON = BUGUN.year if BUGUN.month >= 7 else BUGUN.year - 1
LIG_ULKE = {"TR1": "Türkiye", "GB1": "England", "ES1": "Spain", "IT1": "Italy", "L1": "Germany", "FR1": "France", "PO1": "Portugal", "NL1": "Netherlands"}


def _sayfa(tablo, sutunlar, ofs):
    req = urllib.request.Request(f"{URL}/{tablo}?select={sutunlar}&order={ORDER[tablo]}&limit=1000&offset={ofs}", headers={"apikey": KEY})
    return json.load(urllib.request.urlopen(req, timeout=120))


ORDER = {"oyuncular": "id", "kulupler": "id", "ligler": "kod", "lig_kulupleri": "lig_kod,sezon,kulup_id",
         "kulup_turnuvalari": "kulup_id,sezon,turnuva_kod", "oyuncu_turnuvalari": "oyuncu_id,kulup_id,sezon,turnuva_kod",
         "oyuncu_sezonlari": "oyuncu_id,kulup_id,sezon"}


def hepsi(tablo, sutunlar):
    """Tabloyu 1000'erlik sayfalarla, 8 paralel istekle okur."""
    out = []
    ofs = 0
    with ThreadPoolExecutor(8) as ex:
        while True:
            sayfalar = list(ex.map(lambda o: _sayfa(tablo, sutunlar, o), range(ofs, ofs + 8000, 1000)))
            for s in sayfalar:
                out.extend(s)
            if len(sayfalar[-1]) < 1000:
                return out
            ofs += 8000


def main():
    print("Veri okunuyor…")
    ligler = {r["kod"]: r for r in hepsi("ligler", "kod,ad,ulke")}
    kulupler = {r["id"]: r["ad"] for r in hepsi("kulupler", "id,ad")}
    oyuncular = {r["id"]: r for r in hepsi("oyuncular", "id,ad,uyruk,mevki,dogum_tarihi,boy_cm,ayak")}
    lk = hepsi("lig_kulupleri", "lig_kod,sezon,kulup_id")
    kt = hepsi("kulup_turnuvalari", "kulup_id,sezon,turnuva_kod,mac_basi_puan")
    ot = hepsi("oyuncu_turnuvalari", "oyuncu_id,kulup_id,sezon,turnuva_kod,kadroda,mac,gol,asist,sari,ikinci_sari,kirmizi,oyuna_girdi,dakika")
    os_ = hepsi("oyuncu_sezonlari", "oyuncu_id,kulup_id,sezon,yas,piyasa_degeri_eur")
    print(f"{len(oyuncular)} oyuncu, {len(ot)} lig satırı, {len(os_)} sezon satırı")

    yas = {(r["oyuncu_id"], r["kulup_id"], r["sezon"]): r["yas"] for r in os_}
    deger = {(r["oyuncu_id"], r["kulup_id"], r["sezon"]): r["piyasa_degeri_eur"] for r in os_}
    ad = lambda oid: oyuncular[oid]["ad"] if oid in oyuncular else str(oid)
    uyruk1 = lambda oid: ((oyuncular.get(oid) or {}).get("uyruk") or "").split(", ")[0] or None
    kulup_sayisi = defaultdict(lambda: Counter())
    for r in lk:
        kulup_sayisi[r["lig_kod"]][r["sezon"]] += 1

    # Şampiyonlar: biten her lig sezonunda en yüksek puan ortalamalı kulüp.
    # Puan eşitliğinde averaj verisi yok; kulüp oyuncularının attığı lig golü toplamına bakılır
    # (2020/21 Süper Lig, 2011/12 Premier League gibi sezonları doğru verir; ikili averaj kullanan liglerde nadiren yanılabilir).
    kulupGol = Counter()
    for r in ot:
        kulupGol[(r["kulup_id"], r["sezon"], r["turnuva_kod"])] += r["gol"]
    ppg = defaultdict(list)
    for r in kt:
        if r["mac_basi_puan"] is not None and r["sezon"] < BU_SEZON:
            k = (r["turnuva_kod"], r["sezon"])
            ppg[k].append((float(r["mac_basi_puan"]), kulupGol[(r["kulup_id"], r["sezon"], r["turnuva_kod"])], r["kulup_id"]))
    sampiyon = {}
    for k, v in ppg.items():
        v.sort(reverse=True)
        sampiyon[k] = v[0][2]

    def oyuncu_ozet(oid, **ek):
        o = oyuncular.get(oid) or {}
        return {"id": oid, "ad": ad(oid), "uyruk": o.get("uyruk"), **ek}

    K = {}  # sonuç

    # 1) Tüm zamanların lig golcüleri (8 lig toplam)
    gol = Counter(); mac = Counter(); kulupset = defaultdict(set); ligset = defaultdict(set)
    for r in ot:
        gol[r["oyuncu_id"]] += r["gol"]; mac[r["oyuncu_id"]] += r["mac"]
        if r["mac"]:
            kulupset[r["oyuncu_id"]].add(r["kulup_id"]); ligset[r["oyuncu_id"]].add(r["turnuva_kod"])
    K["golcuOlar"] = [oyuncu_ozet(o, gol=g, mac=mac[o], kulup=len(kulupset[o]), lig=sorted(ligset[o])) for o, g in gol.most_common(25)]

    # 2) Her ligin tüm zamanlar golcüsü ve tek sezon rekoru
    ligRekor = []
    for lig in ligler:
        g = Counter(); tek = []
        for r in ot:
            if r["turnuva_kod"] == lig:
                g[r["oyuncu_id"]] += r["gol"]
                tek.append((r["gol"], r["sezon"], r["oyuncu_id"], r["kulup_id"]))
        tek.sort(reverse=True)
        ligRekor.append({
            "lig": lig,
            "tumZaman": [oyuncu_ozet(o, gol=v) for o, v in g.most_common(5)],
            "tekSezon": [oyuncu_ozet(t[2], gol=t[0], sezon=t[1], kulup=kulupler.get(t[3])) for t in tek[:5]],
        })
    K["ligRekor"] = ligRekor

    # 3) Dakika başına golcüler (en az 40 lig golü)
    dk = Counter()
    for r in ot:
        dk[r["oyuncu_id"]] += r["dakika"]
    adaylar = [(dk[o] / g, o) for o, g in gol.items() if g >= 40 and dk[o] > 0]
    adaylar.sort()
    K["dakikaGol"] = [oyuncu_ozet(o, dakikaBasina=round(v), gol=gol[o]) for v, o in adaylar[:15]]

    # 4) Süper yedekler: en çok oyuna sonradan girme + gol (sezon toplamı: oyuna girdiği maç çoğunluksa)
    yedek = Counter(); yedekGol = Counter()
    for r in ot:
        if r["mac"] and r["oyuna_girdi"] / r["mac"] >= 0.6:  # o sezon ağırlıkla yedekten girmiş
            yedek[r["oyuncu_id"]] += r["oyuna_girdi"]; yedekGol[r["oyuncu_id"]] += r["gol"]
    K["superYedek"] = [oyuncu_ozet(o, gol=g, oyunaGirdi=yedek[o]) for o, g in yedekGol.most_common(15)]

    # 5) Demir adamlar: toplam lig dakikası
    K["demirAdam"] = [oyuncu_ozet(o, dakika=v, mac=mac[o]) for o, v in dk.most_common(15)]

    # 6) Kart rekortmenleri
    kart = Counter(); kirmizi = Counter(); sari = Counter()
    for r in ot:
        kirmizi[r["oyuncu_id"]] += r["kirmizi"] + r["ikinci_sari"]; sari[r["oyuncu_id"]] += r["sari"]
        kart[r["oyuncu_id"]] += r["sari"] + 3 * (r["kirmizi"] + r["ikinci_sari"])
    K["kart"] = [oyuncu_ozet(o, sari=sari[o], kirmizi=kirmizi[o], mac=mac[o]) for o, _ in kart.most_common(15)]

    # 7) Göçebeler: 8 ligde en çok farklı kulüp
    K["gocebe"] = [oyuncu_ozet(o, kulup=len(s), lig=sorted(ligset[o]), mac=mac[o]) for o, s in sorted(kulupset.items(), key=lambda x: (-len(x[1]), -mac[x[0]]))[:15]]

    # 8) Sadakat: aynı kulüpte en çok sezon (ligde oynadığı)
    sad = Counter()
    for r in ot:
        if r["mac"]:
            sad[(r["oyuncu_id"], r["kulup_id"])] += 1
    K["sadakat"] = [oyuncu_ozet(o, kulup=kulupler.get(k), sezon=v) for (o, k), v in sad.most_common(15)]

    # 9) En genç ve en yaşlı golcüler (sezon yaşı)
    genc = []; yasli = []
    for r in ot:
        y = yas.get((r["oyuncu_id"], r["kulup_id"], r["sezon"]))
        if y and r["gol"] >= 1:
            t = (y, r["gol"], r["sezon"], r["oyuncu_id"], r["kulup_id"], r["turnuva_kod"])
            if y <= 18: genc.append(t)
            if y >= 37: yasli.append(t)
    genc.sort(key=lambda t: (t[0], -t[1])); yasli.sort(key=lambda t: (-t[0], -t[1]))
    sat = lambda t: oyuncu_ozet(t[3], yas=t[0], gol=t[1], sezon=t[2], kulup=kulupler.get(t[4]), lig=t[5])
    K["gencGolcu"] = [sat(t) for t in sorted([t for t in genc if t[1] >= 5], key=lambda t: (t[0], -t[1]))[:12]]
    K["yasliGolcu"] = [sat(t) for t in sorted([t for t in yasli if t[1] >= 5], key=lambda t: (-t[0], -t[1]))[:12]]

    # 10) Şampiyonluk sayıları (kulüp) ve en çok şampiyon olan oyuncular (sezonun en az 1/3'ünde oynamış)
    kulupSamp = defaultdict(Counter)
    for (lig, s), k in sampiyon.items():
        kulupSamp[lig][k] += 1
    K["kulupSampiyon"] = {lig: [{"kulup": kulupler.get(k), "sayi": n, "sezonlar": sorted(s for (l, s), kk in sampiyon.items() if l == lig and kk == k)} for k, n in c.most_common(6)] for lig, c in kulupSamp.items()}
    oyuncuSamp = defaultdict(list)
    for r in ot:
        k = (r["turnuva_kod"], r["sezon"])
        n = kulup_sayisi[r["turnuva_kod"]][r["sezon"]]
        if sampiyon.get(k) == r["kulup_id"] and n and r["mac"] >= (2 * (n - 1)) / 3:
            oyuncuSamp[r["oyuncu_id"]].append({"lig": r["turnuva_kod"], "sezon": r["sezon"], "kulup": kulupler.get(r["kulup_id"])})
    K["oyuncuSampiyon"] = [oyuncu_ozet(o, sayi=len(v), unvanlar=sorted(v, key=lambda x: x["sezon"])) for o, v in sorted(oyuncuSamp.items(), key=lambda x: -len(x[1]))[:15]]

    # 11) Ligler yıllara göre: maç başı gol, ortalama yaş (oynayanlar, dakika ağırlıklı), yabancı oranı (dakika)
    trend = defaultdict(dict)
    gruplar = defaultdict(list)
    for r in ot:
        gruplar[(r["turnuva_kod"], r["sezon"])].append(r)
    for (lig, s), rows in gruplar.items():
        if s >= BU_SEZON:
            continue
        n = kulup_sayisi[lig][s]
        toplamGol = sum(r["gol"] for r in rows)
        dkT = sum(r["dakika"] for r in rows) or 1
        yasT = sum((yas.get((r["oyuncu_id"], r["kulup_id"], s)) or 0) * r["dakika"] for r in rows if yas.get((r["oyuncu_id"], r["kulup_id"], s)))
        yasDk = sum(r["dakika"] for r in rows if yas.get((r["oyuncu_id"], r["kulup_id"], s))) or 1
        ulke = LIG_ULKE[lig]
        yerli = sum(r["dakika"] for r in rows if ulke in ((oyuncular.get(r["oyuncu_id"]) or {}).get("uyruk") or "").split(", "))
        trend[lig][s] = {
            "golMac": round(toplamGol / (n * (n - 1)), 2) if n > 1 else None,
            "yas": round(yasT / yasDk, 1),
            "yabanci": round(100 * (1 - yerli / dkT), 1),
        }
    K["trend"] = trend

    # 12) Ülke fabrikaları: her ligde en çok gol atan uyruklar (yerli hariç), tüm zamanlar
    fab = {}
    for lig in ligler:
        c = Counter()
        for r in ot:
            if r["turnuva_kod"] == lig:
                u = uyruk1(r["oyuncu_id"])
                if u and u != LIG_ULKE[lig]:
                    c[u] += r["gol"]
        fab[lig] = [{"ulke": u, "gol": g} for u, g in c.most_common(8)]
    K["fabrika"] = fab

    # 13) Türkler Avrupa'da: Türk uyruklu oyuncuların Süper Lig dışındaki 7 ligdeki sezonları
    turk = defaultdict(lambda: {"oyuncu": set(), "gol": 0, "dakika": 0})
    turkOyuncu = Counter(); turkMac = Counter(); turkLig = defaultdict(set)
    for r in ot:
        if r["turnuva_kod"] != "TR1" and r["mac"] and "Türkiye" in ((oyuncular.get(r["oyuncu_id"]) or {}).get("uyruk") or ""):
            t = turk[r["sezon"]]; t["oyuncu"].add(r["oyuncu_id"]); t["gol"] += r["gol"]; t["dakika"] += r["dakika"]
            turkOyuncu[r["oyuncu_id"]] += r["gol"]; turkMac[r["oyuncu_id"]] += r["mac"]; turkLig[r["oyuncu_id"]].add(r["turnuva_kod"])
    K["turklerAvrupada"] = {
        "sezonlar": {s: {"oyuncu": len(v["oyuncu"]), "gol": v["gol"]} for s, v in sorted(turk.items())},
        "golcular": [oyuncu_ozet(o, gol=g, mac=turkMac[o], lig=sorted(turkLig[o])) for o, g in sorted(turkMac.items(), key=lambda x: (-turkOyuncu[x[0]], -x[1]))[:12] for g in [turkOyuncu[o]]],
    }

    # 14) Piyasa değeri (yüklenebildiği kadar): en değerli oyuncular (zirve değeri) ve en değerli kadrolar
    zirve = {}
    for (o, k, s), v in deger.items():
        if v and (o not in zirve or v > zirve[o][0]):
            zirve[o] = (v, s, k)
    K["enDegerli"] = [oyuncu_ozet(o, deger=v[0], sezon=v[1], kulup=kulupler.get(v[2])) for o, v in sorted(zirve.items(), key=lambda x: -x[1][0])[:15]]
    kadro = Counter()
    for (o, k, s), v in deger.items():
        if v:
            kadro[(k, s)] += v
    K["enDegerliKadro"] = [{"kulup": kulupler.get(k), "sezon": s, "deger": v} for (k, s), v in kadro.most_common(12)]
    K["degerKapsami"] = sorted({s for (_, _, s), v in deger.items() if v})

    # 15) Boy: en uzun ve en kısa golcüler (en az 30 lig golü)
    boylu = [(oyuncular[o]["boy_cm"], o) for o, g in gol.items() if g >= 30 and o in oyuncular and oyuncular[o].get("boy_cm")]
    K["uzunGolcu"] = [oyuncu_ozet(o, boy=b, gol=gol[o]) for b, o in sorted(boylu, reverse=True)[:8]]
    K["kisaGolcu"] = [oyuncu_ozet(o, boy=b, gol=gol[o]) for b, o in sorted(boylu)[:8]]

    K["ligler"] = {k: {"ad": v["ad"], "ulke": v["ulke"]} for k, v in ligler.items()}
    K["uretildi"] = BUGUN.isoformat()
    K["buSezon"] = BU_SEZON
    (KOK / "veri").mkdir(exist_ok=True)
    yol = KOK / "veri" / "kesfet.json"
    yol.write_text(json.dumps(K, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Yazıldı: {yol} ({yol.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()

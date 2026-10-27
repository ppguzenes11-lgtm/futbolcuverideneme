"""
Futbol veritabanını Cracko Supabase'indeki tm_ önekli tablolara kopyalar (ekler / günceller, silmez).
Önce Cracko'da supabase/cracko_tm.sql çalıştırılmış olmalı (geçici yazma izni açık).

Kullanım: python scripts/cracko_aktar.py [--cracko-key <publishable anahtar>]
"""
import argparse
import json
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

KOK = Path(__file__).resolve().parent.parent
cfg = (KOK / "js" / "config.js").read_text(encoding="utf-8")
KAYNAK = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", cfg).group(1) + "/rest/v1"
KAYNAK_KEY = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", cfg).group(1)
HEDEF = "https://kucmjwkbukmfwdbjrlyl.supabase.co/rest/v1"

# (kaynak tablo, hedef tablo, sütunlar, birincil anahtar) — yabancı anahtar sırasına göre
TABLOLAR = [
    ("ligler", "tm_ligler", "kod,ad,ulke", "kod"),
    ("kulupler", "tm_kulupler", "id,ad,slug", "id"),
    ("lig_kulupleri", "tm_lig_kulupleri", "lig_kod,sezon,kulup_id", "lig_kod,sezon,kulup_id"),
    ("oyuncular", "tm_oyuncular", "id,ad,uyruk,mevki,dogum_tarihi,boy_cm,ayak", "id"),
    ("oyuncu_sezonlari", "tm_oyuncu_sezonlari",
     "oyuncu_id,kulup_id,sezon,forma_no,yas,mevki,kadroda,mac,gol,asist,sari,ikinci_sari,kirmizi,oyuna_girdi,oyundan_cikti,mac_basi_puan,dakika,piyasa_degeri_eur,katilma_tarihi,geldigi_kulup",
     "oyuncu_id,kulup_id,sezon"),
    ("kulup_turnuvalari", "tm_kulup_turnuvalari", "kulup_id,sezon,turnuva_kod,mac_basi_puan", "kulup_id,sezon,turnuva_kod"),
    ("oyuncu_turnuvalari", "tm_oyuncu_turnuvalari",
     "oyuncu_id,kulup_id,sezon,turnuva_kod,kadroda,mac,gol,asist,sari,ikinci_sari,kirmizi,oyuna_girdi,oyundan_cikti,mac_basi_puan,dakika",
     "oyuncu_id,kulup_id,sezon,turnuva_kod"),
]


def istek(url, key, veri=None, ek=None, deneme=4):
    for d in range(deneme):
        try:
            req = urllib.request.Request(url, data=veri, method="POST" if veri else "GET",
                                         headers={"apikey": key, "Content-Type": "application/json", **(ek or {})})
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            govde = e.read().decode()[:400]
            if e.code < 500 or d == deneme - 1:
                raise RuntimeError(f"{url.split('?')[0]} {e.code}: {govde}")
        except Exception:
            if d == deneme - 1:
                raise
        time.sleep(2 * (d + 1))


def oku(tablo, sutunlar, pk):
    out = []
    def sayfa(ofs):
        return json.loads(istek(f"{KAYNAK}/{tablo}?select={sutunlar}&order={pk}&limit=1000&offset={ofs}", KAYNAK_KEY))
    ofs = 0
    with ThreadPoolExecutor(8) as ex:
        while True:
            parca = list(ex.map(sayfa, range(ofs, ofs + 8000, 1000)))
            for p in parca:
                out.extend(p)
            if len(parca[-1]) < 1000:
                return out
            ofs += 8000


def say(url_tablo, key):
    req = urllib.request.Request(f"{url_tablo}?select=*", method="HEAD", headers={"apikey": key, "Prefer": "count=exact", "Range": "0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return int(r.headers["Content-Range"].split("/")[1])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cracko-key", required=True)
    a = ap.parse_args()
    for kaynak, hedef, sutunlar, pk in TABLOLAR:
        t0 = time.time()
        satirlar = oku(kaynak, sutunlar, pk)
        parcalar = [satirlar[i:i + 1000] for i in range(0, len(satirlar), 1000)]
        def yaz(p):
            istek(f"{HEDEF}/{hedef}?on_conflict={pk}", a.cracko_key, json.dumps(p).encode(),
                  {"Prefer": "resolution=merge-duplicates,return=minimal"})
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(yaz, parcalar))
        print(f"{hedef}: {len(satirlar)} satır kopyalandı, hedefte {say(f'{HEDEF}/{hedef}', a.cracko_key)} ({time.time() - t0:.0f} sn)")


if __name__ == "__main__":
    main()

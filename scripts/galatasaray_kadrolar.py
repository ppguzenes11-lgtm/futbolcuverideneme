"""
Transfermarkt'tan Galatasaray kadrolarını (2000/01 sezonundan bugüne) çeker.

Çıktı: data/galatasaray_kadrolar.csv ve .json
--supabase verilirse satırlar Supabase'deki galatasaray_kadrolar tablosuna da yazılır
(önce supabase/galatasaray_kadrolar.sql çalıştırılmalı).

Kullanım:
  pip install -r requirements.txt
  python scripts/galatasaray_kadrolar.py                 # tüm sezonlar
  python scripts/galatasaray_kadrolar.py --bas 2020 --bit 2021
  python scripts/galatasaray_kadrolar.py --supabase
"""
import argparse
import csv
import json
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

import requests
from bs4 import BeautifulSoup

KULUP_ID = 141  # Galatasaray
URL = "https://www.transfermarkt.com/galatasaray/kader/verein/{kulup}/saison_id/{sezon}/plus/1"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}
BEKLEME = 3  # sayfalar arası saniye — siteyi yormamak için

KOK = Path(__file__).resolve().parent.parent


def temiz(s):
    return re.sub(r"\s+", " ", s or "").strip()


def deger_eur(metin):
    """'€1.50m' -> 1500000, '€500k' -> 500000, '-' -> None"""
    m = re.search(r"([\d.,]+)\s*(bn|m|k|Th\.)?", metin or "")
    if not m or "€" not in (metin or ""):
        return None
    sayi = float(m.group(1).replace(",", ""))
    carpan = {"bn": 1e9, "m": 1e6, "k": 1e3, "Th.": 1e3}.get(m.group(2), 1)
    return int(round(sayi * carpan))


def dogum(metin):
    """'Jan 5, 1985 (39)' veya '05/01/1985 (39)' -> ('1985-01-05', 39)"""
    yas = re.search(r"\((\d+)\)", metin or "")
    yas = int(yas.group(1)) if yas else None
    tarih = re.sub(r"\(.*?\)", "", metin or "").strip()
    for fmt in ("%b %d, %Y", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(tarih, fmt).date().isoformat(), yas
        except ValueError:
            pass
    return (tarih or None), yas


def sezon_cek(oturum, sezon):
    r = oturum.get(URL.format(kulup=KULUP_ID, sezon=sezon), headers=HEADERS, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    tablo = soup.select_one("table.items")
    if tablo is None:
        raise RuntimeError(f"{sezon}: kadro tablosu bulunamadı (sayfa yapısı değişmiş ya da erişim engellenmiş olabilir)")

    basliklar = [temiz(th.get_text(" ")) for th in tablo.select("thead th")]
    satirlar = []
    for tr in tablo.select("tbody > tr"):
        tdler = tr.find_all("td", recursive=False)
        if not tdler:
            continue
        hucre = {basliklar[i] if i < len(basliklar) else f"sutun{i}": td for i, td in enumerate(tdler)}

        link = tr.select_one("td.hauptlink a[href*='/profil/spieler/']")
        if link is None:
            continue
        oyuncu_id = int(re.search(r"/spieler/(\d+)", link["href"]).group(1))
        ic = tr.select("table.inline-table tr")
        mevki = temiz(ic[1].get_text(" ")) if len(ic) > 1 else None
        no = tr.select_one("div.rn_nummer")
        no = temiz(no.get_text()) if no else None

        def bul(*anahtarlar):
            for b, td in hucre.items():
                if any(a.lower() in b.lower() for a in anahtarlar):
                    return td
            return None

        dt = bul("Date of birth", "birth")
        dogum_tarihi, yas = dogum(temiz(dt.get_text(" ")) if dt else "")
        uyruk_td = bul("Nat")
        uyruklar = [img.get("title") for img in (uyruk_td.select("img") if uyruk_td else []) if img.get("title")]
        boy = bul("Height")
        ayak = bul("Foot")
        katilma = bul("Joined")
        gelis = bul("Signed from")
        gelis_kulup = gelis.select_one("a[title]") if gelis else None
        sozlesme = bul("Contract")
        deger_td = tr.select_one("td.rechts.hauptlink")
        deger_metin = temiz(deger_td.get_text(" ")) if deger_td else None

        satirlar.append({
            "sezon": sezon,
            "sezon_ad": f"{sezon}/{str(sezon + 1)[-2:]}",
            "oyuncu_id": oyuncu_id,
            "ad": temiz(link.get_text()),
            "forma_no": no if no and no != "-" else None,
            "mevki": mevki,
            "dogum_tarihi": dogum_tarihi,
            "yas": yas,
            "uyruk": ", ".join(uyruklar) or None,
            "boy": temiz(boy.get_text(" ")) if boy else None,
            "ayak": temiz(ayak.get_text(" ")) if ayak else None,
            "katilma_tarihi": temiz(katilma.get_text(" ")) if katilma else None,
            "geldigi_kulup": gelis_kulup["title"] if gelis_kulup else None,
            "sozlesme_bitis": temiz(sozlesme.get_text(" ")) if sozlesme else None,
            "piyasa_degeri": deger_metin if deger_metin and deger_metin != "-" else None,
            "piyasa_degeri_eur": deger_eur(deger_metin),
            "profil_url": "https://www.transfermarkt.com" + link["href"],
        })
    return satirlar


def supabase_yaz(satirlar):
    url, key = supabase_ayar()
    for i in range(0, len(satirlar), 500):
        r = requests.post(
            f"{url}/rest/v1/galatasaray_kadrolar?on_conflict=sezon,oyuncu_id",
            headers={"apikey": key, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
            data=json.dumps(satirlar[i:i + 500]),
            timeout=60,
        )
        if r.status_code >= 300:
            raise RuntimeError(f"Supabase hatası {r.status_code}: {r.text}")
    print(f"Supabase: {len(satirlar)} satır yazıldı.")


def supabase_ayar():
    """js/config.js içindeki URL ve anahtarı okur (tek yerde dursun diye)"""
    metin = (KOK / "js" / "config.js").read_text(encoding="utf-8")
    url = re.search(r"SUPABASE_URL\s*=\s*'([^']+)'", metin).group(1)
    key = re.search(r"SUPABASE_KEY\s*=\s*'([^']+)'", metin).group(1)
    return url, key


def main():
    bu_sezon = date.today().year if date.today().month >= 7 else date.today().year - 1
    ap = argparse.ArgumentParser()
    ap.add_argument("--bas", type=int, default=2000)
    ap.add_argument("--bit", type=int, default=bu_sezon)
    ap.add_argument("--supabase", action="store_true", help="Sonuçları Supabase'e de yaz")
    a = ap.parse_args()

    oturum = requests.Session()
    hepsi = []
    for sezon in range(a.bas, a.bit + 1):
        satirlar = sezon_cek(oturum, sezon)
        print(f"{sezon}/{str(sezon + 1)[-2:]}: {len(satirlar)} oyuncu")
        hepsi.extend(satirlar)
        time.sleep(BEKLEME)

    cikti = KOK / "data"
    cikti.mkdir(exist_ok=True)
    (cikti / "galatasaray_kadrolar.json").write_text(json.dumps(hepsi, ensure_ascii=False, indent=1), encoding="utf-8")
    with open(cikti / "galatasaray_kadrolar.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=list(hepsi[0].keys()))
        w.writeheader()
        w.writerows(hepsi)
    print(f"Toplam {len(hepsi)} satır → data/galatasaray_kadrolar.csv / .json")

    if a.supabase:
        supabase_yaz(hepsi)


if __name__ == "__main__":
    main()

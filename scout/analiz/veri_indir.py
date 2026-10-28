"""Scout analizi için Supabase'den ham veriyi indirir (yalnızca okuma).
Kullanım: python veri_indir.py <klasör> [lig_id=17]"""
import json, sys, urllib.request, urllib.parse, os

URL = 'https://oixqyntsoatmerjxltki.supabase.co/rest/v1/'
KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA'


def hepsi(tablo, select, filtre=''):
    out = []
    for ofs in range(0, 10**7, 1000):
        q = f'{URL}{tablo}?select={urllib.parse.quote(select, safe=",:()*->")}{filtre}&order=id.asc&limit=1000&offset={ofs}' if tablo != 'ss_oyuncu_mac' else \
            f'{URL}{tablo}?select={select}{filtre}&order=mac_id.asc,oyuncu_id.asc&limit=1000&offset={ofs}'
        if tablo == 'ss_anahtarlar':
            q = q.replace('order=id.asc', 'order=sira.asc')
        r = urllib.request.Request(q, headers={'apikey': KEY})
        sayfa = json.load(urllib.request.urlopen(r, timeout=60))
        out += sayfa
        if len(sayfa) < 1000:
            return out


if __name__ == '__main__':
    klasor = sys.argv[1]
    lig = int(sys.argv[2]) if len(sys.argv) > 2 else 17
    os.makedirs(klasor, exist_ok=True)
    maclar = hepsi('ss_maclar', 'id,sezon,hafta,tarih,ev_id,dep_id,ev_gol,dep_gol,ev_iy,dep_iy,hakem,ev_hoca,dep_hoca,ev_dizilis,dep_dizilis,istatistik,olaylar,eksikler,oranlar',
                   f'&lig_id=eq.{lig}&sezon=neq.99/00')
    ids = {m['id'] for m in maclar}
    oyuncu_mac = [r for r in hepsi('ss_oyuncu_mac', 'mac_id,oyuncu_id,takim_id,ev,yedek,mevki,dakika,puan,ist') if r['mac_id'] in ids]
    for ad, veri in [('maclar', maclar), ('oyuncu_mac', oyuncu_mac), ('oyuncular', hepsi('ss_oyuncular', 'id,ad,mevki,dogum,ulke,boy,ayak')),
                     ('takimlar', hepsi('ss_takimlar', 'id,ad')), ('anahtarlar', hepsi('ss_anahtarlar', 'sira,anahtar'))]:
        json.dump(veri, open(os.path.join(klasor, ad + '.json'), 'w'))
        print(ad, len(veri))

// Futbolcu Puanı — bir lig sezonundaki oyuncuları 0–100 arası puanlar.
// Veri: oyuncu_turnuvalari (sadece lig maçları) + kulup_turnuvalari (kulübün lig puan ortalaması).
// Bileşenler aynı sezon, aynı mevki ailesindeki oyuncular arasında yüzdelik dilime çevrilir;
// böylece kaleci kalecilerle, forvet forvetlerle yarışır.

// Mevki grupları: [grup, aile, taraf]
const GRUP = {
  Goalkeeper: ['KL', 'kaleci'],
  'Centre-Back': ['STP', 'defans'], Sweeper: ['STP', 'defans'], Defender: ['STP', 'defans'],
  'Right-Back': ['BEK', 'defans', 'sag'], 'Left-Back': ['BEK', 'defans', 'sol'],
  'Defensive Midfield': ['DOS', 'ortasaha'],
  'Central Midfield': ['OS', 'ortasaha'], Midfield: ['OS', 'ortasaha'],
  'Right Midfield': ['OS', 'ortasaha', 'sag'], 'Left Midfield': ['OS', 'ortasaha', 'sol'],
  'Attacking Midfield': ['OOS', 'ortasaha'],
  'Right Winger': ['KNT', 'hucum', 'sag'], 'Left Winger': ['KNT', 'hucum', 'sol'],
  'Centre-Forward': ['FV', 'hucum'], 'Second Striker': ['FV', 'hucum'], Attack: ['FV', 'hucum'],
};
export const grupBul = (mevki) => GRUP[mevki] || ['OS', 'ortasaha'];

// Mevkiye göre bileşen ağırlıkları (toplam 1) ve gol/asist değeri
// S: süre payı, E: takıma etkisi, T: takım başarısı, U: üretkenlik, D: disiplin
const AGIRLIK = {
  KL: { S: 0.30, E: 0.35, T: 0.30, U: 0.00, D: 0.05 },
  STP: { S: 0.30, E: 0.30, T: 0.25, U: 0.10, D: 0.05 },
  BEK: { S: 0.25, E: 0.25, T: 0.20, U: 0.25, D: 0.05 },
  DOS: { S: 0.25, E: 0.30, T: 0.20, U: 0.20, D: 0.05 },
  OS: { S: 0.20, E: 0.25, T: 0.15, U: 0.35, D: 0.05 },
  OOS: { S: 0.15, E: 0.15, T: 0.10, U: 0.55, D: 0.05 },
  KNT: { S: 0.15, E: 0.15, T: 0.10, U: 0.55, D: 0.05 },
  FV: { S: 0.15, E: 0.10, T: 0.10, U: 0.60, D: 0.05 },
};
const GOL_ASIST = {
  KL: [1, 1], STP: [1, 0.8], BEK: [0.8, 1], DOS: [0.8, 1], OS: [0.9, 1], OOS: [0.9, 1], KNT: [1, 0.85], FV: [1, 0.7],
};
const SAMPIYON_BONUS = 8; // tam süre oynayan şampiyon oyuncuya eklenen puan

export const BILESEN_AD = { S: 'Süre payı', E: 'Takıma etkisi', T: 'Takım başarısı', U: 'Üretkenlik', D: 'Disiplin' };

// Değerin, karşılaştırma kümesindeki yüzdelik dilimi (0–100)
function yuzdelik(deger, kume) {
  if (!kume.length) return 50;
  let alt = 0; let esit = 0;
  for (const x of kume) { if (x < deger) alt++; else if (x === deger) esit++; }
  return ((alt + esit / 2) / kume.length) * 100;
}

/**
 * oyuncular: [{ oyuncu_id, kulup_id, mevki, ad, kulup_ad, kadroda, mac, gol, asist, sari, ikinci_sari, kirmizi, mac_basi_puan, dakika }]
 * kulupler: [{ kulup_id, mac_basi_puan }]
 * bitti: sezon tamamlandıysa true (şampiyonluk bonusu verilir)
 */
export function puanla(oyuncular, kulupler, { bitti }) {
  const kulupPpg = new Map(kulupler.map((k) => [k.kulup_id, Number(k.mac_basi_puan)]));
  // Kulübün oynadığı maç sayısı: kadrosundaki en yüksek "kadroda" değeri
  const kulupMac = new Map();
  for (const o of oyuncular) kulupMac.set(o.kulup_id, Math.max(kulupMac.get(o.kulup_id) || 0, o.kadroda || 0, o.mac || 0));

  // Takım başarısı: kulübün lig içindeki puan ortalaması sırası (0–100)
  const ppgListe = [...kulupPpg.values()];
  const takimBasari = new Map([...kulupPpg].map(([id, p]) => [id, yuzdelik(p, ppgListe)]));
  const enIyi = Math.max(...ppgListe);
  const sampiyonlar = new Set(bitti ? [...kulupPpg].filter(([, p]) => p === enIyi).map(([id]) => id) : []);

  // Ham değerler
  const satirlar = oyuncular.map((o) => {
    const [grup, aile, taraf] = grupBul(o.mevki);
    const mc = kulupMac.get(o.kulup_id) || 0;
    const sure = mc ? Math.min(1, o.dakika / (mc * 90)) : 0;

    // Etki: oyuncu sahadayken takımın maç başı puanı – yokken maç başı puanı.
    // Az maçta şans eseri büyük çıkmasın diye örneklem büyüklüğüne göre küçültülür.
    // Oyuncu ya da takım onsuz 3 maçtan az oynadıysa ölçülemez: null → bileşen nötr (50) sayılır.
    let etki = null; let on = null; let off = null;
    const kp = kulupPpg.get(o.kulup_id);
    const yok = mc - o.mac;
    if (o.mac >= 3 && yok >= 3 && o.mac_basi_puan != null && kp != null) { // tek tük maçın şansı etki sayılmasın
      on = Number(o.mac_basi_puan);
      off = Math.max(0, (kp * mc - on * o.mac) / yok);
      const n = (o.mac * yok) / mc;
      etki = (on - off) * (n / (n + 8));
    }

    const [wg, wa] = GOL_ASIST[grup];
    const doksan = o.dakika / 90;
    const uretkenlik = (o.gol * wg + o.asist * wa) / (doksan + 3); // +3: az dakikada şişmesin
    const ceza = (o.sari + 3 * o.ikinci_sari + 4 * o.kirmizi) / (doksan + 3);
    return { ...o, grup, aile, taraf, sure, etki, on, off, uretkenlik, ceza, kulupMac: mc, sampiyon: sampiyonlar.has(o.kulup_id) };
  });

  // Karşılaştırma kümesi: aynı mevki ailesinde, takım dakikalarının en az %25'ini oynayanlar
  const kume = {};
  for (const s of satirlar) {
    if (s.sure < 0.25) continue;
    (kume[s.aile] ||= { etki: [], uretkenlik: [], ceza: [] });
    if (s.etki != null) kume[s.aile].etki.push(s.etki);
    kume[s.aile].uretkenlik.push(s.uretkenlik); kume[s.aile].ceza.push(s.ceza);
  }

  for (const s of satirlar) {
    const k = kume[s.aile] || { etki: [], uretkenlik: [], ceza: [] };
    const tGuven = Math.min(1, s.sure / 0.6); // kenarda kalan oyuncu takımın başarısından tam pay almaz
    s.bilesen = {
      S: s.sure * 100,
      E: s.etki == null ? 50 : yuzdelik(s.etki, k.etki),
      T: (takimBasari.get(s.kulup_id) ?? 50) * tGuven,
      U: yuzdelik(s.uretkenlik, k.uretkenlik),
      D: 100 - yuzdelik(s.ceza, k.ceza),
    };
    s.agirlik = AGIRLIK[s.grup];
    s.katki = Object.fromEntries(Object.keys(s.agirlik).map((b) => [b, s.agirlik[b] * s.bilesen[b]]));
    s.sampiyonBonus = s.sampiyon ? SAMPIYON_BONUS * Math.min(1, s.sure / 0.7) : 0;
    s.puan = Math.min(100, Object.values(s.katki).reduce((a, b) => a + b, 0) + s.sampiyonBonus);
  }
  return satirlar.sort((a, b) => b.puan - a.puan);
}

// ---------- En iyi 11 ----------
// Her pozisyon: [kod, ad, uygun gruplar (öncelik sırasıyla), taraf]
const P = {
  KL: ['KL', 'Kaleci', ['KL']],
  SGB: ['SGB', 'Sağ bek', ['BEK'], 'sag'], SLB: ['SLB', 'Sol bek', ['BEK'], 'sol'],
  STP: ['STP', 'Stoper', ['STP']],
  DOS: ['DOS', 'Ön libero', ['DOS', 'OS']],
  OS: ['OS', 'Orta saha', ['OS', 'DOS', 'OOS']],
  OOS: ['OOS', 'On numara', ['OOS', 'OS']],
  SGK: ['SGK', 'Sağ kanat', ['KNT', 'OS'], 'sag'], SLK: ['SLK', 'Sol kanat', ['KNT', 'OS'], 'sol'],
  FV: ['FV', 'Forvet', ['FV']],
};
// Satırlar: forvetten kaleciye
export const DIZILISLER = {
  '4-3-3': [[P.SLK, P.FV, P.SGK], [P.OS, P.DOS, P.OS], [P.SLB, P.STP, P.STP, P.SGB], [P.KL]],
  '4-2-3-1': [[P.FV], [P.SLK, P.OOS, P.SGK], [P.DOS, P.OS], [P.SLB, P.STP, P.STP, P.SGB], [P.KL]],
  '4-4-2': [[P.FV, P.FV], [P.SLK, P.OS, P.OS, P.SGK], [P.SLB, P.STP, P.STP, P.SGB], [P.KL]],
  '3-5-2': [[P.FV, P.FV], [P.SLB, P.OS, P.DOS, P.OS, P.SGB], [P.STP, P.STP, P.STP], [P.KL]],
};

// Pozisyonun asıl mevkisi dışından (yakın mevkiden) seçilen oyuncuya uygulanan puan farkı
const YAKIN_MEVKI_FARKI = 5;
const TARAF_BELIRSIZ_FARKI = 3;

/** Puanlanmış oyunculardan diziliş için en iyi 11. Yakın mevkiden gelen oyuncu ancak belirgin şekilde daha iyiyse seçilir. */
export function enIyi11(puanlilar, dizilis) {
  const secilen = new Set();
  const satirlar = DIZILISLER[dizilis];
  const yerler = satirlar.flat().map((p, i) => ({ p, i }));
  // Önce seçeneği az olan pozisyonlar (kaleci, bekler), sonra diğerleri
  yerler.sort((a, b) => a.p[2].length - b.p[2].length || (b.p[3] ? 1 : 0) - (a.p[3] ? 1 : 0));
  const sonuc = [];
  for (const { p, i } of yerler) {
    const [, , gruplar, taraf] = p;
    let aday = null; let enIyiDeger = -Infinity;
    for (const o of puanlilar) {
      if (secilen.has(o.oyuncu_id) || o.sure < 0.25 || !gruplar.includes(o.grup)) continue;
      if (taraf && o.taraf && o.taraf !== taraf) continue; // sağ beke sol bek konmaz
      const deger = o.puan - (o.grup === gruplar[0] ? 0 : YAKIN_MEVKI_FARKI) - (taraf && !o.taraf ? TARAF_BELIRSIZ_FARKI : 0);
      if (deger > enIyiDeger) { enIyiDeger = deger; aday = o; }
    }
    if (aday) secilen.add(aday.oyuncu_id);
    sonuc[i] = { pozisyon: p, oyuncu: aday || null };
  }
  // Dizilişin satır yapısına geri böl
  let k = 0;
  return satirlar.map((s) => s.map(() => sonuc[k++]));
}

// ---------- Dönem (sezon aralığı) puanı ----------
export const DONEM = { ZIRVE_SEZON: 3, ZIRVE_AGIRLIK: 0.75, ISTIKRAR_SEZON: 5, EKSIK_DOLGU: 50, IYI_SEZON: 70 };

/**
 * Sezon puanlarını tek dönem puanında birleştirir.
 * sezonlar: [{ sezon, puanlilar }] — puanlilar, puanla() çıktısı
 * Dönem puanı = %75 zirve (en iyi 3 sezonun ortalaması; eksik sezonlar 50) + %25 istikrar (70+ puanlı iyi sezon sayısı, en fazla 5).
 * İstikrar sadece iyi sezonları sayar: uzun ama vasat kariyer ödüllendirilmesin.
 */
export function donemPuanla(sezonlar) {
  const R = sezonlar.length;
  const K = Math.min(DONEM.ZIRVE_SEZON, R);
  const IST = Math.min(DONEM.ISTIKRAR_SEZON, R);
  const oyuncu = new Map();
  for (const { sezon, puanlilar } of sezonlar) {
    // Aynı sezonda iki kulüpte oynadıysa daha yüksek puanlı satır sayılır
    const enIyiSatir = new Map();
    for (const s of puanlilar) {
      if (s.sure < 0.25) continue;
      const v = enIyiSatir.get(s.oyuncu_id);
      if (!v || s.puan > v.puan) enIyiSatir.set(s.oyuncu_id, s);
    }
    for (const s of enIyiSatir.values()) {
      if (!oyuncu.has(s.oyuncu_id)) oyuncu.set(s.oyuncu_id, []);
      oyuncu.get(s.oyuncu_id).push({ ...s, sezon });
    }
  }
  const sonuc = [];
  for (const [id, liste] of oyuncu) {
    liste.sort((a, b) => b.puan - a.puan);
    const enIyiler = liste.slice(0, K).map((s) => s.puan);
    while (enIyiler.length < K) enIyiler.push(DONEM.EKSIK_DOLGU);
    const zirve = enIyiler.reduce((a, b) => a + b, 0) / K;
    const iyiSezon = liste.filter((s) => s.puan >= DONEM.IYI_SEZON).length;
    const istikrar = Math.min(1, iyiSezon / IST) * 100;
    // Mevki ve kulüp: en çok dakika aldığı
    const dk = (f) => { const m = new Map(); for (const s of liste) m.set(f(s), (m.get(f(s)) || 0) + s.dakika); return [...m].sort((a, b) => b[1] - a[1]); };
    const anaGrup = dk((s) => s.grup)[0][0];
    const anaSatir = liste.filter((s) => s.grup === anaGrup).sort((a, b) => b.dakika - a.dakika)[0];
    const kulupler = dk((s) => s.kulup_ad).map(([ad]) => ad);
    const top = (k) => liste.reduce((a, s) => a + (s[k] || 0), 0);
    sonuc.push({
      oyuncu_id: id, ad: liste[0].ad, uyruk: liste[0].uyruk,
      grup: anaGrup, aile: anaSatir.aile, taraf: anaSatir.taraf, mevki: anaSatir.mevki,
      kulup_id: anaSatir.kulup_id, kulup_ad: kulupler[0], kulupler,
      sure: 1, // dönemde en az bir sezon düzenli oynadı (en iyi 11 seçimine uygun)
      mac: top('mac'), gol: top('gol'), asist: top('asist'), dakika: top('dakika'),
      sezonlar: liste.sort((a, b) => b.sezon - a.sezon), enIyiSezon: Math.max(...liste.map((s) => s.puan)),
      zirve, istikrar, iyiSezon, istikrarHedef: IST, puan: DONEM.ZIRVE_AGIRLIK * zirve + (1 - DONEM.ZIRVE_AGIRLIK) * istikrar,
      sampiyonluk: liste.filter((s) => s.sampiyon).length,
    });
  }
  return sonuc.sort((a, b) => b.puan - a.puan);
}

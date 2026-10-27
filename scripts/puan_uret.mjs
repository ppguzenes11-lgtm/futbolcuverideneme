// Bütün sezonların Futbolcu Puanlarını önceden hesaplar → veri/puan/<sezon>.json (+ veri/puan/ozet.json).
// Formül sitedekiyle aynıdır (js/puan.js). Veri değişince tekrar çalıştırın:
//   node scripts/puan_uret.mjs
// (Proxy arkasında: NODE_USE_ENV_PROXY=1 node scripts/puan_uret.mjs)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { puanla, dunyaKatmani } from '../js/puan.js';

const KOK = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readFileSync(join(KOK, 'js', 'config.js'), 'utf8');
const URL = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(cfg)[1] + '/rest/v1';
const KEY = /SUPABASE_KEY\s*=\s*'([^']+)'/.exec(cfg)[1];
const bugun = new Date();
const BU_SEZON = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;

const SIRA = { oyuncular: 'id', kulupler: 'id', lig_kulupleri: 'lig_kod,sezon,kulup_id', kulup_turnuvalari: 'kulup_id,sezon,turnuva_kod',
  oyuncu_turnuvalari: 'oyuncu_id,kulup_id,sezon,turnuva_kod', oyuncu_sezonlari: 'oyuncu_id,kulup_id,sezon' };
async function sayfa(tablo, sutun, ofs) {
  for (let d = 0; ; d++) {
    try {
      const r = await fetch(`${URL}/${tablo}?select=${sutun}&order=${SIRA[tablo]}&limit=1000&offset=${ofs}`, { headers: { apikey: KEY } });
      if (!r.ok) throw new Error(`${tablo} ${r.status}`);
      return await r.json();
    } catch (e) { if (d >= 3) throw e; await new Promise((ok) => setTimeout(ok, 2000)); }
  }
}
async function hepsi(tablo, sutun) {
  const out = [];
  for (let ofs = 0; ; ofs += 8000) {
    const parcalar = await Promise.all(Array.from({ length: 8 }, (_, i) => sayfa(tablo, sutun, ofs + i * 1000)));
    for (const p of parcalar) out.push(...p);
    if (parcalar[7].length < 1000) return out;
  }
}

console.log('Veri okunuyor…');
const [oyuncular, kulupler, lk, kt, ot, os] = await Promise.all([
  hepsi('oyuncular', 'id,ad,uyruk,mevki'),
  hepsi('kulupler', 'id,ad'),
  hepsi('lig_kulupleri', 'lig_kod,sezon,kulup_id'),
  hepsi('kulup_turnuvalari', 'kulup_id,sezon,turnuva_kod,mac_basi_puan'),
  hepsi('oyuncu_turnuvalari', 'oyuncu_id,kulup_id,sezon,turnuva_kod,kadroda,mac,gol,asist,sari,ikinci_sari,kirmizi,mac_basi_puan,dakika'),
  hepsi('oyuncu_sezonlari', 'oyuncu_id,kulup_id,sezon,mevki,yas,piyasa_degeri_eur'),
]);
console.log(`${oyuncular.length} oyuncu, ${ot.length} lig satırı`);
const oy = new Map(oyuncular.map((o) => [o.id, o]));
const kad = new Map(kulupler.map((k) => [k.id, k.ad]));
const osMap = new Map(os.map((r) => [`${r.oyuncu_id}:${r.kulup_id}:${r.sezon}`, r]));
const grupla = (rows, f) => rows.reduce((m, r) => { (m[f(r)] ||= []).push(r); return m; }, {});
const otS = grupla(ot, (r) => `${r.sezon}:${r.turnuva_kod}`);
const ktS = grupla(kt, (r) => `${r.sezon}:${r.turnuva_kod}`);
const ligler = [...new Set(lk.map((r) => r.lig_kod))];
const sezonlar = [...new Set(lk.map((r) => r.sezon))].sort((a, b) => b - a);

const yuvarla = (x, n = 1) => (x == null ? null : Math.round(x * 10 ** n) / 10 ** n);
mkdirSync(join(KOK, 'veri', 'puan'), { recursive: true });
const ozet = { sezonlar: [], ligGucu: {}, uretildi: bugun.toISOString().slice(0, 10) };
let yedekGuc = null;
for (const sezon of sezonlar) { // yeniden eskiye: değeri olmayan eski sezonlar en yakın sezonun lig gücünü kullanır
  const ligSonuc = [];
  for (const lig of ligler) {
    const satir = otS[`${sezon}:${lig}`]; const kul = ktS[`${sezon}:${lig}`];
    if (!satir?.length || !kul?.length) continue;
    const girdi = satir.map((r) => {
      const ek = osMap.get(`${r.oyuncu_id}:${r.kulup_id}:${sezon}`) || {};
      const o = oy.get(r.oyuncu_id) || {};
      return { ...r, ad: o.ad, uyruk: o.uyruk, kulup_ad: kad.get(r.kulup_id), mevki: ek.mevki || o.mevki, yas: ek.yas, deger: ek.piyasa_degeri_eur };
    });
    ligSonuc.push({ lig, puanlilar: puanla(girdi, kul, { bitti: sezon < BU_SEZON }) });
  }
  if (!ligSonuc.length) continue;
  const { ligGucu, karsilastirilabilir } = dunyaKatmani(ligSonuc, yedekGuc);
  if (karsilastirilabilir) yedekGuc = ligGucu;
  ozet.ligGucu[sezon] = Object.fromEntries(Object.entries(ligGucu).map(([l, g]) => [l, yuvarla(g, 3)]));
  // Kısa alanlar: sayfa hızlı yüklensin. Takım dakikalarının %10'undan azını oynayanlar dosyaya girmez.
  const satirlar = ligSonuc.flatMap(({ puanlilar }) => puanlilar.filter((s) => s.sure >= 0.1).map((s) => ({
    o: s.oyuncu_id, k: s.kulup_id, l: s.lig, ad: s.ad, u: s.uyruk, ka: s.kulup_ad, m: s.mevki, y: s.yas, dg: s.deger,
    mac: s.mac, gol: s.gol, as: s.asist, dk: s.dakika, sa: s.sari, is: s.ikinci_sari, ki: s.kirmizi,
    su: yuvarla(s.sure, 3), et: yuvarla(s.etki, 3), on: yuvarla(s.on, 2), of: yuvarla(s.off, 2),
    b: Object.fromEntries(Object.entries(s.bilesen).map(([k, v]) => [k, yuvarla(v)])),
    w: Object.fromEntries(Object.entries(s.agirlik).map(([k, v]) => [k, yuvarla(v, 3)])),
    sb: yuvarla(s.sampiyonBonus), sp: s.sampiyon ? 1 : 0, pl: yuvarla(s.puanLig), p: yuvarla(s.puan), c: yuvarla(s.carpan, 3), pd: yuvarla(s.puanDunya),
  })));
  writeFileSync(join(KOK, 'veri', 'puan', `${sezon}.json`), JSON.stringify({ sezon, ligGucu: ozet.ligGucu[sezon], satirlar }));
  ozet.sezonlar.push(sezon);
  console.log(`${sezon}: ${satirlar.length} oyuncu · lig gücü ${Object.entries(ozet.ligGucu[sezon]).map(([l, g]) => `${l} ${g}`).join(' ')}`);
}
writeFileSync(join(KOK, 'veri', 'puan', 'ozet.json'), JSON.stringify(ozet));
console.log('Tamam.');

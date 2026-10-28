// Sitedeki tahmin fonksiyonlarıyla (js/tahmin.js) her maç için maç öncesi özellikleri üretir.
// Her maç günü model yalnızca o günden önceki maçlarla kurulur. Kullanım: node ozellik_cikar.mjs <veri klasörü> <çıktı.json>
import fs from 'fs';
import path from 'path';
import { modelKur, xgFormu, yeniOzellik } from '../../js/tahmin.js';

const [klasor, cikti] = process.argv.slice(2);
const ham = JSON.parse(fs.readFileSync(path.join(klasor, 'maclar.json')));
const al = (m, k) => m.istatistik?.ALL?.[k] ?? null;
const maclar = ham.filter((m) => m.ev_gol != null).map((m) => ({
  id: m.id, sezon: m.sezon, tarih: m.tarih, ev_id: m.ev_id, dep_id: m.dep_id, ev_gol: m.ev_gol, dep_gol: m.dep_gol, hakem: m.hakem,
  xg: al(m, 'expectedGoals'), kor: al(m, 'cornerKicks'), sari: al(m, 'yellowCards'), kir: al(m, 'redCards'),
  oran: m.oranlar?.['Full time'] ?? null,
})).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));

const ilk = new Date(maclar[0].tarih).getTime();
const gunler = new Map();
for (const m of maclar) {
  const g = m.tarih.slice(0, 10);
  if (!gunler.has(g)) gunler.set(g, []);
  gunler.get(g).push(m);
}
const satirlar = [];
for (const [g, liste] of gunler) {
  const simdi = new Date(g + 'T00:00:00Z').getTime();
  if (simdi - ilk < 45 * 86400000) continue;
  const model = modelKur(maclar, simdi);
  const form = xgFormu(maclar, simdi);
  for (const m of liste) {
    const t = model.tahmin(m.ev_id, m.dep_id, { hakemId: m.hakem?.id });
    satirlar.push({ id: m.id, sezon: m.sezon, y: m.ev_gol > m.dep_gol ? 0 : m.ev_gol === m.dep_gol ? 1 : 2,
      dc: [t.p1, t.px, t.p2], x: yeniOzellik(t, form, m.ev_id, m.dep_id), oran: m.oran });
  }
}
fs.writeFileSync(cikti, JSON.stringify(satirlar));
console.log('özellik satırı', satirlar.length);

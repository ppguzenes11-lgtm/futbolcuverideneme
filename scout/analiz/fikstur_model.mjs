// Gerçek kupon modu: yaklaşan maçlar için sitedeki modelin (js/tahmin.js) gol çizgisi olasılıkları.
// Model, şimdiye kadar oynanmış tüm maçlarla kurulur (pazar_cikar.mjs ile aynı hesap).
// Kullanım: node fikstur_model.mjs <veri klasörü> <çıktı.json>   (klasörde maclar.json ve fikstur.json)
import fs from 'fs';
import path from 'path';
import { modelKur, skorMatrisi } from '../../js/tahmin.js';

const [klasor, cikti] = process.argv.slice(2);
const oku = (ad) => JSON.parse(fs.readFileSync(path.join(klasor, ad + '.json')));
const al = (m, k) => m.istatistik?.ALL?.[k] ?? null;
const maclar = oku('maclar').filter((m) => m.ev_gol != null).map((m) => ({
  id: m.id, tarih: m.tarih, ev_id: m.ev_id, dep_id: m.dep_id, ev_gol: m.ev_gol, dep_gol: m.dep_gol, hakem: m.hakem,
  xg: al(m, 'expectedGoals'), kor: al(m, 'cornerKicks'), sari: al(m, 'yellowCards'), kir: al(m, 'redCards'),
})).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
const model = modelKur(maclar, Date.now());
const topla = (M, f) => M.reduce((a, r, i) => a + r.reduce((b, p, j) => b + (f(i, j) ? p : 0), 0), 0);
const out = {};
for (const f of oku('fikstur')) {
  const t = model.tahmin(f.ev_id, f.dep_id, { hakemId: f.hakem?.id });
  const s = skorMatrisi(t.lEv, t.lDep);
  const p = {};
  for (const ad of Object.keys(f.oranlar || {})) {
    const gol = ad.match(/^Match goals ([\d.]+)$/);
    if (gol && +gol[1] <= 5.5) { const u = topla(s, (i, j) => i + j > +gol[1]); p[ad] = [u, 1 - u]; }
  }
  out[f.id] = { lev: t.lEv, ldep: t.lDep, model: p };
}
fs.writeFileSync(cikti, JSON.stringify(out));
console.log('yaklaşan maç', Object.keys(out).length);

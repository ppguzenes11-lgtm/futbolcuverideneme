// Sitedeki modelle (js/tahmin.js) her maç için maç öncesi pazar olasılıkları + o maçın oranları.
// Kullanım: node pazar_cikar.mjs <veri klasörü> <çıktı.json>
import fs from 'fs';
import path from 'path';
import { modelKur, xgFormu, yeniOzellik } from '../../js/tahmin.js';

const [klasor, cikti] = process.argv.slice(2);
const ham = JSON.parse(fs.readFileSync(path.join(klasor, 'maclar.json')));
const al = (m, k) => m.istatistik?.ALL?.[k] ?? null;
const maclar = ham.filter((m) => m.ev_gol != null).map((m) => ({
  id: m.id, sezon: m.sezon, tarih: m.tarih, ev_id: m.ev_id, dep_id: m.dep_id, ev_gol: m.ev_gol, dep_gol: m.dep_gol, hakem: m.hakem,
  xg: al(m, 'expectedGoals'), kor: al(m, 'cornerKicks'), sari: al(m, 'yellowCards'), kir: al(m, 'redCards'), oranlar: m.oranlar,
})).sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
const ilk = new Date(maclar[0].tarih).getTime();
const gunler = new Map();
for (const m of maclar) { const g = m.tarih.slice(0, 10); if (!gunler.has(g)) gunler.set(g, []); gunler.get(g).push(m); }
const out = [];
for (const [g, liste] of gunler) {
  const simdi = new Date(g + 'T00:00:00Z').getTime();
  if (simdi - ilk < 45 * 86400000) continue;
  const model = modelKur(maclar, simdi);
  const form = xgFormu(maclar, simdi);
  for (const m of liste) {
    const t = model.tahmin(m.ev_id, m.dep_id, { hakemId: m.hakem?.id });
    const o = m.oranlar || {};
    const satir = { id: m.id, sezon: m.sezon, tarih: m.tarih, ev_gol: m.ev_gol, dep_gol: m.dep_gol,
      kor: m.kor ? m.kor[0] + m.kor[1] : null,
      kart: m.sari || m.kir ? (m.sari?.[0] ?? 0) + (m.sari?.[1] ?? 0) + (m.kir?.[0] ?? 0) + (m.kir?.[1] ?? 0) : null,
      x: yeniOzellik(t, form, m.ev_id, m.dep_id), dc: [t.p1, t.px, t.p2], kg: t.kg, ust25: t.ust[2.5], lev: t.lEv, ldep: t.lDep,
      kor_bek: t.korner.toplam, kart_bek: t.kart.toplam, hakem_carpan: t.kart.hakem, pazar: {} };
    for (const [ad, sec] of Object.entries(o)) {
      if (ad === 'Full time' || ad === 'Both teams to score' || ad === 'Match goals 2.5') satir.pazar[ad] = sec;
      const kor = ad.match(/^Corners 2-Way ([\d.]+)$/), kart = ad.match(/^Cards in match ([\d.]+)$/);
      if (kor) satir.pazar[ad] = { cizgi: +kor[1], model: t.korner.ust(+kor[1]), sec };
      if (kart) satir.pazar[ad] = { cizgi: +kart[1], model: t.kart.ust(+kart[1]), sec };
    }
    out.push(satir);
  }
}
fs.writeFileSync(cikti, JSON.stringify(out));
console.log('satır', out.length);

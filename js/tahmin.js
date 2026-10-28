// Maç tahmin modeli (saf fonksiyonlar; tarayıcıda ve Node'da çalışır).
//
// Gol: her takımın hücum ve savunma gücü + ev sahibi avantajı (Maher / Dixon-Coles modeli).
//   Beklenen ev golü = ort · ev · hücum(ev) · savunma(dep), deplasman golü = ort · hücum(dep) · savunma(ev).
//   Güçler eski maçlara daha az ağırlık verilerek (yarılanma süresi) hesaplanır; gol yerine gol ile xG'nin
//   karışımı kullanılır (xG şanstan daha az etkilenir). Az maçı olan takım lig ortalamasına, lige yeni
//   çıkmış takım ise biraz daha zayıf bir başlangıca çekilir.
// Skor olasılıkları Poisson + Dixon-Coles düşük skor düzeltmesi; korner ve kart için aynı güç modeli ve
// negatif binom dağılımı (bu sayılar Poisson'dan daha dağınık). Kartta hakemin eğilimi de çarpan olur.

export const AYAR = {
  yarilanmaGun: 240,   // bir maçın ağırlığı bu kadar günde yarıya iner
  pencereGun: 900,     // daha eski maçlar kullanılmaz
  onsel: 4,            // takım gücünü lig ortalamasına çeken sanal maç sayısı (gol)
  onselKorKart: 8,     // korner ve kart için aynısı (bunlar takım gücünü daha az yansıtır)
  yeniTakim: { hucum: 0.85, savunma: 1.15 }, // lige yeni gelen takımın başlangıç gücü
  xgPayi: 0.5,         // gol hedefinde xG'nin payı (xG yoksa yalnızca gol)
  rho: -0.08,          // Dixon-Coles düşük skor düzeltmesi
  toplamCekim: 0.7,    // maçın toplam gol beklentisini lig ortalamasına bu oranda çeker (takım farkı korunur)
  hakemOnsel: 8,       // hakem çarpanını 1'e çeken sanal maç sayısı
  iterasyon: 40,
};

const GUN = 86400000;

// ---------- Ağırlıklı güç modeli ----------
// satirlar: { tarih(ms), ev, dep, yEv, yDep } — y: hedef sayı (gol, korner, kart)
function gucModeli(satirlar, simdi, ayar, onselFn) {
  const lnIki = Math.LN2 / ayar.yarilanmaGun;
  const veri = satirlar
    .filter((r) => r.yEv != null && r.yDep != null && r.tarih < simdi && simdi - r.tarih < ayar.pencereGun * GUN)
    .map((r) => ({ ...r, w: Math.exp(-lnIki * ((simdi - r.tarih) / GUN)) }));
  const takimlar = new Set(veri.flatMap((r) => [r.ev, r.dep]));
  const hucum = new Map(), savunma = new Map(), onsel = new Map();
  for (const t of takimlar) {
    const o = onselFn(t);
    onsel.set(t, o);
    hucum.set(t, o.hucum);
    savunma.set(t, o.savunma);
  }
  let wT = 0, yT = 0, yEvT = 0, yDepT = 0;
  for (const r of veri) { wT += r.w; yT += r.w * (r.yEv + r.yDep); yEvT += r.w * r.yEv; yDepT += r.w * r.yDep; }
  let ort = wT ? yT / (2 * wT) : 1.35;
  let ev = yDepT > 0 ? Math.sqrt(yEvT / yDepT) : 1.1;
  const K = ayar.onsel;
  for (let it = 0; it < ayar.iterasyon; it++) {
    const hP = new Map(), hB = new Map(), sP = new Map(), sB = new Map();
    for (const t of takimlar) { hP.set(t, 0); hB.set(t, 0); sP.set(t, 0); sB.set(t, 0); }
    for (const r of veri) {
      const he = hucum.get(r.ev), hd = hucum.get(r.dep), se = savunma.get(r.ev), sd = savunma.get(r.dep);
      hP.set(r.ev, hP.get(r.ev) + r.w * r.yEv); hB.set(r.ev, hB.get(r.ev) + r.w * ort * ev * sd);
      hP.set(r.dep, hP.get(r.dep) + r.w * r.yDep); hB.set(r.dep, hB.get(r.dep) + r.w * ort * se);
      sP.set(r.dep, sP.get(r.dep) + r.w * r.yEv); sB.set(r.dep, sB.get(r.dep) + r.w * ort * ev * he);
      sP.set(r.ev, sP.get(r.ev) + r.w * r.yDep); sB.set(r.ev, sB.get(r.ev) + r.w * ort * hd);
    }
    for (const t of takimlar) {
      const o = onsel.get(t);
      hucum.set(t, (hP.get(t) + K * ort * o.hucum) / (hB.get(t) + K * ort));
      savunma.set(t, (sP.get(t) + K * ort * o.savunma) / (sB.get(t) + K * ort));
    }
    let pay = 0, payda = 0, evP = 0, evB = 0;
    for (const r of veri) {
      const a = ev * hucum.get(r.ev) * savunma.get(r.dep), b = hucum.get(r.dep) * savunma.get(r.ev);
      pay += r.w * (r.yEv + r.yDep); payda += r.w * (a + b);
      evP += r.w * r.yEv; evB += r.w * ort * hucum.get(r.ev) * savunma.get(r.dep);
    }
    if (payda) ort = pay / payda;
    if (evB) ev = evP / evB;
  }
  // Dağınıklık: gözlenen varyans / beklenen (Poisson'da 1)
  let fark = 0, n = 0;
  for (const r of veri) {
    const a = ort * ev * hucum.get(r.ev) * savunma.get(r.dep), b = ort * hucum.get(r.dep) * savunma.get(r.ev);
    fark += r.w * (((r.yEv - a) ** 2) / a + ((r.yDep - b) ** 2) / b); n += 2 * r.w;
  }
  const dagilim = n ? Math.max(1, fark / n) : 1;
  const varsayilan = (t) => onselFn(t);
  return {
    ort, ev, dagilim, takimSayisi: takimlar.size, macSayisi: veri.length,
    hucum: (t) => hucum.get(t) ?? varsayilan(t).hucum,
    savunma: (t) => savunma.get(t) ?? varsayilan(t).savunma,
    beklenen(evT, depT) {
      return [ort * ev * this.hucum(evT) * this.savunma(depT), ort * this.hucum(depT) * this.savunma(evT)];
    },
  };
}

// ---------- Dağılımlar ----------
function poisson(l, enCok = 12) {
  const p = [Math.exp(-l)];
  for (let k = 1; k <= enCok; k++) p.push((p[k - 1] * l) / k);
  return p;
}
function lnGamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, t = x + 5.5, s = 1.000000000190015;
  t -= (x + 0.5) * Math.log(t);
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
// Ortalama m, varyans dagilim·m olan negatif binom (dagilim ≤ 1 ise Poisson)
function negBinom(m, dagilim, enCok = 40) {
  if (dagilim <= 1.02) return poisson(m, enCok);
  const r = m / (dagilim - 1), p = r / (r + m);
  const out = [];
  for (let k = 0; k <= enCok; k++) out.push(Math.exp(lnGamma(k + r) - lnGamma(r) - lnGamma(k + 1) + r * Math.log(p) + k * Math.log(1 - p)));
  return out;
}
const ustOlasilik = (dagilim, cizgi) => dagilim.reduce((a, p, k) => a + (k > cizgi ? p : 0), 0);

export function skorMatrisi(lEv, lDep, rho = AYAR.rho) {
  const a = poisson(lEv, 10), b = poisson(lDep, 10);
  const m = a.map((pa, i) => b.map((pb, j) => {
    let tau = 1;
    if (i === 0 && j === 0) tau = 1 - lEv * lDep * rho;
    else if (i === 0 && j === 1) tau = 1 + lEv * rho;
    else if (i === 1 && j === 0) tau = 1 + lDep * rho;
    else if (i === 1 && j === 1) tau = 1 - rho;
    return pa * pb * tau;
  }));
  const top = m.flat().reduce((x, y) => x + y, 0);
  return m.map((s) => s.map((p) => p / top));
}

// ---------- Model ----------
// maclar: ss_maclar satırları { id, tarih, ev_id, dep_id, ev_gol, dep_gol, xg:[ev,dep], kor:[ev,dep], sari, kir, hakem }
export function modelKur(maclar, simdi, ayar = AYAR) {
  const t = (m) => new Date(m.tarih).getTime();
  // Lige yeni gelen takım: tahmin anından önceki 1 yıl içinde bu ligde maçı olmayan takım
  const sonMac = new Map();
  for (const m of maclar) {
    const zm = t(m);
    if (zm >= simdi) continue;
    for (const k of [m.ev_id, m.dep_id]) if (!sonMac.has(k) || sonMac.get(k) < zm) sonMac.set(k, zm);
  }
  const ilkMac = new Map();
  for (const m of maclar) {
    const zm = t(m);
    if (zm >= simdi) continue;
    for (const k of [m.ev_id, m.dep_id]) if (!ilkMac.has(k) || ilkMac.get(k) > zm) ilkMac.set(k, zm);
  }
  const enEski = Math.min(...[...ilkMac.values()]);
  const yeni = (k) => !ilkMac.has(k) || ilkMac.get(k) - enEski > 200 * GUN; // verinin başından sonra lige katılmış
  const golOnsel = (k) => (yeni(k) ? ayar.yeniTakim : { hucum: 1, savunma: 1 });
  const notr = () => ({ hucum: 1, savunma: 1 });

  const xp = ayar.xgPayi;
  const hedefGol = (g, x) => (g == null ? null : x == null ? g : (1 - xp) * g + xp * x);
  const gol = gucModeli(maclar.map((m) => ({
    tarih: t(m), ev: m.ev_id, dep: m.dep_id,
    yEv: hedefGol(m.ev_gol, m.xg?.[0]), yDep: hedefGol(m.dep_gol, m.xg?.[1]),
  })), simdi, ayar, golOnsel);
  const korner = gucModeli(maclar.map((m) => ({ tarih: t(m), ev: m.ev_id, dep: m.dep_id, yEv: m.kor?.[0] ?? null, yDep: m.kor?.[1] ?? null })), simdi, { ...ayar, onsel: ayar.onselKorKart }, notr);
  const kartSay = (m, i) => (m.sari == null && m.kir == null ? null : (m.sari?.[i] ?? 0) + (m.kir?.[i] ?? 0));
  const kartSatir = maclar.map((m) => ({ tarih: t(m), ev: m.ev_id, dep: m.dep_id, yEv: kartSay(m, 0), yDep: kartSay(m, 1), hakem: m.hakem?.id }));
  const kart = gucModeli(kartSatir, simdi, { ...ayar, onsel: ayar.onselKorKart }, notr);

  // Hakem çarpanı: hakemin maçlarında görülen kart / modelin beklediği kart (1'e doğru çekilir)
  const lnIki = Math.LN2 / ayar.yarilanmaGun;
  const hakemP = new Map(), hakemB = new Map();
  for (const r of kartSatir) {
    if (!r.hakem || r.yEv == null || r.tarih >= simdi || simdi - r.tarih > ayar.pencereGun * GUN) continue;
    const w = Math.exp(-lnIki * ((simdi - r.tarih) / GUN));
    const [a, b] = kart.beklenen(r.ev, r.dep);
    hakemP.set(r.hakem, (hakemP.get(r.hakem) || 0) + w * (r.yEv + r.yDep));
    hakemB.set(r.hakem, (hakemB.get(r.hakem) || 0) + w * (a + b));
  }
  const hakemCarpan = (id) => {
    if (!id || !hakemB.has(id)) return 1;
    const K = ayar.hakemOnsel * (kart.ort * 2);
    return (hakemP.get(id) + K) / (hakemB.get(id) + K);
  };

  return {
    gol, korner, kart, hakemCarpan, yeni, macSayisi: gol.macSayisi,
    tahmin(evId, depId, { hakemId = null } = {}) {
      // Toplam gol beklentisi takım güçlerinden tahmin edildiğinde gürültülü; lig ortalamasına çekilir
      const [hamEv, hamDep] = gol.beklenen(evId, depId);
      const ligToplam = gol.ort * (gol.ev + 1), ham = hamEv + hamDep;
      const oran = (ligToplam + (ham - ligToplam) * (1 - ayar.toplamCekim)) / ham;
      const lEv = hamEv * oran, lDep = hamDep * oran;
      const s = skorMatrisi(lEv, lDep, ayar.rho);
      let p1 = 0, px = 0, p2 = 0, kg = 0;
      const toplam = new Array(21).fill(0);
      const skorlar = [];
      s.forEach((satir, i) => satir.forEach((p, j) => {
        if (i > j) p1 += p; else if (i === j) px += p; else p2 += p;
        if (i > 0 && j > 0) kg += p;
        toplam[i + j] += p;
        skorlar.push({ ev: i, dep: j, p });
      }));
      const ust = (c) => toplam.reduce((a, p, k) => a + (k > c ? p : 0), 0);
      const [kEv, kDep] = korner.beklenen(evId, depId);
      const korDag = negBinom(kEv + kDep, korner.dagilim);
      const hc = hakemCarpan(hakemId);
      const [cEv, cDep] = kart.beklenen(evId, depId);
      const kartDag = negBinom((cEv + cDep) * hc, kart.dagilim);
      return {
        lEv, lDep, p1, px, p2, kg,
        ust: { 0.5: ust(0.5), 1.5: ust(1.5), 2.5: ust(2.5), 3.5: ust(3.5), 4.5: ust(4.5) },
        skorlar: skorlar.sort((a, b) => b.p - a.p).slice(0, 6),
        korner: { ev: kEv, dep: kDep, toplam: kEv + kDep, ust: (c) => ustOlasilik(korDag, c) },
        kart: { ev: cEv * hc, dep: cDep * hc, toplam: (cEv + cDep) * hc, hakem: hc, ust: (c) => ustOlasilik(kartDag, c) },
      };
    },
  };
}

// ---------- Bahis oranlarından olasılık (şirket payı çıkarılır) ----------
export function oranOlasilik(oranlar, pazar) {
  const sec = oranlar?.[pazar];
  if (!sec?.length) return null;
  const ters = sec.map(([ad, ilk, son]) => [ad, son ? 1 / son : null]);
  if (ters.some(([, v]) => v == null)) return null;
  const top = ters.reduce((a, [, v]) => a + v, 0);
  return Object.fromEntries(ters.map(([ad, v]) => [ad, v / top]));
}
export const oranSonuc = (oranlar, pazar) => oranlar?.[pazar]?.find((c) => c[3])?.[0] ?? null;

// ---------- Geriye dönük sınama ----------
// Her maç günü için model yalnızca o günden önceki maçlarla kurulur ve o günün maçları tahmin edilir.
export function geriTest(maclar, { baslangic = null, ayar = AYAR, enAzGecmisGun = 45 } = {}) {
  const sirali = [...maclar].sort((a, b) => new Date(a.tarih) - new Date(b.tarih));
  if (!sirali.length) return [];
  const ilk = new Date(sirali[0].tarih).getTime();
  const gunler = new Map();
  for (const m of sirali) {
    const g = m.tarih.slice(0, 10);
    if (!gunler.has(g)) gunler.set(g, []);
    gunler.get(g).push(m);
  }
  const sonuc = [];
  for (const [g, gununMaclari] of gunler) {
    const simdi = new Date(g + 'T00:00:00Z').getTime();
    if (simdi - ilk < enAzGecmisGun * GUN) continue;
    if (baslangic && simdi < baslangic) continue;
    const model = modelKur(sirali, simdi, ayar);
    for (const m of gununMaclari) sonuc.push({ mac: m, tahmin: model.tahmin(m.ev_id, m.dep_id, { hakemId: m.hakem?.id }) });
  }
  return sonuc;
}

// Karne: modelin ve bahis piyasasının başarısı (Brier: 0 kusursuz, küçük olan iyi)
export function karne(sonuclar) {
  const k = { n: 0, dogru: 0, brier: 0, oranN: 0, oranDogru: 0, oranBrier: 0, bizimOranli: 0, kg: [0, 0, 0, 0], ust: [0, 0, 0, 0], kor: [0, 0, 0, 0], kart: [0, 0, 0, 0], kalibre: [] };
  const kutu = Array.from({ length: 10 }, () => ({ n: 0, p: 0, oldu: 0 }));
  for (const { mac: m, tahmin: t } of sonuclar) {
    if (m.ev_gol == null) continue;
    const g = m.ev_gol > m.dep_gol ? 0 : m.ev_gol === m.dep_gol ? 1 : 2;
    const p = [t.p1, t.px, t.p2];
    k.n++;
    if (p.indexOf(Math.max(...p)) === g) k.dogru++;
    const b = p.reduce((a, v, i) => a + (v - (i === g ? 1 : 0)) ** 2, 0);
    k.brier += b;
    p.forEach((v, i) => { const c = kutu[Math.min(9, Math.floor(v * 10))]; c.n++; c.p += v; c.oldu += i === g ? 1 : 0; });
    const o = oranOlasilik(m.oranlar, 'Full time');
    if (o && o['1'] != null) {
      const q = [o['1'], o.X, o['2']];
      k.oranN++;
      if (q.indexOf(Math.max(...q)) === g) k.oranDogru++;
      k.oranBrier += q.reduce((a, v, i) => a + (v - (i === g ? 1 : 0)) ** 2, 0);
      k.bizimOranli += b;
    }
    // İkili pazarlar: [bizim Brier, piyasa Brier, n(oranlı), bizim Brier (oranlı maçlarda)]
    const ikili = (hedef, bizim, oran, olduMu) => {
      const y = olduMu ? 1 : 0;
      if (oran == null) return;
      hedef[0] += (bizim - y) ** 2; hedef[1] += (oran - y) ** 2; hedef[2]++;
    };
    ikili(k.kg, t.kg, oranOlasilik(m.oranlar, 'Both teams to score')?.Yes, m.ev_gol > 0 && m.dep_gol > 0);
    ikili(k.ust, t.ust[2.5], oranOlasilik(m.oranlar, 'Match goals 2.5')?.Over, m.ev_gol + m.dep_gol > 2.5);
    for (const [pazar, oz, hedef] of [['Corners 2-Way', 'kor', k.kor], ['Cards in match', 'kart', k.kart]]) {
      const anahtar = Object.keys(m.oranlar || {}).find((x) => x.startsWith(pazar + ' '));
      const toplam = oz === 'kor' ? (m.kor ? m.kor[0] + m.kor[1] : null) : (m.sari || m.kir ? (m.sari?.[0] ?? 0) + (m.sari?.[1] ?? 0) + (m.kir?.[0] ?? 0) + (m.kir?.[1] ?? 0) : null);
      if (!anahtar || toplam == null) continue;
      const cizgi = parseFloat(anahtar.slice(pazar.length + 1));
      const q = oranOlasilik(m.oranlar, anahtar)?.Over;
      ikili(hedef, (oz === 'kor' ? t.korner : t.kart).ust(cizgi), q, toplam > cizgi);
    }
  }
  k.kalibre = kutu.filter((c) => c.n).map((c, i) => ({ ort: c.p / c.n, gercek: c.oldu / c.n, n: c.n }));
  return k;
}

// ---------- Yeni model (Tahmin laboratuvarının kazananı) ----------
// Mevcut modelin olasılıkları + son maçlardaki xG formu farkı, çok sınıflı lojistik regresyonla birleştirilir.
// Katsayılar scout/analiz/model_egit.py ile, sitedeki bu fonksiyonların ürettiği özelliklerle eğitilir
// (veri/scout_model_katsayi.json). Yalnızca maçtan önce bilinen bilgiler kullanılır.

const XG_ORT = { xgf: 1.45, xga: 1.45 };
const XG_YENI = { xgf: 1.15, xga: 1.8 };

/** Her takımın tahmin anına kadarki xG formu: üstel ağırlıklı ortalama (yarılanma 5 maç). */
export function xgFormu(maclar, simdi, yarilanma = 5) {
  const a = 1 - 0.5 ** (1 / yarilanma);
  const sirali = maclar.filter((m) => new Date(m.tarih).getTime() < simdi).sort((x, y) => new Date(x.tarih) - new Date(y.tarih));
  const ilk = sirali.length ? new Date(sirali[0].tarih).getTime() : simdi;
  const durum = new Map();
  for (const m of sirali) {
    const t = new Date(m.tarih).getTime();
    for (const [id, i] of [[m.ev_id, 0], [m.dep_id, 1]]) {
      if (!durum.has(id)) durum.set(id, { ...(t - ilk > 60 * GUN ? XG_YENI : XG_ORT), n: 0 });
      const d = durum.get(id);
      const xf = m.xg?.[i], xa = m.xg?.[1 - i];
      if (xf == null || xa == null) continue;
      if (d.n === 0) { d.xgf = xf; d.xga = xa; } else { d.xgf = (1 - a) * d.xgf + a * xf; d.xga = (1 - a) * d.xga + a * xa; }
      d.n++;
    }
  }
  const varsayilan = simdi - ilk > 60 * GUN ? XG_YENI : XG_ORT;
  return (id) => durum.get(id) ?? varsayilan;
}

/** Yeni modelin özellikleri: [log(p1/p2), log(px), xG formu net farkı] */
export function yeniOzellik(t, form, evId, depId) {
  const fe = form(evId), fd = form(depId);
  return [Math.log(t.p1 / t.p2), Math.log(t.px), (fe.xgf - fe.xga) - (fd.xgf - fd.xga)];
}

/** Katsayılarla 1-X-2 olasılıkları (softmax). k: {ort, std, b:[3], w:[3][n]} */
export function yeniOlasilik(ozellik, k) {
  const z = ozellik.map((x, i) => (x - k.ort[i]) / k.std[i]);
  const s = k.b.map((b, c) => b + k.w[c].reduce((t, w, i) => t + w * z[i], 0));
  const en = Math.max(...s);
  const e = s.map((x) => Math.exp(x - en));
  const top = e.reduce((x, y) => x + y, 0);
  return { p1: e[0] / top, px: e[1] / top, p2: e[2] / top };
}

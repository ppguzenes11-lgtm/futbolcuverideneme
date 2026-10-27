import { db } from './db.js';
import { kesfetGoster } from './kesfet.js';
import { puanla, enIyi11, DIZILISLER, BILESEN_AD, donemPuanla, DONEM, grupBul } from './puan.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sayi = (n) => Number(n || 0).toLocaleString('tr-TR');
const euro = (n) => (n >= 1e6 ? `€${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mn` : `€${Math.round(n / 1e3).toLocaleString('tr-TR')} bin`);

// Transfermarkt mevkileri (İngilizce) -> grup ve Türkçe ad
const MEVKI = {
  Goalkeeper: ['Kaleci', 'Kaleci'],
  'Centre-Back': ['Defans', 'Stoper'], 'Left-Back': ['Defans', 'Sol bek'], 'Right-Back': ['Defans', 'Sağ bek'], Defender: ['Defans', 'Defans'], Sweeper: ['Defans', 'Libero'],
  'Defensive Midfield': ['Orta saha', 'Ön libero'], 'Central Midfield': ['Orta saha', 'Merkez orta saha'], 'Attacking Midfield': ['Orta saha', 'On numara'],
  'Left Midfield': ['Orta saha', 'Sol orta saha'], 'Right Midfield': ['Orta saha', 'Sağ orta saha'], Midfield: ['Orta saha', 'Orta saha'],
  'Left Winger': ['Forvet', 'Sol kanat'], 'Right Winger': ['Forvet', 'Sağ kanat'], 'Centre-Forward': ['Forvet', 'Santrfor'], 'Second Striker': ['Forvet', 'İkinci forvet'], Attack: ['Forvet', 'Forvet'],
};
const GRUPLAR = ['Kaleci', 'Defans', 'Orta saha', 'Forvet', 'Diğer'];
const mevki = (m) => MEVKI[m] || ['Diğer', m || '-'];
const sezonAd = (s) => `${s}/${String(s + 1).slice(-2)}`;
const yabanciMi = (uyruk, ulke) => uyruk && !uyruk.split(', ').includes(ulke);
const ULKE_TM = { İngiltere: 'England', İspanya: 'Spain', İtalya: 'Italy', Almanya: 'Germany', Fransa: 'France', Portekiz: 'Portugal', Hollanda: 'Netherlands', Türkiye: 'Türkiye' };

const bugun = new Date();
const BU_SEZON = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;

const durum = { lig: 'TR1', sezon: BU_SEZON, kulup: 141, gorunum: 'kulup', dizilis: '4-3-3', mevkiFiltre: '', sezonBit: null };
let ligler = [];

function hata(e) {
  $('#ozet').innerHTML = '';
  const tabloYok = /relation|does not exist|schema cache/i.test(e.message || '');
  $('#icerik').innerHTML = `<div class="bilgi">${tabloYok
    ? "Veritabanı tabloları kurulmamış. Supabase SQL Editor'de <code>supabase/veritabani.sql</code> dosyasını çalıştırın."
    : `Veriler yüklenemedi: ${esc(e.message)}`}</div>`;
}
const bos = (mesaj) => { $('#ozet').innerHTML = ''; $('#icerik').innerHTML = `<div class="bilgi">${mesaj}</div>`; };
const TUM = 'TUM'; // 8 lig birlikte (yalnızca En iyi 11 ve Puan sıralamasında)
const ligAd = (kod) => (kod === TUM ? 'Tüm ligler' : ligler.find((l) => l.kod === kod)?.ad || kod);

// ---------- Seçiciler ----------
async function ligleriYukle() {
  const { data, error } = await db().from('ligler').select('*');
  if (error) throw error;
  const sira = ['TR1', 'GB1', 'ES1', 'IT1', 'L1', 'FR1', 'PO1', 'NL1'];
  ligler = data.sort((a, b) => sira.indexOf(a.kod) - sira.indexOf(b.kod));
  $('#lig').innerHTML = `<option value="${TUM}" hidden>🌍 Tüm ligler (8 lig)</option>`
    + ligler.map((l) => `<option value="${l.kod}">${esc(l.ad)} · ${esc(l.ulke)}</option>`).join('');
  $('#lig').value = durum.lig;
  for (let s = BU_SEZON; s >= 2000; s--) $('#sezon').add(new Option(sezonAd(s), s));
}

async function kulupleriYukle() {
  const { data, error } = await db().from('lig_kulupleri').select('kulup_id,kulupler(ad)').eq('lig_kod', durum.lig).eq('sezon', durum.sezon);
  if (error) throw error;
  const liste = data.map((r) => ({ id: r.kulup_id, ad: r.kulupler.ad })).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  $('#kulup').innerHTML = liste.length ? liste.map((k) => `<option value="${k.id}">${esc(k.ad)}</option>`).join('') : '<option value="">Veri yok</option>';
  if (!liste.some((k) => k.id === durum.kulup)) durum.kulup = liste[0]?.id ?? null;
  if (durum.kulup) $('#kulup').value = durum.kulup;
  return liste;
}

// ---------- Kulüp kadrosu ----------
async function kulupGoster() {
  if (!durum.kulup) return bos(`${ligAd(durum.lig)} ${sezonAd(durum.sezon)} için henüz veri yok. Veri çekme kodu bu sezona geldiğinde burada görünecek.`);
  $('#icerik').innerHTML = '<div class="bilgi">Yükleniyor…</div>';
  const { data, error } = await db().from('oyuncu_sezonlari').select('*,oyuncular(ad,uyruk)').eq('kulup_id', durum.kulup).eq('sezon', durum.sezon);
  if (error) return hata(error);
  if (!data.length) return bos('Bu kulüp ve sezon için oyuncu verisi yok.');

  const ulke = ULKE_TM[ligler.find((l) => l.kod === durum.lig)?.ulke];
  const oynayan = data.filter((r) => r.mac > 0);
  const golcu = [...data].sort((a, b) => b.gol - a.gol)[0];
  const yaslar = oynayan.map((r) => r.yas).filter(Boolean);
  $('#ozet').innerHTML = [
    ['Oynayan oyuncu', `${oynayan.length}<small class="soluk"> / ${data.length}</small>`],
    ['Toplam gol', sayi(data.reduce((a, r) => a + r.gol, 0))],
    ['En golcü', golcu?.gol ? `${esc(golcu.oyuncular.ad)} <small class="soluk">${golcu.gol}</small>` : '-'],
    ['Kadro değeri', (() => { const t = data.reduce((a, r) => a + (r.piyasa_degeri_eur || 0), 0); return t ? esc(euro(t)) : '-'; })()],
    ['Yaş ort. · yabancı', `${yaslar.length ? (yaslar.reduce((a, b) => a + b, 0) / yaslar.length).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '-'} · ${data.filter((r) => yabanciMi(r.oyuncular.uyruk, ulke)).length}`],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');

  const gruplar = Object.fromEntries(GRUPLAR.map((g) => [g, []]));
  for (const r of data) gruplar[mevki(r.mevki)[0]].push(r);
  $('#icerik').innerHTML = GRUPLAR.filter((g) => gruplar[g].length).map((g) => `
    <div class="grup">
      <h3>${g} · ${gruplar[g].length}</h3>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Yaş</th><th>Uyruk</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Dakika</th><th class="sag">Kart</th><th class="sag">Değer</th></tr></thead>
        <tbody>${gruplar[g].sort((a, b) => b.dakika - a.dakika || b.kadroda - a.kadroda).map((r) => `
          <tr data-id="${r.oyuncu_id}">
            <td class="no">${esc(r.forma_no || '-')}</td>
            <td class="ad"><b>${esc(r.oyuncular.ad)}</b><small>${esc(mevki(r.mevki)[1])}</small></td>
            <td data-k="Yaş">${esc(r.yas ?? '-')}</td>
            <td data-k="Uyruk">${esc(r.oyuncular.uyruk || '-')}</td>
            <td data-k="Maç" class="sag">${r.mac || '<span class="soluk">–</span>'}</td>
            <td data-k="Gol" class="sag">${r.gol ? `<b>${r.gol}</b>` : '<span class="soluk">–</span>'}</td>
            <td data-k="Asist" class="sag">${r.asist || '<span class="soluk">–</span>'}</td>
            <td data-k="Dakika" class="sag">${r.dakika ? sayi(r.dakika) : '<span class="soluk">–</span>'}</td>
            <td data-k="Kart" class="sag">${kart(r)}</td>
            <td data-k="Değer" class="sag">${r.piyasa_degeri_eur ? esc(euro(r.piyasa_degeri_eur)) : '<span class="soluk">–</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');
}
const kart = (r) => {
  const p = [];
  if (r.sari) p.push(`🟨${r.sari}`);
  if (r.ikinci_sari) p.push(`🟨🟥${r.ikinci_sari}`);
  if (r.kirmizi) p.push(`🟥${r.kirmizi}`);
  return p.join(' ') || '<span class="soluk">–</span>';
};

// ---------- Gol / asist krallığı (ligdeki kulüplerde, tüm turnuvalar) ----------
// Krallık kapsamı: 'lig' (yalnızca lig maçları) ya da 'tum' (lig + kupa + Avrupa)
let krallikKapsam = 'lig';
async function kralligGoster(alan) {
  const { data: kl, error: e1 } = await db().from('lig_kulupleri').select('kulup_id').eq('lig_kod', durum.lig).eq('sezon', durum.sezon);
  if (e1) return hata(e1);
  if (!kl.length) return bos(`${ligAd(durum.lig)} ${sezonAd(durum.sezon)} için henüz veri yok.`);
  const sutunlar = 'oyuncu_id,gol,asist,mac,dakika,oyuncular(ad,uyruk),kulupler(ad)';
  let kapsam = krallikKapsam;
  let { data, error } = kapsam === 'lig'
    ? await db().from('oyuncu_turnuvalari').select(sutunlar).eq('turnuva_kod', durum.lig).eq('sezon', durum.sezon)
      .gt(alan, 0).order(alan, { ascending: false }).order('mac').limit(30)
    : await db().from('oyuncu_sezonlari').select(sutunlar).in('kulup_id', kl.map((r) => r.kulup_id)).eq('sezon', durum.sezon)
      .gt(alan, 0).order(alan, { ascending: false }).order('mac').limit(30);
  if (error) return hata(error);
  let notEk = '';
  if (kapsam === 'lig' && !data.length) {
    // Bu sezonun lig istatistikleri yoksa tüm turnuvalara düş
    ({ data, error } = await db().from('oyuncu_sezonlari').select(sutunlar).in('kulup_id', kl.map((r) => r.kulup_id)).eq('sezon', durum.sezon)
      .gt(alan, 0).order(alan, { ascending: false }).order('mac').limit(30));
    if (error) return hata(error);
    kapsam = 'tum';
    notEk = ' Bu sezonun yalnızca lig istatistikleri henüz yok.';
  }
  $('#ozet').innerHTML = '';
  if (!data.length) return bos('Bu sezon için kayıt yok.');
  const baslik = alan === 'gol' ? 'Gol' : 'Asist';
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)} · ${baslik} krallığı</h3>
      <div class="segment" style="margin:2px 0 8px">
        <button data-kapsam="lig" class="${kapsam === 'lig' ? 'aktif' : ''}">Sadece lig</button>
        <button data-kapsam="tum" class="${kapsam === 'tum' ? 'aktif' : ''}">Tüm turnuvalar</button>
      </div>
      <p class="soluk" style="margin:0 0 10px;font-size:13px">${kapsam === 'lig' ? 'Yalnızca lig maçları.' : 'Lig, kupa ve Avrupa maçlarının toplamı.'}${notEk}</p>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Kulüp</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Dakika</th></tr></thead>
        <tbody>${data.map((r, i) => `
          <tr data-id="${r.oyuncu_id}">
            <td class="sira">${i + 1}</td>
            <td class="ad"><b>${esc(r.oyuncular.ad)}</b><small>${esc(r.oyuncular.uyruk || '')}</small></td>
            <td data-k="Kulüp">${esc(r.kulupler.ad)}</td>
            <td data-k="Maç" class="sag">${r.mac}</td>
            <td data-k="Gol" class="sag">${alan === 'gol' ? `<b>${r.gol}</b>` : r.gol}</td>
            <td data-k="Asist" class="sag">${alan === 'asist' ? `<b>${r.asist}</b>` : r.asist}</td>
            <td data-k="Dakika" class="sag">${sayi(r.dakika)}</td>
          </tr>`).join('')}</tbody>
      </table></div>`;
  $('#icerik').querySelectorAll('[data-kapsam]').forEach((b) => b.addEventListener('click', () => { krallikKapsam = b.dataset.kapsam; kralligGoster(alan); }));
}

// ---------- Oyuncu kariyeri ----------
const AYAK = { right: 'Sağ ayak', left: 'Sol ayak', both: 'İki ayak' };
const yasHesap = (dt) => { if (!dt) return null; const d = new Date(dt); const n = new Date(); return n.getFullYear() - d.getFullYear() - ((n.getMonth() < d.getMonth() || (n.getMonth() === d.getMonth() && n.getDate() < d.getDate())) ? 1 : 0); };

/** Piyasa değeri grafiği (tek seri): sezon başına en yüksek değer; üzerinde gezinince sezon ve değer */
function degerGrafik(noktalar) {
  if (noktalar.length < 2) return '';
  const W = 560; const H = 170; const sol = 52; const sag = 10; const ust = 10; const alt = 24;
  const x0 = noktalar[0][0]; const x1 = noktalar[noktalar.length - 1][0];
  const y1 = Math.max(...noktalar.map((n) => n[1])) * 1.08;
  const px = (x) => sol + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - sol - sag);
  const py = (y) => ust + (1 - y / y1) * (H - ust - alt);
  const yol = noktalar.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join('');
  const alan = `${yol}L${px(x1).toFixed(1)},${py(0)}L${px(x0).toFixed(1)},${py(0)}Z`;
  const enY = noktalar.reduce((a, b) => (b[1] > a[1] ? b : a));
  const adim = Math.max(1, Math.ceil((x1 - x0) / 6));
  const yillar = []; for (let x = x0; x <= x1; x += adim) yillar.push(x);
  return `
    <div class="deger-grafik" data-noktalar='${JSON.stringify(noktalar)}' data-geo='${JSON.stringify({ W, sol, sag, x0, x1 })}'>
      <svg viewBox="0 0 ${W} ${H}" class="trend" role="img" aria-label="Piyasa değeri, sezonlara göre">
        ${[0.5, 1].map((f) => `<line x1="${sol}" x2="${W - sag}" y1="${py(y1 * f / 1.08)}" y2="${py(y1 * f / 1.08)}" class="izgara"/><text x="${sol - 6}" y="${py(y1 * f / 1.08) + 4}" class="eksen" text-anchor="end">${esc(euro(y1 * f / 1.08))}</text>`).join('')}
        ${yillar.map((x) => `<text x="${px(x)}" y="${H - 6}" class="eksen" text-anchor="middle">${sezonAd(x)}</text>`).join('')}
        <path d="${alan}" class="deger-alan"/><path d="${yol}" class="seri vurgu"/>
        <circle cx="${px(enY[0])}" cy="${py(enY[1])}" r="4.5" class="imlec-nokta"/>
        <text x="${px(enY[0])}" y="${py(enY[1]) - 9}" class="eksen deger-etiket" text-anchor="middle">${esc(euro(enY[1]))}</text>
        <line class="imlec" y1="${ust}" y2="${H - alt}" style="display:none"/>
        <rect class="hedef" x="${sol}" y="0" width="${W - sol - sag}" height="${H}" fill="transparent"/>
      </svg>
      <div class="ipucu" style="display:none"></div>
    </div>`;
}
function degerGrafikEtkilesim(kok) {
  const g = kok.querySelector('.deger-grafik');
  if (!g) return;
  const n = JSON.parse(g.dataset.noktalar); const geo = JSON.parse(g.dataset.geo);
  const svg = g.querySelector('svg'); const ip = g.querySelector('.ipucu'); const im = svg.querySelector('.imlec');
  const goster = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * geo.W;
    const yil = Math.round(geo.x0 + ((x - geo.sol) / (geo.W - geo.sol - geo.sag)) * (geo.x1 - geo.x0));
    const p = n.find((q) => q[0] === yil);
    if (!p) return;
    const xp = geo.sol + ((yil - geo.x0) / (geo.x1 - geo.x0 || 1)) * (geo.W - geo.sol - geo.sag);
    im.setAttribute('x1', xp); im.setAttribute('x2', xp); im.style.display = '';
    ip.innerHTML = `<b>${sezonAd(yil)}</b><div class="vurgu"><span>${esc(p[2])}</span><span>${esc(euro(p[1]))}</span></div>`;
    ip.style.display = '';
    const k = g.getBoundingClientRect(); const sola = ev.clientX - k.left > k.width / 2;
    ip.style.left = sola ? '' : `${ev.clientX - k.left + 12}px`; ip.style.right = sola ? `${k.right - ev.clientX + 12}px` : '';
  };
  const h = svg.querySelector('.hedef');
  h.addEventListener('pointermove', goster); h.addEventListener('pointerdown', goster);
  h.addEventListener('pointerleave', () => { ip.style.display = 'none'; im.style.display = 'none'; });
}

async function oyuncuDetay(id) {
  const [{ data: o }, { data, error }, { data: ligSat }] = await Promise.all([
    db().from('oyuncular').select('*').eq('id', id).single(),
    db().from('oyuncu_sezonlari').select('*,kulupler(ad)').eq('oyuncu_id', id).order('sezon', { ascending: false }),
    db().from('oyuncu_turnuvalari').select('kulup_id,sezon,turnuva_kod,mac,gol,asist').eq('oyuncu_id', id),
  ]);
  if (error || !o) return;
  // Kulübün o sezon hangi ligde olduğu
  const { data: lk } = await db().from('lig_kulupleri').select('lig_kod,sezon,kulup_id').in('kulup_id', [...new Set(data.map((r) => r.kulup_id))]);
  const ligi = (r) => lk?.find((x) => x.kulup_id === r.kulup_id && x.sezon === r.sezon)?.lig_kod;
  const ligIst = new Map((ligSat || []).map((r) => [`${r.kulup_id}:${r.sezon}`, r]));
  const oynanan = data.filter((r) => r.mac > 0 || ligIst.get(`${r.kulup_id}:${r.sezon}`)?.mac);
  const top = (k) => data.reduce((a, r) => a + (r[k] || 0), 0);
  const ligTop = (k) => (ligSat || []).reduce((a, r) => a + (r[k] || 0), 0);
  // Değer grafiği: sezon başına en yüksek değer (sezon içinde kulüp değiştirdiyse ikisinden büyüğü)
  const degerSezon = new Map();
  for (const r of data) if (r.piyasa_degeri_eur && (!degerSezon.has(r.sezon) || r.piyasa_degeri_eur > degerSezon.get(r.sezon)[1])) degerSezon.set(r.sezon, [r.sezon, r.piyasa_degeri_eur, r.kulupler.ad]);
  const degerler = [...degerSezon.values()].sort((a, b) => a[0] - b[0]);
  const zirve = degerler.length ? degerler.reduce((a, b) => (b[1] > a[1] ? b : a)) : null;
  const yas = yasHesap(o.dogum_tarihi);

  $('#detay-ad').textContent = o.ad;
  $('#detay-govde').innerHTML = `
    <div class="etiketler">
      <span class="etiket">${esc(mevki(o.mevki)[1])}</span>
      ${o.uyruk ? `<span class="etiket">${esc(o.uyruk)}</span>` : ''}
      ${o.dogum_tarihi ? `<span class="etiket">${new Date(o.dogum_tarihi).toLocaleDateString('tr-TR')}${yas != null ? ` · ${yas} yaş` : ''}</span>` : ''}
      ${o.boy_cm ? `<span class="etiket">${o.boy_cm} cm</span>` : ''}
      ${o.ayak ? `<span class="etiket">${AYAK[o.ayak] || esc(o.ayak)}</span>` : ''}
      <span class="etiket">${oynanan.length} sezon · ${new Set(oynanan.map((r) => r.kulup_id)).size} kulüp</span>
    </div>
    <div class="kariyer-toplam">
      ${[['Maç', top('mac')], ['Gol', top('gol')], ['Lig golü', ligTop('gol')], ['Asist', top('asist')]].map(([e, d]) => `<div class="stat"><b>${sayi(d)}</b><span>${e}</span></div>`).join('')}
    </div>
    ${degerler.length >= 2 ? `<h4 class="ara-baslik">Piyasa değeri${zirve ? ` <small class="soluk">· zirve ${esc(euro(zirve[1]))} (${sezonAd(zirve[0])})</small>` : ''}</h4>${degerGrafik(degerler)}` : ''}
    <h4 class="ara-baslik">Sezonlar</h4>
    <table>
      <thead><tr><th>Sezon</th><th>Kulüp</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Lig golü</th><th class="sag">Asist</th><th class="sag">Değer</th></tr></thead>
      <tbody>${data.map((r) => { const li = ligIst.get(`${r.kulup_id}:${r.sezon}`); return `
        <tr data-sezon="${r.sezon}" data-kulup="${r.kulup_id}" data-lig="${ligi(r) || ''}">
          <td>${sezonAd(r.sezon)}</td>
          <td data-k="Kulüp">${esc(r.kulupler.ad)}${ligi(r) ? ` <small class="soluk">${esc(ligAd(ligi(r)))}</small>` : ''}</td>
          <td data-k="Maç" class="sag">${r.mac}</td>
          <td data-k="Gol" class="sag">${r.gol ? `<b>${r.gol}</b>` : r.gol}</td>
          <td data-k="Lig golü" class="sag">${li ? li.gol : '–'}</td>
          <td data-k="Asist" class="sag">${r.asist}</td>
          <td data-k="Değer" class="sag">${r.piyasa_degeri_eur ? esc(euro(r.piyasa_degeri_eur)) : '–'}</td>
        </tr>`; }).join('')}</tbody>
    </table>
    <p class="soluk" style="font-size:12px">Sadece 8 ligdeki kulüplerde oynadığı sezonlar. Maç, gol ve asist tüm turnuvaların toplamı; "Lig golü" yalnızca lig maçları. Bir sezona dokunun: o kulübün kadrosu.</p>
    <p><a href="https://www.transfermarkt.com/x/profil/spieler/${o.id}" target="_blank" rel="noopener">Transfermarkt profili ↗</a></p>`;
  degerGrafikEtkilesim($('#detay-govde'));
  if (!$('#detay').open) $('#detay').showModal();
}

// ---------- Futbolcu Puanı ----------
const puanOnbellek = new Map();
async function hepsiniOku(sorgu) {
  const out = [];
  for (let ofs = 0; ; ofs += 1000) {
    const { data, error } = await sorgu().range(ofs, ofs + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
// Önceden hesaplanmış sezon puanları (scripts/puan_uret.mjs → veri/puan/<sezon>.json): piyasa değeri ve lig gücü dahil
const sezonDosyasi = new Map();
async function sezonPuanDosyasi(sezon) {
  if (!sezonDosyasi.has(sezon)) {
    sezonDosyasi.set(sezon, fetch(`veri/puan/${sezon}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((d) => d && d.satirlar.map((r) => {
      const [grup, aile, taraf] = grupBul(r.m);
      const katki = Object.fromEntries(Object.keys(r.w).map((b) => [b, r.w[b] * r.b[b]]));
      return {
        oyuncu_id: r.o, kulup_id: r.k, lig: r.l, ad: r.ad, uyruk: r.u, kulup_ad: r.ka, mevki: r.m, yas: r.y, deger: r.dg,
        grup, aile, taraf, mac: r.mac, gol: r.gol, asist: r.as, dakika: r.dk, sari: r.sa, ikinci_sari: r.is, kirmizi: r.ki,
        sure: r.su, etki: r.et, on: r.on, off: r.of, bilesen: r.b, agirlik: r.w, katki, sampiyonBonus: r.sb, sampiyon: !!r.sp,
        puanLig: r.pl, puanLigIci: r.p, carpan: r.c, ligGucu: d.ligGucu[r.l], puanDunya: r.pd, puan: r.p,
      };
    })));
  }
  return sezonDosyasi.get(sezon);
}
/** Lig sezonunun puanlanmış oyuncuları (sadece lig maçları). lig = TUM: 8 lig birlikte, dünya puanıyla. */
async function ligPuanlari(lig, sezon) {
  const anahtar = `${lig}:${sezon}`;
  if (puanOnbellek.has(anahtar)) return puanOnbellek.get(anahtar);
  const dosya = await sezonPuanDosyasi(sezon);
  if (dosya) {
    const sonuc = lig === TUM
      ? dosya.map((r) => ({ ...r, puan: r.puanDunya, dunya: true })).sort((a, b) => b.puan - a.puan)
      : dosya.filter((r) => r.lig === lig).sort((a, b) => b.puan - a.puan);
    const s2 = sonuc.length ? sonuc : null;
    puanOnbellek.set(anahtar, s2);
    return s2;
  }
  if (lig === TUM) return null;
  // Yedek: dosya yoksa (örn. yeni sezon) canlı veriden lig içi puan
  const [ot, kt] = await Promise.all([
    hepsiniOku(() => db().from('oyuncu_turnuvalari').select('*,oyuncular(ad,uyruk,mevki),kulupler(ad)').eq('turnuva_kod', lig).eq('sezon', sezon)),
    hepsiniOku(() => db().from('kulup_turnuvalari').select('*').eq('turnuva_kod', lig).eq('sezon', sezon)),
  ]);
  if (!ot.length || !kt.length) return null;
  // O sezonki mevki (oyuncunun güncel mevkisi değil)
  const ms = await hepsiniOku(() => db().from('oyuncu_sezonlari').select('oyuncu_id,kulup_id,mevki').eq('sezon', sezon).in('kulup_id', kt.map((k) => k.kulup_id)));
  const mev = new Map(ms.map((m) => [`${m.oyuncu_id}:${m.kulup_id}`, m.mevki]));
  const oyuncular = ot.map((r) => ({ ...r, ad: r.oyuncular.ad, uyruk: r.oyuncular.uyruk, kulup_ad: r.kulupler.ad, mevki: mev.get(`${r.oyuncu_id}:${r.kulup_id}`) || r.oyuncular.mevki }));
  const sonuc = puanla(oyuncular, kt, { bitti: sezon < BU_SEZON });
  puanOnbellek.set(anahtar, sonuc);
  return sonuc;
}
// Seçili sezon aralığı (bitiş seçilmediyse tek sezon)
const aralik = () => {
  const a = durum.sezon; const b = durum.sezonBit ?? durum.sezon;
  return [Math.min(a, b), Math.max(a, b)];
};
const aralikAd = () => { const [a, b] = aralik(); return a === b ? sezonAd(a) : `${sezonAd(a)} – ${sezonAd(b)}`; };
const puanYok = () => bos(`${esc(ligAd(durum.lig))} ${aralikAd()} için lig istatistikleri henüz yüklenmemiş. Lig istatistik kodu bu sezonlara geldiğinde puanlar burada görünecek.`);
const devamNotu = () => (aralik()[1] >= BU_SEZON ? '<p class="not">Devam eden sezon dahil: o sezonun puanları oynanan maçlara göre ve şampiyonluk bonusu yok.</p>' : '');
let sonPuanlar = [];
let sonDonem = false;
let istekNo = 0; // seçim değişince eski (yavaş) hesap ekrana yazmasın

/** Seçili lig ve sezon(lar)ın puanları: tek sezonsa sezon puanı, aralıksa dönem puanı */
async function seciliPuanlar(no) {
  const [a, b] = aralik();
  const lig = durum.lig;
  if (a === b) {
    const p = await ligPuanlari(lig, a);
    if (no === istekNo) sonDonem = false;
    return p;
  }
  const sezonlar = [];
  for (let s = b; s >= a; s -= 3) {
    // 3'er sezon paralel yükle
    const grup = [s, s - 1, s - 2].filter((x) => x >= a);
    if (no !== istekNo) return null;
    $('#icerik').innerHTML = `<div class="bilgi">Puanlar hesaplanıyor… ${sezonAd(grup[0])} (${b - s + 1}/${b - a + 1})</div>`;
    const sonuclar = await Promise.all(grup.map((x) => ligPuanlari(lig, x)));
    grup.forEach((x, i) => { if (sonuclar[i]) sezonlar.push({ sezon: x, puanlilar: sonuclar[i] }); });
  }
  if (!sezonlar.length || no !== istekNo) return null;
  sonDonem = true;
  const p = donemPuanla(sezonlar);
  p.yuklenenSezon = sezonlar.length;
  p.istenenSezon = b - a + 1;
  return p;
}
const eksikNotu = (p) => (sonDonem && p.yuklenenSezon < p.istenenSezon
  ? `<p class="not">Aralıktaki ${p.istenenSezon} sezonun ${p.yuklenenSezon} tanesinin verisi yüklü; hesap yalnızca bunlarla yapıldı.</p>` : '');
const donemNotu = () => (sonDonem ? `<p class="not">Dönem puanı: %${Math.round(DONEM.ZIRVE_AGIRLIK * 100)} zirve (en iyi ${DONEM.ZIRVE_SEZON} sezonun ortalaması) + %${Math.round((1 - DONEM.ZIRVE_AGIRLIK) * 100)} istikrar (iyi sezon sayısı: ${DONEM.IYI_UST}+ puanlı sezon 1, ${(DONEM.IYI_ALT + DONEM.IYI_UST) / 2}'lik yarım, ${DONEM.IYI_ALT} ve altı 0 sayılır; tam puan ${DONEM.ISTIKRAR_SEZON}).</p>` : '');
// Dönem satırında kulupler bir ad listesidir; tek sezon satırında 'kulupler' veritabanı ilişkisidir (nesne), kulup_ad kullanılır
const kulupYazi = (o) => esc(Array.isArray(o.kulupler) ? o.kulupler[0] + (o.kulupler.length > 1 ? ` +${o.kulupler.length - 1}` : '') : o.kulup_ad);

async function enIyi11Goster() {
  const no = ++istekNo;
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = '<div class="bilgi">Puanlar hesaplanıyor…</div>';
  const p = await seciliPuanlar(no);
  if (no !== istekNo) return;
  if (!p) return puanYok();
  sonPuanlar = p;
  const xi = enIyi11(p, durum.dizilis);
  const secilen = xi.flat().filter((y) => y.oyuncu);
  const ort = secilen.reduce((a, y) => a + y.oyuncu.puan, 0) / (secilen.length || 1);
  $('#ozet').innerHTML = [
    ['Takım puanı', ort.toLocaleString('tr-TR', { maximumFractionDigits: 1 })],
    ['Kulüp sayısı', new Set(secilen.map((y) => y.oyuncu.kulup_ad)).size],
    [sonDonem ? 'Dönemde toplam lig golü' : 'Toplam lig golü', sayi(secilen.reduce((a, y) => a + y.oyuncu.gol, 0))],
    ['Diziliş', durum.dizilis],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${aralikAd()} · ${sonDonem ? 'Dönemin' : 'Sezonun'} en iyi 11'i</h3>${eksikNotu(p)}${devamNotu()}
      <div class="saha">${xi.map((sira) => `<div class="saha-sira">${sira.map(({ pozisyon, oyuncu }) => (oyuncu ? `
        <button class="oyuncu-kart" data-puan="${oyuncu.oyuncu_id}:${oyuncu.kulup_id}">
          <span class="p">${oyuncu.puan.toFixed(1)}</span><b>${esc(oyuncu.ad)}</b><small>${kulupYazi(oyuncu)}</small><small>${esc(pozisyon[1])}${sonDonem ? ` · ${oyuncu.sezonlar.length} sz` : ''}</small>
        </button>` : `<div class="oyuncu-kart bos"><b>—</b><small>${esc(pozisyon[1])}</small></div>`)).join('')}</div>`).join('')}
      </div>
      <p class="not">Oyuncuya dokunun: puanın nereden geldiğini görün. Puan yalnızca lig maçlarından hesaplanır; aynı mevkideki oyuncularla karşılaştırılır.</p>
      ${donemNotu()}
    </div>`;
}

async function puanSiralamaGoster() {
  const no = ++istekNo;
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = '<div class="bilgi">Puanlar hesaplanıyor…</div>';
  const p = await seciliPuanlar(no);
  if (no !== istekNo) return;
  if (!p) return puanYok();
  sonPuanlar = p;
  const liste = p.filter((o) => o.sure >= 0.25 && (!durum.mevkiFiltre || o.aile === durum.mevkiFiltre)).slice(0, 50);
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${aralikAd()} · Futbolcu Puanı sıralaması</h3>${eksikNotu(p)}${devamNotu()}${donemNotu()}
      <p class="not">Takımının lig dakikalarının en az %25'inde oynayanlar${sonDonem ? ' (en az bir sezonda)' : ''}. Satıra dokunun: puan dökümü.</p>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Kulüp</th>${sonDonem ? '<th class="sag">Sezon</th>' : ''}<th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th>${sonDonem ? '<th class="sag">En iyi sezon</th>' : ''}<th class="sag">Puan</th></tr></thead>
        <tbody>${liste.map((o, i) => `
          <tr data-puan="${o.oyuncu_id}:${o.kulup_id}">
            <td class="sira">${i + 1}</td>
            <td class="ad"><b>${esc(o.ad)}</b><small>${esc(mevki(o.mevki)[1])}</small></td>
            <td data-k="Kulüp">${kulupYazi(o)}${o.sampiyon || o.sampiyonluk ? ` 🏆${o.sampiyonluk > 1 ? '×' + o.sampiyonluk : ''}` : ''}${durum.lig === TUM && o.lig ? `<small class="soluk" style="display:block">${esc(ligAd(o.lig))}</small>` : ''}</td>
            ${sonDonem ? `<td data-k="Sezon" class="sag">${o.sezonlar.length}</td>` : ''}
            <td data-k="Maç" class="sag">${o.mac}</td>
            <td data-k="Gol" class="sag">${o.gol}</td>
            <td data-k="Asist" class="sag">${o.asist}</td>
            ${sonDonem ? `<td data-k="En iyi sezon" class="sag">${o.enIyiSezon.toFixed(1)}</td>` : ''}
            <td data-k="Puan" class="sag"><b>${o.puan.toFixed(1)}</b></td>
          </tr>`).join('')}</tbody>
      </table></div>`;
}

const BILESEN_ACIKLAMA = {
  S: (o) => `Takımın lig dakikalarının %${Math.round(o.sure * 100)}'inde sahadaydı (${sayi(o.dakika)} dk).`,
  E: (o) => (o.etki == null ? 'Ölçülemedi (o ya da takım onsuz 3 maçtan az oynadı) — nötr sayıldı.'
    : `Takım o sahadayken maç başı ${o.on.toFixed(2)}, yokken ${o.off.toFixed(2)} puan aldı.`),
  T: (o) => `Kulübünün ligdeki başarı sırası${o.sure < 0.6 ? ', süresi az olduğu için kısmen' : ''}.`,
  U: (o) => `${o.gol} gol, ${o.asist} asist · aynı mevkidekilere göre 90 dk başına.`,
  D: (o) => `${o.sari} sarı, ${o.ikinci_sari} ikinci sarı, ${o.kirmizi} kırmızı.`,
  P: (o) => `${o.deger ? euro(o.deger) : '-'}${o.yas ? ` · ${o.yas} yaşında` : ''} · 8 ligde aynı mevki ve yaş grubundakilere göre.`,
};
/** Tek sezon puan dökümü */
function sezonDokumu(o, sezon) {
  $('#detay-ad').textContent = o.ad;
  $('#detay-govde').innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:6px">
      <div class="buyuk-puan">${o.puan.toFixed(1)}</div>
      <div><b>${esc(o.kulup_ad)}</b> · ${esc(ligAd(o.lig || durum.lig))} ${sezonAd(sezon)}<br><span class="soluk">${esc(mevki(o.mevki)[1])} · ${o.mac} maç · ${o.gol} gol · ${o.asist} asist</span></div>
    </div>
    ${o.dunya ? `<p class="not" style="margin:0 0 6px">Tüm ligler görünümü: lig içi puan ${o.puanLigIci.toFixed(1)} × lig gücü çarpanı ${o.carpan.toFixed(2)} (${esc(ligAd(o.lig))}) = <b>${o.puan.toFixed(1)}</b></p>` : ''}
    <div class="dokum">${Object.keys(o.agirlik).map((b) => `
      <div class="dokum-satir">
        <span>${BILESEN_AD[b]}<br><small>ağırlık %${Math.round(o.agirlik[b] * 100)}</small></span>
        <div><div class="cubuk"><i style="width:${Math.round(o.bilesen[b])}%"></i></div><small>${esc(BILESEN_ACIKLAMA[b](o))}</small></div>
        <span class="sag"><b>+${o.katki[b].toFixed(1)}</b></span>
      </div>`).join('')}
      ${o.sampiyonBonus ? `<div class="dokum-satir"><span>🏆 Şampiyonluk</span><small>Şampiyon takımda oynadığı süre oranında bonus.</small><span class="sag"><b>+${o.sampiyonBonus.toFixed(1)}</b></span></div>` : ''}
    </div>
    <p class="not">Çubuklar: aynı sezon ve aynı mevki ailesindeki oyuncular arasındaki yeri (0–100). Puan = ağırlıklı toplam.</p>
    <p><a href="#" data-kariyer="${o.oyuncu_id}">Kariyerini gör →</a></p>`;
  if (!$('#detay').open) $('#detay').showModal();
}
/** Dönem puan dökümü: zirve + istikrar ve sezon sezon puanlar */
function donemDokumu(o) {
  const enIyiler = new Set(o.sezonlar.slice().sort((a, b) => b.puan - a.puan).slice(0, DONEM.ZIRVE_SEZON).map((s) => s.sezon));
  $('#detay-ad').textContent = o.ad;
  $('#detay-govde').innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:6px">
      <div class="buyuk-puan">${o.puan.toFixed(1)}</div>
      <div><b>${esc(o.kulupler.join(', '))}</b><br><span class="soluk">${esc(ligAd(durum.lig))} ${aralikAd()} · ${esc(mevki(o.mevki)[1])} · ${o.mac} maç · ${o.gol} gol · ${o.asist} asist</span></div>
    </div>
    <div class="dokum">
      <div class="dokum-satir"><span>Zirve<br><small>ağırlık %${Math.round(DONEM.ZIRVE_AGIRLIK * 100)}</small></span>
        <div><div class="cubuk"><i style="width:${Math.round(o.zirve)}%"></i></div><small>En iyi ${DONEM.ZIRVE_SEZON} sezonunun ortalaması${o.sezonlar.length < DONEM.ZIRVE_SEZON ? ` (eksik sezonlar ${DONEM.EKSIK_DOLGU} sayıldı)` : ''}: ${o.zirve.toFixed(1)}</small></div>
        <span class="sag"><b>+${(DONEM.ZIRVE_AGIRLIK * o.zirve).toFixed(1)}</b></span></div>
      <div class="dokum-satir"><span>İstikrar<br><small>ağırlık %${Math.round((1 - DONEM.ZIRVE_AGIRLIK) * 100)}</small></span>
        <div><div class="cubuk"><i style="width:${Math.round(o.istikrar)}%"></i></div><small>İyi sezon değeri ${o.iyiSezon.toLocaleString('tr-TR', { maximumFractionDigits: 1 })} / ${o.istikrarHedef} (${DONEM.IYI_UST}+ puanlı sezon 1, ${DONEM.IYI_ALT} ve altı 0 sayılır)</small></div>
        <span class="sag"><b>+${((1 - DONEM.ZIRVE_AGIRLIK) * o.istikrar).toFixed(1)}</b></span></div>
    </div>
    <p class="not">⭐ zirveye sayılan en iyi ${DONEM.ZIRVE_SEZON} sezon · Bir sezona dokunun: o sezonun puan dökümü.</p>
    <table>
      <thead><tr><th>Sezon</th><th>Kulüp</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Puan</th></tr></thead>
      <tbody>${o.sezonlar.map((s) => `
        <tr data-sezon-puan="${s.sezon}:${s.oyuncu_id}:${s.kulup_id}" style="cursor:pointer">
          <td>${sezonAd(s.sezon)}${enIyiler.has(s.sezon) ? ' ⭐' : ''}</td>
          <td data-k="Kulüp">${esc(s.kulup_ad)}${s.sampiyon ? ' 🏆' : ''}</td>
          <td data-k="Maç" class="sag">${s.mac}</td><td data-k="Gol" class="sag">${s.gol}</td><td data-k="Asist" class="sag">${s.asist}</td>
          <td data-k="Puan" class="sag"><b>${s.puan.toFixed(1)}</b></td>
        </tr>`).join('')}</tbody>
    </table>
    <p><a href="#" data-kariyer="${o.oyuncu_id}">Kariyerini gör →</a></p>`;
  if (!$('#detay').open) $('#detay').showModal();
}
function puanDokumu(anahtar) {
  const o = sonPuanlar.find((x) => `${x.oyuncu_id}:${x.kulup_id}` === anahtar);
  if (!o) return;
  if (sonDonem) donemDokumu(o); else sezonDokumu(o, aralik()[0]);
}

// ---------- Arama ----------
async function ara(metin) {
  const { data, error } = await db().from('oyuncular').select('id,ad,uyruk,mevki').ilike('ad', `%${metin}%`).order('ad').limit(40);
  if (error) return hata(error);
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = data.length ? `
    <div class="grup"><h3>Arama sonuçları · ${data.length}${data.length === 40 ? '+' : ''}</h3>
      <table>
        <thead><tr><th>Oyuncu</th><th>Uyruk</th></tr></thead>
        <tbody>${data.map((o) => `<tr data-id="${o.id}"><td class="ad"><b>${esc(o.ad)}</b><small>${esc(mevki(o.mevki)[1])}</small></td><td data-k="Uyruk">${esc(o.uyruk || '-')}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="bilgi">Eşleşen oyuncu yok.</div>';
}

// ---------- Akış ----------
async function goster() {
  istekNo++;
  $('#ara').value = '';
  try {
    if (durum.gorunum === 'kulup') await kulupGoster();
    else if (durum.gorunum === 'enIyi11') await enIyi11Goster();
    else if (durum.gorunum === 'puan') await puanSiralamaGoster();
    else if (durum.gorunum === 'kesfet') await kesfetGoster($('#icerik'), durum.lig, { oyuncuDetay, ozetEl: $('#ozet') });
    else await kralligGoster(durum.gorunum);
  } catch (e) { hata(e); }
}
async function ligSezonDegisti() {
  try { await kulupleriYukle(); } catch (e) { return hata(e); }
  goster();
}
function gorunumSec(g) {
  durum.gorunum = g;
  document.querySelectorAll('.sekme').forEach((b) => b.classList.toggle('aktif', b.dataset.gorunum === g));
  $('#kulup').closest('.alan').style.display = g === 'kulup' ? '' : 'none';
  $('#sezon').closest('.alan').style.display = g === 'kesfet' ? 'none' : '';
  $('#dizilis-alan').style.display = g === 'enIyi11' ? '' : 'none';
  $('#bitis-alan').style.display = g === 'enIyi11' || g === 'puan' ? '' : 'none';
  $('#mevki-alan').style.display = g === 'puan' ? '' : 'none';
  const puanSekmesi = g === 'enIyi11' || g === 'puan';
  $('#lig').querySelector(`option[value="${TUM}"]`).hidden = !puanSekmesi;
  if (!puanSekmesi && durum.lig === TUM) { durum.lig = 'TR1'; $('#lig').value = 'TR1'; kulupleriYukle().catch(() => {}); }
}

$('#lig').addEventListener('change', (e) => { durum.lig = e.target.value; ligSezonDegisti(); });
$('#sezon').addEventListener('change', (e) => { durum.sezon = Number(e.target.value); ligSezonDegisti(); });
$('#kulup').addEventListener('change', (e) => { durum.kulup = Number(e.target.value); goster(); });
document.querySelectorAll('.sekme').forEach((b) => b.addEventListener('click', () => { gorunumSec(b.dataset.gorunum); goster(); }));
let araZaman;
$('#ara').addEventListener('input', (e) => {
  clearTimeout(araZaman);
  const m = e.target.value.trim();
  araZaman = setTimeout(() => (m.length >= 2 ? ara(m) : goster()), 300);
});
$('#icerik').addEventListener('click', (e) => {
  const p = e.target.closest('[data-puan]');
  if (p) return puanDokumu(p.dataset.puan);
  const tr = e.target.closest('tr[data-id]');
  if (tr) oyuncuDetay(Number(tr.dataset.id));
});
for (const d of Object.keys(DIZILISLER)) $('#dizilis').add(new Option(d, d));
$('#dizilis').addEventListener('change', (e) => { durum.dizilis = e.target.value; goster(); });
$('#sezon-bit').add(new Option('— (tek sezon)', ''));
for (let s = BU_SEZON; s >= 2000; s--) $('#sezon-bit').add(new Option(sezonAd(s), s));
$('#sezon-bit').addEventListener('change', (e) => { durum.sezonBit = e.target.value ? Number(e.target.value) : null; goster(); });
$('#mevki-filtre').addEventListener('change', (e) => { durum.mevkiFiltre = e.target.value; goster(); });
// Kariyerde bir sezona tıklayınca o kulübün o sezonki kadrosuna git
$('#detay-govde').addEventListener('click', async (e) => {
  const k = e.target.closest('[data-kariyer]');
  if (k) { e.preventDefault(); return oyuncuDetay(Number(k.dataset.kariyer)); }
  const sp = e.target.closest('[data-sezon-puan]');
  if (sp) {
    const [sz, oid, kid] = sp.dataset.sezonPuan.split(':').map(Number);
    const liste = await ligPuanlari(durum.lig, sz);
    const o = liste?.find((x) => x.oyuncu_id === oid && x.kulup_id === kid);
    if (o) sezonDokumu(o, sz);
    return;
  }
  const tr = e.target.closest('tr[data-sezon]');
  if (!tr || !tr.dataset.lig) return;
  $('#detay').close();
  Object.assign(durum, { lig: tr.dataset.lig, sezon: Number(tr.dataset.sezon), kulup: Number(tr.dataset.kulup) });
  $('#lig').value = durum.lig; $('#sezon').value = durum.sezon;
  gorunumSec('kulup');
  ligSezonDegisti();
});
$('#detay-kapat').addEventListener('click', () => $('#detay').close());
$('#detay').addEventListener('click', (e) => { if (e.target.id === 'detay') $('#detay').close(); });

(async () => {
  try {
    await ligleriYukle();
    $('#sezon').value = durum.sezon;
    await ligSezonDegisti();
  } catch (e) { hata(e); }
})();

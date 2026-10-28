import { db } from './db.js';
import { modelKur, geriTest, karne, oranOlasilik, xgFormu, yeniOzellik, yeniOlasilik } from './tahmin.js';

// Scout — SofaScore verisi (ss_ tabloları): maçlar, oyuncu sıralamaları, oyuncu profili, çekim durumu.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sayi = (n, b = 0) => (n == null || Number.isNaN(n) ? '–' : Number(n).toLocaleString('tr-TR', { minimumFractionDigits: b, maximumFractionDigits: b }));
const tarihAd = (t) => (t ? new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const saatAd = (t) => (t ? new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
const yas = (d) => (d ? Math.floor((Date.now() - new Date(d)) / 31557600000) : null);

const LIGLER = [{ id: 17, ad: 'Premier Lig' }, { id: 52, ad: 'Süper Lig' }, { id: 37, ad: 'Eredivisie' }];
const bugun = new Date();
const BU = (bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1) % 100;
const iki = (n) => String(n).padStart(2, '0');
const SEZONLAR = Array.from({ length: BU - 16 + 1 }, (_, i) => `${iki(BU - i)}/${iki(BU - i + 1)}`);
const MEVKI = { G: 'Kaleci', D: 'Defans', M: 'Orta saha', F: 'Forvet' };
const ligAd = (id) => LIGLER.find((l) => l.id === id)?.ad ?? id;

const durum = { gorunum: 'maclar', ev: null, dep: null, hakem: '', lig: 17, sezon: SEZONLAR[0], hafta: null, stat: 'puan', mevki: '', dk: 900, ara: '' };
let takimlar = new Map(), anahtar = new Map();
const takim = (id) => takimlar.get(id)?.ad ?? '?';

function hata(e) {
  $('#ozet').innerHTML = '';
  const tabloYok = /relation|does not exist|schema cache/i.test(e.message || '');
  $('#icerik').innerHTML = `<div class="bilgi">${tabloYok
    ? "Scout tabloları kurulmamış. Supabase SQL Editor'de <code>scout/supabase/sofascore.sql</code> dosyasını çalıştırın."
    : `Veriler yüklenemedi: ${esc(e.message)}`}</div>`;
}
let surum = 0;
const guncel = (v) => v === surum;
const bos = (mesaj) => { $('#ozet').innerHTML = ''; $('#icerik').innerHTML = `<div class="bilgi">${mesaj}</div>`; };
const yukleniyor = () => { $('#icerik').innerHTML = '<div class="bilgi">Yükleniyor…</div>'; };

async function sayfali(yap) {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await yap().range(i, i + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function parcali(ids, yap, boyut = 150) {
  const out = [];
  for (let i = 0; i < ids.length; i += boyut) out.push(...(await sayfali(() => yap(ids.slice(i, i + boyut)))));
  return out;
}
async function oyuncuAdlari(ids) {
  const liste = [...new Set(ids.filter(Boolean))];
  const satir = await parcali(liste, (p) => db().from('ss_oyuncular').select('id,ad,kisa_ad,mevki,dogum,ulke').in('id', p));
  return new Map(satir.map((r) => [r.id, r]));
}

// ---------- Oyuncu istatistikleri (ist dizisi) ----------
const ist = (r, k) => { const i = anahtar.get(k); return i == null ? 0 : (r.ist?.[i] ?? 0); };
function topla(satirlar) {
  const a = new Map();
  for (const r of satirlar) {
    let t = a.get(r.oyuncu_id);
    if (!t) a.set(r.oyuncu_id, (t = { id: r.oyuncu_id, mac: 0, dakika: 0, puanT: 0, puanN: 0, ist: [], takim: new Map(), mevki: new Map() }));
    t.mac++;
    t.dakika += r.dakika || 0;
    if (r.puan != null) { t.puanT += r.puan; t.puanN++; }
    (r.ist || []).forEach((v, i) => { if (v != null) t.ist[i] = (t.ist[i] || 0) + v; });
    t.takim.set(r.takim_id, (t.takim.get(r.takim_id) || 0) + 1);
    if (r.mevki) t.mevki.set(r.mevki, (t.mevki.get(r.mevki) || 0) + 1);
  }
  for (const t of a.values()) {
    t.takimId = [...t.takim].sort((x, y) => y[1] - x[1])[0]?.[0];
    t.mevkiKod = [...t.mevki].sort((x, y) => y[1] - x[1])[0]?.[0];
  }
  return [...a.values()];
}
const d90 = (t, k) => (t.dakika ? (ist(t, k) * 90) / t.dakika : null);
const yuzde = (pay, payda, enAz = 10) => (payda >= enAz ? (100 * pay) / payda : null);
const STATLAR = [
  { k: 'puan', ad: 'Ortalama puan', b: 2, f: (t) => (t.puanN ? t.puanT / t.puanN : null) },
  { k: 'gol', ad: 'Gol', f: (t) => ist(t, 'goals') },
  { k: 'asist', ad: 'Asist', f: (t) => ist(t, 'goalAssist') },
  { k: 'xg', ad: 'Beklenen gol (xG)', b: 2, f: (t) => ist(t, 'expectedGoals') },
  { k: 'calim', ad: 'Başarılı çalım / 90 dk', b: 2, f: (t) => d90(t, 'wonContest') },
  { k: 'calimY', ad: 'Çalım başarısı %', b: 0, f: (t) => yuzde(ist(t, 'wonContest'), ist(t, 'totalContest'), 20) },
  { k: 'ikiliY', ad: 'İkili mücadele kazanma %', b: 0, f: (t) => yuzde(ist(t, 'duelWon'), ist(t, 'duelWon') + ist(t, 'duelLost'), 50) },
  { k: 'kilit', ad: 'Kilit pas / 90 dk', b: 2, f: (t) => d90(t, 'keyPass') },
  { k: 'buyuk', ad: 'Büyük fırsat yaratma / 90 dk', b: 2, f: (t) => d90(t, 'bigChanceCreated') },
  { k: 'topKapma', ad: 'Başarılı top kapma / 90 dk', b: 2, f: (t) => d90(t, 'wonTackle') },
  { k: 'arayaGirme', ad: 'Araya girme / 90 dk', b: 2, f: (t) => d90(t, 'interceptionWon') },
  { k: 'topKazanma', ad: 'Top kazanma / 90 dk', b: 2, f: (t) => d90(t, 'ballRecovery') },
  { k: 'pasY', ad: 'Pas isabeti %', b: 0, f: (t) => yuzde(ist(t, 'accuratePass'), ist(t, 'totalPass'), 100) },
  { k: 'havaY', ad: 'Hava topu kazanma %', b: 0, f: (t) => yuzde(ist(t, 'aerialWon'), ist(t, 'aerialWon') + ist(t, 'aerialLost'), 20) },
  { k: 'topKaybi', ad: 'Top kaybı / 90 dk (az iyi)', b: 2, ters: true, f: (t) => d90(t, 'possessionLostCtrl') },
  { k: 'kurtaris', ad: 'Kurtarış / 90 dk', b: 2, f: (t) => d90(t, 'saves') },
];

// ---------- Seçiciler ----------
function seciciler() {
  $('#lig').innerHTML = LIGLER.map((l) => `<option value="${l.id}">${esc(l.ad)}</option>`).join('');
  $('#lig').value = durum.lig;
  $('#sezon').innerHTML = SEZONLAR.map((s) => `<option>${s}</option>`).join('');
  $('#stat').innerHTML = STATLAR.map((s) => `<option value="${s.k}">${esc(s.ad)}</option>`).join('');
  const g = durum.gorunum;
  $('#hafta-alan').style.display = g === 'maclar' ? '' : 'none';
  for (const id of ['#stat-alan', '#mevki-alan', '#dk-alan']) $(id).style.display = g === 'siralama' ? '' : 'none';
  $('#ara-alan').style.display = g === 'oyuncular' ? '' : 'none';
  for (const id of ['#ev-alan', '#dep-alan', '#hakem-alan']) $(id).style.display = g === 'tahmin' ? '' : 'none';
  $('#lig').parentElement.style.display = g === 'oyuncular' || g === 'durum' || g === 'analiz' || g === 'kupon' ? 'none' : '';
  $('#sezon').parentElement.style.display = g === 'oyuncular' || g === 'durum' || g === 'tahmin' || g === 'analiz' || g === 'kupon' ? 'none' : '';
}

// ---------- Maçlar ----------
async function maclarGoster() {
  const v = surum;
  yukleniyor();
  let maclar;
  try {
    maclar = await sayfali(() => db().from('ss_maclar').select('id,hafta,tur,tarih,ev_id,dep_id,ev_gol,dep_gol,ev_iy,dep_iy')
      .eq('lig_id', durum.lig).eq('sezon', durum.sezon).order('tarih'));
  } catch (e) { return guncel(v) && hata(e); }
  if (!guncel(v)) return;
  if (!maclar.length) {
    $('#hafta').innerHTML = '';
    return bos(`${ligAd(durum.lig)} ${durum.sezon} için henüz maç yok. Veri çekimi bu sezona gelince burada görünecek.`);
  }
  const haftalar = [...new Set(maclar.map((m) => m.hafta ?? 0))].sort((a, b) => a - b);
  if (!haftalar.includes(durum.hafta)) durum.hafta = haftalar[haftalar.length - 1];
  $('#hafta').innerHTML = haftalar.map((h) => `<option value="${h}">${h ? `${h}. hafta` : 'Diğer'}</option>`).join('');
  $('#hafta').value = durum.hafta;

  const gol = maclar.reduce((a, m) => a + (m.ev_gol ?? 0) + (m.dep_gol ?? 0), 0);
  const kg = maclar.filter((m) => m.ev_gol > 0 && m.dep_gol > 0).length;
  const ust = maclar.filter((m) => m.ev_gol + m.dep_gol > 2.5).length;
  const ev = maclar.filter((m) => m.ev_gol > m.dep_gol).length, ber = maclar.filter((m) => m.ev_gol === m.dep_gol).length;
  $('#ozet').innerHTML = [
    ['Çekilen maç', sayi(maclar.length)],
    ['Maç başı gol', sayi(gol / maclar.length, 2)],
    ['Karşılıklı gol', `%${sayi((100 * kg) / maclar.length)}`],
    ['2,5 üst', `%${sayi((100 * ust) / maclar.length)}`],
    ['Ev / ber. / dep.', `%${sayi((100 * ev) / maclar.length)} · %${sayi((100 * ber) / maclar.length)} · %${sayi((100 * (maclar.length - ev - ber)) / maclar.length)}`],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');

  const liste = maclar.filter((m) => (m.hafta ?? 0) === durum.hafta);
  $('#icerik').innerHTML = `<div class="mac-liste">${liste.map((m) => `
    <button class="mac" data-mac="${m.id}">
      <span class="mac-zaman">${esc(tarihAd(m.tarih))}<small>${esc(saatAd(m.tarih))}</small></span>
      <span class="mac-takim ev ${m.ev_gol > m.dep_gol ? 'kazanan' : ''}">${esc(takim(m.ev_id))}</span>
      <span class="mac-skor">${m.ev_gol ?? '-'} – ${m.dep_gol ?? '-'}<small>İY ${m.ev_iy ?? '-'}-${m.dep_iy ?? '-'}</small></span>
      <span class="mac-takim dep ${m.dep_gol > m.ev_gol ? 'kazanan' : ''}">${esc(takim(m.dep_id))}</span>
    </button>`).join('')}</div>`;
  $('#icerik').querySelectorAll('[data-mac]').forEach((b) => b.addEventListener('click', () => macDetay(+b.dataset.mac)));
}

// Takım istatistikleri: önce bu liste, sonra kalanlar ("Tümünü göster")
const TAKIM_IST = [
  ['ballPossession', 'Topa sahip olma', '%'], ['expectedGoals', 'Beklenen gol (xG)'], ['totalShotsOnGoal', 'Toplam şut'],
  ['shotsOnGoal', 'İsabetli şut'], ['bigChanceCreated', 'Büyük fırsat'], ['touchesInOppBox', 'Rakip ceza sahasında topla buluşma'],
  ['cornerKicks', 'Korner'], ['fouls', 'Faul'], ['yellowCards', 'Sarı kart'], ['redCards', 'Kırmızı kart'], ['offsides', 'Ofsayt'],
  ['passes', 'Pas'], ['accuratePasses', 'İsabetli pas'], ['accurateLongBalls', 'Uzun top (isabetli)'], ['accurateCross', 'Orta (isabetli)'],
  ['duelWonPercent', 'İkili mücadele', '%'], ['groundDuelsPercentage', 'Yer mücadelesi (kazanılan)'], ['aerialDuelsPercentage', 'Hava topu (kazanılan)'],
  ['dribblesPercentage', 'Çalım (başarılı)'], ['wonTacklePercent', 'Top kapma (başarılı)'], ['interceptionWon', 'Araya girme'],
  ['ballRecovery', 'Top kazanma'], ['totalClearance', 'Uzaklaştırma'], ['goalkeeperSaves', 'Kurtarış'], ['kilometersCovered', 'Koşu mesafesi (km)'],
];
const istDeger = (v, i) => {
  const d = v[i];
  if (d == null) return '–';
  if (v.length > 2 && v[i + 2]) return `${sayi(d)}/${sayi(v[i + 2])} <small>%${sayi((100 * d) / v[i + 2])}</small>`;
  return sayi(d, Number.isInteger(d) ? 0 : 2);
};
function istSatir(k, ad, v, birim = '') {
  const [e, d] = v;
  const pe = v.length > 2 && v[2] ? e / v[2] : e, pd = v.length > 2 && v[3] ? d / v[3] : d;
  const top = (pe || 0) + (pd || 0);
  const oran = top ? (100 * (pe || 0)) / top : 50;
  return `<div class="ist-satir">
    <div class="ist-ust"><b>${istDeger(v, 0)}${birim}</b><span>${esc(ad)}</span><b>${istDeger(v, 1)}${birim}</b></div>
    <div class="ist-cubuk"><i style="width:${oran}%"></i></div></div>`;
}

let macPeriyot = 'ALL';
async function macDetay(id) {
  $('#detay-ad').textContent = 'Yükleniyor…';
  $('#detay-govde').innerHTML = '';
  if (!$('#detay').open) $('#detay').showModal();
  const [{ data: m, error }, { data: oy, error: e2 }] = await Promise.all([
    db().from('ss_maclar').select('*').eq('id', id).single(),
    db().from('ss_oyuncu_mac').select('*').eq('mac_id', id),
  ]);
  if (error || e2) { $('#detay-govde').innerHTML = `<div class="bilgi">${esc((error || e2).message)}</div>`; return; }
  const adlar = await oyuncuAdlari([...oy.map((r) => r.oyuncu_id), ...(m.olaylar || []).flatMap((o) => [o.p, o.a])]);
  const oAd = (pid) => adlar.get(pid)?.kisa_ad || adlar.get(pid)?.ad || (m.eksikler || []).find((x) => x.id === pid)?.ad || '?';
  let tahminHtml = '';
  const baslik = `${takim(m.ev_id)} ${m.ev_gol ?? ''}–${m.dep_gol ?? ''} ${takim(m.dep_id)}`;
  $('#detay-ad').textContent = baslik;

  const etiket = [
    `${ligAd(m.lig_id)} · ${m.sezon}${m.hafta ? ` · ${m.hafta}. hafta` : ''}`,
    `${tarihAd(m.tarih)} ${saatAd(m.tarih)}`,
    m.stadyum && `🏟 ${m.stadyum}${m.seyirci ? ` · ${sayi(m.seyirci)} seyirci` : ''}`,
    m.hakem && `🟨 Hakem: ${m.hakem.ad}`,
    `İlk yarı ${m.ev_iy ?? '-'}-${m.dep_iy ?? '-'}`,
  ].filter(Boolean);
  const hoca = `<div class="iki-taraf"><div><small class="soluk">Teknik direktör · diziliş</small><b>${esc(m.ev_hoca?.ad || '–')}</b><span>${esc(m.ev_dizilis || '')}</span></div>
    <div class="sag"><small class="soluk">Teknik direktör · diziliş</small><b>${esc(m.dep_hoca?.ad || '–')}</b><span>${esc(m.dep_dizilis || '')}</span></div></div>`;

  const istHtml = () => {
    const per = m.istatistik?.[macPeriyot] || {};
    if (!Object.keys(per).length) return '<p class="not">Bu maç için takım istatistiği yok.</p>';
    const bilinen = new Set(TAKIM_IST.map((x) => x[0]));
    return TAKIM_IST.filter(([k]) => per[k]).map(([k, ad, b]) => istSatir(k, ad, per[k], b || '')).join('')
      + `<details class="tablo-gor"><summary>Tümünü göster (${Object.keys(per).length})</summary>${Object.entries(per).filter(([k]) => !bilinen.has(k)).map(([k, v]) => istSatir(k, k, v)).join('')}</details>`;
  };

  const IKON = { goal: '⚽', card: '🟨', substitution: '🔁', varDecision: '📺', inGamePenalty: '❌' };
  const olaylar = (m.olaylar || []).slice().sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || (a.e ?? 0) - (b.e ?? 0)).map((o) => {
    const ikon = o.t === 'card' ? (o.s === 'red' ? '🟥' : o.s === 'yellowRed' ? '🟨🟥' : '🟨') : IKON[o.t] || '•';
    const ek = o.t === 'goal' ? (o.s === 'penalty' ? ' (penaltı)' : o.s === 'ownGoal' ? ' (kendi kalesine)' : o.a ? ` <small>asist: ${esc(oAd(o.a))}</small>` : '')
      : o.t === 'substitution' ? ` <small>çıkan: ${esc(oAd(o.a))}</small>` : o.t === 'inGamePenalty' ? ' <small>kaçan penaltı</small>' : o.t === 'varDecision' ? ' <small>VAR</small>' : '';
    return `<li class="${o.h ? 'ev' : 'dep'}"><span class="dk">${o.d ?? ''}${o.e ? `+${o.e}` : ''}'</span>${ikon} ${esc(oAd(o.p))}${ek}</li>`;
  }).join('');

  const kadro = (ev) => {
    const liste = oy.filter((r) => r.ev === ev).sort((a, b) => a.yedek - b.yedek || 'GDMF'.indexOf(a.mevki) - 'GDMF'.indexOf(b.mevki));
    return `<table><thead><tr><th>Oyuncu</th><th class="sag">Dk</th><th class="sag">Puan</th><th class="sag">G/A</th><th class="sag">Şut</th><th class="sag">Kilit pas</th><th class="sag">Çalım</th><th class="sag">İkili</th><th class="sag">Top kapma</th><th class="sag">Pas</th></tr></thead><tbody>
      ${liste.map((r) => `<tr data-oyuncu="${r.oyuncu_id}">
        <td class="ad"><b>${esc(oAd(r.oyuncu_id))}${r.kaptan ? ' <small>(K)</small>' : ''}</b><small>${esc(r.forma ?? '')} · ${esc(MEVKI[r.mevki] || r.mevki || '')}${r.yedek ? ' · yedekten' : ''}</small></td>
        <td data-k="Dk" class="sag">${r.dakika}</td>
        <td data-k="Puan" class="sag"><span class="puan ${r.puan >= 7.5 ? 'iyi' : r.puan < 6.3 ? 'kotu' : ''}">${sayi(r.puan, 1)}</span></td>
        <td data-k="G/A" class="sag">${ist(r, 'goals') || 0}/${ist(r, 'goalAssist') || 0}</td>
        <td data-k="Şut" class="sag">${ist(r, 'totalShots')}</td>
        <td data-k="Kilit pas" class="sag">${ist(r, 'keyPass')}</td>
        <td data-k="Çalım" class="sag">${ist(r, 'wonContest')}/${ist(r, 'totalContest')}</td>
        <td data-k="İkili" class="sag">${ist(r, 'duelWon')}/${ist(r, 'duelWon') + ist(r, 'duelLost')}</td>
        <td data-k="Top kapma" class="sag">${ist(r, 'wonTackle')}</td>
        <td data-k="Pas" class="sag">${ist(r, 'accuratePass')}/${ist(r, 'totalPass')}</td></tr>`).join('')}</tbody></table>`;
  };
  const SEBEP = { missing: 'Yok', doubtful: 'Şüpheli' };
  const eksik = (ev) => (m.eksikler || []).filter((x) => x.ev === ev).map((x) => `<span class="etiket">${esc(x.ad)} <small class="soluk">${esc(SEBEP[x.tip] || x.tip || '')}</small></span>`).join('') || '<span class="soluk">Yok</span>';

  const oranHtml = m.oranlar ? Object.entries(m.oranlar).map(([pazar, secenek]) => `<tr><td>${esc(pazar)}</td><td>${secenek.map(([ad, ilk, son, kaz]) =>
    `<span class="oran ${kaz ? 'kazandi' : ''}">${esc(ad)} <b>${sayi(son, 2)}</b>${ilk && ilk !== son ? ` <small>(açılış ${sayi(ilk, 2)})</small>` : ''}</span>`).join(' ')}</td></tr>`).join('') : '';

  const ciz = () => {
    $('#detay-govde').innerHTML = `
      <div class="etiketler">${etiket.map((e) => `<span class="etiket">${esc(e)}</span>`).join('')}</div>
      ${hoca}
      <h3 class="ara-baslik">Takım istatistikleri</h3>
      <div class="segment" id="periyot">${[['ALL', 'Maç'], ['1ST', '1. yarı'], ['2ND', '2. yarı']].map(([k, a]) => `<button data-p="${k}" class="${k === macPeriyot ? 'aktif' : ''}">${a}</button>`).join('')}</div>
      <div class="ist-kutu">${istHtml()}</div>
      <div id="mac-tahmin">${tahminHtml}</div>
      ${olaylar ? `<h3 class="ara-baslik">Maç olayları</h3><ul class="olaylar">${olaylar}</ul>` : ''}
      <h3 class="ara-baslik">${esc(takim(m.ev_id))} kadrosu</h3><div class="tablo-kaydir">${kadro(true)}</div>
      <h3 class="ara-baslik">${esc(takim(m.dep_id))} kadrosu</h3><div class="tablo-kaydir">${kadro(false)}</div>
      <h3 class="ara-baslik">Eksik oyuncular</h3>
      <div class="iki-sutun"><div><small class="soluk">${esc(takim(m.ev_id))}</small><div class="etiketler">${eksik(true)}</div></div>
        <div><small class="soluk">${esc(takim(m.dep_id))}</small><div class="etiketler">${eksik(false)}</div></div></div>
      ${oranHtml ? `<details class="tablo-gor"><summary>Bahis oranları (yalnızca ölçüm için)</summary><div class="tablo-kaydir"><table class="oran-tablo"><tbody>${oranHtml}</tbody></table></div></details>` : ''}`;
    $('#periyot').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { macPeriyot = b.dataset.p; ciz(); }));
    $('#detay-govde').querySelectorAll('[data-oyuncu]').forEach((t) => t.addEventListener('click', () => oyuncuDetay(+t.dataset.oyuncu)));
  };
  ciz();
  macOncesiTahmin(m).then((r) => {
    const kutu = document.getElementById('mac-tahmin');
    if (!r || !kutu || $('#detay-ad').textContent !== baslik) return;
    kutu.innerHTML = tahminHtml = `<details class="tablo-gor t-detay"><summary><b>Maç öncesi tahminimiz:</b> ${yuz(r.t.p1)} · ${yuz(r.t.px)} · ${yuz(r.t.p2)}</summary>
      <div class="t-ana">${tahminKart(r.t, m.ev_id, m.dep_id, r.model, oranOlasilik(m.oranlar, 'Full time'))}</div></details>`;
  }).catch(() => {});
}

// ---------- Sıralama ----------
async function siralamaGoster() {
  const v = surum;
  yukleniyor();
  let satirlar;
  try {
    const maclar = await sayfali(() => db().from('ss_maclar').select('id').eq('lig_id', durum.lig).eq('sezon', durum.sezon));
    if (!maclar.length) return bos(`${ligAd(durum.lig)} ${durum.sezon} için henüz maç yok.`);
    satirlar = await parcali(maclar.map((m) => m.id), (p) => db().from('ss_oyuncu_mac').select('oyuncu_id,takim_id,mevki,dakika,puan,ist').in('mac_id', p), 100);
  } catch (e) { return guncel(v) && hata(e); }
  if (!guncel(v)) return;
  const st = STATLAR.find((s) => s.k === durum.stat);
  const hepsi = topla(satirlar);
  // Sezon başında kimse 900 dakikaya ulaşmamışsa sınır, en çok oynayanın yarısına iner
  const enCok = Math.max(0, ...hepsi.map((t) => t.dakika));
  const sinir = Math.min(durum.dk, Math.round(enCok / 2));
  const liste = hepsi
    .filter((t) => t.dakika >= sinir && (!durum.mevki || t.mevkiKod === durum.mevki))
    .map((t) => ({ ...t, deger: st.f(t) }))
    .filter((t) => t.deger != null)
    .sort((a, b) => (st.ters ? a.deger - b.deger : b.deger - a.deger))
    .slice(0, 50);
  $('#ozet').innerHTML = '';
  if (!liste.length) return bos('Bu filtrelerle oyuncu yok. "En az dakika" değerini düşürmeyi deneyin.');
  const adlar = await oyuncuAdlari(liste.map((t) => t.id));
  if (!guncel(v)) return;
  const enYuksek = Math.max(...liste.map((t) => Math.abs(t.deger)));
  $('#icerik').innerHTML = `<p class="not">${esc(ligAd(durum.lig))} ${durum.sezon} · ${esc(st.ad)} · en az ${sayi(sinir)} dakika oynayanlar${sinir < durum.dk ? ' (sezon yeni başladığı için sınır düşürüldü)' : ''}. Satıra tıklayınca oyuncu profili açılır.</p>
    <table><thead><tr><th>#</th><th>Oyuncu</th><th>Takım</th><th class="sag">Maç</th><th class="sag">Dakika</th><th class="sag">Ort. puan</th><th class="sag">${esc(st.ad)}</th></tr></thead><tbody>
    ${liste.map((t, i) => `<tr data-oyuncu="${t.id}">
      <td class="sira">${i + 1}</td>
      <td class="ad"><b>${esc(adlar.get(t.id)?.ad || '?')}</b><small>${esc(MEVKI[t.mevkiKod] || '')}${adlar.get(t.id)?.dogum ? ` · ${yas(adlar.get(t.id).dogum)} yaş` : ''}</small></td>
      <td data-k="Takım">${esc(takim(t.takimId))}</td>
      <td data-k="Maç" class="sag">${t.mac}</td>
      <td data-k="Dakika" class="sag">${sayi(t.dakika)}</td>
      <td data-k="Ort. puan" class="sag">${sayi(t.puanN ? t.puanT / t.puanN : null, 2)}</td>
      <td data-k="${esc(st.ad)}" class="sag deger-hucre"><b>${sayi(t.deger, st.b ?? 0)}</b><span class="mini-cubuk"><i style="width:${(100 * Math.abs(t.deger)) / enYuksek}%"></i></span></td>
    </tr>`).join('')}</tbody></table>`;
  $('#icerik').querySelectorAll('[data-oyuncu]').forEach((t) => t.addEventListener('click', () => oyuncuDetay(+t.dataset.oyuncu)));
}

// ---------- Oyuncular ----------
let araZamanlayici;
async function oyuncularGoster() {
  const v = surum;
  $('#ozet').innerHTML = '';
  const q = durum.ara.trim();
  if (q.length < 3) return bos('Aramak için en az 3 harf yazın. Örn. <b>Kerem</b>, <b>Saka</b>, <b>Icardi</b>.');
  yukleniyor();
  const { data, error } = await db().from('ss_oyuncular').select('id,ad,mevki,dogum,ulke,boy').ilike('ad', `%${q}%`).limit(40);
  if (!guncel(v)) return;
  if (error) return hata(error);
  if (!data.length) return bos('Bu isimde oyuncu bulunamadı. Veri çekimi devam ettikçe yeni oyuncular eklenecek.');
  $('#icerik').innerHTML = `<table><thead><tr><th>Oyuncu</th><th>Mevki</th><th>Yaş</th><th>Uyruk</th><th class="sag">Boy</th></tr></thead><tbody>
    ${data.map((o) => `<tr data-oyuncu="${o.id}"><td class="ad"><b>${esc(o.ad)}</b></td><td data-k="Mevki">${esc(MEVKI[o.mevki] || o.mevki || '–')}</td>
      <td data-k="Yaş">${yas(o.dogum) ?? '–'}</td><td data-k="Uyruk">${esc(o.ulke || '–')}</td><td data-k="Boy" class="sag">${o.boy ? `${o.boy} cm` : '–'}</td></tr>`).join('')}</tbody></table>`;
  $('#icerik').querySelectorAll('[data-oyuncu]').forEach((t) => t.addEventListener('click', () => oyuncuDetay(+t.dataset.oyuncu)));
}

const AYAK = { Right: 'Sağ ayak', Left: 'Sol ayak', Both: 'İki ayak' };
async function oyuncuDetay(id) {
  $('#detay-ad').textContent = 'Yükleniyor…';
  $('#detay-govde').innerHTML = '';
  if (!$('#detay').open) $('#detay').showModal();
  try {
    const [{ data: o, error }, satirlar] = await Promise.all([
      db().from('ss_oyuncular').select('*').eq('id', id).single(),
      sayfali(() => db().from('ss_oyuncu_mac').select('mac_id,takim_id,mevki,dakika,puan,ist,yedek').eq('oyuncu_id', id)),
    ]);
    if (error) throw error;
    const maclar = new Map((await parcali(satirlar.map((r) => r.mac_id), (p) => db().from('ss_maclar')
      .select('id,lig_id,sezon,tarih,ev_id,dep_id,ev_gol,dep_gol').in('id', p))).map((m) => [m.id, m]));
    $('#detay-ad').textContent = o.ad;

    // Sezon sezon toplamlar (lig + sezon + takım)
    const gruplar = new Map();
    for (const r of satirlar) {
      const m = maclar.get(r.mac_id);
      if (!m) continue;
      const k = `${m.sezon}|${m.lig_id}|${r.takim_id}`;
      if (!gruplar.has(k)) gruplar.set(k, { sezon: m.sezon, lig: m.lig_id, takimId: r.takim_id, satir: [] });
      gruplar.get(k).satir.push({ ...r, oyuncu_id: id });
    }
    const sezonlar = [...gruplar.values()].sort((a, b) => b.sezon.localeCompare(a.sezon)).map((g) => ({ ...g, t: topla(g.satir)[0] }));
    const kolon = [['puan', 'Ort. puan'], ['gol', 'Gol'], ['asist', 'Asist'], ['calim', 'Çalım/90'], ['ikiliY', 'İkili %'], ['kilit', 'Kilit pas/90'], ['topKapma', 'Top kapma/90'], ['pasY', 'Pas %']]
      .map(([k, ad]) => ({ ...STATLAR.find((s) => s.k === k), kisa: ad }));
    const son = satirlar.map((r) => ({ ...r, m: maclar.get(r.mac_id) })).filter((r) => r.m).sort((a, b) => new Date(b.m.tarih) - new Date(a.m.tarih)).slice(0, 10);

    $('#detay-govde').innerHTML = `
      <div class="etiketler">${[MEVKI[o.mevki], o.dogum && `${yas(o.dogum)} yaş (${tarihAd(o.dogum)})`, o.ulke, o.boy && `${o.boy} cm`, AYAK[o.ayak] || o.ayak]
        .filter(Boolean).map((e) => `<span class="etiket">${esc(e)}</span>`).join('')}</div>
      ${sezonlar.length ? `<h3 class="ara-baslik">Sezonlar</h3><div class="tablo-kaydir"><table><thead><tr><th>Sezon</th><th>Takım</th><th class="sag">Maç</th><th class="sag">Dk</th>${kolon.map((c) => `<th class="sag">${esc(c.kisa)}</th>`).join('')}</tr></thead><tbody>
        ${sezonlar.map((g) => `<tr><td>${g.sezon} <small class="soluk">${esc(ligAd(g.lig))}</small></td><td>${esc(takim(g.takimId))}</td><td class="sag">${g.t.mac}</td><td class="sag">${sayi(g.t.dakika)}</td>
          ${kolon.map((c) => `<td class="sag">${sayi(c.f(g.t), c.b ?? 0)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="not">Yüzdeler yeterli deneme yoksa (ör. 20'den az çalım) boş görünür.</p>` : '<p class="not">Bu oyuncunun çekilmiş maçı yok.</p>'}
      ${son.length ? `<h3 class="ara-baslik">Son maçlar</h3><div class="tablo-kaydir"><table><thead><tr><th>Tarih</th><th>Maç</th><th class="sag">Dk</th><th class="sag">Puan</th><th class="sag">G/A</th><th class="sag">Çalım</th><th class="sag">İkili</th></tr></thead><tbody>
        ${son.map((r) => `<tr data-mac="${r.mac_id}"><td>${esc(tarihAd(r.m.tarih))}</td><td>${esc(takim(r.m.ev_id))} ${r.m.ev_gol}-${r.m.dep_gol} ${esc(takim(r.m.dep_id))}</td>
          <td class="sag">${r.dakika}${r.yedek ? '<small>*</small>' : ''}</td><td class="sag"><span class="puan ${r.puan >= 7.5 ? 'iyi' : r.puan < 6.3 ? 'kotu' : ''}">${sayi(r.puan, 1)}</span></td>
          <td class="sag">${ist(r, 'goals')}/${ist(r, 'goalAssist')}</td><td class="sag">${ist(r, 'wonContest')}/${ist(r, 'totalContest')}</td>
          <td class="sag">${ist(r, 'duelWon')}/${ist(r, 'duelWon') + ist(r, 'duelLost')}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
    $('#detay-govde').querySelectorAll('[data-mac]').forEach((t) => t.addEventListener('click', () => macDetay(+t.dataset.mac)));
  } catch (e) {
    $('#detay-govde').innerHTML = `<div class="bilgi">Yüklenemedi: ${esc(e.message)}</div>`;
  }
}

// ---------- Çekim durumu ----------
async function durumGoster() {
  const v = surum;
  yukleniyor();
  const say = async (tablo, f = (q) => q) => {
    const { count, error } = await f(db().from(tablo).select('*', { count: 'exact', head: true }));
    if (error) throw error;
    return count;
  };
  try {
    const [toplamMac, toplamOyuncu, satir, sonMac, ...hucre] = await Promise.all([
      say('ss_maclar'), say('ss_oyuncular'), say('ss_oyuncu_mac'),
      db().from('ss_maclar').select('cekildi,lig_id,sezon').order('cekildi', { ascending: false }).limit(1),
      ...LIGLER.flatMap((l) => SEZONLAR.map((s) => say('ss_maclar', (q) => q.eq('lig_id', l.id).eq('sezon', s)))),
    ]);
    if (!guncel(v)) return;
    const son = sonMac.data?.[0];
    $('#ozet').innerHTML = [
      ['Çekilen maç', sayi(toplamMac)],
      ['Oyuncu', sayi(toplamOyuncu)],
      ['Oyuncu-maç satırı', sayi(satir)],
      ['Son çekilen', son ? `${new Date(son.cekildi).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })} <small class="soluk">${esc(ligAd(son.lig_id))} ${son.sezon}</small>` : '–'],
    ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');
    const beklenen = (lig, s) => (lig === 17 ? 380 : 306);
    $('#icerik').innerHTML = `<p class="not">Her hücre o lig ve sezonda çekilmiş maç sayısı. Süper Lig ve Eredivisie'de sezona göre maç sayısı değişir; tamamlanan sezonlar yeşil görünür.
      Sayfa her 60 saniyede bir yenilenir.</p>
      <div class="tablo-kaydir"><table class="durum-tablo"><thead><tr><th>Sezon</th>${LIGLER.map((l) => `<th class="sag">${esc(l.ad)}</th>`).join('')}</tr></thead><tbody>
      ${SEZONLAR.map((s, si) => `<tr><td>${s}</td>${LIGLER.map((l, li) => {
        const n = hucre[li * SEZONLAR.length + si];
        return `<td class="sag ${n >= beklenen(l.id, s) * 0.95 && si > 0 ? 'tamam' : n ? 'suruyor' : ''}">${n ? sayi(n) : '<span class="soluk">–</span>'}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>`;
  } catch (e) { return guncel(v) && hata(e); }
}

// ---------- Görünüm ----------
let yenile;
async function goster() {
  surum++;
  clearInterval(yenile);
  document.querySelectorAll('.sekme').forEach((b) => b.classList.toggle('aktif', b.dataset.gorunum === durum.gorunum));
  seciciler();
  $('#sezon').value = durum.sezon;
  $('#stat').value = durum.stat;
  if (durum.gorunum === 'maclar') return maclarGoster();
  if (durum.gorunum === 'siralama') return siralamaGoster();
  if (durum.gorunum === 'oyuncular') return oyuncularGoster();
  if (durum.gorunum === 'tahmin') return tahminGoster();
  if (durum.gorunum === 'analiz') return analizGoster();
  if (durum.gorunum === 'kupon') return kuponGoster();
  yenile = setInterval(() => { if (durum.gorunum === 'durum' && !document.hidden) { surum++; durumGoster(); } }, 60000);
  return durumGoster();
}

document.querySelectorAll('.sekme').forEach((b) => b.addEventListener('click', () => { durum.gorunum = b.dataset.gorunum; goster(); }));
$('#lig').addEventListener('change', (e) => { durum.lig = +e.target.value; durum.hafta = null; goster(); });
$('#sezon').addEventListener('change', (e) => { durum.sezon = e.target.value; durum.hafta = null; goster(); });
$('#hafta').addEventListener('change', (e) => { durum.hafta = +e.target.value; goster(); });
$('#stat').addEventListener('change', (e) => { durum.stat = e.target.value; goster(); });
$('#mevki').addEventListener('change', (e) => { durum.mevki = e.target.value; goster(); });
$('#dk').addEventListener('change', (e) => { durum.dk = +e.target.value; goster(); });
$('#ara').addEventListener('input', (e) => { durum.ara = e.target.value; clearTimeout(araZamanlayici); araZamanlayici = setTimeout(goster, 300); });
$('#ev').addEventListener('change', (e) => { durum.ev = +e.target.value; goster(); });
$('#dep').addEventListener('change', (e) => { durum.dep = +e.target.value; goster(); });
$('#hakem').addEventListener('change', (e) => { durum.hakem = e.target.value ? +e.target.value : ''; goster(); });
$('#lig').addEventListener('change', () => { durum.ev = durum.dep = null; durum.hakem = ''; });
$('#detay-kapat').addEventListener('click', () => $('#detay').close());
$('#detay').addEventListener('click', (e) => { if (e.target === $('#detay')) $('#detay').close(); });

(async () => {
  try {
    const [t, a] = await Promise.all([
      sayfali(() => db().from('ss_takimlar').select('id,ad,kisa_ad')),
      sayfali(() => db().from('ss_anahtarlar').select('sira,anahtar')),
    ]);
    takimlar = new Map(t.map((r) => [r.id, r]));
    anahtar = new Map(a.map((r) => [r.anahtar, r.sira - 1]));
  } catch (e) { return hata(e); }
  goster();
})();

// ---------- Tahmin ----------
// Lig verisi bir kez yüklenir (hafif sütunlar), model tarayıcıda kurulur.
const ligVeri = new Map();
const VERI_SUTUN = 'id,sezon,tarih,ev_id,dep_id,ev_gol,dep_gol,hakem,xg:istatistik->ALL->expectedGoals,kor:istatistik->ALL->cornerKicks,sari:istatistik->ALL->yellowCards,kir:istatistik->ALL->redCards';
function ligYukle(lig) {
  if (!ligVeri.has(lig)) {
    ligVeri.set(lig, sayfali(() => db().from('ss_maclar').select(VERI_SUTUN).eq('lig_id', lig).neq('sezon', '99/00').order('tarih'))
      .catch((e) => { ligVeri.delete(lig); throw e; }));
  }
  return ligVeri.get(lig);
}
// Yeni model katsayıları (scout/analiz/model_egit.py); bir lig için yoksa mevcut model kullanılır
let katsayiSoz = null;
const katsayiYukle = () => (katsayiSoz ||= fetch('veri/scout_model_katsayi.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})));

/** Mevcut modelin tahminine yeni modelin 1-X-2 olasılıklarını ekler; temel olasılıklar t.temel'de kalır. */
function yeniyleBirlestir(t, form, k, evId, depId) {
  if (!k) return t;
  const p = yeniOlasilik(yeniOzellik(t, form, evId, depId), k);
  return { ...t, ...p, temel: { p1: t.p1, px: t.px, p2: t.p2 } };
}

const yuz = (p) => `%${sayi(100 * p)}`;
const GUC = (x) => sayi(100 * x);

function tahminKart(t, evId, depId, model, oran = null) {
  const cubuk = `<div class="t-cubuk"><i class="ev" style="width:${100 * t.p1}%"></i><i class="ber" style="width:${100 * t.px}%"></i><i class="dep" style="width:${100 * t.p2}%"></i></div>`;
  const ikili = (ad, p) => `<div class="t-satir"><span>${esc(ad)}</span><b>${yuz(p)}</b><span class="mini-cubuk"><i style="width:${100 * p}%"></i></span></div>`;
  const kc = Math.round(t.korner.toplam) - 0.5, kk = Math.round(t.kart.toplam) - 0.5;
  return `
    <div class="t-ust">
      <div><small class="soluk">Ev sahibi</small><b>${esc(takim(evId))}</b><span class="t-yuzde ev">${yuz(t.p1)}</span></div>
      <div class="orta"><small class="soluk">Beraberlik</small><span class="t-yuzde ber">${yuz(t.px)}</span></div>
      <div class="sag"><small class="soluk">Deplasman</small><b>${esc(takim(depId))}</b><span class="t-yuzde dep">${yuz(t.p2)}</span></div>
    </div>
    ${cubuk}
    ${t.temel ? `<p class="not">Yeni model (mevcut model + son maçlardaki xG formu). Yalnızca mevcut model: ${yuz(t.temel.p1)} · ${yuz(t.temel.px)} · ${yuz(t.temel.p2)}.
      Gol, korner ve kart tahminleri mevcut modelden.</p>` : ''}
    ${oran ? `<p class="not">Bahis piyasası: ${yuz(oran['1'])} · ${yuz(oran.X)} · ${yuz(oran['2'])} (yalnızca karşılaştırma için)</p>` : ''}
    <div class="iki-sutun t-izgara">
      <div class="kesfet-kart">
        <h3>Goller</h3>
        <p class="not">Beklenen skor ${sayi(t.lEv, 1)} – ${sayi(t.lDep, 1)}</p>
        ${ikili('Karşılıklı gol', t.kg)}${ikili('1,5 üst', t.ust[1.5])}${ikili('2,5 üst', t.ust[2.5])}${ikili('3,5 üst', t.ust[3.5])}
        <div class="etiketler t-skorlar">${t.skorlar.map((s) => `<span class="etiket">${s.ev}-${s.dep} <small class="soluk">${yuz(s.p)}</small></span>`).join('')}</div>
      </div>
      <div class="kesfet-kart">
        <h3>Korner ve kart</h3>
        <p class="not">Beklenen korner ${sayi(t.korner.ev, 1)} – ${sayi(t.korner.dep, 1)} (toplam ${sayi(t.korner.toplam, 1)})</p>
        ${[kc - 1, kc, kc + 1].map((c) => ikili(`${sayi(c, 1)} üst korner`, t.korner.ust(c))).join('')}
        <p class="not">Beklenen kart ${sayi(t.kart.ev, 1)} – ${sayi(t.kart.dep, 1)} (toplam ${sayi(t.kart.toplam, 1)})${t.kart.hakem !== 1 ? ` · hakem etkisi ×${sayi(t.kart.hakem, 2)}` : ''}</p>
        ${[kk - 1, kk, kk + 1].filter((c) => c > 0).map((c) => ikili(`${sayi(c, 1)} üst kart`, t.kart.ust(c))).join('')}
      </div>
    </div>
    ${model ? `<p class="not">Güç (lig ortalaması 100, yüksek olan iyi): ${esc(takim(evId))} hücum ${GUC(model.gol.hucum(evId))}, savunma ${GUC(1 / model.gol.savunma(evId))} ·
      ${esc(takim(depId))} hücum ${GUC(model.gol.hucum(depId))}, savunma ${GUC(1 / model.gol.savunma(depId))}${model.yeni(evId) || model.yeni(depId) ? ' · lige yeni gelen takımın verisi az, tahmin daha belirsiz' : ''}.</p>` : ''}`;
}

async function tahminGoster() {
  const v = surum;
  yukleniyor();
  $('#ozet').innerHTML = '';
  let maclar;
  try { maclar = await ligYukle(durum.lig); } catch (e) { return guncel(v) && hata(e); }
  if (!guncel(v)) return;
  if (maclar.length < 60) return bos(`${ligAd(durum.lig)} için henüz yeterli maç yok (${maclar.length}). Tahmin için en az 60 maç gerekiyor; veri çekimi bu lige gelince burada görünecek.`);
  const simdi = Date.now();
  const son = new Date(maclar[maclar.length - 1].tarih).getTime();
  // Yaklaşan maçlar (fikstür tablosu yoksa liste boş kalır)
  const oynanan = new Set(maclar.map((m) => m.id));
  const { data: fikRaw } = await db().from('ss_fikstur').select('*').eq('lig_id', durum.lig)
    .gte('tarih', new Date(simdi - 3 * 3600000).toISOString()).order('tarih').limit(30);
  if (!guncel(v)) return;
  const fikstur = (fikRaw || []).filter((f) => !oynanan.has(f.id) && f.durum !== 'canceled');
  for (const f of fikstur) for (const [id, ad] of [[f.ev_id, f.ev_ad], [f.dep_id, f.dep_ad]]) if (!takimlar.has(id)) takimlar.set(id, { id, ad });
  if (durum.ev == null && fikstur[0]) Object.assign(durum, { ev: fikstur[0].ev_id, dep: fikstur[0].dep_id, hakem: fikstur[0].hakem?.id ?? '' });
  const guncelTakim = [...new Set([...maclar.filter((m) => son - new Date(m.tarih) < 200 * 86400000).flatMap((m) => [m.ev_id, m.dep_id]),
    ...fikstur.flatMap((f) => [f.ev_id, f.dep_id])])]
    .sort((a, b) => takim(a).localeCompare(takim(b), 'tr'));
  if (!guncelTakim.includes(durum.ev)) durum.ev = guncelTakim[0];
  if (!guncelTakim.includes(durum.dep) || durum.dep === durum.ev) durum.dep = guncelTakim.find((t) => t !== durum.ev);
  const hakemler = [...new Map(maclar.filter((m) => m.hakem && son - new Date(m.tarih) < 400 * 86400000).map((m) => [m.hakem.id, m.hakem.ad])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1], 'tr'));
  for (const f of fikstur) if (f.hakem && !hakemler.some(([id]) => id === f.hakem.id)) hakemler.push([f.hakem.id, f.hakem.ad]);
  const sec = (id, liste, deger) => { $(id).innerHTML = liste; $(id).value = deger ?? ''; };
  const takimSec = guncelTakim.map((t) => `<option value="${t}">${esc(takim(t))}</option>`).join('');
  sec('#ev', takimSec, durum.ev);
  sec('#dep', takimSec, durum.dep);
  sec('#hakem', `<option value="">Bilinmiyor</option>${hakemler.map(([id, ad]) => `<option value="${id}">${esc(ad)}</option>`).join('')}`, durum.hakem);

  const model = modelKur(maclar, simdi);
  const form = xgFormu(maclar, simdi);
  const kat = (await katsayiYukle())[durum.lig];
  if (!guncel(v)) return;
  const tahminEt = (ev, dep, hakemId) => yeniyleBirlestir(model.tahmin(ev, dep, { hakemId }), form, kat, ev, dep);
  const t = tahminEt(durum.ev, durum.dep, durum.hakem || null);
  const fikHtml = fikstur.length ? `<h2 class="kesfet-baslik">Yaklaşan maçlar</h2><div class="mac-liste t-fikstur">${fikstur.map((f) => {
    const p = tahminEt(f.ev_id, f.dep_id, f.hakem?.id);
    const secili = f.ev_id === durum.ev && f.dep_id === durum.dep;
    return `<button class="mac ${secili ? 'secili' : ''}" data-fik="${f.id}">
      <span class="mac-zaman">${esc(tarihAd(f.tarih))}<small>${esc(saatAd(f.tarih))}${f.durum === 'postponed' ? ' · ertelendi' : ''}</small></span>
      <span class="mac-takim ev">${esc(f.ev_ad)}</span>
      <span class="mac-skor t-mini"><span class="ev">${sayi(100 * p.p1)}</span>·<span class="ber">${sayi(100 * p.px)}</span>·<span class="dep">${sayi(100 * p.p2)}</span><small>%</small></span>
      <span class="mac-takim dep">${esc(f.dep_ad)}</span></button>`;
  }).join('')}</div>` : '<p class="not">Yaklaşan maç listesi için çekim kodunun yeni sürümü ve <code>fikstur.sql</code> gerekiyor. Şimdilik takımları yukarıdan seçebilirsiniz.</p>';
  $('#icerik').innerHTML = `
    <h2 class="kesfet-baslik">Seçili maç</h2>
    <div class="kesfet-kart genis t-ana">${durum.ev === durum.dep ? '<p class="not">İki farklı takım seçin.</p>' : tahminKart(t, durum.ev, durum.dep, model)}</div>
    <p class="not">Model ${sayi(model.macSayisi)} maçtan öğrendi (yakın tarihli maçlar daha ağır basar). Ev sahibi avantajı ×${sayi(model.gol.ev, 2)}.
      Bu yüzdeler tahmindir, kesinlik değildir.</p>
    ${fikHtml}
    <h2 class="kesfet-baslik">Karne <small class="soluk">— geçmiş maçlarda ne kadar isabetliydik?</small></h2>
    ${kat ? `<p class="not"><b>Yeni modelin dürüst sınaması</b> (${sayi(kat.sinama.mac)} maç, her sezon önceki sezonlarla eğitilip sınandı):
      maç sonucu isabeti %${sayi(100 * kat.sinama.yeni_isabet, 1)}, mevcut model %${sayi(100 * kat.sinama.temel_isabet, 1)}.
      Aşağıdaki karne mevcut modele aittir; ayrıntılar Analiz → Tahmin laboratuvarı'nda.</p>` : ''}
    <div id="karne"><div class="bilgi">Hesaplanıyor…</div></div>`;
  $('#icerik').querySelectorAll('[data-fik]').forEach((b) => b.addEventListener('click', () => {
    const f = fikstur.find((x) => x.id === +b.dataset.fik);
    Object.assign(durum, { ev: f.ev_id, dep: f.dep_id, hakem: f.hakem?.id ?? '' });
    goster().then(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  }));
  setTimeout(() => karneGoster(v, maclar), 30);
}

async function karneGoster(v, maclar) {
  // Son 1 yılın maçları, her biri yalnızca kendinden önceki verilerle tahmin edilir
  const son = new Date(maclar[maclar.length - 1].tarih).getTime();
  const baslangic = son - 365 * 86400000;
  const sonuclar = geriTest(maclar, { baslangic });
  if (!guncel(v)) return;
  // Bahis oranları yalnızca karşılaştırma için, sadece sınanan maçlar için çekilir
  let oranlar = new Map();
  try {
    const sat = await parcali(sonuclar.map((s) => s.mac.id), (p) => db().from('ss_maclar').select('id,oranlar').in('id', p), 150);
    oranlar = new Map(sat.map((r) => [r.id, r.oranlar]));
  } catch { /* oranlar olmadan da karne çıkar */ }
  if (!guncel(v)) return;
  for (const s of sonuclar) s.mac = { ...s.mac, oranlar: oranlar.get(s.mac.id) };
  const k = karne(sonuclar);
  if (!k.n) { $('#karne').innerHTML = '<div class="bilgi">Karne için henüz yeterli geçmiş maç yok.</div>'; return; }
  const f = (x, n) => (n ? sayi(x / n, 3) : '–');
  const satir = (ad, biz, pi, n) => `<tr><td>${esc(ad)}</td><td class="sag">${f(biz, n)}</td><td class="sag">${f(pi, n)}</td><td class="sag">${n ? (biz <= pi ? '✅ biz' : `piyasa (${sayi((100 * (biz - pi)) / pi, 1)}% fark)`) : '–'}</td><td class="sag soluk">${sayi(n)}</td></tr>`;
  const sonMaclar = sonuclar.slice(-15).reverse();
  $('#karne').innerHTML = `
    <section class="ozet">
      ${[['Sınanan maç', sayi(k.n)], ['Bizim isabet (1-X-2)', `%${sayi((100 * k.dogru) / k.n)}`], ['Piyasanın isabeti', k.oranN ? `%${sayi((100 * k.oranDogru) / k.oranN)}` : '–'],
        ['Rastgele tahmin', '%33']].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('')}
    </section>
    <p class="not">Brier puanı tahminin ne kadar isabetli olduğunu ölçer: <b>küçük olan iyi</b>. "Piyasa" bahis şirketlerinin oranlarından çıkan olasılık; dünyanın en iyi tahminlerinden biri, onu yakalamak hedefimiz.</p>
    <div class="tablo-kaydir"><table><thead><tr><th>Tahmin</th><th class="sag">Biz</th><th class="sag">Piyasa</th><th class="sag">Daha iyi</th><th class="sag">Maç</th></tr></thead><tbody>
      ${satir('Maç sonucu (1-X-2)', k.bizimOranli, k.oranBrier, k.oranN)}
      ${satir('Karşılıklı gol', k.kg[0], k.kg[1], k.kg[2])}
      ${satir('2,5 üst / alt', k.ust[0], k.ust[1], k.ust[2])}
      ${satir('Korner üst / alt', k.kor[0], k.kor[1], k.kor[2])}
      ${satir('Kart üst / alt', k.kart[0], k.kart[1], k.kart[2])}
    </tbody></table></div>
    <h3 class="ara-baslik">Dediğimiz oldu mu?</h3>
    <p class="not">Bir sonuca örneğin %60 dediğimiz maçlarda o sonuç gerçekten yaklaşık %60 oranında çıktıysa yüzdelerimize güvenilebilir.</p>
    <div class="tablo-kaydir"><table><thead><tr><th>Dediğimiz</th><th class="sag">Gerçekleşen</th><th class="sag">Tahmin sayısı</th></tr></thead><tbody>
      ${k.kalibre.map((c) => `<tr><td>${yuz(c.ort)}</td><td class="sag"><b>${yuz(c.gercek)}</b></td><td class="sag soluk">${sayi(c.n)}</td></tr>`).join('')}
    </tbody></table></div>
    <h3 class="ara-baslik">Son maçlar: tahminimiz ve sonuç</h3>
    <div class="tablo-kaydir"><table><thead><tr><th>Maç</th><th class="sag">Skor</th><th class="sag">Biz (1 · X · 2)</th><th class="sag">Piyasa</th></tr></thead><tbody>
      ${sonMaclar.map(({ mac: m, tahmin: t }) => {
        const g = m.ev_gol > m.dep_gol ? 0 : m.ev_gol === m.dep_gol ? 1 : 2;
        const p = [t.p1, t.px, t.p2], en = p.indexOf(Math.max(...p));
        const o = oranOlasilik(m.oranlar, 'Full time');
        return `<tr data-mac="${m.id}"><td>${esc(takim(m.ev_id))} – ${esc(takim(m.dep_id))} <small class="soluk">${esc(tarihAd(m.tarih))}</small></td>
          <td class="sag"><b>${m.ev_gol}-${m.dep_gol}</b></td>
          <td class="sag">${p.map((x, i) => `<span class="${i === g ? 'oldu' : ''}">${sayi(100 * x)}</span>`).join(' · ')} ${en === g ? '✅' : '❌'}</td>
          <td class="sag soluk">${o ? [o['1'], o.X, o['2']].map((x) => sayi(100 * x)).join(' · ') : '–'}</td></tr>`;
      }).join('')}
    </tbody></table></div>`;
  $('#karne').querySelectorAll('[data-mac]').forEach((t) => t.addEventListener('click', () => macDetay(+t.dataset.mac)));
}

// Maç detayında: maçtan önce ne demiştik?
async function macOncesiTahmin(m) {
  const maclar = await ligYukle(m.lig_id);
  const simdi = new Date(m.tarih.slice(0, 10) + 'T00:00:00Z').getTime();
  if (maclar.filter((x) => new Date(x.tarih).getTime() < simdi).length < 60) return null;
  const model = modelKur(maclar, simdi);
  const kat = (await katsayiYukle())[m.lig_id];
  const t = yeniyleBirlestir(model.tahmin(m.ev_id, m.dep_id, { hakemId: m.hakem?.id }), xgFormu(maclar, simdi), kat, m.ev_id, m.dep_id);
  return { t, model };
}

// ---------- Analiz (bilgi tablosu) ----------
// İçerik scout/analiz/pl_analiz.py ile hesaplanıp veri/scout_pl_analiz.json'a yazılır; burada yalnızca gösterilir.
let analizVeri = null;
const sayiBicim = (v) => (typeof v === 'number' ? v.toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : esc(v ?? '–'));

function analizBlok(b) {
  if (b.tur === 'baslik') return `<h3 class="ara-baslik a-alt">${esc(b.metin)}</h3>`;
  if (b.tur === 'istatistik') {
    return `<section class="ozet a-ist">${b.ogeler.map((o) => `<div class="stat"><b>${esc(o.deger)}</b><span>${esc(o.etiket)}</span></div>`).join('')}</section>`;
  }
  const bas = `${b.baslik ? `<h3 class="ara-baslik">${esc(b.baslik)}</h3>` : ''}${b.not ? `<p class="not">${esc(b.not)}</p>` : ''}`;
  if (b.tur === 'tablo') {
    const say = new Set(b.sayisal || []);
    return `${bas}<div class="tablo-kaydir"><table><thead><tr>${b.sutunlar.map((c, i) => `<th class="${say.has(i) ? 'sag' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${b.satirlar.map((r) => `<tr>${r.map((c, i) => `<td class="${say.has(i) ? 'sag' : ''}">${i === 0 ? `<b>${sayiBicim(c)}</b>` : sayiBicim(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (b.tur === 'cubuk') {
    const degerler = b.ogeler.map((o) => o.deger ?? 0);
    const [enAz, enCok] = b.aralik || [Math.min(0, ...degerler), Math.max(...degerler)];
    const iki = enAz < 0; // iki yönlü (olumlu/olumsuz) çubuk: sıfır ortada
    const olcek = (v) => (100 * (v - enAz)) / (enCok - enAz || 1);
    const sifir = iki ? olcek(0) : 0;
    return `${bas}<ul class="a-cubuklar">${b.ogeler.map((o) => {
      const v = o.deger ?? 0;
      const sol = iki ? Math.min(sifir, olcek(v)) : 0;
      const gen = iki ? Math.abs(olcek(v) - sifir) : olcek(Math.max(v, enAz));
      return `<li title="${esc(`${o.ad}: ${sayiBicim(v)}${b.birim || ''}${o.alt ? ` · ${o.alt}` : ''}`)}">
        <div class="cl-ust"><b>${esc(o.ad)}</b><span class="cl-deger">${sayiBicim(v)}${esc(b.birim || '')}</span></div>
        <div class="a-iz${iki ? ' iki' : ''}" style="--sifir:${sifir}%"><i class="${o.ton === 'negatif' ? 'neg' : ''}" style="left:${sol}%;width:${Math.max(gen, 0.6)}%"></i></div>
        ${o.alt ? `<small>${esc(o.alt)}</small>` : ''}</li>`;
    }).join('')}</ul>`;
  }
  return '';
}

async function analizGoster() {
  const v = surum;
  yukleniyor();
  try {
    if (!analizVeri) {
      const al = (u) => fetch(u, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
      const [a, lab, ara] = await Promise.all([al('veri/scout_pl_analiz.json'), al('veri/scout_model_lab.json').catch(() => null),
        al('veri/scout_arastirma.json').catch(() => null)]);
      // Tahmin laboratuvarı (model_lab.py) ve kazanç araştırması (arastirma.py) ayrı dosyalarda; lig özetinin hemen ardından gösterilir
      a.bolumler.splice(1, 0, ...(ara?.bolumler || []), ...(lab?.bolumler || []));
      analizVeri = a;
    }
  } catch (e) { return guncel(v) && bos(`Analiz yüklenemedi: ${esc(e.message)}`); }
  if (!guncel(v)) return;
  const a = analizVeri;
  $('#ozet').innerHTML = [
    ['İncelenen maç', sayi(a.mac)], ['Takım-sezon', sayi(a.takim_sezon)], ['Oyuncu-sezon', sayi(a.oyuncu_sezon)],
    ['Sezonlar', `${esc(a.sezonlar[0])} – ${esc(a.sezonlar[a.sezonlar.length - 1])}`],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');
  $('#icerik').innerHTML = `
    <p class="not">${esc(a.lig)} bilgi tablosu · ${esc(new Date(a.olusturuldu).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' }))} tarihli veriyle hesaplandı.
      Veri çekimi ilerledikçe (eski sezonlar, diğer ligler) yeniden hesaplanacak.</p>
    <nav class="a-icindekiler">${a.bolumler.map((b) => `<a href="#a-${b.id}" data-git="a-${b.id}">${b.ikon} ${esc(b.baslik.split(':')[0])}</a>`).join('')}</nav>
    ${a.bolumler.map((b) => `
      <section class="kesfet-kart genis a-bolum" id="a-${b.id}">
        <h2 class="kesfet-baslik">${b.ikon} ${esc(b.baslik)}</h2>
        <p class="a-sonuc">${esc(b.ozet)}</p>
        ${b.bloklar.map(analizBlok).join('')}
      </section>`).join('')}
    <details class="tablo-gor"><summary>Yöntem</summary><p class="not">${esc(a.yontem)}</p></details>`;
  $('#icerik').querySelectorAll('[data-git]').forEach((l) => l.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(l.dataset.git)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

// ---------- Kupon simülatörü (geçmiş maçlarda) ----------
// Model olasılıkları maç oynanmadan önceki bilgilerle üretildi (scout/analiz/kupon_veri.py); sonuçlar sonradan açılır.
// Her seçenek: [ad, model olasılığı, piyasa olasılığı (kapanış), açılış oranı, kapanış oranı, tuttu]
let kuponVeri = null;
let formulVeri = null;   // scout/analiz/arastirma.py: gol pazarlarında P(üst), yalnızca dürüst (görmeden) tahminler
const KUPON_PAZAR = [['ms', 'Maç sonucu'], ['cs', 'Çifte şans'], ['iy', 'İlk yarı'], ['gol', 'Gol alt/üst'], ['kg', 'Karşılıklı gol'],
  ['korner', 'Korner'], ['kart', 'Kart'], ['ilkgol', 'İlk golü atan']];
const STRATEJI = {
  formul: '💰 Araştırmanın formülü (gol alt/üst, açılış oranı, %10+ değer)',
  birlesik: 'En yüksek tutma ihtimali (model + oranlar)',
  favori: 'Modelin favorileri',
  deger: 'Değerli seçimler (model × oran)',
  rastgele: 'Rastgele (kıyas için)',
};
const kuponAyar = { para: 100, tip: 'sayi', sayi: 3, hedef: 5, strateji: 'birlesik', pazarlar: new Set(KUPON_PAZAR.map(([k]) => k)), oran: 1, enAz: 1.3 };
let sonKupon = null;
const tl = (x) => `${Number(x).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} TL`;

function haftaAnahtari(t) {
  const d = new Date(t + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Bir maçın seçilen pazarlardaki seçenekleri. pm: seçilen oran türünden, şirket payı çıkarılmış olasılık. */
function secenekler(m, pazarlar, oranTur, enAz = 1, formul = false) {
  const out = [];
  const fm = formulVeri?.maclar?.[m.id];
  for (const [kat, pazarAd, sec] of m.pz) {
    if (formul ? !(kat === 'gol' && fm?.[pazarAd] != null) : !pazarlar.has(kat)) continue;
    const o = sec.map((s) => s[3 + oranTur]);
    const ters = o.reduce((a, x) => a + 1 / x, 0) / (kat === 'cs' ? 2 : 1);   // çifte şans seçenekleri örtüşür
    sec.forEach((s, i) => out.push({ ad: s[0], pazar: pazarAd, p: s[1], pm: 1 / o[i] / ters, o: o[i], tuttu: !!s[5],
      pf: formul ? (i === 0 ? fm[pazarAd] : 1 - fm[pazarAd]) : null }));
  }
  return out.filter((x) => x.o > 1 && (formul || x.o >= enAz));
}

const puanla = (s, str) => (str === 'formul' ? s.pf * s.o - 1 : str === 'birlesik' ? (s.p + s.pm) / 2 : str === 'deger' ? s.p * s.o : s.p);

/** Bir haftadan kupon kurar. */
function haftaKuponu(hafta, ayar, rnd = Math.random) {
  const adaylar = [];
  const formul = ayar.strateji === 'formul';
  for (const m of hafta.maclar) {
    // Formül açılış oranlarıyla kuruldu; yalnızca en az %10 değer gördüğü gol alt/üst seçimleri oynanır
    let ss = secenekler(m, ayar.pazarlar, formul ? 0 : ayar.oran, ayar.enAz, formul);
    if (formul) ss = ss.filter((x) => puanla(x, 'formul') >= (formulVeri?.esik ?? 0.1));
    if (!ss.length) continue;
    // Formül kuponda: değer gördüğü seçimler arasından en olasıyı alır (uç oranlar kuponu piyangoya çevirmesin)
    const olcut = (x) => (formul ? x.pf : puanla(x, ayar.strateji));
    const sec = ayar.strateji === 'rastgele' ? ss[Math.floor(rnd() * ss.length)] : ss.reduce((a, b) => (olcut(b) > olcut(a) ? b : a));
    adaylar.push({ m, sec, puan: ayar.strateji === 'rastgele' ? rnd() : olcut(sec) });
  }
  adaylar.sort((a, b) => b.puan - a.puan);
  if (ayar.tip === 'sayi' && adaylar.length < ayar.sayi) return null;
  const secilen = [];
  let oran = 1;
  for (const a of adaylar) {
    if (ayar.tip === 'sayi' ? secilen.length >= ayar.sayi : oran >= ayar.hedef) break;
    secilen.push(a);
    oran *= a.sec.o;
  }
  if (!secilen.length) return null;
  const tuttu = secilen.every((a) => a.sec.tuttu);
  const sansi = secilen.reduce((x, a) => x * (formul ? a.sec.pf : (a.sec.p + a.sec.pm) / 2), 1);
  return { hafta: hafta.anahtar, secilen, oran, sansi, tuttu, kazanc: tuttu ? ayar.para * oran : 0 };
}

function kuponHaftalari() {
  const h = new Map();
  for (const m of kuponVeri.maclar) {
    const k = haftaAnahtari(m.t);
    if (!h.has(k)) h.set(k, { anahtar: k, maclar: [] });
    h.get(k).maclar.push(m);
  }
  return [...h.values()];
}
const trHafta = (k) => new Date(k + 'T12:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });

function kuponCiz(k, acik) {
  if (!k) {
    return kuponAyar.strateji === 'formul'
      ? '<div class="bilgi">Formül, bu maç sayısı için yeterli değerli seçim bulamadı. Formül haftada genelde birkaç bahis önerir; maç sayısını 1–2 yapın.</div>'
      : '<div class="bilgi">Bu ayarlarla kupon kurulamadı. Maç sayısını düşürün ya da daha çok pazar seçin.</div>';
  }
  const satir = (a, i) => {
    const m = a.m;
    const acildi = acik > i;
    return `<div class="k-satir ${acildi ? (a.sec.tuttu ? 'tuttu' : 'yatti') : ''}">
      <div class="k-mac"><b>${esc(m.e)} – ${esc(m.d)}</b><small>${esc(tarihAd(m.t))}</small></div>
      <div class="k-sec"><span class="etiket">${esc(a.sec.ad)}</span><small>${esc(a.sec.pazar)} · ${a.sec.pf != null ? `formül %${sayi(100 * a.sec.pf)} · değer +%${sayi(100 * (a.sec.pf * a.sec.o - 1))}` : `model %${sayi(100 * a.sec.p)}`} · oranlara göre %${sayi(100 * a.sec.pm)}</small></div>
      <div class="k-oran">${sayi(a.sec.o, 2)}</div>
      <div class="k-sonuc">${acildi ? `<b>${m.g[0]}–${m.g[1]}</b> ${a.sec.tuttu ? '✅' : '❌'}` : '<span class="soluk">?</span>'}</div>
    </div>`;
  };
  const bitti = acik >= k.secilen.length;
  return `<div class="kesfet-kart genis k-kupon">
    <div class="k-ust"><b>${esc(trHafta(k.hafta))} haftasından ${k.secilen.length} maçlık kupon</b><span class="soluk">${esc(STRATEJI[kuponAyar.strateji])} · ${kuponAyar.oran && kuponAyar.strateji !== 'formul' ? 'maç saatindeki oranlar' : 'açılış oranları'}</span></div>
    ${k.secilen.map(satir).join('')}
    <div class="k-alt">
      <div><small class="soluk">Toplam oran</small><b>${sayi(k.oran, 2)}</b></div>
      <div><small class="soluk">Tahmini tutma ihtimali</small><b>%${sayi(100 * k.sansi, 1)}</b></div>
      <div><small class="soluk">Bahis</small><b>${tl(kuponAyar.para)}</b></div>
      <div><small class="soluk">Olası kazanç</small><b>${tl(kuponAyar.para * k.oran)}</b></div>
    </div>
    ${bitti ? `<div class="k-karar ${k.tuttu ? 'tuttu' : 'yatti'}">${k.tuttu ? `🎉 Kupon tuttu! ${tl(k.kazanc)} kazandın (net +${tl(k.kazanc - kuponAyar.para)})` : `Kupon yattı. ${tl(kuponAyar.para)} kaybettin.`}</div>`
      : `<button class="k-buton" id="k-goster">Sonucu göster</button>`}
  </div>`;
}

/** Bütün haftalarda (her hafta bir kupon) dener; rastgele strateji 20 kez tekrarlanıp ortalanır. */
function haftalardaDene(ayar, haftalar, strateji) {
  const tekrar = strateji === 'rastgele' ? 20 : 1;
  let n = 0, yat = 0, don = 0, tut = 0, sans = 0, oranT = 0;
  for (let r = 0; r < tekrar; r++) {
    for (const h of haftalar) {
      const k = haftaKuponu(h, { ...ayar, strateji });
      if (!k) continue;
      n++; yat += ayar.para; don += k.kazanc; tut += k.tuttu; sans += k.sansi; oranT += k.oran;
    }
  }
  return { n, yat, don, tut, sans, oran: oranT / (n || 1), tekrar };
}

function karsilastirCiz(ayar, haftalar) {
  const satirlar = Object.entries(STRATEJI).map(([k, ad]) => {
    const x = haftalardaDene(ayar, haftalar, k);
    const net = x.don - x.yat;
    return `<tr class="${k === ayar.strateji ? 'secili-satir' : ''}"><td><b>${esc(ad)}</b></td><td class="sag">${sayi(x.n / x.tekrar)}</td>
      <td class="sag"><b>%${sayi(100 * x.tut / (x.n || 1), 1)}</b></td><td class="sag">${sayi(x.oran, 2)}</td>
      <td class="sag"><span class="${net >= 0 ? 'k-arti' : 'k-eksi'}">${net >= 0 ? '+' : ''}${sayi(100 * net / (x.yat || 1), 1)} TL</span></td></tr>`;
  }).join('');
  // Araştırmadaki gibi: formülün değer gördüğü her gol çizgisine tek bahis (kupon değil)
  let tekN = 0, tekTut = 0, tekNet = 0;
  for (const m of kuponVeri.maclar) {
    const fm = formulVeri?.maclar?.[m.id];
    if (!fm) continue;
    for (const [kat, pazarAd, sec] of m.pz) {
      if (kat !== 'gol' || fm[pazarAd] == null) continue;
      const ev = [fm[pazarAd] * sec[0][3] - 1, (1 - fm[pazarAd]) * sec[1][3] - 1];
      const i = ev[0] >= ev[1] ? 0 : 1;
      if (ev[i] < (formulVeri.esik ?? 0.1)) continue;
      tekN++; tekTut += sec[i][5]; tekNet += sec[i][5] ? sec[i][3] - 1 : -1;
    }
  }
  const tekSatir = tekN ? `<tr class="formul-satir"><td><b>💰 Formül · her uygun maça tek bahis (kupon değil)</b></td><td class="sag">${sayi(tekN)} bahis</td>
    <td class="sag"><b>%${sayi(100 * tekTut / tekN, 1)}</b></td><td class="sag">–</td>
    <td class="sag"><span class="${tekNet >= 0 ? 'k-arti' : 'k-eksi'}">${tekNet >= 0 ? '+' : ''}${sayi(100 * tekNet / tekN, 1)} TL</span></td></tr>` : '';
  const kapsam = (ayar.tip === 'sayi' ? `${ayar.sayi} maçlık` : `hedef oranı ${ayar.hedef} olan`) + (ayar.enAz > 1 ? `, seçim başına en az ${sayi(ayar.enAz, 2)} oranlı` : '');
  return `<h2 class="kesfet-baslik">Stratejiler yarışıyor: ${esc(kapsam)} kuponlar, seçili pazarlar</h2>
    <div class="tablo-kaydir"><table><thead><tr><th>Strateji</th><th class="sag">Kupon</th><th class="sag">Tutma oranı</th><th class="sag">Ort. oran</th><th class="sag">100 TL başına</th></tr></thead>
    <tbody>${tekSatir}${satirlar}</tbody></table></div>
    <p class="not">Formül yalnızca Temmuz 2025'ten sonraki maçlarda (onları görmeden) tahmin yapabildiği için daha az haftada oynar; açılış oranlarını kullanır ve pazar seçimini dikkate almaz.
      Geçmişteki her hafta için bir kupon kuruldu (her hafta yalnızca bir kez sayılır; rastgele strateji 20 kez denenip ortalandı).
      <b>Tutma oranını</b> en çok yükselten yöntem, modelin tahminini oranların gösterdiği olasılıkla birleştirmek. <b>Kâr</b> ise başka bir konu:
      bahis şirketinin payı her seçimde vardır; tüm maçlarda tek tek oynandığında her yöntem uzun vadede hafif zararda. Yüz küsur haftalık sonuçta
      birkaç şanslı hafta kârı büyük gösterebilir, bu yüzden "100 TL başına" sütununu kesin bir kanıt olarak okumayın.</p>`;
}

// ---------- Gerçek kupon (yaklaşan maçlar) ----------
// scout/analiz/canli_kupon.py her 3 saatte bir (GitHub Actions) formülü oranı belli yaklaşan maçlara uygular.
let kuponMod = 'gercek';
let canliVeri = null, canliGecmis = null;
const canliAyar = { lig: null, para: 100, sayi: 1 };
const gunSaat = (t) => new Date(t).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const kuponModSecici = () => `<div class="k-mod">
    <button class="k-mod-b ${kuponMod === 'gercek' ? 'secili' : ''}" data-mod="gercek">🎯 Gerçek kupon <small>yaklaşan maçlar</small></button>
    <button class="k-mod-b ${kuponMod === 'gecmis' ? 'secili' : ''}" data-mod="gecmis">🎲 Simülatör <small>oynanmış maçlar</small></button>
  </div>`;
const kuponModBagla = () => document.querySelectorAll('.k-mod-b').forEach((b) => b.addEventListener('click', () => {
  if (kuponMod !== b.dataset.mod) { kuponMod = b.dataset.mod; kuponGoster(); }
}));

function canliKarne() {
  const b = (canliGecmis?.bahisler ?? []).filter((x) => x.sonuc != null);
  if (!b.length) return '<p class="not">Canlı karne: formülün burada önerdiği bahisler oynandıkça sonuçları buraya işlenecek (henüz sonuçlanan yok).</p>';
  const tut = b.filter((x) => x.sonuc).length;
  const net = b.reduce((a, x) => a + (x.sonuc ? x.oran - 1 : -1), 0);
  const son = [...b].sort((x, y) => (y.t > x.t ? 1 : -1)).slice(0, 12);
  return `<h2 class="kesfet-baslik">📒 Canlı karne (önerildikten sonra oynanan maçlar)</h2>
    <div class="k-alt">
      <div><small class="soluk">Sonuçlanan bahis</small><b>${sayi(b.length)}</b></div>
      <div><small class="soluk">Tutan</small><b>${sayi(tut)} (%${sayi(100 * tut / b.length)})</b></div>
      <div><small class="soluk">Her bahse 100 TL</small><b class="${net >= 0 ? 'k-arti' : 'k-eksi'}">${net >= 0 ? '+' : ''}${tl(100 * net)}</b></div>
      <div><small class="soluk">100 TL başına</small><b class="${net >= 0 ? 'k-arti' : 'k-eksi'}">${net >= 0 ? '+' : ''}${sayi(100 * net / b.length, 1)} TL</b></div>
    </div>
    <details class="tablo-gor"><summary>Son sonuçlar</summary>${son.map((x) => `<div class="k-satir ${x.sonuc ? 'tuttu' : 'yatti'}">
      <div class="k-mac"><b>${esc(x.e)} – ${esc(x.d)}</b><small>${esc(x.lig)} · ${esc(gunSaat(x.t))}</small></div>
      <div class="k-sec"><span class="etiket">${esc(x.secim)}</span><small>formül %${sayi(100 * x.p)}</small></div>
      <div class="k-oran">${sayi(x.oran, 2)}</div><div class="k-sonuc"><b>${x.skor ? x.skor.join('–') : ''}</b> ${x.sonuc ? '✅' : '❌'}</div></div>`).join('')}</details>
    <p class="not">Oran, bahsin ilk önerildiği andaki SofaScore oranıdır. Az sayıda bahiste sonuç şansa çok bağlıdır; en az birkaç yüz bahis birikmeden karar vermeyin.</p>`;
}

function canliCiz() {
  const a = canliAyar;
  const L = canliVeri[a.lig];
  const kart = (b) => `<div class="k-satir">
      <div class="k-mac"><b>${esc(b.e)} – ${esc(b.d)}</b><small>${esc(gunSaat(b.t))}</small></div>
      <div class="k-sec"><span class="etiket">${esc(b.secim)}</span><small>formül %${sayi(100 * b.p)} · oranlara göre %${sayi(100 * b.piyasa_p)} · değer +%${sayi(100 * b.deger)}</small>
        <small class="k-iddaa">İddaa'da oran <b>${sayi(b.en_az_oran, 2)}</b> ya da üstüyse oyna</small></div>
      <div class="k-oran">${sayi(b.oran, 2)}</div>
      <div class="k-sonuc"><span class="soluk">${sayi(a.para)} TL → ${tl(a.para * b.oran)}</span></div>
    </div>`;
  const B = L.bahisler;
  const beklenen = B.reduce((x, b) => x + a.para * b.deger, 0);
  let kupon = '';
  if (a.sayi > 1 && B.length >= a.sayi) {
    const sec = [...B].sort((x, y) => y.p - x.p).slice(0, a.sayi);
    const oran = sec.reduce((x, b) => x * b.oran, 1), sans = sec.reduce((x, b) => x * b.p, 1);
    kupon = `<div class="kesfet-kart genis k-kupon">
      <div class="k-ust"><b>${a.sayi} maçlık kupon</b><span class="soluk">formülün en emin olduğu ${a.sayi} seçim</span></div>
      ${sec.map(kart).join('')}
      <div class="k-alt">
        <div><small class="soluk">Toplam oran</small><b>${sayi(oran, 2)}</b></div>
        <div><small class="soluk">Formüle göre tutma ihtimali</small><b>%${sayi(100 * sans, 1)}</b></div>
        <div><small class="soluk">Bahis</small><b>${tl(a.para)}</b></div>
        <div><small class="soluk">Olası kazanç</small><b>${tl(a.para * oran)}</b></div>
      </div>
      <p class="not">Kombine kuponda her maçın şirket payı çarpılarak büyür; araştırmada kârlı çıkan yol <b>tek tek oynamaktı</b>.</p>
    </div>`;
  } else if (a.sayi > 1) {
    kupon = `<div class="bilgi">${a.sayi} maçlık kupon için yeterli değerli seçim yok (şu an ${B.length}). Maç sayısını düşürün.</div>`;
  }
  const oranli = L.maclar.length;
  $('#k-alan').innerHTML = `
    ${kupon}
    <div class="kesfet-kart genis k-kupon">
      <div class="k-ust"><b>Formülün önerdiği tek bahisler (${sayi(B.length)})</b><span class="soluk">güncellendi: ${esc(gunSaat(L.olusturuldu))}</span></div>
      ${B.length ? B.map(kart).join('') : `<div class="bilgi">${oranli ? `Oranı belli ${sayi(oranli)} yaklaşan maçta formül %${sayi(100 * L.esik)}+ değerli seçim bulamadı. Bu normal: formül seçici, bazı haftalar hiç oynamaz.` : L.egitim_satir < 3000 ? 'Bu ligde formülü kuracak kadar geçmiş veri henüz yok.' : 'Yaklaşan maçların oranları henüz gelmedi (oranlar maçtan birkaç gün önce açılır, konsol betiği 3 saatte bir çeker).'}</div>`}
      ${B.length ? `<div class="k-alt">
        <div><small class="soluk">Bahis sayısı</small><b>${sayi(B.length)}</b></div>
        <div><small class="soluk">Toplam yatırılan</small><b>${tl(a.para * B.length)}</b></div>
        <div><small class="soluk">Formüle göre beklenen kâr</small><b class="k-arti">+${tl(beklenen)}</b></div>
        <div><small class="soluk">Ort. oran</small><b>${sayi(B.reduce((x, b) => x + b.oran, 0) / B.length, 2)}</b></div>
      </div>` : ''}
    </div>
    <div class="kesfet-kart genis">${canliKarne()}</div>`;
}

async function gercekKuponGoster(v) {
  try {
    canliVeri = await fetch('veri/scout_canli_kupon.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    canliGecmis = await fetch('veri/scout_canli_gecmis.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  } catch { canliVeri = {}; }
  if (!guncel(v)) return;
  const ligler = Object.keys(canliVeri);
  const a = canliAyar;
  if (!ligler.includes(a.lig)) a.lig = ligler[0] ?? null;
  $('#icerik').innerHTML = `${kuponModSecici()}
    <div class="kesfet-kart genis">
      <h2 class="kesfet-baslik" style="margin-top:0">🎯 Gerçek kupon: henüz oynanmamış maçlar</h2>
      <p class="not">Araştırmada son sınavı geçen tek formül uygulanır: <b>gol alt/üst</b>, formülün gördüğü olasılık × oran en az <b>%10 kâr</b> gösteriyorsa.
        Oranlar SofaScore'dan (birkaç şirketin ortalamasına yakın). <b>İddaa genelde daha düşük oran verir</b>: her seçimde yazan "en az" oranı
        İddaa'da bulamazsan o bahsi oynama. Geçmişte bu formül 372 bahiste +%4,6 getirdi; bu kesin kazanç değil, kayıp haftaları normal.</p>
      ${ligler.length ? `<div class="arac k-ayar">
        <label class="alan"><span>Lig</span><select id="c-lig">${ligler.map((l) => `<option>${esc(l)}</option>`).join('')}</select></label>
        <label class="alan"><span>Bahis başına (TL)</span><input id="c-para" type="number" min="1" step="10" value="${a.para}"></label>
        <label class="alan"><span>Oynama biçimi</span><select id="c-sayi"><option value="1">Tek tek (önerilen)</option>${[2, 3, 4, 5].map((n) => `<option value="${n}">${n} maçlık kupon</option>`).join('')}</select></label>
      </div>` : ''}
    </div>
    <div id="k-alan">${ligler.length ? '' : '<div class="bilgi">Gerçek kupon verisi henüz hazırlanmadı. İlk hesaplama birkaç saat içinde kendiliğinden yapılır.</div>'}</div>`;
  kuponModBagla();
  if (!ligler.length) return;
  $('#c-lig').value = a.lig; $('#c-sayi').value = String(a.sayi);
  const oku = () => { a.lig = $('#c-lig').value; a.para = Math.max(1, Number($('#c-para').value) || 100); a.sayi = +$('#c-sayi').value; canliCiz(); };
  ['#c-lig', '#c-para', '#c-sayi'].forEach((k) => $(k).addEventListener('change', oku));
  canliCiz();
}

async function kuponGoster() {
  const v = surum;
  yukleniyor();
  $('#ozet').innerHTML = '';
  if (kuponMod === 'gercek') return gercekKuponGoster(v);
  try {
    kuponVeri ||= await fetch('veri/scout_kupon_gecmis.json', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); });
    formulVeri ||= await fetch('veri/scout_formul.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  } catch (e) { return guncel(v) && bos(`Kupon verisi yüklenemedi: ${esc(e.message)}`); }
  if (!guncel(v)) return;
  const haftalar = kuponHaftalari();
  const a = kuponAyar;
  $('#icerik').innerHTML = `${kuponModSecici()}
    <div class="kesfet-kart genis">
      <h2 class="kesfet-baslik" style="margin-top:0">🎲 Kupon simülatörü</h2>
      <p class="not">${esc(kuponVeri.lig)}'in ${sayi(kuponVeri.maclar.length)} geçmiş maçında, ${sayi(haftalar.length)} haftada oynanır. Model her maçı <b>sonucu bilmeden</b> tahmin etti;
        kuponu kurunca sonuçlar açılır. Gerçek para değildir, modelin gücünü görmek içindir. Korner, kart ve diğer pazarların oranları 2024/25'ten beri var.</p>
      <div class="arac k-ayar">
        <label class="alan"><span>Bahis (TL)</span><input id="k-para" type="number" min="1" step="10" value="${a.para}"></label>
        <label class="alan"><span>Kupon</span><select id="k-tip"><option value="sayi">Maç sayısına göre</option><option value="hedef">Hedef orana göre</option></select></label>
        <label class="alan" id="k-sayi-alan"><span>Maç sayısı</span><select id="k-sayi">${[1, 2, 3, 4, 5, 6, 8, 10].map((n) => `<option>${n}</option>`).join('')}</select></label>
        <label class="alan" id="k-hedef-alan"><span>Hedef oran</span><select id="k-hedef">${[2, 3, 5, 10, 20, 50, 100].map((n) => `<option>${n}</option>`).join('')}</select></label>
        <label class="alan"><span>Strateji</span><select id="k-strateji">${Object.entries(STRATEJI).map(([k, ad]) => `<option value="${k}">${esc(ad)}</option>`).join('')}</select></label>
        <label class="alan"><span>Seçim başına en az oran</span><select id="k-enaz">${[1, 1.2, 1.3, 1.5, 1.8, 2].map((n) => `<option value="${n}">${n === 1 ? 'Sınır yok' : sayi(n, 2)}</option>`).join('')}</select></label>
        <label class="alan"><span>Oranlar</span><select id="k-oran"><option value="1">Maç saatindeki</option><option value="0">Açılış (günler önce)</option></select></label>
      </div>
      <div class="k-pazarlar"><span class="soluk">Pazarlar:</span>${KUPON_PAZAR.map(([k, ad]) => `<label class="k-cip"><input type="checkbox" value="${k}" ${a.pazarlar.has(k) ? 'checked' : ''}> ${esc(ad)}</label>`).join('')}</div>
      <div class="k-butonlar"><button class="k-buton" id="k-olustur">🎲 Kupon oluştur</button><button class="k-buton ikincil" id="k-toplu">Stratejileri yarıştır</button></div>
    </div>
    <div id="k-alan"></div>`;
  const ayarOku = () => {
    a.para = Math.max(1, Number($('#k-para').value) || 100);
    a.tip = $('#k-tip').value; a.sayi = +$('#k-sayi').value; a.hedef = +$('#k-hedef').value;
    a.strateji = $('#k-strateji').value; a.oran = +$('#k-oran').value; a.enAz = +$('#k-enaz').value;
    a.pazarlar = new Set([...document.querySelectorAll('.k-pazarlar input:checked')].map((x) => x.value));
    $('#k-sayi-alan').style.display = a.tip === 'sayi' ? '' : 'none';
    $('#k-hedef-alan').style.display = a.tip === 'hedef' ? '' : 'none';
  };
  kuponModBagla();
  $('#k-tip').value = a.tip; $('#k-sayi').value = a.sayi; $('#k-hedef').value = a.hedef;
  $('#k-strateji').value = a.strateji; $('#k-oran').value = a.oran; $('#k-enaz').value = String(a.enAz);
  ayarOku();
  $('#icerik').querySelectorAll('.k-ayar select, .k-ayar input, .k-pazarlar input').forEach((x) => x.addEventListener('change', ayarOku));
  const goster = (acik) => {
    $('#k-alan').innerHTML = kuponCiz(sonKupon, acik);
    $('#k-goster')?.addEventListener('click', () => {
      let i = 0;
      const ac = () => { i++; $('#k-alan').innerHTML = kuponCiz(sonKupon, i); if (i < sonKupon.secilen.length) setTimeout(ac, 450); };
      ac();
    });
  };
  $('#k-olustur').addEventListener('click', () => {
    ayarOku();
    if (!a.pazarlar.size) return toastYok();
    // Kurulabilen bir hafta bulunana kadar rastgele hafta dene
    sonKupon = null;
    const karisik = [...haftalar].sort(() => Math.random() - 0.5);
    for (const h of karisik) { sonKupon = haftaKuponu(h, a); if (sonKupon) break; }
    goster(0);
  });
  const toastYok = () => { $('#k-alan').innerHTML = '<div class="bilgi">En az bir pazar seçin.</div>'; };
  $('#k-toplu').addEventListener('click', () => {
    ayarOku();
    if (!a.pazarlar.size) return toastYok();
    $('#k-alan').innerHTML = '<div class="bilgi">Kuponlar oynanıyor…</div>';
    setTimeout(() => { $('#k-alan').innerHTML = karsilastirCiz(a, haftalar); }, 30);
  });
}

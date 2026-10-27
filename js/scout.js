import { db } from './db.js';

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

const durum = { gorunum: 'maclar', lig: 17, sezon: SEZONLAR[0], hafta: null, stat: 'puan', mevki: '', dk: 900, ara: '' };
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
  $('#lig').parentElement.style.display = $('#sezon').parentElement.style.display = g === 'oyuncular' || g === 'durum' ? 'none' : '';
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
  $('#detay-ad').textContent = `${takim(m.ev_id)} ${m.ev_gol ?? ''}–${m.dep_gol ?? ''} ${takim(m.dep_id)}`;

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

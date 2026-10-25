import { db } from './db.js';

const TABLO = 'galatasaray_kadrolar';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

const euro = (n) => {
  if (n == null) return '-';
  if (n >= 1e6) return `€${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} mn`;
  if (n >= 1e3) return `€${Math.round(n / 1e3).toLocaleString('tr-TR')} bin`;
  return `€${n}`;
};
// Transfermarkt 'geldiği kulüp' metni bedeli de içerir: 'Trabzonspor: Ablöse €30.00m' -> kulüp + Türkçe bedel
const BEDEL = [['Leihgebühr', 'Kiralama bedeli'], ['Leih-Ende', 'Kiralık dönüşü'], ['Leihe', 'Kiralık'], ['ablösefrei', 'Bedelsiz'], ['Ablöse', 'Bonservis']];
function gelis(metin) {
  if (!metin) return { kulup: '-', bedel: '' };
  const i = metin.indexOf(': ');
  if (i < 0) return { kulup: metin, bedel: '' };
  let bedel = metin.slice(i + 2).trim();
  for (const [de, tr] of BEDEL) bedel = bedel.replace(de, tr);
  return { kulup: metin.slice(0, i), bedel: bedel === '-' || bedel === '?' ? '' : bedel };
}
const gelisHtml = (metin) => { const g = gelis(metin); return `${esc(g.kulup)}${g.bedel ? ` <small class="bedel">${esc(g.bedel)}</small>` : ''}`; };

const sezonAd = (s) => `${s}/${String(s + 1).slice(-2)}`;

// Sezon listesi: 2000/01'den bu sezona (Temmuz'da yeni sezon başlar)
const bugun = new Date();
const buSezon = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;
const sezonSec = $('#sezon');
for (let s = buSezon; s >= 2000; s--) sezonSec.add(new Option(sezonAd(s), s));

function hataGoster(e) {
  const tabloYok = /relation|does not exist|schema cache/i.test(e.message || '');
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = tabloYok
    ? `<div class="bilgi">Kadro tablosu henüz kurulmamış.<br>Supabase SQL Editor'de <code>supabase/galatasaray_kadrolar.sql</code> dosyasını çalıştırın, ardından verileri yükleyin.</div>`
    : `<div class="bilgi">Veriler yüklenemedi: ${esc(e.message)}</div>`;
}

async function sezonGoster(sezon) {
  $('#icerik').innerHTML = '<div class="bilgi">Yükleniyor…</div>';
  const { data, error } = await db().from(TABLO).select('*').eq('sezon', sezon).order('ad');
  if (error) return hataGoster(error);
  if (!data.length) {
    $('#ozet').innerHTML = '';
    $('#icerik').innerHTML = `<div class="bilgi">${sezonAd(sezon)} sezonu için veri yok. Verileri yüklemek için <code>python scripts/galatasaray_kadrolar.py --supabase</code></div>`;
    return;
  }

  const yaslar = data.map((r) => r.yas).filter((y) => y != null);
  const toplamDeger = data.reduce((a, r) => a + (r.piyasa_degeri_eur || 0), 0);
  const yabanci = data.filter((r) => r.uyruk && !r.uyruk.split(', ').includes('Türkiye') && !r.uyruk.split(', ').includes('Turkey')).length;
  $('#ozet').innerHTML = [
    ['Oyuncu', data.length],
    ['Yaş ortalaması', yaslar.length ? (yaslar.reduce((a, b) => a + b, 0) / yaslar.length).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '-'],
    ['Yabancı oyuncu', yabanci],
    ['Toplam piyasa değeri', toplamDeger ? euro(toplamDeger) : '-'],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');

  const gruplar = Object.fromEntries(GRUPLAR.map((g) => [g, []]));
  for (const r of data) gruplar[mevki(r.mevki)[0]].push(r);
  const noSira = (r) => (r.forma_no && !Number.isNaN(Number(r.forma_no)) ? Number(r.forma_no) : 999);

  $('#icerik').innerHTML = GRUPLAR.filter((g) => gruplar[g].length).map((g) => `
    <div class="grup">
      <h3>${g} · ${gruplar[g].length}</h3>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Yaş</th><th>Uyruk</th><th>Geldiği kulüp</th><th class="sag">Piyasa değeri</th></tr></thead>
        <tbody>${gruplar[g].sort((a, b) => noSira(a) - noSira(b)).map((r) => `
          <tr data-id="${r.oyuncu_id}">
            <td class="no">${esc(r.forma_no || '-')}</td>
            <td class="ad"><b>${esc(r.ad)}</b><small>${esc(mevki(r.mevki)[1])}</small></td>
            <td data-k="Yaş">${esc(r.yas ?? '-')}</td>
            <td data-k="Uyruk">${esc(r.uyruk || '-')}</td>
            <td data-k="Geldiği kulüp">${gelisHtml(r.geldigi_kulup)}</td>
            <td data-k="Değer" class="sag">${euro(r.piyasa_degeri_eur)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`).join('');
}

async function oyuncuDetay(id) {
  const { data, error } = await db().from(TABLO).select('*').eq('oyuncu_id', id).order('sezon');
  if (error || !data.length) return;
  const son = data[data.length - 1];
  $('#detay-ad').textContent = son.ad;
  $('#detay-govde').innerHTML = `
    <div class="etiketler">
      <span class="etiket">${esc(mevki(son.mevki)[1])}</span>
      ${son.dogum_tarihi ? `<span class="etiket">Doğum: ${esc(son.dogum_tarihi)}</span>` : ''}
      ${son.uyruk ? `<span class="etiket">${esc(son.uyruk)}</span>` : ''}
      ${son.boy ? `<span class="etiket">${esc(son.boy)}</span>` : ''}
      ${son.ayak ? `<span class="etiket">Ayak: ${esc(son.ayak)}</span>` : ''}
      <span class="etiket">Galatasaray'da ${data.length} sezon</span>
    </div>
    <table>
      <thead><tr><th>Sezon</th><th>#</th><th>Yaş</th><th class="sag">Piyasa değeri</th></tr></thead>
      <tbody>${data.map((r) => `<tr data-sezon="${r.sezon}"><td>${esc(r.sezon_ad)}</td><td data-k="Forma">${esc(r.forma_no || '-')}</td><td data-k="Yaş">${esc(r.yas ?? '-')}</td><td data-k="Değer" class="sag">${euro(r.piyasa_degeri_eur)}</td></tr>`).join('')}</tbody>
    </table>
    ${son.profil_url ? `<p><a href="${esc(son.profil_url)}" target="_blank" rel="noopener">Transfermarkt profili ↗</a></p>` : ''}`;
  $('#detay').showModal();
}

// Arama: tüm sezonlarda isimle eşleşen oyuncular (her oyuncu bir kez)
let araZaman;
async function ara(metin) {
  if (metin.length < 2) return sezonGoster(Number(sezonSec.value));
  const { data, error } = await db().from(TABLO).select('oyuncu_id,ad,mevki,sezon,sezon_ad').ilike('ad', `%${metin}%`).order('sezon').limit(500);
  if (error) return hataGoster(error);
  const oyuncular = new Map();
  for (const r of data) {
    const o = oyuncular.get(r.oyuncu_id) || { ...r, sezonlar: [] };
    o.sezonlar.push(r.sezon_ad);
    oyuncular.set(r.oyuncu_id, o);
  }
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = oyuncular.size ? `
    <div class="grup"><h3>Arama sonuçları · ${oyuncular.size}</h3>
      <table>
        <thead><tr><th>Oyuncu</th><th>Sezonlar</th></tr></thead>
        <tbody>${[...oyuncular.values()].map((o) => `
          <tr data-id="${o.oyuncu_id}"><td class="ad"><b>${esc(o.ad)}</b><small>${esc(mevki(o.mevki)[1])}</small></td>
          <td data-k="Sezonlar" style="white-space:normal">${esc(o.sezonlar.join(', '))}</td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="bilgi">Eşleşen oyuncu yok.</div>';
}

sezonSec.addEventListener('change', () => { $('#ara').value = ''; sezonGoster(Number(sezonSec.value)); });
$('#ara').addEventListener('input', (e) => { clearTimeout(araZaman); araZaman = setTimeout(() => ara(e.target.value.trim()), 300); });
$('#icerik').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) oyuncuDetay(Number(tr.dataset.id)); });
$('#detay-govde').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-sezon]');
  if (!tr) return;
  $('#detay').close();
  $('#ara').value = '';
  sezonSec.value = tr.dataset.sezon;
  sezonGoster(Number(tr.dataset.sezon));
});
$('#detay-kapat').addEventListener('click', () => $('#detay').close());
$('#detay').addEventListener('click', (e) => { if (e.target.id === 'detay') $('#detay').close(); });

sezonGoster(buSezon);

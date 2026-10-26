import { db } from './db.js';
import { puanla, enIyi11, DIZILISLER, BILESEN_AD } from './puan.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sayi = (n) => Number(n || 0).toLocaleString('tr-TR');

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

const durum = { lig: 'TR1', sezon: BU_SEZON, kulup: 141, gorunum: 'kulup', dizilis: '4-3-3', mevkiFiltre: '' };
let ligler = [];

function hata(e) {
  $('#ozet').innerHTML = '';
  const tabloYok = /relation|does not exist|schema cache/i.test(e.message || '');
  $('#icerik').innerHTML = `<div class="bilgi">${tabloYok
    ? "Veritabanı tabloları kurulmamış. Supabase SQL Editor'de <code>supabase/veritabani.sql</code> dosyasını çalıştırın."
    : `Veriler yüklenemedi: ${esc(e.message)}`}</div>`;
}
const bos = (mesaj) => { $('#ozet').innerHTML = ''; $('#icerik').innerHTML = `<div class="bilgi">${mesaj}</div>`; };
const ligAd = (kod) => ligler.find((l) => l.kod === kod)?.ad || kod;

// ---------- Seçiciler ----------
async function ligleriYukle() {
  const { data, error } = await db().from('ligler').select('*');
  if (error) throw error;
  const sira = ['TR1', 'GB1', 'ES1', 'IT1', 'L1', 'FR1', 'PO1', 'NL1'];
  ligler = data.sort((a, b) => sira.indexOf(a.kod) - sira.indexOf(b.kod));
  $('#lig').innerHTML = ligler.map((l) => `<option value="${l.kod}">${esc(l.ad)} · ${esc(l.ulke)}</option>`).join('');
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
    ['Yaş ort. · yabancı', `${yaslar.length ? (yaslar.reduce((a, b) => a + b, 0) / yaslar.length).toLocaleString('tr-TR', { maximumFractionDigits: 1 }) : '-'} · ${data.filter((r) => yabanciMi(r.oyuncular.uyruk, ulke)).length}`],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');

  const gruplar = Object.fromEntries(GRUPLAR.map((g) => [g, []]));
  for (const r of data) gruplar[mevki(r.mevki)[0]].push(r);
  $('#icerik').innerHTML = GRUPLAR.filter((g) => gruplar[g].length).map((g) => `
    <div class="grup">
      <h3>${g} · ${gruplar[g].length}</h3>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Yaş</th><th>Uyruk</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Dakika</th><th class="sag">Kart</th></tr></thead>
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
async function kralligGoster(alan) {
  const { data: kl, error: e1 } = await db().from('lig_kulupleri').select('kulup_id').eq('lig_kod', durum.lig).eq('sezon', durum.sezon);
  if (e1) return hata(e1);
  if (!kl.length) return bos(`${ligAd(durum.lig)} ${sezonAd(durum.sezon)} için henüz veri yok.`);
  const { data, error } = await db().from('oyuncu_sezonlari').select('oyuncu_id,gol,asist,mac,dakika,oyuncular(ad,uyruk),kulupler(ad)')
    .in('kulup_id', kl.map((r) => r.kulup_id)).eq('sezon', durum.sezon).gt(alan, 0).order(alan, { ascending: false }).order('mac').limit(30);
  if (error) return hata(error);
  $('#ozet').innerHTML = '';
  if (!data.length) return bos('Bu sezon için kayıt yok.');
  const baslik = alan === 'gol' ? 'Gol' : 'Asist';
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)} · ${baslik} krallığı</h3>
      <p class="soluk" style="margin:-4px 0 10px;font-size:13px">Lig kulüplerinde tüm turnuvalar (lig, kupa, Avrupa) toplamı.</p>
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
}

// ---------- Oyuncu kariyeri ----------
async function oyuncuDetay(id) {
  const [{ data: o }, { data, error }] = await Promise.all([
    db().from('oyuncular').select('*').eq('id', id).single(),
    db().from('oyuncu_sezonlari').select('*,kulupler(ad)').eq('oyuncu_id', id).order('sezon', { ascending: false }),
  ]);
  if (error || !o) return;
  // Kulübün o sezon hangi ligde olduğu
  const { data: lk } = await db().from('lig_kulupleri').select('lig_kod,sezon,kulup_id').in('kulup_id', [...new Set(data.map((r) => r.kulup_id))]);
  const ligi = (r) => lk?.find((x) => x.kulup_id === r.kulup_id && x.sezon === r.sezon)?.lig_kod;
  const top = (k) => data.reduce((a, r) => a + (r[k] || 0), 0);

  $('#detay-ad').textContent = o.ad;
  $('#detay-govde').innerHTML = `
    <div class="etiketler">
      <span class="etiket">${esc(mevki(o.mevki)[1])}</span>
      ${o.uyruk ? `<span class="etiket">${esc(o.uyruk)}</span>` : ''}
      <span class="etiket">${data.length} sezon · ${new Set(data.map((r) => r.kulup_id)).size} kulüp</span>
    </div>
    <div class="kariyer-toplam">
      ${[['Maç', top('mac')], ['Gol', top('gol')], ['Asist', top('asist')], ['Dakika', top('dakika')]].map(([e, d]) => `<div class="stat"><b>${sayi(d)}</b><span>${e}</span></div>`).join('')}
    </div>
    <table>
      <thead><tr><th>Sezon</th><th>Kulüp</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Dakika</th></tr></thead>
      <tbody>${data.map((r) => `
        <tr data-sezon="${r.sezon}" data-kulup="${r.kulup_id}" data-lig="${ligi(r) || ''}">
          <td>${sezonAd(r.sezon)}</td>
          <td data-k="Kulüp">${esc(r.kulupler.ad)}${ligi(r) ? ` <small class="soluk">${esc(ligAd(ligi(r)))}</small>` : ''}</td>
          <td data-k="Maç" class="sag">${r.mac}</td>
          <td data-k="Gol" class="sag">${r.gol ? `<b>${r.gol}</b>` : r.gol}</td>
          <td data-k="Asist" class="sag">${r.asist}</td>
          <td data-k="Dakika" class="sag">${sayi(r.dakika)}</td>
        </tr>`).join('')}</tbody>
    </table>
    <p class="soluk" style="font-size:12px">Sadece 8 ligdeki kulüplerde oynadığı sezonlar; tüm turnuvalar toplamı.</p>
    <p><a href="https://www.transfermarkt.com/x/profil/spieler/${o.id}" target="_blank" rel="noopener">Transfermarkt profili ↗</a></p>`;
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
/** Lig sezonunun puanlanmış oyuncuları (sadece lig maçları) */
async function ligPuanlari(lig, sezon) {
  const anahtar = `${lig}:${sezon}`;
  if (puanOnbellek.has(anahtar)) return puanOnbellek.get(anahtar);
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
const puanYok = () => bos(`${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)} için lig istatistikleri henüz yüklenmemiş. Lig istatistik kodu bu sezona geldiğinde puanlar burada görünecek.`);
const devamNotu = () => (durum.sezon >= BU_SEZON ? '<p class="not">Sezon devam ediyor; puanlar oynanan maçlara göre ve şampiyonluk bonusu yok.</p>' : '');
let sonPuanlar = [];

async function enIyi11Goster() {
  $('#icerik').innerHTML = '<div class="bilgi">Puanlar hesaplanıyor…</div>';
  const p = await ligPuanlari(durum.lig, durum.sezon);
  if (!p) return puanYok();
  sonPuanlar = p;
  const xi = enIyi11(p, durum.dizilis);
  const secilen = xi.flat().filter((y) => y.oyuncu);
  const ort = secilen.reduce((a, y) => a + y.oyuncu.puan, 0) / (secilen.length || 1);
  $('#ozet').innerHTML = [
    ['Takım puanı', ort.toLocaleString('tr-TR', { maximumFractionDigits: 1 })],
    ['Kulüp sayısı', new Set(secilen.map((y) => y.oyuncu.kulup_id)).size],
    ['Toplam lig golü', secilen.reduce((a, y) => a + y.oyuncu.gol, 0)],
    ['Diziliş', durum.dizilis],
  ].map(([e, d]) => `<div class="stat"><b>${d}</b><span>${e}</span></div>`).join('');
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)} · Sezonun en iyi 11'i</h3>${devamNotu()}
      <div class="saha">${xi.map((sira) => `<div class="saha-sira">${sira.map(({ pozisyon, oyuncu }) => (oyuncu ? `
        <button class="oyuncu-kart" data-puan="${oyuncu.oyuncu_id}:${oyuncu.kulup_id}">
          <span class="p">${oyuncu.puan.toFixed(1)}</span><b>${esc(oyuncu.ad)}</b><small>${esc(oyuncu.kulup_ad)}</small><small>${esc(pozisyon[1])}</small>
        </button>` : `<div class="oyuncu-kart bos"><b>—</b><small>${esc(pozisyon[1])}</small></div>`)).join('')}</div>`).join('')}
      </div>
      <p class="not">Oyuncuya dokunun: puanın nereden geldiğini görün. Puan yalnızca lig maçlarından hesaplanır; aynı mevkideki oyuncularla karşılaştırılır.</p>
    </div>`;
}

async function puanSiralamaGoster() {
  $('#icerik').innerHTML = '<div class="bilgi">Puanlar hesaplanıyor…</div>';
  const p = await ligPuanlari(durum.lig, durum.sezon);
  if (!p) return puanYok();
  sonPuanlar = p;
  const liste = p.filter((o) => o.sure >= 0.25 && (!durum.mevkiFiltre || o.aile === durum.mevkiFiltre)).slice(0, 50);
  $('#ozet').innerHTML = '';
  $('#icerik').innerHTML = `
    <div class="grup"><h3>${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)} · Futbolcu Puanı sıralaması</h3>${devamNotu()}
      <p class="not">Takımının lig dakikalarının en az %25'inde oynayanlar. Satıra dokunun: puan dökümü.</p>
      <table>
        <thead><tr><th>#</th><th>Oyuncu</th><th>Kulüp</th><th class="sag">Maç</th><th class="sag">Gol</th><th class="sag">Asist</th><th class="sag">Puan</th></tr></thead>
        <tbody>${liste.map((o, i) => `
          <tr data-puan="${o.oyuncu_id}:${o.kulup_id}">
            <td class="sira">${i + 1}</td>
            <td class="ad"><b>${esc(o.ad)}</b><small>${esc(mevki(o.mevki)[1])}</small></td>
            <td data-k="Kulüp">${esc(o.kulup_ad)}${o.sampiyon ? ' 🏆' : ''}</td>
            <td data-k="Maç" class="sag">${o.mac}</td>
            <td data-k="Gol" class="sag">${o.gol}</td>
            <td data-k="Asist" class="sag">${o.asist}</td>
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
};
function puanDokumu(anahtar) {
  const o = sonPuanlar.find((x) => `${x.oyuncu_id}:${x.kulup_id}` === anahtar);
  if (!o) return;
  $('#detay-ad').textContent = o.ad;
  $('#detay-govde').innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:6px">
      <div class="buyuk-puan">${o.puan.toFixed(1)}</div>
      <div><b>${esc(o.kulup_ad)}</b> · ${esc(ligAd(durum.lig))} ${sezonAd(durum.sezon)}<br><span class="soluk">${esc(mevki(o.mevki)[1])} · ${o.mac} maç · ${o.gol} gol · ${o.asist} asist</span></div>
    </div>
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
  $('#ara').value = '';
  try {
    if (durum.gorunum === 'kulup') await kulupGoster();
    else if (durum.gorunum === 'enIyi11') await enIyi11Goster();
    else if (durum.gorunum === 'puan') await puanSiralamaGoster();
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
  $('#dizilis-alan').style.display = g === 'enIyi11' ? '' : 'none';
  $('#mevki-alan').style.display = g === 'puan' ? '' : 'none';
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
$('#mevki-filtre').addEventListener('change', (e) => { durum.mevkiFiltre = e.target.value; goster(); });
// Kariyerde bir sezona tıklayınca o kulübün o sezonki kadrosuna git
$('#detay-govde').addEventListener('click', async (e) => {
  const k = e.target.closest('[data-kariyer]');
  if (k) { e.preventDefault(); return oyuncuDetay(Number(k.dataset.kariyer)); }
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

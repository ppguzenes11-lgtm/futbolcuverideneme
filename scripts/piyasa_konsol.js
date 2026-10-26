// Futbol veritabanı — 3. aşama: kadro sayfalarından piyasa değeri, kulübe katılma, geldiği kulüp,
// ve oyuncu profili (doğum tarihi, boy, ayak). Kulüp listesi lig_kulupleri tablosundan gelir.
// Kullanım: önce Supabase'de supabase/piyasa.sql çalıştırın. Sonra https://www.transfermarkt.com açın,
// F12 > Console'a bu kodun tamamını yapıştırıp Enter'a basın. Kaldığı yerden devam eder.
(async () => {
  // ---------- Ayarlar ----------
  const SUPABASE_URL = 'https://oixqyntsoatmerjxltki.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA';
  const bugun = new Date();
  const BU_SEZON = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;
  const BEKLEME = 3000;          // sayfalar arası ms — siteyi yormamak için
  const GUNCEL_YENILE_GUN = 7;   // bu sezonun sayfaları kaç günde bir yeniden çekilsin

  if (location.hostname !== 'www.transfermarkt.com') {
    console.error('Önce https://www.transfermarkt.com adresini açın (transfermarkt.com.tr değil), sonra kodu tekrar çalıştırın.');
    return;
  }

  const temiz = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  const sayi = (s) => { const n = parseInt(temiz(s).replace(/[^\d]/g, ''), 10); return Number.isNaN(n) ? 0 : n; };
  const sezonAd = (s) => `${s}/${String(s + 1).slice(-2)}`;

  // ---------- Supabase ----------
  const SB = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  async function sbYaz(tablo, satirlar, { cakisma, sadeceYeni = false }) {
    if (!satirlar.length) return;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${tablo}?on_conflict=${cakisma}`, {
      method: 'POST',
      headers: { ...SB, Prefer: `resolution=${sadeceYeni ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(satirlar),
    });
    if (!r.ok) throw new Error(`Supabase (${tablo}) ${r.status}: ${await r.text()}`);
  }
  async function sbOkuHepsi(tablo, sutunlar, filtre = '') {
    const out = [];
    for (let ofs = 0; ; ofs += 1000) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${tablo}?select=${sutunlar}${filtre}&limit=1000&offset=${ofs}`, { headers: SB });
      if (!r.ok) throw new Error(`Supabase (${tablo}) ${r.status}: ${await r.text()}`);
      const sayfa = await r.json();
      out.push(...sayfa);
      if (sayfa.length < 1000) return out;
    }
  }
  const tekil = (satirlar, anahtar) => [...new Map(satirlar.map((r) => [anahtar(r), r])).values()];

  // ---------- Transfermarkt ----------
  class DogrulamaGerekli extends Error {}
  async function sayfaAl(yol) {
    for (let deneme = 1; ; deneme++) {
      const r = await fetch(yol);
      const html = await r.text();
      if (r.status === 405 || /Human Verification/i.test(html.slice(0, 3000))) throw new DogrulamaGerekli();
      if (r.ok) return new DOMParser().parseFromString(html, 'text/html');
      if (deneme >= 2 || r.status < 429) throw new Error(`${yol}: HTTP ${r.status}`);
      console.warn(`${yol}: HTTP ${r.status}, 60 sn bekleniyor…`);
      await bekle(60000);
    }
  }

  const AYLAR = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  // 'Jun 16, 1986' -> '1986-06-16'
  const tarih = (m) => {
    const x = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(m || '');
    return x && AYLAR[x[1]] ? `${x[3]}-${AYLAR[x[1]]}-${x[2].padStart(2, '0')}` : null;
  };
  // '€1.50m' -> 1500000, '€500k' -> 500000
  const degerEur = (m) => {
    const x = /€\s*([\d.,]+)\s*(bn|m|k|Th\.)?/.exec(m || '');
    if (!x) return null;
    return Math.round(parseFloat(x[1].replace(/,/g, '')) * ({ bn: 1e9, m: 1e6, k: 1e3, 'Th.': 1e3 }[x[2]] || 1));
  };
  // '1,90m' -> 190
  const boyCm = (m) => { const x = /(\d)[,.](\d{2})\s*m/.exec(m || ''); return x ? Number(x[1] + x[2]) : null; };

  // Kulübün sezon kadro sayfası (plus/1: ayrıntılı görünüm)
  // Sütunlar başlık adlarıyla bulunur: Date of birth/Age, Nat., Height, Foot, Joined, Signed from, Contract, Market value
  async function kadro(slug, kulupId, sezon) {
    const doc = await sayfaAl(`/${slug}/kader/verein/${kulupId}/saison_id/${sezon}/plus/1`);
    const tablo = doc.querySelector('table.items');
    if (!tablo) return null;
    const basliklar = [...tablo.querySelectorAll('thead th')].map((th) => temiz(th.textContent));
    const satirlar = [];
    for (const tr of tablo.querySelectorAll(':scope > tbody > tr')) {
      const link = tr.querySelector("td.hauptlink a[href*='/profil/spieler/']");
      if (!link) continue;
      const tdler = [...tr.children].filter((e) => e.tagName === 'TD');
      const bul = (...anahtar) => {
        const i = basliklar.findIndex((b) => anahtar.some((a) => b.toLowerCase().includes(a.toLowerCase())));
        return i >= 0 ? tdler[i] : null;
      };
      const yazi = (td) => { const t = td ? temiz(td.textContent) : ''; return t && t !== '-' ? t : null; };
      const ayak = yazi(bul('Foot'));
      satirlar.push({
        oyuncu: {
          id: Number(/\/spieler\/(\d+)/.exec(link.getAttribute('href'))[1]),
          ad: temiz(link.getAttribute('title') || link.textContent),
          dogum_tarihi: tarih(yazi(bul('Date of birth', 'birth'))),
          boy_cm: boyCm(yazi(bul('Height'))),
          ayak: ayak && /^(right|left|both)$/i.test(ayak) ? ayak.toLowerCase() : null,
        },
        piyasa_degeri_eur: degerEur(yazi(tr.querySelector('td.rechts.hauptlink'))),
        katilma_tarihi: tarih(yazi(bul('Joined'))),
        geldigi_kulup: bul('Signed from')?.querySelector('a[title]')?.title || null,
      });
    }
    return satirlar;
  }

  // ---------- İş listesi: lig_kulupleri (en yeni sezondan geriye) ----------
  console.log('Kulüp listesi ve daha önce çekilen sayfalar okunuyor…');
  const [isler, cekilenRows] = await Promise.all([
    sbOkuHepsi('lig_kulupleri', 'lig_kod,sezon,kulup_id,kulupler(ad,slug)', '&order=sezon.desc,lig_kod,kulup_id'),
    sbOkuHepsi('cekilen_sayfalar', 'anahtar,tarih', '&anahtar=like.kadro:*'),
  ]);
  const cekilen = new Map(cekilenRows.map((r) => [r.anahtar, new Date(r.tarih)]));
  const tamamMi = (anahtar, sezon) => {
    const t = cekilen.get(anahtar);
    return !!t && (sezon < BU_SEZON || (Date.now() - t) / 864e5 < GUNCEL_YENILE_GUN);
  };
  const kalan = isler.filter((i) => !tamamMi(`kadro:${i.kulup_id}:${i.sezon}`, i.sezon));
  console.log(`${isler.length} kulüp-sezon var, ${isler.length - kalan.length} tanesi daha önce çekilmiş. Kalan: ${kalan.length} sayfa (~${Math.ceil(kalan.length * 5 / 60)} dk).`);

  let sayfaSay = 0;
  const basla = Date.now();
  const mn = (n) => (n == null ? '-' : `€${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mn`);
  try {
    for (const is of kalan) {
      const { lig_kod: lig, sezon, kulup_id: kulupId } = is;
      const kulup = is.kulupler;
      const anahtar = `kadro:${kulupId}:${sezon}`;
      const satirlar = await kadro(kulup.slug, kulupId, sezon);
      sayfaSay++;
      if (!satirlar) {
        console.warn(`${lig} ${sezonAd(sezon)} · ${kulup.ad}: kadro tablosu yok, atlandı`);
      } else {
        await sbYaz('oyuncular', tekil(satirlar.map((s) => s.oyuncu), (o) => o.id), { cakisma: 'id' });
        await sbYaz('oyuncu_sezonlari', tekil(satirlar.map(({ oyuncu, ...s }) => ({ oyuncu_id: oyuncu.id, kulup_id: kulupId, sezon, ...s })), (s) => s.oyuncu_id),
          { cakisma: 'oyuncu_id,kulup_id,sezon' });
        const toplam = satirlar.reduce((a, s) => a + (s.piyasa_degeri_eur || 0), 0);
        console.log(`  ${lig} ${sezonAd(sezon)} · ${kulup.ad}: ${satirlar.length} oyuncu, kadro değeri ${toplam ? mn(toplam) : '-'}`);
      }
      await sbYaz('cekilen_sayfalar', [{ anahtar, tarih: new Date().toISOString() }], { cakisma: 'anahtar' });
      if (sayfaSay % 100 === 0) {
        const dk = (Date.now() - basla) / 60000;
        console.log(`%c${sayfaSay}/${kalan.length} sayfa · ${Math.round(dk)} dk geçti, ~${Math.round(dk / sayfaSay * (kalan.length - sayfaSay))} dk kaldı`, 'color:#1f8a52;font-weight:bold');
      }
      await bekle(BEKLEME);
    }
    console.log('%cPiyasa değerleri tamam ✓', 'color:#1f8a52;font-weight:bold;font-size:14px');
  } catch (e) {
    if (e instanceof DogrulamaGerekli) {
      console.warn(`Transfermarkt doğrulama istiyor. Sayfayı yenileyin (F5), doğrulamayı geçin ve kodu tekrar çalıştırın — kaldığı yerden devam eder. (Bu çalıştırmada ${sayfaSay} sayfa çekildi.)`);
    } else {
      console.error(`Hata: ${e.message}\nKodu tekrar çalıştırırsanız kaldığı yerden devam eder. Sürerse bu mesajı Claude'a gönderin.`);
    }
  }
})();

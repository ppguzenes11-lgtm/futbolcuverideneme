// Futbol veritabanı — 2. aşama: oyuncuların sadece LİG maçlarındaki istatistikleri + kulübün lig puan ortalaması.
// Kulüp listesi 1. aşamada doldurulan lig_kulupleri tablosundan gelir (lig sayfası okunmaz).
// Kullanım: önce Supabase'de supabase/turnuvalar.sql çalıştırın. Sonra https://www.transfermarkt.com açın,
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

  // Kulübün bir turnuvadaki sezon istatistikleri (reldata=TURNUVA&SEZON)
  // Sütunlar: #, Oyuncu, Yaş, Uyruk, Kadroda, Maç, Gol, Asist, Sarı, 2. sarı, Kırmızı, Girdi, Çıktı, Puan ort., Dakika
  async function turnuvaIstatistik(slug, kulupId, turnuva, sezon) {
    const doc = await sayfaAl(`/${slug}/leistungsdaten/verein/${kulupId}/plus/1?reldata=${turnuva}%26${sezon}`);
    const tablo = doc.querySelector('table.items');
    if (!tablo) return null;
    let kulupPpg = null;
    const satirlar = [];
    for (const tr of tablo.querySelectorAll(':scope > tbody > tr')) {
      const td = [...tr.children].filter((e) => e.tagName === 'TD');
      const link = td[1]?.querySelector("td.hauptlink a[href*='/profil/spieler/']");
      if (!link || td.length < 15) continue;
      // td title: "Points average of club: 2.68"
      const kp = parseFloat(/([\d.]+)\s*$/.exec(td[13].getAttribute('title') || '')?.[1]);
      if (!Number.isNaN(kp)) kulupPpg = kp;
      const durum = temiz(td[5].textContent);
      if (/not in squad/i.test(durum)) continue; // bu turnuvada hiç kadroya girmemiş
      const kullanilmadi = td[5].colSpan > 1;    // "Not used during this season": kadroda ama oynamamış
      const ic = td[1].querySelectorAll('table.inline-table tr');
      const ppg = parseFloat(temiz(td[13].textContent));
      const v = (i) => (kullanilmadi ? 0 : sayi(td[i].textContent));
      satirlar.push({
        oyuncu: {
          id: Number(/\/spieler\/(\d+)/.exec(link.getAttribute('href'))[1]),
          ad: temiz(link.getAttribute('title') || link.textContent),
          uyruk: [...td[3].querySelectorAll('img[title]')].map((i) => i.title).join(', ') || null,
          mevki: ic[1] ? temiz(ic[1].textContent) : null,
        },
        kadroda: sayi(td[4].textContent),
        mac: v(5), gol: v(6), asist: v(7), sari: v(8), ikinci_sari: v(9), kirmizi: v(10),
        oyuna_girdi: v(11), oyundan_cikti: v(12),
        mac_basi_puan: kullanilmadi || Number.isNaN(ppg) ? null : ppg,
        dakika: v(14),
      });
    }
    return { satirlar, kulupPpg };
  }

  // ---------- İş listesi: lig_kulupleri (en yeni sezondan geriye) ----------
  console.log('Kulüp listesi ve daha önce çekilen sayfalar okunuyor…');
  const [isler, cekilenRows] = await Promise.all([
    sbOkuHepsi('lig_kulupleri', 'lig_kod,sezon,kulup_id,kulupler(ad,slug)', '&order=sezon.desc,lig_kod,kulup_id'),
    sbOkuHepsi('cekilen_sayfalar', 'anahtar,tarih', '&anahtar=like.ligist:*'),
  ]);
  const cekilen = new Map(cekilenRows.map((r) => [r.anahtar, new Date(r.tarih)]));
  const tamamMi = (anahtar, sezon) => {
    const t = cekilen.get(anahtar);
    return !!t && (sezon < BU_SEZON || (Date.now() - t) / 864e5 < GUNCEL_YENILE_GUN);
  };
  const kalan = isler.filter((i) => !tamamMi(`ligist:${i.lig_kod}:${i.kulup_id}:${i.sezon}`, i.sezon));
  console.log(`${isler.length} kulüp-sezon var, ${isler.length - kalan.length} tanesi daha önce çekilmiş. Kalan: ${kalan.length} sayfa (~${Math.ceil(kalan.length * 5 / 60)} dk).`);

  let sayfaSay = 0;
  const basla = Date.now();
  try {
    for (const is of kalan) {
      const { lig_kod: lig, sezon, kulup_id: kulupId } = is;
      const kulup = is.kulupler;
      const anahtar = `ligist:${lig}:${kulupId}:${sezon}`;
      const sonuc = await turnuvaIstatistik(kulup.slug, kulupId, lig, sezon);
      sayfaSay++;
      if (!sonuc) {
        console.warn(`${lig} ${sezonAd(sezon)} · ${kulup.ad}: tablo yok, atlandı`);
      } else {
        const { satirlar, kulupPpg } = sonuc;
        await sbYaz('oyuncular', tekil(satirlar.map((s) => s.oyuncu), (o) => o.id), { cakisma: 'id', sadeceYeni: true });
        await sbYaz('oyuncu_turnuvalari', tekil(satirlar.map(({ oyuncu, ...s }) => ({ oyuncu_id: oyuncu.id, kulup_id: kulupId, sezon, turnuva_kod: lig, ...s })), (s) => s.oyuncu_id),
          { cakisma: 'oyuncu_id,kulup_id,sezon,turnuva_kod' });
        if (kulupPpg != null) await sbYaz('kulup_turnuvalari', [{ kulup_id: kulupId, sezon, turnuva_kod: lig, mac_basi_puan: kulupPpg }], { cakisma: 'kulup_id,sezon,turnuva_kod' });
        const gol = satirlar.reduce((a, s) => a + s.gol, 0);
        console.log(`  ${lig} ${sezonAd(sezon)} · ${kulup.ad}: ${satirlar.length} oyuncu, ${gol} lig golü, kulüp ort. ${kulupPpg ?? '-'}`);
      }
      await sbYaz('cekilen_sayfalar', [{ anahtar, tarih: new Date().toISOString() }], { cakisma: 'anahtar' });
      if (sayfaSay % 100 === 0) {
        const dk = (Date.now() - basla) / 60000;
        console.log(`%c${sayfaSay}/${kalan.length} sayfa · ${Math.round(dk)} dk geçti, ~${Math.round(dk / sayfaSay * (kalan.length - sayfaSay))} dk kaldı`, 'color:#1f8a52;font-weight:bold');
      }
      await bekle(BEKLEME);
    }
    console.log('%cLig istatistikleri tamam ✓', 'color:#1f8a52;font-weight:bold;font-size:14px');
  } catch (e) {
    if (e instanceof DogrulamaGerekli) {
      console.warn(`Transfermarkt doğrulama istiyor. Sayfayı yenileyin (F5), doğrulamayı geçin ve kodu tekrar çalıştırın — kaldığı yerden devam eder. (Bu çalıştırmada ${sayfaSay} sayfa çekildi.)`);
    } else {
      console.error(`Hata: ${e.message}\nKodu tekrar çalıştırırsanız kaldığı yerden devam eder. Sürerse bu mesajı Claude'a gönderin.`);
    }
  }
})();

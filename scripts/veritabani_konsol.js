// Futbol veritabanı — 1. aşama: 8 ligin kulüpleri ve oyuncu sezon istatistikleri (Transfermarkt → Supabase).
// Kullanım: bilgisayarda https://www.transfermarkt.com sayfasını açın, F12 > Console'a bu kodun tamamını yapıştırıp Enter'a basın.
// Kaldığı yerden devam eder: durdurmak için sekmeyi kapatın ya da sayfayı yenileyin, sonra kodu tekrar çalıştırın.
(async () => {
  // ---------- Ayarlar ----------
  const SUPABASE_URL = 'https://oixqyntsoatmerjxltki.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA';
  const LIGLER = [
    ['TR1', 'super-lig'], ['GB1', 'premier-league'], ['ES1', 'laliga'], ['IT1', 'serie-a'],
    ['L1', 'bundesliga'], ['FR1', 'ligue-1'], ['PO1', 'liga-portugal'], ['NL1', 'eredivisie'],
  ];
  const ILK_SEZON = 2000;
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
  // Aynı istekte aynı anahtar iki kez olursa Postgres hata verir
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

  // Lig sayfası → o sezonki kulüpler
  async function ligKulupleri(ligKod, ligSlug, sezon) {
    const doc = await sayfaAl(`/${ligSlug}/startseite/wettbewerb/${ligKod}/plus/?saison_id=${sezon}`);
    const tablo = doc.querySelector('table.items');
    if (!tablo) return [];
    const kulupler = [];
    for (const tr of tablo.querySelectorAll(':scope > tbody > tr')) {
      const a = tr.querySelector("td.hauptlink a[href*='/startseite/verein/']");
      if (!a) continue;
      const id = Number(/\/verein\/(\d+)/.exec(a.getAttribute('href'))[1]);
      const kadro = tr.querySelector("a[href*='/kader/verein/']");
      const slug = kadro ? kadro.getAttribute('href').split('/')[1] : a.getAttribute('href').split('/')[1];
      kulupler.push({ id, ad: temiz(a.getAttribute('title') || a.textContent), slug });
    }
    return kulupler;
  }

  // Kulübün sezon istatistik sayfası (tüm turnuvalar) → oyuncu satırları
  // Sütunlar: #, Oyuncu, Yaş, Uyruk, Kadroda, Maç, Gol, Asist, Sarı, 2. sarı, Kırmızı, Girdi, Çıktı, Puan ort., Dakika
  async function kulupIstatistik(kulup, sezon) {
    const doc = await sayfaAl(`/${kulup.slug}/leistungsdaten/verein/${kulup.id}/plus/1?reldata=%26${sezon}`);
    const tablo = doc.querySelector('table.items');
    if (!tablo) return null;
    const satirlar = [];
    for (const tr of tablo.querySelectorAll(':scope > tbody > tr')) {
      const td = [...tr.children].filter((e) => e.tagName === 'TD');
      const link = td[1]?.querySelector("td.hauptlink a[href*='/profil/spieler/']");
      if (!link || td.length < 15) continue;
      const kullanilmadi = td[5].colSpan > 1; // "Not used during this season"
      const ic = td[1].querySelectorAll('table.inline-table tr');
      const no = temiz(td[0].querySelector('.rn_nummer')?.textContent);
      const ppg = parseFloat(temiz(td[13].textContent));
      // td title: "Points average of club: 2.41" — oyuncunun etkisini ölçmek için kulübün sezon ortalaması
      const kulupPpg = parseFloat(/([\d.]+)\s*$/.exec(td[13].getAttribute('title') || '')?.[1]);
      const v = (i) => (kullanilmadi ? 0 : sayi(td[i].textContent));
      satirlar.push({
        oyuncu: {
          id: Number(/\/spieler\/(\d+)/.exec(link.getAttribute('href'))[1]),
          ad: temiz(link.getAttribute('title') || link.textContent),
          uyruk: [...td[3].querySelectorAll('img[title]')].map((i) => i.title).join(', ') || null,
          mevki: ic[1] ? temiz(ic[1].textContent) : null,
        },
        forma_no: no && no !== '-' ? no : null,
        yas: sayi(td[2].textContent) || null,
        kadroda: sayi(td[4].textContent),
        mac: v(5), gol: v(6), asist: v(7), sari: v(8), ikinci_sari: v(9), kirmizi: v(10),
        oyuna_girdi: v(11), oyundan_cikti: v(12),
        mac_basi_puan: kullanilmadi || Number.isNaN(ppg) ? null : ppg,
        kulup_mac_basi_puan: Number.isNaN(kulupPpg) ? null : kulupPpg,
        dakika: v(14),
      });
    }
    return satirlar;
  }

  // ---------- Kaldığı yer ----------
  console.log('Daha önce çekilen sayfalar okunuyor…');
  const cekilen = new Map((await sbOkuHepsi('cekilen_sayfalar', 'anahtar,tarih')).map((r) => [r.anahtar, new Date(r.tarih)]));
  const tamamMi = (anahtar, sezon) => {
    const t = cekilen.get(anahtar);
    if (!t) return false;
    return sezon < BU_SEZON || (Date.now() - t) / 864e5 < GUNCEL_YENILE_GUN;
  };
  const isaretle = async (anahtar) => {
    await sbYaz('cekilen_sayfalar', [{ anahtar, tarih: new Date().toISOString() }], { cakisma: 'anahtar' });
    cekilen.set(anahtar, new Date());
  };
  console.log(`${cekilen.size} sayfa daha önce çekilmiş, atlanacak.`);

  // ---------- Ana döngü: en yeni sezondan geriye ----------
  let sayfaSay = 0; let oyuncuSay = 0;
  const basla = Date.now();
  try {
    for (let sezon = BU_SEZON; sezon >= ILK_SEZON; sezon--) {
      for (const [ligKod, ligSlug] of LIGLER) {
        const ligAnahtar = `lig:${ligKod}:${sezon}`;
        let kulupler;
        if (tamamMi(ligAnahtar, sezon)) {
          kulupler = (await sbOkuHepsi('lig_kulupleri', 'kulup_id,kulupler(ad,slug)', `&lig_kod=eq.${ligKod}&sezon=eq.${sezon}`))
            .map((r) => ({ id: r.kulup_id, ad: r.kulupler.ad, slug: r.kulupler.slug }));
        } else {
          kulupler = await ligKulupleri(ligKod, ligSlug, sezon);
          sayfaSay++;
          await sbYaz('kulupler', tekil(kulupler, (k) => k.id), { cakisma: 'id', sadeceYeni: true });
          await sbYaz('lig_kulupleri', kulupler.map((k) => ({ lig_kod: ligKod, sezon, kulup_id: k.id })), { cakisma: 'lig_kod,sezon,kulup_id' });
          await isaretle(ligAnahtar);
          console.log(`${ligKod} ${sezonAd(sezon)}: ${kulupler.length} kulüp`);
          await bekle(BEKLEME);
        }

        for (const kulup of kulupler) {
          const anahtar = `kulup2:${kulup.id}:${sezon}`; // v2: kulüp ortalama puanı da kaydediliyor
          if (tamamMi(anahtar, sezon)) continue;
          const satirlar = await kulupIstatistik(kulup, sezon);
          sayfaSay++;
          if (satirlar === null) {
            console.warn(`${kulup.ad} ${sezonAd(sezon)}: istatistik tablosu yok, atlandı`);
          } else {
            // Oyuncunun ad/uyruk/mevki bilgisi en yeni sezondan gelir (yeni sezondan geriye gidildiği için eskiler üzerine yazmaz)
            await sbYaz('oyuncular', tekil(satirlar.map((s) => s.oyuncu), (o) => o.id), { cakisma: 'id', sadeceYeni: true });
            await sbYaz('oyuncu_sezonlari', tekil(satirlar.map(({ oyuncu, ...s }) => ({ oyuncu_id: oyuncu.id, kulup_id: kulup.id, sezon, mevki: oyuncu.mevki, ...s })), (s) => s.oyuncu_id), { cakisma: 'oyuncu_id,kulup_id,sezon' });
            oyuncuSay += satirlar.length;
            const gol = satirlar.reduce((a, s) => a + s.gol, 0);
            console.log(`  ${ligKod} ${sezonAd(sezon)} · ${kulup.ad}: ${satirlar.length} oyuncu, ${gol} gol`);
          }
          await isaretle(anahtar);
          await bekle(BEKLEME);
        }
      }
      const dk = Math.round((Date.now() - basla) / 60000);
      console.log(`%c${sezonAd(sezon)} sezonu tamam · bu çalıştırmada ${sayfaSay} sayfa, ${oyuncuSay} oyuncu satırı, ${dk} dk`, 'color:#1f8a52;font-weight:bold');
    }
    console.log('%cHer şey tamam ✓ Tüm sezonlar çekildi.', 'color:#1f8a52;font-weight:bold;font-size:14px');
  } catch (e) {
    if (e instanceof DogrulamaGerekli) {
      console.warn(`Transfermarkt doğrulama istiyor. Sayfayı yenileyin (F5), doğrulamayı geçin ve kodu tekrar çalıştırın — kaldığı yerden devam eder. (Bu çalıştırmada ${sayfaSay} sayfa çekildi.)`);
    } else {
      console.error(`Hata: ${e.message}\nKodu tekrar çalıştırırsanız kaldığı yerden devam eder. Sürerse bu mesajı Claude'a gönderin.`);
    }
  }
})();

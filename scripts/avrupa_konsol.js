// Futbol veritabanı — 4. aşama: Şampiyonlar Ligi (CL) ve Avrupa Ligi / UEFA Kupası (EL) istatistikleri.
// Her sezon için turnuvaya katılan kulüpler okunur, bizim 8 ligdeki kulüplerin turnuva kadro istatistikleri çekilir.
// Kazanan kulüpler turnuva_sampiyonlari tablosuna yazılır.
// Kullanım: önce Supabase'de supabase/avrupa.sql çalıştırın. Sonra https://www.transfermarkt.com açın,
// F12 > Console'a bu kodun tamamını yapıştırıp Enter'a basın. Kaldığı yerden devam eder.
(async () => {
  // ---------- Ayarlar ----------
  const SUPABASE_URL = 'https://oixqyntsoatmerjxltki.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA';
  const bugun = new Date();
  const BU_SEZON = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;
  const ILK_SEZON = 2000;
  const TURNUVALAR = [
    { kod: 'CL', ad: 'Şampiyonlar Ligi', slug: 'uefa-champions-league' },
    // 2008/09 ve öncesi Transfermarkt'ta ayrı turnuva: UEFA Kupası (kod UEFA); veritabanına yine EL olarak yazılır
    { kod: 'EL', ad: 'Avrupa Ligi / UEFA Kupası', slug: 'europa-league', eski: { kod: 'UEFA', slug: 'uefa-cup', sonSezon: 2008 } },
  ];
  const kaynak = (t, sezon) => (t.eski && sezon <= t.eski.sonSezon ? { ...t, kod: t.eski.kod, slug: t.eski.slug, dbKod: t.kod } : { ...t, dbKod: t.kod });
  const BEKLEME = 3000;          // sayfalar arası ms — siteyi yormamak için
  const GUNCEL_YENILE_GUN = 7;   // bu sezonun sayfaları kaç günde bir yeniden çekilsin
  const YEDEK_SIRA = { CL: 5, EL: 8 }; // katılımcı listesi okunamazsa: ligde puan ortalaması sırası bu kadar olan kulüpler denenir

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
  async function sayfaAl(yol, { yoksaNull = false } = {}) {
    for (let deneme = 1; ; deneme++) {
      const r = await fetch(yol);
      const html = await r.text();
      if (r.status === 405 || /Human Verification/i.test(html.slice(0, 3000))) throw new DogrulamaGerekli();
      if (r.ok) return new DOMParser().parseFromString(html, 'text/html');
      if (yoksaNull && r.status === 404) return null;
      if (deneme >= 2 || r.status < 429) throw new Error(`${yol}: HTTP ${r.status}`);
      console.warn(`${yol}: HTTP ${r.status}, 60 sn bekleniyor…`);
      await bekle(60000);
    }
  }
  const kulupIdleri = (kok) => new Set([...kok.querySelectorAll("a[href*='/verein/']")]
    .map((a) => Number(/\/verein\/(\d+)/.exec(a.getAttribute('href'))?.[1])).filter(Boolean));

  // Turnuvaya o sezon katılan kulüpler (grup/lig aşaması ve sonrası)
  async function katilimcilar(t, sezon) {
    const doc = await sayfaAl(`/${t.slug}/teilnehmer/pokalwettbewerb/${t.kod}/saison_id/${sezon}`, { yoksaNull: true });
    const tablolar = doc ? [...doc.querySelectorAll('table.items')] : [];
    const ids = new Set();
    for (const tb of tablolar) for (const id of kulupIdleri(tb)) ids.add(id);
    return ids;
  }

  // Turnuvanın bütün kazananları: satırda "24/25" gibi sezon ve bir kulüp bağlantısı aranır
  async function kazananlar(t) {
    for (const yol of [`/${t.slug}/erfolge/pokalwettbewerb/${t.kod}`, `/${t.slug}/siegerliste/pokalwettbewerb/${t.kod}`]) {
      const doc = await sayfaAl(yol, { yoksaNull: true });
      if (!doc) continue;
      const out = new Map();
      for (const tr of doc.querySelectorAll('table tr')) {
        const m = /(^|\s)(\d{2})\/(\d{2})(\s|$)/.exec(temiz(tr.textContent));
        const a = tr.querySelector("a[href*='/verein/']");
        if (!m || !a) continue;
        const yy = Number(m[2]);
        const sezon = yy >= 50 ? 1900 + yy : 2000 + yy;
        if (sezon < ILK_SEZON || out.has(sezon)) continue;
        out.set(sezon, { turnuva_kod: t.kod, sezon, kulup_id: Number(/\/verein\/(\d+)/.exec(a.getAttribute('href'))[1]),
          kulup_ad: temiz(a.getAttribute('title') || a.textContent) });
      }
      if (out.size) return [...out.values()];
      await bekle(BEKLEME);
    }
    return [];
  }

  // Kulübün bir turnuvadaki sezon istatistikleri (lig_istatistik_konsol.js ile aynı tablo düzeni)
  // Sütunlar: #, Oyuncu, Yaş, Uyruk, Kadroda, Maç, Gol, Asist, Sarı, 2. sarı, Kırmızı, Girdi, Çıktı, Puan ort., Dakika
  async function turnuvaIstatistik(slug, kulupId, turnuva, sezon) {
    const doc = await sayfaAl(`/${slug}/leistungsdaten/verein/${kulupId}/plus/1?reldata=${turnuva}%26${sezon}`);
    const tablo = doc.querySelector('table.items');
    if (!tablo) return null;
    const satirlar = [];
    for (const tr of tablo.querySelectorAll(':scope > tbody > tr')) {
      const td = [...tr.children].filter((e) => e.tagName === 'TD');
      const link = td[1]?.querySelector("td.hauptlink a[href*='/profil/spieler/']");
      if (!link || td.length < 15) continue;
      if (/not in squad/i.test(temiz(td[5].textContent))) continue;
      const kullanilmadi = td[5].colSpan > 1;
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
    return satirlar;
  }

  // ---------- Hazırlık ----------
  console.log('Kulüpler ve daha önce çekilen sayfalar okunuyor…');
  const [kulupRows, ligKulup, ligPpg, cekilenRows] = await Promise.all([
    sbOkuHepsi('kulupler', 'id,ad,slug'),
    sbOkuHepsi('lig_kulupleri', 'lig_kod,sezon,kulup_id'),
    sbOkuHepsi('kulup_turnuvalari', 'kulup_id,sezon,turnuva_kod,mac_basi_puan', '&turnuva_kod=in.(TR1,GB1,ES1,IT1,L1,FR1,PO1,NL1)'),
    sbOkuHepsi('cekilen_sayfalar', 'anahtar,tarih', '&anahtar=like.avrupa*'),
  ]);
  const kulup = new Map(kulupRows.map((k) => [k.id, k]));
  const ligde = new Map(); // sezon -> Set(kulup_id)
  for (const r of ligKulup) (ligde.get(r.sezon) || ligde.set(r.sezon, new Set()).get(r.sezon)).add(r.kulup_id);
  const cekilen = new Map(cekilenRows.map((r) => [r.anahtar, new Date(r.tarih)]));
  const tamamMi = (anahtar, sezon) => {
    const t = cekilen.get(anahtar);
    return !!t && (sezon < BU_SEZON || (Date.now() - t) / 864e5 < GUNCEL_YENILE_GUN);
  };
  async function isaretle(anahtar) {
    await sbYaz('cekilen_sayfalar', [{ anahtar, tarih: new Date().toISOString() }], { cakisma: 'anahtar' });
    cekilen.set(anahtar, new Date());
  }
  // Katılımcı listesi okunamazsa yedek: ligini puan ortalamasıyla ilk N'de bitiren kulüpler
  function yedekKulupler(sezon, n) {
    const lig = new Map(ligKulup.filter((r) => r.sezon === sezon - 1).map((r) => [r.kulup_id, r.lig_kod]));
    const grup = new Map();
    for (const r of ligPpg) if (r.sezon === sezon - 1 && lig.get(r.kulup_id) === r.turnuva_kod && r.mac_basi_puan != null)
      (grup.get(r.turnuva_kod) || grup.set(r.turnuva_kod, []).get(r.turnuva_kod)).push(r);
    const ids = new Set();
    for (const l of grup.values()) l.sort((a, b) => b.mac_basi_puan - a.mac_basi_puan).slice(0, n).forEach((r) => ids.add(r.kulup_id));
    return ids;
  }

  let sayfaSay = 0, satirSay = 0;
  const basla = Date.now();
  try {
    // 1) Kazananlar (turnuva başına tek sayfa)
    for (const t of TURNUVALAR) {
      const anahtar = `avrupa_kazanan:${t.kod}`;
      if (tamamMi(anahtar, BU_SEZON)) continue;
      const k = await kazananlar(t);
      if (k.length) {
        await sbYaz('turnuva_sampiyonlari', k, { cakisma: 'turnuva_kod,sezon' });
        await isaretle(anahtar);
        console.log(`${t.ad}: ${k.length} sezonun kazananı kaydedildi (ör. ${sezonAd(k[0].sezon)} ${k[0].kulup_ad})`);
      } else {
        console.warn(`${t.ad}: kazananlar sayfası okunamadı, bu adım atlandı (istatistikler yine çekilecek).`);
      }
      await bekle(BEKLEME);
    }

    // 2) Sezon sezon katılımcılar ve kadro istatistikleri (en yeni sezondan geriye)
    for (let sezon = BU_SEZON; sezon >= ILK_SEZON; sezon--) {
      for (const t0 of TURNUVALAR) {
        const t = kaynak(t0, sezon);
        const bizim = ligde.get(sezon) || new Set();
        let ids = [...(await katilimcilar(t, sezon))].filter((id) => bizim.has(id) && kulup.has(id));
        sayfaSay++;
        await bekle(BEKLEME);
        if (!ids.length) {
          ids = [...yedekKulupler(sezon, YEDEK_SIRA[t.dbKod])].filter((id) => bizim.has(id) && kulup.has(id));
          console.warn(`${t.ad} ${sezonAd(sezon)}: katılımcı listesi okunamadı, ${ids.length} aday kulüp denenecek.`);
        }
        const kalan = ids.filter((id) => !tamamMi(`avrupa:${t.kod}:${id}:${sezon}`, sezon));
        if (!kalan.length) continue;
        console.log(`%c${t.ad} ${sezonAd(sezon)}: ${ids.length} kulüp (${kalan.length} kaldı)`, 'font-weight:bold');
        for (const id of kalan) {
          const k = kulup.get(id);
          const satirlar = await turnuvaIstatistik(k.slug, id, t.kod, sezon);
          sayfaSay++;
          if (satirlar?.length) {
            await sbYaz('oyuncular', tekil(satirlar.map((s) => s.oyuncu), (o) => o.id), { cakisma: 'id', sadeceYeni: true });
            await sbYaz('oyuncu_turnuvalari', tekil(satirlar.map(({ oyuncu, ...s }) => ({ oyuncu_id: oyuncu.id, kulup_id: id, sezon, turnuva_kod: t.dbKod, ...s })), (s) => s.oyuncu_id),
              { cakisma: 'oyuncu_id,kulup_id,sezon,turnuva_kod' });
            satirSay += satirlar.length;
            const mac = Math.max(0, ...satirlar.map((s) => s.mac));
            console.log(`  ${k.ad}: ${satirlar.length} oyuncu, en çok ${mac} maç, ${satirlar.reduce((a, s) => a + s.gol, 0)} gol`);
          } else {
            console.log(`  ${k.ad}: bu turnuvada maç yok`);
          }
          await isaretle(`avrupa:${t.kod}:${id}:${sezon}`);
          if (sayfaSay % 50 === 0) console.log(`%c${sayfaSay} sayfa · ${Math.round((Date.now() - basla) / 60000)} dk geçti`, 'color:#1f8a52;font-weight:bold');
          await bekle(BEKLEME);
        }
      }
    }
    console.log(`%cAvrupa kupaları tamam ✓ (${sayfaSay} sayfa, ${satirSay} oyuncu satırı)`, 'color:#1f8a52;font-weight:bold;font-size:14px');
    console.log('Şimdi Supabase SQL Editor\'de supabase/avrupa.sql dosyasının sonundaki komutla yazma izinlerini kapatın.');
  } catch (e) {
    if (e instanceof DogrulamaGerekli) {
      console.warn('%cTransfermarkt doğrulama istiyor. Sayfayı yenileyin, doğrulamayı geçin ve kodu tekrar çalıştırın — kaldığı yerden devam eder.', 'color:#c0392b;font-weight:bold');
    } else {
      console.error('Hata:', e);
      console.warn('Kodu tekrar çalıştırırsanız kaldığı yerden devam eder.');
    }
  }
})();

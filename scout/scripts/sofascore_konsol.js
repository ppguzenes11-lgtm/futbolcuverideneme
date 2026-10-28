// Scout — SofaScore maç ve oyuncu verisi (Premier Lig, Süper Lig, Eredivisie; 2016/17'den bugüne).
// Her bitmiş maç için: maç bilgisi + hakem, takım istatistikleri, kadrolar ve oyuncu istatistikleri,
// olaylar (gol/kart/değişiklik dakikaları), eksik oyuncular, teknik direktörler, bahis oranları.
// Kullanım: önce Supabase'de scout/supabase/sofascore.sql çalıştırın. Sonra https://www.sofascore.com açın,
// F12 > Console'a bu kodun tamamını yapıştırıp Enter'a basın. Kaldığı yerden devam eder.
(async () => {
  // ---------- Ayarlar ----------
  const SUPABASE_URL = 'https://oixqyntsoatmerjxltki.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA';
  const LIGLER = [
    { id: 17, ad: 'Premier Lig' },
    { id: 52, ad: 'Süper Lig' },
    { id: 37, ad: 'Eredivisie' },
  ];
  const ILK_SEZON = 2016; // 16/17
  const BEKLEME = 500;    // istekler arası ms — siteyi yormamak için
  const DENEME_MAC = 3;   // deneme modunda çekilecek maç sayısı

  if (!location.hostname.endsWith('sofascore.com')) {
    console.error('Önce https://www.sofascore.com adresini açın, sonra kodu tekrar çalıştırın.');
    return;
  }
  // Ekranı açık tut: bazı dizüstüler ekran kapanınca uykuya geçip interneti keser.
  let kilit = null;
  const ekranKilidi = async () => { try { if (document.visibilityState === 'visible') kilit = await navigator.wakeLock.request('screen'); } catch {} };
  document.addEventListener('visibilitychange', ekranKilidi);
  ekranKilidi();
  const deneme = !confirm('Tam çekim için TAMAM, 3 maçlık deneme için İPTAL düğmesine basın.');

  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  const sayiMi = (v) => typeof v === 'number' && Number.isFinite(v);
  const tarih = (ts) => (sayiMi(ts) ? new Date(ts * 1000).toISOString() : null);
  // '99/00' → 1999, '16/17' → 2016
  const sezonYili = (y) => { const a = Number(y.slice(0, 2)); return a >= 50 ? 1900 + a : 2000 + a; };
  const gun = (ts) => (sayiMi(ts) ? new Date(ts * 1000).toISOString().slice(0, 10) : null);
  const oran = (f) => {
    if (!f) return null;
    const [a, b] = String(f).split('/').map(Number);
    return b ? Math.round((1 + a / b) * 100) / 100 : null;
  };

  // ---------- Supabase ----------
  const SB = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  // Ağ koparsa (bilgisayar uyudu, internet gitti) vazgeçmeden dakikada bir tekrar dener.
  async function agIstek(url, secenek) {
    for (let deneme = 1; ; deneme++) {
      try {
        const r = await fetch(url, secenek);
        if (r.status >= 500 && deneme < 6) { await bekle(30000 * deneme); continue; }
        return r;
      } catch (e) {
        if (deneme === 1) console.warn('İnternet bağlantısı yok; bağlantı gelene kadar dakikada bir denenecek…');
        await bekle(60000);
      }
    }
  }
  async function sbYaz(tablo, satirlar, { cakisma, sadeceYeni = false }) {
    if (!satirlar.length) return;
    const r = await agIstek(`${SUPABASE_URL}/rest/v1/${tablo}?on_conflict=${cakisma}`, {
      method: 'POST',
      headers: { ...SB, Prefer: `resolution=${sadeceYeni ? 'ignore' : 'merge'}-duplicates,return=minimal` },
      body: JSON.stringify(satirlar),
    });
    if (!r.ok) throw new Error(`Supabase (${tablo}) ${r.status}: ${await r.text()}`);
  }
  async function sbOkuHepsi(tablo, sutunlar, filtre = '') {
    const out = [];
    for (let ofs = 0; ; ofs += 1000) {
      const r = await agIstek(`${SUPABASE_URL}/rest/v1/${tablo}?select=${sutunlar}${filtre}&order=${sutunlar.split(',')[0]}&limit=1000&offset=${ofs}`, { headers: SB });
      if (!r.ok) throw new Error(`Supabase (${tablo}) ${r.status}: ${await r.text()}`);
      const sayfa = await r.json();
      out.push(...sayfa);
      if (sayfa.length < 1000) return out;
    }
  }
  const tekil = (satirlar, anahtar) => [...new Map(satirlar.map((r) => [anahtar(r), r])).values()];

  // ---------- SofaScore ----------
  class Durdur extends Error {}
  async function al(yol, { yoksaNull = false } = {}) {
    for (let deneme = 1; ; deneme++) {
      await bekle(BEKLEME);
      const r = await agIstek('/api/v1/' + yol);
      if (r.ok) return r.json();
      if (r.status === 404) {
        if (yoksaNull) return null;
        throw new Error('404 ' + yol);
      }
      if ((r.status === 403 || r.status === 429) && deneme < 6) {
        const sn = 60 * deneme;
        console.warn(`SofaScore ${r.status} verdi (çok hızlı istek olabilir). ${sn} sn bekleniyor…`);
        await bekle(sn * 1000);
        continue;
      }
      if (r.status === 403 || r.status === 429) {
        throw new Durdur(`SofaScore erişimi engelledi (${r.status}). Birkaç saat sonra kodu tekrar çalıştırın; kaldığı yerden devam eder.`);
      }
      throw new Error(`${r.status} ${yol}`);
    }
  }

  // ---------- Başlangıç: mevcut veriler ----------
  let anahtarlar, bitenMaclar, bilinenOyuncular;
  try {
    anahtarlar = (await sbOkuHepsi('ss_anahtarlar', 'sira,anahtar')).sort((a, b) => a.sira - b.sira).map((r) => r.anahtar);
    bitenMaclar = new Set((await sbOkuHepsi('ss_maclar', 'id')).map((r) => r.id));
    bilinenOyuncular = new Set((await sbOkuHepsi('ss_oyuncular', 'id')).map((r) => r.id));
  } catch (e) {
    console.error('Veritabanına bağlanılamadı. sofascore.sql çalıştırıldı mı?', e);
    return;
  }
  const anahtarSira = new Map(anahtarlar.map((a, i) => [a, i + 1]));
  console.log(`Veritabanında ${bitenMaclar.size} maç, ${bilinenOyuncular.size} oyuncu var. ${deneme ? 'DENEME modu.' : 'Tam çekim başlıyor.'}`);

  async function istDizisi(stat) {
    const yeni = [];
    for (const [k, v] of Object.entries(stat)) {
      if (!sayiMi(v) || k === 'minutesPlayed' || k === 'rating' || anahtarSira.has(k)) continue;
      anahtarlar.push(k);
      anahtarSira.set(k, anahtarlar.length);
      yeni.push({ sira: anahtarlar.length, anahtar: k });
    }
    await sbYaz('ss_anahtarlar', yeni, { cakisma: 'sira' });
    const dizi = new Array(anahtarlar.length).fill(null);
    for (const [k, v] of Object.entries(stat)) if (anahtarSira.has(k) && sayiMi(v)) dizi[anahtarSira.get(k) - 1] = v;
    while (dizi.length && dizi[dizi.length - 1] === null) dizi.pop();
    return dizi;
  }

  // ---------- Bir maç ----------
  async function macCek(lig, sezon, ev) {
    const [detay, ist, kadro, olay, hoca, oranlar] = [
      await al(`event/${ev.id}`, { yoksaNull: true }),
      await al(`event/${ev.id}/statistics`, { yoksaNull: true }),
      await al(`event/${ev.id}/lineups`, { yoksaNull: true }),
      await al(`event/${ev.id}/incidents`, { yoksaNull: true }),
      await al(`event/${ev.id}/managers`, { yoksaNull: true }),
      await al(`event/${ev.id}/odds/1/all`, { yoksaNull: true }),
    ];
    const d = detay?.event ?? ev;

    // Takım istatistikleri: {ALL: {cornerKicks: [ev, dep], accuratePasses: [ev, dep, evToplam, depToplam]}, 1ST: …, 2ND: …}
    const istatistik = {};
    for (const p of ist?.statistics ?? []) {
      const per = (istatistik[p.period] = {});
      for (const g of p.groups ?? []) {
        for (const i of g.statisticsItems ?? []) {
          const v = [i.homeValue ?? null, i.awayValue ?? null];
          if (i.homeTotal != null || i.awayTotal != null) v.push(i.homeTotal ?? null, i.awayTotal ?? null);
          per[i.key || i.name] = v;
        }
      }
    }

    const olaylar = (olay?.incidents ?? [])
      .filter((i) => ['goal', 'card', 'substitution', 'varDecision', 'inGamePenalty'].includes(i.incidentType))
      .map((i) => ({
        t: i.incidentType, s: i.incidentClass ?? null, d: i.time ?? null, e: i.addedTime ?? null, h: i.isHome ?? null,
        p: i.player?.id ?? i.playerIn?.id ?? null, a: i.assist1?.id ?? i.playerOut?.id ?? null,
      }));

    const oranSatir = {};
    for (const m of oranlar?.markets ?? []) {
      if (m.isLive) continue;
      oranSatir[m.marketName + (m.choiceGroup ? ' ' + m.choiceGroup : '')] =
        (m.choices ?? []).map((c) => [c.name, oran(c.initialFractionalValue), oran(c.fractionalValue), c.winning ?? null]);
    }

    // Kadrolar ve oyuncular
    const oyuncuSatir = [], yeniOyuncu = new Map(), eksikler = [];
    for (const taraf of ['home', 'away']) {
      const t = kadro?.[taraf];
      if (!t) continue;
      const takimId = taraf === 'home' ? ev.homeTeam.id : ev.awayTeam.id;
      for (const o of t.players ?? []) {
        const p = o.player, s = o.statistics ?? {};
        if (!p?.id) continue;
        if (!bilinenOyuncular.has(p.id)) yeniOyuncu.set(p.id, p);
        if (!s.minutesPlayed) continue;
        oyuncuSatir.push({
          mac_id: ev.id, oyuncu_id: p.id, takim_id: takimId, ev: taraf === 'home', yedek: !!o.substitute, kaptan: !!o.captain,
          mevki: o.position ?? p.position ?? null, forma: Number(o.shirtNumber ?? o.jerseyNumber) || null,
          dakika: s.minutesPlayed, puan: sayiMi(s.rating) ? s.rating : null, ist: await istDizisi(s),
        });
      }
      for (const m of t.missingPlayers ?? []) {
        eksikler.push({ id: m.player?.id ?? null, ad: m.player?.name ?? null, ev: taraf === 'home', tip: m.type ?? null, sebep: m.reason ?? null });
      }
    }

    // Yeni oyuncuların kimlik bilgisi (her oyuncu için bir kez)
    const profiller = [];
    for (const [id, p] of yeniOyuncu) {
      const pr = (await al(`player/${id}`, { yoksaNull: true }))?.player ?? p;
      profiller.push({
        id, ad: pr.name ?? p.name, kisa_ad: pr.shortName ?? p.shortName ?? null, mevki: pr.position ?? p.position ?? null,
        dogum: gun(pr.dateOfBirthTimestamp ?? p.dateOfBirthTimestamp), ulke: pr.country?.name ?? p.country?.name ?? null,
        boy: pr.height ?? p.height ?? null, ayak: pr.preferredFoot ?? null,
      });
    }

    await sbYaz('ss_takimlar', [ev.homeTeam, ev.awayTeam].map((t) => ({ id: t.id, ad: t.name, kisa_ad: t.shortName ?? null })), { cakisma: 'id' });
    await sbYaz('ss_oyuncular', profiller, { cakisma: 'id', sadeceYeni: true });
    await sbYaz('ss_oyuncu_mac', tekil(oyuncuSatir, (r) => r.oyuncu_id), { cakisma: 'mac_id,oyuncu_id' });
    // Maç satırı en son yazılır: varsa maç tamamen çekilmiş demektir.
    const hk = (m) => (m ? { id: m.id, ad: m.name } : null);
    await sbYaz('ss_maclar', [{
      id: ev.id, lig_id: lig.id, sezon_id: sezon.id, sezon: sezon.year, hafta: ev.roundInfo?.round ?? null,
      tur: ev.roundInfo?.slug ?? ev.roundInfo?.name ?? null, tarih: tarih(ev.startTimestamp),
      ev_id: ev.homeTeam.id, dep_id: ev.awayTeam.id,
      ev_gol: ev.homeScore?.current ?? null, dep_gol: ev.awayScore?.current ?? null,
      ev_iy: ev.homeScore?.period1 ?? null, dep_iy: ev.awayScore?.period1 ?? null,
      hakem: hk(d.referee), stadyum: d.venue?.name ?? d.venue?.stadium?.name ?? null, seyirci: d.attendance ?? null,
      ev_hoca: hk(hoca?.homeManager), dep_hoca: hk(hoca?.awayManager),
      ev_dizilis: kadro?.home?.formation ?? null, dep_dizilis: kadro?.away?.formation ?? null,
      istatistik, olaylar, eksikler, oranlar: Object.keys(oranSatir).length ? oranSatir : null,
    }], { cakisma: 'id' });
    profiller.forEach((p) => bilinenOyuncular.add(p.id));
    bitenMaclar.add(ev.id);
    return { oyuncu: oyuncuSatir.length, istSayisi: Object.keys(istatistik.ALL ?? {}).length, oran: Object.keys(oranSatir).length };
  }

  // ---------- Sezonun maçları ----------
  async function sezonMaclari(lig, sezon) {
    const yol = `unique-tournament/${lig.id}/season/${sezon.id}`;
    let turlar = (await al(`${yol}/rounds`, { yoksaNull: true }))?.rounds;
    if (!turlar?.length) turlar = Array.from({ length: 40 }, (_, i) => ({ round: i + 1 }));
    const maclar = new Map();
    for (const t of turlar) {
      const r = await al(`${yol}/events/round/${t.round}${t.slug ? '/slug/' + t.slug : ''}`, { yoksaNull: true });
      for (const e of r?.events ?? []) if (e.status?.type === 'finished') maclar.set(e.id, e);
    }
    return [...maclar.values()].sort((a, b) => a.startTimestamp - b.startTimestamp);
  }

  // ---------- Ana döngü ----------
  let toplam = 0;
  const baslangic = Date.now();
  try {
    for (const lig of LIGLER) {
      const sezonlar = (await al(`unique-tournament/${lig.id}/seasons`)).seasons
        .filter((s) => /^\d\d\/\d\d$/.test(s.year) && sezonYili(s.year) >= ILK_SEZON)
        .sort((a, b) => sezonYili(b.year) - sezonYili(a.year)); // en yeni sezon önce
      for (const sezon of sezonlar) {
        const maclar = await sezonMaclari(lig, sezon);
        const kalan = maclar.filter((m) => !bitenMaclar.has(m.id));
        console.log(`%c${lig.ad} ${sezon.year}: ${maclar.length} bitmiş maç, ${kalan.length} çekilecek`, 'font-weight:bold;color:#2563eb');
        for (const ev of kalan) {
          const s = await macCek(lig, sezon, ev);
          toplam++;
          const dk = Math.round((Date.now() - baslangic) / 60000);
          console.log(`✓ ${ev.homeTeam.name} ${ev.homeScore?.current}-${ev.awayScore?.current} ${ev.awayTeam.name} — ${s.oyuncu} oyuncu, ${s.istSayisi} takım ist., ${s.oran} oran  (bu oturumda ${toplam} maç, ${dk} dk)`);
          if (deneme && toplam >= DENEME_MAC) {
            console.log('%cDENEME BAŞARILI ✅ Veriler veritabanına yazıldı. Tam çekim için kodu tekrar yapıştırıp TAMAM\'a basın.', 'font-weight:bold;color:#16a34a');
            return;
          }
        }
      }
    }
    console.log('%cTAMAMLANDI ✅ Tüm ligler ve sezonlar çekildi. Yeni maçlar için ileride tekrar çalıştırabilirsiniz.', 'font-weight:bold;color:#16a34a');
  } catch (e) {
    if (e instanceof Durdur) console.error(e.message);
    else console.error('Hata — kodu tekrar çalıştırın, kaldığı yerden devam eder:', e);
  }
})();

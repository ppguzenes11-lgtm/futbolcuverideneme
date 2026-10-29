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
  const BEKLEME = 220;    // istekler arası en az ms; SofaScore yavaşla derse kendiliğinden artar
  const AYNI_ANDA = 3;    // aynı anda çekilen maç sayısı
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

  // Zamanlayıcı ayrı bir işçide (Web Worker) çalışır: Chrome arka plandaki ya da ekranı kapalı sekmede normal
  // zamanlayıcıları dakikada bire kadar yavaşlatır, işçidekileri yavaşlatmaz. Kod bu yüzden "duruyor" gibi görünüyordu.
  const isci = new Worker(URL.createObjectURL(new Blob(['onmessage=(e)=>setTimeout(()=>postMessage(e.data[0]),e.data[1])'], { type: 'text/javascript' })));
  const bekleyen = new Map();
  let bekleNo = 0;
  isci.onmessage = (e) => { bekleyen.get(e.data)?.(); bekleyen.delete(e.data); };
  const bekle = (ms) => new Promise((r) => { const n = ++bekleNo; bekleyen.set(n, r); isci.postMessage([n, ms]); });
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

  // {"Match goals 2.5": [[seçenek, açılış oranı, güncel oran, tuttu mu], …], …}
  const oranAyikla = (oranlar) => {
    const out = {};
    for (const m of oranlar?.markets ?? []) {
      if (m.isLive) continue;
      out[m.marketName + (m.choiceGroup ? ' ' + m.choiceGroup : '')] =
        (m.choices ?? []).map((c) => [c.name, oran(c.initialFractionalValue), oran(c.fractionalValue), c.winning ?? null]);
    }
    return out;
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
  // Hız sınırlayıcı: istekler arasında en az "aralik" ms. SofaScore 403/429 derse aralık büyür, istekler geçtikçe küçülür.
  let aralik = BEKLEME, sonIstek = 0, engelSayac = 0;
  async function sira() {
    const simdi = Date.now();
    const bekleme = Math.max(0, sonIstek + aralik - simdi);
    sonIstek = Math.max(simdi, sonIstek + aralik);
    if (bekleme) await bekle(bekleme);
  }
  async function al(yol, { yoksaNull = false } = {}) {
    for (let deneme = 1; ; deneme++) {
      await sira();
      const r = await agIstek('/api/v1/' + yol);
      if (r.ok) { aralik = Math.max(BEKLEME, aralik * 0.98); engelSayac = 0; return r.json(); }
      if (r.status === 404) {
        if (yoksaNull) return null;
        throw new Error('404 ' + yol);
      }
      if (r.status === 403 || r.status === 429) {
        // Vazgeçmez: önce yavaşlar, üst üste engellenirse giderek uzun bekler (en çok 15 dk), sonra devam eder
        engelSayac++;
        aralik = Math.min(3000, aralik * 2);
        const dk = Math.min(15, engelSayac);
        console.warn(`SofaScore ${r.status} verdi; yavaşlıyorum. ${dk} dk beklenip devam edilecek…`);
        await bekle(dk * 60000);
        continue;
      }
      if (deneme < 4) { await bekle(5000 * deneme); continue; }
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
    const [detay, ist, kadro, olay, hoca, oranlar] = await Promise.all(
      ['', '/statistics', '/lineups', '/incidents', '/managers', '/odds/1/all'].map((u) => al(`event/${ev.id}${u}`, { yoksaNull: true })));
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

    const oranSatir = oranAyikla(oranlar);

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
    const profilVeri = await Promise.all([...yeniOyuncu.keys()].map((id) => al(`player/${id}`, { yoksaNull: true })));
    const profiller = [];
    for (const [k, [id, p]] of [...yeniOyuncu].entries()) {
      const pr = profilVeri[k]?.player ?? p;
      profiller.push({
        id, ad: pr.name ?? p.name, kisa_ad: pr.shortName ?? p.shortName ?? null, mevki: pr.position ?? p.position ?? null,
        dogum: gun(pr.dateOfBirthTimestamp ?? p.dateOfBirthTimestamp), ulke: pr.country?.name ?? p.country?.name ?? null,
        boy: pr.height ?? p.height ?? null, ayak: pr.preferredFoot ?? null,
      });
    }

    await Promise.all([
      sbYaz('ss_takimlar', [ev.homeTeam, ev.awayTeam].map((t) => ({ id: t.id, ad: t.name, kisa_ad: t.shortName ?? null })), { cakisma: 'id' }),
      sbYaz('ss_oyuncular', profiller, { cakisma: 'id', sadeceYeni: true }),
      sbYaz('ss_oyuncu_mac', tekil(oyuncuSatir, (r) => r.oyuncu_id), { cakisma: 'mac_id,oyuncu_id' }),
    ]);
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

  // ---------- Fikstür (yaklaşan maçlar) ----------
  const guncelSezon = async (lig) => (await al(`unique-tournament/${lig.id}/seasons`)).seasons
    .filter((s) => /^\d\d\/\d\d$/.test(s.year)).sort((a, b) => sezonYili(b.year) - sezonYili(a.year))[0];
  // ss_fikstur'da oran sütunu var mı (fikstur.sql'in son iki satırı çalıştırıldı mı)
  let oranSutunu = null;
  async function fiksturGuncelle() {
    try {
      if (oranSutunu === null) {
        oranSutunu = (await agIstek(`${SUPABASE_URL}/rest/v1/ss_fikstur?select=oranlar&limit=1`, { headers: SB })).ok;
        if (!oranSutunu) console.warn('Yaklaşan maç oranları çekilmeyecek: Supabase\'de scout/supabase/fikstur.sql dosyasının son iki satırını çalıştırın.');
      }
      let n = 0, m = 0;
      for (const lig of LIGLER) {
        const sz = await guncelSezon(lig);
        const r = await al(`unique-tournament/${lig.id}/season/${sz.id}/events/next/0`, { yoksaNull: true });
        const satir = [];
        for (const e of (r?.events ?? []).filter((x) => x.status?.type !== 'finished')) {
          // Hakem genelde maçtan 1-2 gün önce açıklanır; yalnızca 3 gün içindeki maçlar için bakılır
          let hakem = null;
          if (e.startTimestamp * 1000 - Date.now() < 3 * 86400000) {
            const ref = (await al(`event/${e.id}`, { yoksaNull: true }))?.event?.referee;
            if (ref) hakem = { id: ref.id, ad: ref.name };
          }
          // Gerçek kupon modu için oranlar: 7 gün içindeki, başlamamış maçlar
          let oranlar = null;
          if (oranSutunu && e.status?.type === 'notstarted' && e.startTimestamp * 1000 - Date.now() < 7 * 86400000) {
            const o = oranAyikla(await al(`event/${e.id}/odds/1/all`, { yoksaNull: true }));
            if (Object.keys(o).length) oranlar = o;
          }
          satir.push({
            id: e.id, lig_id: lig.id, sezon_id: sz.id, sezon: sz.year, hafta: e.roundInfo?.round ?? null, tarih: tarih(e.startTimestamp),
            ev_id: e.homeTeam.id, ev_ad: e.homeTeam.name, dep_id: e.awayTeam.id, dep_ad: e.awayTeam.name,
            durum: e.status?.type ?? null, hakem, guncellendi: new Date().toISOString(),
            ...(oranSutunu ? { oranlar, oran_guncellendi: oranlar ? new Date().toISOString() : null } : {}),
          });
        }
        await sbYaz('ss_fikstur', satir, { cakisma: 'id' });
        n += satir.length;
        m += satir.filter((x) => x.oranlar).length;
      }
      console.log(`%cFikstür güncellendi: ${n} yaklaşan maç${oranSutunu ? ` (${m} maçın oranı alındı)` : ''}`, 'color:#2563eb');
    } catch (e) {
      console.warn('Fikstür güncellenemedi (scout/supabase/fikstur.sql çalıştırıldı mı?):', e.message);
    }
  }

  // ---------- Ana döngü ----------
  // Sezonlar liglere karışık ve yeniden eskiye çekilir (26/27'nin üç ligi, sonra 25/26'nın üç ligi…): her ligin yakın
  // sezonları erken gelir. Bir maçta hata olursa çekim durmaz; o maç sona bırakılıp yeniden denenir.
  let toplam = 0, hata = 0;
  const baslangic = Date.now();
  let sonFikstur = 0;
  const fiksturZamani = async () => {
    if (Date.now() - sonFikstur > 3 * 3600000) { sonFikstur = Date.now(); await fiksturGuncelle(); }
  };
  const durum = () => {
    const dk = Math.max(1, Math.round((Date.now() - baslangic) / 60000));
    return `bu oturumda ${toplam} maç, ${dk} dk (dakikada ${(toplam / dk).toFixed(1)} maç)${hata ? `, ${hata} hata (sona bırakıldı)` : ''}`;
  };
  async function maclariCek(lig, sezon, liste) {
    const kuyruk = [...liste];
    const tekrar = [];
    const isle = async () => {
      for (let ev = kuyruk.shift(); ev; ev = kuyruk.shift()) {
        await fiksturZamani();
        try {
          const s = await macCek(lig, sezon, ev);
          toplam++;
          console.log(`✓ ${ev.homeTeam.name} ${ev.homeScore?.current}-${ev.awayScore?.current} ${ev.awayTeam.name} — ${s.oyuncu} oyuncu, ${s.oran} oran  (${durum()})`);
          if (toplam % 300 === 0) { console.clear(); console.log(`%cKonsol temizlendi (yavaşlamasın diye). ${durum()}`, 'color:#2563eb'); }
        } catch (e) {
          hata++;
          tekrar.push(ev);
          console.warn(`Maç atlandı, sonra tekrar denenecek: ${ev.homeTeam.name} – ${ev.awayTeam.name} (${e.message})`);
        }
        if (deneme && toplam >= DENEME_MAC) return;
      }
    };
    await Promise.all(Array.from({ length: AYNI_ANDA }, isle));
    return tekrar;
  }

  for (let tur = 1; ; tur++) {
    try {
      if (deneme) {
        const lig = LIGLER[0];
        const sz = await guncelSezon(lig);
        const kalan = (await sezonMaclari(lig, sz)).filter((m) => !bitenMaclar.has(m.id)).slice(0, DENEME_MAC);
        await maclariCek(lig, sz, kalan);
        console.log('%cDENEME BAŞARILI ✅ Veriler veritabanına yazıldı. Tam çekim için kodu tekrar yapıştırıp TAMAM\'a basın.', 'font-weight:bold;color:#16a34a');
        return;
      }
      await fiksturZamani();
      const isler = [];
      for (const lig of LIGLER) {
        const sezonlar = (await al(`unique-tournament/${lig.id}/seasons`)).seasons
          .filter((s) => /^\d\d\/\d\d$/.test(s.year) && sezonYili(s.year) >= ILK_SEZON);
        sezonlar.forEach((sezon) => isler.push({ lig, sezon }));
      }
      isler.sort((a, b) => sezonYili(b.sezon.year) - sezonYili(a.sezon.year) || LIGLER.indexOf(a.lig) - LIGLER.indexOf(b.lig));
      let geriKalan = [];
      for (const { lig, sezon } of isler) {
        const maclar = await sezonMaclari(lig, sezon);
        const kalan = maclar.filter((m) => !bitenMaclar.has(m.id));
        console.log(`%c${lig.ad} ${sezon.year}: ${maclar.length} bitmiş maç, ${kalan.length} çekilecek`, 'font-weight:bold;color:#2563eb');
        const t = await maclariCek(lig, sezon, kalan);
        geriKalan.push(...t.map((ev) => ({ lig, sezon, ev })));
      }
      // Hatalı maçlar: bir kez daha
      for (const { lig, sezon, ev } of geriKalan) {
        try { await macCek(lig, sezon, ev); toplam++; } catch (e) { console.warn('Yine olmadı, sonraki turda denenecek:', ev.id, e.message); }
      }
      console.log(`%cTAMAMLANDI ✅ Bütün ligler ve sezonlar çekildi (${durum()}). Sayfa açık kaldıkça takip sürer: 3 saatte bir yeni biten maçlar ve yaklaşan maçların oranları alınır.`, 'font-weight:bold;color:#16a34a');
      // ---------- Takip: yeni biten maçlar + fikstür/oranlar ----------
      for (;;) {
        await bekle(Math.max(60000, 3 * 3600000 - (Date.now() - sonFikstur)));
        for (const lig of LIGLER) {
          const sz = await guncelSezon(lig);
          const son = (await al(`unique-tournament/${lig.id}/season/${sz.id}/events/last/0`, { yoksaNull: true }))?.events ?? [];
          await maclariCek(lig, sz, son.filter((x) => x.status?.type === 'finished' && !bitenMaclar.has(x.id)));
        }
        await fiksturZamani();
      }
    } catch (e) {
      // Beklenmedik hata: çekim durmaz, 1 dakika sonra kaldığı yerden yeniden başlar
      console.error(`Hata (${tur}. tur) — 1 dakika sonra kaldığı yerden devam edilecek:`, e);
      await bekle(60000);
    }
  }
})();

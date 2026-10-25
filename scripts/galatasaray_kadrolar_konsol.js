// Galatasaray kadroları (2000/01 → bugün) — Transfermarkt'tan çekip Supabase'e yazar.
// Kullanım: bilgisayarda https://www.transfermarkt.com sayfasını açın, F12 > Console'a bu kodun tamamını yapıştırıp Enter'a basın.
(async () => {
  const SUPABASE_URL = 'https://oixqyntsoatmerjxltki.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_She16NlbAEODVuBv9DqfIw_5AfTJ9pA';
  const KULUP_ID = 141; // Galatasaray
  const BAS = 2000;
  const bugun = new Date();
  const BIT = bugun.getMonth() >= 6 ? bugun.getFullYear() : bugun.getFullYear() - 1;
  const BEKLEME = 3000; // sayfalar arası ms — siteyi yormamak için

  if (location.hostname !== 'www.transfermarkt.com') {
    console.error('Önce https://www.transfermarkt.com adresini açın (transfermarkt.com.tr değil), sonra kodu tekrar çalıştırın.');
    return;
  }

  const temiz = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const bekle = (ms) => new Promise((r) => setTimeout(r, ms));
  const AYLAR = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

  // '€1.50m' -> 1500000, '€500k' -> 500000
  const degerEur = (m) => {
    const x = /€\s*([\d.,]+)\s*(bn|m|k|Th\.)?/.exec(m || '');
    if (!x) return null;
    return Math.round(parseFloat(x[1].replace(/,/g, '')) * ({ bn: 1e9, m: 1e6, k: 1e3, 'Th.': 1e3 }[x[2]] || 1));
  };
  // 'Jun 16, 1986 (40)' -> ['1986-06-16', 40]
  const dogum = (m) => {
    const yas = /\((\d+)\)/.exec(m || '');
    const t = temiz((m || '').replace(/\(.*?\)/g, ''));
    const x = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/.exec(t);
    return [x ? `${x[3]}-${AYLAR[x[1]]}-${x[2].padStart(2, '0')}` : (t || null), yas ? Number(yas[1]) : null];
  };

  async function sezonCek(sezon) {
    const r = await fetch(`/galatasaray/kader/verein/${KULUP_ID}/saison_id/${sezon}/plus/1`);
    if (!r.ok) throw new Error(`${sezon}: HTTP ${r.status}`);
    const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
    const tablo = doc.querySelector('table.items');
    if (!tablo) throw new Error(`${sezon}: kadro tablosu bulunamadı (sayfayı yenileyip doğrulamayı geçin, sonra tekrar deneyin)`);
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
      const ic = tr.querySelectorAll('table.inline-table tr');
      const no = temiz(tr.querySelector('div.rn_nummer')?.textContent);
      const [dogumTarihi, yas] = dogum(yazi(bul('Date of birth', 'birth')));
      const uyruk = [...(bul('Nat')?.querySelectorAll('img[title]') || [])].map((i) => i.title).join(', ');
      const deger = yazi(tr.querySelector('td.rechts.hauptlink'));
      satirlar.push({
        sezon,
        sezon_ad: `${sezon}/${String(sezon + 1).slice(-2)}`,
        oyuncu_id: Number(/\/spieler\/(\d+)/.exec(link.getAttribute('href'))[1]),
        ad: temiz(link.textContent),
        forma_no: no && no !== '-' ? no : null,
        mevki: ic[1] ? temiz(ic[1].textContent) : null,
        dogum_tarihi: dogumTarihi,
        yas,
        uyruk: uyruk || null,
        boy: yazi(bul('Height')),
        ayak: yazi(bul('Foot')),
        katilma_tarihi: yazi(bul('Joined')),
        geldigi_kulup: bul('Signed from')?.querySelector('a[title]')?.title || null,
        sozlesme_bitis: yazi(bul('Contract')),
        piyasa_degeri: deger && deger !== '-' ? deger : null,
        piyasa_degeri_eur: degerEur(deger),
        profil_url: `https://www.transfermarkt.com${link.getAttribute('href')}`,
      });
    }
    return satirlar;
  }

  function dosyaIndir(ad, icerik, tip) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([icerik], { type: tip }));
    a.download = ad;
    a.click();
  }

  const hepsi = [];
  for (let s = BAS; s <= BIT; s++) {
    try {
      const satirlar = await sezonCek(s);
      hepsi.push(...satirlar);
      console.log(`${s}/${String(s + 1).slice(-2)}: ${satirlar.length} oyuncu`);
    } catch (e) {
      console.error(e.message);
      if (!hepsi.length) return;
      console.warn('Durduruldu; o ana kadar çekilenler kaydedilecek.');
      break;
    }
    await bekle(BEKLEME);
  }
  console.log(`Toplam ${hepsi.length} satır çekildi.`);

  // Her ihtimale karşı CSV olarak da indir (Supabase > Table Editor > Import data from CSV ile yüklenebilir)
  const sutunlar = Object.keys(hepsi[0]);
  const csv = [sutunlar.join(','), ...hepsi.map((r) => sutunlar.map((k) => (r[k] == null ? '' : `"${String(r[k]).replace(/"/g, '""')}"`)).join(','))].join('\n');
  dosyaIndir('galatasaray_kadrolar.csv', '﻿' + csv, 'text/csv');

  try {
    for (let i = 0; i < hepsi.length; i += 500) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/galatasaray_kadrolar?on_conflict=sezon,oyuncu_id`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(hepsi.slice(i, i + 500)),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    }
    console.log(`%cSupabase: ${hepsi.length} satır yazıldı. Bitti ✓`, 'color:green;font-weight:bold');
  } catch (e) {
    console.error(`Supabase'e yazılamadı (${e.message}). İndirilen galatasaray_kadrolar.csv dosyasını Supabase > Table Editor > galatasaray_kadrolar > Import data from CSV ile yükleyebilirsiniz.`);
  }
})();

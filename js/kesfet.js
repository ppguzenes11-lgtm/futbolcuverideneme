// Keşfet: rekorlar, unvanlar ve ligler arası karşılaştırmalar.
// İstatistikler scripts/kesfet_uret.py ile önceden hesaplanıp veri/kesfet.json'a yazılır.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sayi = (n) => Number(n || 0).toLocaleString('tr-TR');
const sezonAd = (s) => `${s}/${String(Number(s) + 1).slice(-2)}`;
const mn = (n) => `€${(n / 1e6).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} mn`;
const LIG_SIRA = ['TR1', 'GB1', 'ES1', 'IT1', 'L1', 'FR1', 'PO1', 'NL1'];
const ULKE_TR = {
  Brazil: 'Brezilya', Argentina: 'Arjantin', France: 'Fransa', Spain: 'İspanya', Germany: 'Almanya', Italy: 'İtalya', Portugal: 'Portekiz',
  Netherlands: 'Hollanda', England: 'İngiltere', Belgium: 'Belçika', Senegal: 'Senegal', Nigeria: 'Nijerya', Cameroon: 'Kamerun',
  "Cote d'Ivoire": 'Fildişi Sahili', Uruguay: 'Uruguay', Colombia: 'Kolombiya', Croatia: 'Hırvatistan', Serbia: 'Sırbistan', Poland: 'Polonya',
  Denmark: 'Danimarka', Sweden: 'İsveç', Norway: 'Norveç', Ghana: 'Gana', Mali: 'Mali', Morocco: 'Fas', Algeria: 'Cezayir', Türkiye: 'Türkiye',
  Austria: 'Avusturya', Switzerland: 'İsviçre', 'Czech Republic': 'Çekya', Greece: 'Yunanistan', Chile: 'Şili', Mexico: 'Meksika', 'United States': 'ABD',
  Japan: 'Japonya', 'Korea, South': 'Güney Kore', Bosnia: 'Bosna', 'Bosnia-Herzegovina': 'Bosna-Hersek', Romania: 'Romanya', Slovenia: 'Slovenya',
  Paraguay: 'Paraguay', Ecuador: 'Ekvador', Peru: 'Peru', Venezuela: 'Venezuela', 'DR Congo': 'Kongo DC', Guinea: 'Gine', Tunisia: 'Tunus',
  Ukraine: 'Ukrayna', Russia: 'Rusya', Georgia: 'Gürcistan', Scotland: 'İskoçya', Wales: 'Galler', Ireland: 'İrlanda', Iceland: 'İzlanda',
  Finland: 'Finlandiya', Hungary: 'Macaristan', Slovakia: 'Slovakya', 'North Macedonia': 'Kuzey Makedonya', Albania: 'Arnavutluk', Kosovo: 'Kosova',
  Montenegro: 'Karadağ', Israel: 'İsrail', Iran: 'İran', Australia: 'Avustralya', Canada: 'Kanada', 'Cape Verde': 'Yeşil Burun', Angola: 'Angola',
  Zambia: 'Zambiya', Egypt: 'Mısır', Gabon: 'Gabon', Togo: 'Togo', Burkina: 'Burkina Faso', 'Burkina Faso': 'Burkina Faso', Suriname: 'Surinam', Curacao: 'Curaçao',
};
const ulke = (u) => ULKE_TR[u] || u;

let veri = null;
async function yukle() {
  if (!veri) {
    const r = await fetch('veri/kesfet.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Keşfet verisi yüklenemedi (${r.status})`);
    veri = await r.json();
  }
  return veri;
}

// ---------- Küçük yapı taşları ----------
const kart = (baslik, aciklama, govde, genis = false) => `
  <section class="kesfet-kart${genis ? ' genis' : ''}">
    <h3>${baslik}</h3>${aciklama ? `<p class="not">${aciklama}</p>` : ''}
    ${govde}
  </section>`;

/** Sıralı liste: her satırda değere göre çubuk (tek renk), solda sıra, ortada ad + alt bilgi, sağda değer */
function cubukListe(satirlar, { deger, etiket, alt, id }) {
  const max = Math.max(...satirlar.map(deger), 1);
  return `<ol class="cubuk-liste">${satirlar.map((s, i) => `
    <li${id && id(s) != null ? ` data-oyuncu="${id(s)}" tabindex="0"` : ''}>
      <span class="sira">${i + 1}</span>
      <div class="cl-govde">
        <div class="cl-ust"><b>${esc(etiket(s))}</b><span class="cl-deger">${alt.deger(s)}</span></div>
        <div class="cl-cubuk"><i style="width:${Math.max(2, (deger(s) / max) * 100)}%"></i></div>
        ${alt.metin ? `<small>${alt.metin(s)}</small>` : ''}
      </div>
    </li>`).join('')}</ol>`;
}

// ---------- Ligler yıllara göre (çizgi grafik: seçili lig vurgulu, diğerleri gri) ----------
const METRIK = {
  golMac: { ad: 'Maç başı gol', kisa: 'Gol/maç', bicim: (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) },
  yas: { ad: 'Ortalama yaş', kisa: 'Yaş ort.', bicim: (v) => v.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) },
  yabanci: { ad: 'Yabancı oyuncu oranı', kisa: 'Yabancı %', bicim: (v) => `%${v.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}` },
};
let seciliMetrik = 'golMac';

function trendGrafik(v, lig, genislik) {
  const m = METRIK[seciliMetrik];
  const seriler = LIG_SIRA.filter((l) => v.trend[l]).map((l) => ({
    lig: l, noktalar: Object.entries(v.trend[l]).map(([s, d]) => [Number(s), d[seciliMetrik]]).filter(([, y]) => y != null).sort((a, b) => a[0] - b[0]),
  }));
  const tumX = seriler.flatMap((s) => s.noktalar.map((n) => n[0]));
  const tumY = seriler.flatMap((s) => s.noktalar.map((n) => n[1]));
  const x0 = Math.min(...tumX); const x1 = Math.max(...tumX);
  let y0 = Math.min(...tumY); let y1 = Math.max(...tumY);
  const pay = (y1 - y0) * 0.08; y0 -= pay; y1 += pay;
  // Grafik kutunun gerçek genişliğinde çizilir: yazılar telefonda da okunur boyutta kalır
  const W = Math.max(300, Math.round(genislik || 720)); const H = W < 500 ? 220 : 260; const sol = 44; const sag = 12; const ust = 12; const alt = 26;
  const px = (x) => sol + ((x - x0) / (x1 - x0)) * (W - sol - sag);
  const py = (y) => ust + (1 - (y - y0) / (y1 - y0)) * (H - ust - alt);
  const yol = (n) => n.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)},${py(y).toFixed(1)}`).join('');
  const izgara = Array.from({ length: 4 }, (_, i) => y0 + ((i + 0.5) / 4) * (y1 - y0));
  const yillar = [];
  const adim = W < 500 ? 10 : 5;
  for (let x = Math.ceil(x0 / adim) * adim; x <= x1; x += adim) yillar.push(x);
  const secili = seriler.find((s) => s.lig === lig);
  return `
    <div class="trend-ust">
      <div class="segment" role="tablist">${Object.entries(METRIK).map(([k, d]) => `<button class="${k === seciliMetrik ? 'aktif' : ''}" data-metrik="${k}" title="${d.ad}">${d.kisa}</button>`).join('')}</div>
      <div class="lejant"><span class="lj-cizgi vurgu"></span>${esc(v.ligler[lig]?.ad || lig)} <span class="lj-cizgi gri"></span>Diğer ligler</div>
    </div>
    <div class="trend-kutu">
      <svg viewBox="0 0 ${W} ${H}" width="${W}" class="trend" role="img" aria-label="${esc(m.ad)} — yıllara göre">
        ${izgara.map((y) => `<line x1="${sol}" x2="${W - sag}" y1="${py(y)}" y2="${py(y)}" class="izgara"/><text x="${sol - 6}" y="${py(y) + 4}" class="eksen" text-anchor="end">${esc(m.bicim(y))}</text>`).join('')}
        ${yillar.map((x) => `<text x="${px(x)}" y="${H - 6}" class="eksen" text-anchor="middle">${x}</text>`).join('')}
        ${seriler.filter((s) => s.lig !== lig).map((s) => `<path d="${yol(s.noktalar)}" class="seri gri"/>`).join('')}
        ${secili ? `<path d="${yol(secili.noktalar)}" class="seri vurgu"/>` : ''}
        <line class="imlec" y1="${ust}" y2="${H - alt}" style="display:none"/>
        <circle class="imlec-nokta" r="5" style="display:none"/>
        <rect class="hedef" x="${sol}" y="0" width="${W - sol - sag}" height="${H}" fill="transparent"/>
      </svg>
      <div class="ipucu" style="display:none"></div>
    </div>
    <details class="tablo-gor"><summary>Tablo olarak gör</summary>
      <div class="tablo-kaydir"><table><thead><tr><th>Sezon</th>${seriler.map((s) => `<th class="sag">${esc(s.lig)}</th>`).join('')}</tr></thead>
      <tbody>${[...new Set(tumX)].sort((a, b) => b - a).map((x) => `<tr><td>${sezonAd(x)}</td>${seriler.map((s) => { const n = s.noktalar.find((p) => p[0] === x); return `<td class="sag">${n ? esc(m.bicim(n[1])) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    </details>
    <script type="application/json" class="trend-veri">${JSON.stringify({ x0, x1, y0, y1, sol, sag, ust, alt, W, H, seriler: seriler.map((s) => [s.lig, s.noktalar]) })}</script>`;
}

function trendEtkilesim(kok, v, lig) {
  const svg = kok.querySelector('svg.trend');
  if (!svg) return;
  const d = JSON.parse(kok.querySelector('.trend-veri').textContent);
  const m = METRIK[seciliMetrik];
  const ipucu = kok.querySelector('.ipucu');
  const imlec = svg.querySelector('.imlec'); const nokta = svg.querySelector('.imlec-nokta');
  const vb = svg.viewBox.baseVal;
  const goster = (ev) => {
    const r = svg.getBoundingClientRect();
    const xVb = ((ev.clientX - r.left) / r.width) * vb.width;
    const yil = Math.round(d.x0 + ((xVb - d.sol) / (d.W - d.sol - d.sag)) * (d.x1 - d.x0));
    if (yil < d.x0 || yil > d.x1) return;
    const degerler = d.seriler.map(([l, n]) => [l, n.find((p) => p[0] === yil)?.[1]]).filter(([, y]) => y != null).sort((a, b) => b[1] - a[1]);
    const xPx = d.sol + ((yil - d.x0) / (d.x1 - d.x0)) * (d.W - d.sol - d.sag);
    imlec.setAttribute('x1', xPx); imlec.setAttribute('x2', xPx); imlec.style.display = '';
    const sec = d.seriler.find(([l]) => l === lig)?.[1].find((p) => p[0] === yil);
    const yPx = sec ? d.ust + (1 - (sec[1] - d.y0) / (d.y1 - d.y0)) * (d.H - d.ust - d.alt) : null;
    if (yPx != null) { nokta.setAttribute('cx', xPx); nokta.setAttribute('cy', yPx); nokta.style.display = ''; } else nokta.style.display = 'none';
    ipucu.innerHTML = `<b>${sezonAd(yil)}</b>${degerler.map(([l, y]) => `<div class="${l === lig ? 'vurgu' : ''}"><span>${esc(v.ligler[l]?.ad || l)}</span><span>${esc(m.bicim(y))}</span></div>`).join('')}`;
    ipucu.style.display = '';
    const kutu = kok.querySelector('.trend-kutu').getBoundingClientRect();
    const sola = ev.clientX - kutu.left > kutu.width / 2;
    ipucu.style.left = sola ? '' : `${ev.clientX - kutu.left + 14}px`;
    ipucu.style.right = sola ? `${kutu.right - ev.clientX + 14}px` : '';
  };
  const gizle = () => { ipucu.style.display = 'none'; imlec.style.display = 'none'; nokta.style.display = 'none'; };
  const hedef = svg.querySelector('.hedef');
  hedef.addEventListener('pointermove', goster);
  hedef.addEventListener('pointerdown', goster);
  hedef.addEventListener('pointerleave', gizle);
}

// ---------- Sayfa ----------
export async function kesfetGoster(el, lig, { oyuncuDetay, ozetEl }) {
  el.innerHTML = '<div class="bilgi">Yükleniyor…</div>';
  const v = await yukle();
  const ligAd = v.ligler[lig]?.ad || lig;
  const rek = v.ligRekor.find((r) => r.lig === lig);
  const kulupS = v.kulupSampiyon[lig] || [];
  const fab = v.fabrika[lig] || [];
  const oyuncuId = (s) => s.id;
  const sonDeger = v.degerKapsami.length ? `${sezonAd(v.degerKapsami[0])} – ${sezonAd(v.degerKapsami[v.degerKapsami.length - 1])}` : '';
  ozetEl.innerHTML = '';

  el.innerHTML = `
    <div class="kesfet">
      <h2 class="kesfet-baslik">${esc(ligAd)}</h2>
      <div class="kesfet-izgara">
        ${kart('Ligler yıllara göre', 'Seçili lig yeşil, diğer yedi lig gri. Grafiğin üzerinde gezinin: o sezonun bütün değerleri.', '<div class="trend-yer"></div>', true)}
        ${rek ? kart(`${esc(ligAd)} · tüm zamanların golcüleri`, '2000/01\'den bugüne yalnızca lig golleri.', cubukListe(rek.tumZaman, { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.gol} gol` } })) : ''}
        ${rek ? kart(`${esc(ligAd)} · tek sezon gol rekoru`, 'Bir sezonda atılan en çok lig golü.', cubukListe(rek.tekSezon, { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.gol} gol`, metin: (s) => `${sezonAd(s.sezon)} · ${esc(s.kulup)}` } })) : ''}
        ${kulupS.length ? kart(`${esc(ligAd)} · şampiyonluklar`, 'Puan ortalamasından hesaplandı; eşitlikte atılan gole bakılır.', cubukListe(kulupS, { deger: (s) => s.sayi, etiket: (s) => s.kulup, alt: { deger: (s) => `${s.sayi} kez`, metin: (s) => s.sezonlar.map(sezonAd).join(', ') } })) : ''}
        ${(v.ligTransfer?.[lig] || []).length ? kart(`${esc(ligAd)} · en pahalı transferler`, 'Lige gelen oyuncular için ödenen en yüksek bonservisler.', cubukListe(v.ligTransfer[lig], { deger: (s) => s.bedel, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => mn(s.bedel), metin: (s) => `${esc(s.nereden)} → ${esc(s.nereye)} · ${sezonAd(s.sezon)}` } })) : ''}
        ${(v.ligHarcayan?.[lig] || []).length ? kart(`${esc(ligAd)} · en çok harcayan kulüpler`, '2000\'den bu yana bilinen bonservislerin toplamı.', cubukListe(v.ligHarcayan[lig], { deger: (s) => s.toplam, etiket: (s) => s.kulup, alt: { deger: (s) => mn(s.toplam) } })) : ''}
        ${fab.length ? kart(`${esc(ligAd)} · gol fabrikası ülkeler`, 'Ligde en çok gol atan yabancı uyruklar (oyuncunun ilk uyruğu).', cubukListe(fab, { deger: (s) => s.gol, etiket: (s) => ulke(s.ulke), alt: { deger: (s) => `${sayi(s.gol)} gol` } })) : ''}
      </div>

      <h2 class="kesfet-baslik">8 ligin tamamı</h2>
      <div class="kesfet-izgara">
        ${kart('Tüm zamanların golcüleri', '8 lig toplamı, sadece lig golleri.', cubukListe(v.golcuOlar.slice(0, 12), { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.gol} gol`, metin: (s) => `${s.mac} maç · ${s.kulup} kulüp` } }))}
        ${kart('Dakika başına golcüler', 'En az 40 lig golü atanlar arasında, kaç dakikada bir gol attıkları.', cubukListe(v.dakikaGol.slice(0, 10), { deger: (s) => 1 / s.dakikaBasina, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.dakikaBasina} dk'da bir`, metin: (s) => `${s.gol} gol` } }))}
        ${kart('Süper yedekler', 'Ağırlıkla yedekten girdiği sezonlarda attığı goller.', cubukListe(v.superYedek.slice(0, 10), { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.gol} gol`, metin: (s) => `${s.oyunaGirdi} kez oyuna sonradan girdi` } }))}
        ${kart('Demir adamlar', 'Ligde en çok dakika oynayanlar.', cubukListe(v.demirAdam.slice(0, 10), { deger: (s) => s.dakika, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${sayi(s.dakika)} dk`, metin: (s) => `${s.mac} maç · ${(s.dakika / 1440).toLocaleString('tr-TR', { maximumFractionDigits: 0 })} gün sahada` } }))}
        ${kart('Kart rekortmenleri', 'Sarılar + kırmızılar (kırmızı 3 sarı sayıldı).', cubukListe(v.kart.slice(0, 10), { deger: (s) => s.sari + 3 * s.kirmizi, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `🟨${s.sari} 🟥${s.kirmizi}`, metin: (s) => `${s.mac} maç` } }))}
        ${kart('Göçebeler', 'Bu 8 ligde en çok farklı kulüpte oynayanlar.', cubukListe(v.gocebe.slice(0, 10), { deger: (s) => s.kulup, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.kulup} kulüp`, metin: (s) => `${s.lig.map((l) => v.ligler[l]?.ad || l).join(', ')}` } }))}
        ${kart('Bir ömür tek forma', 'Aynı kulüpte ligde en çok sezon oynayanlar.', cubukListe(v.sadakat.slice(0, 10), { deger: (s) => s.sezon, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.sezon} sezon`, metin: (s) => esc(s.kulup) } }))}
        ${kart('En çok şampiyonluk yaşayanlar', 'Şampiyon takımda sezonun en az üçte birinde oynadığı lig şampiyonlukları.', cubukListe(v.oyuncuSampiyon.slice(0, 10), { deger: (s) => s.sayi, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `🏆 ${s.sayi}`, metin: (s) => [...new Set(s.unvanlar.map((u) => u.kulup))].join(', ') } }))}
        ${kart('Çocuk yaşta golcüler', '18 yaşında ya da daha genç, bir lig sezonunda en az 5 gol.', cubukListe(v.gencGolcu.slice(0, 10), { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.yas} yaşında ${s.gol} gol`, metin: (s) => `${sezonAd(s.sezon)} · ${esc(s.kulup)}` } }))}
        ${kart('Yaş sadece bir sayı', '37 yaşında ya da daha büyük, bir lig sezonunda en az 5 gol.', cubukListe(v.yasliGolcu.slice(0, 10), { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.yas} yaşında ${s.gol} gol`, metin: (s) => `${sezonAd(s.sezon)} · ${esc(s.kulup)}` } }))}
        ${kart('Türkler Avrupa\'da', 'Türk uyruklu oyuncuların Süper Lig dışındaki 7 ligde attığı goller.', cubukListe(v.turklerAvrupada.golcular.slice(0, 10), { deger: (s) => s.gol, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.gol} gol`, metin: (s) => `${s.mac} maç · ${s.lig.map((l) => v.ligler[l]?.ad || l).join(', ')}` } }))}
        ${kart('En uzun ve en kısa golcüler', 'En az 30 lig golü atanlar.', `<div class="iki-sutun">${cubukListe(v.uzunGolcu.slice(0, 5), { deger: (s) => s.boy - 150, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.boy} cm`, metin: (s) => `${s.gol} gol` } })}${cubukListe(v.kisaGolcu.slice(0, 5), { deger: (s) => 200 - s.boy, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `${s.boy} cm`, metin: (s) => `${s.gol} gol` } })}</div>`)}
        ${v.enDegerli.length ? kart('En değerli oyuncular', `Kariyerinin zirve piyasa değeri. Piyasa değerleri yüklendikçe güncellenir (şu an ${sonDeger}).`, cubukListe(v.enDegerli.slice(0, 10), { deger: (s) => s.deger, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => mn(s.deger), metin: (s) => `${sezonAd(s.sezon)} · ${esc(s.kulup)}` } })) : ''}
        ${v.enDegerliKadro.length ? kart('En değerli kadrolar', `Kadrodaki oyuncuların piyasa değerleri toplamı (şu an ${sonDeger}).`, cubukListe(v.enDegerliKadro.slice(0, 10), { deger: (s) => s.deger, etiket: (s) => s.kulup, alt: { deger: (s) => mn(s.deger), metin: (s) => sezonAd(s.sezon) } })) : ''}
      </div>

      <h2 class="kesfet-baslik">Transferler ve piyasa</h2>
      <div class="kesfet-izgara">
        ${(v.transferRekor || []).length ? kart('Tarihin en pahalı transferleri', 'Bu 8 ligdeki kulüplere gelen oyuncular için ödenen bonservis.', cubukListe(v.transferRekor.slice(0, 10), { deger: (s) => s.bedel, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => mn(s.bedel), metin: (s) => `${esc(s.nereden)} → ${esc(s.nereye)} · ${sezonAd(s.sezon)}` } })) : ''}
        ${(v.yilRekor || []).length ? kart('Her sezonun rekor transferi', 'Bonservis rekorlarının yıllar içindeki yükselişi.', cubukListe(v.yilRekor, { deger: (s) => s.bedel, etiket: (s) => `${sezonAd(s.sezon)} · ${s.ad}`, id: oyuncuId, alt: { deger: (s) => mn(s.bedel), metin: (s) => `${esc(s.nereden)} → ${esc(s.nereye)}` } })) : ''}
        ${(v.harcayan || []).length ? kart('En çok harcayan kulüpler', '2000\'den bu yana bilinen bonservislerin toplamı.', cubukListe(v.harcayan.slice(0, 10), { deger: (s) => s.toplam, etiket: (s) => s.kulup, alt: { deger: (s) => mn(s.toplam), metin: (s) => `${s.sayi} transfer` } })) : ''}
        ${(v.karliAlim || []).length ? kart('En kârlı alımlar', 'Kulübe gelirken ödenen bedel ile o kulüpte ulaştığı en yüksek piyasa değeri arasındaki fark.', cubukListe(v.karliAlim.slice(0, 10), { deger: (s) => s.artis, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => `+${mn(s.artis)}`, metin: (s) => `${esc(s.nereye)} · ${s.bedel ? mn(s.bedel) : 'bedelsiz'} → ${mn(s.zirve)}` } })) : ''}
        ${(v.bedelsizYildiz || []).length ? kart('Bedelsiz gelen yıldızlar', 'Bonservis ödenmeden gelip kulüpte en yüksek değere ulaşanlar.', cubukListe(v.bedelsizYildiz, { deger: (s) => s.zirve, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => mn(s.zirve), metin: (s) => `${esc(s.nereden)} → ${esc(s.nereye)} · ${sezonAd(s.sezon)}` } })) : ''}
        ${(v.gencDeger || []).length ? kart('Genç ve pahalı', '21 yaşında ya da daha genç, ulaştığı en yüksek piyasa değeri.', cubukListe(v.gencDeger, { deger: (s) => s.deger, etiket: (s) => s.ad, id: oyuncuId, alt: { deger: (s) => mn(s.deger), metin: (s) => `${s.yas} yaşında · ${esc(s.kulup)} · ${sezonAd(s.sezon)}` } })) : ''}
      </div>
      <p class="not">İstatistikler ${esc(v.uretildi)} tarihli veriden hesaplandı. Oyuncuya dokunun: kariyeri açılır.</p>
    </div>`;

  const trendCiz = () => {
    const yer = el.querySelector('.trend-yer');
    yer.innerHTML = trendGrafik(v, lig, yer.clientWidth);
    trendEtkilesim(yer, v, lig);
    yer.querySelectorAll('[data-metrik]').forEach((b) => b.addEventListener('click', () => { seciliMetrik = b.dataset.metrik; trendCiz(); }));
  };
  trendCiz();
  const ac = (e) => { const li = e.target.closest('[data-oyuncu]'); if (li) oyuncuDetay(Number(li.dataset.oyuncu)); };
  el.querySelector('.kesfet').addEventListener('click', ac);
  el.querySelector('.kesfet').addEventListener('keydown', (e) => { if (e.key === 'Enter') ac(e); });
}

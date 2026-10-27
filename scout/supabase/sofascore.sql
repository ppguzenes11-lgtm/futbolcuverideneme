-- Scout — SofaScore verisi (Premier Lig, Süper Lig, Eredivisie; 2016/17'den bugüne).
-- Tablolar ss_ ile başlar; Transfermarkt tablolarına dokunulmaz.
-- Oyuncu maç istatistikleri yer kaplamasın diye dizi olarak tutulur: ss_oyuncu_mac.ist[i]
-- değeri ss_anahtarlar'da sira = i olan istatistiktir (ör. wonContest = başarılı çalım).

create table if not exists ss_takimlar (
  id      int primary key,   -- SofaScore takım ID
  ad      text,
  kisa_ad text
);

create table if not exists ss_oyuncular (
  id      int primary key,   -- SofaScore oyuncu ID
  ad      text,
  kisa_ad text,
  mevki   text,              -- G, D, M, F
  dogum   date,
  ulke    text,
  boy     int,
  ayak    text,
  eklendi timestamptz default now()
);

create table if not exists ss_anahtarlar (
  sira    int primary key,   -- ss_oyuncu_mac.ist dizisindeki yeri (1'den başlar)
  anahtar text unique not null
);

create table if not exists ss_maclar (
  id          int primary key,  -- SofaScore maç ID
  lig_id      int not null,     -- 17 Premier Lig, 52 Süper Lig, 37 Eredivisie
  sezon_id    int not null,
  sezon       text not null,    -- '24/25'
  hafta       int,
  tur         text,             -- play-off turları için
  tarih       timestamptz,
  ev_id       int,
  dep_id      int,
  ev_gol      int,
  dep_gol     int,
  ev_iy       int,              -- ilk yarı
  dep_iy      int,
  hakem       jsonb,            -- {id, ad}
  stadyum     text,
  seyirci     int,
  ev_hoca     jsonb,            -- {id, ad}
  dep_hoca    jsonb,
  ev_dizilis  text,
  dep_dizilis text,
  istatistik  jsonb,            -- {ALL|1ST|2ND: {anahtar: [ev, dep, ev_toplam?, dep_toplam?]}}
  olaylar     jsonb,            -- goller, kartlar, değişiklikler (dakikalı)
  eksikler    jsonb,            -- sakat / cezalı oyuncular
  oranlar     jsonb,            -- yalnızca arka planda ölçüm için, gösterilmez
  cekildi     timestamptz default now()
);
create index if not exists ss_maclar_lig_sezon on ss_maclar (lig_id, sezon);

create table if not exists ss_oyuncu_mac (
  mac_id    int not null,
  oyuncu_id int not null,
  takim_id  int,
  ev        boolean,
  yedek     boolean,
  kaptan    boolean,
  mevki     text,
  forma     int,
  dakika    int,
  puan      real,
  ist       real[],
  primary key (mac_id, oyuncu_id)
);
create index if not exists ss_oyuncu_mac_oyuncu on ss_oyuncu_mac (oyuncu_id);

do $$
declare t text;
begin
  foreach t in array array['ss_takimlar','ss_oyuncular','ss_anahtarlar','ss_maclar','ss_oyuncu_mac'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "okuma" on %I', t);
    execute format('create policy "okuma" on %I for select using (true)', t);
    -- YAZMA: veri çekilirken açık, bitince kapatın (dosyanın sonundaki komutla).
    execute format('drop policy if exists "yazma" on %I', t);
    execute format('create policy "yazma" on %I for insert with check (true)', t);
    execute format('drop policy if exists "guncelleme" on %I', t);
    execute format('create policy "guncelleme" on %I for update using (true) with check (true)', t);
  end loop;
end $$;

-- Çekim bitince yazmayı kapatmak için:
-- do $$ declare t text; begin
--   foreach t in array array['ss_takimlar','ss_oyuncular','ss_anahtarlar','ss_maclar','ss_oyuncu_mac'] loop
--     execute format('drop policy if exists "yazma" on %I', t);
--     execute format('drop policy if exists "guncelleme" on %I', t);
--   end loop; end $$;

-- Futbol veritabanı — 2. aşama: turnuva bazında istatistikler (önce ligler, ileride Şampiyonlar Ligi / Avrupa Ligi).
-- Supabase > SQL Editor'de çalıştırın. Önce supabase/veritabani.sql çalıştırılmış olmalı. Tekrar çalıştırmak güvenlidir.

-- Kulübün bir sezonda bir turnuvadaki maç başı puan ortalaması
create table if not exists kulup_turnuvalari (
  kulup_id      int  not null references kulupler(id),
  sezon         int  not null,
  turnuva_kod   text not null,   -- TR1, GB1... ileride CL, EL
  mac_basi_puan numeric,
  primary key (kulup_id, sezon, turnuva_kod)
);

-- Oyuncunun bir sezonda bir kulüpte bir turnuvadaki istatistikleri
create table if not exists oyuncu_turnuvalari (
  oyuncu_id      int  not null references oyuncular(id),
  kulup_id       int  not null references kulupler(id),
  sezon          int  not null,
  turnuva_kod    text not null,
  kadroda        int,
  mac            int not null default 0,
  gol            int not null default 0,
  asist          int not null default 0,
  sari           int not null default 0,
  ikinci_sari    int not null default 0,
  kirmizi        int not null default 0,
  oyuna_girdi    int not null default 0,
  oyundan_cikti  int not null default 0,
  mac_basi_puan  numeric,        -- oyuncu sahadayken takımın maç başı puanı
  dakika         int not null default 0,
  primary key (oyuncu_id, kulup_id, sezon, turnuva_kod)
);
create index if not exists oyuncu_turnuvalari_kulup on oyuncu_turnuvalari (kulup_id, sezon, turnuva_kod);
create index if not exists oyuncu_turnuvalari_turnuva on oyuncu_turnuvalari (turnuva_kod, sezon);

do $$
declare t text;
begin
  foreach t in array array['kulup_turnuvalari','oyuncu_turnuvalari'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "okuma" on %I', t);
    execute format('create policy "okuma" on %I for select using (true)', t);
  end loop;
end $$;

-- YAZMA: veri yüklerken açık, bitince kapatın (dosyanın sonundaki komutla).
-- oyuncular: daha önce görülmemiş bir oyuncu çıkarsa eklenebilsin diye.
do $$
declare t text;
begin
  foreach t in array array['kulup_turnuvalari','oyuncu_turnuvalari','oyuncular','cekilen_sayfalar'] loop
    execute format('drop policy if exists "yazma" on %I', t);
    execute format('create policy "yazma" on %I for insert with check (true)', t);
    execute format('drop policy if exists "guncelleme" on %I', t);
    execute format('create policy "guncelleme" on %I for update using (true) with check (true)', t);
  end loop;
end $$;

-- Yükleme bitince yazmayı kapatmak için:
-- do $$ declare t text; begin
--   foreach t in array array['kulup_turnuvalari','oyuncu_turnuvalari','oyuncular','cekilen_sayfalar'] loop
--     execute format('drop policy if exists "yazma" on %I', t);
--     execute format('drop policy if exists "guncelleme" on %I', t);
--   end loop; end $$;

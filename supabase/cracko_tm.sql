-- CRACKO Supabase'i için: futbol veritabanının "tm_" önekli kopyası.
-- Mevcut tablolara (players, clubs, player_club_seasons, leagues ...) ve fonksiyonlara DOKUNMAZ;
-- yayındaki oyun eski tablolarla çalışmaya devam eder. Yeni uygulama sürümü tm_ tablolarını kullanır.
-- Cracko Supabase > SQL Editor'de bir kez çalıştırın. Tekrar çalıştırmak güvenlidir (veri silmez).

create table if not exists tm_ligler (
  kod  text primary key,          -- Transfermarkt lig kodu: TR1, GB1, ES1, IT1, L1, FR1, PO1, NL1
  ad   text not null,
  ulke text not null
);

create table if not exists tm_kulupler (
  id   int primary key,           -- Transfermarkt kulüp ID
  ad   text not null,
  slug text
);

create table if not exists tm_lig_kulupleri (
  lig_kod  text not null references tm_ligler(kod),
  sezon    int  not null,          -- 2023 = 2023/24
  kulup_id int  not null references tm_kulupler(id),
  primary key (lig_kod, sezon, kulup_id)
);

create table if not exists tm_oyuncular (
  id           int primary key,    -- Transfermarkt oyuncu ID
  ad           text not null,
  uyruk        text,
  mevki        text,
  dogum_tarihi date,
  boy_cm       int,
  ayak         text
);

-- Oyuncunun bir sezonda bir kulüpteki verisi (maç/gol/asist: tüm turnuvalar toplamı)
create table if not exists tm_oyuncu_sezonlari (
  oyuncu_id         int not null references tm_oyuncular(id),
  kulup_id          int not null references tm_kulupler(id),
  sezon             int not null,
  forma_no          text,
  yas               int,
  mevki             text,
  kadroda           int,
  mac               int not null default 0,
  gol               int not null default 0,
  asist             int not null default 0,
  sari              int not null default 0,
  ikinci_sari       int not null default 0,
  kirmizi           int not null default 0,
  oyuna_girdi       int not null default 0,
  oyundan_cikti     int not null default 0,
  mac_basi_puan     numeric,
  dakika            int not null default 0,
  piyasa_degeri_eur bigint,
  katilma_tarihi    date,
  geldigi_kulup     text,
  primary key (oyuncu_id, kulup_id, sezon)
);
create index if not exists tm_oyuncu_sezonlari_kulup on tm_oyuncu_sezonlari (kulup_id, sezon);

-- Kulübün turnuvadaki (şimdilik lig) maç başı puan ortalaması
create table if not exists tm_kulup_turnuvalari (
  kulup_id      int  not null references tm_kulupler(id),
  sezon         int  not null,
  turnuva_kod   text not null,
  mac_basi_puan numeric,
  primary key (kulup_id, sezon, turnuva_kod)
);

-- Oyuncunun turnuvadaki (şimdilik yalnızca lig) istatistikleri
create table if not exists tm_oyuncu_turnuvalari (
  oyuncu_id      int  not null references tm_oyuncular(id),
  kulup_id       int  not null references tm_kulupler(id),
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
  mac_basi_puan  numeric,
  dakika         int not null default 0,
  primary key (oyuncu_id, kulup_id, sezon, turnuva_kod)
);
create index if not exists tm_oyuncu_turnuvalari_kulup on tm_oyuncu_turnuvalari (kulup_id, sezon, turnuva_kod);

-- Okuma: herkes. (Uygulama yalnızca okur.)
do $$
declare t text;
begin
  foreach t in array array['tm_ligler','tm_kulupler','tm_lig_kulupleri','tm_oyuncular','tm_oyuncu_sezonlari','tm_kulup_turnuvalari','tm_oyuncu_turnuvalari'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "tm_okuma" on %I', t);
    execute format('create policy "tm_okuma" on %I for select using (true)', t);
    execute format('grant select on %I to anon, authenticated', t);
  end loop;
end $$;

-- GEÇİCİ YAZMA: yalnızca bu tm_ tablolarına, veri aktarımı için. Aktarım bitince aşağıdaki komutla kapatın.
do $$
declare t text;
begin
  foreach t in array array['tm_ligler','tm_kulupler','tm_lig_kulupleri','tm_oyuncular','tm_oyuncu_sezonlari','tm_kulup_turnuvalari','tm_oyuncu_turnuvalari'] loop
    execute format('grant insert, update on %I to anon', t);
    execute format('drop policy if exists "tm_gecici_yazma" on %I', t);
    execute format('create policy "tm_gecici_yazma" on %I for insert to anon with check (true)', t);
    execute format('drop policy if exists "tm_gecici_guncelleme" on %I', t);
    execute format('create policy "tm_gecici_guncelleme" on %I for update to anon using (true) with check (true)', t);
  end loop;
end $$;

-- AKTARIM BİTİNCE ÇALIŞTIRIN (geçici yazmayı kapatır):
-- do $$ declare t text; begin
--   foreach t in array array['tm_ligler','tm_kulupler','tm_lig_kulupleri','tm_oyuncular','tm_oyuncu_sezonlari','tm_kulup_turnuvalari','tm_oyuncu_turnuvalari'] loop
--     execute format('drop policy if exists "tm_gecici_yazma" on %I', t);
--     execute format('drop policy if exists "tm_gecici_guncelleme" on %I', t);
--     execute format('revoke insert, update on %I from anon', t);
--   end loop; end $$;

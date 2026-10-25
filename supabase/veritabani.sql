-- Futbol veritabanı — 1. aşama: ligler, kulüpler, oyuncular, oyuncu sezon istatistikleri.
-- Supabase > SQL Editor'de bir kez çalıştırın. Tekrar çalıştırmak güvenlidir (veri silmez).

create table if not exists ligler (
  kod  text primary key,   -- Transfermarkt lig kodu: GB1, ES1...
  ad   text not null,
  ulke text not null
);

insert into ligler (kod, ad, ulke) values
  ('GB1', 'Premier League', 'İngiltere'),
  ('ES1', 'LaLiga', 'İspanya'),
  ('IT1', 'Serie A', 'İtalya'),
  ('L1',  'Bundesliga', 'Almanya'),
  ('FR1', 'Ligue 1', 'Fransa'),
  ('PO1', 'Liga Portugal', 'Portekiz'),
  ('NL1', 'Eredivisie', 'Hollanda'),
  ('TR1', 'Süper Lig', 'Türkiye')
on conflict (kod) do nothing;

create table if not exists kulupler (
  id   int primary key,     -- Transfermarkt kulüp ID
  ad   text not null,
  slug text                 -- adres parçası: /galatasaray/kader/verein/141
);

-- Hangi sezon hangi ligde hangi kulüpler oynadı
create table if not exists lig_kulupleri (
  lig_kod  text not null references ligler(kod),
  sezon    int  not null,   -- 2023 = 2023/24
  kulup_id int  not null references kulupler(id),
  primary key (lig_kod, sezon, kulup_id)
);

create table if not exists oyuncular (
  id     int primary key,   -- Transfermarkt oyuncu ID
  ad     text not null,
  uyruk  text,
  mevki  text
);

-- Oyuncunun bir sezonda bir kulüpteki istatistikleri (tüm turnuvalar toplamı: lig + kupa + Avrupa)
create table if not exists oyuncu_sezonlari (
  oyuncu_id      int not null references oyuncular(id),
  kulup_id       int not null references kulupler(id),
  sezon          int not null,
  forma_no       text,
  yas            int,
  mevki          text,
  kadroda        int,           -- maç kadrosunda bulunduğu maç sayısı
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
  primary key (oyuncu_id, kulup_id, sezon)
);
create index if not exists oyuncu_sezonlari_kulup on oyuncu_sezonlari (kulup_id, sezon);

-- Veri çekme kodunun kaldığı yeri bilmesi için: 'lig:TR1:2023', 'kulup:141:2023'
create table if not exists cekilen_sayfalar (
  anahtar text primary key,
  tarih   timestamptz not null default now()
);

-- Güvenlik: herkes okuyabilir. Yazma yalnızca veri yüklenirken açık olmalı (aşağıdaki "YAZMA" bölümü).
do $$
declare t text;
begin
  foreach t in array array['ligler','kulupler','lig_kulupleri','oyuncular','oyuncu_sezonlari','cekilen_sayfalar'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "okuma" on %I', t);
    execute format('create policy "okuma" on %I for select using (true)', t);
  end loop;
end $$;

-- YAZMA: veri yüklerken açın, bitince kapatın (dosyanın sonundaki komutlarla).
do $$
declare t text;
begin
  foreach t in array array['kulupler','lig_kulupleri','oyuncular','oyuncu_sezonlari','cekilen_sayfalar'] loop
    execute format('drop policy if exists "yazma" on %I', t);
    execute format('create policy "yazma" on %I for insert with check (true)', t);
    execute format('drop policy if exists "guncelleme" on %I', t);
    execute format('create policy "guncelleme" on %I for update using (true) with check (true)', t);
  end loop;
end $$;

-- Yükleme bitince yazmayı kapatmak için şunu çalıştırın:
-- do $$ declare t text; begin
--   foreach t in array array['kulupler','lig_kulupleri','oyuncular','oyuncu_sezonlari','cekilen_sayfalar'] loop
--     execute format('drop policy if exists "yazma" on %I', t);
--     execute format('drop policy if exists "guncelleme" on %I', t);
--   end loop; end $$;

-- Galatasaray sezon kadroları (Transfermarkt). Supabase > SQL Editor'de bir kez çalıştırın.
create table if not exists galatasaray_kadrolar (
  sezon             int     not null,          -- 2000 = 2000/01
  sezon_ad          text    not null,
  oyuncu_id         int     not null,          -- Transfermarkt oyuncu ID
  ad                text    not null,
  forma_no          text,
  mevki             text,
  dogum_tarihi      text,
  yas               int,
  uyruk             text,
  boy               text,
  ayak              text,
  katilma_tarihi    text,
  geldigi_kulup     text,
  sozlesme_bitis    text,
  piyasa_degeri     text,
  piyasa_degeri_eur bigint,
  profil_url        text,
  primary key (sezon, oyuncu_id)
);

alter table galatasaray_kadrolar enable row level security;

-- Deneme projesi: herkes okuyabilir ve publishable anahtarla yazılabilir.
-- Gerçek kullanımda yazma politikasını kaldırın.
drop policy if exists "kadrolar okuma" on galatasaray_kadrolar;
create policy "kadrolar okuma" on galatasaray_kadrolar for select using (true);
drop policy if exists "kadrolar yazma" on galatasaray_kadrolar;
create policy "kadrolar yazma" on galatasaray_kadrolar for insert with check (true);
drop policy if exists "kadrolar guncelleme" on galatasaray_kadrolar;
create policy "kadrolar guncelleme" on galatasaray_kadrolar for update using (true) with check (true);

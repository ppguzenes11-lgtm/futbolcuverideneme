-- Futbol veritabanı — 4. aşama: Avrupa kupaları (Şampiyonlar Ligi = CL, Avrupa Ligi / UEFA Kupası = EL).
-- Oyuncu istatistikleri mevcut oyuncu_turnuvalari tablosuna turnuva_kod 'CL' / 'EL' ile yazılır.
-- Kupayı kazanan kulüpler ayrı tabloda tutulur (kazanan 8 ligin dışından olabilir, bu yüzden kulup_id zorunlu bağ değil).

create table if not exists turnuva_sampiyonlari (
  turnuva_kod text not null,   -- CL, EL
  sezon       int  not null,   -- sezonun başladığı yıl (2024 = 2024/25)
  kulup_id    int  not null,   -- Transfermarkt kulüp ID
  kulup_ad    text,
  primary key (turnuva_kod, sezon)
);

alter table turnuva_sampiyonlari enable row level security;
drop policy if exists "okuma" on turnuva_sampiyonlari;
create policy "okuma" on turnuva_sampiyonlari for select using (true);

-- YAZMA: veri yüklerken açık, bitince kapatın (dosyanın sonundaki komutla).
do $$
declare t text;
begin
  foreach t in array array['turnuva_sampiyonlari','kulup_turnuvalari','oyuncu_turnuvalari','oyuncular','cekilen_sayfalar'] loop
    execute format('drop policy if exists "yazma" on %I', t);
    execute format('create policy "yazma" on %I for insert with check (true)', t);
    execute format('drop policy if exists "guncelleme" on %I', t);
    execute format('create policy "guncelleme" on %I for update using (true) with check (true)', t);
  end loop;
end $$;

-- Yükleme bitince yazmayı kapatmak için:
-- do $$ declare t text; begin
--   foreach t in array array['turnuva_sampiyonlari','kulup_turnuvalari','oyuncu_turnuvalari','oyuncular','cekilen_sayfalar'] loop
--     execute format('drop policy if exists "yazma" on %I', t);
--     execute format('drop policy if exists "guncelleme" on %I', t);
--   end loop; end $$;

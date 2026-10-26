-- Futbol veritabanı — 3. aşama: piyasa değerleri ve oyuncu profili (doğum tarihi, boy, ayak).
-- Supabase > SQL Editor'de çalıştırın. Tekrar çalıştırmak güvenlidir.

alter table oyuncular add column if not exists dogum_tarihi date;
alter table oyuncular add column if not exists boy_cm int;
alter table oyuncular add column if not exists ayak text;          -- right / left / both

-- O sezonki kadro sayfasından (sezon için Transfermarkt'ın gösterdiği değer)
alter table oyuncu_sezonlari add column if not exists piyasa_degeri_eur bigint;
alter table oyuncu_sezonlari add column if not exists katilma_tarihi date;   -- kulübe katılma
alter table oyuncu_sezonlari add column if not exists geldigi_kulup text;    -- "Kulüp: bedel" metni

-- YAZMA: veri yüklerken açık, bitince kapatın (dosyanın sonundaki komutla).
do $$
declare t text;
begin
  foreach t in array array['oyuncular','oyuncu_sezonlari','cekilen_sayfalar'] loop
    execute format('drop policy if exists "yazma" on %I', t);
    execute format('create policy "yazma" on %I for insert with check (true)', t);
    execute format('drop policy if exists "guncelleme" on %I', t);
    execute format('create policy "guncelleme" on %I for update using (true) with check (true)', t);
  end loop;
end $$;

-- Yükleme bitince yazmayı kapatmak için (tüm tablolar):
-- do $$ declare t text; begin
--   foreach t in array array['kulupler','lig_kulupleri','oyuncular','oyuncu_sezonlari','cekilen_sayfalar','kulup_turnuvalari','oyuncu_turnuvalari'] loop
--     execute format('drop policy if exists "yazma" on %I', t);
--     execute format('drop policy if exists "guncelleme" on %I', t);
--   end loop; end $$;

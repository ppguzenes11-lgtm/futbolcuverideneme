-- Scout — yaklaşan maçlar (fikstür). Tahmin sekmesindeki "Yaklaşan maçlar" listesi buradan gelir.
-- Konsol betiği her çalıştığında (ve uzun çekimde 6 saatte bir) güncellenir. Oynanan maçlar ss_maclar'a geçer.

create table if not exists ss_fikstur (
  id          int primary key,  -- SofaScore maç ID (oynanınca ss_maclar'da aynı ID)
  lig_id      int not null,
  sezon_id    int,
  sezon       text,
  hafta       int,
  tarih       timestamptz,
  ev_id       int,
  ev_ad       text,
  dep_id      int,
  dep_ad      text,
  durum       text,             -- notstarted, postponed, inprogress …
  hakem       jsonb,            -- {id, ad} — genelde maçtan 1-2 gün önce açıklanır
  guncellendi timestamptz default now()
);
create index if not exists ss_fikstur_lig_tarih on ss_fikstur (lig_id, tarih);

alter table ss_fikstur enable row level security;
drop policy if exists "okuma" on ss_fikstur;
create policy "okuma" on ss_fikstur for select using (true);
-- YAZMA: diğer ss_ tablolarıyla birlikte, çekim bitince kapatın (sofascore.sql sonundaki komuta ss_fikstur da eklendi).
drop policy if exists "yazma" on ss_fikstur;
create policy "yazma" on ss_fikstur for insert with check (true);
drop policy if exists "guncelleme" on ss_fikstur;
create policy "guncelleme" on ss_fikstur for update using (true) with check (true);

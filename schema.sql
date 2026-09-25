-- ============================================================
-- Pyjama Dz Tag Scanner — Supabase schema
-- Paste this whole file into the Supabase SQL editor and run it.
-- Safe to run more than once.
-- ============================================================

-- ---------- products: one row per barcode --------------------
create table if not exists public.products (
  code        text primary key,
  name        text not null,
  name_ar     text,
  sku         text,
  brand       text,
  price       numeric(12,2),
  note        text,
  updated_at  timestamptz not null default now()
);

-- ---------- scans: one row per scan --------------------------
-- Deliberately one row per scan rather than a counter on the
-- product: two phones scanning at the same moment cannot then
-- overwrite each other's count. Quantities are grouped in the UI.
create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text,
  sku         text,
  brand       text,
  price       numeric(12,2),
  format      text,
  scanned_at  timestamptz not null default now()
);

create index if not exists scans_scanned_at_idx on public.scans (scanned_at desc);
create index if not exists scans_code_idx       on public.scans (code);

-- ---------- row level security -------------------------------
-- These policies let the browser's anon key read and write both
-- tables. That is what makes the scanner work with no login.
--
-- It also means: anyone holding the page URL and the anon key can
-- read and change this data. Fine for a page you keep to your own
-- phones; NOT fine if the page goes public. To lock it down, drop
-- these four policies, turn on Supabase Auth, and recreate them
-- with `to authenticated` instead of `to anon`.

-- Safe migration for existing installations
alter table if not exists public.products add column if not exists brand text;
alter table if not exists public.scans    add column if not exists brand text;

alter table public.products enable row level security;
alter table public.scans    enable row level security;

drop policy if exists "scanner reads products"  on public.products;
drop policy if exists "scanner writes products" on public.products;
drop policy if exists "scanner reads scans"     on public.scans;
drop policy if exists "scanner writes scans"    on public.scans;

create policy "scanner reads products"
  on public.products for select to anon using (true);

create policy "scanner writes products"
  on public.products for all to anon using (true) with check (true);

create policy "scanner reads scans"
  on public.scans for select to anon using (true);

create policy "scanner writes scans"
  on public.scans for all to anon using (true) with check (true);

-- ---------- realtime -----------------------------------------
-- Without this the other phones only update when reloaded.
alter publication supabase_realtime add table public.products;
alter publication supabase_realtime add table public.scans;

-- ---------- the tag this scanner was built from ---------------
insert into public.products (code, name, name_ar, sku, brand, price, note)
values (
  '4458534760123',
  'Robe',
  'روب',
  'BASKAT Z8-1',
  'Pyjama Dz',
  1600,
  'Pyjama Dz · 80% polyester, 20% coton · صنع في الجزائر'
)
on conflict (code) do nothing;

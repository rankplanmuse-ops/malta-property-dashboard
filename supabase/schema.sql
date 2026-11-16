-- Malta Property Dashboard (standalone) - Supabase schema.
-- Run this in the Supabase SQL editor for the new project, then run seed.sql.

create table if not exists public.listings (
  url text primary key,
  rent integer not null,
  island text,
  src text,
  data jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.listings enable row level security;

drop policy if exists "Listings are public" on public.listings;
create policy "Listings are public"
  on public.listings for select
  using (true);

create table if not exists public.verdicts (
  user_id uuid not null references auth.users (id) on delete cascade,
  listing_url text not null,
  verdict text not null check (verdict in ('yay', 'maybe', 'nay')),
  updated_at timestamptz not null default now(),
  primary key (user_id, listing_url)
);

alter table public.verdicts enable row level security;

drop policy if exists "Users read own verdicts" on public.verdicts;
create policy "Users read own verdicts"
  on public.verdicts for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own verdicts" on public.verdicts;
create policy "Users insert own verdicts"
  on public.verdicts for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own verdicts" on public.verdicts;
create policy "Users update own verdicts"
  on public.verdicts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own verdicts" on public.verdicts;
create policy "Users delete own verdicts"
  on public.verdicts for delete
  using (auth.uid() = user_id);

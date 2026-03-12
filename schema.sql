-- ═══════════════════════════════════════════════════════════
--  GAMEVAULT — Supabase SQL Schema (custom auth, no auth.users)
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- Enable pgcrypto for bcrypt password hashing
create extension if not exists "pgcrypto";

-- 0) CLEAN RESET (drops all public tables and helper objects)
do $$
declare
  rec record;
begin
  for rec in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('drop table if exists public.%I cascade', rec.tablename);
  end loop;
end $$;

drop trigger  if exists on_auth_user_created    on auth.users;
drop function if exists public.handle_new_user();
drop function if exists public.set_updated_at();
drop function if exists public.verify_login(text, text);

-- 1) USERS TABLE (custom auth — no Supabase auth.users required)
create table public.users (
  id            bigserial    primary key,
  username      text         not null unique check (username in ('Rafael', 'Lucas')),
  password_hash text         not null,
  created_at    timestamptz  default now()
);

-- 2) RANKINGS TABLE
create table public.rankings (
  id             bigserial    primary key,
  username       text         not null references public.users(username) on delete cascade,
  game_key       text         not null,
  graphics_score numeric(4,1) check (graphics_score >= 0 and graphics_score <= 10),
  gameplay_score numeric(4,1) check (gameplay_score >= 0 and gameplay_score <= 10),
  story_score    numeric(4,1) check (story_score >= 0 and story_score <= 10),
  fun_score      numeric(4,1) check (fun_score >= 0 and fun_score <= 10),
  overall_rating numeric(4,1) check (overall_rating >= 0 and overall_rating <= 10),
  comment        text,
  created_at     timestamptz  default now(),
  updated_at     timestamptz  default now(),
  unique (username, game_key)
);

create index if not exists rankings_game_key_idx on public.rankings (game_key);
create index if not exists rankings_username_idx  on public.rankings (username);

-- Auto-update updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_rankings_updated_at
  before update on public.rankings
  for each row execute procedure public.set_updated_at();

-- 3) LOGIN VERIFICATION FUNCTION
-- Returns the matched username when credentials are correct, empty string otherwise.
-- SECURITY DEFINER lets it bypass RLS and read the users table safely.
create or replace function public.verify_login(p_username text, p_password text)
returns text
language sql
security definer
as $$
  select coalesce(
    (select username
       from public.users
      where lower(username) = lower(p_username)
        and password_hash = crypt(p_password, password_hash)),
    ''
  );
$$;

-- 4) ROW LEVEL SECURITY
alter table public.users    enable row level security;
alter table public.rankings enable row level security;

-- Block direct reads of the users table (credentials are only checked via verify_login RPC)
create policy "no_direct_user_reads"
  on public.users for select using (false);

-- Rankings: open access (private 2-person app; anon key already shipped in client code)
create policy "anyone_can_read_rankings"
  on public.rankings for select using (true);

create policy "anyone_can_insert_rankings"
  on public.rankings for insert with check (true);

create policy "anyone_can_update_rankings"
  on public.rankings for update using (true);

create policy "anyone_can_delete_rankings"
  on public.rankings for delete using (true);

-- 5) SEED USERS
insert into public.users (username, password_hash) values
  ('Lucas',  crypt('lusca10',   gen_salt('bf'))),
  ('Rafael', crypt('rafinha10', gen_salt('bf')));

-- ═══════════════════════════════════════════════════════════
-- LOGIN CREDENTIALS FOR THE APP UI
--   User: Lucas  | Senha: lusca10
--   User: Rafael | Senha: rafinha10
-- ═══════════════════════════════════════════════════════════

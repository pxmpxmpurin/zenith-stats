begin;

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  legend text not null check (btrim(legend) <> ''),
  deck_type text not null check (btrim(deck_type) <> ''),
  unique (user_id, id)
);

create unique index decks_user_legend_type_idx
  on public.decks (user_id, lower(btrim(legend)), lower(btrim(deck_type)));

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  deck_id uuid not null,
  opponent_legend text not null check (btrim(opponent_legend) <> ''),
  opponent_deck_type text check (btrim(opponent_deck_type) <> ''),
  won_die_roll boolean not null,
  won_match boolean not null,
  played_at timestamptz not null default now(),
  foreign key (user_id, deck_id)
    references public.decks (user_id, id) on delete cascade
);

create index matches_user_deck_idx on public.matches (user_id, deck_id);

alter table public.app_admins enable row level security;
alter table public.decks enable row level security;
alter table public.matches enable row level security;

revoke all on public.app_admins, public.decks, public.matches
  from public, anon, authenticated;
grant select on public.app_admins to authenticated;
grant select, insert on public.decks, public.matches to authenticated;

create policy "Users can check their own admin status"
  on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Owners and admins can read decks"
  on public.decks for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select exists (
      select 1 from public.app_admins where user_id = (select auth.uid())
    ))
  );

create policy "Users can create their own decks"
  on public.decks for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy "Owners and admins can read matches"
  on public.matches for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select exists (
      select 1 from public.app_admins where user_id = (select auth.uid())
    ))
  );

create policy "Users can record their own matches"
  on public.matches for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;

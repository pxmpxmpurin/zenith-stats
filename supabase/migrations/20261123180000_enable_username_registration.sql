begin;

create table public.registration_attempts (
  source_key text not null,
  window_start timestamptz not null,
  attempts integer not null default 1,
  primary key (window_start, source_key)
);

alter table public.registration_attempts enable row level security;
revoke all on public.registration_attempts from public, anon, authenticated;

create function public.allow_registration_attempt(registration_source text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_window timestamptz := date_bin('10 minutes', now(), '2000-01-01 00:00:00+00');
begin
  delete from public.registration_attempts where window_start < current_window;

  insert into public.registration_attempts (source_key, window_start)
  values (registration_source, current_window)
  on conflict (window_start, source_key) do update
  set attempts = registration_attempts.attempts + 1
  where registration_attempts.attempts < 6;

  return found;
end;
$$;

revoke all on function public.allow_registration_attempt(text) from public, anon, authenticated;
grant execute on function public.allow_registration_attempt(text) to service_role;

create function public.assign_registered_username()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  login_name text := new.raw_app_meta_data ->> 'zenith_username';
begin
  if login_name is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.raw_app_meta_data ->> 'zenith_username' is not null then
    return new;
  end if;

  if exists (
    select 1 from auth.users as users
    where users.id <> new.id
      and lower(split_part(users.email, '@', 1)) = login_name
      and not exists (
        select 1 from public.login_usernames as aliases where aliases.user_id = users.id
      )
  ) then
    raise unique_violation using message = 'Username already in use';
  end if;

  insert into public.login_usernames (username, user_id) values (login_name, new.id);
  return new;
end;
$$;

revoke all on function public.assign_registered_username() from public, anon, authenticated;

-- Supabase Auth may add app metadata in an update inside the creation transaction.
create trigger assign_registered_username
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.assign_registered_username();

commit;

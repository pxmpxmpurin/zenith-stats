begin;

create table public.login_usernames (
  username text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  check (username <> '' and username = lower(btrim(username)) and strpos(username, '@') = 0)
);

alter table public.login_usernames enable row level security;
revoke all on public.login_usernames from public, anon, authenticated;

-- Reserve unique aliases for existing accounts without modifying Auth users.
with candidates as (
  select id, lower(coalesce(
    nullif(btrim(raw_user_meta_data ->> 'username'), ''),
    nullif(split_part(email, '@', 1), '')
  )) as username
  from auth.users
  where email is not null and email <> ''
), unique_candidates as (
  select id, username, count(*) over (partition by username) as occurrences
  from candidates
  where username <> '' and strpos(username, '@') = 0
)
insert into public.login_usernames (username, user_id)
select username, id from unique_candidates where occurrences = 1;

create function public.resolve_login_username(login_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select users.email
      from public.login_usernames as aliases
      join auth.users as users on users.id = aliases.user_id
      where aliases.username = lower(btrim(login_name))
    ),
    (
      select case when count(*) = 1 then min(users.email) end
      from auth.users as users
      where lower(split_part(users.email, '@', 1)) = lower(btrim(login_name))
        and not exists (
          select 1 from public.login_usernames as aliases where aliases.user_id = users.id
        )
    )
  );
$$;

revoke all on function public.resolve_login_username(text) from public, anon, authenticated;
grant execute on function public.resolve_login_username(text) to service_role;

commit;

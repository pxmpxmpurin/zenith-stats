begin;

create function public.admin_list_players()
returns table (player_id uuid, email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.app_admins as admins
    where admins.user_id = (select auth.uid())
  ) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  return query
    select users.id, users.email::text
    from auth.users as users;
end;
$$;

revoke all on function public.admin_list_players() from public, anon, authenticated;
grant execute on function public.admin_list_players() to authenticated;

commit;

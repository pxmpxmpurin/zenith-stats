begin;

grant update (deck_id, opponent_legend, opponent_deck_type, won_die_roll, won_match)
  on public.matches to authenticated;

create policy "Users can edit their own matches"
  on public.matches for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

commit;

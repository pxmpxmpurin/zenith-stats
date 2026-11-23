begin;

create table public.legends (
  champion text not null,
  title text not null,
  name text generated always as (champion || ' · ' || title) stored primary key
);

-- English Legend cards from Riot's official Card Gallery, including Radiance.
-- Alternate printings are represented by a single entry.
insert into public.legends (champion, title) values
  ('Ahri', 'Nine-Tailed Fox'),
  ('Akali', 'Rogue Assassin'),
  ('Ambessa', 'Matriarch of War'),
  ('Annie', 'Dark Child'),
  ('Azir', 'Emperor of the Sands'),
  ('Darius', 'Hand of Noxus'),
  ('Diana', 'Scorn of the Moon'),
  ('Draven', 'Glorious Executioner'),
  ('Ekko', 'Boy Who Shattered Time'),
  ('Evelynn', 'Agony''s Embrace'),
  ('Ezreal', 'Prodigal Explorer'),
  ('Fiora', 'Grand Duelist'),
  ('Garen', 'Might of Demacia'),
  ('Irelia', 'Blade Dancer'),
  ('Ivern', 'Green Father'),
  ('Jarvan IV', 'Exemplar of Demacia'),
  ('Jax', 'Grandmaster at Arms'),
  ('Jayce', 'Defender of Tomorrow'),
  ('Jhin', 'Virtuoso'),
  ('Jinx', 'Loose Cannon'),
  ('K''Sante', 'Pride of Nazumah'),
  ('Kai''Sa', 'Daughter of the Void'),
  ('Kennen', 'Heart of the Tempest'),
  ('Kha''Zix', 'Voidreaver'),
  ('LeBlanc', 'Deceiver'),
  ('Lee Sin', 'Blind Monk'),
  ('Leona', 'Radiant Dawn'),
  ('Lillia', 'Bashful Bloom'),
  ('Lucian', 'Purifier'),
  ('Lux', 'Lady of Luminosity'),
  ('Master Yi', 'Wuju Bladesman'),
  ('Master Yi', 'Wuju Master'),
  ('Mel', 'Soul''s Reflection'),
  ('Miss Fortune', 'Bounty Hunter'),
  ('Mordekaiser', 'Iron Revenant'),
  ('Nasus', 'Curator of the Sands'),
  ('Orianna', 'Lady of Clockwork'),
  ('Ornn', 'Fire Below the Mountain'),
  ('Poppy', 'Keeper of the Hammer'),
  ('Pyke', 'Bloodharbor Ripper'),
  ('Rek''Sai', 'Void Burrower'),
  ('Renata Glasc', 'Chem-Baroness'),
  ('Renekton', 'Butcher of the Sands'),
  ('Rengar', 'Pridestalker'),
  ('Riven', 'The Exile'),
  ('Rumble', 'Mechanized Menace'),
  ('Seraphine', 'Starry-Eyed Songstress'),
  ('Sett', 'The Boss'),
  ('Shen', 'Eye of Twilight'),
  ('Sivir', 'Battle Mistress'),
  ('Teemo', 'Swift Scout'),
  ('Vex', 'Gloomist'),
  ('Vi', 'Piltover Enforcer'),
  ('Viktor', 'Herald of the Arcane'),
  ('Volibear', 'Relentless Storm'),
  ('Yasuo', 'Unforgiven'),
  ('Zed', 'Master of Shadows'),
  ('Ziggs', 'Hexplosives Expert');

alter table public.legends enable row level security;
revoke all on public.legends from public, anon, authenticated;
grant select on public.legends to authenticated;

create policy "Players can read the legend catalog"
  on public.legends for select to authenticated
  using (true);

-- Retain historical free-text records and enforce the catalog for new values.
alter table public.decks
  add constraint decks_legend_catalog_fk
  foreign key (legend) references public.legends (name) not valid;

alter table public.matches
  add constraint matches_opponent_legend_catalog_fk
  foreign key (opponent_legend) references public.legends (name) not valid;

commit;

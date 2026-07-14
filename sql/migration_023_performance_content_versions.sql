-- =========================================================
-- CULONES-RPG · Migración 023
-- Índice liviano de versiones para el panel de Novedades.
--
-- No modifica ni elimina tablas/RPC usadas por el bot. Solo añade una tabla
-- pública de lectura, un RPC de lectura y triggers que actualizan versiones.
-- =========================================================

create table if not exists public.site_content_versions (
  section      text primary key check (section in ('logs','guides','tierlist','kits','about')),
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  latest_id    text,
  latest_title text,
  change_kind text not null default 'updated' check (change_kind in ('baseline','published','updated','removed'))
);

alter table public.site_content_versions
  add column if not exists change_kind text not null default 'updated';

alter table public.site_content_versions enable row level security;

drop policy if exists "site_content_versions_select_public" on public.site_content_versions;
create policy "site_content_versions_select_public"
  on public.site_content_versions for select
  to anon, authenticated
  using (true);

grant select on public.site_content_versions to anon, authenticated;

drop function if exists public.bump_site_content_version(text,text,text);

create or replace function public.bump_site_content_version(
  input_section text,
  input_latest_id text default null,
  input_latest_title text default null,
  input_change_kind text default 'updated'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_section not in ('logs','guides','tierlist','kits','about') then
    return;
  end if;

  if input_change_kind not in ('baseline','published','updated','removed') then
    input_change_kind := 'updated';
  end if;

  insert into public.site_content_versions(section, version, updated_at, latest_id, latest_title, change_kind)
  values (input_section, 1, now(), nullif(input_latest_id, ''), nullif(input_latest_title, ''), input_change_kind)
  on conflict (section) do update
    set version = public.site_content_versions.version + 1,
        updated_at = now(),
        latest_id = excluded.latest_id,
        latest_title = excluded.latest_title,
        change_kind = excluded.change_kind;
end;
$$;

revoke all on function public.bump_site_content_version(text,text,text,text) from public, anon, authenticated;

create or replace function public.touch_logs_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affects_public boolean := false;
  event_kind text := 'updated';
  event_id text;
  event_title text;
begin
  if tg_op = 'INSERT' then
    affects_public := coalesce(new.published, true);
    event_kind := 'published';
    event_id := new.id::text;
    event_title := new.title;
  elsif tg_op = 'DELETE' then
    affects_public := coalesce(old.published, true);
    event_kind := 'removed';
    event_id := old.id::text;
    event_title := old.title;
  else
    event_id := new.id::text;
    event_title := new.title;
    affects_public := coalesce(new.published, true) or coalesce(old.published, true);
    if not coalesce(old.published, true) and coalesce(new.published, true) then
      event_kind := 'published';
    elsif coalesce(old.published, true) and not coalesce(new.published, true) then
      event_kind := 'removed';
    end if;
  end if;

  if not affects_public then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.bump_site_content_version(
    'logs',
    case when event_kind = 'removed' then null else event_id end,
    case when event_kind = 'removed' then null else event_title end,
    event_kind
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_guides_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  weapon_id uuid;
  weapon_title text;
  affects_public boolean := false;
  event_kind text := 'updated';
begin
  if tg_table_name = 'weapons' then
    weapon_id := case when tg_op = 'DELETE' then old.id else new.id end;
    weapon_title := case when tg_op = 'DELETE' then old.name else new.name end;
    if tg_op = 'INSERT' then
      affects_public := coalesce(new.published, false);
      event_kind := 'published';
    elsif tg_op = 'DELETE' then
      affects_public := coalesce(old.published, false);
      event_kind := 'removed';
    else
      affects_public := coalesce(new.published, false) or coalesce(old.published, false);
      if not coalesce(old.published, false) and coalesce(new.published, false) then
        event_kind := 'published';
      elsif coalesce(old.published, false) and not coalesce(new.published, false) then
        event_kind := 'removed';
      end if;
    end if;
  else
    weapon_id := case when tg_op = 'DELETE' then old.weapon_id else new.weapon_id end;
    select coalesce(published, false), name into affects_public, weapon_title
      from public.weapons where id = weapon_id;
  end if;

  if not affects_public then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.bump_site_content_version(
    'guides',
    case when event_kind = 'removed' then null else weapon_id::text end,
    case when event_kind = 'removed' then null else weapon_title end,
    event_kind
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_guides_taxonomy_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bump_site_content_version('guides', null, null, 'updated');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_tierlist_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.bump_site_content_version('tierlist', null, null, 'updated');
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_kits_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  affects_public boolean := false;
  event_kind text := 'updated';
  event_id text;
  event_title text;
begin
  if tg_op = 'INSERT' then
    affects_public := coalesce(new.published, false);
    event_kind := 'published';
    event_id := new.id::text;
    event_title := new.name;
  elsif tg_op = 'DELETE' then
    affects_public := coalesce(old.published, false);
    event_kind := 'removed';
    event_id := old.id::text;
    event_title := old.name;
  else
    event_id := new.id::text;
    event_title := new.name;
    affects_public := coalesce(new.published, false) or coalesce(old.published, false);
    if not coalesce(old.published, false) and coalesce(new.published, false) then
      event_kind := 'published';
    elsif coalesce(old.published, false) and not coalesce(new.published, false) then
      event_kind := 'removed';
    end if;
  end if;

  if not affects_public then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  perform public.bump_site_content_version(
    'kits',
    case when event_kind = 'removed' then null else event_id end,
    case when event_kind = 'removed' then null else event_title end,
    event_kind
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.touch_about_content_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (case when tg_op = 'DELETE' then old.key else new.key end) = 'about_blocks' then
    perform public.bump_site_content_version('about', null, null, 'updated');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Reinstalación segura de triggers.
drop trigger if exists site_versions_logs on public.logs;
create trigger site_versions_logs
  after insert or update or delete on public.logs
  for each row execute function public.touch_logs_content_version();

drop trigger if exists site_versions_weapons on public.weapons;
create trigger site_versions_weapons
  after insert or update or delete on public.weapons
  for each row execute function public.touch_guides_content_version();

drop trigger if exists site_versions_weapon_ranks on public.weapon_ranks;
create trigger site_versions_weapon_ranks
  after insert or update or delete on public.weapon_ranks
  for each row execute function public.touch_guides_content_version();

drop trigger if exists site_versions_weapon_categories on public.weapon_categories;
create trigger site_versions_weapon_categories
  after insert or update or delete on public.weapon_categories
  for each row execute function public.touch_guides_taxonomy_content_version();

drop trigger if exists site_versions_weapon_types on public.weapon_types;
create trigger site_versions_weapon_types
  after insert or update or delete on public.weapon_types
  for each row execute function public.touch_guides_taxonomy_content_version();

drop trigger if exists site_versions_tierlist_rows on public.tierlist_rows;
create trigger site_versions_tierlist_rows
  after insert or update or delete on public.tierlist_rows
  for each row execute function public.touch_tierlist_content_version();

drop trigger if exists site_versions_tierlist_items on public.tierlist_items;
create trigger site_versions_tierlist_items
  after insert or update or delete on public.tierlist_items
  for each row execute function public.touch_tierlist_content_version();

drop trigger if exists site_versions_kits on public.kits;
create trigger site_versions_kits
  after insert or update or delete on public.kits
  for each row execute function public.touch_kits_content_version();

drop trigger if exists site_versions_about on public.app_settings;
create trigger site_versions_about
  after insert or update or delete on public.app_settings
  for each row execute function public.touch_about_content_version();

-- Estado inicial: sirve de línea base y no crea avisos falsos.
insert into public.site_content_versions(section, version, updated_at, latest_id, latest_title, change_kind)
select 'logs', 1, now(), latest.id::text, latest.title, 'baseline'
from (select id, title from public.logs where coalesce(published, true) = true order by created_at desc limit 1) latest
on conflict (section) do nothing;

insert into public.site_content_versions(section, version, updated_at, latest_id, latest_title, change_kind)
select 'guides', 1, now(), latest.id::text, latest.name, 'baseline'
from (select id, name from public.weapons where published = true order by updated_at desc limit 1) latest
on conflict (section) do nothing;

insert into public.site_content_versions(section, version, updated_at, latest_id, latest_title, change_kind)
select 'kits', 1, now(), latest.id::text, latest.name, 'baseline'
from (select id, name from public.kits where published = true order by updated_at desc limit 1) latest
on conflict (section) do nothing;

insert into public.site_content_versions(section, version, updated_at, change_kind)
values ('tierlist', 1, now(), 'baseline'), ('about', 1, now(), 'baseline')
on conflict (section) do nothing;

-- Garantiza las cinco filas aunque una sección todavía esté vacía.
insert into public.site_content_versions(section, version, updated_at, change_kind)
values ('logs',1,now(),'baseline'),('guides',1,now(),'baseline'),('tierlist',1,now(),'baseline'),('kits',1,now(),'baseline'),('about',1,now(),'baseline')
on conflict (section) do nothing;

drop function if exists public.get_site_content_versions();

create function public.get_site_content_versions()
returns table (
  section text,
  version bigint,
  updated_at timestamptz,
  latest_id text,
  latest_title text,
  change_kind text
)
language sql
stable
security definer
set search_path = public
as $$
  select v.section, v.version, v.updated_at, v.latest_id, v.latest_title, v.change_kind
    from public.site_content_versions v
   order by case v.section
     when 'logs' then 1
     when 'guides' then 2
     when 'tierlist' then 3
     when 'kits' then 4
     when 'about' then 5
     else 99 end;
$$;

grant execute on function public.get_site_content_versions() to anon, authenticated;

notify pgrst, 'reload schema';

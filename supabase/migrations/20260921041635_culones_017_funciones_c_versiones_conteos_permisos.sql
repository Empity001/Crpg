-- Versiones de contenido (campana de novedades).
create or replace function public.bump_site_content_version(
  input_section text,
  input_latest_id text default null,
  input_latest_title text default null,
  input_change_kind text default 'updated'
)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if input_section not in ('logs', 'guides', 'tierlist', 'kits', 'about') then
    return;
  end if;

  if input_change_kind not in ('baseline', 'published', 'updated', 'removed') then
    input_change_kind := 'updated';
  end if;

  insert into public.site_content_versions (section, version, updated_at, latest_id, latest_title, change_kind)
  values (input_section, 1, now(), nullif(input_latest_id, ''), nullif(input_latest_title, ''), input_change_kind)
  on conflict (section) do update
    set version = public.site_content_versions.version + 1,
        updated_at = now(),
        latest_id = excluded.latest_id,
        latest_title = excluded.latest_title,
        change_kind = excluded.change_kind;
end;
$$;

-- Logs y Kits: solo cuentan como novedad los cambios que afectan a lo público.
-- Corrección: un "me gusta" (que solo cambia logs.likes) ya no marca el Log como actualizado.
create or replace function public.touch_published_content_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  section_name text := tg_argv[0];
  title_column text := tg_argv[1];
  new_row jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  old_row jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  row_data jsonb := coalesce(new_row, old_row);
  affects_public boolean;
  event_kind text := 'updated';
begin
  if tg_op = 'INSERT' then
    affects_public := (new_row ->> 'published')::boolean;
    event_kind := 'published';
  elsif tg_op = 'DELETE' then
    affects_public := (old_row ->> 'published')::boolean;
    event_kind := 'removed';
  else
    if (new_row - 'likes') = (old_row - 'likes') then
      return new;
    end if;
    affects_public := (new_row ->> 'published')::boolean or (old_row ->> 'published')::boolean;
    if not (old_row ->> 'published')::boolean and (new_row ->> 'published')::boolean then
      event_kind := 'published';
    elsif (old_row ->> 'published')::boolean and not (new_row ->> 'published')::boolean then
      event_kind := 'removed';
    end if;
  end if;

  if coalesce(affects_public, false) then
    perform public.bump_site_content_version(
      section_name,
      case when event_kind = 'removed' then null else row_data ->> 'id' end,
      case when event_kind = 'removed' then null else row_data ->> title_column end,
      event_kind
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.touch_guides_content_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  guide_id uuid;
  guide_title text;
  affects_public boolean := false;
  event_kind text := 'updated';
begin
  if tg_table_name = 'weapons' then
    guide_id := case when tg_op = 'DELETE' then old.id else new.id end;
    guide_title := case when tg_op = 'DELETE' then old.name else new.name end;
    if tg_op = 'INSERT' then
      affects_public := new.published;
      event_kind := 'published';
    elsif tg_op = 'DELETE' then
      affects_public := old.published;
      event_kind := 'removed';
    else
      affects_public := new.published or old.published;
      if not old.published and new.published then
        event_kind := 'published';
      elsif old.published and not new.published then
        event_kind := 'removed';
      end if;
    end if;
  else
    guide_id := case when tg_op = 'DELETE' then old.weapon_id else new.weapon_id end;
    select published, name into affects_public, guide_title from public.weapons where id = guide_id;
  end if;

  if coalesce(affects_public, false) then
    perform public.bump_site_content_version(
      'guides',
      case when event_kind = 'removed' then null else guide_id::text end,
      case when event_kind = 'removed' then null else guide_title end,
      event_kind
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Cambios que siempre cuentan (tierlist y categorías/tipos de guías).
create or replace function public.touch_simple_content_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.bump_site_content_version(tg_argv[0], null, null, 'updated');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.touch_about_content_version()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if (case when tg_op = 'DELETE' then old.key else new.key end) = 'about_blocks' then
    perform public.bump_site_content_version('about', null, null, 'updated');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists site_versions_logs on public.logs;
create trigger site_versions_logs
  after insert or update or delete on public.logs
  for each row execute function public.touch_published_content_version('logs', 'title');

drop trigger if exists site_versions_kits on public.kits;
create trigger site_versions_kits
  after insert or update or delete on public.kits
  for each row execute function public.touch_published_content_version('kits', 'name');

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
  for each row execute function public.touch_simple_content_version('guides');

drop trigger if exists site_versions_weapon_types on public.weapon_types;
create trigger site_versions_weapon_types
  after insert or update or delete on public.weapon_types
  for each row execute function public.touch_simple_content_version('guides');

drop trigger if exists site_versions_tierlist_rows on public.tierlist_rows;
create trigger site_versions_tierlist_rows
  after insert or update or delete on public.tierlist_rows
  for each row execute function public.touch_simple_content_version('tierlist');

drop trigger if exists site_versions_tierlist_items on public.tierlist_items;
create trigger site_versions_tierlist_items
  after insert or update or delete on public.tierlist_items
  for each row execute function public.touch_simple_content_version('tierlist');

drop trigger if exists site_versions_about on public.app_settings;
create trigger site_versions_about
  after insert or update or delete on public.app_settings
  for each row execute function public.touch_about_content_version();

create or replace function public.get_site_content_versions()
returns table (
  section      text,
  version      bigint,
  updated_at   timestamptz,
  latest_id    text,
  latest_title text,
  change_kind  text
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select v.section, v.version, v.updated_at, v.latest_id, v.latest_title, v.change_kind
  from public.site_content_versions v
  order by array_position(array['logs', 'guides', 'tierlist', 'kits', 'about'], v.section);
$$;

-- Lista pública de Logs con sus conteos (respeta RLS: solo lo publicado).
create or replace function public.list_public_logs_with_counts()
returns table (
  id uuid,
  title text,
  description text,
  category text,
  relevance text,
  likes integer,
  created_at timestamptz,
  cover_image_url text,
  published boolean,
  mob_count bigint,
  item_count bigint,
  extra_count bigint
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select
    l.id, l.title, l.description, l.category, l.relevance, l.likes, l.created_at,
    l.cover_image_url, l.published,
    coalesce(m.mob_count, 0),
    coalesce(i.item_count, 0),
    coalesce(i.extra_count, 0)
  from public.logs l
  left join (
    select log_id, count(*)::bigint as mob_count
    from public.log_mobs
    group by log_id
  ) m on m.log_id = l.id
  left join (
    select
      log_id,
      count(*) filter (where item_type is distinct from '_libre')::bigint as item_count,
      count(*) filter (where item_type = '_libre')::bigint as extra_count
    from public.log_items
    group by log_id
  ) i on i.log_id = l.id
  order by l.created_at desc;
$$;

-- Endurecimiento: por defecto NINGUNA función es ejecutable por el navegador (anon / authenticated).
-- Toda la administración pasa por la Edge Function con service_role.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname not in ('toggle_like', 'like_comment', 'get_site_content_versions', 'list_public_logs_with_counts', 'list_kits')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

-- Las únicas funciones que el visitante puede llamar directamente.
grant execute on function public.toggle_like(uuid, text) to anon, authenticated, service_role;
grant execute on function public.like_comment(uuid, text) to anon, authenticated, service_role;
grant execute on function public.get_site_content_versions() to anon, authenticated, service_role;
grant execute on function public.list_public_logs_with_counts() to anon, authenticated, service_role;
grant execute on function public.list_kits(text) to anon, authenticated, service_role;

-- Las funciones nuevas que se creen en el futuro también nacen cerradas al navegador.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

notify pgrst, 'reload schema';

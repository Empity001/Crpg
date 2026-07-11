-- =========================================================
-- CULONES-RPG · Migración 018
-- Portada independiente para cada log
-- =========================================================
-- Ejecutar una vez en Supabase Dashboard → SQL Editor.
-- Esta migración conserva los RPC antiguos y añade una variante nueva
-- de create_log/update_log con input_cover_image_url.
-- =========================================================

alter table public.logs
  add column if not exists cover_image_url text;

comment on column public.logs.cover_image_url is
  'Imagen opcional usada en la lista compacta de logs. Si es null, la UI muestra el icono de la categoría.';

-- ---------------------------------------------------------
-- create_log con portada independiente
-- ---------------------------------------------------------
create or replace function public.create_log(
  input_code text,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null,
  input_mobs jsonb default '[]'::jsonb,
  input_items jsonb default '[]'::jsonb,
  input_cover_image_url text default null
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  new_log public.logs;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.logs (
    title, description, category, relevance, created_at, cover_image_url
  )
  values (
    input_title,
    input_description,
    input_category,
    input_relevance,
    coalesce(input_created_at, now()),
    nullif(trim(input_cover_image_url), '')
  )
  returning * into new_log;

  insert into public.log_mobs (
    log_id, name, health, damage, armor, equipment, location,
    description, extra_fields, image_url, sort_order
  )
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb))
    with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (
    log_id, name, tier, item_type, obtained_from, damage,
    enchantments, description, extra_fields, image_url, sort_order
  )
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    nullif(elem->>'damage', '')::integer,
    coalesce(elem->'enchantments', '[]'::jsonb),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb))
    with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.action_log (actor, action, description)
  values ('Admin', 'log_created', format('📜 Log creado: "%s"', input_title));

  insert into public.action_log (actor, action, description)
  select 'Admin', 'mob_created',
    format('👾 Mob agregado: "%s" (en "%s")', trim(elem->>'name'), input_title)
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.action_log (actor, action, description)
  select
    'Admin',
    case when (elem->>'item_type') = '_libre' then 'block_created' else 'item_created' end,
    format(
      '%s agregado: "%s" (en "%s")',
      case when (elem->>'item_type') = '_libre' then '📋 Bloque libre' else '🗡 Item' end,
      trim(elem->>'name'),
      input_title
    )
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  return new_log;
end;
$$;

grant execute on function public.create_log(
  text, text, text, text, text, timestamptz, jsonb, jsonb, text
) to anon, authenticated;

-- ---------------------------------------------------------
-- update_log con portada independiente
-- ---------------------------------------------------------
create or replace function public.update_log(
  input_code text,
  input_id uuid,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null,
  input_mobs jsonb default '[]'::jsonb,
  input_items jsonb default '[]'::jsonb,
  input_cover_image_url text default null
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_log public.logs;
  old_mob_names text[];
  old_item_names text[];
  new_mob_names text[];
  new_item_names text[];
  added_mobs text[];
  removed_mobs text[];
  added_items text[];
  removed_items text[];
  n text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select coalesce(array_agg(name), array[]::text[])
    into old_mob_names
  from public.log_mobs
  where log_id = input_id;

  select coalesce(array_agg(name), array[]::text[])
    into old_item_names
  from public.log_items
  where log_id = input_id;

  update public.logs
  set title = input_title,
      description = input_description,
      category = input_category,
      relevance = input_relevance,
      created_at = coalesce(input_created_at, created_at),
      cover_image_url = nullif(trim(input_cover_image_url), '')
  where id = input_id
  returning * into updated_log;

  delete from public.log_mobs where log_id = input_id;
  delete from public.log_items where log_id = input_id;

  insert into public.log_mobs (
    log_id, name, health, damage, armor, equipment, location,
    description, extra_fields, image_url, sort_order
  )
  select
    input_id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb))
    with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (
    log_id, name, tier, item_type, obtained_from, damage,
    enchantments, description, extra_fields, image_url, sort_order
  )
  select
    input_id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    nullif(elem->>'damage', '')::integer,
    coalesce(elem->'enchantments', '[]'::jsonb),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb))
    with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[])
    into new_mob_names
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[])
    into new_item_names
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  added_mobs   := array(select unnest(new_mob_names) except select unnest(old_mob_names));
  removed_mobs := array(select unnest(old_mob_names) except select unnest(new_mob_names));
  added_items   := array(select unnest(new_item_names) except select unnest(old_item_names));
  removed_items := array(select unnest(old_item_names) except select unnest(new_item_names));

  insert into public.action_log (actor, action, description)
  values ('Admin', 'log_updated', format('✏️ Log editado: "%s"', input_title));

  foreach n in array added_mobs loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'mob_created', format('👾 Mob agregado: "%s" (en "%s")', n, input_title));
  end loop;

  foreach n in array removed_mobs loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'mob_deleted', format('👾 Mob quitado: "%s" (de "%s")', n, input_title));
  end loop;

  foreach n in array added_items loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'item_created', format('🗡 Item/bloque agregado: "%s" (en "%s")', n, input_title));
  end loop;

  foreach n in array removed_items loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'item_deleted', format('🗡 Item/bloque quitado: "%s" (de "%s")', n, input_title));
  end loop;

  return updated_log;
end;
$$;

grant execute on function public.update_log(
  text, uuid, text, text, text, text, timestamptz, jsonb, jsonb, text
) to anon, authenticated;

notify pgrst, 'reload schema';

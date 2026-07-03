-- =========================================================
-- CULONES-RPG · Migración 005
-- Bitácora de acciones ("Acciones realizadas"): registra TODO
-- lo que pasa en la web — creación/edición/borrado de logs,
-- mobs, items y bloques libres; categorías; moderación de
-- comentarios; comentarios nuevos de visitantes; cambios de
-- configuración de fichas. Solo visible para admins.
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr sobre una base que ya tiene schema.sql +
-- migration_002 + migration_003 + migration_004 aplicados.
-- =========================================================

-- ---------------------------------------------------------
-- 1) TABLA: action_log
--    Totalmente bloqueada para lectura/escritura directa vía
--    anon key (mismo patrón que admin_codes) — solo se lee a
--    través de list_action_log (valida código de admin) y solo
--    se escribe desde dentro de las funciones RPC / el trigger
--    de comentarios, todas SECURITY DEFINER.
-- ---------------------------------------------------------
create table if not exists public.action_log (
  id          uuid primary key default gen_random_uuid(),
  actor       text not null default 'Admin', -- 'Admin' o el alias de quien comentó
  action      text not null,                  -- clave corta: log_created, mob_deleted, etc.
  description text not null,                  -- texto ya armado, listo para mostrar
  created_at  timestamptz not null default now()
);

create index if not exists action_log_created_at_idx on public.action_log (created_at desc);

alter table public.action_log enable row level security;

drop policy if exists "action_log_no_direct_access" on public.action_log;
create policy "action_log_no_direct_access"
  on public.action_log for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------
-- 2) list_action_log: única puerta de lectura, admin-gated.
-- ---------------------------------------------------------
create or replace function public.list_action_log(
  input_code text,
  input_limit integer default 300
)
returns setof public.action_log
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  return query
    select * from public.action_log
    order by created_at desc
    limit coalesce(input_limit, 300);
end;
$$;

grant execute on function public.list_action_log(text, integer) to anon, authenticated;

-- ---------------------------------------------------------
-- 3) create_log: ahora también registra "log creado" y un
--    evento por cada mob/item/bloque libre incluido.
-- ---------------------------------------------------------
create or replace function public.create_log(
  input_code text,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null,
  input_mobs jsonb default '[]'::jsonb,
  input_items jsonb default '[]'::jsonb
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

  insert into public.logs (title, description, category, relevance, created_at)
  values (
    input_title, input_description, input_category, input_relevance,
    coalesce(input_created_at, now())
  )
  returning * into new_log;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, description, extra_fields, image_url, sort_order)
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
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url, sort_order)
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
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  -- ---- Bitácora ----
  insert into public.action_log (actor, action, description)
  values ('Admin', 'log_created', format('📜 Log creado: "%s"', input_title));

  insert into public.action_log (actor, action, description)
  select 'Admin', 'mob_created', format('👾 Mob agregado: "%s" (en "%s")', trim(elem->>'name'), input_title)
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.action_log (actor, action, description)
  select 'Admin',
    case when (elem->>'item_type') = '_libre' then 'block_created' else 'item_created' end,
    format('%s agregado: "%s" (en "%s")',
      case when (elem->>'item_type') = '_libre' then '📋 Bloque libre' else '🗡 Item' end,
      trim(elem->>'name'), input_title)
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  return new_log;
end;
$$;

grant execute on function public.create_log(text, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 4) update_log: compara mobs/items ANTES vs DESPUÉS (por
--    nombre) para registrar exactamente qué se agregó y qué
--    se quitó, además del "log editado" general.
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
  input_items jsonb default '[]'::jsonb
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

  select coalesce(array_agg(name), array[]::text[]) into old_mob_names
  from public.log_mobs where log_id = input_id;

  select coalesce(array_agg(name), array[]::text[]) into old_item_names
  from public.log_items where log_id = input_id;

  update public.logs
  set title = input_title,
      description = input_description,
      category = input_category,
      relevance = input_relevance,
      created_at = coalesce(input_created_at, created_at)
  where id = input_id
  returning * into updated_log;

  delete from public.log_mobs where log_id = input_id;
  delete from public.log_items where log_id = input_id;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, description, extra_fields, image_url, sort_order)
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
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url, sort_order)
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
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[]) into new_mob_names
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[]) into new_item_names
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  added_mobs   := array(select unnest(new_mob_names) except select unnest(old_mob_names));
  removed_mobs := array(select unnest(old_mob_names) except select unnest(new_mob_names));
  added_items   := array(select unnest(new_item_names) except select unnest(old_item_names));
  removed_items := array(select unnest(old_item_names) except select unnest(new_item_names));

  -- ---- Bitácora ----
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

grant execute on function public.update_log(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 5) delete_log: registra el título antes de borrarlo.
-- ---------------------------------------------------------
create or replace function public.delete_log(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  log_title text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select title into log_title from public.logs where id = input_id;

  delete from public.logs where id = input_id;

  if log_title is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'log_deleted', format('🗑 Log eliminado: "%s"', log_title));
  end if;
end;
$$;

grant execute on function public.delete_log(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------
-- 6) create_category / delete_category: registran el cambio.
-- ---------------------------------------------------------
create or replace function public.create_category(
  input_code text,
  input_slug text,
  input_label text,
  input_emoji text,
  input_color text
)
returns public.categories
language plpgsql
security definer
set search_path = public
as $$
declare
  new_category public.categories;
  clean_slug text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  clean_slug := lower(regexp_replace(trim(input_slug), '[^a-z0-9_]+', '-', 'g'));

  if clean_slug = '' then
    raise exception 'El identificador de categoría no puede estar vacío';
  end if;

  insert into public.categories (slug, label, emoji, color)
  values (clean_slug, input_label, coalesce(input_emoji, '📦'), coalesce(input_color, '#9a92b8'))
  returning * into new_category;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'category_created', format('🏷 Categoría creada: "%s"', new_category.label));

  return new_category;
end;
$$;

grant execute on function public.create_category(text, text, text, text, text) to anon, authenticated;

create or replace function public.delete_category(
  input_code text,
  input_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  logs_using_it integer;
  cat_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select count(*) into logs_using_it from public.logs where category = input_slug;

  if logs_using_it > 0 then
    raise exception 'No se puede borrar: % log(s) usan esta categoría', logs_using_it;
  end if;

  select label into cat_label from public.categories where slug = input_slug;

  delete from public.categories where slug = input_slug;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'category_deleted', format('🏷 Categoría eliminada: "%s"', coalesce(cat_label, input_slug)));
end;
$$;

grant execute on function public.delete_category(text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- 7) set_comment_hidden / delete_comment: moderación de admin.
-- ---------------------------------------------------------
create or replace function public.set_comment_hidden(
  input_code text,
  input_id uuid,
  input_hidden boolean
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.comments;
  log_title text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.comments set hidden = input_hidden
  where id = input_id
  returning * into result;

  select title into log_title from public.logs where id = result.log_id;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    case when input_hidden then 'comment_hidden' else 'comment_shown' end,
    format('💬 Comentario de "%s" %s (en "%s")',
      coalesce(result.username, 'Anónimo'),
      case when input_hidden then 'ocultado' else 'mostrado de nuevo' end,
      coalesce(log_title, '—'))
  );

  return result;
end;
$$;

grant execute on function public.set_comment_hidden(text, uuid, boolean) to anon, authenticated;

create or replace function public.delete_comment(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comments;
  log_title text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into c from public.comments where id = input_id;

  delete from public.comments where id = input_id;

  if c.id is not null then
    select title into log_title from public.logs where id = c.log_id;
    insert into public.action_log (actor, action, description)
    values ('Admin', 'comment_deleted', format('💬 Comentario de "%s" eliminado (en "%s")', coalesce(c.username, 'Anónimo'), coalesce(log_title, '—')));
  end if;
end;
$$;

grant execute on function public.delete_comment(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------
-- 8) update_app_setting: cambios en "Configurar fichas".
-- ---------------------------------------------------------
create or replace function public.update_app_setting(
  input_code text,
  input_key text,
  input_value jsonb
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.app_settings;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values (input_key, input_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'field_config_updated', format('⚙ Configuración de fichas actualizada ("%s")', input_key));

  return result;
end;
$$;

grant execute on function public.update_app_setting(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- 9) TRIGGER: comentario nuevo de cualquier visitante (no pasa
--    por una función RPC, así que se captura con un trigger).
-- ---------------------------------------------------------
create or replace function public.log_comment_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  log_title text;
begin
  select title into log_title from public.logs where id = new.log_id;

  insert into public.action_log (actor, action, description)
  values (
    coalesce(new.username, 'Anónimo'),
    'comment_created',
    format('💬 %s comentó en "%s"%s',
      coalesce(new.username, 'Anónimo'),
      coalesce(log_title, '—'),
      case when new.parent_id is not null then ' (respuesta)' else '' end)
  );

  return new;
end;
$$;

drop trigger if exists trg_log_comment_created on public.comments;
create trigger trg_log_comment_created
  after insert on public.comments
  for each row execute function public.log_comment_created();

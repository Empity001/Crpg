-- =========================================================
-- CULONES-RPG · Migración 014
-- Action Logs descriptivos desde cliente
-- =========================================================
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New query.
-- Requiere migration_005_action_log.sql aplicada.
--
-- No cambia la tabla action_log ni reemplaza created_at del servidor.
-- Solo agrega una puerta admin-gated para que la UI registre acciones
-- realizadas en cliente: export/import, fondo y multimedia.
-- =========================================================

create or replace function public.record_admin_action(
  input_code text,
  input_action text,
  input_description text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_action text := left(coalesce(nullif(trim(input_action), ''), 'admin_action'), 80);
  clean_description text := left(coalesce(nullif(trim(input_description), ''), 'Acción administrativa registrada sin descripción.'), 240);
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.action_log (actor, action, description)
  values ('Admin', clean_action, clean_description);
end;
$$;

grant execute on function public.record_admin_action(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- Descripciones mejoradas para acciones existentes.
-- Mantienen las mismas firmas RPC.
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
  old_log public.logs;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into old_log from public.logs where id = input_id;

  delete from public.logs where id = input_id;

  if old_log.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'log_deleted',
      format(
        'Se eliminó el log "%s"%s.',
        coalesce(nullif(trim(old_log.title), ''), 'log sin título'),
        case
          when old_log.created_at is not null
            then format(' del %s', to_char(old_log.created_at at time zone 'America/Santo_Domingo', 'DD Mon YYYY, HH24:MI'))
          else ''
        end
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_log(text, uuid) to anon, authenticated;

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
    format(
      'Se %s el comentario de "%s" en el log "%s".',
      case when input_hidden then 'ocultó' else 'restauró' end,
      coalesce(nullif(trim(result.username), ''), 'Anónimo'),
      coalesce(nullif(trim(log_title), ''), 'log sin título')
    )
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
    values (
      'Admin',
      'comment_deleted',
      format(
        'Se borró un comentario de "%s" en el log "%s".',
        coalesce(nullif(trim(c.username), ''), 'Anónimo'),
        coalesce(nullif(trim(log_title), ''), 'log sin título')
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_comment(text, uuid) to anon, authenticated;

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
  action_key text;
  action_description text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values (input_key, input_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into result;

  action_key := case
    when input_key = 'background_config' and coalesce(input_value->>'image_url', '') <> '' then 'background_updated'
    when input_key = 'background_config' then 'background_cleared'
    else 'field_config_updated'
  end;

  action_description := case
    when input_key = 'background_config' and coalesce(input_value->>'image_url', '') <> '' then 'Se cambió el fondo principal.'
    when input_key = 'background_config' then 'Se quitó el fondo principal.'
    else format('Se actualizó la configuración de fichas ("%s").', coalesce(input_key, 'configuración'))
  end;

  insert into public.action_log (actor, action, description)
  values ('Admin', action_key, action_description);

  return result;
end;
$$;

grant execute on function public.update_app_setting(text, text, jsonb) to anon, authenticated;

create or replace function public.create_tierlist_row(
  input_code text,
  input_name text,
  input_color text default '#9a92b8'
)
returns public.tierlist_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  new_row public.tierlist_rows;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select coalesce(max(sort_order) + 1, 0) into next_order from public.tierlist_rows;

  insert into public.tierlist_rows (name, color, sort_order)
  values (coalesce(trim(input_name), 'Nueva fila'), coalesce(input_color, '#9a92b8'), next_order)
  returning * into new_row;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'tierlist_row_created',
    format('Se creó la fila de tierlist "%s" en la posición %s.', new_row.name, new_row.sort_order + 1)
  );

  return new_row;
end;
$$;

grant execute on function public.create_tierlist_row(text, text, text) to anon, authenticated;

create or replace function public.update_tierlist_row(
  input_code text,
  input_id uuid,
  input_name text,
  input_color text
)
returns public.tierlist_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tierlist_rows;
  old_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name into old_name from public.tierlist_rows where id = input_id;

  update public.tierlist_rows
  set name = coalesce(trim(input_name), name),
      color = coalesce(input_color, color)
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'tierlist_row_updated',
    format(
      'Se editó la fila de tierlist "%s"%s.',
      result.name,
      case when old_name is not null and old_name <> result.name then format(' (antes "%s")', old_name) else '' end
    )
  );

  return result;
end;
$$;

grant execute on function public.update_tierlist_row(text, uuid, text, text) to anon, authenticated;

create or replace function public.delete_tierlist_row(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_name text;
  affected_items integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name into row_name from public.tierlist_rows where id = input_id;
  select count(*) into affected_items from public.tierlist_items where row_id = input_id;

  delete from public.tierlist_rows where id = input_id;

  if row_name is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'tierlist_row_deleted',
      format(
        'Se eliminó la fila de tierlist "%s"; %s elemento(s) volvieron a "Sin clasificar".',
        row_name,
        affected_items
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_tierlist_row(text, uuid) to anon, authenticated;

create or replace function public.upsert_tierlist_item(
  input_code text,
  input_id uuid,
  input_name text,
  input_image_url text,
  input_column_key text,
  input_row_id uuid,
  input_extra_fields jsonb default '[]'::jsonb
)
returns public.tierlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tierlist_items;
  next_order integer;
  row_name text;
  column_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_name), '') = '' then
    raise exception 'El elemento necesita un nombre';
  end if;

  if input_column_key not in ('weapon', 'subweapon', 'accessory') then
    raise exception 'Columna inválida: %', input_column_key;
  end if;

  select name into row_name from public.tierlist_rows where id = input_row_id;
  column_label := case input_column_key
    when 'weapon' then 'Arma'
    when 'subweapon' then 'Subarma'
    when 'accessory' then 'Accesorio'
    else input_column_key
  end;

  if input_id is null then
    select coalesce(max(sort_order) + 1, 0) into next_order
    from public.tierlist_items
    where column_key = input_column_key
      and coalesce(row_id::text, 'bench') = coalesce(input_row_id::text, 'bench');

    insert into public.tierlist_items (row_id, column_key, name, image_url, extra_fields, sort_order)
    values (
      input_row_id,
      input_column_key,
      trim(input_name),
      nullif(trim(input_image_url), ''),
      coalesce(input_extra_fields, '[]'::jsonb),
      next_order
    )
    returning * into result;

    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'tierlist_item_created',
      format(
        'Se creó el elemento de tierlist "%s" en %s / %s.',
        result.name,
        column_label,
        coalesce(nullif(trim(row_name), ''), 'Sin clasificar')
      )
    );
  else
    update public.tierlist_items
    set name = trim(input_name),
        image_url = nullif(trim(input_image_url), ''),
        extra_fields = coalesce(input_extra_fields, extra_fields)
    where id = input_id
    returning * into result;

    select name into row_name from public.tierlist_rows where id = result.row_id;

    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'tierlist_item_updated',
      format(
        'Se editó el elemento de tierlist "%s" en %s / %s.',
        result.name,
        column_label,
        coalesce(nullif(trim(row_name), ''), 'Sin clasificar')
      )
    );
  end if;

  return result;
end;
$$;

grant execute on function public.upsert_tierlist_item(text, uuid, text, text, text, uuid, jsonb) to anon, authenticated;

create or replace function public.delete_tierlist_item(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.tierlist_items;
  row_name text;
  column_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into item from public.tierlist_items where id = input_id;
  select name into row_name from public.tierlist_rows where id = item.row_id;
  column_label := case item.column_key
    when 'weapon' then 'Arma'
    when 'subweapon' then 'Subarma'
    when 'accessory' then 'Accesorio'
    else coalesce(item.column_key, 'columna desconocida')
  end;

  delete from public.tierlist_items where id = input_id;

  if item.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'tierlist_item_deleted',
      format(
        'Se eliminó el elemento de tierlist "%s" de %s / %s.',
        coalesce(nullif(trim(item.name), ''), 'elemento sin nombre'),
        column_label,
        coalesce(nullif(trim(row_name), ''), 'Sin clasificar')
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_tierlist_item(text, uuid) to anon, authenticated;

create or replace function public.create_weapon(
  input_code text,
  input_name text,
  input_image_url text,
  input_category_id uuid,
  input_type_id uuid,
  input_initial_rank_name text default 'MK1'
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  new_weapon public.weapons;
  category_label text;
  type_label text;
  weapon_context text;
  rank_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_name), '') = '' then
    raise exception 'El arma necesita un nombre';
  end if;

  select label into category_label from public.weapon_categories where id = input_category_id;
  select label into type_label from public.weapon_types where id = input_type_id;
  weapon_context := case
    when category_label is not null and type_label is not null
      then format(' (categoría: %s, tipo: %s)', category_label, type_label)
    when category_label is not null
      then format(' (categoría: %s)', category_label)
    when type_label is not null
      then format(' (tipo: %s)', type_label)
    else ''
  end;
  rank_label := coalesce(nullif(trim(input_initial_rank_name), ''), 'MK1');

  insert into public.weapons (name, image_url, category_id, type_id, published)
  values (trim(input_name), nullif(trim(input_image_url), ''), input_category_id, input_type_id, false)
  returning * into new_weapon;

  insert into public.weapon_ranks (weapon_id, name, sort_order)
  values (new_weapon.id, rank_label, 0);

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'weapon_created',
    format(
      'Se creó el arma "%s"%s con rango inicial "%s" (oculta hasta publicarla).',
      new_weapon.name,
      weapon_context,
      rank_label
    )
  );

  return new_weapon;
end;
$$;

grant execute on function public.create_weapon(text, text, text, uuid, uuid, text) to anon, authenticated;

create or replace function public.update_weapon(
  input_code text,
  input_id uuid,
  input_name text,
  input_image_url text,
  input_category_id uuid,
  input_type_id uuid
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapons;
  category_label text;
  type_label text;
  weapon_context text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapons
  set name = coalesce(trim(input_name), name),
      image_url = nullif(trim(input_image_url), ''),
      category_id = input_category_id,
      type_id = input_type_id,
      updated_at = now()
  where id = input_id
  returning * into result;

  select label into category_label from public.weapon_categories where id = result.category_id;
  select label into type_label from public.weapon_types where id = result.type_id;
  weapon_context := case
    when category_label is not null and type_label is not null
      then format(' (categoría: %s, tipo: %s)', category_label, type_label)
    when category_label is not null
      then format(' (categoría: %s)', category_label)
    when type_label is not null
      then format(' (tipo: %s)', type_label)
    else ''
  end;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'weapon_updated',
    format(
      'Se editó el arma "%s"%s.',
      coalesce(nullif(trim(result.name), ''), 'arma sin nombre'),
      weapon_context
    )
  );

  return result;
end;
$$;

grant execute on function public.update_weapon(text, uuid, text, text, uuid, uuid) to anon, authenticated;

create or replace function public.set_weapon_published(
  input_code text,
  input_id uuid,
  input_published boolean
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapons;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapons
  set published = input_published, updated_at = now()
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    case when input_published then 'weapon_published' else 'weapon_unpublished' end,
    format(
      'Se %s el arma "%s".',
      case when input_published then 'publicó' else 'despublicó' end,
      coalesce(nullif(trim(result.name), ''), 'arma sin nombre')
    )
  );

  return result;
end;
$$;

grant execute on function public.set_weapon_published(text, uuid, boolean) to anon, authenticated;

create or replace function public.delete_weapon(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_weapon public.weapons;
  category_label text;
  type_label text;
  weapon_context text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into old_weapon from public.weapons where id = input_id;
  select label into category_label from public.weapon_categories where id = old_weapon.category_id;
  select label into type_label from public.weapon_types where id = old_weapon.type_id;
  weapon_context := case
    when category_label is not null and type_label is not null
      then format(' (categoría: %s, tipo: %s)', category_label, type_label)
    when category_label is not null
      then format(' (categoría: %s)', category_label)
    when type_label is not null
      then format(' (tipo: %s)', type_label)
    else ''
  end;

  delete from public.weapons where id = input_id;

  if old_weapon.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'weapon_deleted',
      format(
        'Se eliminó el arma "%s"%s.',
        coalesce(nullif(trim(old_weapon.name), ''), 'arma sin nombre'),
        weapon_context
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_weapon(text, uuid) to anon, authenticated;

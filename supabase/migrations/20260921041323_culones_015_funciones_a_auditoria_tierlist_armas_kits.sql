-- Sobrecargas antiguas y dependencias del sistema de códigos que ya no existe.
drop function if exists public.create_log(text, text, text, text, text, timestamptz, jsonb, jsonb);
drop function if exists public.update_log(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb);
drop function if exists public.private_hash_admin_code(text);

-- Puerta de administración: solo service_role (la Edge Function ya validó Discord y el rol).
create or replace function public.validate_admin_code(input_code text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

-- Quién está haciendo la petición (la Edge Function envía su Discord ID en una cabecera interna).
create or replace function public.current_admin_owner()
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-culones-discord-user', ''),
    'sin-identidad'
  );
$$;

create or replace function public.private_weapon_context(input_category_id uuid, input_type_id uuid)
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select case
    when x.c is not null and x.t is not null then format(' (categoría: %s, tipo: %s)', x.c, x.t)
    when x.c is not null then format(' (categoría: %s)', x.c)
    when x.t is not null then format(' (tipo: %s)', x.t)
    else ''
  end
  from (
    select
      (select label from public.weapon_categories where id = input_category_id) as c,
      (select label from public.weapon_types where id = input_type_id) as t
  ) x;
$$;

create or replace function public.private_tier_column_label(input_key text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select case input_key
    when 'weapon' then 'Arma'
    when 'subweapon' then 'Subarma'
    when 'accessory' then 'Accesorio'
    else coalesce(input_key, 'columna desconocida')
  end;
$$;

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
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    left(coalesce(nullif(trim(input_action), ''), 'admin_action'), 80),
    left(coalesce(nullif(trim(input_description), ''), 'Acción administrativa registrada sin descripción.'), 240)
  );
end;
$$;

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
  has_image boolean := coalesce(input_value->>'image_url', '') <> '';
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values (input_key, input_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into result;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    case
      when input_key = 'background_config' and has_image then 'background_updated'
      when input_key = 'background_config' then 'background_cleared'
      else 'field_config_updated'
    end,
    case
      when input_key = 'background_config' and has_image then 'Se cambió el fondo principal.'
      when input_key = 'background_config' then 'Se quitó el fondo principal.'
      else format('Se actualizó la configuración de fichas ("%s").', coalesce(input_key, 'configuración'))
    end
  );

  return result;
end;
$$;

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

create or replace function public.upsert_tierlist_item(
  input_code text,
  input_id uuid,
  input_name text,
  input_image_url text,
  input_column_key text,
  input_row_id uuid default null,
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
  else
    update public.tierlist_items
    set name = trim(input_name),
        image_url = nullif(trim(input_image_url), ''),
        extra_fields = coalesce(input_extra_fields, extra_fields)
    where id = input_id
    returning * into result;
  end if;

  select name into row_name from public.tierlist_rows where id = result.row_id;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    case when input_id is null then 'tierlist_item_created' else 'tierlist_item_updated' end,
    format(
      'Se %s el elemento de tierlist "%s" en %s / %s.',
      case when input_id is null then 'creó' else 'editó' end,
      result.name,
      public.private_tier_column_label(input_column_key),
      coalesce(nullif(trim(row_name), ''), 'Sin clasificar')
    )
  );

  return result;
end;
$$;

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
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into item from public.tierlist_items where id = input_id;
  select name into row_name from public.tierlist_rows where id = item.row_id;

  delete from public.tierlist_items where id = input_id;

  if item.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'tierlist_item_deleted',
      format(
        'Se eliminó el elemento de tierlist "%s" de %s / %s.',
        coalesce(nullif(trim(item.name), ''), 'elemento sin nombre'),
        public.private_tier_column_label(item.column_key),
        coalesce(nullif(trim(row_name), ''), 'Sin clasificar')
      )
    );
  end if;
end;
$$;

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
  rank_label text := coalesce(nullif(trim(input_initial_rank_name), ''), 'MK1');
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_name), '') = '' then
    raise exception 'El arma necesita un nombre';
  end if;

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
      public.private_weapon_context(input_category_id, input_type_id),
      rank_label
    )
  );

  return new_weapon;
end;
$$;

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

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'weapon_updated',
    format(
      'Se editó el arma "%s"%s.',
      coalesce(nullif(trim(result.name), ''), 'arma sin nombre'),
      public.private_weapon_context(result.category_id, result.type_id)
    )
  );

  return result;
end;
$$;

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
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into old_weapon from public.weapons where id = input_id;

  delete from public.weapons where id = input_id;

  if old_weapon.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'weapon_deleted',
      format(
        'Se eliminó el arma "%s"%s.',
        coalesce(nullif(trim(old_weapon.name), ''), 'arma sin nombre'),
        public.private_weapon_context(old_weapon.category_id, old_weapon.type_id)
      )
    );
  end if;
end;
$$;

create or replace function public.patch_weapon_rank(
  input_code text,
  input_id uuid,
  input_name text default null,
  input_description text default null,
  input_image_url text default null,
  input_stats jsonb default null,
  input_abilities jsonb default null,
  input_extra_sections jsonb default null,
  input_upgrade_recipe jsonb default null,
  input_clear_upgrade_recipe boolean default false
)
returns public.weapon_ranks
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_ranks;
  weapon_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if input_name is not null and coalesce(trim(input_name), '') = '' then
    raise exception 'El rango necesita un nombre';
  end if;

  update public.weapon_ranks
  set name = case when input_name is null then name else trim(input_name) end,
      description = case when input_description is null then description else nullif(trim(input_description), '') end,
      image_url = case when input_image_url is null then image_url else nullif(trim(input_image_url), '') end,
      stats = coalesce(input_stats, stats),
      abilities = coalesce(input_abilities, abilities),
      extra_sections = coalesce(input_extra_sections, extra_sections),
      upgrade_recipe = case
        when input_clear_upgrade_recipe then null
        when input_upgrade_recipe is not null then input_upgrade_recipe
        else upgrade_recipe
      end
  where id = input_id
  returning * into result;

  if result.id is null then
    raise exception 'El rango ya no existe';
  end if;

  select name into weapon_name from public.weapons where id = result.weapon_id;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'weapon_rank_updated',
    format('📈 Rango "%s" editado en "%s"', result.name, coalesce(weapon_name, '—'))
  );

  return result;
end;
$$;

-- Kits. Correcciones: el admin ahora ve también los kits ocultos (la versión anterior dependía de un
-- código que ya no llega) y se evita devolver cada kit publicado duplicado.
create or replace function public.list_kits(input_code text default null)
returns setof public.kits
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.validate_admin_code(input_code) then
    return query select * from public.kits order by sort_order, created_at;
  else
    return query select * from public.kits where published = true order by sort_order, created_at;
  end if;
end;
$$;

create or replace function public.normalize_kit_items(input_items jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'weapon', coalesce(input_items->'weapon', '[]'::jsonb),
    'accessory', coalesce(input_items->'accessory', '[]'::jsonb),
    'subweapon', coalesce(input_items->'subweapon', '[]'::jsonb)
  );
$$;

create or replace function public.upsert_kit(
  input_code text,
  input_id uuid,
  input_name text,
  input_description text default null,
  input_published boolean default true,
  input_items jsonb default null
)
returns public.kits
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.kits;
  next_order integer;
  clean_name text := nullif(trim(input_name), '');
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Codigo de administrador invalido o expirado';
  end if;

  if clean_name is null then
    raise exception 'El kit necesita un nombre';
  end if;

  if input_id is null then
    select coalesce(max(sort_order) + 1, 0) into next_order from public.kits;

    insert into public.kits (name, description, published, items, sort_order, updated_at)
    values (
      clean_name,
      nullif(trim(coalesce(input_description, '')), ''),
      coalesce(input_published, true),
      public.normalize_kit_items(input_items),
      next_order,
      now()
    )
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_created', format('Se creo el kit recomendado "%s".', result.name));
  else
    update public.kits
    set name = clean_name,
        description = nullif(trim(coalesce(input_description, '')), ''),
        published = coalesce(input_published, published),
        items = public.normalize_kit_items(input_items),
        updated_at = now()
    where id = input_id
    returning * into result;

    if result.id is null then
      raise exception 'El kit ya no existe';
    end if;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_updated', format('Se edito el kit recomendado "%s".', result.name));
  end if;

  return result;
end;
$$;

create or replace function public.delete_kit(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_kit public.kits;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Codigo de administrador invalido o expirado';
  end if;

  select * into old_kit from public.kits where id = input_id;
  delete from public.kits where id = input_id;

  if old_kit.id is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_deleted', format('Se elimino el kit recomendado "%s".', old_kit.name));
  end if;
end;
$$;

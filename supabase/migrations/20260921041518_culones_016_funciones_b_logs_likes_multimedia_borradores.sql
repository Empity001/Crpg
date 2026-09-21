-- Límite de frecuencia (por IP con hash, sin guardar la IP). Solo actúa en peticiones del navegador.
create or replace function public.rate_limit_guard(input_bucket text, input_max integer, input_window_seconds integer)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  raw_ip text := coalesce(
    nullif(headers ->> 'cf-connecting-ip', ''),
    nullif(btrim(split_part(coalesce(headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
    nullif(headers ->> 'x-real-ip', '')
  );
  current_hits integer;
begin
  if raw_ip is null then
    return;
  end if;

  insert into public.rate_limit_hits as r (bucket, actor, window_start, hits)
  values (
    input_bucket,
    left(encode(sha256(convert_to(raw_ip || ':culones', 'UTF8')), 'hex'), 32),
    to_timestamp(floor(extract(epoch from now()) / input_window_seconds) * input_window_seconds),
    1
  )
  on conflict (bucket, actor, window_start) do update set hits = r.hits + 1
  returning r.hits into current_hits;

  if current_hits > input_max then
    raise exception 'Vas demasiado rápido. Espera un momento e inténtalo de nuevo.';
  end if;

  if random() < 0.02 then
    delete from public.rate_limit_hits where window_start < now() - interval '2 days';
  end if;
end;
$$;

create or replace function public.guard_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.rate_limit_guard('comment', 5, 60);
  perform public.rate_limit_guard('comment_hour', 40, 3600);
  new.username := left(btrim(coalesce(new.username, '')), 40);
  if new.username = '' then
    new.username := 'Anónimo';
  end if;
  new.comment := btrim(coalesce(new.comment, ''));
  return new;
end;
$$;

drop trigger if exists comments_guard on public.comments;
create trigger comments_guard
  before insert on public.comments
  for each row execute function public.guard_comment_insert();

-- Logs: escritura de fichas (mobs / items / extras), compartida por crear y editar.
create or replace function public.private_write_log_children(input_log_id uuid, input_mobs jsonb, input_items jsonb)
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  delete from public.log_mobs where log_id = input_log_id;
  delete from public.log_items where log_id = input_log_id;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, description, extra_fields, image_url, sort_order)
  select
    input_log_id,
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
    input_log_id,
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
end;
$$;

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

  insert into public.logs (title, description, category, relevance, created_at, cover_image_url)
  values (
    input_title,
    input_description,
    input_category,
    input_relevance,
    coalesce(input_created_at, now()),
    nullif(trim(input_cover_image_url), '')
  )
  returning * into new_log;

  perform public.private_write_log_children(new_log.id, input_mobs, input_items);

  insert into public.action_log (actor, action, description)
  values ('Admin', 'log_created', format('📜 Log creado: "%s"', input_title));

  insert into public.action_log (actor, action, description)
  select 'Admin', 'mob_created', format('👾 Mob agregado: "%s" (en "%s")', trim(elem->>'name'), input_title)
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.action_log (actor, action, description)
  select
    'Admin',
    case when (elem->>'item_type') = '_libre' then 'block_created' else 'item_created' end,
    format(
      '%s agregado: "%s" (en "%s")',
      case when (elem->>'item_type') = '_libre' then '✦ Extra' else '🗡 Item' end,
      trim(elem->>'name'),
      input_title
    )
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  return new_log;
end;
$$;

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
  n text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select coalesce(array_agg(name), array[]::text[]) into old_mob_names from public.log_mobs where log_id = input_id;
  select coalesce(array_agg(name), array[]::text[]) into old_item_names from public.log_items where log_id = input_id;

  update public.logs
  set title = input_title,
      description = input_description,
      category = input_category,
      relevance = input_relevance,
      created_at = coalesce(input_created_at, created_at),
      cover_image_url = nullif(trim(input_cover_image_url), '')
  where id = input_id
  returning * into updated_log;

  perform public.private_write_log_children(input_id, input_mobs, input_items);

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[]) into new_mob_names
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  select coalesce(array_agg(trim(elem->>'name')), array[]::text[]) into new_item_names
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) as elem
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.action_log (actor, action, description)
  values ('Admin', 'log_updated', format('✏️ Log editado: "%s"', input_title));

  foreach n in array array(select unnest(new_mob_names) except select unnest(old_mob_names)) loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'mob_created', format('👾 Mob agregado: "%s" (en "%s")', n, input_title));
  end loop;

  foreach n in array array(select unnest(old_mob_names) except select unnest(new_mob_names)) loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'mob_deleted', format('👾 Mob quitado: "%s" (de "%s")', n, input_title));
  end loop;

  foreach n in array array(select unnest(new_item_names) except select unnest(old_item_names)) loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'item_created', format('🗡 Item/bloque agregado: "%s" (en "%s")', n, input_title));
  end loop;

  foreach n in array array(select unnest(old_item_names) except select unnest(new_item_names)) loop
    insert into public.action_log (actor, action, description)
    values ('Admin', 'item_deleted', format('🗡 Item/bloque quitado: "%s" (de "%s")', n, input_title));
  end loop;

  return updated_log;
end;
$$;

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
  pub public.log_discord_publications;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into old_log from public.logs where id = input_id;
  select * into pub from public.log_discord_publications where log_id = input_id;

  if pub.log_id is not null then
    insert into public.discord_deletion_queue (log_id, channel_id, summary_message_id, thread_id)
    values (pub.log_id, pub.channel_id, pub.summary_message_id, pub.thread_id);
  end if;

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

create or replace function public.set_log_published(
  input_id uuid,
  input_published boolean
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  current_log public.logs;
  result public.logs;
  publication public.log_discord_publications;
begin
  select * into current_log from public.logs where id = input_id for update;
  if current_log.id is null then
    raise exception 'El Log no existe';
  end if;

  if current_log.published = input_published then
    return current_log;
  end if;

  if input_published = false then
    select * into publication from public.log_discord_publications where log_id = input_id;

    if publication.log_id is not null then
      insert into public.discord_deletion_queue (log_id, channel_id, summary_message_id, thread_id)
      values (publication.log_id, publication.channel_id, publication.summary_message_id, publication.thread_id);

      delete from public.log_discord_publications where log_id = input_id;
    end if;
  end if;

  update public.logs set published = input_published where id = input_id returning * into result;

  insert into public.action_log (
    actor, action, description, entity_type, entity_id, entity_name, old_value, new_value, metadata, success
  ) values (
    'Admin',
    case when input_published then 'log_published' else 'log_unpublished' end,
    case
      when input_published then format(
        'Se publicó el Log “%s”. Volvió a estar visible para la comunidad y el bot lo enviará al canal de Logs.',
        coalesce(nullif(trim(result.title), ''), 'Log sin título')
      )
      else format(
        'Se despublicó el Log “%s”. Dejó de ser visible para la comunidad y su publicación de Discord fue enviada a eliminación.',
        coalesce(nullif(trim(result.title), ''), 'Log sin título')
      )
    end,
    'log',
    result.id::text,
    result.title,
    jsonb_build_object('published', current_log.published),
    jsonb_build_object('published', result.published),
    jsonb_build_object('discord_cleanup_queued', input_published = false),
    true
  );

  return result;
end;
$$;

create or replace function public.list_logs_admin()
returns setof public.logs
language sql
security definer
set search_path = public
as $$
  select * from public.logs order by created_at desc;
$$;

create or replace function public.list_log_mobs_admin()
returns setof public.log_mobs
language sql
security definer
set search_path = public
as $$
  select * from public.log_mobs order by log_id, sort_order, created_at;
$$;

create or replace function public.list_log_items_admin()
returns setof public.log_items
language sql
security definer
set search_path = public
as $$
  select * from public.log_items order by log_id, sort_order, created_at;
$$;

create or replace function public.list_comments_admin(input_log_id uuid)
returns setof public.comments
language sql
security definer
set search_path = public
as $$
  select * from public.comments where log_id = input_log_id order by created_at;
$$;

-- Likes públicos (con límite de frecuencia por IP).
create or replace function public.toggle_like(
  input_log_id uuid,
  input_client_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_likes integer;
begin
  perform public.rate_limit_guard('like', 30, 60);

  if not exists (select 1 from public.logs where id = input_log_id and published = true) then
    raise exception 'Este Log no está disponible públicamente';
  end if;

  if exists (select 1 from public.log_likes where log_id = input_log_id and client_id = input_client_id) then
    delete from public.log_likes where log_id = input_log_id and client_id = input_client_id;
    update public.logs set likes = greatest(likes - 1, 0) where id = input_log_id returning likes into new_likes;
  else
    insert into public.log_likes (log_id, client_id) values (input_log_id, input_client_id);
    update public.logs set likes = likes + 1 where id = input_log_id returning likes into new_likes;
  end if;

  return new_likes;
end;
$$;

create or replace function public.like_comment(
  input_comment_id uuid,
  input_client_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_likes integer;
begin
  perform public.rate_limit_guard('like', 30, 60);

  if not exists (
    select 1
    from public.comments c
    join public.logs l on l.id = c.log_id
    where c.id = input_comment_id and c.hidden = false and l.published = true
  ) then
    raise exception 'Este comentario no está disponible públicamente';
  end if;

  if exists (select 1 from public.comment_likes where comment_id = input_comment_id and client_id = input_client_id) then
    delete from public.comment_likes where comment_id = input_comment_id and client_id = input_client_id;
    update public.comments set likes = greatest(likes - 1, 0) where id = input_comment_id returning likes into new_likes;
  else
    insert into public.comment_likes (comment_id, client_id) values (input_comment_id, input_client_id);
    update public.comments set likes = likes + 1 where id = input_comment_id returning likes into new_likes;
  end if;

  return new_likes;
end;
$$;

-- Categorías de Logs.
create or replace function public.update_category(
  input_code  text,
  input_slug  text,
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
  result public.categories;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if nullif(trim(input_label), '') is null then
    raise exception 'El nombre de la categoría no puede estar vacío';
  end if;

  update public.categories
  set label = trim(input_label),
      emoji = coalesce(nullif(trim(input_emoji), ''), '📦'),
      color = coalesce(nullif(trim(input_color), ''), '#9a92b8')
  where slug = input_slug
  returning * into result;

  if result.slug is null then
    raise exception 'La categoría ya no existe';
  end if;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'category_updated', format('🏷 Categoría editada: "%s"', result.label));

  return result;
end;
$$;

-- Multimedia: reemplazo global del archivo de un recurso (actualiza todas las referencias).
create or replace function public.replace_jsonb_exact_string(
  input_value jsonb,
  input_old text,
  input_new text
)
returns jsonb
language sql
immutable
strict
set search_path = public, pg_catalog
as $$
  select replace(input_value::text, to_jsonb(input_old)::text, to_jsonb(input_new)::text)::jsonb;
$$;

create or replace function public.replace_media_asset_file(
  input_code text,
  input_asset_id uuid,
  input_new_url text,
  input_new_storage_path text,
  input_new_display_name text default null,
  input_new_description text default null,
  input_new_mime_type text default null,
  input_new_media_kind text default 'image',
  input_new_file_size bigint default null,
  input_new_file_hash text default null,
  input_new_tags text[] default '{}'::text[],
  input_new_presentation jsonb default '{}'::jsonb,
  input_new_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_asset public.media_assets;
  saved_asset public.media_assets;
  spec record;
  old_url text;
  old_storage_path text;
  new_url text := nullif(trim(coalesce(input_new_url, '')), '');
  new_path text := nullif(trim(coalesce(input_new_storage_path, '')), '');
  new_kind text := coalesce(nullif(trim(coalesce(input_new_media_kind, '')), ''), 'image');
  affected integer := 0;
  total_affected integer := 0;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into current_asset from public.media_assets where id = input_asset_id for update;

  if current_asset.id is null then
    raise exception 'El recurso multimedia ya no existe';
  end if;

  if current_asset.source_type <> 'storage' then
    raise exception 'Solo se pueden reemplazar archivos almacenados en Supabase Storage';
  end if;

  old_url := nullif(trim(coalesce(current_asset.url, '')), '');
  old_storage_path := nullif(trim(coalesce(current_asset.storage_path, '')), '');

  if old_url is null or new_url is null or new_path is null then
    raise exception 'La URL y la ruta del archivo son obligatorias';
  end if;

  if new_kind not in ('image', 'video', 'audio', 'document', 'other') then
    new_kind := 'other';
  end if;

  -- Cada fila: tabla, columna, tipo de columna y asignaciones extra al actualizar.
  for spec in
    select * from (values
      ('logs',           'cover_image_url', 'text',  ''),
      ('log_mobs',       'image_url',       'text',  ''),
      ('log_items',      'image_url',       'text',  ''),
      ('tierlist_items', 'image_url',       'text',  ''),
      ('weapons',        'image_url',       'text',  ''),
      ('weapon_ranks',   'image_url',       'text',  ''),
      ('log_mobs',       'extra_fields',    'jsonb', ''),
      ('log_items',      'extra_fields',    'jsonb', ''),
      ('tierlist_items', 'extra_fields',    'jsonb', ''),
      ('weapon_ranks',   'stats',           'jsonb', ''),
      ('weapon_ranks',   'abilities',       'jsonb', ''),
      ('weapon_ranks',   'extra_sections',  'jsonb', ''),
      ('weapon_ranks',   'upgrade_recipe',  'jsonb', ''),
      ('kits',           'items',           'jsonb', ', updated_at = now()'),
      ('drafts',         'payload',         'jsonb', ', saved_at = now()'),
      ('app_settings',   'value',           'jsonb', '')
    ) as v(tbl, col, kind, extra)
  loop
    if spec.kind = 'text' then
      execute format('update public.%I set %I = $2 where %I = $1', spec.tbl, spec.col, spec.col)
        using old_url, new_url;
    else
      execute format(
        'update public.%1$I set %2$I = public.replace_jsonb_exact_string(%2$I, $1, $2)%3$s where %2$I is not null and position(to_jsonb($1::text)::text in %2$I::text) > 0',
        spec.tbl, spec.col, spec.extra
      ) using old_url, new_url;
    end if;
    get diagnostics affected = row_count;
    total_affected := total_affected + affected;
  end loop;

  update public.media_assets
  set
    url = new_url,
    bucket = coalesce(nullif(trim(current_asset.bucket), ''), 'culones'),
    storage_path = new_path,
    folder = split_part(new_path, '/', 1),
    display_name = coalesce(nullif(trim(coalesce(input_new_display_name, '')), ''), current_asset.display_name),
    description = nullif(trim(coalesce(input_new_description, '')), ''),
    mime_type = nullif(trim(coalesce(input_new_mime_type, '')), ''),
    media_kind = new_kind,
    file_size = input_new_file_size,
    file_hash = nullif(trim(coalesce(input_new_file_hash, '')), ''),
    tags = coalesce(input_new_tags, current_asset.tags, '{}'::text[]),
    presentation = '{"fit":"contain","position":"center center","repeat":"no-repeat","opacity":1}'::jsonb
      || coalesce(input_new_presentation, current_asset.presentation, '{}'::jsonb),
    metadata = coalesce(current_asset.metadata, '{}'::jsonb)
      || coalesce(input_new_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'replaced_at', now(),
        'replaced_from_url', old_url,
        'replaced_from_storage_path', old_storage_path
      ),
    is_archived = current_asset.is_archived,
    updated_at = now()
  where id = input_asset_id
  returning * into saved_asset;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    'media_file_replaced',
    format(
      'Se reemplazó el archivo del recurso multimedia "%s" y se actualizaron %s registro(s) relacionados.',
      saved_asset.display_name,
      total_affected
    )
  );

  return jsonb_build_object(
    'asset', to_jsonb(saved_asset),
    'updated_records', total_affected,
    'old_url', old_url,
    'old_storage_path', old_storage_path
  );
end;
$$;

-- Bitácora: se completa con la cuenta de Discord que hizo el cambio (cabeceras internas de la Edge Function).
create or replace function public.enrich_action_log_discord_actor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  request_headers jsonb := '{}'::jsonb;
  raw_headers text;
  auth_user text;
  discord_user text;
  actor_b64 text;
  avatar_b64 text;
  request_id text;
begin
  raw_headers := current_setting('request.headers', true);
  if coalesce(raw_headers, '') <> '' then
    begin
      request_headers := raw_headers::jsonb;
    exception when others then
      request_headers := '{}'::jsonb;
    end;
  end if;

  auth_user := coalesce(request_headers ->> 'x-culones-auth-user', '');
  discord_user := coalesce(request_headers ->> 'x-culones-discord-user', '');
  actor_b64 := coalesce(request_headers ->> 'x-culones-actor-b64', '');
  avatar_b64 := coalesce(request_headers ->> 'x-culones-avatar-b64', '');
  request_id := coalesce(request_headers ->> 'x-culones-request-id', '');

  if auth_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.auth_user_id := auth_user::uuid;
  end if;
  if discord_user ~ '^[0-9]{15,22}$' then
    new.discord_user_id := discord_user;
  end if;
  if actor_b64 <> '' then
    begin
      new.actor := left(convert_from(decode(actor_b64, 'base64'), 'UTF8'), 200);
    exception when others then
      null;
    end;
  end if;
  if avatar_b64 <> '' then
    begin
      new.actor_avatar_url := left(convert_from(decode(avatar_b64, 'base64'), 'UTF8'), 1200);
    exception when others then
      null;
    end;
  end if;
  if request_id <> '' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('request_id', request_id, 'source', 'discord-oauth');
  end if;
  return new;
end;
$$;

drop trigger if exists action_log_discord_actor_trigger on public.action_log;
create trigger action_log_discord_actor_trigger
  before insert on public.action_log
  for each row execute function public.enrich_action_log_discord_actor();

-- Borradores: ahora ligados a la cuenta de Discord de quien los guarda.
create or replace function public.upsert_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text,
  input_payload     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.drafts (owner_key, entity_type, entity_id, payload, saved_at)
  values (public.current_admin_owner(), input_entity_type, input_entity_id, input_payload, now())
  on conflict (owner_key, entity_type, entity_id)
  do update set payload = excluded.payload, saved_at = excluded.saved_at
  returning jsonb_build_object('entity_type', entity_type, 'entity_id', entity_id, 'saved_at', saved_at) into result;

  return result;
end;
$$;

create or replace function public.get_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select jsonb_build_object('payload', payload, 'saved_at', saved_at, 'entity_id', entity_id)
  into result
  from public.drafts
  where owner_key = public.current_admin_owner()
    and entity_type = input_entity_type
    and entity_id = input_entity_id;

  return result;
end;
$$;

create or replace function public.delete_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text
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

  delete from public.drafts
  where owner_key = public.current_admin_owner()
    and entity_type = input_entity_type
    and entity_id = input_entity_id;
end;
$$;

create or replace function public.list_drafts(
  input_code text
)
returns table (
  entity_type text,
  entity_id   text,
  saved_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  return query
  select d.entity_type, d.entity_id, d.saved_at
  from public.drafts d
  where d.owner_key = public.current_admin_owner()
  order by d.saved_at desc;
end;
$$;

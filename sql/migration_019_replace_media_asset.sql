-- =========================================================
-- CULONES-RPG · Migración 019
-- Reemplazo global de archivos de la Biblioteca Multimedia
-- =========================================================
-- Ejecutar una sola vez en Supabase Dashboard -> SQL Editor.
-- Requiere las migraciones 011, 016 y 018 aplicadas.
--
-- Permite subir un archivo nuevo y sustituir la URL anterior en todos
-- los lugares donde se usa: logs, mobs, items, tierlist, guías,
-- recetas, kits, borradores y ajustes globales. El frontend elimina el
-- objeto viejo de Storage solo después de que esta transacción termine.
-- =========================================================

create or replace function public.replace_jsonb_exact_string(
  input_value jsonb,
  input_old text,
  input_new text
)
returns jsonb
language sql
immutable
strict
as $$
  select replace(
    input_value::text,
    to_jsonb(input_old)::text,
    to_jsonb(input_new)::text
  )::jsonb;
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

  select * into current_asset
  from public.media_assets
  where id = input_asset_id
  for update;

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

  -- Columnas de URL directas.
  update public.logs set cover_image_url = new_url where cover_image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.log_mobs set image_url = new_url where image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.log_items set image_url = new_url where image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.tierlist_items set image_url = new_url where image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapons set image_url = new_url where image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapon_ranks set image_url = new_url where image_url = old_url;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  -- Campos JSONB que pueden contener recursos anidados.
  update public.log_mobs
  set extra_fields = public.replace_jsonb_exact_string(extra_fields, old_url, new_url)
  where extra_fields is not null
    and position(to_jsonb(old_url)::text in extra_fields::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.log_items
  set extra_fields = public.replace_jsonb_exact_string(extra_fields, old_url, new_url)
  where extra_fields is not null
    and position(to_jsonb(old_url)::text in extra_fields::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.tierlist_items
  set extra_fields = public.replace_jsonb_exact_string(extra_fields, old_url, new_url)
  where extra_fields is not null
    and position(to_jsonb(old_url)::text in extra_fields::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapon_ranks
  set stats = public.replace_jsonb_exact_string(stats, old_url, new_url)
  where stats is not null
    and position(to_jsonb(old_url)::text in stats::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapon_ranks
  set abilities = public.replace_jsonb_exact_string(abilities, old_url, new_url)
  where abilities is not null
    and position(to_jsonb(old_url)::text in abilities::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapon_ranks
  set extra_sections = public.replace_jsonb_exact_string(extra_sections, old_url, new_url)
  where extra_sections is not null
    and position(to_jsonb(old_url)::text in extra_sections::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.weapon_ranks
  set upgrade_recipe = public.replace_jsonb_exact_string(upgrade_recipe, old_url, new_url)
  where upgrade_recipe is not null
    and position(to_jsonb(old_url)::text in upgrade_recipe::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.kits
  set items = public.replace_jsonb_exact_string(items, old_url, new_url),
      updated_at = now()
  where items is not null
    and position(to_jsonb(old_url)::text in items::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.drafts
  set payload = public.replace_jsonb_exact_string(payload, old_url, new_url),
      saved_at = now()
  where payload is not null
    and position(to_jsonb(old_url)::text in payload::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  update public.app_settings
  set value = public.replace_jsonb_exact_string(value, old_url, new_url)
  where value is not null
    and position(to_jsonb(old_url)::text in value::text) > 0;
  get diagnostics affected = row_count; total_affected := total_affected + affected;

  -- Conserva el mismo registro de biblioteca, pero apunta al archivo nuevo.
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

grant execute on function public.replace_media_asset_file(
  text, uuid, text, text, text, text, text, text, bigint, text, text[], jsonb, jsonb
) to anon, authenticated;

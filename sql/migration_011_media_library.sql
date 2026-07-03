-- =========================================================
-- CULONES-RPG · Migración 011
-- Sistema Multimedia: biblioteca reutilizable + metadatos
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Requiere migración 001–010 aplicada previamente.
--
-- Esta migración NO elimina ni cambia los campos image_url actuales.
-- La biblioteca multimedia nace como capa de metadatos/reutilización
-- encima de Supabase Storage. Las URLs externas se manejan por uso en
-- el selector y no necesitan registro permanente en media_assets.
-- =========================================================

-- ── Ampliar tipos aceptados en el bucket ───────────────────────
-- La UI sigue restringiendo los campos image_url actuales a imágenes,
-- pero la biblioteca queda preparada para videos MP4/WEBM.
update storage.buckets
set
  file_size_limit = 26214400, -- 25 MB
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/apng',
    'video/mp4',
    'video/webm'
  ]::text[]
where id = 'culones';

-- ── Tabla de recursos multimedia ───────────────────────────────
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'storage'
    check (source_type = 'storage'),
  bucket text,
  storage_path text,
  folder text,
  url text not null,
  display_name text not null,
  description text,
  mime_type text,
  media_kind text not null default 'image'
    check (media_kind in ('image', 'video', 'audio', 'document', 'other')),
  file_size bigint,
  file_hash text,
  tags text[] not null default '{}'::text[],
  presentation jsonb not null default '{"fit":"contain","position":"center center","repeat":"no-repeat","opacity":1}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists media_assets_url_unique
  on public.media_assets (url);

create index if not exists media_assets_hash_idx
  on public.media_assets (file_hash)
  where file_hash is not null;

create index if not exists media_assets_kind_idx
  on public.media_assets (media_kind, source_type, is_archived, created_at desc);

alter table public.media_assets enable row level security;

-- Sin políticas directas: el frontend usa RPCs admin-gated.

-- ── Listar recursos ────────────────────────────────────────────
create or replace function public.list_media_assets(
  input_code text,
  input_include_archived boolean default false
)
returns setof public.media_assets
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  return query
    select *
    from public.media_assets
    where input_include_archived or not is_archived
    order by created_at desc;
end;
$$;

-- ── Buscar duplicado por hash o URL ────────────────────────────
create or replace function public.find_media_duplicate(
  input_code text,
  input_file_hash text default null,
  input_url text default null
)
returns public.media_assets
language plpgsql
security definer
set search_path = public
as $$
declare
  found_asset public.media_assets;
  clean_hash text := nullif(trim(coalesce(input_file_hash, '')), '');
  clean_url text := nullif(trim(coalesce(input_url, '')), '');
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select *
  into found_asset
  from public.media_assets
  where not is_archived
    and (
      (clean_hash is not null and file_hash = clean_hash)
      or (clean_url is not null and url = clean_url)
    )
  order by created_at asc
  limit 1;

  return found_asset;
end;
$$;

-- ── Crear/actualizar recurso ───────────────────────────────────
create or replace function public.upsert_media_asset(
  input_code text,
  input_source_type text,
  input_url text,
  input_bucket text default null,
  input_storage_path text default null,
  input_display_name text default null,
  input_mime_type text default null,
  input_media_kind text default 'image',
  input_file_size bigint default null,
  input_file_hash text default null,
  input_description text default null,
  input_folder text default null,
  input_tags text[] default '{}'::text[],
  input_presentation jsonb default '{}'::jsonb,
  input_metadata jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public
as $$
declare
  saved_asset public.media_assets;
  existing_id uuid;
  clean_url text := nullif(trim(coalesce(input_url, '')), '');
  clean_hash text := nullif(trim(coalesce(input_file_hash, '')), '');
  clean_source text := coalesce(nullif(trim(input_source_type), ''), 'storage');
  clean_kind text := coalesce(nullif(trim(input_media_kind), ''), 'image');
  clean_name text;
  clean_path text := nullif(trim(coalesce(input_storage_path, '')), '');
  clean_folder text := nullif(trim(coalesce(input_folder, '')), '');
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if clean_url is null then
    raise exception 'La URL del recurso es obligatoria';
  end if;

  if clean_source <> 'storage' then
    clean_source := 'storage';
  end if;

  if clean_kind not in ('image', 'video', 'audio', 'document', 'other') then
    clean_kind := 'other';
  end if;

  clean_name := nullif(trim(coalesce(input_display_name, '')), '');
  if clean_name is null then
    clean_name := regexp_replace(split_part(clean_url, '?', 1), '^.*/', '');
  end if;
  if clean_name is null or clean_name = '' then
    clean_name := 'Recurso multimedia';
  end if;

  if clean_folder is null and clean_path is not null then
    clean_folder := split_part(clean_path, '/', 1);
  end if;

  select id
  into existing_id
  from public.media_assets
  where (clean_hash is not null and file_hash = clean_hash)
     or url = clean_url
  order by created_at asc
  limit 1;

  if existing_id is not null then
    update public.media_assets
    set
      source_type = clean_source,
      bucket = nullif(trim(coalesce(input_bucket, '')), ''),
      storage_path = clean_path,
      folder = clean_folder,
      url = clean_url,
      display_name = clean_name,
      description = nullif(trim(coalesce(input_description, '')), ''),
      mime_type = nullif(trim(coalesce(input_mime_type, '')), ''),
      media_kind = clean_kind,
      file_size = input_file_size,
      file_hash = clean_hash,
      tags = coalesce(input_tags, '{}'::text[]),
      presentation = '{"fit":"contain","position":"center center","repeat":"no-repeat","opacity":1}'::jsonb || coalesce(input_presentation, '{}'::jsonb),
      metadata = coalesce(input_metadata, '{}'::jsonb),
      is_archived = false,
      updated_at = now()
    where id = existing_id
    returning * into saved_asset;
  else
    insert into public.media_assets (
      source_type, bucket, storage_path, folder, url, display_name,
      description, mime_type, media_kind, file_size, file_hash,
      tags, presentation, metadata
    )
    values (
      clean_source,
      nullif(trim(coalesce(input_bucket, '')), ''),
      clean_path,
      clean_folder,
      clean_url,
      clean_name,
      nullif(trim(coalesce(input_description, '')), ''),
      nullif(trim(coalesce(input_mime_type, '')), ''),
      clean_kind,
      input_file_size,
      clean_hash,
      coalesce(input_tags, '{}'::text[]),
      '{"fit":"contain","position":"center center","repeat":"no-repeat","opacity":1}'::jsonb || coalesce(input_presentation, '{}'::jsonb),
      coalesce(input_metadata, '{}'::jsonb)
    )
    returning * into saved_asset;
  end if;

  return saved_asset;
end;
$$;

-- ── Editar metadatos visibles ──────────────────────────────────
create or replace function public.update_media_asset(
  input_code text,
  input_id uuid,
  input_display_name text,
  input_description text default null,
  input_tags text[] default '{}'::text[],
  input_presentation jsonb default '{}'::jsonb
)
returns public.media_assets
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_asset public.media_assets;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.media_assets
  set
    display_name = coalesce(nullif(trim(input_display_name), ''), display_name),
    description = nullif(trim(coalesce(input_description, '')), ''),
    tags = coalesce(input_tags, '{}'::text[]),
    presentation = '{"fit":"contain","position":"center center","repeat":"no-repeat","opacity":1}'::jsonb || coalesce(input_presentation, '{}'::jsonb),
    updated_at = now()
  where id = input_id
  returning * into updated_asset;

  return updated_asset;
end;
$$;

-- ── Archivar / restaurar metadatos ─────────────────────────────
-- No borra el archivo de Storage: solo oculta el registro de biblioteca.
create or replace function public.archive_media_asset(
  input_code text,
  input_id uuid,
  input_archived boolean default true
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

  update public.media_assets
  set is_archived = input_archived,
      updated_at = now()
  where id = input_id;
end;
$$;

grant execute on function public.list_media_assets(text, boolean) to anon, authenticated;
grant execute on function public.find_media_duplicate(text, text, text) to anon, authenticated;
grant execute on function public.upsert_media_asset(text, text, text, text, text, text, text, text, bigint, text, text, text, text[], jsonb, jsonb) to anon, authenticated;
grant execute on function public.update_media_asset(text, uuid, text, text, text[], jsonb) to anon, authenticated;
grant execute on function public.archive_media_asset(text, uuid, boolean) to anon, authenticated;

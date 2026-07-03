-- =========================================================
-- CULONES-RPG - Migracion 013
-- Selector Multimedia liviano
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard -> SQL Editor -> New query
-- Requiere migracion 011 aplicada previamente.
--
-- Esta funcion es solo para el modo selector. Devuelve columnas minimas,
-- solo recursos activos y una pagina acotada para que abrir el picker no
-- cargue archivados, usos ni metadatos administrativos completos.
-- =========================================================

create or replace function public.list_media_picker_assets(
  input_code text,
  input_search text default '',
  input_media_kind text default 'all',
  input_source_type text default 'all',
  input_sort text default 'recent',
  input_limit integer default 32,
  input_offset integer default 0
)
returns table (
  id uuid,
  url text,
  display_name text,
  media_kind text,
  mime_type text,
  source_type text,
  file_size bigint,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_search text := lower(trim(coalesce(input_search, '')));
  clean_kind text := coalesce(nullif(trim(input_media_kind), ''), 'all');
  clean_source text := coalesce(nullif(trim(input_source_type), ''), 'all');
  clean_sort text := coalesce(nullif(trim(input_sort), ''), 'recent');
  safe_limit integer := greatest(1, least(coalesce(input_limit, 32), 80));
  safe_offset integer := greatest(0, coalesce(input_offset, 0));
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Codigo de administrador invalido o expirado';
  end if;

  if clean_kind not in ('all', 'image', 'video', 'audio', 'document', 'other') then
    clean_kind := 'all';
  end if;

  if clean_source not in ('all', 'storage') then
    clean_source := 'all';
  end if;

  if clean_sort not in ('recent', 'oldest', 'name', 'size') then
    clean_sort := 'recent';
  end if;

  return query
    select
      ma.id,
      ma.url,
      ma.display_name,
      ma.media_kind,
      ma.mime_type,
      ma.source_type,
      ma.file_size,
      ma.created_at
    from public.media_assets ma
    where not ma.is_archived
      and (clean_kind = 'all' or ma.media_kind = clean_kind)
      and (clean_source = 'all' or ma.source_type = clean_source)
      and (
        clean_search = ''
        or lower(coalesce(ma.display_name, '')) like '%' || clean_search || '%'
        or lower(coalesce(ma.mime_type, '')) like '%' || clean_search || '%'
        or lower(coalesce(ma.url, '')) like '%' || clean_search || '%'
      )
    order by
      case when clean_sort = 'name' then lower(ma.display_name) end asc nulls last,
      case when clean_sort = 'oldest' then ma.created_at end asc nulls last,
      case when clean_sort = 'size' then ma.file_size end desc nulls last,
      case when clean_sort = 'recent' then ma.created_at end desc nulls last,
      ma.created_at desc
    limit safe_limit
    offset safe_offset;
end;
$$;

grant execute on function public.list_media_picker_assets(text, text, text, text, text, integer, integer) to anon, authenticated;

-- =========================================================
-- CULONES-RPG · Fix: create_category con slug automático
-- =========================================================
-- Problema anterior: el cliente mandaba input_slug = label (texto
-- libre), lo que causaba "duplicate key" si el nombre ya existía
-- como slug, y también si el usuario usaba el mismo nombre dos veces.
--
-- Solución: la función ignora input_slug y genera el slug
-- internamente a partir de input_label. Si el slug base ya existe,
-- añade sufijo -2, -3, etc. hasta encontrar uno libre.
--
-- El parámetro input_slug se mantiene en la firma para no romper
-- ninguna llamada existente desde el cliente (se acepta pero se ignora).
-- =========================================================

create or replace function public.create_category(
  input_code  text,
  input_slug  text,   -- ignorado; se genera desde input_label
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
  base_slug    text;
  candidate    text;
  counter      int := 1;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  -- Genera slug desde el label: minúsculas, no-alfanuméricos → '-',
  -- recorta guiones al inicio/fin, colapsa guiones múltiples.
  base_slug := trim(
    both '-' from
    regexp_replace(
      lower(trim(input_label)),
      '[^a-z0-9]+', '-', 'g'
    )
  );

  if base_slug = '' then
    raise exception 'El nombre de la categoría no puede estar vacío o contener solo caracteres especiales';
  end if;

  -- Busca el primer slug disponible (base, base-2, base-3, ...)
  candidate := base_slug;
  loop
    exit when not exists (select 1 from public.categories where slug = candidate);
    counter   := counter + 1;
    candidate := base_slug || '-' || counter;
  end loop;

  insert into public.categories (slug, label, emoji, color)
  values (candidate, input_label, coalesce(nullif(trim(input_emoji), ''), '📦'), coalesce(nullif(trim(input_color), ''), '#9a92b8'))
  returning * into new_category;

  return new_category;
end;
$$;

-- Los permisos ya existían; se reaplican por si acaso.
grant execute on function public.create_category(text, text, text, text, text) to anon, authenticated;

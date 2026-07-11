-- =========================================================
-- CULONES-RPG · Editar categorías de Logs
-- =========================================================
-- Permite cambiar nombre visible, emoji y color sin modificar el slug.
-- Mantener el slug evita romper los logs que ya usan la categoría.
-- Ejecutar una sola vez en Supabase > SQL Editor.
-- =========================================================

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

  if to_regclass('public.action_log') is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'category_updated', format('🏷 Categoría editada: "%s"', result.label));
  end if;

  return result;
end;
$$;

grant execute on function public.update_category(text, text, text, text, text) to anon, authenticated;

-- =========================================================
-- CULONES-RPG · Migración 012
-- Sistema Multimedia: borrado definitivo de recursos archivados
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard -> SQL Editor -> New query
-- Requiere migración 011 aplicada previamente.
--
-- El archivado sigue siendo reversible. Esta función elimina solo el
-- registro de la Biblioteca Multimedia; la UI intenta borrar también el
-- objeto de Storage antes de invocarla cuando existe storage_path.
-- =========================================================

create or replace function public.delete_media_asset(
  input_code text,
  input_id uuid
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

  delete from public.media_assets
  where id = input_id;
end;
$$;

grant execute on function public.delete_media_asset(text, uuid) to anon, authenticated;

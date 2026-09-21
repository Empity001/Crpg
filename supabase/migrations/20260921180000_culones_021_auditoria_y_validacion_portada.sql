-- 021: auditoría y validación de la disposición de la portada.
--
-- update_app_setting guardaba cualquier clave y registraba todo lo que no fuera
-- el fondo como "configuración de fichas", incluido el nuevo lienzo de la
-- portada (app_settings.layout_home). Ahora:
--   * layout_home se audita como 'layout_updated' ("Se reorganizó la portada.");
--   * layout_home se valida en el servidor (objeto con lista de ventanas, máximo
--     40 y tamaño acotado), sin fiarse de que el navegador ya lo haya hecho.
-- La firma no cambia, así que los permisos ya revocados a anon/authenticated
-- siguen igual: solo la ejecuta la Edge Function con service_role.

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

  if input_key = 'layout_home' then
    if jsonb_typeof(input_value) is distinct from 'object'
       or jsonb_typeof(input_value->'windows') is distinct from 'array' then
      raise exception 'La disposición de la portada no es válida';
    end if;
    if jsonb_array_length(input_value->'windows') > 40
       or octet_length(input_value::text) > 200000 then
      raise exception 'La disposición de la portada es demasiado grande';
    end if;
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
      when input_key = 'layout_home' then 'layout_updated'
      else 'field_config_updated'
    end,
    case
      when input_key = 'background_config' and has_image then 'Se cambió el fondo principal.'
      when input_key = 'background_config' then 'Se quitó el fondo principal.'
      when input_key = 'layout_home' then 'Se reorganizó la portada.'
      else format('Se actualizó la configuración de fichas ("%s").', coalesce(input_key, 'configuración'))
    end
  );

  return result;
end;
$$;

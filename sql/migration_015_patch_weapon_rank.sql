-- =========================================================
-- CULONES-RPG · Migración 015
-- PATCH parcial de rangos de armas
-- =========================================================
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New query.
-- Requiere migration_008_weapons.sql aplicada.
--
-- No reemplaza upsert_weapon_rank. Agrega una RPC más pequeña para
-- editar campos concretos de weapon_ranks sin reenviar el rango entero.
-- =========================================================

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
  set name = case
        when input_name is null then name
        else trim(input_name)
      end,
      description = case
        when input_description is null then description
        else nullif(trim(input_description), '')
      end,
      image_url = case
        when input_image_url is null then image_url
        else nullif(trim(input_image_url), '')
      end,
      stats = case
        when input_stats is null then stats
        else coalesce(input_stats, '[]'::jsonb)
      end,
      abilities = case
        when input_abilities is null then abilities
        else coalesce(input_abilities, '[]'::jsonb)
      end,
      extra_sections = case
        when input_extra_sections is null then extra_sections
        else coalesce(input_extra_sections, '[]'::jsonb)
      end,
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

grant execute on function public.patch_weapon_rank(
  text, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb, boolean
) to anon, authenticated;

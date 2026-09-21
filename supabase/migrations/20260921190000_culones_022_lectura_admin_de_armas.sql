-- 022: lectura de armas y rangos (incluidos borradores) solo para administración.
--
-- Hoy la web y el panel leen weapons y weapon_ranks directamente con la clave
-- pública, y por eso sus políticas de lectura son using (true): cualquiera
-- puede leer también los borradores. Estas dos funciones dan al panel de
-- administración otra puerta para leer todo (la Edge Function las ejecuta con
-- service_role), de modo que la migración 023 pueda cerrar la lectura pública
-- a lo publicado sin dejar al administrador sin sus borradores.
--
-- Esta migración solo añade funciones: no cambia ninguna política ni ningún
-- comportamiento existente.

create or replace function public.list_weapons_admin()
returns setof public.weapons
language sql
stable
security definer
set search_path = public
as $$
  select * from public.weapons order by sort_order, created_at;
$$;

create or replace function public.list_weapon_ranks_admin()
returns setof public.weapon_ranks
language sql
stable
security definer
set search_path = public
as $$
  select * from public.weapon_ranks order by sort_order, created_at;
$$;

revoke all on function public.list_weapons_admin() from public, anon, authenticated;
revoke all on function public.list_weapon_ranks_admin() from public, anon, authenticated;
grant execute on function public.list_weapons_admin() to service_role;
grant execute on function public.list_weapon_ranks_admin() to service_role;

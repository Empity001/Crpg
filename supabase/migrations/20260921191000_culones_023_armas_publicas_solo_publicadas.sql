-- 023: la lectura pública de armas y rangos solo entrega lo publicado.
--
-- weapons_select_public y weapon_ranks_select_public eran using (true), así que
-- cualquiera que llamara a la API con la clave pública podía leer también las
-- armas sin publicar y todos sus datos (estadísticas, habilidades, recetas). La
-- web pública los ocultaba en el cliente, pero no en la base de datos.
--
-- Va después de la migración 022: el panel de administración ya lee los
-- borradores por list_weapons_admin y list_weapon_ranks_admin (service_role),
-- que no dependen de estas políticas. Aplicar esta migración antes de publicar
-- la web que usa esas funciones dejaría al administrador sin sus borradores.

drop policy if exists "weapons_select_public" on public.weapons;
create policy "weapons_select_public" on public.weapons
  for select to anon, authenticated
  using (published = true);

drop policy if exists "weapon_ranks_select_public" on public.weapon_ranks;
create policy "weapon_ranks_select_public" on public.weapon_ranks
  for select to anon, authenticated
  using (exists (
    select 1 from public.weapons w
    where w.id = weapon_ranks.weapon_id and w.published = true
  ));

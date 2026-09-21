-- app_settings: la política "no_direct_write" (FOR ALL) duplicaba el SELECT; sin políticas de escritura ya se deniega por defecto.
drop policy if exists "app_settings_no_direct_write" on public.app_settings;

-- media_assets: solo se toca desde el panel (service_role); denegación explícita al navegador.
drop policy if exists "media_assets_no_client" on public.media_assets;
create policy "media_assets_no_client" on public.media_assets for all to anon, authenticated
  using (false) with check (false);

-- Estas dos lecturas no necesitan privilegios elevados: la RLS ya filtra por rol.
-- (service_role ignora RLS y ve todo; anon / authenticated solo ven lo publicado.)
create or replace function public.list_kits(input_code text default null)
returns setof public.kits
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select * from public.kits order by sort_order, created_at;
$$;

create or replace function public.get_site_content_versions()
returns table (
  section      text,
  version      bigint,
  updated_at   timestamptz,
  latest_id    text,
  latest_title text,
  change_kind  text
)
language sql
stable
security invoker
set search_path = public, pg_catalog
as $$
  select v.section, v.version, v.updated_at, v.latest_id, v.latest_title, v.change_kind
  from public.site_content_versions v
  order by array_position(array['logs', 'guides', 'tierlist', 'kits', 'about'], v.section);
$$;

grant execute on function public.list_kits(text) to anon, authenticated, service_role;
grant execute on function public.get_site_content_versions() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

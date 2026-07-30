-- Empi Network - hotfix de publicación y experiencia del constructor
-- Requiere migration_025, migration_026 y migration_027.
-- Es idempotente y no modifica el contenido legacy de Culones RPG.

begin;

do $$
begin
  if to_regclass('public.sites') is null or to_regclass('public.site_pages') is null then
    raise exception 'Faltan las tablas de Empi Network. Ejecuta primero las migraciones 025, 026 y 027.';
  end if;
end;
$$;

-- Recupera las instancias afectadas por el comportamiento anterior: tenían
-- al menos una página pública, pero el portal seguía marcado como borrador.
with activated as (
  update public.sites s set
    status = 'active',
    updated_at = now()
  where s.status = 'draft'
    and s.deleted_at is null
    and exists (
      select 1
      from public.site_pages p
      where p.site_id = s.id
        and p.status = 'published'
        and p.published_document is not null
        and p.deleted_at is null
    )
  returning s.id
)
insert into public.site_audit_log (
  site_id, actor_mode, action, entity_type, entity_id, new_value, metadata
)
select
  id, 'platform_owner', 'site.activate', 'site', id::text,
  jsonb_build_object('status', 'active'),
  jsonb_build_object('source', 'migration_028', 'reason', 'Página publicada en portal borrador')
from activated;

create or replace function public.network_publish_page(
  input_page_id uuid,
  input_site_id uuid,
  input_created_by uuid,
  input_created_by_discord_id text,
  input_reason text
)
returns public.site_pages
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  updated_page public.site_pages;
  next_version bigint;
  site_activated boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_page_id::text, 0));

  update public.site_pages set
    published_document = draft_document,
    status = 'published',
    published_at = now()
  where id = input_page_id and site_id = input_site_id and deleted_at is null
  returning * into updated_page;

  if not found then
    raise exception using errcode = 'P0002', message = 'La página no existe.';
  end if;

  update public.sites set
    status = 'active',
    updated_at = now()
  where id = input_site_id and status = 'draft' and deleted_at is null;
  site_activated := found;

  if site_activated then
    insert into public.site_audit_log (
      site_id, auth_user_id, discord_user_id, actor_mode, action,
      entity_type, entity_id, new_value, metadata
    ) values (
      input_site_id, input_created_by, input_created_by_discord_id,
      'platform_owner', 'site.activate', 'site', input_site_id::text,
      jsonb_build_object('status', 'active'),
      jsonb_build_object('source', 'page.publish')
    );
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.site_page_versions where page_id = input_page_id;

  insert into public.site_page_versions (
    site_id, page_id, version_number, stage, document, metadata, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id, input_page_id, next_version, 'published', updated_page.published_document,
    jsonb_build_object(
      'name', updated_page.name,
      'title', updated_page.title,
      'slug', updated_page.slug,
      'isHome', updated_page.is_home,
      'seo', updated_page.seo_config,
      'access', updated_page.access_config
    ),
    coalesce(nullif(btrim(input_reason), ''), 'Publicación desde el constructor'),
    input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'page.publish', 'site_page', input_page_id::text,
    jsonb_build_object('version', next_version, 'slug', updated_page.slug)
  );

  return updated_page;
end;
$$;

revoke all on function public.network_publish_page(uuid,uuid,uuid,text,text) from public;
revoke all on function public.network_publish_page(uuid,uuid,uuid,text,text) from anon;
revoke all on function public.network_publish_page(uuid,uuid,uuid,text,text) from authenticated;
grant execute on function public.network_publish_page(uuid,uuid,uuid,text,text) to service_role;

commit;

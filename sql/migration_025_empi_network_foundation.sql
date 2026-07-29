-- =========================================================
-- EMPI NETWORK · Migración 025
-- Fundación multisitio, PLATFORM_OWNER, perfiles y aislamiento.
-- =========================================================
-- Requiere las migraciones 001–024.
-- Es aditiva: Culones conserva sus tablas, RPC y comportamiento actual.
-- Ejecutar primero en staging y guardar un backup antes de producción.
-- =========================================================

begin;

create extension if not exists pgcrypto;

-- Identificador estable del primer sitio. Usarlo como default mantiene
-- compatibles todas las escrituras legacy que todavía no envían site_id.
create table if not exists public.platform_owners (
  discord_user_id text primary key,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint platform_owners_discord_id_valid check (discord_user_id ~ '^\d{15,22}$')
);

insert into public.platform_owners (discord_user_id, active)
values ('726444396970770494', true)
on conflict (discord_user_id) do update set active = excluded.active;

alter table public.platform_owners enable row level security;
drop policy if exists "platform_owners_no_client" on public.platform_owners;
create policy "platform_owners_no_client"
  on public.platform_owners for all to anon, authenticated
  using (false) with check (false);

create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  status text not null default 'draft',
  public_base_url text,
  discord_guild_id text,
  theme_config jsonb not null default '{
    "mode":"dark",
    "palette":{"background":"#050505","surface":"#101010","text":"#ffffff","muted":"#a3a3a3","accent":"#ffffff"}
  }'::jsonb,
  navigation_config jsonb not null default '{
    "desktop":{"position":"top","visible":true,"alignment":"center"},
    "tablet":{"position":"top","visible":true,"alignment":"start"},
    "mobile":{"position":"bottom","visible":true,"alignment":"center"},
    "items":[]
  }'::jsonb,
  search_config jsonb not null default '{
    "enabled":true,"position":"header","scope":"site","placeholder":"Buscar…","sources":[]
  }'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sites_slug_valid check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 2 and 64),
  constraint sites_name_valid check (char_length(btrim(name)) between 1 and 100),
  constraint sites_status_valid check (status in ('draft','active','maintenance','archived','suspended')),
  constraint sites_guild_id_valid check (discord_guild_id is null or discord_guild_id ~ '^\d{15,22}$'),
  constraint sites_public_base_url_valid check (public_base_url is null or public_base_url ~* '^https?://[^[:space:]]+$'),
  constraint sites_theme_object check (jsonb_typeof(theme_config) = 'object'),
  constraint sites_navigation_object check (jsonb_typeof(navigation_config) = 'object'),
  constraint sites_search_object check (jsonb_typeof(search_config) = 'object')
);

create unique index if not exists sites_discord_guild_unique_idx
  on public.sites(discord_guild_id)
  where discord_guild_id is not null;
create index if not exists sites_status_created_idx
  on public.sites(status, created_at desc);

insert into public.sites (
  id, slug, name, description, status, public_base_url,
  created_by_discord_id, navigation_config, search_config
)
values (
  '00000000-0000-4000-8000-000000000001',
  'culones-rpg',
  'Culones RPG',
  'Servidor RPG/Gacha y primera instancia de Empi Network.',
  'active',
  'https://empity001.github.io/empi-network/logs.html',
  '726444396970770494',
  '{
    "desktop":{"position":"left","visible":true,"alignment":"start"},
    "tablet":{"position":"left","visible":true,"alignment":"start"},
    "mobile":{"position":"top","visible":true,"alignment":"start"},
    "items":[
      {"key":"logs","label":"Logs","url":"logs.html"},
      {"key":"guides","label":"Guías","url":"guides.html"},
      {"key":"tierlist","label":"Tierlist","url":"tierlist.html"},
      {"key":"kits","label":"Kits","url":"kits.html"},
      {"key":"about","label":"Acerca","url":"about.html"}
    ]
  }'::jsonb,
  '{
    "enabled":true,"position":"header","scope":"site","placeholder":"Buscar en Culones RPG…",
    "sources":["logs","guides","tierlist","kits","about"]
  }'::jsonb
)
on conflict (id) do update set
  slug = excluded.slug,
  name = excluded.name,
  description = excluded.description,
  public_base_url = excluded.public_base_url,
  updated_at = now();

create table if not exists public.site_role_profiles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  role_key text not null,
  display_name text not null,
  description text not null default '',
  is_system boolean not null default false,
  is_default_admin boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, role_key),
  unique (id, site_id),
  constraint site_role_key_valid check (role_key ~ '^[a-z][a-z0-9_-]{1,47}$'),
  constraint site_role_name_valid check (char_length(btrim(display_name)) between 1 and 80)
);

create unique index if not exists site_role_default_admin_unique_idx
  on public.site_role_profiles(site_id)
  where is_default_admin;

create table if not exists public.site_role_permissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  role_profile_id uuid not null,
  permission_key text not null,
  effect text not null default 'allow',
  constraints jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (role_profile_id, permission_key),
  foreign key (role_profile_id, site_id)
    references public.site_role_profiles(id, site_id) on delete cascade,
  constraint site_role_permission_key_valid check (permission_key ~ '^[a-z*][a-z0-9_.*:-]{0,119}$'),
  constraint site_role_permission_effect_valid check (effect in ('allow','deny')),
  constraint site_role_permission_constraints_object check (jsonb_typeof(constraints) = 'object')
);

create index if not exists site_role_permissions_site_role_idx
  on public.site_role_permissions(site_id, role_profile_id);

create table if not exists public.site_discord_role_mappings (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  role_profile_id uuid not null,
  discord_role_id text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, role_profile_id, discord_role_id),
  foreign key (role_profile_id, site_id)
    references public.site_role_profiles(id, site_id) on delete cascade,
  constraint site_discord_role_id_valid check (discord_role_id ~ '^\d{15,22}$')
);

create index if not exists site_discord_role_mappings_role_idx
  on public.site_discord_role_mappings(discord_role_id, site_id);

create table if not exists public.site_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  version_number bigint not null,
  snapshot jsonb not null,
  reason text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (site_id, version_number),
  constraint site_versions_snapshot_object check (jsonb_typeof(snapshot) = 'object')
);

create table if not exists public.site_audit_log (
  id bigint generated always as identity primary key,
  site_id uuid references public.sites(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  discord_user_id text,
  actor_mode text not null default 'platform_owner',
  action text not null,
  entity_type text,
  entity_id text,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}'::jsonb,
  success boolean not null default true,
  created_at timestamptz not null default now(),
  constraint site_audit_actor_mode_valid check (actor_mode in ('normal','site_admin_supreme','platform_owner')),
  constraint site_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists site_audit_log_site_created_idx
  on public.site_audit_log(site_id, created_at desc);
create index if not exists site_audit_log_actor_created_idx
  on public.site_audit_log(discord_user_id, created_at desc);

-- El navegador solo puede leer sitios activos. Cualquier mutación Owner pasa
-- por network-admin-api, que vuelve a validar la identidad Discord.
alter table public.sites enable row level security;
drop policy if exists "sites_public_read_active" on public.sites;
create policy "sites_public_read_active"
  on public.sites for select to anon, authenticated
  using (status = 'active');

alter table public.site_role_profiles enable row level security;
alter table public.site_role_permissions enable row level security;
alter table public.site_discord_role_mappings enable row level security;
alter table public.site_versions enable row level security;
alter table public.site_audit_log enable row level security;

drop policy if exists "site_role_profiles_no_client" on public.site_role_profiles;
create policy "site_role_profiles_no_client" on public.site_role_profiles
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "site_role_permissions_no_client" on public.site_role_permissions;
create policy "site_role_permissions_no_client" on public.site_role_permissions
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "site_discord_role_mappings_no_client" on public.site_discord_role_mappings;
create policy "site_discord_role_mappings_no_client" on public.site_discord_role_mappings
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "site_versions_no_client" on public.site_versions;
create policy "site_versions_no_client" on public.site_versions
  for all to anon, authenticated using (false) with check (false);
drop policy if exists "site_audit_log_no_client" on public.site_audit_log;
create policy "site_audit_log_no_client" on public.site_audit_log
  for all to anon, authenticated using (false) with check (false);

insert into public.site_role_profiles (
  id, site_id, role_key, display_name, description,
  is_system, is_default_admin, created_by_discord_id
)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'administrador',
  'Administrador',
  'Administrador global de Culones RPG. Usa las herramientas expuestas por Owner.',
  true,
  true,
  '726444396970770494'
)
on conflict (site_id, role_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  is_system = true,
  is_default_admin = true,
  updated_at = now();

insert into public.site_role_permissions (
  site_id, role_profile_id, permission_key, effect
)
select
  '00000000-0000-4000-8000-000000000001',
  id,
  'site.admin.*',
  'allow'
from public.site_role_profiles
where site_id = '00000000-0000-4000-8000-000000000001'
  and role_key = 'administrador'
on conflict (role_profile_id, permission_key) do update set effect = excluded.effect;

-- Añade site_id a datos existentes sin cambiar firmas RPC ni exigir que el
-- frontend legacy lo envíe. Phase 3 sustituirá las unicidades globales que
-- todavía deban convertirse en unicidades por sitio.
do $$
declare
  table_name text;
  constraint_name text;
  legacy_tables text[] := array[
    'logs','categories','log_mobs','log_items','comments','comment_likes',
    'log_likes','app_settings','action_log','kits','media_assets',
    'weapon_categories','weapon_types','weapons','weapon_ranks',
    'tierlist_rows','tierlist_items','drafts','site_content_versions',
    'discord_guild_config','guide_forum_publications','guide_forum_jobs',
    'guide_forum_tag_map','log_discord_publications','discord_deletion_queue'
  ];
begin
  foreach table_name in array legacy_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I add column if not exists site_id uuid', table_name);
    execute format(
      'update public.%I set site_id = $1 where site_id is null',
      table_name
    ) using '00000000-0000-4000-8000-000000000001'::uuid;
    execute format(
      'alter table public.%I alter column site_id set default %L::uuid',
      table_name,
      '00000000-0000-4000-8000-000000000001'
    );
    execute format('alter table public.%I alter column site_id set not null', table_name);

    constraint_name := table_name || '_site_id_fkey';
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', table_name)::regclass
        and conname = constraint_name
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (site_id) references public.sites(id) on delete restrict',
        table_name,
        constraint_name
      );
    end if;

    execute format(
      'create index if not exists %I on public.%I(site_id)',
      table_name || '_site_id_idx',
      table_name
    );
  end loop;
end $$;

create or replace function public.empi_touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sites_touch_updated_at on public.sites;
create trigger sites_touch_updated_at
before update on public.sites
for each row execute function public.empi_touch_updated_at();

drop trigger if exists site_role_profiles_touch_updated_at on public.site_role_profiles;
create trigger site_role_profiles_touch_updated_at
before update on public.site_role_profiles
for each row execute function public.empi_touch_updated_at();

drop trigger if exists site_discord_role_mappings_touch_updated_at on public.site_discord_role_mappings;
create trigger site_discord_role_mappings_touch_updated_at
before update on public.site_discord_role_mappings
for each row execute function public.empi_touch_updated_at();

-- Creación atómica utilizada únicamente por network-admin-api después de
-- verificar PLATFORM_OWNER. No se concede a anon/authenticated.
create or replace function public.network_create_site(
  input_name text,
  input_slug text,
  input_discord_guild_id text,
  input_public_base_url text,
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.sites
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  created_site public.sites;
  admin_profile_id uuid;
begin
  insert into public.sites (
    name, slug, discord_guild_id, public_base_url,
    created_by, created_by_discord_id
  ) values (
    btrim(input_name),
    lower(btrim(input_slug)),
    nullif(btrim(input_discord_guild_id), ''),
    nullif(btrim(input_public_base_url), ''),
    input_created_by,
    input_created_by_discord_id
  )
  returning * into created_site;

  insert into public.site_role_profiles (
    site_id, role_key, display_name, description, is_system,
    is_default_admin, created_by, created_by_discord_id
  ) values (
    created_site.id, 'administrador', 'Administrador',
    'Administrador global de esta instancia.', true, true,
    input_created_by, input_created_by_discord_id
  ) returning id into admin_profile_id;

  insert into public.site_role_permissions (
    site_id, role_profile_id, permission_key, effect
  ) values (
    created_site.id, admin_profile_id, 'site.admin.*', 'allow'
  );

  insert into public.site_versions (
    site_id, version_number, snapshot, reason,
    created_by, created_by_discord_id
  ) values (
    created_site.id,
    1,
    jsonb_build_object(
      'site', to_jsonb(created_site),
      'initialContent', jsonb_build_object('type', 'server_name', 'text', created_site.name)
    ),
    'Creación inicial de la instancia',
    input_created_by,
    input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode,
    action, entity_type, entity_id, new_value
  ) values (
    created_site.id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'site.create', 'site', created_site.id::text,
    to_jsonb(created_site)
  );

  return created_site;
end;
$$;

-- La edición, el versionado y la auditoría se confirman en una sola
-- transacción. El advisory lock evita dos números de versión iguales si el
-- Owner guarda la misma instancia desde dos pestañas.
create or replace function public.network_update_site(
  input_site_id uuid,
  input_patch jsonb,
  input_created_by uuid,
  input_created_by_discord_id text,
  input_reason text
)
returns public.sites
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  before_site public.sites;
  updated_site public.sites;
  next_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_site_id::text, 0));

  select * into before_site
  from public.sites
  where id = input_site_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'La instancia no existe.';
  end if;

  update public.sites set
    name = case when input_patch ? 'name' then btrim(input_patch->>'name') else name end,
    description = case when input_patch ? 'description' then coalesce(input_patch->>'description', '') else description end,
    slug = case when input_patch ? 'slug' then lower(btrim(input_patch->>'slug')) else slug end,
    status = case when input_patch ? 'status' then input_patch->>'status' else status end,
    discord_guild_id = case
      when input_patch ? 'discord_guild_id' then nullif(btrim(coalesce(input_patch->>'discord_guild_id', '')), '')
      else discord_guild_id
    end,
    public_base_url = case
      when input_patch ? 'public_base_url' then nullif(btrim(coalesce(input_patch->>'public_base_url', '')), '')
      else public_base_url
    end,
    theme_config = case when input_patch ? 'theme_config' then input_patch->'theme_config' else theme_config end,
    navigation_config = case when input_patch ? 'navigation_config' then input_patch->'navigation_config' else navigation_config end,
    search_config = case when input_patch ? 'search_config' then input_patch->'search_config' else search_config end
  where id = input_site_id
  returning * into updated_site;

  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.site_versions
  where site_id = input_site_id;

  insert into public.site_versions (
    site_id, version_number, snapshot, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id,
    next_version,
    jsonb_build_object('site', to_jsonb(updated_site)),
    coalesce(nullif(btrim(input_reason), ''), 'Actualización desde Owner'),
    input_created_by,
    input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode,
    action, entity_type, entity_id, old_value, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'site.update', 'site', input_site_id::text,
    to_jsonb(before_site), to_jsonb(updated_site)
  );

  return updated_site;
end;
$$;

-- Perfil y permisos también se reemplazan atómicamente: nunca queda un
-- perfil sin permisos por un fallo a mitad de guardado.
create or replace function public.network_upsert_role(
  input_site_id uuid,
  input_role_id uuid,
  input_role_key text,
  input_display_name text,
  input_description text,
  input_permissions text[],
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.site_role_profiles
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  before_role public.site_role_profiles;
  saved_role public.site_role_profiles;
begin
  if input_role_id is null then
    insert into public.site_role_profiles (
      site_id, role_key, display_name, description,
      created_by, created_by_discord_id
    ) values (
      input_site_id, lower(btrim(input_role_key)), btrim(input_display_name),
      coalesce(input_description, ''), input_created_by, input_created_by_discord_id
    ) returning * into saved_role;
  else
    select * into before_role
    from public.site_role_profiles
    where id = input_role_id and site_id = input_site_id
    for update;

    if not found then
      raise exception using errcode = 'P0002', message = 'El perfil no existe en esta instancia.';
    end if;
    if before_role.is_system and lower(btrim(input_role_key)) <> before_role.role_key then
      raise exception using errcode = '23514', message = 'La clave de un perfil del sistema no puede modificarse.';
    end if;

    update public.site_role_profiles set
      role_key = lower(btrim(input_role_key)),
      display_name = btrim(input_display_name),
      description = coalesce(input_description, '')
    where id = input_role_id and site_id = input_site_id
    returning * into saved_role;
  end if;

  delete from public.site_role_permissions
  where site_id = input_site_id and role_profile_id = saved_role.id;

  insert into public.site_role_permissions (
    site_id, role_profile_id, permission_key, effect
  )
  select input_site_id, saved_role.id, permission_key, 'allow'
  from (
    select distinct btrim(value) as permission_key
    from unnest(coalesce(input_permissions, array[]::text[])) as permission(value)
    where nullif(btrim(value), '') is not null
    union
    select 'site.admin.*' where saved_role.is_default_admin
  ) permissions;

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode,
    action, entity_type, entity_id, old_value, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner',
    case when input_role_id is null then 'role.create' else 'role.update' end,
    'site_role_profile', saved_role.id::text,
    case when input_role_id is null then null else to_jsonb(before_role) end,
    jsonb_build_object(
      'role', to_jsonb(saved_role),
      'permissions', to_jsonb(coalesce(input_permissions, array[]::text[]))
    )
  );

  return saved_role;
end;
$$;

revoke all on function public.network_create_site(text,text,text,text,uuid,text) from public;
grant execute on function public.network_create_site(text,text,text,text,uuid,text) to service_role;
revoke all on function public.network_update_site(uuid,jsonb,uuid,text,text) from public;
grant execute on function public.network_update_site(uuid,jsonb,uuid,text,text) to service_role;
revoke all on function public.network_upsert_role(uuid,uuid,text,text,text,text[],uuid,text) from public;
grant execute on function public.network_upsert_role(uuid,uuid,text,text,text,text[],uuid,text) to service_role;

revoke all on public.platform_owners from anon, authenticated;
revoke insert, update, delete on public.sites from anon, authenticated;
revoke all on public.site_role_profiles from anon, authenticated;
revoke all on public.site_role_permissions from anon, authenticated;
revoke all on public.site_discord_role_mappings from anon, authenticated;
revoke all on public.site_versions from anon, authenticated;
revoke all on public.site_audit_log from anon, authenticated;
grant select on public.sites to anon, authenticated;

commit;

-- =========================================================
-- EMPI NETWORK · Migración 026
-- Constructor universal, páginas versionadas y control Owner.
-- =========================================================
-- Requiere migration_025_empi_network_foundation.sql.
-- Es aditiva y no modifica el renderer ni las tablas legacy de Culones RPG.
-- Ejecutar primero en staging y conservar un backup verificado.
-- =========================================================

begin;

create extension if not exists pgcrypto;

alter table public.sites
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id) on delete set null,
  add column if not exists deletion_reason text,
  add column if not exists builder_config jsonb not null default '{"schemaVersion":1,"enabled":true}'::jsonb,
  add column if not exists draft_theme_config jsonb default '{
    "mode":"dark",
    "palette":{"background":"#050505","surface":"#101010","text":"#ffffff","muted":"#a3a3a3","accent":"#ffffff"}
  }'::jsonb,
  add column if not exists published_theme_version bigint not null default 1;

update public.sites set draft_theme_config = theme_config where draft_theme_config is null;
alter table public.sites alter column draft_theme_config set default '{
  "mode":"dark",
  "palette":{"background":"#050505","surface":"#101010","text":"#ffffff","muted":"#a3a3a3","accent":"#ffffff"}
}'::jsonb;
alter table public.sites alter column draft_theme_config set not null;

alter table public.sites drop constraint if exists sites_builder_config_object;
alter table public.sites add constraint sites_builder_config_object
  check (jsonb_typeof(builder_config) = 'object');
alter table public.sites drop constraint if exists sites_draft_theme_object;
alter table public.sites add constraint sites_draft_theme_object
  check (jsonb_typeof(draft_theme_config) = 'object');

create table if not exists public.site_theme_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  version_number bigint not null,
  stage text not null default 'draft',
  theme_config jsonb not null,
  reason text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (site_id, version_number),
  constraint site_theme_versions_stage_valid check (stage in ('draft','published','rollback','imported')),
  constraint site_theme_versions_config_object check (jsonb_typeof(theme_config) = 'object')
);

create index if not exists site_theme_versions_site_created_idx
  on public.site_theme_versions(site_id, version_number desc);

insert into public.site_theme_versions (
  site_id, version_number, stage, theme_config, reason, created_by, created_by_discord_id
)
select id, 1, 'published', theme_config, 'Versión visual inicial', created_by, created_by_discord_id
from public.sites s
where not exists (select 1 from public.site_theme_versions v where v.site_id = s.id);

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  slug text not null,
  name text not null,
  title text not null,
  description text not null default '',
  status text not null default 'draft',
  is_home boolean not null default false,
  sort_order integer not null default 0,
  draft_document jsonb not null,
  published_document jsonb,
  seo_config jsonb not null default '{}'::jsonb,
  access_config jsonb not null default '{"visibility":"public","roles":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  deleted_at timestamptz,
  unique (site_id, slug),
  unique (id, site_id),
  constraint site_pages_slug_valid check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 1 and 64),
  constraint site_pages_name_valid check (char_length(btrim(name)) between 1 and 100),
  constraint site_pages_title_valid check (char_length(btrim(title)) between 1 and 160),
  constraint site_pages_status_valid check (status in ('draft','published','archived')),
  constraint site_pages_sort_valid check (sort_order between -100000 and 100000),
  constraint site_pages_draft_object check (jsonb_typeof(draft_document) = 'object'),
  constraint site_pages_published_object check (published_document is null or jsonb_typeof(published_document) = 'object'),
  constraint site_pages_seo_object check (jsonb_typeof(seo_config) = 'object'),
  constraint site_pages_access_object check (jsonb_typeof(access_config) = 'object')
);

create unique index if not exists site_pages_home_unique_idx
  on public.site_pages(site_id) where is_home and deleted_at is null;
create index if not exists site_pages_public_idx
  on public.site_pages(site_id, status, sort_order, created_at) where deleted_at is null;

create table if not exists public.site_page_versions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  page_id uuid not null,
  version_number bigint not null,
  stage text not null default 'draft',
  document jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  reason text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  unique (page_id, version_number),
  foreign key (page_id, site_id) references public.site_pages(id, site_id) on delete cascade,
  constraint site_page_versions_stage_valid check (stage in ('draft','published','rollback','imported')),
  constraint site_page_versions_document_object check (jsonb_typeof(document) = 'object'),
  constraint site_page_versions_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists site_page_versions_page_created_idx
  on public.site_page_versions(site_id, page_id, version_number desc);

create table if not exists public.site_reusable_components (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  component_key text not null,
  display_name text not null,
  description text not null default '',
  document jsonb not null,
  category text not null default 'custom',
  version_number bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (site_id, component_key),
  constraint site_components_key_valid check (component_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint site_components_name_valid check (char_length(btrim(display_name)) between 1 and 100),
  constraint site_components_document_object check (jsonb_typeof(document) = 'object')
);

create index if not exists site_components_site_category_idx
  on public.site_reusable_components(site_id, category, display_name) where deleted_at is null;

create table if not exists public.module_registry (
  module_type text primary key,
  display_name text not null,
  description text not null default '',
  current_version text not null default '1.0.0',
  schema_version integer not null default 1,
  manifest jsonb not null,
  built_in boolean not null default false,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint module_registry_type_valid check (module_type ~ '^[a-z][a-z0-9_.-]{2,99}$'),
  constraint module_registry_status_valid check (status in ('available','disabled','deprecated')),
  constraint module_registry_manifest_object check (jsonb_typeof(manifest) = 'object')
);

create table if not exists public.site_module_instances (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  module_type text not null references public.module_registry(module_type) on delete restrict,
  instance_key text not null,
  display_name text not null,
  description text not null default '',
  status text not null default 'draft',
  schema_version integer not null default 1,
  settings jsonb not null default '{}'::jsonb,
  admin_config jsonb not null default '{"exposedControls":[]}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (site_id, instance_key),
  unique (id, site_id),
  constraint site_module_key_valid check (instance_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint site_module_status_valid check (status in ('draft','active','disabled','archived')),
  constraint site_module_settings_object check (jsonb_typeof(settings) = 'object'),
  constraint site_module_admin_object check (jsonb_typeof(admin_config) = 'object')
);

create index if not exists site_module_instances_site_status_idx
  on public.site_module_instances(site_id, status, display_name) where deleted_at is null;

create table if not exists public.site_module_capabilities (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  module_instance_id uuid not null,
  capability_type text not null,
  contract_version integer not null default 1,
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_instance_id, capability_type),
  foreign key (module_instance_id, site_id)
    references public.site_module_instances(id, site_id) on delete cascade,
  constraint site_module_capability_valid check (capability_type ~ '^[a-z][a-z0-9_.:-]{2,119}$'),
  constraint site_module_capability_settings_object check (jsonb_typeof(settings) = 'object')
);

create index if not exists site_module_capabilities_site_idx
  on public.site_module_capabilities(site_id, enabled, capability_type);

create table if not exists public.site_collections (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  collection_key text not null,
  singular_name text not null,
  plural_name text not null,
  description text not null default '',
  status text not null default 'draft',
  visibility text not null default 'public',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (site_id, collection_key),
  unique (id, site_id),
  constraint site_collections_key_valid check (collection_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint site_collections_status_valid check (status in ('draft','active','archived')),
  constraint site_collections_visibility_valid check (visibility in ('public','authenticated','private')),
  constraint site_collections_settings_object check (jsonb_typeof(settings) = 'object')
);

create index if not exists site_collections_site_status_idx
  on public.site_collections(site_id, status, plural_name) where deleted_at is null;

create table if not exists public.site_collection_fields (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  collection_id uuid not null,
  field_key text not null,
  display_name text not null,
  field_type text not null,
  position integer not null default 0,
  required boolean not null default false,
  searchable boolean not null default false,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collection_id, field_key),
  foreign key (collection_id, site_id) references public.site_collections(id, site_id) on delete cascade,
  constraint site_collection_field_key_valid check (field_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  constraint site_collection_field_type_valid check (field_type in (
    'text','long_text','rich_text','number','boolean','date','datetime','select','multi_select',
    'image','file','url','email','color','relation','user','minecraft_uuid','discord_id','formula','json'
  )),
  constraint site_collection_field_settings_object check (jsonb_typeof(settings) = 'object')
);

create index if not exists site_collection_fields_collection_idx
  on public.site_collection_fields(site_id, collection_id, position);

create table if not exists public.site_collection_records (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  collection_id uuid not null,
  slug text,
  status text not null default 'draft',
  data jsonb not null default '{}'::jsonb,
  search_text text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  deleted_at timestamptz,
  unique (collection_id, slug),
  unique (id, site_id),
  foreign key (collection_id, site_id) references public.site_collections(id, site_id) on delete restrict,
  constraint site_collection_record_status_valid check (status in ('draft','published','archived')),
  constraint site_collection_record_slug_valid check (slug is null or slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint site_collection_record_data_object check (jsonb_typeof(data) = 'object')
);

create index if not exists site_collection_records_public_idx
  on public.site_collection_records(site_id, collection_id, status, published_at desc)
  where deleted_at is null;
create index if not exists site_collection_records_search_idx
  on public.site_collection_records using gin (to_tsvector('simple', search_text));

create table if not exists public.site_form_submissions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  collection_id uuid not null,
  record_id uuid,
  request_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending',
  submitted_by uuid references auth.users(id) on delete set null,
  submitter_fingerprint text not null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  unique (site_id, request_id),
  foreign key (collection_id, site_id) references public.site_collections(id, site_id) on delete restrict,
  foreign key (record_id, site_id) references public.site_collection_records(id, site_id) on delete restrict,
  constraint site_form_submission_status_valid check (status in ('pending','approved','rejected','spam','archived')),
  constraint site_form_submission_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint site_form_submission_fingerprint_valid check (char_length(submitter_fingerprint) between 32 and 128)
);

create index if not exists site_form_submissions_rate_idx
  on public.site_form_submissions(site_id, submitter_fingerprint, created_at desc);
create index if not exists site_form_submissions_review_idx
  on public.site_form_submissions(site_id, collection_id, status, created_at desc);

create table if not exists public.site_relation_definitions (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  relation_key text not null,
  source_collection_id uuid not null,
  target_collection_id uuid not null,
  relation_type text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, relation_key),
  foreign key (source_collection_id, site_id) references public.site_collections(id, site_id) on delete cascade,
  foreign key (target_collection_id, site_id) references public.site_collections(id, site_id) on delete cascade,
  constraint site_relation_key_valid check (relation_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint site_relation_type_valid check (relation_type in ('one_to_one','one_to_many','many_to_many')),
  constraint site_relation_settings_object check (jsonb_typeof(settings) = 'object')
);

create table if not exists public.site_workflows (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  workflow_key text not null,
  display_name text not null,
  description text not null default '',
  trigger_config jsonb not null default '{}'::jsonb,
  condition_config jsonb not null default '{"all":[]}'::jsonb,
  actions_config jsonb not null default '[]'::jsonb,
  error_config jsonb not null default '{"strategy":"stop"}'::jsonb,
  enabled boolean not null default false,
  version_number bigint not null default 1,
  created_by uuid references auth.users(id) on delete set null,
  created_by_discord_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (site_id, workflow_key),
  constraint site_workflow_key_valid check (workflow_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint site_workflow_trigger_object check (jsonb_typeof(trigger_config) = 'object'),
  constraint site_workflow_condition_object check (jsonb_typeof(condition_config) = 'object'),
  constraint site_workflow_actions_array check (jsonb_typeof(actions_config) = 'array'),
  constraint site_workflow_error_object check (jsonb_typeof(error_config) = 'object')
);

create table if not exists public.site_admin_controls (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete restrict,
  target_type text not null,
  target_id uuid,
  property_path text not null,
  display_name text not null,
  control_type text not null default 'text',
  permission_key text not null,
  settings jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, target_type, target_id, property_path),
  constraint site_admin_control_target_valid check (target_type in ('site','page','module','collection','block','workflow')),
  constraint site_admin_control_property_valid check (property_path ~ '^[a-zA-Z0-9_.:-]{1,200}$'),
  constraint site_admin_control_permission_valid check (permission_key ~ '^[a-z*][a-z0-9_.*:-]{0,119}$'),
  constraint site_admin_control_settings_object check (jsonb_typeof(settings) = 'object')
);

-- Manifiestos del núcleo. Los nombres visibles se pueden cambiar por instancia;
-- el module_type estable evita que web y Empi Connect dependan de esos nombres.
insert into public.module_registry (module_type, display_name, description, built_in, manifest)
values
  ('empi.collection', 'Colección', 'Contenido estructurado con campos, vistas y formularios.', true,
   '{"id":"empi.collection","version":"1.0.0","schemaVersion":1,"entities":["collection","record"],"views":["cards","list","table","detail","timeline","calendar","kanban","tierlist"],"actions":["create","edit","publish","archive"],"events":["record.created","record.updated","record.published"],"capabilities":["discord.publish.entries","discord.search","discord.command.render"],"permissions":["collection.view","collection.manage","collection.publish"],"connectors":[],"migrations":[]}'::jsonb),
  ('empi.page', 'Página', 'Lienzo libre compuesto por regiones y bloques.', true,
   '{"id":"empi.page","version":"1.0.0","schemaVersion":1,"entities":["page"],"views":["page"],"actions":["edit","publish","rollback"],"events":["page.published"],"capabilities":["discord.publish.snapshot"],"permissions":["page.view","page.manage","page.publish"],"connectors":[],"migrations":[]}'::jsonb),
  ('empi.form', 'Formulario', 'Captura validada de datos públicos o privados.', true,
   '{"id":"empi.form","version":"1.0.0","schemaVersion":1,"entities":["submission"],"views":["form"],"actions":["submit","review","approve","reject"],"events":["form.submitted"],"capabilities":["discord.publish.entries"],"permissions":["form.submit","form.review"],"connectors":[],"migrations":[]}'::jsonb),
  ('empi.ranking', 'Ranking y tierlist', 'Clasificaciones configurables para jugadores, equipos o contenido.', true,
   '{"id":"empi.ranking","version":"1.0.0","schemaVersion":1,"entities":["ranking","entry","tier"],"views":["leaderboard","tierlist","cards"],"actions":["rank","move","publish"],"events":["ranking.updated"],"capabilities":["discord.publish.snapshot","discord.search"],"permissions":["ranking.view","ranking.manage"],"connectors":[],"migrations":[]}'::jsonb),
  ('empi.wiki', 'Wiki y guías', 'Documentación, recetas y contenido relacionado.', true,
   '{"id":"empi.wiki","version":"1.0.0","schemaVersion":1,"entities":["article","section"],"views":["catalog","detail","tree"],"actions":["create","edit","publish"],"events":["article.published"],"capabilities":["discord.publish.entries","discord.search"],"permissions":["wiki.view","wiki.manage","wiki.publish"],"connectors":[],"migrations":[]}'::jsonb),
  ('empi.news', 'Noticias y registros', 'Entradas publicables con categorías, portada y bloques.', true,
   '{"id":"empi.news","version":"1.0.0","schemaVersion":1,"entities":["entry","category"],"views":["cards","timeline","detail"],"actions":["create","edit","publish","hide"],"events":["entry.published","entry.hidden"],"capabilities":["discord.publish.entries","discord.search"],"permissions":["news.view","news.manage","news.publish"],"connectors":[],"migrations":[]}'::jsonb)
on conflict (module_type) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  manifest = excluded.manifest,
  built_in = excluded.built_in,
  updated_at = now();

-- Página inicial de Culones solo como registro de compatibilidad. Su documento
-- apunta a la experiencia legacy, que sigue viviendo en logs.html sin cambios.
insert into public.site_pages (
  id, site_id, slug, name, title, description, status, is_home, sort_order,
  draft_document, published_document, seo_config, created_by_discord_id, published_at
)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000001',
  'inicio', 'Inicio', 'Culones RPG', 'Entrada a la experiencia original de Culones RPG.',
  'published', true, 0,
  '{"schemaVersion":1,"kind":"legacy","legacyUrl":"logs.html","nodes":[]}'::jsonb,
  '{"schemaVersion":1,"kind":"legacy","legacyUrl":"logs.html","nodes":[]}'::jsonb,
  '{"title":"Culones RPG","description":"Servidor RPG/Gacha"}'::jsonb,
  '726444396970770494', now()
)
on conflict (id) do nothing;

-- Cualquier sitio de Fase 1 que no sea Culones recibe una página inicial segura.
insert into public.site_pages (
  site_id, slug, name, title, description, status, is_home,
  draft_document, published_document, seo_config, created_by, created_by_discord_id, published_at
)
select
  s.id, 'inicio', 'Inicio', s.name, s.description,
  case when s.status = 'active' then 'published' else 'draft' end,
  true,
  jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'page',
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'hero-inicial', 'type', 'section',
        'props', jsonb_build_object('layout', jsonb_build_object('minHeight', '70vh', 'align', 'center', 'justify', 'center')),
        'children', jsonb_build_array(
          jsonb_build_object('id', 'titulo-inicial', 'type', 'heading', 'props', jsonb_build_object('text', s.name, 'level', 1), 'children', jsonb_build_array())
        )
      )
    )
  ),
  case when s.status = 'active' then jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'page',
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'hero-inicial', 'type', 'section',
        'props', jsonb_build_object('layout', jsonb_build_object('minHeight', '70vh', 'align', 'center', 'justify', 'center')),
        'children', jsonb_build_array(
          jsonb_build_object('id', 'titulo-inicial', 'type', 'heading', 'props', jsonb_build_object('text', s.name, 'level', 1), 'children', jsonb_build_array())
        )
      )
    )
  ) else null end,
  jsonb_build_object('title', s.name, 'description', s.description),
  s.created_by, s.created_by_discord_id,
  case when s.status = 'active' then now() else null end
from public.sites s
where s.id <> '00000000-0000-4000-8000-000000000001'
  and s.deleted_at is null
  and not exists (select 1 from public.site_pages p where p.site_id = s.id and p.deleted_at is null);

insert into public.site_page_versions (
  site_id, page_id, version_number, stage, document, metadata, reason,
  created_by, created_by_discord_id
)
select
  p.site_id, p.id, 1,
  case when p.status = 'published' then 'published' else 'draft' end,
  coalesce(p.published_document, p.draft_document),
  jsonb_build_object('name', p.name, 'title', p.title, 'slug', p.slug, 'isHome', p.is_home),
  'Versión inicial del constructor', p.created_by, p.created_by_discord_id
from public.site_pages p
where not exists (select 1 from public.site_page_versions v where v.page_id = p.id);

-- Updated-at uniforme.
do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'site_pages','site_reusable_components','module_registry','site_module_instances',
    'site_module_capabilities','site_collections','site_collection_fields',
    'site_collection_records','site_relation_definitions','site_workflows','site_admin_controls'
  ] loop
    execute format('drop trigger if exists %I on public.%I', target_table || '_touch_updated_at', target_table);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.empi_touch_updated_at()',
      target_table || '_touch_updated_at', target_table
    );
  end loop;
end $$;

-- RLS: la estructura de construcción y los borradores nunca se exponen.
alter table public.site_pages enable row level security;
alter table public.site_page_versions enable row level security;
alter table public.site_theme_versions enable row level security;
alter table public.site_reusable_components enable row level security;
alter table public.module_registry enable row level security;
alter table public.site_module_instances enable row level security;
alter table public.site_module_capabilities enable row level security;
alter table public.site_collections enable row level security;
alter table public.site_collection_fields enable row level security;
alter table public.site_collection_records enable row level security;
alter table public.site_form_submissions enable row level security;
alter table public.site_relation_definitions enable row level security;
alter table public.site_workflows enable row level security;
alter table public.site_admin_controls enable row level security;

drop policy if exists "site_pages_public_published" on public.site_pages;
create policy "site_pages_public_published" on public.site_pages
  for select to anon, authenticated
  using (
    status = 'published' and deleted_at is null and published_document is not null
    and exists (select 1 from public.sites s where s.id = site_pages.site_id and s.status = 'active' and s.deleted_at is null)
  );

drop policy if exists "module_registry_public_available" on public.module_registry;
create policy "module_registry_public_available" on public.module_registry
  for select to anon, authenticated using (status = 'available');

drop policy if exists "site_modules_public_active" on public.site_module_instances;
create policy "site_modules_public_active" on public.site_module_instances
  for select to anon, authenticated
  using (
    status = 'active' and deleted_at is null
    and exists (select 1 from public.sites s where s.id = site_module_instances.site_id and s.status = 'active' and s.deleted_at is null)
  );

drop policy if exists "site_capabilities_public_enabled" on public.site_module_capabilities;
create policy "site_capabilities_public_enabled" on public.site_module_capabilities
  for select to anon, authenticated
  using (
    enabled and exists (
      select 1 from public.site_module_instances m
      where m.id = site_module_capabilities.module_instance_id
        and m.site_id = site_module_capabilities.site_id
        and m.status = 'active' and m.deleted_at is null
    )
    and exists (
      select 1 from public.sites s
      where s.id = site_module_capabilities.site_id
        and s.status = 'active' and s.deleted_at is null
    )
  );

drop policy if exists "site_collections_public_active" on public.site_collections;
create policy "site_collections_public_active" on public.site_collections
  for select to anon, authenticated
  using (
    status = 'active' and visibility = 'public' and deleted_at is null
    and exists (select 1 from public.sites s where s.id = site_collections.site_id and s.status = 'active' and s.deleted_at is null)
  );

drop policy if exists "site_fields_public_collection" on public.site_collection_fields;
create policy "site_fields_public_collection" on public.site_collection_fields
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.site_collections c
      where c.id = site_collection_fields.collection_id and c.site_id = site_collection_fields.site_id
        and c.status = 'active' and c.visibility = 'public' and c.deleted_at is null
    )
    and exists (
      select 1 from public.sites s
      where s.id = site_collection_fields.site_id
        and s.status = 'active' and s.deleted_at is null
    )
  );

drop policy if exists "site_records_public_published" on public.site_collection_records;
create policy "site_records_public_published" on public.site_collection_records
  for select to anon, authenticated
  using (
    status = 'published' and deleted_at is null
    and exists (
      select 1 from public.site_collections c
      where c.id = site_collection_records.collection_id and c.site_id = site_collection_records.site_id
        and c.status = 'active' and c.visibility = 'public' and c.deleted_at is null
    )
    and exists (
      select 1 from public.sites s
      where s.id = site_collection_records.site_id
        and s.status = 'active' and s.deleted_at is null
    )
  );

-- Todo lo demás queda service-role only. Las mutaciones pasan por Edge Function.
do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'site_page_versions','site_theme_versions','site_reusable_components','site_relation_definitions',
    'site_workflows','site_admin_controls','site_form_submissions'
  ] loop
    policy_name := target_table || '_no_client';
    execute format('drop policy if exists %I on public.%I', policy_name, target_table);
    execute format(
      'create policy %I on public.%I for all to anon, authenticated using (false) with check (false)',
      policy_name, target_table
    );
  end loop;
end $$;

-- Recepción pública atómica. La Edge Function valida el esquema; esta RPC
-- vuelve a comprobar aislamiento, estado, idempotencia y límite por huella.
create or replace function public.network_submit_collection_form(
  input_site_id uuid,
  input_collection_id uuid,
  input_data jsonb,
  input_search_text text,
  input_request_id uuid,
  input_fingerprint text,
  input_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  target_collection public.site_collections;
  existing_submission public.site_form_submissions;
  created_record public.site_collection_records;
  created_submission public.site_form_submissions;
  recent_count integer;
begin
  if jsonb_typeof(input_data) <> 'object' then
    raise exception using errcode = '22023', message = 'FORM_DATA_INVALID';
  end if;

  select c.* into target_collection
  from public.site_collections c
  join public.sites s on s.id = c.site_id
  where c.id = input_collection_id and c.site_id = input_site_id
    and c.status = 'active' and c.visibility = 'public' and c.deleted_at is null
    and s.status = 'active' and s.deleted_at is null
    and coalesce(c.settings ->> 'allowPublicSubmissions', 'false') = 'true';
  if not found then
    raise exception using errcode = '42501', message = 'FORM_NOT_AVAILABLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(input_site_id::text || ':' || input_fingerprint, 0));

  select * into existing_submission
  from public.site_form_submissions
  where site_id = input_site_id and request_id = input_request_id;
  if found then
    return jsonb_build_object('submissionId', existing_submission.id, 'recordId', existing_submission.record_id, 'duplicate', true);
  end if;

  select count(*)::integer into recent_count
  from public.site_form_submissions
  where site_id = input_site_id and submitter_fingerprint = input_fingerprint
    and created_at >= now() - interval '1 hour';
  if recent_count >= 8 then
    raise exception using errcode = 'P0001', message = 'FORM_RATE_LIMIT';
  end if;

  insert into public.site_collection_records (
    site_id, collection_id, status, data, search_text, created_by
  ) values (
    input_site_id, input_collection_id, 'draft', input_data,
    left(coalesce(input_search_text, ''), 12000), input_auth_user_id
  ) returning * into created_record;

  insert into public.site_form_submissions (
    site_id, collection_id, record_id, request_id, payload,
    submitted_by, submitter_fingerprint
  ) values (
    input_site_id, input_collection_id, created_record.id, input_request_id,
    input_data, input_auth_user_id, input_fingerprint
  ) returning * into created_submission;

  insert into public.site_audit_log (
    site_id, auth_user_id, actor_mode, action, entity_type, entity_id, new_value
  ) values (
    input_site_id, input_auth_user_id, 'normal', 'form.submit',
    'site_form_submission', created_submission.id::text,
    jsonb_build_object('collectionId', input_collection_id, 'recordId', created_record.id)
  );

  return jsonb_build_object('submissionId', created_submission.id, 'recordId', created_record.id, 'duplicate', false);
end;
$$;

create or replace function public.network_save_theme(
  input_site_id uuid,
  input_theme_config jsonb,
  input_publish boolean,
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
  updated_site public.sites;
  next_version bigint;
begin
  if jsonb_typeof(input_theme_config) <> 'object' then
    raise exception using errcode = '22023', message = 'La apariencia debe ser un objeto.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(input_site_id::text || ':theme', 0));
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.site_theme_versions where site_id = input_site_id;

  update public.sites set
    draft_theme_config = input_theme_config,
    theme_config = case when input_publish then input_theme_config else theme_config end,
    published_theme_version = case when input_publish then next_version else published_theme_version end
  where id = input_site_id and deleted_at is null
  returning * into updated_site;
  if not found then raise exception using errcode = 'P0002', message = 'La instancia no existe.'; end if;

  insert into public.site_theme_versions (
    site_id, version_number, stage, theme_config, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id, next_version, case when input_publish then 'published' else 'draft' end,
    input_theme_config, coalesce(nullif(btrim(input_reason), ''), 'Cambio de apariencia'),
    input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', case when input_publish then 'theme.publish' else 'theme.save_draft' end,
    'site_theme', input_site_id::text,
    jsonb_build_object('version', next_version, 'published', input_publish)
  );
  return updated_site;
end;
$$;

create or replace function public.network_restore_theme_version(
  input_site_id uuid,
  input_version_number bigint,
  input_publish boolean,
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.sites
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  source_theme jsonb;
  updated_site public.sites;
  next_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_site_id::text || ':theme', 0));
  select theme_config into source_theme from public.site_theme_versions
  where site_id = input_site_id and version_number = input_version_number;
  if not found then raise exception using errcode = 'P0002', message = 'La versión visual no existe.'; end if;
  select coalesce(max(version_number), 0) + 1 into next_version
  from public.site_theme_versions where site_id = input_site_id;

  update public.sites set
    draft_theme_config = source_theme,
    theme_config = case when input_publish then source_theme else theme_config end,
    published_theme_version = case when input_publish then next_version else published_theme_version end
  where id = input_site_id and deleted_at is null returning * into updated_site;
  if not found then raise exception using errcode = 'P0002', message = 'La instancia no existe.'; end if;

  insert into public.site_theme_versions (
    site_id, version_number, stage, theme_config, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id, next_version, 'rollback', source_theme,
    'Restauración de versión visual ' || input_version_number,
    input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'theme.rollback', 'site_theme', input_site_id::text,
    jsonb_build_object('sourceVersion', input_version_number, 'newVersion', next_version, 'published', input_publish)
  );
  return updated_site;
end;
$$;

-- Creación atómica de página y su versión inicial.
create or replace function public.network_create_page(
  input_site_id uuid,
  input_name text,
  input_slug text,
  input_is_home boolean,
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.site_pages
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  created_page public.site_pages;
  site_name text;
  initial_document jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_site_id::text, 0));
  select name into site_name from public.sites
  where id = input_site_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'La instancia no existe.';
  end if;

  if input_is_home then
    update public.site_pages set is_home = false
    where site_id = input_site_id and is_home and deleted_at is null;
  end if;

  initial_document := jsonb_build_object(
    'schemaVersion', 1,
    'kind', 'page',
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'section-' || substr(gen_random_uuid()::text, 1, 8),
        'type', 'section',
        'props', jsonb_build_object(
          'layout', jsonb_build_object('minHeight', '60vh', 'align', 'center', 'justify', 'center')
        ),
        'children', jsonb_build_array(
          jsonb_build_object(
            'id', 'heading-' || substr(gen_random_uuid()::text, 1, 8),
            'type', 'heading',
            'props', jsonb_build_object('text', btrim(input_name), 'level', 1),
            'children', jsonb_build_array()
          )
        )
      )
    )
  );

  insert into public.site_pages (
    site_id, slug, name, title, is_home, draft_document,
    seo_config, created_by, created_by_discord_id
  ) values (
    input_site_id, lower(btrim(input_slug)), btrim(input_name), btrim(input_name),
    input_is_home, initial_document,
    jsonb_build_object('title', btrim(input_name), 'description', ''),
    input_created_by, input_created_by_discord_id
  ) returning * into created_page;

  insert into public.site_page_versions (
    site_id, page_id, version_number, stage, document, metadata, reason,
    created_by, created_by_discord_id
  ) values (
    created_page.site_id, created_page.id, 1, 'draft', created_page.draft_document,
    jsonb_build_object('name', created_page.name, 'title', created_page.title, 'slug', created_page.slug, 'isHome', created_page.is_home),
    'Creación de página', input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'page.create', 'site_page', created_page.id::text,
    to_jsonb(created_page) - 'draft_document' - 'published_document'
  );

  return created_page;
end;
$$;

create or replace function public.network_save_page(
  input_page_id uuid,
  input_site_id uuid,
  input_patch jsonb,
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
  before_page public.site_pages;
  updated_page public.site_pages;
  next_version bigint;
  wants_home boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_page_id::text, 0));
  select * into before_page from public.site_pages
  where id = input_page_id and site_id = input_site_id and deleted_at is null for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'La página no existe.';
  end if;

  wants_home := case when input_patch ? 'is_home' then (input_patch->>'is_home')::boolean else before_page.is_home end;
  if wants_home and not before_page.is_home then
    update public.site_pages set is_home = false
    where site_id = input_site_id and is_home and deleted_at is null;
  end if;

  update public.site_pages set
    name = case when input_patch ? 'name' then btrim(input_patch->>'name') else name end,
    title = case when input_patch ? 'title' then btrim(input_patch->>'title') else title end,
    slug = case when input_patch ? 'slug' then lower(btrim(input_patch->>'slug')) else slug end,
    description = case when input_patch ? 'description' then coalesce(input_patch->>'description', '') else description end,
    is_home = wants_home,
    sort_order = case when input_patch ? 'sort_order' then (input_patch->>'sort_order')::integer else sort_order end,
    draft_document = case when input_patch ? 'draft_document' then input_patch->'draft_document' else draft_document end,
    seo_config = case when input_patch ? 'seo_config' then input_patch->'seo_config' else seo_config end,
    access_config = case when input_patch ? 'access_config' then input_patch->'access_config' else access_config end
  where id = input_page_id and site_id = input_site_id
  returning * into updated_page;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.site_page_versions where page_id = input_page_id;

  insert into public.site_page_versions (
    site_id, page_id, version_number, stage, document, metadata, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id, input_page_id, next_version, 'draft', updated_page.draft_document,
    jsonb_build_object('name', updated_page.name, 'title', updated_page.title, 'slug', updated_page.slug, 'isHome', updated_page.is_home, 'seo', updated_page.seo_config, 'access', updated_page.access_config),
    coalesce(nullif(btrim(input_reason), ''), 'Guardado desde el constructor'),
    input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, old_value, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'page.save', 'site_page', input_page_id::text,
    jsonb_build_object('name', before_page.name, 'slug', before_page.slug, 'version', next_version - 1),
    jsonb_build_object('name', updated_page.name, 'slug', updated_page.slug, 'version', next_version)
  );
  return updated_page;
end;
$$;

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

  -- Publicar la primera página también hace público el portal. Antes de esta
  -- corrección una página podía quedar "published" dentro de un sitio "draft",
  -- por lo que site.html no podía leerla mediante RLS.
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
    jsonb_build_object('name', updated_page.name, 'title', updated_page.title, 'slug', updated_page.slug, 'isHome', updated_page.is_home, 'seo', updated_page.seo_config, 'access', updated_page.access_config),
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

create or replace function public.network_restore_page_version(
  input_page_id uuid,
  input_site_id uuid,
  input_version_number bigint,
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.site_pages
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  source_version public.site_page_versions;
  updated_page public.site_pages;
  next_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(input_page_id::text, 0));
  select * into source_version from public.site_page_versions
  where page_id = input_page_id and site_id = input_site_id and version_number = input_version_number;
  if not found then
    raise exception using errcode = 'P0002', message = 'La versión no existe.';
  end if;

  update public.site_pages set
    draft_document = source_version.document,
    name = coalesce(source_version.metadata->>'name', name),
    title = coalesce(source_version.metadata->>'title', title),
    description = coalesce(source_version.metadata->>'description', description),
    seo_config = coalesce(source_version.metadata->'seo', seo_config),
    access_config = coalesce(source_version.metadata->'access', access_config)
  where id = input_page_id and site_id = input_site_id and deleted_at is null
  returning * into updated_page;
  if not found then
    raise exception using errcode = 'P0002', message = 'La página no existe.';
  end if;

  select coalesce(max(version_number), 0) + 1 into next_version
  from public.site_page_versions where page_id = input_page_id;
  insert into public.site_page_versions (
    site_id, page_id, version_number, stage, document, metadata, reason,
    created_by, created_by_discord_id
  ) values (
    input_site_id, input_page_id, next_version, 'rollback', updated_page.draft_document,
    source_version.metadata,
    'Restauración de versión ' || input_version_number,
    input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'page.rollback', 'site_page', input_page_id::text,
    jsonb_build_object('sourceVersion', input_version_number, 'newDraftVersion', next_version)
  );
  return updated_page;
end;
$$;

-- Archivar es la eliminación segura: mantiene datos y permite restaurar.
create or replace function public.network_archive_site(
  input_site_id uuid,
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
begin
  if input_site_id = '00000000-0000-4000-8000-000000000001'::uuid then
    raise exception using errcode = '42501', message = 'Culones RPG está protegido y no puede archivarse.';
  end if;
  select * into before_site from public.sites where id = input_site_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'La instancia no existe.'; end if;

  update public.sites set
    status = 'archived', deleted_at = now(), deleted_by = input_created_by,
    deletion_reason = coalesce(nullif(btrim(input_reason), ''), 'Archivada por Owner')
  where id = input_site_id returning * into updated_site;

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, old_value, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'site.archive', 'site', input_site_id::text,
    to_jsonb(before_site), to_jsonb(updated_site)
  );
  return updated_site;
end;
$$;

create or replace function public.network_restore_site(
  input_site_id uuid,
  input_created_by uuid,
  input_created_by_discord_id text
)
returns public.sites
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  updated_site public.sites;
begin
  update public.sites set
    status = 'draft', deleted_at = null, deleted_by = null, deletion_reason = null
  where id = input_site_id and deleted_at is not null returning * into updated_site;
  if not found then raise exception using errcode = 'P0002', message = 'La instancia no está archivada.'; end if;

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode, action,
    entity_type, entity_id, new_value
  ) values (
    input_site_id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'site.restore', 'site', input_site_id::text, to_jsonb(updated_site)
  );
  return updated_site;
end;
$$;

-- La creación de Fase 1 ahora nace con página de Inicio versionada.
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
  created_page public.site_pages;
  initial_document jsonb;
begin
  insert into public.sites (
    name, slug, discord_guild_id, public_base_url,
    created_by, created_by_discord_id
  ) values (
    btrim(input_name), lower(btrim(input_slug)),
    nullif(btrim(input_discord_guild_id), ''), nullif(btrim(input_public_base_url), ''),
    input_created_by, input_created_by_discord_id
  ) returning * into created_site;

  insert into public.site_role_profiles (
    site_id, role_key, display_name, description, is_system,
    is_default_admin, created_by, created_by_discord_id
  ) values (
    created_site.id, 'administrador', 'Administrador',
    'Administrador global de esta instancia.', true, true,
    input_created_by, input_created_by_discord_id
  ) returning id into admin_profile_id;

  insert into public.site_role_permissions (site_id, role_profile_id, permission_key, effect)
  values (created_site.id, admin_profile_id, 'site.admin.*', 'allow');

  insert into public.site_theme_versions (
    site_id, version_number, stage, theme_config, reason,
    created_by, created_by_discord_id
  ) values (
    created_site.id, 1, 'published', created_site.theme_config,
    'Apariencia inicial de la instancia', input_created_by, input_created_by_discord_id
  );

  initial_document := jsonb_build_object(
    'schemaVersion', 1, 'kind', 'page',
    'nodes', jsonb_build_array(
      jsonb_build_object(
        'id', 'hero-inicial', 'type', 'section',
        'props', jsonb_build_object('layout', jsonb_build_object('minHeight', '70vh', 'align', 'center', 'justify', 'center')),
        'children', jsonb_build_array(
          jsonb_build_object('id', 'titulo-inicial', 'type', 'heading', 'props', jsonb_build_object('text', created_site.name, 'level', 1), 'children', jsonb_build_array())
        )
      )
    )
  );

  insert into public.site_pages (
    site_id, slug, name, title, status, is_home, draft_document,
    seo_config, created_by, created_by_discord_id
  ) values (
    created_site.id, 'inicio', 'Inicio', created_site.name, 'draft', true,
    initial_document, jsonb_build_object('title', created_site.name, 'description', ''),
    input_created_by, input_created_by_discord_id
  ) returning * into created_page;

  insert into public.site_page_versions (
    site_id, page_id, version_number, stage, document, metadata, reason,
    created_by, created_by_discord_id
  ) values (
    created_site.id, created_page.id, 1, 'draft', initial_document,
    jsonb_build_object('name', 'Inicio', 'title', created_site.name, 'slug', 'inicio', 'isHome', true),
    'Creación inicial de la instancia', input_created_by, input_created_by_discord_id
  );

  insert into public.site_versions (
    site_id, version_number, snapshot, reason, created_by, created_by_discord_id
  ) values (
    created_site.id, 1,
    jsonb_build_object('site', to_jsonb(created_site), 'homePageId', created_page.id),
    'Creación inicial de la instancia', input_created_by, input_created_by_discord_id
  );

  insert into public.site_audit_log (
    site_id, auth_user_id, discord_user_id, actor_mode,
    action, entity_type, entity_id, new_value
  ) values (
    created_site.id, input_created_by, input_created_by_discord_id,
    'platform_owner', 'site.create', 'site', created_site.id::text,
    jsonb_build_object('site', to_jsonb(created_site), 'homePageId', created_page.id)
  );
  return created_site;
end;
$$;

revoke all on function public.network_create_page(uuid,text,text,boolean,uuid,text) from public;
grant execute on function public.network_create_page(uuid,text,text,boolean,uuid,text) to service_role;
revoke all on function public.network_save_page(uuid,uuid,jsonb,uuid,text,text) from public;
grant execute on function public.network_save_page(uuid,uuid,jsonb,uuid,text,text) to service_role;
revoke all on function public.network_publish_page(uuid,uuid,uuid,text,text) from public;
grant execute on function public.network_publish_page(uuid,uuid,uuid,text,text) to service_role;
revoke all on function public.network_restore_page_version(uuid,uuid,bigint,uuid,text) from public;
grant execute on function public.network_restore_page_version(uuid,uuid,bigint,uuid,text) to service_role;
revoke all on function public.network_save_theme(uuid,jsonb,boolean,uuid,text,text) from public;
grant execute on function public.network_save_theme(uuid,jsonb,boolean,uuid,text,text) to service_role;
revoke all on function public.network_restore_theme_version(uuid,bigint,boolean,uuid,text) from public;
grant execute on function public.network_restore_theme_version(uuid,bigint,boolean,uuid,text) to service_role;
revoke all on function public.network_archive_site(uuid,uuid,text,text) from public;
grant execute on function public.network_archive_site(uuid,uuid,text,text) to service_role;
revoke all on function public.network_restore_site(uuid,uuid,text) from public;
grant execute on function public.network_restore_site(uuid,uuid,text) to service_role;
revoke all on function public.network_submit_collection_form(uuid,uuid,jsonb,text,uuid,text,uuid) from public;
grant execute on function public.network_submit_collection_form(uuid,uuid,jsonb,text,uuid,text,uuid) to service_role;
revoke all on function public.network_create_site(text,text,text,text,uuid,text) from public;
grant execute on function public.network_create_site(text,text,text,text,uuid,text) to service_role;

revoke insert, update, delete on public.site_pages from anon, authenticated;
revoke all on public.site_page_versions from anon, authenticated;
revoke all on public.site_theme_versions from anon, authenticated;
revoke all on public.site_reusable_components from anon, authenticated;
revoke insert, update, delete on public.module_registry from anon, authenticated;
revoke insert, update, delete on public.site_module_instances from anon, authenticated;
revoke insert, update, delete on public.site_module_capabilities from anon, authenticated;
revoke insert, update, delete on public.site_collections from anon, authenticated;
revoke insert, update, delete on public.site_collection_fields from anon, authenticated;
revoke insert, update, delete on public.site_collection_records from anon, authenticated;
revoke all on public.site_form_submissions from anon, authenticated;
revoke all on public.site_relation_definitions from anon, authenticated;
revoke all on public.site_workflows from anon, authenticated;
revoke all on public.site_admin_controls from anon, authenticated;

grant select on public.site_pages to anon, authenticated;
grant select on public.module_registry to anon, authenticated;
grant select on public.site_module_instances to anon, authenticated;
grant select on public.site_module_capabilities to anon, authenticated;
grant select on public.site_collections to anon, authenticated;
grant select on public.site_collection_fields to anon, authenticated;
grant select on public.site_collection_records to anon, authenticated;

commit;

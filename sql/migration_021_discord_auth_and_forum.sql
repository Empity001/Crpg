-- =========================================================
-- CULONES-RPG · Migración 021
-- Discord OAuth, autorización por rol, publicaciones de Guías y
-- reconciliación granular de publicaciones de Logs.
-- =========================================================
-- Requiere migraciones 001–020 y las tablas del bot existentes.
-- Ejecutar una sola vez desde Supabase SQL Editor.
-- =========================================================

create extension if not exists pgcrypto;

-- 1) Configuración única del servidor oficial.
create table if not exists public.discord_guild_config (
  guild_id text primary key,
  admin_role_id text,
  guides_forum_channel_id text,
  log_channel_id text,
  forum_reactions jsonb not null default '[]'::jsonb,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discord_guild_reactions_array check (jsonb_typeof(forum_reactions) = 'array')
);

alter table public.discord_guild_config
  add column if not exists admin_role_id text,
  add column if not exists guides_forum_channel_id text,
  add column if not exists log_channel_id text,
  add column if not exists forum_reactions jsonb not null default '[]'::jsonb,
  add column if not exists updated_by text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.discord_guild_config
  drop constraint if exists discord_guild_reactions_array;
alter table public.discord_guild_config
  add constraint discord_guild_reactions_array check (jsonb_typeof(forum_reactions) = 'array');

-- Acepta tanto auth.uid() (UUID serializado) como el ID de Discord de quien
-- ejecutó un comando slash. Esto también corrige instalaciones parciales de
-- una versión previa donde la columna se creó como uuid.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'discord_guild_config'
      and column_name = 'updated_by'
      and data_type = 'uuid'
  ) then
    alter table public.discord_guild_config
      drop constraint if exists discord_guild_config_updated_by_fkey;
    alter table public.discord_guild_config
      alter column updated_by drop default,
      alter column updated_by type text using updated_by::text;
  end if;
end $$;

alter table public.discord_guild_config enable row level security;
drop policy if exists "discord_guild_config_no_client" on public.discord_guild_config;
create policy "discord_guild_config_no_client"
  on public.discord_guild_config for all to anon, authenticated
  using (false) with check (false);

-- Migrar la configuración legacy del bot cuando exista.
do $$
begin
  if to_regclass('public.bot_config') is not null then
    insert into public.discord_guild_config (guild_id, log_channel_id, admin_role_id, guides_forum_channel_id, forum_reactions)
    select
      coalesce(nullif(current_setting('app.settings.discord_guild_id', true), ''), 'CONFIGURE_WITH_BOT'),
      max(value) filter (where key = 'log_channel_id'),
      max(value) filter (where key = 'admin_role_id'),
      max(value) filter (where key = 'guides_forum_channel_id'),
      case
        when coalesce(max(value) filter (where key = 'forum_reactions'), '') ~ '^\s*\['
          then (max(value) filter (where key = 'forum_reactions'))::jsonb
        else '[]'::jsonb
      end
    from public.bot_config
    on conflict (guild_id) do nothing;
  end if;
end $$;

-- 2) Estado persistente de publicaciones del foro.
create table if not exists public.guide_forum_publications (
  guide_id uuid primary key references public.weapons(id) on delete cascade,
  forum_channel_id text,
  thread_id text,
  starter_message_id text,
  message_map jsonb not null default '{}'::jsonb,
  message_order jsonb not null default '[]'::jsonb,
  attachment_map jsonb not null default '{}'::jsonb,
  published_hash text,
  status text not null default 'unpublished',
  last_error_code text,
  last_error_message text,
  last_synced_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint guide_forum_status_valid check (status in (
    'unpublished','publishing','synced','outdated','updating',
    'unpublishing','lost','failed','synced_with_warnings'
  )),
  constraint guide_forum_message_map_object check (jsonb_typeof(message_map) = 'object'),
  constraint guide_forum_message_order_array check (jsonb_typeof(message_order) = 'array'),
  constraint guide_forum_attachment_map_object check (jsonb_typeof(attachment_map) = 'object')
);

alter table public.guide_forum_publications
  add column if not exists forum_channel_id text,
  add column if not exists thread_id text,
  add column if not exists starter_message_id text,
  add column if not exists message_map jsonb not null default '{}'::jsonb,
  add column if not exists message_order jsonb not null default '[]'::jsonb,
  add column if not exists attachment_map jsonb not null default '{}'::jsonb,
  add column if not exists published_hash text,
  add column if not exists status text not null default 'unpublished',
  add column if not exists last_error_code text,
  add column if not exists last_error_message text,
  add column if not exists last_synced_by uuid references auth.users(id) on delete set null,
  add column if not exists published_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.guide_forum_publications
  drop constraint if exists guide_forum_status_valid,
  drop constraint if exists guide_forum_message_map_object,
  drop constraint if exists guide_forum_message_order_array,
  drop constraint if exists guide_forum_attachment_map_object;
alter table public.guide_forum_publications
  add constraint guide_forum_status_valid check (status in (
    'unpublished','publishing','synced','outdated','updating',
    'unpublishing','lost','failed','synced_with_warnings'
  )),
  add constraint guide_forum_message_map_object check (jsonb_typeof(message_map) = 'object'),
  add constraint guide_forum_message_order_array check (jsonb_typeof(message_order) = 'array'),
  add constraint guide_forum_attachment_map_object check (jsonb_typeof(attachment_map) = 'object');

create index if not exists guide_forum_publications_thread_idx
  on public.guide_forum_publications(thread_id);
create index if not exists guide_forum_publications_status_idx
  on public.guide_forum_publications(status);

alter table public.guide_forum_publications enable row level security;
drop policy if exists "guide_forum_publications_no_client" on public.guide_forum_publications;
create policy "guide_forum_publications_no_client"
  on public.guide_forum_publications for all to anon, authenticated
  using (false) with check (false);

-- 3) Cola duradera e idempotente procesada por el bot.
create table if not exists public.guide_forum_jobs (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid references public.weapons(id) on delete cascade,
  action text not null,
  requested_by uuid references auth.users(id) on delete set null,
  requested_discord_user_id text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint guide_forum_job_action_valid check (action in ('publish','update','unpublish','reconcile','apply_reactions')),
  constraint guide_forum_job_status_valid check (status in ('pending','processing','completed','failed','cancelled')),
  constraint guide_forum_job_payload_object check (jsonb_typeof(payload) = 'object')
);

create index if not exists guide_forum_jobs_pending_idx
  on public.guide_forum_jobs(status, created_at);
create index if not exists guide_forum_jobs_guide_idx
  on public.guide_forum_jobs(guide_id, created_at desc);

alter table public.guide_forum_jobs enable row level security;
drop policy if exists "guide_forum_jobs_no_client" on public.guide_forum_jobs;
create policy "guide_forum_jobs_no_client"
  on public.guide_forum_jobs for all to anon, authenticated
  using (false) with check (false);

-- Realtime acelera el procesamiento. El worker también conserva un sondeo
-- periódico como recuperación si el canal Realtime se interrumpe.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'guide_forum_jobs'
  ) then
    alter publication supabase_realtime add table public.guide_forum_jobs;
  end if;
end $$;

-- 4) Relación estable entre categorías/tipos y tags del foro.
create table if not exists public.guide_forum_tag_map (
  id uuid primary key default gen_random_uuid(),
  forum_channel_id text not null,
  kind text not null,
  source_id uuid not null,
  source_name text not null,
  discord_tag_id text not null,
  discord_tag_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (forum_channel_id, kind, source_id),
  constraint guide_forum_tag_kind_valid check (kind in ('category','type'))
);

alter table public.guide_forum_tag_map enable row level security;
drop policy if exists "guide_forum_tag_map_no_client" on public.guide_forum_tag_map;
create policy "guide_forum_tag_map_no_client"
  on public.guide_forum_tag_map for all to anon, authenticated
  using (false) with check (false);

-- 5) Publicaciones de Logs: migrar de pages[] a message_map estable.
create table if not exists public.log_discord_publications (
  log_id uuid primary key references public.logs(id) on delete cascade,
  channel_id text not null default '',
  summary_message_id text,
  thread_id text,
  page_message_ids jsonb not null default '[]'::jsonb,
  message_map jsonb not null default '{}'::jsonb,
  message_order jsonb not null default '[]'::jsonb,
  content_hash text,
  status text not null default 'synced',
  updated_at timestamptz not null default now()
);

alter table public.log_discord_publications
  add column if not exists message_map jsonb not null default '{}'::jsonb,
  add column if not exists message_order jsonb not null default '[]'::jsonb,
  add column if not exists content_hash text,
  add column if not exists status text not null default 'synced';

alter table public.log_discord_publications
  alter column summary_message_id drop not null;

create index if not exists log_discord_publications_thread_idx
  on public.log_discord_publications(thread_id);

alter table public.log_discord_publications enable row level security;
drop policy if exists "discord_pubs_no_public" on public.log_discord_publications;
create policy "discord_pubs_no_public"
  on public.log_discord_publications for all to anon, authenticated
  using (false) with check (false);

-- 6) Auditoría con identidad real de Discord.
alter table public.action_log
  add column if not exists auth_user_id uuid references auth.users(id) on delete set null,
  add column if not exists discord_user_id text,
  add column if not exists actor_avatar_url text,
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists entity_name text,
  add column if not exists old_value jsonb,
  add column if not exists new_value jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists success boolean not null default true;

create index if not exists action_log_auth_user_idx on public.action_log(auth_user_id, created_at desc);
create index if not exists action_log_entity_idx on public.action_log(entity_type, entity_id, created_at desc);


-- Las RPC legacy escriben action_log con actor='Admin'. La Edge Function
-- autenticada envía cabeceras internas con la identidad ya verificada. Este
-- trigger enriquece la fila dentro de la misma petición y evita atribuciones
-- por ventanas de tiempo cuando dos administradores actúan a la vez.
create or replace function public.enrich_action_log_discord_actor()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  request_headers jsonb := '{}'::jsonb;
  raw_headers text;
  auth_user text;
  discord_user text;
  actor_b64 text;
  avatar_b64 text;
  request_id text;
begin
  raw_headers := current_setting('request.headers', true);
  if coalesce(raw_headers, '') <> '' then
    begin
      request_headers := raw_headers::jsonb;
    exception when others then
      request_headers := '{}'::jsonb;
    end;
  end if;

  auth_user := coalesce(request_headers ->> 'x-culones-auth-user', '');
  discord_user := coalesce(request_headers ->> 'x-culones-discord-user', '');
  actor_b64 := coalesce(request_headers ->> 'x-culones-actor-b64', '');
  avatar_b64 := coalesce(request_headers ->> 'x-culones-avatar-b64', '');
  request_id := coalesce(request_headers ->> 'x-culones-request-id', '');

  if auth_user ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    new.auth_user_id := auth_user::uuid;
  end if;
  if discord_user ~ '^[0-9]{15,22}$' then
    new.discord_user_id := discord_user;
  end if;
  if actor_b64 <> '' then
    begin
      new.actor := left(convert_from(decode(actor_b64, 'base64'), 'UTF8'), 200);
    exception when others then
      null;
    end;
  end if;
  if avatar_b64 <> '' then
    begin
      new.actor_avatar_url := left(convert_from(decode(avatar_b64, 'base64'), 'UTF8'), 1200);
    exception when others then
      null;
    end;
  end if;
  if request_id <> '' then
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_build_object('request_id', request_id, 'source', 'discord-oauth');
  end if;
  return new;
end;
$$;

drop trigger if exists action_log_discord_actor_trigger on public.action_log;
create trigger action_log_discord_actor_trigger
before insert on public.action_log
for each row execute function public.enrich_action_log_discord_actor();

-- 7) El código compartido deja de ser una credencial. Las firmas legacy
-- se conservan temporalmente para no reescribir todas las RPC de una vez,
-- pero solo service_role puede superar la validación.
create or replace function public.validate_admin_code(input_code text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.role(), '') = 'service_role';
$$;

revoke all on function public.validate_admin_code(text) from public, anon, authenticated;
grant execute on function public.validate_admin_code(text) to service_role;

-- La Edge Function usa service_role y continúa llamando las firmas existentes.
-- Un cliente anon/authenticated que intente reutilizarlas siempre falla dentro
-- de validate_admin_code.

-- 8) Cerrar las escrituras directas al bucket. Las subidas administrativas
-- se hacen con URLs firmadas emitidas después de validar Discord.
drop policy if exists "culones_admin_insert" on storage.objects;
drop policy if exists "culones_admin_update" on storage.objects;
drop policy if exists "culones_admin_delete" on storage.objects;

-- La lectura pública del bucket se conserva.

-- 9) El sistema de códigos ya no forma parte de la autorización.
drop table if exists public.admin_codes cascade;

comment on table public.discord_guild_config is 'Configuración del único servidor oficial usada por bot y Discord OAuth.';
comment on table public.guide_forum_jobs is 'Cola idempotente de publicar/actualizar/despublicar Guías en Discord.';
comment on table public.guide_forum_publications is 'Estado y message_map de cada publicación del foro de Guías.';

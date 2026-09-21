-- Limpieza de legado: el sistema de códigos de admin ya no existe (login por Discord).
drop table if exists public.admin_codes cascade;

-- Logs: visibilidad pública (publicado / oculto) y políticas finales.
alter table public.logs add column if not exists published boolean not null default true;
create index if not exists logs_published_created_idx on public.logs (published, created_at desc);

drop policy if exists "logs_select_public" on public.logs;
create policy "logs_select_public" on public.logs for select to anon, authenticated
  using (published = true);

drop policy if exists "log_mobs_select_public" on public.log_mobs;
create policy "log_mobs_select_public" on public.log_mobs for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_mobs.log_id and l.published = true));

drop policy if exists "log_items_select_public" on public.log_items;
create policy "log_items_select_public" on public.log_items for select to anon, authenticated
  using (exists (select 1 from public.logs l where l.id = log_items.log_id and l.published = true));

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public" on public.comments for select to anon, authenticated
  using (hidden = false and exists (select 1 from public.logs l where l.id = comments.log_id and l.published = true));

-- Corrección: antes el INSERT público permitía enviar likes=1000000, hidden o un parent_id ajeno.
drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public" on public.comments for insert to anon, authenticated
  with check (
    char_length(comment) between 1 and 500
    and char_length(username) <= 40
    and likes = 0
    and hidden = false
    and exists (select 1 from public.logs l where l.id = comments.log_id and l.published = true)
    and (
      parent_id is null
      or exists (
        select 1 from public.comments p
        where p.id = comments.parent_id and p.log_id = comments.log_id and p.parent_id is null
      )
    )
  );

-- Los likes solo se escriben por RPC (toggle_like / like_comment), nunca por INSERT directo.
drop policy if exists "log_likes_insert_public" on public.log_likes;
drop policy if exists "comment_likes_insert_public" on public.comment_likes;

-- Índices: se quitan los que quedan cubiertos por los compuestos y se añaden los de rendimiento.
drop index if exists public.log_mobs_log_id_idx;
drop index if exists public.log_items_log_id_idx;
drop index if exists public.weapon_ranks_weapon_idx;
drop index if exists public.comments_log_id_idx;
drop index if exists public.tierlist_items_row_id_idx;
create index if not exists log_mobs_log_sort_idx on public.log_mobs (log_id, sort_order);
create index if not exists log_items_log_sort_idx on public.log_items (log_id, sort_order);
create index if not exists weapon_ranks_weapon_sort_idx on public.weapon_ranks (weapon_id, sort_order);
create index if not exists tierlist_items_row_column_sort_idx on public.tierlist_items (row_id, column_key, sort_order);
create index if not exists comments_log_created_idx on public.comments (log_id, created_at);
create index if not exists log_mobs_extra_fields_gin_idx on public.log_mobs using gin (extra_fields jsonb_path_ops);
create index if not exists log_items_extra_fields_gin_idx on public.log_items using gin (extra_fields jsonb_path_ops);
create index if not exists tierlist_items_extra_fields_gin_idx on public.tierlist_items using gin (extra_fields jsonb_path_ops);

-- Bitácora enriquecida con la identidad de Discord.
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
create index if not exists action_log_auth_user_idx on public.action_log (auth_user_id, created_at desc);
create index if not exists action_log_entity_idx on public.action_log (entity_type, entity_id, created_at desc);
create index if not exists action_log_request_id_idx on public.action_log ((metadata ->> 'request_id')) where metadata ? 'request_id';

-- Kits recomendados.
create table if not exists public.kits (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  published   boolean not null default true,
  items       jsonb not null default '{"weapon":[],"accessory":[],"subweapon":[]}'::jsonb,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists kits_sort_idx on public.kits (sort_order, created_at);
create index if not exists kits_published_idx on public.kits (published);
alter table public.kits enable row level security;
drop policy if exists "kits_select_public" on public.kits;
create policy "kits_select_public" on public.kits for select to anon, authenticated
  using (published = true);

-- Borradores: ahora pertenecen a la cuenta de Discord (antes dependían de un hash del código, que ya no existe).
drop table if exists public.drafts;
create table public.drafts (
  id          uuid primary key default gen_random_uuid(),
  owner_key   text not null,
  entity_type text not null check (entity_type in ('log', 'tierlist_item')),
  entity_id   text not null,
  payload     jsonb not null,
  saved_at    timestamptz not null default now(),
  unique (owner_key, entity_type, entity_id)
);
alter table public.drafts enable row level security;
create policy "drafts_no_direct_access" on public.drafts for all to anon, authenticated
  using (false) with check (false);

-- Discord: configuración del servidor, foro de Guías, publicaciones de Logs y cola de borrados.
create table if not exists public.discord_guild_config (
  guild_id                text primary key,
  admin_role_id           text,
  guides_forum_channel_id text,
  log_channel_id          text,
  alert_channel_id        text,
  forum_reactions         jsonb not null default '[]'::jsonb check (jsonb_typeof(forum_reactions) = 'array'),
  updated_by              text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.discord_guild_config is 'Configuración del único servidor oficial usada por bot y Discord OAuth.';
comment on column public.discord_guild_config.alert_channel_id is 'Canal privado donde el bot envía alertas operativas; null usa DM al propietario.';

create table if not exists public.guide_forum_publications (
  guide_id           uuid primary key references public.weapons(id) on delete cascade,
  forum_channel_id   text,
  thread_id          text,
  starter_message_id text,
  message_map        jsonb not null default '{}'::jsonb,
  message_order      jsonb not null default '[]'::jsonb,
  attachment_map     jsonb not null default '{}'::jsonb,
  published_hash     text,
  status             text not null default 'unpublished',
  last_error_code    text,
  last_error_message text,
  last_synced_by     uuid references auth.users(id) on delete set null,
  published_at       timestamptz,
  updated_at         timestamptz not null default now(),
  constraint guide_forum_status_valid check (status in (
    'unpublished','publishing','synced','outdated','updating',
    'unpublishing','lost','failed','synced_with_warnings'
  )),
  constraint guide_forum_message_map_object check (jsonb_typeof(message_map) = 'object'),
  constraint guide_forum_message_order_array check (jsonb_typeof(message_order) = 'array'),
  constraint guide_forum_attachment_map_object check (jsonb_typeof(attachment_map) = 'object')
);
create index if not exists guide_forum_publications_thread_idx on public.guide_forum_publications (thread_id);
create index if not exists guide_forum_publications_status_idx on public.guide_forum_publications (status);
comment on table public.guide_forum_publications is 'Estado y message_map de cada publicación del foro de Guías.';

create table if not exists public.guide_forum_jobs (
  id                        uuid primary key default gen_random_uuid(),
  guide_id                  uuid references public.weapons(id) on delete cascade,
  action                    text not null,
  requested_by              uuid references auth.users(id) on delete set null,
  requested_discord_user_id text,
  idempotency_key           text not null unique,
  payload                   jsonb not null default '{}'::jsonb,
  status                    text not null default 'pending',
  attempts                  integer not null default 0,
  error_code                text,
  error_message             text,
  created_at                timestamptz not null default now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  constraint guide_forum_job_action_valid check (action in ('publish','update','unpublish','reconcile','apply_reactions')),
  constraint guide_forum_job_status_valid check (status in ('pending','processing','completed','failed','cancelled')),
  constraint guide_forum_job_payload_object check (jsonb_typeof(payload) = 'object')
);
create index if not exists guide_forum_jobs_pending_idx on public.guide_forum_jobs (status, created_at);
create index if not exists guide_forum_jobs_guide_idx on public.guide_forum_jobs (guide_id, created_at desc);
comment on table public.guide_forum_jobs is 'Cola idempotente de publicar/actualizar/despublicar Guías en Discord.';

create table if not exists public.guide_forum_tag_map (
  id               uuid primary key default gen_random_uuid(),
  forum_channel_id text not null,
  kind             text not null,
  source_id        uuid not null,
  source_name      text not null,
  discord_tag_id   text not null,
  discord_tag_name text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (forum_channel_id, kind, source_id),
  constraint guide_forum_tag_kind_valid check (kind in ('category','type'))
);

create table if not exists public.log_discord_publications (
  log_id             uuid primary key references public.logs(id) on delete cascade,
  channel_id         text not null default '',
  summary_message_id text,
  thread_id          text,
  page_message_ids   jsonb not null default '[]'::jsonb,
  message_map        jsonb not null default '{}'::jsonb,
  message_order      jsonb not null default '[]'::jsonb,
  content_hash       text,
  status             text not null default 'synced',
  updated_at         timestamptz not null default now()
);
create index if not exists log_discord_publications_thread_idx on public.log_discord_publications (thread_id);

create table if not exists public.discord_deletion_queue (
  id                 uuid primary key default gen_random_uuid(),
  log_id             uuid not null,
  channel_id         text,
  summary_message_id text,
  thread_id          text,
  created_at         timestamptz not null default now()
);

-- Tablas internas: el navegador nunca las toca (solo service_role, que ignora RLS).
alter table public.discord_guild_config enable row level security;
alter table public.guide_forum_publications enable row level security;
alter table public.guide_forum_jobs enable row level security;
alter table public.guide_forum_tag_map enable row level security;
alter table public.log_discord_publications enable row level security;
alter table public.discord_deletion_queue enable row level security;

drop policy if exists "discord_guild_config_no_client" on public.discord_guild_config;
create policy "discord_guild_config_no_client" on public.discord_guild_config for all to anon, authenticated using (false) with check (false);
drop policy if exists "guide_forum_publications_no_client" on public.guide_forum_publications;
create policy "guide_forum_publications_no_client" on public.guide_forum_publications for all to anon, authenticated using (false) with check (false);
drop policy if exists "guide_forum_jobs_no_client" on public.guide_forum_jobs;
create policy "guide_forum_jobs_no_client" on public.guide_forum_jobs for all to anon, authenticated using (false) with check (false);
drop policy if exists "guide_forum_tag_map_no_client" on public.guide_forum_tag_map;
create policy "guide_forum_tag_map_no_client" on public.guide_forum_tag_map for all to anon, authenticated using (false) with check (false);
drop policy if exists "discord_pubs_no_public" on public.log_discord_publications;
create policy "discord_pubs_no_public" on public.log_discord_publications for all to anon, authenticated using (false) with check (false);
drop policy if exists "discord_deletion_queue_no_public" on public.discord_deletion_queue;
create policy "discord_deletion_queue_no_public" on public.discord_deletion_queue for all to anon, authenticated using (false) with check (false);

-- Versiones de contenido para las novedades (una fila por sección).
create table if not exists public.site_content_versions (
  section      text primary key check (section in ('logs','guides','tierlist','kits','about')),
  version      bigint not null default 1,
  updated_at   timestamptz not null default now(),
  latest_id    text,
  latest_title text,
  change_kind  text not null default 'updated' check (change_kind in ('baseline','published','updated','removed'))
);
alter table public.site_content_versions enable row level security;
drop policy if exists "site_content_versions_select_public" on public.site_content_versions;
create policy "site_content_versions_select_public" on public.site_content_versions for select to anon, authenticated using (true);
grant select on public.site_content_versions to anon, authenticated;
insert into public.site_content_versions (section, version, updated_at, change_kind)
values ('logs',1,now(),'baseline'), ('guides',1,now(),'baseline'), ('tierlist',1,now(),'baseline'), ('kits',1,now(),'baseline'), ('about',1,now(),'baseline')
on conflict (section) do nothing;

-- Límite de frecuencia para escrituras públicas (comentarios y likes).
create table if not exists public.rate_limit_hits (
  bucket       text not null,
  actor        text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, actor, window_start)
);
alter table public.rate_limit_hits enable row level security;
drop policy if exists "rate_limit_hits_no_client" on public.rate_limit_hits;
create policy "rate_limit_hits_no_client" on public.rate_limit_hits for all to anon, authenticated using (false) with check (false);

-- Realtime: el bot y la web escuchan estas tablas.
do $$
declare t text;
begin
  foreach t in array array['kits', 'guide_forum_jobs', 'discord_deletion_queue'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

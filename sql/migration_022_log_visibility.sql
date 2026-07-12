-- =========================================================
-- CULONES-RPG · Migración 022
-- Visibilidad pública de Logs + despublicación de Discord.
-- =========================================================
-- Requiere migration_021_discord_auth_and_forum.sql.
-- Ejecutar una sola vez desde Supabase SQL Editor.
-- Es idempotente: puede repetirse si una ejecución se interrumpe.
-- =========================================================

-- 1) Estado de publicación. Los Logs existentes permanecen públicos.
alter table public.logs
  add column if not exists published boolean not null default true;

update public.logs set published = true where published is null;

create index if not exists logs_published_created_idx
  on public.logs (published, created_at desc);

-- 2) La lectura pública solo devuelve Logs publicados.
drop policy if exists "logs_select_public" on public.logs;
create policy "logs_select_public"
  on public.logs for select
  to anon, authenticated
  using (published = true);

-- Los bloques de un Log oculto tampoco pueden consultarse directamente.
drop policy if exists "log_mobs_select_public" on public.log_mobs;
create policy "log_mobs_select_public"
  on public.log_mobs for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.logs
      where logs.id = log_mobs.log_id
        and logs.published = true
    )
  );

drop policy if exists "log_items_select_public" on public.log_items;
create policy "log_items_select_public"
  on public.log_items for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.logs
      where logs.id = log_items.log_id
        and logs.published = true
    )
  );

-- Los comentarios de Logs ocultos tampoco son públicos.
drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  to anon, authenticated
  using (
    hidden = false
    and exists (
      select 1 from public.logs
      where logs.id = comments.log_id
        and logs.published = true
    )
  );

drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public"
  on public.comments for insert
  to anon, authenticated
  with check (
    char_length(comment) > 0
    and char_length(comment) <= 500
    and char_length(username) <= 40
    and exists (
      select 1 from public.logs
      where logs.id = comments.log_id
        and logs.published = true
    )
  );

-- 3) Lecturas administrativas seguras. Solo service_role puede ejecutarlas;
-- la web llega a ellas mediante discord-admin-api después de validar el rol.
create or replace function public.list_logs_admin()
returns setof public.logs
language sql
security definer
set search_path = public
as $$
  select * from public.logs order by created_at desc;
$$;

create or replace function public.list_log_mobs_admin()
returns setof public.log_mobs
language sql
security definer
set search_path = public
as $$
  select * from public.log_mobs order by log_id, sort_order, created_at;
$$;

create or replace function public.list_log_items_admin()
returns setof public.log_items
language sql
security definer
set search_path = public
as $$
  select * from public.log_items order by log_id, sort_order, created_at;
$$;

create or replace function public.list_comments_admin(input_log_id uuid)
returns setof public.comments
language sql
security definer
set search_path = public
as $$
  select * from public.comments
  where log_id = input_log_id
  order by created_at;
$$;

revoke all on function public.list_logs_admin() from public, anon, authenticated;
revoke all on function public.list_log_mobs_admin() from public, anon, authenticated;
revoke all on function public.list_log_items_admin() from public, anon, authenticated;
revoke all on function public.list_comments_admin(uuid) from public, anon, authenticated;
grant execute on function public.list_logs_admin() to service_role;
grant execute on function public.list_log_mobs_admin() to service_role;
grant execute on function public.list_log_items_admin() to service_role;
grant execute on function public.list_comments_admin(uuid) to service_role;

-- 4) Cola de borrado durable. Se conserva aunque el bot esté apagado.
create table if not exists public.discord_deletion_queue (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null,
  channel_id text,
  summary_message_id text,
  thread_id text,
  created_at timestamptz not null default now()
);

alter table public.discord_deletion_queue enable row level security;
drop policy if exists "discord_deletion_queue_no_public" on public.discord_deletion_queue;
create policy "discord_deletion_queue_no_public"
  on public.discord_deletion_queue for all
  to anon, authenticated
  using (false) with check (false);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'discord_deletion_queue'
  ) then
    alter publication supabase_realtime add table public.discord_deletion_queue;
  end if;
end $$;

-- 5) Publicar/despublicar un Log.
-- Al ocultarlo se encola la eliminación de Discord y se borra el mapeo
-- persistente. Al volver a publicarlo, el watcher crea una publicación nueva.
create or replace function public.set_log_published(
  input_id uuid,
  input_published boolean
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  current_log public.logs;
  result public.logs;
  publication public.log_discord_publications;
begin
  select * into current_log from public.logs where id = input_id for update;
  if current_log.id is null then
    raise exception 'El Log no existe';
  end if;

  if current_log.published = input_published then
    return current_log;
  end if;

  if input_published = false then
    select * into publication
    from public.log_discord_publications
    where log_id = input_id;

    if publication.log_id is not null then
      insert into public.discord_deletion_queue (
        log_id, channel_id, summary_message_id, thread_id
      ) values (
        publication.log_id,
        publication.channel_id,
        publication.summary_message_id,
        publication.thread_id
      );

      delete from public.log_discord_publications where log_id = input_id;
    end if;
  end if;

  update public.logs
  set published = input_published
  where id = input_id
  returning * into result;

  insert into public.action_log (
    actor, action, description,
    entity_type, entity_id, entity_name,
    old_value, new_value, metadata, success
  ) values (
    'Admin',
    case when input_published then 'log_published' else 'log_unpublished' end,
    case
      when input_published then format(
        'Se publicó el Log “%s”. Volvió a estar visible para la comunidad y el bot lo enviará al canal de Logs.',
        coalesce(nullif(trim(result.title), ''), 'Log sin título')
      )
      else format(
        'Se despublicó el Log “%s”. Dejó de ser visible para la comunidad y su publicación de Discord fue enviada a eliminación.',
        coalesce(nullif(trim(result.title), ''), 'Log sin título')
      )
    end,
    'log',
    result.id::text,
    result.title,
    jsonb_build_object('published', current_log.published),
    jsonb_build_object('published', result.published),
    jsonb_build_object('discord_cleanup_queued', input_published = false),
    true
  );

  return result;
end;
$$;

revoke all on function public.set_log_published(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_log_published(uuid, boolean) to service_role;

-- 6) Los likes públicos no pueden modificar Logs ocultos.
create or replace function public.toggle_like(
  input_log_id uuid,
  input_client_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  already_liked boolean;
  new_likes integer;
begin
  if not exists (
    select 1 from public.logs
    where id = input_log_id and published = true
  ) then
    raise exception 'Este Log no está disponible públicamente';
  end if;

  select exists (
    select 1 from public.log_likes
    where log_id = input_log_id and client_id = input_client_id
  ) into already_liked;

  if already_liked then
    delete from public.log_likes
    where log_id = input_log_id and client_id = input_client_id;

    update public.logs set likes = greatest(likes - 1, 0)
    where id = input_log_id
    returning likes into new_likes;
  else
    insert into public.log_likes (log_id, client_id)
    values (input_log_id, input_client_id);

    update public.logs set likes = likes + 1
    where id = input_log_id
    returning likes into new_likes;
  end if;

  return new_likes;
end;
$$;

grant execute on function public.toggle_like(uuid, text) to anon, authenticated;

-- 7) Los likes de comentarios tampoco pueden tocar comentarios de Logs ocultos.
create or replace function public.like_comment(
  input_comment_id uuid,
  input_client_id text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  already_liked boolean;
  new_likes integer;
begin
  if not exists (
    select 1
    from public.comments c
    join public.logs l on l.id = c.log_id
    where c.id = input_comment_id
      and c.hidden = false
      and l.published = true
  ) then
    raise exception 'Este comentario no está disponible públicamente';
  end if;

  select exists (
    select 1 from public.comment_likes
    where comment_id = input_comment_id and client_id = input_client_id
  ) into already_liked;

  if already_liked then
    delete from public.comment_likes
    where comment_id = input_comment_id and client_id = input_client_id;

    update public.comments set likes = greatest(likes - 1, 0)
    where id = input_comment_id
    returning likes into new_likes;
  else
    insert into public.comment_likes (comment_id, client_id)
    values (input_comment_id, input_client_id);

    update public.comments set likes = likes + 1
    where id = input_comment_id
    returning likes into new_likes;
  end if;

  return new_likes;
end;
$$;

grant execute on function public.like_comment(uuid, text) to anon, authenticated;

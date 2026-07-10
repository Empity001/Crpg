-- sql/migration_017_discord_deletion_queue.sql
-- =========================================================
-- Reemplaza el enfoque anterior (escuchar el DELETE en cascada
-- de log_discord_publications vía Realtime) por una cola simple.
--
-- POR QUÉ EL ENFOQUE ANTERIOR NO ERA CONFIABLE:
-- Un evento DELETE de Realtime, incluso con REPLICA IDENTITY
-- FULL, depende de que Postgres/Realtime evalúen las políticas
-- RLS de la tabla contra el "old row" para decidir si mandan su
-- contenido — y en la práctica eso terminaba llegando vacío
-- (solo con log_id, sin channel_id/summary_message_id/thread_id).
--
-- LA SOLUCIÓN: en vez de depender de un DELETE, delete_log()
-- ahora hace un INSERT explícito en esta tabla-cola justo antes
-- de borrar el log. Los eventos INSERT de Realtime siempre traen
-- la fila completa — es el mismo mecanismo, ya probado, que usa
-- el bot para detectar logs nuevos.
--
-- El bot escucha INSERT en discord_deletion_queue, borra el
-- mensaje/hilo correspondiente en Discord, y luego borra la fila
-- de la cola (limpieza, para que no crezca sin límite).
--
-- Ejecuta en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr más de una vez.
-- =========================================================

-- ---------------------------------------------------------
-- 1) TABLA: discord_deletion_queue
-- ---------------------------------------------------------
create table if not exists public.discord_deletion_queue (
  id                  uuid primary key default gen_random_uuid(),
  log_id              uuid not null,
  channel_id          text,
  summary_message_id  text,
  thread_id           text,
  created_at          timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2) RLS: bloqueada para anon/authenticated. delete_log()
--    (SECURITY DEFINER) puede insertar igual que ya hace con
--    action_log, que sigue el mismo patrón. El bot lee/borra
--    con la service_role key, que bypassea RLS por completo.
-- ---------------------------------------------------------
alter table public.discord_deletion_queue enable row level security;

drop policy if exists "discord_deletion_queue_no_public" on public.discord_deletion_queue;
create policy "discord_deletion_queue_no_public"
  on public.discord_deletion_queue for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------
-- 3) Habilitar Realtime para esta tabla (solo INSERT importa,
--    pero no hace falta filtrar — el bot solo escucha INSERT).
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- 4) delete_log(): ahora encola la publicación de Discord
--    (si existe) ANTES de borrar el log. El resto de la función
--    (validación de código admin + auditoría) queda igual que
--    en migration_014_admin_action_audit_details.sql.
-- ---------------------------------------------------------
create or replace function public.delete_log(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_log public.logs;
  pub public.log_discord_publications;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select * into old_log from public.logs where id = input_id;

  -- Encolar la limpieza de Discord ANTES de borrar — para cuando
  -- el log se borre (y log_discord_publications se vaya con él
  -- en cascada), el bot ya tiene lo que necesita en la cola.
  select * into pub from public.log_discord_publications where log_id = input_id;
  if pub.log_id is not null then
    insert into public.discord_deletion_queue (log_id, channel_id, summary_message_id, thread_id)
    values (pub.log_id, pub.channel_id, pub.summary_message_id, pub.thread_id);
  end if;

  delete from public.logs where id = input_id;

  if old_log.id is not null then
    insert into public.action_log (actor, action, description)
    values (
      'Admin',
      'log_deleted',
      format(
        'Se eliminó el log "%s"%s.',
        coalesce(nullif(trim(old_log.title), ''), 'log sin título'),
        case
          when old_log.created_at is not null
            then format(' del %s', to_char(old_log.created_at at time zone 'America/Santo_Domingo', 'DD Mon YYYY, HH24:MI'))
          else ''
        end
      )
    );
  end if;
end;
$$;

grant execute on function public.delete_log(text, uuid) to anon, authenticated;

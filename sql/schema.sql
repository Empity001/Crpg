-- =========================================================
-- CULONES-RPG · Esquema de base de datos para Supabase
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- =========================================================

-- ---------------------------------------------------------
-- EXTENSIONES NECESARIAS
-- ---------------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------
-- TABLA: logs
-- ---------------------------------------------------------
create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  category    text not null default 'other',
  relevance   text not null default 'normal', -- low | normal | high | critical
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists logs_created_at_idx on public.logs (created_at desc);
create index if not exists logs_category_idx on public.logs (category);

-- ---------------------------------------------------------
-- TABLA: comments
-- ---------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references public.logs (id) on delete cascade,
  username   text not null default 'Anónimo',
  comment    text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_log_id_idx on public.comments (log_id);

-- ---------------------------------------------------------
-- TABLA: admin_codes
-- ---------------------------------------------------------
create table if not exists public.admin_codes (
  code       text primary key,
  expires_at timestamptz not null,
  created_by text not null -- discord ID del bot/usuario que generó el código
);

-- ---------------------------------------------------------
-- TABLA: likes_log (para evitar likes duplicados por navegador)
-- ---------------------------------------------------------
-- Como no hay cuentas reales, usamos un identificador anónimo
-- generado en el navegador (guardado en localStorage) para
-- evitar que la misma persona infle likes recargando la página.
create table if not exists public.log_likes (
  log_id     uuid not null references public.logs (id) on delete cascade,
  client_id  text not null,
  created_at timestamptz not null default now(),
  primary key (log_id, client_id)
);

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.logs enable row level security;
alter table public.comments enable row level security;
alter table public.admin_codes enable row level security;
alter table public.log_likes enable row level security;

-- ---------------------------------------------------------
-- POLÍTICAS: logs
-- ---------------------------------------------------------
-- Lectura pública (cualquiera puede ver los logs)
drop policy if exists "logs_select_public" on public.logs;
create policy "logs_select_public"
  on public.logs for select
  to anon, authenticated
  using (true);

-- Nadie puede insertar/editar/borrar logs directamente vía anon key.
-- La creación de logs como admin se hace a través de una función
-- RPC (definida abajo) que valida el código de admin internamente.
-- Esto evita que cualquiera con la anon key pueda escribir logs
-- a mano sin pasar por la validación de código.

-- ---------------------------------------------------------
-- POLÍTICAS: comments
-- ---------------------------------------------------------
-- Lectura pública
drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  to anon, authenticated
  using (true);

-- Inserción pública (usuarios anónimos con alias libre)
drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public"
  on public.comments for insert
  to anon, authenticated
  with check (
    char_length(comment) > 0 and char_length(comment) <= 500
    and char_length(username) <= 40
  );

-- ---------------------------------------------------------
-- POLÍTICAS: admin_codes
-- ---------------------------------------------------------
-- NADIE puede leer directamente la tabla de códigos desde el
-- frontend (ni siquiera el propio código no se "lee" para
-- comparar — se valida vía función RPC con SECURITY DEFINER).
drop policy if exists "admin_codes_no_access" on public.admin_codes;
create policy "admin_codes_no_access"
  on public.admin_codes for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------
-- POLÍTICAS: log_likes
-- ---------------------------------------------------------
drop policy if exists "log_likes_select_public" on public.log_likes;
create policy "log_likes_select_public"
  on public.log_likes for select
  to anon, authenticated
  using (true);

drop policy if exists "log_likes_insert_public" on public.log_likes;
create policy "log_likes_insert_public"
  on public.log_likes for insert
  to anon, authenticated
  with check (true);

-- =========================================================
-- FUNCIONES RPC (SECURITY DEFINER)
-- =========================================================
-- Estas funciones corren con privilegios elevados PERO solo
-- hacen exactamente lo que están programadas a hacer — son la
-- única puerta de entrada para acciones sensibles desde el
-- frontend con la anon key.

-- ---------------------------------------------------------
-- validate_admin_code: comprueba si un código es válido y no
-- ha expirado. Devuelve true/false. No expone la tabla.
-- ---------------------------------------------------------
create or replace function public.validate_admin_code(input_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_valid boolean;
begin
  select exists (
    select 1 from public.admin_codes
    where code = input_code
      and expires_at > now()
  ) into is_valid;

  return is_valid;
end;
$$;

-- ---------------------------------------------------------
-- create_log: crea un log SOLO si el código de admin es válido.
-- ---------------------------------------------------------
create or replace function public.create_log(
  input_code text,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  new_log public.logs;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.logs (title, description, category, relevance)
  values (input_title, input_description, input_category, input_relevance)
  returning * into new_log;

  return new_log;
end;
$$;

-- ---------------------------------------------------------
-- update_log: edita un log existente SOLO si el código es válido.
-- ---------------------------------------------------------
create or replace function public.update_log(
  input_code text,
  input_id uuid,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text
)
returns public.logs
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_log public.logs;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.logs
  set title = input_title,
      description = input_description,
      category = input_category,
      relevance = input_relevance
  where id = input_id
  returning * into updated_log;

  return updated_log;
end;
$$;

-- ---------------------------------------------------------
-- delete_log: borra un log SOLO si el código es válido.
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
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  delete from public.logs where id = input_id;
end;
$$;

-- ---------------------------------------------------------
-- toggle_like: da o quita like a un log de forma idempotente
-- usando un client_id anónimo (sin necesidad de login).
-- ---------------------------------------------------------
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

-- Permitir que anon/authenticated ejecuten estas funciones RPC
grant execute on function public.validate_admin_code(text) to anon, authenticated;
grant execute on function public.create_log(text, text, text, text, text) to anon, authenticated;
grant execute on function public.update_log(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_log(text, uuid) to anon, authenticated;
grant execute on function public.toggle_like(uuid, text) to anon, authenticated;

-- =========================================================
-- REALTIME (para que el bot de Discord pueda escuchar
-- nuevos logs en tiempo real más adelante)
-- =========================================================
alter publication supabase_realtime add table public.logs;

-- =========================================================
-- DATOS DE EJEMPLO (opcional — puedes borrar este bloque)
-- =========================================================
insert into public.logs (title, description, category, relevance)
values
  ('Spawn de Slime Real reestructurado', 'Se ajustó el área de spawn del Slime Real en el bioma de pantano. Ahora aparece con mayor frecuencia entre las 22:00 y 02:00 horas del servidor.', 'mob', 'normal'),
  ('Nueva espada gacha: Filo del Vacío', 'Agregada al pool de gacha legendario. Daño base 45, con efecto de sigilo por 3 segundos al golpear críticamente.', 'item', 'high'),
  ('Corrección de exploit en el sistema de trade', 'Se corrigió un bug que permitía duplicar ítems al cancelar un trade en el momento exacto de confirmación.', 'mechanic', 'critical')
on conflict do nothing;

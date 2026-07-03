-- =========================================================
-- CULONES-RPG · Migración 003
-- Bloques estructurados de Mobs e Items dentro de un log
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr sobre una base que ya tiene schema.sql y
-- migration_002_categories_and_dates.sql aplicados.
-- =========================================================

-- ---------------------------------------------------------
-- TABLA: log_mobs
-- Un log puede tener 0, 1 o varios mobs asociados, cada uno
-- con sus propias estadísticas (vida/daño/armor).
-- ---------------------------------------------------------
create table if not exists public.log_mobs (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.logs (id) on delete cascade,
  name        text not null,
  health      integer,           -- "Vida" — opcional pero se espera casi siempre
  damage      integer,           -- "Daño"
  armor       integer,           -- "Armor" — explícitamente opcional
  equipment   text,              -- texto libre: "Casco de Tortuga, Pechera de oro..."
  location    text,              -- texto libre: "Aparece en el Nether"
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists log_mobs_log_id_idx on public.log_mobs (log_id);

-- ---------------------------------------------------------
-- TABLA: log_items
-- Igual que log_mobs, pero para ítems (sin barras numéricas,
-- solo datos descriptivos: rango, tipo, dónde se obtiene).
-- ---------------------------------------------------------
create table if not exists public.log_items (
  id             uuid primary key default gen_random_uuid(),
  log_id         uuid not null references public.logs (id) on delete cascade,
  name           text not null,
  tier           text,           -- "Rango/Tier": ej "S", "Z", "MK 1-5" (texto libre)
  item_type      text,           -- "Tipo": ej "Arma", "Accesorio", "Totem"
  obtained_from  text,           -- "Dónde se obtiene": ej "Máquina de Armas"
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists log_items_log_id_idx on public.log_items (log_id);

-- ---------------------------------------------------------
-- RLS: lectura pública, igual que logs/comments.
-- Nadie escribe directo — todo pasa por create_log/update_log
-- (definidas más abajo), que ya validan el código de admin.
-- ---------------------------------------------------------
alter table public.log_mobs enable row level security;
alter table public.log_items enable row level security;

drop policy if exists "log_mobs_select_public" on public.log_mobs;
create policy "log_mobs_select_public"
  on public.log_mobs for select
  to anon, authenticated
  using (true);

drop policy if exists "log_items_select_public" on public.log_items;
create policy "log_items_select_public"
  on public.log_items for select
  to anon, authenticated
  using (true);

-- =========================================================
-- create_log / update_log: ahora aceptan input_mobs e
-- input_items como JSON (arrays de objetos), y los insertan
-- en log_mobs / log_items dentro de la misma función.
-- =========================================================

drop function if exists public.create_log(text, text, text, text, text, timestamptz);

create or replace function public.create_log(
  input_code text,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null,
  input_mobs jsonb default '[]'::jsonb,
  input_items jsonb default '[]'::jsonb
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

  insert into public.logs (title, description, category, relevance, created_at)
  values (
    input_title,
    input_description,
    input_category,
    input_relevance,
    coalesce(input_created_at, now())
  )
  returning * into new_log;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, sort_order)
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, sort_order)
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  return new_log;
end;
$$;

grant execute on function public.create_log(text, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

drop function if exists public.update_log(text, uuid, text, text, text, text, timestamptz);

create or replace function public.update_log(
  input_code text,
  input_id uuid,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null,
  input_mobs jsonb default '[]'::jsonb,
  input_items jsonb default '[]'::jsonb
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
      relevance = input_relevance,
      created_at = coalesce(input_created_at, created_at)
  where id = input_id
  returning * into updated_log;

  -- Reemplazo completo: se borran los bloques anteriores y se
  -- insertan los nuevos tal cual los manda el frontend (incluye
  -- los que no cambiaron, los editados y los nuevos; los que el
  -- usuario quitó del formulario simplemente no vienen en el array).
  delete from public.log_mobs where log_id = input_id;
  delete from public.log_items where log_id = input_id;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, sort_order)
  select
    input_id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, sort_order)
  select
    input_id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  return updated_log;
end;
$$;

grant execute on function public.update_log(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

-- =========================================================
-- NOTA sobre eliminar categorías:
-- La función delete_category ya existe desde la migración 002
-- (protegida: rechaza el borrado si algún log usa esa categoría).
-- Esta migración no la toca, solo se documenta aquí para que
-- sepas que el botón "Borrar" de categorías en la web ya tiene
-- soporte completo en la base de datos.
-- =========================================================

-- =========================================================
-- REALTIME: que el bot/otros admins vean también cambios en
-- los bloques de mobs/items en tiempo real (opcional, pero
-- consistente con como ya se hizo con logs).
-- =========================================================
alter publication supabase_realtime add table public.log_mobs;
alter publication supabase_realtime add table public.log_items;

-- =========================================================
-- CULONES-RPG · Migración 002
-- Categorías dinámicas + fecha editable en logs
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Este script es seguro de correr sobre una base que ya tiene
-- el schema.sql original aplicado (usa "if not exists" / "or replace").
-- =========================================================

-- ---------------------------------------------------------
-- TABLA: categories
-- ---------------------------------------------------------
create table if not exists public.categories (
  slug        text primary key,        -- identificador interno, ej: "npc"
  label       text not null,           -- nombre visible, ej: "NPC"
  emoji       text not null default '📦',
  color       text not null default '#4dd4e8', -- color hex para el borde/badge
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

-- Lectura pública (todos necesitan ver qué categorías existen)
drop policy if exists "categories_select_public" on public.categories;
create policy "categories_select_public"
  on public.categories for select
  to anon, authenticated
  using (true);

-- Igual que con logs: nadie inserta directo, solo vía función RPC
-- protegida por código de admin (ver create_category más abajo).

-- ---------------------------------------------------------
-- Semillas: las 5 categorías originales, ahora como filas
-- editables en vez de estar fijas en el código.
-- ---------------------------------------------------------
insert into public.categories (slug, label, emoji, color) values
  ('item',     'Item',      '🗡', '#f3b73a'),
  ('mob',      'Mob',       '👾', '#ff3d8e'),
  ('mechanic', 'Mecánica',  '⚙',  '#4dd4e8'),
  ('event',    'Evento',    '🎉', '#38e07a'),
  ('other',    'Otro',      '📦', '#9a92b8')
on conflict (slug) do nothing;

-- ---------------------------------------------------------
-- FUNCIÓN: create_category
-- Crea una categoría nueva, validando el código de admin.
-- ---------------------------------------------------------
create or replace function public.create_category(
  input_code text,
  input_slug text,
  input_label text,
  input_emoji text,
  input_color text
)
returns public.categories
language plpgsql
security definer
set search_path = public
as $$
declare
  new_category public.categories;
  clean_slug text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  -- normaliza el slug: minúsculas, sin espacios ni símbolos raros
  clean_slug := lower(regexp_replace(trim(input_slug), '[^a-z0-9_]+', '-', 'g'));

  if clean_slug = '' then
    raise exception 'El identificador de categoría no puede estar vacío';
  end if;

  insert into public.categories (slug, label, emoji, color)
  values (clean_slug, input_label, coalesce(input_emoji, '📦'), coalesce(input_color, '#9a92b8'))
  returning * into new_category;

  return new_category;
end;
$$;

grant execute on function public.create_category(text, text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------
-- FUNCIÓN: delete_category
-- Borra una categoría SOLO si ningún log la está usando.
-- ---------------------------------------------------------
create or replace function public.delete_category(
  input_code text,
  input_slug text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  logs_using_it integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select count(*) into logs_using_it from public.logs where category = input_slug;

  if logs_using_it > 0 then
    raise exception 'No se puede borrar: % log(s) usan esta categoría', logs_using_it;
  end if;

  delete from public.categories where slug = input_slug;
end;
$$;

grant execute on function public.delete_category(text, text) to anon, authenticated;

-- =========================================================
-- LOGS: permitir fecha (created_at) editable desde el admin
-- =========================================================
-- Reemplazamos create_log y update_log para que acepten una
-- fecha opcional. Si no se manda, se usa now() como antes.

drop function if exists public.create_log(text, text, text, text, text);

create or replace function public.create_log(
  input_code text,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null
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

  return new_log;
end;
$$;

grant execute on function public.create_log(text, text, text, text, text, timestamptz) to anon, authenticated;

drop function if exists public.update_log(text, uuid, text, text, text, text);

create or replace function public.update_log(
  input_code text,
  input_id uuid,
  input_title text,
  input_description text,
  input_category text,
  input_relevance text,
  input_created_at timestamptz default null
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

  return updated_log;
end;
$$;

grant execute on function public.update_log(text, uuid, text, text, text, text, timestamptz) to anon, authenticated;

-- =========================================================
-- CULONES-RPG · Migración 008
-- Guía de Armas: categorías y tipos dinámicos, catálogo de
-- armas (ocultas hasta publicarse), rangos/niveles ilimitados
-- por arma (MK1, MK2... con stats, habilidades y receta de
-- mejora tipo "trade"), y secciones extra libres para que la
-- ficha pueda crecer a futuro (curiosidades, notas, builds...)
-- sin necesidad de migrar de nuevo.
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr sobre una base que ya tiene schema.sql +
-- migration_002 a migration_007 aplicados (usa action_log,
-- que viene de migration_005).
-- =========================================================

-- ---------------------------------------------------------
-- 1) weapon_categories — dinámicas, definidas por el admin
--    (ej. "MK1", "Legendaria", "Gacha S"...), con color propio.
--    Independientes de las `categories` de logs: son dominios
--    distintos (esas categorizan logs, estas categorizan armas).
-- ---------------------------------------------------------
create table if not exists public.weapon_categories (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  color       text not null default '#9a92b8',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists weapon_categories_sort_idx on public.weapon_categories (sort_order);

-- ---------------------------------------------------------
-- 2) weapon_types — dinámicos (ej. "Arma", "Accesorio"...).
-- ---------------------------------------------------------
create table if not exists public.weapon_types (
  id          uuid primary key default gen_random_uuid(),
  label       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists weapon_types_sort_idx on public.weapon_types (sort_order);

-- ---------------------------------------------------------
-- 3) weapons — la ficha "raíz" de cada arma. Oculta por
--    defecto (published = false) hasta que el admin la publica.
-- ---------------------------------------------------------
create table if not exists public.weapons (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  image_url    text,
  category_id  uuid references public.weapon_categories (id) on delete set null,
  type_id      uuid references public.weapon_types (id) on delete set null,
  published    boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists weapons_category_idx on public.weapons (category_id);
create index if not exists weapons_type_idx on public.weapons (type_id);
create index if not exists weapons_published_idx on public.weapons (published);

-- ---------------------------------------------------------
-- 4) weapon_ranks — niveles/rangos de un arma (MK1, MK2...).
--    Cantidad ilimitada, nombre libre, orden propio. Cada rango
--    trae TODO lo que cambia al subir de nivel:
--      stats            → [{label, value}], se muestra como
--                          barra (mismo lenguaje visual que
--                          ❤️Vida/⚔️Daño/🛡Armor de mobs/items).
--      abilities        → [{id, name, tag, description, level,
--                          level_max, stats:[{label, value}]}]
--      upgrade_recipe    → {materials:[{name, image_url, qty}],
--                          result:{name, image_url}} o null si
--                          este rango no mejora a nada más.
--      extra_sections    → [{id, title, kind: 'text'|'keyvalue',
--                          text, fields:[{key, value}]}] — para
--                          crecer a futuro (curiosidades, notas
--                          de balance, builds, etc.) sin migrar.
-- ---------------------------------------------------------
create table if not exists public.weapon_ranks (
  id              uuid primary key default gen_random_uuid(),
  weapon_id       uuid not null references public.weapons (id) on delete cascade,
  name            text not null,
  sort_order      integer not null default 0,
  description     text,
  image_url       text,
  stats           jsonb not null default '[]'::jsonb,
  abilities       jsonb not null default '[]'::jsonb,
  extra_sections  jsonb not null default '[]'::jsonb,
  upgrade_recipe  jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists weapon_ranks_weapon_idx on public.weapon_ranks (weapon_id);

-- ---------------------------------------------------------
-- 5) RLS — lectura pública en las 4 tablas (igual que el resto
--    del sitio: la visibilidad de armas no publicadas se filtra
--    en el frontend para admins, mismo patrón que comentarios
--    ocultos). Nada de insert/update/delete directo — todo pasa
--    por las funciones RPC admin-gated de abajo.
-- ---------------------------------------------------------
alter table public.weapon_categories enable row level security;
alter table public.weapon_types enable row level security;
alter table public.weapons enable row level security;
alter table public.weapon_ranks enable row level security;

drop policy if exists "weapon_categories_select_public" on public.weapon_categories;
create policy "weapon_categories_select_public" on public.weapon_categories for select to anon, authenticated using (true);

drop policy if exists "weapon_types_select_public" on public.weapon_types;
create policy "weapon_types_select_public" on public.weapon_types for select to anon, authenticated using (true);

drop policy if exists "weapons_select_public" on public.weapons;
create policy "weapons_select_public" on public.weapons for select to anon, authenticated using (true);

drop policy if exists "weapon_ranks_select_public" on public.weapon_ranks;
create policy "weapon_ranks_select_public" on public.weapon_ranks for select to anon, authenticated using (true);

-- =========================================================
-- 6) FUNCIONES RPC — categorías de arma
-- =========================================================
create or replace function public.create_weapon_category(
  input_code text,
  input_label text,
  input_color text default '#9a92b8'
)
returns public.weapon_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_categories;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_label), '') = '' then
    raise exception 'La categoría necesita un nombre';
  end if;

  select coalesce(max(sort_order) + 1, 0) into next_order from public.weapon_categories;

  insert into public.weapon_categories (label, color, sort_order)
  values (trim(input_label), coalesce(input_color, '#9a92b8'), next_order)
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_category_created', format('⚔️ Categoría de arma creada: "%s"', result.label));

  return result;
end;
$$;

grant execute on function public.create_weapon_category(text, text, text) to anon, authenticated;

create or replace function public.update_weapon_category(
  input_code text,
  input_id uuid,
  input_label text,
  input_color text
)
returns public.weapon_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_categories;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapon_categories
  set label = coalesce(trim(input_label), label),
      color = coalesce(input_color, color)
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_category_updated', format('⚔️ Categoría de arma editada: "%s"', result.label));

  return result;
end;
$$;

grant execute on function public.update_weapon_category(text, uuid, text, text) to anon, authenticated;

create or replace function public.delete_weapon_category(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  weapons_using_it integer;
  cat_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select count(*) into weapons_using_it from public.weapons where category_id = input_id;
  if weapons_using_it > 0 then
    raise exception 'No se puede borrar: % arma(s) usan esta categoría', weapons_using_it;
  end if;

  select label into cat_label from public.weapon_categories where id = input_id;
  delete from public.weapon_categories where id = input_id;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_category_deleted', format('⚔️ Categoría de arma eliminada: "%s"', coalesce(cat_label, '—')));
end;
$$;

grant execute on function public.delete_weapon_category(text, uuid) to anon, authenticated;

-- =========================================================
-- 7) FUNCIONES RPC — tipos de arma
-- =========================================================
create or replace function public.create_weapon_type(
  input_code text,
  input_label text
)
returns public.weapon_types
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_types;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_label), '') = '' then
    raise exception 'El tipo necesita un nombre';
  end if;

  select coalesce(max(sort_order) + 1, 0) into next_order from public.weapon_types;

  insert into public.weapon_types (label, sort_order)
  values (trim(input_label), next_order)
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_type_created', format('🏷 Tipo de arma creado: "%s"', result.label));

  return result;
end;
$$;

grant execute on function public.create_weapon_type(text, text) to anon, authenticated;

create or replace function public.update_weapon_type(
  input_code text,
  input_id uuid,
  input_label text
)
returns public.weapon_types
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_types;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapon_types
  set label = coalesce(trim(input_label), label)
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_type_updated', format('🏷 Tipo de arma editado: "%s"', result.label));

  return result;
end;
$$;

grant execute on function public.update_weapon_type(text, uuid, text) to anon, authenticated;

create or replace function public.delete_weapon_type(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  weapons_using_it integer;
  type_label text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select count(*) into weapons_using_it from public.weapons where type_id = input_id;
  if weapons_using_it > 0 then
    raise exception 'No se puede borrar: % arma(s) usan este tipo', weapons_using_it;
  end if;

  select label into type_label from public.weapon_types where id = input_id;
  delete from public.weapon_types where id = input_id;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_type_deleted', format('🏷 Tipo de arma eliminado: "%s"', coalesce(type_label, '—')));
end;
$$;

grant execute on function public.delete_weapon_type(text, uuid) to anon, authenticated;

-- =========================================================
-- 8) FUNCIONES RPC — armas
-- =========================================================

-- create_weapon: crea el arma (oculta) + su primer rango en un
-- solo paso, para que el admin pueda seguir editando de inmediato.
create or replace function public.create_weapon(
  input_code text,
  input_name text,
  input_image_url text,
  input_category_id uuid,
  input_type_id uuid,
  input_initial_rank_name text default 'MK1'
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  new_weapon public.weapons;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_name), '') = '' then
    raise exception 'El arma necesita un nombre';
  end if;

  insert into public.weapons (name, image_url, category_id, type_id, published)
  values (trim(input_name), nullif(trim(input_image_url), ''), input_category_id, input_type_id, false)
  returning * into new_weapon;

  insert into public.weapon_ranks (weapon_id, name, sort_order)
  values (new_weapon.id, coalesce(trim(input_initial_rank_name), 'MK1'), 0);

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_created', format('⚔️ Arma creada: "%s" (oculta hasta publicarla)', new_weapon.name));

  return new_weapon;
end;
$$;

grant execute on function public.create_weapon(text, text, text, uuid, uuid, text) to anon, authenticated;

create or replace function public.update_weapon(
  input_code text,
  input_id uuid,
  input_name text,
  input_image_url text,
  input_category_id uuid,
  input_type_id uuid
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapons;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapons
  set name = coalesce(trim(input_name), name),
      image_url = nullif(trim(input_image_url), ''),
      category_id = input_category_id,
      type_id = input_type_id,
      updated_at = now()
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'weapon_updated', format('⚔️ Arma editada: "%s"', result.name));

  return result;
end;
$$;

grant execute on function public.update_weapon(text, uuid, text, text, uuid, uuid) to anon, authenticated;

create or replace function public.set_weapon_published(
  input_code text,
  input_id uuid,
  input_published boolean
)
returns public.weapons
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapons;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.weapons
  set published = input_published, updated_at = now()
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values (
    'Admin',
    case when input_published then 'weapon_published' else 'weapon_unpublished' end,
    format('⚔️ Arma "%s" %s', result.name, case when input_published then 'publicada' else 'despublicada' end)
  );

  return result;
end;
$$;

grant execute on function public.set_weapon_published(text, uuid, boolean) to anon, authenticated;

create or replace function public.delete_weapon(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  weapon_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name into weapon_name from public.weapons where id = input_id;
  delete from public.weapons where id = input_id;

  if weapon_name is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'weapon_deleted', format('⚔️ Arma eliminada: "%s"', weapon_name));
  end if;
end;
$$;

grant execute on function public.delete_weapon(text, uuid) to anon, authenticated;

-- =========================================================
-- 9) FUNCIONES RPC — rangos de arma
-- =========================================================

-- upsert_weapon_rank: crea (input_id null) o edita un rango
-- completo de una sola vez (nombre, descripción, imagen, stats,
-- habilidades, receta de mejora, secciones extra).
create or replace function public.upsert_weapon_rank(
  input_code text,
  input_id uuid,
  input_weapon_id uuid,
  input_name text,
  input_description text default null,
  input_image_url text default null,
  input_stats jsonb default '[]'::jsonb,
  input_abilities jsonb default '[]'::jsonb,
  input_extra_sections jsonb default '[]'::jsonb,
  input_upgrade_recipe jsonb default null
)
returns public.weapon_ranks
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.weapon_ranks;
  next_order integer;
  weapon_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if coalesce(trim(input_name), '') = '' then
    raise exception 'El rango necesita un nombre';
  end if;

  select name into weapon_name from public.weapons where id = input_weapon_id;

  if input_id is null then
    select coalesce(max(sort_order) + 1, 0) into next_order
    from public.weapon_ranks where weapon_id = input_weapon_id;

    insert into public.weapon_ranks (
      weapon_id, name, sort_order, description, image_url, stats, abilities, extra_sections, upgrade_recipe
    )
    values (
      input_weapon_id, trim(input_name), next_order,
      nullif(trim(input_description), ''), nullif(trim(input_image_url), ''),
      coalesce(input_stats, '[]'::jsonb), coalesce(input_abilities, '[]'::jsonb),
      coalesce(input_extra_sections, '[]'::jsonb), input_upgrade_recipe
    )
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'weapon_rank_created', format('📈 Rango "%s" agregado a "%s"', result.name, coalesce(weapon_name, '—')));
  else
    update public.weapon_ranks
    set name = trim(input_name),
        description = nullif(trim(input_description), ''),
        image_url = nullif(trim(input_image_url), ''),
        stats = coalesce(input_stats, '[]'::jsonb),
        abilities = coalesce(input_abilities, '[]'::jsonb),
        extra_sections = coalesce(input_extra_sections, '[]'::jsonb),
        upgrade_recipe = input_upgrade_recipe
    where id = input_id
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'weapon_rank_updated', format('📈 Rango "%s" editado en "%s"', result.name, coalesce(weapon_name, '—')));
  end if;

  return result;
end;
$$;

grant execute on function public.upsert_weapon_rank(text, uuid, uuid, text, text, text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

create or replace function public.delete_weapon_rank(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  rank_name text;
  weapon_name text;
  w_id uuid;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name, weapon_id into rank_name, w_id from public.weapon_ranks where id = input_id;
  select name into weapon_name from public.weapons where id = w_id;

  delete from public.weapon_ranks where id = input_id;

  if rank_name is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'weapon_rank_deleted', format('📈 Rango "%s" eliminado de "%s"', rank_name, coalesce(weapon_name, '—')));
  end if;
end;
$$;

grant execute on function public.delete_weapon_rank(text, uuid) to anon, authenticated;

-- reorder_weapon_ranks: reescribe sort_order de los rangos de
-- UN arma de una sola vez (igual patrón que reorder_tierlist_rows).
create or replace function public.reorder_weapon_ranks(
  input_code text,
  input_ordered_ids uuid[]
)
returns setof public.weapon_ranks
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  idx integer := 0;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  foreach rid in array input_ordered_ids
  loop
    update public.weapon_ranks set sort_order = idx where id = rid;
    idx := idx + 1;
  end loop;

  return query select * from public.weapon_ranks where id = any(input_ordered_ids) order by sort_order;
end;
$$;

grant execute on function public.reorder_weapon_ranks(text, uuid[]) to anon, authenticated;

-- =========================================================
-- 10) REALTIME — para que el catálogo se sincronice en vivo
-- entre pestañas/admins, igual que logs/comentarios/tierlist.
-- =========================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weapons') then
    alter publication supabase_realtime add table public.weapons;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weapon_ranks') then
    alter publication supabase_realtime add table public.weapon_ranks;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weapon_categories') then
    alter publication supabase_realtime add table public.weapon_categories;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weapon_types') then
    alter publication supabase_realtime add table public.weapon_types;
  end if;
end $$;

-- =========================================================
-- 11) SEMILLAS — tipos por defecto para que el filtro no nazca
-- vacío (el admin puede renombrarlos/borrarlos cuando quiera).
-- =========================================================
insert into public.weapon_types (label, sort_order)
select * from (values ('Arma', 0), ('Accesorio', 1)) as seed(label, sort_order)
where not exists (select 1 from public.weapon_types);

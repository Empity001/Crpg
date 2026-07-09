-- =========================================================
-- CULONES-RPG · Migracion 016
-- Kits recomendados
-- =========================================================
-- Ejecutar en Supabase Dashboard -> SQL Editor -> New query.
-- Requiere migration_005_action_log.sql aplicada.
--
-- Crea una pestaña nueva de kits con tres columnas fijas:
-- Arma, Accesorio y Sub-arma. La UI guarda los items del kit como
-- JSONB para mantener el sistema pequeño y facil de editar.
-- =========================================================

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
create policy "kits_select_public"
  on public.kits for select
  to anon, authenticated
  using (published = true);

create or replace function public.list_kits(input_code text default null)
returns setof public.kits
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_code is not null and public.validate_admin_code(input_code) then
    return query select * from public.kits order by sort_order, created_at;
  end if;

  return query select * from public.kits where published = true order by sort_order, created_at;
end;
$$;

grant execute on function public.list_kits(text) to anon, authenticated;

create or replace function public.normalize_kit_items(input_items jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  safe_items jsonb := coalesce(input_items, '{}'::jsonb);
begin
  return jsonb_build_object(
    'weapon', coalesce(safe_items->'weapon', '[]'::jsonb),
    'accessory', coalesce(safe_items->'accessory', '[]'::jsonb),
    'subweapon', coalesce(safe_items->'subweapon', '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_kit(
  input_code text,
  input_id uuid,
  input_name text,
  input_description text default null,
  input_published boolean default true,
  input_items jsonb default null
)
returns public.kits
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.kits;
  next_order integer;
  clean_name text := nullif(trim(input_name), '');
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Codigo de administrador invalido o expirado';
  end if;

  if clean_name is null then
    raise exception 'El kit necesita un nombre';
  end if;

  if input_id is null then
    select coalesce(max(sort_order) + 1, 0) into next_order from public.kits;

    insert into public.kits (name, description, published, items, sort_order, updated_at)
    values (
      clean_name,
      nullif(trim(coalesce(input_description, '')), ''),
      coalesce(input_published, true),
      public.normalize_kit_items(input_items),
      next_order,
      now()
    )
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_created', format('Se creo el kit recomendado "%s".', result.name));
  else
    update public.kits
    set name = clean_name,
        description = nullif(trim(coalesce(input_description, '')), ''),
        published = coalesce(input_published, published),
        items = public.normalize_kit_items(input_items),
        updated_at = now()
    where id = input_id
    returning * into result;

    if result.id is null then
      raise exception 'El kit ya no existe';
    end if;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_updated', format('Se edito el kit recomendado "%s".', result.name));
  end if;

  return result;
end;
$$;

grant execute on function public.upsert_kit(text, uuid, text, text, boolean, jsonb) to anon, authenticated;

create or replace function public.delete_kit(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  old_kit public.kits;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Codigo de administrador invalido o expirado';
  end if;

  select * into old_kit from public.kits where id = input_id;
  delete from public.kits where id = input_id;

  if old_kit.id is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'kit_deleted', format('Se elimino el kit recomendado "%s".', old_kit.name));
  end if;
end;
$$;

grant execute on function public.delete_kit(text, uuid) to anon, authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kits'
  ) then
    return;
  end if;
  alter publication supabase_realtime add table public.kits;
exception
  when undefined_object then
    null;
end $$;

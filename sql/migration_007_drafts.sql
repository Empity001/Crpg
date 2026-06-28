-- =========================================================
-- CULONES-RPG · Migración 007
-- Sistema de borradores (drafts): almacenamiento híbrido
-- localStorage + Supabase para administradores.
-- =========================================================
-- Ejecutar en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr sobre una base que ya tiene schema.sql +
-- migration_002 hasta migration_006 aplicados.
-- =========================================================

-- ---------------------------------------------------------
-- 1) TABLA: drafts
--    Almacena borradores de cualquier entidad administrable.
--    entity_type: 'log' | 'tierlist_item' | (futuras entidades)
--    entity_id:   uuid del registro existente (edición),
--                 o la cadena literal 'new' (creación nueva).
--    payload:     el contenido completo del borrador en JSONB.
--    El campo admin_code_hash guarda un hash SHA-256 del
--    código de admin para que cada admin solo vea sus propios
--    borradores sin exponer el código en claro.
-- ---------------------------------------------------------
create table if not exists public.drafts (
  id               uuid primary key default gen_random_uuid(),
  admin_code_hash  text not null,
  entity_type      text not null check (entity_type in ('log', 'tierlist_item')),
  entity_id        text not null,   -- uuid o 'new'
  payload          jsonb not null,
  saved_at         timestamptz not null default now(),
  -- Índice compuesto: el lookup más frecuente es
  -- (hash, entity_type, entity_id) → "¿existe borrador para X?"
  unique (admin_code_hash, entity_type, entity_id)
);

create index if not exists drafts_hash_type_idx
  on public.drafts (admin_code_hash, entity_type, entity_id);

-- ---------------------------------------------------------
-- 2) RLS: nadie puede tocar drafts directamente desde el
--    frontend. Todo pasa por las funciones RPC de abajo,
--    que validan el código de admin antes de hacer nada.
-- ---------------------------------------------------------
alter table public.drafts enable row level security;

drop policy if exists "drafts_no_direct_access" on public.drafts;
create policy "drafts_no_direct_access"
  on public.drafts for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------
-- 3) FUNCIÓN HELPER: hash_admin_code
--    SHA-256 del código. SECURITY DEFINER para que sea
--    opaco al frontend — nunca expone el texto del hash
--    directamente, solo lo usa internamente en las RPC.
-- ---------------------------------------------------------
create or replace function private_hash_admin_code(input_code text)
returns text
language sql
immutable
as $$
  select encode(digest(input_code, 'sha256'), 'hex');
$$;

-- ---------------------------------------------------------
-- 4) RPC: upsert_draft
--    Crea o actualiza el borrador de una entidad.
--    Valida el código de admin antes de guardar.
-- ---------------------------------------------------------
create or replace function public.upsert_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text,
  input_payload     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_hash text;
  result    jsonb;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  code_hash := private_hash_admin_code(input_code);

  insert into public.drafts (admin_code_hash, entity_type, entity_id, payload, saved_at)
  values (code_hash, input_entity_type, input_entity_id, input_payload, now())
  on conflict (admin_code_hash, entity_type, entity_id)
  do update set
    payload  = excluded.payload,
    saved_at = excluded.saved_at;

  select jsonb_build_object(
    'entity_type', entity_type,
    'entity_id',   entity_id,
    'saved_at',    saved_at
  )
  into result
  from public.drafts
  where admin_code_hash = code_hash
    and entity_type     = input_entity_type
    and entity_id       = input_entity_id;

  return result;
end;
$$;

-- ---------------------------------------------------------
-- 5) RPC: get_draft
--    Devuelve el payload del borrador si existe.
--    Devuelve null si no hay borrador para esa entidad.
-- ---------------------------------------------------------
create or replace function public.get_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  code_hash text;
  result    jsonb;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  code_hash := private_hash_admin_code(input_code);

  select jsonb_build_object(
    'payload',   payload,
    'saved_at',  saved_at,
    'entity_id', entity_id
  )
  into result
  from public.drafts
  where admin_code_hash = code_hash
    and entity_type     = input_entity_type
    and entity_id       = input_entity_id;

  return result; -- null si no hay borrador
end;
$$;

-- ---------------------------------------------------------
-- 6) RPC: delete_draft
--    Descarta el borrador de una entidad específica.
-- ---------------------------------------------------------
create or replace function public.delete_draft(
  input_code        text,
  input_entity_type text,
  input_entity_id   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  code_hash text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  code_hash := private_hash_admin_code(input_code);

  delete from public.drafts
  where admin_code_hash = code_hash
    and entity_type     = input_entity_type
    and entity_id       = input_entity_id;
end;
$$;

-- ---------------------------------------------------------
-- 7) RPC: list_drafts
--    Lista todos los borradores del admin actual (sin payload
--    completo — solo metadata para mostrar en un panel futuro).
-- ---------------------------------------------------------
create or replace function public.list_drafts(
  input_code text
)
returns table (
  entity_type text,
  entity_id   text,
  saved_at    timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  code_hash text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  code_hash := private_hash_admin_code(input_code);

  return query
  select d.entity_type, d.entity_id, d.saved_at
  from public.drafts d
  where d.admin_code_hash = code_hash
  order by d.saved_at desc;
end;
$$;

-- ---------------------------------------------------------
-- 8) Permisos de ejecución para las RPC
-- ---------------------------------------------------------
grant execute on function public.upsert_draft(text, text, text, jsonb)  to anon, authenticated;
grant execute on function public.get_draft(text, text, text)            to anon, authenticated;
grant execute on function public.delete_draft(text, text, text)         to anon, authenticated;
grant execute on function public.list_drafts(text)                      to anon, authenticated;

-- =========================================================
-- CULONES-RPG · Migración 004
-- Encantamientos/daño en items · descripción y "algo más" en
-- bloques (mob/item) · imagen de referencia por bloque ·
-- comentarios con likes, respuestas y moderación de admin ·
-- configuración de fichas (orden/activación de campos fijos)
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Seguro de correr sobre una base que ya tiene schema.sql +
-- migration_002 + migration_003 aplicados.
-- =========================================================

-- ---------------------------------------------------------
-- 1) NUEVAS COLUMNAS: log_mobs
--    (descripción opcional, "algo más" libre, imagen)
-- ---------------------------------------------------------
alter table public.log_mobs add column if not exists description text;
alter table public.log_mobs add column if not exists extra_fields jsonb not null default '[]'::jsonb;
alter table public.log_mobs add column if not exists image_url text;

-- ---------------------------------------------------------
-- 2) NUEVAS COLUMNAS: log_items
--    (daño, encantamientos, descripción, "algo más", imagen)
-- ---------------------------------------------------------
alter table public.log_items add column if not exists damage integer;
alter table public.log_items add column if not exists enchantments jsonb not null default '[]'::jsonb;
alter table public.log_items add column if not exists description text;
alter table public.log_items add column if not exists extra_fields jsonb not null default '[]'::jsonb;
alter table public.log_items add column if not exists image_url text;

-- ---------------------------------------------------------
-- 3) COMENTARIOS: likes, respuestas (1 nivel), moderación
-- ---------------------------------------------------------
alter table public.comments add column if not exists likes integer not null default 0;
alter table public.comments add column if not exists parent_id uuid references public.comments (id) on delete cascade;
alter table public.comments add column if not exists hidden boolean not null default false;

create index if not exists comments_parent_id_idx on public.comments (parent_id);

-- Tabla de likes de comentarios (mismo patrón anti-duplicado que log_likes)
create table if not exists public.comment_likes (
  comment_id uuid not null references public.comments (id) on delete cascade,
  client_id  text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, client_id)
);

alter table public.comment_likes enable row level security;

drop policy if exists "comment_likes_select_public" on public.comment_likes;
create policy "comment_likes_select_public"
  on public.comment_likes for select
  to anon, authenticated
  using (true);

drop policy if exists "comment_likes_insert_public" on public.comment_likes;
create policy "comment_likes_insert_public"
  on public.comment_likes for insert
  to anon, authenticated
  with check (true);

-- ---------------------------------------------------------
-- 4) AJUSTES GENERALES (app_settings)
--    Guarda config de fichas (orden/activación de campos) y
--    cualquier otra preferencia futura de la web. Lectura
--    pública, escritura SOLO vía RPC con código de admin.
-- ---------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "app_settings_select_public" on public.app_settings;
create policy "app_settings_select_public"
  on public.app_settings for select
  to anon, authenticated
  using (true);

drop policy if exists "app_settings_no_direct_write" on public.app_settings;
create policy "app_settings_no_direct_write"
  on public.app_settings for all
  to anon, authenticated
  using (false)
  with check (false);

-- Semillas: configuración por defecto de campos fijos de fichas.
-- Cada campo: { key, label, enabled }. El orden del array ES el
-- orden de aparición. Admin puede reordenar/activar/desactivar
-- desde la web ("Configurar fichas"); los campos personalizados
-- ("algo más") siempre se muestran al final, aparte de esto.
insert into public.app_settings (key, value) values
  ('mob_fields', '[
    {"key":"health",    "label":"❤️ Vida",     "enabled": true},
    {"key":"damage",    "label":"⚔️ Daño",      "enabled": true},
    {"key":"armor",     "label":"🛡 Armor",     "enabled": true},
    {"key":"equipment", "label":"Equipamiento", "enabled": true},
    {"key":"location",  "label":"Dónde aparece","enabled": true}
  ]'::jsonb),
  ('item_fields', '[
    {"key":"tier",          "label":"Rango/Tier",       "enabled": true},
    {"key":"item_type",     "label":"Tipo",              "enabled": true},
    {"key":"damage",        "label":"⚔️ Daño",           "enabled": true},
    {"key":"enchantments",  "label":"Encantamientos",    "enabled": true},
    {"key":"obtained_from", "label":"Dónde se obtiene",  "enabled": true}
  ]'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- update_app_setting: admin-gated upsert de una clave de config
-- ---------------------------------------------------------
create or replace function public.update_app_setting(
  input_code text,
  input_key text,
  input_value jsonb
)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.app_settings;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  insert into public.app_settings (key, value, updated_at)
  values (input_key, input_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.update_app_setting(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------
-- like_comment: da o quita like a un comentario (idempotente,
-- mismo patrón que toggle_like para logs).
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- delete_comment: borra un comentario (y sus respuestas, por
-- el ON DELETE CASCADE de parent_id) SOLO si el código es válido.
-- ---------------------------------------------------------
create or replace function public.delete_comment(
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

  delete from public.comments where id = input_id;
end;
$$;

grant execute on function public.delete_comment(text, uuid) to anon, authenticated;

-- ---------------------------------------------------------
-- set_comment_hidden: oculta/muestra un comentario (admin).
-- Se mantiene en la tabla (no se borra) para poder reactivarlo.
-- ---------------------------------------------------------
create or replace function public.set_comment_hidden(
  input_code text,
  input_id uuid,
  input_hidden boolean
)
returns public.comments
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.comments;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.comments set hidden = input_hidden
  where id = input_id
  returning * into result;

  return result;
end;
$$;

grant execute on function public.set_comment_hidden(text, uuid, boolean) to anon, authenticated;

-- =========================================================
-- 5) create_log / update_log: ahora los objetos de input_mobs
--    e input_items pueden traer description, extra_fields,
--    image_url, y (los items) damage/enchantments.
-- =========================================================

drop function if exists public.create_log(text, text, text, text, text, timestamptz, jsonb, jsonb);

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

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, description, extra_fields, image_url, sort_order)
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url, sort_order)
  select
    new_log.id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    nullif(elem->>'damage', '')::integer,
    coalesce(elem->'enchantments', '[]'::jsonb),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  return new_log;
end;
$$;

grant execute on function public.create_log(text, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

drop function if exists public.update_log(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb);

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

  delete from public.log_mobs where log_id = input_id;
  delete from public.log_items where log_id = input_id;

  insert into public.log_mobs (log_id, name, health, damage, armor, equipment, location, description, extra_fields, image_url, sort_order)
  select
    input_id,
    trim(elem->>'name'),
    nullif(elem->>'health', '')::integer,
    nullif(elem->>'damage', '')::integer,
    nullif(elem->>'armor', '')::integer,
    nullif(trim(elem->>'equipment'), ''),
    nullif(trim(elem->>'location'), ''),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_mobs, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  insert into public.log_items (log_id, name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url, sort_order)
  select
    input_id,
    trim(elem->>'name'),
    nullif(trim(elem->>'tier'), ''),
    nullif(trim(elem->>'item_type'), ''),
    nullif(trim(elem->>'obtained_from'), ''),
    nullif(elem->>'damage', '')::integer,
    coalesce(elem->'enchantments', '[]'::jsonb),
    nullif(trim(elem->>'description'), ''),
    coalesce(elem->'extra_fields', '[]'::jsonb),
    nullif(trim(elem->>'image_url'), ''),
    (idx - 1)::integer
  from jsonb_array_elements(coalesce(input_items, '[]'::jsonb)) with ordinality as t(elem, idx)
  where coalesce(trim(elem->>'name'), '') <> '';

  return updated_log;
end;
$$;

grant execute on function public.update_log(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb) to anon, authenticated;

-- =========================================================
-- REALTIME: que los comentarios también se sincronicen en
-- vivo (likes, respuestas, ocultar) entre pestañas/admins.
-- =========================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'comments'
  ) then
    alter publication supabase_realtime add table public.comments;
  end if;
end $$;

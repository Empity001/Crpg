create extension if not exists "pgcrypto";

create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text not null,
  category    text not null default 'other',
  relevance   text not null default 'normal',
  likes       integer not null default 0,
  cover_image_url text,
  created_at  timestamptz not null default now()
);

create index if not exists logs_created_at_idx on public.logs (created_at desc);
create index if not exists logs_category_idx on public.logs (category);

create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references public.logs (id) on delete cascade,
  username   text not null default 'Anónimo',
  comment    text not null,
  created_at timestamptz not null default now()
);

create index if not exists comments_log_id_idx on public.comments (log_id);

create table if not exists public.admin_codes (
  code       text primary key,
  expires_at timestamptz not null,
  created_by text not null
);

create table if not exists public.log_likes (
  log_id     uuid not null references public.logs (id) on delete cascade,
  client_id  text not null,
  created_at timestamptz not null default now(),
  primary key (log_id, client_id)
);

alter table public.logs enable row level security;
alter table public.comments enable row level security;
alter table public.admin_codes enable row level security;
alter table public.log_likes enable row level security;

drop policy if exists "logs_select_public" on public.logs;
create policy "logs_select_public"
  on public.logs for select
  to anon, authenticated
  using (true);

drop policy if exists "comments_select_public" on public.comments;
create policy "comments_select_public"
  on public.comments for select
  to anon, authenticated
  using (true);

drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public"
  on public.comments for insert
  to anon, authenticated
  with check (
    char_length(comment) > 0 and char_length(comment) <= 500
    and char_length(username) <= 40
  );

drop policy if exists "admin_codes_no_access" on public.admin_codes;
create policy "admin_codes_no_access"
  on public.admin_codes for all
  to anon, authenticated
  using (false)
  with check (false);

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

grant execute on function public.validate_admin_code(text) to anon, authenticated;
grant execute on function public.create_log(text, text, text, text, text) to anon, authenticated;
grant execute on function public.update_log(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_log(text, uuid) to anon, authenticated;
grant execute on function public.toggle_like(uuid, text) to anon, authenticated;

alter publication supabase_realtime add table public.logs;

create table if not exists public.categories (
  slug        text primary key,
  label       text not null,
  emoji       text not null default '📦',
  color       text not null default '#4dd4e8',
  created_at  timestamptz not null default now()
);

alter table public.categories enable row level security;

drop policy if exists "categories_select_public" on public.categories;
create policy "categories_select_public"
  on public.categories for select
  to anon, authenticated
  using (true);

insert into public.categories (slug, label, emoji, color) values
  ('item',     'Item',      '🗡', '#f3b73a'),
  ('mob',      'Mob',       '👾', '#ff3d8e'),
  ('mechanic', 'Mecánica',  '⚙',  '#4dd4e8'),
  ('event',    'Evento',    '🎉', '#38e07a'),
  ('other',    'Otro',      '📦', '#9a92b8')
on conflict (slug) do nothing;

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

create table if not exists public.log_mobs (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.logs (id) on delete cascade,
  name        text not null,
  health      integer,
  damage      integer,
  armor       integer,
  equipment   text,
  location    text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists log_mobs_log_id_idx on public.log_mobs (log_id);

create table if not exists public.log_items (
  id             uuid primary key default gen_random_uuid(),
  log_id         uuid not null references public.logs (id) on delete cascade,
  name           text not null,
  tier           text,
  item_type      text,
  obtained_from  text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists log_items_log_id_idx on public.log_items (log_id);

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

alter publication supabase_realtime add table public.log_mobs;
alter publication supabase_realtime add table public.log_items;

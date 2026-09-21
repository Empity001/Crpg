create table if not exists public.tierlist_rows (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  color       text not null default '#9a92b8',
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

create index if not exists tierlist_rows_sort_idx on public.tierlist_rows (sort_order);

create table if not exists public.tierlist_items (
  id           uuid primary key default gen_random_uuid(),
  row_id       uuid references public.tierlist_rows (id) on delete set null,
  column_key   text not null check (column_key in ('weapon', 'subweapon', 'accessory')),
  name         text not null,
  image_url    text,
  extra_fields jsonb not null default '[]'::jsonb,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists tierlist_items_row_id_idx on public.tierlist_items (row_id);
create index if not exists tierlist_items_column_key_idx on public.tierlist_items (column_key);

alter table public.tierlist_rows enable row level security;
alter table public.tierlist_items enable row level security;

drop policy if exists "tierlist_rows_select_public" on public.tierlist_rows;
create policy "tierlist_rows_select_public"
  on public.tierlist_rows for select
  to anon, authenticated
  using (true);

drop policy if exists "tierlist_items_select_public" on public.tierlist_items;
create policy "tierlist_items_select_public"
  on public.tierlist_items for select
  to anon, authenticated
  using (true);

create or replace function public.create_tierlist_row(
  input_code text,
  input_name text,
  input_color text default '#9a92b8'
)
returns public.tierlist_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  new_row public.tierlist_rows;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select coalesce(max(sort_order) + 1, 0) into next_order from public.tierlist_rows;

  insert into public.tierlist_rows (name, color, sort_order)
  values (coalesce(trim(input_name), 'Nueva fila'), coalesce(input_color, '#9a92b8'), next_order)
  returning * into new_row;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'tierlist_row_created', format('🏆 Fila de tierlist creada: "%s"', new_row.name));

  return new_row;
end;
$$;

grant execute on function public.create_tierlist_row(text, text, text) to anon, authenticated;

create or replace function public.update_tierlist_row(
  input_code text,
  input_id uuid,
  input_name text,
  input_color text
)
returns public.tierlist_rows
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tierlist_rows;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  update public.tierlist_rows
  set name = coalesce(trim(input_name), name),
      color = coalesce(input_color, color)
  where id = input_id
  returning * into result;

  insert into public.action_log (actor, action, description)
  values ('Admin', 'tierlist_row_updated', format('🏆 Fila de tierlist editada: "%s"', result.name));

  return result;
end;
$$;

grant execute on function public.update_tierlist_row(text, uuid, text, text) to anon, authenticated;

create or replace function public.delete_tierlist_row(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  row_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name into row_name from public.tierlist_rows where id = input_id;

  delete from public.tierlist_rows where id = input_id;

  if row_name is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'tierlist_row_deleted', format('🏆 Fila de tierlist eliminada: "%s" (sus elementos volvieron a "Sin clasificar")', row_name));
  end if;
end;
$$;

grant execute on function public.delete_tierlist_row(text, uuid) to anon, authenticated;

create or replace function public.reorder_tierlist_rows(
  input_code text,
  input_ordered_ids uuid[]
)
returns setof public.tierlist_rows
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
    update public.tierlist_rows set sort_order = idx where id = rid;
    idx := idx + 1;
  end loop;

  return query select * from public.tierlist_rows order by sort_order;
end;
$$;

grant execute on function public.reorder_tierlist_rows(text, uuid[]) to anon, authenticated;

create or replace function public.upsert_tierlist_item(
  input_code text,
  input_id uuid,
  input_name text,
  input_image_url text,
  input_column_key text,
  input_row_id uuid default null,
  input_extra_fields jsonb default '[]'::jsonb
)
returns public.tierlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tierlist_items;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if input_column_key not in ('weapon', 'subweapon', 'accessory') then
    raise exception 'Columna inválida: %', input_column_key;
  end if;

  if input_id is null then
    select coalesce(max(sort_order) + 1, 0) into next_order
    from public.tierlist_items
    where column_key = input_column_key
      and coalesce(row_id::text, 'bench') = coalesce(input_row_id::text, 'bench');

    insert into public.tierlist_items (row_id, column_key, name, image_url, extra_fields, sort_order)
    values (
      input_row_id,
      input_column_key,
      trim(input_name),
      nullif(trim(input_image_url), ''),
      coalesce(input_extra_fields, '[]'::jsonb),
      next_order
    )
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'tierlist_item_created', format('🎴 Elemento de tierlist creado: "%s"', result.name));
  else
    update public.tierlist_items
    set name = trim(input_name),
        image_url = nullif(trim(input_image_url), ''),
        extra_fields = coalesce(input_extra_fields, extra_fields)
    where id = input_id
    returning * into result;

    insert into public.action_log (actor, action, description)
    values ('Admin', 'tierlist_item_updated', format('🎴 Elemento de tierlist editado: "%s"', result.name));
  end if;

  return result;
end;
$$;

grant execute on function public.upsert_tierlist_item(text, uuid, text, text, text, uuid, jsonb) to anon, authenticated;

create or replace function public.move_tierlist_item(
  input_code text,
  input_item_id uuid,
  input_row_id uuid,
  input_column_key text,
  input_sort_order integer default null
)
returns public.tierlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.tierlist_items;
  next_order integer;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  if input_column_key not in ('weapon', 'subweapon', 'accessory') then
    raise exception 'Columna inválida: %', input_column_key;
  end if;

  if input_sort_order is null then
    select coalesce(max(sort_order) + 1, 0) into next_order
    from public.tierlist_items
    where column_key = input_column_key
      and coalesce(row_id::text, 'bench') = coalesce(input_row_id::text, 'bench');
  else
    next_order := input_sort_order;
  end if;

  update public.tierlist_items
  set row_id = input_row_id,
      column_key = input_column_key,
      sort_order = next_order
  where id = input_item_id
  returning * into result;

  return result;
end;
$$;

grant execute on function public.move_tierlist_item(text, uuid, uuid, text, integer) to anon, authenticated;

create or replace function public.reorder_tierlist_items(
  input_code text,
  input_ordered_ids uuid[]
)
returns setof public.tierlist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  iid uuid;
  idx integer := 0;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  foreach iid in array input_ordered_ids
  loop
    update public.tierlist_items set sort_order = idx where id = iid;
    idx := idx + 1;
  end loop;

  return query select * from public.tierlist_items where id = any(input_ordered_ids);
end;
$$;

grant execute on function public.reorder_tierlist_items(text, uuid[]) to anon, authenticated;

create or replace function public.delete_tierlist_item(
  input_code text,
  input_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
begin
  if not public.validate_admin_code(input_code) then
    raise exception 'Código de administrador inválido o expirado';
  end if;

  select name into item_name from public.tierlist_items where id = input_id;

  delete from public.tierlist_items where id = input_id;

  if item_name is not null then
    insert into public.action_log (actor, action, description)
    values ('Admin', 'tierlist_item_deleted', format('🎴 Elemento de tierlist eliminado: "%s"', item_name));
  end if;
end;
$$;

grant execute on function public.delete_tierlist_item(text, uuid) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tierlist_rows'
  ) then
    alter publication supabase_realtime add table public.tierlist_rows;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tierlist_items'
  ) then
    alter publication supabase_realtime add table public.tierlist_items;
  end if;
end $$;

insert into public.tierlist_rows (name, color, sort_order)
select * from (values
  ('SSS', '#ff3d8e', 0),
  ('S',   '#f3b73a', 1),
  ('A',   '#4dd4e8', 2)
) as seed(name, color, sort_order)
where not exists (select 1 from public.tierlist_rows);

create table if not exists public.drafts (
  id               uuid primary key default gen_random_uuid(),
  admin_code_hash  text not null,
  entity_type      text not null check (entity_type in ('log', 'tierlist_item')),
  entity_id        text not null,
  payload          jsonb not null,
  saved_at         timestamptz not null default now(),
  unique (admin_code_hash, entity_type, entity_id)
);

create index if not exists drafts_hash_type_idx
  on public.drafts (admin_code_hash, entity_type, entity_id);

alter table public.drafts enable row level security;

drop policy if exists "drafts_no_direct_access" on public.drafts;
create policy "drafts_no_direct_access"
  on public.drafts for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function private_hash_admin_code(input_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(digest(input_code, 'sha256'), 'hex');
$$;

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
  do update set payload = excluded.payload, saved_at = excluded.saved_at;

  select jsonb_build_object('entity_type', entity_type, 'entity_id', entity_id, 'saved_at', saved_at)
  into result
  from public.drafts
  where admin_code_hash = code_hash
    and entity_type     = input_entity_type
    and entity_id       = input_entity_id;

  return result;
end;
$$;

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

  select jsonb_build_object('payload', payload, 'saved_at', saved_at, 'entity_id', entity_id)
  into result
  from public.drafts
  where admin_code_hash = code_hash
    and entity_type     = input_entity_type
    and entity_id       = input_entity_id;

  return result;
end;
$$;

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

grant execute on function public.upsert_draft(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_draft(text, text, text)           to anon, authenticated;
grant execute on function public.delete_draft(text, text, text)        to anon, authenticated;
grant execute on function public.list_drafts(text)                     to anon, authenticated;

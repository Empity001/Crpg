-- =========================================================
-- CULONES-RPG · Migración 024
-- Índices para relaciones, auditoría y lecturas ordenadas.
-- =========================================================
-- Ejecutar una sola vez desde el SQL Editor de Supabase después de 023.
-- Todos los índices usan IF NOT EXISTS, por lo que es seguro repetirla.
-- =========================================================

-- La Edge Function comprueba si una RPC ya dejó auditoría buscando el
-- request_id guardado en metadata. Sin este índice, cada escritura termina
-- recorriendo action_log a medida que crece.
create index if not exists action_log_request_id_idx
  on public.action_log ((metadata ->> 'request_id'))
  where metadata ? 'request_id';

-- Las conexiones inversas de Guías usan el operador JSONB @> sobre
-- extra_fields. jsonb_path_ops mantiene índices más pequeños para ese uso.
create index if not exists log_mobs_extra_fields_gin_idx
  on public.log_mobs using gin (extra_fields jsonb_path_ops);

create index if not exists log_items_extra_fields_gin_idx
  on public.log_items using gin (extra_fields jsonb_path_ops);

create index if not exists tierlist_items_extra_fields_gin_idx
  on public.tierlist_items using gin (extra_fields jsonb_path_ops);

-- Índices compuestos para las lecturas habituales ya ordenadas por sección.
create index if not exists log_mobs_log_sort_idx
  on public.log_mobs (log_id, sort_order);

create index if not exists log_items_log_sort_idx
  on public.log_items (log_id, sort_order);

create index if not exists weapon_ranks_weapon_sort_idx
  on public.weapon_ranks (weapon_id, sort_order);

create index if not exists tierlist_items_row_column_sort_idx
  on public.tierlist_items (row_id, column_key, sort_order);

create index if not exists comments_log_created_idx
  on public.comments (log_id, created_at);

-- Resumen público de Logs. Sustituye la descarga de una fila por cada mob e
-- ítem únicamente para contar tarjetas. SECURITY INVOKER conserva las RLS de
-- logs/log_mobs/log_items, incluidos los Logs despublicados.
create or replace function public.list_public_logs_with_counts()
returns table (
  id uuid,
  title text,
  description text,
  category text,
  relevance text,
  likes integer,
  created_at timestamptz,
  cover_image_url text,
  published boolean,
  mob_count bigint,
  item_count bigint,
  extra_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    l.id,
    l.title,
    l.description,
    l.category,
    l.relevance,
    l.likes,
    l.created_at,
    l.cover_image_url,
    l.published,
    coalesce(m.mob_count, 0),
    coalesce(i.item_count, 0),
    coalesce(i.extra_count, 0)
  from public.logs l
  left join (
    select log_id, count(*)::bigint as mob_count
    from public.log_mobs
    group by log_id
  ) m on m.log_id = l.id
  left join (
    select
      log_id,
      count(*) filter (where item_type is distinct from '_libre')::bigint as item_count,
      count(*) filter (where item_type = '_libre')::bigint as extra_count
    from public.log_items
    group by log_id
  ) i on i.log_id = l.id
  order by l.created_at desc;
$$;

revoke all on function public.list_public_logs_with_counts() from public;
grant execute on function public.list_public_logs_with_counts() to anon, authenticated;

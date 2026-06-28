-- ============================================================
-- CULONES RPG · Esquema de base de datos (Supabase / Postgres)
-- Ejecutar esto en: Supabase Dashboard > SQL Editor > New query
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- LOGS ----------
create table if not exists public.logs (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,                         -- ej: "1.2.4: FELIZ CUMPLEAÑOS"
  version      text,                                   -- ej: "1.2.4"
  category     text not null,                          -- item | mob | mecanica | evento | npc | casino | forja | otro
  tags         text[] not null default '{}',           -- etiquetas libres
  relevance    text not null default 'media',           -- baja | media | alta | critica
  description  text,                                    -- texto libre / resumen
  content      jsonb not null default '[]'::jsonb,      -- specs estructuradas: [{seccion, items:[{clave,valor}]}]
  created_by   text not null default 'admin',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_logs_created_at on public.logs (created_at desc);
create index if not exists idx_logs_category   on public.logs (category);
create index if not exists idx_logs_relevance  on public.logs (relevance);

-- ---------- COMENTARIOS / RESEÑAS ----------
create table if not exists public.log_comments (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.logs(id) on delete cascade,
  author_name text not null default 'Anónimo',
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists idx_comments_log on public.log_comments (log_id);

-- ---------- LIKES ----------
create table if not exists public.log_likes (
  id         uuid primary key default gen_random_uuid(),
  log_id     uuid not null references public.logs(id) on delete cascade,
  voter_id   text not null,             -- id aleatorio generado en el navegador del visitante (localStorage)
  created_at timestamptz not null default now(),
  unique (log_id, voter_id)
);

-- ---------- CÓDIGOS DE ADMIN (rotan cada 24h, los maneja el bot) ----------
create table if not exists public.admin_codes (
  id         uuid primary key default gen_random_uuid(),
  code_hash  text not null,             -- sha256 del código, nunca se guarda en texto plano
  active     boolean not null default true,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------- SESIONES DE ADMIN (las crea la función admin-login) ----------
create table if not exists public.admin_sessions (
  token      text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------- CONFIG DEL BOT (canal de notificaciones, etc) ----------
create table if not exists public.bot_config (
  key   text primary key,
  value text
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.logs           enable row level security;
alter table public.log_comments   enable row level security;
alter table public.log_likes      enable row level security;
alter table public.admin_codes    enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.bot_config     enable row level security;

-- Cualquiera puede LEER los logs (la página es pública)
create policy "logs_select_public" on public.logs
  for select using (true);

-- Nadie puede insertar/editar logs directamente desde el navegador.
-- Eso SOLO pasa a través de las Edge Functions (admin-login / admin-write),
-- que usan la service_role key y por lo tanto se saltan estas políticas.
-- (No se crea policy de insert/update/delete para "anon" -> queda bloqueado)

-- Comentarios: cualquiera puede leer y comentar (no hace falta cuenta)
create policy "comments_select_public" on public.log_comments
  for select using (true);
create policy "comments_insert_public" on public.log_comments
  for insert with check (char_length(content) > 0 and char_length(content) < 1000);

-- Likes: cualquiera puede leer y dar like (1 por log por visitante, controlado por el unique)
create policy "likes_select_public" on public.log_likes
  for select using (true);
create policy "likes_insert_public" on public.log_likes
  for insert with check (true);

-- admin_codes, admin_sessions, bot_config: NO son accesibles desde el navegador (ni lectura).
-- Solo el bot y las Edge Functions los tocan con la service_role key.
-- (No se crean policies -> con RLS activado y sin policies, "anon" no puede ni leer ni escribir)

-- ============================================================
-- REALTIME: para que el bot de Discord se entere de logs nuevos
-- ============================================================
alter publication supabase_realtime add table public.logs;

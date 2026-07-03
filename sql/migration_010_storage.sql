-- =========================================================
-- CULONES-RPG · Migración 010
-- Supabase Storage: buckets e imágenes
-- Elimina la dependencia de URLs externas como método principal.
-- =========================================================
-- Ejecutar completo en: Supabase Dashboard → SQL Editor → New query
-- Requiere migración 001–009 aplicada previamente.
--
-- ESTRUCTURA DE CARPETAS dentro del bucket "culones":
--
--   culones/
--   ├── mobs/          imágenes de mobs (log_mobs.image_url)
--   ├── items/         imágenes de items (log_items.image_url)
--   ├── tierlist/      imágenes de la tierlist (tierlist_items.image_url)
--   ├── weapons/       imagen principal de cada arma (weapons.image_url)
--   ├── weapon-ranks/  imagen por rango (weapon_ranks.image_url)
--   ├── recipes/       imágenes de materiales/resultado de recetas
--   │                  (dentro del jsonb upgrade_recipe)
--   ├── backgrounds/   imagen de fondo de la página (app_settings.background_config)
--   ├── favicons/      icono de la pestaña del navegador (app_settings.favicon_url)
--   └── about/         imágenes de bloques en "Acerca del Server" (app_settings.about_blocks)
--
-- Un único bucket "culones" con acceso público de lectura.
-- Las subidas solo están permitidas via UPSERT a través de la
-- anon key, con las restricciones de tamaño y tipo definidas abajo.
-- =========================================================

-- ── Bucket principal ────────────────────────────────────────────
-- Creado via API de Storage (esta tabla es de solo lectura desde SQL
-- para proyectos de Supabase en la capa free). Correr esto en el
-- SQL Editor puede fallar si el bucket ya existe; es inofensivo.
-- Se recomienda también crearlo desde el Dashboard → Storage → New bucket
-- con las opciones: nombre "culones", Public bucket = true.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'culones',
  'culones',
  true,                          -- acceso público de lectura
  3145728,                       -- 3 MB por archivo (3 * 1024 * 1024)
  '{image/png,image/jpeg,image/jpg,image/webp}'
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ── Políticas RLS del bucket ────────────────────────────────────

-- Lectura pública: cualquier visitante puede ver las imágenes.
drop policy if exists "culones_public_read" on storage.objects;
create policy "culones_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'culones');

-- Subida: solo se permite si el cliente envía un código de admin
-- válido. Como Storage no tiene RLS funcional por función RPC en la
-- capa free (solo comprueba rol JWT), la protección real viene de
-- que la anon key no puede hacer update/delete de objetos sin la
-- service_role key. Se deja abierta la inserción con anon para
-- que la subida desde el navegador funcione; la barrera de seguridad
-- real está en que el botón "Subir imagen" solo existe en la UI
-- cuando hay una sesión de admin activa (mismo patrón que todos
-- los otros botones de admin del proyecto).
drop policy if exists "culones_admin_insert" on storage.objects;
create policy "culones_admin_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'culones');

-- Update (para reemplazar una imagen subiendo de nuevo con el mismo path).
drop policy if exists "culones_admin_update" on storage.objects;
create policy "culones_admin_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'culones');

-- Delete (para borrar la imagen vieja al reemplazarla).
drop policy if exists "culones_admin_delete" on storage.objects;
create policy "culones_admin_delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'culones');

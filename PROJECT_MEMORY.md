# PROJECT_MEMORY — culones-rpg

Registro de sesiones de desarrollo. Cada entrada resume qué se hizo, qué quedó pendiente y qué problemas se conocen. Pensado para que cualquier sesión futura pueda retomar el proyecto sin releer todo el código.

---

# Estado actual del proyecto (tras sesión 17)

## Arquitectura general

- **Web**: sitio estático HTML/CSS/JS vanilla. Sin backend propio. Desplegado en GitHub Pages.
- **Base de datos**: Supabase (Postgres). Toda la lógica sensible protegida por RLS + funciones RPC con `security definer` que validan el código de admin antes de actuar.
- **Imágenes**: Supabase Storage, bucket `culones` (público de lectura). La subida va siempre por `uploadImageToStorage()` en el frontend — nunca por URL externa (opción eliminada en sesión 17).
- **Bot de Discord**: Node.js + discord.js, desplegado en Railway. Se conecta a Supabase directamente con `service_role`.
- **Autenticación de admin**: código de 8 caracteres generado por el bot cada 24h, guardado en la tabla `admin_codes` con fecha de expiración. No hay login real de Supabase Auth.

---

## Pestañas de la web

| Tab | `data-tab` | Visible para |
|---|---|---|
| 📜 Logs | `logs` | Todos |
| ⚔️ Guía de Armas | `weapons` | Todos |
| 🏆 Tierlist | `tierlist` | Todos |
| 🎮 Acerca del Server | `about` | Todos |
| 🛠 Herramientas | `admin` | Solo admin (hidden por CSS, visible al iniciar sesión) |

---

## Tablas en Supabase

| Tabla | Descripción | Migración |
|---|---|---|
| `logs` | Logs principales del servidor | schema.sql |
| `comments` | Comentarios por log (con `parent_id` para respuestas, `hidden` para moderación) | schema.sql |
| `admin_codes` | Códigos temporales de admin (generados por el bot) | schema.sql |
| `log_likes` | Un registro por (log_id, client_id) para evitar likes duplicados | schema.sql |
| `categories` | Categorías dinámicas de logs (slug, label, emoji, color) | 002 |
| `log_mobs` | Fichas de mobs adjuntas a un log (vida, daño, armor, equipamiento) | 003 |
| `log_items` | Fichas de items adjuntas a un log (nombre, rango, tipo, fuente) | 003 |
| `comment_likes` | Likes de comentarios (con RPC admin para moderar) | 004 |
| `app_settings` | Configuración de la app (campos de fichas de mob/item, etc.) | 004 |
| `action_log` | Bitácora de acciones de admin (solo inserción, lectura admin-gated) | 005 |
| `tierlist_rows` | Filas de la tierlist (nombre, color, sort_order) | 006 |
| `tierlist_items` | Elementos de la tierlist (row_id nullable=banco, column_key, image_url) | 006 |
| `drafts` | Borradores guardados en Supabase (actualmente no se usa — ver nota abajo) | 007 |
| `weapon_categories` | Categorías de armas (label, color) | 008 |
| `weapon_types` | Tipos de armas (label) | 008 |
| `weapons` | Armas (name, image_url, published, category_id, type_id) | 008 |
| `weapon_ranks` | Rangos por arma (name, description, image_url, stats jsonb, abilities jsonb, upgrade_recipe jsonb, extra_sections jsonb) | 008 |

---

## Sistema de imágenes (estado actual, sesión 17)

**Implementado:** Subida directa a Supabase Storage. Sin opción de URL externa en ningún campo de imagen de todo el proyecto (sesión 18: se cerraron los últimos 3 huecos que quedaban).

- `uploadImageToStorage(file, folder, oldUrl)`: valida tipo (PNG/JPG/WEBP) y tamaño (≤3 MB), sube al bucket `culones` con nombre único (`folder/timestamp-random.ext`), devuelve URL pública, borra la imagen anterior si era del mismo bucket (fire-and-forget).
- `initImageUploader(prefix, folder, getOldUrl)`: conecta botón `📁 Elegir imagen` + `<input type="file" hidden>` al campo `<input type="hidden" id="${prefix}-image-input">`. La URL resultante se escribe en ese hidden y se pasa a `updateAssetPreview`. El campo hidden es lo que el JS lee al guardar — nunca fue el tipo del input lo que importaba.
- `initGenericImageDropzone(prefix, folder, getOldUrl, onChange)` + `syncGenericDropzoneState(prefix, url)` (sesión 18): versión genérica del patrón dropzone de la tierlist (click, drag&drop, estado visual `has-image`), reutilizada por los campos de configuración global que antes tenían input de URL: fondo de página y favicon.
- Todos los campos de imagen son ahora botón `📁 Elegir imagen` (o dropzone) + vista previa con botón `✕ Quitar imagen`. El `btn-upload-img` sigue existiendo en el DOM con `display:none` porque `initImageUploader` lo busca por ID, pero el usuario nunca lo ve.
- **Carpetas del bucket**: `mobs/`, `items/` (items + libres), `tierlist/`, `weapons/`, `weapon-ranks/`, `recipes/` (materiales y resultado de receta), `backgrounds/` (fondo de página), `favicons/` (icono de pestaña), `about/` (imágenes de bloques en "Acerca del Server"). Todas dentro del mismo bucket `culones`, sin restricción de carpeta a nivel de política RLS.
- **Prefijos cubiertos**: `mob`, `item`, `libre`, `tier-item`, `weapon`, `weapon-rank`, `bg`, `favicon`, más el resultado de receta (`weapon-recipe-result`) con su propio uploader manual.
- **Materiales de receta** (las N filas dinámicas en `renderRecipeMaterialsEditor`): cada fila tiene un botón `📁 Imagen` con file input independiente. La imagen sube a `recipes/`.
- **Bloques de imagen de "Acerca del Server"** (sesión 18): cada bloque `image` en el editor (`renderAboutEditorBlocks`) tiene su propio botón `📁 Elegir imagen` + file input + miniatura + `✕ Quitar`, subiendo a `about/`. Antes era un `<input type="text">` con la URL pegada a mano.
- **Fondo de página y favicon** (sesión 18): antes eran inputs de texto (`bg-image-url-input`, `favicon-url-input`) donde se pegaba una URL externa. Ahora son dropzones (`bg-image-input`, `favicon-image-input`) que suben el archivo igual que el resto del sistema, con vista previa en vivo.
- La tierlist ya tenía dropzone con drag&drop. Se eliminó el `<details>` colapsable de URL externa que había quedado (era el único resto de URL externa en todo el proyecto).

---

## Sistema de borradores (estado real)

**Importante**: hay **dos sistemas** de borradores que coexisten de forma no completamente integrada:

1. **localStorage** (el que se usa activamente): `draftKey(logId)` → `'culones_draft_log_new'` o `'culones_draft_log_${id}'`. Captura título, descripción, categoría, relevancia, fecha, mobs, items, libres. Autoguardado cada 30s mientras el modal de log está abierto, y al cerrar el modal. Se muestra en la pestaña 🛠 Herramientas como lista de borradores recuperables. **Funciona completamente, solo para logs.**
2. **Supabase (tabla `drafts`)**: la tabla existe (migration_007) con RPC `save_draft`, `list_drafts`, `delete_draft`. Pero **ninguna función del frontend actual llama a estas RPCs** — el frontend usa localStorage. La tabla fue diseñada para sincronizar borradores entre dispositivos, pero no está conectada.

**Pendiente**: conectar el sistema de borradores de localStorage al de Supabase, o decidir que solo se usa localStorage (más simple, pero no sincroniza entre dispositivos).

---

## Sistema de comentarios

- Comentarios por log con alias libre (sin login).
- **Respuestas**: un nivel de anidación. `parent_id` en la tabla `comments`. Se activan con botón "Responder" en el modal de detalle.
- **Likes de comentarios**: tabla `comment_likes`, con RPC para togglear.
- **Moderación admin**: botones ocultar/mostrar (RPC `set_comment_hidden`) y borrar definitivo. Los comentarios ocultos muestran tag `[OCULTO]` solo para el admin.

---

## Guía de Armas

- Catálogo de armas con categorías y tipos dinámicos.
- Cada arma tiene múltiples rangos (`weapon_ranks`), y cada rango contiene en JSONB: `stats` (pares clave/valor), `abilities` (habilidades con nivel, stats propios), `upgrade_recipe` (materiales → resultado), `extra_sections` (secciones libres de contenido futuro).
- Admin puede publicar/ocultar armas (campo `published`). Las armas no publicadas solo las ve el admin.
- `saveRankPatch(rankId, patch)` envía el objeto completo del rango en cada edición parcial — funciona pero es frágil (ver problemas conocidos).
- **Vista de detalle** inline dentro del panel de weapons (no es un modal separado) con `openWeaponDetail()` / `closeWeaponDetail()`.

---

## Tierlist

- Filas dinámicas (nombre, color, sort_order) × 3 columnas fijas (`weapon`, `subweapon`, `accessory`).
- `row_id = null` → elemento en el banco "Sin clasificar".
- Drag & drop en PC (eventos nativos HTML5), botón "↕ Mover a..." en móvil.
- Imágenes en pixel-art (`image-rendering: pixelated`) — pensadas para sprites de Minecraft.
- El nombre de cada elemento se muestra debajo de su miniatura (`.tier-chip-name`).

---

## Pestaña 🛠 Herramientas (solo admin)

Contiene:
- **📝 Borradores**: lista de borradores de log guardados en localStorage en este dispositivo. Botón "Limpiar todos".
- **📤 Exportar**: exportación a Excel (.xlsx) o JSON. Excel genera archivos con múltiples hojas (Logs, Mobs, Items, Libres para la sección de logs; Filas y Elementos para tierlist; Todo combina todo). También export de armas en `exportAllXlsx`.
- **📥 Importar**: importación de JSON. Analiza conflictos antes de aplicar y muestra modal de confirmación con lista de conflictos detectados.
- **🕒 Acciones**: botón discreto en la cabecera del panel admin que abre el modal de bitácora (`action_log`).

---

## Realtime (Supabase)

Se escuchan cambios en tiempo real en 3 canales:
- `logs-changes`: tablas `logs`, `log_mobs`, `log_items`, `comments`
- `tierlist-changes`: tablas `tierlist_rows`, `tierlist_items`
- `weapons-changes`: tablas `weapons`, `weapon_ranks`, `weapon_categories`, `weapon_types`

Cada canal tiene un flag de supresión (`_suppressRealtimeReload`, etc.) para evitar que el propio admin que está editando vea un reload innecesario inmediatamente después de guardar.

---

## Bot de Discord (estado actual)

Comandos disponibles:
- `/ping`: latencia del bot y Supabase.
- `/getcode`: envía el código admin por DM. Solo IDs en `AUTHORIZED_USER_IDS`.
- `/setlogchannel #canal`: configura canal de anuncios de logs. Solo IDs autorizados.
- `/screenshot tierlist columna:<Arma|Sub-arma|Accesorio> [canal]`: genera imagen de la columna.
- `/screenshot logs [cantidad] [canal]`: imagen con los logs más recientes.
- `/screenshot arma nombre:<autocompletado> [canal]`: una imagen por cada rango del arma.

Procesos automáticos:
- Rotación de código admin cada 24h (cron a las 00:00 UTC).
- Watcher Realtime en `logs`: al insertar → publica embed en el canal configurado; al actualizar → edita el mensaje existente; al borrar el mensaje manualmente → publica uno nuevo.

---

## Migraciones SQL (orden de aplicación)

1. `schema.sql` — tablas base
2. `migration_002_categories_and_dates.sql` — categorías dinámicas + fecha editable en logs
3. `migration_003_mob_item_blocks.sql` — fichas de mob/item/bloque libre
4. `migration_004_advanced_features.sql` — comment_likes, app_settings, campos configurables
5. `migration_005_action_log.sql` — bitácora de acciones
6. `migration_006_tierlist.sql` — tierlist_rows + tierlist_items
7. `migration_007_drafts.sql` — tabla drafts (existe pero frontend usa localStorage)
8. `migration_008_weapons.sql` — guía de armas completa
9. `migration_009_fix_create_category_slug.sql` — fix de normalización de slugs de categoría
10. `migration_010_storage.sql` — bucket `culones` + políticas RLS de Storage

---

## Problemas conocidos

- **`saveRankPatch` envía objeto completo**: en vez de hacer un PATCH parcial, manda todos los campos del rango en cada edición. Funciona bien ahora que el `SELECT` trae todos los campos, pero si se agrega una columna nueva a `weapon_ranks` y se olvida añadirla al `select()` de `reloadWeaponData()`, puede causar pérdida silenciosa de datos al guardar. Solución correcta: cambiar a updates parciales por campo.
- **Modal de habilidades hace demasiadas consultas**: cada edición de habilidad recarga todo el arma.
- **Borradores no sincronizados entre dispositivos**: la tabla `drafts` en Supabase existe pero no está conectada al frontend. Los borradores solo existen en localStorage del navegador actual.

---

## Pendientes

- Conectar el sistema de borradores de localStorage a Supabase (o documentar que se descartó la idea).
- Verificar que las hojas de Excel de exportación de Tierlist y "Todo" siguen reflejando bien las columnas actuales si se agregan campos nuevos.
- Optimizar el modal de habilidades de armas para no recargar todo el arma en cada edición.


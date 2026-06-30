# PROJECT_MEMORY — culones-rpg

Registro de sesiones de desarrollo. Cada entrada resume qué se hizo, qué quedó pendiente y qué problemas se conocen pero no se resolvieron todavía. Pensado para que cualquier sesión futura (de Claude o de quien sea) pueda retomar el proyecto sin tener que releer todo el código desde cero.

---

# Sesión 16

**Sistema de imágenes — Supabase Storage**

- Se implementó subida de imágenes a Supabase Storage como opción principal, manteniendo la URL externa como opción secundaria opcional. El admin ve un botón 📁 junto a cada input de URL; al pulsarlo abre el selector de archivos del sistema y sube directamente.
- La lógica de Storage se concentra en **dos funciones nuevas** en `app.js`, junto al bloque de utilidades existente, sin crear archivos nuevos:
  - `uploadImageToStorage(file, folder, oldUrl)` — valida tipo (PNG/JPG/WEBP), tamaño (≤3 MB), sube al bucket `culones` con nombre único basado en timestamp, devuelve la URL pública, y borra la imagen anterior del Storage en fire-and-forget si era del mismo bucket (evita archivos huérfanos).
  - `initImageUploader(prefix, folder, getOldUrl)` — conecta el botón 📁 y el `<input type="file">` al input URL existente de cada modal. Sube → obtiene URL → la escribe en el input → llama a `updateAssetPreview` que ya existía. Un solo wiring por prefijo, sin duplicar lógica.
- **Reutilización total**: `updateAssetPreview`, `safeUrl`, `showToast`, `escapeHtml` — todo se reusa sin modificar, excepto que se extendió `updateAssetPreview` para limpiar/marcar `.input-error` en el input cuando una URL externa no carga como imagen (feedback visual antes de guardar, sin bloquear nada).
- **HTML**: cada input URL existente envuelto en un `<div class="image-input-row">` con el botón 📁 y un `<input type="file" hidden>` junto a él. Sin reestructurar modales.
- **CSS**: `.image-input-row` (flex-row), `.btn-upload-img` (botón 📁), `.modal-input.input-error` (borde magenta si URL externa no carga). 4 reglas nuevas.
- **SQL** (`migration_010_storage.sql`): crea el bucket `culones` (público, 3 MB, PNG/JPG/WEBP) con 4 políticas RLS (select/insert/update/delete). La seguridad real sigue siendo la UI (el botón solo existe si hay sesión de admin activa), igual que el resto del proyecto.
- **Carpetas del bucket**: `mobs/`, `items/` (también libres), `tierlist/`, `weapons/`, `weapon-ranks/`, `recipes/`.
- **Prefijos cubiertos**: `mob`, `item`, `libre`, `tier-item`, `weapon`, `weapon-rank` — todos los modales con campo de imagen del proyecto.

Pendiente:
- Las imágenes de **materiales de receta** (dentro del JSONB `upgrade_recipe`) siguen siendo URLs externas — el editor de materiales genera filas dinámicas en JS sin un prefijo fijo, así que aplicarle el uploader requiere extender `renderRecipeMaterialsEditor` para añadir el botón 📁 a cada fila generada. No es urgente pero está anotado.
- Exportaciones (verificar hojas de Excel de Tierlist y "Todo" contra columnas actuales).
- Bot de Discord.

Problemas conocidos:
- El modal de habilidades hace demasiadas consultas.
- El patrón de guardado de rangos de arma (`saveRankPatch`) reenvía el objeto completo — frágil ante nuevas columnas de `weapon_ranks` que se olviden añadir al `select()`.

---

# Sesión 15


- Se diagnosticó por qué la Guía de Armas no cargaba nada y por qué un arma recién creada tampoco aparecía: el `SELECT` optimizado de `weapon_ranks` pedía columnas inexistentes (`recipe`, `sections`) en lugar de las reales (`upgrade_recipe`, `extra_sections`), y Supabase rechazaba la consulta completa. Corregido en `reloadWeaponData()` y en `fetchWeaponsDataForExport()` (export a Excel), incluyendo la referencia downstream `rank.recipe` → `rank.upgrade_recipe`.
- De paso se detectó y corregido un bug silencioso de pérdida de datos: como `description` tampoco se seleccionaba, cualquier guardado parcial de un rango (solo stats, solo habilidades, etc.) habría borrado la descripción guardada, porque el guardado siempre reenvía el objeto completo (`saveRankPatch`). Ya no ocurre, `description` ahora se carga junto al resto.
- Se auditaron **todos** los `select()` explícitos del proyecto (logs, log_mobs, log_items, comments, tierlist_rows, tierlist_items, app_settings, weapon_categories, weapon_types, weapons) contra el esquema SQL real. El único roto era el de `weapon_ranks`; el resto de la optimización (reemplazar `select('*')` por listas de columnas) está bien hecha.
- Se integró `migration_fix_create_category.sql` (un archivo suelto fuera de la numeración) a la secuencia oficial como `migration_009_fix_create_category_slug.sql`.
- Se movió el botón **🕒 Acciones realizadas** desde la barra de Logs hacia la pestaña **🛠 Herramientas**, como botón discreto (`🕒 Acciones`) en una fila superior, sin crear una sección/columna dedicada para él.
- Se corrigió un detalle de UX suelto: el selector de archivo para importar aceptaba `.csv` aunque el importador solo soporta `.json` (quedó así desde que el export dejó de ser CSV y pasó a ser Excel) — ahora el selector solo ofrece `.json`.
- README actualizado: la sección de exportación ya no describe el viejo CSV, sino el Excel actual (4 hojas con estilo); se documentó que "Herramientas" es una 5ª pestaña visible solo para admins; se actualizó la ubicación de "Acciones realizadas".

Pendiente:
- Exportaciones (verificar que las hojas de Excel de Tierlist y "Todo" sigan reflejando bien cualquier cambio futuro de columnas — son el mismo patrón de bug que el de armas, así que si se agregan columnas nuevas a `tierlist_items`/`weapons`/etc., hay que actualizar sus `select()` a mano).
- Bot de Discord.

Problemas conocidos:
- El modal de habilidades hace demasiadas consultas.
- El patrón de guardado de rangos de arma (`upsert_weapon_rank` vía `saveRankPatch`) reenvía el objeto completo en cada edición parcial. Funciona bien ahora que el `SELECT` trae todos los campos, pero es frágil: si en el futuro se agrega una columna nueva a `weapon_ranks` y se olvida añadirla también al `select()` de `reloadWeaponData()`, se repetirá exactamente el mismo tipo de bug que se corrigió esta sesión (consulta rota y/o pérdida silenciosa de datos al guardar). Vale la pena, en algún momento, mover `upsert_weapon_rank` a updates parciales reales (solo mandar lo que cambió) en vez de objeto completo.

---

# Sesión 14

- Se terminó el CRUD de armas.
- Se añadieron habilidades dinámicas.
- Se creó el slider de ascensión.
- Falta optimizar consultas.

Pendiente:
- Exportaciones.
- Bot Discord.

Problemas conocidos:
- El modal de habilidades hace demasiadas consultas.

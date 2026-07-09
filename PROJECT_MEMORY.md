# PROJECT_MEMORY — culones-rpg

Registro de sesiones de desarrollo. Cada entrada resume qué se hizo, qué quedó pendiente y qué problemas se conocen. Pensado para que cualquier sesión futura pueda retomar el proyecto sin releer todo el código.

---

# Estado actual del proyecto (tras P2/P3 y primera pasada de Optimización General)

## Arquitectura general

- **Web**: sitio estático multipágina (MPA) HTML/CSS/JS. Sin backend propio, sin bundler, sin build step. Desplegado en GitHub Pages.
- **Deploy temporal**: GitHub Pages está atascado en `deployment_queued` al 2026-07-02. No tocar configuración de deploy por ahora; la QA de P2/P3 se hace localmente con Live Server.
- **JS**: ES Modules nativos (`<script type="module">`). Ver **"Arquitectura de páginas (sesión 20)"** para la navegación real entre `.html`, y **"Arquitectura del código JS (sesión 19)"** para el detalle de los módulos de `js/features/` y `js/core/` (siguen intactos, solo cambió *quién* los importa).
- **Base de datos**: Supabase (Postgres). Toda la lógica sensible protegida por RLS + funciones RPC con `security definer` que validan el código de admin antes de actuar.
- **Multimedia**: Supabase Storage, bucket `culones` (público de lectura) + tabla `media_assets` para recursos propios. Los campos actuales siguen guardando URLs (`image_url` o equivalentes), pero ahora pueden subir o reutilizar recursos desde la Biblioteca Multimedia. Las URLs externas volvieron como valores por uso desde el selector, sin entrar en la biblioteca interna.
- **Bot de Discord**: Node.js + discord.js, desplegado en Railway. Se conecta a Supabase directamente con `service_role`.
- **Autenticación de admin**: código de 8 caracteres generado por el bot cada 24h, guardado en la tabla `admin_codes` con fecha de expiración, persistido en `localStorage` (`state.adminCode`) — por eso la sesión de admin sobrevive a la navegación entre páginas sin tener que volver a loguearse.

---

## Arquitectura de páginas (sesión 20)

**Motivo**: hasta la sesión 19 la web era una única página (`index.html`) con 5 `<section class="tab-panel">` que se mostraban/ocultaban por JS (sistema de "pestañas falsas"). Cada carga de `index.html` traía **todo** el HTML y (transitivamente, vía `js/app/main.js`) **todo** el JS de las 5 secciones, aunque la persona solo quisiera ver los Logs. Se migró a un sitio multipágina real: cada sección es ahora un archivo `.html` independiente, con su propio `<script type="module">` de entrada que importa solo lo que esa página necesita.

### Páginas

| Archivo | Sección | Acceso |
|---|---|---|
| `index.html` | 📜 Logs (portada) | Todos |
| `weapons.html` | ⚔️ Guía de Armas | Todos |
| `tierlist.html` | 🏆 Tierlist | Todos |
| `about.html` | 🎮 Acerca del Server | Todos |
| `admin.html` | 🛠 Herramientas | Solo admin — link oculto en el nav para visitantes, y la propia página redirige a `index.html` si se accede sin sesión de admin activa (por URL directa, por ejemplo) |

`asset-view.html` (visor de imágenes a pantalla completa) ya existía desde antes como página independiente — sirvió de precedente para este patrón.

### Componentes compartidos: `partials/` + `js/app/shell.js`

Al no haber build step ni server-side includes (GitHub Pages sirve archivos estáticos tal cual), reutilizar HTML entre páginas se resuelve con **fetch en runtime**:

```
partials/
├── header.html   # crt-overlay + bg-grid + <header class="hud-top"> + <nav class="browser-tabs">
└── footer.html   # modal de login de admin + contenedor de toasts
```

- `js/app/include.js` expone `loadPartial(url, targetId)` y `loadSharedShell()`, que hacen `fetch()` de esos dos archivos y los inyectan en `<div id="shell-header"></div>` / `<div id="shell-footer"></div>` — presentes al principio/final del `<body>` de **las 5 páginas**, sin excepción.
- `js/app/shell.js` expone `bootShell(pageKey)`, la función que **todas** las páginas llaman primero en su `init()`:
  1. Inyecta header/footer (`loadSharedShell()`).
  2. Marca la pestaña activa del nav (`.is-active` sobre el `<a data-page="...">` que coincide con `pageKey`) y actualiza el texto `culones-rpg.gg/<pageKey>` de la barra falsa de URL.
  3. Cablea el modal de login de admin (botón ADMIN del header, que ahora vive en el partial compartido).
  4. Cablea la delegación global de `.js-open-asset` (abrir imágenes a pantalla completa) — se usa desde casi todas las páginas.
  5. Llama a `updateAdminUI()` (ver más abajo) y a `loadAppSettings()` (fondo, favicon, config de fichas y bloques de "about" — son datos globales, se cargan siempre aunque la página actual no los muestre todos).

El nav de `partials/header.html` usa `<a href="...">` reales en vez de `<button data-tab="...">` — la navegación entre pestañas ahora es navegación de browser de verdad, no un cambio de `display` por JS. Se mantiene la clase `.tab-item` y toda su CSS (con el único agregado de `text-decoration: none` para que un link no se vea subrayado), así que visualmente es idéntico a antes. El fade-in de `.tab-panel.is-active` se sigue disparando en cada carga de página, así que la transición se "siente" igual.

### Cada página carga solo lo suyo

Se creó `js/pages/` con un entry point por página (distinto de `js/features/`, que sigue teniendo la lógica de negocio reutilizable):

```
js/pages/
├── logs.js      # index.html     — modal de log, mob, item, libre, categorías, config de fichas, detalle+comentarios
├── tierlist.js  # tierlist.html  — modal de fila, elemento y "mover" (móvil)
├── weapons.js   # weapons.html   — initWeaponModals() (ya estaba 100% autocontenido en weapons-admin.js)
├── about.js     # about.html     — editor de bloques de "Acerca del Server"
└── admin.js     # admin.html     — borradores, export, import, fondo, favicon, bitácora de acciones
```

Cada uno importa únicamente los módulos de `js/features/` que le corresponden y cablea únicamente los modales presentes en **su propio** HTML. Por ejemplo, `weapons.js` nunca importa `js/features/tierlist.js`, y `js/pages/logs.js` nunca importa nada de `weapons-*`.

`js/app/realtime.js` se partió en tres funciones (`initLogsRealtime`, `initTierlistRealtime`, `initWeaponsRealtime`) en vez de una única `initRealtime()` que suscribía los 3 canales de una — cada página ahora solo se suscribe al canal que le sirve. `admin.html` y `about.html` no necesitan Realtime y no lo cargan.

### Reubicaciones de piezas que estaban "mal clasificadas"

Al separar por página se detectaron dos casos donde una función vivía dentro de `admin-panel.js` (pensado como "todo lo de Herramientas") pero en realidad pertenecía a la UI del **modal de log**, que ahora vive solo en `index.html`:

- El botón "💾 Guardar borrador" (`draft-manual-save-btn`) y el aviso de "hay cambios sin guardar" al cerrar la pestaña (`initBeforeUnload()`) se movieron de `admin-panel.js` a `js/pages/logs.js`.
- `initAboutEditor()` (el editor de bloques de "Acerca del Server") se movió de `admin-panel.js` a `js/pages/about.js` — el botón que lo abre siempre vivió visualmente en la propia página de About, nunca en Herramientas.

Y un caso de acoplamiento cruzado entre páginas: el listado de borradores en Herramientas tenía un botón "Abrir" que llamaba directamente a `openEditLogModal()`/`openNewLogModal()` de `logs.js` — eso ya no es posible (ni deseable) porque el modal de log no existe en `admin.html`. Se cambió por navegación real: el botón arma una URL `index.html?draftKey=...&logId=...` y `js/pages/logs.js`, al cargar, detecta esos parámetros, abre el modal correspondiente y restaura el borrador automáticamente (`checkIncomingDraftLink()` en `logs.js`).

### Correcciones necesarias para que la carga "solo de datos" no rompiera

Algunas funciones asumían que su HTML siempre estaba presente en el documento (porque antes SIEMPRE lo estaba, todo vivía en el mismo `index.html`). Al dejar de ser cierto, se agregaron guards:

- `renderLogs()` (`logs.js`): ahora retorna temprano si `#logs-grid` no existe.
- `renderTierlist()` (`tierlist.js`): ahora retorna temprano si `#tierlist-board`/`#tierlist-bench-columns` no existen. Esto además habilita que `admin.html` pueda llamar a `loadTierlist()` (usado por la exportación "Backup completo") sin necesitar el tablero visual en el DOM.
- `updateAdminUI()` (`auth.js`): reescrita para no asumir que los botones admin-only (`open-new-log-btn`, `open-new-tier-row-btn`, `open-new-weapon-btn`, etc.) existen todos a la vez — cada uno se busca y se oculta/muestra solo si está presente en la página actual. También reemplaza el viejo hack de "si cierro sesión estando en la pestaña admin, hago click en la pestaña logs" por una redirección real: `if (!admin && state.activeTab === 'admin') window.location.href = 'index.html'`.
- `loadWeaponsCatalog()` ahora marca `state.weaponsLoaded = true` internamente (antes lo hacía `app/tabs.js`, que ya no existe).
- `loadTierlist()` ahora marca `state.tierlistLoaded = true` internamente por la misma razón.
- `loadLogsData()` concentra la carga pura de Logs/Mobs/Items sin renderizar UI. `logs.js` la usa y luego llama a `renderLogs()`, mientras que `admin.html` la usa desde export/import sin arrastrar modales de Logs.
- `loadCategoriesData()` hace lo mismo para categorías: carga datos sin tocar filtros/selects/modales. `loadCategories()` sigue siendo la versión con render para la página de Logs.
- `drafts-list.js` separa el listado de borradores de Herramientas del autoguardado/restauración del formulario de Logs (`drafts.js`). Admin ya no importa el formulario de Logs solo para mostrar la lista de borradores.
- `updateAdminUI()` expone `registerAdminUiRefreshHandler()` para que cada página registre su propio refresco admin-only sin que `auth.js` importe directamente `logs.js`, `tierlist.js` o módulos de Armas.
- `field-config.js` expone `setFieldConfigSavedHandler()` para notificar a Logs cuando se guardan campos de fichas, sin importar `renderLogs()` directamente.

### Qué se eliminó

- `js/app/tabs.js` — la carga perezosa por click de pestaña ya no tiene sentido: cada página carga sus datos una sola vez en su propio `init()`, apenas se entra a esa URL.
- `js/app/main.js` — reemplazado por los 5 archivos de `js/pages/` + `js/app/shell.js`.
- El sistema de `display:none`/`display:block` entre `.tab-panel` — cada página ahora tiene un único `.tab-panel.is-active`, no hay nada que ocultar.

### Qué NO cambió

- Ningún archivo SQL, ninguna tabla, ninguna función RPC.
- El bot de Discord.
- El contenido y la lógica interna de `js/features/*` y `js/core/*` — se movieron *quién los llama*, no *qué hacen*. Las únicas ediciones de código dentro de `features/` fueron los guards de DOM listados arriba y la reubicación de las dos piezas mal clasificadas.
- El diseño visual, la tipografía, las animaciones (incluido el fade-in al entrar a una sección) y el comportamiento de cada funcionalidad: autenticación de admin, Logs, Tierlist, Guía de Armas, borradores, exportación/importación, Storage, Realtime, comentarios, likes — todo se comporta exactamente igual que antes, solo que cada pieza vive en su propio archivo `.html`.

### Cómo se verificó

1. **IDs referenciados vs. IDs presentes**: se extrajeron todos los `getElementById('...')` de cada módulo de `js/features/` y `js/pages/`, y se compararon contra los `id="..."` realmente presentes en la página (+ partials) donde ese módulo se usa. En los módulos enfocados por página no quedan IDs faltantes reales; el único falso positivo global esperado es `load-more-btn`, que se crea dinámicamente por JS y no vive en el HTML.
2. **Grafo de imports**: todos los `import { x } from '...'` se resolvieron contra exports reales de cada archivo (script de Python que compara nombres importados vs. `export function/const` del módulo destino). Cero desajustes reales (un único falso positivo: un comentario dentro de `config.js` que menciona `'../config.js'` como ejemplo de sintaxis).
3. **Sintaxis**: `node --check` sobre los ~35 archivos `.js` del proyecto.
4. **HTML bien formado**: parseo de las 5 páginas + los 2 partials con `html.parser` de Python, verificando que cada tag abierto tenga su cierre correspondiente.

---



**Motivo**: hasta la sesión 18, toda la lógica del frontend (~4875 líneas) vivía en un único archivo `js/app.js`. Se dividió en módulos ES por responsabilidad para que sea mantenible y escalable, **sin cambiar ningún comportamiento visible**. La única corrección funcional necesaria fue mover la variable de paginación `_logsPage` a `state.logsPage` (ver "Decisiones técnicas" abajo) — todo lo demás es exactamente el mismo código, solo movido de lugar.

### Cómo se cargan los módulos

> **Nota (sesión 20)**: esta sección describe la división interna de `js/features/` y `js/core/`, que sigue igual. Lo que cambió es *qué archivo hace de punto de entrada* — ya no es un único `js/app/main.js` para toda la web, sino un entry point por página en `js/pages/` (ver "Arquitectura de páginas (sesión 20)" más arriba). El patrón de carga es el mismo en las 5 páginas, por ejemplo en `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script type="module" src="js/pages/logs.js"></script>
```

`js/pages/logs.js` importa (directa o transitivamente) todos los módulos que la página de Logs necesita, así que no hace falta ningún `<script>` adicional en el HTML. Los scripts de terceros (`supabase-js` en las 5 páginas, `xlsx` de SheetJS solo en `admin.html`) se siguen cargando como `<script>` clásico antes del módulo, y sus globals (`window.supabase`, `XLSX`) se usan tal cual desde dentro de los módulos.

`js/config.js` exporta `supabaseClient` (antes era una variable global `const` suelta) — es el único módulo que lee `window.supabase`.

### Árbol de carpetas

```
js/
├── config.js                    # Supabase client (URL + anon key)
├── core/                        # Fundacional: sin lógica de negocio propia
│   ├── state.js                 # Objeto `state` global + constantes compartidas
│   ├── utils.js                 # Helpers puros sin dependencias de dominio
│   ├── storage.js               # Supabase Storage: subida/preview/dropzones de imagen
│   └── media.js                 # Núcleo de Biblioteca Multimedia: MIME, hash, duplicados y RPCs
├── features/                    # Un módulo por responsabilidad de producto
│   ├── categories.js            # Categorías dinámicas de logs
│   ├── field-config.js          # Config de campos de fichas Mob/Item (+ carga de app_settings)
│   ├── action-log.js            # Bitácora de acciones (solo lectura admin)
│   ├── logs.js                  # CRUD de logs + tarjetas + orden/paginación
│   ├── comments.js              # Comentarios: carga, respuestas, likes, moderación
│   ├── blocks-display.js        # Render de solo-lectura de fichas Mob/Item/Libre
│   ├── blocks-editor.js         # Edición admin de fichas dentro del form de log
│   ├── drafts.js                # Borradores en localStorage (autoguardado + listado)
│   ├── auth.js                  # Login/logout de admin
│   ├── tierlist.js              # Tierlist completa (filas, elementos, drag&drop, banco)
│   ├── weapons-state.js         # Selectores puros sobre el estado de armas
│   ├── weapons-data.js          # Carga de datos de armas desde Supabase
│   ├── weapons-catalog.js       # Catálogo público: filtros + grid
│   ├── weapons-catalog-admin.js # CRUD de categorías/tipos de arma
│   ├── weapons-detail.js        # Vista de detalle de un arma (rangos, habilidades, receta)
│   ├── weapons-admin.js         # CRUD de armas/rangos + cableado de todos sus modales
│   ├── about.js                 # "Acerca del Server": render público + editor admin
│   ├── background.js            # Fondo de página configurable
│   ├── favicon.js               # Favicon configurable
│   ├── export.js                # Exportación a Excel (SheetJS) y JSON
│   ├── import.js                # Importación de JSON + detección de conflictos
│   ├── media-library.js         # Biblioteca Multimedia + selector reutilizable
│   ├── media-library-helpers.js # Helpers puros de Multimedia: presentación, filtros, previews y assets livianos
│   └── admin-panel.js           # Cableado de la página 🛠 Herramientas (export/import/drafts/fondo/favicon/multimedia)
├── app/                         # Orquestación / bootstrap compartido por TODAS las páginas
│   ├── include.js                # Carga partials/header.html y partials/footer.html vía fetch
│   ├── shell.js                  # bootShell(pageKey): header/nav/admin-modal/updateAdminUI/app_settings
│   └── realtime.js               # 3 funciones separadas: initLogsRealtime/initTierlistRealtime/initWeaponsRealtime
└── pages/                        # Un entry point por página .html (sesión 20)
    ├── logs.js                   # index.html
    ├── tierlist.js                # tierlist.html
    ├── weapons.js                 # weapons.html
    ├── about.js                   # about.html
    └── admin.js                   # admin.html
```

### Reglas de dependencia

- `core/` no depende de `features/` ni `app/` (solo entre sí: `state.js` usa `utils.js`; `storage.js` usa `utils.js`).
- `features/*` puede depender de `core/*` y de otros `features/*`.
- `app/*` es la capa de bootstrap compartido: importa de `features/*` y `core/*` para cablear el header/nav/admin-modal comunes a las 5 páginas.
- `pages/*` es la capa más externa, específica de cada página: importa `app/shell.js` + `app/realtime.js` + solo los `features/*` que esa página necesita, y cablea el resto del DOM de esa página en concreto.
- Cada archivo exporta explícitamente (`export function`/`export const`) todo lo que otro módulo necesita — no hay nada colgado de `window` salvo lo que ya venía de terceros (`window.supabase`, `XLSX`).

### Dependencias circulares

La auditoría post-refactor confirmó que no hay imports rotos ni módulos huérfanos. También se eliminaron dos ciclos innecesarios del área de Logs (`logs.js` ↔ `blocks-editor.js` y `logs.js` ↔ `categories.js`).

Actualización de la Fase de Optimización General (2026-07-03):

- El grafo de imports estáticos queda con **0 ciclos**.
- Los 5 ciclos internos conocidos de la Guía de Armas fueron eliminados.
- `weapons-detail.js` ya no importa estáticamente `weapons-admin.js`; carga acciones admin bajo demanda con `import('./weapons-admin.js')` cuando el usuario pulsa botones administrativos del detalle.
- `weapons-data.js` ya no importa estáticamente `weapons-catalog-admin.js`; renderiza selects/listas admin bajo demanda con import dinámico.
- `weapons-catalog.js` y `weapons-detail.js` usan delegación de eventos para reducir listeners recreados en cada render.

En la misma auditoría se limpió la superficie pública de los módulos: las funciones/constantes que solo se usan dentro de su propio archivo dejaron de exportarse. El grafo queda con **0 imports rotos**, **0 módulos huérfanos**, **0 exports sobrantes** y **0 ciclos estáticos**.

La relación render↔acción de Armas sigue existiendo a nivel de flujo de usuario, pero ya no como dependencia circular de módulos.

### Decisiones técnicas

- **`_logsPage` → `state.logsPage`**: en el `app.js` original, `_logsPage` era un `let` de módulo reasignado desde tres sitios distintos (orden, filtro de categoría, "cargar más"). Un binding `import` en ES Modules es de **solo lectura** desde el módulo que importa — no se puede hacer `_logsPage = 1` fuera de `state.js`. Se resolvió moviéndolo a una propiedad mutable del objeto `state` (`state.logsPage`), que si se puede mutar desde cualquier módulo porque `state` en sí es un `const` (el binding no cambia, solo sus propiedades). Es el único cambio de comportamiento interno del refactor, y es 100% transparente para el usuario.
- **`initModals()` (histórico, sesión 19)**: originalmente vivía entera en `app/main.js` y ataba botones de todos los dominios contra sus `open*`/`submit*`. Desde la sesión 20 ya no existe como una única función — se partió en un `initXModals()` por página dentro de cada `js/pages/*.js` (ver "Arquitectura de páginas (sesión 20)"), porque ahora cada página solo tiene en su DOM los modales que le corresponden.
- **`blocks-display.js` vs `blocks-editor.js`**: las fichas de Mob/Item/Libre se separaron en "cómo se muestran" (solo lectura, usado por logs y por la vista de detalle) vs "cómo se editan" (modales admin, usado solo dentro del form de log). Antes vivían mezcladas en el mismo bloque de funciones.
- **Dropzone de imagen de la tierlist** (`syncTierDropzoneState`, `initTierItemDropzone`) se movió de la zona genérica de Storage a `tierlist.js`, porque es específica de ese modal — la parte genérica reutilizable (`initGenericImageDropzone`, `initImageUploader`) se quedó en `core/storage.js`.
- Ningún archivo SQL, CSS, HTML (salvo la etiqueta `<script>` de carga) ni el bot de Discord se tocaron — el refactor es exclusivamente de `js/app.js` → módulos.

### Cómo verificar el refactor

No hay entorno de browser automatizado en este repo, así que la validación se hizo así:
1. **Diff de contenido**: se extrajo cada línea de código real (sin comentarios/blancos) del `app.js` original y de todos los módulos nuevos, y se comparó como multiset — la única diferencia son las 6 líneas de `_logsPage` → `state.logsPage` explicadas arriba. Cero código perdido, cero código duplicado.
2. **Sintaxis**: `node --check` sobre cada archivo `.js`.
3. **Grafo de imports** *(histórico — el archivo `app/main.js` referenciado acá ya no existe desde la sesión 20; ver la sección "Cómo se verificó" de la sesión 20 para el método actualizado)*: `import('./app/main.js')` con globals de `document`/`window`/`localStorage` mockeados — confirma que todos los `import`/`export` resuelven correctamente y no hay ciclos rotos.

Si en el futuro se agrega un módulo nuevo, conviene repetir el paso 3 (import dinámico del árbol completo) antes de dar por buena la integración.

---

## Páginas de la web

| Página | Archivo | `data-page` | Visible para |
|---|---|---|---|
| 📜 Logs | `index.html` | `logs` | Todos |
| ⚔️ Guía de Armas | `weapons.html` | `weapons` | Todos |
| 🏆 Tierlist | `tierlist.html` | `tierlist` | Todos |
| 🎮 Acerca del Server | `about.html` | `about` | Todos |
| 🛠 Herramientas | `admin.html` | `admin` | Solo admin (link oculto en el nav; la página redirige a `index.html` si se accede sin sesión) |

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
| `drafts` | Borradores guardados en Supabase, sincronizados best-effort desde el frontend admin | 007 |
| `weapon_categories` | Categorías de armas (label, color) | 008 |
| `weapon_types` | Tipos de armas (label) | 008 |
| `weapons` | Armas (name, image_url, published, category_id, type_id) | 008 |
| `weapon_ranks` | Rangos por arma (name, description, image_url, stats jsonb, abilities jsonb, upgrade_recipe jsonb, extra_sections jsonb) | 008 |
| `media_assets` | Índice reutilizable de recursos propios de Storage: MIME, hash, metadatos, presentación y archivado | 011 |

---

## Sistema Multimedia (estado actual, Prioridad 2)

**Implementado:** Biblioteca Multimedia reutilizable sobre Supabase Storage + metadatos en `media_assets`, manteniendo compatibilidad con los campos actuales basados en URL (`image_url`, `background_config.image_url`, `favicon_url`, bloques de About, recetas, etc.).

- `js/core/media.js`: núcleo del sistema. Define MIME soportados, tipo dinámico (`image`, `video`, `audio`, `document`, `other`), hash SHA-256, detección de duplicados, helpers de Storage y RPCs admin-gated (`listMediaAssets`, `upsertMediaAsset`, `archiveMediaAsset`, etc.).
- `js/core/storage.js`: conserva `uploadImageToStorage()` para no romper llamadas existentes, pero ahora delega en `uploadMediaToStorage()`. Campos de imagen aceptan PNG, JPG/JPEG, WEBP, GIF, SVG y APNG hasta 8 MB; la biblioteca acepta además MP4 y WEBM hasta 25 MB.
- `sql/migration_011_media_library.sql`: crea `media_assets`, amplía MIME/tamaño del bucket `culones`, y expone RPCs protegidas por `validate_admin_code`.
- `sql/migration_012_media_library_archive_cleanup.sql`: agrega RPC admin-gated para borrado definitivo de registros multimedia archivados.
- `sql/migration_013_media_picker_light_list.sql`: agrega RPC liviana para modo selector; devuelve solo recursos activos y columnas básicas paginadas, sin archivados ni metadatos administrativos completos.
- Biblioteca en **Herramientas**: búsqueda, filtros por tipo/origen, orden, vista previa, nombre visible, MIME, tamaño, hash, tags, descripción, archivado/restauración, borrado definitivo, listado de usos detectados, render progresivo y modo minimizado.
- Selector multimedia reutilizable: disponible en Logs (mob/item/libre), Tierlist, Guía de Armas (arma/rango/receta/materiales), About, fondo de página y favicon. El picker usa modo liviano separado: RPC paginada mínima, cache temporal, búsqueda con debounce y carga incremental; no carga usos, archivados ni acciones administrativas al abrir.
- Recursos externos: vuelven como URLs temporales por uso desde el selector; no se guardan en `media_assets` ni aparecen en la biblioteca interna. El modal intenta detectar MIME/tipo y generar vista previa antes de aceptar, con fallback manual si CORS/HEAD no permite detección.
- Duplicados: los uploads calculan hash y reutilizan el recurso existente si ya fue registrado.
- Usos detectados: la biblioteca indexa URLs actuales en Logs, Tierlist, Armas, recetas, fondo, favicon y bloques de About.
- Presentación preparada: cada recurso guarda `presentation` con `fit`, `position`, `repeat` y `opacity`; el selector devuelve esos datos. El fondo guarda una copia por uso en `background_config.presentation` para respetar fit/posición/repetición/opacidad sin depender del recurso global.
- Deuda técnica documentada: mover todos los campos históricos `image_url` (mobs, items, tierlist, armas y rangos) a presentación persistente por uso requiere una migración de modelo específica posterior. Hasta entonces mantienen URL compatible y pueden recibir recursos del selector.
- Export/import: el backup completo JSON incluye `media_assets`; el Excel completo añade hoja `Multimedia`.
- Identidad visual de P3 aplicada desde P2: la biblioteca, picker, modales, botones, filtros, estados y previews usan negros profundos, blanco para información principal y morado `#7C3AED`.

---

## Sistema de borradores (estado real)

**Importante**: hay **dos capas** de borradores que coexisten de forma integrada:

1. **localStorage**: `draftKey(logId)` → `'culones_draft_log_new'` o `'culones_draft_log_${id}'`. Captura título, descripción, categoría, relevancia, fecha, mobs, items, libres. Autoguardado cada 30s mientras el modal de log está abierto, y al cerrar el modal. Funciona como respaldo inmediato del navegador.
2. **Supabase (tabla `drafts`)**: `drafts-store.js` sincroniza best-effort con RPC `upsert_draft`, `get_draft`, `list_drafts` y `delete_draft` cuando hay sesión admin activa. Herramientas mezcla borradores locales y remotos, y Logs puede restaurar borradores remotos desde `?draftKey=remote:log:...`.

**Pendiente**: QA manual con dos navegadores/dispositivos tras confirmar que `migration_007_drafts.sql` está aplicada en Supabase.

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
- `saveRankPatch(rankId, patch)` usa `patch_weapon_rank` (migration_015) para updates parciales por campo y conserva fallback al RPC viejo si la migración aún no está aplicada.
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
- **Biblioteca Multimedia**: índice reusable de recursos internos de Storage, selector, buscador, filtros, metadatos, duplicados e indexado de usos.
- **📝 Borradores**: lista de borradores de log guardados en localStorage y sincronizados con Supabase cuando hay sesión admin activa. Botón "Limpiar todos".
- **📤 Exportar**: exportación a Excel (.xlsx) o JSON. Excel genera archivos con múltiples hojas (Logs, Mobs, Items, Libres para la sección de logs; Filas y Elementos para tierlist; Todo combina todo, incluida hoja/lista `Multimedia`). También export de armas en `exportAllXlsx`.
- **📥 Importar**: importación de JSON. Analiza conflictos antes de aplicar y muestra modal de confirmación con lista de conflictos detectados, incluyendo `media_assets` en backups completos.
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
7. `migration_007_drafts.sql` — tabla drafts + RPCs de borradores sincronizables
8. `migration_008_weapons.sql` — guía de armas completa
9. `migration_009_fix_create_category_slug.sql` — fix de normalización de slugs de categoría
10. `migration_010_storage.sql` — bucket `culones` + políticas RLS de Storage
11. `migration_011_media_library.sql` — Biblioteca Multimedia (`media_assets`) + MIME ampliados + RPCs admin-gated
12. `migration_012_media_library_archive_cleanup.sql` — borrado definitivo de registros multimedia archivados
13. `migration_013_media_picker_light_list.sql` — listado liviano para selector multimedia rápido
14. `migration_014_admin_action_audit_details.sql` — action logs más descriptivos
15. `migration_015_patch_weapon_rank.sql` — PATCH parcial de `weapon_ranks`

---

## Problemas conocidos

- Pendiente QA manual completa con Live Server tras aplicar `migration_015_patch_weapon_rank.sql` en Supabase.

---

## Fase de Optimización General (iniciada 2026-07-03)

Objetivo: mejorar arquitectura, rendimiento, limpieza y mantenibilidad sin añadir funcionalidades nuevas ni cambiar el comportamiento visible.

Auditoría inicial:

- Archivos más pesados detectados: `css/style.css`, `js/features/media-library.js`, `js/features/weapons-admin.js`, `js/features/export.js` y `sql/migration_014_admin_action_audit_details.sql`.
- Riesgos principales: CSS monolítico, `media-library.js` con demasiadas responsabilidades, ciclos de imports en Armas, render/listeners repetidos en grids y modales, y migración SQL 014 extensa que reemplaza varias RPC.
- Validación base: `node --check` en todos los JS y `git diff --check` sin errores.

Pasada 1 — Multimedia:

- Se creó `js/features/media-library-helpers.js` para helpers puros de presentación, filtros, orden, preview y assets del picker.
- `media-library.js` conserva el control de estado, carga, modales y flujos de usuario.
- Biblioteca/Selector Multimedia ahora usa delegación de eventos en el grid para escoger, copiar, editar, archivar, restaurar y eliminar, evitando recrear listeners por tarjeta.
- Validación: `node --check` en 40 JS, `git diff --check` sin errores.

Pasada 2 — Guía de Armas:

- Se eliminaron los 5 ciclos estáticos de imports detectados en Armas.
- `weapons-detail.js` carga acciones admin bajo demanda con import dinámico.
- `weapons-data.js` carga controles admin de categorías/tipos bajo demanda con import dinámico.
- `weapons-detail.js` usa delegación de eventos para los botones del detalle.
- `weapons-catalog.js` usa delegación de eventos para filtros y tarjetas.
- Validación: grafo de imports estáticos con `cycles 0`; `node --check` en 40 JS; `git diff --check` sin errores.

Pasada 3 — CSS global:

- Se inició la limpieza segura de `css/style.css` sin rediseñar ni mover bloques grandes.
- Se añadieron tokens semánticos para superficies, texto, bordes y blancos del entorno admin/multimedia.
- Se reemplazaron hardcodes repetidos de la sección Multimedia por variables existentes o nuevas (`--admin-purple`, `--admin-ink`, `--admin-surface-*`, `--admin-border-*`, etc.).
- Se separó el bloque `SISTEMA MULTIMEDIA` a `css/media.css`, cargado después de `css/style.css` en `index.html`, `admin.html`, `about.html`, `tierlist.html` y `weapons.html` para conservar la cascada.
- No se eliminaron reglas ni selectores; los hardcodes de un solo uso quedan para revisión posterior si realmente aportan simplificación.
- Validación: balance de llaves correcto en `css/style.css` y `css/media.css`; `git diff --check` sin errores en CSS/HTML/PROJECT_MEMORY.

Pasada 4 — CSS legacy por capas:

- Se separaron bloques legacy consecutivos de `css/style.css` en capas dedicadas: `css/tierlist.css`, `css/admin-tools.css`, `css/weapons.css` y `css/about.css`.
- Las páginas HTML cargan las capas en orden estable: `style.css`, capas legacy y `media.css`.
- No se cambiaron reglas internas, selectores ni comportamiento visual esperado.
- Validación: balance de llaves correcto en todas las hojas CSS separadas.

Pasada 5 — Export/Import:

- Se creó `js/features/backup-helpers.js` para helpers compartidos de backup: fecha de archivo, etiqueta de tipo, detalle de auditoría y descarga de archivo.
- `export.js` usa los helpers compartidos y conserva la firma pública `exportData(type, format)`.
- `import.js` usa la etiqueta compartida de tipo de backup.
- El modal de conflictos de importación pasó a delegación de evento con `listEl.onchange`, evitando listeners por fila en cada render.
- Validación: `node --check` en `backup-helpers.js`, `export.js` e `import.js`.

Pasada 6 — Migración 014:

- Se simplificó la composición repetida de contexto de armas en `create_weapon`, `update_weapon` y `delete_weapon` usando `weapon_context`.
- No se añadieron RPC nuevas ni objetos extra de Supabase.
- Se conservaron firmas, grants y descripciones esperadas.
- Validación: bloques `$$` balanceados; 14 funciones `create or replace function`; 14 `grant execute`.

Pasada 7 — Guía de Armas / PATCH de rangos:

- Se agregó `sql/migration_015_patch_weapon_rank.sql` con RPC `patch_weapon_rank`.
- `saveRankPatch()` ahora envía solo los campos modificados y actualiza el rango en memoria con la respuesta de Supabase.
- Se mantiene fallback compatible a `upsert_weapon_rank` si `migration_015` aún no está aplicada.
- Editar nombre/descripcion/imagen de un rango existente usa patch parcial; crear rango nuevo sigue usando `upsert_weapon_rank`.
- Validación: `node --check` en módulos de armas; SQL `$$` balanceado.

Pasada 8 — Modal de habilidades / weapons-admin:

- Guardar estadísticas, habilidades, receta y secciones extra ya no recarga todo el catálogo de armas.
- Los cambios parciales actualizan `state.weaponRanksByWeapon` y re-renderizan solo el detalle del arma abierta.
- `weapons-admin.js` centraliza el cierre de updates parciales con `finishRankPatch()`.
- Validación: `node --check` en `weapons-admin.js`, `weapons-detail.js` y `weapons-state.js`.

Pasada 9 — Borradores Supabase:

- Se creó `js/features/drafts-store.js` como capa compartida para localStorage + Supabase.
- `drafts.js` guarda siempre local y sincroniza best-effort con `upsert_draft`.
- `drafts-list.js` mezcla borradores locales y remotos, y puede abrir o borrar ambos.
- `admin-panel.js` limpia borradores locales y remotos desde Herramientas.
- `js/pages/logs.js` puede restaurar borradores remotos desde `?draftKey=remote:log:...`.
- Validación: `node --check` en módulos de borradores y página Logs.

Pasada 10 — CSS global / tokens seguros:

- Se añadieron tokens semánticos para estados admin: danger, success, warning, cyan, blancos translúcidos y bordes de controles.
- `admin-tools.css` usa tokens en export/import, borradores y botones danger sin cambiar selectores.
- `media.css` usa tokens para botones danger, placeholders y bordes de inputs/tabs.
- `style.css` declara `--purple` como token real para bloques libres y elimina fallbacks repetidos `#b07cff`.
- No se movieron bloques grandes ni se eliminaron selectores.
- Validación: balance de llaves CSS y `git diff --check`.

Pendiente recomendado para la siguiente sesión:

- Aplicar `migration_015_patch_weapon_rank.sql` en Supabase.
- Hacer QA manual con Live Server: armas, habilidades, borradores Supabase y P3 móvil.

---

## Roadmap y prioridades

### Prioridad 1 — Auditoría y limpieza post-refactor

Objetivo: cerrar la etapa de modularización/multipágina dejando el repo limpio, documentado y verificable antes de construir sistemas nuevos encima.

- Eliminar referencias antiguas a `app.js`, `app/main.js`, `app/tabs.js`, pestañas falsas y URLs externas ya removidas.
- Limpiar comentarios obsoletos en HTML, CSS, JS, README y memoria del proyecto.
- Revisar HTML y README para que describan el estado real multipágina.
- Buscar y eliminar código muerto dejado por el refactor.
- Revisar arquitectura, dependencias entre módulos, duplicación, rendimiento y consultas.
- Probar todas las páginas: Logs, Tierlist, Guía de Armas, Acerca del Server y Admin.
- Probar flujos críticos: exportaciones, importaciones, Storage, Realtime, login admin, comentarios, likes, borradores y cambios desde admin.
- Verificar integración con el bot de Discord: comandos, screenshots, publicación/edición de logs y rotación del código admin.
- Actualizar completamente `PROJECT_MEMORY.md` al terminar la auditoría.
- Confirmar que README, memoria y comentarios del código queden sincronizados con el estado actual.

Pendientes técnicos incluidos en esta prioridad:

- Verificar que las hojas de Excel de exportación de Tierlist y "Todo" reflejan las columnas actuales.
- Aplicar `migration_015_patch_weapon_rank.sql` en Supabase antes de dar por cerrado el PATCH parcial en producción.
- Hacer QA manual completa con Live Server.

#### Checklist de auditoría local

Completado en repo:

- [x] Referencias antiguas a `app.js`, `js/app/main.js`, `js/app/tabs.js`, tabs falsas y URLs obsoletas revisadas/limpiadas en README, HTML, CSS, SQL y memoria.
- [x] Comentarios obsoletos principales limpiados o reescritos para describir el estado multipágina real.
- [x] HTML y README revisados contra la arquitectura actual de páginas reales (`index.html`, `weapons.html`, `tierlist.html`, `about.html`, `admin.html`).
- [x] Imports rotos: 0.
- [x] Módulos huérfanos: 0.
- [x] Exports públicos sin uso: 0 tras ocultar helpers internos que no se importan desde otros módulos.
- [x] Ciclos eliminados fuera de Armas: Logs/Auth/Field Config quedaron desacoplados por callbacks (`registerAdminUiRefreshHandler`, `setCategoryFiltersChangedHandler`, `setFieldConfigSavedHandler`).
- [x] `drafts-list.js` separa la lista de borradores de Admin del formulario/autoguardado de Logs.
- [x] `logs-data.js` separa carga pura de datos de Logs del render de tarjetas/modales.
- [x] `loadCategoriesData()` separa carga pura de categorías del render de filtros/selects.
- [x] Exportaciones desde Admin ya no asumen que Logs, Categorías o Armas fueron cargados por otra página: `exportData()` carga datos frescos antes de JSON/XLSX.
- [x] Importaciones desde Admin cargan datos base antes de detectar conflictos, para evitar falsos "no hay conflicto" en multipágina.
- [x] CSS auditado: 15 clases marcadas como posibles no usadas, todas dinámicas o condicionales conocidas (`toast-success`, `toast-error`, `is-liked`, `is-conflict`, `wm-image`, etc.); no se eliminó CSS inseguro.
- [x] HTML básico validado para las 5 páginas, `asset-view.html` y los 2 partials.
- [x] Servidor local estático levantado en `http://127.0.0.1:4173/`.
- [x] HTTP 200 verificado en páginas, partials, entrypoints JS y `css/style.css`.
- [x] `node --check` pasa en todos los `.js`.
- [x] `git diff --check` pasa sin errores de whitespace.

Verificado por scripts/local:

- `node --check` sobre todos los JS.
- Grafo local de imports estáticos: `CYCLES 0` tras la primera pasada de Optimización General.
- `work/audit-exports.cjs`: `UNUSED_EXPORTED_SYMBOLS 0`.
- `work/check-html.cjs`: todas las páginas y partials `OK`.
- `work/audit-css.cjs`: sin eliminación segura pendiente.
- Cierre real de dependencias de `js/pages/admin.js`: 28 módulos, `drafts.js` ya no está incluido; solo `drafts-list.js`.

Pendiente porque requiere navegador vivo, credenciales admin o servicios externos:

- [x] Smoke test manual completo en navegador real. El navegador interno de Codex se intentó dos veces contra `127.0.0.1:4173`, pero quedó bloqueado por timeout de herramienta; no se usó como verificación final.
- [x] Login admin con código real del bot.
- [x] Crear/editar/borrar Log con mobs/items/bloques libres y confirmar Realtime desde otra pestaña.
- [x] Likes y comentarios con datos reales de Supabase.
- [x] Storage: subir/quitar imágenes en Logs, Tierlist, Armas, fondo y favicon.
- [x] Exportar JSON/XLSX de Logs, Tierlist y Todo, abrir el XLSX en Excel/Google Sheets y validar hojas visualmente.
- [x] Importar JSON con conflictos reales y confirmar resolución overwrite/skip.
- [x] Discord Bot: `/ping`, `/getcode`, `/setlogchannel`, screenshots de logs/tierlist/arma, publicación/edición automática de logs y rotación diaria del código.

### Prioridad 2 — Sistema Multimedia

Objetivo: convertir el manejo de imágenes actual en una infraestructura multimedia centralizada, reutilizable y preparada para crecer. Esta prioridad no debe tratarse como un simple "subidor de imágenes", sino como una capa base del proyecto.

Implementado en repo:

- [x] `sql/migration_011_media_library.sql` crea `media_assets`, amplía MIME/tamaño del bucket y agrega RPCs admin-gated.
- [x] `sql/migration_012_media_library_archive_cleanup.sql` agrega borrado definitivo admin-gated para recursos archivados.
- [x] `sql/migration_013_media_picker_light_list.sql` agrega listado liviano paginado para el Selector Multimedia.
- [x] `js/core/media.js` centraliza MIME, tipo dinámico, hash SHA-256, duplicados, Storage path helpers y RPCs.
- [x] `js/core/storage.js` mantiene `uploadImageToStorage()` compatible y agrega `uploadMediaToStorage()`.
- [x] `js/features/media-library-helpers.js` separa helpers puros de Multimedia: normalización de presentación, filtros, orden, previews y normalización de assets livianos.
- [x] Biblioteca Multimedia en `admin.html` con buscador, filtros, vista previa, metadatos, usos detectados, archivado y subida de recursos propios.
- [x] Selector multimedia reutilizable en Logs, Tierlist, Guía de Armas, About, fondo y favicon.
- [x] Soporte de imagen ampliado: PNG, JPG/JPEG, WEBP, GIF, SVG y APNG.
- [x] Modelo y bucket preparados para MP4/WEBM desde la biblioteca.
- [x] Duplicados por hash al subir archivos registrados.
- [x] Recursos externos reintroducidos desde el selector como URL temporal por uso, sin registro permanente en biblioteca.
- [x] Presentación guardada por recurso: `fit`, `position`, `repeat`, `opacity`.
- [x] Fondo guarda `background_config.presentation` por uso para aplicar fit, posición, repetición y opacidad.
- [x] Biblioteca Multimedia tiene vista de Archivados con restauración, borrado definitivo, modal propio de confirmación y advertencia de usos.
- [x] Biblioteca minimizable y render progresivo para evitar pintar listas grandes completas.
- [x] Selector multimedia optimizado para uso real: modo liviano separado, RPC mínima paginada, cache temporal, sin indexar usos al abrir, sin cargar archivados/metadatos administrativos, `loading="lazy"`/`decoding="async"`, búsqueda con debounce y carga incremental sin reconstruir todo al pulsar "Mostrar mas".
- [x] Primera pasada de optimización: `media-library.js` queda más liviano y el grid de Biblioteca/Selector usa delegación de eventos para evitar listeners por tarjeta.
- [x] Export/import de backup completo incluye `media_assets`; Excel completo añade hoja `Multimedia`.
- [x] UI nueva de P2 ya usa identidad visual de P3: negros profundos, blanco principal y morado `#7C3AED`.
- [x] Compatibilidad mantenida con `image_url`: los formularios siguen guardando URLs.

Checklist manual para comprobar:

- [x] Ejecutar `sql/migration_011_media_library.sql` en Supabase.
- [x] Ejecutar `sql/migration_012_media_library_archive_cleanup.sql` en Supabase.
- [x] Ejecutar `sql/migration_013_media_picker_light_list.sql` en Supabase para activar el modo selector rápido.
- [x] Entrar a Herramientas con código admin real y verificar que la Biblioteca Multimedia carga sin aviso de migración faltante.
- [x] Subir PNG, JPG/JPEG, WEBP, GIF, SVG y APNG desde la biblioteca.
- [x] Subir dos veces el mismo archivo y confirmar que se reutiliza por duplicado/hash.
- [x] Registrar una URL externa y comprobar MIME/tipo/fallback..
- [x] Registrar una URL externa y comprobar preview antes de usarla.
- [x] Usar el selector en mob, item, bloque libre, tierlist, arma, rango, material de receta, resultado de receta, About, fondo y favicon.
- [x] Pulsar "Indexar usados" y confirmar que muestra usos actuales.
- [x] Editar nombre, descripción, tags y opciones de presentación de un recurso.
- [x] Elegir un fondo desde la biblioteca y comprobar fit, posición, repetición y opacidad.
- [x] Minimizar la Biblioteca Multimedia, confirmar que desaparece el grid, expandir y comprobar búsqueda/filtros/orden.
- [ ] Con Live Server, abrir el selector multimedia desde Logs, Tierlist, Guía de Armas, About, fondo y favicon; comprobar que abre fluido, muestra tarjetas compactas, filtra/busca sin lag perceptible y "Mostrar mas" agrega recursos sin parpadeo completo.
- [x] Archivar un recurso, verlo en Archivados, restaurarlo y comprobar que vuelve a la biblioteca principal.
- [x] Intentar eliminar definitivamente un recurso archivado con usos y confirmar que el modal advierte dónde se usa.
- [x] Exportar backup JSON/XLSX completo y confirmar `media_assets` / hoja `Multimedia`.
- [x] Importar un backup completo con multimedia y revisar resolución de conflictos.

#### Visión

El Sistema Multimedia debe ser una de las bases de Culones RPG.

No quiero volver a crear un sistema de subida de imágenes para cada módulo. Quiero una única infraestructura reutilizable que gestione todos los recursos multimedia del proyecto.

A partir de esta implementación, ningún módulo debería preocuparse por cómo se obtiene un recurso. Logs, Guía de Armas, Tierlist, Fondo, Favicon, Acerca del Server y cualquier sección futura deberán utilizar la misma capa multimedia.

El sistema debe ser cómodo para el administrador, claro para el usuario, fácil de mantener para el desarrollador y preparado para crecer sin rediseñar la arquitectura.

#### Filosofía

No quiero un simple selector de imágenes.

Quiero una Biblioteca Multimedia profesional, parecida al gestor de recursos de un CMS moderno.

Debe existir un único lugar donde se administren todos los recursos propios del proyecto.

Toda nueva sección que necesite imágenes, GIFs, vídeos, iconos, fondos o cualquier otro recurso deberá reutilizar esta misma infraestructura.

#### Relación con la Prioridad 3

Todo componente visual nuevo del Sistema Multimedia forma parte del entorno administrativo y debe respetar desde el inicio la identidad visual definida en la Prioridad 3.

La Biblioteca Multimedia, modales, botones, buscadores, filtros, tarjetas, formularios, previews, estados de carga, errores y confirmaciones deben usar desde ahora la estética del modo administrador:

- Negros profundos.
- Blanco para información principal.
- Morado principal `#7C3AED`.
- Variaciones moradas para profundidad y dinamismo.

La Prioridad 3 deberá perfeccionar y ampliar esa experiencia, no reconstruir la interfaz multimedia desde cero.

#### Dos sistemas independientes

El Sistema Multimedia debe dividirse en dos conceptos separados:

1. Biblioteca Multimedia.
2. Recursos Externos.

Ambos se eligen desde la misma interfaz, pero no significan lo mismo.

##### Biblioteca Multimedia

La Biblioteca Multimedia contiene únicamente recursos propios del proyecto.

Todo recurso de la biblioteca debe:

- Estar almacenado en Supabase Storage.
- Tener un registro en la base de datos.
- Poder reutilizarse.
- Poder editarse.
- Poder buscarse.
- Poder filtrarse.
- Poder seleccionarse desde cualquier módulo.

Nunca debería ser necesario subir dos veces el mismo recurso si ya existe en la biblioteca.

##### Recursos Externos

Los Recursos Externos son enlaces pegados manualmente por el administrador.

No pertenecen a la Biblioteca Multimedia.

Solo representan un enlace utilizado por un elemento concreto.

No deben:

- aparecer en la biblioteca,
- aparecer en búsquedas internas,
- ocupar espacio en Supabase Storage,
- reutilizarse automáticamente,
- generar registros multimedia permanentes.

Su objetivo es ofrecer flexibilidad.

Ejemplos:

- Video de YouTube.
- Imagen externa.
- GIF externo.
- PDF externo.
- Enlace web.
- Cualquier recurso que el administrador quiera usar bajo su responsabilidad.

#### Selector Multimedia

Todos los módulos deben usar el mismo selector reutilizable.

No deben existir selectores distintos para Logs, Armas, Tierlist, About o Fondo.

Cuando el administrador necesite escoger un recurso, debe aparecer una interfaz con dos opciones:

- Biblioteca Multimedia.
- Recurso Externo.

Si elige Biblioteca Multimedia, se abre el explorador de recursos.

Si elige Recurso Externo, aparece un campo para pegar un enlace y generar una vista previa.

#### Modal Biblioteca Multimedia

El modal de Biblioteca Multimedia debe ser un componente reutilizable.

Desde este modal el administrador podrá:

- Buscar recursos.
- Filtrar por tipo.
- Ordenar.
- Ver los más recientes primero por defecto.
- Seleccionar un recurso existente.
- Subir un recurso nuevo.
- Editar metadatos.
- Eliminar recursos cuando sea seguro.
- Ver vista previa.
- Ver información del archivo.
- Ver dónde se utiliza.
- Reutilizar recursos existentes.

Todo debe poder hacerse sin abandonar el modal.

#### Modelo de datos

Internamente, el sistema no debe pensar en imágenes.

Debe pensar en Recursos Multimedia.

Cada recurso debería almacenar al menos:

- ID.
- Nombre visible.
- MIME Type.
- Tipo.
- Descripción opcional.
- URL interna.
- Origen.
- Fecha de subida.
- Tamaño.
- Dimensiones.
- Hash.
- Metadatos.
- Usuario creador, si en el futuro existe sistema de usuarios.

El nombre visible nunca debe depender del nombre real del archivo.

#### Tipos dinámicos

Los tipos de recursos no deben estar escritos de forma fija en el código.

Deben ser dinámicos y administrables.

Ejemplos:

- Fondo.
- Logo.
- Banner.
- Arma.
- NPC.
- Enemigo.
- Evento.
- Icono.
- Decoración.
- Otro.

El administrador debe poder crear nuevos tipos en el futuro.

#### Formatos soportados

El sistema debe identificar el contenido mediante MIME Type.

No debe depender únicamente de la extensión del archivo.

Compatibilidad inicial:

- PNG.
- JPG.
- JPEG.
- WEBP.
- GIF.
- SVG.
- APNG.

Preparado para:

- MP4.
- WEBM.
- Audio.
- PDF.
- Modelos 3D.
- Otros formatos soportados por el navegador.

#### Vista previa inteligente

La vista previa debe adaptarse automáticamente al tipo de recurso.

- Imagen → miniatura.
- GIF → reproducción.
- Vídeo → preview o reproductor.
- PDF → icono o miniatura.
- Página web → tarjeta cuando sea posible.
- Tipo desconocido → tarjeta genérica con metadatos básicos.

El administrador no debería tener que indicar manualmente cómo se muestra cada recurso.

#### Reutilización y duplicados

Uno de los objetivos principales es evitar duplicados.

Idealmente el sistema detectará duplicados mediante hash.

Si un archivo ya existe, debe avisar:

> Este recurso ya existe. ¿Deseas reutilizarlo?

Esto evita llenar Supabase Storage con copias innecesarias del mismo archivo.

#### Dónde se utiliza cada recurso

Cada recurso debe poder indicar dónde se está usando.

Ejemplos:

- Log #31.
- Tierlist.
- Arma MK V.
- Fondo principal.
- Bloque de About.

Esto ayuda a evitar eliminar recursos importantes por accidente.

#### Configuración por uso

El recurso multimedia nunca debe guardar información de presentación global.

La configuración visual pertenece al lugar donde se usa el recurso, no al recurso en sí.

Cada uso podrá definir:

- Opacidad.
- Fit.
- Posición.
- Repetición.
- Escala en el futuro.
- Velocidad para GIF o vídeo cuando sea posible.
- Otros comportamientos futuros.

Ejemplo: una misma imagen puede usarse como icono, fondo o banner con configuraciones distintas.

#### Compatibilidad con el sistema actual

No romper el sistema actual.

Durante la transición, los campos actuales basados en `image_url` deben seguir funcionando.

La migración debe ser progresiva.

Los formularios existentes deben poder recibir una URL devuelta por el nuevo selector multimedia sin romper su flujo actual.

#### Escalabilidad

La arquitectura debe permitir integrar en el futuro:

- Videos.
- Audio.
- Modelos 3D.
- Embeds.
- Sketchfab.
- YouTube.
- Spotify.
- Twitch.
- Otros proveedores externos.

Esto debe poder hacerse sin rediseñar el sistema.

#### Resultado esperado

El Sistema Multimedia debe convertirse en la fuente oficial de recursos del proyecto.

Si en el futuro se añade un nuevo módulo, la respuesta nunca debe ser "crear otro sistema de imágenes", sino reutilizar el Sistema Multimedia existente.

---

### Prioridad 3 — Rediseño completo de la Interfaz del Administrador

Objetivo: mejorar la experiencia visual y de uso del modo administrador sin modificar la lógica real de autenticación, Supabase, RPC, permisos ni bot de Discord.

Estado local inicial:

- [x] Login de admin convertido en modal tipo terminal con secuencia: inicialización, conexión, verificación de permisos y espera de autenticación.
- [x] Estados visuales `ACCESS GRANTED` y `ACCESS DENIED` agregados sin cambiar la RPC `validate_admin_code`.
- [x] Indicador permanente `Administrator Mode` en el HUD cuando hay sesión admin activa.
- [x] Botón Admin cambia visualmente entre `ADMIN` y `LOGOUT`, manteniendo la lógica existente.
- [x] Botones administrativos y paneles de Herramientas adoptan identidad negro/blanco/morado `#7C3AED`.
- [x] Confirmaciones críticas migradas de `confirm()` nativo a modal propio reutilizable (`confirmAction`) para borrar/limpiar/quitar/restaurar según corresponda.
- [x] Animaciones discretas de entrada, glow, loading, granted/denied y hover/click en rango 150–300ms.
- [x] No se tocaron autenticación real, Supabase, RPCs existentes, permisos ni bot de Discord.

Checklist manual de validación P3:

- [x] Abrir Live Server local y verificar que GitHub Pages/deploy no se usa para QA.
- [x] Pulsar `ADMIN` sin sesión activa y confirmar que aparece el modal terminal.
- [x] Confirmar que la secuencia muestra: `Inicializando sistema...`, `Conectando...`, `Verificando permisos...`, `Esperando autenticación...`.
- [x] Ingresar código inválido y confirmar `ACCESS DENIED`, vibración/destello rojo corto, botón vuelve de loading y el modal no se cierra.
- [x] Ingresar código válido real del bot y confirmar `ACCESS GRANTED`, glow morado, cierre suave y activación de sesión.
- [x] Confirmar que aparece el badge `Administrator Mode` en el HUD y el botón cambia a `LOGOUT`.
- [x] Confirmar que cerrar sesión con `LOGOUT` oculta badge, herramientas admin-only y vuelve a portada si estás en `admin.html`.
- [x] Revisar visualmente `admin.html`: Biblioteca Multimedia, Borradores, Exportar, Importar, Fondo y Favicon deben verse coherentes con negro profundo/blanco/morado.
- [ ] Probar hover/click/disabled/loading en botones administrativos principales.
- [x] Ejecutar acciones críticas y confirmar que usan modal propio: borrar log, borrar comentario, borrar fila/elemento tierlist, borrar arma/rango/habilidad/sección, quitar receta, borrar categorías/tipos, quitar fondo y limpiar borradores.
- [x] Confirmar que las acciones críticas canceladas no ejecutan RPC ni modifican datos.
- [x] Confirmar que las acciones críticas aceptadas mantienen el comportamiento funcional anterior.
- [ ] Revisar en móvil/ancho estrecho que el badge `Administrator Mode`, modal de login y confirmaciones no se desbordan ni pisan otros elementos.
- [x] Confirmar que los toasts de éxito en modo admin se sienten coherentes con la identidad morada.

#### Objetivo visual

El modo administrador debe sentirse como una experiencia claramente diferenciada del resto de la página.

No debe sentirse como un simple formulario de login.

Debe sentirse como el acceso a un entorno exclusivo de administración, transmitiendo:

- Seguridad.
- Control.
- Profesionalismo.
- Tecnología.
- Exclusividad.

Esta prioridad se centra en UX y UI, no en cambiar la lógica interna del sistema.

#### Identidad visual

Inspiración:

- Consola futurista.
- Panel de control premium.
- HUD tecnológico.
- Terminal moderna.

No debe parecer una terminal hacker clásica con texto verde sobre fondo negro.

La apariencia debe ser limpia, elegante y consistente con Culones RPG.

#### Paleta de colores

Color principal:

```text
#7C3AED
```

Usar el morado principal para:

- Bordes activos.
- Botones principales.
- Indicadores.
- Focus.
- Glow.
- Barras de progreso.
- Estados activos.
- Elementos interactivos.
- Animaciones de éxito.

Variaciones permitidas:

```text
#6D28D9
#8B5CF6
#A78BFA
```

Estas variaciones deben sentirse como niveles de iluminación del mismo color, no como colores distintos.

Fondos recomendados:

```text
#0B0B0F
#111018
#161322
```

Usar negros profundos con matiz morado.

El blanco debe reservarse para:

- Texto principal.
- Iconografía.
- Información importante.
- Estados críticos.

#### Login tipo terminal

Al pulsar **Admin**, debe abrirse un modal dedicado, no un formulario común.

El modal debe mostrar una pequeña secuencia:

- Inicializando sistema...
- Conectando...
- Verificando permisos...
- Esperando autenticación...

Después aparece el campo para introducir el código generado por el bot.

#### Estados del campo de código

Normal:

- Borde oscuro.
- Sin efectos llamativos.

Focus:

- Borde morado.
- Glow morado suave.

Error:

```text
ACCESS DENIED
```

Debe incluir:

- Destello rojo.
- Pequeña vibración.
- Mensaje corto.
- Nada de errores largos.

Correcto:

```text
ACCESS GRANTED
```

Debe incluir:

- Iluminación morada.
- Animación breve.
- Cierre suave del modal.
- Transición al modo administrador.

#### Modo Administrador

Cuando el usuario esté autenticado, la interfaz debe comunicar claramente que está en modo administrador.

Agregar:

- Badge "Administrator Mode".
- Indicador permanente.
- Detalles morados distribuidos en la interfaz.
- Estados visuales especiales en elementos admin-only.

Debe sentirse premium, pero no exagerado.

#### Botones administrativos

Todos los botones de administración deben compartir el mismo lenguaje visual.

Hover:

- Borde morado.
- Glow suave.
- Transición breve.

Click:

- Ligera reducción de escala.
- Feedback inmediato.

Loading:

- Spinner morado.
- Botón deshabilitado temporalmente.

Success:

- Toast o confirmación visual consistente.

#### Acciones críticas

Acciones como:

- Eliminar.
- Limpiar.
- Importar.
- Sobrescribir.
- Restaurar.

deben usar modales propios del proyecto.

No usar `alert()` del navegador.

#### Animaciones

Priorizar animaciones discretas:

- Opacidad.
- Escala.
- Glow.
- Fade.
- Desplazamientos cortos.

Duración recomendada:

```text
150ms – 300ms
```

Evitar animaciones largas o innecesarias.

#### Consistencia técnica

No modificar:

- Sistema de autenticación.
- Bot de Discord.
- Funciones RPC.
- Supabase.
- Flujo de permisos.
- Arquitectura principal.

El objetivo es mejorar exclusivamente la presentación y la experiencia.

#### Relación con el Sistema Multimedia

Todo componente nuevo del Sistema Multimedia debe seguir esta identidad visual desde su primera implementación.

La Biblioteca Multimedia debe sentirse como una herramienta del entorno administrador, no como un modal genérico desconectado del resto.

#### Resultado esperado

El administrador debe sentir que ha desbloqueado una versión avanzada de la aplicación.

La interfaz debe transmitir exclusividad, profesionalismo, seguridad y tecnología, manteniendo la identidad visual de Culones RPG sin alterar la arquitectura existente.

### Prioridad 4 — v2.x

Objetivo: mejoras de capa superior una vez cerradas auditoría, multimedia y admin UX.

- GSAP para microanimaciones.
- Dashboard con estadísticas.
- Ampliar Sistema Multimedia con vídeo, audio u otros tipos.
- PWA / caché offline como mejora opcional.

## Sesion 2026-07-09 - Kits y bot de logs extensos

- Se inicio la pestaña `Kits` como modulo propio reutilizando el patron visual de Tierlist: columnas fijas Arma / Accesorio / Sub-arma, cards publicas y editor admin.
- Nueva migracion pendiente de aplicar: `sql/migration_016_kits.sql`.
- El editor de kits usa selector multimedia en modo selector para elegir imagenes por slot.
- `kits.html`, `css/kits.css`, `js/pages/kits.js` y `js/features/kits.js` quedan como base funcional.
- El fondo configurable ya incluye la pestaña `kits`.
- El bot extraido desde `culones-bot-main.zip` recibio un fix defensivo en `src/utils/embeds.js`: los logs extensos se compactan para no exceder limites de embeds de Discord.
- Pendiente: probar en Discord real con un log largo y desplegar el bot corregido desde su repositorio/carpeta real.

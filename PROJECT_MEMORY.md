# PROJECT_MEMORY — culones-rpg

Registro de sesiones de desarrollo. Cada entrada resume qué se hizo, qué quedó pendiente y qué problemas se conocen. Pensado para que cualquier sesión futura pueda retomar el proyecto sin releer todo el código.

---

# Estado actual del proyecto (tras auditoría local post-refactor)

## Arquitectura general

- **Web**: sitio estático multipágina (MPA) HTML/CSS/JS. Sin backend propio, sin bundler, sin build step. Desplegado en GitHub Pages.
- **JS**: ES Modules nativos (`<script type="module">`). Ver **"Arquitectura de páginas (sesión 20)"** para la navegación real entre `.html`, y **"Arquitectura del código JS (sesión 19)"** para el detalle de los módulos de `js/features/` y `js/core/` (siguen intactos, solo cambió *quién* los importa).
- **Base de datos**: Supabase (Postgres). Toda la lógica sensible protegida por RLS + funciones RPC con `security definer` que validan el código de admin antes de actuar.
- **Imágenes**: Supabase Storage, bucket `culones` (público de lectura). La subida va siempre por `uploadImageToStorage()` en el frontend — nunca por URL externa (opción eliminada en sesión 17/18).
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
│   └── storage.js               # Supabase Storage: subida/preview/dropzones de imagen
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
│   └── admin-panel.js           # Cableado de la página 🛠 Herramientas (export/import/drafts/fondo/favicon)
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

### Dependencias circulares (intencionales / conocidas)

La auditoría post-refactor confirmó que no hay imports rotos ni módulos huérfanos. También se eliminaron dos ciclos innecesarios del área de Logs (`logs.js` ↔ `blocks-editor.js` y `logs.js` ↔ `categories.js`). Los ciclos que quedan están acotados al subsistema de Guía de Armas, donde la UI tiene un ciclo real render↔acción: abrir el detalle de un arma dispara acciones admin que a su vez recargan datos y vuelven a renderizar el catálogo/detalle.

En la misma auditoría se limpió la superficie pública de los módulos: las funciones/constantes que solo se usan dentro de su propio archivo dejaron de exportarse. El grafo queda con **0 imports rotos**, **0 módulos huérfanos** y **0 exports sobrantes**.

ES Modules soporta estos ciclos porque las referencias cruzadas se usan dentro de funciones, no durante la evaluación inicial del módulo. Aun así, quedan registrados como deuda técnica de arquitectura:

- `weapons-detail.js` ↔ `weapons-admin.js`.
- `weapons-catalog.js` ↔ `weapons-detail.js` ↔ `weapons-admin.js`.
- Ciclos más largos entre `weapons-data.js`, `weapons-catalog.js`, `weapons-catalog-admin.js`, `weapons-detail.js` y `weapons-admin.js`.

No se consideran bloqueantes ahora mismo, pero si la Guía de Armas crece conviene introducir una capa de eventos/callbacks o un pequeño coordinador para separar render, carga de datos y acciones admin.

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

- **Ciclos restantes en módulos de Armas**: el grafo de imports ya no tiene módulos huérfanos ni imports rotos, pero quedan 5 ciclos internos entre `weapons-data.js`, `weapons-catalog.js`, `weapons-detail.js`, `weapons-admin.js` y `weapons-catalog-admin.js`. Funcionan hoy, pero conviene partir datos/UI/admin en una pasada dedicada antes de crecer mucho esa sección.
- **`saveRankPatch` envía objeto completo**: en vez de hacer un PATCH parcial, manda todos los campos del rango en cada edición. Funciona bien ahora que el `SELECT` trae todos los campos, pero si se agrega una columna nueva a `weapon_ranks` y se olvida añadirla al `select()` de `reloadWeaponData()`, puede causar pérdida silenciosa de datos al guardar. Solución correcta: cambiar a updates parciales por campo.
- **Modal de habilidades hace demasiadas consultas**: cada edición de habilidad recarga todo el arma.
- **Borradores no sincronizados entre dispositivos**: la tabla `drafts` en Supabase existe pero no está conectada al frontend. Los borradores solo existen en localStorage del navegador actual.

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

- Decidir si los borradores seguirán solo en localStorage o si se conectarán a la tabla `drafts` de Supabase.
- Verificar que las hojas de Excel de exportación de Tierlist y "Todo" reflejan las columnas actuales.
- Optimizar el modal de habilidades de armas para no recargar todo el arma en cada edición.
- Cambiar `saveRankPatch()` a updates parciales por campo para evitar pérdida silenciosa de datos si `weapon_ranks` crece en el futuro.

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
- `work/audit-imports.cjs`: `IMPORT_PROBLEMS 0`, `ORPHAN_MODULES 0`, `CYCLES 5` (los 5 ciclos conocidos de Armas).
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

### Prioridad 2 --- Sistema Multimedia (Especificación Definitiva)

#### Visión

Quiero que el Sistema Multimedia sea una de las bases del proyecto, no
una función más.

No quiero volver a crear un sistema de subida de imágenes para cada
módulo. Quiero construir una única infraestructura reutilizable que
gestione absolutamente todos los recursos multimedia del proyecto.

A partir de esta implementación, ningún módulo deberá preocuparse por
cómo se obtiene un recurso. Logs, Guía de Armas, Tierlist, Fondo,
Favicon, Acerca del Server y cualquier sistema futuro deberán utilizar
exactamente la misma capa.

El objetivo es construir un sistema preparado para crecer durante años
sin tener que rediseñarlo.

------------------------------------------------------------------------

#### Filosofía

No quiero un "subidor de imágenes".

Quiero una Biblioteca Multimedia profesional.

Debe sentirse como el administrador de recursos de un CMS moderno.

Debe existir un único lugar donde se administren todos los recursos
propios del proyecto.

Toda mejora futura deberá integrarse aquí.

------------------------------------------------------------------------

#### Dos sistemas independientes

##### Biblioteca Multimedia

Contiene únicamente recursos propios del proyecto.

Todo recurso deberá:

-   Estar almacenado en Supabase Storage.
-   Tener registro en la base de datos.
-   Poder reutilizarse.
-   Poder editarse.
-   Poder buscarse.
-   Poder filtrarse.

Nunca deberá ser necesario subir dos veces el mismo recurso.

------------------------------------------------------------------------

#### Recursos Externos

Debe existir una segunda opción completamente independiente.

Los recursos externos NO pertenecen a la biblioteca.

Solo representan un enlace utilizado por un elemento concreto.

No deben:

-   aparecer en búsquedas,
-   ocupar espacio en la biblioteca,
-   reutilizarse automáticamente,
-   generar registros multimedia.

Su objetivo es ofrecer flexibilidad.

------------------------------------------------------------------------

#### Selector Multimedia

Todos los módulos utilizarán el mismo selector.

Nunca existirán selectores diferentes para Logs, Armas, Tierlist o
cualquier otra sección.

Al pulsar un recurso aparecerá:

○ Biblioteca Multimedia ○ Recurso Externo

Biblioteca abre el explorador multimedia.

Recurso Externo muestra un campo para pegar un enlace.

------------------------------------------------------------------------

#### Modal Biblioteca Multimedia

Debe ser un componente reutilizable.

Desde aquí el administrador podrá:

-   Buscar.
-   Filtrar.
-   Ordenar.
-   Seleccionar.
-   Subir.
-   Editar metadatos.
-   Eliminar.
-   Ver vista previa.
-   Ver información.
-   Ver dónde se utiliza.
-   Reutilizar recursos existentes.

Todo sin abandonar el modal.

------------------------------------------------------------------------

#### Modelo de datos

El sistema internamente no debe pensar en imágenes.

Debe pensar en Recursos Multimedia.

Cada recurso debería almacenar al menos:

-   ID
-   Nombre visible
-   MIME Type
-   Tipo
-   Descripción
-   URL
-   Origen
-   Fecha de subida
-   Peso
-   Dimensiones
-   Hash
-   Metadatos
-   Usuario creador (si existe en el futuro)

El nombre visible nunca dependerá del nombre físico del archivo.

------------------------------------------------------------------------

#### Tipos

Los tipos no deben estar escritos en el código.

Deben ser dinámicos.

Ejemplos:

-   Fondo
-   Logo
-   Banner
-   Arma
-   NPC
-   Enemigo
-   Evento
-   Icono
-   Decoración
-   Otro

El administrador podrá crear nuevos tipos.

------------------------------------------------------------------------

#### Compatibilidad

El sistema debe identificar el contenido mediante MIME Type.

Nunca mediante la extensión del archivo.

Compatibilidad inicial:

-   PNG
-   JPG
-   JPEG
-   WEBP
-   GIF
-   SVG
-   APNG

Preparado para:

-   MP4
-   WEBM
-   Audio
-   PDF
-   Modelos 3D
-   Otros formatos soportados por el navegador.

------------------------------------------------------------------------

#### Vista previa inteligente

La vista previa debe adaptarse automáticamente.

Imagen → miniatura.

GIF → reproducción.

Vídeo → preview.

PDF → icono o miniatura.

Página web → tarjeta si es posible.

No quiero que el administrador tenga que indicar el tipo manualmente.

------------------------------------------------------------------------

#### Reutilización

El objetivo principal es evitar duplicados.

Idealmente se detectarán mediante hash.

Si el archivo ya existe:

"Este recurso ya existe. ¿Deseas reutilizarlo?"

------------------------------------------------------------------------

#### Dónde se utiliza

Cada recurso debe indicar todas sus referencias.

Ejemplo:

-   Log #31
-   Tierlist
-   Arma MK V
-   Fondo principal

Así nunca se eliminará accidentalmente un recurso importante.

------------------------------------------------------------------------

#### Configuración por uso

El recurso multimedia nunca debe almacenar información de presentación.

Cada elemento que lo utilice podrá definir:

-   Opacidad
-   Fit
-   Posición
-   Repetición
-   Escala (futuro)
-   Velocidad (para GIF o vídeo)
-   Comportamientos futuros

Esto pertenece al uso, no al recurso.

------------------------------------------------------------------------

#### Arquitectura

No quiero que ningún módulo gestione imágenes directamente.

Todos deberán solicitar recursos al Sistema Multimedia.

El selector será un componente único reutilizable.

Cualquier nueva sección deberá integrarse automáticamente utilizando
esta misma infraestructura.

------------------------------------------------------------------------

#### Compatibilidad

No romper el sistema actual.

Mantener compatibilidad con image_url durante la transición.

La migración deberá ser progresiva.

------------------------------------------------------------------------

#### Escalabilidad

La arquitectura debe permitir integrar en el futuro:

-   Vídeos
-   Audio
-   Modelos 3D
-   Embeds
-   Sketchfab
-   YouTube
-   Spotify
-   Twitch
-   Cualquier otro proveedor

Sin rediseñar el sistema.

------------------------------------------------------------------------

#### Objetivo final

Quiero construir una infraestructura multimedia definitiva.

Debe ser cómoda para el administrador, escalable para el desarrollador y
suficientemente flexible para soportar nuevas funciones durante muchos
años.

Si en el futuro se añade un nuevo módulo, la respuesta nunca debería ser
"crear otro sistema de imágenes", sino simplemente reutilizar el Sistema
Multimedia existente.


### Prioridad 3 --- Rediseño completo de la Interfaz del Administrador

#### Objetivo

El modo administrador debe convertirse en una experiencia claramente
diferenciada del resto de la página. No debe sentirse como un simple
formulario de autenticación, sino como el acceso a un entorno exclusivo
de administración, transmitiendo seguridad, control y profesionalismo
sin romper la identidad visual actual de Culones RPG.

Esta prioridad se centra únicamente en la experiencia de usuario (UX) y
la interfaz (UI). No debe modificar la lógica de autenticación
existente, el funcionamiento del bot de Discord, Supabase ni la
arquitectura actual del proyecto.

#### Identidad visual

Inspiración: - Consola futurista. - Panel de control premium. - HUD
tecnológico. - Terminal moderna.

No debe parecer una terminal hacker clásica. La apariencia debe ser
limpia, elegante y consistente.

#### Paleta de colores

Color principal: #7C3AED

Usar para bordes activos, botones principales, indicadores, focus, glow,
barras de progreso, estados activos y elementos interactivos.

Variaciones permitidas: - #6D28D9 - #8B5CF6 - #A78BFA

Fondo: - #0B0B0F - #111018 - #161322

Blanco únicamente para texto principal, iconografía e información
importante.

#### Login

Al pulsar Admin debe abrirse un modal con una pequeña secuencia:

-   Inicializando sistema...
-   Conectando...
-   Verificando permisos...
-   Esperando autenticación...

Después aparece el campo para introducir el código.

Estados: - Normal. - Focus con borde y glow morado. - Error: ACCESS
DENIED con destello rojo y pequeña vibración. - Correcto: ACCESS GRANTED
con iluminación morada y transición al modo administrador.

#### Modo Administrador

Mostrar claramente: - Badge Administrator Mode. - Indicador
permanente. - Detalles morados distribuidos por la interfaz.

#### Botones

Hover: - Borde morado. - Glow suave.

Click: - Ligera reducción de escala.

Loading: - Spinner morado.

Success: - Toast consistente con la identidad visual.

#### Acciones críticas

Eliminar, limpiar, importar, sobrescribir y restaurar deben utilizar
modales propios. No usar alert().

#### Animaciones

Priorizar: - Opacidad. - Escala. - Glow. - Fade. - Desplazamientos
cortos.

Duración recomendada: 150--300 ms.

#### Consistencia

No modificar: - Sistema de autenticación. - Bot de Discord. - RPC. -
Supabase. - Flujo de permisos.

#### Resultado esperado

El administrador debe sentir que ha desbloqueado una versión premium del
sistema. La interfaz debe transmitir exclusividad, profesionalismo,
seguridad y tecnología, manteniendo la identidad visual de Culones RPG
sin alterar la arquitectura existente.


### Prioridad 4 — v2.x

Objetivo: mejoras de capa superior una vez cerradas auditoría, multimedia y admin UX.

- GSAP para microanimaciones.
- Dashboard con estadísticas.
- Ampliar Sistema Multimedia con vídeo, audio u otros tipos.
- PWA / caché offline como mejora opcional.


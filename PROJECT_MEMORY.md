# PROJECT_MEMORY — culones-rpg

Este archivo funciona como un registro de las sesiones de desarrollo del proyecto. La idea es dejar documentado qué se hizo, qué quedó pendiente y qué problemas siguen existiendo, para poder retomar el trabajo en cualquier momento sin tener que volver a revisar todo el código.

---

# Estado actual del proyecto (después de la sesión 17)

## Arquitectura general

- **Web:** Sitio estático hecho con HTML, CSS y JavaScript vanilla. No tiene backend propio y está desplegado en GitHub Pages.

- **Base de datos:** Se utiliza Supabase (Postgres). Toda la lógica sensible está protegida mediante RLS y funciones RPC con `security definer`, que validan el código de administrador antes de ejecutar cualquier acción.

- **Imágenes:** Se almacenan en Supabase Storage, dentro del bucket público `culones` (solo lectura para los usuarios). Todas las imágenes se suben desde el frontend usando `uploadImageToStorage()`. Desde la sesión 17 ya no existe la opción de utilizar URLs externas.

- **Bot de Discord:** Desarrollado con Node.js y discord.js, desplegado en Railway. Se conecta directamente a Supabase utilizando la `service_role`.

- **Autenticación de administrador:** No se utiliza Supabase Auth. En su lugar, el bot genera un código de 8 caracteres cada 24 horas, lo guarda en la tabla `admin_codes` junto con su fecha de expiración y ese código es el que permite acceder a las herramientas de administración.

---

## Pestañas de la web

| Pestaña | `data-tab` | Visible para |
|---|---|---|
| 📜 Logs | `logs` | Todos |
| ⚔️ Guía de Armas | `weapons` | Todos |
| 🏆 Tierlist | `tierlist` | Todos |
| 🎮 Acerca del Server | `about` | Todos |
| 🛠 Herramientas | `admin` | Solo administradores (permanece oculta por CSS hasta iniciar sesión) |

---

## Tablas de Supabase

| Tabla | Descripción | Migración |
|---|---|---|
| `logs` | Guarda los logs principales del servidor. | `schema.sql` |
| `comments` | Comentarios de cada log, incluyendo respuestas mediante `parent_id` y moderación con `hidden`. | `schema.sql` |
| `admin_codes` | Códigos temporales de administrador generados por el bot. | `schema.sql` |
| `log_likes` | Evita que un mismo cliente pueda dar más de un like al mismo log. | `schema.sql` |
| `categories` | Categorías dinámicas para los logs (`slug`, `label`, `emoji`, `color`). | `002` |
| `log_mobs` | Información de mobs asociada a un log (vida, daño, armadura, equipamiento, etc.). | `003` |
| `log_items` | Información de objetos asociados a un log (nombre, rango, tipo, fuente, etc.). | `003` |
| `comment_likes` | Sistema de likes para comentarios, incluyendo RPC para moderación. | `004` |
| `app_settings` | Configuración global de la aplicación (campos de fichas, configuraciones generales, etc.). | `004` |
| `action_log` | Bitácora de acciones realizadas por administradores. Solo permite inserciones y lectura mediante permisos de administrador. | `005` |
| `tierlist_rows` | Filas de la tierlist (nombre, color y orden). | `006` |
| `tierlist_items` | Elementos de la tierlist (`row_id` puede ser `null` para el banco, además de `column_key` e `image_url`). | `006` |
| `drafts` | Tabla pensada para guardar borradores en Supabase. Actualmente no se utiliza (ver sección correspondiente). | `007` |
| `weapon_categories` | Categorías de armas. | `008` |
| `weapon_types` | Tipos de armas. | `008` |
| `weapons` | Información general de cada arma (nombre, imagen, categoría, tipo y estado de publicación). | `008` |
| `weapon_ranks` | Rangos de cada arma, incluyendo descripción, estadísticas, habilidades, recetas de mejora y secciones adicionales almacenadas como JSONB. | `008` |

---

# Sistema de imágenes (estado actual - sesión 17)

Actualmente todo el proyecto utiliza un único sistema de subida de imágenes basado en Supabase Storage. Ya no existe ningún campo que permita pegar una URL externa; esa opción fue eliminada por completo durante la sesión 18, incluyendo los últimos tres casos que aún quedaban.

### Componentes principales

### `uploadImageToStorage(file, folder, oldUrl)`

Esta función valida que el archivo sea PNG, JPG o WEBP y que no supere los 3 MB. Después lo sube al bucket `culones` utilizando un nombre único (`folder/timestamp-random.ext`).

Cuando termina, devuelve la URL pública de la imagen y, si existía una imagen anterior dentro del mismo bucket, la elimina automáticamente en segundo plano.

### `initImageUploader(prefix, folder, getOldUrl)`

Se encarga de conectar el botón **📁 Elegir imagen** con su correspondiente `<input type="file" hidden>`.

La URL resultante se guarda dentro del `<input type="hidden" id="${prefix}-image-input">`, que es el valor que realmente utiliza el JavaScript al guardar los datos. El tipo del input nunca fue lo importante; lo que importa es la URL almacenada en ese campo oculto.

### `initGenericImageDropzone(...)`

Añadido en la sesión 18.

Es una versión reutilizable del sistema de drag & drop que ya utilizaba la tierlist. Se usa para elementos como el fondo de la página y el favicon, manteniendo el mismo comportamiento visual y el estado `has-image`.

### Estado actual

Todos los campos de imagen del proyecto funcionan ahora mediante:

- Botón **📁 Elegir imagen** (o dropzone).
- Vista previa.
- Botón **✕ Quitar imagen**.

El botón `btn-upload-img` sigue existiendo dentro del DOM únicamente porque `initImageUploader` todavía lo busca por ID, aunque permanece oculto (`display:none`) y nunca llega a verlo el usuario.

### Carpetas del bucket

Actualmente el bucket `culones` contiene las siguientes carpetas:

- `mobs/`
- `items/`
- `tierlist/`
- `weapons/`
- `weapon-ranks/`
- `recipes/`
- `backgrounds/`
- `favicons/`
- `about/`

Todas pertenecen al mismo bucket y no existen restricciones por carpeta a nivel de políticas RLS.

### Prefijos soportados

El sistema cubre actualmente los siguientes prefijos:

- `mob`
- `item`
- `libre`
- `tier-item`
- `weapon`
- `weapon-rank`
- `bg`
- `favicon`

Además, el resultado de las recetas (`weapon-recipe-result`) utiliza su propio uploader manual.

### Materiales de recetas

Cada fila creada dinámicamente en `renderRecipeMaterialsEditor` tiene su propio botón **📁 Imagen** con un input independiente para subir imágenes directamente a la carpeta `recipes/`.

### Bloques de imagen en "Acerca del Server"

Desde la sesión 18, cada bloque de tipo `image` dentro de `renderAboutEditorBlocks` cuenta con:

- Botón **📁 Elegir imagen**
- Input de archivo
- Miniatura
- Botón **✕ Quitar imagen**

Las imágenes se almacenan dentro de `about/`.

Anteriormente estos bloques utilizaban un simple `<input type="text">` donde había que pegar la URL manualmente.

### Fondo de página y favicon

También fueron migrados durante la sesión 18.

Antes utilizaban campos de texto (`bg-image-url-input` y `favicon-url-input`) para pegar URLs externas.

Ahora ambos utilizan dropzones que funcionan exactamente igual que el resto del sistema de imágenes y muestran una vista previa en tiempo real.

La tierlist ya utilizaba drag & drop desde antes, por lo que únicamente se eliminó el `<details>` que todavía permitía introducir URLs externas, completando así la migración del proyecto.

---

# Sistema de borradores

Actualmente existen **dos sistemas de borradores**. Ambos cumplen prácticamente la misma función, pero todavía no están conectados entre sí.

### 1. localStorage (el que realmente se usa)

Es el sistema activo y el que utiliza actualmente toda la aplicación.

Los borradores se guardan utilizando `draftKey(logId)`, generando claves como:

- `culones_draft_log_new`
- `culones_draft_log_${id}`

Cada borrador almacena:

- Título
- Descripción
- Categoría
- Relevancia
- Fecha
- Mobs
- Items
- Bloques libres

Mientras el modal de edición de un log permanece abierto, el sistema realiza un autoguardado cada 30 segundos. También guarda automáticamente al cerrar el modal.

Todos estos borradores aparecen dentro de la pestaña **🛠 Herramientas**, desde donde pueden recuperarse o eliminarse.

Actualmente este sistema funciona sin problemas, aunque únicamente para los logs.

### 2. Supabase (`drafts`)

También existe una tabla `drafts` creada mediante la migración 007.

Esta incluye las RPC:

- `save_draft`
- `list_drafts`
- `delete_draft`

Sin embargo, el frontend actual **nunca llega a utilizarlas**.

En algún momento la idea era sincronizar los borradores entre distintos dispositivos usando Supabase, pero esa integración nunca se terminó. Por ahora, la tabla simplemente existe, aunque no forma parte del flujo real de la aplicación.

### Pendiente

Hay que decidir una de estas dos opciones:

- Conectar definitivamente el sistema de `localStorage` con Supabase para sincronizar borradores entre dispositivos.
- O eliminar esa idea y dejar documentado que únicamente se utilizará `localStorage`, ya que es una solución mucho más sencilla.

---

# Sistema de comentarios

Los comentarios funcionan sin necesidad de iniciar sesión. Cada usuario simplemente escribe el alias que quiera utilizar.

### Respuestas

Los comentarios permiten un único nivel de respuestas.

Esto se controla mediante el campo `parent_id` de la tabla `comments`, que se asigna cuando el usuario utiliza el botón **Responder** dentro del modal del log.

### Likes

Los comentarios también cuentan con su propio sistema de likes.

Para ello existe la tabla `comment_likes`, junto con una RPC que se encarga de alternar el estado del like.

### Moderación

Los administradores disponen de herramientas para moderar comentarios.

Pueden:

- Ocultarlos o volver a mostrarlos mediante la RPC `set_comment_hidden`.
- Eliminarlos definitivamente.

Cuando un comentario está oculto, únicamente el administrador puede verlo marcado con la etiqueta **[OCULTO]**.

---

# Guía de Armas

La guía funciona como un catálogo completo de armas organizado mediante categorías y tipos dinámicos.

Cada arma puede tener varios rangos (`weapon_ranks`) y cada uno almacena su información utilizando JSONB.

Cada rango incluye:

- `stats`: estadísticas en formato clave/valor.
- `abilities`: habilidades con nivel y estadísticas propias.
- `upgrade_recipe`: receta de mejora (materiales → resultado).
- `extra_sections`: secciones libres pensadas para contenido futuro.

Los administradores pueden publicar u ocultar cualquier arma mediante el campo `published`.

Las armas ocultas únicamente son visibles para administradores.

### `saveRankPatch()`

Actualmente `saveRankPatch(rankId, patch)` envía el objeto completo del rango cada vez que se modifica cualquier dato.

No es la forma más eficiente, pero por ahora funciona correctamente (más abajo se explica por qué sigue siendo un punto pendiente).

### Vista de detalle

La información de cada arma no se muestra mediante un modal independiente.

En su lugar, la vista de detalle se abre directamente dentro del panel de armas utilizando:

- `openWeaponDetail()`
- `closeWeaponDetail()`

---

# Tierlist

La tierlist está formada por filas dinámicas y tres columnas fijas:

- Weapon
- Subweapon
- Accessory

Cada fila almacena:

- Nombre
- Color
- `sort_order`

Cuando un elemento tiene `row_id = null`, significa que todavía no pertenece a ninguna fila y permanece dentro del banco de **"Sin clasificar"**.

### Movimiento de elementos

En PC se utiliza el sistema nativo de Drag & Drop de HTML5.

En dispositivos móviles se utiliza el botón **↕ Mover a...**, ya que el drag & drop no resulta cómodo en pantallas táctiles.

### Sprites

Todas las imágenes utilizan:

```css
image-rendering: pixelated;
```

Esto permite conservar el estilo pixel art pensado para sprites de Minecraft.

Debajo de cada imagen también se muestra su nombre mediante la clase `.tier-chip-name`.

---

# Pestaña 🛠 Herramientas

Esta pestaña únicamente está disponible para administradores.

Actualmente reúne varias herramientas que antes estaban repartidas por distintas partes del proyecto.

## 📝 Borradores

Muestra todos los borradores guardados mediante `localStorage` en el dispositivo actual.

Desde aquí es posible:

- Recuperarlos.
- Eliminarlos individualmente.
- Limpiar todos los borradores de una sola vez.

## 📤 Exportar

Permite exportar la información tanto en **Excel (.xlsx)** como en **JSON**.

Los archivos de Excel se generan con varias hojas según el contenido exportado.

Por ejemplo:

- Logs
- Mobs
- Items
- Libres

En el caso de la tierlist también se generan hojas independientes para:

- Filas
- Elementos

La opción **Todo** reúne toda la información disponible.

Las armas utilizan su propio exportador mediante `exportAllXlsx`.

## 📥 Importar

Permite importar información desde archivos JSON.

Antes de aplicar cualquier cambio, el sistema analiza posibles conflictos y muestra un modal de confirmación con todo lo detectado para que el administrador decida si continuar.

## 🕒 Registro de acciones

Dentro del encabezado del panel de administración existe un botón discreto que abre la bitácora (`action_log`).

Desde ahí pueden consultarse todas las acciones realizadas por los administradores.

---

# Realtime (Supabase)

La aplicación mantiene tres canales de Realtime activos para sincronizar cambios automáticamente.

### `logs-changes`

Escucha modificaciones en:

- `logs`
- `log_mobs`
- `log_items`
- `comments`

### `tierlist-changes`

Escucha cambios en:

- `tierlist_rows`
- `tierlist_items`

### `weapons-changes`

Escucha cambios en:

- `weapons`
- `weapon_ranks`
- `weapon_categories`
- `weapon_types`

Cada canal utiliza su propio flag de supresión (`_suppressRealtimeReload`, entre otros).

La idea es evitar que el administrador que acaba de guardar un cambio reciba inmediatamente un recargado innecesario provocado por su propia actualización.

---

# Bot de Discord

El bot está desarrollado con Node.js y discord.js, y actualmente está desplegado en Railway.

Se conecta directamente a Supabase utilizando la `service_role`, lo que le permite realizar operaciones administrativas sin depender de la web.

## Comandos disponibles

### `/ping`

Comprueba que todo esté funcionando correctamente mostrando la latencia tanto del bot como de Supabase.

### `/getcode`

Envía por mensaje privado el código temporal de administrador.

Solo pueden utilizar este comando los usuarios cuyos IDs estén incluidos en `AUTHORIZED_USER_IDS`.

### `/setlogchannel #canal`

Permite configurar el canal donde se anunciarán automáticamente los nuevos logs.

Al igual que el comando anterior, únicamente está disponible para usuarios autorizados.

### `/screenshot tierlist columna:<Arma|Sub-arma|Accesorio> [canal]`

Genera una imagen con la columna seleccionada de la tierlist y la envía al canal indicado.

### `/screenshot logs [cantidad] [canal]`

Genera una imagen con los logs más recientes del servidor.

Si se especifica una cantidad, solo mostrará esa cantidad de logs.

### `/screenshot arma nombre:<autocompletado> [canal]`

Genera una imagen por cada rango que tenga el arma seleccionada.

El nombre utiliza autocompletado para facilitar la búsqueda.

---

## Procesos automáticos

Además de los comandos, el bot realiza varias tareas de forma automática.

### Rotación del código de administrador

Todos los días, a las **00:00 UTC**, un cron genera un nuevo código de administrador y reemplaza el anterior.

Ese código queda almacenado en la tabla `admin_codes` junto con su fecha de expiración.

### Watcher de logs

El bot también mantiene un canal Realtime escuchando la tabla `logs`.

Su comportamiento es el siguiente:

- Cuando se crea un log, publica automáticamente un embed en el canal configurado.
- Si ese log se edita posteriormente, actualiza el mismo mensaje en Discord.
- Si alguien elimina manualmente ese mensaje en Discord, el bot detecta la situación y publica uno nuevo para mantener el anuncio disponible.

---

# Migraciones SQL

Las migraciones deben aplicarse en el siguiente orden:

1. `schema.sql` — Tablas base del proyecto.
2. `migration_002_categories_and_dates.sql` — Categorías dinámicas y fecha editable para los logs.
3. `migration_003_mob_item_blocks.sql` — Fichas de mobs, objetos y bloques libres.
4. `migration_004_advanced_features.sql` — Likes de comentarios, configuración global y campos configurables.
5. `migration_005_action_log.sql` — Bitácora de acciones administrativas.
6. `migration_006_tierlist.sql` — Sistema completo de la tierlist.
7. `migration_007_drafts.sql` — Tabla para borradores (actualmente sin integrar con el frontend).
8. `migration_008_weapons.sql` — Sistema completo de la guía de armas.
9. `migration_009_fix_create_category_slug.sql` — Corrección en la normalización de slugs para categorías.
10. `migration_010_storage.sql` — Creación del bucket `culones` y configuración de las políticas RLS para Storage.

---

# Problemas conocidos

Aunque el proyecto se encuentra bastante estable, todavía hay algunos puntos que sería bueno mejorar.

## `saveRankPatch` envía el objeto completo

Actualmente, cada vez que se modifica cualquier dato de un rango, `saveRankPatch()` vuelve a enviar el objeto completo.

Por ahora funciona porque `reloadWeaponData()` obtiene todas las columnas antes de guardar.

El problema aparece si en algún momento se añade una nueva columna a `weapon_ranks` y se olvida incluirla en ese `select()`. En ese caso existe el riesgo de sobrescribir información sin darse cuenta.

La solución ideal sería dejar de enviar el objeto completo y realizar actualizaciones parciales únicamente sobre el campo que cambió.

---

## El modal de habilidades hace demasiadas consultas

Cada vez que se modifica una habilidad, el sistema vuelve a cargar toda la información del arma.

No representa un problema grave, pero sí genera muchas consultas innecesarias.

Lo ideal sería actualizar únicamente la habilidad modificada.

---

## Los borradores siguen siendo locales

Aunque ya existe la tabla `drafts` en Supabase, el frontend todavía no la utiliza.

Esto significa que todos los borradores permanecen únicamente en el `localStorage` del navegador donde fueron creados.

Si el usuario cambia de dispositivo o limpia los datos del navegador, esos borradores se perderán.

---

# Pendientes

Estas son las tareas que todavía quedan por resolver o revisar.

- Conectar definitivamente el sistema de borradores con Supabase o, si se decide no hacerlo, dejar documentado que la aplicación utilizará únicamente `localStorage`.

- Revisar que las exportaciones a Excel de la Tierlist y de la opción **Todo** continúen funcionando correctamente si en el futuro se agregan nuevos campos.

- Optimizar el editor de habilidades para que no sea necesario recargar toda el arma cada vez que se modifica una sola habilidad.
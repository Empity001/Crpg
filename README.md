# culones-rpg

Plataforma web del servidor Minecraft RPG/Gacha **culones-rpg**. Reúne logs, guías, tierlist, kits recomendados, contenido del servidor y herramientas administrativas en un sitio estático conectado a Supabase.

## Secciones

| Página | Contenido | Acceso |
|---|---|---|
| `index.html` | Portada: escritorio de ventanas que compone el administrador | Público |
| `logs.html` | Logs, fichas, comentarios y likes | Público |
| `guides.html` | Catálogo de guías, rangos y fabricación | Público |
| `tierlist.html` | Clasificación por filas y columnas | Público |
| `kits.html` | Combinaciones recomendadas | Público |
| `about.html` | Información editable del servidor | Público |
| `admin.html` | Multimedia, backups, borradores y ajustes | Administrador |
| `asset-view.html` | Visor de recursos a pantalla completa | Público |
| `404.html` | Página de error (GitHub Pages la sirve sola en rutas que no existen) | Público |

Los enlaces antiguos `index.html?log=...` (los que ya publicó el bot en Discord) se reenvían a `logs.html`.

El shell compartido vive en `partials/header.html` y `partials/footer.html`. La navegación, el login y las herramientas globales se inicializan desde `js/app/shell.js`.

## Funciones principales

### Logs

- Título, descripción, categoría, relevancia, fecha y portada opcional.
- Fichas ilimitadas de Mob, Item y bloque Extra.
- Imágenes reutilizables y enlaces hacia elementos existentes de Guías.
- Vista master/detail con inspector independiente.
- Comentarios, respuestas, likes y moderación administrativa.
- Categorías dinámicas editables por administradores.
- Borradores locales con sincronización remota best-effort.

### Guías

- Catálogo con búsqueda y filtros dinámicos por categoría y tipo.
- Elementos publicados u ocultos y rangos ilimitados.
- Estadísticas, habilidades, recursos visuales y secciones extra.
- Apartado **Mesas de trabajo** con varias recetas por rango.
- Modos de intercambio, mesa de crafteo 3x3, horno y mesa de herrería.
- Horno normal, alto horno o ahumador.
- Slots con nombre, cantidad, imagen y enlace opcional a otra Guía.
- URL y entry point propios en `guides.html` y `js/pages/guides.js`.

### Tierlist

- Filas dinámicas y tres columnas fijas: Arma, Sub-arma y Accesorio.
- Banco de elementos sin clasificar.
- Drag and drop en escritorio y modal de movimiento en móvil.
- Elementos con imagen, campos adicionales y vínculo opcional a Guías.

### Kits

- Kits apilados verticalmente en orden de creación.
- Varias entradas por columna: Arma, Accesorio y Sub-arma.
- Cada entrada admite nombre, imagen y vínculo opcional a Guías.
- Creación, edición, duplicación y eliminación para administradores.
- Protección contra envíos y cargas simultáneas duplicadas.

### Biblioteca Multimedia

- Recursos internos reutilizables desde Supabase Storage.
- PNG, JPG/JPEG, WEBP, GIF, SVG y APNG; infraestructura preparada para MP4 y WEBM.
- Búsqueda, filtros, paginación progresiva, preview, metadatos y detección de duplicados.
- Biblioteca activa y archivo con restauración o eliminación definitiva.
- Índice de usos y reemplazo global de archivos compatibles.
- Selector liviano separado del modo administrativo.
- URLs externas por uso sin registrarlas como recursos permanentes.

### Administración

- Inicio de sesión con Discord mediante Supabase Auth.
- Nombre y avatar del servidor en la interfaz.
- Un único rol configurable mediante `/config admin set` concede acceso administrativo.
- El modo administrador se activa voluntariamente y se revoca al perder el rol.
- Publicación, actualización y despublicación manual de Guías en el foro de Discord.
- Indicador global de Administrator Mode.
- Confirmaciones propias para acciones críticas.
- Action Logs descriptivos con hora del servidor y hora local del navegador.
- Exportación JSON/XLSX e importación con análisis de conflictos.
- Ajustes de fondo, favicon, banners, tema y preferencias visuales.

### Herramientas para visitantes

- Buscador global bajo demanda con enlaces profundos.
- Campana local de novedades.
- Preferencias visuales guardadas en el navegador.
- Visor de recursos a pantalla completa.

## Atajos y paleta de comandos

La interfaz incluye una capa global de productividad que solo activa cada acción cuando existe un contexto válido.

| Atajo | Acción |
|---|---|
| `Ctrl + K` | Abrir el buscador global |
| `/` | Enfocar el buscador o filtro de la sección actual |
| `Alt + 0…6` | Ir a Portada, Logs, Guías, Tierlist, Kits, Acerca o Herramientas |
| `Alt + N` | Crear un elemento según la sección |
| `Alt + E` | Editar el elemento seleccionado |
| `Ctrl + S` | Guardar el editor o borrador abierto |
| `Ctrl + Enter` | Confirmar el formulario o modal superior |
| `Esc` | Cerrar la capa superior |
| `Ctrl + Alt + M` | Abrir Biblioteca Multimedia para el campo activo |
| `Ctrl + Alt + D` | Duplicar el elemento seleccionado |
| `Ctrl + Alt + C / V` | Copiar o pegar datos estructurados compatibles |
| `[ / ]` | Ir al rango o elemento anterior/siguiente |
| `?` | Mostrar el listado de atajos |
| `Ctrl + Shift + K` | Abrir la paleta de comandos |

La paleta permite buscar acciones y navegación por nombre, muestra sus atajos y deshabilita los comandos que no tienen sentido en el contexto actual. Las combinaciones se resuelven desde un único controlador y se ejecutan al soltar todas sus teclas, por lo que `Ctrl + Shift + K` no puede activar también `Ctrl + K`. La disponibilidad de los comandos se calcula una sola vez al abrir la paleta y la lista se actualiza por frame para mantener la interfaz fluida. La capa vive en `js/features/command-center.js` y su presentación en `css/command-center.css`.

## Arquitectura

```text
assets/              iconos (sprite), fuentes propias y favicon
css/                 estilos base, capas por sección y rebrand
js/app/              shell, includes, bootstrap y Realtime
js/core/             estado, utilidades, Storage, multimedia y auditoría
js/desk/             la portada: modelo, motor de ventanas, contenidos y editor
js/features/         módulos funcionales por dominio
js/pages/            entry point de cada página
js/vendor/           cliente local de Supabase
partials/            header y footer compartidos
supabase/            migraciones SQL y Edge Function
tools/               utilidades de desarrollo (generador del sprite de iconos)
```

El proyecto es una MPA estática sin bundler ni build step. Usa ES Modules nativos. Cada página carga su entry point y su hoja específica. El rebrand compartido está dividido, en orden de cascada, entre `rebrand.css`, `rebrand-runtime.css`, `rebrand-editors.css`, `rebrand-logs.css`, `rebrand-extras.css`, `rebrand-controls.css` y `theme-system.css`. `css/culones.css` es la última capa de todas las páginas: variables de las ventanas, sistema de iconos y correcciones de accesibilidad globales. `css/desk.css` (solo la portada) contiene las ventanas y el editor. `css/windows.css` lleva el lenguaje de ventanas al resto del sitio: el marco de cada página (`.pw`, con barra de tres puntos que inyecta `ensurePageFrame` en `js/app/shell.js`: cerrar vuelve a la portada, minimizar pliega, ensanchar quita el ancho máximo y se recuerda), botones, campos, tarjetas, paneles, modales con barra y avisos de cristal. Todo cuelga de `body.cw-skin` y usa una sola escala de formas: retro (4/6px, borde grueso, sombra dura solo en lo que se pulsa o flota) para lo que está en la página, cristal (18px) para lo que flota, HUD (2px, línea fina) para paneles de datos. Los colores salen de las variables `--theme-*-rgb` que publica `js/features/theme.js`, así que el editor de tema recolorea también las ventanas.

Las fuentes (Space Grotesk, JetBrains Mono y Press Start 2P, licencia OFL) se sirven desde `assets/fonts/`; ya no se piden a Google. Los iconos son Phosphor (MIT) en un sprite local: para añadir uno, apunta su nombre en `tools/build-icons.mjs`, ejecuta `npm install --no-save @phosphor-icons/core` y `node tools/build-icons.mjs`.

`node tools/check-admin-rpcs.mjs` comprueba que `ADMIN_RPCS` y `CODELESS_RPCS` de la Edge Function encajan con las firmas de las migraciones (una RPC nueva sin `input_code` en su firma debe ir en `CODELESS_RPCS`, si no falla en producción). Ejecútalo antes de desplegar `discord-admin-api`.

## La portada (escritorio de ventanas)

`index.html` es un lienzo de ventanas. Cada ventana es `{ id, type, title, chrome, x, y, w, h, z, props }`: `x` y `w` en porcentaje del ancho (se adapta a cualquier pantalla), `y` y `h` en píxeles. Tres carrocerías (`chrome`): **retro** (borde grueso y sombra dura), **cristal** (barra pastel) y **HUD** (esquinas y líneas finas).

- **Visitantes:** pueden arrastrar, minimizar, cerrar (se reabre desde la barra de tareas), maximizar (doble clic en la barra) y pulsar "Ordenar". Nada de eso se guarda. En pantallas estrechas las ventanas pasan a una columna sin arrastre.
- **Administrador:** el botón **Editar portada** abre el editor. Añadir ventanas de ocho tipos (bienvenida, texto, lista de enlaces, dirección de conexión, imagen, últimos logs, armas nuevas, números), mover (también con "Subir/Bajar" en pantallas estrechas), redimensionar, duplicar, borrar, cambiar estilo y contenido, deshacer/rehacer, cuadrícula y guardar. Nada se guarda hasta pulsar **Guardar**. En pantallas estrechas se edita en una sola columna, con las propiedades en una hoja inferior.
- **Datos:** la disposición se guarda en `app_settings.layout_home` (lectura pública, escritura por la Edge Function como el resto de ajustes). Lo que se lee de ahí pasa siempre por `normalizeLayout` (`js/desk/layout.js`): tipos conocidos, números acotados, textos recortados, texto escapado y enlaces solo `http(s)` o relativos. La migración 021 repite la validación en el servidor y audita el cambio como `layout_updated`.
- **Empieza en blanco:** desde el 2026-09-21 no hay contenido heredado. La portada vacía invita al administrador a empezar (o a elegir una plantilla en **Plantillas**: en blanco, servidor de Minecraft, sitio de información, comunidad) y a los visitantes les dice que el sitio se está armando. Los textos de las ventanas son neutrales: sirven igual para un servidor, un network o una lista de información.
- **Empezar de cero en el navegador:** `js/core/epoch.js` borra una sola vez lo que los visitantes guardaron del sitio anterior (`culones*` en localStorage, salvo la sesión). Para repetirlo en el futuro basta con cambiar `SITE_EPOCH`.

Para añadir un tipo de ventana: definirlo en `TYPES` (`js/desk/layout.js`, con sus campos editables) y escribir su renderizador en `js/desk/contents.js`. El editor genera el formulario a partir de los campos.

Supabase proporciona Postgres, Auth, Edge Functions, RPC, RLS, Storage y Realtime. La `anon key` es pública por diseño. Las escrituras administrativas pasan por `discord-admin-api`, que valida la sesión, la identidad de Discord, la pertenencia al servidor y el rol configurado antes de usar `service_role` en el servidor. Nunca debe incluirse una `service_role`, un Bot Token ni un Client Secret en el cliente.

## Base de datos (Supabase)

El esquema completo vive en `supabase/migrations/`: una cadena de 16 migraciones verificada de principio a fin con 24 pruebas funcionales sobre un proyecto limpio (RLS, permisos, límites de frecuencia, bitácora, borradores, kits, multimedia y cola de Discord). Ya no hay que ejecutar SQL a mano ni respetar el orden de las 24 migraciones antiguas, que se pisaban entre sí y no se podían volver a ejecutar.

**Proyecto nuevo (vacío)**

```bash
supabase link --project-ref TU_REF
supabase db push
supabase functions deploy discord-admin-api --project-ref TU_REF --use-api
```

**Proyecto existente que viene de la cadena antigua (001 a 024):** aplica solo las migraciones `culones_014` a `culones_023`. Unifican el estado final, cierran las funciones al navegador y corrigen los errores de la lista de abajo.

Después, en el panel de Supabase:

1. **Authentication → Providers → Discord:** Client ID y Client Secret de la aplicación de Discord.
2. **Authentication → URL Configuration:** Site URL `https://empity001.github.io/Crpg/` y Redirect URL `https://empity001.github.io/Crpg/**`.
3. **Edge Functions → Secrets:** `DISCORD_BOT_TOKEN` y `DISCORD_GUILD_ID` (y `ADMIN_CODE` si quieres el acceso por código de abajo).
4. **Rol administrador de la web** (no necesita el bot): `update public.discord_guild_config set admin_role_id = 'ID_DEL_ROL' where guild_id = 'ID_DEL_SERVIDOR';`. La Edge Function crea la fila del servidor sola en el primer inicio de sesión.

### Acceso de administrador por código (temporal)

Mientras el acceso con Discord no esté configurado, la web admite un código: guárdalo como secreto `ADMIN_CODE` de la Edge Function y escríbelo en el modal de cuenta (**¿Tienes un código de administrador?**). La función lo compara en el servidor en tiempo constante y bloquea nuevos intentos durante 10 minutos tras 5 fallos desde una misma IP; el navegador solo lo guarda en la pestaña abierta. Usa un código largo y aleatorio, cámbialo cuando quieras editando el secreto, y bórralo cuando el acceso por Discord esté listo.

Para que esto funcione la función se despliega **sin** verificación de JWT en la puerta de Supabase (`supabase/config.toml`), porque decide ella misma: sesión de Discord válida o código correcto.

### Qué corrigen las migraciones 014 a 023

- **Borradores:** el guardado remoto fallaba en silencio desde que el acceso pasó a Discord; ahora se guardan por cuenta de Discord.
- **Kits ocultos:** el administrador no los veía, y la función podía devolver cada kit publicado duplicado.
- **`create_log` y `update_log`:** quedaban dos versiones de cada una; ahora hay una sola.
- **Comentarios públicos:** se podían enviar `likes` falsos, `hidden` o un comentario padre ajeno; ahora se rechazan. Límite de frecuencia por IP: 5 comentarios por minuto y 40 por hora, y 30 likes por minuto.
- **Likes:** solo por RPC, ya no por INSERT directo.
- **Novedades:** un "me gusta" ya no marca el Log como actualizado.
- **Permisos:** el navegador solo puede ejecutar `toggle_like`, `like_comment`, `list_kits`, `list_public_logs_with_counts` y `get_site_content_versions`. Toda la administración pasa por la Edge Function con `service_role`.
- **Índices:** se quitaron los redundantes y el de `request_id` ahora sí lo usa el planificador.
- **Portada (021):** `update_app_setting` audita `layout_home` como "Se reorganizó la portada" en lugar de "configuración de fichas" y valida su forma y tamaño en el servidor.

- **Armas sin publicar (022 y 023):** las políticas de lectura de `weapons` y `weapon_ranks` eran `using (true)`, así que cualquiera con la clave pública podía leer los borradores (estadísticas, habilidades, recetas). Ahora la lectura pública solo entrega lo publicado y el panel de administración lee los borradores por `list_weapons_admin` y `list_weapon_ranks_admin` (solo `service_role`, a través de la Edge Function). En el código, todo pasa por `js/features/weapons-source.js`. Orden de despliegue si vuelves a tocarlo: primero las funciones (022), después la web que las usa y por último la política (023).

## Desarrollo local

El sitio debe servirse por HTTP porque los partials se cargan con `fetch()` y los módulos usan rutas relativas. Puede abrirse con Live Server desde VS Code. Abrir los HTML directamente con `file://` no es una prueba válida.

Pruebas mínimas antes de publicar:

```powershell
$files = rg --files js -g '*.js'
foreach ($file in $files) { node --check $file }
git diff --check
```

Después, comprobar con Live Server:

- Portada: se pintan las ventanas, arrastrar/minimizar/maximizar, y en modo admin añadir, mover, deshacer, guardar y recargar.
- Logs: carga, filtros, detalle, fichas, portada, comentarios y edición.
- Guías: catálogo, filtros, rangos, recetas y enlaces profundos.
- Tierlist: carga, movimiento, edición y enlaces.
- Kits: crear una vez, editar, recargar y confirmar que no se duplique.
- Admin: Discord Login, activación/desactivación del modo, revocación de rol, Multimedia, foro, archivados, import/export y Action Logs.
- Móvil: sidebar, modal de cuenta, inspector y selectores multimedia.

## Bot de Discord

El bot vive en un repositorio independiente y utiliza la misma aplicación de Discord que el login OAuth. Publica Logs por elemento, procesa la cola del foro de Guías, escala pixel art, genera screenshots y comprueba el rol administrativo. `/getcode` fue retirado. La configuración completa está en `GUIA_DESPLIEGUE_DISCORD_AUTH.md`.

## Estado de mantenimiento

La auditoría conjunta del 12 de julio de 2026 confirmó sintaxis válida, imports resueltos, IDs HTML únicos, CSS balanceado y carga local sin errores de las cinco páginas principales. La paleta global alcanza todas las familias de color visibles mediante tokens y canales RGB derivados; categorías y otros colores de contenido siguen siendo configurables por separado. `discord-admin-api` mantiene compatibilidad explícita entre RPC legacy y las RPC sin `input_code`.

La página antigua `weapons.html` fue eliminada: Guías usa `guides.html`, `js/pages/guides.js` y `css/guides.css`. Multimedia separa helpers, usos y orquestación; Mesas de trabajo vive en `weapons-recipes-admin.js` y el resto del CRUD en `weapons-admin.js`.


> Los comandos que configuran el canal de Logs o el foro de Guías requieren que el bot tenga **Gestionar roles** y **Gestionar canales**, además de los permisos de mensajes, hilos, embeds y archivos. Discord exige Gestionar roles para editar los overwrites del canal.


### Visibilidad de Logs

Los administradores pueden publicar o despublicar cada Log desde su inspector o menú contextual. Un Log oculto desaparece de la vista pública y su publicación de Discord se elimina mediante una cola durable.

# Empi Network

Portal multicomunidad de **Empi Network** y hogar de la instancia **Culones RPG**. La portada central, el control Owner y las instancias genéricas son independientes del CSS y de las funciones legacy de Culones, que continúa conectado al mismo proyecto de Supabase.

La Fase 1 usa `site_id` como límite de datos, un `discord_guild_id` único por instancia y una Edge Function exclusiva para Owner. La Fase 3 añade el constructor universal, páginas y apariencia versionadas, contenido estructurado, formularios públicos seguros, módulos, workflows, controles administrativos declarativos e importación/exportación. La identidad `726444396970770494` es la única autorizada para crear o cambiar la estructura global.

## Secciones

| Página | Contenido | Acceso |
|---|---|---|
| `index.html` | Portal central y catálogo de comunidades | Público |
| `logs.html` | Logs, fichas, comentarios y likes de Culones | Público |
| `site.html?site=slug` | Portada mínima de una instancia genérica | Público si la instancia está activa |
| `owner.html` | Control de instancias, navegación, búsqueda y perfiles | Solo PLATFORM_OWNER |
| `builder.html` | Owner Studio de páginas, bloques, datos, módulos y workflows | Solo PLATFORM_OWNER |
| `guides.html` | Catálogo de guías, rangos y fabricación | Público |
| `tierlist.html` | Clasificación por filas y columnas | Público |
| `kits.html` | Combinaciones recomendadas | Público |
| `about.html` | Información editable del servidor | Público |
| `admin.html` | Multimedia, backups, borradores y ajustes | Administrador |
| `asset-view.html` | Visor de recursos a pantalla completa | Público |

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

### Owner Studio de Empi Network

- Páginas libres compuestas por bloques anidados, capas, inspector y undo/redo.
- Vista previa como usuario, administrador supremo u Owner, por rol y dispositivo.
- Posición, visibilidad y comportamiento de tabs y búsqueda por breakpoint.
- Paleta completa, tipografías, densidad, movimiento, assets y CSS personalizado validado.
- Colecciones con campos dinámicos, registros, vistas, formularios y respuestas en borrador.
- Componentes reutilizables, módulos con manifiesto estable, capacidades y workflows desactivables.
- Controles concretos que Owner puede exponer posteriormente a roles administrativos.
- Versiones restaurables de páginas y apariencia, auditoría, exportación e importación aislada.
- Archivado recuperable de instancias; Culones RPG y su página legacy están protegidos.

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
| `Alt + 1…6` | Ir a Logs, Guías, Tierlist, Kits, Acerca o Herramientas |
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
assets/network/      identidad visual central de Empi Network
css/                 estilos base, capas por sección y CSS aislado de Network
js/app/              shell, includes, bootstrap y Realtime
js/core/             estado, utilidades, Storage, multimedia y auditoría
js/features/         módulos funcionales por dominio
js/network/          portal, sesión, Owner Studio y renderizador de instancias
js/pages/            entry point de cada página
js/vendor/           cliente local de Supabase
partials/            header y footer compartidos
sql/                 esquema y migraciones incrementales
```

El proyecto es una MPA estática sin bundler ni build step. Usa ES Modules nativos. Cada página carga su entry point y su hoja específica. El rebrand compartido está dividido, en orden de cascada, entre `rebrand.css`, `rebrand-runtime.css`, `rebrand-editors.css`, `rebrand-logs.css`, `rebrand-extras.css`, `rebrand-controls.css` y `theme-system.css`. La última capa centraliza tokens visibles compartidos, scrollbars y controles base para evitar colores duplicados en varias hojas.

Supabase proporciona Postgres, Auth, Edge Functions, RPC, RLS, Storage y Realtime. La `anon key` es pública por diseño. Las escrituras administrativas pasan por `discord-admin-api`, que valida la sesión, la identidad de Discord, la pertenencia al servidor y el rol configurado antes de usar `service_role` en el servidor. Nunca debe incluirse una `service_role`, un Bot Token ni un Client Secret en el cliente.

## Migraciones SQL

Aplicar en orden desde Supabase SQL Editor:

1. `sql/schema.sql`
2. `sql/migration_002_categories_and_dates.sql`
3. `sql/migration_003_mob_item_blocks.sql`
4. `sql/migration_004_advanced_features.sql`
5. `sql/migration_005_action_log.sql`
6. `sql/migration_006_tierlist.sql`
7. `sql/migration_007_drafts.sql`
8. `sql/migration_008_weapons.sql`
9. `sql/migration_009_fix_create_category_slug.sql`
10. `sql/migration_010_storage.sql`
11. `sql/migration_011_media_library.sql`
12. `sql/migration_012_media_library_archive_cleanup.sql`
13. `sql/migration_013_media_picker_light_list.sql`
14. `sql/migration_014_admin_action_audit_details.sql`
15. `sql/migration_015_patch_weapon_rank.sql`
16. `sql/migration_016_kits.sql`
17. `sql/migration_017_discord_deletion_queue.sql`
18. `sql/migration_018_log_cover_image.sql`
19. `sql/migration_019_replace_media_asset.sql`
20. `sql/migration_020_update_log_category.sql`
21. `sql/migration_021_discord_auth_and_forum.sql`
22. `sql/migration_022_log_visibility.sql`
23. `sql/migration_023_performance_content_versions.sql`
24. `sql/migration_024_performance_hardening.sql`
25. `sql/migration_025_empi_network_foundation.sql`
26. `sql/migration_026_empi_network_builder.sql`

Las migraciones nuevas reemplazan algunas RPC conservando sus firmas públicas. No deben ejecutarse fuera de orden.

Para el deploy 024, el orden exacto está en
`DEPLOY_PERFORMANCE_HARDENING_01.md` y el diagnóstico completo en
`PERFORMANCE_AUDIT_01.md`.

El rediseño de Herramientas, el panel de salud y el respaldo v2 se despliegan
siguiendo `DEPLOY_TOOLS_REFRESH_01.md`. No requieren migración SQL nueva, pero
sí volver a desplegar `discord-admin-api` antes de publicar la página.

La fundación multisitio se despliega siguiendo
`registro/DEPLOY_EMPI_NETWORK_PHASE1.md`. Ese documento incluye staging,
secreto Owner, prueba de aislamiento, cambio de OAuth y reversión segura.

El cierre de la web y del Owner Studio se despliega siguiendo
`registro/DEPLOY_EMPI_NETWORK_PHASE3.md`. La función pública de formularios
debe desplegarse con `--no-verify-jwt`; la validación, idempotencia y límites se
aplican dentro de `network-public-api` y en la RPC transaccional.

## Desarrollo local

El sitio debe servirse por HTTP porque los partials se cargan con `fetch()` y los módulos usan rutas relativas. Puede abrirse con Live Server desde VS Code. Abrir los HTML directamente con `file://` no es una prueba válida.

Pruebas mínimas antes de publicar:

```powershell
$files = rg --files js -g '*.js'
foreach ($file in $files) { node --check $file }
node scripts/verify-phase1.mjs
node scripts/verify-phase3.mjs
git diff --check
```

Después, comprobar con Live Server:

- Logs: carga, filtros, detalle, fichas, portada, comentarios y edición.
- Guías: catálogo, filtros, rangos, recetas y enlaces profundos.
- Tierlist: carga, movimiento, edición y enlaces.
- Kits: crear una vez, editar, recargar y confirmar que no se duplique.
- Admin: Discord Login, activación/desactivación del modo, revocación de rol, Multimedia, foro, archivados, import/export y Action Logs.
- Móvil: sidebar, modal de cuenta, inspector y selectores multimedia.

## Bot de Discord

El bot vive en el repositorio independiente `Empity001/empi-connect` y utiliza la misma aplicación de Discord que el login OAuth. La conversión multiserver corresponde a la Fase 2; hasta entonces, el bot de producción conserva el comportamiento de Culones. Publica Logs por elemento, procesa la cola del foro de Guías, escala pixel art, genera screenshots y comprueba el rol administrativo. `/getcode` fue retirado. La configuración actual está en `registro/GUIA_DESPLIEGUE_DISCORD_AUTH.md`.

## Estado de mantenimiento

La auditoría conjunta del 12 de julio de 2026 confirmó sintaxis válida, imports resueltos, IDs HTML únicos, CSS balanceado y carga local sin errores de las cinco páginas principales. La paleta global alcanza todas las familias de color visibles mediante tokens y canales RGB derivados; categorías y otros colores de contenido siguen siendo configurables por separado. `discord-admin-api` mantiene compatibilidad explícita entre RPC legacy y las RPC sin `input_code` de `migration_022`.

La página antigua `weapons.html` fue eliminada: Guías usa `guides.html`, `js/pages/guides.js` y `css/guides.css`. Multimedia separa helpers, usos y orquestación; Mesas de trabajo vive en `weapons-recipes-admin.js` y el resto del CRUD en `weapons-admin.js`.


> Los comandos que configuran el canal de Logs o el foro de Guías requieren que el bot tenga **Gestionar roles** y **Gestionar canales**, además de los permisos de mensajes, hilos, embeds y archivos. Discord exige Gestionar roles para editar los overwrites del canal.


### Visibilidad de Logs

Después de `migration_021`, ejecuta `sql/migration_022_log_visibility.sql`. Los administradores pueden publicar o despublicar cada Log desde su inspector o menú contextual. Un Log oculto desaparece de la vista pública y su publicación de Discord se elimina mediante una cola durable.

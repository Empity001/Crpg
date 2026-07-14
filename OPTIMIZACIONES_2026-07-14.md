# Optimización de rendimiento — 14 de julio de 2026

Esta versión optimiza la web sin modificar el proyecto del bot ni cambiar los contratos que este utiliza.

## Cambios principales

### Discord y autenticación

- Se eliminó la doble comprobación inicial causada por `getSession()` + `INITIAL_SESSION`.
- La verificación de Discord ya no bloquea la carga del contenido público.
- El resultado del rol se reutiliza durante 3 minutos dentro de la misma pestaña para evitar otra consulta al navegar entre páginas.
- La página `admin.html` sí espera una verificación válida antes de arrancar sus herramientas.
- Las operaciones administrativas continúan pasando por `discord-admin-api`; el caché solo acelera la interfaz y no concede permisos de escritura.

### Novedades

- Se añadió `sql/migration_023_performance_content_versions.sql`.
- Con esa migración aplicada, Novedades usa un único RPC pequeño (`get_site_content_versions`) en vez de descargar datos completos de Logs, Guías, Tierlist, Kits y Acerca del servidor.
- El refresco se limita a una vez cada 5 minutos y el cooldown se comparte entre las páginas de la misma pestaña/navegador.
- Abrir el panel ya no fuerza otra descarga y se eliminó el refresco duplicado por `focus`.
- Si la migración todavía no está aplicada, existe un modo compatible más ligero.

### Logs

- Para visitantes, el arranque descarga la lista de Logs y únicamente los datos mínimos necesarios para calcular sus conteos.
- Las fichas completas de mobs, items y Extras se descargan al seleccionar o abrir el Log.
- En modo administrador se mantiene la carga completa para preservar edición, duplicado, borradores y exportaciones.
- Se protegió el cambio de visitante a administrador para que una carga pública en curso no deje incompleto el editor.

### Guías

- Categorías/tipos y Guías/rangos se consultan en paralelo.
- El editor administrativo se importa únicamente cuando existe un administrador verificado.
- Los controles del foro de Discord también se cargan solo en modo administrador.
- Las imágenes del catálogo usan `loading="lazy"` y `decoding="async"`.
- El catálogo dejó de importar el módulo completo de Tierlist solo para calcular iniciales.

### Módulos y recursos

- La Biblioteca Multimedia se carga bajo demanda mediante `media-library-lazy.js`.
- Los editores de Acerca, Kits y Tierlist solo conectan sus eventos cuando se activa el modo administrador.
- El Centro de comandos se descarga cuando el navegador queda libre, no durante el primer render.
- El buscador global continúa cargándose únicamente al pulsar la lupa.
- `app_settings` solicita solo las claves necesarias para la página actual. `about_blocks` ya no se descarga desde todas las secciones.
- Header y footer utilizan caché real con una versión de despliegue nueva.
- Se añadieron conexiones anticipadas a Google Fonts y Supabase.

## Reducción del JavaScript inicial

Las cifras siguientes corresponden a módulos JavaScript locales alcanzables mediante imports estáticos. No incluyen el cliente compartido de Supabase.

| Página | Antes | Después | Reducción |
|---|---:|---:|---:|
| Guías | 463.3 KiB | 209.7 KiB | 54.7% |
| Kits | 291.3 KiB | 172.1 KiB | 40.9% |
| Tierlist | 301.4 KiB | 182.3 KiB | 39.5% |
| Acerca | 264.1 KiB | 165.8 KiB | 37.2% |
| Logs | 399.0 KiB | 286.9 KiB | 28.1% |
| Administración | 430.8 KiB | 381.3 KiB | 11.5% |

Administración disminuye menos porque esa página necesita deliberadamente casi todas las herramientas.

## Compatibilidad con el bot

No se modificó el bot. También se verificó que estas migraciones de la web siguen siendo idénticas a las incluidas en el proyecto del bot:

- `migration_021_discord_auth_and_forum.sql`
- `migration_022_log_visibility.sql`

Se conservaron, entre otros:

- `set_log_published(input_id, input_published)`
- `guide_forum_jobs` y sus acciones/estados
- `discord_deletion_queue`
- `log_discord_publications`
- enlaces `index.html?log=...`
- enlaces `guides.html?weapon=...&rank=...`
- claves de Kits y Tierlist
- `app_settings.theme_config`

La migración 023 solo añade una tabla de versiones, un RPC público de lectura y triggers de actualización. No reemplaza ni renombra contratos del bot.

## Instalación

1. Sube el contenido completo de esta carpeta al repositorio de GitHub Pages.
2. En Supabase, abre **SQL Editor** y ejecuta `sql/migration_023_performance_content_versions.sql` después de las migraciones 021 y 022.
3. Despliega normalmente la web.
4. Haz una recarga forzada una vez (`Ctrl + F5`) para descartar módulos antiguos almacenados por el navegador.

La web funciona sin la migración 023 mediante el fallback, pero Novedades solo alcanza su optimización completa después de ejecutarla.

## Validaciones realizadas

- Sintaxis comprobada en todos los archivos JavaScript con `node --check`.
- Resolución comprobada para todos los imports locales estáticos y dinámicos.
- Referencias locales `src`/`href` de HTML y parciales comprobadas.
- `git diff --check` sin errores de espacios o parches dañados.
- Prueba aislada: la inicialización de autenticación produce una sola llamada de estado a Discord.
- Prueba aislada: Logs usa resúmenes inicialmente y consulta fichas completas por Log al seleccionarlo.
- Prueba aislada: Novedades usa un único RPC de versiones y respeta el cooldown.
- Comparación SHA-256 de las migraciones 021 y 022 contra el proyecto del bot.

No se pudo ejecutar una sesión visual completa con Chromium dentro del entorno de empaquetado debido a las restricciones del navegador del contenedor. Por eso conviene realizar una comprobación visual final con Live Server o en GitHub Pages, especialmente en móvil y en modo administrador.

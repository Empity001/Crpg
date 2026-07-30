# Empi Network · despliegue de Fase 3

Esta fase termina la parte web: Owner Studio, páginas por bloques, responsive por dispositivo, navegación y búsqueda configurables, apariencia versionada, colecciones, registros, formularios públicos, módulos, workflows, componentes reutilizables, importación/exportación, auditoría y archivado recuperable.

`logs.html` y el resto de la experiencia legacy de Culones RPG no se convierten ni se reemplazan. La instancia protegida continúa abriendo `logs.html`.

## Antes de tocar Supabase

1. Confirma que Fase 1 funciona y que puedes entrar a `owner.html` con Discord `726444396970770494`.
2. Guarda un backup de la base de datos desde Supabase Dashboard.
3. Conserva el commit actualmente publicado para poder volver a desplegar la web y las Edge Functions anteriores.
4. Desde la raíz del repo ejecuta:

```powershell
node scripts/verify-phase1.mjs
node scripts/verify-phase3.mjs
git diff --check
```

Los dos verificadores deben terminar en `*_VERIFIER_OK`. No publiques si alguno falla.

## Hotfixes obligatorios para instalaciones existentes

Si ya ejecutaste la migración 026, abre **SQL Editor**, pega el contenido completo de
`sql/migration_027_phase3_instance_defaults.sql` y ejecútalo una vez. Esta corrección
es idempotente, no altera Culones y soluciona el error `draft_theme_config` al crear
una instancia. No necesitas volver a ejecutar la 026 ni redesplegar las Edge Functions.

Después publica los archivos web actualizados para recibir los avisos superiores,
la explicación de compatibilidad de Culones y las mejoras de rendimiento del constructor.

Luego pega y ejecuta `sql/migration_028_builder_experience_and_publish.sql`. Esta
segunda corrección activa las instancias que ya tenían una página publicada y
evita que vuelva a existir una página `published` dentro de un portal `draft`.
Es la corrección del mensaje **Instancia no disponible** que podía aparecer después
de publicar. Tampoco requiere redesplegar Edge Functions.

## 1. Aplicar la migración 026

En Supabase Dashboard abre **SQL Editor**, crea una consulta nueva, pega el contenido completo de `sql/migration_026_empi_network_builder.sql` y ejecútalo una sola vez.

La migración es aditiva y transaccional. Crea el constructor y sus políticas RLS, añade una página protegida que apunta a Culones legacy y prepara una página mínima para las demás instancias. No elimina tablas ni datos existentes.

En una instalación nueva, aplica 026, 027 y 028 antes de crear la primera instancia.
En una instalación existente, no repitas la 026: aplica 027 y después 028.

Comprobaciones rápidas en **Table Editor**:

- Existen `site_pages`, `site_page_versions` y `site_theme_versions`.
- Existen `site_collections`, `site_collection_fields`, `site_collection_records` y `site_form_submissions`.
- Existen `site_module_instances`, `site_workflows` y `site_admin_controls`.
- En `site_pages`, Culones tiene la página `inicio` con `kind: legacy` y `legacyUrl: logs.html`.

## 2. Desplegar las Edge Functions

No necesitas crear secretos nuevos. `PLATFORM_OWNER_DISCORD_ID` ya fue configurado en Fase 1 y las variables `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` las proporciona Supabase automáticamente.

```powershell
supabase login
supabase functions deploy network-admin-api --project-ref xuaeaebypcggoqwgshjy --use-api
supabase functions deploy network-public-api --project-ref xuaeaebypcggoqwgshjy --use-api --no-verify-jwt
```

`network-admin-api` conserva verificación JWT porque exige una sesión Discord válida y después comprueba al Owner en base de datos. `network-public-api` acepta formularios de visitantes; por eso se despliega sin verificación JWT de plataforma y aplica dentro de la función su propio esquema permitido, honeypot, límite de tamaño, idempotencia, huella no reversible y rate limit. La misma decisión queda documentada en `supabase/config.toml`.

## 3. Publicar la web

Publica los archivos del commit mediante GitHub Pages como acostumbras. No abras los HTML con `file://`: usa GitHub Pages o un servidor HTTP local.

Rutas nuevas o ampliadas:

- `owner.html`: metadatos, roles, tabs, búsqueda y apariencia.
- `builder.html`: Owner Studio completo.
- `site.html?site=<slug>`: render público de páginas nuevas.
- `logs.html`: Culones original, sin cambios.

## 4. Discord y dominios

Fase 3 no requiere activar intents nuevos en Discord Developer Portal.

Si el repositorio o dominio de GitHub Pages cambia:

1. En **Supabase → Authentication → URL Configuration**, actualiza **Site URL** y las **Redirect URLs** del nuevo dominio.
2. En **Discord Developer Portal → OAuth2**, conserva como callback de Discord:

```text
https://xuaeaebypcggoqwgshjy.supabase.co/auth/v1/callback
```

No pongas `owner.html` ni el dominio de GitHub como callback directo de Discord: Supabase recibe primero la respuesta OAuth y luego devuelve al usuario a una URL permitida.

Los intents, permisos de canales, comandos y configuración multiserver de Empi Connect pertenecen a las Fases 2 y 4 del bot.

## 5. Matriz de aceptación

Realiza estas pruebas en este orden:

1. Abre `logs.html`, Guías, Tierlist, Kits y Herramientas de Culones. Deben verse y funcionar como antes.
2. Abre `site.html?site=culones-rpg`: debe redirigir a `logs.html`.
3. Entra a `owner.html` con la cuenta Owner. Una cuenta distinta debe quedar en modo normal.
4. Crea una instancia de prueba sin Guild ID. Debe nacer como borrador, con rol `<administrador>` y página `Inicio`.
5. En `builder.html`, prueba una sección lista y luego agrega título, texto, botones, grid y columnas; prueba escritorio, tablet y móvil.
6. Guarda borrador y confirma que la vista pública siga cerrada. Publica y confirma que la instancia cambie a activa, que `site.html` abra y que el historial no desaparezca.
7. Cambia tabs, posición móvil, buscador, paleta y tipografía. Comprueba borrador antes de publicar.
8. Crea una colección pública activa con al menos un campo obligatorio y activa **Permitir formularios públicos**.
9. Agrega un bloque Formulario, publica la página y envía una respuesta desde una ventana privada. Debe aparecer como registro en borrador dentro de la colección.
10. Publica el registro y confirma que la vista de colección lo muestra. Archivarlo debe ocultarlo sin eliminarlo físicamente.
11. Exporta la instancia, impórtala con otro slug y confirma que nace aislada, sin Guild ID, en borrador y sin publicar workflows ni capacidades externas.
12. Asigna Guild IDs diferentes a dos instancias. Ninguna consulta, registro, página o búsqueda de una debe aparecer en la otra.
13. Abre todos los diálogos largos y verifica que su contenido tenga scroll, mientras la cabecera y los botones inferiores permanecen visibles.

## Rollback seguro

La 026 añade estructura que no afecta a las rutas legacy, por lo que no conviene borrar tablas para volver atrás.

1. Vuelve a desplegar el commit web anterior.
2. Vuelve a desplegar la versión anterior de `network-admin-api`.
3. Archiva las instancias de prueba desde Owner.
4. Deja las tablas 026 sin uso hasta investigar el problema.
5. Culones puede seguir entrando directamente por `logs.html` durante todo el rollback.

Si la migración falla dentro de su transacción, Postgres revierte el bloque completo. Guarda el mensaje exacto y no intentes aplicar fragmentos sueltos.

# Despliegue seguro · Empi Network Fase 1

Esta fase crea el portal central, el panel exclusivo de Owner y la base
multisitio. No convierte todavía las funciones completas de Culones ni el bot:
esas rutas siguen trabajando como antes desde `logs.html` y Empi Connect se
adapta en la Fase 2.

## Garantías de esta entrega

- Culones conserva sus datos, RPC, estilos y herramientas actuales.
- Toda fila legacy recibe el `site_id` estable de Culones mediante un default.
- Cada instancia nueva tiene un `discord_guild_id` único.
- El navegador solo puede leer instancias activas.
- Las tablas de perfiles, mapeos, versiones y auditoría no son accesibles por
  `anon` ni `authenticated`.
- Crear una instancia, guardar una versión y reemplazar permisos son operaciones
  atómicas en Postgres.
- Solo Discord `726444396970770494`, validado en el servidor, puede usar las
  acciones estructurales de `network-admin-api`.

## 1. Antes de tocar producción

1. Exporta la base de datos o crea un backup en Supabase.
2. Conserva el commit estable actualmente publicado.
3. Aplica primero la fase completa en un proyecto de staging o en una copia de
   la base.
4. Ejecuta desde la raíz del repositorio:

```powershell
node scripts/verify-phase1.mjs
git diff --check
```

## 2. SQL

Después de las migraciones 001–024, ejecuta completa y una sola vez:

```text
sql/migration_025_empi_network_foundation.sql
```

La migración es aditiva. No borra tablas, filas ni RPC de Culones. Crea el sitio
inicial con este identificador estable:

```text
00000000-0000-4000-8000-000000000001
```

Comprobaciones en SQL Editor:

```sql
select id, slug, status, discord_guild_id
from public.sites
order by created_at;

select discord_user_id, active
from public.platform_owners;

select table_name, column_name, column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('logs', 'comments', 'kits', 'discord_guild_config')
  and column_name = 'site_id';

select site_id, role_key, is_default_admin
from public.site_role_profiles;
```

Resultados esperados:

- Existe `culones-rpg` y está `active`.
- Existe y está activo el Owner `726444396970770494`.
- Las tablas legacy existentes tienen `site_id` no nulo con default de Culones.
- Culones tiene el perfil `<administrador>`.

## 3. Edge Function Owner

Configura el secreto sin comillas adicionales:

```bash
supabase secrets set PLATFORM_OWNER_DISCORD_ID=726444396970770494
supabase functions deploy network-admin-api
supabase functions deploy discord-admin-api
```

Supabase debe proporcionar también:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Mantén la verificación JWT habilitada. No copies `service_role`, Client Secret
ni tokens de bot a ningún archivo web o variable pública de GitHub Pages.

## 4. Supabase Auth y Discord Developer Portal

En Discord Developer Portal, la URI OAuth sigue siendo la callback de Supabase:

```text
https://TU_PROJECT_REF.supabase.co/auth/v1/callback
```

Para la web solo se usan los scopes `identify` y `email`. Esta fase no necesita
activar `Message Content Intent`, `Server Members Intent` ni `Presence Intent`.
No cambies todavía los permisos ni intents del bot de Culones; eso pertenece a
Empi Connect Fase 2.

En Supabase, Authentication → URL Configuration:

```text
Site URL: https://empity001.github.io/empi-network/
Redirect URL: https://empity001.github.io/empi-network/**
```

Durante la transición conserva también la redirect antigua de Culones hasta
confirmar que todos los enlaces publicados usan el repo nuevo. Para desarrollo
local puede agregarse temporalmente `http://127.0.0.1:4173/**`; nunca sustituyas
la URL de producción por localhost.

## 5. Publicar GitHub Pages

Publica todos los archivos del commit juntos. El orden lógico de activación es:

1. Backup.
2. Migración 025.
3. Secreto y deploy de `network-admin-api` y `discord-admin-api`.
4. Ajustes OAuth.
5. Web.

`index.html` pasa a ser la Network. La antigua portada de Logs vive sin cambios
en `logs.html`; los enlaces internos y los parámetros legacy `?log=`, `?tab=` y
`?entry=` se redirigen conservando query y hash.

## 6. Prueba de aceptación

En una ventana privada:

1. Abre `/empi-network/` y confirma la tarjeta de Culones.
2. Entra a Culones y prueba carga, filtros, detalle, comentarios y búsqueda.
3. Abre un enlace antiguo `/?log=ID&tab=items`; debe terminar en
   `/logs.html?log=ID&tab=items`.
4. Abre `/owner.html` sin sesión: solo debe ofrecer conectar Discord.
5. Inicia con otra cuenta: debe responder `Acceso Owner denegado`.
6. Inicia con `726444396970770494`: deben aparecer los tres modos y el panel.
7. Crea una instancia de prueba en estado `draft`, con un Guild ID que no use
   otra instancia. Debe nacer con `<administrador>` y solo mostrar su nombre.
8. Intenta repetir el Guild ID en otra instancia: debe rechazarse.
9. Publica la instancia y verifica `site.html?site=SU-SLUG` en escritorio y
   móvil, incluidos tabs y posición de búsqueda.
10. Confirma en SQL que sus filas de sitio, perfiles, mapeos, versiones y
    auditoría usan el mismo `site_id` y nunca el de Culones.

## 7. Reversión

Si la portada nueva falla, revierte solamente el commit web y vuelve a publicar
el `index.html` estable. La migración 025 puede permanecer: es compatible con
las escrituras legacy gracias al default de Culones.

No elimines `site_id`, no borres las tablas nuevas y no hagas un reset de la
base durante una reversión urgente. Si la Edge Function falla, vuelve al
deployment anterior o retírala temporalmente; Culones seguirá funcionando sin
el panel Owner.

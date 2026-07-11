# Despliegue coordinado: Discord Login, rol administrativo y foro de Guías

Esta guía corresponde a la migración `021` y al bot actualizado. El orden importa porque `/getcode` fue eliminado.

## 1. Copias de seguridad

Antes de desplegar:

1. Exporta la base de datos o crea un backup desde Supabase.
2. Conserva el último deployment estable de la web y el bot.
3. Verifica que puedes entrar al Dashboard de Supabase aunque la web quede temporalmente sin acceso administrativo.

## 2. Misma aplicación de Discord

Utiliza la aplicación que ya contiene el bot.

Necesitarás:

- **Application ID / Client ID**: se usa en Railway y Supabase Auth.
- **Client Secret**: se guarda únicamente en Supabase Auth.
- **Bot Token**: se guarda en Railway y como secreto de la Edge Function.
- **Guild ID**: ID del servidor oficial.

No publiques el Bot Token, Client Secret ni service role.

## 3. Configurar Discord OAuth en Supabase

En Discord Developer Portal, abre **OAuth2** y agrega como redirect URI:

```text
https://TU_PROJECT_REF.supabase.co/auth/v1/callback
```

En Supabase:

1. Authentication → Providers → Discord.
2. Activa el proveedor.
3. Pega Client ID y Client Secret de la misma aplicación del bot.
4. Authentication → URL Configuration.
5. Configura como Site URL:

```text
https://empity001.github.io/culones-rpg/
```

6. Agrega a Redirect URLs la URL pública y, si quieres permitir rutas concretas después del login:

```text
https://empity001.github.io/culones-rpg/**
```

El desarrollo local no es requisito. Si después lo necesitas, añade temporalmente las URLs de localhost a la lista de redirects sin sustituir la de producción.

## 4. Aplicar SQL

Ejecuta después de las migraciones 001–020:

```text
sql/migration_021_discord_auth_and_forum.sql
```

La migración:

- Crea `discord_guild_config`.
- Crea publicaciones, jobs y tags del foro.
- Amplía publicaciones de Logs con `message_map` y `message_order`.
- Amplía la auditoría con identidad Discord.
- Cierra las escrituras directas de Storage.
- Convierte `validate_admin_code()` en una puerta exclusiva de `service_role` para mantener temporalmente las firmas RPC internas.
- Elimina `admin_codes`.

No vuelvas a ejecutar la aplicación antigua después de esta migración: ya no podrá autenticarse mediante códigos.

## 5. Desplegar la Edge Function

La función está en:

```text
supabase/functions/discord-admin-api/index.ts
```

Con Supabase CLI enlazado al proyecto:

```bash
supabase secrets set DISCORD_BOT_TOKEN="TU_BOT_TOKEN"
supabase secrets set DISCORD_GUILD_ID="TU_GUILD_ID"
supabase functions deploy discord-admin-api
```

Supabase proporciona automáticamente al entorno de la función las variables del proyecto. Confirma que estén disponibles:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_BOT_TOKEN`
- `DISCORD_GUILD_ID`

La función debe mantener verificación JWT habilitada. La web la llama con la sesión de Supabase Auth.

## 6. Desplegar el bot en Railway

Variables:

```env
DISCORD_TOKEN=TU_BOT_TOKEN
DISCORD_CLIENT_ID=TU_APPLICATION_ID
DISCORD_GUILD_ID=TU_GUILD_ID
SUPABASE_URL=https://TU_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU_SERVICE_ROLE
SITE_URL=https://empity001.github.io/culones-rpg/
GUIDE_JOB_POLL_MS=15000
GUIDE_JOB_MAX_ATTEMPTS=5
```

Después:

```bash
npm install
npm run deploy
npm start
```

En Railway, `npm start` ya está definido como comando de inicio. `npm run deploy` debe ejecutarse una vez desde un entorno con las variables anteriores cada vez que cambie la estructura de slash commands.

## 7. Permisos del bot

Para el canal de Logs necesita:

- View Channel.
- Send Messages.
- Embed Links.
- Attach Files.
- Create Public Threads.
- Send Messages in Threads.
- Read Message History.
- Manage Threads.
- Manage Channels para configurar el canal.
- Manage Roles para crear o editar los overwrites de solo lectura.

Para el foro de Guías necesita además:

- Add Reactions.
- Manage Messages.
- Manage Channels.
- Manage Roles para editar los overwrites del foro.

El cliente usa los intents `Guilds` y `GuildMessages`. `GuildMessages` permite detectar si alguien elimina un mensaje propio del bot y reconstruir la publicación; no permite ni se usa para leer el contenido. No actives `Message Content Intent`: no es necesario para este sistema.


### Recuperación automática

El bot escucha `messageDelete` y `threadDelete`, hace una revisión de integridad cinco segundos después de conectarse y la repite cada hora. Por eso debe permanecer encendido después del despliegue. Los Logs se reconstruyen automáticamente; las Guías borradas se marcan como perdidas o desactualizadas para conservar el flujo manual de **Actualizar en foro**.

## 8. Configuración inicial por comandos

Ejecuta con el propietario o una cuenta con `Administrator`:

```text
/adminrole set rol:@RolAdministradoresWeb
/setlogchannel canal:#logs
/guidesforum set canal:#guias
```

Reglas:

- Solo las personas que tengan el rol elegido pueden activar el modo administrador en la web.
- El propietario y otros `Administrator` pueden configurar el rol, pero no obtienen acceso web si no poseen ese rol.
- `/guidesforum set` configura permisos de solo lectura para los usuarios normales.
- `/setlogchannel` configura los hilos de Logs como solo lectura.

Comprueba con:

```text
/adminrole view
/guidesforum view
/ping
```

## 9. Desplegar la web

Sube el proyecto web actualizado a GitHub Pages después de que SQL, Edge Function y bot estén listos.

La web pública utiliza:

```text
https://empity001.github.io/culones-rpg/
```

No agregues secretos a `js/config.js`. La anon key puede estar en el cliente; la seguridad real depende de RLS y de la Edge Function.

## 10. Primera prueba de login

1. Abre la web en una ventana privada.
2. Pulsa **Iniciar sesión con Discord**.
3. Autoriza la aplicación.
4. Comprueba nombre y avatar.
5. Con una cuenta sin rol, no debe aparecer el botón de modo administrador.
6. Con una cuenta con rol, debe aparecer **Activar modo administrador**.
7. Actívalo y realiza una edición pequeña.
8. Quita el rol desde Discord.
9. Vuelve a la pestaña o intenta otra escritura: el acceso debe revocarse.

## 11. Primera prueba del foro

1. Publica una Guía en la web con categoría, tipo y al menos un rango.
2. Pulsa **Publicar en foro**.
3. Espera a que el job pase de `pending` a `completed`.
4. Comprueba post, tags, rangos, recetas e imágenes.
5. Edita la Guía: **Actualizar en foro** debe iluminarse.
6. Actualiza y confirma que no crea otro post.
7. Oculta la Guía: el post debe eliminarse.
8. Vuelve a mostrarla: no debe republicarse hasta pulsar **Publicar en foro**.

## 12. Reacciones

En Herramientas configura de 0 a 20 emojis. Para emojis personalizados pega:

```text
<:nombre:ID>
<a:nombre:ID>
```

La opción **Aplicar también a todas las publicaciones existentes** puede eliminar reacciones anteriores y sus votos. La web solicita confirmación antes de crear ese trabajo.

## 13. Errores frecuentes

### “No se pudo verificar tu rol”

- Revisa `DISCORD_BOT_TOKEN` y `DISCORD_GUILD_ID` en Edge Functions.
- Confirma que el bot continúa en el servidor.
- Comprueba que `/adminrole view` apunta a un rol existente.

### “Edge Function returned a non-2xx status code”

La interfaz intenta leer el cuerpo JSON y mostrar el código real. Revisa los logs de la función si el mensaje sigue siendo genérico.

### La subida de imágenes falla

- Aplica la migración 021.
- Verifica la Edge Function.
- Confirma que el bucket `culones` existe y mantiene lectura pública.

### El foro no acepta publicaciones

- Ejecuta `/guidesforum view`.
- Revisa permisos del bot.
- Comprueba que el foro no haya alcanzado el máximo de tags.
- La Guía debe tener categoría, tipo y estar visible en la web.

### Un job quedó en `processing`

El worker recupera automáticamente trabajos con más de cinco minutos en `processing`. También puedes reiniciar Railway y revisar la tabla `guide_forum_jobs`.

## 14. Rollback

El rollback técnico recomendado es:

1. Revertir web y bot al deployment anterior.
2. Restaurar el backup de Supabase si necesitas recuperar el sistema de códigos.
3. No intentes usar la web antigua contra la migración 021 sin restaurar también el esquema anterior.

El sistema final no mantiene `/getcode` como puerta de emergencia.

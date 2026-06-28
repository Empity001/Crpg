# Culones RPG — Logs, cuenta admin y bot de Discord

Esto es la primera versión funcional: el sistema de **logs**, la **cuenta admin por código rotativo**
y el **bot de Discord**. El theming completo (estilo "skibidi", cursores personalizados, apartados
de armas/mobs como pestañas) ya tiene una base puesta en `web/style.css` y lo iremos ampliando después,
como pediste.

## Estructura del repo

```
culones-rpg/
├── supabase/
│   ├── schema.sql                  -> correr una vez en el SQL Editor de Supabase
│   └── functions/
│       ├── admin-login/index.ts    -> valida el código y crea una sesión
│       └── admin-write/index.ts    -> crea/edita/borra logs (requiere sesión)
├── bot/
│   ├── index.js                    -> bot principal
│   ├── codeManager.js              -> genera y rota el código cada 24h
│   ├── supabaseAdmin.js
│   ├── deploy-commands.js          -> registra los slash commands
│   ├── commands/
│   │   ├── codigo.js               -> /codigo
│   │   └── configurar-canal.js     -> /configurar-canal
│   └── .env.example
└── web/
    ├── index.html
    ├── style.css
    ├── app.js
    └── config.js
```

## 1. Supabase

1. Entra a tu proyecto → **SQL Editor** → pega y corre todo `supabase/schema.sql`.
2. Ve a **Project Settings → API** y copia tu **service_role key** (la secreta, NO la publishable
   que ya me diste). La vas a necesitar para el bot y para las Edge Functions.
3. Instala el [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started) y desde la carpeta
   `culones-rpg/` corre:
   ```bash
   supabase login
   supabase link --project-ref dbiuommtbshzshnyqyvt
   supabase functions deploy admin-login
   supabase functions deploy admin-write
   ```
   Estas dos funciones ya reciben automáticamente `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`
   inyectadas por Supabase, no hay que configurar nada extra para ellas.
4. En **Database → Replication**, confirma que la tabla `logs` quedó agregada a la publicación
   `supabase_realtime` (el script ya lo hace, pero revísalo si el bot no recibe notificaciones).

## 2. Bot de Discord

1. Ve a https://discord.com/developers/applications → tu aplicación (o crea una) → pestaña **Bot**
   → "Reset Token" → copia el token.
2. En **OAuth2 → URL Generator**, marca los scopes `bot` y `applications.commands`, y los permisos
   `Send Messages`. Usa esa URL para invitar el bot a tu servidor.
3. En tu máquina o en un host (Railway, Render, una VPS, etc — necesita estar corriendo 24/7):
   ```bash
   cd bot
   npm install
   cp .env.example .env
   ```
4. Rellena el `.env`:
   - `DISCORD_BOT_TOKEN` y `DISCORD_CLIENT_ID` (los sacas del paso 1, el client id está en "General Information")
   - `DISCORD_GUILD_ID` con el ID de tu server (clic derecho al servidor con modo desarrollador activado → "Copiar ID")
   - `SUPABASE_SERVICE_ROLE_KEY` (la que copiaste arriba)
   - `ALLOWED_DISCORD_IDS` ya viene con los dos IDs que me diste: `726444396970770494,696486533322113087`
   - `WEBSITE_URL` con el link real de tu GitHub Pages cuando lo tengas
5. Registra los comandos y arranca el bot:
   ```bash
   npm run deploy-commands
   npm start
   ```
6. En Discord, usa `/configurar-canal` (necesitas ser admin del servidor) y elige el canal donde
   quieres que se publiquen los logs nuevos.
7. Cualquiera de los dos IDs permitidos puede usar `/codigo` y el bot le manda el código por DM.
   El código cambia solo cada 24 horas (si pides el código y aún no ha pasado un día, te manda
   el mismo que ya tenías vigente).

## 3. Página web (GitHub Pages)

1. Sube la carpeta `web/` a tu repo `culones-rpg` (puede ser la raíz del repo o una rama `gh-pages`,
   como prefieras).
2. En GitHub → Settings → Pages, activa Pages apuntando a esa carpeta/rama.
3. Tu página quedará en algo como `https://TU-USUARIO.github.io/culones-rpg/` — pon esa URL en
   `WEBSITE_URL` del bot.
4. `web/config.js` ya tiene tu URL y publishable key de Supabase puestas. Si alguna vez regeneras
   esa key pública, solo actualiza ese archivo.

## Cómo funciona la seguridad del admin (resumen rápido)

- El código que da el bot **nunca se guarda en texto plano**, solo su hash (sha256) en la tabla
  `admin_codes`, y expira a las 24h.
- Solo los Discord IDs en `ALLOWED_DISCORD_IDS` pueden pedirlo con `/codigo`.
- Cuando alguien mete el código en la web, la Edge Function `admin-login` lo valida contra ese hash
  y, si es correcto, entrega un **token de sesión** (válido 12h) — la página nunca toca la
  service_role key directamente.
- Crear/editar/borrar logs solo se puede hacer mandando ese token a `admin-write`, que es la única
  pieza con permiso real de escritura (vía service_role). Un usuario normal jamás puede escribir en
  `logs` directamente, ni siquiera con la consola del navegador, porque las políticas RLS no le dan
  permiso de insert/update/delete.
- Los comentarios y likes sí los puede escribir cualquiera (no requieren cuenta), pero nunca pueden
  tocar la tabla `logs` en sí.

## Qué sigue (cuando quieras retomarlo)

- Definir bien las categorías/tags exactos del log (me dijiste que me los mandarías).
- Tematizar a fondo: cursor de la espada de speakerman (ya hay una variable CSS lista para que
  pongas tu imagen: `--cursor-default` en `style.css`), iconos con textura para vida/daño/comida
  (variables `--icon-heart`, `--icon-sword`, `--icon-food`, `--icon-shield`).
- Las pestañas tipo navegador para Armas / Mobs / Ecos / Forja / etc — ya dejé el contenedor
  `#browserTabs` en el HTML listo para que agreguemos pestañas ahí.

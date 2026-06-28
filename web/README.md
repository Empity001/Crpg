# culones-rpg

Plataforma web de logs para servidor Minecraft RPG/Gacha. Sitio 100% estático (HTML/CSS/JS vanilla), pensado para GitHub Pages, con Supabase como backend.

## Estructura

```
culones-rpg/
├── sql/
│   └── schema.sql       ← Ejecutar en Supabase SQL Editor (tablas + RLS + funciones)
└── web/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── config.js     ← Aquí van tus credenciales públicas de Supabase
        └── app.js
```

## 1. Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Ve a **SQL Editor** y pega el contenido completo de `sql/schema.sql`. Ejecútalo.
3. Ve a **Project Settings → API** y copia:
   - `Project URL`
   - `anon public` key
4. Pega ambos valores en `web/js/config.js`:

```js
const SUPABASE_URL = "https://tu-proyecto.supabase.co";
const SUPABASE_ANON_KEY = "tu-anon-key";
```

> La `anon key` **sí puede estar en el frontend** — es pública por diseño. Nunca pongas ahí la `service_role key` (esa es solo para el bot de Discord, en un futuro paso).

## 2. Probar localmente

No necesitas servidor especial, pero los navegadores bloquean `fetch` desde `file://`. Usa cualquier servidor estático simple:

```bash
cd web
python3 -m http.server 8080
# abre http://localhost:8080
```

## 3. Desplegar en GitHub Pages

1. Crea un repositorio en GitHub llamado, por ejemplo, `culones-rpg`.
2. Sube el contenido de la carpeta `web/` (no la carpeta `sql/`) a la raíz del repo, o a una rama `gh-pages`.
3. En GitHub: **Settings → Pages → Source**, selecciona la rama y carpeta donde está `index.html`.
4. Tu sitio quedará en `https://tu-usuario.github.io/culones-rpg/`.

## 4. Cómo funciona el sistema de admin (por ahora)

Hasta que conectemos el bot de Discord (próxima fase), puedes generar un código de admin manualmente desde el SQL Editor de Supabase:

```sql
insert into public.admin_codes (code, expires_at, created_by)
values ('TEST-CODE-123', now() + interval '24 hours', 'manual');
```

Luego, en la web, haz clic en **ADMIN** (arriba a la derecha) e introduce `TEST-CODE-123`. Esto activará el modo administrador en tu navegador (se guarda en `localStorage`), mostrando el botón **+ Nuevo Log** y las opciones de editar/borrar en cada tarjeta.

Cuando el bot de Discord esté listo, él se encargará de generar este código automáticamente cada 24h y enviarlo por privado a los IDs autorizados.

## 5. Seguridad: por qué esto es seguro sin backend propio

- La `anon key` es pública a propósito — no protege nada por sí sola.
- La protección real está en **Row Level Security (RLS)**: la tabla `admin_codes` tiene una política que bloquea *toda* lectura/escritura directa (`using (false)`).
- Crear, editar o borrar un log **no es un INSERT/UPDATE/DELETE directo** desde el frontend — pasa por funciones `RPC` (`create_log`, `update_log`, `delete_log`) que verifican el código de admin **dentro** de la base de datos antes de hacer nada. Aunque alguien lea el código JS y la anon key, no puede saltarse esa verificación.
- Los comentarios y likes sí son de escritura pública (es la función esperada), pero están limitados en longitud y estructura por las políticas RLS.

## Próximos pasos (siguiente fase)

- Bot de Discord en Node.js + discord.js: genera el código cada 24h, lo guarda en `admin_codes`, responde a `/admincode` solo a los IDs autorizados, y publica embeds en un canal cuando se crea un log nuevo (usando Supabase Realtime).
- Despliegue del bot 24/7 en una VM (ej. Oracle Cloud Free Tier) — guía paso a paso pendiente.
- Expansión de las secciones "Guías de Armas" y "Estadísticas".

## 6. Migración 004 — funciones nuevas

Si ya tenías el proyecto corriendo con `schema.sql` + `migration_002` + `migration_003`, solo te falta correr **`sql/migration_004_advanced_features.sql`** completo en el SQL Editor de Supabase. Es seguro de ejecutar sobre una base con datos reales: solo agrega columnas/tablas/funciones nuevas, no borra nada.

Esto habilita:

- **Daño y encantamientos en items** (antes solo los mobs los tenían).
- **Descripción opcional** en cada ficha de mob/item/bloque libre.
- **"Algo más"**: campos libres clave/valor dentro de la ficha de un mob o item, para lo que no esté contemplado en los campos fijos.
- **Imagen de referencia** por bloque (mob/item/libre): se pega una URL de imagen (no hay subida de archivos, ya que el sitio no tiene backend de almacenamiento propio — usa una imagen ya alojada en otro sitio, Discord CDN, Imgur, etc.). Tiene vista previa y un botón "Ver en pantalla completa" que abre la imagen en otra pestaña (`asset-view.html`) con su propio botón de "← Volver".
- **Comentarios mejorados**: like por comentario, respuestas (un nivel de anidación), y moderación de admin (ocultar/mostrar y borrar comentarios — borrar un comentario con respuestas borra también las respuestas).
- **Configurar fichas** (botón de admin junto a "+ Nuevo Log"): permite activar/desactivar y reordenar los campos fijos que se muestran en las fichas de Mob e Item (Vida, Daño, Armor, Equipamiento, Dónde aparece / Rango, Tipo, Daño, Encantamientos, Dónde se obtiene). Los campos personalizados ("Algo más") siempre se muestran aparte, al final.

**Nota de seguridad sobre imágenes:** solo se aceptan URLs `http`/`https` (se descartan otros esquemas como `javascript:`); y como pegar una imagen requiere estar en modo admin (las fichas de mob/item solo se crean/editan vía las funciones RPC protegidas por código), esto no es un punto de entrada para usuarios anónimos.

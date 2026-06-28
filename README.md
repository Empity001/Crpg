# culones-rpg · Centro de Logs

Plataforma web del servidor Minecraft RPG/Gacha **culones-rpg**. Es el lugar donde queda registrado todo lo que cambia en el servidor — mobs nuevos, ítems, eventos, mecánicas — para que cualquier jugador pueda consultarlo, comentar y reaccionar, y donde el staff administra todo ese contenido desde el propio navegador.

Este documento explica **qué hace cada parte de la web**, no cómo instalarla.

---

## 🗂 Navegación

La barra superior tiene 4 pestañas, estilo navegador:

- **📜 Logs** — el contenido principal, explicado abajo.
- **⚔️ Guías de Armas** — sección reservada para el futuro catálogo de armas gacha y builds recomendadas. Todavía no tiene contenido.
- **📊 Estadísticas** — sección reservada para rankings de jugadores, economía y métricas en vivo del servidor. Todavía no tiene contenido.
- **🎮 Acerca del Server** — texto fijo de presentación del servidor.

Arriba a la derecha está el botón **ADMIN**, con un punto que indica si hay una sesión de administrador activa (ver más abajo).

---

## 📜 Sistema de Logs

Un **log** es una entrada de "esto cambió en el servidor". Cada uno tiene:

- **Título** y **descripción** (texto libre, con saltos de línea).
- **Categoría** (ver siguiente sección).
- **Relevancia**: Baja / Normal / Alta / Crítica — se muestra como una etiqueta de color en la tarjeta.
- **Fecha de publicación**, editable libremente por un admin (sirve para registrar algo que pasó antes y no se subió a tiempo).
- **Likes**: cualquier visitante puede darle ❤️ a un log. Es anónimo (no hace falta cuenta), pero cada navegador solo puede dar un like por log — se recuerda con un identificador local, así que recargar la página no permite inflar el contador.
- Opcionalmente, **fichas de Mob, Item y/o Bloque Libre** adjuntas (ver siguiente sección) — son las que le dan estructura a logs como "se agregó un mob nuevo con tales stats".

### Filtrar y ordenar

- Arriba de la grilla hay un filtro por categoría (pastillas: "Todos", y una por cada categoría existente).
- Un selector **"Ordenar por"** permite ordenar por Fecha (recientes o antiguos primero) o por Relevancia (mayor o menor primero), de forma independiente al filtro de categoría.

---

## 🏷 Categorías

Las categorías **no están fijas en el código** — son filas editables en la base de datos. Un administrador puede:

- **Crear** una categoría nueva en cualquier momento (desde el formulario de "Nuevo Log" → "+ Crear categoría nueva"), eligiendo su nombre, un **emoji** y un **color** propios. No hay límite de cuántas se pueden crear.
- **Borrar** una categoría desde esa misma ventana — solo se permite si ningún log la está usando actualmente (si hay logs con esa categoría, el sistema avisa cuántos y no la deja borrar, para no dejar logs huérfanos).

Cada categoría se ve como una pastilla con su emoji, su nombre y su color tanto en los filtros como en la tarjeta de cada log.

---

## 🧩 Fichas dentro de un log: Mob, Item y Bloque Libre

Al crear o editar un log, un admin puede adjuntarle cualquier cantidad de **fichas**, de tres tipos distintos. En la tarjeta del log y en su vista de detalle, cada ficha aparece como un botón compacto (chip) con su nombre — al hacer clic se despliega justo debajo con todos sus datos, sin abrir nada nuevo. Solo una ficha se mantiene abierta a la vez por tarjeta/detalle.

### 👾 Ficha de Mob

Pensada para enemigos, jefes, NPCs hostiles, etc.

- **Nombre**
- **❤️ Vida** y **⚔️ Daño** (obligatorios)
- **🛡 Armor** (opcional)
- **Equipamiento**: una lista de piezas (ej. "Casco de diamante", "Espada de Pyrois"), y cada pieza puede tener sus propios **encantamientos** (también en lista, ej. "Filo V", "Sin Maldición"). No es texto suelto — cada pieza y cada encantamiento son entradas propias, así que se ven como etiquetas separadas y prolijas en vez de una sola frase larga.
- **Dónde aparece** (texto libre, ej. "Aparece en el Nether")

### 🗡 Ficha de Item

Pensada para armas, accesorios, materiales gacha, etc.

- **Nombre**
- **Rango/Tier** (texto libre, ej. "S", "Z", "MK-3" — no hay un set fijo de rangos)
- **Tipo** (ej. "Arma", "Accesorio")
- **⚔️ Daño** (opcional)
- **Encantamientos** (lista, igual que en mob)
- **Dónde se obtiene** (ej. "Máquina de Armas", "Dropeado por X")

### 📋 Bloque Libre (ficha personalizada)

Para todo lo que no encaja como mob ni item: NPCs, estructuras, eventos especiales, lo que sea. Es una ficha completamente en blanco:

- **Nombre del bloque** (vos decidís qué es: "NPC Mercader", "Estructura del Casino", etc.)
- **Campos**: tantos como quieras, cada uno con su propio nombre y valor (ej. "Ubicación" → "Plaza central"). Cada campo además puede tener **sub-campos** propios (un nivel de anidación) — útil para agrupar datos relacionados dentro de un mismo campo.

### Elementos comunes a las tres fichas

- **Descripción** (opcional): notas adicionales en texto libre, con saltos de línea respetados.
- **Imagen de referencia** (opcional): se pega una URL de imagen ya alojada en otro lado (Discord, Imgur, etc. — esta web no almacena archivos). Se muestra una vista previa, y un botón **"⛶ Ver en pantalla completa"** abre la imagen en una pestaña aparte con su propio botón de volver.
- **"Algo más"** (solo mob/item, opcional): campos libres clave/valor adicionales, para cualquier dato que no tenga un campo fijo dedicado. Siempre se muestran al final de la ficha, después de los campos fijos.

---

## ⚙ Configurar fichas

Botón de administrador (junto a "+ Nuevo Log") que permite, por separado para **Mob** y para **Item**:

- **Activar o desactivar** cualquier campo fijo (ej. ocultar "Armor" en todas las fichas de mob si no se usa).
- **Reordenar** en qué orden aparecen esos campos dentro de la ficha, con flechas ▲▼.

Los campos personalizados ("Algo más") no se ven afectados por esta configuración — siempre van al final.

---

## 💬 Comentarios

Cada log tiene su propia sección de comentarios, abajo del detalle:

- Cualquier visitante puede comentar con un **alias opcional** (si no pone nada, queda como "Anónimo").
- Se puede dar **like** a cada comentario.
- Se puede **responder** a un comentario (un nivel de anidación — las respuestas se muestran indentadas debajo del comentario original).
- **Moderación de admin**: cada comentario tiene botones para **ocultar/mostrar** (queda marcado como "OCULTO" para otros admins, pero se puede revertir) o **borrar definitivamente** (borrar un comentario con respuestas borra también todas sus respuestas).

---

## 🔐 Modo Administrador

El botón **ADMIN** (arriba a la derecha) pide un código temporal de 24 horas, que se solicita al bot de Discord con `/admincode`. Una vez validado, el navegador queda "logueado" como admin (se recuerda hasta que el código expire o se cierre sesión manualmente con el mismo botón).

En modo admin aparecen:

- **+ Nuevo Log** y, en cada tarjeta, **✏️ Editar** / **🗑️ Borrar**.
- **+ Crear categoría nueva** y poder borrar categorías existentes.
- **⚙ Configurar fichas**.
- Botones de moderación en los comentarios.
- **🕒 Acciones realizadas** (ver siguiente sección).

---

## 🕒 Acciones realizadas (bitácora)

Botón de administrador que abre un registro de **todo lo que pasa en la web**, en orden cronológico (más reciente primero):

- Logs creados, editados o borrados.
- Cada mob, item o bloque libre agregado o quitado individualmente (no solo "el log cambió" — se ve exactamente qué ficha entró o salió).
- Categorías creadas o borradas.
- Comentarios publicados por cualquier visitante, ocultados, mostrados de nuevo o borrados.
- Cambios guardados en "Configurar fichas".

Este registro es **solo visible para administradores** y es permanente — no depende de haber visto el aviso emergente (toast) en el momento en que ocurrió la acción. Cosas como "dar like" no quedan registradas aquí, para no llenar la bitácora de ruido.

---

## 🔄 Tiempo real

Los logs, sus mobs/items, y los comentarios se sincronizan automáticamente entre navegadores: si un admin publica un log nuevo o alguien comenta, cualquier otra persona que tenga la página abierta lo ve aparecer sin necesidad de recargar.

---

## 🖼 Visor de imágenes a pantalla completa

Cuando una ficha tiene imagen de referencia, "Ver en pantalla completa" la abre en una página dedicada (`asset-view.html`) en una pestaña nueva, mostrando la imagen a tamaño grande sobre fondo oscuro, con su propio título y un botón de "← Volver".

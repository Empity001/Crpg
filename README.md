# culones-rpg · Centro de Logs

Plataforma web del servidor Minecraft RPG/Gacha **culones-rpg**. Es el lugar donde queda registrado todo lo que cambia en el servidor — mobs nuevos, ítems, eventos, mecánicas — para que cualquier jugador pueda consultarlo, comentar y reaccionar, y donde el staff administra todo ese contenido desde el propio navegador.

Este documento explica **qué hace cada parte de la web**, no cómo instalarla.

---

## 🗂 Navegación

La barra superior tiene pestañas estilo navegador:

- **📜 Logs** — el contenido principal, explicado abajo.
- **⚔️ Guía de Armas** — catálogo de armas con buscador, filtros 100% dinámicos, rangos ilimitados, habilidades y recetas de mejora. Explicada más abajo.
- **🏆 Tierlist** — tabla de personajes por tier (fila) y rol (columna: Arma / Sub-arma / Accesorio). Explicada más abajo.
- **🎮 Acerca del Server** — texto fijo de presentación del servidor.
- **🛠 Herramientas** — solo visible con sesión de administrador activa. Biblioteca Multimedia, borradores, exportar/importar y la bitácora de acciones (ver "Modo Administrador" más abajo).

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

Desde **Herramientas** se puede exportar todo. El Excel de logs genera **4 hojas relacionadas** (Logs, Mobs, Items, Bloques Libres) con encabezados estilizados, colores, filtros automáticos y una propiedad por columna — nada de texto plano con todo mezclado. Las listas (equipamiento, encantamientos, "algo más") quedan formateadas de forma legible. También hay un export en JSON completo, pensado para backup/restauración más que para lectura humana.

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
- **Imagen de referencia** (opcional): se puede subir un archivo o reutilizar un recurso desde la Biblioteca Multimedia. Se mantiene como URL en el campo actual para compatibilidad, con vista previa, opción de quitar y botón **"⛶ Ver en pantalla completa"**.
- **"Algo más"** (solo mob/item, opcional): campos libres clave/valor adicionales, para cualquier dato que no tenga un campo fijo dedicado. Siempre se muestran al final de la ficha, después de los campos fijos.

---

## ⚙ Configurar fichas

Botón de administrador (junto a "+ Nuevo Log") que permite, por separado para **Mob** y para **Item**:

- **Activar o desactivar** cualquier campo fijo (ej. ocultar "Armor" en todas las fichas de mob si no se usa).
- **Reordenar** en qué orden aparecen esos campos dentro de la ficha, con flechas ▲▼.

Los campos personalizados ("Algo más") no se ven afectados por esta configuración — siempre van al final.

---

## ⚔️ Guía de Armas

Catálogo de armas independiente del sistema de Logs, con su propia búsqueda y filtros.

### Catálogo

- **Buscador por nombre** en tiempo real.
- **Filtro por categoría** (ej. "MK1", "Legendaria"...) — las categorías las crea el admin con nombre + color, igual que las filas de la Tierlist. No están escritas en el código: en cuanto el admin crea una, aparece como filtro para todos.
- **Filtro por tipo** (ej. "Arma", "Accesorio") — mismo concepto, dinámico, sembrado con "Arma" y "Accesorio" pero ampliable sin tocar código.
- Las armas sin publicar ("ocultas") solo las ve el admin, marcadas con una etiqueta — mismo patrón que los comentarios ocultos: se filtran en el navegador, no por permisos de base de datos.

### Página de un arma

Al hacer clic en una tarjeta se abre su página de detalle (dentro de la misma pestaña, sin recargar):

- **Rangos ilimitados** (MK1, MK2, MK3... el nombre y la cantidad los decide el admin). Un selector tipo pastillas cambia de rango y actualiza automáticamente todo lo que sigue.
- **Estadísticas** del rango activo, mostradas como barra — mismo lenguaje visual que ❤️Vida/⚔️Daño/🛡Armor de mobs e items.
- **Habilidades**: tantas como el admin quiera, cada una con etiqueta, descripción, nivel (con barra) y sus propias estadísticas internas.
- **Receta de mejora**: vista tipo "trade" — materiales (cualquier cantidad) → flecha → resultado. Cada material tiene nombre, imagen y cantidad.
- **Secciones extra libres**: para curiosidades, notas de balance, builds, historia o cualquier apartado futuro, sin necesidad de migrar la base de datos de nuevo. Pueden ser texto libre o una lista de campos clave/valor.

### Modo admin

- **+ Nueva arma**: nombre, imagen, categoría, tipo y rango inicial. Queda **oculta** hasta publicarla desde su propia página.
- Dentro de la página de un arma: editar info básica, publicar/despublicar, borrar arma, agregar/borrar rangos, y editar estadísticas/habilidades/receta/secciones de cada rango — todo con modales enfocados, sin tocar la base de datos a mano.
- Gestión de categorías y tipos desde botones dedicados en la barra del catálogo.

---

Tabla de personajes organizada en **filas dinámicas** (tiers: SSS, SS, S, A... el nombre y color lo define el admin) cruzadas con **3 columnas fijas que no se pueden eliminar**: Arma, Sub-arma y Accesorio.

- **Visitantes**: solo pueden ver la tierlist. Sin botones de edición.
- **Banco "Sin clasificar"**: debajo de la tabla, agrupado también por columna — ahí caen los elementos nuevos hasta que un admin los asigna a una fila.
- **Mover un elemento**: en computadora, **arrastra y suelta** el elemento a la celda destino (otra fila, otra columna, o el banco). En el celular, donde no hay arrastre, cada elemento tiene un botón **↕ Mover** que abre un selector de fila + columna.
- **Admin puede**: crear/renombrar/cambiar color/reordenar/borrar filas (al borrar una fila, sus elementos vuelven al banco, no se pierden); crear/editar/borrar elementos con nombre + imagen subida o reutilizada desde la Biblioteca Multimedia.
- Pensado para crecer: cada elemento tiene un campo `extra_fields` libre en la base de datos por si en el futuro quieres agregarle más datos (rareza, nota, etc.) sin tener que migrar de nuevo.

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
- Herramientas completas de gestión en **🏆 Tierlist**: filas y elementos.
- Herramientas completas de gestión en **⚔️ Guía de Armas**: armas, rangos, categorías y tipos.
- Botones de moderación en los comentarios.
- En **🛠 Herramientas**: Biblioteca Multimedia, borradores, exportar/importar, y el botón discreto **🕒 Acciones** (ver siguiente sección).

---

## 🗂 Biblioteca Multimedia

En **🛠 Herramientas**, el admin puede registrar recursos reutilizables en Supabase Storage. La biblioteca guarda nombre visible, tipo MIME, tipo dinámico, tamaño, hash, tags, descripción, opciones de presentación y usos detectados dentro de Logs, Tierlist, Armas, About, fondo y favicon. También permite minimizar el panel, revisar recursos archivados, restaurarlos o eliminarlos definitivamente con confirmación propia.

Los formularios actuales siguen guardando URLs (`image_url` o equivalentes), pero ahora pueden elegir recursos ya subidos desde el selector multimedia o usar una URL externa solo para ese campo. Los uploads aceptan PNG, JPG/JPEG, WEBP, GIF, SVG y APNG; el modelo queda preparado para MP4 y WEBM desde la biblioteca. El fondo de página guarda presentación por uso (`fit`, posición, repetición y opacidad) en su configuración.

---

## 🕒 Acciones realizadas (bitácora)

Botón discreto (**🕒 Acciones**) en la pestaña **🛠 Herramientas**, que abre un registro de **todo lo que pasa en la web**, en orden cronológico (más reciente primero):

- Logs creados, editados o borrados.
- Cada mob, item o bloque libre agregado o quitado individualmente (no solo "el log cambió" — se ve exactamente qué ficha entró o salió).
- Categorías creadas o borradas.
- Armas, rangos, categorías y tipos de arma creados, editados, publicados/despublicados o borrados.
- Comentarios publicados por cualquier visitante, ocultados, mostrados de nuevo o borrados.
- Cambios guardados en "Configurar fichas".

Este registro es **solo visible para administradores** y es permanente — no depende de haber visto el aviso emergente (toast) en el momento en que ocurrió la acción. Cosas como "dar like" no quedan registradas aquí, para no llenar la bitácora de ruido.

---

## 🔄 Tiempo real

Los logs, sus mobs/items, los comentarios y el catálogo de la Guía de Armas se sincronizan automáticamente entre navegadores: si un admin publica un log o un arma nueva, o alguien comenta, cualquier otra persona que tenga la página abierta lo ve aparecer sin necesidad de recargar.

---

## 🖼 Visor de imágenes a pantalla completa

Cuando una ficha tiene imagen de referencia, "Ver en pantalla completa" la abre en una página dedicada (`asset-view.html`) en una pestaña nueva, mostrando la imagen a tamaño grande sobre fondo oscuro, con su propio título y un botón de "← Volver".

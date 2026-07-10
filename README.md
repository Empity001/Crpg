# culones-rpg · Centro de Logs

Plataforma web del servidor Minecraft RPG/Gacha **culones-rpg**. Es el lugar donde queda registrado todo lo que cambia en el servidor — mobs nuevos, ítems, eventos, mecánicas — para que cualquier jugador pueda consultarlo, comentar y reaccionar, y donde el staff administra todo ese contenido desde el propio navegador.

Este documento explica **qué hace cada parte de la web**, no cómo instalarla.

---

## 🗂 Navegación

Es un sitio de **varias páginas** (cada pestaña es un archivo `.html` propio, no un simple cambio de sección dentro de la misma página), con una barra superior estilo navegador:

- **📜 Logs** (`index.html`) — el contenido principal, explicado abajo.
- **⚔️ Guías** (`weapons.html`) — catálogo de armas con buscador, filtros 100% dinámicos, rangos ilimitados, habilidades, recursos visuales y recetas de mejora. Explicada más abajo.
- **🏆 Tierlist** (`tierlist.html`) — tabla de personajes por tier (fila) y rol (columna: Arma / Sub-arma / Accesorio).
- **🎒 Kits** (`kits.html`) — combinaciones recomendadas de Arma / Accesorio / Sub-arma, en tarjetas.
- **🎮 Acerca del Server** (`about.html`) — página de presentación con bloques editables por el admin.
- **🛠 Herramientas** (`admin.html`) — solo visible con sesión de administrador activa. Biblioteca Multimedia, borradores, exportar/importar, fondo de página, favicon y la bitácora de acciones (ver "Modo Administrador" más abajo).

Arriba a la derecha está el botón **ADMIN**, con un punto que indica si hay una sesión de administrador activa. La sesión se comparte entre todas las páginas: si iniciás sesión en una, ya estás logueado al navegar a las demás.

---

## 📜 Sistema de Logs

Un **log** es una entrada de "esto cambió en el servidor". Cada uno tiene:

- **Título** y **descripción** (texto libre, con saltos de línea).
- **Categoría** (ver siguiente sección).
- **Relevancia**: Baja / Normal / Alta / Crítica — se muestra como una etiqueta de color en la tarjeta.
- **Fecha de publicación**, editable libremente por un admin (sirve para registrar algo que pasó antes y no se subió a tiempo).
- **Likes**: cualquier visitante puede darle ❤️ a un log. Es anónimo (no hace falta cuenta), pero cada navegador solo puede dar un like por log — se recuerda con un identificador local, así que recargar la página no permite inflar el contador.
- Opcionalmente, **fichas de Mob, Item y/o Bloque Libre** adjuntas (ver siguiente sección) — son las que le dan estructura a logs como "se agregó un mob nuevo con tales stats".

Desde **Herramientas** se puede exportar todo. El Excel de logs genera **4 hojas relacionadas** (Logs, Mobs, Items, Bloques Libres) con encabezados estilizados, colores, filtros automáticos y una propiedad por columna — nada de texto plano con todo mezclado. Las listas (equipamiento, encantamientos, "algo más") quedan formateadas de forma legible. También hay un export en JSON completo, pensado para backup/restauración más que para lectura humana, y un **backup completo** que junta logs, tierlist, kits y armas en un solo archivo.

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
- **🔗 Enlazar con Guías** (opcional): la ficha puede apuntar a un arma/rango concreto de la Guía de Armas (ver sección dedicada más abajo).
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
- **Recursos visuales**: una pequeña galería de tarjetas (imagen + nombre) arriba de la descripción del rango, pensada para mostrar variantes, skins o referencias sueltas — cada una puede tener su propio enlace a otra arma/rango (ver "Enlazar con Guías").
- **Estadísticas** del rango activo, mostradas como barra — mismo lenguaje visual que ❤️Vida/⚔️Daño/🛡Armor de mobs e items.
- **Habilidades**: tantas como el admin quiera, cada una con etiqueta, descripción, nivel (con barra) y sus propias estadísticas internas.
- **Receta de mejora**: vista tipo Minecraft, con **4 modos** a elección del admin por cada método de fabricación (un arma puede tener varios métodos, ej. "se intercambia" y "se craftea" al mismo tiempo):
  - **Se intercambia** (trade): materiales en cualquier cantidad → flecha → resultado.
  - **Se craftea** (crafting): mesa de crafteo 3×3 completa.
  - **Se funde** (furnace/blast furnace/smoker): ingrediente + combustible → resultado.
  - **Mejorar equipamiento** (smithing): plantilla + equipo base + material → resultado.
  - Cada material/slot y el resultado pueden tener nombre, imagen, cantidad y su propio enlace a otra arma/rango (ver "Enlazar con Guías") — un slot puede incluso ser *solo* un enlace, sin nombre ni imagen.
- **Secciones extra libres**: para curiosidades, notas de balance, builds, historia o cualquier apartado futuro, sin necesidad de migrar la base de datos de nuevo. Pueden ser texto libre o una lista de campos clave/valor.

### Modo admin

- **+ Nueva arma**: nombre, imagen, categoría, tipo y rango inicial. Queda **oculta** hasta publicarla desde su propia página.
- Dentro de la página de un arma: editar info básica, publicar/despublicar, borrar arma, agregar/borrar rangos, y editar recursos visuales/estadísticas/habilidades/receta/secciones de cada rango — todo con modales enfocados, sin tocar la base de datos a mano.
- Gestión de categorías y tipos desde botones dedicados en la barra del catálogo.

---

## 🏆 Tierlist

Tabla de personajes/objetos organizada en **filas dinámicas** (tiers: SSS, SS, S, A... el nombre y color lo define el admin) cruzadas con **3 columnas fijas que no se pueden eliminar**: Arma, Sub-arma y Accesorio.

- **Visitantes**: solo pueden ver la tierlist. Sin botones de edición.
- **Banco "Sin clasificar"**: debajo de la tabla, agrupado también por columna — ahí caen los elementos nuevos hasta que un admin los asigna a una fila.
- **Mover un elemento**: en computadora, **arrastra y suelta** el elemento a la celda destino (otra fila, otra columna, o el banco). En el celular, donde no hay arrastre, cada elemento tiene un botón **↕ Mover** que abre un selector de fila + columna.
- **Admin puede**: crear/renombrar/cambiar color/reordenar/borrar filas (al borrar una fila, sus elementos vuelven al banco, no se pierden); crear/editar/borrar elementos con nombre + imagen subida o reutilizada desde la Biblioteca Multimedia, y opcionalmente un **enlace a Guías** (ver sección dedicada).
- Pensado para crecer: cada elemento tiene un campo `extra_fields` libre en la base de datos por si en el futuro quieres agregarle más datos (rareza, nota, etc.) sin tener que migrar de nuevo.

---

## 🎒 Kits

Combinaciones recomendadas de equipamiento, pensadas para responder "¿con qué me armo?": cada **kit** es una tarjeta con nombre, descripción opcional y tres columnas fijas (Arma / Accesorio / Sub-arma), cada una con la cantidad de piezas que el admin quiera.

- **Visitantes**: ven todos los kits publicados.
- **Cada pieza de un kit** tiene nombre, imagen (subida o desde la Biblioteca Multimedia) y, opcionalmente, un **enlace a Guías** que hace clickeable la pieza entera.
- **Admin puede**: crear/editar/publicar-despublicar/borrar kits, y armar/reordenar las piezas de cada columna.
- Comparte patrón visual y arquitectura con la Tierlist (misma idea de columnas fijas + banco de piezas), pero como página propia (`kits.html`) en vez de convivir con la tabla de tiers.

---

## 🔗 Enlazar con Guías ("Ver en Guías")

Una misma arma o rango de la Guía de Armas puede estar referenciada desde muchos lugares distintos de la web. En vez de repetir su imagen y su nombre por todos lados, cualquiera de estos elementos puede **enlazarse** directamente a esa arma/rango:

- Las fichas de Mob, Item y Bloque Libre dentro de un log.
- Los elementos de la Tierlist.
- Las piezas de un Kit.
- Los recursos visuales y los slots de receta (materiales/resultado) de un rango de arma — así una arma puede "citar" a otra arma como parte de su propia receta.

Cuando un elemento tiene este enlace configurado, deja de comportarse como una simple imagen: al hacer clic (o tocar), lleva directo a la página de esa arma con el rango correspondiente ya seleccionado. Visualmente no cambia nada — sigue viéndose igual que cualquier otro elemento — solo se nota que es clickeable con un resaltado sutil al pasar el mouse. Si un elemento no tiene enlace configurado, sigue funcionando como siempre (por ejemplo, abriendo la imagen a pantalla completa en vez de navegar a otro lado).

Es un campo 100% opcional en cada uno de esos lugares — no reemplaza ni requiere tener nombre/imagen propios; un elemento puede ser *solo* un enlace si así se quiere.

---

## 🎮 Acerca del Server

Página de presentación, totalmente editable por el admin mediante un **editor de bloques**: se arma agregando cualquier cantidad de bloques, en el orden que se quiera, de estos tipos:

- **🔤 Título**
- **📝 Texto**
- **🖼 Imagen** (subida o desde la Biblioteca Multimedia)
- **➖ Separador**
- **✨ Destacado**

El admin puede agregar, reordenar, editar y borrar bloques; los visitantes solo ven el resultado ya armado.

---

## 💬 Comentarios

Cada log tiene su propia sección de comentarios, abajo del detalle:

- Cualquier visitante puede comentar con un **alias opcional** (si no pone nada, queda como "Anónimo").
- Se puede dar **like** a cada comentario.
- Se puede **responder** a un comentario (un nivel de anidación — las respuestas se muestran indentadas debajo del comentario original).
- **Moderación de admin**: cada comentario tiene botones para **ocultar/mostrar** (queda marcado como "OCULTO" para otros admins, pero se puede revertir) o **borrar definitivamente** (borrar un comentario con respuestas borra también todas sus respuestas).

---

## 🔐 Modo Administrador

El botón **ADMIN** (arriba a la derecha) pide un código temporal de 24 horas, que se solicita al bot de Discord con `/admincode`. Una vez validado, el navegador queda "logueado" como admin en **todas las páginas** (se recuerda hasta que el código expire o se cierre sesión manualmente con el mismo botón).

En modo admin aparecen:

- **+ Nuevo Log** y, en cada tarjeta, **✏️ Editar** / **🗑️ Borrar**.
- **+ Crear categoría nueva** y poder borrar categorías existentes.
- **⚙ Configurar fichas**.
- Herramientas completas de gestión en **🏆 Tierlist**: filas y elementos.
- Herramientas completas de gestión en **⚔️ Guías**: armas, rangos, categorías, tipos, recursos visuales y recetas.
- Herramientas completas de gestión en **🎒 Kits**: crear/editar/publicar/borrar kits y sus piezas.
- Editor de bloques completo en **🎮 Acerca del Server**.
- Botones de moderación en los comentarios.
- La pestaña **🛠 Herramientas** completa: Biblioteca Multimedia, borradores, exportar/importar, fondo de página, favicon, y el botón discreto **🕒 Acciones** (ver siguiente sección).

---

## 🗂 Biblioteca Multimedia

En **🛠 Herramientas**, el admin puede registrar recursos reutilizables en Supabase Storage. La biblioteca guarda nombre visible, tipo MIME, tipo dinámico, tamaño, hash, tags, descripción, opciones de presentación y usos detectados dentro de Logs, Tierlist, Kits, Guías, About, fondo y favicon. También permite minimizar el panel, revisar recursos archivados, restaurarlos o eliminarlos definitivamente con confirmación propia.

Los formularios actuales siguen guardando URLs (`image_url` o equivalentes), pero ahora pueden elegir recursos ya subidos desde el **selector multimedia** — un modal liviano (solo vista previa, nombre básico, tipo y botón "Usar") independiente del panel de administración completo de la biblioteca — o usar una URL externa solo para ese campo. Los uploads aceptan PNG, JPG/JPEG, WEBP, GIF, SVG y APNG; el modelo queda preparado para MP4 y WEBM desde la biblioteca. El fondo de página guarda presentación por uso (`fit`, posición, repetición y opacidad) en su configuración.

---

## 🎨 Fondo de página y favicon

También dentro de **🛠 Herramientas**, el admin puede personalizar la apariencia general del sitio para **todos los visitantes**, con vista previa en vivo mientras se ajusta:

- **Fondo de página**: se sube una imagen (arrastrando o eligiendo archivo) que reemplaza el fondo oscuro por defecto, con tres modos de adaptación (fija tipo POV, continua tipo lienzo largo, o completa sin recortes) y la posibilidad de elegir **en qué pestañas** se muestra (Logs, Guías, Tierlist, Kits, About y/o Herramientas, cada una por separado). Se puede quitar en cualquier momento.
- **Favicon**: ícono cuadrado que aparece en la pestaña del navegador y al guardar la página como favorito, también configurable por subida de imagen.

---

## 🕒 Acciones realizadas (bitácora)

Botón discreto (**🕒 Acciones**) en la pestaña **🛠 Herramientas**, que abre un registro de **todo lo que pasa en la web**, en orden cronológico (más reciente primero):

- Logs creados, editados o borrados.
- Cada mob, item o bloque libre agregado o quitado individualmente (no solo "el log cambió" — se ve exactamente qué ficha entró o salió).
- Categorías creadas o borradas.
- Armas, rangos, categorías y tipos de arma creados, editados, publicados/despublicados o borrados.
- Kits creados, editados o borrados.
- Comentarios publicados por cualquier visitante, ocultados, mostrados de nuevo o borrados.
- Cambios guardados en "Configurar fichas".

Este registro es **solo visible para administradores** y es permanente — no depende de haber visto el aviso emergente (toast) en el momento en que ocurrió la acción. Cosas como "dar like" no quedan registradas aquí, para no llenar la bitácora de ruido.

---

## 🔄 Tiempo real

Los logs, sus mobs/items, los comentarios, el catálogo de la Guía de Armas, la Tierlist y los Kits se sincronizan automáticamente entre navegadores: si un admin publica un log, un arma nueva o un kit, o alguien comenta, cualquier otra persona que tenga la página abierta lo ve aparecer sin necesidad de recargar.

---

## 🔗 Enlaces directos (Deep Links) desde Discord

Cada embed que publica el bot en Discord lleva **URLs que abren directamente el contenido relevante** en la web:

- **Título del log en el embed resumen** → enlaza a `index.html?log=<id>`, que abre automáticamente el modal de detalle de ese log exacto.
- **Cada mob, item y bloque libre en los embeds del hilo** → incluye un campo `🔗 Ver en la web` que lleva a `index.html?log=<id>&item=<id_del_bloque>`. La web abre el log, expande el bloque correspondiente, hace scroll hasta él y lo resalta con una animación de pulso durante ~2 segundos.

Los enlaces usan siempre las IDs reales de la base de datos (UUIDs), no nombres ni posiciones, por lo que son estables aunque el log se edite, se reordenen sus bloques o cambie su título.

La web mantiene **compatibilidad total** con el funcionamiento existente: si se accede sin parámetros `?log=` ni `?item=`, se comporta exactamente igual que antes.

---

## 🖼 Visor de imágenes a pantalla completa

Cuando una ficha tiene imagen de referencia (y no tiene un enlace a Guías configurado), "Ver en pantalla completa" la abre en una página dedicada (`asset-view.html`) en una pestaña nueva, mostrando la imagen a tamaño grande sobre fondo oscuro, con su propio título y un botón de "← Volver".

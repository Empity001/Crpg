# Rebrand visual 2026

Esta versión aplica el nuevo estilo oscuro, orgánico y fantástico a todo el sitio sin reemplazar la lógica existente.

## Cambios principales

- Navegación horizontal convertida en una sidebar fija en escritorio.
- Menú lateral desplegable en móvil.
- Botón inferior para entrar o salir del Modo Admin.
- El grupo de administración solo aparece cuando existe una sesión administrativa activa.
- Cabecera visual propia para Logs, Guías, Tierlist, Kits, Acerca del servidor y Herramientas.
- Nuevo estilo para tarjetas, filtros, formularios, modales, biblioteca multimedia y herramientas administrativas.
- Todos los corazones conservan el color rosa; el azul queda reservado para mecánicas y estados visuales.
- Vista responsive revisada para escritorio, tablet y móvil.
- El visor de imágenes también fue adaptado a la nueva paleta.

## Archivos de lógica modificados

- `js/app/shell.js`: añade las cabeceras visuales y el menú móvil.
- `js/features/auth.js`: actualiza textos y estados visuales del botón de Modo Admin.

No se modificaron las funciones de Supabase, CRUD, likes, comentarios, categorías, armas, tierlist, kits, importación, exportación, multimedia ni SQL.

## Hoja visual

La mayor parte del rediseño está aislada en:

- `css/rebrand.css`

Esta hoja se carga después de los estilos anteriores para conservar compatibilidad y reducir el riesgo de romper componentes existentes.

## Verificación realizada

- Sintaxis de todos los módulos JavaScript.
- Resolución del grafo de imports de las seis páginas.
- IDs duplicados y referencias locales de HTML/CSS/JS.
- Parseo de todas las hojas CSS.
- Previsualización visual de usuario normal, usuario administrador, móvil, formulario de logs y página de herramientas.

## Corrección de interfaces y rendimiento (10 Jul 2026)

Se corrigió el sistema de overlays sin modificar el CRUD ni la integración con Supabase:

- Todos los modales se montan en un `#modal-portal` fijo y fuera del flujo del documento.
- La biblioteca multimedia ya no aumenta el alto de la página ni aparece al final del contenido.
- El selector multimedia limita su alto y desplaza únicamente su cuadrícula interna.
- Se eliminó el `backdrop-filter: blur(...)` de los overlays, que causaba retrasos con muchas miniaturas.
- La cuadrícula de la biblioteca se descarga al cerrar el selector y sus tarjetas usan renderizado diferido.
- El terminal de inicio de sesión administrativo se desmonta mientras está cerrado y se crea solo al abrir Modo Admin.
- El terminal vuelve a ocupar toda la pantalla; la regla general de los modales ya no lo comprime.
- Abrir un modal bloquea el scroll de la página y evita saltos hacia el final del documento.
- Los modales dinámicos de confirmación, edición multimedia, URL externa y biblioteca usan la misma capa aislada.

## Corrección del selector multimedia y recetas

- El selector multimedia monta un máximo de 32 miniaturas por tanda, incluso si una RPC antigua devuelve toda la biblioteca.
- Se eliminan duplicados y se descarga por completo la cuadrícula al cerrar el selector.
- Las miniaturas vuelven a mostrarse de forma estable en Brave; los recursos dañados enseñan un estado de error en vez de una tarjeta vacía.
- La cuadrícula tiene altura fija y desplazamiento interno, por lo que nunca aumenta el alto de la página.
- El editor de mejora/fabricación usa un modal ancho con desplazamiento propio.
- Los nueve slots de crafteo conservan tres columnas en escritorio, dos en tablet y una en móvil.
- Los selectores de enlaces a Guías permanecen dentro de cada slot.

## Corrección 3 — categorías/tipos, móvil y acceso admin

- Las categorías de Guías ahora se pueden editar (nombre y color) usando el RPC existente `update_weapon_category`.
- Los tipos de Guías ahora se pueden editar usando `update_weapon_type`.
- Se añadió cancelación de edición y estado visual para la fila activa.
- En móvil, el sidebar comienza debajo de la barra superior para que el nombre Culones-RPG no quede tapado.
- El indicador de sesión administrativa tiene su propio cuadro y ya no queda recortado por el footer.
- El terminal de acceso fue reducido de más de 80 líneas a 14 líneas esenciales.
- Se eliminó el desplazamiento automático al fondo durante la animación; el campo del código queda visible y el modal conserva scroll si hiciera falta.

## Ajustes adicionales — 10 de julio de 2026

- El botón de Modo Admin queda anclado al pie del sidebar móvil.
- El editor de kits fue simplificado: se retiraron los controles de copiar/pegar/duplicar y ahora cada elemento muestra Nombre, Imagen y Enlace con Guías de forma clara.
- Se corrigieron textos con codificación dañada en el editor de “Acerca del servidor”.
- El modo “Completa, sin recortes” ahora usa una imagen completa sobre un fondo ampliado y difuminado, sin recortar los bordes importantes.
- Se añadió personalización independiente de los banners de Logs, Guías, Tierlist, Kits, Acerca del servidor y Herramientas.
- Tamaño recomendado para banners: 1600 × 420 px. Formato recomendado: WEBP; PNG para transparencias y JPG para fotografías. Máximo 8 MB.

## Corrección 2026-07-10 · móvil, admin y selector multimedia

- El drawer móvil bloquea por completo el desplazamiento horizontal y reinicia `scrollLeft` al abrirse.
- El bloque de sesión administrativa y el botón para salir permanecen dentro del ancho del drawer.
- La biblioteca completa usa tarjetas compactas y carga 24 recursos por tanda en móvil.
- El selector multimedia móvil aparece centrado, con margen exterior y altura limitada.
- Los filtros y controles de presentación se organizan en dos columnas en pantallas pequeñas.
- El botón «Mostrar más» ya no flota sobre las últimas tarjetas.
- Cada recurso del selector muestra una acción visible «Usar imagen».
- La selección normaliza el ID del recurso, admite callbacks asíncronos y muestra estado mientras se aplica.

/* fix9 workspace */

## Corrección responsive 9

- El sidebar móvil usa una cuadrícula de tres filas: marca, navegación desplazable y controles administrativos.
- Las pestañas ya no quedan detrás del bloque de sesión ni desaparecen al redimensionar la ventana.
- Al abrir o redimensionar el drawer se restablece tanto el scroll horizontal como el vertical.
- El espacio flexible antiguo se desactiva en móvil para evitar zonas vacías.

## Identidad visual configurable

- El bloque de iconos de Herramientas permite editar en la misma caja el favicon y el logo del menú.
- El logo del menú usa `site_logo_url` dentro de `app_settings` y vuelve a las espadas originales cuando queda vacío.
- La paleta global usa `theme_config` dentro de `app_settings`; no requiere una migración SQL nueva.
- Los colores se aplican mediante variables CSS globales y mantienen los valores originales como respaldo.

## Menús contextuales, copiar, pegar y duplicar

- Se añadió un sistema común de paneles contextuales flotantes en `js/core/context-actions.js`.
- El panel se coloca automáticamente a la derecha, izquierda, debajo o encima del elemento según el espacio visible, y se monta en `#modal-portal` para no deformar la interfaz.
- Los botones pequeños de acciones fueron sustituidos por un único disparador «Acciones» en logs, kits, tierlist, armas, habilidades y bloques de “Acerca del servidor”.
- Logs completos y sus fichas internas pueden copiarse, pegarse, duplicarse, editarse o eliminarse desde el panel contextual.
- Los kits completos y sus elementos internos tienen portapapeles independiente, duplicado y pegado sin alterar la estructura guardada.
- Los elementos de tierlist pueden editarse, moverse, copiarse, pegarse, duplicarse y eliminarse, conservando el arrastre existente.
- Las armas pueden copiarse o duplicarse como nuevas entradas y las habilidades conservan sus acciones administrativas en el mismo sistema.
- El editor de fabricación/mejora usa slots cuadrados. Al pulsar un slot se abre un panel con Nombre, vista previa, Subir imagen, Biblioteca, Propiedades y Acciones.
- Propiedades contiene cantidad y enlace con Guías; Acciones contiene copiar, pegar, duplicar y eliminar/vaciar.
- Los modales generales son más amplios, pero el crafteo de 3×3 conserva exactamente sus nueve espacios y sigue adaptándose a móvil.
- El portapapeles es temporal y separado por tipo de contenido, por lo que pegar un kit no puede sobrescribir accidentalmente una ficha de log o un material de receta.

## Ajuste de rangos y recetas (2026-07-10)

- La biblioteca multimedia se monta por encima de los paneles contextuales y cierra el panel que la abrió para evitar capas cruzadas.
- Cada rango tiene un menú contextual con editar, copiar, duplicar, pegar como nuevo y eliminar.
- Duplicar un rango conserva estadísticas, habilidades, secciones y todos sus métodos de fabricación.
- El editor de recetas usa slots de tamaño fijo y uniforme en crafteo, horno, herrería e intercambio.
- El resultado aparece junto a la cuadrícula con una flecha, como en las interfaces de Minecraft, y también dispone de editor contextual.
- La vista pública utiliza el mismo tamaño para materiales y resultado en todas las variantes.

## Ajuste de resultado de recetas y paneles contextuales

- El resultado de crafteo, horno, herrería e intercambio ahora guarda y muestra cantidad.
- La edición del resultado vive únicamente en su slot; se eliminó el formulario duplicado inferior.
- Los paneles contextuales se reposicionan al expandir Propiedades o Acciones y mantienen scroll interno.
- Los encabezados de modales reservan espacio para el botón de cierre.

## Paleta local o global

El editor de colores ahora permite elegir el alcance antes de guardar:

- **Solo este navegador:** guarda la paleta en `localStorage` bajo la clave `culones_theme_local_v1`. Se aplica únicamente a ese navegador, dispositivo y dominio.
- **Todo el servidor:** mantiene el guardado existente en `app_settings.theme_config` mediante `update_app_setting`.

La paleta local tiene prioridad sobre la global. Desde Herramientas se puede pulsar **Usar colores del servidor en este navegador** para eliminar la personalización local.

No requiere migración SQL.

## Distribución de Logs maestro/detalle

- La sección de Logs dejó la cuadrícula de tres columnas y ahora usa un listado compacto a la izquierda con un inspector persistente a la derecha.
- Al seleccionar un log se muestran Resumen, Mobs, Items y Bloques sin abrir un modal.
- El modal completo se conserva para fichas desplegables y comentarios.
- Se mantienen filtros, orden, likes, paginación progresiva y todas las acciones administrativas existentes.
- En tablet y móvil el inspector se convierte en un panel lateral adaptable que se abre al seleccionar una fila.
- No se añadieron autor, buscador global, enlaces directos ni otros datos que no existían en el proyecto.

## Ajuste de Logs: selección, detalle y portada

- La página de Logs inicia sin seleccionar ningún registro.
- El inspector lateral solo se abre cuando el visitante selecciona un log.
- Las fichas de Mobs, Items y Bloques del inspector son desplegables y reutilizan el detalle completo del log.
- Cada log puede tener una portada independiente mediante `logs.cover_image_url`.
- Si la portada está vacía, la lista muestra el icono de la categoría; ya no toma automáticamente la imagen de un mob o item.
- Se corrigió la alineación vertical de etiquetas y la distribución de las acciones del inspector.

### SQL obligatorio

Ejecuta una vez `sql/migration_018_log_cover_image.sql` en Supabase. La página puede seguir leyendo logs antes de aplicar la migración, pero crear o editar una portada requiere esa migración.

## Auditoría de colores de botones (2026-07-11)

- La paleta ahora distingue botones principales, secundarios, seleccionados, desactivados, de confirmación, advertencia, información, evento y eliminación.
- Se añadieron colores de texto independientes para cada familia, evitando texto blanco fijo sobre colores claros.
- Los botones de Logs, Guías, Tierlist, Kits, Acerca del servidor, Herramientas, biblioteca multimedia, modales, menús contextuales y modo administrador usan variables semánticas compartidas.
- Publicar la paleta global ya no reemplaza temporalmente la paleta personal del navegador: si existe una paleta local, se mantiene activa.
- No requiere migración SQL. Los nuevos campos se almacenan dentro del JSON existente `app_settings.theme_config`; las paletas antiguas reciben valores predeterminados automáticamente.

## Corrección móvil del inspector de Logs — 2026-07-11

- La cabecera y las pestañas del detalle ya no se comprimen cuando hay muchas fichas.
- El título del log permanece visible en pantallas estrechas.
- El contenido de Resumen, Mobs, Items y Bloques usa un área de desplazamiento táctil propia.
- Al cambiar de pestaña o seleccionar otro log, el detalle vuelve al inicio.
- Al expandir una ficha, solo se desplaza el cuerpo del inspector y no la página completa.

## Reemplazo global de archivos multimedia — 2026-07-11

- «Editar recurso» ahora incluye una sección para elegir un archivo nuevo y reemplazarlo en todos sus usos.
- El archivo nuevo se sube a una ruta distinta para evitar caché antigua del navegador/CDN.
- La migración 019 actualiza URLs directas y URLs anidadas dentro de recetas, kits, borradores y ajustes globales en una sola transacción.
- El objeto anterior de Storage solo se elimina después de confirmar que las referencias fueron actualizadas.
- Se conserva el mismo registro de `media_assets`, junto con nombre visible, descripción, etiquetas y presentación.
- Imágenes y videos solo pueden reemplazarse por archivos de la misma familia para no romper los componentes donde ya están utilizados.

### SQL obligatorio

Ejecuta una vez `sql/migration_019_replace_media_asset.sql` en Supabase antes de usar esta función.

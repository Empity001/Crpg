# Auditoría de rendimiento 01

Deploy asociado: `performance-hardening-01`

## Riesgos altos corregidos

| Área | Riesgo anterior | Cambio aplicado |
| --- | --- | --- |
| Modo administrador | Cada activación podía repetir sesión, configuración y consulta del miembro en Discord. | Single-flight en el botón, reutilización de una validación reciente y cachés cortas dentro de la Edge Function. Las escrituras siguen comprobando el rol. |
| Entrada a Logs como admin | Se invocaba la Edge Function tres veces para Logs, mobs e ítems, repitiendo autenticación. | Nueva acción `logs_admin_bundle`: una autenticación y tres lecturas paralelas. |
| Logs públicos | Se descargaban todas las filas de mobs e ítems solo para contar fichas. | RPC `list_public_logs_with_counts`, que devuelve conteos agregados. |
| Realtime | Un cambio recibido durante una recarga podía perderse; varios eventos podían provocar trabajo solapado. | Una sola recarga activa por clave y, como máximo, una recarga final pendiente. |
| Auditoría administrativa | Buscar `request_id` dentro de JSON podía recorrer `action_log` completa. | Índice por expresión sobre `metadata ->> 'request_id'`. |
| Relaciones de Guías | Las búsquedas inversas sobre `extra_fields` JSONB crecían sin índices. | Índices GIN para Logs y Tierlist. |
| Estado del foro | Polling fijo y consultas repetidas aunque nada hubiera cambiado. | Caché corta, deduplicación y espera progresiva de 3 a 10 segundos. |
| Herramientas | La biblioteca calculaba usos en siete tablas apenas se abría la página. | La biblioteca inicia minimizada y calcula usos únicamente al expandirse. |
| Tierlist | Cada celda filtraba y ordenaba otra vez la colección completa. | Agrupación única O(N) antes del render. |
| Dobles clics | Varias acciones podían enviar dos peticiones idénticas. | Deduplicación de RPC administrativas, botones ocupados y guardas en comentarios. |

## Riesgos medios reducidos

- La interfaz administrativa ya no vuelve a renderizar todas las páginas si el
  usuario, su rol y el estado admin no cambiaron.
- Las recargas propias se suprimen antes de escribir, evitando que Realtime se
  adelante a la respuesta de la RPC.
- Las cargas concurrentes de comentarios comparten promesa por Log.
- La configuración del servidor, la identidad autenticada y el miembro de
  Discord tienen cachés separadas y limitadas en tamaño.
- Las consultas ordenadas más frecuentes reciben índices compuestos.

## Riesgos que permanecen y cuándo atenderlos

| Prioridad | Riesgo restante | Señal para actuar | Próxima medida recomendada |
| --- | --- | --- | --- |
| Alta al crecer | El editor admin de Logs aún necesita descargar todas las fichas. | Cientos de Logs o varios miles de fichas; entrada admin claramente lenta. | Paginar Logs administrativos y cargar fichas al editar/abrir cada Log. |
| Alta al crecer | El catálogo de Guías carga armas y rangos para disponer de filtros y detalles. | Más de 300–500 Guías o payload de varios MB. | RPC de catálogo liviano + carga de rangos bajo demanda. |
| Media | Herramientas calcula usos en siete tablas al expandir la biblioteca. | Expandir tarda más de un segundo. | Tabla/index de referencias multimedia mantenida por triggers. |
| Media | La lista de borradores puede producir consultas adicionales por borrador. | Decenas o cientos de borradores por administrador. | RPC que devuelva la lista y sus metadatos en una sola consulta. |
| Media | El estado del foro todavía recalcula el hash mientras un trabajo está activo. | Muchas Guías publicándose a la vez. | Guardar una versión/hash de contenido y comparar ese valor sin reconstruirlo. |
| Media | Imágenes originales grandes siguen dependiendo del archivo subido. | Tráfico móvil alto o imágenes de varios MB. | Miniaturas WebP/AVIF y `srcset`, conservando el original para ampliar. |
| Baja | La hoja visual está dividida en varios CSS históricos. | La cobertura de estilos se vuelve difícil de mantener. | Medir CSS no usado y consolidar por página, sin mezclarlo con cambios funcionales. |

## Controles incluidos

- Cachés Edge con expiración y límites de entradas; no son almacenamiento
  permanente.
- Las escrituras nunca confían únicamente en el estado admin del navegador.
- Fallbacks temporales mantienen la carga si la Edge Function o la migración
  024 todavía no se propagaron.
- Los enlaces copiados no consultan Supabase: se generan localmente a partir
  de IDs estables.

## Verificación realizada antes del ZIP

- Sintaxis de los 64 módulos JavaScript.
- Resolución de imports locales.
- Enlaces locales e IDs duplicados en los siete HTML.
- Balance estructural de las 17 hojas CSS.
- Empaquetado de la Edge Function TypeScript con `esbuild`.
- Validación estática de los objetos JSON y de los elementos requeridos por la
  migración 024.

La prueba final de latencia real debe hacerse después de desplegar la migración
y la Edge Function, porque depende de la región, datos y cachés de Supabase y
Discord.

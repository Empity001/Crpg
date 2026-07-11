# Corrección de arranque y consumo de memoria

Esta revisión corrige el bloqueo de la pantalla durante la carga y varias fuentes de crecimiento progresivo de memoria.

## Cambios principales

- El buscador global ya no forma parte del arranque: se importa únicamente al pulsar la lupa o usar `Ctrl/Cmd + K`.
- La configuración visual remota se consulta en segundo plano. Los colores locales y predeterminados se aplican inmediatamente.
- Las categorías y los logs se cargan en paralelo.
- Las consultas iniciales desactivan los reintentos automáticos de PostgREST y tienen cancelación por tiempo límite.
- El cliente de Supabase no inicializa Supabase Auth porque el proyecto usa su propio código administrativo.
- Los canales de Realtime son únicos, se reutilizan y se eliminan al abandonar la página.
- El observador de modales solo vigila cambios reales de visibilidad dentro del portal de modales; ya no observa todo el documento ni reacciona a sus propias clases.
- Al cancelar la animación del login de administrador se resuelven también sus promesas pendientes, evitando conservar nodos y pilas asíncronas.
- Los selectores multimedia, borradores y temporizadores liberan sus recursos al cerrar o abandonar la página.
- Se añadió un watchdog independiente: si el grafo de módulos no termina de iniciar en 12 segundos, aparece una opción de recarga sin caché en lugar de una pantalla vacía.
- Supabase se sirve desde una copia local del cliente JavaScript para que una caída del CDN no rompa toda la página.

## Compatibilidad

No cambia el esquema de datos ni requiere una migración SQL nueva.

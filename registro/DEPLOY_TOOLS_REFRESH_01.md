# Deploy: tools-refresh-01

Este despliegue modifica únicamente la página y `discord-admin-api`. El bot de
Discord no se modifica.

## Orden recomendado

1. Despliega primero la Edge Function:

   ```bash
   supabase functions deploy discord-admin-api
   ```

2. Sube la página a GitHub Pages.

3. Cuando Pages termine, fuerza una recarga con `Ctrl + F5`.

No hay una migración SQL nueva en este deploy.

## Qué cambia

- Herramientas se divide en Inicio, Contenido, Datos, Discord y Apariencia.
- Biblioteca, Borradores, Discord, Excel y editores visuales se cargan solo al
  abrir su sección.
- Inicio incorpora un diagnóstico bajo demanda de Supabase, Edge Function,
  Discord, Realtime y cola del foro. No mantiene polling activo.
- Excel se descarga bajo demanda; SheetJS ya no bloquea la entrada a la página.
- El respaldo JSON pasa a esquema `culones-rpg-backup` versión 2 e incluye
  Logs, categorías, Tierlist, Guías, rangos, Kits, multimedia y ajustes.
- El respaldo pagina las tablas en bloques de 1,000 filas para no truncar
  colecciones grandes por el límite de la API de Supabase.
- La exportación completa obtiene ese paquete con una sola invocación
  administrativa; las lecturas internas se resuelven en paralelo en la Edge
  Function y no repiten la validación de Discord por cada sección.
- El importador conserva IDs y relaciones, acepta respaldos v1 y v2, y mezcla
  el contenido sin eliminar registros ausentes del archivo.
- Las dependencias de una restauración parcial se limitan a las categorías y
  tipos realmente usados por lo seleccionado; una colisión de ID en una ficha
  hija no puede moverla silenciosamente a otro Log o Guía.
- Los Logs y Guías que no existían se restauran ocultos para evitar una
  publicación automática o masiva en Discord; los existentes conservan su
  visibilidad actual.
- El reporte visual crea un ZIP con `index.html`, `data.json` y `LEEME.txt`.
- Excel incorpora una hoja adicional para Kits.

El respaldo cubre el contenido administrable. No copia sesiones, secretos,
comentarios de visitantes, votos/likes, bitácora histórica ni trabajos internos
de Discord. Multimedia conserva metadatos y URLs; los binarios continúan en
Supabase Storage.

## Prueba rápida

1. Abre Herramientas y confirma que Inicio aparece sin cargar la Biblioteca.
2. Pulsa **Comprobar ahora** dos veces; cada comprobación debe terminar y no
   deben quedar solicitudes periódicas en la pestaña Network.
3. Entra a Contenido, expande Biblioteca y revisa Borradores.
4. En Datos, descarga JSON, Reporte visual y Excel.
5. Abre el ZIP y carga `index.html`; prueba su buscador y navegación.
6. Vuelve a Datos, selecciona el JSON y confirma que aparece el resumen de
   conflictos antes de escribir.
7. Para una prueba segura, deja todos los conflictos en **Saltar** y restaura
   únicamente un registro nuevo o usa una copia de la base.
8. En Discord, confirma que las reacciones siguen cargando y guardando.
9. En Apariencia, visita Fondo, Banners, Iconos y Colores; cada formulario debe
   conservar los valores actuales.

## Reversión

Si necesitas volver atrás, restaura la versión anterior de la página y vuelve
a desplegar su copia de `discord-admin-api`. Los respaldos v2 no alteran la base
por sí solos: solo escriben después de confirmar la restauración.

# Deploy: performance-hardening-01

Este despliegue optimiza la página y la Edge Function. No modifica el bot ni
ningún contrato que el bot utilice.

## Orden de despliegue

1. En Supabase → SQL Editor, ejecuta:

   `sql/migration_024_performance_hardening.sql`

2. Despliega la Edge Function actualizada:

   ```bash
   supabase functions deploy discord-admin-api
   ```

3. Sube el contenido de la página a GitHub Pages.

4. Cuando GitHub Pages termine, haz una recarga forzada con `Ctrl + F5`.

La web conserva fallbacks para seguir cargando si la migración o la Edge
Function tardan en propagarse, pero la mejora completa requiere los tres pasos.

## Qué cambia

- Activar el modo administrador reutiliza durante tres minutos una
  comprobación válida ya realizada.
- El botón queda bloqueado mientras comprueba el rol para evitar dobles clics.
- La interfaz solo notifica a cada página cuando el estado administrativo
  realmente cambia.
- La Edge Function comparte durante periodos cortos las comprobaciones de
  sesión, configuración y miembro de Discord.
- Logs administrativos obtiene Logs, mobs e ítems con una sola autenticación.
- Los visitantes reciben conteos agrupados sin descargar una fila por cada
  bloque de todos los Logs.
- Realtime conserva una única recarga final si llega otro cambio mientras una
  carga está en curso.
- Las consultas de relaciones de Guías y auditoría reciben índices dedicados.
- El estado del foro de Guías usa caché, deduplicación y polling progresivo.
- La Biblioteca Multimedia de Herramientas inicia minimizada y no construye su
  índice de uso hasta que se expande.
- Tierlist agrupa sus elementos una sola vez por render.
- Las RPC administrativas idénticas y simultáneas comparten la misma petición.
- Logs, fichas de Logs, Guías, Kits y elementos de Tierlist permiten copiar
  enlaces profundos y muestran la confirmación **Enlace copiado**.
- **Acciones → Duplicar** en Kits conserva arma, accesorio y sub-arma en un
  editor nuevo; la copia no se guarda hasta que el administrador la confirme.

## Prueba rápida

1. Inicia sesión, cambia modo admin tres veces y comprueba que no aparezcan
   toasts duplicados.
2. En Logs, activa modo admin y abre/edita un Log.
3. Abre una Guía con asociaciones y revisa Logs, Kits y Tierlist relacionados.
4. Abre Herramientas: la biblioteca debe comenzar minimizada y cargar al
   pulsar **Expandir**.
5. Crea un comentario pulsando una sola vez y después intenta doble clic; solo
   debe publicarse una vez.
6. Revisa en Supabase que `migration_024` terminara sin errores.
7. Usa **Copiar enlace** en un Log, una ficha, una Guía, un Kit y un elemento
   de Tierlist; abre cada URL en una pestaña privada y comprueba el enfoque.
8. En un Kit, elige **Acciones → Duplicar**, cambia el nombre y guarda. El Kit
   original debe permanecer intacto.

# Empi Network · experiencia del constructor · archivos modificados

Esta reparación contiene 15 archivos nuevos o modificados. Corrige la publicación
de instancias, mantiene los avisos visibles arriba, añade scroll independiente,
mejora los diálogos y agrega una guía con secciones listas para construir más rápido.

## Archivos

- `builder.html`
- `CHANGED_FILES.md`
- `css/network-builder.css`
- `css/network.css`
- `index.html`
- `js/network/builder.js`
- `js/network/owner.js`
- `js/network/site.js`
- `owner.html`
- `README.md`
- `registro/DEPLOY_EMPI_NETWORK_PHASE3.md`
- `scripts/verify-phase3.mjs`
- `site.html`
- `sql/migration_026_empi_network_builder.sql`
- `sql/migration_028_builder_experience_and_publish.sql`

## Aplicación inmediata

Si la migración 026 ya está instalada, ejecuta primero la 027 si todavía no lo
hiciste y después `sql/migration_028_builder_experience_and_publish.sql`. Publica
los archivos web y fuerza una recarga con `Ctrl + F5`. No hace falta redesplegar
las Edge Functions. Culones RPG continúa usando su experiencia original.

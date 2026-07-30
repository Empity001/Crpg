# Empi Network · hotfix de Fase 3 · archivos modificados

Esta reparación contiene solo los 12 archivos nuevos o modificados. Corrige la
creación de instancias, coloca los avisos arriba, explica el modo legacy de
Culones y reduce el trabajo de renderizado del constructor.

## Archivos

- `builder.html`
- `CHANGED_FILES.md`
- `css/network-builder.css`
- `css/network.css`
- `js/network/builder.js`
- `js/network/owner.js`
- `owner.html`
- `README.md`
- `registro/DEPLOY_EMPI_NETWORK_PHASE3.md`
- `scripts/verify-phase3.mjs`
- `sql/migration_026_empi_network_builder.sql`
- `sql/migration_027_phase3_instance_defaults.sql`

## Aplicación inmediata

Si la migración 026 ya está instalada, ejecuta solamente
`sql/migration_027_phase3_instance_defaults.sql` y publica los archivos web.
No hace falta redesplegar las Edge Functions. Culones RPG continúa usando su
experiencia original sin modificaciones.

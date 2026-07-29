# Empi Network · Fase 1 · archivos modificados

Este paquete contiene solo los 29 archivos nuevos o modificados. Copia su
contenido sobre la raíz del repositorio `empi-network`, preservando las carpetas.
No incluye dependencias, `.git`, archivos sin cambios ni secretos.

## Archivos

- `assets/network/empi-mark.png`
- `css/network.css`
- `index.html`
- `js/config.js`
- `js/core/state.js`
- `js/features/auth.js`
- `js/features/command-center.js`
- `js/features/drafts-list.js`
- `js/features/global-search.js`
- `js/features/guide-relations.js`
- `js/features/logs.js`
- `js/features/notifications.js`
- `js/network/api.js`
- `js/network/owner.js`
- `js/network/portal.js`
- `js/network/session.js`
- `js/network/site.js`
- `js/pages/admin.js`
- `js/pages/logs.js`
- `logs.html`
- `owner.html`
- `partials/header.html`
- `README.md`
- `registro/DEPLOY_EMPI_NETWORK_PHASE1.md`
- `scripts/verify-phase1.mjs`
- `site.html`
- `sql/migration_025_empi_network_foundation.sql`
- `supabase/functions/discord-admin-api/index.ts`
- `supabase/functions/network-admin-api/index.ts`

## Orden de despliegue

Lee primero `registro/DEPLOY_EMPI_NETWORK_PHASE1.md`. En resumen: backup,
migración 025 en staging, secreto Owner, ambas Edge Functions, OAuth, web y
matriz de aceptación. No publiques la web antes de preparar backend y rollback.


# Empi Network · Fase 3 · archivos modificados

Esta entrega contiene los 18 archivos nuevos o modificados de la fase web
completa. No incluye dependencias, secretos, `.git` ni `supabase/.temp`.

## Archivos

- `builder.html`
- `CHANGED_FILES.md`
- `css/network-builder.css`
- `css/network.css`
- `js/config.js`
- `js/network/builder-schema.js`
- `js/network/builder.js`
- `js/network/owner.js`
- `js/network/site.js`
- `owner.html`
- `README.md`
- `registro/DEPLOY_EMPI_NETWORK_PHASE3.md`
- `scripts/verify-phase3.mjs`
- `site.html`
- `sql/migration_026_empi_network_builder.sql`
- `supabase/config.toml`
- `supabase/functions/network-admin-api/index.ts`
- `supabase/functions/network-public-api/index.ts`

## Orden de despliegue

Lee `registro/DEPLOY_EMPI_NETWORK_PHASE3.md`: backup, verificación local,
migración 026, Edge Functions, web y matriz de aceptación. Culones RPG sigue
usando `logs.html`, que no fue modificado.

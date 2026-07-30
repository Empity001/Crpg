import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function source(path) {
  return readFileSync(join(root, path), 'utf8');
}

const required = [
  'README.md', 'CHANGED_FILES.md',
  'builder.html', 'site.html', 'owner.html', 'logs.html',
  'css/network.css', 'css/network-builder.css',
  'js/config.js', 'js/network/builder-schema.js', 'js/network/builder.js',
  'js/network/site.js', 'js/network/owner.js',
  'sql/migration_025_empi_network_foundation.sql',
  'sql/migration_026_empi_network_builder.sql',
  'sql/migration_027_phase3_instance_defaults.sql',
  'supabase/functions/network-admin-api/index.ts',
  'supabase/functions/network-public-api/index.ts',
  'supabase/config.toml',
  'registro/DEPLOY_EMPI_NETWORK_PHASE3.md',
];
for (const path of required) assert(existsSync(join(root, path)), `Existe ${path}`);

for (const htmlPath of ['builder.html', 'owner.html', 'site.html']) {
  const html = source(htmlPath);
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(!duplicates.length, `IDs únicos: ${htmlPath}${duplicates.length ? ` (${duplicates.join(', ')})` : ''}`);
  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|data:|#)/i.test(target)) continue;
    const clean = target.split(/[?#]/)[0];
    if (!clean) continue;
    const absolute = normalize(join(root, clean));
    assert(absolute.startsWith(root) && existsSync(absolute), `Recurso local: ${htmlPath} -> ${clean}`);
  }
}

for (const [htmlPath, jsPath, dynamicIds] of [
  ['builder.html', 'js/network/builder.js', []],
  ['owner.html', 'js/network/owner.js', []],
  ['site.html', 'js/network/site.js', ['instance-custom-theme']],
]) {
  const htmlIds = new Set([...source(htmlPath).matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]));
  const references = new Set([...source(jsPath).matchAll(/\bbyId\(["']([^"']+)["']\)|getElementById\(["']([^"']+)["']\)/g)].map(match => match[1] || match[2]));
  const missing = [...references].filter(id => !htmlIds.has(id) && !dynamicIds.includes(id));
  assert(!missing.length, `Referencias HTML resueltas: ${jsPath}${missing.length ? ` (${missing.join(', ')})` : ''}`);
}

const migration = source('sql/migration_026_empi_network_builder.sql');
const hotfixMigration = source('sql/migration_027_phase3_instance_defaults.sql');
const adminApi = source('supabase/functions/network-admin-api/index.ts');
const publicApi = source('supabase/functions/network-public-api/index.ts');
const supabaseConfig = source('supabase/config.toml');
const builder = source('js/network/builder.js');
const renderer = source('js/network/site.js');
const schema = source('js/network/builder-schema.js');
const owner = source('js/network/owner.js');

assert(/^begin;/im.test(migration) && /commit;\s*$/i.test(migration), 'Migración 026 es transaccional');
assert(/^begin;/im.test(hotfixMigration) && /commit;\s*$/i.test(hotfixMigration), 'Migración 027 es transaccional');
assert((migration.match(/\$\$/g) || []).length % 2 === 0, 'Bloques dollar-quoted SQL balanceados');
for (const marker of [
  'site_pages', 'site_page_versions', 'site_theme_versions', 'site_reusable_components',
  'module_registry', 'site_module_instances', 'site_collections', 'site_collection_fields',
  'site_collection_records', 'site_form_submissions', 'site_workflows', 'site_admin_controls',
  'network_create_page', 'network_save_page', 'network_publish_page',
  'network_restore_page_version', 'network_save_theme', 'network_restore_theme_version',
  'network_submit_collection_form', 'network_archive_site', 'network_restore_site',
]) assert(migration.includes(marker), `Contrato SQL presente: ${marker}`);
assert(migration.includes('site_pages_public_published'), 'RLS publica solo páginas publicadas');
assert(migration.includes('site_records_public_published'), 'RLS publica solo registros publicados');
for (const table of ['site_module_capabilities', 'site_collection_fields', 'site_collection_records']) {
  assert(migration.includes(`where s.id = ${table}.site_id`), `RLS de ${table} comprueba que la instancia está activa`);
}
assert(/'site_workflows','site_admin_controls','site_form_submissions'/.test(migration), 'Respuestas de formularios usan la política no-client');
assert(migration.includes("input_site_id = '00000000-0000-4000-8000-000000000001'"), 'SQL protege Culones contra archivado');
assert(migration.includes("'Apariencia inicial de la instancia'"), 'Cada instancia nace con versión visual inicial');
assert(/draft_theme_config\s+set default/i.test(hotfixMigration), 'Hotfix 027 corrige el valor visual inicial');
assert(hotfixMigration.includes('set draft_theme_config = theme_config'), 'Hotfix 027 recupera valores nulos de forma segura');
assert(migration.includes('revoke all on function public.network_create_site(text,text,text,text,uuid,text) from public'), 'Creación de instancias queda reservada al service role');
assert(/\[functions\.network-public-api\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig), 'Formulario público desactiva JWT de plataforma explícitamente');
assert(/\[functions\.network-admin-api\][\s\S]*?verify_jwt\s*=\s*true/.test(supabaseConfig), 'API Owner mantiene JWT obligatorio');

for (const marker of [
  'requireOwner(ctx)', 'CULONES_LEGACY_PROTECTED', 'MAX_DOCUMENT_NODES', 'DOCUMENT_DEPTH_LIMIT',
  'CUSTOM_CSS_UNSAFE', 'FIELD_SITE_MISMATCH', 'list_admin_controls', 'export_structure',
  'import_structure', 'list_audit', 'archive_site', 'restore_site',
]) assert(adminApi.includes(marker), `Protección/API Owner presente: ${marker}`);
assert(adminApi.includes(".eq('id', componentId).eq('site_id', siteId)"), 'Componentes validan pertenencia a la instancia');
assert(adminApi.includes(".eq('id', moduleId).eq('site_id', siteId)"), 'Módulos validan pertenencia a la instancia');
assert(adminApi.includes(".eq('id', collectionId).eq('site_id', siteId)"), 'Colecciones validan pertenencia a la instancia');

for (const marker of [
  'WRITABLE_TYPES', 'FORM_RATE_LIMIT', 'allowPublicSubmissions', 'input_fingerprint',
  'network_submit_collection_form', 'FIELD_TYPE_UNSUPPORTED', 'FORM_FIELD_UNKNOWN',
]) assert(publicApi.includes(marker), `Protección de formulario presente: ${marker}`);

for (const marker of [
  'renderPageDocument', 'responsive.tablet.columns', 'responsive.mobile.columns',
  'visibility.roles', 'collection-view', 'form', 'navigation', 'search',
]) assert(schema.includes(marker), `Constructor soporta: ${marker}`);
for (const marker of [
  'toggleAdminExposure', 'previewMode', 'restoreVersion', 'exportCurrentSite',
  'submitImport', 'loadCollectionRecords', 'submitRecord', 'renderAudit',
  'schedulePreviewRender', 'Crear página editable',
]) assert(builder.includes(marker), `Owner Studio soporta: ${marker}`);
for (const marker of [
  'hydrateCollection', 'hydrateForm', 'runSearch', 'applyNavigation', 'applySearch',
  "window.location.replace(page.published_document.legacyUrl || 'logs.html')",
]) assert(renderer.includes(marker), `Render público soporta: ${marker}`);
for (const marker of ['renderNavigationEditor', 'collectNavigationItems', 'list_theme_versions', 'save_theme']) {
  assert(owner.includes(marker), `Panel Owner soporta: ${marker}`);
}

const forbidden = /window\.(?:alert|confirm|prompt)|\beval\s*\(|document\.write\s*\(/;
for (const path of ['js/network/builder.js', 'js/network/owner.js', 'js/network/site.js', 'js/network/builder-schema.js']) {
  assert(!forbidden.test(source(path)), `Sin diálogos nativos ni evaluación dinámica: ${path}`);
}

const logsBytes = Buffer.from(readFileSync(join(root, 'logs.html'), 'utf8').replace(/\r\n/g, '\n'));
const logsBlobHash = createHash('sha1').update(`blob ${logsBytes.length}\0`).update(logsBytes).digest('hex');
assert(logsBlobHash === 'e0e42f51cc28f31bf035b4c3c519d7992fe1325a', 'Culones logs.html permanece idéntico al commit base de Fase 3');

if (failures.length) {
  console.error(`PHASE3_VERIFIER_FAILED (${failures.length}/${checks})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PHASE3_VERIFIER_OK (${checks} comprobaciones)`);

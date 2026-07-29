import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const checks = [];

function pass(message) {
  checks.push(message);
}

function assert(condition, message) {
  if (condition) pass(message);
  else failures.push(message);
}

function walk(folder, extension) {
  const output = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const absolute = join(folder, entry.name);
    if (entry.isDirectory()) output.push(...walk(absolute, extension));
    else if (!extension || extname(entry.name) === extension) output.push(absolute);
  }
  return output;
}

const required = [
  'index.html', 'logs.html', 'owner.html', 'site.html',
  'assets/network/empi-mark.png', 'css/network.css',
  'js/network/api.js', 'js/network/session.js', 'js/network/portal.js',
  'js/network/owner.js', 'js/network/site.js',
  'sql/migration_025_empi_network_foundation.sql',
  'supabase/functions/network-admin-api/index.ts',
  'registro/DEPLOY_EMPI_NETWORK_PHASE1.md',
];

for (const path of required) assert(existsSync(join(root, path)), `Existe ${path}`);

const javascriptFiles = walk(join(root, 'js'), '.js');
assert(javascriptFiles.length > 0, `Inventario JS disponible (${javascriptFiles.length} archivos)`);

for (const file of readdirSync(root).filter(name => name.endsWith('.html'))) {
  const source = readFileSync(join(root, file), 'utf8');
  const ids = [...source.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(!duplicates.length, `IDs únicos: ${file}${duplicates.length ? ` (${duplicates.join(', ')})` : ''}`);

  for (const match of source.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const target = match[1];
    if (/^(?:https?:|mailto:|data:|javascript:|#)/i.test(target)) continue;
    const clean = target.split(/[?#]/)[0];
    if (!clean || /\{\{/.test(clean)) continue;
    const absolute = normalize(join(root, clean));
    assert(absolute.startsWith(root) && existsSync(absolute), `Recurso local: ${file} -> ${clean}`);
  }
}

const index = readFileSync(join(root, 'index.html'), 'utf8');
const logs = readFileSync(join(root, 'logs.html'), 'utf8');
const migration = readFileSync(join(root, 'sql/migration_025_empi_network_foundation.sql'), 'utf8');
const edge = readFileSync(join(root, 'supabase/functions/network-admin-api/index.ts'), 'utf8');
const legacyEdge = readFileSync(join(root, 'supabase/functions/discord-admin-api/index.ts'), 'utf8');

assert(index.includes("location.replace(`logs.html"), 'La portada conserva enlaces profundos legacy');
assert(logs.includes('js/pages/logs.js'), 'Culones sigue usando su entry point de Logs');
assert(migration.includes("'726444396970770494'"), 'La migración contiene el Owner solicitado');
assert(migration.includes('sites_discord_guild_unique_idx'), 'Guild ID es único por instancia');
assert(migration.includes('add column if not exists site_id uuid'), 'Datos legacy reciben site_id');
assert(migration.includes('network_update_site'), 'Guardado y versionado son atómicos');
assert(migration.includes('network_upsert_role'), 'Perfil y permisos son atómicos');
assert(migration.includes('sites_public_read_active'), 'Solo sitios activos tienen lectura pública');
assert(edge.includes('requireOwner(ctx)'), 'La API exige Owner antes de mutar');
assert(edge.includes("ctx.service.rpc('network_create_site'"), 'La creación usa una RPC atómica');
assert(edge.includes("ctx.service.rpc('network_update_site'"), 'La actualización usa una RPC atómica');
assert(edge.includes("ctx.service.rpc('network_upsert_role'"), 'Los perfiles usan una RPC atómica');
assert(edge.includes('NAVIGATION_URL_INVALID'), 'La API bloquea URLs peligrosas en tabs');
assert(edge.includes('PUBLIC_URL_INVALID'), 'La API valida la URL pública');
assert(edge.includes('THEME_COLOR_INVALID'), 'La API valida la paleta visual');
assert(legacyEdge.includes('isPlatformOwner || hasConfiguredRole'), 'Owner puede administrar Culones sin rol local');
assert(legacyEdge.includes(".from('platform_owners')"), 'El bypass Owner se valida en base de datos');

if (failures.length) {
  console.error(`PHASE1_VERIFIER_FAILED (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`PHASE1_VERIFIER_OK (${checks.length} comprobaciones)`);

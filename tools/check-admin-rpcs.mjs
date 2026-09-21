// Comprueba que la lista de la Edge Function encaja con las firmas de las migraciones.
//
// discord-admin-api añade `input_code: null` a toda RPC administrativa salvo a las de
// CODELESS_RPCS. Si una función nueva no lleva `input_code` en su firma y se olvida
// en CODELESS_RPCS, la RPC falla en producción con "Could not find the function"
// (así falló list_weapons_admin: el panel no cargaba el catálogo de Guías).
//
// Uso: node tools/check-admin-rpcs.mjs   (sale con código 1 si algo no encaja)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/discord-admin-api/index.ts'), 'utf8');

function setFrom(name) {
  const match = edge.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!match) throw new Error(`No encuentro ${name} en index.ts`);
  return new Set([...match[1].matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]));
}

const admin = setFrom('ADMIN_RPCS');
const codeless = setFrom('CODELESS_RPCS');

// La última definición de cada función (por orden de archivo) manda.
const hasCode = new Map();
const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8');
  for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:returns|language|as\b)/gi)) {
    hasCode.set(m[1].toLowerCase(), /\binput_code\b/i.test(m[2]));
  }
}

const problems = [];
for (const name of admin) {
  if (!hasCode.has(name)) continue; // definida fuera de las migraciones (o de solo lectura antigua): no se puede juzgar
  const withCode = hasCode.get(name);
  if (!withCode && !codeless.has(name)) problems.push(`${name}: su firma no lleva input_code pero falta en CODELESS_RPCS`);
  if (withCode && codeless.has(name)) problems.push(`${name}: su firma sí lleva input_code pero está en CODELESS_RPCS`);
}
for (const name of codeless) {
  if (!admin.has(name)) problems.push(`${name}: está en CODELESS_RPCS pero no en ADMIN_RPCS`);
}

if (problems.length) {
  console.error('Lista de RPC desalineada:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`OK: ${admin.size} RPC administrativas, ${codeless.size} sin input_code, todas alineadas con las migraciones.`);

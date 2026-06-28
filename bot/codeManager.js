// bot/codeManager.js
const crypto = require('crypto');
const supabaseAdmin = require('./supabaseAdmin');

const CODE_LENGTH = 8;
const CODE_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 horas
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0,O,1,I para evitar confusiones

function generarCodigoAleatorio() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Devuelve el código de admin vigente en texto plano.
 * Si no hay uno activo o ya expiró, genera uno nuevo, desactiva los viejos
 * y lo guarda hasheado en Supabase (nunca en texto plano).
 *
 * OJO: como solo guardamos el hash, el código en texto plano solo puede
 * "recordarse" mientras el bot esté corriendo. Por eso lo cacheamos en memoria
 * (currentPlainCode) — si reinicias el bot dentro de las 24h, se genera uno nuevo
 * (lo cual está bien: simplemente invalida el anterior).
 */
let currentPlainCode = null;
let currentExpiresAt = null;

async function obtenerOCrearCodigoVigente() {
  const now = new Date();

  if (currentPlainCode && currentExpiresAt && currentExpiresAt > now) {
    return { code: currentPlainCode, expiresAt: currentExpiresAt };
  }

  // Genera uno nuevo
  const plainCode = generarCodigoAleatorio();
  const hash = sha256(plainCode);
  const expiresAt = new Date(Date.now() + CODE_LIFETIME_MS);

  // Desactiva todos los códigos anteriores
  await supabaseAdmin.from('admin_codes').update({ active: false }).eq('active', true);

  // Inserta el nuevo
  const { error } = await supabaseAdmin.from('admin_codes').insert({
    code_hash: hash,
    active: true,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    console.error('Error guardando el nuevo código de admin:', error);
    throw error;
  }

  currentPlainCode = plainCode;
  currentExpiresAt = expiresAt;

  return { code: plainCode, expiresAt };
}

/** Fuerza la rotación del código aunque el actual siga siendo válido. */
async function forzarRotacion() {
  currentPlainCode = null;
  currentExpiresAt = null;
  return obtenerOCrearCodigoVigente();
}

module.exports = { obtenerOCrearCodigoVigente, forzarRotacion };

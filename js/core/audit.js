// =========================================================
// audit.js
// =========================================================
// Registro de acciones administrativas iniciado desde el cliente.
// Es best-effort: si el RPC aun no existe, la accion principal no falla.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from './state.js';

const MAX_AUDIT_DESCRIPTION = 220;

export function localAuditTime(date = new Date()) {
  return new Intl.DateTimeFormat('es-DO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function compactAuditText(text, fallback = 'dato no disponible') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return fallback;
  return clean.length > MAX_AUDIT_DESCRIPTION
    ? `${clean.slice(0, MAX_AUDIT_DESCRIPTION - 1)}…`
    : clean;
}

export function quotedAuditName(name, fallback = 'recurso sin nombre') {
  return `"${compactAuditText(name, fallback)}"`;
}

export function mediaAuditLabel(asset = {}) {
  const name = quotedAuditName(asset.display_name || asset.name || asset.original_name);
  const technicalType = compactAuditText(asset.mime_type || asset.mimeType || asset.type || '', '');
  const kind = compactAuditText(asset.media_kind || asset.kind || '', '');
  const parts = [technicalType, kindLabel(kind)].filter(Boolean);
  return parts.length ? `${name} (${parts.join(', ')})` : name;
}

export function kindLabel(kind) {
  const labels = {
    image: 'Imagen',
    video: 'Video',
    audio: 'Audio',
    document: 'Documento',
    other: 'Otro',
  };
  return labels[kind] || '';
}

export function countSummary(label, count) {
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? `${n} ${label}` : '';
}

export async function recordAdminAction(action, description) {
  if (!state.adminCode || !action || !description) return;
  const cleanDescription = compactAuditText(description);
  try {
    const { error } = await supabaseClient.rpc('record_admin_action', {
      input_code: state.adminCode,
      input_action: compactAuditText(action, 'admin_action'),
      input_description: cleanDescription,
    });
    if (error) {
      const msg = String(error.message || '').toLowerCase();
      if (!msg.includes('record_admin_action')) {
        console.warn('No se pudo registrar la acción admin:', error);
      }
    }
  } catch (error) {
    console.warn('No se pudo registrar la acción admin:', error);
  }
}

// =========================================================
// drafts-store.js
// =========================================================
// Persistencia compartida de borradores. Mantiene localStorage como
// respaldo inmediato y usa Supabase si la sesión admin está activa.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';

const LOCAL_DRAFT_PREFIX = 'culones_draft_';
const REMOTE_DRAFT_PREFIX = 'remote:log:';

export function draftEntityId(logId) {
  return logId && logId !== 'new' ? String(logId) : 'new';
}

export function draftKey(logId) {
  const entityId = draftEntityId(logId);
  return entityId === 'new' ? `${LOCAL_DRAFT_PREFIX}log_new` : `${LOCAL_DRAFT_PREFIX}log_${entityId}`;
}

export function remoteDraftKey(entityId) {
  return `${REMOTE_DRAFT_PREFIX}${encodeURIComponent(draftEntityId(entityId))}`;
}

export function parseRemoteDraftKey(key) {
  if (!key?.startsWith(REMOTE_DRAFT_PREFIX)) return null;
  return decodeURIComponent(key.slice(REMOTE_DRAFT_PREFIX.length)) || 'new';
}

export function isLocalDraftKey(key) {
  return key?.startsWith(LOCAL_DRAFT_PREFIX);
}

export function listLocalDrafts() {
  const drafts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!isLocalDraftKey(key)) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && draft.savedAt) drafts.push({ key, source: 'local', isRemote: false, ...draft });
    } catch(e) {}
  }
  return drafts;
}

export function saveLocalDraft(logId, draft) {
  const key = draftKey(logId);
  localStorage.setItem(key, JSON.stringify(draft));
  return key;
}

export function loadLocalDraft(logId) {
  return loadLocalDraftByKey(draftKey(logId));
}

export function loadLocalDraftByKey(key) {
  if (!isLocalDraftKey(key)) return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

export function deleteLocalDraft(logId) {
  localStorage.removeItem(draftKey(logId));
}

export function deleteLocalDraftByKey(key) {
  if (isLocalDraftKey(key)) localStorage.removeItem(key);
}

function canUseRemoteDrafts() {
  return !!state.adminCode;
}

function normalizeRemoteDraft(row, draft) {
  if (!draft?.data) return null;
  const entityId = draftEntityId(row?.entity_id || draft.logId || 'new');
  return {
    key: remoteDraftKey(entityId),
    source: 'remote',
    isRemote: true,
    ...draft,
    logId: entityId === 'new' ? null : entityId,
    savedAt: draft.savedAt || row?.saved_at || new Date().toISOString(),
  };
}

export async function upsertRemoteDraft(logId, draft) {
  if (!canUseRemoteDrafts()) return { skipped: true };
  const { error } = await supabaseClient.rpc('upsert_draft', {
    input_code: state.adminCode,
    input_entity_type: 'log',
    input_entity_id: draftEntityId(logId),
    input_payload: draft,
  });
  if (error) console.warn('No se pudo sincronizar el borrador:', error);
  return { error };
}

export async function getRemoteDraft(logId) {
  if (!canUseRemoteDrafts()) return null;
  const entityId = draftEntityId(logId);
  const { data, error } = await supabaseClient.rpc('get_draft', {
    input_code: state.adminCode,
    input_entity_type: 'log',
    input_entity_id: entityId,
  });
  if (error) {
    console.warn('No se pudo leer el borrador remoto:', error);
    return null;
  }
  return normalizeRemoteDraft({ entity_id: entityId, saved_at: data?.saved_at }, data?.payload);
}

export async function listRemoteDrafts() {
  if (!canUseRemoteDrafts()) return [];
  const { data, error } = await supabaseClient.rpc('list_drafts', { input_code: state.adminCode });
  if (error) {
    console.warn('No se pudo listar borradores remotos:', error);
    return [];
  }
  const rows = (data || []).filter(row => row.entity_type === 'log');
  const drafts = await Promise.all(rows.map(row => getRemoteDraft(row.entity_id)));
  return drafts.filter(Boolean);
}

export async function deleteRemoteDraft(logId) {
  if (!canUseRemoteDrafts()) return { skipped: true };
  const { error } = await supabaseClient.rpc('delete_draft', {
    input_code: state.adminCode,
    input_entity_type: 'log',
    input_entity_id: draftEntityId(logId),
  });
  if (error) console.warn('No se pudo eliminar el borrador remoto:', error);
  return { error };
}

export async function deleteRemoteDraftByKey(key) {
  const entityId = parseRemoteDraftKey(key);
  return entityId ? deleteRemoteDraft(entityId) : { skipped: true };
}

export async function loadDraftByKey(key) {
  const remoteEntityId = parseRemoteDraftKey(key);
  if (remoteEntityId) return getRemoteDraft(remoteEntityId);
  return loadLocalDraftByKey(key);
}

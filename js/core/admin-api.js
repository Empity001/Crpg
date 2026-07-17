// =========================================================
// admin-api.js
// Puerta única entre la web pública y las operaciones privilegiadas.
// Toda acción pasa por discord-admin-api, que valida la sesión y el rol.
// =========================================================

import { DISCORD_ADMIN_FUNCTION, supabaseClient } from '../config.js';

async function normalizedError(error, fallback = 'No se pudo completar la operación.') {
  if (!error) return null;
  if (typeof error === 'string') return { message: error, code: 'ADMIN_API_ERROR', details: null };

  // FunctionsHttpError guarda la respuesta JSON de la Edge Function dentro
  // de `context`. Leerla permite mostrar en la interfaz mensajes concretos
  // como GUIDE_HIDDEN o FORUM_TAG_LIMIT en vez del genérico “non-2xx”.
  let remote = null;
  const response = error.context;
  if (response && typeof response.clone === 'function') {
    try { remote = await response.clone().json(); } catch { /* respuesta sin JSON */ }
  }
  const payload = remote?.error || remote || {};
  return {
    message: payload.message || error.message || fallback,
    code: payload.code || error.code || 'ADMIN_API_ERROR',
    details: payload.details || error.details || null,
    status: response?.status || null,
  };
}

async function invokeAdminApi(action, payload = {}) {
  try {
    const { data, error } = await supabaseClient.functions.invoke(DISCORD_ADMIN_FUNCTION, {
      body: { ...payload, action },
    });
    if (error) return { data: null, error: await normalizedError(error) };
    if (data?.error) return { data: data.data ?? null, error: await normalizedError(data.error) };
    return { data: data?.data ?? data ?? null, error: null };
  } catch (error) {
    return { data: null, error: await normalizedError(error) };
  }
}

export function getDiscordAdminStatus() {
  return invokeAdminApi('status');
}

export function getAdminHealth() {
  return invokeAdminApi('admin_health');
}

export function restoreBackup(backup, selections = []) {
  return invokeAdminApi('restore_backup', { backup, selections });
}

export function getAdminLogsBundle() {
  return invokeAdminApi('logs_admin_bundle');
}

export function getAdminBackupBundle(scope = 'all') {
  return invokeAdminApi('backup_bundle', { scope });
}

export function enqueueGuideForumJob(guideId, jobAction, payload = {}) {
  return invokeAdminApi('guide_forum_job', {
    guide_id: guideId,
    job_action: jobAction,
    payload,
  });
}

export function getGuideForumStatus(guideId) {
  return invokeAdminApi('guide_forum_status', { guide_id: guideId });
}

export function saveForumReactions(reactions, applyExisting = false) {
  return invokeAdminApi('save_forum_reactions', {
    reactions,
    apply_existing: !!applyExisting,
  });
}

export function getDiscordGuildConfig() {
  return invokeAdminApi('guild_config');
}

export function createSignedStorageUpload({ bucket, path, contentType }) {
  return invokeAdminApi('create_signed_upload', {
    bucket,
    path,
    content_type: contentType,
  });
}

export function deleteStorageObjects(bucket, paths) {
  return invokeAdminApi('delete_storage_objects', {
    bucket,
    paths: Array.isArray(paths) ? paths : [paths],
  });
}

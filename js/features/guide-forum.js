// =========================================================
// guide-forum.js
// Controles manuales de publicar/actualizar/despublicar una Guía.
// =========================================================

import { enqueueGuideForumJob, getGuideForumStatus } from '../core/admin-api.js';
import { escapeHtml, showToast } from '../core/utils.js';
import { getWeaponRanks } from './weapons-state.js';

const inflight = new Set();
const statusCache = new Map();
const statusPromises = new Map();
const pollTimers = new Map();
const STATUS_CACHE_TTL_MS = 15_000;

function scheduleStatusPoll(weapon, attempt) {
  window.clearTimeout(pollTimers.get(weapon.id));
  const delay = Math.min(3_000 * Math.pow(1.65, attempt), 10_000);
  const timer = window.setTimeout(() => {
    pollTimers.delete(weapon.id);
    const root = document.getElementById('guide-forum-controls');
    if (root?.isConnected && root.dataset.weaponId === weapon.id) {
      void renderGuideForumControls(weapon, { force: true, pollAttempt: attempt + 1 });
    }
  }, delay);
  pollTimers.set(weapon.id, timer);
}

async function loadForumStatus(weaponId, { force = false } = {}) {
  const cached = statusCache.get(weaponId);
  if (!force && cached && Date.now() - cached.loadedAt < STATUS_CACHE_TTL_MS) return cached.result;
  if (statusPromises.has(weaponId)) return statusPromises.get(weaponId);

  const request = getGuideForumStatus(weaponId)
    .then(result => {
      statusCache.set(weaponId, { loadedAt: Date.now(), result });
      return result;
    })
    .finally(() => statusPromises.delete(weaponId));
  statusPromises.set(weaponId, request);
  return request;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

async function contentHash(weapon) {
  const ranks = getWeaponRanks(weapon.id);
  const payload = JSON.stringify(stable({
    id: weapon.id,
    name: weapon.name,
    image_url: weapon.image_url,
    category_id: weapon.category_id,
    type_id: weapon.type_id,
    published: weapon.published,
    ranks,
  }));
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function errorBox(error, action = 'sincronizar', { warning = false } = {}) {
  if (!error) return '';
  const messageRaw = error.message || String(error);
  const codeRaw = error.code || (warning ? 'SYNC_WARNING' : 'GUIDE_FORUM_ERROR');
  const message = escapeHtml(messageRaw);
  const code = escapeHtml(codeRaw);
  const title = warning ? 'La Guía se sincronizó con advertencias' : `No se pudo ${escapeHtml(action)} la Guía en Discord`;
  const copyValue = escapeHtml(`${codeRaw}: ${messageRaw}`);
  return `<div class="guide-forum-error ${warning ? 'is-warning' : ''}" role="${warning ? 'status' : 'alert'}">
    <strong>${title}</strong>
    <span>${message}</span>
    <small>Código: ${code} · ${new Date().toLocaleString()}</small>
    <button type="button" class="btn-compact" data-guide-forum-copy-error="${copyValue}">Copiar error</button>
  </div>`;
}

function controlsHtml(weapon, hash, data, error) {
  const publication = data?.publication || null;
  const job = data?.latestJob || null;
  const status = publication?.status || 'unpublished';
  const busy = ['pending', 'processing'].includes(job?.status) || ['publishing','updating','unpublishing'].includes(status);
  const warning = status === 'synced_with_warnings';
  const synced = ['synced', 'synced_with_warnings'].includes(status) && publication?.published_hash === hash;
  const outdated = status === 'outdated' || (publication?.thread_id && publication?.published_hash !== hash);
  const lost = status === 'lost';
  const failed = status === 'failed' || job?.status === 'failed' || !!error;
  const forumLabel = publication?.forum_channel_id ? `Foro: ${publication.forum_channel_id}` : 'Foro de Guías';

  let primary;
  if (busy) primary = `<button class="btn-primary" type="button" disabled>${status === 'unpublishing' ? 'Despublicando…' : status === 'publishing' ? 'Publicando…' : 'Actualizando…'}</button>`;
  else if (lost) primary = `<button class="btn-primary is-attention" type="button" data-guide-forum-action="publish">Volver a publicar</button>`;
  else if (!publication?.thread_id || status === 'unpublished') primary = `<button class="btn-primary" type="button" data-guide-forum-action="publish" ${weapon.published ? '' : 'disabled'}>Publicar en foro</button>`;
  else primary = `<button class="btn-primary ${outdated || failed ? 'is-attention' : ''}" type="button" data-guide-forum-action="update" ${synced ? 'disabled' : ''}>Actualizar en foro</button>`;

  const secondary = publication?.thread_id && status !== 'unpublished'
    ? `<button class="btn-danger" type="button" data-guide-forum-action="unpublish" ${busy ? 'disabled' : ''}>Despublicar del foro</button>`
    : '';

  const stateText = !weapon.published
    ? 'La Guía está oculta. Su publicación se eliminará y no volverá hasta que la publiques manualmente.'
    : busy ? 'Discord está procesando la solicitud. Puedes salir de la página; el trabajo queda guardado.'
    : lost ? 'La publicación fue eliminada directamente en Discord.'
    : warning && synced ? 'La versión actual está publicada, pero una o más imágenes no pudieron cargarse.'
    : synced ? 'La publicación de Discord ya contiene la versión actual.'
    : publication?.thread_id ? 'La Guía cambió desde la última sincronización.'
    : 'Esta Guía todavía no se ha publicado en Discord.';

  return `<section class="guide-forum-panel" data-guide-forum-id="${escapeHtml(weapon.id)}" data-guide-content-hash="${hash}">
    <div class="guide-forum-panel-copy">
      <span>Discord · ${escapeHtml(forumLabel)}</span>
      <strong>Publicación de la Guía</strong>
      <p>${escapeHtml(stateText)}</p>
    </div>
    <div class="guide-forum-panel-actions">${primary}${secondary}</div>
    ${errorBox(error || (failed ? { message: publication?.last_error_message || job?.error_message || 'La última sincronización falló.', code: publication?.last_error_code || job?.error_code } : null), lost ? 'recuperar' : 'sincronizar')}
    ${warning && !failed ? errorBox({ message: publication?.last_error_message || 'Algunas imágenes no pudieron cargarse; el resto del contenido sí se publicó.', code: publication?.last_error_code || 'MEDIA_WARNINGS' }, 'sincronizar', { warning: true }) : ''}
  </section>`;
}

export async function renderGuideForumControls(weapon, { force = false, pollAttempt = 0 } = {}) {
  const root = document.getElementById('guide-forum-controls');
  if (!root || !weapon?.id) return;
  if (!statusCache.has(weapon.id)) {
    root.innerHTML = '<div class="guide-forum-panel is-loading">Consultando el estado de Discord…</div>';
  }
  const { data, error } = await loadForumStatus(weapon.id, { force });
  const hash = data?.currentHash || await contentHash(weapon);
  if (!root.isConnected || root.dataset.weaponId !== weapon.id) return;
  root.innerHTML = controlsHtml(weapon, hash, data, error);
  const publicationStatus = data?.publication?.status;
  const jobStatus = data?.latestJob?.status;
  if (['publishing','updating','unpublishing'].includes(publicationStatus) || ['pending','processing'].includes(jobStatus)) {
    scheduleStatusPoll(weapon, pollAttempt);
  } else {
    window.clearTimeout(pollTimers.get(weapon.id));
    pollTimers.delete(weapon.id);
  }
}

async function execute(root, weapon, action) {
  if (inflight.has(weapon.id)) return;
  if (action === 'unpublish') {
    const accepted = window.confirm('Esta acción eliminará la publicación del foro y sus mensajes. La Guía continuará existiendo en la página.');
    if (!accepted) return;
  }
  inflight.add(weapon.id);
  root.querySelectorAll('button').forEach(button => { button.disabled = true; });
  const hash = root.querySelector('[data-guide-content-hash]')?.dataset.guideContentHash || await contentHash(weapon);
  const { error } = await enqueueGuideForumJob(weapon.id, action, { content_hash: hash });
  if (error) {
    showToast(error.message, 'error');
    const panel = root.querySelector('.guide-forum-panel');
    panel?.insertAdjacentHTML('beforeend', errorBox(error, action === 'publish' ? 'publicar' : action === 'unpublish' ? 'despublicar' : 'actualizar'));
  } else {
    statusCache.delete(weapon.id);
    showToast(action === 'publish' ? 'Publicación enviada a la cola de Discord' : action === 'update' ? 'Actualización enviada a Discord' : 'Despublicación enviada a Discord', 'success');
    await new Promise(resolve => setTimeout(resolve, 500));
    await renderGuideForumControls(weapon, { force: true });
  }
  inflight.delete(weapon.id);
}

export function bindGuideForumControls(container, getWeapon) {
  if (container.dataset.guideForumBound === 'true') return;
  container.dataset.guideForumBound = 'true';
  container.addEventListener('click', event => {
    const copyButton = event.target.closest('[data-guide-forum-copy-error]');
    if (copyButton) {
      void navigator.clipboard?.writeText(copyButton.dataset.guideForumCopyError || '').then(
        () => showToast('Error copiado'),
        () => showToast('No se pudo copiar el error', 'error'),
      );
      return;
    }
    const button = event.target.closest('[data-guide-forum-action]');
    if (!button) return;
    const weapon = getWeapon();
    if (!weapon) return;
    void execute(document.getElementById('guide-forum-controls'), weapon, button.dataset.guideForumAction);
  });
}

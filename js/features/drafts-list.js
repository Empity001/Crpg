// =========================================================
// drafts-list.js
// =========================================================
// Listado de borradores en Herramientas. Mezcla localStorage con
// Supabase sin importar el formulario de Logs.
// =========================================================

import { escapeHtml, formatDate, showToast } from '../core/utils.js';
import { deleteLocalDraftByKey, deleteRemoteDraft, deleteRemoteDraftByKey, listLocalDrafts, listRemoteDrafts } from './drafts-store.js';

async function getAllDrafts() {
  const localDrafts = listLocalDrafts();
  const remoteDrafts = await listRemoteDrafts();
  const drafts = [...localDrafts];

  remoteDrafts.forEach(remote => {
    const hasLocalForSameLog = localDrafts.some(local => {
      const localId = local.logId || 'new';
      const remoteId = remote.logId || 'new';
      return localId === remoteId;
    });
    if (!hasLocalForSameLog) drafts.push(remote);
  });

  return drafts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

export async function renderDraftsList() {
  const container = document.getElementById('drafts-list');
  if (!container) return;

  container.innerHTML = '<p class="admin-empty">Cargando borradores...</p>';
  const drafts = await getAllDrafts();

  if (drafts.length === 0) {
    container.innerHTML = '<p class="admin-empty">No hay borradores guardados.</p>';
    return;
  }

  container.innerHTML = drafts.map(draft => {
    const title = draft.data?.title || '(Sin título)';
    const localTag = draft.isLocal ? '<span class="draft-local-tag">[local]</span>' : '';
    const sourceTag = draft.isRemote
      ? '<span class="draft-local-tag">[Supabase]</span>'
      : '<span class="draft-local-tag">[este navegador]</span>';
    const blocksCount = (draft.data?.mobs?.length || 0)
      + (draft.data?.items?.length || 0)
      + (draft.data?.libres?.length || 0);
    const blocksHint = blocksCount > 0 ? `· ${blocksCount} bloque${blocksCount > 1 ? 's' : ''}` : '';
    return `
      <div class="draft-list-row">
        <div class="draft-list-info">
          <span class="draft-list-title">📝 ${escapeHtml(title)} ${localTag} ${sourceTag}</span>
          <span class="draft-list-meta">${formatDate(draft.savedAt)} ${blocksHint}</span>
        </div>
        <div class="draft-list-actions">
          <button type="button" class="btn-secondary-admin draft-open-btn" data-draft-key="${draft.key}" data-log-id="${draft.logId || ''}">Abrir</button>
          <button type="button" class="btn-secondary-admin danger draft-delete-btn" data-draft-key="${draft.key}" data-log-id="${draft.logId || 'new'}">🗑</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.draft-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const params = new URLSearchParams();
      params.set('draftKey', btn.dataset.draftKey);
      if (btn.dataset.logId) params.set('logId', btn.dataset.logId);
      window.location.href = `index.html?${params.toString()}`;
    });
  });

  container.querySelectorAll('.draft-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      deleteLocalDraftByKey(btn.dataset.draftKey);
      if (btn.dataset.draftKey.startsWith('remote:')) await deleteRemoteDraftByKey(btn.dataset.draftKey);
      else await deleteRemoteDraft(btn.dataset.logId || 'new');
      await renderDraftsList();
      showToast('Borrador eliminado');
    });
  });
}

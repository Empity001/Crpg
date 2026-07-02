// =========================================================
// drafts-list.js
// =========================================================
// Listado de borradores en la página Herramientas. Se mantiene separado
// de drafts.js para que Admin no importe el formulario de Logs.
// =========================================================

import { escapeHtml, formatDate, showToast } from '../core/utils.js';

function getAllDrafts() {
  const drafts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('culones_draft_')) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && draft.savedAt) drafts.push({ key, ...draft });
    } catch(e) {}
  }
  return drafts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

export function renderDraftsList() {
  const container = document.getElementById('drafts-list');
  if (!container) return;
  const drafts = getAllDrafts();
  if (drafts.length === 0) {
    container.innerHTML = '<p class="admin-empty">No hay borradores guardados.</p>';
    return;
  }
  container.innerHTML = drafts.map(d => {
    const title = d.data?.title || '(Sin título)';
    const localTag = d.isLocal ? '<span class="draft-local-tag">[local]</span>' : '';
    const blocksCount = (d.data?.mobs?.length || 0) + (d.data?.items?.length || 0) + (d.data?.libres?.length || 0);
    const blocksHint = blocksCount > 0 ? `· ${blocksCount} bloque${blocksCount > 1 ? 's' : ''}` : '';
    return `
      <div class="draft-list-row">
        <div class="draft-list-info">
          <span class="draft-list-title">📝 ${escapeHtml(title)} ${localTag}</span>
          <span class="draft-list-meta">${formatDate(d.savedAt)} ${blocksHint}</span>
        </div>
        <div class="draft-list-actions">
          <button type="button" class="btn-secondary-admin draft-open-btn" data-draft-key="${d.key}" data-log-id="${d.logId || ''}">Abrir</button>
          <button type="button" class="btn-secondary-admin danger draft-delete-btn" data-draft-key="${d.key}">🗑</button>
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
    btn.addEventListener('click', () => {
      localStorage.removeItem(btn.dataset.draftKey);
      renderDraftsList();
      showToast('Borrador eliminado');
    });
  });
}

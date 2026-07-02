// =========================================================
// drafts.js
// =========================================================
// Sistema de borradores en localStorage para el formulario de log:
// autoguardado, restauración, aviso de borrador pendiente y listado en
// la pestaña Herramientas.
// =========================================================

import { renderDraftBlocksList } from './blocks-editor.js';
import { isAdmin, state } from '../core/state.js';
import { escapeHtml, formatDate, showToast } from '../core/utils.js';

const DRAFT_AUTOSAVE_INTERVAL = 30000; // 30 segundos

let _draftAutosaveTimer = null;

let _draftHasUnsaved = false;


function draftKey(logId) {
  return logId === 'new' ? 'culones_draft_log_new' : `culones_draft_log_${logId}`;
}

/** Captura el estado actual del form de log en un objeto serializable */

function captureDraftData() {
  return {
    title: document.getElementById('log-title-input')?.value || '',
    description: document.getElementById('log-desc-input')?.value || '',
    category: document.getElementById('log-category-input')?.value || '',
    relevance: document.getElementById('log-relevance-input')?.value || 'normal',
    date: document.getElementById('log-date-input')?.value || '',
    mobs: JSON.parse(JSON.stringify(state.draftMobs)),
    items: JSON.parse(JSON.stringify(state.draftItems)),
    libres: JSON.parse(JSON.stringify(state.draftLibres)),
  };
}

/** Guarda el borrador en localStorage */

export function saveDraft(logId, isManual = false) {
  if (!isAdmin()) return;
  const key = draftKey(logId || 'new');
  const data = captureDraftData();
  // No guardar si está completamente vacío
  if (!data.title && !data.description && data.mobs.length === 0 && data.items.length === 0 && data.libres.length === 0) return;
  const draft = {
    savedAt: new Date().toISOString(),
    isLocal: !logId, // true si nunca fue publicado
    logId: logId || null,
    data,
  };
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    _draftHasUnsaved = false;
    updateDraftAutosaveStatus('saved', draft.savedAt);
    if (isManual) showToast('Borrador guardado', 'success');
  } catch(e) {
    showToast('No se pudo guardar el borrador (localStorage lleno?)', 'error');
  }
}

/** Lee un borrador de localStorage */

function loadDraftFromStorage(logId) {
  const key = draftKey(logId || 'new');
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

/** Elimina un borrador */

export function clearDraft(logId) {
  localStorage.removeItem(draftKey(logId || 'new'));
  renderDraftsList();
}

/** Restaura los datos de un borrador al form */

export function restoreDraft(draft) {
  const d = draft.data;
  document.getElementById('log-title-input').value = d.title || '';
  document.getElementById('log-desc-input').value = d.description || '';
  if (d.category) document.getElementById('log-category-input').value = d.category;
  document.getElementById('log-relevance-input').value = d.relevance || 'normal';
  if (d.date) document.getElementById('log-date-input').value = d.date;
  state.draftMobs = d.mobs || [];
  state.draftItems = d.items || [];
  state.draftLibres = d.libres || [];
  renderDraftBlocksList();
  hideDraftBanner();
  showToast('Borrador restaurado', 'success');
}

/** Muestra el banner de borrador disponible si existe uno */

export function checkAndShowDraftBanner(logId) {
  const banner = document.getElementById('log-draft-banner');
  const timeEl = document.getElementById('log-draft-banner-time');
  if (!banner) return;
  const draft = loadDraftFromStorage(logId || 'new');
  if (!draft) { banner.classList.add('hidden'); return; }
  const when = new Date(draft.savedAt);
  timeEl.textContent = `Guardado el ${formatDate(draft.savedAt)}`;
  banner.classList.remove('hidden');

  document.getElementById('log-draft-restore-btn').onclick = () => restoreDraft(draft);
  document.getElementById('log-draft-discard-btn').onclick = () => {
    clearDraft(logId || 'new');
    hideDraftBanner();
    showToast('Borrador descartado');
  };
}


function hideDraftBanner() {
  const banner = document.getElementById('log-draft-banner');
  if (banner) banner.classList.add('hidden');
}

/** Arranca el autoguardado cada 30s mientras el modal está abierto */

export function startDraftAutosave() {
  stopDraftAutosave();
  _draftHasUnsaved = false;
  updateDraftAutosaveStatus('idle');

  // Marcar como "hay cambios" cuando el admin escribe
  const fields = ['log-title-input', 'log-desc-input', 'log-category-input', 'log-relevance-input', 'log-date-input'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', markDraftDirty);
  });

  _draftAutosaveTimer = setInterval(() => {
    if (_draftHasUnsaved) {
      saveDraft(state.editingLogId || 'new');
    }
  }, DRAFT_AUTOSAVE_INTERVAL);
}


export function stopDraftAutosave() {
  if (_draftAutosaveTimer) { clearInterval(_draftAutosaveTimer); _draftAutosaveTimer = null; }
  // Remove listeners
  const fields = ['log-title-input', 'log-desc-input', 'log-category-input', 'log-relevance-input', 'log-date-input'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.removeEventListener('input', markDraftDirty);
  });
}


function markDraftDirty() {
  _draftHasUnsaved = true;
  updateDraftAutosaveStatus('unsaved');
}


function updateDraftAutosaveStatus(state, savedAt = null) {
  const el = document.getElementById('draft-autosave-status');
  if (!el) return;
  switch(state) {
    case 'saved': el.textContent = `✅ Guardado ${savedAt ? formatDate(savedAt) : ''}`; el.className = 'draft-autosave-status is-saved'; break;
    case 'unsaved': el.textContent = '● Cambios sin guardar'; el.className = 'draft-autosave-status is-dirty'; break;
    default: el.textContent = ''; el.className = 'draft-autosave-status'; break;
  }
}

/** Aviso antes de cerrar la página si hay cambios sin guardar */

export function initBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    if (_draftHasUnsaved && document.getElementById('log-modal') && !document.getElementById('log-modal').classList.contains('hidden')) {
      // Guardar automáticamente al cerrar
      saveDraft(state.editingLogId || 'new');
    }
  });
}

// ---------------------------------------------------------
// LISTA DE TODOS LOS BORRADORES (pestaña herramientas)
// ---------------------------------------------------------

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
      // El modal de log vive únicamente en la página de Logs (index.html).
      // Navegamos allí pasando la clave del borrador por query string;
      // esa página lo detecta al cargar y abre + restaura el modal.
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

// ---------------------------------------------------------
// EXPORT / IMPORT
// ---------------------------------------------------------

/** Descarga un objeto como archivo */

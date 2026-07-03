// =========================================================
// admin-panel.js
// =========================================================
// Cableado de la página 🛠 Herramientas: botones de export/import,
// drag&drop de import, listado de borradores y "limpiar todos los
// borradores", fondo de página y favicon. Se usa SOLO desde
// js/pages/admin.js.
// =========================================================

import { initBackgroundTool } from './background.js';
import { renderDraftsList } from './drafts-list.js';
import { exportData } from './export.js';
import { initFaviconTool } from './favicon.js';
import { _importConflicts, confirmImport, handleImportFile } from './import.js';
import { initMediaLibraryPanel } from './media-library.js';
import { confirmAction, showToast } from '../core/utils.js';
import { deleteRemoteDraft, listRemoteDrafts } from './drafts-store.js';

export function initAdminPanel() {
  // Export buttons
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', () => exportData(btn.dataset.export, btn.dataset.format));
  });

  // Import: file input
  // Reseteamos el value ANTES de procesar (no después) para que volver a
  // elegir el mismo archivo dispare el evento 'change' correctamente.
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';          // reset inmediato → permite reseleccionar el mismo archivo
    if (file) handleImportFile(file);
  });

  // Import: drag & drop
  const dropZone = document.getElementById('import-drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('is-drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-drag-over');
    if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
  });

  // Import conflict modal
  document.getElementById('close-import-conflict-modal').addEventListener('click', () => {
    document.getElementById('import-conflict-modal').classList.add('hidden');
  });
  document.getElementById('import-conflict-cancel-btn').addEventListener('click', () => {
    document.getElementById('import-conflict-modal').classList.add('hidden');
  });
  document.getElementById('import-conflict-confirm-btn').addEventListener('click', confirmImport);
  document.getElementById('import-conflict-all-overwrite').addEventListener('click', () => {
    _importConflicts.forEach((c, idx) => {
      c.resolution = 'import';
      document.querySelectorAll(`input[name="conflict-${idx}"][value="import"]`).forEach(r => r.checked = true);
    });
  });
  document.getElementById('import-conflict-all-skip').addEventListener('click', () => {
    _importConflicts.forEach((c, idx) => {
      c.resolution = 'skip';
      document.querySelectorAll(`input[name="conflict-${idx}"][value="skip"]`).forEach(r => r.checked = true);
    });
  });

  // Clear all drafts
  document.getElementById('drafts-clear-all-btn')?.addEventListener('click', async () => {
    if (!(await confirmAction({
      title: 'Eliminar borradores',
      message: 'Eliminar TODOS los borradores guardados en este dispositivo y en Supabase. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar borradores',
      danger: true,
    }))) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('culones_draft_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    const remoteDrafts = await listRemoteDrafts();
    await Promise.all(remoteDrafts.map(draft => deleteRemoteDraft(draft.logId || 'new')));
    await renderDraftsList();
    showToast('Todos los borradores eliminados');
  });

  void renderDraftsList();
  initMediaLibraryPanel();
  initBackgroundTool();
  initFaviconTool();
}

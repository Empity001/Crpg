// =========================================================
// pages/tierlist.js — Entry point de tierlist.html (🏆 Tierlist)
// =========================================================
// Carga y cablea EXCLUSIVAMENTE lo que pertenece a la Tierlist: filas,
// elementos, su dropzone de imagen y el modal de "mover" (uso en
// móvil). No importa nada de Logs, Armas, About ni Herramientas.
// =========================================================

import { startPage } from '../app/page-bootstrap.js';
import { bootShell } from '../app/shell.js';
import { initTierlistRealtime } from '../app/realtime.js';
import { state } from '../core/state.js';
import { initImageUploader, updateAssetPreview } from '../core/storage.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { attachMediaPickerButton } from '../features/media-library.js';
import {
  initTierItemClipboardActions, initTierItemDropzone, loadTierlist, openTierItemModal, openTierRowModal,
  renderTierlist, submitTierItem, submitTierMove, submitTierRow, syncTierDropzoneState,
} from '../features/tierlist.js';


function focusLinkedTierItem() {
  const itemId = new URLSearchParams(window.location.search).get('item');
  if (!itemId) return;
  window.requestAnimationFrame(() => {
    const item = document.querySelector(`.tier-item-chip[data-item-id="${CSS.escape(itemId)}"]`);
    if (!item) return;
    item.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    item.classList.add('global-search-target');
    window.setTimeout(() => item.classList.remove('global-search-target'), 2100);
  });
}

function initTierlistModals() {
  document.getElementById('open-new-tier-row-btn').addEventListener('click', () => openTierRowModal(null));
  document.getElementById('close-tier-row-modal').addEventListener('click', () => document.getElementById('tier-row-modal').classList.add('hidden'));
  document.getElementById('submit-tier-row-btn').addEventListener('click', submitTierRow);

  document.getElementById('open-new-tier-item-btn').addEventListener('click', () => openTierItemModal(null));
  document.getElementById('close-tier-item-modal').addEventListener('click', () => document.getElementById('tier-item-modal').classList.add('hidden'));
  document.getElementById('submit-tier-item-btn').addEventListener('click', submitTierItem);
  initTierItemClipboardActions();
  document.getElementById('tier-item-image-input').addEventListener('change', (e) => {
    updateAssetPreview('tier-item', e.target.value.trim());
    syncTierDropzoneState(e.target.value.trim());
  });

  initTierItemDropzone();
  initImageUploader('tier-item', 'tierlist', () => {
    const item = state.editingTierItemId ? state.tierItems.find(i => i.id === state.editingTierItemId) : null;
    return item ? (item.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'tier-item-image-input',
    insertAfterId: 'tier-item-dropzone',
    title: 'Seleccionar imagen de tierlist',
    onSelect: ({ url }) => {
      updateAssetPreview('tier-item', url);
      syncTierDropzoneState(url);
    },
  });

  document.getElementById('close-tier-move-modal').addEventListener('click', () => document.getElementById('tier-move-modal').classList.add('hidden'));
  document.getElementById('submit-tier-move-btn').addEventListener('click', submitTierMove);
}

async function init() {
  await bootShell('tierlist');
  initTierlistModals();
  registerAdminUiRefreshHandler(() => { if (state.tierlistLoaded) renderTierlist(); });
  const tierlistLoaded = await loadTierlist();
  if (tierlistLoaded) {
    focusLinkedTierItem();
    initTierlistRealtime();
  }
}

startPage(init);

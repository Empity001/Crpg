// =========================================================
// pages/logs.js — Entry point de index.html (📜 Logs)
// =========================================================
// Carga y cablea EXCLUSIVAMENTE lo que pertenece a la sección de Logs:
// el modal de log (con sus bloques de mob/item/libre embebidos), el
// modal de categorías, el modal de configuración de fichas y el modal
// de detalle+comentarios. No importa nada de Tierlist, Armas, About
// ni Herramientas.
// =========================================================

import { startPage } from '../app/page-bootstrap.js';
import { bootShell } from '../app/shell.js';
import { initLogsRealtime } from '../app/realtime.js';
import { addEquipmentPiece, addItemEnchant, addLibreField, openItemModal, openLibreModal, openMobModal, renderExtraFieldsEditor, submitItemBlock, submitLibreBlock, submitMobBlock } from '../features/blocks-editor.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { loadCategories, openNewCategoryModal, setCategoryFiltersChangedHandler, submitCategory } from '../features/categories.js';
import { cancelReply, deleteCommentAction, startReplyTo, submitComment, toggleCommentHidden, toggleCommentLike } from '../features/comments.js';
import { initBeforeUnload, restoreDraft, saveDraft, stopDraftAutosave } from '../features/drafts.js';
import { loadDraftByKey } from '../features/drafts-store.js';
import { openFieldConfigModal, saveFieldConfig, setFieldConfigSavedHandler } from '../features/field-config.js';
import { initDesktopLogInspectorTracking, initSortControl, loadLogs, openEditLogModal, openLogFromSearch, openNewLogModal, renderLogs, submitLog, updateLogCoverPreview } from '../features/logs.js';
import { attachMediaPickerButton, openMediaPicker } from '../features/media-library.js';
import { state } from '../core/state.js';
import { initImageUploader, updateAssetPreview } from '../core/storage.js';
import { registerModalLifecycleCleanup } from '../core/utils.js';

function initLogsModals() {
  registerModalLifecycleCleanup('log-modal', { onClose: stopDraftAutosave });
  registerModalLifecycleCleanup('detail-modal', { onClose: cancelReply });

  document.getElementById('open-new-log-btn').addEventListener('click', openNewLogModal);
  document.getElementById('close-log-modal').addEventListener('click', () => {
    stopDraftAutosave();
    document.getElementById('log-modal').classList.add('hidden');
  });
  document.getElementById('submit-log-btn').addEventListener('click', submitLog);
  document.getElementById('draft-manual-save-btn')?.addEventListener('click', () => {
    saveDraft(state.editingLogId || 'new', true);
  });

  document.getElementById('log-cover-image-picker-btn')?.addEventListener('click', () => {
    const input = document.getElementById('log-cover-image-input');
    openMediaPicker({
      title: 'Seleccionar portada del log',
      allowedKinds: ['image'],
      currentUrl: input?.value || '',
      onSelect: ({ url }) => {
        updateLogCoverPreview(url || '');
        input?.dispatchEvent(new Event('input', { bubbles: true }));
      },
    });
  });
  document.getElementById('log-cover-image-clear-btn')?.addEventListener('click', () => {
    const input = document.getElementById('log-cover-image-input');
    updateLogCoverPreview('');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.getElementById('log-cover-image-input')?.addEventListener('draft-cover-restored', (event) => {
    updateLogCoverPreview(event.detail?.url || '');
  });

  document.getElementById('open-add-mob-btn').addEventListener('click', () => openMobModal(null));
  document.getElementById('close-mob-modal').addEventListener('click', () => document.getElementById('mob-modal').classList.add('hidden'));
  document.getElementById('submit-mob-btn').addEventListener('click', submitMobBlock);
  document.getElementById('mob-add-equipment-btn').addEventListener('click', addEquipmentPiece);
  document.getElementById('mob-add-extra-btn').addEventListener('click', () => { state.mobExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('mob-extra-fields-list', () => state.mobExtraDraft); });
  document.getElementById('mob-image-input').addEventListener('change', (e) => updateAssetPreview('mob', e.target.value.trim()));
  initImageUploader('mob', 'mobs', () => {
    const mob = state.editingMobIndex != null ? state.draftMobs[state.editingMobIndex] : null;
    return mob ? (mob.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'mob-image-input',
    insertAfterId: 'mob-image-upload-btn',
    title: 'Seleccionar imagen de mob',
    onSelect: ({ url }) => updateAssetPreview('mob', url),
  });
  document.getElementById('mob-image-clear-btn').addEventListener('click', () => {
    document.getElementById('mob-image-input').value = '';
    updateAssetPreview('mob', '');
  });

  document.getElementById('open-add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('close-item-modal').addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
  document.getElementById('submit-item-btn').addEventListener('click', submitItemBlock);
  document.getElementById('item-add-enchant-btn').addEventListener('click', addItemEnchant);
  document.getElementById('item-add-extra-btn').addEventListener('click', () => { state.itemExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('item-extra-fields-list', () => state.itemExtraDraft); });
  document.getElementById('item-image-input').addEventListener('change', (e) => updateAssetPreview('item', e.target.value.trim()));
  initImageUploader('item', 'items', () => {
    const item = state.editingItemIndex != null ? state.draftItems[state.editingItemIndex] : null;
    return item ? (item.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'item-image-input',
    insertAfterId: 'item-image-upload-btn',
    title: 'Seleccionar imagen de item',
    onSelect: ({ url }) => updateAssetPreview('item', url),
  });
  document.getElementById('item-image-clear-btn').addEventListener('click', () => {
    document.getElementById('item-image-input').value = '';
    updateAssetPreview('item', '');
  });

  document.getElementById('open-add-libre-btn').addEventListener('click', () => openLibreModal(null));
  document.getElementById('close-libre-modal').addEventListener('click', () => document.getElementById('libre-modal').classList.add('hidden'));
  document.getElementById('submit-libre-btn').addEventListener('click', submitLibreBlock);
  document.getElementById('libre-add-field-btn').addEventListener('click', addLibreField);
  document.getElementById('libre-image-input').addEventListener('change', (e) => updateAssetPreview('libre', e.target.value.trim()));
  initImageUploader('libre', 'items', () => {
    const lib = state.editingLibreIndex != null ? state.draftLibres[state.editingLibreIndex] : null;
    return lib ? (lib.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'libre-image-input',
    insertAfterId: 'libre-image-upload-btn',
    title: 'Seleccionar imagen de Extra',
    onSelect: ({ url }) => updateAssetPreview('libre', url),
  });
  document.getElementById('libre-image-clear-btn').addEventListener('click', () => {
    document.getElementById('libre-image-input').value = '';
    updateAssetPreview('libre', '');
  });

  document.getElementById('open-new-category-btn').addEventListener('click', openNewCategoryModal);
  document.getElementById('close-category-modal').addEventListener('click', () => document.getElementById('category-modal').classList.add('hidden'));
  document.getElementById('submit-category-btn').addEventListener('click', submitCategory);

  document.getElementById('open-field-config-btn').addEventListener('click', openFieldConfigModal);
  document.getElementById('close-field-config-modal').addEventListener('click', () => document.getElementById('field-config-modal').classList.add('hidden'));
  document.getElementById('fieldcfg-save-btn').addEventListener('click', saveFieldConfig);

  document.getElementById('close-detail-modal').addEventListener('click', () => { document.getElementById('detail-modal').classList.add('hidden'); cancelReply(); });
  document.getElementById('submit-comment-btn').addEventListener('click', submitComment);
  document.getElementById('comment-reply-cancel').addEventListener('click', cancelReply);

  // Delegación de acciones de comentarios (like / responder / ocultar / borrar).
  // Los comentarios se re-renderizan dinámicamente, así que se delega en
  // document en vez de re-bindear cada vez.
  document.addEventListener('click', (e) => {
    const likeEl = e.target.closest('.comment-like-btn');
    if (likeEl) { e.stopPropagation(); toggleCommentLike(likeEl.dataset.commentId); return; }

    const replyEl = e.target.closest('.comment-reply-btn');
    if (replyEl) { e.stopPropagation(); startReplyTo(replyEl.dataset.commentId, replyEl.dataset.username); return; }

    const hideEl = e.target.closest('.comment-hide-btn');
    if (hideEl) { e.stopPropagation(); toggleCommentHidden(hideEl.dataset.commentId, hideEl.dataset.hidden === 'true'); return; }

    const delEl = e.target.closest('.comment-delete-btn');
    if (delEl) { e.stopPropagation(); deleteCommentAction(delEl.dataset.commentId); return; }
  });
}

// Si venimos redirigidos desde Herramientas > Borradores con
// ?draftKey=...&logId=... (ver drafts.js), abrimos el modal
// correspondiente y restauramos el borrador automáticamente.

function openLinkedLogFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const logId = params.get('log');
  if (!logId) return;
  openLogFromSearch(logId, {
    tab: params.get('tab') || 'summary',
    entryId: params.get('entry') || null,
  });
}

async function checkIncomingDraftLink() {
  const params = new URLSearchParams(window.location.search);
  const draftKey = params.get('draftKey');
  if (!draftKey) return;
  window.history.replaceState({}, '', 'index.html');
  const draft = await loadDraftByKey(draftKey);
  if (!draft) return;
  const logId = params.get('logId');
  if (logId) openEditLogModal(logId); else openNewLogModal();
  setTimeout(() => restoreDraft(draft), 60);
}

async function init() {
  await bootShell('logs');
  initLogsModals();
  initSortControl();
  initDesktopLogInspectorTracking();
  registerAdminUiRefreshHandler(renderLogs);
  setCategoryFiltersChangedHandler(renderLogs);
  setFieldConfigSavedHandler(renderLogs);
  initBeforeUnload();
  // Categorías y registros son consultas independientes. Ejecutarlas en
  // paralelo evita encadenar hasta 20–30 s de espera cuando la red está lenta.
  const [categoriesLoaded, logsLoaded] = await Promise.all([
    loadCategories(),
    loadLogs(),
  ]);
  // Si los logs se dibujaron antes de recibir las categorías, actualizamos una
  // sola vez sus etiquetas y colores con la metadata definitiva.
  if (logsLoaded && categoriesLoaded) renderLogs();
  if (logsLoaded) {
    openLinkedLogFromUrl();
    initLogsRealtime();
  }
  await checkIncomingDraftLink();
}

startPage(init);

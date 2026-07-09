// =========================================================
// shell.js
// =========================================================
// Arranque compartido por TODAS las páginas de la aplicación
// (index.html, weapons.html, tierlist.html, about.html, admin.html).
// Se encarga de:
//   1. Inyectar el header/nav/footer compartidos (partials/).
//   2. Marcar la pestaña activa según la página actual.
//   3. Cablear el modal de login de admin (compartido por el botón
//      ADMIN del header).
//   4. Delegación global para abrir imágenes en pantalla completa
//      (usada por prácticamente todas las páginas: logs, tierlist,
//      armas, about, fondo, favicon...).
//   5. Cargar app_settings (fondo, favicon, config de fichas, bloques
//      de "about") — son datos globales que afectan a todas las
//      páginas por igual (el fondo/favicon se aplican siempre).
//   6. Refrescar la UI dependiente de si hay sesión de admin activa.
//
// Cada página, después de llamar a `bootShell(pageKey)`, solo debe
// cablear los modales y cargar los datos que le pertenecen a ELLA
// (logs, tierlist, armas...), nunca los de otra sección.
// =========================================================

import { loadSharedShell } from './include.js';
import { closeAdminLoginModal, logoutAdmin, openAdminLoginModal, submitAdminCode, updateAdminUI } from '../features/auth.js';
import { loadAppSettings } from '../features/field-config.js';
import { isAdmin, state } from '../core/state.js';
import { openAssetFullscreen } from '../core/storage.js';
import { registerModalLifecycleCleanup, setupModalLifecycleObserver } from '../core/utils.js';

let modalVisualCleanupsRegistered = false;

function registerModalVisualCleanups() {
  if (modalVisualCleanupsRegistered) return;
  modalVisualCleanupsRegistered = true;

  [
    ['admin-modal', { onClose: closeAdminLoginModal }],
    ['app-confirm-modal', { resetTextSelectors: ['#app-confirm-title', '#app-confirm-message', '#app-confirm-accept'] }],
    ['media-picker-modal', { clearSelectors: ['#media-picker-grid'] }],
    ['media-confirm-modal', { clearSelectors: ['#media-confirm-preview', '#media-confirm-usage'] }],
    ['media-external-modal', { clearSelectors: ['#media-external-preview'], resetTextSelectors: ['#media-external-status'] }],
    ['media-edit-modal', { clearSelectors: ['#media-edit-preview'] }],
    ['action-log-modal', { clearSelectors: ['#action-log-list'] }],
    ['import-conflict-modal', { clearSelectors: ['#import-conflict-list'], resetTextSelectors: ['#import-conflict-summary'] }],
    ['detail-modal', { clearSelectors: ['#detail-content', '#comments-list'] }],
    ['log-modal', { clearSelectors: ['#draft-blocks-list'] }],
    ['category-modal', { clearSelectors: ['#category-manage-list'] }],
    ['field-config-modal', { clearSelectors: ['#fieldcfg-mob-list', '#fieldcfg-item-list'] }],
    ['mob-modal', { clearSelectors: ['#mob-equipment-list', '#mob-extra-fields-list'], assetPreviewPrefixes: ['mob'] }],
    ['item-modal', { clearSelectors: ['#item-enchant-list', '#item-extra-fields-list'], assetPreviewPrefixes: ['item'] }],
    ['libre-modal', { clearSelectors: ['#libre-fields-list'], assetPreviewPrefixes: ['libre'] }],
    ['tier-item-modal', { assetPreviewPrefixes: ['tier-item'] }],
    ['tier-move-modal', { resetTextSelectors: ['#tier-move-item-name'] }],
    ['kit-modal', { clearSelectors: ['#kit-columns-editor'] }],
    ['weapon-modal', { assetPreviewPrefixes: ['weapon'] }],
    ['weapon-category-modal', { clearSelectors: ['#weapon-category-manage-list'] }],
    ['weapon-type-modal', { clearSelectors: ['#weapon-type-manage-list'] }],
    ['weapon-rank-modal', { assetPreviewPrefixes: ['weapon-rank'] }],
    ['weapon-stats-modal', { clearSelectors: ['#weapon-stats-list'] }],
    ['weapon-ability-modal', { clearSelectors: ['#weapon-ability-stats-list'] }],
    ['weapon-recipe-modal', { clearSelectors: ['#weapon-recipe-materials-list'], resetTextSelectors: ['#weapon-recipe-result-img-name'], hideSelectors: ['#weapon-recipe-result-img-name'] }],
    ['weapon-section-modal', { clearSelectors: ['#weapon-section-fields-list'] }],
    ['about-editor-modal', { clearSelectors: ['#about-blocks-editor'] }],
  ].forEach(([id, config]) => registerModalLifecycleCleanup(id, config));
}

function wireHeaderNav(pageKey) {
  document.querySelectorAll('.tab-item').forEach(tab => {
    const active = tab.dataset.page === pageKey;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const pathEl = document.getElementById('active-tab-path');
  if (pathEl) pathEl.textContent = pageKey;
}

function wireAdminModal() {
  document.getElementById('admin-toggle-btn')?.addEventListener('click', () => {
    if (isAdmin()) logoutAdmin();
    else openAdminLoginModal();
  });
  document.getElementById('close-admin-modal')?.addEventListener('click', () => {
    closeAdminLoginModal();
  });
  document.getElementById('admin-login-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitAdminCode();
  });
  document.getElementById('submit-admin-code')?.addEventListener('click', (e) => {
    e.preventDefault();
    submitAdminCode();
  });
  document.getElementById('admin-code-input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitAdminCode();
    }
  });
  // Cerrar cualquier modal-overlay al hacer click fuera de la caja.
  // Se delega en document porque los modales propios de cada página
  // todavía no existen en el DOM en este punto del arranque.
  document.addEventListener('click', (e) => {
    const overlay = e.target.closest('.modal-overlay');
    if (!overlay || e.target !== overlay) return;
    if (overlay.id === 'admin-modal') closeAdminLoginModal();
    else overlay.classList.add('hidden');
  });
}

function wireAssetFullscreenDelegation() {
  document.addEventListener('click', (e) => {
    const assetEl = e.target.closest('.js-open-asset');
    if (assetEl) openAssetFullscreen(assetEl.dataset.assetSrc, assetEl.dataset.assetTitle);
  });
}

// pageKey: 'logs' | 'weapons' | 'tierlist' | 'about' | 'admin'
// Devuelve una promesa que se resuelve cuando el shell está listo
// (header/footer inyectados, admin UI actualizada, app_settings
// cargados). Cada página debe `await`earla antes de cablear lo suyo.

export async function bootShell(pageKey) {
  state.activeTab = pageKey;
  await loadSharedShell();
  registerModalVisualCleanups();
  setupModalLifecycleObserver();
  wireHeaderNav(pageKey);
  wireAdminModal();
  wireAssetFullscreenDelegation();
  updateAdminUI();
  await loadAppSettings();
}

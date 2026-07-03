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
  wireHeaderNav(pageKey);
  wireAdminModal();
  wireAssetFullscreenDelegation();
  updateAdminUI();
  await loadAppSettings();
}

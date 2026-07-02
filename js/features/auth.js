// =========================================================
// auth.js
// =========================================================
// Autenticación de administrador: estado de sesión (código de 8
// caracteres), login/logout y refresco de la UI dependiente de
// isAdmin().
// =========================================================

import { supabaseClient } from '../config.js';
import { isAdmin, state } from '../core/state.js';
import { showToast } from '../core/utils.js';

const adminUiRefreshHandlers = new Set();

export function registerAdminUiRefreshHandler(handler) {
  if (typeof handler === 'function') adminUiRefreshHandlers.add(handler);
}

export function updateAdminUI() {
  const dot = document.getElementById('admin-dot');
  const admin = isAdmin();
  if (dot) dot.className = admin ? 'dot-online' : 'dot-offline';

  // Botones/elementos que solo existen en algunas páginas — se ocultan
  // o muestran si están presentes en el DOM actual, sin asumir que
  // todos existen (cada página ahora carga solo su propio contenido).
  const adminOnlyIds = [
    'open-new-log-btn', 'open-field-config-btn', 'open-action-log-btn',
    'open-new-tier-row-btn', 'open-new-tier-item-btn', 'admin-panel-tab',
    'open-new-weapon-btn', 'open-weapon-category-manage-btn', 'open-weapon-type-manage-btn',
    'about-admin-toolbar',
  ];
  adminOnlyIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !admin);
  });

  // Si la sesión de admin se cerró estando en la página de Herramientas
  // (solo accesible para admins), volvemos a la portada.
  if (!admin && state.activeTab === 'admin') {
    window.location.href = 'index.html';
    return;
  }

  adminUiRefreshHandlers.forEach(handler => handler(admin));
}


export async function submitAdminCode() {
  const input = document.getElementById('admin-code-input');
  const errorBox = document.getElementById('admin-modal-error');
  const code = input.value.trim();
  if (!code) return;
  const { data, error } = await supabaseClient.rpc('validate_admin_code', { input_code: code });
  if (error || !data) { errorBox.textContent = 'Código inválido o expirado.'; errorBox.classList.remove('hidden'); return; }
  state.adminCode = code;
  localStorage.setItem('culones_admin_code', code);
  errorBox.classList.add('hidden');
  input.value = '';
  document.getElementById('admin-modal').classList.add('hidden');
  showToast('Sesión de administrador activada', 'success');
  updateAdminUI();
}


export function logoutAdmin() {
  state.adminCode = null;
  localStorage.removeItem('culones_admin_code');
  updateAdminUI();
  showToast('Sesión de administrador cerrada');
}

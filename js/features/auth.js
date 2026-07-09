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
let adminLoginSequenceTimers = [];
let adminSubmitting = false;
const ADMIN_MOBILE_TERMINAL_LINES = new Set([
  '0', '1', '2', '3', '4', '5',
  '9', '10', '11',
  '20', '22', '24',
  '27', '28', '29', '30',
  '31', '37', '43', '50', '54', '57',
  '60', '61', '62', '63', '68', '69', '70', '80',
  '82', '83', '84', '85'
]);

function clearAdminLoginSequence() {
  adminLoginSequenceTimers.forEach(timer => clearTimeout(timer));
  adminLoginSequenceTimers = [];
}

function waitAdminTerminal(ms) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, ms);
    adminLoginSequenceTimers.push(timer);
  });
}

function getTerminalTypingProfile(line) {
  if (line.classList.contains('admin-terminal-command')) return { chunk: 3, delay: 6, pause: 38 };
  if (line.classList.contains('admin-terminal-cipher')) return { chunk: 8, delay: 2, pause: 8 };
  if (line.classList.contains('admin-terminal-muted')) return { chunk: 6, delay: 3, pause: 10 };
  return { chunk: 5, delay: 3, pause: 14 };
}

function shouldUseCompactAdminTerminal() {
  return window.matchMedia('(max-width: 720px)').matches;
}

async function typeAdminTerminalLine(line) {
  const text = line.dataset.terminalText || '';
  const { chunk, delay, pause } = getTerminalTypingProfile(line);
  line.classList.add('is-visible');
  for (let idx = 0; idx < text.length; idx += chunk) {
    line.textContent = text.slice(0, idx + chunk);
    line.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    await waitAdminTerminal(delay);
  }
  await waitAdminTerminal(pause);
}

function setAdminSubmitLoading(loading) {
  const btn = document.getElementById('submit-admin-code');
  const label = btn?.querySelector('.btn-label');
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle('is-loading', loading);
  if (label) label.textContent = loading ? 'VERIFYING...' : 'EXECUTE';
}

function setAdminAccessState(type, text, detail = '') {
  const stateBox = document.getElementById('admin-access-state');
  const modalBox = document.querySelector('#admin-modal .admin-login-box');
  if (!stateBox) return;
  const title = document.createElement('span');
  title.className = 'admin-access-title';
  title.textContent = text;
  stateBox.replaceChildren(title);
  if (detail) {
    const detailEl = document.createElement('span');
    detailEl.className = 'admin-access-detail';
    detailEl.textContent = detail;
    stateBox.appendChild(detailEl);
  }
  stateBox.className = `admin-access-state is-${type}`;
  stateBox.classList.remove('hidden');
  modalBox?.classList.remove('is-denied', 'is-granted');
  modalBox?.classList.add(`is-${type}`);
}

function resetAdminAccessState() {
  const stateBox = document.getElementById('admin-access-state');
  const errorBox = document.getElementById('admin-modal-error');
  const modalBox = document.querySelector('#admin-modal .admin-login-box');
  const input = document.getElementById('admin-code-input');
  stateBox?.classList.add('hidden');
  if (stateBox) stateBox.replaceChildren();
  errorBox?.classList.add('hidden');
  if (errorBox) errorBox.textContent = '';
  modalBox?.classList.remove('is-denied', 'is-granted');
  input?.classList.remove('input-error');
  setAdminSubmitLoading(false);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function registerAdminUiRefreshHandler(handler) {
  if (typeof handler === 'function') adminUiRefreshHandlers.add(handler);
}

export function updateAdminUI() {
  const dot = document.getElementById('admin-dot');
  const badge = document.getElementById('admin-mode-badge');
  const label = document.getElementById('admin-toggle-label');
  const admin = isAdmin();
  if (dot) dot.className = admin ? 'dot-online' : 'dot-offline';
  if (badge) badge.classList.toggle('hidden', !admin);
  if (label) label.textContent = admin ? 'LOGOUT' : 'ADMIN';
  document.body?.classList.toggle('is-admin-mode', admin);

  // Botones/elementos que solo existen en algunas páginas — se ocultan
  // o muestran si están presentes en el DOM actual, sin asumir que
  // todos existen (cada página ahora carga solo su propio contenido).
  const adminOnlyIds = [
    'open-new-log-btn', 'open-field-config-btn', 'open-action-log-btn',
    'open-new-tier-row-btn', 'open-new-tier-item-btn', 'admin-panel-tab',
    'open-new-weapon-btn', 'open-weapon-category-manage-btn', 'open-weapon-type-manage-btn',
    'open-new-kit-btn',
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


export function openAdminLoginModal() {
  const modal = document.getElementById('admin-modal');
  const form = document.getElementById('admin-login-form');
  const input = document.getElementById('admin-code-input');
  if (!modal) return;
  clearAdminLoginSequence();
  resetAdminAccessState();
  if (input) input.value = '';
  form?.classList.add('hidden');
  const terminalLines = [...document.querySelectorAll('[data-admin-terminal-line]')];
  const compactTerminal = shouldUseCompactAdminTerminal();
  terminalLines.forEach(line => {
    if (!line.dataset.terminalText) line.dataset.terminalText = line.textContent;
    const shouldSkip = compactTerminal && !ADMIN_MOBILE_TERMINAL_LINES.has(line.dataset.adminTerminalLine);
    line.classList.remove('is-visible', 'is-mobile-skipped');
    line.classList.toggle('is-mobile-skipped', shouldSkip);
    line.textContent = '';
  });
  const visibleTerminalLines = terminalLines.filter(line => !line.classList.contains('is-mobile-skipped'));
  modal.classList.remove('hidden');

  (async () => {
    await waitAdminTerminal(80);
    for (const line of visibleTerminalLines) {
      await typeAdminTerminalLine(line);
    }
    form?.classList.remove('hidden');
    input?.focus();
  })();
}

export function closeAdminLoginModal() {
  clearAdminLoginSequence();
  document.getElementById('admin-modal')?.classList.add('hidden');
  resetAdminAccessState();
}

export async function submitAdminCode() {
  if (adminSubmitting) return;
  const input = document.getElementById('admin-code-input');
  const errorBox = document.getElementById('admin-modal-error');
  if (!input || !errorBox) return;
  const code = input.value.trim();
  if (!code) return;
  adminSubmitting = true;
  resetAdminAccessState();
  setAdminSubmitLoading(true);

  try {
    const { data, error } = await supabaseClient.rpc('validate_admin_code', {
      input_code: code
    });

    if (error) throw error;

    if (!data) {
      input.classList.add('input-error');
      setAdminAccessState('denied', 'ACCESS DENIED', 'Mission aborted.');
      errorBox.textContent = 'Código inválido o expirado.';
      errorBox.classList.add('hidden');
      await delay(950);
      closeAdminLoginModal();
      return;
    }

    state.adminCode = code;
    localStorage.setItem('culones_admin_code', code);
    errorBox.classList.add('hidden');
    input.value = '';
    setAdminAccessState('granted', 'ACCESS GRANTED', 'Administrator Mode enabled.');
    showToast('Sesión de administrador activada', 'success');
    updateAdminUI();
    await delay(700);
    closeAdminLoginModal();
  } catch (error) {
    input.classList.add('input-error');
    setAdminAccessState('denied', 'ACCESS DENIED', 'Mission aborted.');
    errorBox.textContent = 'Código inválido o expirado.';
    errorBox.classList.add('hidden');
    await delay(950);
    closeAdminLoginModal();
  } finally {
    setAdminSubmitLoading(false);
    adminSubmitting = false;
  }
}


export function logoutAdmin() {
  state.adminCode = null;
  localStorage.removeItem('culones_admin_code');
  updateAdminUI();
  showToast('Sesión de administrador cerrada');
}

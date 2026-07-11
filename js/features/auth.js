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
let adminLoginSequenceGeneration = 0;
let adminSubmitting = false;
let adminLoginSequenceActive = false;
let adminTerminalPrepared = false;
let adminTerminalLineTemplates = [];
const ADMIN_MOBILE_TERMINAL_LINES = new Set([
  '0', '1', '2', '3', '4', '5', '6',
  '7', '8', '9', '10', '11', '12', '13'
]);

/**
 * El terminal de acceso es una interfaz pesada (decenas de líneas). Se
 * conserva idéntico, pero sus nodos se desmontan mientras el modal está
 * cerrado y se crean solamente cuando el usuario abre Modo Admin.
 */
export function prepareAdminLoginModal() {
  if (adminTerminalPrepared) return;
  const panel = document.querySelector('#admin-modal .admin-terminal-panel');
  if (!panel) return;
  const lines = [...panel.querySelectorAll('[data-admin-terminal-line]')];
  adminTerminalLineTemplates = lines.map(line => line.cloneNode(true));
  lines.forEach(line => line.remove());
  adminTerminalPrepared = true;
}

function mountAdminTerminalLines() {
  prepareAdminLoginModal();
  const panel = document.querySelector('#admin-modal .admin-terminal-panel');
  const form = document.getElementById('admin-login-form');
  if (!panel || panel.querySelector('[data-admin-terminal-line]')) return;
  const fragment = document.createDocumentFragment();
  adminTerminalLineTemplates.forEach(template => fragment.appendChild(template.cloneNode(true)));
  panel.insertBefore(fragment, form || panel.firstChild);
}

function unmountAdminTerminalLines() {
  document.querySelectorAll('#admin-modal [data-admin-terminal-line]').forEach(line => line.remove());
}


function clearAdminLoginSequence() {
  adminLoginSequenceGeneration += 1;
  adminLoginSequenceTimers.forEach(entry => {
    clearTimeout(entry.timer);
    entry.resolve(false);
  });
  adminLoginSequenceTimers = [];
  adminLoginSequenceActive = false;
}

function waitAdminTerminal(ms, generation) {
  return new Promise(resolve => {
    const entry = { timer: null, resolve };
    entry.timer = setTimeout(() => {
      adminLoginSequenceTimers = adminLoginSequenceTimers.filter(item => item !== entry);
      resolve(generation === adminLoginSequenceGeneration);
    }, ms);
    adminLoginSequenceTimers.push(entry);
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

async function typeAdminTerminalLine(line, generation) {
  const text = line.dataset.terminalText || '';
  const { chunk, delay, pause } = getTerminalTypingProfile(line);
  line.classList.add('is-visible');
  for (let idx = 0; idx < text.length; idx += chunk) {
    if (generation !== adminLoginSequenceGeneration) return false;
    line.textContent = text.slice(0, idx + chunk);
    if (!(await waitAdminTerminal(delay, generation))) return false;
  }
  return waitAdminTerminal(pause, generation);
}

function revealAdminLoginPrompt() {
  const form = document.getElementById('admin-login-form');
  const input = document.getElementById('admin-code-input');
  form?.classList.remove('hidden');
  input?.focus();
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
  const sublabel = document.getElementById('admin-toggle-sublabel');
  const subtitle = document.getElementById('hud-subtitle');
  const mobileIndicator = document.getElementById('mobile-admin-indicator');
  const admin = isAdmin();
  if (dot) dot.className = admin ? 'dot-online' : 'dot-offline';
  if (badge) badge.classList.toggle('hidden', !admin);
  if (mobileIndicator) mobileIndicator.classList.toggle('hidden', !admin);
  if (label) label.textContent = admin ? 'Salir del Modo Admin' : 'Entrar a Modo Admin';
  if (sublabel) sublabel.textContent = admin ? 'Sesión administrativa activa' : 'Acceso para administradores';
  if (subtitle) subtitle.textContent = admin ? 'Panel de Administración' : 'Página oficial';
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
  document.dispatchEvent(new CustomEvent('culones:admin-state-changed', { detail: { admin } }));
}


export function openAdminLoginModal() {
  const modal = document.getElementById('admin-modal');
  const form = document.getElementById('admin-login-form');
  const input = document.getElementById('admin-code-input');
  if (!modal) return;
  mountAdminTerminalLines();
  clearAdminLoginSequence();
  const sequenceGeneration = adminLoginSequenceGeneration;
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
  adminLoginSequenceActive = true;

  (async () => {
    if (!(await waitAdminTerminal(80, sequenceGeneration))) return;
    for (const line of visibleTerminalLines) {
      if (!(await typeAdminTerminalLine(line, sequenceGeneration))) return;
    }
    if (sequenceGeneration !== adminLoginSequenceGeneration) return;
    adminLoginSequenceActive = false;
    revealAdminLoginPrompt();
  })();
}

export function skipAdminLoginIntro() {
  const modal = document.getElementById('admin-modal');
  const form = document.getElementById('admin-login-form');
  if (!modal || modal.classList.contains('hidden') || !adminLoginSequenceActive || !form?.classList.contains('hidden')) return false;
  clearAdminLoginSequence();
  document.querySelectorAll('[data-admin-terminal-line]').forEach(line => {
    if (line.classList.contains('is-mobile-skipped')) return;
    if (!line.dataset.terminalText) line.dataset.terminalText = line.textContent;
    line.textContent = line.dataset.terminalText || '';
    line.classList.add('is-visible');
  });
  revealAdminLoginPrompt();
  return true;
}

export function closeAdminLoginModal() {
  clearAdminLoginSequence();
  document.getElementById('admin-modal')?.classList.add('hidden');
  resetAdminAccessState();
  unmountAdminTerminalLines();
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

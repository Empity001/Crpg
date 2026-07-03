// =========================================================
// utils.js
// =========================================================
// Utilidades genéricas sin dependencias de dominio: debounce, saneado de
// HTML/URLs, formateo de fechas, toasts, identificador de cliente
// anónimo. Cualquier módulo puede importar de aquí sin riesgo de ciclos.
// =========================================================

export function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ---------------------------------------------------------
// FLAG: suprime la recarga por Realtime cuando el propio
// cliente acaba de guardar. Se activa justo antes de la
// llamada RPC y se desactiva automáticamente tras 3 s.
// ---------------------------------------------------------

export function getOrCreateClientId() {
  let id = localStorage.getItem('culones_client_id');
  if (!id) { id = 'client_' + crypto.randomUUID(); localStorage.setItem('culones_client_id', id); }
  return id;
}


export function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

const modalLifecycleCleanups = new Map();
let modalLifecycleObserver = null;

function uniqueList(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function cleanupVideoElement(video) {
  try {
    video.pause();
    video.removeAttribute('src');
    video.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
    video.load();
  } catch (error) {
    // Best-effort cleanup; hidden previews should never block modal closing.
  }
}

function pauseModalMedia(root) {
  root.querySelectorAll('video').forEach(cleanupVideoElement);
}

function clearElementContent(element) {
  pauseModalMedia(element);
  element.replaceChildren();
}

function clearAssetPreview(prefix) {
  const wrap = document.getElementById(`${prefix}-image-preview-wrap`);
  const img = document.getElementById(`${prefix}-image-preview`);
  const fullscreenBtn = document.getElementById(`${prefix}-image-fullscreen-btn`);
  if (img) {
    img.removeAttribute('src');
    img.removeAttribute('srcset');
  }
  if (fullscreenBtn) {
    delete fullscreenBtn.dataset.assetSrc;
    delete fullscreenBtn.dataset.assetTitle;
  }
  wrap?.classList.add('hidden');
}

export function registerModalLifecycleCleanup(modalId, config = {}) {
  if (!modalId) return;
  const current = modalLifecycleCleanups.get(modalId) || {};
  const callbacks = [...(current.onCloseCallbacks || [])];
  if (typeof config.onClose === 'function' && !callbacks.includes(config.onClose)) {
    callbacks.push(config.onClose);
  }
  modalLifecycleCleanups.set(modalId, {
    clearSelectors: uniqueList(current.clearSelectors || [], config.clearSelectors || []),
    hideSelectors: uniqueList(current.hideSelectors || [], config.hideSelectors || []),
    resetTextSelectors: uniqueList(current.resetTextSelectors || [], config.resetTextSelectors || []),
    assetPreviewPrefixes: uniqueList(current.assetPreviewPrefixes || [], config.assetPreviewPrefixes || []),
    onCloseCallbacks: callbacks,
  });
}

export function cleanupModalVisualResources(modal) {
  if (!modal) return;
  pauseModalMedia(modal);
  const config = modalLifecycleCleanups.get(modal.id);
  if (!config) return;

  (config.clearSelectors || []).forEach(selector => {
    modal.querySelectorAll(selector).forEach(clearElementContent);
  });
  (config.resetTextSelectors || []).forEach(selector => {
    modal.querySelectorAll(selector).forEach(element => { element.textContent = ''; });
  });
  (config.hideSelectors || []).forEach(selector => {
    modal.querySelectorAll(selector).forEach(element => element.classList.add('hidden'));
  });
  (config.assetPreviewPrefixes || []).forEach(clearAssetPreview);
  (config.onCloseCallbacks || []).forEach(callback => callback(modal));
}

function handleModalLifecycleChange(modal) {
  const isHidden = modal.classList.contains('hidden');
  if (!isHidden) {
    modal.dataset.visualResourcesCleaned = 'false';
    return;
  }
  if (modal.dataset.visualResourcesCleaned === 'true') return;
  cleanupModalVisualResources(modal);
  modal.dataset.visualResourcesCleaned = 'true';
}

export function setupModalLifecycleObserver() {
  if (modalLifecycleObserver || !document.body) return;
  modalLifecycleObserver = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
      const target = mutation.target;
      if (mutation.type === 'attributes' && target instanceof Element && target.classList.contains('modal-overlay')) {
        handleModalLifecycleChange(target);
      }
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          if (!(node instanceof Element)) return;
          if (node.classList.contains('modal-overlay')) handleModalLifecycleChange(node);
          node.querySelectorAll?.('.modal-overlay').forEach(handleModalLifecycleChange);
        });
      }
    });
  });
  modalLifecycleObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });
  document.querySelectorAll('.modal-overlay').forEach(handleModalLifecycleChange);
}

function ensureConfirmModal() {
  let modal = document.getElementById('app-confirm-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden app-confirm-overlay';
  modal.id = 'app-confirm-modal';
  modal.innerHTML = `
    <div class="modal-box app-confirm-box">
      <button class="modal-close" id="app-confirm-close" aria-label="Cerrar">✕</button>
      <p class="admin-login-kicker">Administrator confirmation</p>
      <h3 class="modal-title app-confirm-title" id="app-confirm-title"></h3>
      <p class="modal-hint app-confirm-message" id="app-confirm-message"></p>
      <div class="app-confirm-actions">
        <button type="button" class="btn-secondary-admin" id="app-confirm-cancel">Cancelar</button>
        <button type="button" class="btn-secondary-admin danger" id="app-confirm-accept"></button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

export function confirmAction({
  title = 'Confirmar acción',
  message = '',
  confirmLabel = 'Confirmar',
  danger = true,
} = {}) {
  return new Promise(resolve => {
    const modal = ensureConfirmModal();
    const titleEl = document.getElementById('app-confirm-title');
    const messageEl = document.getElementById('app-confirm-message');
    const acceptBtn = document.getElementById('app-confirm-accept');
    const cancelBtn = document.getElementById('app-confirm-cancel');
    const closeBtn = document.getElementById('app-confirm-close');
    titleEl.textContent = title;
    messageEl.textContent = message;
    acceptBtn.textContent = confirmLabel;
    acceptBtn.className = danger ? 'btn-secondary-admin danger' : 'btn-secondary-admin';

    const cleanup = (value) => {
      modal.classList.add('hidden');
      acceptBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      modal.onclick = null;
      resolve(value);
    };

    acceptBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    closeBtn.onclick = () => cleanup(false);
    modal.onclick = (event) => { if (event.target === modal) cleanup(false); };
    modal.classList.remove('hidden');
    cancelBtn.focus();
  });
}


export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}


export function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}


export function toDatetimeLocalValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


export function tempId() { return 'tmp_' + Math.random().toString(36).slice(2, 10); }


export function asArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch(e) { return []; }
  }
  return [];
}

// Solo permite URLs http/https — evita esquemas raros (javascript:, etc.)
// en los campos de "imagen de referencia" que vienen de texto libre.

export function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) {}
  return '';
}

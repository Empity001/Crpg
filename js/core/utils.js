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

export function withTimeout(promise, timeoutMs = 10000, label = 'La operación') {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} tardó demasiado.`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(promise), timeout])
    .finally(() => window.clearTimeout(timer));
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
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body?.appendChild(container);
  }
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4000);
}

const editorClipboards = new Map();

export function cloneData(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

export function copyEditorPayload(scope, payload) {
  if (!scope) return;
  editorClipboards.set(scope, cloneData(payload));
  showToast('Copiado', 'success');
}

export function getEditorPayload(scope) {
  if (!editorClipboards.has(scope)) return null;
  return cloneData(editorClipboards.get(scope));
}

export function hasEditorPayload(scope) {
  return editorClipboards.has(scope);
}

const modalLifecycleCleanups = new Map();
const modalVisibilityStates = new WeakMap();
let modalLifecycleObserver = null;
let modalPortal = null;
let modalOpenSequence = 0;

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

/**
 * Todos los overlays viven en un portal fijo, fuera del flujo de la página.
 * Esto evita que un selector creado al final del <body> aumente la altura del
 * documento o termine visualmente "debajo" de otras interfaces.
 */
export function ensureModalPortal() {
  if (modalPortal?.isConnected) return modalPortal;
  modalPortal = document.getElementById('modal-portal');
  if (!modalPortal) {
    modalPortal = document.createElement('div');
    modalPortal.id = 'modal-portal';
    modalPortal.setAttribute('aria-live', 'off');
    document.body.appendChild(modalPortal);
  }
  return modalPortal;
}

export function mountModal(modal) {
  if (!(modal instanceof Element)) return modal;
  const portal = ensureModalPortal();
  if (modal.parentElement !== portal) portal.appendChild(modal);
  return modal;
}

function visibleModalOverlays() {
  const portal = ensureModalPortal();
  return [...portal.querySelectorAll(':scope > .modal-overlay:not(.hidden)')];
}

function recomputeModalStack() {
  const visible = visibleModalOverlays()
    .sort((a, b) => Number(a.dataset.modalOpenSequence || 0) - Number(b.dataset.modalOpenSequence || 0));

  visible.forEach((modal, index) => {
    const layer = 100 + index * 20;
    modal.style.setProperty('--modal-stack-z', String(layer));
    modal.dataset.modalStackDepth = String(index);
    modal.classList.toggle('is-stacked-modal', index > 0);
    modal.classList.toggle('is-stack-top', index === visible.length - 1);
    modal.classList.toggle('is-stack-obscured', index < visible.length - 1);
  });

  ensureModalPortal().querySelectorAll(':scope > .modal-overlay.hidden').forEach(modal => {
    modal.style.removeProperty('--modal-stack-z');
    delete modal.dataset.modalStackDepth;
    modal.classList.remove('is-stacked-modal', 'is-stack-top', 'is-stack-obscured');
  });
}

export function bringModalToFront(modal) {
  if (!(modal instanceof Element)) return modal;
  mountModal(modal);
  if (modal.classList.contains('hidden')) return modal;

  modalOpenSequence += 1;
  modal.dataset.modalOpenSequence = String(modalOpenSequence);
  // El orden DOM también sirve como respaldo en navegadores con reglas CSS
  // antiguas cacheadas. El z-index real se asigna después por profundidad.
  ensureModalPortal().appendChild(modal);
  recomputeModalStack();
  document.dispatchEvent(new CustomEvent('culones:modal-opened', { detail: { modal } }));
  return modal;
}

function visibleModalCount() {
  const portal = ensureModalPortal();
  return portal.querySelectorAll('.modal-overlay:not(.hidden)').length;
}

function syncModalOpenState() {
  if (!document.body) return;
  const hasOpenModal = visibleModalCount() > 0;
  document.body.classList.toggle('modal-open', hasOpenModal);
  document.documentElement.classList.toggle('modal-open', hasOpenModal);
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

function handleModalLifecycleChange(modal, { force = false } = {}) {
  if (!(modal instanceof Element)) return;

  const isVisible = !modal.classList.contains('hidden');
  const previous = modalVisibilityStates.get(modal);

  // Las clases internas de la pila (is-stack-top, is-stack-obscured, etc.)
  // también producen mutaciones. Si la visibilidad real no cambió, no
  // hacemos nada: esto evita un bucle de MutationObserver y el crecimiento
  // progresivo de memoria que podía dejar la página en blanco.
  if (!force && previous === isVisible) return;

  modalVisibilityStates.set(modal, isVisible);
  modal.setAttribute('aria-hidden', isVisible ? 'false' : 'true');

  if (isVisible) {
    modal.dataset.visualResourcesCleaned = 'false';
    modalOpenSequence += 1;
    modal.dataset.modalOpenSequence = String(modalOpenSequence);
    const portal = ensureModalPortal();
    if (modal.parentElement !== portal) portal.appendChild(modal);
    else portal.appendChild(modal); // lo deja como la capa más reciente
  } else {
    if (modal.dataset.visualResourcesCleaned !== 'true') {
      cleanupModalVisualResources(modal);
      modal.dataset.visualResourcesCleaned = 'true';
    }
    delete modal.dataset.modalOpenSequence;
  }

  recomputeModalStack();
  syncModalOpenState();
}

export function setupModalLifecycleObserver() {
  if (modalLifecycleObserver || !document.body) return;
  const portal = ensureModalPortal();

  // Todos los overlays existentes se montan una sola vez antes de observar.
  [...document.querySelectorAll('.modal-overlay')].forEach(modal => {
    mountModal(modal);
    handleModalLifecycleChange(modal, { force: true });
  });

  // Solo observamos el atributo class de overlays que ya viven dentro del
  // portal. No observamos todo el body ni cada render dinámico de tarjetas.
  modalLifecycleObserver = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const target = mutation.target;
      if (target instanceof Element && target.matches('.modal-overlay')) {
        handleModalLifecycleChange(target);
      }
    }
  });
  modalLifecycleObserver.observe(portal, {
    attributes: true,
    attributeFilter: ['class'],
    subtree: true,
  });

  window.addEventListener('pagehide', () => {
    modalLifecycleObserver?.disconnect();
    modalLifecycleObserver = null;
  }, { once: true });

  syncModalOpenState();
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
  mountModal(modal);
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
    bringModalToFront(modal);
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

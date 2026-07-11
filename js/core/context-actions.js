import { ensureModalPortal } from './utils.js';

let activePanel = null;
let activeAnchor = null;
let outsideHandler = null;
let keyHandler = null;
let resizeHandler = null;
let panelResizeObserver = null;
let repositionFrame = 0;

function viewportRect() {
  const vv = window.visualViewport;
  return {
    left: vv?.offsetLeft || 0,
    top: vv?.offsetTop || 0,
    width: vv?.width || window.innerWidth,
    height: vv?.height || window.innerHeight,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function positionPanel(panel, anchor) {
  if (!panel?.isConnected || !anchor?.isConnected) return;
  const view = viewportRect();
  const rect = anchor.getBoundingClientRect();
  const gap = 12;
  const margin = 12;

  // Limita primero la altura al viewport real (incluido el teclado móvil).
  // Luego mide el panel ya recortado para que cualquier disclosure abierto
  // pueda recolocarlo sin salirse de la pantalla.
  panel.style.maxHeight = `${Math.max(220, view.height - margin * 2)}px`;
  const panelRect = panel.getBoundingClientRect();
  const maxLeft = view.left + view.width - panelRect.width - margin;
  const maxTop = view.top + view.height - panelRect.height - margin;

  const roomRight = view.left + view.width - rect.right;
  const roomLeft = rect.left - view.left;
  const roomBelow = view.top + view.height - rect.bottom;
  const roomAbove = rect.top - view.top;

  let placement = 'right';
  let left = rect.right + gap;
  let top = rect.top;

  if (roomRight >= panelRect.width + gap) {
    placement = 'right';
    left = rect.right + gap;
    top = rect.top + (rect.height - panelRect.height) / 2;
  } else if (roomLeft >= panelRect.width + gap) {
    placement = 'left';
    left = rect.left - panelRect.width - gap;
    top = rect.top + (rect.height - panelRect.height) / 2;
  } else if (roomBelow >= Math.min(panelRect.height, 360) + gap || roomBelow >= roomAbove) {
    placement = 'bottom';
    left = rect.left + (rect.width - panelRect.width) / 2;
    top = rect.bottom + gap;
  } else {
    placement = 'top';
    left = rect.left + (rect.width - panelRect.width) / 2;
    top = rect.top - panelRect.height - gap;
  }

  panel.dataset.placement = placement;
  panel.style.left = `${clamp(left, view.left + margin, Math.max(view.left + margin, maxLeft))}px`;
  panel.style.top = `${clamp(top, view.top + margin, Math.max(view.top + margin, maxTop))}px`;
}

function schedulePosition(panel, anchor) {
  cancelAnimationFrame(repositionFrame);
  repositionFrame = requestAnimationFrame(() => positionPanel(panel, anchor));
}

export function closeContextPanel() {
  if (activePanel) {
    activePanel.classList.add('is-closing');
    const doomed = activePanel;
    setTimeout(() => doomed.remove(), 120);
  }
  activeAnchor?.classList.remove('context-anchor-active');
  activePanel = null;
  activeAnchor = null;
  if (outsideHandler) document.removeEventListener('pointerdown', outsideHandler, true);
  if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
  if (resizeHandler) {
    window.removeEventListener('resize', resizeHandler);
    window.removeEventListener('scroll', resizeHandler, true);
    window.visualViewport?.removeEventListener('resize', resizeHandler);
    window.visualViewport?.removeEventListener('scroll', resizeHandler);
  }
  panelResizeObserver?.disconnect();
  panelResizeObserver = null;
  cancelAnimationFrame(repositionFrame);
  repositionFrame = 0;
  outsideHandler = keyHandler = resizeHandler = null;
}

export function openContextPanel({
  anchor,
  title = 'Acciones',
  subtitle = '',
  width = 340,
  className = '',
  build,
  onClose,
} = {}) {
  if (!(anchor instanceof Element)) return null;
  closeContextPanel();

  const portal = ensureModalPortal();
  const panel = document.createElement('aside');
  panel.className = `context-action-panel ${className}`.trim();
  panel.style.setProperty('--context-panel-width', `${width}px`);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.innerHTML = `
    <header class="context-action-head">
      <div class="context-action-title-wrap">
        <strong class="context-action-title"></strong>
        <span class="context-action-subtitle ${subtitle ? '' : 'hidden'}"></span>
      </div>
      <button type="button" class="context-action-close" aria-label="Cerrar">✕</button>
    </header>
    <div class="context-action-body"></div>
  `;
  panel.querySelector('.context-action-title').textContent = String(title || 'Acciones');
  panel.querySelector('.context-action-subtitle').textContent = String(subtitle || '');
  portal.appendChild(panel);
  panel.style.pointerEvents = 'auto';

  activePanel = panel;
  activeAnchor = anchor;
  anchor.classList.add('context-anchor-active');

  const body = panel.querySelector('.context-action-body');
  const close = () => {
    onClose?.();
    closeContextPanel();
  };
  panel.querySelector('.context-action-close')?.addEventListener('click', close);
  build?.(body, close, panel);

  requestAnimationFrame(() => {
    positionPanel(panel, anchor);
    panel.classList.add('is-open');
  });

  // Los paneles cambian de altura al abrir “Propiedades” o “Acciones”.
  // Recalcular su posición evita que el contenido nuevo salga del viewport.
  if ('ResizeObserver' in window) {
    panelResizeObserver = new ResizeObserver(() => schedulePosition(panel, anchor));
    panelResizeObserver.observe(panel);
  }

  outsideHandler = (event) => {
    if (panel.contains(event.target) || anchor.contains(event.target)) return;
    close();
  };
  keyHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  resizeHandler = () => schedulePosition(panel, anchor);
  setTimeout(() => document.addEventListener('pointerdown', outsideHandler, true), 0);
  document.addEventListener('keydown', keyHandler, true);
  window.addEventListener('resize', resizeHandler);
  window.addEventListener('scroll', resizeHandler, true);
  window.visualViewport?.addEventListener('resize', resizeHandler);
  window.visualViewport?.addEventListener('scroll', resizeHandler);

  return panel;
}

export function actionButton({ label, icon = '', tone = '', disabled = false, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `context-action-button ${tone ? `is-${tone}` : ''}`;
  button.disabled = !!disabled;
  button.innerHTML = `${icon ? `<span aria-hidden="true">${icon}</span>` : ''}<span>${label}</span>`;
  button.addEventListener('click', onClick);
  return button;
}

export function appendActionGrid(root, actions = []) {
  const grid = document.createElement('div');
  grid.className = 'context-action-grid';
  actions.forEach(action => grid.appendChild(actionButton(action)));
  root.appendChild(grid);
  return grid;
}

export function appendDisclosure(root, { title, open = false, className = '', build } = {}) {
  const details = document.createElement('details');
  details.className = `context-disclosure ${className}`.trim();
  details.open = open;
  const summary = document.createElement('summary');
  summary.innerHTML = `<span>${title}</span><span class="context-disclosure-arrow" aria-hidden="true">⌄</span>`;
  const content = document.createElement('div');
  content.className = 'context-disclosure-content';
  details.append(summary, content);
  root.appendChild(details);
  build?.(content, details);
  return details;
}

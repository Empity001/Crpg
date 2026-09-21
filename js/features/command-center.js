// =========================================================
// command-center.js
// =========================================================
// Capa global de atajos y paleta de comandos. Trabaja sobre la UI ya
// existente (botones, modales y menús contextuales) para no duplicar la
// lógica de negocio de cada sección.
// =========================================================

import { closeContextPanel } from '../core/context-actions.js';
import { showToast } from '../core/utils.js';

const PAGE_LINKS = [
  { key: 'home', label: 'Ir a la Portada', url: 'index.html', icon: '🏠', shortcut: 'Alt 0' },
  { key: 'logs', label: 'Ir a Logs', url: 'logs.html', icon: '📜', shortcut: 'Alt 1' },
  { key: 'guides', label: 'Ir a Guías', url: 'guides.html', icon: '⚔️', shortcut: 'Alt 2' },
  { key: 'tierlist', label: 'Ir a Tierlist', url: 'tierlist.html', icon: '🏆', shortcut: 'Alt 3' },
  { key: 'kits', label: 'Ir a Kits', url: 'kits.html', icon: '🎒', shortcut: 'Alt 4' },
  { key: 'about', label: 'Ir a Acerca del servidor', url: 'about.html', icon: '🎮', shortcut: 'Alt 5' },
  { key: 'admin', label: 'Ir a Herramientas', url: 'admin.html', icon: '🛠', shortcut: 'Alt 6', adminOnly: true },
];

const COMMAND_DEFINITIONS = [
  { id: 'search-global', label: 'Buscar en toda la página', icon: '⌕', group: 'Buscar', shortcut: 'Ctrl K', keywords: 'buscar global encontrar contenido' },
  { id: 'search-section', label: 'Enfocar buscador o filtro de esta sección', icon: '/', group: 'Buscar', shortcut: '/', keywords: 'filtro buscar sección' },
  { id: 'create', label: 'Crear un elemento en esta sección', icon: '+', group: 'Editar', shortcut: 'Alt N', keywords: 'nuevo crear añadir' },
  { id: 'edit', label: 'Editar el elemento seleccionado', icon: '✏', group: 'Editar', shortcut: 'Alt E', keywords: 'editar seleccionado actual' },
  { id: 'save', label: 'Guardar el editor abierto', icon: '✓', group: 'Editar', shortcut: 'Ctrl S', keywords: 'guardar borrador confirmar cambios' },
  { id: 'confirm', label: 'Confirmar el formulario o modal abierto', icon: '↵', group: 'Editar', shortcut: 'Ctrl Enter', keywords: 'confirmar enviar formulario' },
  { id: 'media', label: 'Abrir Biblioteca Multimedia para el campo activo', icon: '▦', group: 'Editar', shortcut: 'Ctrl Alt M', keywords: 'imagen recurso biblioteca multimedia' },
  { id: 'copy', label: 'Copiar el elemento seleccionado', icon: '⎘', group: 'Acciones', shortcut: 'Ctrl Alt C', keywords: 'copiar datos estructurados' },
  { id: 'paste', label: 'Pegar datos compatibles', icon: '↧', group: 'Acciones', shortcut: 'Ctrl Alt V', keywords: 'pegar datos estructurados' },
  { id: 'duplicate', label: 'Duplicar el elemento seleccionado', icon: '⧉', group: 'Acciones', shortcut: 'Ctrl Alt D', keywords: 'duplicar clonar copia' },
  { id: 'previous', label: 'Ir al elemento o rango anterior', icon: '←', group: 'Navegar', shortcut: '[', keywords: 'anterior rango elemento' },
  { id: 'next', label: 'Ir al elemento o rango siguiente', icon: '→', group: 'Navegar', shortcut: ']', keywords: 'siguiente rango elemento' },
  { id: 'close', label: 'Cerrar la capa superior', icon: '✕', group: 'Interfaz', shortcut: 'Esc', keywords: 'cerrar modal popup ventana' },
  { id: 'shortcuts', label: 'Mostrar todos los atajos', icon: '?', group: 'Ayuda', shortcut: '?', keywords: 'ayuda teclado atajos' },
  { id: 'palette', label: 'Abrir paleta de comandos', icon: '⌘', group: 'Ayuda', shortcut: 'Ctrl Shift K', keywords: 'comandos acciones paleta' },
];

const ALL_COMMANDS = [
  ...COMMAND_DEFINITIONS,
  ...PAGE_LINKS.map(page => ({
    id: `navigate:${page.key}`,
    label: page.label,
    icon: page.icon,
    group: 'Navegar',
    shortcut: page.shortcut,
    keywords: `${page.key} sección pagina`,
    adminOnly: page.adminOnly,
  })),
];

const SHORTCUT_COOLDOWN_MS = 180;

let initialized = false;
let activePage = 'logs';
let palette = null;
let helpDialog = null;
let paletteInput = null;
let paletteList = null;
let paletteResults = [];
let paletteIndex = 0;
let lastActionTarget = null;
let lastFocusedField = null;
let focusBeforeCommandLayer = null;
let listenersController = null;
let paletteAvailability = new Map();
let paletteRenderFrame = 0;
let pendingShortcut = null;
let shortcutCooldownUntil = 0;
let initialCommandSelectionCleared = false;
const pressedShortcutCodes = new Set();


function rememberLayerFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && !active.closest('.command-palette-overlay, .shortcut-help-overlay')) {
    focusBeforeCommandLayer = active;
  }
}

function restoreLayerFocus() {
  const target = focusBeforeCommandLayer;
  focusBeforeCommandLayer = null;
  if (target?.isConnected && typeof target.focus === 'function') target.focus({ preventScroll: true });
  else document.body?.focus?.();
}

function isVisible(element) {
  if (!(element instanceof Element) || !element.isConnected) return false;
  if (element.closest('[hidden], .hidden, [aria-hidden="true"]')) return false;
  return element.getClientRects().length > 0;
}

function isEnabled(element) {
  return isVisible(element) && !element.matches(':disabled,[aria-disabled="true"]');
}

function isTextEntry(target = document.activeElement) {
  if (!(target instanceof Element)) return false;
  return target.matches('input, textarea, select, [contenteditable="true"], [role="textbox"]');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .trim();
}

function firstEnabled(selectors, root = document) {
  for (const selector of selectors) {
    for (const match of root.querySelectorAll(selector)) {
      if (isEnabled(match)) return match;
    }
  }
  return null;
}

function activeModal() {
  const modals = [...document.querySelectorAll('.modal-overlay:not(.hidden)')].filter(isVisible);
  return modals.sort((a, b) => Number(a.dataset.modalOpenSequence || a.dataset.modalStackDepth || 0) - Number(b.dataset.modalOpenSequence || b.dataset.modalStackDepth || 0)).at(-1) || null;
}

function clickElement(element) {
  if (!isEnabled(element)) return false;
  element.click();
  return true;
}

function findPageSearchTarget() {
  const selectorsByPage = {
    logs: ['#sort-select', '#category-filters .pill'],
    guides: ['#weapon-search-input', '#weapon-category-filters .pill', '#weapon-type-filters .pill'],
    tierlist: [],
    kits: [],
    about: [],
    admin: ['#media-library-search', '#media-library-kind-filter'],
  };
  return firstEnabled(selectorsByPage[activePage] || []);
}

function focusElement(element) {
  if (!(element instanceof HTMLElement)) return false;
  element.focus({ preventScroll: false });
  element.scrollIntoView?.({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  if (element instanceof HTMLInputElement && ['text', 'search'].includes(element.type)) element.select();
  return true;
}

function currentContextTarget() {
  if (lastActionTarget?.isConnected && isVisible(lastActionTarget)) return lastActionTarget;

  const focused = document.activeElement instanceof Element ? document.activeElement : null;
  const focusedTarget = focused?.closest('.log-card, .kit-card, .tier-item-chip, .weapon-card, .weapon-rank-pill-wrap, [data-about-block-index]');
  if (focusedTarget && isVisible(focusedTarget)) return focusedTarget;

  return firstEnabled([
    '.log-card.is-selected',
    '.log-card[aria-selected="true"]',
    '.weapon-rank-pill-wrap:has(.pill.is-active)',
    '.kit-card.is-command-selected',
    '.tier-item-chip.is-command-selected',
    '[data-about-block-index].is-command-selected',
  ]);
}

function markActionTarget(target) {
  const card = target instanceof Element
    ? target.closest('.log-card, .kit-card, .tier-item-chip, .weapon-card, .weapon-rank-pill-wrap, [data-about-block-index]')
    : null;
  if (!card) return;

  if (card === lastActionTarget) return;

  if (!initialCommandSelectionCleared) {
    document.querySelectorAll('.is-command-selected').forEach(item => item.classList.remove('is-command-selected'));
    initialCommandSelectionCleared = true;
  } else if (lastActionTarget?.isConnected) {
    lastActionTarget.classList.remove('is-command-selected');
  }

  card.classList.add('is-command-selected');
  lastActionTarget = card;
}

function contextTriggerForTarget(target = currentContextTarget()) {
  if (!target) {
    if (activePage === 'guides') {
      return firstEnabled([
        '.weapon-rank-pill-wrap:has(.pill.is-active) [data-action="rank-actions"]',
        '#weapon-detail-content [data-action="weapon-actions"]',
      ]);
    }
    return null;
  }

  return firstEnabled([
    '[data-action="log-actions"]',
    '[data-action="kit-actions"]',
    '[data-action="tier-item-actions"]',
    '[data-action="rank-actions"]',
    '[data-action="weapon-actions"]',
    '.about-block-actions-trigger',
    '.context-menu-trigger',
  ], target);
}

function clickContextAction(labels) {
  const labelList = labels.map(normalizeText);
  const trigger = contextTriggerForTarget();
  if (!trigger) return false;
  trigger.click();

  window.requestAnimationFrame(() => {
    const buttons = [...document.querySelectorAll('.context-action-panel.is-open .context-action-button, .context-action-panel .context-action-button')].filter(isEnabled);
    const button = buttons.find(item => labelList.some(label => normalizeText(item.textContent).includes(label)));
    if (button) button.click();
    else showToast('Esta acción no está disponible para el elemento seleccionado.', 'error');
  });
  return true;
}

function editorActionButton(action) {
  const modal = activeModal();
  if (!modal) return null;
  const terms = {
    copy: ['copiar'],
    paste: ['pegar'],
    duplicate: ['duplicar'],
  }[action] || [];
  return [...modal.querySelectorAll('button')].find(button => isEnabled(button) && terms.some(term => normalizeText(button.textContent).includes(term))) || null;
}

function saveButton() {
  const modal = activeModal();
  if (modal) {
    const candidates = [...modal.querySelectorAll('button')].filter(isEnabled);
    const exact = candidates.find(button => /^(guardar|actualizar|crear|aplicar)(\s|$)/i.test(button.textContent.trim()));
    if (exact) return exact;
    const byId = firstEnabled(['[id^="submit-"]', '[id$="-save-btn"]', '.btn-primary'], modal);
    if (byId && !/eliminar|borrar|despublicar/i.test(byId.textContent)) return byId;
  }
  return firstEnabled(['#draft-manual-save-btn', '#save-about-editor-btn', '#theme-save-btn', '#bg-save-btn', '#hero-banner-save-btn', '#favicon-save-btn']);
}

function confirmButton() {
  const modal = activeModal();
  if (modal) {
    const focused = document.activeElement;
    if (focused?.closest?.('.comment-form')) return firstEnabled(['#submit-comment-btn'], modal);
    return firstEnabled([
      '#app-confirm-accept',
      '[id^="submit-"]',
      '[id$="-confirm-btn"]',
      '[id$="-save-btn"]',
      '.btn-primary',
    ], modal);
  }
  return firstEnabled(['#submit-comment-btn', '#draft-manual-save-btn']);
}

function closeTopLayer() {
  if (palette && !palette.classList.contains('hidden')) {
    closePalette();
    return true;
  }
  if (helpDialog && !helpDialog.classList.contains('hidden')) {
    closeHelp();
    return true;
  }

  const contextPanel = document.querySelector('.context-action-panel');
  if (contextPanel) {
    closeContextPanel();
    return true;
  }

  const modal = activeModal();
  if (modal) {
    const close = firstEnabled([
      '.modal-close',
      '[id^="close-"]',
      '[data-modal-close]',
      '#import-conflict-cancel-btn',
    ], modal);
    if (close) close.click();
    else modal.classList.add('hidden');
    return true;
  }

  const notification = document.getElementById('site-notification-panel');
  if (notification && notification.getAttribute('aria-hidden') === 'false') {
    document.querySelector('[data-notification-close]')?.click();
    return true;
  }
  const settings = document.getElementById('visitor-settings-panel');
  if (settings && settings.getAttribute('aria-hidden') === 'false') {
    document.getElementById('visitor-settings-close')?.click();
    return true;
  }
  if (document.body.classList.contains('sidebar-open')) {
    document.getElementById('sidebar-scrim')?.click();
    return true;
  }
  return false;
}

function mediaButton() {
  const active = document.activeElement instanceof Element ? document.activeElement : lastFocusedField;
  if (active?.id) {
    const direct = document.querySelector(`[data-media-picker-for="${CSS.escape(active.id)}"]`);
    if (isEnabled(direct)) return direct;
  }

  const modal = activeModal();
  if (modal) {
    const modalButton = firstEnabled([
      '[data-media-picker-for]',
      '.btn-media-picker',
      '#log-cover-image-picker-btn',
      '[data-action="pick-info-visual"]',
    ], modal);
    if (modalButton) return modalButton;
  }

  return firstEnabled(['[data-media-picker-for]', '.btn-media-picker', '#log-cover-image-picker-btn']);
}

function createButton() {
  const selectors = {
    logs: ['#open-new-log-btn'],
    guides: ['#open-new-weapon-btn'],
    tierlist: ['#open-new-tier-item-btn', '#open-new-tier-row-btn'],
    kits: ['#open-new-kit-btn'],
    about: ['#open-about-editor-btn'],
    admin: ['#media-library-upload-btn'],
  };
  return firstEnabled(selectors[activePage] || []);
}

function editButton() {
  const selectors = {
    logs: ['[data-inspector-action="edit"]', '.log-card.is-selected [data-action="log-actions"]'],
    guides: ['#weapon-detail-content [data-action="edit-rank-info"]', '#weapon-detail-content [data-action="edit-weapon-info"]'],
    tierlist: ['.tier-item-chip.is-command-selected [data-action="tier-item-actions"]', '.tier-row:focus-within [data-action="edit-row"]'],
    kits: ['.kit-card.is-command-selected [data-action="kit-actions"]'],
    about: ['#open-about-editor-btn'],
  };
  return firstEnabled(selectors[activePage] || []);
}

function sequenceItems() {
  const selectors = {
    logs: '.log-card',
    guides: '.weapon-rank-selector [data-action="select-rank"]',
    tierlist: '.tier-item-chip',
    kits: '.kit-card',
    about: '#about-content-render [data-about-block-index]',
  };
  const selector = selectors[activePage];
  return selector ? [...document.querySelectorAll(selector)].filter(isVisible) : [];
}

function activeSequenceItem(items) {
  if (!items.length) return null;
  const current = currentContextTarget();
  if (current) {
    const matching = items.find(item => item === current || item.contains(current) || current.contains(item));
    if (matching) return matching;
  }
  return items.find(item => item.matches('.is-selected, .is-active, [aria-selected="true"], .is-command-selected')) || items[0];
}

function moveSequence(direction) {
  const items = sequenceItems();
  if (!items.length) return false;
  const current = activeSequenceItem(items);
  const index = Math.max(0, items.indexOf(current));
  const nextIndex = Math.min(items.length - 1, Math.max(0, index + direction));
  const next = items[nextIndex];
  if (!next || next === current && items.length > 1) return false;
  markActionTarget(next);
  next.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  if (next.matches('button, a, .log-card')) next.click();
  else {
    const clickable = firstEnabled(['button', 'a'], next);
    clickable?.click();
  }
  next.focus?.({ preventScroll: true });
  return true;
}

function canRun(id) {
  switch (id) {
    case 'create': return !!createButton();
    case 'edit': return !!editButton() || !!contextTriggerForTarget();
    case 'save': return !!saveButton();
    case 'confirm': return !!confirmButton();
    case 'media': return !!mediaButton();
    case 'copy':
    case 'paste':
    case 'duplicate': return !!editorActionButton(id) || !!contextTriggerForTarget();
    case 'previous':
    case 'next': return sequenceItems().length > 1;
    case 'search-section': return !!findPageSearchTarget();
    default: return true;
  }
}

function unavailable(message = 'Este comando no está disponible en el contexto actual.') {
  showToast(message, 'error');
  return false;
}

export function executeCommand(id, { fromPalette = false } = {}) {
  if (fromPalette) closePalette();

  if (id.startsWith('navigate:')) {
    const key = id.split(':')[1];
    const page = PAGE_LINKS.find(item => item.key === key);
    if (!page) return false;
    const tab = document.querySelector(`.tab-item[data-page="${CSS.escape(key)}"]`);
    if (page.adminOnly && (!tab || tab.classList.contains('hidden'))) return unavailable('Herramientas solo está disponible con una sesión administrativa activa.');
    window.location.href = page.url;
    return true;
  }

  switch (id) {
    case 'search-global': {
      const toggle = firstEnabled(['.global-search-desktop [data-global-search-toggle]', '[data-global-search-toggle]']);
      return clickElement(toggle) || unavailable('No se pudo abrir el buscador global.');
    }
    case 'search-section': {
      const target = findPageSearchTarget();
      return target ? focusElement(target) : unavailable('Esta sección no tiene un buscador o filtro enfocable.');
    }
    case 'create': return clickElement(createButton()) || unavailable('No hay una acción de creación disponible aquí.');
    case 'edit': {
      const button = editButton();
      if (button) {
        if (button.matches('[data-action$="actions"], .context-menu-trigger')) return clickContextAction(['editar', 'editar rango']);
        return clickElement(button);
      }
      return clickContextAction(['editar', 'editar rango']) || unavailable();
    }
    case 'save': return clickElement(saveButton()) || unavailable('No hay ningún editor abierto para guardar.');
    case 'confirm': return clickElement(confirmButton()) || unavailable('No hay ningún formulario abierto para confirmar.');
    case 'media': return clickElement(mediaButton()) || unavailable('Selecciona primero un campo de imagen o abre un editor compatible.');
    case 'copy': {
      const button = editorActionButton('copy');
      return clickElement(button) || clickContextAction(['copiar']) || unavailable();
    }
    case 'paste': {
      const button = editorActionButton('paste');
      return clickElement(button) || clickContextAction(['pegar']) || unavailable();
    }
    case 'duplicate': {
      const button = editorActionButton('duplicate');
      return clickElement(button) || clickContextAction(['duplicar']) || unavailable();
    }
    case 'previous': return moveSequence(-1) || unavailable('No hay un elemento anterior disponible.');
    case 'next': return moveSequence(1) || unavailable('No hay un elemento siguiente disponible.');
    case 'close': return closeTopLayer();
    case 'shortcuts': openHelp(); return true;
    case 'palette': openPalette(); return true;
    default: return false;
  }
}

function allCommands() {
  return ALL_COMMANDS;
}

function isCommandVisible(command) {
  if (command.adminOnly) {
    const tab = document.querySelector(`.tab-item[data-page="${CSS.escape(command.id.split(':')[1] || 'admin')}"]`);
    if (!tab || tab.classList.contains('hidden')) return false;
  }
  return true;
}

function ensurePalette() {
  if (palette?.isConnected) return palette;
  palette = document.createElement('div');
  palette.id = 'command-palette';
  palette.className = 'command-palette-overlay hidden';
  palette.setAttribute('aria-hidden', 'true');
  palette.innerHTML = `
    <section class="command-palette" role="dialog" aria-modal="true" aria-labelledby="command-palette-title">
      <header class="command-palette-head">
        <span class="command-palette-mark" aria-hidden="true">⌘</span>
        <div>
          <strong id="command-palette-title">Paleta de comandos</strong>
          <small>Busca una acción o escribe su nombre</small>
        </div>
        <button type="button" class="command-palette-close" aria-label="Cerrar">✕</button>
      </header>
      <div class="command-palette-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input type="search" class="command-palette-search" autocomplete="off" spellcheck="false" placeholder="Buscar comandos…" aria-label="Buscar comandos" />
        <kbd>Esc</kbd>
      </div>
      <div class="command-palette-results" role="listbox"></div>
      <footer class="command-palette-footer"><span><kbd>↑</kbd><kbd>↓</kbd> Navegar</span><span><kbd>Enter</kbd> Ejecutar</span><span><kbd>?</kbd> Atajos</span></footer>
    </section>`;
  document.body.appendChild(palette);
  paletteInput = palette.querySelector('.command-palette-search');
  paletteList = palette.querySelector('.command-palette-results');
  palette.querySelector('.command-palette-close')?.addEventListener('click', closePalette);
  palette.addEventListener('pointerdown', event => { if (event.target === palette) closePalette(); });
  paletteInput.addEventListener('input', schedulePaletteRender);
  paletteInput.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); selectPaletteIndex(paletteIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); selectPaletteIndex(paletteIndex - 1); }
    else if (event.key === 'Enter') { event.preventDefault(); paletteResults[paletteIndex] && executeCommand(paletteResults[paletteIndex].id, { fromPalette: true }); }
    else if (event.key === 'Escape') { event.preventDefault(); closePalette(); }
  });
  paletteList.addEventListener('click', event => {
    const button = event.target.closest('[data-command-id]');
    if (!button || button.disabled) return;
    executeCommand(button.dataset.commandId, { fromPalette: true });
  });
  return palette;
}

function schedulePaletteRender() {
  if (paletteRenderFrame) return;
  paletteRenderFrame = window.requestAnimationFrame(() => {
    paletteRenderFrame = 0;
    renderPalette();
  });
}

function refreshPaletteAvailability() {
  paletteAvailability = new Map();
  for (const command of ALL_COMMANDS) {
    if (!isCommandVisible(command)) continue;
    paletteAvailability.set(command.id, canRun(command.id));
  }
}

function commandMatches(command, query) {
  if (!query) return true;
  const haystack = normalizeText(`${command.label} ${command.group} ${command.keywords || ''} ${command.shortcut || ''}`);
  return query.split(/\s+/).every(token => haystack.includes(token));
}

function renderPalette() {
  const query = normalizeText(paletteInput?.value || '');
  paletteResults = allCommands().filter(isCommandVisible).filter(command => commandMatches(command, query));
  paletteIndex = Math.min(paletteIndex, Math.max(0, paletteResults.length - 1));
  if (!paletteResults.length) {
    paletteList.innerHTML = '<p class="command-palette-empty">No se encontraron comandos.</p>';
    return;
  }

  let currentGroup = '';
  paletteList.innerHTML = paletteResults.map((command, index) => {
    const group = command.group !== currentGroup ? `<div class="command-palette-group">${command.group}</div>` : '';
    currentGroup = command.group;
    const enabled = paletteAvailability.get(command.id) ?? true;
    return `${group}<button type="button" class="command-palette-item ${index === paletteIndex ? 'is-active' : ''}" data-command-id="${command.id}" role="option" aria-selected="${index === paletteIndex}" ${enabled ? '' : 'disabled'}>
      <span class="command-palette-item-icon" aria-hidden="true">${command.icon || '•'}</span>
      <span class="command-palette-item-copy"><strong>${command.label}</strong>${enabled ? '' : '<small>No disponible en este contexto</small>'}</span>
      ${command.shortcut ? `<kbd>${command.shortcut}</kbd>` : ''}
    </button>`;
  }).join('');
  paletteList.querySelector('.command-palette-item.is-active')?.scrollIntoView({ block: 'nearest' });
}

function selectPaletteIndex(nextIndex) {
  if (!paletteResults.length) return;
  paletteIndex = (nextIndex + paletteResults.length) % paletteResults.length;
  const items = paletteList?.querySelectorAll('.command-palette-item') || [];
  items.forEach((item, index) => {
    const active = index === paletteIndex;
    item.classList.toggle('is-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) item.scrollIntoView({ block: 'nearest' });
  });
}

export function openPalette() {
  rememberLayerFocus();
  ensurePalette();
  closeHelp();
  palette.classList.remove('hidden');
  palette.setAttribute('aria-hidden', 'false');
  document.body.classList.add('command-layer-open');
  paletteInput.value = '';
  paletteIndex = 0;
  refreshPaletteAvailability();
  renderPalette();
  window.requestAnimationFrame(() => paletteInput.focus());
}

export function closePalette() {
  if (!palette) return;
  if (paletteRenderFrame) {
    window.cancelAnimationFrame(paletteRenderFrame);
    paletteRenderFrame = 0;
  }
  palette.classList.add('hidden');
  palette.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('command-layer-open');
  paletteInput?.blur();
  if (!helpDialog || helpDialog.classList.contains('hidden')) restoreLayerFocus();
}

function ensureHelp() {
  if (helpDialog?.isConnected) return helpDialog;
  helpDialog = document.createElement('div');
  helpDialog.id = 'shortcut-help';
  helpDialog.className = 'shortcut-help-overlay hidden';
  helpDialog.setAttribute('aria-hidden', 'true');
  const shortcuts = [
    ['Ctrl + K', 'Buscador global'],
    ['/', 'Buscador o filtro de la sección'],
    ['Alt + 1…6', 'Navegar entre secciones'],
    ['Alt + N', 'Crear elemento'],
    ['Alt + E', 'Editar elemento seleccionado'],
    ['Ctrl + S', 'Guardar editor o borrador'],
    ['Ctrl + Enter', 'Confirmar formulario o modal'],
    ['Esc', 'Cerrar la capa superior'],
    ['Ctrl + Alt + M', 'Biblioteca Multimedia'],
    ['Ctrl + Alt + D', 'Duplicar seleccionado'],
    ['Ctrl + Alt + C / V', 'Copiar o pegar datos'],
    ['[ / ]', 'Elemento o rango anterior/siguiente'],
    ['?', 'Mostrar esta ayuda'],
    ['Ctrl + Shift + K', 'Paleta de comandos'],
  ];
  helpDialog.innerHTML = `
    <section class="shortcut-help" role="dialog" aria-modal="true" aria-labelledby="shortcut-help-title">
      <header><div><strong id="shortcut-help-title">Atajos de teclado</strong><small>Las acciones se activan solo cuando tienen sentido.</small></div><button type="button" aria-label="Cerrar">✕</button></header>
      <div class="shortcut-help-grid">${shortcuts.map(([keys, label]) => `<div><kbd>${keys}</kbd><span>${label}</span></div>`).join('')}</div>
      <footer><button type="button" class="btn-primary" data-open-command-palette>Abrir paleta de comandos</button></footer>
    </section>`;
  document.body.appendChild(helpDialog);
  helpDialog.querySelector('header button')?.addEventListener('click', closeHelp);
  helpDialog.querySelector('[data-open-command-palette]')?.addEventListener('click', () => { closeHelp(); openPalette(); });
  helpDialog.addEventListener('pointerdown', event => { if (event.target === helpDialog) closeHelp(); });
  return helpDialog;
}

export function openHelp() {
  rememberLayerFocus();
  ensureHelp();
  closePalette();
  helpDialog.classList.remove('hidden');
  helpDialog.setAttribute('aria-hidden', 'false');
  document.body.classList.add('command-layer-open');
  helpDialog.querySelector('header button')?.focus();
}

export function closeHelp() {
  if (!helpDialog) return;
  helpDialog.classList.add('hidden');
  helpDialog.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('command-layer-open');
  if (!palette || palette.classList.contains('hidden')) restoreLayerFocus();
}

function isCommandLayerOpen() {
  return Boolean(
    (palette && !palette.classList.contains('hidden'))
    || (helpDialog && !helpDialog.classList.contains('hidden'))
  );
}

function isModifierCode(code) {
  return ['ControlLeft', 'ControlRight', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight'].includes(code);
}

function resolveShortcut(event) {
  const key = event.key;
  const lower = key.toLowerCase();
  const ctrl = event.ctrlKey || event.metaKey;
  const alt = event.altKey;
  const shift = event.shiftKey;
  const typing = isTextEntry(event.target);

  // AltGr se reporta como Ctrl + Alt en muchos teclados. No debe ejecutar
  // acciones mientras el usuario intenta escribir símbolos especiales.
  if (event.getModifierState?.('AltGraph')) return null;

  if (ctrl && shift && !alt && lower === 'k') return 'palette';
  if (ctrl && !shift && !alt && lower === 'k') return 'search-global';

  // Cuando la paleta o la ayuda están abiertas, el teclado pertenece a esa
  // capa. Solo Escape (y el propio atajo de paleta) puede salir de ella.
  if (isCommandLayerOpen()) {
    if (!ctrl && !alt && !shift && key === 'Escape') return 'close';
    return null;
  }

  if (alt && !ctrl && !shift && /^[0-6]$/.test(key)) {
    const target = PAGE_LINKS.find(item => item.shortcut === `Alt ${key}`);
    if (target) return `navigate:${target.key}`;
  }
  if (alt && !ctrl && !shift && lower === 'n') return 'create';
  if (alt && !ctrl && !shift && lower === 'e') return 'edit';
  if (ctrl && !alt && !shift && lower === 's') return 'save';
  if (ctrl && !alt && !shift && key === 'Enter') return 'confirm';
  if (ctrl && alt && !shift && lower === 'm') return 'media';
  if (ctrl && alt && !shift && lower === 'd') return 'duplicate';
  if (ctrl && alt && !shift && lower === 'c') return 'copy';
  if (ctrl && alt && !shift && lower === 'v') return 'paste';
  if (!typing && !ctrl && !alt && !shift && key === '/') return 'search-section';
  if (!typing && !ctrl && !alt && !shift && key === '[') return 'previous';
  if (!typing && !ctrl && !alt && !shift && key === ']') return 'next';
  if (!typing && !ctrl && !alt && shift && (key === '?' || key === '/')) return 'shortcuts';
  if (!ctrl && !alt && !shift && key === 'Escape') return 'close';

  return null;
}

function clearPendingShortcut() {
  pendingShortcut = null;
}

function executePendingShortcut() {
  const pending = pendingShortcut;
  clearPendingShortcut();
  if (!pending || performance.now() < shortcutCooldownUntil) return;

  shortcutCooldownUntil = performance.now() + SHORTCUT_COOLDOWN_MS;
  window.requestAnimationFrame(() => {
    if (pending.commandId === 'close') closeTopLayer();
    else executeCommand(pending.commandId);
  });
}

function handleKeydown(event) {
  if (event.repeat) return;
  pressedShortcutCodes.add(event.code || event.key);

  // Los modificadores por sí solos aún no forman una combinación.
  if (isModifierCode(event.code)) return;

  const commandId = resolveShortcut(event);
  if (!commandId) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  pendingShortcut = {
    commandId,
    triggerCode: event.code || event.key,
    chordCodes: new Set(pressedShortcutCodes),
  };
}

function handleKeyup(event) {
  const releasedCode = event.code || event.key;
  pressedShortcutCodes.delete(releasedCode);

  if (!pendingShortcut) return;
  if (!pendingShortcut.chordCodes.has(releasedCode)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  // El comando se ejecuta cuando ya se soltó toda la combinación, no al
  // presionar la primera tecla que coincide. Así Ctrl+Shift+K nunca puede
  // disparar también Ctrl+K.
  const chordFinished = [...pendingShortcut.chordCodes].every(code => !pressedShortcutCodes.has(code));
  if (chordFinished) executePendingShortcut();
}

function resetShortcutState() {
  pressedShortcutCodes.clear();
  clearPendingShortcut();
}

export function initCommandCenter(pageKey = 'logs') {
  activePage = pageKey || 'logs';
  if (initialized) return;
  initialized = true;
  listenersController = new AbortController();
  const { signal } = listenersController;

  document.addEventListener('pointerdown', event => markActionTarget(event.target), { capture: true, signal });
  document.addEventListener('focusin', event => {
    if (isTextEntry(event.target)) lastFocusedField = event.target;
    markActionTarget(event.target);
  }, { signal });
  document.addEventListener('keydown', handleKeydown, { capture: true, signal });
  document.addEventListener('keyup', handleKeyup, { capture: true, signal });
  window.addEventListener('blur', resetShortcutState, { signal });
  window.addEventListener('pagehide', () => {
    resetShortcutState();
    listenersController?.abort();
    listenersController = null;
    initialized = false;
  }, { once: true });
}

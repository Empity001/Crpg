// =========================================================
// admin-panel.js
// =========================================================
// Navegación y carga diferida de Herramientas. El inicio no descarga ni
// consulta Biblioteca, Discord, apariencia, backups o Excel. Cada módulo se
// activa una sola vez cuando el administrador entra en su sección.
// =========================================================

import { confirmAction, showToast } from '../core/utils.js';

const initialized = new Set();
let currentView = 'overview';

function knownView(value) {
  return ['overview', 'content', 'data', 'discord', 'appearance'].includes(value) ? value : 'overview';
}

function setViewUi(view) {
  currentView = knownView(view);
  document.querySelectorAll('[data-tools-view]').forEach((button) => {
    const active = button.dataset.toolsView === currentView;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-tools-panel]').forEach((panel) => {
    const active = panel.dataset.toolsPanel === currentView;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
}

async function initOverview() {
  if (initialized.has('overview')) return;
  initialized.add('overview');
  const { initAdminHealth } = await import('./admin-health.js?v=20260717-1');
  initAdminHealth();
}

async function initContent() {
  if (initialized.has('content')) return;
  initialized.add('content');
  const [{ renderDraftsList }, { initMediaLibraryPanel }] = await Promise.all([
    import('./drafts-list.js'),
    import('./media-library.js'),
  ]);
  void renderDraftsList();
  initMediaLibraryPanel();

  document.getElementById('drafts-clear-all-btn')?.addEventListener('click', async () => {
    if (!(await confirmAction({
      title: 'Eliminar borradores',
      message: 'Eliminar TODOS los borradores guardados en este dispositivo y en Supabase. Esta acción no se puede deshacer.',
      confirmLabel: 'Eliminar borradores',
      danger: true,
    }))) return;

    const { deleteRemoteDraft, listRemoteDrafts } = await import('./drafts-store.js');
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith('culones_draft_')) keys.push(key);
    }
    keys.forEach(key => localStorage.removeItem(key));
    const remoteDrafts = await listRemoteDrafts();
    await Promise.all(remoteDrafts.map(draft => deleteRemoteDraft(draft.logId || 'new')));
    await renderDraftsList();
    showToast('Todos los borradores eliminados');
  });
}

async function runImport(file) {
  if (!file) return;
  const { handleImportFile } = await import('./import.js?v=20260717-1');
  await handleImportFile(file);
}

function initData() {
  if (initialized.has('data')) return;
  initialized.add('data');

  document.querySelectorAll('.btn-export').forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const scope = document.getElementById('export-scope')?.value || button.dataset.export || 'all';
        const { exportData } = await import('./export.js?v=20260717-1');
        await exportData(scope, button.dataset.format);
      } finally {
        button.disabled = false;
      }
    });
  });

  const input = document.getElementById('import-file-input');
  input?.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    void runImport(file);
  });

  const dropZone = document.getElementById('import-drop-zone');
  dropZone?.addEventListener('dragover', event => { event.preventDefault(); dropZone.classList.add('is-drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-drag-over'));
  dropZone?.addEventListener('drop', event => {
    event.preventDefault();
    dropZone.classList.remove('is-drag-over');
    void runImport(event.dataTransfer?.files?.[0]);
  });
}

async function initDiscord() {
  if (initialized.has('discord')) return;
  initialized.add('discord');
  const anchor = document.getElementById('forum-reactions-anchor');
  if (anchor) anchor.innerHTML = '';
  const { initForumTools } = await import('./forum-tools.js?v=20260717-1');
  await initForumTools();
}

async function initAppearancePart(part) {
  const key = `appearance:${part}`;
  if (initialized.has(key)) return;
  initialized.add(key);
  if (part === 'background') {
    const { initBackgroundTool } = await import('./background.js');
    initBackgroundTool();
  } else if (part === 'banners') {
    const { initHeroBannerTool } = await import('./hero-banners.js');
    initHeroBannerTool();
  } else if (part === 'identity') {
    const { initFaviconTool } = await import('./favicon.js');
    initFaviconTool();
  } else if (part === 'colors') {
    const { initThemeTool } = await import('./theme.js');
    initThemeTool();
  }
}

function activateAppearance(part = 'background') {
  const selected = ['background', 'banners', 'identity', 'colors'].includes(part) ? part : 'background';
  document.querySelectorAll('[data-appearance-view]').forEach(button => button.classList.toggle('is-active', button.dataset.appearanceView === selected));
  document.querySelectorAll('[data-appearance-panel]').forEach(panel => {
    const active = panel.dataset.appearancePanel === selected;
    panel.hidden = !active;
    panel.classList.toggle('is-active', active);
  });
  void initAppearancePart(selected);
}

async function ensureView(view) {
  if (view === 'overview') await initOverview();
  else if (view === 'content') await initContent();
  else if (view === 'data') initData();
  else if (view === 'discord') await initDiscord();
  else if (view === 'appearance') activateAppearance(document.querySelector('[data-appearance-view].is-active')?.dataset.appearanceView);
}

function activateView(view, { updateHistory = true } = {}) {
  const selected = knownView(view);
  setViewUi(selected);
  if (updateHistory) {
    const hash = selected === 'overview' ? '#inicio' : `#${selected}`;
    if (window.location.hash !== hash) history.pushState({ toolsView: selected }, '', hash);
  }
  void ensureView(selected);
}

function initImportModal() {
  const close = () => document.getElementById('import-conflict-modal')?.classList.add('hidden');
  document.getElementById('close-import-conflict-modal')?.addEventListener('click', close);
  document.getElementById('import-conflict-cancel-btn')?.addEventListener('click', close);
  document.getElementById('import-conflict-confirm-btn')?.addEventListener('click', async () => {
    const { confirmImport } = await import('./import.js?v=20260717-1');
    await confirmImport();
  });
  document.getElementById('import-conflict-all-overwrite')?.addEventListener('click', async () => {
    const { setAllImportResolutions } = await import('./import.js?v=20260717-1');
    setAllImportResolutions('import');
  });
  document.getElementById('import-conflict-all-skip')?.addEventListener('click', async () => {
    const { setAllImportResolutions } = await import('./import.js?v=20260717-1');
    setAllImportResolutions('skip');
  });
}

export function initAdminPanel() {
  document.querySelectorAll('[data-tools-view]').forEach(button => button.addEventListener('click', () => activateView(button.dataset.toolsView)));
  document.querySelectorAll('[data-tools-jump]').forEach(button => button.addEventListener('click', () => activateView(button.dataset.toolsJump)));
  document.querySelectorAll('[data-appearance-view]').forEach(button => button.addEventListener('click', () => activateAppearance(button.dataset.appearanceView)));
  initImportModal();

  window.addEventListener('popstate', () => {
    const hashView = window.location.hash.replace(/^#/, '');
    activateView(hashView === 'inicio' ? 'overview' : hashView, { updateHistory: false });
  });

  const initialHash = window.location.hash.replace(/^#/, '');
  const initial = initialHash === 'inicio' ? 'overview' : knownView(initialHash);
  setViewUi(initial);
  history.replaceState({ toolsView: initial }, '', initial === 'overview' ? '#inicio' : `#${initial}`);
  void ensureView(initial);
}

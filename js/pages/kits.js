import { initKitsRealtime } from '../app/realtime.js';
import { bootShell } from '../app/shell.js';
import { state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { loadKits, openKitModal, renderKits, submitKit } from '../features/kits.js';

function initKitModals() {
  document.getElementById('open-new-kit-btn')?.addEventListener('click', () => openKitModal(null));
  document.getElementById('close-kit-modal')?.addEventListener('click', () => {
    document.getElementById('kit-modal')?.classList.add('hidden');
  });
  document.getElementById('submit-kit-btn')?.addEventListener('click', submitKit);
}

async function init() {
  await bootShell('kits');
  initKitModals();
  registerAdminUiRefreshHandler(() => { if (state.kitsLoaded) renderKits(); });
  await loadKits();
  initKitsRealtime();
}

document.addEventListener('DOMContentLoaded', init);

import { startPage } from '../app/page-bootstrap.js';
import { initKitsRealtime } from '../app/realtime.js';
import { bootShell } from '../app/shell.js';
import { isAdmin, state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { loadKits, openKitModal, renderKits, submitKit } from '../features/kits.js';


function focusLinkedKit() {
  const params = new URLSearchParams(window.location.search);
  const kitId = params.get('kit');
  if (!kitId) return;
  window.requestAnimationFrame(() => {
    const card = document.querySelector(`.kit-card[data-kit-id="${CSS.escape(kitId)}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const itemName = params.get('item');
    const matchingItem = itemName
      ? [...card.querySelectorAll('.kit-item-name')].find(el => el.textContent.trim().toLocaleLowerCase('es') === itemName.trim().toLocaleLowerCase('es'))
      : null;
    const target = matchingItem?.closest('.kit-item, .kit-slot') || card;
    target.classList.add('global-search-target');
    window.setTimeout(() => target.classList.remove('global-search-target'), 2100);
  });
}

let kitAdminInitialized = false;

function initKitModals() {
  if (kitAdminInitialized || !isAdmin()) return;
  kitAdminInitialized = true;
  document.getElementById('open-new-kit-btn')?.addEventListener('click', () => openKitModal(null));
  document.getElementById('close-kit-modal')?.addEventListener('click', () => {
    document.getElementById('kit-modal')?.classList.add('hidden');
  });
  document.getElementById('submit-kit-btn')?.addEventListener('click', submitKit);
}

async function init() {
  await bootShell('kits');
  initKitModals();
  registerAdminUiRefreshHandler((admin) => {
    if (admin) initKitModals();
    if (state.kitsLoaded) renderKits();
  });
  const kitsLoaded = await loadKits();
  if (kitsLoaded) {
    focusLinkedKit();
    initKitsRealtime();
  }
}

startPage(init);

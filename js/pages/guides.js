// Entry point de guides.html.

import { startPage } from '../app/page-bootstrap.js';
import { initWeaponsRealtime } from '../app/realtime.js';
import { bootShell } from '../app/shell.js';
import { isAdmin, state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { renderWeaponsGrid } from '../features/weapons-catalog.js';
import { debounce } from '../core/utils.js';
import { loadWeaponsCatalog, renderWeaponAdminMetaControls } from '../features/weapons-data.js';
import { closeWeaponDetail, openWeaponDetail, renderWeaponDetail } from '../features/weapons-detail.js';

let weaponAdminPromise = null;

function initWeaponsPublicControls() {
  document.getElementById('weapon-search-input')?.addEventListener('input', debounce((event) => {
    state.weaponSearchTerm = event.target.value.trim();
    renderWeaponsGrid();
  }, 250));
  document.getElementById('weapon-back-btn')?.addEventListener('click', closeWeaponDetail);
}

function ensureWeaponAdminLoaded() {
  if (!isAdmin()) return Promise.resolve(null);
  if (!weaponAdminPromise) {
    weaponAdminPromise = import('../features/weapons-admin.js')
      .then(async module => {
        module.initWeaponModals();
        await renderWeaponAdminMetaControls();
        return module;
      })
      .catch(error => {
        weaponAdminPromise = null;
        console.error('[Guides] No se pudo cargar el editor administrativo:', error);
        return null;
      });
  }
  return weaponAdminPromise;
}

function openLinkedGuideFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const weaponId = params.get('weapon');
  const rankId = params.get('rank');
  const weapon = state.weapons.find(item => item.id === weaponId);
  if (!weapon || (!weapon.published && !isAdmin())) return;
  openWeaponDetail(weaponId);
  if (rankId && state.weaponRanksByWeapon[weaponId]?.some(rank => rank.id === rankId)) {
    state.currentWeaponRankId = rankId;
    renderWeaponDetail();
  }
}

async function init() {
  await bootShell('guides');
  initWeaponsPublicControls();
  registerAdminUiRefreshHandler((admin) => {
    if (admin) void ensureWeaponAdminLoaded();
    if (!state.weaponsLoaded) return;
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  });
  if (isAdmin()) void ensureWeaponAdminLoaded();
  const guidesLoaded = await loadWeaponsCatalog();
  if (guidesLoaded) {
    openLinkedGuideFromUrl();
    initWeaponsRealtime();
  }
}

startPage(init);

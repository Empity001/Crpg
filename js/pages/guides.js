// Entry point de guides.html.

import { startPage } from '../app/page-bootstrap.js';
import { initWeaponsRealtime } from '../app/realtime.js';
import { bootShell } from '../app/shell.js';
import { isAdmin, state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { initWeaponModals } from '../features/weapons-admin.js';
import { renderWeaponsGrid } from '../features/weapons-catalog.js';
import { loadWeaponsCatalog } from '../features/weapons-data.js';
import { openWeaponDetail, renderWeaponDetail } from '../features/weapons-detail.js';

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
  initWeaponModals();
  registerAdminUiRefreshHandler(() => {
    if (!state.weaponsLoaded) return;
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  });
  const guidesLoaded = await loadWeaponsCatalog();
  if (guidesLoaded) {
    openLinkedGuideFromUrl();
    initWeaponsRealtime();
  }
}

startPage(init);

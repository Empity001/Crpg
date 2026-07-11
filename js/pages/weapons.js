// =========================================================
// pages/weapons.js — Entry point de weapons.html (⚔️ Guía de Armas)
// =========================================================
// Carga y cablea EXCLUSIVAMENTE lo que pertenece a la Guía de Armas:
// catálogo, filtros, detalle de arma y todos sus modales admin (arma,
// categorías, tipos, rango, estadísticas, habilidad, receta, sección).
// No importa nada de Logs, Tierlist, About ni Herramientas.
// =========================================================

import { bootShell } from '../app/shell.js';
import { initWeaponsRealtime } from '../app/realtime.js';
import { isAdmin, state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { initWeaponModals } from '../features/weapons-admin.js?v=20260710-13';
import { renderWeaponsGrid } from '../features/weapons-catalog.js?v=20260710-12';
import { loadWeaponsCatalog } from '../features/weapons-data.js?v=20260710-12';
import { openWeaponDetail, renderWeaponDetail } from '../features/weapons-detail.js?v=20260710-12';

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
  await bootShell('weapons');
  initWeaponModals();
  registerAdminUiRefreshHandler(() => {
    if (!state.weaponsLoaded) return;
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  });
  await loadWeaponsCatalog();
  openLinkedGuideFromUrl();
  initWeaponsRealtime();
}

document.addEventListener('DOMContentLoaded', init);

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
import { state } from '../core/state.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { initWeaponModals } from '../features/weapons-admin.js';
import { renderWeaponsGrid } from '../features/weapons-catalog.js';
import { loadWeaponsCatalog } from '../features/weapons-data.js';
import { renderWeaponDetail } from '../features/weapons-detail.js';

async function init() {
  await bootShell('weapons');
  initWeaponModals();
  registerAdminUiRefreshHandler(() => {
    if (!state.weaponsLoaded) return;
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  });
  await loadWeaponsCatalog();
  initWeaponsRealtime();
}

document.addEventListener('DOMContentLoaded', init);

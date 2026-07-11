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
  await bootShell('weapons');
  initWeaponModals();
  registerAdminUiRefreshHandler(() => {
    if (!state.weaponsLoaded) return;
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  });
  const weaponsLoaded = await loadWeaponsCatalog();
  if (weaponsLoaded) {
    openLinkedGuideFromUrl();
    initWeaponsRealtime();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(error => {
    console.error('[Boot] Error al iniciar la página:', error);
    const main = document.querySelector('.app-main') || document.body;
    const existing = document.getElementById('boot-error-panel');
    if (existing) return;
    const panel = document.createElement('section');
    panel.id = 'boot-error-panel';
    panel.className = 'boot-error-panel';
    panel.innerHTML = `
      <strong>No se pudo iniciar esta página</strong>
      <p>Recarga con Ctrl + F5. Si continúa, revisa la consola del navegador o la conexión con Supabase.</p>
      <button type="button">Recargar</button>`;
    panel.querySelector('button')?.addEventListener('click', () => window.location.reload());
    main.prepend(panel);
  });
});

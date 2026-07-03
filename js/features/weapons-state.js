// =========================================================
// weapons-state.js
// =========================================================
// Selectores puros sobre el estado de la Guía de Armas (visibilidad,
// categoría/tipo por id, rangos de un arma, arma actual). Sin efectos
// secundarios ni acceso a red.
// =========================================================

import { isAdmin, state } from '../core/state.js';

export function isWeaponVisible(w) { return isAdmin() || !!w.published; }


export function getWeaponCategory(id) { return state.weaponCategories.find(c => c.id === id) || null; }

export function getWeaponType(id) { return state.weaponTypes.find(t => t.id === id) || null; }


export function getWeaponRanks(weaponId) {
  return (state.weaponRanksByWeapon[weaponId] || []).slice().sort((a, b) => a.sort_order - b.sort_order);
}


export function getCurrentWeapon() { return state.weapons.find(w => w.id === state.currentWeaponId) || null; }

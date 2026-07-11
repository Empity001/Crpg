// =========================================================
// weapons-data.js
// =========================================================
// Carga de datos de la Guías desde Supabase: metadatos
// (categorías/tipos), catálogo completo, y una variante de solo-datos
// para exportación.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { withTimeout } from '../core/utils.js';
import { renderWeaponCategoryFilters, renderWeaponTypeFilters, renderWeaponsGrid } from './weapons-catalog.js';
import { renderWeaponDetail } from './weapons-detail.js';

let weaponMetaPromise = null;
let weaponDataPromise = null;

function attachSignal(request, signal) {
  const stableRequest = disableQueryRetry(request);
  return typeof stableRequest?.abortSignal === 'function' ? stableRequest.abortSignal(signal) : stableRequest;
}

async function renderWeaponAdminMetaControls() {
  const {
    renderWeaponCategoryManageList,
    renderWeaponCategorySelectOptions,
    renderWeaponTypeManageList,
    renderWeaponTypeSelectOptions,
  } = await import('./weapons-catalog-admin.js');

  renderWeaponCategorySelectOptions();
  renderWeaponTypeSelectOptions();
  renderWeaponCategoryManageList();
  renderWeaponTypeManageList();
}

async function performLoadWeaponMeta() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8500);
  try {
    const requests = Promise.all([
      attachSignal(supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true }), controller.signal),
      attachSignal(supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true }), controller.signal),
    ]);
    const [catsRes, typesRes] = await withTimeout(requests, 9000, 'La carga de categorías de Guías');
    if (catsRes.error) {
      console.error('[Weapons] weapon_categories error:', catsRes.error.message);
      const grid = document.getElementById('weapons-grid');
      if (grid) grid.innerHTML = `<div class="logs-empty"><p>⚠️ El catálogo de armas no está configurado aún.<br>Ejecuta <code>migration_008_weapons.sql</code> en Supabase.</p></div>`;
      return false;
    }
    state.weaponCategories = catsRes.data || [];
    state.weaponTypes = !typesRes.error ? (typesRes.data || []) : [];
    renderWeaponCategoryFilters();
    renderWeaponTypeFilters();
    await renderWeaponAdminMetaControls();
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Weapons meta]', error);
    const grid = document.getElementById('weapons-grid');
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>La carga de Guías tardó demasiado. Revisa tu conexión.</p></div>`;
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadWeaponMeta() {
  if (!weaponMetaPromise) weaponMetaPromise = performLoadWeaponMeta().finally(() => { weaponMetaPromise = null; });
  return weaponMetaPromise;
}


async function performReloadWeaponData() {
  const grid = document.getElementById('weapons-grid');
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8500);
  try {
    const requests = Promise.all([
      attachSignal(supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order'), controller.signal),
      attachSignal(supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true }), controller.signal),
    ]);
    const [weaponsRes, ranksRes] = await withTimeout(requests, 9000, 'La carga del catálogo de Guías');
    if (weaponsRes.error || ranksRes.error) {
      console.error(weaponsRes.error || ranksRes.error);
      if (grid) grid.innerHTML = `<div class="logs-empty"><p>No se pudo cargar el catálogo de armas.</p></div>`;
      return false;
    }
    state.weapons = weaponsRes.data || [];
    state.weaponRanksByWeapon = {};
    (ranksRes.data || []).forEach(r => {
      if (!state.weaponRanksByWeapon[r.weapon_id]) state.weaponRanksByWeapon[r.weapon_id] = [];
      state.weaponRanksByWeapon[r.weapon_id].push(r);
    });
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Weapons data]', error);
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>La carga del catálogo tardó demasiado. Revisa tu conexión.</p></div>`;
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function reloadWeaponData() {
  if (!weaponDataPromise) weaponDataPromise = performReloadWeaponData().finally(() => { weaponDataPromise = null; });
  return weaponDataPromise;
}

export async function loadWeaponsCatalog() {
  const metaOk = await loadWeaponMeta();
  if (!metaOk) return false;
  const dataOk = await reloadWeaponData();
  if (!dataOk) return false;
  state.weaponsLoaded = true;
  return true;
}


// Obtiene datos de armas SOLO para exportación — sin tocar el DOM
// ni los renders de la guía. Seguro de llamar desde cualquier contexto.

export async function fetchWeaponsDataForExport() {
  const [catsRes, typesRes, weaponsRes, ranksRes] = await Promise.all([
    disableQueryRetry(supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true })),
    disableQueryRetry(supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true })),
    disableQueryRetry(supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order')),
    disableQueryRetry(supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true })),
  ]);
  const categories = (!catsRes.error && catsRes.data)   || [];
  const types      = (!typesRes.error && typesRes.data)  || [];
  const weapons    = (!weaponsRes.error && weaponsRes.data) || [];
  const ranksByWeapon = {};
  ((!ranksRes.error && ranksRes.data) || []).forEach(r => {
    if (!ranksByWeapon[r.weapon_id]) ranksByWeapon[r.weapon_id] = [];
    ranksByWeapon[r.weapon_id].push(r);
  });
  return { categories, types, weapons, ranksByWeapon };
}

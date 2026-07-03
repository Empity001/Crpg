// =========================================================
// weapons-data.js
// =========================================================
// Carga de datos de la Guía de Armas desde Supabase: metadatos
// (categorías/tipos), catálogo completo, y una variante de solo-datos
// para exportación.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { renderWeaponCategoryFilters, renderWeaponTypeFilters, renderWeaponsGrid } from './weapons-catalog.js';
import { renderWeaponDetail } from './weapons-detail.js';

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

export async function loadWeaponMeta() {
  const [catsRes, typesRes] = await Promise.all([
    supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true }),
  ]);
  if (catsRes.error) {
    console.error('[Weapons] weapon_categories error:', catsRes.error.message);
    // Las tablas aún no existen en Supabase — mostrar mensaje claro
    const grid = document.getElementById('weapons-grid');
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>⚠️ El catálogo de armas no está configurado aún.<br>Ejecuta <code>migration_008_weapons.sql</code> en Supabase.</p></div>`;
    return false;
  }
  if (!catsRes.error) state.weaponCategories = catsRes.data || [];
  if (!typesRes.error) state.weaponTypes = typesRes.data || [];
  renderWeaponCategoryFilters();
  renderWeaponTypeFilters();
  await renderWeaponAdminMetaControls();
  return true;
}


export async function reloadWeaponData() {
  const grid = document.getElementById('weapons-grid');
  const [weaponsRes, ranksRes] = await Promise.all([
    supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true }),
  ]);
  if (weaponsRes.error || ranksRes.error) {
    console.error(weaponsRes.error || ranksRes.error);
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>No se pudo cargar el catálogo de armas.</p></div>`;
    return;
  }
  state.weapons = weaponsRes.data;
  state.weaponRanksByWeapon = {};
  (ranksRes.data || []).forEach(r => {
    if (!state.weaponRanksByWeapon[r.weapon_id]) state.weaponRanksByWeapon[r.weapon_id] = [];
    state.weaponRanksByWeapon[r.weapon_id].push(r);
  });
  renderWeaponsGrid();
  if (state.currentWeaponId) renderWeaponDetail();
}


export async function loadWeaponsCatalog() {
  const ok = await loadWeaponMeta();
  if (ok === false) return; // tablas no existen aún
  await reloadWeaponData();
  state.weaponsLoaded = true;
}

// Obtiene datos de armas SOLO para exportación — sin tocar el DOM
// ni los renders de la guía. Seguro de llamar desde cualquier contexto.

export async function fetchWeaponsDataForExport() {
  const [catsRes, typesRes, weaponsRes, ranksRes] = await Promise.all([
    supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true }),
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

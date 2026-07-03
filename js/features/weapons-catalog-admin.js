// =========================================================
// weapons-catalog-admin.js
// =========================================================
// Gestión admin de categorías y tipos de arma: selects, listas de
// gestión y CRUD.
// =========================================================

import { supabaseClient } from '../config.js';
import { state, suppressNextWeaponsReload } from '../core/state.js';
import { confirmAction, escapeHtml, showToast } from '../core/utils.js';
import { renderWeaponsGrid } from './weapons-catalog.js';
import { loadWeaponMeta } from './weapons-data.js';
import { getWeaponCategory, getWeaponType } from './weapons-state.js';

export function renderWeaponCategorySelectOptions() {
  const select = document.getElementById('weapon-category-input');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">— Sin categoría —</option>` +
    state.weaponCategories.map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
  if (current) select.value = current;
}


export function renderWeaponCategoryManageList() {
  const container = document.getElementById('weapon-category-manage-list');
  if (!container) return;
  if (state.weaponCategories.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`; return; }
  container.innerHTML = state.weaponCategories.map(c => `
    <div class="category-manage-row">
      <span class="category-manage-label"><span class="weapon-cat-dot" style="background:${c.color};display:inline-block;margin-right:6px;"></span>${escapeHtml(c.label)}</span>
      <button type="button" class="category-manage-delete" data-id="${c.id}">🗑 Borrar</button>
    </div>`).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponCategory(btn.dataset.id)));
}


export function openWeaponCategoryModal() {
  document.getElementById('weapon-category-label-input').value = '';
  document.getElementById('weapon-category-color-input').value = '#4dd4e8';
  document.getElementById('weapon-category-modal-error').classList.add('hidden');
  renderWeaponCategoryManageList();
  document.getElementById('weapon-category-modal').classList.remove('hidden');
}


export async function submitWeaponCategory() {
  const errorBox = document.getElementById('weapon-category-modal-error');
  const label = document.getElementById('weapon-category-label-input').value.trim();
  const color = document.getElementById('weapon-category-color-input').value || '#4dd4e8';
  if (!label) { errorBox.textContent = 'Ponle un nombre a la categoría.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_weapon_category', { input_code: state.adminCode, input_label: label, input_color: color });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('weapon-category-label-input').value = '';
  showToast(`Categoría "${data.label}" creada`, 'success');
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  document.getElementById('weapon-category-input').value = data.id;
}


async function deleteWeaponCategory(id) {
  const cat = getWeaponCategory(id);
  if (!(await confirmAction({
    title: 'Borrar categoría',
    message: `Borrar la categoría "${cat ? cat.label : ''}". Solo funcionará si ningún arma la está usando.`,
    confirmLabel: 'Borrar categoría',
    danger: true,
  }))) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_weapon_category', { input_code: state.adminCode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast('Categoría eliminada', 'success');
  if (state.weaponActiveCategoryFilter === id) state.weaponActiveCategoryFilter = 'all';
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  renderWeaponsGrid();
}

// ---------------------------------------------------------
// ADMIN — tipos de arma
// ---------------------------------------------------------

export function renderWeaponTypeSelectOptions() {
  const select = document.getElementById('weapon-type-input');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">— Sin tipo —</option>` +
    state.weaponTypes.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  if (current) select.value = current;
}


export function renderWeaponTypeManageList() {
  const container = document.getElementById('weapon-type-manage-list');
  if (!container) return;
  if (state.weaponTypes.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay tipos todavía.</p>`; return; }
  container.innerHTML = state.weaponTypes.map(t => `
    <div class="category-manage-row">
      <span class="category-manage-label">${escapeHtml(t.label)}</span>
      <button type="button" class="category-manage-delete" data-id="${t.id}">🗑 Borrar</button>
    </div>`).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponType(btn.dataset.id)));
}


export function openWeaponTypeModal() {
  document.getElementById('weapon-type-label-input').value = '';
  document.getElementById('weapon-type-modal-error').classList.add('hidden');
  renderWeaponTypeManageList();
  document.getElementById('weapon-type-modal').classList.remove('hidden');
}


export async function submitWeaponType() {
  const errorBox = document.getElementById('weapon-type-modal-error');
  const label = document.getElementById('weapon-type-label-input').value.trim();
  if (!label) { errorBox.textContent = 'Ponle un nombre al tipo.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_weapon_type', { input_code: state.adminCode, input_label: label });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('weapon-type-label-input').value = '';
  showToast(`Tipo "${data.label}" creado`, 'success');
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  document.getElementById('weapon-type-input').value = data.id;
}


async function deleteWeaponType(id) {
  const t = getWeaponType(id);
  if (!(await confirmAction({
    title: 'Borrar tipo',
    message: `Borrar el tipo "${t ? t.label : ''}". Solo funcionará si ningún arma lo está usando.`,
    confirmLabel: 'Borrar tipo',
    danger: true,
  }))) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_weapon_type', { input_code: state.adminCode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast('Tipo eliminado', 'success');
  if (state.weaponActiveTypeFilter === id) state.weaponActiveTypeFilter = 'all';
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  renderWeaponsGrid();
}

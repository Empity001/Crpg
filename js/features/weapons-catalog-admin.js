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

let editingWeaponCategoryId = null;
let editingWeaponTypeId = null;

function setButtonBusy(button, busy, idleLabel) {
  if (!button) return;
  button.disabled = busy;
  button.textContent = busy ? 'Guardando…' : idleLabel;
}

function resetWeaponCategoryEditor() {
  editingWeaponCategoryId = null;
  const labelInput = document.getElementById('weapon-category-label-input');
  const colorInput = document.getElementById('weapon-category-color-input');
  const errorBox = document.getElementById('weapon-category-modal-error');
  const submitButton = document.getElementById('submit-weapon-category-btn');
  const cancelButton = document.getElementById('cancel-weapon-category-edit-btn');
  if (labelInput) labelInput.value = '';
  if (colorInput) colorInput.value = '#4dd4e8';
  errorBox?.classList.add('hidden');
  if (errorBox) errorBox.textContent = '';
  if (submitButton) submitButton.textContent = 'Crear categoría';
  cancelButton?.classList.add('hidden');
}

function resetWeaponTypeEditor() {
  editingWeaponTypeId = null;
  const labelInput = document.getElementById('weapon-type-label-input');
  const errorBox = document.getElementById('weapon-type-modal-error');
  const submitButton = document.getElementById('submit-weapon-type-btn');
  const cancelButton = document.getElementById('cancel-weapon-type-edit-btn');
  if (labelInput) labelInput.value = '';
  errorBox?.classList.add('hidden');
  if (errorBox) errorBox.textContent = '';
  if (submitButton) submitButton.textContent = 'Crear tipo';
  cancelButton?.classList.add('hidden');
}

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
  if (state.weaponCategories.length === 0) {
    container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`;
    return;
  }

  container.innerHTML = state.weaponCategories.map(c => `
    <div class="category-manage-row${editingWeaponCategoryId === c.id ? ' is-editing' : ''}">
      <span class="category-manage-label">
        <span class="weapon-cat-dot" style="background:${c.color};display:inline-block;margin-right:6px;"></span>
        ${escapeHtml(c.label)}
      </span>
      <span class="category-manage-actions">
        <button type="button" class="category-manage-edit" data-id="${c.id}">✎ Editar</button>
        <button type="button" class="category-manage-delete" data-id="${c.id}">🗑 Borrar</button>
      </span>
    </div>`).join('');

  container.querySelectorAll('.category-manage-edit').forEach(btn =>
    btn.addEventListener('click', () => beginWeaponCategoryEdit(btn.dataset.id)));
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponCategory(btn.dataset.id)));
}

function beginWeaponCategoryEdit(id) {
  const category = getWeaponCategory(id);
  if (!category) return;
  editingWeaponCategoryId = id;
  const labelInput = document.getElementById('weapon-category-label-input');
  const colorInput = document.getElementById('weapon-category-color-input');
  const submitButton = document.getElementById('submit-weapon-category-btn');
  const cancelButton = document.getElementById('cancel-weapon-category-edit-btn');
  if (labelInput) labelInput.value = category.label || '';
  if (colorInput) colorInput.value = category.color || '#4dd4e8';
  if (submitButton) submitButton.textContent = 'Guardar cambios';
  cancelButton?.classList.remove('hidden');
  document.getElementById('weapon-category-modal-error')?.classList.add('hidden');
  renderWeaponCategoryManageList();
  labelInput?.focus();
  labelInput?.select();
}

export function openWeaponCategoryModal() {
  resetWeaponCategoryEditor();
  renderWeaponCategoryManageList();
  const cancelButton = document.getElementById('cancel-weapon-category-edit-btn');
  if (cancelButton) cancelButton.onclick = () => {
    resetWeaponCategoryEditor();
    renderWeaponCategoryManageList();
  };
  document.getElementById('weapon-category-modal')?.classList.remove('hidden');
}

export async function submitWeaponCategory() {
  const errorBox = document.getElementById('weapon-category-modal-error');
  const label = document.getElementById('weapon-category-label-input')?.value.trim() || '';
  const color = document.getElementById('weapon-category-color-input')?.value || '#4dd4e8';
  const submitButton = document.getElementById('submit-weapon-category-btn');
  const wasEditing = Boolean(editingWeaponCategoryId);
  const idleLabel = wasEditing ? 'Guardar cambios' : 'Crear categoría';

  if (!label) {
    if (errorBox) {
      errorBox.textContent = 'Ponle un nombre a la categoría.';
      errorBox.classList.remove('hidden');
    }
    return;
  }
  if (!state.adminMode) {
    if (errorBox) {
      errorBox.textContent = 'Tu sesión de administrador expiró.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  setButtonBusy(submitButton, true, idleLabel);
  const rpcName = wasEditing ? 'update_weapon_category' : 'create_weapon_category';
  const rpcArgs = wasEditing
    ? { input_code: state.adminMode, input_id: editingWeaponCategoryId, input_label: label, input_color: color }
    : { input_code: state.adminMode, input_label: label, input_color: color };

  try {
    suppressNextWeaponsReload();
    const { data, error } = await supabaseClient.rpc(rpcName, rpcArgs);
    if (error) throw error;
    errorBox?.classList.add('hidden');
    showToast(wasEditing ? `Categoría "${data.label}" actualizada` : `Categoría "${data.label}" creada`, 'success');
    suppressNextWeaponsReload();
    await loadWeaponMeta();
    if (!wasEditing) {
      const select = document.getElementById('weapon-category-input');
      if (select) select.value = data.id;
    }
    resetWeaponCategoryEditor();
    renderWeaponCategoryManageList();
    renderWeaponsGrid();
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = 'Error: ' + (error?.message || 'No se pudo guardar la categoría.');
      errorBox.classList.remove('hidden');
    }
  } finally {
    setButtonBusy(submitButton, false, editingWeaponCategoryId ? 'Guardar cambios' : 'Crear categoría');
  }
}

async function deleteWeaponCategory(id) {
  const cat = getWeaponCategory(id);
  if (!(await confirmAction({
    title: 'Borrar categoría',
    message: `Borrar la categoría "${cat ? cat.label : ''}". Solo funcionará si ningún arma la está usando.`,
    confirmLabel: 'Borrar categoría',
    danger: true,
  }))) return;
  if (!state.adminMode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  suppressNextWeaponsReload();
  const { error } = await supabaseClient.rpc('delete_weapon_category', { input_code: state.adminMode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  if (editingWeaponCategoryId === id) resetWeaponCategoryEditor();
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
  if (state.weaponTypes.length === 0) {
    container.innerHTML = `<p class="category-manage-empty">No hay tipos todavía.</p>`;
    return;
  }

  container.innerHTML = state.weaponTypes.map(t => `
    <div class="category-manage-row${editingWeaponTypeId === t.id ? ' is-editing' : ''}">
      <span class="category-manage-label">${escapeHtml(t.label)}</span>
      <span class="category-manage-actions">
        <button type="button" class="category-manage-edit" data-id="${t.id}">✎ Editar</button>
        <button type="button" class="category-manage-delete" data-id="${t.id}">🗑 Borrar</button>
      </span>
    </div>`).join('');

  container.querySelectorAll('.category-manage-edit').forEach(btn =>
    btn.addEventListener('click', () => beginWeaponTypeEdit(btn.dataset.id)));
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponType(btn.dataset.id)));
}

function beginWeaponTypeEdit(id) {
  const type = getWeaponType(id);
  if (!type) return;
  editingWeaponTypeId = id;
  const labelInput = document.getElementById('weapon-type-label-input');
  const submitButton = document.getElementById('submit-weapon-type-btn');
  const cancelButton = document.getElementById('cancel-weapon-type-edit-btn');
  if (labelInput) labelInput.value = type.label || '';
  if (submitButton) submitButton.textContent = 'Guardar cambios';
  cancelButton?.classList.remove('hidden');
  document.getElementById('weapon-type-modal-error')?.classList.add('hidden');
  renderWeaponTypeManageList();
  labelInput?.focus();
  labelInput?.select();
}

export function openWeaponTypeModal() {
  resetWeaponTypeEditor();
  renderWeaponTypeManageList();
  const cancelButton = document.getElementById('cancel-weapon-type-edit-btn');
  if (cancelButton) cancelButton.onclick = () => {
    resetWeaponTypeEditor();
    renderWeaponTypeManageList();
  };
  document.getElementById('weapon-type-modal')?.classList.remove('hidden');
}

export async function submitWeaponType() {
  const errorBox = document.getElementById('weapon-type-modal-error');
  const label = document.getElementById('weapon-type-label-input')?.value.trim() || '';
  const submitButton = document.getElementById('submit-weapon-type-btn');
  const wasEditing = Boolean(editingWeaponTypeId);
  const idleLabel = wasEditing ? 'Guardar cambios' : 'Crear tipo';

  if (!label) {
    if (errorBox) {
      errorBox.textContent = 'Ponle un nombre al tipo.';
      errorBox.classList.remove('hidden');
    }
    return;
  }
  if (!state.adminMode) {
    if (errorBox) {
      errorBox.textContent = 'Tu sesión de administrador expiró.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  setButtonBusy(submitButton, true, idleLabel);
  const rpcName = wasEditing ? 'update_weapon_type' : 'create_weapon_type';
  const rpcArgs = wasEditing
    ? { input_code: state.adminMode, input_id: editingWeaponTypeId, input_label: label }
    : { input_code: state.adminMode, input_label: label };

  try {
    suppressNextWeaponsReload();
    const { data, error } = await supabaseClient.rpc(rpcName, rpcArgs);
    if (error) throw error;
    errorBox?.classList.add('hidden');
    showToast(wasEditing ? `Tipo "${data.label}" actualizado` : `Tipo "${data.label}" creado`, 'success');
    suppressNextWeaponsReload();
    await loadWeaponMeta();
    if (!wasEditing) {
      const select = document.getElementById('weapon-type-input');
      if (select) select.value = data.id;
    }
    resetWeaponTypeEditor();
    renderWeaponTypeManageList();
    renderWeaponsGrid();
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = 'Error: ' + (error?.message || 'No se pudo guardar el tipo.');
      errorBox.classList.remove('hidden');
    }
  } finally {
    setButtonBusy(submitButton, false, editingWeaponTypeId ? 'Guardar cambios' : 'Crear tipo');
  }
}

async function deleteWeaponType(id) {
  const t = getWeaponType(id);
  if (!(await confirmAction({
    title: 'Borrar tipo',
    message: `Borrar el tipo "${t ? t.label : ''}". Solo funcionará si ningún arma lo está usando.`,
    confirmLabel: 'Borrar tipo',
    danger: true,
  }))) return;
  if (!state.adminMode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  suppressNextWeaponsReload();
  const { error } = await supabaseClient.rpc('delete_weapon_type', { input_code: state.adminMode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  if (editingWeaponTypeId === id) resetWeaponTypeEditor();
  showToast('Tipo eliminado', 'success');
  if (state.weaponActiveTypeFilter === id) state.weaponActiveTypeFilter = 'all';
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  renderWeaponsGrid();
}

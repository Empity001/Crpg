// =========================================================
// weapons-admin.js
// =========================================================
// CRUD admin completo de armas y de todo lo que cuelga de un rango (info
// básica, estadísticas, habilidades, receta, secciones), más el cableado
// de todos los modales de la Guía de Armas.
// =========================================================

import { supabaseClient } from '../config.js';
import { renderExtraFieldsEditor } from './blocks-editor.js';
import { state, suppressNextWeaponsReload } from '../core/state.js';
import { initImageUploader, updateAssetPreview, uploadImageToStorage } from '../core/storage.js';
import { asArray, confirmAction, debounce, escapeHtml, showToast } from '../core/utils.js';
import { attachMediaPickerButton, openMediaPicker } from './media-library.js';
import { renderWeaponsGrid } from './weapons-catalog.js';
import { openWeaponCategoryModal, openWeaponTypeModal, renderWeaponCategorySelectOptions, renderWeaponTypeSelectOptions, submitWeaponCategory, submitWeaponType } from './weapons-catalog-admin.js';
import { reloadWeaponData } from './weapons-data.js';
import { closeWeaponDetail, openWeaponDetail, renderWeaponDetail, saveRankPatch } from './weapons-detail.js';
import { getWeaponRanks } from './weapons-state.js';

export function openWeaponModal(weaponId = null) {
  state.editingWeaponId = weaponId;
  const titleEl = document.getElementById('weapon-modal-title');
  const initialRankRow = document.getElementById('weapon-initial-rank-row');
  renderWeaponCategorySelectOptions();
  renderWeaponTypeSelectOptions();
  if (weaponId) {
    const w = state.weapons.find(x => x.id === weaponId);
    if (!w) return;
    titleEl.textContent = '✏️ EDITAR ARMA';
    document.getElementById('weapon-name-input').value = w.name;
    document.getElementById('weapon-image-input').value = w.image_url || '';
    updateAssetPreview('weapon', w.image_url || '');
    document.getElementById('weapon-category-input').value = w.category_id || '';
    document.getElementById('weapon-type-input').value = w.type_id || '';
    initialRankRow.classList.add('hidden');
  } else {
    titleEl.textContent = '⚔️ NUEVA ARMA';
    document.getElementById('weapon-name-input').value = '';
    document.getElementById('weapon-image-input').value = '';
    updateAssetPreview('weapon', '');
    document.getElementById('weapon-category-input').value = state.weaponCategories[0] ? state.weaponCategories[0].id : '';
    document.getElementById('weapon-type-input').value = state.weaponTypes[0] ? state.weaponTypes[0].id : '';
    document.getElementById('weapon-initial-rank-input').value = 'MK1';
    initialRankRow.classList.remove('hidden');
  }
  document.getElementById('weapon-modal-error').classList.add('hidden');
  document.getElementById('weapon-modal').classList.remove('hidden');
}

function finishRankPatch(message, modalId = null) {
  if (modalId) document.getElementById(modalId)?.classList.add('hidden');
  showToast(message, 'success');
  suppressNextWeaponsReload();
  renderWeaponDetail();
}


async function submitWeapon() {
  const errorBox = document.getElementById('weapon-modal-error');
  const name = document.getElementById('weapon-name-input').value.trim();
  const imageUrl = document.getElementById('weapon-image-input').value.trim();
  const categoryId = document.getElementById('weapon-category-input').value || null;
  const typeId = document.getElementById('weapon-type-input').value || null;
  if (!name) { errorBox.textContent = 'Ponle un nombre al arma.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  let result;
  if (state.editingWeaponId) {
    result = await supabaseClient.rpc('update_weapon', {
      input_code: state.adminCode, input_id: state.editingWeaponId, input_name: name,
      input_image_url: imageUrl, input_category_id: categoryId, input_type_id: typeId,
    });
  } else {
    const initialRank = document.getElementById('weapon-initial-rank-input').value.trim() || 'MK1';
    result = await supabaseClient.rpc('create_weapon', {
      input_code: state.adminCode, input_name: name, input_image_url: imageUrl,
      input_category_id: categoryId, input_type_id: typeId, input_initial_rank_name: initialRank,
    });
  }
  if (result.error) { errorBox.textContent = 'Error: ' + result.error.message; errorBox.classList.remove('hidden'); return; }

  document.getElementById('weapon-modal').classList.add('hidden');
  showToast(state.editingWeaponId ? 'Arma actualizada' : 'Arma creada (oculta hasta publicarla)', 'success');
  const wasCreating = !state.editingWeaponId;
  const newId = result.data ? result.data.id : null;
  suppressNextWeaponsReload();
  await reloadWeaponData();
  if (wasCreating && newId) openWeaponDetail(newId);
}


export async function toggleWeaponPublished(weaponId) {
  const w = state.weapons.find(x => x.id === weaponId);
  if (!w) return;
  const { error } = await supabaseClient.rpc('set_weapon_published', { input_code: state.adminCode, input_id: weaponId, input_published: !w.published });
  if (error) { showToast('No se pudo actualizar: ' + error.message, 'error'); return; }
  showToast(!w.published ? 'Arma publicada' : 'Arma despublicada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}


export async function deleteWeaponAction(weaponId) {
  if (!(await confirmAction({
    title: 'Borrar arma',
    message: 'Borrar esta arma. Se perderán todos sus rangos, estadísticas y habilidades.',
    confirmLabel: 'Borrar arma',
    danger: true,
  }))) return;
  const { error } = await supabaseClient.rpc('delete_weapon', { input_code: state.adminCode, input_id: weaponId });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  showToast('Arma eliminada', 'success');
  closeWeaponDetail();
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — rangos (info básica)
// ---------------------------------------------------------

export function openWeaponRankModal(rankId) {
  state.editingWeaponRankId = rankId;
  const titleEl = document.getElementById('weapon-rank-modal-title');
  if (rankId) {
    const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
    if (!rank) return;
    titleEl.textContent = '✏️ EDITAR RANGO';
    document.getElementById('weapon-rank-name-input').value = rank.name;
    document.getElementById('weapon-rank-desc-input').value = rank.description || '';
    document.getElementById('weapon-rank-image-input').value = rank.image_url || '';
    updateAssetPreview('weapon-rank', rank.image_url || '');
  } else {
    titleEl.textContent = '📈 NUEVO RANGO';
    document.getElementById('weapon-rank-name-input').value = '';
    document.getElementById('weapon-rank-desc-input').value = '';
    document.getElementById('weapon-rank-image-input').value = '';
    updateAssetPreview('weapon-rank', '');
  }
  document.getElementById('weapon-rank-modal-error').classList.add('hidden');
  document.getElementById('weapon-rank-modal').classList.remove('hidden');
}


async function submitWeaponRank() {
  const errorBox = document.getElementById('weapon-rank-modal-error');
  const name = document.getElementById('weapon-rank-name-input').value.trim();
  const description = document.getElementById('weapon-rank-desc-input').value.trim();
  const imageUrl = document.getElementById('weapon-rank-image-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre al rango.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const result = state.editingWeaponRankId
    ? await saveRankPatch(state.editingWeaponRankId, {
        input_name: name,
        input_description: description,
        input_image_url: imageUrl,
      })
    : await supabaseClient.rpc('upsert_weapon_rank', {
        input_code: state.adminCode,
        input_id: null,
        input_weapon_id: state.currentWeaponId,
        input_name: name,
        input_description: description,
        input_image_url: imageUrl,
        input_stats: [],
        input_abilities: [],
        input_extra_sections: [],
        input_upgrade_recipe: null,
      });
  const { error } = result;
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-rank-modal').classList.add('hidden');
  showToast(state.editingWeaponRankId ? 'Rango actualizado' : 'Rango creado', 'success');
  suppressNextWeaponsReload();
  if (state.editingWeaponRankId) renderWeaponDetail();
  else await reloadWeaponData();
}


export async function deleteWeaponRank(rankId) {
  const ranks = getWeaponRanks(state.currentWeaponId);
  const msg = ranks.length <= 1
    ? 'Este es el último rango del arma. ¿Borrarlo igual? El arma quedará sin rangos hasta que agregues otro.'
    : '¿Borrar este rango? Se perderán sus estadísticas, habilidades y receta.';
  if (!(await confirmAction({
    title: 'Borrar rango',
    message: msg,
    confirmLabel: 'Borrar rango',
    danger: true,
  }))) return;
  const { error } = await supabaseClient.rpc('delete_weapon_rank', { input_code: state.adminCode, input_id: rankId });
  if (error) { showToast('No se pudo borrar el rango', 'error'); return; }
  showToast('Rango eliminado', 'success');
  if (state.currentWeaponRankId === rankId) state.currentWeaponRankId = null;
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — estadísticas del rango
// ---------------------------------------------------------

export function openWeaponStatsModal(rankId) {
  state.editingWeaponRankId = rankId;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  state.weaponStatsDraft = JSON.parse(JSON.stringify(asArray(rank.stats)));
  renderExtraFieldsEditor('weapon-stats-list', () => state.weaponStatsDraft);
  document.getElementById('weapon-stats-modal-error').classList.add('hidden');
  document.getElementById('weapon-stats-modal').classList.remove('hidden');
}


async function submitWeaponStats() {
  const errorBox = document.getElementById('weapon-stats-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const cleanStats = state.weaponStatsDraft.filter(s => s.key && s.key.trim()).map(s => ({ key: s.key.trim(), value: s.value }));
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_stats: cleanStats });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-stats-modal').classList.add('hidden');
  finishRankPatch('Estadísticas guardadas');
}

// ---------------------------------------------------------
// ADMIN — habilidades
// ---------------------------------------------------------

export function openWeaponAbilityModal(rankId, abilityIdx) {
  state.editingWeaponRankId = rankId;
  state.editingAbilityIndex = abilityIdx;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const abilities = asArray(rank.abilities);
  const titleEl = document.getElementById('weapon-ability-modal-title');
  if (abilityIdx != null) {
    const ab = abilities[abilityIdx] || {};
    titleEl.textContent = '✏️ EDITAR HABILIDAD';
    document.getElementById('weapon-ability-name-input').value = ab.name || '';
    document.getElementById('weapon-ability-tag-input').value = ab.tag || '';
    document.getElementById('weapon-ability-desc-input').value = ab.description || '';
    document.getElementById('weapon-ability-level-input').value = ab.level ?? 1;
    document.getElementById('weapon-ability-level-max-input').value = ab.level_max ?? 10;
    state.weaponAbilityStatsDraft = JSON.parse(JSON.stringify(asArray(ab.stats)));
  } else {
    titleEl.textContent = '✨ NUEVA HABILIDAD';
    document.getElementById('weapon-ability-name-input').value = '';
    document.getElementById('weapon-ability-tag-input').value = '';
    document.getElementById('weapon-ability-desc-input').value = '';
    document.getElementById('weapon-ability-level-input').value = 1;
    document.getElementById('weapon-ability-level-max-input').value = 10;
    state.weaponAbilityStatsDraft = [];
  }
  renderExtraFieldsEditor('weapon-ability-stats-list', () => state.weaponAbilityStatsDraft);
  document.getElementById('weapon-ability-modal-error').classList.add('hidden');
  document.getElementById('weapon-ability-modal').classList.remove('hidden');
}


async function submitWeaponAbility() {
  const errorBox = document.getElementById('weapon-ability-modal-error');
  const name = document.getElementById('weapon-ability-name-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre a la habilidad.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
  if (!rank) return;

  const newAbility = {
    name,
    tag: document.getElementById('weapon-ability-tag-input').value.trim(),
    description: document.getElementById('weapon-ability-desc-input').value.trim(),
    level: Number(document.getElementById('weapon-ability-level-input').value) || 0,
    level_max: Number(document.getElementById('weapon-ability-level-max-input').value) || 1,
    stats: state.weaponAbilityStatsDraft.filter(s => s.key && s.key.trim()).map(s => ({ key: s.key.trim(), value: s.value })),
  };

  const abilities = JSON.parse(JSON.stringify(asArray(rank.abilities)));
  if (state.editingAbilityIndex != null) abilities[state.editingAbilityIndex] = newAbility;
  else abilities.push(newAbility);

  const { error } = await saveRankPatch(rank.id, { input_abilities: abilities });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-ability-modal').classList.add('hidden');
  finishRankPatch('Habilidad guardada');
}


export async function deleteAbility(rankId, idx) {
  if (!(await confirmAction({
    title: 'Borrar habilidad',
    message: 'Borrar esta habilidad del rango.',
    confirmLabel: 'Borrar habilidad',
    danger: true,
  }))) return;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const abilities = JSON.parse(JSON.stringify(asArray(rank.abilities)));
  abilities.splice(idx, 1);
  const { error } = await saveRankPatch(rankId, { input_abilities: abilities });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  finishRankPatch('Habilidad eliminada');
}

// ---------------------------------------------------------
// ADMIN — receta de mejora (estilo "trade")
// ---------------------------------------------------------

function renderRecipeMaterialsEditor() {
  const container = document.getElementById('weapon-recipe-materials-list');
  const list = state.weaponRecipeMaterialsDraft;
  if (list.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin materiales. Usa "+ Material" para agregar (cualquier cantidad).</p>`;
    return;
  }
  container.innerHTML = list.map((m, idx) => `
    <div class="weapon-material-row">
      <input type="text" class="modal-input wm-name" data-idx="${idx}" data-f="name" value="${escapeHtml(m.name || '')}" placeholder="Nombre del material" maxlength="60" />
      <button type="button" class="btn-upload-zone btn-upload-zone-sm wm-img-btn" data-idx="${idx}">${m.image_url ? '✅ Imagen' : '📁 Imagen'}</button>
      <button type="button" class="btn-media-picker wm-media-btn" data-idx="${idx}">Biblioteca</button>
      <input type="file" class="hidden wm-img-file" data-idx="${idx}" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng" />
      <input type="number" class="modal-input wm-qty" data-idx="${idx}" data-f="qty" value="${m.qty ?? 1}" min="1" />
      <button type="button" class="enchant-remove" data-idx="${idx}">🗑</button>
    </div>`).join('');
  container.querySelectorAll('input[data-f]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.idx);
      const field = el.dataset.f;
      list[idx][field] = field === 'qty' ? (Number(el.value) || 1) : el.value;
    });
  });
  // Botones de subir imagen de cada material
  container.querySelectorAll('.wm-img-btn').forEach(btn => {
    const idx = Number(btn.dataset.idx);
    const fileInput = container.querySelectorAll('.wm-img-file')[idx];
    if (!fileInput) return;
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      btn.textContent = '…';
      try {
        const oldUrl = list[idx].image_url || '';
        const publicUrl = await uploadImageToStorage(file, 'recipes', oldUrl);
        list[idx].image_url = publicUrl;
        btn.textContent = '✅ Imagen';
        showToast('Imagen del material subida', 'success');
      } catch (err) {
        btn.textContent = list[idx].image_url ? '✅ Imagen' : '📁 Imagen';
        showToast(err.message, 'error');
      }
    });
  });
  container.querySelectorAll('.wm-media-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      openMediaPicker({
        title: 'Seleccionar imagen de material',
        allowedKinds: ['image'],
        currentUrl: list[idx]?.image_url || '',
        onSelect: ({ url }) => {
          list[idx].image_url = url;
          renderRecipeMaterialsEditor();
        },
      });
    });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { list.splice(Number(btn.dataset.idx), 1); renderRecipeMaterialsEditor(); });
  });
}


export function openWeaponRecipeModal(rankId) {
  state.editingWeaponRankId = rankId;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const recipe = rank.upgrade_recipe || { materials: [], result: { name: '', image_url: '' } };
  state.weaponRecipeMaterialsDraft = JSON.parse(JSON.stringify(asArray(recipe.materials)));
  document.getElementById('weapon-recipe-result-name-input').value = recipe.result ? (recipe.result.name || '') : '';
  document.getElementById('weapon-recipe-result-image-input').value = recipe.result ? (recipe.result.image_url || '') : '';
  renderRecipeMaterialsEditor();
  document.getElementById('weapon-recipe-modal-error').classList.add('hidden');
  document.getElementById('weapon-recipe-modal').classList.remove('hidden');
}


async function submitWeaponRecipe() {
  const errorBox = document.getElementById('weapon-recipe-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const resultName = document.getElementById('weapon-recipe-result-name-input').value.trim();
  const resultImage = document.getElementById('weapon-recipe-result-image-input').value.trim();
  const materials = state.weaponRecipeMaterialsDraft.filter(m => m.name && m.name.trim()).map(m => ({ name: m.name.trim(), image_url: m.image_url || '', qty: m.qty || 1 }));
  if (materials.length === 0 && !resultName) { errorBox.textContent = 'Agrega al menos un material o un resultado.'; errorBox.classList.remove('hidden'); return; }
  const recipe = { materials, result: { name: resultName, image_url: resultImage } };
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_upgrade_recipe: recipe });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-recipe-modal').classList.add('hidden');
  finishRankPatch('Receta guardada');
}


async function clearWeaponRecipe() {
  if (!(await confirmAction({
    title: 'Quitar receta',
    message: 'Quitar la receta de mejora de este rango.',
    confirmLabel: 'Quitar receta',
    danger: true,
  }))) return;
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_clear_upgrade_recipe: true });
  if (error) { showToast('No se pudo quitar la receta', 'error'); return; }
  document.getElementById('weapon-recipe-modal').classList.add('hidden');
  finishRankPatch('Receta eliminada');
}

// ---------------------------------------------------------
// ADMIN — secciones extra (libres, para crecer a futuro)
// ---------------------------------------------------------

function toggleWeaponSectionKindUI() {
  const kind = document.getElementById('weapon-section-kind-input').value;
  document.getElementById('weapon-section-text-wrap').classList.toggle('hidden', kind !== 'text');
  document.getElementById('weapon-section-fields-wrap').classList.toggle('hidden', kind !== 'keyvalue');
}


export function openWeaponSectionModal(rankId, sectionIdx) {
  state.editingWeaponRankId = rankId;
  state.editingSectionIndex = sectionIdx;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const sections = asArray(rank.extra_sections);
  const titleEl = document.getElementById('weapon-section-modal-title');
  const kindSelect = document.getElementById('weapon-section-kind-input');
  if (sectionIdx != null) {
    const sec = sections[sectionIdx] || {};
    titleEl.textContent = '✏️ EDITAR SECCIÓN';
    document.getElementById('weapon-section-title-input').value = sec.title || '';
    kindSelect.value = sec.kind || 'text';
    document.getElementById('weapon-section-text-input').value = sec.text || '';
    state.weaponSectionFieldsDraft = JSON.parse(JSON.stringify(asArray(sec.fields)));
  } else {
    titleEl.textContent = '📑 NUEVA SECCIÓN';
    document.getElementById('weapon-section-title-input').value = '';
    kindSelect.value = 'text';
    document.getElementById('weapon-section-text-input').value = '';
    state.weaponSectionFieldsDraft = [];
  }
  toggleWeaponSectionKindUI();
  renderExtraFieldsEditor('weapon-section-fields-list', () => state.weaponSectionFieldsDraft);
  document.getElementById('weapon-section-modal-error').classList.add('hidden');
  document.getElementById('weapon-section-modal').classList.remove('hidden');
}


async function submitWeaponSection() {
  const errorBox = document.getElementById('weapon-section-modal-error');
  const title = document.getElementById('weapon-section-title-input').value.trim();
  if (!title) { errorBox.textContent = 'Ponle un título a la sección.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
  if (!rank) return;
  const kind = document.getElementById('weapon-section-kind-input').value;
  const newSection = {
    title,
    kind,
    text: kind === 'text' ? document.getElementById('weapon-section-text-input').value.trim() : '',
    fields: kind === 'keyvalue' ? state.weaponSectionFieldsDraft.filter(f => f.key && f.key.trim()).map(f => ({ key: f.key.trim(), value: f.value || '' })) : [],
  };
  const sections = JSON.parse(JSON.stringify(asArray(rank.extra_sections)));
  if (state.editingSectionIndex != null) sections[state.editingSectionIndex] = newSection;
  else sections.push(newSection);
  const { error } = await saveRankPatch(rank.id, { input_extra_sections: sections });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-section-modal').classList.add('hidden');
  finishRankPatch('Sección guardada');
}


export async function deleteSection(rankId, idx) {
  if (!(await confirmAction({
    title: 'Borrar sección',
    message: 'Borrar esta sección adicional del rango.',
    confirmLabel: 'Borrar sección',
    danger: true,
  }))) return;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const sections = JSON.parse(JSON.stringify(asArray(rank.extra_sections)));
  sections.splice(idx, 1);
  const { error } = await saveRankPatch(rankId, { input_extra_sections: sections });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  finishRankPatch('Sección eliminada');
}

// ---------------------------------------------------------
// MODALES Y BOTONES — Guía de Armas
// ---------------------------------------------------------

export function initWeaponModals() {
  document.getElementById('weapon-search-input').addEventListener('input', debounce((e) => {
    state.weaponSearchTerm = e.target.value.trim();
    renderWeaponsGrid();
  }, 250));
  document.getElementById('weapon-back-btn').addEventListener('click', closeWeaponDetail);

  document.getElementById('open-new-weapon-btn').addEventListener('click', () => openWeaponModal(null));
  document.getElementById('close-weapon-modal').addEventListener('click', () => document.getElementById('weapon-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-btn').addEventListener('click', submitWeapon);
  document.getElementById('weapon-image-input').addEventListener('change', (e) => updateAssetPreview('weapon', e.target.value.trim()));
  initImageUploader('weapon', 'weapons', () => {
    const w = state.weapons.find(x => x.id === state.editingWeaponId);
    return w ? (w.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'weapon-image-input',
    insertAfterId: 'weapon-image-upload-btn',
    title: 'Seleccionar imagen de arma',
    onSelect: ({ url }) => updateAssetPreview('weapon', url),
  });
  document.getElementById('weapon-image-clear-btn').addEventListener('click', () => {
    document.getElementById('weapon-image-input').value = '';
    updateAssetPreview('weapon', '');
  });

  ['open-weapon-category-manage-btn', 'open-weapon-category-manage-btn-inline'].forEach(id =>
    document.getElementById(id).addEventListener('click', openWeaponCategoryModal));
  document.getElementById('close-weapon-category-modal').addEventListener('click', () => document.getElementById('weapon-category-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-category-btn').addEventListener('click', submitWeaponCategory);

  ['open-weapon-type-manage-btn', 'open-weapon-type-manage-btn-inline'].forEach(id =>
    document.getElementById(id).addEventListener('click', openWeaponTypeModal));
  document.getElementById('close-weapon-type-modal').addEventListener('click', () => document.getElementById('weapon-type-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-type-btn').addEventListener('click', submitWeaponType);

  document.getElementById('close-weapon-rank-modal').addEventListener('click', () => document.getElementById('weapon-rank-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-rank-btn').addEventListener('click', submitWeaponRank);
  document.getElementById('weapon-rank-image-input').addEventListener('change', (e) => updateAssetPreview('weapon-rank', e.target.value.trim()));
  initImageUploader('weapon-rank', 'weapon-ranks', () => {
    const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
    return rank ? (rank.image_url || '') : '';
  });
  attachMediaPickerButton({
    targetInputId: 'weapon-rank-image-input',
    insertAfterId: 'weapon-rank-image-upload-btn',
    title: 'Seleccionar imagen de rango',
    onSelect: ({ url }) => updateAssetPreview('weapon-rank', url),
  });
  document.getElementById('weapon-rank-image-clear-btn').addEventListener('click', () => {
    document.getElementById('weapon-rank-image-input').value = '';
    updateAssetPreview('weapon-rank', '');
  });

  document.getElementById('close-weapon-stats-modal').addEventListener('click', () => document.getElementById('weapon-stats-modal').classList.add('hidden'));
  document.getElementById('weapon-stats-add-btn').addEventListener('click', () => {
    state.weaponStatsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-stats-list', () => state.weaponStatsDraft);
  });
  document.getElementById('submit-weapon-stats-btn').addEventListener('click', submitWeaponStats);

  document.getElementById('close-weapon-ability-modal').addEventListener('click', () => document.getElementById('weapon-ability-modal').classList.add('hidden'));
  document.getElementById('weapon-ability-stats-add-btn').addEventListener('click', () => {
    state.weaponAbilityStatsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-ability-stats-list', () => state.weaponAbilityStatsDraft);
  });
  document.getElementById('submit-weapon-ability-btn').addEventListener('click', submitWeaponAbility);

  document.getElementById('close-weapon-recipe-modal').addEventListener('click', () => document.getElementById('weapon-recipe-modal').classList.add('hidden'));
  document.getElementById('weapon-recipe-add-material-btn').addEventListener('click', () => {
    state.weaponRecipeMaterialsDraft.push({ name: '', image_url: '', qty: 1 });
    renderRecipeMaterialsEditor();
  });
  document.getElementById('submit-weapon-recipe-btn').addEventListener('click', submitWeaponRecipe);
  document.getElementById('clear-weapon-recipe-btn').addEventListener('click', clearWeaponRecipe);

  // Uploader de imagen para el RESULTADO de receta (el único que no tenía file input antes)
  const recipeResultUploadBtn = document.getElementById('weapon-recipe-result-image-upload-btn');
  const recipeResultFileInput = document.getElementById('weapon-recipe-result-image-file');
  const recipeResultHidden    = document.getElementById('weapon-recipe-result-image-input');
  const recipeResultImgName   = document.getElementById('weapon-recipe-result-img-name');
  if (recipeResultUploadBtn && recipeResultFileInput) {
    recipeResultUploadBtn.addEventListener('click', () => recipeResultFileInput.click());
    recipeResultFileInput.addEventListener('change', async () => {
      const file = recipeResultFileInput.files[0];
      if (!file) return;
      recipeResultFileInput.value = '';
      recipeResultUploadBtn.textContent = '…';
      try {
        const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
        const oldUrl = rank?.upgrade_recipe?.result?.image_url || '';
        const publicUrl = await uploadImageToStorage(file, 'recipes', oldUrl);
        recipeResultHidden.value = publicUrl;
        if (recipeResultImgName) { recipeResultImgName.textContent = '✅ Imagen lista'; recipeResultImgName.classList.remove('hidden'); }
        showToast('Imagen del resultado subida', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        recipeResultUploadBtn.textContent = '📁 Imagen del resultado';
      }
    });
  }
  attachMediaPickerButton({
    targetInputId: 'weapon-recipe-result-image-input',
    insertAfterId: 'weapon-recipe-result-image-upload-btn',
    title: 'Seleccionar imagen de resultado',
    onSelect: ({ url }) => {
      recipeResultHidden.value = url;
      if (recipeResultImgName) {
        recipeResultImgName.textContent = '✅ Imagen lista';
        recipeResultImgName.classList.remove('hidden');
      }
    },
  });

  document.getElementById('close-weapon-section-modal').addEventListener('click', () => document.getElementById('weapon-section-modal').classList.add('hidden'));
  document.getElementById('weapon-section-kind-input').addEventListener('change', toggleWeaponSectionKindUI);
  document.getElementById('weapon-section-add-field-btn').addEventListener('click', () => {
    state.weaponSectionFieldsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-section-fields-list', () => state.weaponSectionFieldsDraft);
  });
  document.getElementById('submit-weapon-section-btn').addEventListener('click', submitWeaponSection);
}

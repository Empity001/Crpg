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
import { initImageUploader, updateAssetPreview } from '../core/storage.js';
import { asArray, cloneData, confirmAction, copyEditorPayload, debounce, escapeHtml, getEditorPayload, hasEditorPayload, safeUrl, showToast } from '../core/utils.js';
import { attachMediaPickerButton, openMediaPicker } from './media-library.js';
import { appendActionGrid, appendDisclosure, closeContextPanel, openContextPanel } from '../core/context-actions.js';
import { hydrateGuideLinkSelect, normalizeGuideLink, parseGuideLinkValue } from './guide-links.js';
import { renderWeaponsGrid } from './weapons-catalog.js';
import { openWeaponCategoryModal, openWeaponTypeModal, renderWeaponCategorySelectOptions, renderWeaponTypeSelectOptions, submitWeaponCategory, submitWeaponType } from './weapons-catalog-admin.js';
import { reloadWeaponData } from './weapons-data.js';
import { closeWeaponDetail, openWeaponDetail, renderWeaponDetail, saveRankPatch } from './weapons-detail.js';
import { getInfoVisuals, setInfoVisualsInSections } from './weapons-rank-extras.js';
import { getWeaponRanks } from './weapons-state.js';

let weaponRankInfoVisualsDraft = [];

function editorActionButtons(scope, idx) {
  return `<button type="button" class="editor-mini-btn context-menu-trigger editor-row-context-trigger"
    data-editor-context="true" data-scope="${scope}" data-idx="${idx}"
    aria-label="Abrir acciones" title="Acciones">⋯</button>`;
}

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

function syncRankInfoVisualsDraftFromDom() {
  document.querySelectorAll('.weapon-info-visual-row').forEach((row) => {
    const index = Number(row.dataset.index);
    if (!weaponRankInfoVisualsDraft[index]) return;
    weaponRankInfoVisualsDraft[index].name = row.querySelector('[data-visual-field="name"]')?.value.trim() || '';
    weaponRankInfoVisualsDraft[index].image_url = row.querySelector('[data-visual-field="image_url"]')?.value.trim() || '';
    weaponRankInfoVisualsDraft[index].guide_link = parseGuideLinkValue(row.querySelector('[data-visual-field="guide_link"]')?.value || '');
  });
}

function renderRankInfoVisualsEditor() {
  const container = document.getElementById('weapon-rank-info-visuals-list');
  if (!container) return;
  if (!weaponRankInfoVisualsDraft.length) {
    container.innerHTML = '<p class="equip-empty-hint">Sin recursos visuales. Usa "+ Recurso visual" para agregar.</p>';
    return;
  }
  container.innerHTML = weaponRankInfoVisualsDraft.map((item, index) => `
    <div class="weapon-info-visual-row" data-index="${index}">
      <input type="text" class="modal-input" data-visual-field="name" value="${escapeHtml(item.name || '')}" maxlength="80" placeholder="Nombre visible" />
      <div class="weapon-info-visual-media-row">
        <input type="text" class="modal-input" id="weapon-info-visual-${index}-image" data-visual-field="image_url" value="${escapeHtml(item.image_url || '')}" placeholder="URL de imagen" />
        <button type="button" class="btn-media-picker" data-action="pick-info-visual" data-index="${index}">Biblioteca</button>
        <div class="editor-row-actions">${editorActionButtons('weapon-info-visual', index)}</div>
      </div>
      <select class="modal-select" id="weapon-info-visual-${index}-guide" data-visual-field="guide_link"></select>
    </div>
  `).join('');

  container.querySelectorAll('[data-action="pick-info-visual"]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncRankInfoVisualsDraftFromDom();
      const index = Number(btn.dataset.index);
      openMediaPicker({
        title: 'Seleccionar recurso visual',
        allowedKinds: ['image'],
        currentUrl: weaponRankInfoVisualsDraft[index]?.image_url || '',
        mode: 'picker',
        onSelect: ({ url }) => {
          weaponRankInfoVisualsDraft[index].image_url = url;
          renderRankInfoVisualsEditor();
        },
      });
    });
  });
  container.querySelectorAll('[data-action="remove-info-visual"]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncRankInfoVisualsDraftFromDom();
      weaponRankInfoVisualsDraft.splice(Number(btn.dataset.index), 1);
      renderRankInfoVisualsEditor();
    });
  });
  container.querySelectorAll('[data-editor-context][data-scope="weapon-info-visual"]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncRankInfoVisualsDraftFromDom();
      const index = Number(btn.dataset.idx);
      const item = weaponRankInfoVisualsDraft[index];
      if (!item) return;
      openContextPanel({
        anchor: btn,
        title: 'Acciones del recurso',
        subtitle: item.name || `Recurso ${index + 1}`,
        width: 330,
        build(root, close) {
          appendActionGrid(root, [
            { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('weapon-info-visual', item) },
            { label: 'Pegar', icon: '↧', disabled: !hasEditorPayload('weapon-info-visual'), onClick: () => {
              const payload = getEditorPayload('weapon-info-visual');
              if (!payload) return;
              weaponRankInfoVisualsDraft[index] = {
                name: String(payload?.name || ''),
                image_url: String(payload?.image_url || ''),
                guide_link: normalizeGuideLink(payload?.guide_link),
              };
              close();
              renderRankInfoVisualsEditor();
            } },
            { label: 'Duplicar', icon: '⧉', onClick: () => {
              weaponRankInfoVisualsDraft.splice(index + 1, 0, cloneData(item));
              close();
              renderRankInfoVisualsEditor();
            } },
            { label: 'Eliminar', icon: '🗑', tone: 'danger', onClick: () => {
              weaponRankInfoVisualsDraft.splice(index, 1);
              close();
              renderRankInfoVisualsEditor();
            } },
          ]);
        },
      });
    });
  });
  weaponRankInfoVisualsDraft.forEach((item, index) => {
    hydrateGuideLinkSelect(`weapon-info-visual-${index}-guide`, item.guide_link || null);
  });
}

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
    weaponRankInfoVisualsDraft = getInfoVisuals(rank.extra_sections);
  } else {
    titleEl.textContent = '📈 NUEVO RANGO';
    document.getElementById('weapon-rank-name-input').value = '';
    document.getElementById('weapon-rank-desc-input').value = '';
    document.getElementById('weapon-rank-image-input').value = '';
    updateAssetPreview('weapon-rank', '');
    weaponRankInfoVisualsDraft = [];
  }
  renderRankInfoVisualsEditor();
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

  syncRankInfoVisualsDraftFromDom();

  const result = state.editingWeaponRankId
    ? await saveRankPatch(state.editingWeaponRankId, {
        input_name: name,
        input_description: description,
        input_image_url: imageUrl,
        input_extra_sections: setInfoVisualsInSections(
          getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId)?.extra_sections || [],
          weaponRankInfoVisualsDraft
        ),
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
        input_extra_sections: setInfoVisualsInSections([], weaponRankInfoVisualsDraft),
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

function normalizedWeaponRankPayload(payload = {}) {
  return {
    name: String(payload.name || 'Rango').trim() || 'Rango',
    description: String(payload.description || ''),
    image_url: String(payload.image_url || ''),
    stats: cloneData(asArray(payload.stats)),
    abilities: cloneData(asArray(payload.abilities)),
    extra_sections: cloneData(asArray(payload.extra_sections)),
    upgrade_recipe: cloneData(payload.upgrade_recipe || null),
  };
}

export async function createWeaponRankFromPayload(payload, { addCopySuffix = false } = {}) {
  if (!state.currentWeaponId || !state.adminCode) {
    showToast('La sesión de administrador expiró', 'error');
    return null;
  }
  const rank = normalizedWeaponRankPayload(payload);
  if (addCopySuffix) rank.name = `${rank.name} (copia)`;
  const { data, error } = await supabaseClient.rpc('upsert_weapon_rank', {
    input_code: state.adminCode,
    input_id: null,
    input_weapon_id: state.currentWeaponId,
    input_name: rank.name,
    input_description: rank.description,
    input_image_url: rank.image_url,
    input_stats: rank.stats,
    input_abilities: rank.abilities,
    input_extra_sections: rank.extra_sections,
    input_upgrade_recipe: rank.upgrade_recipe,
  });
  if (error) {
    showToast(`No se pudo crear el rango: ${error.message}`, 'error');
    return null;
  }
  suppressNextWeaponsReload();
  await reloadWeaponData();
  if (data?.id) {
    state.currentWeaponRankId = data.id;
    renderWeaponDetail();
  }
  showToast(addCopySuffix ? 'Rango duplicado' : 'Rango pegado como nuevo', 'success');
  return data || null;
}

export async function duplicateWeaponRank(rankId) {
  const rank = getWeaponRanks(state.currentWeaponId).find(entry => entry.id === rankId);
  if (!rank) {
    showToast('Ese rango ya no existe', 'error');
    return null;
  }
  return createWeaponRankFromPayload(rank, { addCopySuffix: true });
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

export function openWeaponAbilityModal(rankId, abilityIdx, seed = null) {
  state.editingWeaponRankId = rankId;
  state.editingAbilityIndex = abilityIdx;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const abilities = asArray(rank.abilities);
  const titleEl = document.getElementById('weapon-ability-modal-title');
  const source = abilityIdx != null ? (abilities[abilityIdx] || {}) : (seed || null);
  if (source) {
    const ab = source;
    titleEl.textContent = abilityIdx != null ? '✏️ EDITAR HABILIDAD' : '✨ NUEVA HABILIDAD';
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

const EMPTY_RECIPE_SLOT = { name: '', image_url: '', qty: 1, guide_link: null };

function emptyRecipeSlots(count) {
  return Array.from({ length: count }, () => ({ ...EMPTY_RECIPE_SLOT }));
}

function normalizeRecipeSlot(slot = {}) {
  return {
    name: String(slot.name || '').trim(),
    image_url: String(slot.image_url || '').trim(),
    qty: Math.max(1, Number(slot.qty) || 1),
    guide_link: normalizeGuideLink(slot.guide_link),
  };
}

function normalizeRecipeDraftForMode(mode, recipe = {}) {
  if (mode === 'crafting') {
    const source = asArray(recipe.grid);
    return emptyRecipeSlots(9).map((slot, index) => normalizeRecipeSlot(source[index] || slot));
  }
  if (mode === 'furnace' || mode === 'smithing') {
    const source = asArray(recipe.inputs);
    return emptyRecipeSlots(mode === 'smithing' ? 3 : 2).map((slot, index) => normalizeRecipeSlot(source[index] || slot));
  }
  return asArray(recipe.materials).map(normalizeRecipeSlot);
}

function defaultRecipeTitle(mode) {
  return {
    trade: 'Se intercambia',
    crafting: 'Se craftea',
    furnace: 'Se funde',
    smithing: 'Mejorar equipamiento',
  }[mode] || 'Método de fabricación';
}

function normalizeRecipeMethod(method = {}) {
  const mode = method.mode || 'trade';
  const normalized = {
    title: String(method.title || defaultRecipeTitle(mode)).trim(),
    mode,
    result: {
      name: String(method.result?.name || '').trim(),
      image_url: String(method.result?.image_url || '').trim(),
      qty: Math.max(1, Number(method.result?.qty) || 1),
      guide_link: normalizeGuideLink(method.result?.guide_link),
    },
  };
  if (mode === 'crafting') {
    normalized.grid = normalizeRecipeDraftForMode(mode, method);
  } else if (mode === 'furnace') {
    normalized.furnace_type = method.furnace_type || 'furnace';
    normalized.inputs = normalizeRecipeDraftForMode(mode, method);
  } else if (mode === 'smithing') {
    normalized.inputs = normalizeRecipeDraftForMode(mode, method);
  } else {
    normalized.materials = normalizeRecipeDraftForMode(mode, method).filter(slot => slot.name || slot.image_url || slot.guide_link);
  }
  return normalized;
}

function recipeMethodsFromRecipe(recipe = null) {
  if (Array.isArray(recipe?.methods) && recipe.methods.length) {
    return recipe.methods.map(normalizeRecipeMethod);
  }
  if (!recipe) return [normalizeRecipeMethod({ mode: 'trade' })];
  return [normalizeRecipeMethod(recipe)];
}

function getCurrentRecipeMode() {
  return document.getElementById('weapon-recipe-mode-input')?.value || 'trade';
}

function currentRecipeMethod() {
  return state.weaponRecipeMethodsDraft[state.editingWeaponRecipeMethodIndex] || null;
}

function syncRecipeMaterialsDraftFromDom() {
  const container = document.getElementById('weapon-recipe-materials-list');
  if (!container) return;
  container.querySelectorAll('.weapon-material-row').forEach((row) => {
    const idx = Number(row.dataset.idx);
    if (!state.weaponRecipeMaterialsDraft[idx]) return;
    state.weaponRecipeMaterialsDraft[idx].name = row.querySelector('[data-f="name"]')?.value || '';
    state.weaponRecipeMaterialsDraft[idx].qty = Number(row.querySelector('[data-f="qty"]')?.value) || 1;
    state.weaponRecipeMaterialsDraft[idx].guide_link = parseGuideLinkValue(row.querySelector('[data-f="guide_link"]')?.value || '');
  });
}

function setRecipeModeUI(mode) {
  const furnaceWrap = document.getElementById('weapon-recipe-furnace-type-wrap');
  const addBtn = document.getElementById('weapon-recipe-add-material-btn');
  const label = document.getElementById('weapon-recipe-materials-label');
  furnaceWrap?.classList.toggle('hidden', mode !== 'furnace');
  addBtn?.classList.toggle('hidden', mode !== 'trade');
  if (label) {
    label.textContent = mode === 'crafting'
      ? 'Mesa de crafteo'
      : mode === 'furnace'
        ? 'Entrada y combustible'
        : mode === 'smithing'
          ? 'Mesa de herreria'
          : 'Materiales';
  }
}

function syncCurrentRecipeMethodFromForm() {
  const method = currentRecipeMethod();
  if (!method) return;
  const mode = getCurrentRecipeMode();
  syncRecipeMaterialsDraftFromDom();
  method.title = document.getElementById('weapon-recipe-title-input')?.value.trim() || defaultRecipeTitle(mode);
  method.mode = mode;
  method.result = {
    name: document.getElementById('weapon-recipe-result-name-input')?.value.trim() || '',
    image_url: document.getElementById('weapon-recipe-result-image-input')?.value.trim() || '',
    qty: Math.max(1, Number(document.getElementById('weapon-recipe-result-qty-input')?.value) || 1),
    guide_link: parseGuideLinkValue(document.getElementById('weapon-recipe-result-guide-input')?.value || ''),
  };
  const normalized = state.weaponRecipeMaterialsDraft.map(normalizeRecipeSlot);
  delete method.materials;
  delete method.grid;
  delete method.inputs;
  delete method.furnace_type;
  if (mode === 'crafting') {
    method.grid = emptyRecipeSlots(9).map((slot, index) => normalizeRecipeSlot(normalized[index] || slot));
  } else if (mode === 'furnace') {
    method.furnace_type = document.getElementById('weapon-recipe-furnace-type-input')?.value || 'furnace';
    method.inputs = emptyRecipeSlots(2).map((slot, index) => normalizeRecipeSlot(normalized[index] || slot));
  } else if (mode === 'smithing') {
    method.inputs = emptyRecipeSlots(3).map((slot, index) => normalizeRecipeSlot(normalized[index] || slot));
  } else {
    method.materials = normalized.filter(slot => slot.name || slot.image_url || slot.guide_link);
  }
}

function renderRecipeMethodSelector() {
  const select = document.getElementById('weapon-recipe-method-input');
  if (!select) return;
  select.innerHTML = state.weaponRecipeMethodsDraft.map((method, index) => `
    <option value="${index}">${escapeHtml(method.title || `Método ${index + 1}`)}</option>
  `).join('');
  select.value = String(state.editingWeaponRecipeMethodIndex);
  document.getElementById('weapon-recipe-remove-method-btn')?.classList.toggle('hidden', state.weaponRecipeMethodsDraft.length <= 1);
}

function loadRecipeMethodIntoForm(index = 0) {
  state.editingWeaponRecipeMethodIndex = Math.max(0, Math.min(index, state.weaponRecipeMethodsDraft.length - 1));
  const method = currentRecipeMethod() || normalizeRecipeMethod({ mode: 'trade' });
  document.getElementById('weapon-recipe-title-input').value = method.title || defaultRecipeTitle(method.mode);
  document.getElementById('weapon-recipe-mode-input').value = method.mode || 'trade';
  document.getElementById('weapon-recipe-furnace-type-input').value = method.furnace_type || 'furnace';
  document.getElementById('weapon-recipe-result-name-input').value = method.result?.name || '';
  document.getElementById('weapon-recipe-result-image-input').value = method.result?.image_url || '';
  document.getElementById('weapon-recipe-result-qty-input').value = String(Math.max(1, Number(method.result?.qty) || 1));
  hydrateGuideLinkSelect('weapon-recipe-result-guide-input', method.result?.guide_link || null);
  state.weaponRecipeMaterialsDraft = JSON.parse(JSON.stringify(normalizeRecipeDraftForMode(method.mode || 'trade', method)));
  renderRecipeMethodSelector();
  renderRecipeMaterialsEditor();
  paintRecipeResultPreview();
}

function recipeSlotLabel(mode, index) {
  if (mode === 'crafting') return `Slot ${index + 1}`;
  if (mode === 'smithing') return ['Plantilla', 'Equipo', 'Material'][index] || `Slot ${index + 1}`;
  if (mode === 'furnace') return index === 0 ? 'Ingrediente' : 'Combustible';
  return `Material ${index + 1}`;
}

function recipeSlotInner(slot, index, mode) {
  const image = safeUrl(slot?.image_url);
  const label = recipeSlotLabel(mode, index);
  const name = String(slot?.name || '').trim();
  return `
    <span class="recipe-editor-slot-label">${escapeHtml(label)}</span>
    ${slot?.guide_link ? '<span class="recipe-editor-slot-link" title="Enlazado con Guías">↗</span>' : ''}
    ${image
      ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name || label)}" loading="lazy" />`
      : `<span class="recipe-editor-slot-icon">${name ? '◈' : '+'}</span>`}
    <span class="recipe-editor-slot-name">${escapeHtml(name || 'Vacío')}</span>
    ${name || image ? `<span class="recipe-editor-slot-qty">×${Math.max(1, Number(slot?.qty) || 1)}</span>` : ''}
  `;
}

function currentRecipeResultFromForm() {
  return {
    name: document.getElementById('weapon-recipe-result-name-input')?.value.trim() || '',
    image_url: document.getElementById('weapon-recipe-result-image-input')?.value.trim() || '',
    qty: Math.max(1, Number(document.getElementById('weapon-recipe-result-qty-input')?.value) || 1),
    guide_link: parseGuideLinkValue(document.getElementById('weapon-recipe-result-guide-input')?.value || ''),
  };
}

function paintRecipeResultPreview() {
  const slot = document.getElementById('weapon-recipe-result-slot');
  const preview = document.getElementById('weapon-recipe-result-preview');
  const nameEl = document.getElementById('weapon-recipe-result-preview-name');
  const qtyEl = document.getElementById('weapon-recipe-result-preview-qty');
  if (!slot || !preview || !nameEl) return;
  const result = currentRecipeResultFromForm();
  const image = safeUrl(result.image_url);
  const name = result.name || 'Vacío';
  const hasContent = !!(result.name || result.image_url || result.guide_link);
  preview.innerHTML = image
    ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(name)}" />`
    : '<span class="recipe-editor-slot-icon">+</span>';
  nameEl.textContent = name;
  if (qtyEl) {
    qtyEl.textContent = `×${Math.max(1, Number(result.qty) || 1)}`;
    qtyEl.classList.toggle('hidden', !hasContent);
  }
  slot.classList.toggle('is-empty', !hasContent);
  slot.classList.toggle('has-image', !!image);
}

function setRecipeResultForm(result = {}, { hydrateGuide = true } = {}) {
  const normalized = {
    name: String(result.name || ''),
    image_url: String(result.image_url || ''),
    qty: Math.max(1, Number(result.qty) || 1),
    guide_link: normalizeGuideLink(result.guide_link),
  };
  const nameInput = document.getElementById('weapon-recipe-result-name-input');
  const imageInput = document.getElementById('weapon-recipe-result-image-input');
  const qtyInput = document.getElementById('weapon-recipe-result-qty-input');
  if (nameInput) nameInput.value = normalized.name;
  if (imageInput) imageInput.value = normalized.image_url;
  if (qtyInput) qtyInput.value = String(normalized.qty);
  if (hydrateGuide) hydrateGuideLinkSelect('weapon-recipe-result-guide-input', normalized.guide_link || null);
  paintRecipeResultPreview();
}

function openRecipeResultContext(anchor) {
  const result = currentRecipeResultFromForm();
  openContextPanel({
    anchor,
    title: 'Resultado',
    subtitle: result.name || 'Configura el resultado de la receta',
    width: 390,
    className: 'recipe-slot-context recipe-result-context',
    build(root, close) {
      const nameField = document.createElement('label');
      nameField.className = 'context-field';
      nameField.innerHTML = `<span>Nombre</span><input class="modal-input" type="text" maxlength="80" value="${escapeHtml(result.name)}" placeholder="Nombre del resultado" />`;
      nameField.querySelector('input').addEventListener('input', (event) => {
        result.name = event.target.value;
        setRecipeResultForm(result, { hydrateGuide: false });
      });
      root.appendChild(nameField);

      const preview = document.createElement('div');
      preview.className = 'context-image-preview';
      const renderPreview = () => {
        const image = safeUrl(result.image_url);
        preview.innerHTML = image
          ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(result.name || 'Resultado')}" />`
          : '<span>Sin imagen</span>';
      };
      renderPreview();
      root.appendChild(preview);

      appendActionGrid(root, [
        { label: 'Biblioteca', icon: '▦', onClick: () => openMediaPicker({
          title: 'Seleccionar imagen de resultado',
          allowedKinds: ['image'],
          currentUrl: result.image_url || '',
          onSelect: ({ url }) => {
            result.image_url = url;
            setRecipeResultForm(result, { hydrateGuide: false });
            renderPreview();
          },
        }) },
      ]);

      appendDisclosure(root, {
        title: 'Propiedades',
        open: true,
        build(content) {
          const qtyField = document.createElement('label');
          qtyField.className = 'context-field';
          qtyField.innerHTML = `<span>Cantidad obtenida</span><input class="modal-input" type="number" min="1" step="1" value="${Math.max(1, Number(result.qty) || 1)}" />`;
          qtyField.querySelector('input').addEventListener('input', (event) => {
            result.qty = Math.max(1, Number(event.target.value) || 1);
            setRecipeResultForm(result, { hydrateGuide: false });
          });
          content.appendChild(qtyField);

          const guideField = document.createElement('label');
          guideField.className = 'context-field';
          const selectId = `recipe-result-guide-${crypto.randomUUID()}`;
          guideField.innerHTML = `<span>Enlazar con Guías</span><select class="modal-select" id="${selectId}"></select>`;
          content.appendChild(guideField);
          hydrateGuideLinkSelect(selectId, result.guide_link || null);
          guideField.querySelector('select').addEventListener('change', (event) => {
            result.guide_link = parseGuideLinkValue(event.target.value || '');
            setRecipeResultForm(result);
          });
        },
      });

      appendDisclosure(root, {
        title: 'Acciones',
        build(content) {
          appendActionGrid(content, [
            { label: 'Copiar', icon: '⎘', onClick: () => {
              copyEditorPayload('weapon-recipe-result', cloneData(result));
              showToast('Resultado copiado', 'success');
            } },
            { label: 'Pegar', icon: '↧', disabled: !hasEditorPayload('weapon-recipe-result'), onClick: () => {
              const payload = getEditorPayload('weapon-recipe-result');
              if (!payload) return;
              Object.assign(result, {
                name: String(payload.name || ''),
                image_url: String(payload.image_url || ''),
                qty: Math.max(1, Number(payload.qty) || 1),
                guide_link: normalizeGuideLink(payload.guide_link),
              });
              setRecipeResultForm(result);
              close();
            } },
            { label: 'Vaciar', icon: '🗑', tone: 'danger', onClick: () => {
              setRecipeResultForm({});
              close();
            } },
          ]);
        },
      });
    },
  });
}

function refreshRecipeSlotAnchor(anchor, slot, index, mode) {
  if (!anchor?.isConnected) return;
  anchor.classList.toggle('is-empty', !(slot?.name || slot?.image_url || slot?.guide_link));
  anchor.innerHTML = recipeSlotInner(slot, index, mode);
}

function duplicateRecipeSlot(index, mode) {
  const list = state.weaponRecipeMaterialsDraft;
  const clone = normalizeRecipeSlot(cloneData(list[index] || EMPTY_RECIPE_SLOT));
  if (mode === 'trade') {
    list.splice(index + 1, 0, clone);
    return index + 1;
  }
  const emptyIndex = list.findIndex((slot, idx) => idx !== index && !(slot.name || slot.image_url || slot.guide_link));
  if (emptyIndex === -1) {
    showToast('No hay un slot vacío para duplicarlo', 'error');
    return index;
  }
  list[emptyIndex] = clone;
  return emptyIndex;
}

function openRecipeSlotContext(anchor, index) {
  const list = state.weaponRecipeMaterialsDraft;
  const mode = getCurrentRecipeMode();
  const slot = list[index] || (list[index] = { ...EMPTY_RECIPE_SLOT });
  openContextPanel({
    anchor,
    title: recipeSlotLabel(mode, index),
    subtitle: slot.name || 'Configura este espacio',
    width: 390,
    className: 'recipe-slot-context',
    build(root, close) {
      const nameField = document.createElement('label');
      nameField.className = 'context-field';
      nameField.innerHTML = `<span>Nombre</span><input class="modal-input" type="text" maxlength="80" value="${escapeHtml(slot.name || '')}" placeholder="Nombre del material" />`;
      const nameInput = nameField.querySelector('input');
      nameInput.addEventListener('input', () => {
        slot.name = nameInput.value;
        refreshRecipeSlotAnchor(anchor, slot, index, mode);
      });
      root.appendChild(nameField);

      const preview = document.createElement('div');
      preview.className = 'context-image-preview';
      const paintPreview = () => {
        const image = safeUrl(slot.image_url);
        preview.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="Vista previa" />` : '<span>Sin imagen</span>';
      };
      paintPreview();
      root.appendChild(preview);

      appendActionGrid(root, [
        {
          label: 'Biblioteca', icon: '▦', onClick: () => openMediaPicker({
            title: 'Seleccionar imagen de material',
            allowedKinds: ['image'],
            currentUrl: slot.image_url || '',
            onSelect: ({ url }) => {
              slot.image_url = url;
              paintPreview();
              refreshRecipeSlotAnchor(anchor, slot, index, mode);
            },
          }),
        },
      ]);

      appendDisclosure(root, {
        title: 'Propiedades',
        open: true,
        build(content) {
          const qtyField = document.createElement('label');
          qtyField.className = 'context-field';
          qtyField.innerHTML = `<span>Cantidad</span><input class="modal-input" type="number" min="1" value="${Math.max(1, Number(slot.qty) || 1)}" />`;
          qtyField.querySelector('input').addEventListener('input', (event) => {
            slot.qty = Math.max(1, Number(event.target.value) || 1);
            refreshRecipeSlotAnchor(anchor, slot, index, mode);
          });
          content.appendChild(qtyField);

          const guideField = document.createElement('label');
          guideField.className = 'context-field';
          const selectId = `recipe-context-guide-${crypto.randomUUID()}`;
          guideField.innerHTML = `<span>Enlazar con Guías</span><select class="modal-select" id="${selectId}"></select>`;
          content.appendChild(guideField);
          hydrateGuideLinkSelect(selectId, slot.guide_link || null);
          guideField.querySelector('select').addEventListener('change', (event) => {
            slot.guide_link = parseGuideLinkValue(event.target.value || '');
            refreshRecipeSlotAnchor(anchor, slot, index, mode);
          });
        },
      });

      appendDisclosure(root, {
        title: 'Acciones',
        build(content) {
          appendActionGrid(content, [
            {
              label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('weapon-recipe-material', normalizeRecipeSlot(slot)),
            },
            {
              label: 'Pegar', icon: '↧', disabled: !hasEditorPayload('weapon-recipe-material'), onClick: () => {
                const payload = getEditorPayload('weapon-recipe-material');
                if (!payload) return;
                list[index] = normalizeRecipeSlot(payload);
                renderRecipeMaterialsEditor();
                close();
                showToast('Material pegado', 'success');
              },
            },
            {
              label: 'Duplicar', icon: '⧉', onClick: () => {
                duplicateRecipeSlot(index, mode);
                renderRecipeMaterialsEditor();
                close();
              },
            },
            {
              label: mode === 'trade' ? 'Eliminar' : 'Vaciar', icon: '🗑', tone: 'danger', onClick: () => {
                if (mode === 'trade') list.splice(index, 1);
                else list[index] = { ...EMPTY_RECIPE_SLOT };
                renderRecipeMaterialsEditor();
                close();
              },
            },
          ]);
        },
      });
    },
  });
}

function renderRecipeMaterialsEditor() {
  const container = document.getElementById('weapon-recipe-materials-list');
  const mode = getCurrentRecipeMode();
  const workbench = document.getElementById('weapon-recipe-workbench');
  setRecipeModeUI(mode);
  container.dataset.recipeMode = mode;
  if (workbench) workbench.dataset.recipeMode = mode;
  container.classList.add('recipe-square-editor');

  if (mode === 'crafting' && state.weaponRecipeMaterialsDraft.length !== 9) {
    state.weaponRecipeMaterialsDraft = emptyRecipeSlots(9).map((slot, index) => normalizeRecipeSlot(state.weaponRecipeMaterialsDraft[index] || slot));
  }
  if (mode === 'furnace' && state.weaponRecipeMaterialsDraft.length !== 2) {
    state.weaponRecipeMaterialsDraft = emptyRecipeSlots(2).map((slot, index) => normalizeRecipeSlot(state.weaponRecipeMaterialsDraft[index] || slot));
  }
  if (mode === 'smithing' && state.weaponRecipeMaterialsDraft.length !== 3) {
    state.weaponRecipeMaterialsDraft = emptyRecipeSlots(3).map((slot, index) => normalizeRecipeSlot(state.weaponRecipeMaterialsDraft[index] || slot));
  }

  const list = state.weaponRecipeMaterialsDraft;
  if (list.length === 0) {
    container.innerHTML = `<button type="button" class="recipe-editor-slot is-empty" data-idx="0"><span class="recipe-editor-slot-icon">+</span><span class="recipe-editor-slot-name">Agregar material</span></button>`;
    container.querySelector('button')?.addEventListener('click', (event) => {
      list.push({ ...EMPTY_RECIPE_SLOT });
      renderRecipeMaterialsEditor();
      requestAnimationFrame(() => document.querySelector('#weapon-recipe-materials-list [data-idx="0"]')?.click());
    });
    return;
  }

  const slotsHtml = list.map((slot, index) => `
    <button type="button" class="recipe-editor-slot ${slot.name || slot.image_url || slot.guide_link ? '' : 'is-empty'}" data-idx="${index}">
      ${recipeSlotInner(slot, index, mode)}
    </button>
  `);
  if (mode === 'furnace' && slotsHtml.length >= 2) {
    container.innerHTML = `${slotsHtml[0]}<span class="recipe-editor-furnace-flame" aria-hidden="true">♨</span>${slotsHtml[1]}`;
  } else {
    container.innerHTML = slotsHtml.join('');
  }
  container.querySelectorAll('.recipe-editor-slot').forEach((button) => {
    button.addEventListener('click', () => openRecipeSlotContext(button, Number(button.dataset.idx)));
  });
}


function openRecipeMethodActions(anchor) {
  syncCurrentRecipeMethodFromForm();
  const index = state.editingWeaponRecipeMethodIndex;
  const method = state.weaponRecipeMethodsDraft[index];
  if (!method) return;
  openContextPanel({
    anchor,
    title: 'Acciones del método',
    subtitle: method.title || `Método ${index + 1}`,
    width: 330,
    build(root, close) {
      appendActionGrid(root, [
        {
          label: 'Copiar', icon: '⎘', onClick: () => {
            copyEditorPayload('weapon-recipe-method', normalizeRecipeMethod(method));
            showToast('Método copiado', 'success');
          },
        },
        {
          label: 'Pegar', icon: '↧', disabled: !hasEditorPayload('weapon-recipe-method'), onClick: () => {
            const payload = getEditorPayload('weapon-recipe-method');
            if (!payload) return;
            state.weaponRecipeMethodsDraft[index] = normalizeRecipeMethod(payload);
            loadRecipeMethodIntoForm(index);
            close();
          },
        },
        {
          label: 'Duplicar', icon: '⧉', onClick: () => {
            state.weaponRecipeMethodsDraft.splice(index + 1, 0, normalizeRecipeMethod(cloneData(method)));
            loadRecipeMethodIntoForm(index + 1);
            close();
          },
        },
        {
          label: 'Eliminar', icon: '🗑', tone: 'danger', disabled: state.weaponRecipeMethodsDraft.length <= 1, onClick: () => {
            if (state.weaponRecipeMethodsDraft.length <= 1) return;
            state.weaponRecipeMethodsDraft.splice(index, 1);
            loadRecipeMethodIntoForm(Math.max(0, index - 1));
            close();
          },
        },
      ]);
    },
  });
}


export function openWeaponRecipeModal(rankId) {
  state.editingWeaponRankId = rankId;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  state.weaponRecipeMethodsDraft = recipeMethodsFromRecipe(rank.upgrade_recipe);
  state.editingWeaponRecipeMethodIndex = 0;
  loadRecipeMethodIntoForm(0);
  document.getElementById('weapon-recipe-modal-error').classList.add('hidden');
  document.getElementById('weapon-recipe-modal').classList.remove('hidden');
}


async function submitWeaponRecipe() {
  const errorBox = document.getElementById('weapon-recipe-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  syncCurrentRecipeMethodFromForm();
  const methods = state.weaponRecipeMethodsDraft.map(normalizeRecipeMethod);
  const hasContent = methods.some(method => {
    const slots = method.mode === 'crafting' ? asArray(method.grid)
      : ['furnace', 'smithing'].includes(method.mode) ? asArray(method.inputs)
        : asArray(method.materials);
    return slots.some(slot => slot.name || slot.image_url || slot.guide_link) || method.result?.name || method.result?.image_url || method.result?.guide_link;
  });
  if (!hasContent) { errorBox.textContent = 'Agrega al menos un material o un resultado.'; errorBox.classList.remove('hidden'); return; }
  const primary = methods[0] || normalizeRecipeMethod({ mode: 'trade' });
  const recipe = { ...primary, methods };
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
  document.getElementById('weapon-rank-info-visual-add-btn')?.addEventListener('click', () => {
    syncRankInfoVisualsDraftFromDom();
    weaponRankInfoVisualsDraft.push({ name: '', image_url: '', guide_link: null });
    renderRankInfoVisualsEditor();
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
  document.getElementById('weapon-recipe-method-input').addEventListener('change', (event) => {
    syncCurrentRecipeMethodFromForm();
    loadRecipeMethodIntoForm(Number(event.target.value) || 0);
  });
  document.getElementById('weapon-recipe-add-method-btn').addEventListener('click', () => {
    syncCurrentRecipeMethodFromForm();
    const method = normalizeRecipeMethod({ mode: 'crafting', title: `Método ${state.weaponRecipeMethodsDraft.length + 1}` });
    state.weaponRecipeMethodsDraft.push(method);
    loadRecipeMethodIntoForm(state.weaponRecipeMethodsDraft.length - 1);
  });
  document.getElementById('weapon-recipe-remove-method-btn').addEventListener('click', () => {
    if (state.weaponRecipeMethodsDraft.length <= 1) return;
    state.weaponRecipeMethodsDraft.splice(state.editingWeaponRecipeMethodIndex, 1);
    loadRecipeMethodIntoForm(Math.max(0, state.editingWeaponRecipeMethodIndex - 1));
  });
  document.getElementById('weapon-recipe-method-actions-btn')?.addEventListener('click', (event) => {
    openRecipeMethodActions(event.currentTarget);
  });
  document.getElementById('weapon-recipe-mode-input').addEventListener('change', () => {
    syncRecipeMaterialsDraftFromDom();
    const method = currentRecipeMethod();
    if (method) method.mode = getCurrentRecipeMode();
    if (getCurrentRecipeMode() === 'trade') {
      state.weaponRecipeMaterialsDraft = state.weaponRecipeMaterialsDraft
        .map(normalizeRecipeSlot)
        .filter(slot => slot.name || slot.image_url || slot.guide_link);
    }
    renderRecipeMaterialsEditor();
  });
  document.getElementById('weapon-recipe-add-material-btn').addEventListener('click', () => {
    syncRecipeMaterialsDraftFromDom();
    state.weaponRecipeMaterialsDraft.push({ ...EMPTY_RECIPE_SLOT });
    renderRecipeMaterialsEditor();
  });
  document.getElementById('weapon-recipe-result-slot')?.addEventListener('click', (event) => {
    openRecipeResultContext(event.currentTarget);
  });
  document.getElementById('submit-weapon-recipe-btn').addEventListener('click', submitWeaponRecipe);
  document.getElementById('clear-weapon-recipe-btn').addEventListener('click', clearWeaponRecipe);

  document.getElementById('close-weapon-section-modal').addEventListener('click', () => document.getElementById('weapon-section-modal').classList.add('hidden'));
  document.getElementById('weapon-section-kind-input').addEventListener('change', toggleWeaponSectionKindUI);
  document.getElementById('weapon-section-add-field-btn').addEventListener('click', () => {
    state.weaponSectionFieldsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-section-fields-list', () => state.weaponSectionFieldsDraft);
  });
  document.getElementById('submit-weapon-section-btn').addEventListener('click', submitWeaponSection);
}

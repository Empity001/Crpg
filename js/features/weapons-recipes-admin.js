// Administración de Mesas de trabajo para Guías.

import { state, suppressNextWeaponsReload } from '../core/state.js';
import { asArray, cloneData, confirmAction, copyEditorPayload, escapeHtml, getEditorPayload, hasEditorPayload, safeUrl, showToast } from '../core/utils.js';
import { appendActionGrid, appendDisclosure, openContextPanel } from '../core/context-actions.js';
import { hydrateGuideLinkSelect, normalizeGuideLink, parseGuideLinkValue } from './guide-links.js';
import { openMediaPicker } from './media-library-lazy.js';
import { renderWeaponDetail, saveRankPatch } from './weapons-detail.js';
import { getWeaponRanks } from './weapons-state.js';

function finishRecipePatch(message) {
  showToast(message, 'success');
  suppressNextWeaponsReload();
  renderWeaponDetail();
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
          guideField.innerHTML = `<span>Asociar a una guía</span><select class="modal-select" id="${selectId}"></select>`;
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
          guideField.innerHTML = `<span>Asociar a una guía</span><select class="modal-select" id="${selectId}"></select>`;
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
  if (!state.adminMode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
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
  finishRecipePatch('Receta guardada');
}


async function clearWeaponRecipe() {
  if (!(await confirmAction({
    title: 'Quitar receta',
    message: 'Quitar las mesas de trabajo configuradas para este rango.',
    confirmLabel: 'Quitar receta',
    danger: true,
  }))) return;
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_clear_upgrade_recipe: true });
  if (error) { showToast('No se pudo quitar la receta', 'error'); return; }
  document.getElementById('weapon-recipe-modal').classList.add('hidden');
  finishRecipePatch('Receta eliminada');
}


export function initWeaponRecipeControls() {
  document.getElementById('close-weapon-recipe-modal').addEventListener('click', () => document.getElementById('weapon-recipe-modal').classList.add('hidden'));
  document.getElementById('weapon-recipe-method-input').addEventListener('change', event => {
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
  document.getElementById('weapon-recipe-method-actions-btn')?.addEventListener('click', event => openRecipeMethodActions(event.currentTarget));
  document.getElementById('weapon-recipe-mode-input').addEventListener('change', () => {
    syncRecipeMaterialsDraftFromDom();
    const method = currentRecipeMethod();
    if (method) method.mode = getCurrentRecipeMode();
    if (getCurrentRecipeMode() === 'trade') {
      state.weaponRecipeMaterialsDraft = state.weaponRecipeMaterialsDraft.map(normalizeRecipeSlot).filter(slot => slot.name || slot.image_url || slot.guide_link);
    }
    renderRecipeMaterialsEditor();
  });
  document.getElementById('weapon-recipe-add-material-btn').addEventListener('click', () => {
    syncRecipeMaterialsDraftFromDom();
    state.weaponRecipeMaterialsDraft.push({ ...EMPTY_RECIPE_SLOT });
    renderRecipeMaterialsEditor();
  });
  document.getElementById('weapon-recipe-result-slot')?.addEventListener('click', event => openRecipeResultContext(event.currentTarget));
  document.getElementById('submit-weapon-recipe-btn').addEventListener('click', submitWeaponRecipe);
  document.getElementById('clear-weapon-recipe-btn').addEventListener('click', clearWeaponRecipe);
}

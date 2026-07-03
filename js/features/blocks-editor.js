// =========================================================
// blocks-editor.js
// =========================================================
// Edición admin de fichas Mob/Item/Bloque Libre dentro del formulario de
// log: modales de alta/edición, editores de
// equipamiento/encantamientos/campos libres y la lista de chips de
// borrador.
// =========================================================

import { parseEquipment } from './blocks-display.js';
import { state } from '../core/state.js';
import { updateAssetPreview } from '../core/storage.js';
import { asArray, escapeHtml, safeUrl, tempId } from '../core/utils.js';

export function renderDraftBlocksList() {
  const container = document.getElementById('draft-blocks-list');
  const mobChips = state.draftMobs.map((mob, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="mob" data-idx="${idx}">👾 ${escapeHtml(mob.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="mob" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);
  const itemChips = state.draftItems.map((item, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="item" data-idx="${idx}">🗡 ${escapeHtml(item.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="item" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);
  const libreChips = state.draftLibres.map((lib, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="libre" data-idx="${idx}">📋 ${escapeHtml(lib.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="libre" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);

  container.innerHTML = [...mobChips, ...itemChips, ...libreChips].join('');

  container.querySelectorAll('.draft-block-label').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (el.dataset.kind === 'mob') openMobModal(idx);
      else if (el.dataset.kind === 'item') openItemModal(idx);
      else openLibreModal(idx);
    });
  });
  container.querySelectorAll('.draft-block-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.kind === 'mob') state.draftMobs.splice(idx, 1);
      else if (btn.dataset.kind === 'item') state.draftItems.splice(idx, 1);
      else state.draftLibres.splice(idx, 1);
      renderDraftBlocksList();
    });
  });
}

// ---------------------------------------------------------
// "ALGO MÁS" — editor genérico de campos clave/valor libres,
// reutilizado tanto en mob como en item (subcategoría libre
// dentro de la ficha, además de los campos fijos).
// ---------------------------------------------------------

export function renderExtraFieldsEditor(containerId, getArr) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const fields = getArr();
  if (fields.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin campos. Haz clic en "+ Campo" para agregar.</p>`;
    return;
  }
  container.innerHTML = fields.map((field, fIdx) => `
    <div class="libre-field-item">
      <div class="libre-field-head">
        <input type="text" class="modal-input extra-key-input" data-f="${fIdx}" value="${escapeHtml(field.key || '')}" placeholder="Campo (ej: Rareza)" maxlength="60" />
        <input type="text" class="modal-input extra-val-input" data-f="${fIdx}" value="${escapeHtml(field.value || '')}" placeholder="Valor" maxlength="200" />
        <button type="button" class="enchant-remove extra-remove-field" data-f="${fIdx}">🗑</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.extra-key-input').forEach(el => {
    el.addEventListener('input', () => { getArr()[Number(el.dataset.f)].key = el.value; });
  });
  container.querySelectorAll('.extra-val-input').forEach(el => {
    el.addEventListener('input', () => { getArr()[Number(el.dataset.f)].value = el.value; });
  });
  container.querySelectorAll('.extra-remove-field').forEach(btn => {
    btn.addEventListener('click', () => { getArr().splice(Number(btn.dataset.f), 1); renderExtraFieldsEditor(containerId, getArr); });
  });
}

// ---------------------------------------------------------
// MOB MODAL — con equipamiento como lista editable
// ---------------------------------------------------------

export function openMobModal(editIndex = null) {
  state.editingMobIndex = editIndex;
  const mob = editIndex != null ? state.draftMobs[editIndex] : null;
  document.getElementById('mob-name-input').value = mob ? mob.name : '';
  document.getElementById('mob-health-input').value = mob && mob.health != null ? mob.health : '';
  document.getElementById('mob-damage-input').value = mob && mob.damage != null ? mob.damage : '';
  document.getElementById('mob-armor-input').value = mob && mob.armor != null ? mob.armor : '';
  document.getElementById('mob-location-input').value = mob ? (mob.location || '') : '';
  document.getElementById('mob-desc-input').value = mob ? (mob.description || '') : '';
  const mobImageUrl = mob ? (mob.image_url || '') : '';
  document.getElementById('mob-image-input').value = mobImageUrl;
  updateAssetPreview('mob', mobImageUrl);
  document.getElementById('mob-modal-error').classList.add('hidden');
  // Cargar equipamiento draft
  if (mob && mob.equipment) {
    state.mobEquipmentDraft = parseEquipment(mob.equipment);
  } else {
    state.mobEquipmentDraft = [];
  }
  renderMobEquipmentEditor();
  // Cargar "algo más" draft
  state.mobExtraDraft = mob ? JSON.parse(JSON.stringify(asArray(mob.extra_fields))) : [];
  renderExtraFieldsEditor('mob-extra-fields-list', () => state.mobExtraDraft);
  document.getElementById('mob-modal').classList.remove('hidden');
}


function renderMobEquipmentEditor() {
  const container = document.getElementById('mob-equipment-list');
  if (!container) return;
  if (state.mobEquipmentDraft.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin equipamiento aún. Haz clic en "+ Pieza" para agregar.</p>`;
    return;
  }
  container.innerHTML = state.mobEquipmentDraft.map((eq, eqIdx) => {
    const enchHtml = eq.enchantments.map((en, enIdx) => `
      <div class="enchant-row">
        <span class="enchant-icon">✨</span>
        <input type="text" class="modal-input enchant-input" value="${escapeHtml(en.name)}"
          data-eq="${eqIdx}" data-en="${enIdx}" placeholder="Ej: Filo V" maxlength="60" />
        <button type="button" class="enchant-remove" data-eq="${eqIdx}" data-en="${enIdx}">✕</button>
      </div>`).join('');
    return `
      <div class="equip-editor-item">
        <div class="equip-editor-head">
          <span class="equip-bullet">⚙</span>
          <input type="text" class="modal-input equip-name-input" value="${escapeHtml(eq.name)}"
            data-eq="${eqIdx}" placeholder="Ej: Casco de diamante" maxlength="80" />
          <button type="button" class="equip-add-enchant" data-eq="${eqIdx}">+ Encantamiento</button>
          <button type="button" class="equip-remove-piece" data-eq="${eqIdx}">🗑</button>
        </div>
        <div class="enchant-rows">${enchHtml}</div>
        <button type="button" class="link-btn enchant-add-btn" data-eq="${eqIdx}">✨ + Encantamiento</button>
      </div>`;
  }).join('');

  // Bind inputs
  container.querySelectorAll('.equip-name-input').forEach(input => {
    input.addEventListener('input', () => {
      state.mobEquipmentDraft[Number(input.dataset.eq)].name = input.value;
    });
  });
  container.querySelectorAll('.enchant-input').forEach(input => {
    input.addEventListener('input', () => {
      state.mobEquipmentDraft[Number(input.dataset.eq)].enchantments[Number(input.dataset.en)].name = input.value;
    });
  });
  container.querySelectorAll('.equip-add-enchant, .enchant-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft[Number(btn.dataset.eq)].enchantments.push({ name: '' });
      renderMobEquipmentEditor();
    });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft[Number(btn.dataset.eq)].enchantments.splice(Number(btn.dataset.en), 1);
      renderMobEquipmentEditor();
    });
  });
  container.querySelectorAll('.equip-remove-piece').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft.splice(Number(btn.dataset.eq), 1);
      renderMobEquipmentEditor();
    });
  });
}


export function addEquipmentPiece() {
  state.mobEquipmentDraft.push({ name: '', enchantments: [] });
  renderMobEquipmentEditor();
}


export function submitMobBlock() {
  const errorBox = document.getElementById('mob-modal-error');
  const name = document.getElementById('mob-name-input').value.trim();
  const health = document.getElementById('mob-health-input').value;
  const damage = document.getElementById('mob-damage-input').value;
  const armor = document.getElementById('mob-armor-input').value;
  const location = document.getElementById('mob-location-input').value.trim();
  const description = document.getElementById('mob-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('mob-image-input').value.trim());

  if (!name) { errorBox.textContent = 'Ponle un nombre al mob.'; errorBox.classList.remove('hidden'); return; }
  if (health === '' || damage === '') { errorBox.textContent = 'Vida y Daño son obligatorios.'; errorBox.classList.remove('hidden'); return; }

  // Limpia piezas vacías
  const cleanEquip = state.mobEquipmentDraft
    .filter(eq => eq.name.trim())
    .map(eq => ({
      name: eq.name.trim(),
      enchantments: eq.enchantments.filter(en => en.name.trim()).map(en => ({ name: en.name.trim() }))
    }));

  const cleanExtra = state.mobExtraDraft
    .filter(f => f.key && f.key.trim())
    .map(f => ({ key: f.key.trim(), value: (f.value || '').trim() }));

  const mobData = {
    id: (state.editingMobIndex != null ? state.draftMobs[state.editingMobIndex].id : null) || tempId(),
    name,
    health: Number(health),
    damage: Number(damage),
    armor: armor === '' ? null : Number(armor),
    equipment: cleanEquip.length > 0 ? JSON.stringify(cleanEquip) : null,
    location: location || null,
    description: description || null,
    extra_fields: cleanExtra,
    image_url: imageUrl || null,
  };

  if (state.editingMobIndex != null) state.draftMobs[state.editingMobIndex] = mobData;
  else state.draftMobs.push(mobData);

  document.getElementById('mob-modal').classList.add('hidden');
  renderDraftBlocksList();
}

// ---------------------------------------------------------
// ITEM MODAL
// ---------------------------------------------------------

function renderItemEnchantEditor() {
  const container = document.getElementById('item-enchant-list');
  if (!container) return;
  const list = state.itemEnchantDraft;
  if (list.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin encantamientos. Haz clic en "+ Encantamiento" para agregar.</p>`;
    return;
  }
  container.innerHTML = list.map((en, idx) => `
    <div class="enchant-row">
      <span class="enchant-icon">✨</span>
      <input type="text" class="modal-input enchant-input" data-idx="${idx}" value="${escapeHtml(en.name)}" placeholder="Ej: Filo V" maxlength="60" />
      <button type="button" class="enchant-remove" data-idx="${idx}">✕</button>
    </div>`).join('');
  container.querySelectorAll('.enchant-input').forEach(el => {
    el.addEventListener('input', () => { state.itemEnchantDraft[Number(el.dataset.idx)].name = el.value; });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { state.itemEnchantDraft.splice(Number(btn.dataset.idx), 1); renderItemEnchantEditor(); });
  });
}


export function addItemEnchant() {
  state.itemEnchantDraft.push({ name: '' });
  renderItemEnchantEditor();
}


export function openItemModal(editIndex = null) {
  state.editingItemIndex = editIndex;
  const item = editIndex != null ? state.draftItems[editIndex] : null;
  document.getElementById('item-name-input').value = item ? item.name : '';
  document.getElementById('item-tier-input').value = item ? (item.tier || '') : '';
  document.getElementById('item-type-input').value = item ? (item.item_type || '') : '';
  document.getElementById('item-obtained-input').value = item ? (item.obtained_from || '') : '';
  document.getElementById('item-damage-input').value = item && item.damage != null ? item.damage : '';
  document.getElementById('item-desc-input').value = item ? (item.description || '') : '';
  const itemImageUrl = item ? (item.image_url || '') : '';
  document.getElementById('item-image-input').value = itemImageUrl;
  updateAssetPreview('item', itemImageUrl);
  document.getElementById('item-modal-error').classList.add('hidden');
  state.itemEnchantDraft = item ? JSON.parse(JSON.stringify(asArray(item.enchantments))) : [];
  renderItemEnchantEditor();
  state.itemExtraDraft = item ? JSON.parse(JSON.stringify(asArray(item.extra_fields))) : [];
  renderExtraFieldsEditor('item-extra-fields-list', () => state.itemExtraDraft);
  document.getElementById('item-modal').classList.remove('hidden');
}


export function submitItemBlock() {
  const errorBox = document.getElementById('item-modal-error');
  const name = document.getElementById('item-name-input').value.trim();
  const tier = document.getElementById('item-tier-input').value.trim();
  const itemType = document.getElementById('item-type-input').value.trim();
  const obtainedFrom = document.getElementById('item-obtained-input').value.trim();
  const damage = document.getElementById('item-damage-input').value;
  const description = document.getElementById('item-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('item-image-input').value.trim());
  if (!name) { errorBox.textContent = 'Ponle un nombre al item.'; errorBox.classList.remove('hidden'); return; }

  const cleanEnchant = state.itemEnchantDraft.filter(en => en.name.trim()).map(en => ({ name: en.name.trim() }));
  const cleanExtra = state.itemExtraDraft
    .filter(f => f.key && f.key.trim())
    .map(f => ({ key: f.key.trim(), value: (f.value || '').trim() }));

  const itemData = {
    id: (state.editingItemIndex != null ? state.draftItems[state.editingItemIndex].id : null) || tempId(),
    name, tier: tier || null, item_type: itemType || null, obtained_from: obtainedFrom || null,
    damage: damage === '' ? null : Number(damage),
    enchantments: cleanEnchant,
    description: description || null,
    extra_fields: cleanExtra,
    image_url: imageUrl || null,
  };
  if (state.editingItemIndex != null) state.draftItems[state.editingItemIndex] = itemData;
  else state.draftItems.push(itemData);
  document.getElementById('item-modal').classList.add('hidden');
  renderDraftBlocksList();
}

// ---------------------------------------------------------
// LIBRE MODAL — campos clave/valor completamente libres,
// con sub-campos anidables
// ---------------------------------------------------------

export function openLibreModal(editIndex = null) {
  state.editingLibreIndex = editIndex;
  const lib = editIndex != null ? state.draftLibres[editIndex] : null;
  document.getElementById('libre-name-input').value = lib ? lib.name : '';
  document.getElementById('libre-desc-input').value = lib ? (lib.description || '') : '';
  const libreImageUrl = lib ? (lib.image_url || '') : '';
  document.getElementById('libre-image-input').value = libreImageUrl;
  updateAssetPreview('libre', libreImageUrl);
  document.getElementById('libre-modal-error').classList.add('hidden');
  // Cargar campos
  const rawFields = lib ? (lib._fields || []) : [];
  // Store in a temp array on the modal
  document.getElementById('libre-modal')._fields = JSON.parse(JSON.stringify(rawFields));
  renderLibreFieldsEditor();
  document.getElementById('libre-modal').classList.remove('hidden');
}


function getLibreFields() {
  return document.getElementById('libre-modal')._fields || [];
}


function renderLibreFieldsEditor() {
  const container = document.getElementById('libre-fields-list');
  const fields = getLibreFields();
  if (fields.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin campos. Haz clic en "+ Campo" para agregar.</p>`;
    return;
  }
  container.innerHTML = fields.map((field, fIdx) => {
    const subHtml = (field.subfields || []).map((sf, sIdx) => `
      <div class="libre-subfield-row">
        <input type="text" class="modal-input libre-subkey" value="${escapeHtml(sf.key || '')}"
          data-f="${fIdx}" data-s="${sIdx}" placeholder="Sub-campo" maxlength="60" />
        <input type="text" class="modal-input libre-subval" value="${escapeHtml(sf.value || '')}"
          data-f="${fIdx}" data-s="${sIdx}" placeholder="Valor" maxlength="200" />
        <button type="button" class="enchant-remove" data-f="${fIdx}" data-s="${sIdx}">✕</button>
      </div>`).join('');
    return `
      <div class="libre-field-item">
        <div class="libre-field-head">
          <input type="text" class="modal-input libre-key-input" value="${escapeHtml(field.key || '')}"
            data-f="${fIdx}" placeholder="Campo (ej: Tipo)" maxlength="60" />
          <input type="text" class="modal-input libre-val-input" value="${escapeHtml(field.value || '')}"
            data-f="${fIdx}" placeholder="Valor (opcional si tiene sub-campos)" maxlength="200" />
          <button type="button" class="enchant-remove" data-f="${fIdx}">🗑</button>
        </div>
        <div class="libre-subfields-editor">${subHtml}</div>
        <button type="button" class="link-btn libre-add-sub" data-f="${fIdx}">↳ + Sub-campo</button>
      </div>`;
  }).join('');

  // Binds
  container.querySelectorAll('.libre-key-input').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].key = el.value; });
  });
  container.querySelectorAll('.libre-val-input').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].value = el.value; });
  });
  container.querySelectorAll('.libre-subkey').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].subfields[Number(el.dataset.s)].key = el.value; });
  });
  container.querySelectorAll('.libre-subval').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].subfields[Number(el.dataset.s)].value = el.value; });
  });
  // Remove field
  container.querySelectorAll('.libre-field-item > .libre-field-head > .enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { getLibreFields().splice(Number(btn.dataset.f), 1); renderLibreFieldsEditor(); });
  });
  // Remove subfield
  container.querySelectorAll('.libre-subfields-editor .enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { getLibreFields()[Number(btn.dataset.f)].subfields.splice(Number(btn.dataset.s), 1); renderLibreFieldsEditor(); });
  });
  // Add subfield
  container.querySelectorAll('.libre-add-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = getLibreFields()[Number(btn.dataset.f)];
      if (!f.subfields) f.subfields = [];
      f.subfields.push({ key: '', value: '' });
      renderLibreFieldsEditor();
    });
  });
}


export function addLibreField() {
  const fields = getLibreFields();
  fields.push({ key: '', value: '', subfields: [] });
  renderLibreFieldsEditor();
}


export function submitLibreBlock() {
  const errorBox = document.getElementById('libre-modal-error');
  const name = document.getElementById('libre-name-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre al bloque.'; errorBox.classList.remove('hidden'); return; }

  const fields = getLibreFields().filter(f => f.key.trim());
  const description = document.getElementById('libre-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('libre-image-input').value.trim());

  // Guardamos en draftLibres con _fields para edición, y
  // la serialización final a item lo hacemos en submitLog
  const libreData = {
    id: (state.editingLibreIndex != null ? state.draftLibres[state.editingLibreIndex].id : null) || tempId(),
    name,
    _fields: fields,
    description: description || null,
    image_url: imageUrl || null,
  };

  if (state.editingLibreIndex != null) state.draftLibres[state.editingLibreIndex] = libreData;
  else state.draftLibres.push(libreData);

  document.getElementById('libre-modal').classList.add('hidden');
  renderDraftBlocksList();
}

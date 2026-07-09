import { supabaseClient } from '../config.js';
import { KIT_COLUMNS, isAdmin, state, suppressNextKitsReload } from '../core/state.js';
import { confirmAction, escapeHtml, safeUrl, showToast } from '../core/utils.js';
import { attachMediaPickerButton } from './media-library.js';

function emptyKitItems() {
  return { weapon: [], accessory: [], subweapon: [] };
}

function normalizeKitItems(items) {
  const source = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
  const normalized = emptyKitItems();
  KIT_COLUMNS.forEach((column) => {
    normalized[column.key] = Array.isArray(source[column.key])
      ? source[column.key].map((item) => ({
        name: String(item?.name || '').trim(),
        image_url: String(item?.image_url || '').trim(),
      })).filter(item => item.name || item.image_url)
      : [];
  });
  return normalized;
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(part => part[0]).join('').toUpperCase() || '?';
}

function renderKitItem(item) {
  const url = safeUrl(item.image_url);
  const thumb = url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(item.name || 'Item de kit')}" class="js-open-asset pixel-art" loading="lazy" data-asset-src="${escapeHtml(url)}" data-asset-title="${escapeHtml(item.name || 'Item de kit')}" />`
    : `<span class="tier-chip-initials">${escapeHtml(initialsOf(item.name))}</span>`;

  return `
    <div class="kit-item">
      <div class="kit-item-thumb">${thumb}</div>
      <span class="kit-item-name">${escapeHtml(item.name || 'Item sin nombre')}</span>
    </div>
  `;
}

function renderKitColumn(column, items, maxRows) {
  const rows = [];
  for (let index = 0; index < maxRows; index += 1) {
    const item = items[index];
    rows.push(`
      <div class="kit-slot">
        ${item ? renderKitItem(item) : '<span class="kit-empty-slot">-</span>'}
      </div>
    `);
  }

  return `
    <div class="kit-column">
      <div class="kit-column-head">${escapeHtml(column.label)}</div>
      ${rows.join('')}
    </div>
  `;
}

function renderKitCard(kit) {
  const items = normalizeKitItems(kit.items);
  const maxRows = Math.max(1, ...KIT_COLUMNS.map(column => items[column.key].length));

  return `
    <article class="kit-card" data-kit-id="${kit.id}">
      <header class="kit-card-head">
        <div>
          <h2 class="kit-card-title">${escapeHtml(kit.name || 'Kit sin nombre')}</h2>
          ${kit.description ? `<p class="kit-card-desc">${escapeHtml(kit.description)}</p>` : ''}
        </div>
        ${isAdmin() ? `
          <div class="kit-admin-actions">
            <button type="button" class="kit-mini-btn" data-action="edit-kit" data-kit-id="${kit.id}" title="Editar">✏</button>
            <button type="button" class="kit-mini-btn danger" data-action="delete-kit" data-kit-id="${kit.id}" title="Eliminar">🗑</button>
          </div>
        ` : ''}
      </header>
      <div class="kit-table">
        ${KIT_COLUMNS.map(column => renderKitColumn(column, items[column.key], maxRows)).join('')}
      </div>
    </article>
  `;
}

export async function loadKits() {
  const grid = document.getElementById('kits-grid');
  const { data, error } = await supabaseClient.rpc('list_kits', {
    input_code: state.adminCode,
  });

  if (error) {
    console.error(error);
    if (grid) {
      grid.innerHTML = `<div class="logs-empty"><p>No se pudieron cargar los kits. Revisa si la migracion 016 ya fue aplicada.</p></div>`;
    }
    return;
  }

  state.kits = data || [];
  state.kitsLoaded = true;
  renderKits();
}

export function renderKits() {
  const grid = document.getElementById('kits-grid');
  if (!grid) return;

  if (!state.kits.length) {
    grid.innerHTML = `<div class="logs-empty"><p>Todavia no hay kits recomendados.${isAdmin() ? ' Crea el primero con "+ Nuevo kit".' : ''}</p></div>`;
    return;
  }

  grid.innerHTML = state.kits.map(renderKitCard).join('');
  grid.querySelectorAll('[data-action="edit-kit"]').forEach(btn => {
    btn.addEventListener('click', () => openKitModal(btn.dataset.kitId));
  });
  grid.querySelectorAll('[data-action="delete-kit"]').forEach(btn => {
    btn.addEventListener('click', () => deleteKit(btn.dataset.kitId));
  });
}

function renderKitEditor() {
  const editor = document.getElementById('kit-columns-editor');
  if (!editor) return;

  editor.innerHTML = KIT_COLUMNS.map(column => `
    <div class="kit-editor-column" data-kit-column="${column.key}">
      <div class="kit-editor-head">
        <span class="kit-editor-title">${escapeHtml(column.label)}</span>
        <button type="button" class="kit-add-item-btn" data-action="add-kit-item" data-column-key="${column.key}" title="Agregar">+</button>
      </div>
      <div class="kit-editor-list">
        ${(state.kitDraftItems[column.key] || []).map((item, index) => `
          <div class="kit-editor-row" data-column-key="${column.key}" data-index="${index}">
            <input type="text" class="modal-input" data-kit-field="name" value="${escapeHtml(item.name)}" maxlength="80" placeholder="Nombre" />
            <button type="button" class="kit-row-btn danger" data-action="remove-kit-item" title="Quitar">✕</button>
            <div class="kit-url-row">
              <input type="text" class="modal-input" id="kit-${column.key}-${index}-image" data-kit-field="image_url" value="${escapeHtml(item.image_url)}" placeholder="URL de imagen" />
              <button type="button" class="kit-row-btn" data-action="pick-kit-media" data-input-id="kit-${column.key}-${index}-image">Biblioteca</button>
              <button type="button" class="kit-row-btn" data-action="clear-kit-image" title="Limpiar">Limpiar</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  bindKitEditorEvents();
}

function syncKitDraftFromEditor() {
  const next = emptyKitItems();
  document.querySelectorAll('.kit-editor-row').forEach((row) => {
    const columnKey = row.dataset.columnKey;
    if (!next[columnKey]) return;
    next[columnKey].push({
      name: row.querySelector('[data-kit-field="name"]')?.value.trim() || '',
      image_url: row.querySelector('[data-kit-field="image_url"]')?.value.trim() || '',
    });
  });
  state.kitDraftItems = normalizeKitItems(next);
}

function bindKitEditorEvents() {
  document.querySelectorAll('[data-action="add-kit-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncKitDraftFromEditor();
      state.kitDraftItems[btn.dataset.columnKey].push({ name: '', image_url: '' });
      renderKitEditor();
    });
  });

  document.querySelectorAll('[data-action="remove-kit-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      syncKitDraftFromEditor();
      const row = btn.closest('.kit-editor-row');
      state.kitDraftItems[row.dataset.columnKey].splice(Number(row.dataset.index), 1);
      renderKitEditor();
    });
  });

  document.querySelectorAll('[data-action="clear-kit-image"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.kit-editor-row');
      const input = row?.querySelector('[data-kit-field="image_url"]');
      if (input) input.value = '';
    });
  });

  document.querySelectorAll('[data-action="pick-kit-media"]').forEach(btn => {
    const inputId = btn.dataset.inputId;
    attachMediaPickerButton({
      targetInputId: inputId,
      insertAfterId: inputId,
      label: 'Elegir',
      title: 'Seleccionar imagen de kit',
    });
    document.querySelector(`[data-media-picker-for="${inputId}"]`)?.classList.add('hidden');
    btn.addEventListener('click', () => {
      document.querySelector(`[data-media-picker-for="${inputId}"]`)?.click();
    });
  });
}

export function openKitModal(kitId = null) {
  state.editingKitId = kitId;
  const kit = kitId ? state.kits.find(item => item.id === kitId) : null;

  document.getElementById('kit-modal-title').textContent = kit ? 'Editar kit' : 'Nuevo kit';
  document.getElementById('kit-name-input').value = kit?.name || '';
  document.getElementById('kit-description-input').value = kit?.description || '';
  document.getElementById('kit-published-input').checked = kit ? !!kit.published : true;
  document.getElementById('kit-modal-error').classList.add('hidden');

  state.kitDraftItems = normalizeKitItems(kit?.items);
  if (!kit) {
    KIT_COLUMNS.forEach((column) => {
      state.kitDraftItems[column.key].push({ name: '', image_url: '' });
    });
  }
  renderKitEditor();
  document.getElementById('kit-modal').classList.remove('hidden');
}

export async function submitKit() {
  const errorBox = document.getElementById('kit-modal-error');
  const name = document.getElementById('kit-name-input').value.trim();
  const description = document.getElementById('kit-description-input').value.trim();
  const published = document.getElementById('kit-published-input').checked;

  if (!name) {
    errorBox.textContent = 'Ponle un nombre al kit.';
    errorBox.classList.remove('hidden');
    return;
  }
  if (!state.adminCode) {
    errorBox.textContent = 'Tu sesion de administrador expiro.';
    errorBox.classList.remove('hidden');
    return;
  }

  syncKitDraftFromEditor();
  const { error } = await supabaseClient.rpc('upsert_kit', {
    input_code: state.adminCode,
    input_id: state.editingKitId,
    input_name: name,
    input_description: description,
    input_published: published,
    input_items: state.kitDraftItems,
  });

  if (error) {
    console.error(error);
    errorBox.textContent = `Error: ${error.message}`;
    errorBox.classList.remove('hidden');
    return;
  }

  document.getElementById('kit-modal').classList.add('hidden');
  showToast(state.editingKitId ? 'Kit actualizado' : 'Kit creado', 'success');
  suppressNextKitsReload();
  await loadKits();
}

async function deleteKit(kitId) {
  const kit = state.kits.find(item => item.id === kitId);
  if (!(await confirmAction({
    title: 'Eliminar kit',
    message: `Eliminar el kit "${kit?.name || 'kit sin nombre'}".`,
    confirmLabel: 'Eliminar kit',
    danger: true,
  }))) return;

  const { error } = await supabaseClient.rpc('delete_kit', {
    input_code: state.adminCode,
    input_id: kitId,
  });

  if (error) {
    console.error(error);
    showToast('No se pudo eliminar el kit', 'error');
    return;
  }

  showToast('Kit eliminado', 'success');
  suppressNextKitsReload();
  await loadKits();
}

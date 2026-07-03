// =========================================================
// tierlist.js
// =========================================================
// Tierlist completa: carga, render de filas/columnas/banco, drag & drop
// (PC) y modal "Mover a..." (móvil), y CRUD admin de filas y elementos,
// incluida su dropzone de imagen dedicada.
// =========================================================

import { supabaseClient } from '../config.js';
import { TIER_COLUMNS, isAdmin, state, suppressNextTierlistReload } from '../core/state.js';
import { initImageUploader, updateAssetPreview, uploadImageToStorage } from '../core/storage.js';
import { confirmAction, escapeHtml, safeUrl, showToast } from '../core/utils.js';

export function syncTierDropzoneState(url) {
  const zone  = document.getElementById('tier-item-dropzone');
  const icon  = document.getElementById('tier-item-dropzone-icon');
  const label = document.getElementById('tier-item-dropzone-label');
  if (!zone) return;
  if (url) {
    zone.classList.add('has-image');
    if (icon)  icon.textContent  = '✅';
    if (label) label.textContent = 'Imagen lista — hacé click para reemplazarla';
  } else {
    zone.classList.remove('has-image');
    if (icon)  icon.textContent  = '🖼';
    if (label) label.textContent = 'Arrastrá una imagen aquí o hacé click para elegir';
  }
}


export function initTierItemDropzone() {
  const zone      = document.getElementById('tier-item-dropzone');
  const fileInput = document.getElementById('tier-item-image-file');
  const urlInput  = document.getElementById('tier-item-image-input');
  const progress  = document.getElementById('tier-item-upload-progress');
  const clearBtn  = document.getElementById('tier-item-image-clear-btn');
  if (!zone || !fileInput) return;

  // ── Click en la dropzone → abre el selector de archivos ──
  zone.addEventListener('click', () => fileInput.click());

  // ── Drag-and-drop ──────────────────────────────────────
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleTierImageFile(file);
  });

  // ── Selección por file input (también lo usa initImageUploader) ──
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    await handleTierImageFile(file);
  });

  // ── Botón "✕ Quitar imagen" ─────────────────────────────
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (urlInput) urlInput.value = '';
      updateAssetPreview('tier-item', '');
      syncTierDropzoneState('');
    });
  }

  async function handleTierImageFile(file) {
    // Feedback inmediato
    if (progress) progress.classList.remove('hidden');
    zone.style.pointerEvents = 'none';

    const getOldUrl = () => {
      const item = state.editingTierItemId ? state.tierItems.find(i => i.id === state.editingTierItemId) : null;
      return item ? (item.image_url || '') : '';
    };

    try {
      const publicUrl = await uploadImageToStorage(file, 'tierlist', getOldUrl());
      if (urlInput) urlInput.value = publicUrl;
      updateAssetPreview('tier-item', publicUrl);
      syncTierDropzoneState(publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (progress) progress.classList.add('hidden');
      zone.style.pointerEvents = '';
    }
  }
}

// Dropzone genérica de imagen (click, drag&drop, quitar) para campos
// únicos de configuración global (fondo de página, favicon). Sigue el
// mismo patrón visual/funcional que la dropzone de la tierlist.
// prefix    : 'bg' | 'favicon' (ids esperados: ${prefix}-dropzone, ${prefix}-image-file,
//             ${prefix}-image-input, ${prefix}-dropzone-icon, ${prefix}-dropzone-label,
//             ${prefix}-upload-progress)
// folder    : carpeta destino en el bucket
// getOldUrl : función que devuelve la URL actual guardada (para borrado de huérfanos)
// onChange  : callback(url) llamado tras subir o quitar la imagen

export async function loadTierlist() {
  const board = document.getElementById('tierlist-board');
  const [rowsRes, itemsRes] = await Promise.all([
    supabaseClient.from('tierlist_rows').select('id,name,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('tierlist_items').select('id,row_id,column_key,name,image_url,extra_fields,sort_order').order('sort_order', { ascending: true }),
  ]);

  if (rowsRes.error || itemsRes.error) {
    console.error(rowsRes.error || itemsRes.error);
    if (board) board.innerHTML = `<div class="logs-empty"><p>No se pudo cargar la tierlist.</p></div>`;
    return;
  }

  state.tierRows = rowsRes.data;
  state.tierItems = itemsRes.data;
  state.tierlistLoaded = true;
  renderTierlist();
}


function itemsFor(rowId, columnKey) {
  return state.tierItems
    .filter(it => (it.row_id || null) === (rowId || null) && it.column_key === columnKey)
    .sort((a, b) => a.sort_order - b.sort_order);
}


function renderTierItemChip(item) {
  const safe = safeUrl(item.image_url);
  const thumb = safe
    ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(item.name)}" class="js-open-asset pixel-art" loading="lazy" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(item.name)}" />`
    : `<span class="tier-chip-initials">${escapeHtml(initialsOf(item.name))}</span>`;

  return `
    <div class="tier-item-chip"
         draggable="${isAdmin() ? 'true' : 'false'}"
         data-item-id="${item.id}"
         title="${escapeHtml(item.name)}">
      <div class="tier-chip-thumb">
        ${thumb}
        ${isAdmin() ? `
          <div class="tier-chip-admin-overlay">
            <button type="button" class="tier-chip-mini-btn" data-action="move-tier-item" data-item-id="${item.id}" title="Mover">↕</button>
            <button type="button" class="tier-chip-mini-btn" data-action="edit-tier-item" data-item-id="${item.id}" title="Editar">✏️</button>
            <button type="button" class="tier-chip-mini-btn danger" data-action="delete-tier-item" data-item-id="${item.id}" title="Eliminar">🗑️</button>
          </div>
        ` : ''}
      </div>
      <span class="tier-chip-name">${escapeHtml(item.name)}</span>
    </div>
  `;
}


export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const s = parts.map(w => w[0]).join('').toUpperCase();
  return s || '?';
}


export function renderTierlist() {
  const board = document.getElementById('tierlist-board');
  const benchColumnsEl = document.getElementById('tierlist-bench-columns');
  if (!board || !benchColumnsEl) return;

  if (state.tierRows.length === 0) {
    board.innerHTML = `<div class="logs-empty"><p>Todavía no hay filas. ${isAdmin() ? 'Crea la primera con "+ Nueva fila".' : ''}</p></div>`;
  } else {
    board.innerHTML = `
      <div class="tierlist-header-row">
        <div class="tier-label-spacer"></div>
        ${TIER_COLUMNS.map(c => `<div class="tier-column-head">${c.label}</div>`).join('')}
      </div>
      ${state.tierRows.map(row => `
        <div class="tier-row" data-row-id="${row.id}">
          <div class="tier-row-label" style="background:${row.color};">
            <span class="tier-row-name">${escapeHtml(row.name)}</span>
            ${isAdmin() ? `
              <div class="tier-row-admin-controls">
                <button type="button" class="tier-row-ctrl-btn" data-action="move-row-up" data-row-id="${row.id}" title="Subir fila">▲</button>
                <button type="button" class="tier-row-ctrl-btn" data-action="move-row-down" data-row-id="${row.id}" title="Bajar fila">▼</button>
                <button type="button" class="tier-row-ctrl-btn" data-action="edit-row" data-row-id="${row.id}" title="Editar">✏️</button>
                <button type="button" class="tier-row-ctrl-btn danger" data-action="delete-row" data-row-id="${row.id}" title="Eliminar">🗑️</button>
              </div>
            ` : ''}
          </div>
          ${TIER_COLUMNS.map(c => `
            <div class="tier-cell" data-row-id="${row.id}" data-column-key="${c.key}">
              ${itemsFor(row.id, c.key).map(renderTierItemChip).join('')}
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  }

  benchColumnsEl.innerHTML = TIER_COLUMNS.map(c => `
    <div class="tier-bench-column">
      <span class="tier-bench-column-label">${c.label}</span>
      <div class="tier-cell tier-bench-cell" data-row-id="" data-column-key="${c.key}">
        ${itemsFor(null, c.key).map(renderTierItemChip).join('')}
      </div>
    </div>
  `).join('');

  bindTierlistCellEvents();
}


function bindTierlistCellEvents() {
  const board = document.getElementById('tierlist-board');
  const bench = document.getElementById('tierlist-bench-columns');

  // ---- Drag & drop (PC) ----
  document.querySelectorAll('.tier-item-chip[draggable="true"]').forEach(chip => {
    chip.addEventListener('dragstart', (e) => {
      state.draggedTierItemId = chip.dataset.itemId;
      e.dataTransfer.effectAllowed = 'move';
    });
    chip.addEventListener('dragend', () => { state.draggedTierItemId = null; });
  });

  document.querySelectorAll('.tier-cell').forEach(cell => {
    cell.addEventListener('dragover', (e) => {
      if (!isAdmin() || !state.draggedTierItemId) return;
      e.preventDefault();
      cell.classList.add('is-drop-target');
    });
    cell.addEventListener('dragleave', () => cell.classList.remove('is-drop-target'));
    cell.addEventListener('drop', async (e) => {
      e.preventDefault();
      cell.classList.remove('is-drop-target');
      if (!isAdmin() || !state.draggedTierItemId) return;
      const rowId = cell.dataset.rowId || null;
      const columnKey = cell.dataset.columnKey;
      await moveTierItem(state.draggedTierItemId, rowId, columnKey);
      state.draggedTierItemId = null;
    });
  });

  // ---- Botones admin sobre cada chip / fila (delegado por contenedor) ----
  [board, bench].forEach(container => {
    container.querySelectorAll('[data-action="move-tier-item"]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTierMoveModal(btn.dataset.itemId); }));
    container.querySelectorAll('[data-action="edit-tier-item"]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); openTierItemModal(btn.dataset.itemId); }));
    container.querySelectorAll('[data-action="delete-tier-item"]').forEach(btn =>
      btn.addEventListener('click', (e) => { e.stopPropagation(); deleteTierItem(btn.dataset.itemId); }));
  });

  board.querySelectorAll('[data-action="edit-row"]').forEach(btn =>
    btn.addEventListener('click', () => openTierRowModal(btn.dataset.rowId)));
  board.querySelectorAll('[data-action="delete-row"]').forEach(btn =>
    btn.addEventListener('click', () => deleteTierRow(btn.dataset.rowId)));
  board.querySelectorAll('[data-action="move-row-up"]').forEach(btn =>
    btn.addEventListener('click', () => reorderTierRow(btn.dataset.rowId, -1)));
  board.querySelectorAll('[data-action="move-row-down"]').forEach(btn =>
    btn.addEventListener('click', () => reorderTierRow(btn.dataset.rowId, 1)));
}

// ---------------------------------------------------------
// FILAS (tiers)
// ---------------------------------------------------------

export function openTierRowModal(rowId = null) {
  state.editingTierRowId = rowId;
  const titleEl = document.getElementById('tier-row-modal-title');
  if (rowId) {
    const row = state.tierRows.find(r => r.id === rowId);
    if (!row) return;
    titleEl.textContent = '✏️ EDITAR FILA';
    document.getElementById('tier-row-name-input').value = row.name;
    document.getElementById('tier-row-color-input').value = row.color;
  } else {
    titleEl.textContent = '🏆 NUEVA FILA';
    document.getElementById('tier-row-name-input').value = '';
    document.getElementById('tier-row-color-input').value = '#9a92b8';
  }
  document.getElementById('tier-row-modal-error').classList.add('hidden');
  document.getElementById('tier-row-modal').classList.remove('hidden');
}


export async function submitTierRow() {
  const errorBox = document.getElementById('tier-row-modal-error');
  const name = document.getElementById('tier-row-name-input').value.trim();
  const color = document.getElementById('tier-row-color-input').value || '#9a92b8';

  if (!name) { errorBox.textContent = 'Ponle un nombre a la fila.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const rpcName = state.editingTierRowId ? 'update_tierlist_row' : 'create_tierlist_row';
  const params = state.editingTierRowId
    ? { input_code: state.adminCode, input_id: state.editingTierRowId, input_name: name, input_color: color }
    : { input_code: state.adminCode, input_name: name, input_color: color };

  const { error } = await supabaseClient.rpc(rpcName, params);
  if (error) { console.error(error); errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }

  document.getElementById('tier-row-modal').classList.add('hidden');
  showToast(state.editingTierRowId ? 'Fila actualizada' : 'Fila creada', 'success');
  suppressNextTierlistReload();
  await loadTierlist();
}


async function deleteTierRow(rowId) {
  if (!(await confirmAction({
    title: 'Eliminar fila',
    message: 'Eliminar esta fila. Sus elementos pasarán a "Sin clasificar".',
    confirmLabel: 'Eliminar fila',
    danger: true,
  }))) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_row', { input_code: state.adminCode, input_id: rowId });
  if (error) { console.error(error); showToast('No se pudo borrar la fila', 'error'); return; }
  showToast('Fila eliminada', 'success');
  suppressNextTierlistReload();
  await loadTierlist();
}


async function reorderTierRow(rowId, direction) {
  const idx = state.tierRows.findIndex(r => r.id === rowId);
  const newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= state.tierRows.length) return;

  const reordered = [...state.tierRows];
  [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
  const orderedIds = reordered.map(r => r.id);

  const { error } = await supabaseClient.rpc('reorder_tierlist_rows', { input_code: state.adminCode, input_ordered_ids: orderedIds });
  if (error) { console.error(error); showToast('No se pudo reordenar', 'error'); return; }
  suppressNextTierlistReload();
  await loadTierlist();
}

// ---------------------------------------------------------
// ELEMENTOS (items)
// ---------------------------------------------------------

export function openTierItemModal(itemId = null) {
  state.editingTierItemId = itemId;
  const titleEl = document.getElementById('tier-item-modal-title');

  if (itemId) {
    const item = state.tierItems.find(it => it.id === itemId);
    if (!item) return;
    titleEl.textContent = '✏️ EDITAR ELEMENTO';
    document.getElementById('tier-item-name-input').value = item.name;
    document.getElementById('tier-item-column-input').value = item.column_key;
    document.getElementById('tier-item-image-input').value = item.image_url || '';
    updateAssetPreview('tier-item', item.image_url || '');
    syncTierDropzoneState(item.image_url || '');
  } else {
    titleEl.textContent = '🎴 NUEVO ELEMENTO';
    document.getElementById('tier-item-name-input').value = '';
    document.getElementById('tier-item-column-input').value = 'weapon';
    document.getElementById('tier-item-image-input').value = '';
    updateAssetPreview('tier-item', '');
    syncTierDropzoneState('');
  }
  document.getElementById('tier-item-modal-error').classList.add('hidden');
  document.getElementById('tier-item-modal').classList.remove('hidden');
}


export async function submitTierItem() {
  const errorBox = document.getElementById('tier-item-modal-error');
  const name = document.getElementById('tier-item-name-input').value.trim();
  const columnKey = document.getElementById('tier-item-column-input').value;
  const imageUrl = document.getElementById('tier-item-image-input').value.trim();

  if (!name) { errorBox.textContent = 'Ponle un nombre al elemento.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const existing = state.editingTierItemId ? state.tierItems.find(it => it.id === state.editingTierItemId) : null;

  const { error } = await supabaseClient.rpc('upsert_tierlist_item', {
    input_code: state.adminCode,
    input_id: state.editingTierItemId,
    input_name: name,
    input_image_url: imageUrl,
    input_column_key: state.editingTierItemId ? existing.column_key : columnKey,
    input_row_id: state.editingTierItemId ? existing.row_id : null,
    input_extra_fields: existing ? existing.extra_fields : [],
  });

  if (error) { console.error(error); errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }

  document.getElementById('tier-item-modal').classList.add('hidden');
  showToast(state.editingTierItemId ? 'Elemento actualizado' : 'Elemento creado', 'success');
  suppressNextTierlistReload();
  await loadTierlist();
}


async function deleteTierItem(itemId) {
  if (!(await confirmAction({
    title: 'Eliminar elemento',
    message: 'Eliminar este elemento de la tierlist.',
    confirmLabel: 'Eliminar elemento',
    danger: true,
  }))) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_item', { input_code: state.adminCode, input_id: itemId });
  if (error) { console.error(error); showToast('No se pudo eliminar', 'error'); return; }
  showToast('Elemento eliminado', 'success');
  suppressNextTierlistReload();
  await loadTierlist();
}


async function moveTierItem(itemId, rowId, columnKey) {
  const { error } = await supabaseClient.rpc('move_tierlist_item', {
    input_code: state.adminCode,
    input_item_id: itemId,
    input_row_id: rowId || null,
    input_column_key: columnKey,
  });
  if (error) { console.error(error); showToast('No se pudo mover: ' + error.message, 'error'); return; }
  suppressNextTierlistReload();
  await loadTierlist();
}

// ---- Modal "Mover a..." (uso principal en móvil, donde no hay drag&drop) ----

function openTierMoveModal(itemId) {
  const item = state.tierItems.find(it => it.id === itemId);
  if (!item) return;
  state.movingTierItemId = itemId;

  document.getElementById('tier-move-item-name').textContent = `Elemento: ${item.name}`;

  const rowSelect = document.getElementById('tier-move-row-select');
  rowSelect.innerHTML = `<option value="">★ Sin clasificar</option>` +
    state.tierRows.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  rowSelect.value = item.row_id || '';

  document.getElementById('tier-move-column-select').value = item.column_key;
  document.getElementById('tier-move-modal-error').classList.add('hidden');
  document.getElementById('tier-move-modal').classList.remove('hidden');
}


export async function submitTierMove() {
  const rowId = document.getElementById('tier-move-row-select').value || null;
  const columnKey = document.getElementById('tier-move-column-select').value;
  await moveTierItem(state.movingTierItemId, rowId, columnKey);
  document.getElementById('tier-move-modal').classList.add('hidden');
}

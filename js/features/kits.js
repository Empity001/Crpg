import { disableQueryRetry, supabaseClient } from '../config.js';
import { KIT_COLUMNS, isAdmin, state, suppressNextKitsReload } from '../core/state.js';
import { buildShareUrl, cloneData, confirmAction, copyEditorPayload, copyLink, escapeHtml, getEditorPayload, hasEditorPayload, renderLoadError, safeUrl, showToast, withTimeout } from '../core/utils.js';
import { openMediaPicker } from './media-library-lazy.js';
import { appendActionGrid, appendDisclosure, openContextPanel } from '../core/context-actions.js';
import { guideLinkUrl, hydrateGuideLinkSelect, parseGuideLinkValue } from './guide-links.js';

let kitsLoadRequestId = 0;
let kitSubmitInProgress = false;
let kitsLoadPromise = null;

function emptyKitItems() {
  return { weapon: [], accessory: [], subweapon: [] };
}

function normalizeKitItems(items, { keepEmpty = false } = {}) {
  const source = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
  const normalized = emptyKitItems();
  KIT_COLUMNS.forEach((column) => {
    const list = Array.isArray(source[column.key])
      ? source[column.key].map((item) => ({
        name: String(item?.name || '').trim(),
        image_url: String(item?.image_url || '').trim(),
        guide_link: item?.guide_link || null,
      }))
      : [];
    normalized[column.key] = keepEmpty ? list : list.filter(item => item.name || item.image_url || item.guide_link);
  });
  return normalized;
}

function kitRenderSignature(kit) {
  const items = normalizeKitItems(kit?.items);
  return JSON.stringify({
    name: String(kit?.name || '').trim().toLowerCase(),
    description: String(kit?.description || '').trim(),
    published: !!kit?.published,
    items,
  });
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(part => part[0]).join('').toUpperCase() || '?';
}

function renderKitItem(item, { kitId = '', columnKey = '', index = 0 } = {}) {
  const url = safeUrl(item.image_url);
  const guideUrl = guideLinkUrl(item.guide_link);
  const thumb = url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(item.name || 'Item de kit')}" class="${guideUrl ? '' : 'js-open-asset'} pixel-art" loading="lazy" ${guideUrl ? '' : `data-asset-src="${escapeHtml(url)}" data-asset-title="${escapeHtml(item.name || 'Item de kit')}"`} />`
    : `<span class="tier-chip-initials">${escapeHtml(initialsOf(item.name))}</span>`;

  const body = `
    <div class="kit-item" data-kit-column="${escapeHtml(columnKey)}" data-kit-slot-index="${index}">
      <div class="kit-item-thumb">${thumb}</div>
      <span class="kit-item-name">${escapeHtml(item.name || 'Item sin nombre')}</span>
    </div>`;

  const linkedBody = guideUrl ? `<a class="kit-item-link" href="${escapeHtml(guideUrl)}">${body}</a>` : body;
  return `<div class="kit-item-shell">
    ${linkedBody}
    <button type="button" class="copy-link-btn kit-item-copy-link" data-copy-kit-item="${escapeHtml(String(kitId))}" data-kit-column="${escapeHtml(columnKey)}" data-kit-slot-index="${index}" aria-label="Copiar enlace de ${escapeHtml(item.name || 'este elemento')}" title="Copiar enlace">↗</button>
  </div>`;
}

function renderKitColumn(column, items, maxRows, kitId) {
  const rows = [];
  for (let index = 0; index < maxRows; index += 1) {
    const item = items[index];
    rows.push(`
      <div class="kit-slot" data-kit-column="${escapeHtml(column.key)}" data-kit-slot-index="${index}">
        ${item ? renderKitItem(item, { kitId, columnKey: column.key, index }) : '<span class="kit-empty-slot">-</span>'}
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
        <div class="kit-admin-actions">
          <button type="button" class="copy-link-btn copy-link-btn-with-label" data-copy-kit-link="${kit.id}"><span aria-hidden="true">↗</span><span>Copiar enlace</span></button>
          ${isAdmin() ? `<button type="button" class="context-menu-trigger" data-action="kit-actions" data-kit-id="${kit.id}">⋯ Acciones</button>` : ''}
        </div>
      </header>
      <div class="kit-table">
        ${KIT_COLUMNS.map(column => renderKitColumn(column, items[column.key], maxRows, kit.id)).join('')}
      </div>
    </article>
  `;
}

function renderCreateKitCard() {
  if (!isAdmin()) return '';
  return `
    <button type="button" class="kit-card admin-create-card admin-create-kit-card" data-admin-create="kit" aria-label="Agregar un nuevo kit">
      <span class="kit-card-head">
        <span>
          <span class="admin-create-eyebrow">Administración</span>
          <span class="kit-card-title">Agregar nuevo kit</span>
          <span class="kit-card-desc">Combina arma, accesorio y sub-arma sin salir del formato de los kits existentes.</span>
        </span>
        <span class="admin-create-kit-callout" aria-hidden="true">Crear kit</span>
      </span>
      <span class="admin-create-kit-slots" aria-hidden="true">
        ${KIT_COLUMNS.map(column => `
          <span class="admin-create-kit-slot">
            <span class="admin-create-plus">+</span>
            <span>${escapeHtml(column.label)}</span>
          </span>`).join('')}
      </span>
    </button>`;
}

async function performKitsLoad() {
  const grid = document.getElementById('kits-grid');
  const requestId = ++kitsLoadRequestId;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8500);
  try {
    let request = disableQueryRetry(supabaseClient.rpc('list_kits', { input_code: state.adminMode }));
    if (typeof request?.abortSignal === 'function') request = request.abortSignal(controller.signal);
    const { data, error } = await withTimeout(request, 9000, 'La carga de kits');

    if (requestId !== kitsLoadRequestId) return false;
    if (error) {
      console.error(error);
      renderLoadError(grid, 'No se pudieron cargar los kits.');
      return false;
    }

    const seen = new Set();
    const seenContent = new Set();
    state.kits = (data || []).filter((kit) => {
      if (!kit?.id) return true;
      if (seen.has(kit.id)) return false;
      const signature = kitRenderSignature(kit);
      if (seenContent.has(signature)) return false;
      seen.add(kit.id);
      seenContent.add(signature);
      return true;
    });
    state.kitsLoaded = true;
    renderKits();
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Kits]', error);
    renderLoadError(grid, 'La carga de kits tardó demasiado. Revisa tu conexión.');
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadKits() {
  if (!kitsLoadPromise) kitsLoadPromise = performKitsLoad().finally(() => { kitsLoadPromise = null; });
  return kitsLoadPromise;
}

export function renderKits() {
  const grid = document.getElementById('kits-grid');
  if (!grid) return;
  const createCard = renderCreateKitCard();

  if (!state.kits.length) {
    grid.innerHTML = `${createCard}<div class="logs-empty"><p>Todavía no hay kits recomendados.</p></div>`;
    return;
  }

  grid.innerHTML = createCard + state.kits.map(renderKitCard).join('');
  grid.querySelectorAll('[data-action="kit-actions"]').forEach(btn => {
    btn.addEventListener('click', () => openKitCardActions(btn, btn.dataset.kitId));
  });
  grid.querySelectorAll('[data-copy-kit-link]').forEach(btn => {
    btn.addEventListener('click', () => {
      void copyLink(buildShareUrl('kits.html', { kit: btn.dataset.copyKitLink }));
    });
  });
  grid.querySelectorAll('[data-copy-kit-item]').forEach(btn => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      void copyLink(buildShareUrl('kits.html', {
        kit: btn.dataset.copyKitItem,
        column: btn.dataset.kitColumn,
        slot: btn.dataset.kitSlotIndex,
      }));
    });
  });
}

function kitItemFace(item, index) {
  const image = safeUrl(item?.image_url);
  return `
    <span class="kit-context-index">${index + 1}</span>
    <div class="kit-image-preview" data-kit-image-preview>
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item?.name || 'Elemento')}" loading="lazy" />` : '<span>Sin imagen</span>'}
    </div>
    <strong>${escapeHtml(item?.name || 'Elemento sin nombre')}</strong>
    <span class="kit-context-hint">Toca para editar</span>
  `;
}

function renderKitEditor() {
  const editor = document.getElementById('kit-columns-editor');
  if (!editor) return;
  editor.innerHTML = KIT_COLUMNS.map(column => `
    <section class="kit-editor-column" data-kit-column="${column.key}">
      <div class="kit-editor-head">
        <div>
          <span class="kit-editor-title">${escapeHtml(column.label)}</span>
          <small class="kit-editor-subtitle">Selecciona un cuadro para editarlo.</small>
        </div>
        <button type="button" class="kit-add-item-btn" data-action="add-kit-item" data-column-key="${column.key}">+ Agregar</button>
      </div>
      <div class="kit-editor-list kit-context-grid">
        ${(state.kitDraftItems[column.key] || []).map((item, index) => `
          <button type="button" class="kit-editor-item kit-context-item" data-action="open-kit-item" data-column-key="${column.key}" data-index="${index}">
            ${kitItemFace(item, index)}
          </button>`).join('') || '<p class="kit-editor-empty">No hay elementos en esta columna.</p>'}
      </div>
    </section>
  `).join('');
  bindKitEditorEvents();
}

function syncKitDraftFromEditor() {
  // Los paneles contextuales escriben directamente en state.kitDraftItems.
  state.kitDraftItems = normalizeKitItems(state.kitDraftItems, { keepEmpty: true });
}

function openKitItemContext(anchor, columnKey, index) {
  const list = state.kitDraftItems[columnKey];
  const item = list?.[index];
  if (!item) return;
  const scope = 'kit-item-editor';
  openContextPanel({
    anchor,
    title: 'Elemento del kit',
    subtitle: item.name || `Elemento ${index + 1}`,
    width: 390,
    className: 'kit-item-context',
    build(root, close) {
      const nameField = document.createElement('label');
      nameField.className = 'context-field';
      nameField.innerHTML = `<span>Nombre</span><input class="modal-input" maxlength="80" value="${escapeHtml(item.name || '')}" placeholder="Nombre del elemento" />`;
      nameField.querySelector('input').addEventListener('input', event => {
        item.name = event.target.value;
        anchor.innerHTML = kitItemFace(item, index);
      });
      root.appendChild(nameField);

      const preview = document.createElement('div');
      preview.className = 'context-image-preview';
      const paintPreview = () => {
        const image = safeUrl(item.image_url);
        preview.innerHTML = image ? `<img src="${escapeHtml(image)}" alt="Vista previa" />` : '<span>Sin imagen</span>';
        anchor.innerHTML = kitItemFace(item, index);
      };
      paintPreview();
      root.appendChild(preview);

      appendActionGrid(root, [
        { label: 'Biblioteca', icon: '▦', onClick: () => openMediaPicker({
          title: 'Seleccionar imagen de kit', allowedKinds: ['image'], currentUrl: item.image_url || '',
          onSelect: ({ url }) => { item.image_url = url; paintPreview(); },
        }) },
      ]);

      appendDisclosure(root, {
        title: 'Propiedades', open: true, build(content) {
          const guide = document.createElement('label');
          const selectId = `kit-context-guide-${crypto.randomUUID()}`;
          guide.className = 'context-field';
          guide.innerHTML = `<span>Asociar a una guía</span><select class="modal-select" id="${selectId}"></select>`;
          content.appendChild(guide);
          hydrateGuideLinkSelect(selectId, item.guide_link || null);
          guide.querySelector('select').addEventListener('change', event => {
            item.guide_link = parseGuideLinkValue(event.target.value || '');
          });
        },
      });

      appendDisclosure(root, {
        title: 'Acciones', build(content) {
          appendActionGrid(content, [
            { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload(scope, item) },
            { label: 'Pegar', icon: '↧', disabled: !hasEditorPayload(scope), onClick: () => {
              const payload = getEditorPayload(scope); if (!payload) return;
              list[index] = { name: String(payload.name || ''), image_url: String(payload.image_url || ''), guide_link: payload.guide_link || null };
              close(); renderKitEditor();
            } },
            { label: 'Duplicar', icon: '⧉', onClick: () => { list.splice(index + 1, 0, cloneData(item)); close(); renderKitEditor(); } },
            { label: 'Eliminar', icon: '🗑', tone: 'danger', onClick: () => { list.splice(index, 1); close(); renderKitEditor(); } },
          ]);
        },
      });
    },
  });
}

function bindKitEditorEvents() {
  document.querySelectorAll('[data-action="add-kit-item"]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.kitDraftItems[btn.dataset.columnKey].push({ name: '', image_url: '', guide_link: null });
      renderKitEditor();
      requestAnimationFrame(() => {
        const list = document.querySelectorAll(`[data-action="open-kit-item"][data-column-key="${btn.dataset.columnKey}"]`);
        list[list.length - 1]?.click();
      });
    });
  });
  document.querySelectorAll('[data-action="open-kit-item"]').forEach(btn => {
    btn.addEventListener('click', () => openKitItemContext(btn, btn.dataset.columnKey, Number(btn.dataset.index)));
  });
}

function kitEditorPayload(kit) {
  return {
    name: kit?.name || '',
    description: kit?.description || '',
    published: kit ? !!kit.published : true,
    items: normalizeKitItems(kit?.items, { keepEmpty: true }),
  };
}

function applyKitEditorPayload(payload, { asNew = true } = {}) {
  state.editingKitId = asNew ? null : state.editingKitId;
  document.getElementById('kit-modal-title').textContent = asNew ? 'Nuevo kit' : 'Editar kit';
  document.getElementById('kit-name-input').value = payload?.name || '';
  document.getElementById('kit-description-input').value = payload?.description || '';
  document.getElementById('kit-published-input').checked = payload?.published ?? true;
  state.kitDraftItems = normalizeKitItems(payload?.items, { keepEmpty: true });
  renderKitEditor();
  document.getElementById('kit-modal-error').classList.add('hidden');
  document.getElementById('kit-modal').classList.remove('hidden');
}

function openKitCardActions(anchor, kitId) {
  const kit = state.kits.find(item => item.id === kitId);
  if (!kit) return;
  openContextPanel({
    anchor, title: 'Acciones del kit', subtitle: kit.name || '', width: 340,
    build(root, close) {
      appendActionGrid(root, [
        { label: 'Editar', icon: '✏', onClick: () => { close(); openKitModal(kitId); } },
        { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('kit-editor', kitEditorPayload(kit)) },
        { label: 'Duplicar', icon: '⧉', onClick: () => {
          const payload = kitEditorPayload(kit); payload.name = `${payload.name} (copia)`;
          close(); applyKitEditorPayload(payload, { asNew: true });
        } },
        { label: 'Pegar como nuevo', icon: '↧', disabled: !hasEditorPayload('kit-editor'), onClick: () => {
          const payload = getEditorPayload('kit-editor'); if (!payload) return;
          close(); applyKitEditorPayload(payload, { asNew: true });
        } },
        { label: 'Eliminar', icon: '🗑', tone: 'danger', onClick: () => { close(); deleteKit(kitId); } },
      ]);
    },
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

  state.kitDraftItems = normalizeKitItems(kit?.items, { keepEmpty: true });
  if (!kit) {
    KIT_COLUMNS.forEach((column) => {
      state.kitDraftItems[column.key].push({ name: '', image_url: '' });
    });
  }
  renderKitEditor();
  document.getElementById('kit-modal').classList.remove('hidden');
}

export async function submitKit() {
  if (kitSubmitInProgress) return;
  const errorBox = document.getElementById('kit-modal-error');
  const submitBtn = document.getElementById('submit-kit-btn');
  const name = document.getElementById('kit-name-input').value.trim();
  const description = document.getElementById('kit-description-input').value.trim();
  const published = document.getElementById('kit-published-input').checked;

  if (!name) {
    errorBox.textContent = 'Ponle un nombre al kit.';
    errorBox.classList.remove('hidden');
    return;
  }
  if (!state.adminMode) {
    errorBox.textContent = 'Tu sesión de administrador expiró.';
    errorBox.classList.remove('hidden');
    return;
  }

  syncKitDraftFromEditor();
  const kitItems = normalizeKitItems(state.kitDraftItems);
  kitSubmitInProgress = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.originalText = submitBtn.dataset.originalText || submitBtn.textContent;
    submitBtn.textContent = 'Guardando...';
  }

  try {
    suppressNextKitsReload();
    const { error } = await supabaseClient.rpc('upsert_kit', {
      input_code: state.adminMode,
      input_id: state.editingKitId,
      input_name: name,
      input_description: description,
      input_published: published,
      input_items: kitItems,
    });

    if (error) throw error;

    document.getElementById('kit-modal').classList.add('hidden');
    showToast(state.editingKitId ? 'Kit actualizado' : 'Kit creado', 'success');
    await loadKits();
  } catch (error) {
    console.error(error);
    errorBox.textContent = `Error: ${error.message}`;
    errorBox.classList.remove('hidden');
  } finally {
    kitSubmitInProgress = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.originalText || 'Guardar kit';
    }
  }
}

async function deleteKit(kitId) {
  const kit = state.kits.find(item => item.id === kitId);
  if (!(await confirmAction({
    title: 'Eliminar kit',
    message: `Eliminar el kit "${kit?.name || 'kit sin nombre'}".`,
    confirmLabel: 'Eliminar kit',
    danger: true,
  }))) return;

  suppressNextKitsReload();
  const { error } = await supabaseClient.rpc('delete_kit', {
    input_code: state.adminMode,
    input_id: kitId,
  });

  if (error) {
    console.error(error);
    showToast('No se pudo eliminar el kit', 'error');
    return;
  }

  showToast('Kit eliminado', 'success');
  await loadKits();
}

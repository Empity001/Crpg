// =========================================================
// media-library.js
// =========================================================
// Biblioteca Multimedia + selector reutilizable. La biblioteca guarda
// metadatos en media_assets, pero los formularios actuales siguen
// recibiendo una URL para mantener compatibilidad con image_url.
// =========================================================

import {
  DEFAULT_MEDIA_PRESENTATION,
  archiveMediaAsset,
  detectExternalMime,
  folderFromStoragePath,
  formatFileSize,
  isMediaInfrastructureMissing,
  listMediaAssets,
  mediaKindFromMime,
  mediaKindFromUrlFallback,
  storagePathFromPublicUrl,
  updateMediaAsset,
  upsertMediaAsset,
} from '../core/media.js';
import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { uploadMediaToStorage } from '../core/storage.js';
import { asArray, escapeHtml, safeUrl, showToast } from '../core/utils.js';

let mediaAssets = [];
let mediaUsageIndex = new Map();
let mediaInfrastructureReady = true;
let panelInitialized = false;
let pickerState = null;

const panelFilters = {
  search: '',
  kind: 'all',
  source: 'all',
};

const pickerFilters = {
  search: '',
  kind: 'all',
  source: 'all',
};

function normalizePresentation(presentation = {}) {
  return { ...DEFAULT_MEDIA_PRESENTATION, ...(presentation || {}) };
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

function assetFileName(asset) {
  const raw = asset.storage_path || String(asset.url || '').split('?')[0];
  return raw.split('/').pop() || asset.display_name || 'recurso';
}

function sourceLabel(asset) {
  return asset.source_type === 'external' ? 'Externo' : (asset.folder || 'Storage');
}

function kindLabel(kind) {
  return { image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento', other: 'Otro' }[kind] || kind || 'Otro';
}

function renderMediaPreview(asset, className = 'media-thumb-preview') {
  const safe = safeUrl(asset.url);
  if (!safe) return `<div class="${className} is-empty">?</div>`;
  if (asset.media_kind === 'image') {
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(asset.display_name || '')}" class="${className}" loading="lazy" />`;
  }
  if (asset.media_kind === 'video') {
    return `<video src="${escapeHtml(safe)}" class="${className}" muted playsinline controls></video>`;
  }
  return `<div class="${className} is-file">${escapeHtml(kindLabel(asset.media_kind))}</div>`;
}

function assetMatchesFilters(asset, filters, allowedKinds = null) {
  if (allowedKinds && allowedKinds.length && !allowedKinds.includes(asset.media_kind)) return false;
  if (filters.kind !== 'all' && asset.media_kind !== filters.kind) return false;
  if (filters.source !== 'all' && asset.source_type !== filters.source) return false;
  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    asset.display_name,
    asset.description,
    asset.mime_type,
    asset.folder,
    asset.url,
    ...(asset.tags || []),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

async function reloadMediaAssets() {
  const { data, error } = await listMediaAssets();
  if (error) {
    mediaInfrastructureReady = !isMediaInfrastructureMissing(error);
    mediaAssets = [];
    return { data: [], error };
  }
  mediaInfrastructureReady = true;
  mediaAssets = (data || []).filter(asset => asset.source_type !== 'external');
  return { data: mediaAssets, error: null };
}

function addUsage(map, url, label) {
  if (!url) return;
  const normalized = safeUrl(url);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(label);
}

async function buildMediaUsageIndex() {
  const usage = new Map();

  const [
    { data: logs = [] },
    { data: mobs = [] },
    { data: logItems = [] },
    { data: tierItems = [] },
    { data: weapons = [] },
    { data: ranks = [] },
  ] = await Promise.all([
    supabaseClient.from('logs').select('id,title'),
    supabaseClient.from('log_mobs').select('log_id,name,image_url'),
    supabaseClient.from('log_items').select('log_id,name,item_type,image_url'),
    supabaseClient.from('tierlist_items').select('name,image_url'),
    supabaseClient.from('weapons').select('id,name,image_url'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,image_url,upgrade_recipe'),
  ]);

  const logById = new Map(logs.map(log => [log.id, log]));
  mobs.forEach(mob => {
    const logTitle = logById.get(mob.log_id)?.title || 'Log';
    addUsage(usage, mob.image_url, `Log: ${logTitle} > Mob: ${mob.name}`);
  });
  logItems.forEach(item => {
    const logTitle = logById.get(item.log_id)?.title || 'Log';
    addUsage(usage, item.image_url, `Log: ${logTitle} > ${item.item_type === '_libre' ? 'Libre' : 'Item'}: ${item.name}`);
  });

  tierItems.forEach(item => addUsage(usage, item.image_url, `Tierlist: ${item.name}`));

  const weaponById = new Map(weapons.map(weapon => [weapon.id, weapon]));
  weapons.forEach(weapon => {
    addUsage(usage, weapon.image_url, `Arma: ${weapon.name}`);
  });
  ranks.forEach(rank => {
    const weapon = weaponById.get(rank.weapon_id);
    const weaponName = weapon?.name || 'Arma';
    addUsage(usage, rank.image_url, `Arma: ${weaponName} > Rango: ${rank.name}`);
    asArray(rank.upgrade_recipe?.materials).forEach(mat => addUsage(usage, mat.image_url, `Receta: ${weaponName} > ${mat.name}`));
    addUsage(usage, rank.upgrade_recipe?.result?.image_url, `Receta: ${weaponName} > Resultado`);
  });

  addUsage(usage, state.backgroundConfig?.image_url, 'Fondo de página');
  addUsage(usage, state.faviconUrl, 'Favicon');
  asArray(state.aboutBlocks).forEach((block, idx) => {
    if (block.kind === 'image') addUsage(usage, block.url, `Acerca del Server: imagen ${idx + 1}`);
  });

  mediaUsageIndex = usage;
  return usage;
}

function renderUsageList(asset) {
  const usages = mediaUsageIndex.get(safeUrl(asset.url)) || [];
  if (!usages.length) return '<p class="media-usage-empty">Sin usos detectados</p>';
  const visible = usages.slice(0, 4);
  const extra = usages.length - visible.length;
  return `
    <ul class="media-usage-list">
      ${visible.map(u => `<li>${escapeHtml(u)}</li>`).join('')}
      ${extra > 0 ? `<li>+ ${extra} uso(s) más</li>` : ''}
    </ul>`;
}

function renderMediaCard(asset, mode = 'panel') {
  const usages = mediaUsageIndex.get(safeUrl(asset.url)) || [];
  const tags = (asset.tags || []).slice(0, 3);
  return `
    <article class="media-card" data-media-id="${asset.id}">
      <div class="media-thumb">
        ${renderMediaPreview(asset)}
        <span class="media-kind-badge">${escapeHtml(kindLabel(asset.media_kind))}</span>
      </div>
      <div class="media-card-body">
        <h4 class="media-card-title">${escapeHtml(asset.display_name || assetFileName(asset))}</h4>
        <p class="media-card-meta">${escapeHtml(sourceLabel(asset))} · ${escapeHtml(asset.mime_type || 'MIME pendiente')} · ${escapeHtml(formatFileSize(asset.file_size))}</p>
        <p class="media-card-file">${escapeHtml(assetFileName(asset))}</p>
        ${tags.length ? `<div class="media-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="media-usage-row">
          <span>${usages.length} uso(s)</span>
          ${mode === 'panel' ? renderUsageList(asset) : ''}
        </div>
      </div>
      <div class="media-card-actions">
        ${mode === 'picker' ? `<button type="button" class="media-action-primary" data-media-pick="${asset.id}">Usar</button>` : ''}
        <button type="button" class="media-action-btn" data-media-copy="${asset.id}">Copiar URL</button>
        ${mode === 'panel' ? `<button type="button" class="media-action-btn" data-media-edit="${asset.id}">Editar</button>
        <button type="button" class="media-action-danger" data-media-archive="${asset.id}">Archivar</button>` : ''}
      </div>
    </article>`;
}

function bindMediaCardActions(root, mode = 'panel') {
  root.querySelectorAll('[data-media-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const asset = mediaAssets.find(a => a.id === btn.dataset.mediaCopy);
      if (!asset) return;
      await navigator.clipboard?.writeText(asset.url).catch(() => {});
      showToast('URL copiada', 'success');
    });
  });

  root.querySelectorAll('[data-media-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const asset = mediaAssets.find(a => a.id === btn.dataset.mediaEdit);
      if (asset) openMediaEditModal(asset);
    });
  });

  root.querySelectorAll('[data-media-archive]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const asset = mediaAssets.find(a => a.id === btn.dataset.mediaArchive);
      if (!asset || !confirm(`¿Archivar "${asset.display_name}"? No borra el archivo, solo lo oculta de la biblioteca.`)) return;
      const { error } = await archiveMediaAsset(asset.id, true);
      if (error) { showToast(error.message, 'error'); return; }
      showToast('Recurso archivado', 'success');
      await loadAndRenderMediaLibrary();
    });
  });

  if (mode === 'picker') {
    root.querySelectorAll('[data-media-pick]').forEach(btn => {
      btn.addEventListener('click', () => {
        const asset = mediaAssets.find(a => a.id === btn.dataset.mediaPick);
        if (!asset || !pickerState) return;
        const presentation = readPickerPresentation();
        pickerState.onSelect?.({ url: asset.url, asset, presentation });
        closeMediaPicker();
      });
    });
  }
}

function renderMediaGrid(container, filters, mode = 'panel', allowedKinds = null) {
  const list = mediaAssets.filter(asset => assetMatchesFilters(asset, filters, allowedKinds));
  if (!list.length) {
    container.innerHTML = '<p class="media-empty">No hay recursos con esos filtros.</p>';
    return;
  }
  container.innerHTML = list.map(asset => renderMediaCard(asset, mode)).join('');
  bindMediaCardActions(container, mode);
}

function renderMediaInfrastructureError(container) {
  container.innerHTML = `
    <div class="media-system-warning">
      <strong>Falta la migración multimedia.</strong>
      <span>Ejecuta <code>sql/migration_011_media_library.sql</code> en Supabase y vuelve a cargar Herramientas.</span>
    </div>`;
}

async function loadAndRenderMediaLibrary() {
  const grid = document.getElementById('media-library-grid');
  const status = document.getElementById('media-library-status');
  if (!grid) return;
  grid.innerHTML = '<p class="media-empty">Cargando biblioteca...</p>';
  const { error } = await reloadMediaAssets();
  if (error) {
    if (!mediaInfrastructureReady) renderMediaInfrastructureError(grid);
    else grid.innerHTML = `<p class="media-empty">No se pudo cargar la biblioteca: ${escapeHtml(error.message)}</p>`;
    return;
  }
  if (status) status.textContent = `${mediaAssets.length} recurso(s) registrados`;
  renderMediaGrid(grid, panelFilters, 'panel');
}

async function uploadLibraryFiles(files) {
  const status = document.getElementById('media-library-status');
  if (!files.length) return;
  if (status) status.textContent = `Subiendo ${files.length} recurso(s)...`;
  let ok = 0;
  for (const file of files) {
    try {
      await uploadMediaToStorage(file, 'media', '', { imageOnly: false });
      ok++;
    } catch (err) {
      showToast(`${file.name}: ${err.message}`, 'error');
    }
  }
  showToast(`${ok} recurso(s) subido(s)`, ok ? 'success' : 'error');
  await loadAndRenderMediaLibrary();
}

async function indexUsedMediaAssets() {
  const status = document.getElementById('media-library-status');
  if (status) status.textContent = 'Analizando usos actuales...';
  const usage = await buildMediaUsageIndex();
  let created = 0;
  for (const [url, usages] of usage.entries()) {
    if (mediaAssets.some(asset => safeUrl(asset.url) === url)) continue;
    const path = storagePathFromPublicUrl(url);
    if (!path) continue;
    const kind = mediaKindFromUrlFallback(url) || 'image';
    const { error } = await upsertMediaAsset({
      source_type: 'storage',
      url,
      bucket: 'culones',
      storage_path: path,
      folder: folderFromStoragePath(path),
      display_name: usages[0] || 'Recurso en uso',
      media_kind: kind === 'other' ? 'image' : kind,
      mime_type: '',
      description: `Indexado desde uso existente: ${usages[0] || ''}`,
      tags: ['indexado'],
      metadata: { indexed_from_usage: true, usages },
    });
    if (!error) created++;
  }
  showToast(`${created} recurso(s) indexado(s)`, 'success');
  await loadAndRenderMediaLibrary();
}

function bindPanelFilters() {
  document.getElementById('media-library-search')?.addEventListener('input', (e) => {
    panelFilters.search = e.target.value;
    renderMediaGrid(document.getElementById('media-library-grid'), panelFilters, 'panel');
  });
  document.getElementById('media-library-kind-filter')?.addEventListener('change', (e) => {
    panelFilters.kind = e.target.value;
    renderMediaGrid(document.getElementById('media-library-grid'), panelFilters, 'panel');
  });
  document.getElementById('media-library-source-filter')?.addEventListener('change', (e) => {
    panelFilters.source = e.target.value;
    renderMediaGrid(document.getElementById('media-library-grid'), panelFilters, 'panel');
  });
}

export function initMediaLibraryPanel() {
  const section = document.getElementById('media-library-section');
  if (!section || panelInitialized) return;
  panelInitialized = true;

  bindPanelFilters();
  document.getElementById('media-library-refresh-btn')?.addEventListener('click', loadAndRenderMediaLibrary);
  document.getElementById('media-library-index-btn')?.addEventListener('click', indexUsedMediaAssets);
  document.getElementById('media-library-upload-btn')?.addEventListener('click', () => document.getElementById('media-library-file-input')?.click());
  document.getElementById('media-library-file-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadLibraryFiles(files);
  });

  buildMediaUsageIndex().finally(loadAndRenderMediaLibrary);
}

function ensureExternalModal() {
  let modal = document.getElementById('media-external-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden media-modal-overlay';
  modal.id = 'media-external-modal';
  modal.innerHTML = `
    <div class="modal-box media-modal-box">
      <button class="modal-close" id="close-media-external-modal" aria-label="Cerrar">✕</button>
      <h3 class="modal-title media-modal-title">RECURSO EXTERNO</h3>
      <p class="modal-hint media-modal-hint">Usa una URL externa solo para el campo actual. No se guarda en la Biblioteca Multimedia.</p>
      <label class="field-label">URL</label>
      <input type="url" id="media-external-url" class="modal-input media-input" placeholder="https://..." />
      <label class="field-label">Nombre visible</label>
      <input type="text" id="media-external-name" class="modal-input media-input" maxlength="120" />
      <label class="field-label">Tipo si no se puede detectar</label>
      <select id="media-external-kind" class="modal-select media-input">
        <option value="image">Imagen</option>
        <option value="video">Video</option>
        <option value="other">Otro</option>
      </select>
      <div class="modal-error hidden" id="media-external-error"></div>
      <button class="btn-primary media-primary-btn" id="save-media-external-btn">Usar URL</button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('close-media-external-modal').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  return modal;
}

function openExternalMediaModal(onCreated = () => {}) {
  const modal = ensureExternalModal();
  const errorBox = document.getElementById('media-external-error');
  ['media-external-url', 'media-external-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('media-external-kind').value = 'image';
  errorBox.classList.add('hidden');
  modal.classList.remove('hidden');
  document.getElementById('save-media-external-btn').onclick = async () => {
    const url = document.getElementById('media-external-url').value.trim();
    const displayName = document.getElementById('media-external-name').value.trim() || assetFileName({ url });
    if (!safeUrl(url)) {
      errorBox.textContent = 'La URL debe ser http/https válida.';
      errorBox.classList.remove('hidden');
      return;
    }
    const btn = document.getElementById('save-media-external-btn');
    btn.disabled = true;
    btn.textContent = 'Detectando...';
    const mime = await detectExternalMime(url);
    const fallbackKind = document.getElementById('media-external-kind').value;
    const mediaKind = mime ? mediaKindFromMime(mime) : (fallbackKind || mediaKindFromUrlFallback(url));
    const asset = {
      id: '',
      source_type: 'external',
      url,
      display_name: displayName,
      mime_type: mime,
      media_kind: mediaKind,
      tags: [],
      presentation: DEFAULT_MEDIA_PRESENTATION,
      metadata: { external_temporary: true, external_detection: mime ? 'head' : 'manual-or-url-fallback' },
    };
    btn.disabled = false;
    btn.textContent = 'Usar URL';
    showToast('URL externa lista', 'success');
    modal.classList.add('hidden');
    onCreated(asset);
  };
}

function ensureMediaEditModal() {
  let modal = document.getElementById('media-edit-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden media-modal-overlay';
  modal.id = 'media-edit-modal';
  modal.innerHTML = `
    <div class="modal-box media-modal-box">
      <button class="modal-close" id="close-media-edit-modal" aria-label="Cerrar">✕</button>
      <h3 class="modal-title media-modal-title">EDITAR RECURSO</h3>
      <div id="media-edit-preview"></div>
      <label class="field-label">Nombre visible</label>
      <input type="text" id="media-edit-name" class="modal-input media-input" maxlength="120" />
      <label class="field-label">Descripción</label>
      <textarea id="media-edit-description" class="modal-textarea media-input" rows="3" maxlength="400"></textarea>
      <label class="field-label">Tags</label>
      <input type="text" id="media-edit-tags" class="modal-input media-input" />
      ${renderPresentationControls('edit')}
      <div class="modal-error hidden" id="media-edit-error"></div>
      <button class="btn-primary media-primary-btn" id="save-media-edit-btn">Guardar metadatos</button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('close-media-edit-modal').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  return modal;
}

function openMediaEditModal(asset) {
  const modal = ensureMediaEditModal();
  const presentation = normalizePresentation(asset.presentation);
  document.getElementById('media-edit-preview').innerHTML = `<div class="media-edit-preview">${renderMediaPreview(asset)}</div>`;
  document.getElementById('media-edit-name').value = asset.display_name || '';
  document.getElementById('media-edit-description').value = asset.description || '';
  document.getElementById('media-edit-tags').value = (asset.tags || []).join(', ');
  writePresentationControls('edit', presentation);
  document.getElementById('media-edit-error').classList.add('hidden');
  modal.classList.remove('hidden');
  document.getElementById('save-media-edit-btn').onclick = async () => {
    const btn = document.getElementById('save-media-edit-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando...';
    const { error } = await updateMediaAsset({
      id: asset.id,
      display_name: document.getElementById('media-edit-name').value.trim(),
      description: document.getElementById('media-edit-description').value.trim(),
      tags: parseTags(document.getElementById('media-edit-tags').value),
      presentation: readPresentationControls('edit'),
    });
    btn.disabled = false;
    btn.textContent = 'Guardar metadatos';
    if (error) {
      const errorBox = document.getElementById('media-edit-error');
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
      return;
    }
    showToast('Metadatos guardados', 'success');
    modal.classList.add('hidden');
    await loadAndRenderMediaLibrary();
  };
}

function renderPresentationControls(prefix) {
  return `
    <div class="media-presentation-grid">
      <label><span>Fit</span><select id="${prefix}-media-fit" class="modal-select media-input"><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>
      <label><span>Posición</span><select id="${prefix}-media-position" class="modal-select media-input"><option value="center center">Centro</option><option value="top center">Arriba</option><option value="bottom center">Abajo</option><option value="center left">Izquierda</option><option value="center right">Derecha</option></select></label>
      <label><span>Repetición</span><select id="${prefix}-media-repeat" class="modal-select media-input"><option value="no-repeat">No repetir</option><option value="repeat">Repetir</option><option value="repeat-x">Horizontal</option><option value="repeat-y">Vertical</option></select></label>
      <label><span>Opacidad</span><input type="range" id="${prefix}-media-opacity" min="0" max="1" step="0.05" value="1" /></label>
    </div>`;
}

function writePresentationControls(prefix, presentation = DEFAULT_MEDIA_PRESENTATION) {
  const p = normalizePresentation(presentation);
  document.getElementById(`${prefix}-media-fit`).value = p.fit;
  document.getElementById(`${prefix}-media-position`).value = p.position;
  document.getElementById(`${prefix}-media-repeat`).value = p.repeat;
  document.getElementById(`${prefix}-media-opacity`).value = p.opacity;
}

function readPresentationControls(prefix) {
  return {
    fit: document.getElementById(`${prefix}-media-fit`)?.value || DEFAULT_MEDIA_PRESENTATION.fit,
    position: document.getElementById(`${prefix}-media-position`)?.value || DEFAULT_MEDIA_PRESENTATION.position,
    repeat: document.getElementById(`${prefix}-media-repeat`)?.value || DEFAULT_MEDIA_PRESENTATION.repeat,
    opacity: Number(document.getElementById(`${prefix}-media-opacity`)?.value || 1),
  };
}

function readPickerPresentation() {
  return readPresentationControls('picker');
}

function ensurePickerModal() {
  let modal = document.getElementById('media-picker-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden media-modal-overlay';
  modal.id = 'media-picker-modal';
  modal.innerHTML = `
    <div class="modal-box modal-box-wide modal-box-tall media-picker-box">
      <button class="modal-close" id="close-media-picker-modal" aria-label="Cerrar">✕</button>
      <h3 class="modal-title media-modal-title" id="media-picker-title">BIBLIOTECA MULTIMEDIA</h3>
      <div class="media-toolbar media-picker-toolbar">
        <input type="search" id="media-picker-search" class="modal-input media-input" placeholder="Buscar recurso..." />
        <select id="media-picker-kind-filter" class="modal-select media-input">
          <option value="all">Todos</option>
          <option value="image">Imágenes</option>
          <option value="video">Videos</option>
        </select>
        <select id="media-picker-source-filter" class="modal-select media-input">
          <option value="all">Origen</option>
          <option value="storage">Storage</option>
        </select>
      </div>
      <div class="media-picker-actions">
        <button type="button" class="media-action-primary" id="media-picker-upload-btn">Subir recurso</button>
        <button type="button" class="media-action-btn" id="media-picker-external-btn">URL externa</button>
        <input type="file" id="media-picker-file-input" class="hidden" />
      </div>
      ${renderPresentationControls('picker')}
      <div class="media-grid media-picker-grid" id="media-picker-grid"></div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('close-media-picker-modal').addEventListener('click', closeMediaPicker);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeMediaPicker(); });
  document.getElementById('media-picker-search').addEventListener('input', (e) => {
    pickerFilters.search = e.target.value;
    renderPickerGrid();
  });
  document.getElementById('media-picker-kind-filter').addEventListener('change', (e) => {
    pickerFilters.kind = e.target.value;
    renderPickerGrid();
  });
  document.getElementById('media-picker-source-filter').addEventListener('change', (e) => {
    pickerFilters.source = e.target.value;
    renderPickerGrid();
  });
  document.getElementById('media-picker-upload-btn').addEventListener('click', () => document.getElementById('media-picker-file-input').click());
  document.getElementById('media-picker-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadLibraryFiles(files);
    await reloadMediaAssets();
    renderPickerGrid();
  });
  document.getElementById('media-picker-external-btn').addEventListener('click', () => openExternalMediaModal(async (asset) => {
    if (asset && pickerState) {
      pickerState.onSelect?.({ url: asset.url, asset, presentation: readPickerPresentation() });
      closeMediaPicker();
    }
  }));
  return modal;
}

function renderPickerGrid() {
  const grid = document.getElementById('media-picker-grid');
  if (!grid) return;
  if (!mediaInfrastructureReady) {
    renderMediaInfrastructureError(grid);
    return;
  }
  renderMediaGrid(grid, pickerFilters, 'picker', pickerState?.allowedKinds || null);
}

function closeMediaPicker() {
  document.getElementById('media-picker-modal')?.classList.add('hidden');
  pickerState = null;
}

export async function openMediaPicker({ title = 'Biblioteca Multimedia', allowedKinds = ['image'], currentUrl = '', onSelect = () => {} } = {}) {
  const modal = ensurePickerModal();
  pickerState = { allowedKinds, currentUrl, onSelect };
  pickerFilters.search = '';
  pickerFilters.kind = allowedKinds.length === 1 ? allowedKinds[0] : 'all';
  pickerFilters.source = 'all';
  document.getElementById('media-picker-title').textContent = title;
  document.getElementById('media-picker-search').value = '';
  document.getElementById('media-picker-kind-filter').value = pickerFilters.kind;
  document.getElementById('media-picker-source-filter').value = 'all';
  document.getElementById('media-picker-file-input').accept = allowedKinds.includes('video')
    ? 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng,video/mp4,video/webm'
    : 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng';
  writePresentationControls('picker', DEFAULT_MEDIA_PRESENTATION);
  modal.classList.remove('hidden');
  document.getElementById('media-picker-grid').innerHTML = '<p class="media-empty">Cargando recursos...</p>';
  await reloadMediaAssets();
  if (!mediaUsageIndex.size) buildMediaUsageIndex().then(renderPickerGrid).catch(renderPickerGrid);
  renderPickerGrid();
}

export function attachMediaPickerButton({ targetInputId, insertAfterId, label = 'Biblioteca', allowedKinds = ['image'], title = 'Seleccionar recurso', onSelect = () => {} }) {
  const target = document.getElementById(targetInputId);
  const anchor = document.getElementById(insertAfterId) || target;
  if (!target || !anchor || document.querySelector(`[data-media-picker-for="${targetInputId}"]`)) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-media-picker';
  btn.dataset.mediaPickerFor = targetInputId;
  btn.textContent = label;
  anchor.insertAdjacentElement('afterend', btn);
  btn.addEventListener('click', () => {
    openMediaPicker({
      title,
      allowedKinds,
      currentUrl: target.value,
      onSelect: ({ url, asset, presentation }) => {
        target.value = url;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        onSelect({ url, asset, presentation });
      },
    });
  });
}

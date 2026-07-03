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
  deleteMediaAsset,
  detectExternalMime,
  folderFromStoragePath,
  formatFileSize,
  isMediaInfrastructureMissing,
  listMediaAssets,
  listMediaPickerAssets,
  mediaKindFromMime,
  mediaKindFromUrlFallback,
  storagePathFromPublicUrl,
  updateMediaAsset,
  upsertMediaAsset,
} from '../core/media.js';
import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { localAuditTime, mediaAuditLabel, recordAdminAction } from '../core/audit.js';
import { uploadMediaToStorage } from '../core/storage.js';
import { asArray, debounce, escapeHtml, registerModalLifecycleCleanup, safeUrl, showToast } from '../core/utils.js';
import {
  assetFileName,
  assetMatchesFilters,
  kindLabel,
  normalizePickerAsset,
  normalizePresentation,
  parseTags,
  renderMediaPreview,
  sortedMediaList,
  sourceLabel,
} from './media-library-helpers.js';

const MEDIA_PANEL_PAGE_SIZE = 60;
const MEDIA_PICKER_PAGE_SIZE = 32;
const MEDIA_CACHE_TTL_MS = 60000;

let mediaAssets = [];
let archivedMediaAssets = [];
let pickerAssets = [];
let mediaUsageIndex = new Map();
let mediaInfrastructureReady = true;
let mediaPickerInfrastructureReady = true;
let panelInitialized = false;
let pickerState = null;
let pickerOpenToken = 0;
let pickerAssetsLoadedAt = 0;
let pickerAssetsQueryKey = '';
let pickerHasMore = false;
let pickerLoading = false;
let pickerLoadToken = 0;
let externalPreviewToken = 0;
const gridRenderState = new WeakMap();

const panelState = {
  view: 'active',
  minimized: false,
  visibleLimit: MEDIA_PANEL_PAGE_SIZE,
  scrollY: 0,
};

const panelFilters = {
  search: '',
  kind: 'all',
  source: 'all',
  sort: 'recent',
};

const pickerFilters = {
  search: '',
  kind: 'all',
  source: 'all',
  sort: 'recent',
};

function pageSizeForMode(mode) {
  return mode === 'picker' ? MEDIA_PICKER_PAGE_SIZE : MEDIA_PANEL_PAGE_SIZE;
}

function currentPanelAssets() {
  return panelState.view === 'archived' ? archivedMediaAssets : mediaAssets;
}

function setPanelStatus(text) {
  const status = document.getElementById('media-library-status');
  if (status) status.textContent = text;
}

function pickerKindForRequest() {
  const allowedKinds = pickerState?.allowedKinds || [];
  if (pickerFilters.kind !== 'all') return pickerFilters.kind;
  return allowedKinds.length === 1 ? allowedKinds[0] : 'all';
}

function pickerQueryKey() {
  return JSON.stringify({
    search: pickerFilters.search.trim(),
    kind: pickerKindForRequest(),
    source: pickerFilters.source,
    sort: pickerFilters.sort,
  });
}

function pickerCacheFresh(key = pickerQueryKey()) {
  return pickerAssets.length > 0
    && pickerAssetsQueryKey === key
    && pickerAssetsLoadedAt
    && (Date.now() - pickerAssetsLoadedAt) < MEDIA_CACHE_TTL_MS;
}

function schedulePickerInitialRender(callback) {
  const run = () => window.setTimeout(callback, 70);
  if (typeof window.requestAnimationFrame !== 'function') {
    run();
    return;
  }
  window.requestAnimationFrame(() => window.requestAnimationFrame(run));
}

function scheduleClosedPickerGridCleanup(token) {
  window.setTimeout(() => {
    if (pickerState || pickerOpenToken !== token) return;
    const grid = document.getElementById('media-picker-grid');
    if (grid) {
      grid.classList.remove('is-opening');
      grid.innerHTML = '';
    }
    setPickerStatus('');
  }, 160);
}

function cleanupPickerLifecycle() {
  document.getElementById('media-picker-grid')?.classList.remove('is-opening');
  pickerOpenToken++;
  pickerLoadToken++;
  pickerLoading = false;
  pickerState = null;
  setPickerStatus('');
}

function cleanupExternalMediaLifecycle() {
  externalPreviewToken++;
  const btn = document.getElementById('save-media-external-btn');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Usar URL';
  }
}

async function reloadMediaAssets() {
  const { data, error } = await listMediaAssets({ includeArchived: true });
  if (error) {
    mediaInfrastructureReady = !isMediaInfrastructureMissing(error);
    mediaAssets = [];
    archivedMediaAssets = [];
    return { data: [], error };
  }
  mediaInfrastructureReady = true;
  const storageAssets = (data || []).filter(asset => asset.source_type !== 'external');
  mediaAssets = storageAssets.filter(asset => !asset.is_archived);
  archivedMediaAssets = storageAssets.filter(asset => asset.is_archived);
  return { data: storageAssets, error: null };
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

function findMediaAsset(id) {
  return [...mediaAssets, ...archivedMediaAssets].find(a => a.id === id);
}

function renderMediaCard(asset, mode = 'panel') {
  const title = asset.display_name || assetFileName(asset);
  if (mode === 'picker') {
    const isCurrent = pickerState?.currentUrl && safeUrl(asset.url) === safeUrl(pickerState.currentUrl);
    return `
      <article class="media-card media-card-picker${isCurrent ? ' is-current' : ''}" data-media-id="${asset.id}">
        <button type="button" class="media-picker-card-button" data-media-pick="${asset.id}" aria-label="Usar ${escapeHtml(title)}">
          <div class="media-thumb">
            ${renderMediaPreview(asset)}
            <span class="media-kind-badge">${escapeHtml(kindLabel(asset.media_kind))}</span>
          </div>
          <div class="media-card-body">
            <h4 class="media-card-title">${escapeHtml(title)}</h4>
            <p class="media-card-meta">${escapeHtml(sourceLabel(asset))} &middot; ${escapeHtml(formatFileSize(asset.file_size))}</p>
          </div>
        </button>
      </article>`;
  }
  const usages = mediaUsageIndex.get(safeUrl(asset.url)) || [];
  const tags = (asset.tags || []).slice(0, 3);
  const archivedMode = mode === 'panel-archived';
  return `
    <article class="media-card" data-media-id="${asset.id}">
      <div class="media-thumb">
        ${renderMediaPreview(asset)}
        <span class="media-kind-badge">${escapeHtml(kindLabel(asset.media_kind))}</span>
      </div>
      <div class="media-card-body">
        <h4 class="media-card-title">${escapeHtml(title)}</h4>
        <p class="media-card-meta">${escapeHtml(sourceLabel(asset))} · ${escapeHtml(asset.mime_type || 'MIME pendiente')} · ${escapeHtml(formatFileSize(asset.file_size))}</p>
        <p class="media-card-file">${escapeHtml(assetFileName(asset))}</p>
        ${tags.length ? `<div class="media-tags">${tags.map(t => `<span>${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="media-usage-row">
          <span>${usages.length} uso(s)</span>
          ${mode !== 'picker' ? renderUsageList(asset) : ''}
        </div>
      </div>
      <div class="media-card-actions">
        ${mode === 'picker' ? `<button type="button" class="media-action-primary" data-media-pick="${asset.id}">Usar</button>` : ''}
        <button type="button" class="media-action-btn" data-media-copy="${asset.id}">Copiar URL</button>
        ${mode === 'panel' ? `<button type="button" class="media-action-btn" data-media-edit="${asset.id}">Editar</button>
        <button type="button" class="media-action-danger" data-media-archive="${asset.id}">Archivar</button>` : ''}
        ${archivedMode ? `<button type="button" class="media-action-primary" data-media-restore="${asset.id}">Restaurar</button>
        <button type="button" class="media-action-btn" data-media-edit="${asset.id}">Info</button>
        <button type="button" class="media-action-danger" data-media-delete="${asset.id}">Eliminar definitivo</button>` : ''}
      </div>
    </article>`;
}

function bindMediaCardActions(root) {
  if (!root || root.dataset.mediaActionsDelegated === 'true') return;
  root.dataset.mediaActionsDelegated = 'true';
  root.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const pickBtn = target.closest('[data-media-pick]');
    if (pickBtn && root.contains(pickBtn)) {
      const asset = pickerAssets.find(a => a.id === pickBtn.dataset.mediaPick);
      if (!asset || !pickerState) return;
      const presentation = readPickerPresentation();
      pickerState.onSelect?.({ url: asset.url, asset, presentation });
      closeMediaPicker();
      return;
    }

    const copyBtn = target.closest('[data-media-copy]');
    if (copyBtn && root.contains(copyBtn)) {
      const asset = findMediaAsset(copyBtn.dataset.mediaCopy);
      if (!asset) return;
      await navigator.clipboard?.writeText(asset.url).catch(() => {});
      showToast('URL copiada', 'success');
      return;
    }

    const editBtn = target.closest('[data-media-edit]');
    if (editBtn && root.contains(editBtn)) {
      const asset = findMediaAsset(editBtn.dataset.mediaEdit);
      if (asset) openMediaEditModal(asset);
      return;
    }

    const archiveBtn = target.closest('[data-media-archive]');
    if (archiveBtn && root.contains(archiveBtn)) {
      const asset = findMediaAsset(archiveBtn.dataset.mediaArchive);
      if (!asset || !(await confirmMediaAction({
        title: 'Archivar recurso',
        asset,
        actionLabel: 'Archivar',
        danger: false,
        message: 'El recurso saldrá de la biblioteca principal, pero seguirá existiendo en el proyecto y podrás restaurarlo desde Archivados.',
      }))) return;
      const { error } = await archiveMediaAsset(asset.id, true);
      if (error) { showToast(error.message, 'error'); return; }
      await recordAdminAction('media_archived', `Se archivó el recurso multimedia ${mediaAuditLabel(asset)} a las ${localAuditTime()}.`);
      showToast('Recurso archivado', 'success');
      await loadAndRenderMediaLibrary();
      return;
    }

    const restoreBtn = target.closest('[data-media-restore]');
    if (restoreBtn && root.contains(restoreBtn)) {
      const asset = findMediaAsset(restoreBtn.dataset.mediaRestore);
      if (!asset) return;
      const { error } = await archiveMediaAsset(asset.id, false);
      if (error) { showToast(error.message, 'error'); return; }
      await recordAdminAction('media_restored', `Se restauró el recurso multimedia ${mediaAuditLabel(asset)} a las ${localAuditTime()}.`);
      showToast('Recurso restaurado', 'success');
      panelState.view = 'active';
      await loadAndRenderMediaLibrary();
      return;
    }

    const deleteBtn = target.closest('[data-media-delete]');
    if (deleteBtn && root.contains(deleteBtn)) {
      const asset = findMediaAsset(deleteBtn.dataset.mediaDelete);
      if (!asset || !(await confirmMediaAction({
        title: 'Eliminar definitivamente',
        asset,
        actionLabel: 'Eliminar definitivo',
        danger: true,
        message: 'Esta acción borrará el registro de la Biblioteca Multimedia e intentará borrar el archivo de Storage. No es lo mismo que archivar.',
      }))) return;
      await deleteArchivedMediaAsset(asset);
    }
  });
}

function renderMediaGrid(container, filters, mode = 'panel', allowedKinds = null) {
  if (!container) return 0;
  const source = mode === 'picker' ? pickerAssets : currentPanelAssets();
  const limit = mode === 'picker' ? pickerAssets.length : panelState.visibleLimit;
  const list = mode === 'picker'
    ? source.filter(asset => !allowedKinds || !allowedKinds.length || allowedKinds.includes(asset.media_kind))
    : sortedMediaList(
      source.filter(asset => assetMatchesFilters(asset, filters, allowedKinds)),
      filters.sort,
    );
  gridRenderState.set(container, { filters, mode, allowedKinds });
  if (!list.length) {
    container.innerHTML = '<p class="media-empty">No hay recursos con esos filtros.</p>';
    return 0;
  }
  const visible = list.slice(0, limit);
  const renderMode = mode === 'panel' && panelState.view === 'archived' ? 'panel-archived' : mode;
  container.innerHTML = visible.map(asset => renderMediaCard(asset, renderMode)).join('')
    + (mode === 'picker' ? (pickerHasMore ? `
      <div class="media-load-more-row">
        <button type="button" class="media-action-btn" data-media-load-more="${mode}">Mostrar mas</button>
        <span>${visible.length} cargado(s)</span>
      </div>` : '') : (visible.length < list.length ? `
      <div class="media-load-more-row">
        <button type="button" class="media-action-btn" data-media-load-more="${mode}">Mostrar ${Math.min(pageSizeForMode(mode), list.length - visible.length)} mas</button>
        <span>${visible.length} de ${list.length}</span>
      </div>` : ''));
  bindMediaCardActions(container);
  bindMediaLoadMoreButtons(container);
  return list.length;
}

function bindMediaLoadMoreButtons(container) {
  container.querySelectorAll('[data-media-load-more]').forEach(btn => {
    if (btn.dataset.mediaLoadMoreBound === 'true') return;
    btn.dataset.mediaLoadMoreBound = 'true';
    btn.addEventListener('click', () => appendMediaGridPage(container));
  });
}

function appendMediaGridPage(container) {
  const renderState = gridRenderState.get(container);
  if (!renderState) return;
  const { filters, mode, allowedKinds } = renderState;
  if (mode === 'picker') {
    loadPickerAssets({ reset: false });
    return;
  }
  const oldLimit = panelState.visibleLimit;
  const pageSize = pageSizeForMode(mode);
  panelState.visibleLimit += pageSize;

  const source = currentPanelAssets();
  const limit = panelState.visibleLimit;
  const list = sortedMediaList(
    source.filter(asset => assetMatchesFilters(asset, filters, allowedKinds)),
    filters.sort,
  );
  const renderMode = mode === 'panel' && panelState.view === 'archived' ? 'panel-archived' : mode;
  const nextAssets = list.slice(oldLimit, limit);
  container.querySelector('.media-load-more-row')?.remove();
  if (nextAssets.length) {
    container.insertAdjacentHTML('beforeend', nextAssets.map(asset => renderMediaCard(asset, renderMode)).join(''));
    bindMediaCardActions(container);
  }
  const visibleCount = Math.min(limit, list.length);
  if (mode === 'picker') {
    const status = document.getElementById('media-picker-status');
    if (status) status.textContent = list.length ? `${visibleCount} de ${list.length} recurso(s)` : 'Sin resultados con esos filtros.';
  }
  if (visibleCount < list.length) {
    container.insertAdjacentHTML('beforeend', `
      <div class="media-load-more-row">
        <button type="button" class="media-action-btn" data-media-load-more="${mode}">Mostrar ${Math.min(pageSize, list.length - visibleCount)} mas</button>
        <span>${visibleCount} de ${list.length}</span>
      </div>`);
    bindMediaLoadMoreButtons(container);
  }
}

function renderMediaInfrastructureError(container) {
  container.innerHTML = `
    <div class="media-system-warning">
      <strong>Falta la migración multimedia.</strong>
      <span>Ejecuta <code>sql/migration_011_media_library.sql</code> en Supabase y vuelve a cargar Herramientas.</span>
    </div>`;
}

function ensureMediaConfirmModal() {
  let modal = document.getElementById('media-confirm-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden media-modal-overlay';
  modal.id = 'media-confirm-modal';
  modal.innerHTML = `
    <div class="modal-box media-modal-box">
      <button class="modal-close" id="close-media-confirm-modal" aria-label="Cerrar">✕</button>
      <h3 class="modal-title media-modal-title" id="media-confirm-title"></h3>
      <div id="media-confirm-preview"></div>
      <p class="modal-hint media-modal-hint" id="media-confirm-message"></p>
      <div class="media-confirm-usage" id="media-confirm-usage"></div>
      <div class="media-confirm-actions">
        <button type="button" class="media-action-btn" id="media-confirm-cancel-btn">Cancelar</button>
        <button type="button" class="media-action-danger" id="media-confirm-action-btn"></button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

function confirmMediaAction({ title, asset, message, actionLabel, danger = false }) {
  return new Promise(resolve => {
    const modal = ensureMediaConfirmModal();
    const usages = mediaUsageIndex.get(safeUrl(asset.url)) || [];
    document.getElementById('media-confirm-title').textContent = title;
    document.getElementById('media-confirm-preview').innerHTML = `<div class="media-edit-preview">${renderMediaPreview(asset)}</div>`;
    document.getElementById('media-confirm-message').textContent = message;
    document.getElementById('media-confirm-usage').innerHTML = usages.length
      ? `<div class="${danger ? 'media-delete-warning' : 'media-system-warning'}"><strong>${usages.length} uso(s) detectado(s)</strong>${renderUsageList(asset)}</div>`
      : '<p class="media-usage-empty">No hay usos detectados actualmente.</p>';
    const actionBtn = document.getElementById('media-confirm-action-btn');
    const cancelBtn = document.getElementById('media-confirm-cancel-btn');
    const closeBtn = document.getElementById('close-media-confirm-modal');
    actionBtn.textContent = actionLabel;
    actionBtn.className = danger ? 'media-action-danger' : 'media-action-primary';

    const cleanup = (value) => {
      modal.classList.add('hidden');
      actionBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      modal.onclick = null;
      resolve(value);
    };
    actionBtn.onclick = () => cleanup(true);
    cancelBtn.onclick = () => cleanup(false);
    closeBtn.onclick = () => cleanup(false);
    modal.onclick = (e) => { if (e.target === modal) cleanup(false); };
    modal.classList.remove('hidden');
  });
}

async function deleteArchivedMediaAsset(asset) {
  const bucket = asset.bucket || 'culones';
  const path = asset.storage_path || storagePathFromPublicUrl(asset.url);
  if (path) {
    const { error: storageError } = await supabaseClient.storage.from(bucket).remove([path]);
    if (storageError) {
      showToast('No se pudo borrar el archivo de Storage: ' + storageError.message, 'error');
      return;
    }
  }
  const { error } = await deleteMediaAsset(asset.id);
  if (error) { showToast(error.message, 'error'); return; }
  await recordAdminAction('media_deleted', `Se eliminó definitivamente el recurso multimedia ${mediaAuditLabel(asset)} a las ${localAuditTime()}.`);
  showToast('Recurso eliminado definitivamente', 'success');
  await loadAndRenderMediaLibrary();
}

async function loadAndRenderMediaLibrary() {
  const grid = document.getElementById('media-library-grid');
  if (!grid) return;
  if (panelState.minimized) {
    grid.innerHTML = '';
    setPanelStatus('Biblioteca minimizada. Los recursos no están renderizados.');
    return;
  }
  grid.innerHTML = '<p class="media-empty">Cargando biblioteca...</p>';
  const { error } = await reloadMediaAssets();
  if (error) {
    if (!mediaInfrastructureReady) renderMediaInfrastructureError(grid);
    else grid.innerHTML = `<p class="media-empty">No se pudo cargar la biblioteca: ${escapeHtml(error.message)}</p>`;
    return;
  }
  const count = panelState.view === 'archived' ? archivedMediaAssets.length : mediaAssets.length;
  setPanelStatus(`${count} recurso(s) en ${panelState.view === 'archived' ? 'Archivados' : 'Biblioteca principal'}`);
  document.querySelectorAll('[data-media-view]').forEach(btn => btn.classList.toggle('is-active', btn.dataset.mediaView === panelState.view));
  renderMediaGrid(grid, panelFilters, 'panel');
  if (panelState.scrollY) {
    const scrollY = panelState.scrollY;
    panelState.scrollY = 0;
    requestAnimationFrame(() => window.scrollTo({ top: scrollY }));
  }
}

async function uploadLibraryFiles(files, { refreshPanel = true } = {}) {
  const status = document.getElementById('media-library-status');
  if (!files.length) return;
  if (status) status.textContent = `Subiendo ${files.length} recurso(s)...`;
  let ok = 0;
  for (const file of files) {
    try {
      await uploadMediaToStorage(file, 'media', '', { imageOnly: false });
      await recordAdminAction('media_uploaded', `Se subió el recurso multimedia ${mediaAuditLabel({
        display_name: file.name,
        mime_type: file.type,
        media_kind: mediaKindFromMime(file.type),
      })} a las ${localAuditTime()}.`);
      ok++;
    } catch (err) {
      showToast(`${file.name}: ${err.message}`, 'error');
    }
  }
  showToast(`${ok} recurso(s) subido(s)`, ok ? 'success' : 'error');
  if (ok) pickerAssetsLoadedAt = 0;
  if (refreshPanel) await loadAndRenderMediaLibrary();
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
  const rerenderPanel = () => {
    panelState.visibleLimit = MEDIA_PANEL_PAGE_SIZE;
    if (panelState.minimized) return;
    renderMediaGrid(document.getElementById('media-library-grid'), panelFilters, 'panel');
  };
  const debouncedPanelSearch = debounce(rerenderPanel, 150);
  document.getElementById('media-library-search')?.addEventListener('input', (e) => {
    panelFilters.search = e.target.value;
    debouncedPanelSearch();
  });
  document.getElementById('media-library-kind-filter')?.addEventListener('change', (e) => {
    panelFilters.kind = e.target.value;
    rerenderPanel();
  });
  document.getElementById('media-library-source-filter')?.addEventListener('change', (e) => {
    panelFilters.source = e.target.value;
    rerenderPanel();
  });
  document.getElementById('media-library-sort-filter')?.addEventListener('change', (e) => {
    panelFilters.sort = e.target.value;
    rerenderPanel();
  });
}

function setMediaLibraryMinimized(minimized) {
  panelState.minimized = minimized;
  const section = document.getElementById('media-library-section');
  const grid = document.getElementById('media-library-grid');
  const toggleBtn = document.getElementById('media-library-toggle-btn');
  section?.classList.toggle('is-minimized', minimized);
  if (toggleBtn) {
    toggleBtn.textContent = minimized ? 'Expandir' : 'Minimizar';
    toggleBtn.setAttribute('aria-expanded', minimized ? 'false' : 'true');
  }
  if (minimized) {
    panelState.scrollY = window.scrollY;
    if (grid) grid.innerHTML = '';
    setPanelStatus('Biblioteca minimizada. Los recursos no están renderizados.');
  } else {
    loadAndRenderMediaLibrary();
  }
}

export function initMediaLibraryPanel() {
  const section = document.getElementById('media-library-section');
  if (!section || panelInitialized) return;
  panelInitialized = true;

  bindPanelFilters();
  document.getElementById('media-library-refresh-btn')?.addEventListener('click', loadAndRenderMediaLibrary);
  document.getElementById('media-library-index-btn')?.addEventListener('click', indexUsedMediaAssets);
  document.getElementById('media-library-upload-btn')?.addEventListener('click', () => document.getElementById('media-library-file-input')?.click());
  document.getElementById('media-library-toggle-btn')?.addEventListener('click', () => setMediaLibraryMinimized(!panelState.minimized));
  document.querySelectorAll('[data-media-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (panelState.view === btn.dataset.mediaView) return;
      panelState.view = btn.dataset.mediaView || 'active';
      panelState.visibleLimit = MEDIA_PANEL_PAGE_SIZE;
      loadAndRenderMediaLibrary();
    });
  });
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
  registerModalLifecycleCleanup('media-external-modal', { onClose: cleanupExternalMediaLifecycle });
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
        <option value="document">Documento</option>
        <option value="other">Otro</option>
      </select>
      <div class="media-external-preview" id="media-external-preview">
        <p class="media-usage-empty">Pega una URL para generar vista previa.</p>
      </div>
      <p class="media-status" id="media-external-status"></p>
      <div class="modal-error hidden" id="media-external-error"></div>
      <button class="btn-primary media-primary-btn" id="save-media-external-btn">Usar URL</button>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('close-media-external-modal').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });
  const updatePreview = debounce(() => previewExternalUrl(), 350);
  document.getElementById('media-external-url').addEventListener('input', updatePreview);
  document.getElementById('media-external-kind').addEventListener('change', () => previewExternalUrl());
  return modal;
}

async function previewExternalUrl() {
  const url = document.getElementById('media-external-url')?.value.trim() || '';
  const preview = document.getElementById('media-external-preview');
  const status = document.getElementById('media-external-status');
  const fallbackKind = document.getElementById('media-external-kind')?.value || 'image';
  const modal = document.getElementById('media-external-modal');
  const token = ++externalPreviewToken;
  if (modal?.classList.contains('hidden')) return null;
  if (!preview || !status) return null;
  if (!url) {
    preview.innerHTML = '<p class="media-usage-empty">Pega una URL para generar vista previa.</p>';
    status.textContent = '';
    return null;
  }
  const safe = safeUrl(url);
  if (!safe) {
    preview.innerHTML = '<p class="media-empty">La URL debe ser http/https válida.</p>';
    status.textContent = '';
    return null;
  }
  status.textContent = 'Detectando recurso externo...';
  const mime = await detectExternalMime(safe);
  if (modal?.classList.contains('hidden')) return null;
  if (token !== externalPreviewToken) return null;
  const urlKind = mediaKindFromUrlFallback(safe);
  const mediaKind = mime ? mediaKindFromMime(mime) : (urlKind === 'other' ? fallbackKind : urlKind);
  const asset = {
    id: '',
    source_type: 'external',
    url: safe,
    display_name: document.getElementById('media-external-name')?.value.trim() || assetFileName({ url: safe }),
    mime_type: mime,
    media_kind: mediaKind,
    tags: [],
    presentation: DEFAULT_MEDIA_PRESENTATION,
    metadata: { external_temporary: true, external_detection: mime ? 'head' : 'manual-or-url-fallback' },
  };
  preview.innerHTML = `<div class="media-edit-preview">${renderMediaPreview(asset)}</div>`;
  status.textContent = mime
    ? `${kindLabel(mediaKind)} detectado (${mime}).`
    : `${kindLabel(mediaKind)} por respaldo. No se pudo detectar MIME automáticamente.`;
  preview.dataset.mediaKind = mediaKind;
  preview.dataset.mimeType = mime || '';
  preview.dataset.safeUrl = safe;
  return asset;
}

function openExternalMediaModal(onCreated = () => {}) {
  const modal = ensureExternalModal();
  const errorBox = document.getElementById('media-external-error');
  ['media-external-url', 'media-external-name'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('media-external-kind').value = 'image';
  document.getElementById('media-external-preview').innerHTML = '<p class="media-usage-empty">Pega una URL para generar vista previa.</p>';
  document.getElementById('media-external-status').textContent = '';
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
    const previewAsset = await previewExternalUrl();
    const mime = previewAsset?.mime_type || '';
    const fallbackKind = document.getElementById('media-external-kind').value;
    const urlKind = mediaKindFromUrlFallback(url);
    const mediaKind = previewAsset?.media_kind || (mime ? mediaKindFromMime(mime) : (urlKind === 'other' ? fallbackKind : urlKind));
    const asset = {
      id: '',
      source_type: 'external',
      url: safeUrl(url),
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
    await recordAdminAction('media_updated', `Se editaron los metadatos del recurso multimedia ${mediaAuditLabel({
      ...asset,
      display_name: document.getElementById('media-edit-name').value.trim() || asset.display_name,
      tags: parseTags(document.getElementById('media-edit-tags').value),
    })} a las ${localAuditTime()}.`);
    showToast('Metadatos guardados', 'success');
    modal.classList.add('hidden');
    await loadAndRenderMediaLibrary();
  };
}

function renderPresentationControls(prefix) {
  return `
    <div class="media-presentation-grid">
      <label><span>Fit</span><select id="${prefix}-media-fit" class="modal-select media-input"><option value="contain">Contain</option><option value="cover">Cover</option><option value="fill">Fill</option></select></label>
      <label><span>Posición</span><select id="${prefix}-media-position" class="modal-select media-input"><option value="center center">Centro</option><option value="center top">Arriba</option><option value="center bottom">Abajo</option><option value="left center">Izquierda</option><option value="right center">Derecha</option></select></label>
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
  registerModalLifecycleCleanup('media-picker-modal', { onClose: cleanupPickerLifecycle });
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
        <select id="media-picker-sort-filter" class="modal-select media-input">
          <option value="recent">Más recientes</option>
          <option value="oldest">Más antiguos</option>
          <option value="name">Nombre A-Z</option>
          <option value="size">Más pesados</option>
        </select>
      </div>
      <div class="media-picker-actions">
        <button type="button" class="media-action-primary" id="media-picker-upload-btn">Subir recurso</button>
        <button type="button" class="media-action-btn" id="media-picker-external-btn">URL externa</button>
        <input type="file" id="media-picker-file-input" class="hidden" />
      </div>
      ${renderPresentationControls('picker')}
      <p class="media-status media-picker-status" id="media-picker-status"></p>
      <div class="media-grid media-picker-grid" id="media-picker-grid"></div>
    </div>`;
  document.body.appendChild(modal);
  document.getElementById('close-media-picker-modal').addEventListener('click', closeMediaPicker);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeMediaPicker(); });
  const rerenderPicker = () => {
    loadPickerAssets({ reset: true });
  };
  const debouncedPickerSearch = debounce(rerenderPicker, 150);
  document.getElementById('media-picker-search').addEventListener('input', (e) => {
    pickerFilters.search = e.target.value;
    debouncedPickerSearch();
  });
  document.getElementById('media-picker-kind-filter').addEventListener('change', (e) => {
    pickerFilters.kind = e.target.value;
    rerenderPicker();
  });
  document.getElementById('media-picker-source-filter').addEventListener('change', (e) => {
    pickerFilters.source = e.target.value;
    rerenderPicker();
  });
  document.getElementById('media-picker-sort-filter').addEventListener('change', (e) => {
    pickerFilters.sort = e.target.value;
    rerenderPicker();
  });
  document.getElementById('media-picker-upload-btn').addEventListener('click', () => document.getElementById('media-picker-file-input').click());
  document.getElementById('media-picker-file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadLibraryFiles(files, { refreshPanel: false });
    pickerAssetsLoadedAt = 0;
    await loadPickerAssets({ reset: true });
  });
  document.getElementById('media-picker-external-btn').addEventListener('click', () => openExternalMediaModal(async (asset) => {
    if (asset && pickerState) {
      pickerState.onSelect?.({ url: asset.url, asset, presentation: readPickerPresentation() });
      closeMediaPicker();
    }
  }));
  return modal;
}

function setPickerStatus(text) {
  const status = document.getElementById('media-picker-status');
  if (status) status.textContent = text;
}

function renderPickerInfrastructureError(container) {
  container.innerHTML = `
    <div class="media-system-warning">
      <strong>Falta la migracion del selector liviano.</strong>
      <span>Ejecuta <code>sql/migration_013_media_picker_light_list.sql</code> en Supabase para activar el modo selector rapido.</span>
    </div>`;
}

function updatePickerStatus() {
  if (pickerLoading) {
    setPickerStatus(pickerAssets.length ? `Cargando mas recursos... ${pickerAssets.length} ya visible(s).` : 'Cargando recursos...');
    return;
  }
  if (!pickerAssets.length) {
    setPickerStatus('Sin resultados con esos filtros.');
    return;
  }
  setPickerStatus(pickerHasMore
    ? `${pickerAssets.length} recurso(s) cargado(s). Hay mas disponibles.`
    : `${pickerAssets.length} recurso(s) cargado(s).`);
}

function appendPickerAssetsToGrid(newAssets) {
  const grid = document.getElementById('media-picker-grid');
  if (!grid) return;
  grid.querySelector('.media-load-more-row')?.remove();
  if (newAssets.length) {
    grid.insertAdjacentHTML('beforeend', newAssets.map(asset => renderMediaCard(asset, 'picker')).join(''));
    bindMediaCardActions(grid);
  }
  if (pickerHasMore) {
    grid.insertAdjacentHTML('beforeend', `
      <div class="media-load-more-row">
        <button type="button" class="media-action-btn" data-media-load-more="picker">Mostrar mas</button>
        <span>${pickerAssets.length} cargado(s)</span>
      </div>`);
    bindMediaLoadMoreButtons(grid);
  }
  updatePickerStatus();
}

async function loadPickerAssets({ reset = false } = {}) {
  const grid = document.getElementById('media-picker-grid');
  if (!grid || !pickerState || (pickerLoading && !reset)) return;

  const token = pickerState.token;
  const loadToken = ++pickerLoadToken;
  const key = pickerQueryKey();
  const offset = reset ? 0 : pickerAssets.length;

  if (reset) {
    pickerAssetsQueryKey = key;
    pickerHasMore = false;
    pickerAssets = [];
    grid.innerHTML = '<p class="media-empty">Cargando recursos...</p>';
  } else {
    const loadMoreBtn = grid.querySelector('[data-media-load-more="picker"]');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Cargando...';
    }
  }

  pickerLoading = true;
  updatePickerStatus();

  const { data, error } = await listMediaPickerAssets({
    search: pickerFilters.search.trim(),
    kind: pickerKindForRequest(),
    source: pickerFilters.source,
    sort: pickerFilters.sort,
    limit: MEDIA_PICKER_PAGE_SIZE,
    offset,
  });

  if (loadToken === pickerLoadToken) pickerLoading = false;
  if (!pickerState || pickerState.token !== token || loadToken !== pickerLoadToken) return;

  if (error) {
    mediaPickerInfrastructureReady = !isMediaInfrastructureMissing(error);
    pickerHasMore = false;
    pickerAssets = reset ? [] : pickerAssets;
    if (!mediaPickerInfrastructureReady) renderPickerInfrastructureError(grid);
    else grid.innerHTML = `<p class="media-empty">No se pudo cargar el selector: ${escapeHtml(error.message)}</p>`;
    setPickerStatus('');
    return;
  }

  mediaPickerInfrastructureReady = true;
  const newAssets = (data || []).map(normalizePickerAsset);
  pickerAssets = reset ? newAssets : [...pickerAssets, ...newAssets];
  pickerHasMore = newAssets.length === MEDIA_PICKER_PAGE_SIZE;
  pickerAssetsLoadedAt = Date.now();
  pickerAssetsQueryKey = key;

  if (reset) renderPickerGrid();
  else appendPickerAssetsToGrid(newAssets);
}

function renderPickerGrid() {
  const grid = document.getElementById('media-picker-grid');
  if (!grid) return;
  if (!mediaPickerInfrastructureReady) {
    renderPickerInfrastructureError(grid);
    setPickerStatus('');
    return;
  }
  renderMediaGrid(grid, pickerFilters, 'picker', pickerState?.allowedKinds || null);
  updatePickerStatus();
}

function closeMediaPicker() {
  document.getElementById('media-picker-modal')?.classList.add('hidden');
  document.getElementById('media-picker-grid')?.classList.remove('is-opening');
  pickerOpenToken++;
  pickerState = null;
  scheduleClosedPickerGridCleanup(pickerOpenToken);
}

export async function openMediaPicker({ title = 'Biblioteca Multimedia', allowedKinds = ['image'], currentUrl = '', onSelect = () => {} } = {}) {
  const modal = ensurePickerModal();
  const token = ++pickerOpenToken;
  pickerState = { allowedKinds, currentUrl, onSelect, token };
  pickerFilters.search = '';
  pickerFilters.kind = allowedKinds.length === 1 ? allowedKinds[0] : 'all';
  pickerFilters.source = 'all';
  pickerFilters.sort = 'recent';
  document.getElementById('media-picker-title').textContent = title;
  document.getElementById('media-picker-search').value = '';
  document.getElementById('media-picker-kind-filter').value = pickerFilters.kind;
  document.getElementById('media-picker-source-filter').value = 'all';
  document.getElementById('media-picker-sort-filter').value = 'recent';
  document.getElementById('media-picker-file-input').accept = allowedKinds.includes('video')
    ? 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng,video/mp4,video/webm'
    : 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng';
  writePresentationControls('picker', DEFAULT_MEDIA_PRESENTATION);
  const grid = document.getElementById('media-picker-grid');
  const key = pickerQueryKey();
  grid.classList.add('is-opening');
  grid.innerHTML = '<p class="media-empty">Preparando selector...</p>';
  setPickerStatus('');
  modal.classList.remove('hidden');

  schedulePickerInitialRender(async () => {
    if (!pickerState || pickerState.token !== token) return;
    grid.classList.remove('is-opening');
    if (pickerCacheFresh(key)) {
      renderPickerGrid();
      return;
    }
    if (pickerAssetsQueryKey === key && pickerAssets.length) {
      renderPickerGrid();
    } else {
      grid.innerHTML = '<p class="media-empty">Cargando recursos...</p>';
      setPickerStatus('Cargando recursos...');
    }
    await loadPickerAssets({ reset: true });
  });
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
        if (asset?.source_type !== 'external') {
          recordAdminAction(
            'media_used',
            `Se usó el recurso multimedia ${mediaAuditLabel(asset)} en "${title || label || targetInputId}" a las ${localAuditTime()}.`
          );
        }
        onSelect({ url, asset, presentation });
      },
    });
  });
}

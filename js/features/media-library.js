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
  replaceMediaAssetFileRecord,
  storagePathFromPublicUrl,
  updateMediaAsset,
  upsertMediaAsset,
} from '../core/media.js';
import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { localAuditTime, mediaAuditLabel, recordAdminAction } from '../core/audit.js';
import { removeStorageObject, stageMediaReplacement, uploadMediaToStorage, validateMediaReplacementFile } from '../core/storage.js';
import { debounce, escapeHtml, mountModal, registerModalLifecycleCleanup, safeUrl, showToast } from '../core/utils.js';
import { closeContextPanel } from '../core/context-actions.js';
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
import { buildMediaUsageIndex, renderMediaUsageList } from './media-usage.js';
import { deleteStorageObjects } from '../core/admin-api.js';

const MEDIA_PANEL_PAGE_SIZE = 60;
const MEDIA_PANEL_MOBILE_PAGE_SIZE = 24;
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
let pickerBufferedAssets = [];
let pickerRemoteHasMore = false;
let pickerLoading = false;
let pickerLoadToken = 0;
let externalPreviewToken = 0;
const gridRenderState = new WeakMap();
let mediaEditReplacementFile = null;
let mediaEditReplacementObjectUrl = '';
let mediaEditActiveAsset = null;

const panelState = {
  view: 'active',
  minimized: false,
  visibleLimit: typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
    ? MEDIA_PANEL_MOBILE_PAGE_SIZE
    : MEDIA_PANEL_PAGE_SIZE,
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

function panelPageSize() {
  return typeof window !== 'undefined' && window.matchMedia?.('(max-width: 720px)').matches
    ? MEDIA_PANEL_MOBILE_PAGE_SIZE
    : MEDIA_PANEL_PAGE_SIZE;
}

function pageSizeForMode(mode) {
  return mode === 'picker' ? MEDIA_PICKER_PAGE_SIZE : panelPageSize();
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
  const grid = document.getElementById('media-picker-grid');
  grid?.classList.remove('is-opening');
  grid?.replaceChildren();
  pickerOpenToken++;
  pickerLoadToken++;
  pickerLoading = false;
  pickerState = null;
  pickerAssets = [];
  pickerBufferedAssets = [];
  pickerRemoteHasMore = false;
  pickerHasMore = false;
  pickerAssetsLoadedAt = 0;
  pickerAssetsQueryKey = '';
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

async function refreshMediaUsageIndex() {
  mediaUsageIndex = await buildMediaUsageIndex();
  return mediaUsageIndex;
}

function renderUsageList(asset) {
  return renderMediaUsageList(asset, mediaUsageIndex);
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
            ${renderMediaPreview(asset, 'media-thumb-preview', { loading: 'eager' })}
            <span class="media-kind-badge">${escapeHtml(kindLabel(asset.media_kind))}</span>
          </div>
          <div class="media-card-body">
            <h4 class="media-card-title">${escapeHtml(title)}</h4>
            <p class="media-card-meta">${escapeHtml(sourceLabel(asset))} &middot; ${escapeHtml(formatFileSize(asset.file_size))}</p>
            <span class="media-picker-select-hint">Usar imagen</span>
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

async function commitPickerSelection(asset, trigger = null) {
  if (!asset || !pickerState) return;
  const activeState = pickerState;
  const presentation = readPickerPresentation();

  trigger?.classList.add('is-selecting');
  trigger?.setAttribute('aria-busy', 'true');
  const hint = trigger?.querySelector?.('.media-picker-select-hint');
  if (hint) hint.textContent = 'Seleccionando…';

  try {
    await Promise.resolve(activeState.onSelect?.({ url: asset.url, asset, presentation }));
    closeMediaPicker();
  } catch (error) {
    trigger?.classList.remove('is-selecting');
    trigger?.removeAttribute('aria-busy');
    if (hint) hint.textContent = 'Usar imagen';
    showToast(error?.message || 'No se pudo seleccionar el recurso', 'error');
  }
}

function bindMediaCardActions(root) {
  if (!root || root.dataset.mediaActionsDelegated === 'true') return;
  root.dataset.mediaActionsDelegated = 'true';
  root.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const pickBtn = target.closest('[data-media-pick]');
    if (pickBtn && root.contains(pickBtn)) {
      event.preventDefault();
      event.stopPropagation();
      const requestedId = String(pickBtn.dataset.mediaPick || '');
      const asset = pickerAssets.find(a => String(a.id) === requestedId);
      if (!asset || !pickerState) return;
      await commitPickerSelection(asset, pickBtn.closest('.media-picker-card-button') || pickBtn);
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

function pickerAssetKey(asset) {
  return String(asset?.id || safeUrl(asset?.url) || '').trim();
}

function uniquePickerAssets(list = [], existing = []) {
  const seen = new Set(existing.map(pickerAssetKey).filter(Boolean));
  const result = [];
  list.forEach((asset) => {
    const key = pickerAssetKey(asset);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(asset);
  });
  return result;
}

function splitPickerResponse(rawAssets = [], existing = []) {
  const unique = uniquePickerAssets(rawAssets, existing);
  const page = unique.slice(0, MEDIA_PICKER_PAGE_SIZE);
  const overflow = unique.slice(MEDIA_PICKER_PAGE_SIZE);
  return { page, overflow, rawCount: rawAssets.length };
}

function bindMediaPreviewFallbacks(root) {
  if (!root) return;
  root.querySelectorAll('img.media-thumb-preview').forEach((img) => {
    if (img.dataset.previewFallbackBound === 'true') return;
    img.dataset.previewFallbackBound = 'true';
    img.addEventListener('load', () => {
      img.closest('.media-thumb')?.classList.remove('is-preview-error');
    }, { once: true });
    img.addEventListener('error', () => {
      img.closest('.media-thumb')?.classList.add('is-preview-error');
      img.remove();
    }, { once: true });
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
  bindMediaPreviewFallbacks(container);
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
  mountModal(modal);
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
    const { error: storageError } = await deleteStorageObjects(bucket, [path]);
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
  const usage = await refreshMediaUsageIndex();
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
    panelState.visibleLimit = panelPageSize();
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
      panelState.visibleLimit = panelPageSize();
      loadAndRenderMediaLibrary();
    });
  });
  document.getElementById('media-library-file-input')?.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    await uploadLibraryFiles(files);
  });

  refreshMediaUsageIndex().finally(loadAndRenderMediaLibrary);
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
  mountModal(modal);
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


function clearMediaEditReplacement({ keepAsset = false } = {}) {
  if (mediaEditReplacementObjectUrl) URL.revokeObjectURL(mediaEditReplacementObjectUrl);
  mediaEditReplacementObjectUrl = '';
  mediaEditReplacementFile = null;
  if (!keepAsset) mediaEditActiveAsset = null;

  const input = document.getElementById('media-replace-file-input');
  if (input) input.value = '';
  const pending = document.getElementById('media-replace-pending');
  if (pending) {
    pending.classList.add('hidden');
    pending.innerHTML = '';
  }
  const button = document.getElementById('replace-media-file-btn');
  if (button) {
    button.disabled = true;
    button.textContent = 'Reemplazar en todos los usos';
  }
}

function closeMediaEditModal() {
  document.getElementById('media-edit-modal')?.classList.add('hidden');
  clearMediaEditReplacement();
}

function mediaReplacementAccept(asset) {
  const kind = asset?.media_kind && asset.media_kind !== 'other'
    ? asset.media_kind
    : mediaKindFromUrlFallback(asset?.url);
  return kind === 'video'
    ? 'video/mp4,video/webm'
    : 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng';
}

function selectMediaReplacementFile(file) {
  const errorBox = document.getElementById('media-edit-error');
  errorBox?.classList.add('hidden');
  if (!mediaEditActiveAsset) return;

  try {
    const expectedKind = mediaEditActiveAsset.media_kind && mediaEditActiveAsset.media_kind !== 'other'
      ? mediaEditActiveAsset.media_kind
      : mediaKindFromUrlFallback(mediaEditActiveAsset.url);
    const nextKind = validateMediaReplacementFile(file, expectedKind === 'other' ? '' : expectedKind);
    clearMediaEditReplacement({ keepAsset: true });
    mediaEditReplacementFile = file;
    mediaEditReplacementObjectUrl = URL.createObjectURL(file);

    const pending = document.getElementById('media-replace-pending');
    if (pending) {
      pending.classList.remove('hidden');
      pending.innerHTML = `
        <div class="media-replace-preview">
          ${renderMediaPreview({
            ...mediaEditActiveAsset,
            url: mediaEditReplacementObjectUrl,
            display_name: file.name,
            mime_type: file.type,
            media_kind: nextKind,
          }, 'media-thumb-preview', { loading: 'eager' })}
        </div>
        <div class="media-replace-file-info">
          <strong>${escapeHtml(file.name)}</strong>
          <span>${escapeHtml(file.type || 'Tipo desconocido')} · ${escapeHtml(formatFileSize(file.size))}</span>
          <small>El archivo nuevo sustituirá al anterior en todos sus usos detectados.</small>
        </div>`;
    }
    const button = document.getElementById('replace-media-file-btn');
    if (button) button.disabled = false;
  } catch (error) {
    if (errorBox) {
      errorBox.textContent = error.message;
      errorBox.classList.remove('hidden');
    }
  }
}

async function commitMediaFileReplacement() {
  const asset = mediaEditActiveAsset;
  const file = mediaEditReplacementFile;
  const errorBox = document.getElementById('media-edit-error');
  const button = document.getElementById('replace-media-file-btn');
  if (!asset || !file || !button) return;

  const confirmed = await confirmMediaAction({
    title: 'Reemplazar recurso en todos sus usos',
    asset,
    actionLabel: 'Reemplazar archivo',
    danger: false,
    message: 'Se subirá el archivo nuevo, se actualizarán automáticamente todas las referencias detectadas y, al finalizar, se borrará el archivo anterior de Storage.',
  });
  if (!confirmed) return;

  button.disabled = true;
  button.textContent = 'Reemplazando y actualizando usos...';
  errorBox?.classList.add('hidden');
  let staged = null;

  try {
    staged = await stageMediaReplacement(file, asset);
    const metadata = {
      ...(asset.metadata || {}),
      replacement_original_name: file.name || '',
      replacement_client_time: new Date().toISOString(),
    };
    const { data, error } = await replaceMediaAssetFileRecord({
      id: asset.id,
      url: staged.url,
      storagePath: staged.path,
      displayName: document.getElementById('media-edit-name')?.value.trim() || asset.display_name,
      description: document.getElementById('media-edit-description')?.value.trim() || '',
      mimeType: staged.mimeType,
      mediaKind: staged.mediaKind,
      fileSize: staged.fileSize,
      fileHash: staged.hash,
      tags: parseTags(document.getElementById('media-edit-tags')?.value || ''),
      presentation: readPresentationControls('edit'),
      metadata,
    });

    if (error) throw error;

    const oldPath = data?.old_storage_path || staged.oldPath;
    if (oldPath && oldPath !== staged.path) {
      const { error: removeError } = await removeStorageObject(oldPath, staged.bucket);
      if (removeError) {
        showToast('El reemplazo se aplicó, pero no se pudo borrar el archivo anterior de Storage.', 'warning');
      }
    }

    const updatedRecords = Number(data?.updated_records || 0);
    showToast(`Recurso reemplazado en ${updatedRecords} registro(s)`, 'success');
    closeMediaEditModal();
    pickerAssetsLoadedAt = 0;
    await refreshMediaUsageIndex();
    await loadAndRenderMediaLibrary();
  } catch (error) {
    if (staged?.path) await removeStorageObject(staged.path, staged.bucket).catch(() => {});
    const message = /replace_media_asset_file|schema cache|could not find/i.test(String(error?.message || ''))
      ? 'Falta ejecutar sql/migration_019_replace_media_asset.sql en Supabase.'
      : (error?.message || 'No se pudo reemplazar el recurso.');
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.classList.remove('hidden');
    }
    button.disabled = false;
    button.textContent = 'Reemplazar en todos los usos';
  }
}

function ensureMediaEditModal() {
  let modal = document.getElementById('media-edit-modal');
  if (modal) return modal;
  registerModalLifecycleCleanup('media-edit-modal', { onClose: () => clearMediaEditReplacement() });
  modal = document.createElement('div');
  modal.className = 'modal-overlay hidden media-modal-overlay';
  modal.id = 'media-edit-modal';
  modal.innerHTML = `
    <div class="modal-box modal-box-tall media-modal-box media-edit-box">
      <button class="modal-close" id="close-media-edit-modal" aria-label="Cerrar">✕</button>
      <h3 class="modal-title media-modal-title">EDITAR RECURSO</h3>
      <div id="media-edit-preview"></div>

      <section class="media-replace-section">
        <div class="media-replace-heading">
          <div>
            <strong>Reemplazar archivo</strong>
            <span id="media-replace-usage-summary">Mantiene todos los usos del recurso.</span>
          </div>
          <span class="media-replace-kind" id="media-replace-kind"></span>
        </div>
        <p class="media-replace-help">Sube un archivo nuevo y la página actualizará automáticamente logs, guías, recetas, kits, tierlist y ajustes que usen el recurso anterior.</p>
        <input type="file" id="media-replace-file-input" class="hidden" />
        <div class="media-replace-actions">
          <button type="button" class="media-action-btn" id="choose-media-replacement-btn">Elegir archivo nuevo</button>
          <button type="button" class="media-action-primary" id="replace-media-file-btn" disabled>Reemplazar en todos los usos</button>
        </div>
        <div class="media-replace-pending hidden" id="media-replace-pending"></div>
      </section>

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
  mountModal(modal);
  document.getElementById('close-media-edit-modal').addEventListener('click', closeMediaEditModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeMediaEditModal(); });
  document.getElementById('choose-media-replacement-btn').addEventListener('click', () => {
    document.getElementById('media-replace-file-input')?.click();
  });
  document.getElementById('media-replace-file-input').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) selectMediaReplacementFile(file);
  });
  document.getElementById('replace-media-file-btn').addEventListener('click', commitMediaFileReplacement);
  return modal;
}

function openMediaEditModal(asset) {
  const modal = ensureMediaEditModal();
  clearMediaEditReplacement();
  mediaEditActiveAsset = asset;
  const presentation = normalizePresentation(asset.presentation);
  document.getElementById('media-edit-preview').innerHTML = `<div class="media-edit-preview">${renderMediaPreview(asset)}</div>`;
  document.getElementById('media-edit-name').value = asset.display_name || '';
  document.getElementById('media-edit-description').value = asset.description || '';
  document.getElementById('media-edit-tags').value = (asset.tags || []).join(', ');
  writePresentationControls('edit', presentation);
  document.getElementById('media-edit-error').classList.add('hidden');
  const usageCount = (mediaUsageIndex.get(safeUrl(asset.url)) || []).length;
  document.getElementById('media-replace-usage-summary').textContent = usageCount
    ? `${usageCount} uso(s) detectado(s); todos se actualizarán automáticamente.`
    : 'No hay usos detectados; el recurso de Storage igualmente será reemplazado.';
  document.getElementById('media-replace-kind').textContent = kindLabel(asset.media_kind);
  document.getElementById('media-replace-file-input').accept = mediaReplacementAccept(asset);
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
    closeMediaEditModal();
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
  mountModal(modal);
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
    bindMediaPreviewFallbacks(grid);
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

  if (reset) {
    pickerAssetsQueryKey = key;
    pickerHasMore = false;
    pickerRemoteHasMore = false;
    pickerBufferedAssets = [];
    pickerAssets = [];
    grid.innerHTML = '<p class="media-empty">Cargando recursos...</p>';
  } else if (pickerBufferedAssets.length) {
    const nextAssets = pickerBufferedAssets.splice(0, MEDIA_PICKER_PAGE_SIZE);
    pickerAssets = [...pickerAssets, ...nextAssets];
    pickerHasMore = pickerBufferedAssets.length > 0 || pickerRemoteHasMore;
    appendPickerAssetsToGrid(nextAssets);
    return;
  } else {
    const loadMoreBtn = grid.querySelector('[data-media-load-more="picker"]');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = true;
      loadMoreBtn.textContent = 'Cargando...';
    }
  }

  pickerLoading = true;
  updatePickerStatus();

  const offset = reset ? 0 : pickerAssets.length;
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
    pickerRemoteHasMore = false;
    pickerBufferedAssets = [];
    pickerAssets = reset ? [] : pickerAssets;
    if (!mediaPickerInfrastructureReady) renderPickerInfrastructureError(grid);
    else grid.innerHTML = `<p class="media-empty">No se pudo cargar el selector: ${escapeHtml(error.message)}</p>`;
    setPickerStatus('');
    return;
  }

  mediaPickerInfrastructureReady = true;
  const normalized = (data || []).map(normalizePickerAsset);
  const { page, overflow, rawCount } = splitPickerResponse(normalized, reset ? [] : pickerAssets);

  // Algunas instalaciones antiguas de la RPC ignoran input_limit y devuelven
  // toda la biblioteca. Solo montamos 32 tarjetas por tanda y guardamos el
  // resto como metadatos, evitando cientos de <img> simultáneas y duplicados.
  pickerBufferedAssets = overflow;
  pickerRemoteHasMore = rawCount <= MEDIA_PICKER_PAGE_SIZE && rawCount === MEDIA_PICKER_PAGE_SIZE;
  if (!page.length && !overflow.length) pickerRemoteHasMore = false;

  pickerAssets = reset ? page : [...pickerAssets, ...page];
  pickerHasMore = pickerBufferedAssets.length > 0 || pickerRemoteHasMore;
  pickerAssetsLoadedAt = Date.now();
  pickerAssetsQueryKey = key;

  if (reset) renderPickerGrid();
  else appendPickerAssetsToGrid(page);
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
  const grid = document.getElementById('media-picker-grid');
  if (grid) {
    grid.classList.remove('is-opening');
    grid.replaceChildren();
  }
  pickerOpenToken++;
  pickerLoadToken++;
  pickerLoading = false;
  pickerState = null;
  pickerAssets = [];
  pickerBufferedAssets = [];
  pickerRemoteHasMore = false;
  pickerHasMore = false;
  pickerAssetsLoadedAt = 0;
  pickerAssetsQueryKey = '';
  setPickerStatus('');
}

export async function openMediaPicker({ title = 'Biblioteca Multimedia', allowedKinds = ['image'], currentUrl = '', onSelect = () => {} } = {}) {
  // El selector multimedia siempre debe ser la capa superior. Si se abrió
  // desde un menú contextual, ese menú ya no es necesario y además podría
  // interceptar clics por encima del selector.
  closeContextPanel();
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
  grid.classList.add('is-opening');
  grid.innerHTML = '<p class="media-empty">Preparando selector...</p>';
  setPickerStatus('');
  modal.classList.remove('hidden');
  const pickerBox = modal.querySelector('.media-picker-box');
  if (pickerBox) pickerBox.scrollTop = 0;
  if (grid) grid.scrollTop = 0;

  schedulePickerInitialRender(async () => {
    if (!pickerState || pickerState.token !== token) return;
    grid.classList.remove('is-opening');
    grid.innerHTML = '<p class="media-empty">Cargando recursos...</p>';
    setPickerStatus('Cargando recursos...');
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
  btn.innerHTML = `<span class="btn-media-picker-icon" aria-hidden="true">▦</span><span>${escapeHtml(label)}</span>`;
  btn.setAttribute('aria-label', `${label}: ${title}`);
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

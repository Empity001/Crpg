// =========================================================
// import.js
// =========================================================
// Importador de respaldos v1/v2. Valida y compara primero; la escritura se
// ejecuta en una sola Edge Function que conserva IDs y relaciones. Es una
// restauración por mezcla: nunca elimina registros que no estén en el archivo.
// =========================================================

import { restoreBackup } from '../core/admin-api.js';
import { state, suppressNextRealtimeReload, suppressNextTierlistReload } from '../core/state.js';
import { escapeHtml, showToast } from '../core/utils.js';
import { loadLogsData } from './logs-data.js';
import { loadTierlist } from './tierlist.js';
import { loadKits } from './kits.js';
import { fetchWeaponsDataForExport } from './weapons-data.js';
import { isMediaInfrastructureMissing, listMediaAssets } from '../core/media.js';
import { backupTypeLabel } from './backup-helpers.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_RECORDS = 30_000;
let importPayload = null;
let importBaseline = {};

export let _importConflicts = [];

const list = value => Array.isArray(value) ? value : [];

function ensureId(item) {
  if (item && typeof item === 'object' && !item.id) item.id = crypto.randomUUID();
  return item;
}

function normalizePayloadIds(payload) {
  const logs = list(payload.logs || payload.data);
  logs.forEach(log => {
    ensureId(log);
    list(log.mobs).forEach(ensureId);
    list(log.items).forEach(ensureId);
  });
  list(payload.rows || payload.tierlist?.rows).forEach(ensureId);
  list(payload.items || payload.tierlist?.items).forEach(ensureId);
  list(payload.weapons).forEach(ensureId);
  list(payload.kits).forEach(ensureId);
  if (Array.isArray(payload.weapon_ranks)) payload.weapon_ranks.forEach(ensureId);
  else if (payload.weapon_ranks && typeof payload.weapon_ranks === 'object') Object.values(payload.weapon_ranks).forEach(ranks => list(ranks).forEach(ensureId));
}

function backupCounts(payload) {
  const logs = list(payload.logs || payload.data);
  const rows = list(payload.rows || payload.tierlist?.rows);
  const items = list(payload.items || payload.tierlist?.items);
  const guides = list(payload.weapons);
  const kits = list(payload.kits);
  const media = list(payload.media_assets);
  const dependencies = list(payload.categories).length + list(payload.weapon_categories).length + list(payload.weapon_types).length + list(payload.app_settings).length;
  const logEntries = logs.reduce((sum, log) => sum + list(log.mobs).length + list(log.items).length, 0);
  const ranks = Array.isArray(payload.weapon_ranks)
    ? payload.weapon_ranks.length
    : Object.values(payload.weapon_ranks || {}).reduce((sum, values) => sum + list(values).length, 0);
  return { logs: logs.length, logEntries, rows: rows.length, items: items.length, guides: guides.length, ranks, kits: kits.length, media: media.length, dependencies };
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('El archivo no contiene un respaldo válido.');
  if (!['logs', 'tierlist', 'full_backup'].includes(payload.type)) throw new Error('El tipo de respaldo no es compatible con esta web.');
  const version = Number(payload.version || 1);
  if (!Number.isFinite(version) || version < 1 || version > 2) throw new Error(`La versión ${payload.version} todavía no es compatible.`);
  if (payload.schema && payload.schema !== 'culones-rpg-backup') throw new Error('El JSON pertenece a otra aplicación.');
  const counts = backupCounts(payload);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total > MAX_RECORDS) throw new Error(`El respaldo contiene ${total} registros; el límite de seguridad es ${MAX_RECORDS}.`);
  if (payload.type === 'logs' && counts.logs === 0) throw new Error('El respaldo de Logs está vacío.');
  if (payload.type === 'tierlist' && counts.rows + counts.items === 0) throw new Error('El respaldo de Tierlist está vacío.');
  return { version, counts, total };
}

function showFileSummary(file, validation) {
  const target = document.getElementById('import-file-summary');
  if (!target) return;
  const { counts } = validation;
  target.classList.remove('hidden');
  target.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>JSON v${validation.version} · ${escapeHtml(backupTypeLabel(importPayload.type))} · ${(file.size / 1024).toFixed(1)} KB</span><small>${counts.logs} logs · ${counts.logEntries} fichas · ${counts.guides} Guías · ${counts.ranks} variantes · ${counts.kits} kits · ${counts.rows + counts.items} elementos de Tierlist · ${counts.media} recursos</small>`;
}

export async function handleImportFile(file) {
  if (!file) return;
  if (!/\.json$/i.test(file.name) && file.type !== 'application/json') {
    showToast('Solo se pueden restaurar respaldos JSON.', 'error');
    return;
  }
  if (file.size > MAX_FILE_SIZE) {
    showToast('El respaldo supera el límite de 20 MB.', 'error');
    return;
  }

  showToast('Validando respaldo…', 'default');
  try {
    const parsed = JSON.parse(await file.text());
    const validation = validatePayload(parsed);
    normalizePayloadIds(parsed);
    importPayload = parsed;
    showFileSummary(file, validation);
    importBaseline = await prepareImportBaseline(parsed.type);
    analyzeAndShowImportConflicts(parsed);
  } catch (error) {
    console.error('[Import]', error);
    showToast(error instanceof SyntaxError ? 'El archivo no es un JSON válido.' : error.message, 'error');
  }
}

async function prepareImportBaseline(type) {
  const baseline = {};
  const tasks = [];
  if (type === 'logs' || type === 'full_backup') tasks.push(loadLogsData().then(() => { baseline.logs = state.logs; }));
  if (type === 'tierlist' || type === 'full_backup') tasks.push(loadTierlist().then(() => { baseline.tierRows = state.tierRows; baseline.tierItems = state.tierItems; }));
  if (type === 'full_backup') {
    tasks.push(fetchWeaponsDataForExport().then(data => { baseline.weaponData = data; }));
    tasks.push(loadKits().then(() => { baseline.kits = state.kits; }));
    tasks.push(listMediaAssets({ includeArchived: true }).then(result => {
      baseline.media = result.error && !isMediaInfrastructureMissing(result.error) ? [] : (result.data || []);
      baseline.mediaUnavailable = !!result.error;
    }));
  }
  await Promise.all(tasks);
  return baseline;
}

function conflict(kind, id, name, existingIds, item) {
  const isConflict = existingIds.has(String(id));
  return { kind, id: String(id), name, isConflict, item, resolution: isConflict ? 'skip' : 'import' };
}

function analyzeAndShowImportConflicts(payload) {
  const conflicts = [];
  const logIds = new Set(list(importBaseline.logs).map(item => String(item.id)));
  list(payload.logs || payload.data).forEach(log => conflicts.push(conflict('log', log.id, `[Log] ${log.title || 'Sin título'}`, logIds, log)));

  const rowIds = new Set(list(importBaseline.tierRows).map(item => String(item.id)));
  list(payload.rows || payload.tierlist?.rows).forEach(row => conflicts.push(conflict('tier_row', row.id, `[Tier] ${row.name || 'Fila'}`, rowIds, row)));
  const tierItemIds = new Set(list(importBaseline.tierItems).map(item => String(item.id)));
  list(payload.items || payload.tierlist?.items).forEach(item => conflicts.push(conflict('tier_item', item.id, `[Tierlist] ${item.name || 'Elemento'}`, tierItemIds, item)));

  if (payload.type === 'full_backup') {
    const weaponIds = new Set(list(importBaseline.weaponData?.weapons).map(item => String(item.id)));
    list(payload.weapons).forEach(weapon => conflicts.push(conflict('weapon', weapon.id, `[Guía] ${weapon.name || 'Sin nombre'}`, weaponIds, weapon)));
    const kitIds = new Set(list(importBaseline.kits).map(item => String(item.id)));
    list(payload.kits).forEach(kit => conflicts.push(conflict('kit', kit.id, `[Kit] ${kit.name || 'Sin nombre'}`, kitIds, kit)));

    const mediaByIdOrUrl = new Set(list(importBaseline.media).flatMap(item => [String(item.id || ''), String(item.url || '')]).filter(Boolean));
    list(payload.media_assets).filter(asset => (asset.source_type || 'storage') === 'storage').forEach(asset => {
      const id = asset.id || asset.url;
      const hasConflict = importBaseline.mediaUnavailable || mediaByIdOrUrl.has(String(asset.id || '')) || mediaByIdOrUrl.has(String(asset.url || ''));
      conflicts.push({ kind: 'media_asset', id: String(id), name: `[Multimedia] ${asset.display_name || asset.url || 'Recurso'}`, isConflict: hasConflict, item: asset, resolution: hasConflict ? 'skip' : 'import' });
    });

    if (list(payload.app_settings).length || payload.field_config) {
      conflicts.push({ kind: 'app_settings', id: '__all__', name: '[Apariencia] Configuración general de la web', isConflict: true, item: payload.app_settings || payload.field_config, resolution: 'skip' });
    }
  }

  _importConflicts = conflicts;
  showImportConflictModal(conflicts);
}

function showImportConflictModal(conflicts) {
  const modal = document.getElementById('import-conflict-modal');
  const summary = document.getElementById('import-conflict-summary');
  const target = document.getElementById('import-conflict-list');
  if (!modal || !summary || !target) return;
  const conflictsCount = conflicts.filter(item => item.isConflict).length;
  summary.textContent = `${conflicts.length} elemento(s): ${conflicts.length - conflictsCount} nuevos y ${conflictsCount} ya existentes. Restaurar mezcla datos; no elimina registros ausentes del archivo.`;
  target.innerHTML = conflicts.map((item, index) => `<div class="import-conflict-row ${item.isConflict ? 'is-conflict' : 'is-new'}"><span class="import-conflict-name">${item.isConflict ? '⚠' : '✓'} ${escapeHtml(item.name)}</span><div class="import-conflict-toggle"><label class="import-radio-label"><input type="radio" name="conflict-${index}" value="import" ${item.resolution === 'import' ? 'checked' : ''} data-idx="${index}">${item.isConflict ? 'Sobrescribir' : 'Importar'}</label><label class="import-radio-label"><input type="radio" name="conflict-${index}" value="skip" ${item.resolution === 'skip' ? 'checked' : ''} data-idx="${index}">Saltar</label></div></div>`).join('');
  target.onchange = event => {
    const radio = event.target.closest('input[type="radio"][data-idx]');
    if (radio) _importConflicts[Number(radio.dataset.idx)].resolution = radio.value;
  };
  document.getElementById('import-conflict-error')?.classList.add('hidden');
  modal.classList.remove('hidden');
}

export function setAllImportResolutions(resolution) {
  _importConflicts.forEach((item, index) => {
    item.resolution = resolution;
    const radio = document.querySelector(`input[name="conflict-${index}"][value="${resolution}"]`);
    if (radio) radio.checked = true;
  });
}

export async function confirmImport() {
  const errorBox = document.getElementById('import-conflict-error');
  const button = document.getElementById('import-conflict-confirm-btn');
  if (!state.adminMode) {
    if (errorBox) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); }
    return;
  }
  const selected = _importConflicts.filter(item => item.resolution === 'import').map(item => ({ kind: item.kind, id: item.id }));
  if (!selected.length) {
    showToast('No seleccionaste elementos para restaurar.');
    document.getElementById('import-conflict-modal')?.classList.add('hidden');
    return;
  }

  if (button) { button.disabled = true; button.textContent = 'Restaurando…'; }
  if (errorBox) errorBox.classList.add('hidden');
  showToast(`Restaurando ${selected.length} grupo(s)…`, 'default');
  const result = await restoreBackup(importPayload, selected);
  if (button) { button.disabled = false; button.textContent = 'Restaurar seleccionados'; }
  if (result.error) {
    if (errorBox) { errorBox.textContent = result.error.message || 'No se pudo restaurar el respaldo.'; errorBox.classList.remove('hidden'); }
    return;
  }

  const counts = result.data?.counts || {};
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  document.getElementById('import-conflict-modal')?.classList.add('hidden');
  document.getElementById('import-file-summary')?.classList.add('hidden');
  showToast(`Restauración completada: ${total} registro(s) procesados.`, 'success');
  suppressNextRealtimeReload();
  suppressNextTierlistReload();
  state.kitsLoaded = false;
  state.weaponsLoaded = false;
  if (importPayload.type === 'logs' || importPayload.type === 'full_backup') await loadLogsData();
  if (importPayload.type === 'tierlist' || importPayload.type === 'full_backup') await loadTierlist();
}

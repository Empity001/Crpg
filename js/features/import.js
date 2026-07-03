// =========================================================
// import.js
// =========================================================
// Importación de JSON: lectura de archivo, detección de conflictos
// contra los datos actuales, modal de confirmación y aplicación final
// vía RPC.
// =========================================================

import { supabaseClient } from '../config.js';
import { loadLogsData } from './logs-data.js';
import { state, suppressNextRealtimeReload, suppressNextTierlistReload } from '../core/state.js';
import { loadTierlist } from './tierlist.js';
import { isMediaInfrastructureMissing, listMediaAssets, upsertMediaAsset } from '../core/media.js';
import { countSummary, localAuditTime, recordAdminAction } from '../core/audit.js';
import { asArray, escapeHtml, showToast } from '../core/utils.js';
import { backupTypeLabel } from './backup-helpers.js';

let _importPayload = null; // datos del archivo leído

export let _importConflicts = []; // [{item, resolution: 'overwrite'|'skip'}]


export async function handleImportFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'json') { showToast('Solo se soportan archivos JSON por ahora', 'error'); return; }

  showToast('Leyendo archivo...', 'default');
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch(e) { showToast('El archivo no es un JSON válido', 'error'); return; }

  _importPayload = parsed;
  await prepareImportBaseline(parsed.type);
  await analyzeAndShowImportConflicts(parsed);
}

async function prepareImportBaseline(type) {
  if (type === 'logs' || type === 'full_backup') {
    await loadLogsData();
  }
  if (type === 'tierlist' || type === 'full_backup') {
    await loadTierlist();
  }
}


async function analyzeAndShowImportConflicts(payload) {
  const type = payload.type;
  const allConflicts = [];

  if (type === 'logs' || type === 'full_backup') {
    const existingIds = new Set(state.logs.map(l => l.id));
    const importLogs = payload.data || payload.logs || [];
    importLogs.forEach(log => {
      allConflicts.push({
        kind: 'log',
        id: log.id,
        name: log.title,
        isConflict: existingIds.has(log.id),
        item: log,
        resolution: existingIds.has(log.id) ? 'skip' : 'import',
      });
    });
  }

  if (type === 'tierlist' || type === 'full_backup') {
    const existingRowIds = new Set(state.tierRows.map(r => r.id));
    const importRows = payload.rows || payload.tierlist?.rows || [];
    importRows.forEach(row => {
      allConflicts.push({
        kind: 'tier_row',
        id: row.id,
        name: `[Fila] ${row.name}`,
        isConflict: existingRowIds.has(row.id),
        item: row,
        resolution: existingRowIds.has(row.id) ? 'skip' : 'import',
      });
    });
    const existingItemIds = new Set(state.tierItems.map(i => i.id));
    const importItems = payload.items || payload.tierlist?.items || [];
    importItems.forEach(item => {
      allConflicts.push({
        kind: 'tier_item',
        id: item.id,
        name: `[Item] ${item.name}`,
        isConflict: existingItemIds.has(item.id),
        item,
        resolution: existingItemIds.has(item.id) ? 'skip' : 'import',
      });
    });
  }

  if (type === 'full_backup') {
    const importMedia = (payload.media_assets || []).filter(asset => (asset.source_type || 'storage') === 'storage');
    if (importMedia.length) {
      const { data: existingMedia, error } = await listMediaAssets({ includeArchived: true });
      const mediaInfrastructureMissing = error && isMediaInfrastructureMissing(error);
      const existingUrls = new Set((existingMedia || []).map(asset => asset.url).filter(Boolean));
      const existingHashes = new Set((existingMedia || []).map(asset => asset.file_hash).filter(Boolean));
      if (error && !mediaInfrastructureMissing) console.warn('Media import conflict check skipped:', error);

      importMedia.forEach(asset => {
        const hasConflict = existingUrls.has(asset.url) || (!!asset.file_hash && existingHashes.has(asset.file_hash));
        allConflicts.push({
          kind: 'media_asset',
          id: asset.id || asset.url,
          name: `[Multimedia] ${asset.display_name || asset.url || 'Recurso'}${mediaInfrastructureMissing ? ' (migración pendiente)' : ''}`,
          isConflict: mediaInfrastructureMissing || hasConflict,
          item: asset,
          resolution: mediaInfrastructureMissing || hasConflict ? 'skip' : 'import',
        });
      });
    }
  }

  _importConflicts = allConflicts;
  showImportConflictModal(allConflicts);
}


function showImportConflictModal(conflicts) {
  const modal = document.getElementById('import-conflict-modal');
  const summaryEl = document.getElementById('import-conflict-summary');
  const listEl = document.getElementById('import-conflict-list');

  const conflictCount = conflicts.filter(c => c.isConflict).length;
  const newCount = conflicts.filter(c => !c.isConflict).length;

  summaryEl.textContent = `${conflicts.length} elemento(s) encontrados: ${newCount} nuevos, ${conflictCount} con conflicto.`;

  listEl.innerHTML = conflicts.map((c, idx) => `
    <div class="import-conflict-row ${c.isConflict ? 'is-conflict' : 'is-new'}">
      <span class="import-conflict-name">${c.isConflict ? '⚠️' : '✅'} ${escapeHtml(c.name)}</span>
      <div class="import-conflict-toggle">
        <label class="import-radio-label">
          <input type="radio" name="conflict-${idx}" value="import" ${c.resolution !== 'skip' ? 'checked' : ''} data-idx="${idx}" />
          ${c.isConflict ? 'Sobrescribir' : 'Importar'}
        </label>
        <label class="import-radio-label">
          <input type="radio" name="conflict-${idx}" value="skip" ${c.resolution === 'skip' ? 'checked' : ''} data-idx="${idx}" />
          Saltar
        </label>
      </div>
    </div>`).join('');

  listEl.onchange = (event) => {
    const radio = event.target.closest('input[type="radio"][data-idx]');
    if (!radio) return;
    _importConflicts[Number(radio.dataset.idx)].resolution = radio.value;
  };

  modal.classList.remove('hidden');
}


export async function confirmImport() {
  const errorBox = document.getElementById('import-conflict-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const toImport = _importConflicts.filter(c => c.resolution !== 'skip');
  if (toImport.length === 0) { showToast('Nada que importar'); document.getElementById('import-conflict-modal').classList.add('hidden'); return; }

  showToast(`Importando ${toImport.length} elemento(s)...`, 'default');
  let imported = 0;
  let errors = 0;
  const importedCounts = { log: 0, tier_row: 0, tier_item: 0, media_asset: 0 };

  for (const conflict of toImport) {
    try {
      if (conflict.kind === 'log') {
        const log = conflict.item;
        const mobsPayload = (log.mobs || []).map(({ name, health, damage, armor, equipment, location, description, extra_fields, image_url }) => ({
          name, health, damage, armor, equipment, location, description: description || null,
          extra_fields: asArray(extra_fields), image_url: image_url || null,
        }));
        const itemsPayload = (log.items || []).map(({ name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url }) => ({
          name, tier, item_type, obtained_from, damage: damage ?? null,
          enchantments: asArray(enchantments), description: description || null,
          extra_fields: asArray(extra_fields), image_url: image_url || null,
        }));

        if (conflict.isConflict) {
          // Sobrescribir: update_log
          await supabaseClient.rpc('update_log', {
            input_code: state.adminCode, input_id: log.id,
            input_title: log.title, input_description: log.description,
            input_category: log.category, input_relevance: log.relevance,
            input_created_at: log.created_at, input_mobs: mobsPayload, input_items: itemsPayload,
          });
        } else {
          // Nuevo: create_log
          await supabaseClient.rpc('create_log', {
            input_code: state.adminCode,
            input_title: log.title, input_description: log.description,
            input_category: log.category, input_relevance: log.relevance,
            input_created_at: log.created_at, input_mobs: mobsPayload, input_items: itemsPayload,
          });
        }
        imported++;
        importedCounts.log++;
      } else if (conflict.kind === 'tier_row') {
        const row = conflict.item;
        if (conflict.isConflict) {
          await supabaseClient.rpc('update_tierlist_row', { input_code: state.adminCode, input_id: row.id, input_name: row.name, input_color: row.color });
        } else {
          await supabaseClient.rpc('create_tierlist_row', { input_code: state.adminCode, input_name: row.name, input_color: row.color });
        }
        imported++;
        importedCounts.tier_row++;
      } else if (conflict.kind === 'tier_item') {
        const item = conflict.item;
        await supabaseClient.rpc('upsert_tierlist_item', {
          input_code: state.adminCode, input_id: conflict.isConflict ? item.id : null,
          input_name: item.name, input_image_url: item.image_url || null,
          input_column_key: item.column_key, input_row_id: item.row_id || null,
          input_extra_fields: asArray(item.extra_fields),
        });
        imported++;
        importedCounts.tier_item++;
      } else if (conflict.kind === 'media_asset') {
        const { error } = await upsertMediaAsset(conflict.item);
        if (error) throw error;
        imported++;
        importedCounts.media_asset++;
      }
    } catch(e) {
      console.error('Import error:', e);
      errors++;
    }
  }

  document.getElementById('import-conflict-modal').classList.add('hidden');
  document.getElementById('import-file-input').value = '';
  showToast(`Importación completa: ${imported} ok${errors > 0 ? `, ${errors} error(es)` : ''}`, errors > 0 ? 'error' : 'success');
  const importType = backupTypeLabel(_importPayload?.type || 'logs');
  const details = [
    countSummary('logs', importedCounts.log),
    countSummary('filas tierlist', importedCounts.tier_row),
    countSummary('items tierlist', importedCounts.tier_item),
    countSummary('recursos multimedia', importedCounts.media_asset),
  ].filter(Boolean).join(', ');
  await recordAdminAction(
    'import_completed',
    `Se importó un backup de ${importType}${details ? ` (${details})` : ''}${errors ? ` con ${errors} error(es)` : ''} a las ${localAuditTime()}.`
  );
  suppressNextRealtimeReload();
  suppressNextTierlistReload();
  await loadLogsData();
  if (state.tierlistLoaded) await loadTierlist();
}

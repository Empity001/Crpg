// =========================================================
// export.js
// =========================================================
// Exportación a Excel (SheetJS) y JSON: estilos compartidos,
// construcción de hojas, y las funciones
// exportLogsXlsx/exportTierlistXlsx/exportAllXlsx/exportData que arma
// usa la pestaña Herramientas.
// =========================================================

import { parseEquipment, parseLibreFields } from './blocks-display.js';
import { RELEVANCE_LABELS, TIER_COLUMNS, getCategory, state } from '../core/state.js';
import { disableQueryRetry, supabaseClient } from '../config.js';
import { loadCategoriesData } from './categories.js';
import { loadLogsData } from './logs-data.js';
import { loadTierlist } from './tierlist.js';
import { loadKits } from './kits.js';
import { isMediaInfrastructureMissing, listMediaAssets } from '../core/media.js';
import { countSummary, localAuditTime, recordAdminAction } from '../core/audit.js';
import { asArray, formatDate, showToast } from '../core/utils.js';
import { fetchWeaponsDataForExport } from './weapons-data.js';
import { auditDetails, backupFileStamp, backupTypeLabel, downloadFile } from './backup-helpers.js';
import { getAdminBackupBundle } from '../core/admin-api.js';

const BACKUP_SCHEMA = 'culones-rpg-backup';
const BACKUP_VERSION = 2;
let xlsxLoadPromise = null;

async function ensureXlsx() {
  if (window.XLSX) return true;
  if (!xlsxLoadPromise) {
    xlsxLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => reject(new Error('No se pudo cargar el generador de Excel.'));
      document.head.appendChild(script);
    }).catch(error => {
      xlsxLoadPromise = null;
      throw error;
    });
  }
  return xlsxLoadPromise;
}

function formatEquipmentText(raw) {
  const list = parseEquipment(raw);
  if (!list.length) return '';
  return list.map(eq => {
    const ench = (eq.enchantments || []).map(e => e.name).filter(Boolean);
    return ench.length ? `${eq.name} [${ench.join(', ')}]` : eq.name;
  }).join('; ');
}

function formatEnchantmentsText(arr) {
  return asArray(arr).map(e => e.name).filter(Boolean).join(', ');
}


function formatExtraFieldsText(arr) {
  const list = asArray(arr);
  if (!list.length) return '';
  return list.map(f => `${f.key}: ${f.value ?? ''}`).join('; ');
}


function formatLibreFieldsText(fields) {
  if (!fields || !fields.length) return '';
  return fields.map(f => {
    if (f.subfields && f.subfields.length) {
      const subs = f.subfields.map(sf => `${sf.key}: ${sf.value ?? ''}`).join(', ');
      return `${f.key} [${subs}]`;
    }
    return `${f.key}: ${f.value ?? ''}`;
  }).join('; ');
}


async function getMediaAssetsForExport() {
  const { data, error } = await listMediaAssets({ includeArchived: true });
  if (error) {
    if (!isMediaInfrastructureMissing(error)) console.warn('Media export skipped:', error);
    return [];
  }
  return data || [];
}

async function getAppSettingsForExport() {
  const { data, error } = await disableQueryRetry(
    supabaseClient.from('app_settings').select('key,value,updated_at').order('key', { ascending: true })
  );
  if (error) {
    console.warn('App settings export skipped:', error);
    return [];
  }
  return data || [];
}

function logsWithBlocks() {
  return state.logs.map(log => ({
    ...log,
    mobs: state.mobsByLog[log.id] || [],
    items: state.itemsByLog[log.id] || [],
  }));
}

function backupEnvelope(type) {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    type,
    app: 'culones-rpg',
    exported_at: new Date().toISOString(),
  };
}

export async function collectExportBundle(type = 'all') {
  const scope = ['logs', 'tierlist'].includes(type) ? type : 'all';
  const envelopeType = scope === 'all' ? 'full_backup' : scope;
  const bundleResult = await getAdminBackupBundle(scope);
  if (!bundleResult.error && bundleResult.data) {
    const settings = listSettingValues(bundleResult.data.app_settings);
    const bundle = {
      ...backupEnvelope(envelopeType),
      ...bundleResult.data,
    };
    if (scope === 'all') bundle.field_config = {
        mob: settings.mob_fields || state.fieldConfig.mob,
        item: settings.item_fields || state.fieldConfig.item,
    };
    return bundle;
  }

  // Compatibilidad durante el breve intervalo entre Pages y el redeploy de
  // la Edge Function: usa las lecturas anteriores, siempre bajo demanda.
  console.warn('[Export] backup_bundle no disponible; usando carga compatible:', bundleResult.error?.message);
  if (type === 'logs') {
    await Promise.all([loadLogsData(), loadCategoriesData()]);
    return { ...backupEnvelope('logs'), logs: logsWithBlocks(), categories: state.categories };
  }
  if (type === 'tierlist') {
    if (!state.tierlistLoaded) await loadTierlist();
    return { ...backupEnvelope('tierlist'), tierlist: { rows: state.tierRows, items: state.tierItems } };
  }
  await Promise.all([loadLogsData(), loadCategoriesData(), state.tierlistLoaded ? Promise.resolve() : loadTierlist(), state.kitsLoaded ? Promise.resolve() : loadKits()]);
  const [weaponData, mediaAssets, appSettings] = await Promise.all([fetchWeaponsDataForExport(), getMediaAssetsForExport(), getAppSettingsForExport()]);
  return { ...backupEnvelope('full_backup'), logs: logsWithBlocks(), categories: state.categories, tierlist: { rows: state.tierRows, items: state.tierItems }, weapons: weaponData.weapons, weapon_categories: weaponData.categories, weapon_types: weaponData.types, weapon_ranks: weaponData.ranksByWeapon, kits: state.kits, media_assets: mediaAssets, app_settings: appSettings, field_config: state.fieldConfig };
}

function listSettingValues(settings) {
  return Object.fromEntries((Array.isArray(settings) ? settings : []).map(setting => [setting.key, setting.value]));
}

function hydrateLogsBundle(bundle) {
  state.logs = bundle.logs || [];
  state.mobsByLog = {};
  state.itemsByLog = {};
  state.logs.forEach(log => {
    state.mobsByLog[log.id] = log.mobs || [];
    state.itemsByLog[log.id] = log.items || [];
  });
  if (bundle.categories) state.categories = bundle.categories;
}

function hydrateTierlistBundle(bundle) {
  state.tierRows = bundle.tierlist?.rows || [];
  state.tierItems = bundle.tierlist?.items || [];
  state.tierlistLoaded = true;
}


// ---------------------------------------------------------
// ESTILOS EXCEL COMPARTIDOS
// Paleta de colores consistente para todas las hojas.
// ---------------------------------------------------------

const XL_STYLE = {
  // Encabezado principal (fila de columnas)
  header: {
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
    fill: { fgColor: { rgb: '1A1035' } },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      bottom: { style: 'medium', color: { rgb: '7C3AED' } },
      right:  { style: 'thin',   color: { rgb: '3D2E6B' } },
    },
  },
  // Título de la hoja (fila 0, celda fusionada)
  title: {
    font: { bold: true, color: { rgb: 'E2D9F3' }, sz: 14 },
    fill: { fgColor: { rgb: '0C0A14' } },
    alignment: { horizontal: 'left', vertical: 'center' },
  },
  // Filas de datos (alternadas)
  rowEven: {
    fill: { fgColor: { rgb: '1A1035' } },
    alignment: { vertical: 'top', wrapText: true },
    border: { right: { style: 'thin', color: { rgb: '2D2050' } } },
  },
  rowOdd: {
    fill: { fgColor: { rgb: '120D2C' } },
    alignment: { vertical: 'top', wrapText: true },
    border: { right: { style: 'thin', color: { rgb: '2D2050' } } },
  },
  // Celda numérica
  number: {
    alignment: { horizontal: 'center', vertical: 'top' },
    border: { right: { style: 'thin', color: { rgb: '2D2050' } } },
  },
};

// ---------------------------------------------------------
// HELPERS PARA CONSTRUIR HOJAS CON ESTILO
// ---------------------------------------------------------

/**
 * Crea una hoja de cálculo estilizada a partir de headers + rows.
 * @param {string} sheetTitle  Título visible en la fila 1 (fusionada).
 * @param {string[]} headers   Nombres de las columnas.
 * @param {Array[]} rows       Filas de datos (arrays de valores primitivos).
 * @param {number[]} [numericCols]  Índices de columnas que son numéricas.
 * @param {number[]} [colWidths]    Anchos en caracteres para cada columna.
 * @returns {object} Hoja de trabajo SheetJS.
 */

function buildXlSheet(sheetTitle, headers, rows, numericCols = [], colWidths = []) {
  const ws = {};
  const R_TITLE  = 0; // fila 0: título
  const R_HEADER = 1; // fila 1: encabezados
  const R_DATA   = 2; // fila 2+: datos

  const ncols = headers.length;
  const nrows = rows.length;

  // --- Celda de título (fusionada) ---
  const titleCell = `A${R_TITLE + 1}`;
  ws[titleCell] = { v: sheetTitle, t: 's', s: XL_STYLE.title };

  // --- Encabezados ---
  headers.forEach((h, ci) => {
    const addr = XLSX.utils.encode_cell({ r: R_HEADER, c: ci });
    ws[addr] = { v: h, t: 's', s: XL_STYLE.header };
  });

  // --- Datos ---
  rows.forEach((row, ri) => {
    const isEven = ri % 2 === 0;
    const baseStyle = isEven ? XL_STYLE.rowEven : XL_STYLE.rowOdd;
    row.forEach((val, ci) => {
      const addr = XLSX.utils.encode_cell({ r: R_DATA + ri, c: ci });
      const isNum = numericCols.includes(ci);
      const v = val == null ? '' : val;
      ws[addr] = {
        v,
        t: isNum && typeof v === 'number' ? 'n' : 's',
        s: isNum ? { ...baseStyle, ...XL_STYLE.number } : baseStyle,
      };
    });
  });

  // --- Rango ---
  ws['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(R_DATA + nrows - 1, R_HEADER), c: ncols - 1 },
  });

  // --- Fusionar celda de título ---
  ws['!merges'] = [{ s: { r: R_TITLE, c: 0 }, e: { r: R_TITLE, c: ncols - 1 } }];

  // --- Filtros automáticos (fila de encabezados) ---
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({
    s: { r: R_HEADER, c: 0 }, e: { r: R_HEADER, c: ncols - 1 },
  }) };

  // --- Ancho de columnas ---
  const defaultWidth = 18;
  ws['!cols'] = headers.map((h, i) => ({
    wch: colWidths[i] || Math.max(defaultWidth, h.length + 2),
  }));

  // --- Filas: altura del título y encabezado ---
  ws['!rows'] = [{ hpt: 28 }, { hpt: 36 }];

  return ws;
}

// ---------------------------------------------------------
// DESCARGA DE WORKBOOK XLSX
// ---------------------------------------------------------

function downloadXlsx(workbook, filename) {
  const buf = XLSX.write(workbook, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------
// DATOS DE LOGS → HOJAS EXCEL
// Reutiliza la misma lógica de extracción que exportLogsCsv()
// pero genera objetos de hoja SheetJS en lugar de texto CSV.
// ---------------------------------------------------------

function buildLogsSheets() {
  // — Hoja 1: Logs —
  const logsHeaders = [
    'ID', 'Título', 'Descripción', 'Categoría', 'Emoji Cat.',
    'Relevancia', 'Likes', 'Fecha', 'Fecha (ISO)', 'Portada (URL)',
    '# Mobs', '# Items', '# Extras',
  ];
  const logsRows = state.logs.map(log => {
    const mobs  = state.mobsByLog[log.id]  || [];
    const items = state.itemsByLog[log.id] || [];
    const libres = items.filter(i => i.item_type === '_libre');
    const normalItems = items.filter(i => i.item_type !== '_libre');
    const cat = getCategory(log.category);
    return [
      log.id, log.title, log.description || '', cat.label, cat.emoji || '',
      RELEVANCE_LABELS[log.relevance] || log.relevance,
      log.likes || 0, formatDate(log.created_at), log.created_at, log.cover_image_url || '',
      mobs.length, normalItems.length, libres.length,
    ];
  });

  // — Hoja 2: Mobs —
  const mobsHeaders = [
    'ID Log', 'Título del Log', 'Nombre del Mob',
    'Vida', 'Daño', 'Armor',
    'Equipamiento', 'Dónde aparece', 'Descripción', 'Imagen (URL)', 'Algo más',
  ];
  const mobsRows = [];

  // — Hoja 3: Items —
  const itemsHeaders = [
    'ID Log', 'Título del Log', 'Nombre del Item',
    'Rango/Tier', 'Tipo', 'Dónde se obtiene',
    'Daño', 'Encantamientos', 'Descripción', 'Imagen (URL)', 'Algo más',
  ];
  const itemsRows = [];

  // — Hoja 4: Bloques Libres —
  const libresHeaders = [
    'ID Log', 'Título del Log', 'Nombre del Bloque',
    'Campos', 'Descripción', 'Imagen (URL)',
  ];
  const libresRows = [];

  state.logs.forEach(log => {
    (state.mobsByLog[log.id] || []).forEach(mob => {
      mobsRows.push([
        log.id, log.title, mob.name,
        mob.health ?? '', mob.damage ?? '', mob.armor ?? '',
        formatEquipmentText(mob.equipment),
        mob.location || '', mob.description || '',
        mob.image_url || '', formatExtraFieldsText(mob.extra_fields),
      ]);
    });
    (state.itemsByLog[log.id] || []).forEach(item => {
      if (item.item_type === '_libre') {
        libresRows.push([
          log.id, log.title, item.name,
          formatLibreFieldsText(parseLibreFields(item)),
          item.description || '', item.image_url || '',
        ]);
      } else {
        itemsRows.push([
          log.id, log.title, item.name,
          item.tier || '', item.item_type || '', item.obtained_from || '',
          item.damage ?? '', formatEnchantmentsText(item.enchantments),
          item.description || '', item.image_url || '',
          formatExtraFieldsText(item.extra_fields),
        ]);
      }
    });
  });

  return {
    wsLogs:  buildXlSheet(`📜 Logs  (${logsRows.length} registros)`,  logsHeaders,  logsRows,  [6,10,11,12], [12,30,40,18,8,12,8,12,30,35,10,10,12]),
    wsMobs:  buildXlSheet(`⚔️ Mobs  (${mobsRows.length} registros)`,  mobsHeaders,  mobsRows,  [3,4,5],     [12,30,24,8,8,8,30,24,35,35,30]),
    wsItems: buildXlSheet(`🎒 Items (${itemsRows.length} registros)`,  itemsHeaders, itemsRows, [6],         [12,30,24,12,14,24,8,24,35,35,30]),
    wsLibres: buildXlSheet(`📦 Extras (${libresRows.length} registros)`, libresHeaders, libresRows, [], [12,30,24,45,35,35]),
  };
}

// ---------------------------------------------------------
// EXPORTACIÓN LOGS → EXCEL
// ---------------------------------------------------------

function exportLogsXlsx() {
  const { wsLogs, wsMobs, wsItems, wsLibres } = buildLogsSheets();

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'Culones RPG — Logs', Subject: 'Logs exportados', CreatedDate: new Date() };

  XLSX.utils.book_append_sheet(wb, wsLogs,   'Logs');
  XLSX.utils.book_append_sheet(wb, wsMobs,   'Mobs');
  XLSX.utils.book_append_sheet(wb, wsItems,  'Items');
  XLSX.utils.book_append_sheet(wb, wsLibres, 'Extras');

  downloadXlsx(wb, `culones-logs-${backupFileStamp()}.xlsx`);
  showToast(`${state.logs.length} logs exportados a Excel (4 hojas)`, 'success');
}

// ---------------------------------------------------------
// EXPORTACIÓN TIERLIST → EXCEL
// ---------------------------------------------------------

function buildTierlistSheets() {
  // — Hoja: Filas de tier —
  const rowsHeaders = ['ID', 'Nombre de la Fila', 'Color', 'Orden'];
  const rowsData = state.tierRows.map(r => [r.id, r.name, r.color, r.sort_order ?? '']);

  // — Hoja: Items de tier —
  const itemsHeaders = ['ID', 'ID Fila', 'Nombre de la Fila', 'Columna', 'Nombre del Item', 'Imagen (URL)', 'Campos Extra', 'Orden'];
  const itemsData = state.tierItems.map(item => {
    const row = state.tierRows.find(r => r.id === item.row_id);
    const colLabel = TIER_COLUMNS.find(c => c.key === item.column_key)?.label || item.column_key || '';
    return [
      item.id, item.row_id || '', row?.name || '',
      colLabel, item.name,
      item.image_url || '', formatExtraFieldsText(item.extra_fields),
      item.sort_order ?? '',
    ];
  });

  return {
    wsRows:  buildXlSheet(`🏆 Filas Tierlist (${rowsData.length} filas)`, rowsHeaders, rowsData,  [3], [12,28,12,8]),
    wsItems: buildXlSheet(`🔷 Items Tierlist (${itemsData.length} items)`, itemsHeaders, itemsData, [7], [12,12,24,14,28,35,35,8]),
  };
}


function buildMediaSheet(mediaAssets) {
  const headers = [
    'ID', 'Nombre visible', 'Tipo', 'Origen', 'MIME', 'Tamaño bytes',
    'Hash', 'Carpeta', 'Storage Path', 'URL', 'Tags', 'Descripción',
    'Fit', 'Posición', 'Repetición', 'Opacidad', 'Archivado', 'Creado', 'Actualizado',
  ];
  const rows = mediaAssets.map(asset => {
    const presentation = asset.presentation || {};
    return [
      asset.id || '',
      asset.display_name || '',
      asset.media_kind || '',
      asset.source_type || '',
      asset.mime_type || '',
      asset.file_size ?? '',
      asset.file_hash || '',
      asset.folder || '',
      asset.storage_path || '',
      asset.url || '',
      asArray(asset.tags).join(', '),
      asset.description || '',
      presentation.fit || '',
      presentation.position || '',
      presentation.repeat || '',
      presentation.opacity ?? '',
      asset.is_archived ? 'Sí' : 'No',
      asset.created_at || '',
      asset.updated_at || '',
    ];
  });
  return buildXlSheet(`🗂️ Multimedia (${rows.length})`, headers, rows, [5,15], [12,28,12,12,20,14,38,16,32,45,26,34,12,18,14,10,10,22,22]);
}

function buildKitsSheet(kits = []) {
  const headers = ['ID', 'Kit', 'Descripción', 'Publicado', 'Columna', 'Elemento', 'Imagen (URL)', 'Guía asociada', 'Orden'];
  const rows = [];
  kits.forEach(kit => {
    const columns = [
      ['weapon', 'Arma'],
      ['accessory', 'Accesorio'],
      ['subweapon', 'Sub-arma'],
    ];
    let hasItems = false;
    columns.forEach(([key, label]) => {
      asArray(kit.items?.[key]).forEach((item, index) => {
        hasItems = true;
        rows.push([
          kit.id || '', kit.name || '', kit.description || '', kit.published ? 'Sí' : 'No',
          label, item.name || '', item.image_url || '',
          item.guide_link ? JSON.stringify(item.guide_link) : '', index,
        ]);
      });
    });
    if (!hasItems) rows.push([kit.id || '', kit.name || '', kit.description || '', kit.published ? 'Sí' : 'No', '', '', '', '', '']);
  });
  return buildXlSheet(`🎒 Kits (${kits.length})`, headers, rows, [8], [12,28,38,10,14,28,38,30,8]);
}


function exportTierlistXlsx() {
  const { wsRows, wsItems } = buildTierlistSheets();

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'Culones RPG — Tierlist', Subject: 'Tierlist exportada', CreatedDate: new Date() };

  XLSX.utils.book_append_sheet(wb, wsRows,  'Filas Tier');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Items Tier');

  downloadXlsx(wb, `culones-tierlist-${backupFileStamp()}.xlsx`);
  showToast('Tierlist exportada a Excel (2 hojas)', 'success');
}

// ---------------------------------------------------------
// EXPORTACIÓN COMPLETA → EXCEL (todas las hojas)
// Incluye Logs, Mobs, Items, Bloques Libres, Tierlist,
// Armas, Categorías de armas, Tipos de armas y Configuración.
// ---------------------------------------------------------

async function exportAllXlsx() {
  const bundle = await collectExportBundle('all');
  hydrateLogsBundle(bundle);
  hydrateTierlistBundle(bundle);
  state.kits = bundle.kits || [];
  state.kitsLoaded = true;
  if (bundle.field_config) state.fieldConfig = bundle.field_config;
  const weaponData = {
    weapons: bundle.weapons || [],
    categories: bundle.weapon_categories || [],
    types: bundle.weapon_types || [],
    ranksByWeapon: bundle.weapon_ranks || {},
  };
  const mediaAssets = bundle.media_assets || [];

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'Culones RPG — Backup Completo', Subject: 'Exportación completa', CreatedDate: new Date() };

  // --- Hoja de resumen ---
  const summaryHeaders = ['Sección', 'Cantidad de registros', 'Última exportación'];
  const now = new Date().toLocaleString('es-ES');
  const summaryRows = [
    ['Logs',              state.logs.length,                                                now],
    ['Mobs',             Object.values(state.mobsByLog).reduce((a,b) => a + b.length, 0),  now],
    ['Items',            Object.values(state.itemsByLog).reduce((a,arr) => a + arr.filter(i => i.item_type !== '_libre').length, 0), now],
    ['Extras',   Object.values(state.itemsByLog).reduce((a,arr) => a + arr.filter(i => i.item_type === '_libre').length, 0), now],
    ['Filas Tierlist',   state.tierRows.length,                                             now],
    ['Items Tierlist',   state.tierItems.length,                                            now],
    ['Categorías',       state.categories.length,                                           now],
    ['Armas',            weaponData.weapons.length,                                         now],
    ['Categorías Armas', weaponData.categories.length,                                      now],
    ['Tipos de Armas',   weaponData.types.length,                                           now],
    ['Kits',             state.kits.length,                                                  now],
    ['Multimedia',       mediaAssets.length,                                                now],
  ];
  const wsSummary = buildXlSheet('📊 Resumen del Backup', summaryHeaders, summaryRows, [1], [28, 24, 28]);

  // --- Hojas de logs ---
  const { wsLogs, wsMobs, wsItems, wsLibres } = buildLogsSheets();

  // --- Hojas de tierlist ---
  const { wsRows: wsTierRows, wsItems: wsTierItems } = buildTierlistSheets();

  // --- Hoja de categorías de logs ---
  const catHeaders = ['Slug', 'Etiqueta', 'Emoji', 'Color', 'Descripción'];
  const catRows = state.categories.map(c => [c.slug, c.label, c.emoji || '', c.color || '', c.description || '']);
  const wsCats = buildXlSheet(`🏷️ Categorías (${catRows.length})`, catHeaders, catRows, [], [16,24,8,12,40]);

  // --- Hoja de armas ---
  const weaponHeaders = ['ID', 'Nombre', 'Categoría', 'Tipo', 'Publicada', 'Imagen (URL)', 'Orden'];
  const weaponRows = weaponData.weapons.map(w => {
    const cat  = weaponData.categories.find(c => c.id === w.category_id);
    const type = weaponData.types.find(t => t.id === w.type_id);
    return [
      w.id, w.name,
      cat?.label || '', type?.label || '',
      w.published ? 'Sí' : 'No',
      w.image_url || '', w.sort_order ?? '',
    ];
  });
  const wsWeapons = buildXlSheet(`⚔️ Armas (${weaponRows.length})`, weaponHeaders, weaponRows, [6], [12,28,20,20,10,35,8]);

  // --- Hoja de ranks / versiones de armas ---
  const rankHeaders = ['ID', 'ID Arma', 'Nombre Arma', 'Nombre del Rank', 'Estadísticas', 'Habilidades (resumen)', 'Receta (resumen)', 'Orden'];
  const rankRows = [];
  const summarizeRecipeMethod = (recipe) => {
    if (!recipe) return '';
    if (recipe.mode === 'crafting') {
      return asArray(recipe.grid).map((m, idx) => m?.name ? `Slot ${idx + 1}: ${m.name}×${m.qty || 1}` : '').filter(Boolean).join(', ');
    }
    if (recipe.mode === 'smithing') {
      const labels = ['Plantilla', 'Equipo', 'Material'];
      return asArray(recipe.inputs).map((m, idx) => m?.name ? `${labels[idx] || `Slot ${idx + 1}`}: ${m.name}x${m.qty || 1}` : '').filter(Boolean).join(', ');
    }
    if (recipe.mode === 'furnace') {
      const labels = ['Ingrediente', 'Combustible'];
      return asArray(recipe.inputs).map((m, idx) => m?.name ? `${labels[idx] || `Slot ${idx + 1}`}: ${m.name}×${m.qty || 1}` : '').filter(Boolean).join(', ');
    }
    return asArray(recipe.materials).map(m => `${m.name}×${m.qty}`).join(', ');
  };
  const summarizeRecipe = (recipe) => {
    if (!recipe) return '';
    const methods = asArray(recipe.methods);
    if (methods.length) {
      return methods.map((method, index) => {
        const text = summarizeRecipeMethod(method);
        if (!text) return '';
        return `${method.title || `Metodo ${index + 1}`}: ${text}`;
      }).filter(Boolean).join(' | ');
    }
    return summarizeRecipeMethod(recipe);
  };
  weaponData.weapons.forEach(w => {
    (weaponData.ranksByWeapon[w.id] || []).forEach(rank => {
      const statsText     = asArray(rank.stats).map(s => `${s.label}: ${s.value}`).join('; ');
      const abilitiesText = asArray(rank.abilities).map(a => a.name).filter(Boolean).join(', ');
      const recipeText    = summarizeRecipe(rank.upgrade_recipe);
      rankRows.push([
        rank.id, w.id, w.name, rank.name || '',
        statsText, abilitiesText, recipeText, rank.sort_order ?? '',
      ]);
    });
  });
  const wsRanks = buildXlSheet(`📈 Versiones de Armas (${rankRows.length})`, rankHeaders, rankRows, [7], [12,12,28,20,45,35,30,8]);

  // --- Hoja de categorías de armas ---
  const wcatHeaders = ['ID', 'Etiqueta', 'Color', 'Orden'];
  const wcatRows = weaponData.categories.map(c => [c.id, c.label, c.color || '', c.sort_order ?? '']);
  const wsWCats = buildXlSheet(`🎨 Categorías Armas (${wcatRows.length})`, wcatHeaders, wcatRows, [3], [12,28,12,8]);

  // --- Hoja de tipos de armas ---
  const wtypeHeaders = ['ID', 'Etiqueta', 'Orden'];
  const wtypeRows = weaponData.types.map(t => [t.id, t.label, t.sort_order ?? '']);
  const wsWTypes = buildXlSheet(`🔰 Tipos Armas (${wtypeRows.length})`, wtypeHeaders, wtypeRows, [2], [12,28,8]);

  // --- Hoja de configuración de campos ---
  const cfgHeaders = ['Tipo de ficha', 'Clave del campo', 'Etiqueta', 'Habilitado', 'Orden'];
  const cfgRows = [];
  ['mob', 'item'].forEach(type => {
    (state.fieldConfig[type] || []).forEach((field, idx) => {
      cfgRows.push([
        type === 'mob' ? 'Mob' : 'Item',
        field.key, field.label,
        field.enabled ? 'Sí' : 'No',
        idx + 1,
      ]);
    });
  });
  const wsCfg = buildXlSheet(`⚙️ Configuración de Campos (${cfgRows.length})`, cfgHeaders, cfgRows, [4], [14,20,28,12,8]);
  const wsMedia = buildMediaSheet(mediaAssets);
  const wsKits = buildKitsSheet(state.kits);

  // --- Ensamblar workbook ---
  XLSX.utils.book_append_sheet(wb, wsSummary,  'Resumen');
  XLSX.utils.book_append_sheet(wb, wsLogs,     'Logs');
  XLSX.utils.book_append_sheet(wb, wsMobs,     'Mobs');
  XLSX.utils.book_append_sheet(wb, wsItems,    'Items');
  XLSX.utils.book_append_sheet(wb, wsLibres,   'Extras');
  XLSX.utils.book_append_sheet(wb, wsTierRows, 'Tier - Filas');
  XLSX.utils.book_append_sheet(wb, wsTierItems,'Tier - Items');
  XLSX.utils.book_append_sheet(wb, wsCats,     'Categorías');
  XLSX.utils.book_append_sheet(wb, wsWeapons,  'Armas');
  XLSX.utils.book_append_sheet(wb, wsRanks,    'Versiones Armas');
  XLSX.utils.book_append_sheet(wb, wsWCats,    'Categorías Armas');
  XLSX.utils.book_append_sheet(wb, wsWTypes,   'Tipos Armas');
  XLSX.utils.book_append_sheet(wb, wsKits,     'Kits');
  XLSX.utils.book_append_sheet(wb, wsMedia,    'Multimedia');
  XLSX.utils.book_append_sheet(wb, wsCfg,      'Configuración');

  downloadXlsx(wb, `culones-backup-${backupFileStamp()}.xlsx`);
  showToast('Backup completo exportado a Excel (15 hojas)', 'success');
}

// ---------------------------------------------------------
// PUNTO DE ENTRADA ÚNICO DE EXPORTACIÓN
// Mantiene la misma firma que antes: exportData(type, format)
// para no romper el event listener de initAdminPanel().
// ---------------------------------------------------------

export async function exportData(type, format) {
  showToast('Preparando exportación...', 'default');
  try {
    if (format === 'json') {
      const bundle = await collectExportBundle(type);
      // Alias de la v1 para scripts externos que todavía esperan data/rows/items.
      if (type === 'logs') bundle.data = bundle.logs;
      if (type === 'tierlist') {
        bundle.rows = bundle.tierlist.rows;
        bundle.items = bundle.tierlist.items;
      }
      const name = type === 'logs' ? 'culones-logs' : type === 'tierlist' ? 'culones-tierlist' : 'culones-backup';
      downloadFile(JSON.stringify(bundle, null, 2), `${name}-${backupFileStamp()}.json`, 'application/json');
      const details = auditDetails([
        'JSON v2',
        countSummary('logs', bundle.logs?.length || 0),
        countSummary('Guías', bundle.weapons?.length || 0),
        countSummary('kits', bundle.kits?.length || 0),
      ]);
      showToast(type === 'all' ? 'Respaldo restaurable descargado' : `${backupTypeLabel(type)} exportado`, 'success');
      await recordAdminAction('export_created', `Se exportó ${backupTypeLabel(type)} (${details}) a las ${localAuditTime()}.`);
      return;
    }

    if (format === 'htmlzip') {
      const bundle = await collectExportBundle(type);
      const { downloadVisualReport } = await import('./visual-report.js?v=20260717-1');
      const suffix = type === 'all' ? 'completo' : type;
      downloadVisualReport(bundle, `culones-reporte-${suffix}-${backupFileStamp()}.zip`);
      showToast('Reporte visual creado', 'success');
      await recordAdminAction('export_created', `Se exportó un reporte visual de ${backupTypeLabel(type)} (ZIP) a las ${localAuditTime()}.`);
      return;
    }

    if (format === 'xlsx') {
      await ensureXlsx();
      if (type === 'logs') {
        hydrateLogsBundle(await collectExportBundle('logs'));
        exportLogsXlsx();
      } else if (type === 'tierlist') {
        hydrateTierlistBundle(await collectExportBundle('tierlist'));
        exportTierlistXlsx();
      } else {
        await exportAllXlsx();
      }
      await recordAdminAction('export_created', `Se exportó ${backupTypeLabel(type)} (XLSX) a las ${localAuditTime()}.`);
    }
  } catch (error) {
    console.error('[Export]', error);
    showToast(error?.message || 'No se pudo crear la exportación.', 'error');
  }
}

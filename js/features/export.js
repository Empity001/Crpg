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
import { loadCategoriesData } from './categories.js';
import { loadLogsData } from './logs-data.js';
import { loadTierlist } from './tierlist.js';
import { isMediaInfrastructureMissing, listMediaAssets } from '../core/media.js';
import { countSummary, localAuditTime, recordAdminAction } from '../core/audit.js';
import { asArray, formatDate, showToast } from '../core/utils.js';
import { fetchWeaponsDataForExport } from './weapons-data.js';
import { auditDetails, backupFileStamp, backupTypeLabel, downloadFile } from './backup-helpers.js';

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
    'Relevancia', 'Likes', 'Fecha', 'Fecha (ISO)',
    '# Mobs', '# Items', '# Bloques Libres',
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
      log.likes || 0, formatDate(log.created_at), log.created_at,
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
    wsLogs:  buildXlSheet(`📜 Logs  (${logsRows.length} registros)`,  logsHeaders,  logsRows,  [6,9,10,11], [12,30,40,18,8,12,8,12,30,10,10,12]),
    wsMobs:  buildXlSheet(`⚔️ Mobs  (${mobsRows.length} registros)`,  mobsHeaders,  mobsRows,  [3,4,5],     [12,30,24,8,8,8,30,24,35,35,30]),
    wsItems: buildXlSheet(`🎒 Items (${itemsRows.length} registros)`,  itemsHeaders, itemsRows, [6],         [12,30,24,12,14,24,8,24,35,35,30]),
    wsLibres: buildXlSheet(`📦 Bloques Libres (${libresRows.length} registros)`, libresHeaders, libresRows, [], [12,30,24,45,35,35]),
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
  XLSX.utils.book_append_sheet(wb, wsLibres, 'Bloques Libres');

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
  await loadLogsData();
  await loadCategoriesData();
  // Asegurar tierlist cargada (el render queda protegido si no hay DOM)
  if (!state.tierlistLoaded) await loadTierlist();

  // Obtener datos de armas sin disparar ningún render de la guía
  const weaponData = await fetchWeaponsDataForExport();
  const mediaAssets = await getMediaAssetsForExport();

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'Culones RPG — Backup Completo', Subject: 'Exportación completa', CreatedDate: new Date() };

  // --- Hoja de resumen ---
  const summaryHeaders = ['Sección', 'Cantidad de registros', 'Última exportación'];
  const now = new Date().toLocaleString('es-ES');
  const summaryRows = [
    ['Logs',              state.logs.length,                                                now],
    ['Mobs',             Object.values(state.mobsByLog).reduce((a,b) => a + b.length, 0),  now],
    ['Items',            Object.values(state.itemsByLog).reduce((a,arr) => a + arr.filter(i => i.item_type !== '_libre').length, 0), now],
    ['Bloques Libres',   Object.values(state.itemsByLog).reduce((a,arr) => a + arr.filter(i => i.item_type === '_libre').length, 0), now],
    ['Filas Tierlist',   state.tierRows.length,                                             now],
    ['Items Tierlist',   state.tierItems.length,                                            now],
    ['Categorías',       state.categories.length,                                           now],
    ['Armas',            weaponData.weapons.length,                                         now],
    ['Categorías Armas', weaponData.categories.length,                                      now],
    ['Tipos de Armas',   weaponData.types.length,                                           now],
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
  weaponData.weapons.forEach(w => {
    (weaponData.ranksByWeapon[w.id] || []).forEach(rank => {
      const statsText     = asArray(rank.stats).map(s => `${s.label}: ${s.value}`).join('; ');
      const abilitiesText = asArray(rank.abilities).map(a => a.name).filter(Boolean).join(', ');
      const recipeText    = asArray(rank.upgrade_recipe?.materials).map(m => `${m.name}×${m.qty}`).join(', ');
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

  // --- Ensamblar workbook ---
  XLSX.utils.book_append_sheet(wb, wsSummary,  'Resumen');
  XLSX.utils.book_append_sheet(wb, wsLogs,     'Logs');
  XLSX.utils.book_append_sheet(wb, wsMobs,     'Mobs');
  XLSX.utils.book_append_sheet(wb, wsItems,    'Items');
  XLSX.utils.book_append_sheet(wb, wsLibres,   'Bloques Libres');
  XLSX.utils.book_append_sheet(wb, wsTierRows, 'Tier - Filas');
  XLSX.utils.book_append_sheet(wb, wsTierItems,'Tier - Items');
  XLSX.utils.book_append_sheet(wb, wsCats,     'Categorías');
  XLSX.utils.book_append_sheet(wb, wsWeapons,  'Armas');
  XLSX.utils.book_append_sheet(wb, wsRanks,    'Versiones Armas');
  XLSX.utils.book_append_sheet(wb, wsWCats,    'Categorías Armas');
  XLSX.utils.book_append_sheet(wb, wsWTypes,   'Tipos Armas');
  XLSX.utils.book_append_sheet(wb, wsMedia,    'Multimedia');
  XLSX.utils.book_append_sheet(wb, wsCfg,      'Configuración');

  downloadXlsx(wb, `culones-backup-${backupFileStamp()}.xlsx`);
  showToast('Backup completo exportado a Excel (14 hojas)', 'success');
}

// ---------------------------------------------------------
// PUNTO DE ENTRADA ÚNICO DE EXPORTACIÓN
// Mantiene la misma firma que antes: exportData(type, format)
// para no romper el event listener de initAdminPanel().
// ---------------------------------------------------------

export async function exportData(type, format) {
  showToast('Preparando exportación...', 'default');

  // -------- JSON (sin cambios, compatibilidad total) --------
  if (format === 'json') {
    if (type === 'logs') {
      await loadLogsData();
      const logsWithBlocks = state.logs.map(log => ({
        ...log,
        mobs:  state.mobsByLog[log.id]  || [],
        items: state.itemsByLog[log.id] || [],
      }));
      downloadFile(
        JSON.stringify({ version: 1, type: 'logs', exported_at: new Date().toISOString(), data: logsWithBlocks }, null, 2),
        `culones-logs-${backupFileStamp()}.json`, 'application/json',
      );
      showToast(`${logsWithBlocks.length} logs exportados`, 'success');
      await recordAdminAction(
        'export_created',
        `Se exportó un backup de Logs (${auditDetails([format.toUpperCase(), countSummary('logs', logsWithBlocks.length)])}) a las ${localAuditTime()}.`
      );

    } else if (type === 'tierlist') {
      if (!state.tierlistLoaded) await loadTierlist();
      downloadFile(
        JSON.stringify({ version: 1, type: 'tierlist', exported_at: new Date().toISOString(), rows: state.tierRows, items: state.tierItems }, null, 2),
        `culones-tierlist-${backupFileStamp()}.json`, 'application/json',
      );
      showToast('Tierlist exportada', 'success');
      const tierDetails = auditDetails([format.toUpperCase(), countSummary('filas', state.tierRows.length), countSummary('items', state.tierItems.length)]);
      await recordAdminAction(
        'export_created',
        `Se exportó un backup de Tierlist (${tierDetails}) a las ${localAuditTime()}.`
      );

    } else if (type === 'all') {
      await loadLogsData();
      await loadCategoriesData();
      if (!state.tierlistLoaded) await loadTierlist();
      const weaponData = await fetchWeaponsDataForExport();
      const mediaAssets = await getMediaAssetsForExport();
      const logsWithBlocks = state.logs.map(log => ({
        ...log,
        mobs:  state.mobsByLog[log.id]  || [],
        items: state.itemsByLog[log.id] || [],
      }));
      const backup = {
        version: 1, type: 'full_backup',
        exported_at: new Date().toISOString(),
        logs: logsWithBlocks,
        categories: state.categories,
        tierlist: { rows: state.tierRows, items: state.tierItems },
        weapons: weaponData.weapons,
        weapon_categories: weaponData.categories,
        weapon_types: weaponData.types,
        weapon_ranks: weaponData.ranksByWeapon,
        media_assets: mediaAssets,
        field_config: state.fieldConfig,
      };
      downloadFile(JSON.stringify(backup, null, 2), `culones-backup-${backupFileStamp()}.json`, 'application/json');
      showToast('Backup completo exportado', 'success');
      const backupDetails = auditDetails([
        format.toUpperCase(),
        countSummary('logs', logsWithBlocks.length),
        countSummary('armas', weaponData.weapons.length),
        countSummary('recursos multimedia', mediaAssets.length),
      ]);
      await recordAdminAction(
        'export_created',
        `Se exportó un Backup completo (${backupDetails}) a las ${localAuditTime()}.`
      );
    }
    return;
  }

  // -------- XLSX --------
  if (format === 'xlsx') {
    if (typeof XLSX === 'undefined') {
      showToast('SheetJS no está disponible. Comprueba tu conexión a internet.', 'error');
      return;
    }
    if (type === 'logs') {
      await loadLogsData();
      exportLogsXlsx();
      await recordAdminAction(
        'export_created',
        `Se exportó un backup de Logs (${auditDetails([format.toUpperCase(), countSummary('logs', state.logs.length)])}) a las ${localAuditTime()}.`
      );
    } else if (type === 'tierlist') {
      if (!state.tierlistLoaded) await loadTierlist();
      exportTierlistXlsx();
      const tierDetails = auditDetails([format.toUpperCase(), countSummary('filas', state.tierRows.length), countSummary('items', state.tierItems.length)]);
      await recordAdminAction(
        'export_created',
        `Se exportó un backup de Tierlist (${tierDetails}) a las ${localAuditTime()}.`
      );
    } else if (type === 'all') {
      await exportAllXlsx();
      await recordAdminAction(
        'export_created',
        `Se exportó un ${backupTypeLabel(type)} (${format.toUpperCase()}) a las ${localAuditTime()}.`
      );
    }
  }
}

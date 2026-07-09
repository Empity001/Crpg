// =========================================================
// state.js
// =========================================================
// Estado global de la aplicación (objeto `state`), constantes
// compartidas (relevancias, columnas de tierlist, campos por defecto de
// fichas) y flags de supresión de Realtime. Punto único de verdad para
// todo lo que la UI necesita leer/escribir entre módulos.
// =========================================================

import { getOrCreateClientId } from './utils.js';

export let _suppressRealtimeReload = false;

let _suppressRealtimeTimer = null;

export function suppressNextRealtimeReload() {
  _suppressRealtimeReload = true;
  clearTimeout(_suppressRealtimeTimer);
  _suppressRealtimeTimer = setTimeout(() => { _suppressRealtimeReload = false; }, 3000);
}


export let _suppressRealtimeTierlist = false;

let _suppressRealtimeTierlistTimer = null;

export function suppressNextTierlistReload() {
  _suppressRealtimeTierlist = true;
  clearTimeout(_suppressRealtimeTierlistTimer);
  _suppressRealtimeTierlistTimer = setTimeout(() => { _suppressRealtimeTierlist = false; }, 3000);
}


export let _suppressRealtimeWeapons = false;

let _suppressRealtimeWeaponsTimer = null;

export function suppressNextWeaponsReload() {
  _suppressRealtimeWeapons = true;
  clearTimeout(_suppressRealtimeWeaponsTimer);
  _suppressRealtimeWeaponsTimer = setTimeout(() => { _suppressRealtimeWeapons = false; }, 3000);
}


export let _suppressRealtimeKits = false;

let _suppressRealtimeKitsTimer = null;

export function suppressNextKitsReload() {
  _suppressRealtimeKits = true;
  clearTimeout(_suppressRealtimeKitsTimer);
  _suppressRealtimeKitsTimer = setTimeout(() => { _suppressRealtimeKits = false; }, 3000);
}

// ---------------------------------------------------------
// PAGINACIÓN DE LOGS
// Carga progresiva: muestra PAGE_SIZE logs y añade más bajo demanda.
// ---------------------------------------------------------

export const PAGE_SIZE = 20;

// NOTA DE REFACTOR: `_logsPage` vivía como `let` en el antiguo monolito
// JS. Como varios módulos necesitan reasignarlo (no solo leerlo),
// se expone como propiedad mutable de `state` (`state.logsPage`) en vez
// de un `let` exportado — los bindings de `import` son de solo lectura,
// así que un `let` exportado no se puede reasignar desde otro módulo,
// pero sí se pueden mutar las propiedades de un objeto importado.

// ---------------------------------------------------------
// CACHE DE LOGS: evita recargar si los datos no han cambiado
// ---------------------------------------------------------

let _logsLoadedOnce = false;


export const state = {
  logsPage: 1, // cuántas páginas de logs se han mostrado (antes `_logsPage`)
  logs: [],
  categories: [],
  mobsByLog: {},
  itemsByLog: {},
  activeFilter: 'all',
  sortMode: 'date_desc',
  adminCode: localStorage.getItem('culones_admin_code') || null,
  clientId: getOrCreateClientId(),
  likedLogIds: new Set(JSON.parse(localStorage.getItem('culones_liked_logs') || '[]')),
  editingLogId: null,
  currentDetailLogId: null,
  draftMobs: [],
  draftItems: [],
  draftLibres: [],
  editingMobIndex: null,
  editingItemIndex: null,
  editingLibreIndex: null,
  // Para el editor de equipamiento dentro de mob modal
  mobEquipmentDraft: [], // [{name, enchantments: [{name}]}]
  // "Algo más" — campos libres clave/valor dentro de la ficha de mob/item
  mobExtraDraft: [],
  itemExtraDraft: [],
  // Encantamientos propios del item (no de una pieza de equipo)
  itemEnchantDraft: [],
  // Configuración de fichas (campos fijos activables/reordenables)
  fieldConfig: { mob: [], item: [] },
  fieldConfigDraft: { mob: [], item: [] },
  aboutBlocks: null,
  aboutEditorBlocks: [],
  backgroundConfig: { image_url: '', mode: 'fixed', tabs: [], presentation: null, opacity: 1 },
  faviconUrl: '',
  // Comentarios: cache plano del log abierto + likes + respuesta activa
  commentsFlat: [],
  likedCommentIds: new Set(JSON.parse(localStorage.getItem('culones_liked_comments') || '[]')),
  replyToCommentId: null,

  // ---------- Tierlist ----------
  tierRows: [],     // [{id, name, color, sort_order}, ...] ordenadas
  tierItems: [],    // [{id, row_id, column_key, name, image_url, extra_fields, sort_order}, ...]
  editingTierRowId: null,
  editingTierItemId: null,
  movingTierItemId: null,
  draggedTierItemId: null, // id del elemento que se está arrastrando (drag&drop PC)
  activeTab: 'logs',

  // ---------- Kits recomendados ----------
  kitsLoaded: false,
  kits: [],
  editingKitId: null,
  kitDraftItems: { weapon: [], accessory: [], subweapon: [] },

  // ---------- Guía de Armas ----------
  weaponsLoaded: false,
  weaponCategories: [],   // [{id, label, color, sort_order}, ...]
  weaponTypes: [],        // [{id, label, sort_order}, ...]
  weapons: [],            // [{id, name, image_url, category_id, type_id, published, ...}, ...]
  weaponRanksByWeapon: {},// weapon_id -> [rank, ...]
  weaponSearchTerm: '',
  weaponActiveCategoryFilter: 'all',
  weaponActiveTypeFilter: 'all',
  currentWeaponId: null,
  currentWeaponRankId: null,
  editingWeaponId: null,
  editingWeaponCategoryId: null,
  editingWeaponTypeId: null,
  editingWeaponRankId: null,
  editingAbilityIndex: null,
  editingSectionIndex: null,
  weaponStatsDraft: [],
  weaponAbilityStatsDraft: [],
  weaponRecipeMaterialsDraft: [],
  weaponSectionFieldsDraft: [],
};


export const RELEVANCE_ORDER = { low: 0, normal: 1, high: 2, critical: 3 };

export const RELEVANCE_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', critical: 'Crítica' };


export const TIER_COLUMNS = [
  { key: 'weapon', label: 'Arma' },
  { key: 'subweapon', label: 'Sub-arma' },
  { key: 'accessory', label: 'Accesorio' },
];

export const KIT_COLUMNS = [
  { key: 'weapon', label: 'Arma' },
  { key: 'accessory', label: 'Accesorio' },
  { key: 'subweapon', label: 'Sub-arma' },
];

// Configuración de fichas por defecto (respaldo si app_settings no
// tiene filas todavía, p.ej. antes de correr migration_004).

export const DEFAULT_MOB_FIELDS = [
  { key: 'health', label: '❤️ Vida', enabled: true },
  { key: 'damage', label: '⚔️ Daño', enabled: true },
  { key: 'armor', label: '🛡 Armor', enabled: true },
  { key: 'equipment', label: 'Equipamiento', enabled: true },
  { key: 'location', label: 'Dónde aparece', enabled: true },
];

export const DEFAULT_ITEM_FIELDS = [
  { key: 'tier', label: 'Rango/Tier', enabled: true },
  { key: 'item_type', label: 'Tipo', enabled: true },
  { key: 'damage', label: '⚔️ Daño', enabled: true },
  { key: 'enchantments', label: 'Encantamientos', enabled: true },
  { key: 'obtained_from', label: 'Dónde se obtiene', enabled: true },
];

// ---------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------

export function isAdmin() { return !!state.adminCode; }


export function getCategory(slug) {
  return state.categories.find(c => c.slug === slug) || { slug, label: slug, emoji: '📦', color: '#9a92b8' };
}

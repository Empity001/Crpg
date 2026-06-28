// =========================================================
// CULONES-RPG · app.js  (revisión 2)
// =========================================================

const state = {
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

  // ---------- Drafts ----------
  // Controladores activos de DraftManager (uno por modal de edición abierto).
  // Se inicializan en openNewLogModal/openEditLogModal/openTierItemModal
  // y se destruyen con teardown() al cerrar cada modal.
  logDraft:      null,
  tierItemDraft: null,
};

const RELEVANCE_ORDER = { low: 0, normal: 1, high: 2, critical: 3 };
const RELEVANCE_LABELS = { low: 'Baja', normal: 'Normal', high: 'Alta', critical: 'Crítica' };

const TIER_COLUMNS = [
  { key: 'weapon', label: 'Arma' },
  { key: 'subweapon', label: 'Sub-arma' },
  { key: 'accessory', label: 'Accesorio' },
];

// Configuración de fichas por defecto (respaldo si app_settings no
// tiene filas todavía, p.ej. antes de correr migration_004).
const DEFAULT_MOB_FIELDS = [
  { key: 'health', label: '❤️ Vida', enabled: true },
  { key: 'damage', label: '⚔️ Daño', enabled: true },
  { key: 'armor', label: '🛡 Armor', enabled: true },
  { key: 'equipment', label: 'Equipamiento', enabled: true },
  { key: 'location', label: 'Dónde aparece', enabled: true },
];
const DEFAULT_ITEM_FIELDS = [
  { key: 'tier', label: 'Rango/Tier', enabled: true },
  { key: 'item_type', label: 'Tipo', enabled: true },
  { key: 'damage', label: '⚔️ Daño', enabled: true },
  { key: 'enchantments', label: 'Encantamientos', enabled: true },
  { key: 'obtained_from', label: 'Dónde se obtiene', enabled: true },
];

// ---------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------
function getOrCreateClientId() {
  let id = localStorage.getItem('culones_client_id');
  if (!id) { id = 'client_' + crypto.randomUUID(); localStorage.setItem('culones_client_id', id); }
  return id;
}

function showToast(message, type = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function formatDate(isoString) {
  const date = new Date(isoString);
  return date.toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toDatetimeLocalValue(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function tempId() { return 'tmp_' + Math.random().toString(36).slice(2, 10); }

function isAdmin() { return !!state.adminCode; }

function getCategory(slug) {
  return state.categories.find(c => c.slug === slug) || { slug, label: slug, emoji: '📦', color: '#9a92b8' };
}

// Parsea equipamiento guardado: puede ser JSON array o texto plano legacy
function parseEquipment(raw) {
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  // Legacy: texto plano → convertir a array sin encantamientos
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, enchantments: [] }));
}

// Parsea campos libres de un bloque libre
function parseLibreFields(item) {
  // stored as item_type = '_libre', name = nombre del bloque, obtained_from = JSON fields
  try {
    return JSON.parse(item.obtained_from || '[]');
  } catch(e) { return []; }
}

// Devuelve siempre un array, sea que la columna jsonb ya venga
// parseada (caso normal de supabase-js) o, defensivamente, como
// texto JSON crudo.
function asArray(val) {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : []; } catch(e) { return []; }
  }
  return [];
}

// Solo permite URLs http/https — evita esquemas raros (javascript:, etc.)
// en los campos de "imagen de referencia" que vienen de texto libre.
function safeUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url, window.location.href);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
  } catch (e) {}
  return '';
}

// Renderiza filas clave/valor (con sub-campos opcionales) — usado
// tanto por bloques libres como por "Algo más" en mobs/items.
function renderKeyValueRows(fields) {
  if (!fields || fields.length === 0) return '';
  function renderFieldValue(field) {
    if (field.subfields && field.subfields.length > 0) {
      return `<div class="libre-subfields">${field.subfields.map(sf =>
        `<div class="item-detail-row libre-subrow">
          <span class="item-detail-label libre-sublabel">↳ ${escapeHtml(sf.key)}</span>
          <span class="item-detail-value">${escapeHtml(sf.value || '')}</span>
        </div>`
      ).join('')}</div>`;
    }
    return `<span class="item-detail-value">${escapeHtml(field.value || '')}</span>`;
  }
  return fields.map(f => `
    <div class="item-detail-row libre-row">
      <span class="item-detail-label">${escapeHtml(f.key)}</span>
      ${renderFieldValue(f)}
    </div>`).join('');
}

// Bloque de imagen de referencia: thumbnail + botón de pantalla
// completa (abre asset-view.html en otra pestaña, con su propio
// botón de "Volver").
function renderBlockAssetHtml(url, title) {
  const safe = safeUrl(url);
  if (!safe) return '';
  const safeAttr = escapeHtml(safe);
  const titleAttr = escapeHtml(title || '');
  return `
    <div class="block-asset">
      <img src="${safeAttr}" alt="${titleAttr}" class="js-open-asset pixel-art" data-asset-src="${safeAttr}" data-asset-title="${titleAttr}" />
      <button type="button" class="btn-fullscreen-asset js-open-asset" data-asset-src="${safeAttr}" data-asset-title="${titleAttr}">⛶ Ver en pantalla completa</button>
    </div>`;
}

function openAssetFullscreen(src, title) {
  const safe = safeUrl(src);
  if (!safe) return;
  const url = `asset-view.html?src=${encodeURIComponent(safe)}&title=${encodeURIComponent(title || '')}`;
  window.open(url, '_blank');
}

// Sincroniza el preview de imagen dentro de un modal de bloque
// (mob/item/libre) — prefix es 'mob' | 'item' | 'libre'.
function updateAssetPreview(prefix, url) {
  const wrap = document.getElementById(`${prefix}-image-preview-wrap`);
  const img = document.getElementById(`${prefix}-image-preview`);
  const btn = document.getElementById(`${prefix}-image-fullscreen-btn`);
  if (!wrap || !img || !btn) return;
  const safe = safeUrl(url);
  if (!safe) { wrap.classList.add('hidden'); return; }
  img.src = safe;
  img.onerror = () => wrap.classList.add('hidden');
  wrap.classList.remove('hidden');
  btn.dataset.assetSrc = safe;
  btn.dataset.assetTitle = document.getElementById(`${prefix}-name-input`) ? document.getElementById(`${prefix}-name-input`).value : '';
}

// ---------------------------------------------------------
// NAVEGACIÓN POR PESTAÑAS
// ---------------------------------------------------------
function initTabs() {
  const tabs = document.querySelectorAll('.tab-item');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => { t.classList.remove('is-active'); t.setAttribute('aria-selected', 'false'); });
      tab.classList.add('is-active');
      tab.setAttribute('aria-selected', 'true');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('is-active'));
      document.getElementById(`panel-${target}`).classList.add('is-active');
      document.getElementById('active-tab-path').textContent = target;

      if (target === 'tierlist' && !state.tierlistLoaded) {
        state.tierlistLoaded = true;
        loadTierlist();
      }
    });
  });
}

// ---------------------------------------------------------
// CATEGORÍAS
// ---------------------------------------------------------
async function loadCategories() {
  const { data, error } = await supabaseClient.from('categories').select('*').order('created_at', { ascending: true });
  if (error) { console.error(error); showToast('No se pudieron cargar las categorías', 'error'); return; }
  state.categories = data;
  renderCategoryFilters();
  renderCategorySelectOptions();
  renderCategoryManageList();
}

function renderCategoryFilters() {
  const container = document.getElementById('category-filters');
  const allPill = container.querySelector('[data-filter="all"]');
  container.innerHTML = '';
  container.appendChild(allPill);
  state.categories.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'pill' + (state.activeFilter === cat.slug ? ' is-active' : '');
    pill.dataset.filter = cat.slug;
    pill.textContent = `${cat.emoji} ${cat.label}`;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.activeFilter === 'all');
  container.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      state.activeFilter = pill.dataset.filter;
      renderLogs();
    });
  });
}

function renderCategorySelectOptions() {
  const select = document.getElementById('log-category-input');
  const currentValue = select.value;
  select.innerHTML = state.categories.map(cat => `<option value="${cat.slug}">${cat.emoji} ${cat.label}</option>`).join('');
  if (currentValue && state.categories.some(c => c.slug === currentValue)) select.value = currentValue;
}

function renderCategoryManageList() {
  const container = document.getElementById('category-manage-list');
  if (!container) return;
  if (state.categories.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`; return; }
  container.innerHTML = state.categories.map(cat => `
    <div class="category-manage-row">
      <span class="category-manage-label">${cat.emoji} ${escapeHtml(cat.label)}</span>
      <button type="button" class="category-manage-delete" data-slug="${cat.slug}">🗑 Borrar</button>
    </div>
  `).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.slug));
  });
}

function openNewCategoryModal() {
  document.getElementById('category-label-input').value = '';
  document.getElementById('category-emoji-input').value = '📦';
  document.getElementById('category-color-input').value = '#4dd4e8';
  document.getElementById('category-modal-error').classList.add('hidden');
  renderCategoryManageList();
  document.getElementById('category-modal').classList.remove('hidden');
}

async function submitCategory() {
  const errorBox = document.getElementById('category-modal-error');
  const label = document.getElementById('category-label-input').value.trim();
  const emoji = document.getElementById('category-emoji-input').value.trim() || '📦';
  const color = document.getElementById('category-color-input').value || '#4dd4e8';
  if (!label) { errorBox.textContent = 'Ponle un nombre a la categoría.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_category', { input_code: state.adminCode, input_slug: label, input_label: label, input_emoji: emoji, input_color: color });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('category-label-input').value = '';
  showToast(`Categoría "${data.label}" creada`, 'success');
  await loadCategories();
  document.getElementById('log-category-input').value = data.slug;
}

async function deleteCategory(slug) {
  const cat = getCategory(slug);
  if (!confirm(`¿Borrar la categoría "${cat.label}"?`)) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_category', { input_code: state.adminCode, input_slug: slug });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast(`Categoría "${cat.label}" eliminada`, 'success');
  if (state.activeFilter === slug) state.activeFilter = 'all';
  await loadCategories();
  renderLogs();
}

// ---------------------------------------------------------
// CONFIGURACIÓN DE FICHAS (app_settings: mob_fields / item_fields)
// ---------------------------------------------------------
async function loadAppSettings() {
  state.fieldConfig = { mob: DEFAULT_MOB_FIELDS, item: DEFAULT_ITEM_FIELDS };
  const { data, error } = await supabaseClient.from('app_settings').select('*');
  if (error || !data) return;
  const mobRow = data.find(r => r.key === 'mob_fields');
  const itemRow = data.find(r => r.key === 'item_fields');
  if (mobRow && Array.isArray(mobRow.value) && mobRow.value.length > 0) state.fieldConfig.mob = mobRow.value;
  if (itemRow && Array.isArray(itemRow.value) && itemRow.value.length > 0) state.fieldConfig.item = itemRow.value;
}

function openFieldConfigModal() {
  state.fieldConfigDraft = {
    mob: JSON.parse(JSON.stringify(state.fieldConfig.mob)),
    item: JSON.parse(JSON.stringify(state.fieldConfig.item)),
  };
  renderFieldConfigList('mob');
  renderFieldConfigList('item');
  document.getElementById('field-config-modal-error').classList.add('hidden');
  document.getElementById('field-config-modal').classList.remove('hidden');
}

function renderFieldConfigList(kind) {
  const container = document.getElementById(`fieldcfg-${kind}-list`);
  const list = state.fieldConfigDraft[kind];
  container.innerHTML = list.map((f, idx) => `
    <div class="fieldcfg-row ${f.enabled ? '' : 'is-disabled'}">
      <input type="checkbox" class="fieldcfg-enabled" data-kind="${kind}" data-idx="${idx}" ${f.enabled ? 'checked' : ''} />
      <span class="fieldcfg-label">${escapeHtml(f.label)}</span>
      <div class="fieldcfg-move-group">
        <button type="button" class="fieldcfg-move-btn fieldcfg-up" data-kind="${kind}" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="fieldcfg-move-btn fieldcfg-down" data-kind="${kind}" data-idx="${idx}" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.fieldcfg-enabled').forEach(cb => {
    cb.addEventListener('change', () => {
      state.fieldConfigDraft[cb.dataset.kind][Number(cb.dataset.idx)].enabled = cb.checked;
      renderFieldConfigList(cb.dataset.kind);
    });
  });
  container.querySelectorAll('.fieldcfg-up').forEach(btn => {
    btn.addEventListener('click', () => moveFieldConfig(btn.dataset.kind, Number(btn.dataset.idx), -1));
  });
  container.querySelectorAll('.fieldcfg-down').forEach(btn => {
    btn.addEventListener('click', () => moveFieldConfig(btn.dataset.kind, Number(btn.dataset.idx), 1));
  });
}

function moveFieldConfig(kind, idx, dir) {
  const list = state.fieldConfigDraft[kind];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= list.length) return;
  [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
  renderFieldConfigList(kind);
}

async function saveFieldConfig() {
  const errorBox = document.getElementById('field-config-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const [r1, r2] = await Promise.all([
    supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'mob_fields', input_value: state.fieldConfigDraft.mob }),
    supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'item_fields', input_value: state.fieldConfigDraft.item }),
  ]);
  if (r1.error || r2.error) { errorBox.textContent = 'Error: ' + (r1.error || r2.error).message; errorBox.classList.remove('hidden'); return; }
  state.fieldConfig = { mob: state.fieldConfigDraft.mob, item: state.fieldConfigDraft.item };
  document.getElementById('field-config-modal').classList.add('hidden');
  showToast('Configuración de fichas guardada', 'success');
  renderLogs();
}

// ---------------------------------------------------------
// BITÁCORA DE ACCIONES ("Acciones realizadas") — solo admin.
// Lee desde el servidor (tabla action_log, bloqueada para
// lectura directa) vía la función list_action_log, que valida
// el código de admin antes de devolver nada.
// ---------------------------------------------------------
const ACTION_LOG_ICONS = {
  log_created: '📜', log_updated: '✏️', log_deleted: '🗑',
  mob_created: '👾', mob_deleted: '👾',
  item_created: '🗡', item_deleted: '🗡',
  block_created: '📋', block_deleted: '📋',
  category_created: '🏷', category_deleted: '🏷',
  comment_created: '💬', comment_hidden: '🙈', comment_shown: '👁', comment_deleted: '💬',
  field_config_updated: '⚙',
};

function actionLogRowClass(action) {
  if (action.endsWith('_created') || action === 'comment_shown') return 'is-create';
  if (action.endsWith('_deleted') || action === 'comment_hidden') return 'is-delete';
  if (action === 'comment_created') return 'is-comment';
  return 'is-update';
}

async function openActionLogModal() {
  document.getElementById('action-log-modal').classList.remove('hidden');
  await loadActionLog();
}

async function loadActionLog() {
  const list = document.getElementById('action-log-list');
  list.innerHTML = `<p class="action-log-empty">Cargando...</p>`;

  if (!state.adminCode) {
    list.innerHTML = `<p class="action-log-empty">Tu sesión de administrador expiró.</p>`;
    return;
  }

  const { data, error } = await supabaseClient.rpc('list_action_log', { input_code: state.adminCode, input_limit: 300 });

  if (error) {
    list.innerHTML = `<p class="action-log-empty">No se pudo cargar la bitácora.</p>`;
    return;
  }

  renderActionLogList(data || []);
}

function renderActionLogList(rows) {
  const list = document.getElementById('action-log-list');
  if (!rows || rows.length === 0) {
    list.innerHTML = `<p class="action-log-empty">Todavía no hay acciones registradas.</p>`;
    return;
  }

  list.innerHTML = rows.map(row => {
    const icon = ACTION_LOG_ICONS[row.action] || '•';
    const cls = actionLogRowClass(row.action);
    return `
      <div class="action-log-row ${cls}">
        <span class="action-log-icon">${icon}</span>
        <div class="action-log-body">
          <p class="action-log-desc">${escapeHtml(row.description)}</p>
          <div class="action-log-meta"><span>${formatDate(row.created_at)}</span></div>
        </div>
      </div>`;
  }).join('');
}



function sortLogs(logs) {
  const sorted = [...logs];
  switch (state.sortMode) {
    case 'date_asc': sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); break;
    case 'relevance_desc': sorted.sort((a, b) => (RELEVANCE_ORDER[b.relevance] ?? 0) - (RELEVANCE_ORDER[a.relevance] ?? 0)); break;
    case 'relevance_asc': sorted.sort((a, b) => (RELEVANCE_ORDER[a.relevance] ?? 0) - (RELEVANCE_ORDER[b.relevance] ?? 0)); break;
    default: sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); break;
  }
  return sorted;
}

function initSortControl() {
  const select = document.getElementById('sort-select');
  select.value = state.sortMode;
  select.addEventListener('change', () => { state.sortMode = select.value; renderLogs(); });
}

// ---------------------------------------------------------
// CARGA DE LOGS
// ---------------------------------------------------------
async function loadLogs() {
  const [logsRes, mobsRes, itemsRes] = await Promise.all([
    supabaseClient.from('logs').select('*').order('created_at', { ascending: false }),
    supabaseClient.from('log_mobs').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('log_items').select('*').order('sort_order', { ascending: true }),
  ]);
  if (logsRes.error) { console.error(logsRes.error); showToast('No se pudieron cargar los logs', 'error'); return; }
  state.logs = logsRes.data;
  state.mobsByLog = {};
  state.itemsByLog = {};
  if (!mobsRes.error) {
    (mobsRes.data || []).forEach(mob => {
      if (!state.mobsByLog[mob.log_id]) state.mobsByLog[mob.log_id] = [];
      state.mobsByLog[mob.log_id].push(mob);
    });
  }
  if (!itemsRes.error) {
    (itemsRes.data || []).forEach(item => {
      if (!state.itemsByLog[item.log_id]) state.itemsByLog[item.log_id] = [];
      state.itemsByLog[item.log_id].push(item);
    });
  }
  renderLogs();
}

// ---------------------------------------------------------
// RENDER DE BLOQUES — FIX: barras a 100% fijas (indicador,
// no comparación). Encantamientos en cyan.
// ---------------------------------------------------------
function renderMobDetailPanel(mob, contextKey) {
  const fieldsConfig = (state.fieldConfig.mob && state.fieldConfig.mob.length > 0) ? state.fieldConfig.mob : DEFAULT_MOB_FIELDS;
  const rows = [];

  // Equipamiento: puede ser JSON array o texto legacy
  function buildEquipHtml() {
    if (!mob.equipment) return '';
    const equipList = parseEquipment(mob.equipment);
    if (equipList.length === 0) return '';
    const itemsHtml = equipList.map(eq => {
      let enchHtml = '';
      if (eq.enchantments && eq.enchantments.length > 0) {
        enchHtml = eq.enchantments.map(en =>
          `<span class="enchant-tag">${escapeHtml(en.name)}</span>`
        ).join('');
        enchHtml = `<span class="enchant-list">${enchHtml}</span>`;
      }
      return `<div class="equip-item"><span class="equip-name">⚙ ${escapeHtml(eq.name)}</span>${enchHtml}</div>`;
    }).join('');
    return `
      <div class="item-detail-row equip-section">
        <span class="item-detail-label">Equipamiento</span>
        <div class="equip-list">${itemsHtml}</div>
      </div>`;
  }

  fieldsConfig.filter(f => f.enabled).forEach(f => {
    switch (f.key) {
      case 'health':
        if (mob.health != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">❤️ Vida</span>
            <div class="bar-track"><div class="bar-fill bar-health" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.health}</span>
          </div>`);
        break;
      case 'damage':
        if (mob.damage != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">⚔️ Daño</span>
            <div class="bar-track"><div class="bar-fill bar-damage" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.damage}</span>
          </div>`);
        break;
      case 'armor':
        if (mob.armor != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">🛡 Armor</span>
            <div class="bar-track"><div class="bar-fill bar-armor" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.armor}</span>
          </div>`);
        break;
      case 'equipment':
        rows.push(buildEquipHtml());
        break;
      case 'location':
        if (mob.location) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Dónde aparece</span><span class="item-detail-value">${escapeHtml(mob.location)}</span></div>`);
        break;
    }
  });

  const statRows = rows.filter(r => r.includes('stat-row')).join('');
  const otherRows = rows.filter(r => !r.includes('stat-row')).join('');

  const descHtml = mob.description ? `<p class="block-detail-desc">${escapeHtml(mob.description)}</p>` : '';
  const extraRows = renderKeyValueRows(asArray(mob.extra_fields));
  const extraHtml = extraRows ? `<div class="block-detail-extra"><p class="block-detail-extra-label">Algo más</p><div class="item-detail-grid">${extraRows}</div></div>` : '';
  const assetHtml = renderBlockAssetHtml(mob.image_url, mob.name);

  const panelId = `block-detail-${contextKey}-${mob.id}`;
  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">👾 ${escapeHtml(mob.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${statRows}
      ${otherRows ? `<div class="item-detail-grid" style="margin-top:8px;">${otherRows}</div>` : ''}
      ${extraHtml}
    </div>`;
}

function renderItemDetailPanel(item, contextKey) {
  if (item.item_type === '_libre') {
    return renderLibreDetailPanel(item, contextKey);
  }
  const fieldsConfig = (state.fieldConfig.item && state.fieldConfig.item.length > 0) ? state.fieldConfig.item : DEFAULT_ITEM_FIELDS;
  const rows = [];
  const enchantments = asArray(item.enchantments);

  fieldsConfig.filter(f => f.enabled).forEach(f => {
    switch (f.key) {
      case 'tier':
        if (item.tier) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Rango/Tier</span><span class="item-detail-value">${escapeHtml(item.tier)}</span></div>`);
        break;
      case 'item_type':
        if (item.item_type) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Tipo</span><span class="item-detail-value">${escapeHtml(item.item_type)}</span></div>`);
        break;
      case 'damage':
        if (item.damage != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">⚔️ Daño</span>
            <div class="bar-track"><div class="bar-fill bar-damage" style="width:100%"></div></div>
            <span class="stat-row-value">${item.damage}</span>
          </div>`);
        break;
      case 'enchantments':
        if (enchantments.length > 0) {
          const tags = enchantments.map(en => `<span class="enchant-tag">${escapeHtml(en.name)}</span>`).join('');
          rows.push(`<div class="item-detail-row equip-section"><span class="item-detail-label">Encantamientos</span><div class="item-enchant-tags">${tags}</div></div>`);
        }
        break;
      case 'obtained_from':
        if (item.obtained_from) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Dónde se obtiene</span><span class="item-detail-value">${escapeHtml(item.obtained_from)}</span></div>`);
        break;
    }
  });

  const statRows = rows.filter(r => r.includes('stat-row')).join('');
  const otherRows = rows.filter(r => !r.includes('stat-row')).join('');

  const descHtml = item.description ? `<p class="block-detail-desc">${escapeHtml(item.description)}</p>` : '';
  const extraRows = renderKeyValueRows(asArray(item.extra_fields));
  const extraHtml = extraRows ? `<div class="block-detail-extra"><p class="block-detail-extra-label">Algo más</p><div class="item-detail-grid">${extraRows}</div></div>` : '';
  const assetHtml = renderBlockAssetHtml(item.image_url, item.name);

  const panelId = `block-detail-${contextKey}-${item.id}`;
  const hasContent = statRows || otherRows || descHtml || extraHtml || assetHtml;
  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">🗡 ${escapeHtml(item.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${statRows}
      ${otherRows ? `<div class="item-detail-grid"${statRows ? ' style="margin-top:8px;"' : ''}>${otherRows}</div>` : ''}
      ${extraHtml}
      ${hasContent ? '' : '<p class="comments-empty">Sin datos adicionales.</p>'}
    </div>`;
}

function renderLibreDetailPanel(item, contextKey) {
  const fields = parseLibreFields(item);
  const panelId = `block-detail-${contextKey}-${item.id}`;
  const rows = renderKeyValueRows(fields);

  const descHtml = item.description ? `<p class="block-detail-desc">${escapeHtml(item.description)}</p>` : '';
  const assetHtml = renderBlockAssetHtml(item.image_url, item.name);

  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">📋 ${escapeHtml(item.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${rows ? `<div class="item-detail-grid">${rows}</div>` : (descHtml || assetHtml ? '' : '<p class="comments-empty">Sin campos.</p>')}
    </div>`;
}

// FIX PRINCIPAL: usa contextKey para que los IDs sean únicos entre
// tarjeta y modal de detalle. bindBlockChipEvents busca en el
// contenedor padre, no en el documento entero.
function renderBlocksSection(logId, contextKey) {
  const mobs = state.mobsByLog[logId] || [];
  const items = state.itemsByLog[logId] || [];
  const libres = items.filter(i => i.item_type === '_libre');
  const normalItems = items.filter(i => i.item_type !== '_libre');

  if (mobs.length === 0 && items.length === 0) return '';

  const chips = [
    ...mobs.map(m => `<button type="button" class="block-chip chip-mob" data-panel-id="block-detail-${contextKey}-${m.id}">👾 ${escapeHtml(m.name)} <span class="block-chip-caret">▾</span></button>`),
    ...normalItems.map(i => `<button type="button" class="block-chip chip-item" data-panel-id="block-detail-${contextKey}-${i.id}">🗡 ${escapeHtml(i.name)} <span class="block-chip-caret">▾</span></button>`),
    ...libres.map(i => `<button type="button" class="block-chip chip-libre" data-panel-id="block-detail-${contextKey}-${i.id}">📋 ${escapeHtml(i.name)} <span class="block-chip-caret">▾</span></button>`),
  ].join('');

  const panels = [
    ...mobs.map(m => renderMobDetailPanel(m, contextKey)),
    ...items.map(i => renderItemDetailPanel(i, contextKey)),
  ].join('');

  return `<div class="block-chip-row">${chips}</div>${panels}`;
}

// FIX: busca el panel por ID dentro del contenedor, no document.getElementById
function bindBlockChipEvents(container) {
  container.querySelectorAll('.block-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const panelId = chip.dataset.panelId;
      // Buscar dentro del mismo contenedor o en todo el documento si está en un modal
      const panel = container.querySelector(`#${CSS.escape(panelId)}`) || document.getElementById(panelId);
      if (!panel) return;
      const wasHidden = panel.classList.contains('hidden');
      // Cierra todos los paneles del mismo contenedor primero
      container.querySelectorAll('.block-detail-panel').forEach(p => {
        p.classList.add('hidden');
      });
      container.querySelectorAll('.block-chip').forEach(c => c.classList.remove('is-expanded'));
      if (wasHidden) {
        panel.classList.remove('hidden');
        chip.classList.add('is-expanded');
      }
    });
  });
}

// ---------------------------------------------------------
// RENDER DE LOGS (tarjetas)
// ---------------------------------------------------------
function renderLogs() {
  const grid = document.getElementById('logs-grid');
  let filtered = state.activeFilter === 'all' ? state.logs : state.logs.filter(l => l.category === state.activeFilter);
  filtered = sortLogs(filtered);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="logs-empty"><p>No hay logs en esta categoría todavía.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(log => {
    const isLiked = state.likedLogIds.has(log.id);
    const cat = getCategory(log.category);
    // contextKey único por log+tarjeta para evitar colisión de IDs con el modal
    const ctx = `card-${log.id}`;
    return `
      <article class="log-card" data-relevance="${log.relevance}" data-log-id="${log.id}">
        <div class="log-card-head">
          <span class="log-category-tag" style="border:1px solid ${cat.color}66; color:${cat.color};">${cat.emoji} ${escapeHtml(cat.label)}</span>
          <span class="log-relevance-badge">${RELEVANCE_LABELS[log.relevance] || log.relevance}</span>
        </div>
        <h3 class="log-card-title">${escapeHtml(log.title)}</h3>
        <p class="log-card-desc">${escapeHtml(log.description)}</p>
        ${renderBlocksSection(log.id, ctx)}
        <div class="log-card-foot">
          <span>${formatDate(log.created_at)}</span>
          <button class="log-like-btn ${isLiked ? 'is-liked' : ''}" data-log-id="${log.id}">
            ${isLiked ? '❤️' : '🤍'} <span class="like-count">${log.likes}</span>
          </button>
        </div>
        ${isAdmin() ? `
          <div class="log-card-admin-actions">
            <button class="icon-btn" data-action="edit" data-log-id="${log.id}">✏️ Editar</button>
            <button class="icon-btn danger" data-action="delete" data-log-id="${log.id}">🗑️ Borrar</button>
          </div>` : ''}
      </article>`;
  }).join('');

  grid.querySelectorAll('.log-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.log-like-btn') || e.target.closest('.icon-btn') || e.target.closest('.block-chip')) return;
      openDetailModal(card.dataset.logId);
    });
  });
  grid.querySelectorAll('.log-like-btn').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(btn.dataset.logId); });
  });
  grid.querySelectorAll('[data-action="edit"]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditLogModal(btn.dataset.logId); });
  });
  grid.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteLog(btn.dataset.logId); });
  });
  bindBlockChipEvents(grid);
}

// ---------------------------------------------------------
// LIKES
// ---------------------------------------------------------
async function toggleLike(logId) {
  const { data, error } = await supabaseClient.rpc('toggle_like', { input_log_id: logId, input_client_id: state.clientId });
  if (error) { console.error(error); showToast('No se pudo procesar el like', 'error'); return; }
  if (state.likedLogIds.has(logId)) state.likedLogIds.delete(logId); else state.likedLogIds.add(logId);
  localStorage.setItem('culones_liked_logs', JSON.stringify([...state.likedLogIds]));
  const log = state.logs.find(l => l.id === logId);
  if (log) log.likes = data;
  renderLogs();
}

// ---------------------------------------------------------
// DETALLE DE LOG + COMENTARIOS
// ---------------------------------------------------------
async function openDetailModal(logId) {
  const log = state.logs.find(l => l.id === logId);
  if (!log) return;
  state.currentDetailLogId = logId;
  cancelReply();
  const cat = getCategory(log.category);
  const ctx = `modal-${logId}`;

  document.getElementById('detail-content').innerHTML = `
    <span class="detail-category">${cat.emoji} ${escapeHtml(cat.label)}</span>
    <h2 class="detail-title">${escapeHtml(log.title)}</h2>
    <p class="detail-desc">${escapeHtml(log.description)}</p>
    ${renderBlocksSection(log.id, ctx)}
    <div class="detail-meta">
      <span>📅 ${formatDate(log.created_at)}</span>
      <span>❤️ ${log.likes} likes</span>
      <span>⚡ Relevancia: ${RELEVANCE_LABELS[log.relevance]}</span>
    </div>`;

  const detailContent = document.getElementById('detail-content');
  bindBlockChipEvents(detailContent);

  document.getElementById('detail-modal').classList.remove('hidden');
  await loadComments(logId);
}

// ---------------------------------------------------------
// COMENTARIOS: carga, árbol de respuestas (1 nivel), likes,
// y moderación de admin (ocultar/mostrar/borrar).
// ---------------------------------------------------------
async function loadComments(logId) {
  const list = document.getElementById('comments-list');
  list.innerHTML = `<p class="comments-empty">Cargando comentarios...</p>`;
  const { data, error } = await supabaseClient.from('comments').select('*').eq('log_id', logId).order('created_at', { ascending: true });
  if (error) { list.innerHTML = `<p class="comments-empty">No se pudieron cargar.</p>`; return; }
  state.commentsFlat = data || [];
  renderCommentsList();
}

function isCommentVisible(c) {
  return isAdmin() || !c.hidden;
}

function renderCommentNode(c, repliesByParent, isReply) {
  const liked = state.likedCommentIds.has(c.id);
  const hiddenTag = c.hidden ? `<span class="comment-hidden-tag">OCULTO</span>` : '';
  const replies = (repliesByParent[c.id] || []).filter(isCommentVisible);
  const repliesHtml = replies.map(r => renderCommentNode(r, repliesByParent, true)).join('');
  const adminBtns = isAdmin() ? `
        <button type="button" class="comment-action-btn comment-hide-btn" data-comment-id="${c.id}" data-hidden="${c.hidden}">${c.hidden ? '👁 Mostrar' : '🙈 Ocultar'}</button>
        <button type="button" class="comment-action-btn is-danger comment-delete-btn" data-comment-id="${c.id}">🗑 Borrar</button>` : '';
  return `
    <div class="comment-item ${c.hidden ? 'is-hidden' : ''}">
      <div class="comment-meta">
        <span class="comment-username">${escapeHtml(c.username || 'Anónimo')} ${hiddenTag}</span>
        <span>${formatDate(c.created_at)}</span>
      </div>
      <p class="comment-text">${escapeHtml(c.comment)}</p>
      <div class="comment-actions">
        <button type="button" class="comment-action-btn comment-like-btn ${liked ? 'is-liked' : ''}" data-comment-id="${c.id}">${liked ? '❤️' : '🤍'} ${c.likes || 0}</button>
        ${!isReply ? `<button type="button" class="comment-action-btn comment-reply-btn" data-comment-id="${c.id}" data-username="${escapeHtml(c.username || 'Anónimo')}">↩ Responder</button>` : ''}
        ${adminBtns}
      </div>
      ${repliesHtml ? `<div class="comment-replies">${repliesHtml}</div>` : ''}
    </div>`;
}

function renderCommentsList() {
  const list = document.getElementById('comments-list');
  const flat = state.commentsFlat;
  const repliesByParent = {};
  flat.forEach(c => { if (c.parent_id) { (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c); } });
  const roots = flat.filter(c => !c.parent_id).filter(isCommentVisible);
  if (roots.length === 0) { list.innerHTML = `<p class="comments-empty">Sé el primero en comentar este log.</p>`; return; }
  list.innerHTML = roots.map(root => renderCommentNode(root, repliesByParent, false)).join('');
}

function startReplyTo(commentId, username) {
  state.replyToCommentId = commentId;
  document.getElementById('comment-reply-target').textContent = username || 'Anónimo';
  document.getElementById('comment-reply-banner').classList.remove('hidden');
  document.getElementById('comment-text-input').focus();
}

function cancelReply() {
  state.replyToCommentId = null;
  const banner = document.getElementById('comment-reply-banner');
  if (banner) banner.classList.add('hidden');
}

async function toggleCommentLike(commentId) {
  const { data, error } = await supabaseClient.rpc('like_comment', { input_comment_id: commentId, input_client_id: state.clientId });
  if (error) { console.error(error); showToast('No se pudo procesar el like', 'error'); return; }
  if (state.likedCommentIds.has(commentId)) state.likedCommentIds.delete(commentId); else state.likedCommentIds.add(commentId);
  localStorage.setItem('culones_liked_comments', JSON.stringify([...state.likedCommentIds]));
  const c = state.commentsFlat.find(x => x.id === commentId);
  if (c) c.likes = data;
  renderCommentsList();
}

async function toggleCommentHidden(commentId, currentlyHidden) {
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('set_comment_hidden', { input_code: state.adminCode, input_id: commentId, input_hidden: !currentlyHidden });
  if (error) { showToast('No se pudo actualizar el comentario', 'error'); return; }
  const c = state.commentsFlat.find(x => x.id === commentId);
  if (c) c.hidden = !currentlyHidden;
  renderCommentsList();
  showToast(!currentlyHidden ? 'Comentario oculto' : 'Comentario visible de nuevo', 'success');
}

async function deleteCommentAction(commentId) {
  if (!confirm('¿Seguro que quieres borrar este comentario? (sus respuestas también se borrarán)')) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_comment', { input_code: state.adminCode, input_id: commentId });
  if (error) { showToast('No se pudo borrar el comentario', 'error'); return; }
  state.commentsFlat = state.commentsFlat.filter(c => c.id !== commentId && c.parent_id !== commentId);
  renderCommentsList();
  showToast('Comentario eliminado', 'success');
}

async function submitComment() {
  const logId = state.currentDetailLogId;
  const usernameInput = document.getElementById('comment-username-input');
  const textInput = document.getElementById('comment-text-input');
  const username = usernameInput.value.trim() || 'Anónimo';
  const comment = textInput.value.trim();
  if (!comment) { showToast('Escribe un comentario antes de enviar', 'error'); return; }
  const { error } = await supabaseClient.from('comments').insert({ log_id: logId, username, comment, parent_id: state.replyToCommentId });
  if (error) { showToast('No se pudo publicar el comentario', 'error'); return; }
  textInput.value = '';
  cancelReply();
  showToast('Comentario publicado', 'success');
  await loadComments(logId);
}

// ---------------------------------------------------------
// ADMIN: LOGIN
// ---------------------------------------------------------
function updateAdminUI() {
  const dot = document.getElementById('admin-dot');
  const newLogBtn = document.getElementById('open-new-log-btn');
  const fieldConfigBtn = document.getElementById('open-field-config-btn');
  const actionLogBtn = document.getElementById('open-action-log-btn');
  const newTierRowBtn = document.getElementById('open-new-tier-row-btn');
  const newTierItemBtn = document.getElementById('open-new-tier-item-btn');
  if (isAdmin()) {
    dot.className = 'dot-online';
    newLogBtn.classList.remove('hidden');
    fieldConfigBtn.classList.remove('hidden');
    actionLogBtn.classList.remove('hidden');
    newTierRowBtn.classList.remove('hidden');
    newTierItemBtn.classList.remove('hidden');
  } else {
    dot.className = 'dot-offline';
    newLogBtn.classList.add('hidden');
    fieldConfigBtn.classList.add('hidden');
    actionLogBtn.classList.add('hidden');
    newTierRowBtn.classList.add('hidden');
    newTierItemBtn.classList.add('hidden');
  }
  renderLogs();
  if (state.tierlistLoaded) renderTierlist();
}

async function submitAdminCode() {
  const input = document.getElementById('admin-code-input');
  const errorBox = document.getElementById('admin-modal-error');
  const code = input.value.trim();
  if (!code) return;
  const { data, error } = await supabaseClient.rpc('validate_admin_code', { input_code: code });
  if (error || !data) { errorBox.textContent = 'Código inválido o expirado.'; errorBox.classList.remove('hidden'); return; }
  state.adminCode = code;
  localStorage.setItem('culones_admin_code', code);
  errorBox.classList.add('hidden');
  input.value = '';
  document.getElementById('admin-modal').classList.add('hidden');
  showToast('Sesión de administrador activada', 'success');
  updateAdminUI();
}

function logoutAdmin() {
  state.adminCode = null;
  localStorage.removeItem('culones_admin_code');
  updateAdminUI();
  showToast('Sesión de administrador cerrada');
}

// ---------------------------------------------------------
// DRAFT BLOCKS LIST (chips de borrador en el form de log)
// ---------------------------------------------------------
function renderDraftBlocksList() {
  const container = document.getElementById('draft-blocks-list');
  const mobChips = state.draftMobs.map((mob, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="mob" data-idx="${idx}">👾 ${escapeHtml(mob.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="mob" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);
  const itemChips = state.draftItems.map((item, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="item" data-idx="${idx}">🗡 ${escapeHtml(item.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="item" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);
  const libreChips = state.draftLibres.map((lib, idx) => `
    <div class="draft-block-chip">
      <span class="draft-block-label" data-kind="libre" data-idx="${idx}">📋 ${escapeHtml(lib.name)}</span>
      <button type="button" class="draft-block-remove" data-kind="libre" data-idx="${idx}" aria-label="Quitar">✕</button>
    </div>`);

  container.innerHTML = [...mobChips, ...itemChips, ...libreChips].join('');

  container.querySelectorAll('.draft-block-label').forEach(el => {
    el.addEventListener('click', () => {
      const idx = Number(el.dataset.idx);
      if (el.dataset.kind === 'mob') openMobModal(idx);
      else if (el.dataset.kind === 'item') openItemModal(idx);
      else openLibreModal(idx);
    });
  });
  container.querySelectorAll('.draft-block-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (btn.dataset.kind === 'mob') state.draftMobs.splice(idx, 1);
      else if (btn.dataset.kind === 'item') state.draftItems.splice(idx, 1);
      else state.draftLibres.splice(idx, 1);
      renderDraftBlocksList();
      // Notificar al draft que hubo un cambio estructural
      if (state.logDraft) state.logDraft.markDirty();
    });
  });
}

// ---------------------------------------------------------
// "ALGO MÁS" — editor genérico de campos clave/valor libres,
// reutilizado tanto en mob como en item (subcategoría libre
// dentro de la ficha, además de los campos fijos).
// ---------------------------------------------------------
function renderExtraFieldsEditor(containerId, getArr) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const fields = getArr();
  if (fields.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin campos. Haz clic en "+ Campo" para agregar.</p>`;
    return;
  }
  container.innerHTML = fields.map((field, fIdx) => `
    <div class="libre-field-item">
      <div class="libre-field-head">
        <input type="text" class="modal-input extra-key-input" data-f="${fIdx}" value="${escapeHtml(field.key || '')}" placeholder="Campo (ej: Rareza)" maxlength="60" />
        <input type="text" class="modal-input extra-val-input" data-f="${fIdx}" value="${escapeHtml(field.value || '')}" placeholder="Valor" maxlength="200" />
        <button type="button" class="enchant-remove extra-remove-field" data-f="${fIdx}">🗑</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.extra-key-input').forEach(el => {
    el.addEventListener('input', () => { getArr()[Number(el.dataset.f)].key = el.value; });
  });
  container.querySelectorAll('.extra-val-input').forEach(el => {
    el.addEventListener('input', () => { getArr()[Number(el.dataset.f)].value = el.value; });
  });
  container.querySelectorAll('.extra-remove-field').forEach(btn => {
    btn.addEventListener('click', () => { getArr().splice(Number(btn.dataset.f), 1); renderExtraFieldsEditor(containerId, getArr); });
  });
}

// ---------------------------------------------------------
// MOB MODAL — con equipamiento como lista editable
// ---------------------------------------------------------
function openMobModal(editIndex = null) {
  state.editingMobIndex = editIndex;
  const mob = editIndex != null ? state.draftMobs[editIndex] : null;
  document.getElementById('mob-name-input').value = mob ? mob.name : '';
  document.getElementById('mob-health-input').value = mob && mob.health != null ? mob.health : '';
  document.getElementById('mob-damage-input').value = mob && mob.damage != null ? mob.damage : '';
  document.getElementById('mob-armor-input').value = mob && mob.armor != null ? mob.armor : '';
  document.getElementById('mob-location-input').value = mob ? (mob.location || '') : '';
  document.getElementById('mob-desc-input').value = mob ? (mob.description || '') : '';
  const mobImageUrl = mob ? (mob.image_url || '') : '';
  document.getElementById('mob-image-input').value = mobImageUrl;
  updateAssetPreview('mob', mobImageUrl);
  document.getElementById('mob-modal-error').classList.add('hidden');
  // Cargar equipamiento draft
  if (mob && mob.equipment) {
    state.mobEquipmentDraft = parseEquipment(mob.equipment);
  } else {
    state.mobEquipmentDraft = [];
  }
  renderMobEquipmentEditor();
  // Cargar "algo más" draft
  state.mobExtraDraft = mob ? JSON.parse(JSON.stringify(asArray(mob.extra_fields))) : [];
  renderExtraFieldsEditor('mob-extra-fields-list', () => state.mobExtraDraft);
  document.getElementById('mob-modal').classList.remove('hidden');
}

function renderMobEquipmentEditor() {
  const container = document.getElementById('mob-equipment-list');
  if (!container) return;
  if (state.mobEquipmentDraft.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin equipamiento aún. Haz clic en "+ Pieza" para agregar.</p>`;
    return;
  }
  container.innerHTML = state.mobEquipmentDraft.map((eq, eqIdx) => {
    const enchHtml = eq.enchantments.map((en, enIdx) => `
      <div class="enchant-row">
        <span class="enchant-icon">✨</span>
        <input type="text" class="modal-input enchant-input" value="${escapeHtml(en.name)}"
          data-eq="${eqIdx}" data-en="${enIdx}" placeholder="Ej: Filo V" maxlength="60" />
        <button type="button" class="enchant-remove" data-eq="${eqIdx}" data-en="${enIdx}">✕</button>
      </div>`).join('');
    return `
      <div class="equip-editor-item">
        <div class="equip-editor-head">
          <span class="equip-bullet">⚙</span>
          <input type="text" class="modal-input equip-name-input" value="${escapeHtml(eq.name)}"
            data-eq="${eqIdx}" placeholder="Ej: Casco de diamante" maxlength="80" />
          <button type="button" class="equip-add-enchant" data-eq="${eqIdx}">+ Encantamiento</button>
          <button type="button" class="equip-remove-piece" data-eq="${eqIdx}">🗑</button>
        </div>
        <div class="enchant-rows">${enchHtml}</div>
        <button type="button" class="link-btn enchant-add-btn" data-eq="${eqIdx}">✨ + Encantamiento</button>
      </div>`;
  }).join('');

  // Bind inputs
  container.querySelectorAll('.equip-name-input').forEach(input => {
    input.addEventListener('input', () => {
      state.mobEquipmentDraft[Number(input.dataset.eq)].name = input.value;
    });
  });
  container.querySelectorAll('.enchant-input').forEach(input => {
    input.addEventListener('input', () => {
      state.mobEquipmentDraft[Number(input.dataset.eq)].enchantments[Number(input.dataset.en)].name = input.value;
    });
  });
  container.querySelectorAll('.equip-add-enchant, .enchant-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft[Number(btn.dataset.eq)].enchantments.push({ name: '' });
      renderMobEquipmentEditor();
    });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft[Number(btn.dataset.eq)].enchantments.splice(Number(btn.dataset.en), 1);
      renderMobEquipmentEditor();
    });
  });
  container.querySelectorAll('.equip-remove-piece').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mobEquipmentDraft.splice(Number(btn.dataset.eq), 1);
      renderMobEquipmentEditor();
    });
  });
}

function addEquipmentPiece() {
  state.mobEquipmentDraft.push({ name: '', enchantments: [] });
  renderMobEquipmentEditor();
}

function submitMobBlock() {
  const errorBox = document.getElementById('mob-modal-error');
  const name = document.getElementById('mob-name-input').value.trim();
  const health = document.getElementById('mob-health-input').value;
  const damage = document.getElementById('mob-damage-input').value;
  const armor = document.getElementById('mob-armor-input').value;
  const location = document.getElementById('mob-location-input').value.trim();
  const description = document.getElementById('mob-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('mob-image-input').value.trim());

  if (!name) { errorBox.textContent = 'Ponle un nombre al mob.'; errorBox.classList.remove('hidden'); return; }
  if (health === '' || damage === '') { errorBox.textContent = 'Vida y Daño son obligatorios.'; errorBox.classList.remove('hidden'); return; }

  // Limpia piezas vacías
  const cleanEquip = state.mobEquipmentDraft
    .filter(eq => eq.name.trim())
    .map(eq => ({
      name: eq.name.trim(),
      enchantments: eq.enchantments.filter(en => en.name.trim()).map(en => ({ name: en.name.trim() }))
    }));

  const cleanExtra = state.mobExtraDraft
    .filter(f => f.key && f.key.trim())
    .map(f => ({ key: f.key.trim(), value: (f.value || '').trim() }));

  const mobData = {
    id: (state.editingMobIndex != null ? state.draftMobs[state.editingMobIndex].id : null) || tempId(),
    name,
    health: Number(health),
    damage: Number(damage),
    armor: armor === '' ? null : Number(armor),
    equipment: cleanEquip.length > 0 ? JSON.stringify(cleanEquip) : null,
    location: location || null,
    description: description || null,
    extra_fields: cleanExtra,
    image_url: imageUrl || null,
  };

  if (state.editingMobIndex != null) state.draftMobs[state.editingMobIndex] = mobData;
  else state.draftMobs.push(mobData);

  document.getElementById('mob-modal').classList.add('hidden');
  renderDraftBlocksList();
  if (state.logDraft) state.logDraft.markDirty();
}

// ---------------------------------------------------------
// ITEM MODAL
// ---------------------------------------------------------
function renderItemEnchantEditor() {
  const container = document.getElementById('item-enchant-list');
  if (!container) return;
  const list = state.itemEnchantDraft;
  if (list.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin encantamientos. Haz clic en "+ Encantamiento" para agregar.</p>`;
    return;
  }
  container.innerHTML = list.map((en, idx) => `
    <div class="enchant-row">
      <span class="enchant-icon">✨</span>
      <input type="text" class="modal-input enchant-input" data-idx="${idx}" value="${escapeHtml(en.name)}" placeholder="Ej: Filo V" maxlength="60" />
      <button type="button" class="enchant-remove" data-idx="${idx}">✕</button>
    </div>`).join('');
  container.querySelectorAll('.enchant-input').forEach(el => {
    el.addEventListener('input', () => { state.itemEnchantDraft[Number(el.dataset.idx)].name = el.value; });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { state.itemEnchantDraft.splice(Number(btn.dataset.idx), 1); renderItemEnchantEditor(); });
  });
}

function addItemEnchant() {
  state.itemEnchantDraft.push({ name: '' });
  renderItemEnchantEditor();
}

function openItemModal(editIndex = null) {
  state.editingItemIndex = editIndex;
  const item = editIndex != null ? state.draftItems[editIndex] : null;
  document.getElementById('item-name-input').value = item ? item.name : '';
  document.getElementById('item-tier-input').value = item ? (item.tier || '') : '';
  document.getElementById('item-type-input').value = item ? (item.item_type || '') : '';
  document.getElementById('item-obtained-input').value = item ? (item.obtained_from || '') : '';
  document.getElementById('item-damage-input').value = item && item.damage != null ? item.damage : '';
  document.getElementById('item-desc-input').value = item ? (item.description || '') : '';
  const itemImageUrl = item ? (item.image_url || '') : '';
  document.getElementById('item-image-input').value = itemImageUrl;
  updateAssetPreview('item', itemImageUrl);
  document.getElementById('item-modal-error').classList.add('hidden');
  state.itemEnchantDraft = item ? JSON.parse(JSON.stringify(asArray(item.enchantments))) : [];
  renderItemEnchantEditor();
  state.itemExtraDraft = item ? JSON.parse(JSON.stringify(asArray(item.extra_fields))) : [];
  renderExtraFieldsEditor('item-extra-fields-list', () => state.itemExtraDraft);
  document.getElementById('item-modal').classList.remove('hidden');
}

function submitItemBlock() {
  const errorBox = document.getElementById('item-modal-error');
  const name = document.getElementById('item-name-input').value.trim();
  const tier = document.getElementById('item-tier-input').value.trim();
  const itemType = document.getElementById('item-type-input').value.trim();
  const obtainedFrom = document.getElementById('item-obtained-input').value.trim();
  const damage = document.getElementById('item-damage-input').value;
  const description = document.getElementById('item-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('item-image-input').value.trim());
  if (!name) { errorBox.textContent = 'Ponle un nombre al item.'; errorBox.classList.remove('hidden'); return; }

  const cleanEnchant = state.itemEnchantDraft.filter(en => en.name.trim()).map(en => ({ name: en.name.trim() }));
  const cleanExtra = state.itemExtraDraft
    .filter(f => f.key && f.key.trim())
    .map(f => ({ key: f.key.trim(), value: (f.value || '').trim() }));

  const itemData = {
    id: (state.editingItemIndex != null ? state.draftItems[state.editingItemIndex].id : null) || tempId(),
    name, tier: tier || null, item_type: itemType || null, obtained_from: obtainedFrom || null,
    damage: damage === '' ? null : Number(damage),
    enchantments: cleanEnchant,
    description: description || null,
    extra_fields: cleanExtra,
    image_url: imageUrl || null,
  };
  if (state.editingItemIndex != null) state.draftItems[state.editingItemIndex] = itemData;
  else state.draftItems.push(itemData);
  document.getElementById('item-modal').classList.add('hidden');
  renderDraftBlocksList();
  if (state.logDraft) state.logDraft.markDirty();
}

// ---------------------------------------------------------
// LIBRE MODAL — campos clave/valor completamente libres,
// con sub-campos anidables
// ---------------------------------------------------------
function openLibreModal(editIndex = null) {
  state.editingLibreIndex = editIndex;
  const lib = editIndex != null ? state.draftLibres[editIndex] : null;
  document.getElementById('libre-name-input').value = lib ? lib.name : '';
  document.getElementById('libre-desc-input').value = lib ? (lib.description || '') : '';
  const libreImageUrl = lib ? (lib.image_url || '') : '';
  document.getElementById('libre-image-input').value = libreImageUrl;
  updateAssetPreview('libre', libreImageUrl);
  document.getElementById('libre-modal-error').classList.add('hidden');
  // Cargar campos
  const rawFields = lib ? (lib._fields || []) : [];
  // Store in a temp array on the modal
  document.getElementById('libre-modal')._fields = JSON.parse(JSON.stringify(rawFields));
  renderLibreFieldsEditor();
  document.getElementById('libre-modal').classList.remove('hidden');
}

function getLibreFields() {
  return document.getElementById('libre-modal')._fields || [];
}

function renderLibreFieldsEditor() {
  const container = document.getElementById('libre-fields-list');
  const fields = getLibreFields();
  if (fields.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin campos. Haz clic en "+ Campo" para agregar.</p>`;
    return;
  }
  container.innerHTML = fields.map((field, fIdx) => {
    const subHtml = (field.subfields || []).map((sf, sIdx) => `
      <div class="libre-subfield-row">
        <input type="text" class="modal-input libre-subkey" value="${escapeHtml(sf.key || '')}"
          data-f="${fIdx}" data-s="${sIdx}" placeholder="Sub-campo" maxlength="60" />
        <input type="text" class="modal-input libre-subval" value="${escapeHtml(sf.value || '')}"
          data-f="${fIdx}" data-s="${sIdx}" placeholder="Valor" maxlength="200" />
        <button type="button" class="enchant-remove" data-f="${fIdx}" data-s="${sIdx}">✕</button>
      </div>`).join('');
    return `
      <div class="libre-field-item">
        <div class="libre-field-head">
          <input type="text" class="modal-input libre-key-input" value="${escapeHtml(field.key || '')}"
            data-f="${fIdx}" placeholder="Campo (ej: Tipo)" maxlength="60" />
          <input type="text" class="modal-input libre-val-input" value="${escapeHtml(field.value || '')}"
            data-f="${fIdx}" placeholder="Valor (opcional si tiene sub-campos)" maxlength="200" />
          <button type="button" class="enchant-remove" data-f="${fIdx}">🗑</button>
        </div>
        <div class="libre-subfields-editor">${subHtml}</div>
        <button type="button" class="link-btn libre-add-sub" data-f="${fIdx}">↳ + Sub-campo</button>
      </div>`;
  }).join('');

  // Binds
  container.querySelectorAll('.libre-key-input').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].key = el.value; });
  });
  container.querySelectorAll('.libre-val-input').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].value = el.value; });
  });
  container.querySelectorAll('.libre-subkey').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].subfields[Number(el.dataset.s)].key = el.value; });
  });
  container.querySelectorAll('.libre-subval').forEach(el => {
    el.addEventListener('input', () => { getLibreFields()[Number(el.dataset.f)].subfields[Number(el.dataset.s)].value = el.value; });
  });
  // Remove field
  container.querySelectorAll('.libre-field-item > .libre-field-head > .enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { getLibreFields().splice(Number(btn.dataset.f), 1); renderLibreFieldsEditor(); });
  });
  // Remove subfield
  container.querySelectorAll('.libre-subfields-editor .enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { getLibreFields()[Number(btn.dataset.f)].subfields.splice(Number(btn.dataset.s), 1); renderLibreFieldsEditor(); });
  });
  // Add subfield
  container.querySelectorAll('.libre-add-sub').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = getLibreFields()[Number(btn.dataset.f)];
      if (!f.subfields) f.subfields = [];
      f.subfields.push({ key: '', value: '' });
      renderLibreFieldsEditor();
    });
  });
}

function addLibreField() {
  const fields = getLibreFields();
  fields.push({ key: '', value: '', subfields: [] });
  renderLibreFieldsEditor();
}

function submitLibreBlock() {
  const errorBox = document.getElementById('libre-modal-error');
  const name = document.getElementById('libre-name-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre al bloque.'; errorBox.classList.remove('hidden'); return; }

  const fields = getLibreFields().filter(f => f.key.trim());
  const description = document.getElementById('libre-desc-input').value.trim();
  const imageUrl = safeUrl(document.getElementById('libre-image-input').value.trim());

  // Guardamos en draftLibres con _fields para edición, y
  // la serialización final a item lo hacemos en submitLog
  const libreData = {
    id: (state.editingLibreIndex != null ? state.draftLibres[state.editingLibreIndex].id : null) || tempId(),
    name,
    _fields: fields,
    description: description || null,
    image_url: imageUrl || null,
  };

  if (state.editingLibreIndex != null) state.draftLibres[state.editingLibreIndex] = libreData;
  else state.draftLibres.push(libreData);

  document.getElementById('libre-modal').classList.add('hidden');
  renderDraftBlocksList();
  if (state.logDraft) state.logDraft.markDirty();
}

// ---------------------------------------------------------
// ADMIN: CREAR / EDITAR / BORRAR LOGS
// ---------------------------------------------------------
function openNewLogModal() {
  state.editingLogId = null;
  state.draftMobs = [];
  state.draftItems = [];
  state.draftLibres = [];
  document.getElementById('log-modal-title').textContent = '📜 NUEVO LOG';
  document.getElementById('log-title-input').value = '';
  document.getElementById('log-desc-input').value = '';
  renderCategorySelectOptions();
  if (state.categories.length > 0) document.getElementById('log-category-input').value = state.categories[0].slug;
  document.getElementById('log-relevance-input').value = 'normal';
  document.getElementById('log-date-input').value = toDatetimeLocalValue(new Date());
  document.getElementById('log-modal-error').classList.add('hidden');
  renderDraftBlocksList();
  document.getElementById('log-modal').classList.remove('hidden');
  initLogDraft('new');
}

function openEditLogModal(logId) {
  const log = state.logs.find(l => l.id === logId);
  if (!log) return;
  state.editingLogId = logId;
  // Separar libres de items normales
  const allItems = (state.itemsByLog[logId] || []).map(i => ({ ...i }));
  state.draftItems = allItems.filter(i => i.item_type !== '_libre');
  // Reconstruir draftLibres con _fields
  state.draftLibres = allItems.filter(i => i.item_type === '_libre').map(i => ({
    ...i,
    _fields: parseLibreFields(i),
  }));
  state.draftMobs = (state.mobsByLog[logId] || []).map(m => ({ ...m }));
  document.getElementById('log-modal-title').textContent = '✏️ EDITAR LOG';
  document.getElementById('log-title-input').value = log.title;
  document.getElementById('log-desc-input').value = log.description;
  renderCategorySelectOptions();
  document.getElementById('log-category-input').value = log.category;
  document.getElementById('log-relevance-input').value = log.relevance;
  document.getElementById('log-date-input').value = toDatetimeLocalValue(log.created_at);
  document.getElementById('log-modal-error').classList.add('hidden');
  renderDraftBlocksList();
  document.getElementById('log-modal').classList.remove('hidden');
  initLogDraft(logId);
}

async function submitLog() {
  const errorBox = document.getElementById('log-modal-error');
  const title = document.getElementById('log-title-input').value.trim();
  const description = document.getElementById('log-desc-input').value.trim();
  const category = document.getElementById('log-category-input').value;
  const relevance = document.getElementById('log-relevance-input').value;
  const dateValue = document.getElementById('log-date-input').value;
  if (!title || !description) { errorBox.textContent = 'Título y descripción son obligatorios.'; errorBox.classList.remove('hidden'); return; }
  if (!category) { errorBox.textContent = 'Elige o crea una categoría primero.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const isoDate = dateValue ? new Date(dateValue).toISOString() : null;

  const mobsPayload = state.draftMobs.map(({ name, health, damage, armor, equipment, location, description, extra_fields, image_url }) => ({
    name, health, damage, armor, equipment, location,
    description: description || null,
    extra_fields: asArray(extra_fields),
    image_url: image_url || null,
  }));

  // Items normales + libres combinados
  const itemsPayload = [
    ...state.draftItems.map(({ name, tier, item_type, obtained_from, damage, enchantments, description, extra_fields, image_url }) => ({
      name, tier, item_type, obtained_from,
      damage: damage != null ? damage : null,
      enchantments: asArray(enchantments),
      description: description || null,
      extra_fields: asArray(extra_fields),
      image_url: image_url || null,
    })),
    ...state.draftLibres.map(lib => ({
      name: lib.name,
      tier: null,
      item_type: '_libre',
      obtained_from: JSON.stringify(lib._fields || []),
      damage: null,
      enchantments: [],
      description: lib.description || null,
      extra_fields: [],
      image_url: lib.image_url || null,
    })),
  ];

  let result;
  if (state.editingLogId) {
    result = await supabaseClient.rpc('update_log', {
      input_code: state.adminCode, input_id: state.editingLogId,
      input_title: title, input_description: description,
      input_category: category, input_relevance: relevance,
      input_created_at: isoDate, input_mobs: mobsPayload, input_items: itemsPayload,
    });
  } else {
    result = await supabaseClient.rpc('create_log', {
      input_code: state.adminCode, input_title: title, input_description: description,
      input_category: category, input_relevance: relevance,
      input_created_at: isoDate, input_mobs: mobsPayload, input_items: itemsPayload,
    });
  }

  if (result.error) { errorBox.textContent = 'Error: ' + result.error.message; errorBox.classList.remove('hidden'); return; }

  // Borrar el borrador al publicar con éxito
  if (state.logDraft) {
    await state.logDraft.teardown({ discard: true });
    state.logDraft = null;
  }

  document.getElementById('log-modal').classList.add('hidden');
  showToast(state.editingLogId ? 'Log actualizado' : 'Log publicado', 'success');
  await loadLogs();
}

async function deleteLog(logId) {
  if (!confirm('¿Seguro que quieres borrar este log?')) return;
  const { error } = await supabaseClient.rpc('delete_log', { input_code: state.adminCode, input_id: logId });
  if (error) { showToast('No se pudo borrar el log', 'error'); return; }
  showToast('Log eliminado', 'success');
  await loadLogs();
}

// =========================================================
// TIERLIST
// =========================================================
// Modelo: tierlist_rows (filas/tiers, dinámicas) ×
// TIER_COLUMNS (3 columnas fijas: weapon/subweapon/accessory).
// tierlist_items vive en una celda (row_id × column_key); si
// row_id es null, el elemento está en el banco "Sin clasificar".
// Todo el CRUD pasa por funciones RPC admin-gated, mismo patrón
// que logs/mobs/items/categorías en el resto de la app.
// ---------------------------------------------------------

async function loadTierlist() {
  const board = document.getElementById('tierlist-board');
  const [rowsRes, itemsRes] = await Promise.all([
    supabaseClient.from('tierlist_rows').select('*').order('sort_order', { ascending: true }),
    supabaseClient.from('tierlist_items').select('*').order('sort_order', { ascending: true }),
  ]);

  if (rowsRes.error || itemsRes.error) {
    console.error(rowsRes.error || itemsRes.error);
    board.innerHTML = `<div class="logs-empty"><p>No se pudo cargar la tierlist.</p></div>`;
    return;
  }

  state.tierRows = rowsRes.data;
  state.tierItems = itemsRes.data;
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
    ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(item.name)}" class="js-open-asset pixel-art" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(item.name)}" />`
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

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const s = parts.map(w => w[0]).join('').toUpperCase();
  return s || '?';
}

function renderTierlist() {
  const board = document.getElementById('tierlist-board');
  const benchColumnsEl = document.getElementById('tierlist-bench-columns');

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
function openTierRowModal(rowId = null) {
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

async function submitTierRow() {
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
  await loadTierlist();
}

async function deleteTierRow(rowId) {
  if (!confirm('¿Eliminar esta fila? Sus elementos pasarán a "Sin clasificar".')) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_row', { input_code: state.adminCode, input_id: rowId });
  if (error) { console.error(error); showToast('No se pudo borrar la fila', 'error'); return; }
  showToast('Fila eliminada', 'success');
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
  await loadTierlist();
}

// ---------------------------------------------------------
// ELEMENTOS (items)
// ---------------------------------------------------------
function openTierItemModal(itemId = null) {
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
  } else {
    titleEl.textContent = '🎴 NUEVO ELEMENTO';
    document.getElementById('tier-item-name-input').value = '';
    document.getElementById('tier-item-column-input').value = 'weapon';
    document.getElementById('tier-item-image-input').value = '';
    updateAssetPreview('tier-item', '');
  }
  document.getElementById('tier-item-modal-error').classList.add('hidden');
  document.getElementById('tier-item-modal').classList.remove('hidden');
  initTierItemDraft(itemId || 'new');
}

async function submitTierItem() {
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

  // Borrar el borrador al guardar con éxito
  if (state.tierItemDraft) {
    await state.tierItemDraft.teardown({ discard: true });
    state.tierItemDraft = null;
  }

  document.getElementById('tier-item-modal').classList.add('hidden');
  showToast(state.editingTierItemId ? 'Elemento actualizado' : 'Elemento creado', 'success');
  await loadTierlist();
}

async function deleteTierItem(itemId) {
  if (!confirm('¿Eliminar este elemento de la tierlist?')) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_item', { input_code: state.adminCode, input_id: itemId });
  if (error) { console.error(error); showToast('No se pudo eliminar', 'error'); return; }
  showToast('Elemento eliminado', 'success');
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

async function submitTierMove() {
  const rowId = document.getElementById('tier-move-row-select').value || null;
  const columnKey = document.getElementById('tier-move-column-select').value;
  await moveTierItem(state.movingTierItemId, rowId, columnKey);
  document.getElementById('tier-move-modal').classList.add('hidden');
}

// ---------------------------------------------------------
// REALTIME
// ---------------------------------------------------------
function initRealtime() {
  supabaseClient.channel('logs-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, () => loadLogs())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_mobs' }, () => loadLogs())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_items' }, () => loadLogs())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
      if (state.currentDetailLogId) loadComments(state.currentDetailLogId);
    })
    .subscribe();

  supabaseClient.channel('tierlist-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_rows' }, () => {
      if (state.tierlistLoaded) loadTierlist();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_items' }, () => {
      if (state.tierlistLoaded) loadTierlist();
    })
    .subscribe();
}

// ---------------------------------------------------------
// MODALES Y BOTONES
// ---------------------------------------------------------
function initModals() {
  document.getElementById('admin-toggle-btn').addEventListener('click', () => {
    if (isAdmin()) logoutAdmin();
    else document.getElementById('admin-modal').classList.remove('hidden');
  });
  document.getElementById('close-admin-modal').addEventListener('click', () => document.getElementById('admin-modal').classList.add('hidden'));
  document.getElementById('submit-admin-code').addEventListener('click', submitAdminCode);
  document.getElementById('admin-code-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminCode(); });

  document.getElementById('open-new-log-btn').addEventListener('click', openNewLogModal);
  document.getElementById('close-log-modal').addEventListener('click', async () => {
    if (state.logDraft) {
      await state.logDraft.teardown({ discard: false });
      state.logDraft = null;
    }
    document.getElementById('log-modal').classList.add('hidden');
  });
  document.getElementById('submit-log-btn').addEventListener('click', submitLog);

  document.getElementById('open-add-mob-btn').addEventListener('click', () => openMobModal(null));
  document.getElementById('close-mob-modal').addEventListener('click', () => document.getElementById('mob-modal').classList.add('hidden'));
  document.getElementById('submit-mob-btn').addEventListener('click', submitMobBlock);
  document.getElementById('mob-add-equipment-btn').addEventListener('click', addEquipmentPiece);
  document.getElementById('mob-add-extra-btn').addEventListener('click', () => { state.mobExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('mob-extra-fields-list', () => state.mobExtraDraft); });
  document.getElementById('mob-image-input').addEventListener('input', (e) => updateAssetPreview('mob', e.target.value.trim()));

  document.getElementById('open-add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('close-item-modal').addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
  document.getElementById('submit-item-btn').addEventListener('click', submitItemBlock);
  document.getElementById('item-add-enchant-btn').addEventListener('click', addItemEnchant);
  document.getElementById('item-add-extra-btn').addEventListener('click', () => { state.itemExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('item-extra-fields-list', () => state.itemExtraDraft); });
  document.getElementById('item-image-input').addEventListener('input', (e) => updateAssetPreview('item', e.target.value.trim()));

  document.getElementById('open-add-libre-btn').addEventListener('click', () => openLibreModal(null));
  document.getElementById('close-libre-modal').addEventListener('click', () => document.getElementById('libre-modal').classList.add('hidden'));
  document.getElementById('submit-libre-btn').addEventListener('click', submitLibreBlock);
  document.getElementById('libre-add-field-btn').addEventListener('click', addLibreField);
  document.getElementById('libre-image-input').addEventListener('input', (e) => updateAssetPreview('libre', e.target.value.trim()));

  document.getElementById('open-new-category-btn').addEventListener('click', openNewCategoryModal);
  document.getElementById('close-category-modal').addEventListener('click', () => document.getElementById('category-modal').classList.add('hidden'));
  document.getElementById('submit-category-btn').addEventListener('click', submitCategory);

  document.getElementById('open-field-config-btn').addEventListener('click', openFieldConfigModal);
  document.getElementById('close-field-config-modal').addEventListener('click', () => document.getElementById('field-config-modal').classList.add('hidden'));
  document.getElementById('fieldcfg-save-btn').addEventListener('click', saveFieldConfig);

  document.getElementById('open-action-log-btn').addEventListener('click', openActionLogModal);
  document.getElementById('close-action-log-modal').addEventListener('click', () => document.getElementById('action-log-modal').classList.add('hidden'));
  document.getElementById('close-action-log-btn-bottom').addEventListener('click', () => document.getElementById('action-log-modal').classList.add('hidden'));
  document.getElementById('refresh-action-log-btn').addEventListener('click', loadActionLog);

  document.getElementById('open-new-tier-row-btn').addEventListener('click', () => openTierRowModal(null));
  document.getElementById('close-tier-row-modal').addEventListener('click', () => document.getElementById('tier-row-modal').classList.add('hidden'));
  document.getElementById('submit-tier-row-btn').addEventListener('click', submitTierRow);

  document.getElementById('open-new-tier-item-btn').addEventListener('click', () => openTierItemModal(null));
  document.getElementById('close-tier-item-modal').addEventListener('click', async () => {
    if (state.tierItemDraft) {
      await state.tierItemDraft.teardown({ discard: false });
      state.tierItemDraft = null;
    }
    document.getElementById('tier-item-modal').classList.add('hidden');
  });
  document.getElementById('submit-tier-item-btn').addEventListener('click', submitTierItem);
  document.getElementById('tier-item-image-input').addEventListener('input', (e) => updateAssetPreview('tier-item', e.target.value.trim()));

  document.getElementById('close-tier-move-modal').addEventListener('click', () => document.getElementById('tier-move-modal').classList.add('hidden'));
  document.getElementById('submit-tier-move-btn').addEventListener('click', submitTierMove);

  document.getElementById('close-detail-modal').addEventListener('click', () => { document.getElementById('detail-modal').classList.add('hidden'); cancelReply(); });
  document.getElementById('submit-comment-btn').addEventListener('click', submitComment);
  document.getElementById('comment-reply-cancel').addEventListener('click', cancelReply);

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', async (e) => {
      if (e.target !== overlay) return;
      // Teardown de drafts si se cierra el modal de log o tieritem haciendo clic fuera
      if (overlay.id === 'log-modal' && state.logDraft) {
        await state.logDraft.teardown({ discard: false });
        state.logDraft = null;
      }
      if (overlay.id === 'tier-item-modal' && state.tierItemDraft) {
        await state.tierItemDraft.teardown({ discard: false });
        state.tierItemDraft = null;
      }
      overlay.classList.add('hidden');
    });
  });

  // ---------------------------------------------------------
  // Delegación global: abrir imagen en pantalla completa y
  // acciones de comentarios (like / responder / ocultar / borrar).
  // Estos elementos se re-renderizan dinámicamente, así que se
  // delega en document en vez de re-bindear cada vez.
  // ---------------------------------------------------------
  document.addEventListener('click', (e) => {
    const assetEl = e.target.closest('.js-open-asset');
    if (assetEl) { openAssetFullscreen(assetEl.dataset.assetSrc, assetEl.dataset.assetTitle); return; }

    const likeEl = e.target.closest('.comment-like-btn');
    if (likeEl) { e.stopPropagation(); toggleCommentLike(likeEl.dataset.commentId); return; }

    const replyEl = e.target.closest('.comment-reply-btn');
    if (replyEl) { e.stopPropagation(); startReplyTo(replyEl.dataset.commentId, replyEl.dataset.username); return; }

    const hideEl = e.target.closest('.comment-hide-btn');
    if (hideEl) { e.stopPropagation(); toggleCommentHidden(hideEl.dataset.commentId, hideEl.dataset.hidden === 'true'); return; }

    const delEl = e.target.closest('.comment-delete-btn');
    if (delEl) { e.stopPropagation(); deleteCommentAction(delEl.dataset.commentId); return; }
  });
}

// =========================================================
// INTEGRACIÓN DE DRAFTS
// =========================================================
// Funciones que conectan DraftManager con cada editor concreto.
// Patrón uniforme para log y tierlist_item — extensible a
// cualquier entidad futura con la misma estructura.
// =========================================================

// ---------------------------------------------------------
// HELPERS DE UI COMPARTIDOS
// ---------------------------------------------------------

// Actualiza la barra de estado de draft de un modal dado.
// prefix: 'log' | 'tieritem'
function updateDraftStatusBar(prefix, isDirty, lastSavedText) {
  const bar      = document.getElementById(`${prefix}-draft-status-bar`);
  const dot      = bar ? bar.querySelector('.draft-status-dot') : null;
  const textEl   = document.getElementById(`${prefix}-draft-status-text`);
  const saveBtn  = document.getElementById(`${prefix}-draft-save-btn`);
  if (!bar || !textEl) return;

  bar.classList.remove('is-dirty', 'is-saved');

  if (isDirty) {
    bar.classList.add('is-dirty');
    textEl.textContent = '● Cambios sin guardar';
    if (saveBtn) saveBtn.disabled = false;
  } else if (lastSavedText) {
    bar.classList.add('is-saved');
    textEl.textContent = `✓ Borrador guardado ${lastSavedText}`;
    if (saveBtn) saveBtn.disabled = false;
  } else {
    textEl.textContent = 'Sin cambios';
    if (saveBtn) saveBtn.disabled = true;
  }
}

// Muestra el banner de restauración con la fecha del borrador.
function showDraftRestoreBanner(prefix, savedAt) {
  const banner = document.getElementById(`${prefix}-draft-restore-banner`);
  const timeEl = document.getElementById(`${prefix}-draft-restore-time`);
  if (!banner || !timeEl) return;
  timeEl.textContent = DraftManager.timeAgo(savedAt) || 'hace un momento';
  banner.classList.remove('hidden');
}

function hideDraftRestoreBanner(prefix) {
  const banner = document.getElementById(`${prefix}-draft-restore-banner`);
  if (banner) banner.classList.add('hidden');
}

// Pulso visual corto cuando el autosave completa silenciosamente.
function showAutosaveFlash() {
  const existing = document.querySelector('.draft-autosave-flash');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'draft-autosave-flash';
  el.textContent = '✓ Borrador guardado';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

// ---------------------------------------------------------
// SERIALIZAR / DESERIALIZAR EL FORMULARIO DE LOG
// Estas funciones leen y escriben el estado completo del
// modal de log — incluye campos de texto, mobs, items y libres.
// ---------------------------------------------------------

function collectLogFormData() {
  return {
    title:       document.getElementById('log-title-input').value,
    description: document.getElementById('log-desc-input').value,
    category:    document.getElementById('log-category-input').value,
    relevance:   document.getElementById('log-relevance-input').value,
    dateValue:   document.getElementById('log-date-input').value,
    draftMobs:   JSON.parse(JSON.stringify(state.draftMobs)),
    draftItems:  JSON.parse(JSON.stringify(state.draftItems)),
    draftLibres: JSON.parse(JSON.stringify(state.draftLibres)),
  };
}

function applyLogFormData(payload) {
  if (!payload) return;
  document.getElementById('log-title-input').value       = payload.title       || '';
  document.getElementById('log-desc-input').value        = payload.description || '';
  document.getElementById('log-date-input').value        = payload.dateValue   || toDatetimeLocalValue(new Date());

  // Categoría — puede que haya categorías que ya no existen; silencia el error
  renderCategorySelectOptions();
  const catSelect = document.getElementById('log-category-input');
  if (payload.category && catSelect.querySelector(`option[value="${CSS.escape(payload.category)}"]`)) {
    catSelect.value = payload.category;
  }

  const relSelect = document.getElementById('log-relevance-input');
  if (payload.relevance) relSelect.value = payload.relevance;

  state.draftMobs   = payload.draftMobs   || [];
  state.draftItems  = payload.draftItems  || [];
  state.draftLibres = payload.draftLibres || [];
  renderDraftBlocksList();
}

// ---------------------------------------------------------
// INICIALIZAR DRAFT DEL MODAL DE LOG
// Se llama desde openNewLogModal y openEditLogModal.
// ---------------------------------------------------------
async function initLogDraft(entityId) {
  // Destruir instancia previa si quedó colgada
  if (state.logDraft) {
    await state.logDraft.teardown({ discard: false });
    state.logDraft = null;
  }

  hideDraftRestoreBanner('log');
  updateDraftStatusBar('log', false, null);

  // Registrar listeners de markDirty en todos los campos del formulario
  const logModal = document.getElementById('log-modal');
  const markDirtyOnInput = () => { if (state.logDraft) state.logDraft.markDirty(); };

  ['log-title-input', 'log-desc-input', 'log-category-input',
   'log-relevance-input', 'log-date-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      // Clonar para limpiar listeners anteriores sin romper otros bindings
      el.removeEventListener('input',  markDirtyOnInput);
      el.removeEventListener('change', markDirtyOnInput);
      el.addEventListener('input',  markDirtyOnInput);
      el.addEventListener('change', markDirtyOnInput);
    }
  });

  // Crear instancia del DraftManager para este log
  const draft = DraftManager.init({
    entityType: 'log',
    entityId,
    adminCode:  state.adminCode,
    getPayload: collectLogFormData,
    onRestore:  applyLogFormData,
    onDirtyChange: (isDirty, lastSavedAt) => {
      updateDraftStatusBar('log', isDirty, DraftManager.timeAgo(lastSavedAt));
      if (!isDirty && lastSavedAt) showAutosaveFlash();
    },
  });

  state.logDraft = draft;
  draft.startAutosave();

  // Botón guardar borrador manual
  const saveBtn = document.getElementById('log-draft-save-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      await draft.saveNow({ silent: false });
      updateDraftStatusBar('log', false, draft.getLastSavedText());
    };
  }

  // Comprobar si existe borrador previo (async — no bloquea la apertura del modal)
  const existing = await draft.checkForExistingDraft();
  if (!existing) return;

  // Hay borrador: mostrar banner
  showDraftRestoreBanner('log', existing.savedAt);

  document.getElementById('log-draft-btn-restore').onclick = () => {
    draft.restore(existing.payload);
    hideDraftRestoreBanner('log');
    updateDraftStatusBar('log', false, DraftManager.timeAgo(existing.savedAt));
    showToast('Borrador restaurado', 'success');
  };

  document.getElementById('log-draft-btn-discard').onclick = async () => {
    await draft.discardDraft();
    hideDraftRestoreBanner('log');
    updateDraftStatusBar('log', false, null);
    showToast('Borrador descartado', 'default');
  };

  document.getElementById('log-draft-btn-ignore').onclick = () => {
    hideDraftRestoreBanner('log');
    // El borrador sigue existiendo pero no se restaura — el admin edita desde cero
  };
}

// ---------------------------------------------------------
// SERIALIZAR / DESERIALIZAR EL FORMULARIO DE TIER ITEM
// ---------------------------------------------------------

function collectTierItemFormData() {
  return {
    name:      document.getElementById('tier-item-name-input').value,
    columnKey: document.getElementById('tier-item-column-input').value,
    imageUrl:  document.getElementById('tier-item-image-input').value,
  };
}

function applyTierItemFormData(payload) {
  if (!payload) return;
  document.getElementById('tier-item-name-input').value   = payload.name      || '';
  document.getElementById('tier-item-column-input').value = payload.columnKey || 'weapon';
  const imageUrl = payload.imageUrl || '';
  document.getElementById('tier-item-image-input').value  = imageUrl;
  updateAssetPreview('tier-item', imageUrl);
}

// ---------------------------------------------------------
// INICIALIZAR DRAFT DEL MODAL DE TIER ITEM
// ---------------------------------------------------------
async function initTierItemDraft(entityId) {
  if (state.tierItemDraft) {
    await state.tierItemDraft.teardown({ discard: false });
    state.tierItemDraft = null;
  }

  hideDraftRestoreBanner('tieritem');
  updateDraftStatusBar('tieritem', false, null);

  const markDirtyOnInput = () => { if (state.tierItemDraft) state.tierItemDraft.markDirty(); };

  ['tier-item-name-input', 'tier-item-column-input', 'tier-item-image-input'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.removeEventListener('input',  markDirtyOnInput);
      el.removeEventListener('change', markDirtyOnInput);
      el.addEventListener('input',  markDirtyOnInput);
      el.addEventListener('change', markDirtyOnInput);
    }
  });

  const draft = DraftManager.init({
    entityType: 'tierlist_item',
    entityId,
    adminCode:  state.adminCode,
    getPayload: collectTierItemFormData,
    onRestore:  applyTierItemFormData,
    onDirtyChange: (isDirty, lastSavedAt) => {
      updateDraftStatusBar('tieritem', isDirty, DraftManager.timeAgo(lastSavedAt));
      if (!isDirty && lastSavedAt) showAutosaveFlash();
    },
  });

  state.tierItemDraft = draft;
  draft.startAutosave();

  const saveBtn = document.getElementById('tieritem-draft-save-btn');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      await draft.saveNow({ silent: false });
      updateDraftStatusBar('tieritem', false, draft.getLastSavedText());
    };
  }

  const existing = await draft.checkForExistingDraft();
  if (!existing) return;

  showDraftRestoreBanner('tieritem', existing.savedAt);

  document.getElementById('tieritem-draft-btn-restore').onclick = () => {
    draft.restore(existing.payload);
    hideDraftRestoreBanner('tieritem');
    updateDraftStatusBar('tieritem', false, DraftManager.timeAgo(existing.savedAt));
    showToast('Borrador restaurado', 'success');
  };

  document.getElementById('tieritem-draft-btn-discard').onclick = async () => {
    await draft.discardDraft();
    hideDraftRestoreBanner('tieritem');
    updateDraftStatusBar('tieritem', false, null);
    showToast('Borrador descartado', 'default');
  };

  document.getElementById('tieritem-draft-btn-ignore').onclick = () => {
    hideDraftRestoreBanner('tieritem');
  };
}

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
async function init() {
  initTabs();
  initModals();
  initSortControl();
  updateAdminUI();
  await loadCategories();
  await loadAppSettings();
  await loadLogs();
  initRealtime();
}

document.addEventListener('DOMContentLoaded', init);

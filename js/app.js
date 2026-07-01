// =========================================================
// CULONES-RPG · app.js  (revisión 3 — optimizada)
// =========================================================

// ---------------------------------------------------------
// UTILIDAD: debounce
// Retrasa la ejecución de fn hasta que pasen `delay` ms sin
// que se vuelva a llamar. Evita búsquedas en cada tecla.
// ---------------------------------------------------------
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// ---------------------------------------------------------
// FLAG: suprime la recarga por Realtime cuando el propio
// cliente acaba de guardar. Se activa justo antes de la
// llamada RPC y se desactiva automáticamente tras 3 s.
// ---------------------------------------------------------
let _suppressRealtimeReload = false;
let _suppressRealtimeTimer = null;
function suppressNextRealtimeReload() {
  _suppressRealtimeReload = true;
  clearTimeout(_suppressRealtimeTimer);
  _suppressRealtimeTimer = setTimeout(() => { _suppressRealtimeReload = false; }, 3000);
}

let _suppressRealtimeTierlist = false;
let _suppressRealtimeTierlistTimer = null;
function suppressNextTierlistReload() {
  _suppressRealtimeTierlist = true;
  clearTimeout(_suppressRealtimeTierlistTimer);
  _suppressRealtimeTierlistTimer = setTimeout(() => { _suppressRealtimeTierlist = false; }, 3000);
}

let _suppressRealtimeWeapons = false;
let _suppressRealtimeWeaponsTimer = null;
function suppressNextWeaponsReload() {
  _suppressRealtimeWeapons = true;
  clearTimeout(_suppressRealtimeWeaponsTimer);
  _suppressRealtimeWeaponsTimer = setTimeout(() => { _suppressRealtimeWeapons = false; }, 3000);
}

// ---------------------------------------------------------
// PAGINACIÓN DE LOGS
// Carga progresiva: muestra PAGE_SIZE logs y añade más bajo demanda.
// ---------------------------------------------------------
const PAGE_SIZE = 20;
let _logsPage = 1; // cuántas páginas se han mostrado

// ---------------------------------------------------------
// CACHE DE LOGS: evita recargar si los datos no han cambiado
// ---------------------------------------------------------
let _logsLoadedOnce = false;

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
  aboutBlocks: null,
  aboutEditorBlocks: [],
  backgroundConfig: { image_url: '', mode: 'fixed', tabs: [] },
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
      <img src="${safeAttr}" alt="${titleAttr}" class="js-open-asset pixel-art" loading="lazy" data-asset-src="${safeAttr}" data-asset-title="${titleAttr}" />
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
  const img  = document.getElementById(`${prefix}-image-preview`);
  const btn  = document.getElementById(`${prefix}-image-fullscreen-btn`);
  const urlInput = document.getElementById(`${prefix}-image-input`);
  if (!wrap || !img || !btn) return;
  const safe = safeUrl(url);
  if (!safe) {
    wrap.classList.add('hidden');
    if (urlInput) urlInput.classList.remove('input-error');
    return;
  }
  img.src = safe;
  img.onload  = () => { if (urlInput) urlInput.classList.remove('input-error'); };
  img.onerror = () => {
    wrap.classList.add('hidden');
    // Marca el input en rojo si la URL no carga como imagen — avisa al admin antes de guardar.
    if (urlInput && url) urlInput.classList.add('input-error');
  };
  wrap.classList.remove('hidden');
  btn.dataset.assetSrc   = safe;
  btn.dataset.assetTitle = document.getElementById(`${prefix}-name-input`)?.value ?? '';
}

// Sube un archivo de imagen al bucket "culones" de Supabase Storage.
// folder: carpeta destino ('mobs', 'items', 'tierlist', 'weapons', 'weapon-ranks', 'recipes')
// oldUrl: URL previa (si viene de Storage) — se borra para no dejar huérfanos.
// Devuelve la URL pública de la imagen subida, o lanza error.
const STORAGE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
const STORAGE_ALLOWED   = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
const STORAGE_BUCKET    = 'culones';

async function uploadImageToStorage(file, folder, oldUrl = '') {
  if (!STORAGE_ALLOWED.includes(file.type)) {
    throw new Error('Solo se permiten imágenes PNG, JPG o WEBP.');
  }
  if (file.size > STORAGE_MAX_BYTES) {
    throw new Error('El archivo supera el límite de 3 MB.');
  }

  // Nombre único basado en timestamp — evita colisiones y cachés viejas.
  const ext  = file.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: upErr } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (upErr) throw new Error('Error al subir: ' + upErr.message);

  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  // Borrar imagen antigua del Storage (solo si era de nuestro mismo bucket).
  if (oldUrl && oldUrl.includes(`/storage/v1/object/public/${STORAGE_BUCKET}/`)) {
    const oldPath = oldUrl.split(`/storage/v1/object/public/${STORAGE_BUCKET}/`)[1];
    if (oldPath) {
      // Fire-and-forget: si falla el borrado no bloqueamos la subida nueva.
      supabaseClient.storage.from(STORAGE_BUCKET).remove([oldPath]).catch(() => {});
    }
  }

  return data.publicUrl;
}

// ---------------------------------------------------------
// DROPZONE DE IMAGEN — Modal "Nuevo/Editar elemento Tierlist"
// Maneja: click-para-elegir, drag-and-drop, botón "Quitar
// imagen", y sincronización visual de estado (vacío / con imagen).
// Reutiliza uploadImageToStorage y updateAssetPreview intactos.
// ---------------------------------------------------------
function syncTierDropzoneState(url) {
  const zone  = document.getElementById('tier-item-dropzone');
  const icon  = document.getElementById('tier-item-dropzone-icon');
  const label = document.getElementById('tier-item-dropzone-label');
  if (!zone) return;
  if (url) {
    zone.classList.add('has-image');
    if (icon)  icon.textContent  = '✅';
    if (label) label.textContent = 'Imagen lista — hacé click para reemplazarla';
  } else {
    zone.classList.remove('has-image');
    if (icon)  icon.textContent  = '🖼';
    if (label) label.textContent = 'Arrastrá una imagen aquí o hacé click para elegir';
  }
}

function initTierItemDropzone() {
  const zone      = document.getElementById('tier-item-dropzone');
  const fileInput = document.getElementById('tier-item-image-file');
  const urlInput  = document.getElementById('tier-item-image-input');
  const progress  = document.getElementById('tier-item-upload-progress');
  const clearBtn  = document.getElementById('tier-item-image-clear-btn');
  if (!zone || !fileInput) return;

  // ── Click en la dropzone → abre el selector de archivos ──
  zone.addEventListener('click', () => fileInput.click());

  // ── Drag-and-drop ──────────────────────────────────────
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleTierImageFile(file);
  });

  // ── Selección por file input (también lo usa initImageUploader) ──
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    await handleTierImageFile(file);
  });

  // ── Botón "✕ Quitar imagen" ─────────────────────────────
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (urlInput) urlInput.value = '';
      updateAssetPreview('tier-item', '');
      syncTierDropzoneState('');
    });
  }

  async function handleTierImageFile(file) {
    // Feedback inmediato
    if (progress) progress.classList.remove('hidden');
    zone.style.pointerEvents = 'none';

    const getOldUrl = () => {
      const item = state.editingTierItemId ? state.tierItems.find(i => i.id === state.editingTierItemId) : null;
      return item ? (item.image_url || '') : '';
    };

    try {
      const publicUrl = await uploadImageToStorage(file, 'tierlist', getOldUrl());
      if (urlInput) urlInput.value = publicUrl;
      updateAssetPreview('tier-item', publicUrl);
      syncTierDropzoneState(publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (progress) progress.classList.add('hidden');
      zone.style.pointerEvents = '';
    }
  }
}

// Dropzone genérica de imagen (click, drag&drop, quitar) para campos
// únicos de configuración global (fondo de página, favicon). Sigue el
// mismo patrón visual/funcional que la dropzone de la tierlist.
// prefix    : 'bg' | 'favicon' (ids esperados: ${prefix}-dropzone, ${prefix}-image-file,
//             ${prefix}-image-input, ${prefix}-dropzone-icon, ${prefix}-dropzone-label,
//             ${prefix}-upload-progress)
// folder    : carpeta destino en el bucket
// getOldUrl : función que devuelve la URL actual guardada (para borrado de huérfanos)
// onChange  : callback(url) llamado tras subir o quitar la imagen
function syncGenericDropzoneState(prefix, url) {
  const zone  = document.getElementById(`${prefix}-dropzone`);
  const icon  = document.getElementById(`${prefix}-dropzone-icon`);
  const label = document.getElementById(`${prefix}-dropzone-label`);
  if (!zone) return;
  if (url) {
    zone.classList.add('has-image');
    if (icon)  icon.textContent  = '✅';
    if (label) label.textContent = 'Imagen lista — hacé click para reemplazarla';
  } else {
    zone.classList.remove('has-image');
    if (icon)  icon.textContent  = '🖼';
    if (label) label.textContent = 'Arrastrá una imagen aquí o hacé click para elegir';
  }
}

function initGenericImageDropzone(prefix, folder, getOldUrl = () => '', onChange = () => {}) {
  const zone      = document.getElementById(`${prefix}-dropzone`);
  const fileInput = document.getElementById(`${prefix}-image-file`);
  const urlInput  = document.getElementById(`${prefix}-image-input`);
  const progress  = document.getElementById(`${prefix}-upload-progress`);
  if (!zone || !fileInput || !urlInput) return;

  syncGenericDropzoneState(prefix, urlInput.value);

  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleFile(file);
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    await handleFile(file);
  });

  async function handleFile(file) {
    if (progress) progress.classList.remove('hidden');
    zone.style.pointerEvents = 'none';
    try {
      const publicUrl = await uploadImageToStorage(file, folder, getOldUrl());
      urlInput.value = publicUrl;
      syncGenericDropzoneState(prefix, publicUrl);
      onChange(publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (progress) progress.classList.add('hidden');
      zone.style.pointerEvents = '';
    }
  }
}

// Conecta el botón 📁 de un modal al input URL existente.
// prefix    : 'mob' | 'item' | 'libre' | 'tier-item' | 'weapon' | 'weapon-rank'
// folder    : carpeta dentro del bucket ('mobs', 'items', 'tierlist', 'weapons', 'weapon-ranks')
// getOldUrl : función que devuelve la URL actual guardada (para borrado de huérfanos)
function initImageUploader(prefix, folder, getOldUrl = () => '') {
  const btn      = document.getElementById(`${prefix}-image-upload-btn`);
  const fileInput = document.getElementById(`${prefix}-image-file`);
  const urlInput  = document.getElementById(`${prefix}-image-input`);
  if (!btn || !fileInput || !urlInput) return;

  btn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // permite volver a elegir el mismo archivo

    btn.classList.add('is-uploading');
    btn.textContent = '…';

    try {
      const publicUrl = await uploadImageToStorage(file, folder, getOldUrl());
      urlInput.value = publicUrl;
      updateAssetPreview(prefix, publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.classList.remove('is-uploading');
      btn.textContent = 'Subir';
    }
  });
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
      state.activeTab = target;
      applyCustomBackground();

      if (target === 'tierlist' && !state.tierlistLoaded) {
        state.tierlistLoaded = true;
        loadTierlist();
      }
      if (target === 'weapons' && !state.weaponsLoaded) {
        state.weaponsLoaded = true;
        loadWeaponsCatalog();
      }
      if (target === 'admin' && isAdmin()) {
        renderDraftsList();
      }
    });
  });
}

// ---------------------------------------------------------
// CATEGORÍAS
// ---------------------------------------------------------
async function loadCategories() {
  const { data, error } = await supabaseClient.from('categories').select('slug,label,emoji,color,created_at').order('created_at', { ascending: true });
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
      _logsPage = 1;
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
  const { data, error } = await supabaseClient.rpc('create_category', { input_code: state.adminCode, input_slug: '', input_label: label, input_emoji: emoji, input_color: color });
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
  state.aboutBlocks = null;
  state.backgroundConfig = { image_url: '', mode: 'fixed', tabs: [] };
  state.faviconUrl = '';

  const { data, error } = await supabaseClient.from('app_settings').select('key,value');
  if (error || !data) return;

  const mobRow   = data.find(r => r.key === 'mob_fields');
  const itemRow  = data.find(r => r.key === 'item_fields');
  const aboutRow = data.find(r => r.key === 'about_blocks');
  const bgRow    = data.find(r => r.key === 'background_config');
  const faviRow  = data.find(r => r.key === 'favicon_url');

  if (mobRow  && Array.isArray(mobRow.value)  && mobRow.value.length  > 0) state.fieldConfig.mob  = mobRow.value;
  if (itemRow && Array.isArray(itemRow.value) && itemRow.value.length > 0) state.fieldConfig.item = itemRow.value;

  if (aboutRow && Array.isArray(aboutRow.value)) {
    state.aboutBlocks = aboutRow.value;
  }

  if (bgRow && bgRow.value && typeof bgRow.value === 'object') {
    state.backgroundConfig = {
      image_url: bgRow.value.image_url || '',
      mode: ['fixed','continuous','contain'].includes(bgRow.value.mode) ? bgRow.value.mode : 'fixed',
      tabs: Array.isArray(bgRow.value.tabs) ? bgRow.value.tabs : [],
    };
  }

  if (faviRow && typeof faviRow.value === 'string') {
    state.faviconUrl = faviRow.value;
  } else if (faviRow && faviRow.value && typeof faviRow.value === 'object') {
    state.faviconUrl = faviRow.value.url || '';
  }

  renderAboutContent();
  populateBackgroundForm();
  applyCustomBackground();
  applyFavicon(state.faviconUrl);
  populateFaviconForm();
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
  select.addEventListener('change', () => { state.sortMode = select.value; _logsPage = 1; renderLogs(); });
}

// ---------------------------------------------------------
// CARGA DE LOGS
// ---------------------------------------------------------
async function loadLogs() {
  const [logsRes, mobsRes, itemsRes] = await Promise.all([
    supabaseClient.from('logs')
      .select('id,title,description,category,relevance,likes,created_at')
      .order('created_at', { ascending: false }),
    supabaseClient.from('log_mobs')
      .select('id,log_id,name,health,damage,armor,equipment,location,description,extra_fields,image_url,sort_order')
      .order('sort_order', { ascending: true }),
    supabaseClient.from('log_items')
      .select('id,log_id,name,tier,item_type,obtained_from,damage,enchantments,description,extra_fields,image_url,sort_order')
      .order('sort_order', { ascending: true }),
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
// Optimización: renderiza sólo la tarjeta que cambió si se
// le pasa un logId concreto; de lo contrario reconstruye
// todo el grid (primer carga, cambio de filtro/orden).
// Paginación: muestra PAGE_SIZE cards y permite cargar más.
// ---------------------------------------------------------
function buildLogCardHtml(log) {
  const isLiked = state.likedLogIds.has(log.id);
  const cat = getCategory(log.category);
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
}

function bindCardEvents(card) {
  card.addEventListener('click', (e) => {
    if (e.target.closest('.log-like-btn') || e.target.closest('.icon-btn') || e.target.closest('.block-chip')) return;
    openDetailModal(card.dataset.logId);
  });
  const likeBtn = card.querySelector('.log-like-btn');
  if (likeBtn) likeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(likeBtn.dataset.logId); });
  const editBtn = card.querySelector('[data-action="edit"]');
  if (editBtn) editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEditLogModal(editBtn.dataset.logId); });
  const delBtn = card.querySelector('[data-action="delete"]');
  if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteLog(delBtn.dataset.logId); });
  bindBlockChipEvents(card);
}

function renderLoadMoreBtn(grid, remaining) {
  const existing = document.getElementById('load-more-btn');
  if (existing) existing.remove();
  if (remaining <= 0) return;
  const btn = document.createElement('button');
  btn.id = 'load-more-btn';
  btn.className = 'btn-load-more';
  btn.textContent = `Cargar ${Math.min(remaining, PAGE_SIZE)} más (${remaining} restantes)`;
  btn.addEventListener('click', () => {
    _logsPage++;
    renderLogs();
  });
  grid.after(btn);
}

function renderLogs(changedLogId = null) {
  const grid = document.getElementById('logs-grid');
  let filtered = state.activeFilter === 'all' ? state.logs : state.logs.filter(l => l.category === state.activeFilter);
  filtered = sortLogs(filtered);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="logs-empty"><p>No hay logs en esta categoría todavía.</p></div>`;
    const existingBtn = document.getElementById('load-more-btn');
    if (existingBtn) existingBtn.remove();
    return;
  }

  // Actualización granular: si sólo cambió un log y la tarjeta ya existe
  // en el grid, reemplazamos únicamente ese elemento.
  if (changedLogId != null) {
    const existingCard = grid.querySelector(`[data-log-id="${changedLogId}"]`);
    const log = filtered.find(l => l.id === changedLogId);
    if (existingCard && log) {
      const tmp = document.createElement('div');
      tmp.innerHTML = buildLogCardHtml(log);
      const newCard = tmp.firstElementChild;
      existingCard.replaceWith(newCard);
      bindCardEvents(newCard);
      return;
    }
  }

  // Render completo con paginación
  const visible = filtered.slice(0, _logsPage * PAGE_SIZE);
  grid.innerHTML = visible.map(log => buildLogCardHtml(log)).join('');
  grid.querySelectorAll('.log-card').forEach(card => bindCardEvents(card));
  renderLoadMoreBtn(grid, filtered.length - visible.length);
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
  // Actualización granular: sólo re-renderiza la tarjeta afectada
  renderLogs(logId);
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
  const { data, error } = await supabaseClient.from('comments').select('id,log_id,username,comment,likes,hidden,parent_id,created_at').eq('log_id', logId).order('created_at', { ascending: true });
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
  const adminTab = document.getElementById('admin-panel-tab');
  const newWeaponBtn = document.getElementById('open-new-weapon-btn');
  const weaponCatBtn = document.getElementById('open-weapon-category-manage-btn');
  const weaponTypeBtn = document.getElementById('open-weapon-type-manage-btn');
  if (isAdmin()) {
    dot.className = 'dot-online';
    newLogBtn.classList.remove('hidden');
    fieldConfigBtn.classList.remove('hidden');
    actionLogBtn.classList.remove('hidden');
    newTierRowBtn.classList.remove('hidden');
    newTierItemBtn.classList.remove('hidden');
    newWeaponBtn.classList.remove('hidden');
    weaponCatBtn.classList.remove('hidden');
    weaponTypeBtn.classList.remove('hidden');
    if (adminTab) adminTab.classList.remove('hidden');
    const aboutToolbar = document.getElementById('about-admin-toolbar');
    if (aboutToolbar) aboutToolbar.classList.remove('hidden');
  } else {
    dot.className = 'dot-offline';
    newLogBtn.classList.add('hidden');
    fieldConfigBtn.classList.add('hidden');
    actionLogBtn.classList.add('hidden');
    newTierRowBtn.classList.add('hidden');
    newTierItemBtn.classList.add('hidden');
    newWeaponBtn.classList.add('hidden');
    weaponCatBtn.classList.add('hidden');
    weaponTypeBtn.classList.add('hidden');
    if (adminTab) adminTab.classList.add('hidden');
    const aboutToolbar = document.getElementById('about-admin-toolbar');
    if (aboutToolbar) aboutToolbar.classList.add('hidden');
    // Si estaba en la pestaña admin, volver a logs
    if (state.activeTab === 'admin') {
      document.querySelector('[data-tab="logs"]').click();
    }
  }
  renderLogs();
  if (state.tierlistLoaded) renderTierlist();
  if (state.weaponsLoaded) {
    renderWeaponsGrid();
    if (state.currentWeaponId) renderWeaponDetail();
  }
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
  checkAndShowDraftBanner('new');
  startDraftAutosave();
  document.getElementById('log-modal').classList.remove('hidden');
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
  checkAndShowDraftBanner(logId);
  startDraftAutosave();
  document.getElementById('log-modal').classList.remove('hidden');
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
  const publishedId = state.editingLogId;
  clearDraft(publishedId || 'new');
  stopDraftAutosave();
  document.getElementById('log-modal').classList.add('hidden');
  showToast(publishedId ? 'Log actualizado' : 'Log publicado', 'success');
  suppressNextRealtimeReload();
  await loadLogs();
}

async function deleteLog(logId) {
  if (!confirm('¿Seguro que quieres borrar este log?')) return;
  const { error } = await supabaseClient.rpc('delete_log', { input_code: state.adminCode, input_id: logId });
  if (error) { showToast('No se pudo borrar el log', 'error'); return; }
  showToast('Log eliminado', 'success');
  suppressNextRealtimeReload();
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
    supabaseClient.from('tierlist_rows').select('id,name,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('tierlist_items').select('id,row_id,column_key,name,image_url,extra_fields,sort_order').order('sort_order', { ascending: true }),
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
    ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(item.name)}" class="js-open-asset pixel-art" loading="lazy" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(item.name)}" />`
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
  suppressNextTierlistReload();
  await loadTierlist();
}

async function deleteTierRow(rowId) {
  if (!confirm('¿Eliminar esta fila? Sus elementos pasarán a "Sin clasificar".')) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_row', { input_code: state.adminCode, input_id: rowId });
  if (error) { console.error(error); showToast('No se pudo borrar la fila', 'error'); return; }
  showToast('Fila eliminada', 'success');
  suppressNextTierlistReload();
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
  suppressNextTierlistReload();
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
    syncTierDropzoneState(item.image_url || '');
  } else {
    titleEl.textContent = '🎴 NUEVO ELEMENTO';
    document.getElementById('tier-item-name-input').value = '';
    document.getElementById('tier-item-column-input').value = 'weapon';
    document.getElementById('tier-item-image-input').value = '';
    updateAssetPreview('tier-item', '');
    syncTierDropzoneState('');
  }
  document.getElementById('tier-item-modal-error').classList.add('hidden');
  document.getElementById('tier-item-modal').classList.remove('hidden');
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

  document.getElementById('tier-item-modal').classList.add('hidden');
  showToast(state.editingTierItemId ? 'Elemento actualizado' : 'Elemento creado', 'success');
  suppressNextTierlistReload();
  await loadTierlist();
}

async function deleteTierItem(itemId) {
  if (!confirm('¿Eliminar este elemento de la tierlist?')) return;
  const { error } = await supabaseClient.rpc('delete_tierlist_item', { input_code: state.adminCode, input_id: itemId });
  if (error) { console.error(error); showToast('No se pudo eliminar', 'error'); return; }
  showToast('Elemento eliminado', 'success');
  suppressNextTierlistReload();
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
  suppressNextTierlistReload();
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

// =========================================================
// GUÍA DE ARMAS
// =========================================================
// Catálogo con buscador + filtros 100% dinámicos (categorías y
// tipos los crea el admin, nunca están escritos en el código).
// Cada arma tiene rangos ilimitados (MK1, MK2...) con sus
// propias estadísticas, habilidades, receta de mejora (estilo
// "trade": materiales → resultado) y secciones libres extra
// para crecer a futuro sin tener que migrar de nuevo.
// Oculta para visitantes hasta que el admin la publica — mismo
// patrón que los comentarios ocultos: se filtra en el cliente,
// no en RLS, porque no hay sesión real de Supabase Auth.
// ---------------------------------------------------------

function isWeaponVisible(w) { return isAdmin() || !!w.published; }

function getWeaponCategory(id) { return state.weaponCategories.find(c => c.id === id) || null; }
function getWeaponType(id) { return state.weaponTypes.find(t => t.id === id) || null; }

function getWeaponRanks(weaponId) {
  return (state.weaponRanksByWeapon[weaponId] || []).slice().sort((a, b) => a.sort_order - b.sort_order);
}

function getCurrentWeapon() { return state.weapons.find(w => w.id === state.currentWeaponId) || null; }

// ---------------------------------------------------------
// CARGA
// ---------------------------------------------------------
async function loadWeaponMeta() {
  const [catsRes, typesRes] = await Promise.all([
    supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true }),
  ]);
  if (catsRes.error) {
    console.error('[Weapons] weapon_categories error:', catsRes.error.message);
    // Las tablas aún no existen en Supabase — mostrar mensaje claro
    const grid = document.getElementById('weapons-grid');
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>⚠️ El catálogo de armas no está configurado aún.<br>Ejecuta <code>migration_008_weapons.sql</code> en Supabase.</p></div>`;
    return false;
  }
  if (!catsRes.error) state.weaponCategories = catsRes.data || [];
  if (!typesRes.error) state.weaponTypes = typesRes.data || [];
  renderWeaponCategoryFilters();
  renderWeaponTypeFilters();
  renderWeaponCategorySelectOptions();
  renderWeaponTypeSelectOptions();
  renderWeaponCategoryManageList();
  renderWeaponTypeManageList();
  return true;
}

async function reloadWeaponData() {
  const grid = document.getElementById('weapons-grid');
  const [weaponsRes, ranksRes] = await Promise.all([
    supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true }),
  ]);
  if (weaponsRes.error || ranksRes.error) {
    console.error(weaponsRes.error || ranksRes.error);
    if (grid) grid.innerHTML = `<div class="logs-empty"><p>No se pudo cargar el catálogo de armas.</p></div>`;
    return;
  }
  state.weapons = weaponsRes.data;
  state.weaponRanksByWeapon = {};
  (ranksRes.data || []).forEach(r => {
    if (!state.weaponRanksByWeapon[r.weapon_id]) state.weaponRanksByWeapon[r.weapon_id] = [];
    state.weaponRanksByWeapon[r.weapon_id].push(r);
  });
  renderWeaponsGrid();
  if (state.currentWeaponId) renderWeaponDetail();
}

async function loadWeaponsCatalog() {
  const ok = await loadWeaponMeta();
  if (ok === false) return; // tablas no existen aún
  await reloadWeaponData();
}

// Obtiene datos de armas SOLO para exportación — sin tocar el DOM
// ni los renders de la guía. Seguro de llamar desde cualquier contexto.
async function fetchWeaponsDataForExport() {
  const [catsRes, typesRes, weaponsRes, ranksRes] = await Promise.all([
    supabaseClient.from('weapon_categories').select('id,label,color,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapon_types').select('id,label,sort_order').order('sort_order', { ascending: true }),
    supabaseClient.from('weapons').select('id,name,image_url,category_id,type_id,published,sort_order'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true }),
  ]);
  const categories = (!catsRes.error && catsRes.data)   || [];
  const types      = (!typesRes.error && typesRes.data)  || [];
  const weapons    = (!weaponsRes.error && weaponsRes.data) || [];
  const ranksByWeapon = {};
  ((!ranksRes.error && ranksRes.data) || []).forEach(r => {
    if (!ranksByWeapon[r.weapon_id]) ranksByWeapon[r.weapon_id] = [];
    ranksByWeapon[r.weapon_id].push(r);
  });
  return { categories, types, weapons, ranksByWeapon };
}

// ---------------------------------------------------------
// FILTROS + BÚSQUEDA
// ---------------------------------------------------------
function weaponMatchesFilters(w) {
  if (!isWeaponVisible(w)) return false;
  if (state.weaponActiveCategoryFilter !== 'all' && (w.category_id || '') !== state.weaponActiveCategoryFilter) return false;
  if (state.weaponActiveTypeFilter !== 'all' && (w.type_id || '') !== state.weaponActiveTypeFilter) return false;
  if (state.weaponSearchTerm) {
    if (!w.name.toLowerCase().includes(state.weaponSearchTerm.toLowerCase())) return false;
  }
  return true;
}

function renderWeaponCategoryFilters() {
  const container = document.getElementById('weapon-category-filters');
  const allPill = container.querySelector('[data-wcat="all"]');
  container.innerHTML = '';
  container.appendChild(allPill);
  state.weaponCategories.forEach(cat => {
    const pill = document.createElement('button');
    const active = state.weaponActiveCategoryFilter === cat.id;
    pill.className = 'pill' + (active ? ' is-active' : '');
    pill.dataset.wcat = cat.id;
    pill.style.borderColor = cat.color;
    if (active) { pill.style.background = cat.color; pill.style.color = '#0c0a14'; }
    else { pill.style.color = cat.color; }
    pill.textContent = cat.label;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.weaponActiveCategoryFilter === 'all');
  container.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.weaponActiveCategoryFilter = pill.dataset.wcat;
      renderWeaponCategoryFilters();
      renderWeaponsGrid();
    });
  });
}

function renderWeaponTypeFilters() {
  const container = document.getElementById('weapon-type-filters');
  const allPill = container.querySelector('[data-wtype="all"]');
  container.innerHTML = '';
  container.appendChild(allPill);
  state.weaponTypes.forEach(t => {
    const pill = document.createElement('button');
    pill.className = 'pill' + (state.weaponActiveTypeFilter === t.id ? ' is-active' : '');
    pill.dataset.wtype = t.id;
    pill.textContent = t.label;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.weaponActiveTypeFilter === 'all');
  container.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.weaponActiveTypeFilter = pill.dataset.wtype;
      renderWeaponTypeFilters();
      renderWeaponsGrid();
    });
  });
}

// ---------------------------------------------------------
// GRID DE CATÁLOGO
// ---------------------------------------------------------
function renderWeaponsGrid() {
  const grid = document.getElementById('weapons-grid');
  if (!grid) return;
  const list = state.weapons.filter(weaponMatchesFilters).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (list.length === 0) {
    grid.innerHTML = `<div class="weapons-empty"><p>No hay armas que coincidan con la búsqueda/filtros.${isAdmin() ? ' Crea la primera con "+ Nueva arma".' : ''}</p></div>`;
    return;
  }

  grid.innerHTML = list.map(w => {
    const cat = getWeaponCategory(w.category_id);
    const safe = safeUrl(w.image_url);
    const type = getWeaponType(w.type_id);
    const thumb = safe
      ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(w.name)}" class="pixel-art" />`
      : `<span class="tier-chip-initials">${escapeHtml(initialsOf(w.name))}</span>`;
    return `
      <div class="weapon-card ${!w.published ? 'is-unpublished' : ''}" data-weapon-id="${w.id}">
        ${!w.published ? '<span class="weapon-unpublished-tag">Oculta</span>' : ''}
        <div class="weapon-card-thumb">${thumb}</div>
        <p class="weapon-card-name">${escapeHtml(w.name)}</p>
        <div class="weapon-card-badges">
          ${cat ? `<span class="weapon-cat-dot" style="background:${cat.color};"></span>` : ''}
          ${type ? `<span class="weapon-card-type">${escapeHtml(type.label)}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.weapon-card').forEach(card => {
    card.addEventListener('click', () => openWeaponDetail(card.dataset.weaponId));
  });
}

// ---------------------------------------------------------
// VISTA DE DETALLE
// ---------------------------------------------------------
function openWeaponDetail(weaponId) {
  state.currentWeaponId = weaponId;
  const ranks = getWeaponRanks(weaponId);
  state.currentWeaponRankId = ranks[0] ? ranks[0].id : null;
  document.getElementById('weapons-catalog-view').classList.add('hidden');
  document.getElementById('weapon-detail-view').classList.remove('hidden');
  renderWeaponDetail();
}

function closeWeaponDetail() {
  document.getElementById('weapon-detail-view').classList.add('hidden');
  document.getElementById('weapons-catalog-view').classList.remove('hidden');
  state.currentWeaponId = null;
  state.currentWeaponRankId = null;
}

function renderWeaponDetail() {
  const weapon = getCurrentWeapon();
  const container = document.getElementById('weapon-detail-content');
  if (!weapon) {
    container.innerHTML = `<p class="comments-empty">Esta arma ya no existe.</p>`;
    return;
  }

  const ranks = getWeaponRanks(weapon.id);
  if (!state.currentWeaponRankId || !ranks.some(r => r.id === state.currentWeaponRankId)) {
    state.currentWeaponRankId = ranks[0] ? ranks[0].id : null;
  }
  const rank = ranks.find(r => r.id === state.currentWeaponRankId) || null;

  const cat = getWeaponCategory(weapon.category_id);
  const type = getWeaponType(weapon.type_id);
  const safeImg = safeUrl((rank && rank.image_url) || weapon.image_url);
  const admin = isAdmin();

  const headerHtml = `
    <div class="weapon-detail-header">
      ${safeImg
        ? `<img src="${escapeHtml(safeImg)}" alt="${escapeHtml(weapon.name)}" class="weapon-detail-image pixel-art js-open-asset" data-asset-src="${escapeHtml(safeImg)}" data-asset-title="${escapeHtml(weapon.name)}" />`
        : `<div class="weapon-detail-image"></div>`}
      <div class="weapon-detail-headinfo">
        <h2 class="weapon-detail-name">${escapeHtml(weapon.name)}</h2>
        <div class="weapon-detail-badges">
          ${!weapon.published ? '<span class="weapon-unpublished-tag" style="position:static;">Oculta</span>' : ''}
          ${cat ? `<span class="weapon-cat-badge" style="border-color:${cat.color};color:${cat.color};">${escapeHtml(cat.label)}</span>` : ''}
          ${type ? `<span class="weapon-type-badge">${escapeHtml(type.label)}</span>` : ''}
        </div>
      </div>
      ${admin ? `
        <div class="weapon-detail-admin-actions">
          <button type="button" class="btn-secondary-admin" data-action="edit-weapon-info">✏️ Editar info</button>
          <button type="button" class="btn-secondary-admin" data-action="toggle-weapon-published">${weapon.published ? '🙈 Despublicar' : '👁 Publicar'}</button>
          <button type="button" class="btn-secondary-admin danger" data-action="delete-weapon">🗑 Borrar arma</button>
        </div>` : ''}
    </div>`;

  const rankSelectorHtml = `
    <div class="weapon-rank-selector">
      ${ranks.map(r => `
        <div class="weapon-rank-pill-wrap">
          <button type="button" class="pill ${rank && r.id === rank.id ? 'is-active' : ''}" data-action="select-rank" data-rank-id="${r.id}">${escapeHtml(r.name)}</button>
          ${admin ? `<button type="button" class="weapon-rank-admin-mini danger" data-action="delete-rank" data-rank-id="${r.id}" title="Borrar rango">✕</button>` : ''}
        </div>`).join('')}
      ${admin ? `<button type="button" class="pill" data-action="add-rank">+ Rango</button>` : ''}
    </div>`;

  const bodyHtml = rank
    ? renderWeaponRankBody(weapon, rank, admin)
    : `<p class="comments-empty">${admin ? 'Esta arma no tiene rangos todavía. Agrega el primero con "+ Rango".' : 'Esta arma no tiene información todavía.'}</p>`;

  container.innerHTML = headerHtml + rankSelectorHtml + bodyHtml;
  bindWeaponDetailEvents(container);
}

function renderWeaponRankBody(weapon, rank, admin) {
  let html = '';

  // ---- Descripción del rango ----
  html += `
    <div class="weapon-section-block">
      <div class="weapon-section-head">
        <h3 class="weapon-section-title">📈 ${escapeHtml(rank.name)}</h3>
        ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-rank-info" data-rank-id="${rank.id}">✏️ Editar rango</button></div>` : ''}
      </div>
      ${rank.description ? `<p class="weapon-rank-desc">${escapeHtml(rank.description)}</p>` : (admin ? '<p class="comments-empty">Sin descripción todavía.</p>' : '')}
    </div>`;

  // ---- Estadísticas ----
  const stats = asArray(rank.stats);
  if (stats.length > 0 || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">📊 Estadísticas</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-stats" data-rank-id="${rank.id}">✏️ Editar</button></div>` : ''}
        </div>
        ${stats.length > 0 ? `<div class="weapon-stats-grid">${stats.map(s => `
          <div class="stat-row">
            <span class="stat-row-label">${escapeHtml(s.key)}</span>
            <div class="bar-track"><div class="bar-fill bar-stat" style="width:100%"></div></div>
            <span class="stat-row-value" style="width:auto;">${escapeHtml(String(s.value ?? ''))}</span>
          </div>`).join('')}</div>` : '<p class="comments-empty">Sin estadísticas todavía.</p>'}
      </div>`;
  }

  // ---- Habilidades ----
  const abilities = asArray(rank.abilities);
  if (abilities.length > 0 || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">✨ Habilidades</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="add-ability" data-rank-id="${rank.id}">+ Habilidad</button></div>` : ''}
        </div>
        ${abilities.length > 0
          ? `<div class="weapon-abilities-list">${abilities.map((ab, idx) => renderAbilityCard(ab, idx, rank.id, admin)).join('')}</div>`
          : '<p class="comments-empty">Sin habilidades todavía.</p>'}
      </div>`;
  }

  // ---- Receta de mejora ----
  const recipe = rank.upgrade_recipe;
  if (recipe || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">🔁 Mejora</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-recipe" data-rank-id="${rank.id}">✏️ Editar receta</button></div>` : ''}
        </div>
        ${recipe ? renderRecipeTrade(recipe) : '<p class="comments-empty">Este rango no tiene receta de mejora configurada.</p>'}
      </div>`;
  }

  // ---- Secciones extra (futuro: curiosidades, notas, builds...) ----
  const sections = asArray(rank.extra_sections);
  sections.forEach((sec, idx) => {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">${escapeHtml(sec.title)}</h3>
          ${admin ? `<div class="weapon-section-admin-actions">
            <button type="button" class="btn-secondary-admin" data-action="edit-section" data-rank-id="${rank.id}" data-section-idx="${idx}">✏️</button>
            <button type="button" class="btn-secondary-admin danger" data-action="delete-section" data-rank-id="${rank.id}" data-section-idx="${idx}">🗑</button>
          </div>` : ''}
        </div>
        ${sec.kind === 'keyvalue'
          ? `<div class="item-detail-grid">${renderKeyValueRows(asArray(sec.fields))}</div>`
          : `<p class="weapon-extra-text">${escapeHtml(sec.text || '')}</p>`}
      </div>`;
  });

  if (admin) {
    html += `<button type="button" class="link-btn" data-action="add-section" data-rank-id="${rank.id}">+ Agregar sección</button>`;
  }

  return html;
}

function renderAbilityCard(ab, idx, rankId, admin) {
  const level = ab.level ?? 0;
  const levelMax = ab.level_max ?? 10;
  const pct = levelMax > 0 ? Math.min(100, Math.max(0, Math.round((level / levelMax) * 100))) : 0;
  const statsHtml = asArray(ab.stats).map(s => `
    <div class="weapon-ability-stat-row"><span class="stat-label">${escapeHtml(s.key)}</span><span class="stat-value">${escapeHtml(String(s.value ?? ''))}</span></div>`).join('');
  return `
    <div class="weapon-ability-card">
      <div class="weapon-ability-head">
        <p class="weapon-ability-name">${escapeHtml(ab.name || 'Habilidad')}</p>
        ${ab.tag ? `<span class="weapon-ability-tag">${escapeHtml(ab.tag)}</span>` : ''}
        ${admin ? `<div class="weapon-ability-admin-actions">
          <button type="button" class="btn-secondary-admin" data-action="edit-ability" data-rank-id="${rankId}" data-ability-idx="${idx}">✏️</button>
          <button type="button" class="btn-secondary-admin danger" data-action="delete-ability" data-rank-id="${rankId}" data-ability-idx="${idx}">🗑</button>
        </div>` : ''}
      </div>
      ${ab.description ? `<p class="weapon-ability-desc">${escapeHtml(ab.description)}</p>` : ''}
      <div class="weapon-ability-level-row">
        <span class="weapon-ability-level-label">Nivel: ${escapeHtml(String(level))}${levelMax ? ' / ' + escapeHtml(String(levelMax)) : ''}</span>
        <div class="bar-track"><div class="bar-fill bar-level" style="width:${pct}%"></div></div>
      </div>
      ${statsHtml ? `<div class="weapon-ability-stats-grid">${statsHtml}</div>` : ''}
    </div>`;
}

function renderRecipeTrade(recipe) {
  const materials = asArray(recipe.materials);
  const result = recipe.result || {};
  const matsHtml = materials.map(m => {
    const safe = safeUrl(m.image_url);
    return `
      <div class="weapon-recipe-material">
        <div class="weapon-recipe-material-thumb">
          ${safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(m.name || '')}" class="js-open-asset" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(m.name || '')}" />` : ''}
          <span class="weapon-recipe-material-qty">×${escapeHtml(String(m.qty ?? 1))}</span>
        </div>
        <span class="weapon-recipe-material-name">${escapeHtml(m.name || '')}</span>
      </div>`;
  }).join('');
  const safeResult = safeUrl(result.image_url);
  return `
    <div class="weapon-recipe-trade">
      <div class="weapon-recipe-materials">${matsHtml || '<p class="comments-empty">Sin materiales.</p>'}</div>
      <span class="weapon-recipe-arrow">→</span>
      <div class="weapon-recipe-result">
        <div class="weapon-recipe-result-thumb">${safeResult ? `<img src="${escapeHtml(safeResult)}" alt="${escapeHtml(result.name || '')}" class="js-open-asset" data-asset-src="${escapeHtml(safeResult)}" data-asset-title="${escapeHtml(result.name || '')}" />` : ''}</div>
        <span class="weapon-recipe-result-name">${escapeHtml(result.name || '')}</span>
      </div>
    </div>`;
}

function bindWeaponDetailEvents(container) {
  container.querySelectorAll('[data-action="select-rank"]').forEach(btn =>
    btn.addEventListener('click', () => { state.currentWeaponRankId = btn.dataset.rankId; renderWeaponDetail(); }));
  container.querySelectorAll('[data-action="add-rank"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRankModal(null)));
  container.querySelectorAll('[data-action="delete-rank"]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteWeaponRank(btn.dataset.rankId); }));
  container.querySelectorAll('[data-action="edit-weapon-info"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponModal(state.currentWeaponId)));
  container.querySelectorAll('[data-action="toggle-weapon-published"]').forEach(btn =>
    btn.addEventListener('click', () => toggleWeaponPublished(state.currentWeaponId)));
  container.querySelectorAll('[data-action="delete-weapon"]').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponAction(state.currentWeaponId)));
  container.querySelectorAll('[data-action="edit-rank-info"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRankModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="edit-stats"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponStatsModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="add-ability"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponAbilityModal(btn.dataset.rankId, null)));
  container.querySelectorAll('[data-action="edit-ability"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponAbilityModal(btn.dataset.rankId, Number(btn.dataset.abilityIdx))));
  container.querySelectorAll('[data-action="delete-ability"]').forEach(btn =>
    btn.addEventListener('click', () => deleteAbility(btn.dataset.rankId, Number(btn.dataset.abilityIdx))));
  container.querySelectorAll('[data-action="edit-recipe"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRecipeModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="add-section"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponSectionModal(btn.dataset.rankId, null)));
  container.querySelectorAll('[data-action="edit-section"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponSectionModal(btn.dataset.rankId, Number(btn.dataset.sectionIdx))));
  container.querySelectorAll('[data-action="delete-section"]').forEach(btn =>
    btn.addEventListener('click', () => deleteSection(btn.dataset.rankId, Number(btn.dataset.sectionIdx))));
}

// Aplica un cambio parcial a un rango, conservando todo lo demás
// tal cual está — upsert_weapon_rank siempre reemplaza el rango
// completo (mismo patrón que update_log con mobs/items, o
// set_field_config con la config entera).
async function saveRankPatch(rankId, patch) {
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return { error: { message: 'Este rango ya no existe' } };
  return supabaseClient.rpc('upsert_weapon_rank', {
    input_code: state.adminCode,
    input_id: rank.id,
    input_weapon_id: rank.weapon_id,
    input_name: rank.name,
    input_description: rank.description,
    input_image_url: rank.image_url,
    input_stats: rank.stats,
    input_abilities: rank.abilities,
    input_extra_sections: rank.extra_sections,
    input_upgrade_recipe: rank.upgrade_recipe,
    ...patch,
  });
}

// ---------------------------------------------------------
// ADMIN — categorías de arma
// ---------------------------------------------------------
function renderWeaponCategorySelectOptions() {
  const select = document.getElementById('weapon-category-input');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">— Sin categoría —</option>` +
    state.weaponCategories.map(c => `<option value="${c.id}">${escapeHtml(c.label)}</option>`).join('');
  if (current) select.value = current;
}

function renderWeaponCategoryManageList() {
  const container = document.getElementById('weapon-category-manage-list');
  if (!container) return;
  if (state.weaponCategories.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`; return; }
  container.innerHTML = state.weaponCategories.map(c => `
    <div class="category-manage-row">
      <span class="category-manage-label"><span class="weapon-cat-dot" style="background:${c.color};display:inline-block;margin-right:6px;"></span>${escapeHtml(c.label)}</span>
      <button type="button" class="category-manage-delete" data-id="${c.id}">🗑 Borrar</button>
    </div>`).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponCategory(btn.dataset.id)));
}

function openWeaponCategoryModal() {
  document.getElementById('weapon-category-label-input').value = '';
  document.getElementById('weapon-category-color-input').value = '#4dd4e8';
  document.getElementById('weapon-category-modal-error').classList.add('hidden');
  renderWeaponCategoryManageList();
  document.getElementById('weapon-category-modal').classList.remove('hidden');
}

async function submitWeaponCategory() {
  const errorBox = document.getElementById('weapon-category-modal-error');
  const label = document.getElementById('weapon-category-label-input').value.trim();
  const color = document.getElementById('weapon-category-color-input').value || '#4dd4e8';
  if (!label) { errorBox.textContent = 'Ponle un nombre a la categoría.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_weapon_category', { input_code: state.adminCode, input_label: label, input_color: color });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('weapon-category-label-input').value = '';
  showToast(`Categoría "${data.label}" creada`, 'success');
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  document.getElementById('weapon-category-input').value = data.id;
}

async function deleteWeaponCategory(id) {
  const cat = getWeaponCategory(id);
  if (!confirm(`¿Borrar la categoría "${cat ? cat.label : ''}"?`)) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_weapon_category', { input_code: state.adminCode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast('Categoría eliminada', 'success');
  if (state.weaponActiveCategoryFilter === id) state.weaponActiveCategoryFilter = 'all';
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  renderWeaponsGrid();
}

// ---------------------------------------------------------
// ADMIN — tipos de arma
// ---------------------------------------------------------
function renderWeaponTypeSelectOptions() {
  const select = document.getElementById('weapon-type-input');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">— Sin tipo —</option>` +
    state.weaponTypes.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('');
  if (current) select.value = current;
}

function renderWeaponTypeManageList() {
  const container = document.getElementById('weapon-type-manage-list');
  if (!container) return;
  if (state.weaponTypes.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay tipos todavía.</p>`; return; }
  container.innerHTML = state.weaponTypes.map(t => `
    <div class="category-manage-row">
      <span class="category-manage-label">${escapeHtml(t.label)}</span>
      <button type="button" class="category-manage-delete" data-id="${t.id}">🗑 Borrar</button>
    </div>`).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponType(btn.dataset.id)));
}

function openWeaponTypeModal() {
  document.getElementById('weapon-type-label-input').value = '';
  document.getElementById('weapon-type-modal-error').classList.add('hidden');
  renderWeaponTypeManageList();
  document.getElementById('weapon-type-modal').classList.remove('hidden');
}

async function submitWeaponType() {
  const errorBox = document.getElementById('weapon-type-modal-error');
  const label = document.getElementById('weapon-type-label-input').value.trim();
  if (!label) { errorBox.textContent = 'Ponle un nombre al tipo.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_weapon_type', { input_code: state.adminCode, input_label: label });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('weapon-type-label-input').value = '';
  showToast(`Tipo "${data.label}" creado`, 'success');
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  document.getElementById('weapon-type-input').value = data.id;
}

async function deleteWeaponType(id) {
  const t = getWeaponType(id);
  if (!confirm(`¿Borrar el tipo "${t ? t.label : ''}"?`)) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_weapon_type', { input_code: state.adminCode, input_id: id });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast('Tipo eliminado', 'success');
  if (state.weaponActiveTypeFilter === id) state.weaponActiveTypeFilter = 'all';
  suppressNextWeaponsReload();
  await loadWeaponMeta();
  renderWeaponsGrid();
}

// ---------------------------------------------------------
// ADMIN — arma (crear/editar/publicar/borrar)
// ---------------------------------------------------------
function openWeaponModal(weaponId = null) {
  state.editingWeaponId = weaponId;
  const titleEl = document.getElementById('weapon-modal-title');
  const initialRankRow = document.getElementById('weapon-initial-rank-row');
  renderWeaponCategorySelectOptions();
  renderWeaponTypeSelectOptions();
  if (weaponId) {
    const w = state.weapons.find(x => x.id === weaponId);
    if (!w) return;
    titleEl.textContent = '✏️ EDITAR ARMA';
    document.getElementById('weapon-name-input').value = w.name;
    document.getElementById('weapon-image-input').value = w.image_url || '';
    updateAssetPreview('weapon', w.image_url || '');
    document.getElementById('weapon-category-input').value = w.category_id || '';
    document.getElementById('weapon-type-input').value = w.type_id || '';
    initialRankRow.classList.add('hidden');
  } else {
    titleEl.textContent = '⚔️ NUEVA ARMA';
    document.getElementById('weapon-name-input').value = '';
    document.getElementById('weapon-image-input').value = '';
    updateAssetPreview('weapon', '');
    document.getElementById('weapon-category-input').value = state.weaponCategories[0] ? state.weaponCategories[0].id : '';
    document.getElementById('weapon-type-input').value = state.weaponTypes[0] ? state.weaponTypes[0].id : '';
    document.getElementById('weapon-initial-rank-input').value = 'MK1';
    initialRankRow.classList.remove('hidden');
  }
  document.getElementById('weapon-modal-error').classList.add('hidden');
  document.getElementById('weapon-modal').classList.remove('hidden');
}

async function submitWeapon() {
  const errorBox = document.getElementById('weapon-modal-error');
  const name = document.getElementById('weapon-name-input').value.trim();
  const imageUrl = document.getElementById('weapon-image-input').value.trim();
  const categoryId = document.getElementById('weapon-category-input').value || null;
  const typeId = document.getElementById('weapon-type-input').value || null;
  if (!name) { errorBox.textContent = 'Ponle un nombre al arma.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  let result;
  if (state.editingWeaponId) {
    result = await supabaseClient.rpc('update_weapon', {
      input_code: state.adminCode, input_id: state.editingWeaponId, input_name: name,
      input_image_url: imageUrl, input_category_id: categoryId, input_type_id: typeId,
    });
  } else {
    const initialRank = document.getElementById('weapon-initial-rank-input').value.trim() || 'MK1';
    result = await supabaseClient.rpc('create_weapon', {
      input_code: state.adminCode, input_name: name, input_image_url: imageUrl,
      input_category_id: categoryId, input_type_id: typeId, input_initial_rank_name: initialRank,
    });
  }
  if (result.error) { errorBox.textContent = 'Error: ' + result.error.message; errorBox.classList.remove('hidden'); return; }

  document.getElementById('weapon-modal').classList.add('hidden');
  showToast(state.editingWeaponId ? 'Arma actualizada' : 'Arma creada (oculta hasta publicarla)', 'success');
  const wasCreating = !state.editingWeaponId;
  const newId = result.data ? result.data.id : null;
  suppressNextWeaponsReload();
  await reloadWeaponData();
  if (wasCreating && newId) openWeaponDetail(newId);
}

async function toggleWeaponPublished(weaponId) {
  const w = state.weapons.find(x => x.id === weaponId);
  if (!w) return;
  const { error } = await supabaseClient.rpc('set_weapon_published', { input_code: state.adminCode, input_id: weaponId, input_published: !w.published });
  if (error) { showToast('No se pudo actualizar: ' + error.message, 'error'); return; }
  showToast(!w.published ? 'Arma publicada' : 'Arma despublicada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

async function deleteWeaponAction(weaponId) {
  if (!confirm('¿Borrar esta arma? Se perderán todos sus rangos, estadísticas y habilidades.')) return;
  const { error } = await supabaseClient.rpc('delete_weapon', { input_code: state.adminCode, input_id: weaponId });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  showToast('Arma eliminada', 'success');
  closeWeaponDetail();
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — rangos (info básica)
// ---------------------------------------------------------
function openWeaponRankModal(rankId) {
  state.editingWeaponRankId = rankId;
  const titleEl = document.getElementById('weapon-rank-modal-title');
  if (rankId) {
    const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
    if (!rank) return;
    titleEl.textContent = '✏️ EDITAR RANGO';
    document.getElementById('weapon-rank-name-input').value = rank.name;
    document.getElementById('weapon-rank-desc-input').value = rank.description || '';
    document.getElementById('weapon-rank-image-input').value = rank.image_url || '';
    updateAssetPreview('weapon-rank', rank.image_url || '');
  } else {
    titleEl.textContent = '📈 NUEVO RANGO';
    document.getElementById('weapon-rank-name-input').value = '';
    document.getElementById('weapon-rank-desc-input').value = '';
    document.getElementById('weapon-rank-image-input').value = '';
    updateAssetPreview('weapon-rank', '');
  }
  document.getElementById('weapon-rank-modal-error').classList.add('hidden');
  document.getElementById('weapon-rank-modal').classList.remove('hidden');
}

async function submitWeaponRank() {
  const errorBox = document.getElementById('weapon-rank-modal-error');
  const name = document.getElementById('weapon-rank-name-input').value.trim();
  const description = document.getElementById('weapon-rank-desc-input').value.trim();
  const imageUrl = document.getElementById('weapon-rank-image-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre al rango.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const existing = state.editingWeaponRankId ? getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId) : null;

  const { error } = await supabaseClient.rpc('upsert_weapon_rank', {
    input_code: state.adminCode,
    input_id: state.editingWeaponRankId,
    input_weapon_id: state.currentWeaponId,
    input_name: name,
    input_description: description,
    input_image_url: imageUrl,
    input_stats: existing ? existing.stats : [],
    input_abilities: existing ? existing.abilities : [],
    input_extra_sections: existing ? existing.extra_sections : [],
    input_upgrade_recipe: existing ? existing.upgrade_recipe : null,
  });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-rank-modal').classList.add('hidden');
  showToast(state.editingWeaponRankId ? 'Rango actualizado' : 'Rango creado', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

async function deleteWeaponRank(rankId) {
  const ranks = getWeaponRanks(state.currentWeaponId);
  const msg = ranks.length <= 1
    ? 'Este es el último rango del arma. ¿Borrarlo igual? El arma quedará sin rangos hasta que agregues otro.'
    : '¿Borrar este rango? Se perderán sus estadísticas, habilidades y receta.';
  if (!confirm(msg)) return;
  const { error } = await supabaseClient.rpc('delete_weapon_rank', { input_code: state.adminCode, input_id: rankId });
  if (error) { showToast('No se pudo borrar el rango', 'error'); return; }
  showToast('Rango eliminado', 'success');
  if (state.currentWeaponRankId === rankId) state.currentWeaponRankId = null;
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — estadísticas del rango
// ---------------------------------------------------------
function openWeaponStatsModal(rankId) {
  state.editingWeaponRankId = rankId;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  state.weaponStatsDraft = JSON.parse(JSON.stringify(asArray(rank.stats)));
  renderExtraFieldsEditor('weapon-stats-list', () => state.weaponStatsDraft);
  document.getElementById('weapon-stats-modal-error').classList.add('hidden');
  document.getElementById('weapon-stats-modal').classList.remove('hidden');
}

async function submitWeaponStats() {
  const errorBox = document.getElementById('weapon-stats-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const cleanStats = state.weaponStatsDraft.filter(s => s.key && s.key.trim()).map(s => ({ key: s.key.trim(), value: s.value }));
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_stats: cleanStats });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-stats-modal').classList.add('hidden');
  showToast('Estadísticas guardadas', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — habilidades
// ---------------------------------------------------------
function openWeaponAbilityModal(rankId, abilityIdx) {
  state.editingWeaponRankId = rankId;
  state.editingAbilityIndex = abilityIdx;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const abilities = asArray(rank.abilities);
  const titleEl = document.getElementById('weapon-ability-modal-title');
  if (abilityIdx != null) {
    const ab = abilities[abilityIdx] || {};
    titleEl.textContent = '✏️ EDITAR HABILIDAD';
    document.getElementById('weapon-ability-name-input').value = ab.name || '';
    document.getElementById('weapon-ability-tag-input').value = ab.tag || '';
    document.getElementById('weapon-ability-desc-input').value = ab.description || '';
    document.getElementById('weapon-ability-level-input').value = ab.level ?? 1;
    document.getElementById('weapon-ability-level-max-input').value = ab.level_max ?? 10;
    state.weaponAbilityStatsDraft = JSON.parse(JSON.stringify(asArray(ab.stats)));
  } else {
    titleEl.textContent = '✨ NUEVA HABILIDAD';
    document.getElementById('weapon-ability-name-input').value = '';
    document.getElementById('weapon-ability-tag-input').value = '';
    document.getElementById('weapon-ability-desc-input').value = '';
    document.getElementById('weapon-ability-level-input').value = 1;
    document.getElementById('weapon-ability-level-max-input').value = 10;
    state.weaponAbilityStatsDraft = [];
  }
  renderExtraFieldsEditor('weapon-ability-stats-list', () => state.weaponAbilityStatsDraft);
  document.getElementById('weapon-ability-modal-error').classList.add('hidden');
  document.getElementById('weapon-ability-modal').classList.remove('hidden');
}

async function submitWeaponAbility() {
  const errorBox = document.getElementById('weapon-ability-modal-error');
  const name = document.getElementById('weapon-ability-name-input').value.trim();
  if (!name) { errorBox.textContent = 'Ponle un nombre a la habilidad.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
  if (!rank) return;

  const newAbility = {
    name,
    tag: document.getElementById('weapon-ability-tag-input').value.trim(),
    description: document.getElementById('weapon-ability-desc-input').value.trim(),
    level: Number(document.getElementById('weapon-ability-level-input').value) || 0,
    level_max: Number(document.getElementById('weapon-ability-level-max-input').value) || 1,
    stats: state.weaponAbilityStatsDraft.filter(s => s.key && s.key.trim()).map(s => ({ key: s.key.trim(), value: s.value })),
  };

  const abilities = JSON.parse(JSON.stringify(asArray(rank.abilities)));
  if (state.editingAbilityIndex != null) abilities[state.editingAbilityIndex] = newAbility;
  else abilities.push(newAbility);

  const { error } = await saveRankPatch(rank.id, { input_abilities: abilities });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-ability-modal').classList.add('hidden');
  showToast('Habilidad guardada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

async function deleteAbility(rankId, idx) {
  if (!confirm('¿Borrar esta habilidad?')) return;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const abilities = JSON.parse(JSON.stringify(asArray(rank.abilities)));
  abilities.splice(idx, 1);
  const { error } = await saveRankPatch(rankId, { input_abilities: abilities });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  showToast('Habilidad eliminada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — receta de mejora (estilo "trade")
// ---------------------------------------------------------
function renderRecipeMaterialsEditor() {
  const container = document.getElementById('weapon-recipe-materials-list');
  const list = state.weaponRecipeMaterialsDraft;
  if (list.length === 0) {
    container.innerHTML = `<p class="equip-empty-hint">Sin materiales. Usa "+ Material" para agregar (cualquier cantidad).</p>`;
    return;
  }
  container.innerHTML = list.map((m, idx) => `
    <div class="weapon-material-row">
      <input type="text" class="modal-input wm-name" data-idx="${idx}" data-f="name" value="${escapeHtml(m.name || '')}" placeholder="Nombre del material" maxlength="60" />
      <button type="button" class="btn-upload-zone btn-upload-zone-sm wm-img-btn" data-idx="${idx}">${m.image_url ? '✅ Imagen' : '📁 Imagen'}</button>
      <input type="file" class="hidden wm-img-file" data-idx="${idx}" accept="image/png,image/jpeg,image/jpg,image/webp" />
      <input type="number" class="modal-input wm-qty" data-idx="${idx}" data-f="qty" value="${m.qty ?? 1}" min="1" />
      <button type="button" class="enchant-remove" data-idx="${idx}">🗑</button>
    </div>`).join('');
  container.querySelectorAll('input[data-f]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = Number(el.dataset.idx);
      const field = el.dataset.f;
      list[idx][field] = field === 'qty' ? (Number(el.value) || 1) : el.value;
    });
  });
  // Botones de subir imagen de cada material
  container.querySelectorAll('.wm-img-btn').forEach(btn => {
    const idx = Number(btn.dataset.idx);
    const fileInput = container.querySelectorAll('.wm-img-file')[idx];
    if (!fileInput) return;
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      btn.textContent = '…';
      try {
        const oldUrl = list[idx].image_url || '';
        const publicUrl = await uploadImageToStorage(file, 'recipes', oldUrl);
        list[idx].image_url = publicUrl;
        btn.textContent = '✅ Imagen';
        showToast('Imagen del material subida', 'success');
      } catch (err) {
        btn.textContent = list[idx].image_url ? '✅ Imagen' : '📁 Imagen';
        showToast(err.message, 'error');
      }
    });
  });
  container.querySelectorAll('.enchant-remove').forEach(btn => {
    btn.addEventListener('click', () => { list.splice(Number(btn.dataset.idx), 1); renderRecipeMaterialsEditor(); });
  });
}

function openWeaponRecipeModal(rankId) {
  state.editingWeaponRankId = rankId;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const recipe = rank.upgrade_recipe || { materials: [], result: { name: '', image_url: '' } };
  state.weaponRecipeMaterialsDraft = JSON.parse(JSON.stringify(asArray(recipe.materials)));
  document.getElementById('weapon-recipe-result-name-input').value = recipe.result ? (recipe.result.name || '') : '';
  document.getElementById('weapon-recipe-result-image-input').value = recipe.result ? (recipe.result.image_url || '') : '';
  renderRecipeMaterialsEditor();
  document.getElementById('weapon-recipe-modal-error').classList.add('hidden');
  document.getElementById('weapon-recipe-modal').classList.remove('hidden');
}

async function submitWeaponRecipe() {
  const errorBox = document.getElementById('weapon-recipe-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const resultName = document.getElementById('weapon-recipe-result-name-input').value.trim();
  const resultImage = document.getElementById('weapon-recipe-result-image-input').value.trim();
  const materials = state.weaponRecipeMaterialsDraft.filter(m => m.name && m.name.trim()).map(m => ({ name: m.name.trim(), image_url: m.image_url || '', qty: m.qty || 1 }));
  if (materials.length === 0 && !resultName) { errorBox.textContent = 'Agrega al menos un material o un resultado.'; errorBox.classList.remove('hidden'); return; }
  const recipe = { materials, result: { name: resultName, image_url: resultImage } };
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_upgrade_recipe: recipe });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-recipe-modal').classList.add('hidden');
  showToast('Receta guardada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

async function clearWeaponRecipe() {
  if (!confirm('¿Quitar la receta de mejora de este rango?')) return;
  const { error } = await saveRankPatch(state.editingWeaponRankId, { input_upgrade_recipe: null });
  if (error) { showToast('No se pudo quitar la receta', 'error'); return; }
  document.getElementById('weapon-recipe-modal').classList.add('hidden');
  showToast('Receta eliminada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// ADMIN — secciones extra (libres, para crecer a futuro)
// ---------------------------------------------------------
function toggleWeaponSectionKindUI() {
  const kind = document.getElementById('weapon-section-kind-input').value;
  document.getElementById('weapon-section-text-wrap').classList.toggle('hidden', kind !== 'text');
  document.getElementById('weapon-section-fields-wrap').classList.toggle('hidden', kind !== 'keyvalue');
}

function openWeaponSectionModal(rankId, sectionIdx) {
  state.editingWeaponRankId = rankId;
  state.editingSectionIndex = sectionIdx;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const sections = asArray(rank.extra_sections);
  const titleEl = document.getElementById('weapon-section-modal-title');
  const kindSelect = document.getElementById('weapon-section-kind-input');
  if (sectionIdx != null) {
    const sec = sections[sectionIdx] || {};
    titleEl.textContent = '✏️ EDITAR SECCIÓN';
    document.getElementById('weapon-section-title-input').value = sec.title || '';
    kindSelect.value = sec.kind || 'text';
    document.getElementById('weapon-section-text-input').value = sec.text || '';
    state.weaponSectionFieldsDraft = JSON.parse(JSON.stringify(asArray(sec.fields)));
  } else {
    titleEl.textContent = '📑 NUEVA SECCIÓN';
    document.getElementById('weapon-section-title-input').value = '';
    kindSelect.value = 'text';
    document.getElementById('weapon-section-text-input').value = '';
    state.weaponSectionFieldsDraft = [];
  }
  toggleWeaponSectionKindUI();
  renderExtraFieldsEditor('weapon-section-fields-list', () => state.weaponSectionFieldsDraft);
  document.getElementById('weapon-section-modal-error').classList.add('hidden');
  document.getElementById('weapon-section-modal').classList.remove('hidden');
}

async function submitWeaponSection() {
  const errorBox = document.getElementById('weapon-section-modal-error');
  const title = document.getElementById('weapon-section-title-input').value.trim();
  if (!title) { errorBox.textContent = 'Ponle un título a la sección.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
  if (!rank) return;
  const kind = document.getElementById('weapon-section-kind-input').value;
  const newSection = {
    title,
    kind,
    text: kind === 'text' ? document.getElementById('weapon-section-text-input').value.trim() : '',
    fields: kind === 'keyvalue' ? state.weaponSectionFieldsDraft.filter(f => f.key && f.key.trim()).map(f => ({ key: f.key.trim(), value: f.value || '' })) : [],
  };
  const sections = JSON.parse(JSON.stringify(asArray(rank.extra_sections)));
  if (state.editingSectionIndex != null) sections[state.editingSectionIndex] = newSection;
  else sections.push(newSection);
  const { error } = await saveRankPatch(rank.id, { input_extra_sections: sections });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  document.getElementById('weapon-section-modal').classList.add('hidden');
  showToast('Sección guardada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

async function deleteSection(rankId, idx) {
  if (!confirm('¿Borrar esta sección?')) return;
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return;
  const sections = JSON.parse(JSON.stringify(asArray(rank.extra_sections)));
  sections.splice(idx, 1);
  const { error } = await saveRankPatch(rankId, { input_extra_sections: sections });
  if (error) { showToast('No se pudo borrar', 'error'); return; }
  showToast('Sección eliminada', 'success');
  suppressNextWeaponsReload();
  await reloadWeaponData();
}

// ---------------------------------------------------------
// MODALES Y BOTONES — Guía de Armas
// ---------------------------------------------------------
function initWeaponModals() {
  document.getElementById('weapon-search-input').addEventListener('input', debounce((e) => {
    state.weaponSearchTerm = e.target.value.trim();
    renderWeaponsGrid();
  }, 250));
  document.getElementById('weapon-back-btn').addEventListener('click', closeWeaponDetail);

  document.getElementById('open-new-weapon-btn').addEventListener('click', () => openWeaponModal(null));
  document.getElementById('close-weapon-modal').addEventListener('click', () => document.getElementById('weapon-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-btn').addEventListener('click', submitWeapon);
  document.getElementById('weapon-image-input').addEventListener('change', (e) => updateAssetPreview('weapon', e.target.value.trim()));
  initImageUploader('weapon', 'weapons', () => {
    const w = state.weapons.find(x => x.id === state.editingWeaponId);
    return w ? (w.image_url || '') : '';
  });
  document.getElementById('weapon-image-clear-btn').addEventListener('click', () => {
    document.getElementById('weapon-image-input').value = '';
    updateAssetPreview('weapon', '');
  });

  ['open-weapon-category-manage-btn', 'open-weapon-category-manage-btn-inline'].forEach(id =>
    document.getElementById(id).addEventListener('click', openWeaponCategoryModal));
  document.getElementById('close-weapon-category-modal').addEventListener('click', () => document.getElementById('weapon-category-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-category-btn').addEventListener('click', submitWeaponCategory);

  ['open-weapon-type-manage-btn', 'open-weapon-type-manage-btn-inline'].forEach(id =>
    document.getElementById(id).addEventListener('click', openWeaponTypeModal));
  document.getElementById('close-weapon-type-modal').addEventListener('click', () => document.getElementById('weapon-type-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-type-btn').addEventListener('click', submitWeaponType);

  document.getElementById('close-weapon-rank-modal').addEventListener('click', () => document.getElementById('weapon-rank-modal').classList.add('hidden'));
  document.getElementById('submit-weapon-rank-btn').addEventListener('click', submitWeaponRank);
  document.getElementById('weapon-rank-image-input').addEventListener('change', (e) => updateAssetPreview('weapon-rank', e.target.value.trim()));
  initImageUploader('weapon-rank', 'weapon-ranks', () => {
    const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
    return rank ? (rank.image_url || '') : '';
  });
  document.getElementById('weapon-rank-image-clear-btn').addEventListener('click', () => {
    document.getElementById('weapon-rank-image-input').value = '';
    updateAssetPreview('weapon-rank', '');
  });

  document.getElementById('close-weapon-stats-modal').addEventListener('click', () => document.getElementById('weapon-stats-modal').classList.add('hidden'));
  document.getElementById('weapon-stats-add-btn').addEventListener('click', () => {
    state.weaponStatsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-stats-list', () => state.weaponStatsDraft);
  });
  document.getElementById('submit-weapon-stats-btn').addEventListener('click', submitWeaponStats);

  document.getElementById('close-weapon-ability-modal').addEventListener('click', () => document.getElementById('weapon-ability-modal').classList.add('hidden'));
  document.getElementById('weapon-ability-stats-add-btn').addEventListener('click', () => {
    state.weaponAbilityStatsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-ability-stats-list', () => state.weaponAbilityStatsDraft);
  });
  document.getElementById('submit-weapon-ability-btn').addEventListener('click', submitWeaponAbility);

  document.getElementById('close-weapon-recipe-modal').addEventListener('click', () => document.getElementById('weapon-recipe-modal').classList.add('hidden'));
  document.getElementById('weapon-recipe-add-material-btn').addEventListener('click', () => {
    state.weaponRecipeMaterialsDraft.push({ name: '', image_url: '', qty: 1 });
    renderRecipeMaterialsEditor();
  });
  document.getElementById('submit-weapon-recipe-btn').addEventListener('click', submitWeaponRecipe);
  document.getElementById('clear-weapon-recipe-btn').addEventListener('click', clearWeaponRecipe);

  // Uploader de imagen para el RESULTADO de receta (el único que no tenía file input antes)
  const recipeResultUploadBtn = document.getElementById('weapon-recipe-result-image-upload-btn');
  const recipeResultFileInput = document.getElementById('weapon-recipe-result-image-file');
  const recipeResultHidden    = document.getElementById('weapon-recipe-result-image-input');
  const recipeResultImgName   = document.getElementById('weapon-recipe-result-img-name');
  if (recipeResultUploadBtn && recipeResultFileInput) {
    recipeResultUploadBtn.addEventListener('click', () => recipeResultFileInput.click());
    recipeResultFileInput.addEventListener('change', async () => {
      const file = recipeResultFileInput.files[0];
      if (!file) return;
      recipeResultFileInput.value = '';
      recipeResultUploadBtn.textContent = '…';
      try {
        const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === state.editingWeaponRankId);
        const oldUrl = rank?.upgrade_recipe?.result?.image_url || '';
        const publicUrl = await uploadImageToStorage(file, 'recipes', oldUrl);
        recipeResultHidden.value = publicUrl;
        if (recipeResultImgName) { recipeResultImgName.textContent = '✅ Imagen lista'; recipeResultImgName.classList.remove('hidden'); }
        showToast('Imagen del resultado subida', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        recipeResultUploadBtn.textContent = '📁 Imagen del resultado';
      }
    });
  }

  document.getElementById('close-weapon-section-modal').addEventListener('click', () => document.getElementById('weapon-section-modal').classList.add('hidden'));
  document.getElementById('weapon-section-kind-input').addEventListener('change', toggleWeaponSectionKindUI);
  document.getElementById('weapon-section-add-field-btn').addEventListener('click', () => {
    state.weaponSectionFieldsDraft.push({ key: '', value: '' });
    renderExtraFieldsEditor('weapon-section-fields-list', () => state.weaponSectionFieldsDraft);
  });
  document.getElementById('submit-weapon-section-btn').addEventListener('click', submitWeaponSection);
}

// ---------------------------------------------------------
// REALTIME
// ---------------------------------------------------------
function initRealtime() {
  supabaseClient.channel('logs-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, () => {
      if (_suppressRealtimeReload) return;
      loadLogs();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_mobs' }, () => {
      if (_suppressRealtimeReload) return;
      loadLogs();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_items' }, () => {
      if (_suppressRealtimeReload) return;
      loadLogs();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
      if (state.currentDetailLogId) loadComments(state.currentDetailLogId);
    })
    .subscribe();

  supabaseClient.channel('tierlist-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_rows' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) loadTierlist();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_items' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) loadTierlist();
    })
    .subscribe();

  supabaseClient.channel('weapons-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapons' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) reloadWeaponData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_ranks' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) reloadWeaponData();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_categories' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) loadWeaponMeta();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_types' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) loadWeaponMeta();
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
  document.getElementById('close-log-modal').addEventListener('click', () => {
    stopDraftAutosave();
    document.getElementById('log-modal').classList.add('hidden');
  });
  document.getElementById('submit-log-btn').addEventListener('click', submitLog);

  document.getElementById('open-add-mob-btn').addEventListener('click', () => openMobModal(null));
  document.getElementById('close-mob-modal').addEventListener('click', () => document.getElementById('mob-modal').classList.add('hidden'));
  document.getElementById('submit-mob-btn').addEventListener('click', submitMobBlock);
  document.getElementById('mob-add-equipment-btn').addEventListener('click', addEquipmentPiece);
  document.getElementById('mob-add-extra-btn').addEventListener('click', () => { state.mobExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('mob-extra-fields-list', () => state.mobExtraDraft); });
  document.getElementById('mob-image-input').addEventListener('change', (e) => updateAssetPreview('mob', e.target.value.trim()));
  initImageUploader('mob', 'mobs', () => {
    const mob = state.editingMobIndex != null ? state.draftMobs[state.editingMobIndex] : null;
    return mob ? (mob.image_url || '') : '';
  });
  document.getElementById('mob-image-clear-btn').addEventListener('click', () => {
    document.getElementById('mob-image-input').value = '';
    updateAssetPreview('mob', '');
  });

  document.getElementById('open-add-item-btn').addEventListener('click', () => openItemModal(null));
  document.getElementById('close-item-modal').addEventListener('click', () => document.getElementById('item-modal').classList.add('hidden'));
  document.getElementById('submit-item-btn').addEventListener('click', submitItemBlock);
  document.getElementById('item-add-enchant-btn').addEventListener('click', addItemEnchant);
  document.getElementById('item-add-extra-btn').addEventListener('click', () => { state.itemExtraDraft.push({ key: '', value: '' }); renderExtraFieldsEditor('item-extra-fields-list', () => state.itemExtraDraft); });
  document.getElementById('item-image-input').addEventListener('change', (e) => updateAssetPreview('item', e.target.value.trim()));
  initImageUploader('item', 'items', () => {
    const item = state.editingItemIndex != null ? state.draftItems[state.editingItemIndex] : null;
    return item ? (item.image_url || '') : '';
  });
  document.getElementById('item-image-clear-btn').addEventListener('click', () => {
    document.getElementById('item-image-input').value = '';
    updateAssetPreview('item', '');
  });

  document.getElementById('open-add-libre-btn').addEventListener('click', () => openLibreModal(null));
  document.getElementById('close-libre-modal').addEventListener('click', () => document.getElementById('libre-modal').classList.add('hidden'));
  document.getElementById('submit-libre-btn').addEventListener('click', submitLibreBlock);
  document.getElementById('libre-add-field-btn').addEventListener('click', addLibreField);
  document.getElementById('libre-image-input').addEventListener('change', (e) => updateAssetPreview('libre', e.target.value.trim()));
  initImageUploader('libre', 'items', () => {
    const lib = state.editingLibreIndex != null ? state.draftLibres[state.editingLibreIndex] : null;
    return lib ? (lib.image_url || '') : '';
  });
  document.getElementById('libre-image-clear-btn').addEventListener('click', () => {
    document.getElementById('libre-image-input').value = '';
    updateAssetPreview('libre', '');
  });

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
  document.getElementById('close-tier-item-modal').addEventListener('click', () => document.getElementById('tier-item-modal').classList.add('hidden'));
  document.getElementById('submit-tier-item-btn').addEventListener('click', submitTierItem);
  document.getElementById('tier-item-image-input').addEventListener('change', (e) => {
    updateAssetPreview('tier-item', e.target.value.trim());
    syncTierDropzoneState(e.target.value.trim());
  });

  initTierItemDropzone();
  initImageUploader('tier-item', 'tierlist', () => {
    const item = state.editingTierItemId ? state.tierItems.find(i => i.id === state.editingTierItemId) : null;
    return item ? (item.image_url || '') : '';
  });

  document.getElementById('close-tier-move-modal').addEventListener('click', () => document.getElementById('tier-move-modal').classList.add('hidden'));
  document.getElementById('submit-tier-move-btn').addEventListener('click', submitTierMove);

  document.getElementById('close-detail-modal').addEventListener('click', () => { document.getElementById('detail-modal').classList.add('hidden'); cancelReply(); });
  document.getElementById('submit-comment-btn').addEventListener('click', submitComment);
  document.getElementById('comment-reply-cancel').addEventListener('click', cancelReply);

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
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

// ---------------------------------------------------------
// INIT
// ---------------------------------------------------------
async function init() {
  initTabs();
  initModals();
  initWeaponModals();
  initSortControl();
  initAdminPanel();
  updateAdminUI();
  await loadCategories();
  await loadAppSettings();
  await loadLogs();
  initRealtime();
}

document.addEventListener('DOMContentLoaded', init);

// =========================================================
// SISTEMA DE BORRADORES (Drafts)
// Almacenamiento: localStorage
// Claves: culones_draft_log_new | culones_draft_log_{id}
// =========================================================

const DRAFT_AUTOSAVE_INTERVAL = 30000; // 30 segundos
let _draftAutosaveTimer = null;
let _draftHasUnsaved = false;

function draftKey(logId) {
  return logId === 'new' ? 'culones_draft_log_new' : `culones_draft_log_${logId}`;
}

/** Captura el estado actual del form de log en un objeto serializable */
function captureDraftData() {
  return {
    title: document.getElementById('log-title-input')?.value || '',
    description: document.getElementById('log-desc-input')?.value || '',
    category: document.getElementById('log-category-input')?.value || '',
    relevance: document.getElementById('log-relevance-input')?.value || 'normal',
    date: document.getElementById('log-date-input')?.value || '',
    mobs: JSON.parse(JSON.stringify(state.draftMobs)),
    items: JSON.parse(JSON.stringify(state.draftItems)),
    libres: JSON.parse(JSON.stringify(state.draftLibres)),
  };
}

/** Guarda el borrador en localStorage */
function saveDraft(logId, isManual = false) {
  if (!isAdmin()) return;
  const key = draftKey(logId || 'new');
  const data = captureDraftData();
  // No guardar si está completamente vacío
  if (!data.title && !data.description && data.mobs.length === 0 && data.items.length === 0 && data.libres.length === 0) return;
  const draft = {
    savedAt: new Date().toISOString(),
    isLocal: !logId, // true si nunca fue publicado
    logId: logId || null,
    data,
  };
  try {
    localStorage.setItem(key, JSON.stringify(draft));
    _draftHasUnsaved = false;
    updateDraftAutosaveStatus('saved', draft.savedAt);
    if (isManual) showToast('Borrador guardado', 'success');
  } catch(e) {
    showToast('No se pudo guardar el borrador (localStorage lleno?)', 'error');
  }
}

/** Lee un borrador de localStorage */
function loadDraftFromStorage(logId) {
  const key = draftKey(logId || 'new');
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch(e) { return null; }
}

/** Elimina un borrador */
function clearDraft(logId) {
  localStorage.removeItem(draftKey(logId || 'new'));
  renderDraftsList();
}

/** Restaura los datos de un borrador al form */
function restoreDraft(draft) {
  const d = draft.data;
  document.getElementById('log-title-input').value = d.title || '';
  document.getElementById('log-desc-input').value = d.description || '';
  if (d.category) document.getElementById('log-category-input').value = d.category;
  document.getElementById('log-relevance-input').value = d.relevance || 'normal';
  if (d.date) document.getElementById('log-date-input').value = d.date;
  state.draftMobs = d.mobs || [];
  state.draftItems = d.items || [];
  state.draftLibres = d.libres || [];
  renderDraftBlocksList();
  hideDraftBanner();
  showToast('Borrador restaurado', 'success');
}

/** Muestra el banner de borrador disponible si existe uno */
function checkAndShowDraftBanner(logId) {
  const banner = document.getElementById('log-draft-banner');
  const timeEl = document.getElementById('log-draft-banner-time');
  if (!banner) return;
  const draft = loadDraftFromStorage(logId || 'new');
  if (!draft) { banner.classList.add('hidden'); return; }
  const when = new Date(draft.savedAt);
  timeEl.textContent = `Guardado el ${formatDate(draft.savedAt)}`;
  banner.classList.remove('hidden');

  document.getElementById('log-draft-restore-btn').onclick = () => restoreDraft(draft);
  document.getElementById('log-draft-discard-btn').onclick = () => {
    clearDraft(logId || 'new');
    hideDraftBanner();
    showToast('Borrador descartado');
  };
}

function hideDraftBanner() {
  const banner = document.getElementById('log-draft-banner');
  if (banner) banner.classList.add('hidden');
}

/** Arranca el autoguardado cada 30s mientras el modal está abierto */
function startDraftAutosave() {
  stopDraftAutosave();
  _draftHasUnsaved = false;
  updateDraftAutosaveStatus('idle');

  // Marcar como "hay cambios" cuando el admin escribe
  const fields = ['log-title-input', 'log-desc-input', 'log-category-input', 'log-relevance-input', 'log-date-input'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', markDraftDirty);
  });

  _draftAutosaveTimer = setInterval(() => {
    if (_draftHasUnsaved) {
      saveDraft(state.editingLogId || 'new');
    }
  }, DRAFT_AUTOSAVE_INTERVAL);
}

function stopDraftAutosave() {
  if (_draftAutosaveTimer) { clearInterval(_draftAutosaveTimer); _draftAutosaveTimer = null; }
  // Remove listeners
  const fields = ['log-title-input', 'log-desc-input', 'log-category-input', 'log-relevance-input', 'log-date-input'];
  fields.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.removeEventListener('input', markDraftDirty);
  });
}

function markDraftDirty() {
  _draftHasUnsaved = true;
  updateDraftAutosaveStatus('unsaved');
}

function updateDraftAutosaveStatus(state, savedAt = null) {
  const el = document.getElementById('draft-autosave-status');
  if (!el) return;
  switch(state) {
    case 'saved': el.textContent = `✅ Guardado ${savedAt ? formatDate(savedAt) : ''}`; el.className = 'draft-autosave-status is-saved'; break;
    case 'unsaved': el.textContent = '● Cambios sin guardar'; el.className = 'draft-autosave-status is-dirty'; break;
    default: el.textContent = ''; el.className = 'draft-autosave-status'; break;
  }
}

/** Aviso antes de cerrar la página si hay cambios sin guardar */
function initBeforeUnload() {
  window.addEventListener('beforeunload', (e) => {
    if (_draftHasUnsaved && document.getElementById('log-modal') && !document.getElementById('log-modal').classList.contains('hidden')) {
      // Guardar automáticamente al cerrar
      saveDraft(state.editingLogId || 'new');
    }
  });
}

// ---------------------------------------------------------
// LISTA DE TODOS LOS BORRADORES (pestaña herramientas)
// ---------------------------------------------------------
function getAllDrafts() {
  const drafts = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key.startsWith('culones_draft_')) continue;
    try {
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft && draft.savedAt) drafts.push({ key, ...draft });
    } catch(e) {}
  }
  return drafts.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
}

function renderDraftsList() {
  const container = document.getElementById('drafts-list');
  if (!container) return;
  const drafts = getAllDrafts();
  if (drafts.length === 0) {
    container.innerHTML = '<p class="admin-empty">No hay borradores guardados.</p>';
    return;
  }
  container.innerHTML = drafts.map(d => {
    const title = d.data?.title || '(Sin título)';
    const localTag = d.isLocal ? '<span class="draft-local-tag">[local]</span>' : '';
    const blocksCount = (d.data?.mobs?.length || 0) + (d.data?.items?.length || 0) + (d.data?.libres?.length || 0);
    const blocksHint = blocksCount > 0 ? `· ${blocksCount} bloque${blocksCount > 1 ? 's' : ''}` : '';
    return `
      <div class="draft-list-row">
        <div class="draft-list-info">
          <span class="draft-list-title">📝 ${escapeHtml(title)} ${localTag}</span>
          <span class="draft-list-meta">${formatDate(d.savedAt)} ${blocksHint}</span>
        </div>
        <div class="draft-list-actions">
          <button type="button" class="btn-secondary-admin draft-open-btn" data-draft-key="${d.key}" data-log-id="${d.logId || ''}">Abrir</button>
          <button type="button" class="btn-secondary-admin danger draft-delete-btn" data-draft-key="${d.key}">🗑</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.draft-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const draft = JSON.parse(localStorage.getItem(btn.dataset.draftKey));
      if (!draft) return;
      const logId = btn.dataset.logId || null;
      if (logId) openEditLogModal(logId);
      else openNewLogModal();
      // Restaurar después de que el modal se abra
      setTimeout(() => restoreDraft(draft), 50);
    });
  });
  container.querySelectorAll('.draft-delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.removeItem(btn.dataset.draftKey);
      renderDraftsList();
      showToast('Borrador eliminado');
    });
  });
}

// ---------------------------------------------------------
// EXPORT / IMPORT
// ---------------------------------------------------------

/** Descarga un objeto como archivo */
// ---------------------------------------------------------
// =========================================================
// SISTEMA DE EXPORTACIÓN EXCEL (xlsx) — PROFESIONAL
// Usa SheetJS (XLSX) cargado via CDN.
// Reutiliza los mismos datos que usaba la exportación CSV
// anterior (state.logs, state.mobsByLog, etc.) sin cambiar
// ninguna otra parte de la aplicación.
// =========================================================

// ---------------------------------------------------------
// UTILIDADES DE FORMATO (reemplaza las antiguas csvCell etc.)
// Mantiene compatibilidad con el resto de la app.
// ---------------------------------------------------------

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

function timestamp() {
  return new Date().toISOString().slice(0, 10);
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
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

  downloadXlsx(wb, `culones-logs-${timestamp()}.xlsx`);
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

function exportTierlistXlsx() {
  const { wsRows, wsItems } = buildTierlistSheets();

  const wb = XLSX.utils.book_new();
  wb.Props = { Title: 'Culones RPG — Tierlist', Subject: 'Tierlist exportada', CreatedDate: new Date() };

  XLSX.utils.book_append_sheet(wb, wsRows,  'Filas Tier');
  XLSX.utils.book_append_sheet(wb, wsItems, 'Items Tier');

  downloadXlsx(wb, `culones-tierlist-${timestamp()}.xlsx`);
  showToast('Tierlist exportada a Excel (2 hojas)', 'success');
}

// ---------------------------------------------------------
// EXPORTACIÓN COMPLETA → EXCEL (todas las hojas)
// Incluye Logs, Mobs, Items, Bloques Libres, Tierlist,
// Armas, Categorías de armas, Tipos de armas y Configuración.
// ---------------------------------------------------------
async function exportAllXlsx() {
  // Asegurar tierlist cargada (solo datos, sin render extra)
  if (!state.tierlistLoaded) await loadTierlist();

  // Obtener datos de armas sin disparar ningún render de la guía
  const weaponData = await fetchWeaponsDataForExport();

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
  XLSX.utils.book_append_sheet(wb, wsCfg,      'Configuración');

  downloadXlsx(wb, `culones-backup-${timestamp()}.xlsx`);
  showToast('Backup completo exportado a Excel (13 hojas)', 'success');
}

// ---------------------------------------------------------
// PUNTO DE ENTRADA ÚNICO DE EXPORTACIÓN
// Mantiene la misma firma que antes: exportData(type, format)
// para no romper el event listener de initAdminPanel().
// ---------------------------------------------------------
async function exportData(type, format) {
  showToast('Preparando exportación...', 'default');

  // -------- JSON (sin cambios, compatibilidad total) --------
  if (format === 'json') {
    if (type === 'logs') {
      const logsWithBlocks = state.logs.map(log => ({
        ...log,
        mobs:  state.mobsByLog[log.id]  || [],
        items: state.itemsByLog[log.id] || [],
      }));
      downloadFile(
        JSON.stringify({ version: 1, type: 'logs', exported_at: new Date().toISOString(), data: logsWithBlocks }, null, 2),
        `culones-logs-${timestamp()}.json`, 'application/json',
      );
      showToast(`${logsWithBlocks.length} logs exportados`, 'success');

    } else if (type === 'tierlist') {
      if (!state.tierlistLoaded) await loadTierlist();
      downloadFile(
        JSON.stringify({ version: 1, type: 'tierlist', exported_at: new Date().toISOString(), rows: state.tierRows, items: state.tierItems }, null, 2),
        `culones-tierlist-${timestamp()}.json`, 'application/json',
      );
      showToast('Tierlist exportada', 'success');

    } else if (type === 'all') {
      if (!state.tierlistLoaded) await loadTierlist();
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
        weapons: state.weapons,
        weapon_categories: state.weaponCategories,
        weapon_types: state.weaponTypes,
        weapon_ranks: state.weaponRanksByWeapon,
        field_config: state.fieldConfig,
      };
      downloadFile(JSON.stringify(backup, null, 2), `culones-backup-${timestamp()}.json`, 'application/json');
      showToast('Backup completo exportado', 'success');
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
      exportLogsXlsx();
    } else if (type === 'tierlist') {
      if (!state.tierlistLoaded) await loadTierlist();
      exportTierlistXlsx();
    } else if (type === 'all') {
      await exportAllXlsx();
    }
  }
}

// ---- Import ----
let _importPayload = null; // datos del archivo leído
let _importConflicts = []; // [{item, resolution: 'overwrite'|'skip'}]

async function handleImportFile(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext !== 'json') { showToast('Solo se soportan archivos JSON por ahora', 'error'); return; }

  showToast('Leyendo archivo...', 'default');
  const text = await file.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch(e) { showToast('El archivo no es un JSON válido', 'error'); return; }

  _importPayload = parsed;
  await analyzeAndShowImportConflicts(parsed);
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

  _importConflicts = allConflicts;
  showImportConflictModal(allConflicts);
}

function showImportConflictModal(conflicts) {
  const modal = document.getElementById('import-conflict-modal');
  const summaryEl = document.getElementById('import-conflict-summary');
  const listEl = document.getElementById('import-conflict-list');

  const conflictCount = conflicts.filter(c => c.isConflict).length;
  const newCount = conflicts.filter(c => !c.isConflict).length;

  summaryEl.textContent = `${conflicts.length} elemento(s) encontrados: ${newCount} nuevos, ${conflictCount} con conflicto de ID.`;

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

  listEl.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      _importConflicts[Number(radio.dataset.idx)].resolution = radio.value;
    });
  });

  modal.classList.remove('hidden');
}

async function confirmImport() {
  const errorBox = document.getElementById('import-conflict-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const toImport = _importConflicts.filter(c => c.resolution !== 'skip');
  if (toImport.length === 0) { showToast('Nada que importar'); document.getElementById('import-conflict-modal').classList.add('hidden'); return; }

  showToast(`Importando ${toImport.length} elemento(s)...`, 'default');
  let imported = 0;
  let errors = 0;

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
      } else if (conflict.kind === 'tier_row') {
        const row = conflict.item;
        if (conflict.isConflict) {
          await supabaseClient.rpc('update_tierlist_row', { input_code: state.adminCode, input_id: row.id, input_name: row.name, input_color: row.color });
        } else {
          await supabaseClient.rpc('create_tierlist_row', { input_code: state.adminCode, input_name: row.name, input_color: row.color });
        }
        imported++;
      } else if (conflict.kind === 'tier_item') {
        const item = conflict.item;
        await supabaseClient.rpc('upsert_tierlist_item', {
          input_code: state.adminCode, input_id: conflict.isConflict ? item.id : null,
          input_name: item.name, input_image_url: item.image_url || null,
          input_column_key: item.column_key, input_row_id: item.row_id || null,
          input_extra_fields: asArray(item.extra_fields),
        });
        imported++;
      }
    } catch(e) {
      console.error('Import error:', e);
      errors++;
    }
  }

  document.getElementById('import-conflict-modal').classList.add('hidden');
  document.getElementById('import-file-input').value = '';
  showToast(`Importación completa: ${imported} ok${errors > 0 ? `, ${errors} error(es)` : ''}`, errors > 0 ? 'error' : 'success');
  suppressNextRealtimeReload();
  suppressNextTierlistReload();
  await loadLogs();
  if (state.tierlistLoaded) await loadTierlist();
}

// =========================================================
// ACERCA DEL SERVER — renderizado público + editor admin
// =========================================================

const ABOUT_BLOCK_KINDS = {
  heading:   { label: '🔤 Título',     icon: '🔤' },
  text:      { label: '📝 Texto',      icon: '📝' },
  image:     { label: '🖼 Imagen',     icon: '🖼' },
  divider:   { label: '➖ Separador',  icon: '➖' },
  highlight: { label: '✨ Destacado',  icon: '✨' },
};

function renderAboutContent() {
  const container = document.getElementById('about-content-render');
  if (!container) return;
  const blocks = state.aboutBlocks;
  if (!blocks || blocks.length === 0) {
    container.innerHTML = `
      <div class="placeholder-panel">
        <div class="placeholder-icon">🎮</div>
        <h2>Acerca de culones-rpg</h2>
        <p>Servidor de Minecraft con sistema RPG y gacha.</p>
      </div>`;
    return;
  }
  container.innerHTML = blocks.map(block => {
    switch (block.kind) {
      case 'heading':   return `<h2 class="about-block-heading">${escapeHtml(block.content || '')}</h2>`;
      case 'text':      return `<p class="about-block-text">${escapeHtml(block.content || '')}</p>`;
      case 'highlight': return `<div class="about-block-highlight">${escapeHtml(block.content || '')}</div>`;
      case 'divider':   return `<hr class="about-block-divider" />`;
      case 'image': {
        const safe = (block.url || '').replace(/['"\\]/g, '');
        if (!safe) return '';
        return `<img class="about-block-image" src="${escapeHtml(safe)}" alt="${escapeHtml(block.caption || '')}" loading="lazy" />` +
               (block.caption ? `<p class="about-block-image-caption">${escapeHtml(block.caption)}</p>` : '');
      }
      default: return '';
    }
  }).join('');
}

function openAboutEditor() {
  state.aboutEditorBlocks = JSON.parse(JSON.stringify(state.aboutBlocks || []));
  renderAboutEditorBlocks();
  document.getElementById('about-editor-error').classList.add('hidden');
  document.getElementById('about-editor-modal').classList.remove('hidden');
}

function renderAboutEditorBlocks() {
  const container = document.getElementById('about-blocks-editor');
  if (!container) return;
  if (state.aboutEditorBlocks.length === 0) {
    container.innerHTML = '<p class="admin-empty" style="padding:16px 0;">No hay bloques todavía. Usá los botones de abajo para agregar contenido.</p>';
    return;
  }
  const meta = (b) => ({ heading:'🔤 Título', text:'📝 Texto', image:'🖼 Imagen', divider:'➖ Separador', highlight:'✨ Destacado' }[b.kind] || b.kind);
  container.innerHTML = state.aboutEditorBlocks.map((block, idx) => {
    const first = idx === 0, last = idx === state.aboutEditorBlocks.length - 1;
    const btns = `<div class="about-editor-block-actions">
      <button type="button" class="move-about-block" data-dir="-1" data-idx="${idx}" ${first ? 'disabled' : ''}>▲</button>
      <button type="button" class="move-about-block" data-dir="1" data-idx="${idx}" ${last ? 'disabled' : ''}>▼</button>
      <button type="button" class="del-about-block" data-idx="${idx}">✕</button>
    </div>`;
    if (block.kind === 'divider') return `<div class="about-editor-block is-divider" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span><div class="about-editor-divider-preview"></div></div>${btns}</div>`;
    if (block.kind === 'image') return `<div class="about-editor-block" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span>
      <div class="about-block-image-upload-row">
        ${block.url ? `<img src="${escapeHtml(block.url)}" alt="" class="about-block-image-thumb" />` : ''}
        <button type="button" class="btn-upload-zone btn-upload-zone-sm about-block-img-btn" data-idx="${idx}">${block.url ? '✅ Imagen' : '📁 Elegir imagen'}</button>
        <input type="file" class="hidden about-block-img-file" data-idx="${idx}" accept="image/png,image/jpeg,image/jpg,image/webp" />
        ${block.url ? `<button type="button" class="link-btn about-block-img-clear" data-idx="${idx}">✕ Quitar</button>` : ''}
      </div>
      <input type="text" class="modal-input about-block-field" data-idx="${idx}" data-field="caption" value="${escapeHtml(block.caption||'')}" placeholder="Pie de foto (opcional)" /></div>${btns}</div>`;
    return `<div class="about-editor-block" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span><textarea class="modal-input about-block-field" data-idx="${idx}" data-field="content" rows="${block.kind==='heading'?1:3}" placeholder="${block.kind==='heading'?'Título':'Contenido...'}">${escapeHtml(block.content||'')}</textarea></div>${btns}</div>`;
  }).join('');

  container.querySelectorAll('.about-block-field').forEach(el => {
    el.addEventListener('input', (e) => { state.aboutEditorBlocks[+e.target.dataset.idx][e.target.dataset.field] = e.target.value; });
  });
  container.querySelectorAll('.about-block-img-btn').forEach(btn => {
    const idx = Number(btn.dataset.idx);
    const fileInput = container.querySelector(`.about-block-img-file[data-idx="${idx}"]`);
    if (!fileInput) return;
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      btn.textContent = '…';
      try {
        const oldUrl = state.aboutEditorBlocks[idx].url || '';
        const publicUrl = await uploadImageToStorage(file, 'about', oldUrl);
        state.aboutEditorBlocks[idx].url = publicUrl;
        showToast('Imagen subida correctamente', 'success');
        renderAboutEditorBlocks();
      } catch (err) {
        btn.textContent = state.aboutEditorBlocks[idx].url ? '✅ Imagen' : '📁 Elegir imagen';
        showToast(err.message, 'error');
      }
    });
  });
  container.querySelectorAll('.about-block-img-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.aboutEditorBlocks[idx].url = '';
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.move-about-block').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx, d = +btn.dataset.dir, j = i + d;
      if (j < 0 || j >= state.aboutEditorBlocks.length) return;
      [state.aboutEditorBlocks[i], state.aboutEditorBlocks[j]] = [state.aboutEditorBlocks[j], state.aboutEditorBlocks[i]];
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.del-about-block').forEach(btn => {
    btn.addEventListener('click', () => { state.aboutEditorBlocks.splice(+btn.dataset.idx, 1); renderAboutEditorBlocks(); });
  });
}

function addAboutBlock(kind) {
  const block = { kind };
  if (kind === 'image') { block.url = ''; block.caption = ''; }
  else if (kind !== 'divider') block.content = '';
  state.aboutEditorBlocks.push(block);
  renderAboutEditorBlocks();
  const c = document.getElementById('about-blocks-editor');
  if (c) setTimeout(() => c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }), 50);
}

async function saveAboutContent() {
  const errorBox = document.getElementById('about-editor-error');
  errorBox.classList.add('hidden');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'about_blocks', input_value: state.aboutEditorBlocks });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.aboutBlocks = JSON.parse(JSON.stringify(state.aboutEditorBlocks));
  document.getElementById('about-editor-modal').classList.add('hidden');
  renderAboutContent();
  showToast('Página "Acerca del Server" actualizada', 'success');
}

// =========================================================
// FONDO DE LA PÁGINA
// =========================================================
function populateBackgroundForm() {
  const cfg = state.backgroundConfig;
  const urlInput = document.getElementById('bg-image-input');
  if (!urlInput) return;
  urlInput.value = cfg.image_url || '';
  updateAssetPreview('bg', cfg.image_url || '');
  syncGenericDropzoneState('bg', cfg.image_url || '');
  const r = document.querySelector(`input[name="bg-mode"][value="${cfg.mode||'fixed'}"]`);
  if (r) r.checked = true;
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(cb => { cb.checked = Array.isArray(cfg.tabs) && cfg.tabs.includes(cb.value); });
}

function readBackgroundForm() {
  return {
    image_url: document.getElementById('bg-image-input')?.value.trim() || '',
    mode: document.querySelector('input[name="bg-mode"]:checked')?.value || 'fixed',
    tabs: Array.from(document.querySelectorAll('#bg-tabs-options input:checked')).map(cb => cb.value),
  };
}

function applyCustomBackground(config) {
  const cfg = config || state.backgroundConfig;
  const valid = !!cfg.image_url && /^https?:\/\//i.test(cfg.image_url);
  const show  = valid && Array.isArray(cfg.tabs) && cfg.tabs.includes(state.activeTab || 'logs');
  if (!show) { ['backgroundImage','backgroundAttachment','backgroundSize','backgroundPosition','backgroundRepeat'].forEach(p => document.body.style[p] = ''); return; }
  const u = cfg.image_url.replace(/["\\]/g, '');
  document.body.style.backgroundImage = `url("${u}")`;
  document.body.style.backgroundPosition = 'center center';
  document.body.style.backgroundRepeat = 'no-repeat';
  if (cfg.mode === 'continuous') { document.body.style.backgroundSize = '100% auto'; document.body.style.backgroundAttachment = 'scroll'; }
  else if (cfg.mode === 'contain') { document.body.style.backgroundSize = 'contain'; document.body.style.backgroundAttachment = 'fixed'; }
  else { document.body.style.backgroundSize = 'cover'; document.body.style.backgroundAttachment = 'fixed'; }
}

async function saveBackgroundConfig() {
  const errorBox = document.getElementById('bg-config-error');
  errorBox.classList.add('hidden');
  const value = readBackgroundForm();
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'background_config', input_value: value });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.backgroundConfig = value;
  applyCustomBackground();
  showToast(value.image_url ? 'Fondo guardado para todos' : 'Fondo de página quitado', 'success');
}

async function clearBackgroundConfig() {
  if (!confirm('¿Quitar el fondo personalizado para todos?')) return;
  const i = document.getElementById('bg-image-input'); if (i) i.value = '';
  updateAssetPreview('bg', '');
  syncGenericDropzoneState('bg', '');
  await saveBackgroundConfig();
}

function initBackgroundTool() {
  const u = document.getElementById('bg-image-input'); if (!u) return;
  const preview = () => applyCustomBackground(readBackgroundForm());
  document.querySelectorAll('input[name="bg-mode"]').forEach(r => r.addEventListener('change', preview));
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(cb => cb.addEventListener('change', preview));
  document.getElementById('bg-save-btn')?.addEventListener('click', saveBackgroundConfig);
  document.getElementById('bg-clear-btn')?.addEventListener('click', clearBackgroundConfig);
  document.getElementById('bg-image-clear-btn')?.addEventListener('click', () => {
    u.value = '';
    updateAssetPreview('bg', '');
    syncGenericDropzoneState('bg', '');
    preview();
  });
  initGenericImageDropzone('bg', 'backgrounds', () => state.backgroundConfig.image_url || '', (url) => {
    updateAssetPreview('bg', url);
    preview();
  });
}

// =========================================================
// FAVICON
// =========================================================
function applyFavicon(url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = url;
}

function populateFaviconForm() {
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  if (input) input.value = state.faviconUrl || '';
  syncGenericDropzoneState('favicon', state.faviconUrl || '');
  if (preview) preview.innerHTML = state.faviconUrl ? `<img src="${escapeHtml(state.faviconUrl)}" alt="favicon" onerror="this.parentNode.textContent='?'" />` : '?';
}

async function saveFaviconConfig() {
  const errorBox = document.getElementById('favicon-config-error');
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  errorBox.classList.add('hidden');
  const url = input?.value.trim() || '';
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'favicon_url', input_value: url });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.faviconUrl = url;
  applyFavicon(url);
  if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="favicon" onerror="this.parentNode.textContent='?'" />` : '?';
  showToast(url ? 'Icono de página guardado' : 'Icono de página quitado', 'success');
}

function initFaviconTool() {
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  if (!input) return;
  document.getElementById('favicon-save-btn')?.addEventListener('click', saveFaviconConfig);
  document.getElementById('favicon-clear-btn')?.addEventListener('click', () => {
    input.value = '';
    syncGenericDropzoneState('favicon', '');
    if (preview) preview.innerHTML = '?';
  });
  initGenericImageDropzone('favicon', 'favicons', () => state.faviconUrl || '', (url) => {
    if (preview) preview.innerHTML = `<img src="${escapeHtml(url)}" alt="favicon" onerror="this.parentNode.textContent='?'" />`;
    applyFavicon(url);
  });
}

function initAboutEditor() {
  document.getElementById('open-about-editor-btn')?.addEventListener('click', openAboutEditor);
  document.getElementById('close-about-editor-modal')?.addEventListener('click', () => { document.getElementById('about-editor-modal').classList.add('hidden'); });
  document.getElementById('save-about-editor-btn')?.addEventListener('click', saveAboutContent);
  document.querySelectorAll('.btn-add-about-block').forEach(btn => { btn.addEventListener('click', () => addAboutBlock(btn.dataset.kind)); });
  document.getElementById('about-editor-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
}

function initAdminPanel() {
  // Export buttons
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', () => exportData(btn.dataset.export, btn.dataset.format));
  });

  // Import: file input
  // Reseteamos el value ANTES de procesar (no después) para que volver a
  // elegir el mismo archivo dispare el evento 'change' correctamente.
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';          // reset inmediato → permite reseleccionar el mismo archivo
    if (file) handleImportFile(file);
  });

  // Import: drag & drop
  const dropZone = document.getElementById('import-drop-zone');
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('is-drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-drag-over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-drag-over');
    if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
  });

  // Import conflict modal
  document.getElementById('close-import-conflict-modal').addEventListener('click', () => {
    document.getElementById('import-conflict-modal').classList.add('hidden');
  });
  document.getElementById('import-conflict-cancel-btn').addEventListener('click', () => {
    document.getElementById('import-conflict-modal').classList.add('hidden');
  });
  document.getElementById('import-conflict-confirm-btn').addEventListener('click', confirmImport);
  document.getElementById('import-conflict-all-overwrite').addEventListener('click', () => {
    _importConflicts.forEach((c, idx) => {
      c.resolution = 'import';
      document.querySelectorAll(`input[name="conflict-${idx}"][value="import"]`).forEach(r => r.checked = true);
    });
  });
  document.getElementById('import-conflict-all-skip').addEventListener('click', () => {
    _importConflicts.forEach((c, idx) => {
      c.resolution = 'skip';
      document.querySelectorAll(`input[name="conflict-${idx}"][value="skip"]`).forEach(r => r.checked = true);
    });
  });

  // Draft manual save
  document.getElementById('draft-manual-save-btn')?.addEventListener('click', () => {
    saveDraft(state.editingLogId || 'new', true);
  });

  // Clear all drafts
  document.getElementById('drafts-clear-all-btn')?.addEventListener('click', () => {
    if (!confirm('¿Eliminar TODOS los borradores? Esta acción no se puede deshacer.')) return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('culones_draft_')) keys.push(k);
    }
    keys.forEach(k => localStorage.removeItem(k));
    renderDraftsList();
    showToast('Todos los borradores eliminados');
  });

  initAboutEditor();
  initBackgroundTool();
  initFaviconTool();
  initBeforeUnload();
}

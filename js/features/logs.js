// =========================================================
// logs.js
// =========================================================
// Núcleo del sistema de Logs: orden/paginación, carga desde Supabase,
// render de tarjetas, likes, apertura de detalle, y alta/edición/borrado
// de logs (CRUD admin).
// =========================================================

import { supabaseClient } from '../config.js';
import { bindBlockChipEvents, parseLibreFields, renderBlocksSection, renderLogEntryDetail } from './blocks-display.js';
import { renderDraftBlocksList } from './blocks-editor.js';
import { renderCategorySelectOptions } from './categories.js';
import { cancelReply, loadComments } from './comments.js';
import { checkAndShowDraftBanner, clearDraft, startDraftAutosave, stopDraftAutosave } from './drafts.js';
import { loadLogsData } from './logs-data.js';
import { PAGE_SIZE, RELEVANCE_LABELS, RELEVANCE_ORDER, TIER_COLUMNS, getCategory, isAdmin, state, suppressNextRealtimeReload } from '../core/state.js';
import { asArray, cloneData, confirmAction, copyEditorPayload, escapeHtml, formatDate, getEditorPayload, hasEditorPayload, safeUrl, showToast, toDatetimeLocalValue } from '../core/utils.js';
import { appendActionGrid, openContextPanel } from '../core/context-actions.js';

let selectedLogId = null;
let inspectorTab = 'summary';

function getLogCollections(logId) {
  const mobs = state.mobsByLog[logId] || [];
  const allItems = state.itemsByLog[logId] || [];
  const items = allItems.filter(item => item.item_type !== '_libre');
  const libres = allItems.filter(item => item.item_type === '_libre');
  return { mobs, items, libres };
}

function getLogPreview(log) {
  return safeUrl(log?.cover_image_url || '') || '';
}

function getLogCounts(logId) {
  const { mobs, items, libres } = getLogCollections(logId);
  return { mobs: mobs.length, items: items.length, libres: libres.length };
}

function buildLogPreviewHtml(log, cat) {
  const preview = getLogPreview(log);
  if (preview) {
    return `<img src="${escapeHtml(preview)}" alt="" loading="lazy" decoding="async" />`;
  }
  return `<span class="log-row-media-fallback" style="--log-cat-color:${cat.color}">${cat.emoji || '📜'}</span>`;
}

function duplicateLogToEditor(log) {
  const payload = logEditorPayload(log);
  payload.title = `${payload.title} (copia)`;
  applyLogEditorPayload(payload, { asNew: true });
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


export function initSortControl() {
  const select = document.getElementById('sort-select');
  select.value = state.sortMode;
  select.addEventListener('change', () => { state.sortMode = select.value; state.logsPage = 1; renderLogs(); });
}

// ---------------------------------------------------------
// CARGA DE LOGS
// ---------------------------------------------------------

export async function loadLogs() {
  const ok = await loadLogsData();
  if (ok) renderLogs();
}

// ---------------------------------------------------------
// RENDER DE BLOQUES — FIX: barras a 100% fijas (indicador,
// no comparación). Encantamientos en cyan.
// ---------------------------------------------------------

function buildLogCardHtml(log) {
  const isLiked = state.likedLogIds.has(log.id);
  const cat = getCategory(log.category);
  const counts = getLogCounts(log.id);
  const selected = selectedLogId === log.id;
  return `
    <article class="log-card log-list-card ${selected ? 'is-selected' : ''}" data-relevance="${log.relevance}" data-log-id="${log.id}" tabindex="0" aria-selected="${selected ? 'true' : 'false'}">
      <div class="log-row-media">${buildLogPreviewHtml(log, cat)}</div>

      <div class="log-row-content">
        <div class="log-row-kicker">
          <span class="log-category-tag" style="border-color:${cat.color}66;color:${cat.color};background:${cat.color}12;"><span class="log-tag-icon" aria-hidden="true">${escapeHtml(cat.emoji || '📜')}</span><span>${escapeHtml(cat.label)}</span></span>
          <span class="log-relevance-badge"><span>${escapeHtml(RELEVANCE_LABELS[log.relevance] || log.relevance)}</span></span>
        </div>
        <h3 class="log-card-title">${escapeHtml(log.title)}</h3>
        <p class="log-card-desc">${escapeHtml(log.description)}</p>
        <div class="log-row-date">▣ ${formatDate(log.created_at)}</div>
      </div>

      <div class="log-row-metrics" aria-label="Contenido del log">
        <span><b>👾</b><span>Mobs</span><strong>${counts.mobs}</strong></span>
        <span><b>🗡</b><span>Items</span><strong>${counts.items}</strong></span>
        <span><b>📋</b><span>Bloques</span><strong>${counts.libres}</strong></span>
        <button class="log-like-btn ${isLiked ? 'is-liked' : ''}" data-log-id="${log.id}" aria-label="${isLiked ? 'Quitar me gusta' : 'Dar me gusta'}">
          ${isLiked ? '❤️' : '♡'} <span class="like-count">${log.likes}</span>
        </button>
      </div>

      ${isAdmin() ? `<button class="context-menu-trigger log-row-actions-trigger" data-action="log-actions" data-log-id="${log.id}" aria-label="Acciones del log">⋯</button>` : ''}
    </article>`;
}

function selectLog(logId, { resetTab = true } = {}) {
  if (!state.logs.some(log => log.id === logId)) return;
  selectedLogId = logId;
  state.currentDetailLogId = logId;
  if (resetTab) inspectorTab = 'summary';

  document.querySelectorAll('.log-list-card').forEach(card => {
    const active = card.dataset.logId === logId;
    card.classList.toggle('is-selected', active);
    card.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  renderLogInspector();
  if (window.matchMedia('(max-width: 1180px)').matches) {
    document.body.classList.add('logs-inspector-open');
  }
}

function bindCardEvents(card) {
  const activate = () => selectLog(card.dataset.logId);
  card.addEventListener('click', (e) => {
    if (e.target.closest('.log-like-btn') || e.target.closest('.context-menu-trigger')) return;
    activate();
  });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('button')) {
      e.preventDefault();
      activate();
    }
  });

  const likeBtn = card.querySelector('.log-like-btn');
  if (likeBtn) likeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(likeBtn.dataset.logId); });

  const actionsBtn = card.querySelector('[data-action="log-actions"]');
  if (actionsBtn) actionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLogCardActions(actionsBtn, actionsBtn.dataset.logId);
  });
}

function renderInspectorEntityCard(entry, type, contextKey) {
  const icon = type === 'mob' ? '👾' : type === 'item' ? '🗡' : '📋';
  const image = entry.image_url
    ? `<img src="${escapeHtml(entry.image_url)}" alt="" loading="lazy" decoding="async" />`
    : `<span>${icon}</span>`;
  const panelId = `block-detail-${contextKey}-${entry.id}`;

  let facts = [];
  if (type === 'mob') {
    if (entry.health != null) facts.push(`Vida ${escapeHtml(String(entry.health))}`);
    if (entry.damage != null) facts.push(`Daño ${escapeHtml(String(entry.damage))}`);
    if (entry.armor != null) facts.push(`Armor ${escapeHtml(String(entry.armor))}`);
    if (entry.location) facts.push(escapeHtml(entry.location));
  } else if (type === 'item') {
    if (entry.tier) facts.push(escapeHtml(entry.tier));
    if (entry.item_type) facts.push(escapeHtml(entry.item_type));
    if (entry.damage != null) facts.push(`Daño ${escapeHtml(String(entry.damage))}`);
    if (entry.obtained_from) facts.push(escapeHtml(entry.obtained_from));
  } else {
    facts = parseLibreFields(entry).slice(0, 4).map(field => `${escapeHtml(field.key)}${field.value ? `: ${escapeHtml(field.value)}` : ''}`);
  }

  return `
    <article class="inspector-entity-card" data-entry-id="${escapeHtml(String(entry.id))}">
      <button type="button" class="inspector-entity-toggle" data-panel-id="${panelId}" aria-expanded="false">
        <span class="inspector-entity-media">${image}</span>
        <span class="inspector-entity-copy">
          <span class="inspector-entity-title">${icon} ${escapeHtml(entry.name || 'Sin nombre')}</span>
          ${entry.description ? `<span class="inspector-entity-description">${escapeHtml(entry.description)}</span>` : ''}
          ${facts.length ? `<span class="inspector-entity-facts">${facts.map(fact => `<span>${fact}</span>`).join('')}</span>` : '<span class="inspector-entity-empty">Pulsa para ver todos los datos.</span>'}
        </span>
        <span class="inspector-entity-caret" aria-hidden="true">⌄</span>
      </button>
      ${renderLogEntryDetail(entry, type, contextKey)}
    </article>`;
}

function renderInspectorTabBody(log) {
  const { mobs, items, libres } = getLogCollections(log.id);
  const cat = getCategory(log.category);
  const isLiked = state.likedLogIds.has(log.id);
  const contextKey = `inspector-${log.id}-${inspectorTab}`;

  if (inspectorTab === 'mobs') {
    return mobs.length
      ? `<div class="inspector-entity-list">${mobs.map(entry => renderInspectorEntityCard(entry, 'mob', contextKey)).join('')}</div>`
      : '<div class="logs-inspector-tab-empty">Este log no tiene mobs.</div>';
  }
  if (inspectorTab === 'items') {
    return items.length
      ? `<div class="inspector-entity-list">${items.map(entry => renderInspectorEntityCard(entry, 'item', contextKey)).join('')}</div>`
      : '<div class="logs-inspector-tab-empty">Este log no tiene items.</div>';
  }
  if (inspectorTab === 'blocks') {
    return libres.length
      ? `<div class="inspector-entity-list">${libres.map(entry => renderInspectorEntityCard(entry, 'libre', contextKey)).join('')}</div>`
      : '<div class="logs-inspector-tab-empty">Este log no tiene bloques libres.</div>';
  }

  return `
    <div class="logs-inspector-summary">
      <section class="logs-inspector-section">
        <h3>Descripción</h3>
        <p class="logs-inspector-description">${escapeHtml(log.description)}</p>
      </section>

      <section class="logs-inspector-section inspector-meta-grid">
        <div><span>Categoría</span><strong style="color:${cat.color}">${cat.emoji} ${escapeHtml(cat.label)}</strong></div>
        <div><span>Relevancia</span><strong>${RELEVANCE_LABELS[log.relevance] || log.relevance}</strong></div>
        <div><span>Fecha</span><strong>${formatDate(log.created_at)}</strong></div>
      </section>

      <section class="logs-inspector-section inspector-count-grid">
        <div><strong>${mobs.length}</strong><span>Mobs</span></div>
        <div><strong>${items.length}</strong><span>Items</span></div>
        <div><strong>${libres.length}</strong><span>Bloques</span></div>
        <button class="inspector-like-btn ${isLiked ? 'is-liked' : ''}" data-inspector-action="like">
          <strong>${isLiked ? '❤️' : '♡'} ${log.likes}</strong><span>Me gusta</span>
        </button>
      </section>

      <section class="logs-inspector-actions">
        <button class="btn-secondary-admin inspector-action-wide" data-inspector-action="open-full"><span aria-hidden="true">◉</span><span>Abrir log completo</span></button>
        ${isAdmin() ? `
          <div class="logs-inspector-admin-actions">
            <button class="btn-primary" data-inspector-action="edit"><span aria-hidden="true">✎</span><span>Editar log</span></button>
            <button class="btn-secondary-admin" data-inspector-action="duplicate"><span aria-hidden="true">⧉</span><span>Duplicar log</span></button>
            <button class="btn-danger" data-inspector-action="delete"><span aria-hidden="true">🗑</span><span>Eliminar log</span></button>
          </div>` : ''}
      </section>
    </div>`;
}

function resetLogInspectorScroll({ focusTop = false } = {}) {
  const inspector = document.getElementById('logs-inspector');
  const body = inspector?.querySelector('.logs-inspector-body');
  if (body) {
    body.scrollTop = 0;
    body.scrollLeft = 0;
  }
  if (focusTop && inspector && window.matchMedia('(max-width: 1180px)').matches) {
    inspector.scrollTop = 0;
  }
}

function renderLogInspector() {
  const inspector = document.getElementById('logs-inspector');
  if (!inspector) return;
  const log = state.logs.find(item => item.id === selectedLogId);
  if (!log) {
    state.currentDetailLogId = null;
    inspector.innerHTML = `
      <div class="logs-inspector-empty">
        <span class="logs-inspector-empty-icon" aria-hidden="true">✦</span>
        <h2>Selecciona un log</h2>
        <p>El resumen, las fichas y las acciones aparecerán aquí sin abrir otra ventana.</p>
      </div>`;
    inspector.classList.remove('has-selection');
    document.body.classList.remove('logs-inspector-open');
    return;
  }

  const { mobs, items, libres } = getLogCollections(log.id);
  const cat = getCategory(log.category);
  inspector.classList.add('has-selection');
  inspector.innerHTML = `
    <header class="logs-inspector-head">
      <div>
        <span class="logs-inspector-category" style="color:${cat.color}">${cat.emoji} ${escapeHtml(cat.label)}</span>
        <h2>${escapeHtml(log.title)}</h2>
      </div>
      <button class="logs-inspector-close" type="button" data-inspector-action="close" aria-label="Cerrar detalle">✕</button>
    </header>

    <nav class="logs-inspector-tabs" aria-label="Secciones del log">
      <button class="${inspectorTab === 'summary' ? 'is-active' : ''}" data-inspector-tab="summary">Resumen</button>
      <button class="${inspectorTab === 'mobs' ? 'is-active' : ''}" data-inspector-tab="mobs">Mobs <span>${mobs.length}</span></button>
      <button class="${inspectorTab === 'items' ? 'is-active' : ''}" data-inspector-tab="items">Items <span>${items.length}</span></button>
      <button class="${inspectorTab === 'blocks' ? 'is-active' : ''}" data-inspector-tab="blocks">Bloques <span>${libres.length}</span></button>
    </nav>

    <div class="logs-inspector-body">${renderInspectorTabBody(log)}</div>`;

  requestAnimationFrame(() => resetLogInspectorScroll({ focusTop: true }));

  inspector.querySelectorAll('[data-inspector-tab]').forEach(button => {
    button.addEventListener('click', () => {
      inspectorTab = button.dataset.inspectorTab;
      renderLogInspector();
      requestAnimationFrame(() => resetLogInspectorScroll({ focusTop: true }));
    });
  });

  inspector.querySelectorAll('.inspector-entity-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const panel = inspector.querySelector(`#${CSS.escape(button.dataset.panelId)}`);
      if (!panel) return;
      const shouldOpen = panel.classList.contains('hidden');
      inspector.querySelectorAll('.inspector-entity-card .block-detail-panel').forEach(item => item.classList.add('hidden'));
      inspector.querySelectorAll('.inspector-entity-toggle').forEach(item => {
        item.classList.remove('is-expanded');
        item.setAttribute('aria-expanded', 'false');
      });
      if (shouldOpen) {
        panel.classList.remove('hidden');
        button.classList.add('is-expanded');
        button.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(() => {
          const scrollBody = inspector.querySelector('.logs-inspector-body');
          if (!scrollBody) return;
          const bodyRect = scrollBody.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          if (panelRect.bottom > bodyRect.bottom - 12) {
            scrollBody.scrollBy({ top: panelRect.bottom - bodyRect.bottom + 18, behavior: 'smooth' });
          } else if (panelRect.top < bodyRect.top + 12) {
            scrollBody.scrollBy({ top: panelRect.top - bodyRect.top - 12, behavior: 'smooth' });
          }
        });
      }
    });
  });

  inspector.querySelector('[data-inspector-action="close"]')?.addEventListener('click', () => {
    selectedLogId = null;
    state.currentDetailLogId = null;
    inspectorTab = 'summary';
    document.body.classList.remove('logs-inspector-open');
    document.querySelectorAll('.log-list-card').forEach(card => {
      card.classList.remove('is-selected');
      card.setAttribute('aria-selected', 'false');
    });
    renderLogInspector();
  });
  inspector.querySelector('[data-inspector-action="open-full"]')?.addEventListener('click', () => openDetailModal(log.id));
  inspector.querySelector('[data-inspector-action="like"]')?.addEventListener('click', () => toggleLike(log.id));
  inspector.querySelector('[data-inspector-action="edit"]')?.addEventListener('click', () => openEditLogModal(log.id));
  inspector.querySelector('[data-inspector-action="duplicate"]')?.addEventListener('click', () => duplicateLogToEditor(log));
  inspector.querySelector('[data-inspector-action="delete"]')?.addEventListener('click', () => deleteLog(log.id));
}


export function updateLogCoverPreview(url = '') {
  const input = document.getElementById('log-cover-image-input');
  const wrap = document.getElementById('log-cover-image-preview-wrap');
  const image = document.getElementById('log-cover-image-preview');
  const empty = document.getElementById('log-cover-image-empty');
  const clear = document.getElementById('log-cover-image-clear-btn');
  const safe = safeUrl(url || '');
  if (input) input.value = safe || '';
  if (!wrap || !image || !empty || !clear) return;

  if (!safe) {
    wrap.classList.remove('has-image');
    image.removeAttribute('src');
    image.classList.add('hidden');
    empty.classList.remove('hidden');
    clear.classList.add('hidden');
    return;
  }

  wrap.classList.add('has-image');
  image.classList.remove('hidden');
  empty.classList.add('hidden');
  clear.classList.remove('hidden');
  image.src = safe;
  image.onerror = () => {
    wrap.classList.remove('has-image');
    image.classList.add('hidden');
    empty.classList.remove('hidden');
  };
}


function logEditorPayload(log) {
  const logId = log?.id;
  const allItems = (state.itemsByLog[logId] || []).map(item => cloneData(item));
  return {
    title: log?.title || '',
    description: log?.description || '',
    category: log?.category || state.categories[0]?.slug || '',
    relevance: log?.relevance || 'normal',
    created_at: log?.created_at || new Date().toISOString(),
    cover_image_url: log?.cover_image_url || '',
    mobs: (state.mobsByLog[logId] || []).map(mob => cloneData(mob)),
    items: allItems.filter(item => item.item_type !== '_libre'),
    libres: allItems.filter(item => item.item_type === '_libre').map(item => ({
      ...cloneData(item),
      _fields: parseLibreFields(item),
    })),
  };
}

function applyLogEditorPayload(payload, { asNew = true } = {}) {
  if (!payload) return;
  state.editingLogId = asNew ? null : state.editingLogId;
  state.draftMobs = asArray(payload.mobs).map(cloneData);
  state.draftItems = asArray(payload.items).map(cloneData);
  state.draftLibres = asArray(payload.libres).map(cloneData);
  document.getElementById('log-modal-title').textContent = asNew ? '📜 NUEVO LOG' : '✏️ EDITAR LOG';
  document.getElementById('log-title-input').value = payload.title || '';
  document.getElementById('log-desc-input').value = payload.description || '';
  updateLogCoverPreview(payload.cover_image_url || '');
  renderCategorySelectOptions();
  document.getElementById('log-category-input').value = payload.category || state.categories[0]?.slug || '';
  document.getElementById('log-relevance-input').value = payload.relevance || 'normal';
  document.getElementById('log-date-input').value = toDatetimeLocalValue(asNew ? new Date() : (payload.created_at || new Date()));
  document.getElementById('log-modal-error').classList.add('hidden');
  renderDraftBlocksList();
  checkAndShowDraftBanner(asNew ? 'new' : state.editingLogId);
  startDraftAutosave();
  document.getElementById('log-modal').classList.remove('hidden');
}

function openLogCardActions(anchor, logId) {
  const log = state.logs.find(item => item.id === logId);
  if (!log) return;
  openContextPanel({
    anchor,
    title: 'Acciones del log',
    subtitle: log.title || '',
    width: 340,
    build(root, close) {
      appendActionGrid(root, [
        {
          label: 'Editar', icon: '✏', onClick: () => { close(); openEditLogModal(logId); },
        },
        {
          label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('log-editor', logEditorPayload(log)),
        },
        {
          label: 'Duplicar', icon: '⧉', onClick: () => { close(); duplicateLogToEditor(log); },
        },
        {
          label: 'Pegar como nuevo', icon: '↧', disabled: !hasEditorPayload('log-editor'), onClick: () => {
            const payload = getEditorPayload('log-editor');
            if (!payload) return;
            close();
            applyLogEditorPayload(payload, { asNew: true });
            showToast('Log pegado como nuevo', 'success');
          },
        },
        {
          label: 'Borrar', icon: '🗑', tone: 'danger', onClick: () => { close(); deleteLog(logId); },
        },
      ]);
    },
  });
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
    state.logsPage++;
    renderLogs();
  });
  grid.after(btn);
}


export function renderLogs(changedLogId = null) {
  const grid = document.getElementById('logs-grid');
  if (!grid) return;
  let filtered = state.activeFilter === 'all' ? state.logs : state.logs.filter(log => log.category === state.activeFilter);
  filtered = sortLogs(filtered);

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="logs-empty"><p>No hay logs en esta categoría todavía.</p></div>`;
    const existingBtn = document.getElementById('load-more-btn');
    if (existingBtn) existingBtn.remove();
    selectedLogId = null;
    state.currentDetailLogId = null;
    inspectorTab = 'summary';
    document.body.classList.remove('logs-inspector-open');
    renderLogInspector();
    return;
  }

  const visible = filtered.slice(0, state.logsPage * PAGE_SIZE);
  if (selectedLogId && !visible.some(log => log.id === selectedLogId)) {
    selectedLogId = null;
    state.currentDetailLogId = null;
    inspectorTab = 'summary';
    document.body.classList.remove('logs-inspector-open');
  }

  grid.innerHTML = visible.map(log => buildLogCardHtml(log)).join('');
  grid.querySelectorAll('.log-list-card').forEach(card => bindCardEvents(card));
  renderLoadMoreBtn(grid, filtered.length - visible.length);
  renderLogInspector();
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

export function openNewLogModal() {
  state.editingLogId = null;
  state.draftMobs = [];
  state.draftItems = [];
  state.draftLibres = [];
  document.getElementById('log-modal-title').textContent = '📜 NUEVO LOG';
  document.getElementById('log-title-input').value = '';
  document.getElementById('log-desc-input').value = '';
  updateLogCoverPreview('');
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


export function openEditLogModal(logId) {
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
  updateLogCoverPreview(log.cover_image_url || '');
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


export async function submitLog() {
  const errorBox = document.getElementById('log-modal-error');
  const title = document.getElementById('log-title-input').value.trim();
  const description = document.getElementById('log-desc-input').value.trim();
  const category = document.getElementById('log-category-input').value;
  const relevance = document.getElementById('log-relevance-input').value;
  const coverImageUrl = document.getElementById('log-cover-image-input')?.value.trim() || '';
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
      input_cover_image_url: coverImageUrl || null,
    });
  } else {
    result = await supabaseClient.rpc('create_log', {
      input_code: state.adminCode, input_title: title, input_description: description,
      input_category: category, input_relevance: relevance,
      input_created_at: isoDate, input_mobs: mobsPayload, input_items: itemsPayload,
      input_cover_image_url: coverImageUrl || null,
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
  if (!(await confirmAction({
    title: 'Borrar log',
    message: 'Borrar este log y sus datos asociados.',
    confirmLabel: 'Borrar log',
    danger: true,
  }))) return;
  const { error } = await supabaseClient.rpc('delete_log', { input_code: state.adminCode, input_id: logId });
  if (error) { showToast('No se pudo borrar el log', 'error'); return; }
  showToast('Log eliminado', 'success');
  suppressNextRealtimeReload();
  await loadLogs();
}

// =========================================================
// logs.js
// =========================================================
// Núcleo del sistema de Logs: orden/paginación, carga desde Supabase,
// render de tarjetas, likes, apertura de detalle, y alta/edición/borrado
// de logs (CRUD admin).
// =========================================================

import { supabaseClient } from '../config.js';
import { bindBlockChipEvents, parseLibreFields, renderBlocksSection } from './blocks-display.js';
import { renderDraftBlocksList } from './blocks-editor.js';
import { renderCategorySelectOptions } from './categories.js';
import { cancelReply, loadComments } from './comments.js';
import { checkAndShowDraftBanner, clearDraft, startDraftAutosave, stopDraftAutosave } from './drafts.js';
import { loadLogsData } from './logs-data.js';
import { PAGE_SIZE, RELEVANCE_LABELS, RELEVANCE_ORDER, TIER_COLUMNS, getCategory, isAdmin, state, suppressNextRealtimeReload } from '../core/state.js';
import { asArray, confirmAction, escapeHtml, formatDate, showToast, toDatetimeLocalValue } from '../core/utils.js';

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
    state.logsPage++;
    renderLogs();
  });
  grid.after(btn);
}


export function renderLogs(changedLogId = null) {
  const grid = document.getElementById('logs-grid');
  if (!grid) return;
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
  const visible = filtered.slice(0, state.logsPage * PAGE_SIZE);
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

export function openNewLogModal() {
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

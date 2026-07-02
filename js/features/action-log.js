// =========================================================
// action-log.js
// =========================================================
// Bitácora de acciones de administrador ("Acciones realizadas"): iconos,
// carga vía RPC list_action_log y render de la lista.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { escapeHtml, formatDate } from '../core/utils.js';

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


export async function openActionLogModal() {
  document.getElementById('action-log-modal').classList.remove('hidden');
  await loadActionLog();
}


export async function loadActionLog() {
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

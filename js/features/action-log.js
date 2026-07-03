// =========================================================
// action-log.js
// =========================================================
// Bitácora de acciones de administrador ("Acciones realizadas"): iconos,
// carga vía RPC list_action_log y render de la lista.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { localAuditTime } from '../core/audit.js';
import { escapeHtml, formatDate } from '../core/utils.js';

const ACTION_LOG_ICONS = {
  log_created: '📜', log_updated: '✏️', log_deleted: '🗑',
  mob_created: '👾', mob_deleted: '👾',
  item_created: '🗡', item_deleted: '🗡',
  block_created: '📋', block_deleted: '📋',
  category_created: '🏷', category_deleted: '🏷',
  comment_created: '💬', comment_hidden: '🙈', comment_shown: '👁', comment_deleted: '💬',
  field_config_updated: '⚙',
  tierlist_row_created: '🏆',
  tierlist_row_updated: '🏆',
  tierlist_row_deleted: '🏆',
  tierlist_item_created: '🎴',
  tierlist_item_updated: '🎴',
  tierlist_item_deleted: '🎴',
  weapon_created: '⚔️',
  weapon_updated: '⚔️',
  weapon_deleted: '⚔️',
  weapon_published: '⚔️',
  weapon_unpublished: '⚔️',
  weapon_rank_created: '📈',
  weapon_rank_updated: '📈',
  weapon_rank_deleted: '📈',
  background_updated: '🖼',
  background_cleared: '🖼',
  media_uploaded: '🖼',
  media_updated: '✏️',
  media_used: '🧩',
  media_archived: '🗄',
  media_restored: '♻️',
  media_deleted: '🗑',
  export_created: '📤',
  import_completed: '📥',
};


function actionLogRowClass(action) {
  if (action.endsWith('_created') || action === 'comment_shown') return 'is-create';
  if (action.endsWith('_deleted') || action === 'comment_hidden') return 'is-delete';
  if (action === 'comment_created') return 'is-comment';
  return 'is-update';
}

function quotedFromDescription(description) {
  const match = String(description || '').match(/[“"]([^”"]+)[”"]/);
  return match?.[1] || '';
}

function enhanceLegacyDescription(row) {
  const description = row.description || '';
  const name = quotedFromDescription(description);
  const quotedName = name ? ` "${name}"` : '';
  const legacyMap = {
    tierlist_item_created: `Se creó el elemento de tierlist${quotedName}.`,
    tierlist_item_updated: `Se editó el elemento de tierlist${quotedName}.`,
    tierlist_item_deleted: `Se eliminó el elemento de tierlist${quotedName}.`,
    tierlist_row_created: `Se creó la fila de tierlist${quotedName}.`,
    tierlist_row_updated: `Se editó la fila de tierlist${quotedName}.`,
    tierlist_row_deleted: `Se eliminó la fila de tierlist${quotedName}; sus elementos volvieron a "Sin clasificar".`,
    weapon_created: `Se creó el arma${quotedName}.`,
    weapon_updated: `Se editó el arma${quotedName}.`,
    weapon_deleted: `Se eliminó el arma${quotedName}.`,
    weapon_published: `Se publicó el arma${quotedName}.`,
    weapon_unpublished: `Se despublicó el arma${quotedName}.`,
    weapon_rank_created: `Se creó una versión/rango de arma${quotedName}.`,
    weapon_rank_updated: `Se editó una versión/rango de arma${quotedName}.`,
    weapon_rank_deleted: `Se eliminó una versión/rango de arma${quotedName}.`,
    category_created: `Se creó la categoría${quotedName}.`,
    category_deleted: `Se eliminó la categoría${quotedName}.`,
    field_config_updated: 'Se actualizó la configuración de fichas.',
  };
  return legacyMap[row.action] || description || 'Acción administrativa registrada sin descripción.';
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
    const description = enhanceLegacyDescription(row);
    const localTime = row.created_at ? localAuditTime(new Date(row.created_at)) : 'hora local no disponible';
    return `
      <div class="action-log-row ${cls}">
        <span class="action-log-icon">${icon}</span>
        <div class="action-log-body">
          <p class="action-log-desc">${escapeHtml(description)}</p>
          <div class="action-log-meta">
            <span>${formatDate(row.created_at)}</span>
            <span>Hora local: ${escapeHtml(localTime)}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

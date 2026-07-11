// =========================================================
// logs-data.js
// =========================================================
// Carga pura de datos de Logs desde Supabase, sin tocar el DOM. Sirve
// para la página de Logs y para Herramientas (export/import).
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { showToast, withTimeout } from '../core/utils.js';

let logsLoadPromise = null;
let logsLoadGeneration = 0;

function attachSignal(request, signal) {
  const stableRequest = disableQueryRetry(request);
  return typeof stableRequest?.abortSignal === 'function' ? stableRequest.abortSignal(signal) : stableRequest;
}

async function fetchLogsWithOptionalCover(signal) {
  let result = await attachSignal(
    supabaseClient.from('logs')
      .select('id,title,description,category,relevance,likes,created_at,cover_image_url')
      .order('created_at', { ascending: false }),
    signal,
  );

  if (result.error && /cover_image_url/i.test(`${result.error.message || ''} ${result.error.details || ''}`)) {
    result = await attachSignal(
      supabaseClient.from('logs')
        .select('id,title,description,category,relevance,likes,created_at')
        .order('created_at', { ascending: false }),
      signal,
    );
    if (!result.error) result.data = (result.data || []).map(log => ({ ...log, cover_image_url: null }));
  }
  return result;
}

async function performLogsLoad() {
  const generation = ++logsLoadGeneration;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9500);

  try {
    const request = Promise.all([
      fetchLogsWithOptionalCover(controller.signal),
      attachSignal(
        supabaseClient.from('log_mobs')
          .select('id,log_id,name,health,damage,armor,equipment,location,description,extra_fields,image_url,sort_order')
          .order('sort_order', { ascending: true }),
        controller.signal,
      ),
      attachSignal(
        supabaseClient.from('log_items')
          .select('id,log_id,name,tier,item_type,obtained_from,damage,enchantments,description,extra_fields,image_url,sort_order')
          .order('sort_order', { ascending: true }),
        controller.signal,
      ),
    ]);

    const [logsRes, mobsRes, itemsRes] = await withTimeout(request, 10000, 'La carga de logs');
    if (generation !== logsLoadGeneration) return false;

    if (logsRes.error) {
      console.error(logsRes.error);
      showToast('No se pudieron cargar los logs', 'error');
      return false;
    }

    state.logs = logsRes.data || [];
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

    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Logs] Error de carga:', error);
    showToast('La carga de logs tardó demasiado. Revisa tu conexión.', 'error');
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadLogsData() {
  // Realtime puede disparar varios eventos de una sola operación. Todos
  // comparten una única carga para no acumular consultas ni memoria.
  if (!logsLoadPromise) {
    logsLoadPromise = performLogsLoad().finally(() => { logsLoadPromise = null; });
  }
  return logsLoadPromise;
}

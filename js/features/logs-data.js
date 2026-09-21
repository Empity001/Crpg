// =========================================================
// logs-data.js
// =========================================================
// Carga de datos de Logs desde Supabase. Para visitantes, el arranque solo
// descarga los Logs y metadatos mínimos de conteo; las fichas completas de
// mobs/items se solicitan cuando se selecciona un Log. En modo administrador
// se conserva la carga completa porque el editor y las exportaciones la usan.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { isAdmin, state } from '../core/state.js';
import { renderLoadError, showToast, withTimeout } from '../core/utils.js';
import { getAdminLogsBundle } from '../core/admin-api.js';

let logsLoadPromise = null;
let activeLogsLoadAdminMode = null;
let logsLoadGeneration = 0;
const logBlocksLoadPromises = new Map();

// Un fallo de carga deja un aviso con "Reintentar" en lugar del spinner eterno. Solo se sustituye
// la lista si todavía no hay nada que mostrar: un refresco fallido en segundo plano no borra lo visible.
function showLogsLoadError(message) {
  showToast(message, 'error');
  if (!state.logs.length) renderLoadError(document.getElementById('logs-grid'), message);
}

function attachSignal(request, signal) {
  const stableRequest = disableQueryRetry(request);
  return typeof stableRequest?.abortSignal === 'function' ? stableRequest.abortSignal(signal) : stableRequest;
}

function normalizePublished(rows) {
  return (rows || []).map(row => ({ ...row, published: row.published !== false }));
}

async function fetchLogsWithOptionalCover(signal, adminLoad = isAdmin()) {
  if (adminLoad) {
    const adminResult = await attachSignal(
      supabaseClient.rpc('list_logs_admin', { input_code: state.adminMode }),
      signal,
    );
    if (!adminResult.error) {
      adminResult.data = normalizePublished(adminResult.data)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      return adminResult;
    }
    console.warn('[Logs] No se pudo usar list_logs_admin; se cargará la vista pública:', adminResult.error.message);
  }

  let result = await attachSignal(
    supabaseClient.from('logs')
      .select('id,title,description,category,relevance,likes,created_at,cover_image_url,published')
      .order('created_at', { ascending: false }),
    signal,
  );

  if (result.error && /published|cover_image_url/i.test(`${result.error.message || ''} ${result.error.details || ''}`)) {
    result = await attachSignal(
      supabaseClient.from('logs')
        .select('id,title,description,category,relevance,likes,created_at,cover_image_url')
        .order('created_at', { ascending: false }),
      signal,
    );
  }
  if (!result.error) result.data = normalizePublished(result.data);
  return result;
}

function fullMobsRequest(signal, adminLoad) {
  if (adminLoad) {
    return attachSignal(
      supabaseClient.rpc('list_log_mobs_admin', { input_code: state.adminMode }),
      signal,
    );
  }
  return attachSignal(
    supabaseClient.from('log_mobs')
      .select('id,log_id,name,health,damage,armor,equipment,location,description,extra_fields,image_url,sort_order')
      .order('sort_order', { ascending: true }),
    signal,
  );
}

function fullItemsRequest(signal, adminLoad) {
  if (adminLoad) {
    return attachSignal(
      supabaseClient.rpc('list_log_items_admin', { input_code: state.adminMode }),
      signal,
    );
  }
  return attachSignal(
    supabaseClient.from('log_items')
      .select('id,log_id,name,tier,item_type,obtained_from,damage,enchantments,description,extra_fields,image_url,sort_order')
      .order('sort_order', { ascending: true }),
    signal,
  );
}

function summaryMobsRequest(signal) {
  return attachSignal(supabaseClient.from('log_mobs').select('log_id'), signal);
}

function summaryItemsRequest(signal) {
  return attachSignal(supabaseClient.from('log_items').select('log_id,item_type'), signal);
}

function resetBlockState() {
  state.mobsByLog = {};
  state.itemsByLog = {};
  state.logBlockCounts = {};
  state.logBlocksLoaded = new Set();
  logBlocksLoadPromises.clear();
}

function ensureCount(logId) {
  const key = String(logId || '');
  if (!state.logBlockCounts[key]) state.logBlockCounts[key] = { mobs: 0, items: 0, libres: 0 };
  return state.logBlockCounts[key];
}

function applyFullBlockRows(mobs = [], items = [], { markAllLogsLoaded = false } = {}) {
  (mobs || []).forEach(mob => {
    const logId = String(mob.log_id);
    if (!state.mobsByLog[logId]) state.mobsByLog[logId] = [];
    state.mobsByLog[logId].push(mob);
    ensureCount(logId).mobs += 1;
  });
  (items || []).forEach(item => {
    const logId = String(item.log_id);
    if (!state.itemsByLog[logId]) state.itemsByLog[logId] = [];
    state.itemsByLog[logId].push(item);
    if (item.item_type === '_libre') ensureCount(logId).libres += 1;
    else ensureCount(logId).items += 1;
  });
  if (markAllLogsLoaded) {
    state.logs.forEach(log => state.logBlocksLoaded.add(String(log.id)));
  }
}

function applyBlockSummaries(mobs = [], items = []) {
  (mobs || []).forEach(mob => { ensureCount(mob.log_id).mobs += 1; });
  (items || []).forEach(item => {
    if (item.item_type === '_libre') ensureCount(item.log_id).libres += 1;
    else ensureCount(item.log_id).items += 1;
  });
}

function applyAggregatedBlockCounts(logs = []) {
  logs.forEach(log => {
    state.logBlockCounts[String(log.id)] = {
      mobs: Number(log.mob_count || 0),
      items: Number(log.item_count || 0),
      libres: Number(log.extra_count || 0),
    };
  });
}

async function performLogsLoad(adminLoad) {
  const generation = ++logsLoadGeneration;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 9500);

  try {
    let usedAggregatedCounts = false;
    const request = adminLoad
      ? (async () => {
          const bundleResult = await getAdminLogsBundle();
          if (!bundleResult.error && bundleResult.data) {
            return [
              { data: bundleResult.data.logs || [], error: null },
              { data: bundleResult.data.mobs || [], error: null },
              { data: bundleResult.data.items || [], error: null },
            ];
          }

          // Compatibilidad mientras la Edge Function nueva termina de
          // desplegarse: la versión anterior sigue funcionando.
          console.warn('[Logs] Paquete administrativo no disponible; usando lecturas separadas:', bundleResult.error?.message);
          return Promise.all([
            fetchLogsWithOptionalCover(controller.signal, true),
            fullMobsRequest(controller.signal, true),
            fullItemsRequest(controller.signal, true),
          ]);
        })()
      : (async () => {
          const summaryResult = await attachSignal(
            supabaseClient.rpc('list_public_logs_with_counts'),
            controller.signal,
          );
          if (!summaryResult.error) {
            usedAggregatedCounts = true;
            return [summaryResult, { data: [], error: null }, { data: [], error: null }];
          }

          // La migración 024 puede tardar unos minutos en aplicarse durante un
          // despliegue. Conservamos el método anterior como respaldo temporal.
          console.warn('[Logs] Resumen agregado no disponible; usando conteo compatible:', summaryResult.error.message);
          return Promise.all([
            fetchLogsWithOptionalCover(controller.signal, false),
            summaryMobsRequest(controller.signal),
            summaryItemsRequest(controller.signal),
          ]);
        })();

    const [logsRes, mobsRes, itemsRes] = await withTimeout(request, 10000, 'La carga de logs');
    if (generation !== logsLoadGeneration) return false;

    if (logsRes.error) {
      console.error(logsRes.error);
      showLogsLoadError('No se pudieron cargar los logs.');
      return false;
    }

    state.logs = normalizePublished(logsRes.data);
    resetBlockState();

    if (adminLoad) {
      applyFullBlockRows(
        mobsRes.error ? [] : (mobsRes.data || []),
        itemsRes.error ? [] : (itemsRes.data || []),
        { markAllLogsLoaded: true },
      );
    } else {
      if (usedAggregatedCounts) applyAggregatedBlockCounts(state.logs);
      else {
        applyBlockSummaries(
          mobsRes.error ? [] : (mobsRes.data || []),
          itemsRes.error ? [] : (itemsRes.data || []),
        );
      }
    }

    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Logs] Error de carga:', error);
    showLogsLoadError('La carga de logs tardó demasiado. Revisa tu conexión.');
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadLogsData() {
  const requestedAdminMode = isAdmin();

  // Realtime puede disparar varios eventos de una sola operación. Todos los
  // eventos del mismo modo comparten carga. Si Discord termina de validar el
  // rol mientras había una carga pública en curso, encadenamos una carga
  // administrativa después para no conservar datos públicos incompletos.
  if (logsLoadPromise) {
    if (activeLogsLoadAdminMode === requestedAdminMode) return logsLoadPromise;
    return logsLoadPromise.then(() => loadLogsData());
  }

  activeLogsLoadAdminMode = requestedAdminMode;
  logsLoadPromise = performLogsLoad(requestedAdminMode).finally(() => {
    logsLoadPromise = null;
    activeLogsLoadAdminMode = null;
  });
  return logsLoadPromise;
}

export function isLogBlocksLoading(logId) {
  return logBlocksLoadPromises.has(String(logId));
}

export function getLogBlockCounts(logId) {
  return state.logBlockCounts[String(logId)] || { mobs: 0, items: 0, libres: 0 };
}

export function loadLogBlocksData(logId, { force = false } = {}) {
  const key = String(logId || '');
  if (!key) return Promise.resolve(false);
  if (!force && state.logBlocksLoaded.has(key)) return Promise.resolve(true);
  if (logBlocksLoadPromises.has(key)) return logBlocksLoadPromises.get(key);

  // El modo administrador ya carga todas las fichas para editar/exportar.
  // Si el rol cambió mientras la página estaba abierta, recargamos el conjunto
  // administrativo una sola vez en lugar de intentar leer un Log oculto por RLS.
  if (isAdmin()) {
    const promise = loadLogsData().then(ok => ok && state.logBlocksLoaded.has(key));
    logBlocksLoadPromises.set(key, promise);
    return promise.finally(() => logBlocksLoadPromises.delete(key));
  }

  const promise = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7500);
    try {
      const [mobsRes, itemsRes] = await withTimeout(Promise.all([
        attachSignal(
          supabaseClient.from('log_mobs')
            .select('id,log_id,name,health,damage,armor,equipment,location,description,extra_fields,image_url,sort_order')
            .eq('log_id', key)
            .order('sort_order', { ascending: true }),
          controller.signal,
        ),
        attachSignal(
          supabaseClient.from('log_items')
            .select('id,log_id,name,tier,item_type,obtained_from,damage,enchantments,description,extra_fields,image_url,sort_order')
            .eq('log_id', key)
            .order('sort_order', { ascending: true }),
          controller.signal,
        ),
      ]), 8000, 'Las fichas del Log');

      if (mobsRes.error || itemsRes.error) {
        console.warn('[Logs] No se pudieron cargar las fichas:', (mobsRes.error || itemsRes.error).message);
        return false;
      }

      state.mobsByLog[key] = mobsRes.data || [];
      state.itemsByLog[key] = itemsRes.data || [];
      state.logBlockCounts[key] = {
        mobs: state.mobsByLog[key].length,
        items: state.itemsByLog[key].filter(item => item.item_type !== '_libre').length,
        libres: state.itemsByLog[key].filter(item => item.item_type === '_libre').length,
      };
      state.logBlocksLoaded.add(key);
      return true;
    } catch (error) {
      if (error?.name !== 'AbortError') console.warn('[Logs] Fichas del Log:', error);
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  })();

  logBlocksLoadPromises.set(key, promise);
  return promise.finally(() => logBlocksLoadPromises.delete(key));
}

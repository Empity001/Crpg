// =========================================================
// realtime.js
// =========================================================
// Suscripciones Realtime de Supabase por sección. Cada canal es singleton
// y se destruye al abandonar la página para evitar reconexiones y listeners
// duplicados durante recargas o navegación con caché.
// =========================================================

import { supabaseClient } from '../config.js';
import { _suppressRealtimeKits, _suppressRealtimeReload, _suppressRealtimeTierlist, _suppressRealtimeWeapons, state } from '../core/state.js';


const lazyLoaders = {
  logs: () => import('../features/logs.js').then(module => module.loadLogs()),
  comments: (logId) => import('../features/comments.js').then(module => module.loadComments(logId)),
  kits: () => import('../features/kits.js').then(module => module.loadKits()),
  tierlist: () => import('../features/tierlist.js').then(module => module.loadTierlist()),
  weapons: () => import('../features/weapons-data.js').then(module => module.reloadWeaponData()),
  weaponMeta: () => import('../features/weapons-data.js').then(module => module.loadWeaponMeta()),
};

const channels = new Map();
const reloadTimers = new Map();
const reloadInFlight = new Map();
let cleanupBound = false;

function removeNamedChannel(name) {
  const channel = channels.get(name);
  if (!channel) return;
  channels.delete(name);
  try { supabaseClient.removeChannel(channel); } catch (error) { console.warn('[Realtime] No se pudo cerrar el canal:', error); }
}

function installChannel(name, configure) {
  removeNamedChannel(name);
  const channel = configure(supabaseClient.channel(name));
  channels.set(name, channel);
  channel.subscribe(status => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn(`[Realtime] ${name}: ${status}`);
    }
  });
  bindCleanup();
  return channel;
}

function scheduleReload(key, task, delay = 220) {
  window.clearTimeout(reloadTimers.get(key));
  reloadTimers.set(key, window.setTimeout(async () => {
    reloadTimers.delete(key);
    if (reloadInFlight.get(key)) return;
    reloadInFlight.set(key, true);
    try { await task(); }
    catch (error) { console.warn(`[Realtime] ${key}:`, error); }
    finally { reloadInFlight.delete(key); }
  }, delay));
}

function cleanupRealtime() {
  reloadTimers.forEach(timer => window.clearTimeout(timer));
  reloadTimers.clear();
  reloadInFlight.clear();
  [...channels.keys()].forEach(removeNamedChannel);
}

function bindCleanup() {
  if (cleanupBound) return;
  cleanupBound = true;
  window.addEventListener('pagehide', cleanupRealtime, { once: true });
}

export function initLogsRealtime() {
  return installChannel('logs-changes', channel => channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'logs' }, () => {
      if (!_suppressRealtimeReload) scheduleReload('logs', lazyLoaders.logs);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_mobs' }, () => {
      if (!_suppressRealtimeReload) scheduleReload('logs', lazyLoaders.logs);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'log_items' }, () => {
      if (!_suppressRealtimeReload) scheduleReload('logs', lazyLoaders.logs);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'comments' }, () => {
      if (state.currentDetailLogId) scheduleReload('comments', () => lazyLoaders.comments(state.currentDetailLogId), 150);
    }));
}

export function initTierlistRealtime() {
  return installChannel('tierlist-changes', channel => channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_rows' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) scheduleReload('tierlist', lazyLoaders.tierlist);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_items' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) scheduleReload('tierlist', lazyLoaders.tierlist);
    }));
}

export function initKitsRealtime() {
  return installChannel('kits-changes', channel => channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kits' }, () => {
      if (state.kitsLoaded && !_suppressRealtimeKits) scheduleReload('kits', lazyLoaders.kits);
    }));
}

export function initWeaponsRealtime() {
  return installChannel('weapons-changes', channel => channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapons' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) scheduleReload('weapons', lazyLoaders.weapons);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_ranks' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) scheduleReload('weapons', lazyLoaders.weapons);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_categories' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) scheduleReload('weapon-meta', lazyLoaders.weaponMeta);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'weapon_types' }, () => {
      if (state.weaponsLoaded && !_suppressRealtimeWeapons) scheduleReload('weapon-meta', lazyLoaders.weaponMeta);
    }));
}

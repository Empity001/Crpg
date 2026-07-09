// =========================================================
// realtime.js
// =========================================================
// Suscripciones Realtime de Supabase, separadas por sección para que
// cada página solo suscriba los canales que realmente usa (Logs no
// necesita enterarse de cambios en armas, Tierlist no necesita
// enterarse de cambios en logs, etc.).
// =========================================================

import { supabaseClient } from '../config.js';
import { loadComments } from '../features/comments.js';
import { loadLogs } from '../features/logs.js';
import { _suppressRealtimeKits, _suppressRealtimeReload, _suppressRealtimeTierlist, _suppressRealtimeWeapons, state } from '../core/state.js';
import { loadKits } from '../features/kits.js';
import { loadTierlist } from '../features/tierlist.js';
import { loadWeaponMeta, reloadWeaponData } from '../features/weapons-data.js';

// Usada por la página de Logs (index.html): logs, sus mobs/items, y
// los comentarios del detalle abierto.

export function initLogsRealtime() {
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
}

// Usada por la página de Tierlist (tierlist.html).

export function initTierlistRealtime() {
  supabaseClient.channel('tierlist-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_rows' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) loadTierlist();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tierlist_items' }, () => {
      if (state.tierlistLoaded && !_suppressRealtimeTierlist) loadTierlist();
    })
    .subscribe();
}

// Usada por la página de Kits (kits.html).

export function initKitsRealtime() {
  supabaseClient.channel('kits-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'kits' }, () => {
      if (state.kitsLoaded && !_suppressRealtimeKits) loadKits();
    })
    .subscribe();
}

// Usada por la página de Guía de Armas (weapons.html).

export function initWeaponsRealtime() {
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

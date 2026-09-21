// =========================================================
// weapons-source.js
// =========================================================
// Única puerta de lectura de armas y rangos.
//
//   Administrador -> RPC list_weapons_admin / list_weapon_ranks_admin (pasan por
//                    la Edge Function y devuelven también los borradores).
//   Resto         -> lectura directa, solo armas publicadas.
//
// Así el panel conserva sus borradores aunque la base de datos deje de
// entregárselos a la clave pública (migración 023).
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { isAdmin, state } from '../core/state.js';

export const WEAPON_COLUMNS = 'id,name,image_url,category_id,type_id,published,sort_order';
export const RANK_COLUMNS = 'id,weapon_id,name,description,image_url,stats,abilities,upgrade_recipe,extra_sections,sort_order';

function stable(request, signal) {
  const query = disableQueryRetry(request);
  return signal && typeof query?.abortSignal === 'function' ? query.abortSignal(signal) : query;
}

/** Devuelve [respuestaArmas, respuestaRangos], cada una con la forma { data, error }. */
export function fetchWeaponsAndRanks({ weaponColumns = WEAPON_COLUMNS, rankColumns = RANK_COLUMNS, signal } = {}) {
  if (isAdmin()) {
    return Promise.all([
      supabaseClient.rpc('list_weapons_admin', { input_code: state.adminMode }),
      supabaseClient.rpc('list_weapon_ranks_admin', { input_code: state.adminMode }),
    ]);
  }
  return Promise.all([
    stable(supabaseClient.from('weapons').select(weaponColumns).eq('published', true), signal),
    stable(supabaseClient.from('weapon_ranks').select(rankColumns).order('sort_order', { ascending: true }), signal),
  ]);
}

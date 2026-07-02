// =========================================================
// logs-data.js
// =========================================================
// Carga pura de datos de Logs desde Supabase, sin tocar el DOM. Sirve
// para la página de Logs y para Herramientas (export/import).
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { showToast } from '../core/utils.js';

export async function loadLogsData() {
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
}

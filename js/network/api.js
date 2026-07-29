import { NETWORK_ADMIN_FUNCTION, supabaseClient } from '../config.js';

function remoteError(error, data) {
  const payload = data?.error || data;
  const result = new Error(payload?.message || error?.message || 'No se pudo completar la operación.');
  result.code = payload?.code || 'NETWORK_API_ERROR';
  result.details = payload?.details || null;
  return result;
}

export async function networkApi(action, payload = {}) {
  const { data, error } = await supabaseClient.functions.invoke(NETWORK_ADMIN_FUNCTION, {
    body: { action, ...payload },
  });
  if (error || data?.error) {
    let remote = data;
    if (!remote && error?.context && typeof error.context.clone === 'function') {
      try { remote = await error.context.clone().json(); } catch { /* respuesta sin JSON */ }
    }
    throw remoteError(error, remote);
  }
  return data?.data ?? data ?? null;
}

export async function listPublicSites() {
  const { data, error } = await supabaseClient
    .from('sites')
    .select('id,slug,name,description,status,public_base_url,theme_config,navigation_config,search_config,created_at')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export { supabaseClient };

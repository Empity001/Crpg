// =========================================================
// desk/store.js
// =========================================================
// Guarda la disposición de la portada en app_settings.layout_home.
// Igual que el fondo o el "Acerca del servidor": la escritura pasa por la
// Edge Function de administración (input_code truthy la enruta allí), que
// exige sesión de administrador o el código de acceso.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { SETTING_KEY, normalizeLayout } from './layout.js';

export async function saveLayout(layout) {
  const clean = normalizeLayout(layout);
  if (!clean) throw new Error('La disposición no es válida.');

  const { error } = await supabaseClient.rpc('update_app_setting', {
    input_code: state.adminMode,
    input_key: SETTING_KEY,
    input_value: clean,
  });
  if (error) {
    const detail = error.message || error.code || '';
    throw new Error(detail ? `No se pudo guardar la portada: ${detail}` : 'No se pudo guardar la portada.');
  }

  state.homeLayout = clean;
  return clean;
}

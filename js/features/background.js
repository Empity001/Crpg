// =========================================================
// background.js
// =========================================================
// Fondo de página configurable por el admin (imagen + modo) y su
// aplicación en tiempo real al cambiar de pestaña.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { initGenericImageDropzone, syncGenericDropzoneState, updateAssetPreview } from '../core/storage.js';
import { showToast } from '../core/utils.js';

export function populateBackgroundForm() {
  const cfg = state.backgroundConfig;
  const urlInput = document.getElementById('bg-image-input');
  if (!urlInput) return;
  urlInput.value = cfg.image_url || '';
  updateAssetPreview('bg', cfg.image_url || '');
  syncGenericDropzoneState('bg', cfg.image_url || '');
  const r = document.querySelector(`input[name="bg-mode"][value="${cfg.mode||'fixed'}"]`);
  if (r) r.checked = true;
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(cb => { cb.checked = Array.isArray(cfg.tabs) && cfg.tabs.includes(cb.value); });
}


function readBackgroundForm() {
  return {
    image_url: document.getElementById('bg-image-input')?.value.trim() || '',
    mode: document.querySelector('input[name="bg-mode"]:checked')?.value || 'fixed',
    tabs: Array.from(document.querySelectorAll('#bg-tabs-options input:checked')).map(cb => cb.value),
  };
}


export function applyCustomBackground(config) {
  const cfg = config || state.backgroundConfig;
  const valid = !!cfg.image_url && /^https?:\/\//i.test(cfg.image_url);
  const show  = valid && Array.isArray(cfg.tabs) && cfg.tabs.includes(state.activeTab || 'logs');
  if (!show) { ['backgroundImage','backgroundAttachment','backgroundSize','backgroundPosition','backgroundRepeat'].forEach(p => document.body.style[p] = ''); return; }
  const u = cfg.image_url.replace(/["\\]/g, '');
  document.body.style.backgroundImage = `url("${u}")`;
  document.body.style.backgroundPosition = 'center center';
  document.body.style.backgroundRepeat = 'no-repeat';
  if (cfg.mode === 'continuous') { document.body.style.backgroundSize = '100% auto'; document.body.style.backgroundAttachment = 'scroll'; }
  else if (cfg.mode === 'contain') { document.body.style.backgroundSize = 'contain'; document.body.style.backgroundAttachment = 'fixed'; }
  else { document.body.style.backgroundSize = 'cover'; document.body.style.backgroundAttachment = 'fixed'; }
}


async function saveBackgroundConfig() {
  const errorBox = document.getElementById('bg-config-error');
  errorBox.classList.add('hidden');
  const value = readBackgroundForm();
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'background_config', input_value: value });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.backgroundConfig = value;
  applyCustomBackground();
  showToast(value.image_url ? 'Fondo guardado para todos' : 'Fondo de página quitado', 'success');
}


async function clearBackgroundConfig() {
  if (!confirm('¿Quitar el fondo personalizado para todos?')) return;
  const i = document.getElementById('bg-image-input'); if (i) i.value = '';
  updateAssetPreview('bg', '');
  syncGenericDropzoneState('bg', '');
  await saveBackgroundConfig();
}


export function initBackgroundTool() {
  const u = document.getElementById('bg-image-input'); if (!u) return;
  const preview = () => applyCustomBackground(readBackgroundForm());
  document.querySelectorAll('input[name="bg-mode"]').forEach(r => r.addEventListener('change', preview));
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(cb => cb.addEventListener('change', preview));
  document.getElementById('bg-save-btn')?.addEventListener('click', saveBackgroundConfig);
  document.getElementById('bg-clear-btn')?.addEventListener('click', clearBackgroundConfig);
  document.getElementById('bg-image-clear-btn')?.addEventListener('click', () => {
    u.value = '';
    updateAssetPreview('bg', '');
    syncGenericDropzoneState('bg', '');
    preview();
  });
  initGenericImageDropzone('bg', 'backgrounds', () => state.backgroundConfig.image_url || '', (url) => {
    updateAssetPreview('bg', url);
    preview();
  });
}

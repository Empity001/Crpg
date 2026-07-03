// =========================================================
// favicon.js
// =========================================================
// Favicon configurable por el admin: aplicación al <link rel="icon">,
// formulario y guardado.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { initGenericImageDropzone, syncGenericDropzoneState } from '../core/storage.js';
import { escapeHtml, showToast } from '../core/utils.js';
import { attachMediaPickerButton } from './media-library.js';

export function applyFavicon(url) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  let link = document.querySelector("link[rel~='icon']");
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = url;
}


export function populateFaviconForm() {
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  if (input) input.value = state.faviconUrl || '';
  syncGenericDropzoneState('favicon', state.faviconUrl || '');
  if (preview) preview.innerHTML = state.faviconUrl ? `<img src="${escapeHtml(state.faviconUrl)}" alt="favicon" onerror="this.parentNode.textContent='?'" />` : '?';
}


async function saveFaviconConfig() {
  const errorBox = document.getElementById('favicon-config-error');
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  errorBox.classList.add('hidden');
  const url = input?.value.trim() || '';
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'favicon_url', input_value: url });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.faviconUrl = url;
  applyFavicon(url);
  if (preview) preview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="favicon" onerror="this.parentNode.textContent='?'" />` : '?';
  showToast(url ? 'Icono de página guardado' : 'Icono de página quitado', 'success');
}


export function initFaviconTool() {
  const input = document.getElementById('favicon-image-input');
  const preview = document.getElementById('favicon-preview');
  if (!input) return;
  document.getElementById('favicon-save-btn')?.addEventListener('click', saveFaviconConfig);
  document.getElementById('favicon-clear-btn')?.addEventListener('click', () => {
    input.value = '';
    syncGenericDropzoneState('favicon', '');
    if (preview) preview.innerHTML = '?';
  });
  initGenericImageDropzone('favicon', 'favicons', () => state.faviconUrl || '', (url) => {
    if (preview) preview.innerHTML = `<img src="${escapeHtml(url)}" alt="favicon" onerror="this.parentNode.textContent='?'" />`;
    applyFavicon(url);
  });
  attachMediaPickerButton({
    targetInputId: 'favicon-image-input',
    insertAfterId: 'favicon-dropzone',
    title: 'Seleccionar favicon',
    onSelect: ({ url }) => {
      if (preview) preview.innerHTML = `<img src="${escapeHtml(url)}" alt="favicon" onerror="this.parentNode.textContent='?'" />`;
      syncGenericDropzoneState('favicon', url);
      applyFavicon(url);
    },
  });
}

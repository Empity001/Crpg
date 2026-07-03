// =========================================================
// background.js
// =========================================================
// Fondo de página configurable por el admin (imagen + modo) y su
// aplicación en tiempo real al cambiar de pestaña.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { DEFAULT_MEDIA_PRESENTATION } from '../core/media.js';
import { initGenericImageDropzone, syncGenericDropzoneState, updateAssetPreview } from '../core/storage.js';
import { confirmAction, showToast } from '../core/utils.js';
import { attachMediaPickerButton } from './media-library.js';

const BACKGROUND_BASE_RGB = '12, 10, 20';

export function normalizeBackgroundOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function normalizeBackgroundPresentation(presentation = {}, legacyOpacity = 1) {
  const p = { ...DEFAULT_MEDIA_PRESENTATION, ...(presentation || {}) };
  const opacity = p.opacity ?? legacyOpacity;
  const positionMap = { 'top center': 'center top', 'bottom center': 'center bottom', 'center left': 'left center', 'center right': 'right center' };
  const mappedPosition = positionMap[p.position] || p.position || DEFAULT_MEDIA_PRESENTATION.position;
  const position = ['center center', 'center top', 'center bottom', 'left center', 'right center'].includes(mappedPosition)
    ? mappedPosition
    : DEFAULT_MEDIA_PRESENTATION.position;
  return {
    fit: ['contain', 'cover', 'fill', 'none', 'scale-down'].includes(p.fit) ? p.fit : DEFAULT_MEDIA_PRESENTATION.fit,
    position,
    repeat: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].includes(p.repeat) ? p.repeat : DEFAULT_MEDIA_PRESENTATION.repeat,
    opacity: normalizeBackgroundOpacity(opacity),
  };
}

function setBackgroundFormPresentation(presentation) {
  const urlInput = document.getElementById('bg-image-input');
  if (urlInput) urlInput.dataset.bgPresentation = JSON.stringify(normalizeBackgroundPresentation(presentation));
}

function readBackgroundFormPresentation() {
  const urlInput = document.getElementById('bg-image-input');
  if (urlInput?.dataset.bgPresentation) {
    try { return normalizeBackgroundPresentation(JSON.parse(urlInput.dataset.bgPresentation)); } catch(e) {}
  }
  return normalizeBackgroundPresentation(state.backgroundConfig.presentation, state.backgroundConfig.opacity ?? 1);
}

export function populateBackgroundForm() {
  const cfg = state.backgroundConfig;
  const urlInput = document.getElementById('bg-image-input');
  if (!urlInput) return;
  urlInput.value = cfg.image_url || '';
  setBackgroundFormPresentation(cfg.presentation || { opacity: cfg.opacity ?? 1 });
  updateAssetPreview('bg', cfg.image_url || '');
  syncGenericDropzoneState('bg', cfg.image_url || '');
  const r = document.querySelector(`input[name="bg-mode"][value="${cfg.mode||'fixed'}"]`);
  if (r) r.checked = true;
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(cb => { cb.checked = Array.isArray(cfg.tabs) && cfg.tabs.includes(cb.value); });
}


function readBackgroundForm() {
  const presentation = readBackgroundFormPresentation();
  return {
    image_url: document.getElementById('bg-image-input')?.value.trim() || '',
    mode: document.querySelector('input[name="bg-mode"]:checked')?.value || 'fixed',
    tabs: Array.from(document.querySelectorAll('#bg-tabs-options input:checked')).map(cb => cb.value),
    presentation,
    opacity: presentation.opacity,
  };
}

function backgroundSizeForModeAndPresentation(mode, presentation) {
  if (presentation) {
    const fit = presentation.fit;
    if (fit === 'fill') return '100% 100%';
    if (fit === 'none') return 'auto';
    if (fit === 'scale-down') return 'contain';
    return fit;
  }
  if (mode === 'continuous') return '100% auto';
  if (mode === 'contain') return 'contain';
  return 'cover';
}

export function applyCustomBackground(config) {
  const cfg = config || state.backgroundConfig;
  const valid = !!cfg.image_url && /^https?:\/\//i.test(cfg.image_url);
  const show  = valid && Array.isArray(cfg.tabs) && cfg.tabs.includes(state.activeTab || 'logs');
  if (!show) { ['backgroundImage','backgroundAttachment','backgroundSize','backgroundPosition','backgroundRepeat'].forEach(p => document.body.style[p] = ''); return; }
  const u = cfg.image_url.replace(/["\\]/g, '');
  const hasPresentation = !!cfg.presentation;
  const presentation = normalizeBackgroundPresentation(cfg.presentation, cfg.opacity ?? 1);
  const veilOpacity = 1 - presentation.opacity;
  const imageSize = backgroundSizeForModeAndPresentation(cfg.mode, hasPresentation ? presentation : null);
  const imagePosition = hasPresentation ? presentation.position : 'center center';
  const imageRepeat = hasPresentation ? presentation.repeat : 'no-repeat';
  const imageAttachment = cfg.mode === 'continuous' ? 'scroll' : 'fixed';
  document.body.style.backgroundImage = `linear-gradient(rgba(${BACKGROUND_BASE_RGB}, ${veilOpacity}), rgba(${BACKGROUND_BASE_RGB}, ${veilOpacity})), url("${u}")`;
  document.body.style.backgroundPosition = `center center, ${imagePosition}`;
  document.body.style.backgroundRepeat = `no-repeat, ${imageRepeat}`;
  document.body.style.backgroundSize = `cover, ${imageSize}`;
  document.body.style.backgroundAttachment = `${imageAttachment}, ${imageAttachment}`;
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
  if (!(await confirmAction({
    title: 'Quitar fondo',
    message: 'Quitar el fondo personalizado para todos los visitantes.',
    confirmLabel: 'Quitar fondo',
    danger: true,
  }))) return;
  const i = document.getElementById('bg-image-input'); if (i) i.value = '';
  setBackgroundFormPresentation(DEFAULT_MEDIA_PRESENTATION);
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
    setBackgroundFormPresentation(DEFAULT_MEDIA_PRESENTATION);
    updateAssetPreview('bg', '');
    syncGenericDropzoneState('bg', '');
    preview();
  });
  initGenericImageDropzone('bg', 'backgrounds', () => state.backgroundConfig.image_url || '', (url) => {
    setBackgroundFormPresentation(state.backgroundConfig.presentation || { opacity: state.backgroundConfig.opacity ?? 1 });
    updateAssetPreview('bg', url);
    preview();
  });
  attachMediaPickerButton({
    targetInputId: 'bg-image-input',
    insertAfterId: 'bg-dropzone',
    title: 'Seleccionar fondo',
    onSelect: ({ url, asset, presentation }) => {
      setBackgroundFormPresentation(asset?.presentation || presentation || DEFAULT_MEDIA_PRESENTATION);
      updateAssetPreview('bg', url);
      syncGenericDropzoneState('bg', url);
      preview();
    },
  });
}

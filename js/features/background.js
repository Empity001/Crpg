// =========================================================
// background.js
// =========================================================
// Fondo de página configurable por el admin. Usa una capa dedicada en
// vez de apilar fondos sobre <body>, evitando recortes, saltos y lag.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { normalizePageKeys } from '../core/pages.js';
import { DEFAULT_MEDIA_PRESENTATION } from '../core/media.js';
import { initGenericImageDropzone, syncGenericDropzoneState, updateAssetPreview } from '../core/storage.js';
import { confirmAction, showToast } from '../core/utils.js';
import { attachMediaPickerButton } from './media-library-lazy.js';

export function normalizeBackgroundOpacity(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

export function normalizeBackgroundPresentation(presentation = {}, legacyOpacity = 1) {
  const p = { ...DEFAULT_MEDIA_PRESENTATION, ...(presentation || {}) };
  const opacity = p.opacity ?? legacyOpacity;
  const positionMap = {
    'top center': 'center top',
    'bottom center': 'center bottom',
    'center left': 'left center',
    'center right': 'right center',
  };
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

function ensureBackgroundLayer() {
  let layer = document.getElementById('custom-background-layer');
  if (layer) return layer;

  layer = document.createElement('div');
  layer.id = 'custom-background-layer';
  layer.className = 'custom-background-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.innerHTML = `
    <div class="custom-background-backdrop"></div>
    <div class="custom-background-image"></div>
    <div class="custom-background-veil"></div>`;
  document.body.prepend(layer);
  return layer;
}

function clearLegacyBodyBackground() {
  ['backgroundImage', 'backgroundAttachment', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat']
    .forEach(prop => { document.body.style[prop] = ''; });
}

function setBackgroundFormPresentation(presentation) {
  const urlInput = document.getElementById('bg-image-input');
  if (urlInput) urlInput.dataset.bgPresentation = JSON.stringify(normalizeBackgroundPresentation(presentation));
}

function readBackgroundFormPresentation() {
  const urlInput = document.getElementById('bg-image-input');
  if (urlInput?.dataset.bgPresentation) {
    try {
      return normalizeBackgroundPresentation(JSON.parse(urlInput.dataset.bgPresentation));
    } catch (_) {
      // Usa la configuración actual si el dataset quedó incompleto.
    }
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

  const selectedMode = document.querySelector(`input[name="bg-mode"][value="${cfg.mode || 'fixed'}"]`);
  if (selectedMode) selectedMode.checked = true;

  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach((checkbox) => {
    checkbox.checked = normalizePageKeys(cfg.tabs).includes(checkbox.value);
  });
}

function readBackgroundForm() {
  const presentation = readBackgroundFormPresentation();
  return {
    image_url: document.getElementById('bg-image-input')?.value.trim() || '',
    mode: document.querySelector('input[name="bg-mode"]:checked')?.value || 'fixed',
    tabs: normalizePageKeys(Array.from(document.querySelectorAll('#bg-tabs-options input:checked')).map(cb => cb.value)),
    presentation,
    opacity: presentation.opacity,
  };
}

export function applyCustomBackground(config) {
  const cfg = config || state.backgroundConfig;
  const valid = !!cfg.image_url && /^https?:\/\//i.test(cfg.image_url);
  const show = valid && normalizePageKeys(cfg.tabs).includes(state.activeTab || 'logs');
  const layer = ensureBackgroundLayer();

  clearLegacyBodyBackground();

  if (!show) {
    layer.className = 'custom-background-layer';
    layer.style.removeProperty('--custom-bg-url');
    return;
  }

  const safeUrl = cfg.image_url.replace(/["\\]/g, '');
  const presentation = normalizeBackgroundPresentation(cfg.presentation, cfg.opacity ?? 1);
  const mode = ['fixed', 'continuous', 'contain'].includes(cfg.mode) ? cfg.mode : 'fixed';

  layer.className = `custom-background-layer is-visible mode-${mode}`;
  layer.style.setProperty('--custom-bg-url', `url("${safeUrl}")`);
  layer.style.setProperty('--custom-bg-position', presentation.position);
  layer.style.setProperty('--custom-bg-repeat', presentation.repeat);
  layer.style.setProperty('--custom-bg-opacity', String(presentation.opacity));
  layer.style.setProperty('--custom-bg-veil', String(Math.max(0.12, 0.72 - (presentation.opacity * 0.52))));
}

async function saveBackgroundConfig() {
  const errorBox = document.getElementById('bg-config-error');
  errorBox.classList.add('hidden');
  const value = readBackgroundForm();

  if (!state.adminMode) {
    errorBox.textContent = 'Tu sesión de administrador expiró.';
    errorBox.classList.remove('hidden');
    return;
  }

  const { error } = await supabaseClient.rpc('update_app_setting', {
    input_code: state.adminMode,
    input_key: 'background_config',
    input_value: value,
  });

  if (error) {
    errorBox.textContent = `Error: ${error.message}`;
    errorBox.classList.remove('hidden');
    return;
  }

  state.backgroundConfig = value;
  applyCustomBackground();
  showToast(value.image_url ? 'Fondo guardado para todos' : 'Fondo de página quitado', 'success');
}

async function clearBackgroundConfig() {
  if (!(await confirmAction({
    title: 'Quitar fondo',
    message: 'Quitar el fondo personalizado para toda la web.',
    confirmLabel: 'Quitar fondo',
    danger: true,
  }))) return;

  const input = document.getElementById('bg-image-input');
  if (input) input.value = '';
  setBackgroundFormPresentation(DEFAULT_MEDIA_PRESENTATION);
  updateAssetPreview('bg', '');
  syncGenericDropzoneState('bg', '');
  await saveBackgroundConfig();
}

export function initBackgroundTool() {
  const input = document.getElementById('bg-image-input');
  if (!input) return;

  const preview = () => applyCustomBackground(readBackgroundForm());
  document.querySelectorAll('input[name="bg-mode"]').forEach(radio => radio.addEventListener('change', preview));
  document.querySelectorAll('#bg-tabs-options input[type="checkbox"]').forEach(checkbox => checkbox.addEventListener('change', preview));
  document.getElementById('bg-save-btn')?.addEventListener('click', saveBackgroundConfig);
  document.getElementById('bg-clear-btn')?.addEventListener('click', clearBackgroundConfig);
  document.getElementById('bg-image-clear-btn')?.addEventListener('click', () => {
    input.value = '';
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

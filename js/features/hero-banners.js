// =========================================================
// hero-banners.js
// =========================================================
// Banners personalizados para las cabeceras de cada pestaña.
// Se guardan en app_settings sin requerir una tabla nueva.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { initGenericImageDropzone, syncGenericDropzoneState, updateAssetPreview } from '../core/storage.js';
import { confirmAction, showToast } from '../core/utils.js';
import { attachMediaPickerButton } from './media-library.js';

export const HERO_BANNER_PAGES = [
  { key: 'logs', label: 'Logs' },
  { key: 'weapons', label: 'Guías' },
  { key: 'tierlist', label: 'Tierlist' },
  { key: 'kits', label: 'Kits' },
  { key: 'about', label: 'Acerca del servidor' },
  { key: 'admin', label: 'Herramientas' },
];

const DEFAULT_ENTRY = Object.freeze({
  image_url: '',
  position: 'center center',
  opacity: 1,
  hide_default_art: true,
});

export function normalizeHeroBannerConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(HERO_BANNER_PAGES.map(({ key }) => {
    const entry = source[key] && typeof source[key] === 'object' ? source[key] : {};
    const position = ['center center', 'center top', 'center bottom', 'left center', 'right center'].includes(entry.position)
      ? entry.position
      : DEFAULT_ENTRY.position;
    const opacityNumber = Number(entry.opacity);
    return [key, {
      image_url: typeof entry.image_url === 'string' ? entry.image_url : '',
      position,
      opacity: Number.isFinite(opacityNumber) ? Math.max(0.1, Math.min(1, opacityNumber)) : 1,
      hide_default_art: entry.hide_default_art !== false,
    }];
  }));
}

function ensureHeroBannerLayer(hero) {
  let layer = hero.querySelector('.page-hero-custom-banner');
  if (layer) return layer;
  layer = document.createElement('div');
  layer.className = 'page-hero-custom-banner';
  layer.setAttribute('aria-hidden', 'true');
  hero.prepend(layer);
  return layer;
}

export function applyHeroBanner(pageKey = state.activeTab, config = state.heroBannerConfig) {
  const hero = document.querySelector('.page-hero');
  if (!hero) return;

  const normalized = normalizeHeroBannerConfig(config);
  const entry = normalized[pageKey] || DEFAULT_ENTRY;
  const valid = /^https?:\/\//i.test(entry.image_url || '');
  const layer = ensureHeroBannerLayer(hero);

  hero.classList.toggle('has-custom-banner', valid);
  hero.classList.toggle('hide-default-hero-art', valid && entry.hide_default_art);

  if (!valid) {
    layer.style.backgroundImage = '';
    layer.style.backgroundPosition = '';
    layer.style.opacity = '';
    return;
  }

  const safe = entry.image_url.replace(/["\\]/g, '');
  layer.style.backgroundImage = `linear-gradient(90deg, rgba(8,10,25,.92) 0%, rgba(8,10,25,.54) 48%, rgba(8,10,25,.22) 100%), url("${safe}")`;
  layer.style.backgroundPosition = `center, ${entry.position}`;
  layer.style.opacity = String(entry.opacity);
}

function selectedPageKey() {
  return document.getElementById('hero-banner-page-select')?.value || 'logs';
}

function formEntry() {
  const opacity = Number(document.getElementById('hero-banner-opacity')?.value || 1);
  return {
    image_url: document.getElementById('hero-banner-image-input')?.value.trim() || '',
    position: document.getElementById('hero-banner-position')?.value || 'center center',
    opacity: Number.isFinite(opacity) ? Math.max(0.1, Math.min(1, opacity)) : 1,
    hide_default_art: !!document.getElementById('hero-banner-hide-art')?.checked,
  };
}

function updateOpacityLabel() {
  const range = document.getElementById('hero-banner-opacity');
  const label = document.getElementById('hero-banner-opacity-value');
  if (range && label) label.textContent = `${Math.round(Number(range.value) * 100)}%`;
}

function updateMiniPreview() {
  const preview = document.getElementById('hero-banner-live-preview');
  if (!preview) return;
  const entry = formEntry();
  const valid = /^https?:\/\//i.test(entry.image_url);
  preview.classList.toggle('has-image', valid);
  const leftShade = Math.max(0.3, 0.96 - (entry.opacity * 0.35));
  const rightShade = Math.max(0.08, 0.68 - (entry.opacity * 0.52));
  preview.style.backgroundImage = valid
    ? `linear-gradient(90deg, rgba(8,10,25,${leftShade}), rgba(8,10,25,${rightShade})), url("${entry.image_url.replace(/["\\]/g, '')}")`
    : '';
  preview.style.backgroundPosition = `center, ${entry.position}`;
}

export function populateHeroBannerForm(pageKey = selectedPageKey()) {
  const normalized = normalizeHeroBannerConfig(state.heroBannerConfig);
  const entry = normalized[pageKey] || DEFAULT_ENTRY;
  const input = document.getElementById('hero-banner-image-input');
  if (!input) return;

  input.value = entry.image_url;
  document.getElementById('hero-banner-position').value = entry.position;
  document.getElementById('hero-banner-opacity').value = String(entry.opacity);
  document.getElementById('hero-banner-hide-art').checked = entry.hide_default_art;
  updateAssetPreview('hero-banner', entry.image_url);
  syncGenericDropzoneState('hero-banner', entry.image_url);
  updateOpacityLabel();
  updateMiniPreview();
}

async function saveHeroBanner() {
  const errorBox = document.getElementById('hero-banner-error');
  errorBox?.classList.add('hidden');
  if (!state.adminCode) {
    if (errorBox) {
      errorBox.textContent = 'Tu sesión de administrador expiró.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  const pageKey = selectedPageKey();
  const next = normalizeHeroBannerConfig(state.heroBannerConfig);
  next[pageKey] = formEntry();

  const { error } = await supabaseClient.rpc('update_app_setting', {
    input_code: state.adminCode,
    input_key: 'hero_banner_config',
    input_value: next,
  });

  if (error) {
    if (errorBox) {
      errorBox.textContent = `Error: ${error.message}`;
      errorBox.classList.remove('hidden');
    }
    return;
  }

  state.heroBannerConfig = next;
  applyHeroBanner();
  showToast('Banner guardado', 'success');
}

async function clearHeroBanner() {
  const pageKey = selectedPageKey();
  if (!(await confirmAction({
    title: 'Quitar banner',
    message: `Quitar el banner personalizado de ${HERO_BANNER_PAGES.find(page => page.key === pageKey)?.label || 'esta sección'}.`,
    confirmLabel: 'Quitar banner',
    danger: true,
  }))) return;

  const next = normalizeHeroBannerConfig(state.heroBannerConfig);
  next[pageKey] = { ...DEFAULT_ENTRY };

  const { error } = await supabaseClient.rpc('update_app_setting', {
    input_code: state.adminCode,
    input_key: 'hero_banner_config',
    input_value: next,
  });

  if (error) {
    showToast(`No se pudo quitar el banner: ${error.message}`, 'error');
    return;
  }

  state.heroBannerConfig = next;
  populateHeroBannerForm(pageKey);
  applyHeroBanner();
  showToast('Banner quitado', 'success');
}

export function initHeroBannerTool() {
  const input = document.getElementById('hero-banner-image-input');
  if (!input) return;

  document.getElementById('hero-banner-page-select')?.addEventListener('change', () => populateHeroBannerForm());
  document.getElementById('hero-banner-position')?.addEventListener('change', updateMiniPreview);
  document.getElementById('hero-banner-opacity')?.addEventListener('input', () => {
    updateOpacityLabel();
    updateMiniPreview();
  });
  document.getElementById('hero-banner-hide-art')?.addEventListener('change', updateMiniPreview);
  document.getElementById('hero-banner-save-btn')?.addEventListener('click', saveHeroBanner);
  document.getElementById('hero-banner-clear-btn')?.addEventListener('click', clearHeroBanner);
  document.getElementById('hero-banner-image-clear-btn')?.addEventListener('click', () => {
    input.value = '';
    updateAssetPreview('hero-banner', '');
    syncGenericDropzoneState('hero-banner', '');
    updateMiniPreview();
  });

  initGenericImageDropzone('hero-banner', 'banners', () => {
    const pageKey = selectedPageKey();
    return normalizeHeroBannerConfig(state.heroBannerConfig)[pageKey]?.image_url || '';
  }, (url) => {
    input.value = url;
    updateAssetPreview('hero-banner', url);
    updateMiniPreview();
  });

  attachMediaPickerButton({
    targetInputId: 'hero-banner-image-input',
    insertAfterId: 'hero-banner-dropzone',
    title: 'Seleccionar banner de cabecera',
    onSelect: ({ url }) => {
      input.value = url;
      updateAssetPreview('hero-banner', url);
      syncGenericDropzoneState('hero-banner', url);
      updateMiniPreview();
    },
  });

  populateHeroBannerForm();
}

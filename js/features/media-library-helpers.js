// =========================================================
// media-library-helpers.js
// =========================================================
// Helpers puros de Biblioteca Multimedia: normalizacion,
// filtros y HTML basico de previews. No contiene flujos admin.
// =========================================================

import {
  DEFAULT_MEDIA_PRESENTATION,
  mediaKindFromUrlFallback,
} from '../core/media.js';
import { escapeHtml, safeUrl } from '../core/utils.js';

const mediaSearchTextCache = new WeakMap();

export function normalizePresentation(presentation = {}) {
  const merged = { ...DEFAULT_MEDIA_PRESENTATION, ...(presentation || {}) };
  const opacity = Number(merged.opacity);
  const positionMap = {
    'top center': 'center top',
    'bottom center': 'center bottom',
    'center left': 'left center',
    'center right': 'right center',
  };
  const mappedPosition = positionMap[merged.position] || merged.position || DEFAULT_MEDIA_PRESENTATION.position;
  const position = ['center center', 'center top', 'center bottom', 'left center', 'right center'].includes(mappedPosition)
    ? mappedPosition
    : DEFAULT_MEDIA_PRESENTATION.position;

  return {
    fit: ['contain', 'cover', 'fill', 'none', 'scale-down'].includes(merged.fit) ? merged.fit : DEFAULT_MEDIA_PRESENTATION.fit,
    position,
    repeat: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y'].includes(merged.repeat) ? merged.repeat : DEFAULT_MEDIA_PRESENTATION.repeat,
    opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : DEFAULT_MEDIA_PRESENTATION.opacity,
  };
}

export function presentationStyle(presentation = {}) {
  const p = normalizePresentation(presentation);
  return [
    `object-fit:${p.fit}`,
    `object-position:${p.position}`,
    `opacity:${p.opacity}`,
  ].join(';');
}

export function parseTags(value) {
  return String(value || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

export function assetFileName(asset) {
  const raw = asset.storage_path || String(asset.url || '').split('?')[0];
  return raw.split('/').pop() || asset.display_name || 'recurso';
}

export function sourceLabel(asset) {
  return asset.source_type === 'external' ? 'Externo' : (asset.folder || 'Storage');
}

export function kindLabel(kind) {
  return { image: 'Imagen', video: 'Video', audio: 'Audio', document: 'Documento', other: 'Otro' }[kind] || kind || 'Otro';
}

function assetSearchText(asset) {
  if (mediaSearchTextCache.has(asset)) return mediaSearchTextCache.get(asset);
  const text = [
    asset.display_name,
    asset.description,
    asset.mime_type,
    asset.folder,
    asset.url,
    ...(asset.tags || []),
  ].join(' ').toLowerCase();
  mediaSearchTextCache.set(asset, text);
  return text;
}

export function renderMediaPreview(asset, className = 'media-thumb-preview') {
  const safe = safeUrl(asset.url);
  if (!safe) return `<div class="${className} is-empty">?</div>`;
  const style = presentationStyle(asset.presentation);
  if (asset.media_kind === 'image') {
    return `<img src="${escapeHtml(safe)}" alt="${escapeHtml(asset.display_name || '')}" class="${className}" loading="lazy" decoding="async" fetchpriority="low" style="${style}" />`;
  }
  if (asset.media_kind === 'video') {
    return `<video src="${escapeHtml(safe)}" class="${className}" muted playsinline preload="metadata" style="${style}"></video>`;
  }
  return `<div class="${className} is-file">${escapeHtml(kindLabel(asset.media_kind))}</div>`;
}

export function assetMatchesFilters(asset, filters, allowedKinds = null) {
  if (allowedKinds && allowedKinds.length && !allowedKinds.includes(asset.media_kind)) return false;
  if (filters.kind !== 'all' && asset.media_kind !== filters.kind) return false;
  if (filters.source !== 'all' && asset.source_type !== filters.source) return false;
  const q = filters.search.trim().toLowerCase();
  if (!q) return true;
  return assetSearchText(asset).includes(q);
}

export function sortedMediaList(list, sort = 'recent') {
  return [...list].sort((a, b) => {
    if (sort === 'oldest') return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (sort === 'name') return String(a.display_name || assetFileName(a)).localeCompare(String(b.display_name || assetFileName(b)), 'es');
    if (sort === 'size') return Number(b.file_size || 0) - Number(a.file_size || 0);
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

export function normalizePickerAsset(asset) {
  return {
    id: asset.id,
    url: asset.url,
    display_name: asset.display_name || assetFileName(asset),
    media_kind: asset.media_kind || mediaKindFromUrlFallback(asset.url) || 'image',
    mime_type: asset.mime_type || '',
    source_type: asset.source_type || 'storage',
    file_size: asset.file_size || 0,
    created_at: asset.created_at || '',
    presentation: DEFAULT_MEDIA_PRESENTATION,
  };
}

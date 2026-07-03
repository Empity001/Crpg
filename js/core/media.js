// =========================================================
// media.js
// =========================================================
// Núcleo del Sistema Multimedia: MIME/kind, hashing, duplicados y
// metadatos de Biblioteca Multimedia. Mantiene compatibilidad con los
// campos actuales basados en image_url.
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from './state.js';

export const MEDIA_BUCKET = 'culones';
export const MEDIA_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/apng',
];
const MEDIA_VIDEO_MIME_TYPES = ['video/mp4', 'video/webm'];
export const MEDIA_UPLOAD_MIME_TYPES = [...MEDIA_IMAGE_MIME_TYPES, ...MEDIA_VIDEO_MIME_TYPES];

export const DEFAULT_MEDIA_PRESENTATION = {
  fit: 'contain',
  position: 'center center',
  repeat: 'no-repeat',
  opacity: 1,
};

export function mediaKindFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf') return 'document';
  return 'other';
}

export function mediaKindFromUrlFallback(url) {
  const clean = String(url || '').split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|webp|gif|svg|apng)$/.test(clean)) return 'image';
  if (/\.(mp4|webm)$/.test(clean)) return 'video';
  return 'other';
}

export function formatFileSize(bytes) {
  const n = Number(bytes || 0);
  if (!n) return 'Sin tamaño';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export async function hashFile(file) {
  if (!file || !globalThis.crypto?.subtle) return '';
  const buffer = await file.arrayBuffer();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function storagePathFromPublicUrl(url) {
  const raw = String(url || '');
  const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
  const idx = raw.indexOf(marker);
  if (idx === -1) return '';
  const path = raw.slice(idx + marker.length).split('?')[0];
  try { return decodeURIComponent(path); } catch(e) { return path; }
}

export function folderFromStoragePath(path) {
  return String(path || '').split('/')[0] || '';
}

export function isMediaInfrastructureMissing(error) {
  const msg = String(error?.message || error || '').toLowerCase();
  return msg.includes('media_assets')
    || msg.includes('list_media_assets')
    || msg.includes('list_media_picker_assets')
    || msg.includes('upsert_media_asset')
    || msg.includes('find_media_duplicate')
    || msg.includes('delete_media_asset')
    || msg.includes('could not find the function')
    || msg.includes('schema cache');
}

function withAdminCode(payload = {}) {
  return { input_code: state.adminCode, ...payload };
}

function normalizeRpcAsset(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data || null;
}

export async function listMediaAssets({ includeArchived = false } = {}) {
  if (!state.adminCode) return { data: [], error: new Error('Admin requerido') };
  const { data, error } = await supabaseClient.rpc('list_media_assets', withAdminCode({
    input_include_archived: includeArchived,
  }));
  return { data: data || [], error };
}

export async function listMediaPickerAssets({
  search = '',
  kind = 'all',
  source = 'all',
  sort = 'recent',
  limit = 32,
  offset = 0,
} = {}) {
  if (!state.adminCode) return { data: [], error: new Error('Admin requerido') };
  const { data, error } = await supabaseClient.rpc('list_media_picker_assets', withAdminCode({
    input_search: search,
    input_media_kind: kind,
    input_source_type: source,
    input_sort: sort,
    input_limit: limit,
    input_offset: offset,
  }));
  return { data: data || [], error };
}

export async function findDuplicateMediaAsset({ hash = '', url = '' } = {}) {
  if (!state.adminCode || (!hash && !url)) return { data: null, error: null };
  const { data, error } = await supabaseClient.rpc('find_media_duplicate', withAdminCode({
    input_file_hash: hash || null,
    input_url: url || null,
  }));
  return { data: normalizeRpcAsset(data), error };
}

export async function upsertMediaAsset(asset) {
  if (!state.adminCode) return { data: null, error: new Error('Admin requerido') };
  const presentation = { ...DEFAULT_MEDIA_PRESENTATION, ...(asset.presentation || {}) };
  const { data, error } = await supabaseClient.rpc('upsert_media_asset', withAdminCode({
    input_source_type: asset.source_type || asset.sourceType || 'storage',
    input_url: asset.url,
    input_bucket: asset.bucket || MEDIA_BUCKET,
    input_storage_path: asset.storage_path || asset.path || null,
    input_display_name: asset.display_name || asset.displayName || '',
    input_mime_type: asset.mime_type || asset.mimeType || '',
    input_media_kind: asset.media_kind || asset.kind || mediaKindFromMime(asset.mime_type || asset.mimeType),
    input_file_size: asset.file_size || asset.fileSize || null,
    input_file_hash: asset.file_hash || asset.hash || '',
    input_description: asset.description || '',
    input_folder: asset.folder || '',
    input_tags: Array.isArray(asset.tags) ? asset.tags : [],
    input_presentation: presentation,
    input_metadata: asset.metadata || {},
  }));
  return { data: normalizeRpcAsset(data), error };
}

export async function updateMediaAsset(asset) {
  if (!state.adminCode) return { data: null, error: new Error('Admin requerido') };
  const { data, error } = await supabaseClient.rpc('update_media_asset', withAdminCode({
    input_id: asset.id,
    input_display_name: asset.display_name || '',
    input_description: asset.description || '',
    input_tags: Array.isArray(asset.tags) ? asset.tags : [],
    input_presentation: { ...DEFAULT_MEDIA_PRESENTATION, ...(asset.presentation || {}) },
  }));
  return { data: normalizeRpcAsset(data), error };
}

export async function archiveMediaAsset(id, archived = true) {
  if (!state.adminCode) return { error: new Error('Admin requerido') };
  const { error } = await supabaseClient.rpc('archive_media_asset', withAdminCode({
    input_id: id,
    input_archived: archived,
  }));
  return { error };
}

export async function deleteMediaAsset(id) {
  if (!state.adminCode) return { error: new Error('Admin requerido') };
  const { error } = await supabaseClient.rpc('delete_media_asset', withAdminCode({
    input_id: id,
  }));
  return { error };
}

export async function detectExternalMime(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', mode: 'cors' });
    const type = res.headers.get('content-type') || '';
    return type.split(';')[0].trim().toLowerCase();
  } catch(e) {
    return '';
  }
}

export async function registerUploadedMediaAsset({ url, file, folder, path, hash }) {
  if (!state.adminCode || !url || !file) return { data: null, error: null };
  return upsertMediaAsset({
    source_type: 'storage',
    bucket: MEDIA_BUCKET,
    storage_path: path || storagePathFromPublicUrl(url),
    folder: folder || folderFromStoragePath(path),
    url,
    display_name: file.name || 'Recurso multimedia',
    mime_type: file.type || '',
    media_kind: mediaKindFromMime(file.type),
    file_size: file.size || null,
    file_hash: hash || '',
    tags: [],
    presentation: DEFAULT_MEDIA_PRESENTATION,
    metadata: { original_name: file.name || '', last_upload_at: new Date().toISOString() },
  });
}

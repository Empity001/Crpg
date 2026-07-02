// =========================================================
// storage.js
// =========================================================
// Todo lo relacionado con Supabase Storage: subida de imágenes al bucket
// "culones", vista previa de imagen de referencia, apertura en pantalla
// completa (asset-view.html) y las dropzones/uploaders genéricos
// reutilizados por mobs, items, libres, tierlist, armas, fondo y
// favicon.
// =========================================================

import { supabaseClient } from '../config.js';
import { escapeHtml, safeUrl, showToast } from './utils.js';

export function renderBlockAssetHtml(url, title) {
  const safe = safeUrl(url);
  if (!safe) return '';
  const safeAttr = escapeHtml(safe);
  const titleAttr = escapeHtml(title || '');
  return `
    <div class="block-asset">
      <img src="${safeAttr}" alt="${titleAttr}" class="js-open-asset pixel-art" loading="lazy" data-asset-src="${safeAttr}" data-asset-title="${titleAttr}" />
      <button type="button" class="btn-fullscreen-asset js-open-asset" data-asset-src="${safeAttr}" data-asset-title="${titleAttr}">⛶ Ver en pantalla completa</button>
    </div>`;
}


export function openAssetFullscreen(src, title) {
  const safe = safeUrl(src);
  if (!safe) return;
  const url = `asset-view.html?src=${encodeURIComponent(safe)}&title=${encodeURIComponent(title || '')}`;
  window.open(url, '_blank');
}

// Sincroniza el preview de imagen dentro de un modal de bloque
// (mob/item/libre) — prefix es 'mob' | 'item' | 'libre'.

export function updateAssetPreview(prefix, url) {
  const wrap = document.getElementById(`${prefix}-image-preview-wrap`);
  const img  = document.getElementById(`${prefix}-image-preview`);
  const btn  = document.getElementById(`${prefix}-image-fullscreen-btn`);
  const urlInput = document.getElementById(`${prefix}-image-input`);
  if (!wrap || !img || !btn) return;
  const safe = safeUrl(url);
  if (!safe) {
    wrap.classList.add('hidden');
    if (urlInput) urlInput.classList.remove('input-error');
    return;
  }
  img.src = safe;
  img.onload  = () => { if (urlInput) urlInput.classList.remove('input-error'); };
  img.onerror = () => {
    wrap.classList.add('hidden');
    // Marca el input en rojo si la URL no carga como imagen — avisa al admin antes de guardar.
    if (urlInput && url) urlInput.classList.add('input-error');
  };
  wrap.classList.remove('hidden');
  btn.dataset.assetSrc   = safe;
  btn.dataset.assetTitle = document.getElementById(`${prefix}-name-input`)?.value ?? '';
}

// Sube un archivo de imagen al bucket "culones" de Supabase Storage.
// folder: carpeta destino ('mobs', 'items', 'tierlist', 'weapons', 'weapon-ranks', 'recipes')
// oldUrl: URL previa (si viene de Storage) — se borra para no dejar huérfanos.
// Devuelve la URL pública de la imagen subida, o lanza error.

export const STORAGE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
export const STORAGE_ALLOWED   = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
export const STORAGE_BUCKET    = 'culones';


export async function uploadImageToStorage(file, folder, oldUrl = '') {
  if (!STORAGE_ALLOWED.includes(file.type)) {
    throw new Error('Solo se permiten imágenes PNG, JPG o WEBP.');
  }
  if (file.size > STORAGE_MAX_BYTES) {
    throw new Error('El archivo supera el límite de 3 MB.');
  }

  // Nombre único basado en timestamp — evita colisiones y cachés viejas.
  const ext  = file.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: upErr } = await supabaseClient.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type });

  if (upErr) throw new Error('Error al subir: ' + upErr.message);

  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  // Borrar imagen antigua del Storage (solo si era de nuestro mismo bucket).
  if (oldUrl && oldUrl.includes(`/storage/v1/object/public/${STORAGE_BUCKET}/`)) {
    const oldPath = oldUrl.split(`/storage/v1/object/public/${STORAGE_BUCKET}/`)[1];
    if (oldPath) {
      // Fire-and-forget: si falla el borrado no bloqueamos la subida nueva.
      supabaseClient.storage.from(STORAGE_BUCKET).remove([oldPath]).catch(() => {});
    }
  }

  return data.publicUrl;
}

// ---------------------------------------------------------
// DROPZONE DE IMAGEN — Modal "Nuevo/Editar elemento Tierlist"
// Maneja: click-para-elegir, drag-and-drop, botón "Quitar
// imagen", y sincronización visual de estado (vacío / con imagen).
// Reutiliza uploadImageToStorage y updateAssetPreview intactos.
// ---------------------------------------------------------

export function syncGenericDropzoneState(prefix, url) {
  const zone  = document.getElementById(`${prefix}-dropzone`);
  const icon  = document.getElementById(`${prefix}-dropzone-icon`);
  const label = document.getElementById(`${prefix}-dropzone-label`);
  if (!zone) return;
  if (url) {
    zone.classList.add('has-image');
    if (icon)  icon.textContent  = '✅';
    if (label) label.textContent = 'Imagen lista — hacé click para reemplazarla';
  } else {
    zone.classList.remove('has-image');
    if (icon)  icon.textContent  = '🖼';
    if (label) label.textContent = 'Arrastrá una imagen aquí o hacé click para elegir';
  }
}


export function initGenericImageDropzone(prefix, folder, getOldUrl = () => '', onChange = () => {}) {
  const zone      = document.getElementById(`${prefix}-dropzone`);
  const fileInput = document.getElementById(`${prefix}-image-file`);
  const urlInput  = document.getElementById(`${prefix}-image-input`);
  const progress  = document.getElementById(`${prefix}-upload-progress`);
  if (!zone || !fileInput || !urlInput) return;

  syncGenericDropzoneState(prefix, urlInput.value);

  zone.addEventListener('click', () => fileInput.click());
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-drag-over'));
  zone.addEventListener('drop', async (e) => {
    e.preventDefault();
    zone.classList.remove('is-drag-over');
    const file = e.dataTransfer?.files?.[0];
    if (file) await handleFile(file);
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = '';
    await handleFile(file);
  });

  async function handleFile(file) {
    if (progress) progress.classList.remove('hidden');
    zone.style.pointerEvents = 'none';
    try {
      const publicUrl = await uploadImageToStorage(file, folder, getOldUrl());
      urlInput.value = publicUrl;
      syncGenericDropzoneState(prefix, publicUrl);
      onChange(publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (progress) progress.classList.add('hidden');
      zone.style.pointerEvents = '';
    }
  }
}

// Conecta el botón 📁 de un modal al campo oculto que guarda la URL pública.
// prefix    : 'mob' | 'item' | 'libre' | 'tier-item' | 'weapon' | 'weapon-rank'
// folder    : carpeta dentro del bucket ('mobs', 'items', 'tierlist', 'weapons', 'weapon-ranks')
// getOldUrl : función que devuelve la URL actual guardada (para borrado de huérfanos)

export function initImageUploader(prefix, folder, getOldUrl = () => '') {
  const btn      = document.getElementById(`${prefix}-image-upload-btn`);
  const fileInput = document.getElementById(`${prefix}-image-file`);
  const urlInput  = document.getElementById(`${prefix}-image-input`);
  if (!btn || !fileInput || !urlInput) return;

  btn.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileInput.value = ''; // permite volver a elegir el mismo archivo

    btn.classList.add('is-uploading');
    btn.textContent = '…';

    try {
      const publicUrl = await uploadImageToStorage(file, folder, getOldUrl());
      urlInput.value = publicUrl;
      updateAssetPreview(prefix, publicUrl);
      showToast('Imagen subida correctamente', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.classList.remove('is-uploading');
      btn.textContent = 'Subir';
    }
  });
}

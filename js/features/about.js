// =========================================================
// about.js
// =========================================================
// Pestaña "Acerca del Server": render público de los bloques
// configurables y su editor admin (alta/orden/edición de bloques tipo
// texto/imagen/separador/destacado).
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { uploadImageToStorage } from '../core/storage.js';
import { escapeHtml, showToast } from '../core/utils.js';
import { openMediaPicker } from './media-library.js';

const ABOUT_BLOCK_KINDS = {
  heading:   { label: '🔤 Título',     icon: '🔤' },
  text:      { label: '📝 Texto',      icon: '📝' },
  image:     { label: '🖼 Imagen',     icon: '🖼' },
  divider:   { label: '➖ Separador',  icon: '➖' },
  highlight: { label: '✨ Destacado',  icon: '✨' },
};


export function renderAboutContent() {
  const container = document.getElementById('about-content-render');
  if (!container) return;
  const blocks = state.aboutBlocks;
  if (!blocks || blocks.length === 0) {
    container.innerHTML = `
      <div class="placeholder-panel">
        <div class="placeholder-icon">🎮</div>
        <h2>Acerca de culones-rpg</h2>
        <p>Servidor de Minecraft con sistema RPG y gacha.</p>
      </div>`;
    return;
  }
  container.innerHTML = blocks.map(block => {
    switch (block.kind) {
      case 'heading':   return `<h2 class="about-block-heading">${escapeHtml(block.content || '')}</h2>`;
      case 'text':      return `<p class="about-block-text">${escapeHtml(block.content || '')}</p>`;
      case 'highlight': return `<div class="about-block-highlight">${escapeHtml(block.content || '')}</div>`;
      case 'divider':   return `<hr class="about-block-divider" />`;
      case 'image': {
        const safe = (block.url || '').replace(/['"\\]/g, '');
        if (!safe) return '';
        return `<img class="about-block-image" src="${escapeHtml(safe)}" alt="${escapeHtml(block.caption || '')}" loading="lazy" />` +
               (block.caption ? `<p class="about-block-image-caption">${escapeHtml(block.caption)}</p>` : '');
      }
      default: return '';
    }
  }).join('');
}


function openAboutEditor() {
  state.aboutEditorBlocks = JSON.parse(JSON.stringify(state.aboutBlocks || []));
  renderAboutEditorBlocks();
  document.getElementById('about-editor-error').classList.add('hidden');
  document.getElementById('about-editor-modal').classList.remove('hidden');
}


function renderAboutEditorBlocks() {
  const container = document.getElementById('about-blocks-editor');
  if (!container) return;
  if (state.aboutEditorBlocks.length === 0) {
    container.innerHTML = '<p class="admin-empty" style="padding:16px 0;">No hay bloques todavía. Usá los botones de abajo para agregar contenido.</p>';
    return;
  }
  const meta = (b) => ({ heading:'🔤 Título', text:'📝 Texto', image:'🖼 Imagen', divider:'➖ Separador', highlight:'✨ Destacado' }[b.kind] || b.kind);
  container.innerHTML = state.aboutEditorBlocks.map((block, idx) => {
    const first = idx === 0, last = idx === state.aboutEditorBlocks.length - 1;
    const btns = `<div class="about-editor-block-actions">
      <button type="button" class="move-about-block" data-dir="-1" data-idx="${idx}" ${first ? 'disabled' : ''}>▲</button>
      <button type="button" class="move-about-block" data-dir="1" data-idx="${idx}" ${last ? 'disabled' : ''}>▼</button>
      <button type="button" class="del-about-block" data-idx="${idx}">✕</button>
    </div>`;
    if (block.kind === 'divider') return `<div class="about-editor-block is-divider" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span><div class="about-editor-divider-preview"></div></div>${btns}</div>`;
    if (block.kind === 'image') return `<div class="about-editor-block" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span>
      <div class="about-block-image-upload-row">
        ${block.url ? `<img src="${escapeHtml(block.url)}" alt="" class="about-block-image-thumb" />` : ''}
        <button type="button" class="btn-upload-zone btn-upload-zone-sm about-block-img-btn" data-idx="${idx}">${block.url ? '✅ Imagen' : '📁 Elegir imagen'}</button>
        <button type="button" class="btn-media-picker about-block-media-btn" data-idx="${idx}">Biblioteca</button>
        <input type="file" class="hidden about-block-img-file" data-idx="${idx}" accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,image/svg+xml,image/apng" />
        ${block.url ? `<button type="button" class="link-btn about-block-img-clear" data-idx="${idx}">✕ Quitar</button>` : ''}
      </div>
      <input type="text" class="modal-input about-block-field" data-idx="${idx}" data-field="caption" value="${escapeHtml(block.caption||'')}" placeholder="Pie de foto (opcional)" /></div>${btns}</div>`;
    return `<div class="about-editor-block" data-idx="${idx}"><div class="about-editor-block-body"><span class="about-editor-block-kind">${meta(block)}</span><textarea class="modal-input about-block-field" data-idx="${idx}" data-field="content" rows="${block.kind==='heading'?1:3}" placeholder="${block.kind==='heading'?'Título':'Contenido...'}">${escapeHtml(block.content||'')}</textarea></div>${btns}</div>`;
  }).join('');

  container.querySelectorAll('.about-block-field').forEach(el => {
    el.addEventListener('input', (e) => { state.aboutEditorBlocks[+e.target.dataset.idx][e.target.dataset.field] = e.target.value; });
  });
  container.querySelectorAll('.about-block-img-btn').forEach(btn => {
    const idx = Number(btn.dataset.idx);
    const fileInput = container.querySelector(`.about-block-img-file[data-idx="${idx}"]`);
    if (!fileInput) return;
    btn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      fileInput.value = '';
      btn.textContent = '…';
      try {
        const oldUrl = state.aboutEditorBlocks[idx].url || '';
        const publicUrl = await uploadImageToStorage(file, 'about', oldUrl);
        state.aboutEditorBlocks[idx].url = publicUrl;
        showToast('Imagen subida correctamente', 'success');
        renderAboutEditorBlocks();
      } catch (err) {
        btn.textContent = state.aboutEditorBlocks[idx].url ? '✅ Imagen' : '📁 Elegir imagen';
        showToast(err.message, 'error');
      }
    });
  });
  container.querySelectorAll('.about-block-media-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      openMediaPicker({
        title: 'Seleccionar imagen de bloque',
        allowedKinds: ['image'],
        currentUrl: state.aboutEditorBlocks[idx]?.url || '',
        onSelect: ({ url }) => {
          state.aboutEditorBlocks[idx].url = url;
          renderAboutEditorBlocks();
        },
      });
    });
  });
  container.querySelectorAll('.about-block-img-clear').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.aboutEditorBlocks[idx].url = '';
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.move-about-block').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.idx, d = +btn.dataset.dir, j = i + d;
      if (j < 0 || j >= state.aboutEditorBlocks.length) return;
      [state.aboutEditorBlocks[i], state.aboutEditorBlocks[j]] = [state.aboutEditorBlocks[j], state.aboutEditorBlocks[i]];
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.del-about-block').forEach(btn => {
    btn.addEventListener('click', () => { state.aboutEditorBlocks.splice(+btn.dataset.idx, 1); renderAboutEditorBlocks(); });
  });
}


function addAboutBlock(kind) {
  const block = { kind };
  if (kind === 'image') { block.url = ''; block.caption = ''; }
  else if (kind !== 'divider') block.content = '';
  state.aboutEditorBlocks.push(block);
  renderAboutEditorBlocks();
  const c = document.getElementById('about-blocks-editor');
  if (c) setTimeout(() => c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }), 50);
}


async function saveAboutContent() {
  const errorBox = document.getElementById('about-editor-error');
  errorBox.classList.add('hidden');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'about_blocks', input_value: state.aboutEditorBlocks });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  state.aboutBlocks = JSON.parse(JSON.stringify(state.aboutEditorBlocks));
  document.getElementById('about-editor-modal').classList.add('hidden');
  renderAboutContent();
  showToast('Página "Acerca del Server" actualizada', 'success');
}

// =========================================================
// FONDO DE LA PÁGINA
// =========================================================

export function initAboutEditor() {
  document.getElementById('open-about-editor-btn')?.addEventListener('click', openAboutEditor);
  document.getElementById('close-about-editor-modal')?.addEventListener('click', () => { document.getElementById('about-editor-modal').classList.add('hidden'); });
  document.getElementById('save-about-editor-btn')?.addEventListener('click', saveAboutContent);
  document.querySelectorAll('.btn-add-about-block').forEach(btn => { btn.addEventListener('click', () => addAboutBlock(btn.dataset.kind)); });
  document.getElementById('about-editor-modal')?.addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden'); });
}

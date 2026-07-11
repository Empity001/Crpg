// =========================================================
// about.js
// =========================================================
// Pestaña "Acerca del Server": render público de los bloques
// configurables y su editor admin (alta/orden/edición de bloques tipo
// texto/imagen/separador/destacado/estadística).
// =========================================================

import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { uploadImageToStorage } from '../core/storage.js';
import { cloneData, copyEditorPayload, escapeHtml, getEditorPayload, hasEditorPayload, showToast } from '../core/utils.js';
import { openMediaPicker } from './media-library.js';
import { appendActionGrid, openContextPanel } from '../core/context-actions.js';

const ABOUT_BLOCK_KINDS = {
  heading:   { label: '🔤 Título',     icon: '🔤' },
  text:      { label: '📝 Texto',      icon: '📝' },
  image:     { label: '🖼 Imagen',     icon: '🖼' },
  divider:   { label: '➖ Separador',  icon: '➖' },
  highlight: { label: '✨ Destacado',  icon: '✨' },
  statistic: { label: '📊 Estadística', icon: '📊' },
};



function createAboutTask(label = '') {
  const id = globalThis.crypto?.randomUUID?.() || `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return { id, label: String(label || ''), done: false };
}

function normalizeAboutTask(task) {
  if (typeof task === 'string') return createAboutTask(task);
  const source = task && typeof task === 'object' ? task : {};
  return {
    id: String(source.id || createAboutTask().id),
    label: String(source.label ?? source.name ?? ''),
    done: Boolean(source.done ?? source.completed ?? false),
  };
}

function normalizeAboutBlock(block) {
  const source = block && typeof block === 'object' ? cloneData(block) : { kind: 'text', content: '' };
  if (source.kind === 'statistic') {
    source.title = String(source.title ?? source.content ?? '');
    source.tasks = Array.isArray(source.tasks) ? source.tasks.map(normalizeAboutTask) : [];
    delete source.content;
  }
  return source;
}

function getStatisticProgress(block) {
  const tasks = Array.isArray(block?.tasks) ? block.tasks.map(normalizeAboutTask) : [];
  const completed = tasks.reduce((total, task) => total + (task.done ? 1 : 0), 0);
  const total = tasks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  return { tasks, completed, total, percentage };
}

function renderStatisticPublicBlock(block, blockIndex) {
  const title = String(block?.title || '').trim() || 'Progreso del servidor';
  const { tasks, completed, total, percentage } = getStatisticProgress(block);
  const taskStep = total > 0 ? 100 / total : 0;
  const taskList = tasks.length
    ? `<ul class="about-stat-task-list">${tasks.map(task => `
        <li class="about-stat-task${task.done ? ' is-done' : ''}">
          <span class="about-stat-task-state" aria-hidden="true">${task.done ? '✓' : ''}</span>
          <span class="about-stat-task-label">${escapeHtml(task.label || 'Tarea sin nombre')}</span>
        </li>`).join('')}</ul>`
    : '<p class="about-stat-empty">Todavía no hay tareas en esta estadística.</p>';

  return `<section class="about-stat-card" data-about-block-index="${blockIndex}">
    <div class="about-stat-header">
      <div>
        <span class="about-stat-eyebrow">📊 ESTADÍSTICA</span>
        <h3 class="about-stat-title">${escapeHtml(title)}</h3>
      </div>
      <strong class="about-stat-percent">${percentage}%</strong>
    </div>
    <div class="about-stat-progress" role="progressbar" aria-label="${escapeHtml(title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percentage}">
      <span class="about-stat-progress-fill" style="width:${percentage}%"></span>
    </div>
    <div class="about-stat-meta">
      <span>${completed} de ${total} ${total === 1 ? 'tarea completada' : 'tareas completadas'}</span>
      ${total > 0 ? `<span>Cada tarea aporta ${taskStep.toFixed(taskStep % 1 === 0 ? 0 : 1)}%</span>` : ''}
    </div>
    ${taskList}
  </section>`;
}

function renderStatisticEditorBlock(block, idx, btns, metaLabel) {
  const normalized = normalizeAboutBlock(block);
  state.aboutEditorBlocks[idx] = normalized;
  const { tasks, completed, total, percentage } = getStatisticProgress(normalized);
  const increment = total > 0 ? 100 / total : 0;
  const rows = tasks.length ? tasks.map((task, taskIndex) => `
    <div class="about-stat-task-editor${task.done ? ' is-done' : ''}" data-task-index="${taskIndex}">
      <label class="about-stat-check" title="Marcar como completada">
        <input type="checkbox" class="about-stat-task-done" data-idx="${idx}" data-task-index="${taskIndex}" ${task.done ? 'checked' : ''} />
        <span aria-hidden="true"></span>
      </label>
      <input type="text" class="modal-input about-stat-task-label-input" data-idx="${idx}" data-task-index="${taskIndex}" value="${escapeHtml(task.label)}" placeholder="Nombre de la tarea" />
      <button type="button" class="about-stat-task-delete" data-idx="${idx}" data-task-index="${taskIndex}" aria-label="Eliminar tarea">✕</button>
    </div>`).join('') : '<p class="about-stat-editor-empty">Agregá una tarea para comenzar a calcular el progreso.</p>';

  return `<div class="about-editor-block about-editor-statistic" data-idx="${idx}">
    <div class="about-editor-block-body">
      <span class="about-editor-block-kind">${metaLabel}</span>
      <input type="text" class="modal-input about-stat-title-input" data-idx="${idx}" value="${escapeHtml(normalized.title || '')}" placeholder="Nombre de la barra, por ejemplo: Desarrollo del evento" />
      <div class="about-stat-editor-preview">
        <div class="about-stat-editor-preview-head"><span>${completed}/${total} completadas</span><strong>${percentage}%</strong></div>
        <div class="about-stat-progress"><span class="about-stat-progress-fill" style="width:${percentage}%"></span></div>
        <small>${total > 0 ? `Cada tarea completada suma ${increment.toFixed(increment % 1 === 0 ? 0 : 1)}%.` : 'El porcentaje se calcula automáticamente según la cantidad de tareas.'}</small>
      </div>
      <div class="about-stat-tasks-editor">${rows}</div>
      <button type="button" class="btn-secondary-admin about-stat-add-task" data-idx="${idx}">＋ Agregar tarea</button>
      <p class="about-stat-admin-note">Solo un administrador puede cambiar el estado de las tareas desde este editor.</p>
    </div>
    ${btns}
  </div>`;
}

function aboutBlockActions(idx) {
  return `<div class="about-editor-block-actions">
      <button type="button" class="context-menu-trigger about-block-context" data-idx="${idx}">⋯ Acciones</button>
    </div>`;
}


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
  container.innerHTML = blocks.map((block, blockIndex) => {
    switch (block.kind) {
      case 'heading':   return `<h2 class="about-block-heading" data-about-block-index="${blockIndex}">${escapeHtml(block.content || '')}</h2>`;
      case 'text':      return `<p class="about-block-text" data-about-block-index="${blockIndex}">${escapeHtml(block.content || '')}</p>`;
      case 'highlight': return `<div class="about-block-highlight" data-about-block-index="${blockIndex}">${escapeHtml(block.content || '')}</div>`;
      case 'divider':   return `<hr class="about-block-divider" data-about-block-index="${blockIndex}" />`;
      case 'statistic': return renderStatisticPublicBlock(block, blockIndex);
      case 'image': {
        const safe = (block.url || '').replace(/['"\\]/g, '');
        if (!safe) return '';
        return `<figure class="about-block-figure" data-about-block-index="${blockIndex}"><img class="about-block-image" src="${escapeHtml(safe)}" alt="${escapeHtml(block.caption || '')}" loading="lazy" />` +
               (block.caption ? `<figcaption class="about-block-image-caption">${escapeHtml(block.caption)}</figcaption>` : '') + `</figure>`;
      }
      default: return '';
    }
  }).join('');
}


function openAboutEditor() {
  state.aboutEditorBlocks = (state.aboutBlocks || []).map(normalizeAboutBlock);
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
  const meta = (b) => ({ heading:'🔤 Título', text:'📝 Texto', image:'🖼 Imagen', divider:'➖ Separador', highlight:'✨ Destacado', statistic:'📊 Estadística' }[b.kind] || b.kind);
  container.innerHTML = state.aboutEditorBlocks.map((block, idx) => {
    const first = idx === 0, last = idx === state.aboutEditorBlocks.length - 1;
    const btns = aboutBlockActions(idx);
    if (block.kind === 'statistic') return renderStatisticEditorBlock(block, idx, btns, meta(block));
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
  container.querySelectorAll('.about-stat-title-input').forEach(input => {
    input.addEventListener('input', (event) => {
      const idx = Number(event.currentTarget.dataset.idx);
      if (!state.aboutEditorBlocks[idx]) return;
      state.aboutEditorBlocks[idx].title = event.currentTarget.value;
    });
  });
  container.querySelectorAll('.about-stat-task-label-input').forEach(input => {
    input.addEventListener('input', (event) => {
      const idx = Number(event.currentTarget.dataset.idx);
      const taskIndex = Number(event.currentTarget.dataset.taskIndex);
      const task = state.aboutEditorBlocks[idx]?.tasks?.[taskIndex];
      if (task) task.label = event.currentTarget.value;
    });
  });
  container.querySelectorAll('.about-stat-task-done').forEach(input => {
    input.addEventListener('change', (event) => {
      const idx = Number(event.currentTarget.dataset.idx);
      const taskIndex = Number(event.currentTarget.dataset.taskIndex);
      const task = state.aboutEditorBlocks[idx]?.tasks?.[taskIndex];
      if (!task) return;
      task.done = event.currentTarget.checked;
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.about-stat-task-delete').forEach(button => {
    button.addEventListener('click', () => {
      const idx = Number(button.dataset.idx);
      const taskIndex = Number(button.dataset.taskIndex);
      state.aboutEditorBlocks[idx]?.tasks?.splice(taskIndex, 1);
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.about-stat-add-task').forEach(button => {
    button.addEventListener('click', () => {
      const idx = Number(button.dataset.idx);
      const block = state.aboutEditorBlocks[idx];
      if (!block) return;
      if (!Array.isArray(block.tasks)) block.tasks = [];
      block.tasks.push(createAboutTask());
      renderAboutEditorBlocks();
      requestAnimationFrame(() => {
        const inputs = container.querySelectorAll(`.about-stat-task-label-input[data-idx="${idx}"]`);
        const last = inputs[inputs.length - 1];
        last?.focus();
        last?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    });
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
  container.querySelectorAll('.about-block-context').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      const block = state.aboutEditorBlocks[idx];
      if (!block) return;
      openContextPanel({
        anchor: btn,
        title: 'Acciones del bloque',
        subtitle: ABOUT_BLOCK_KINDS[block.kind]?.label || block.kind,
        width: 330,
        build(root, close) {
          appendActionGrid(root, [
            { label: 'Subir', icon: '▲', disabled: idx === 0, onClick: () => {
              if (idx <= 0) return;
              [state.aboutEditorBlocks[idx - 1], state.aboutEditorBlocks[idx]] = [state.aboutEditorBlocks[idx], state.aboutEditorBlocks[idx - 1]];
              close(); renderAboutEditorBlocks();
            } },
            { label: 'Bajar', icon: '▼', disabled: idx >= state.aboutEditorBlocks.length - 1, onClick: () => {
              if (idx >= state.aboutEditorBlocks.length - 1) return;
              [state.aboutEditorBlocks[idx + 1], state.aboutEditorBlocks[idx]] = [state.aboutEditorBlocks[idx], state.aboutEditorBlocks[idx + 1]];
              close(); renderAboutEditorBlocks();
            } },
            { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('about-block', block) },
            { label: 'Pegar', icon: '↧', disabled: !hasEditorPayload('about-block'), onClick: () => {
              const payload = getEditorPayload('about-block'); if (!payload) return;
              state.aboutEditorBlocks[idx] = cloneData(payload); close(); renderAboutEditorBlocks();
            } },
            { label: 'Duplicar', icon: '⧉', onClick: () => {
              state.aboutEditorBlocks.splice(idx + 1, 0, cloneData(block)); close(); renderAboutEditorBlocks();
            } },
            { label: 'Eliminar', icon: '🗑', tone: 'danger', onClick: () => {
              state.aboutEditorBlocks.splice(idx, 1); close(); renderAboutEditorBlocks();
            } },
          ]);
        },
      });
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
  container.querySelectorAll('.duplicate-about-block').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      state.aboutEditorBlocks.splice(idx + 1, 0, cloneData(state.aboutEditorBlocks[idx]));
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.copy-about-block').forEach(btn => {
    btn.addEventListener('click', () => {
      copyEditorPayload('about-block', state.aboutEditorBlocks[Number(btn.dataset.idx)]);
      renderAboutEditorBlocks();
    });
  });
  container.querySelectorAll('.paste-about-block').forEach(btn => {
    btn.addEventListener('click', () => {
      const payload = getEditorPayload('about-block');
      if (!payload) return;
      state.aboutEditorBlocks[Number(btn.dataset.idx)] = cloneData(payload);
      renderAboutEditorBlocks();
    });
  });
}


function addAboutBlock(kind) {
  const block = { kind };
  if (kind === 'image') { block.url = ''; block.caption = ''; }
  else if (kind === 'statistic') { block.title = ''; block.tasks = []; }
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
  state.aboutEditorBlocks = state.aboutEditorBlocks.map(normalizeAboutBlock);
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

// =========================================================
// categories.js
// =========================================================
// CRUD de categorías dinámicas de logs: carga, filtros, selects, panel
// de gestión admin y alta/baja.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { getCategory, state } from '../core/state.js';
import { confirmAction, escapeHtml, showToast, withTimeout } from '../core/utils.js';

let onCategoryFiltersChanged = () => {};
let categoriesLoadPromise = null;
let editingCategorySlug = null;

export function setCategoryFiltersChangedHandler(handler) {
  onCategoryFiltersChanged = typeof handler === 'function' ? handler : () => {};
}

export async function loadCategories() {
  const ok = await loadCategoriesData();
  if (!ok) return false;
  renderCategoryFilters();
  renderCategorySelectOptions();
  renderCategoryManageList();
  return true;
}

async function performCategoriesLoad() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7500);
  try {
    let request = supabaseClient.from('categories')
      .select('slug,label,emoji,color,created_at')
      .order('created_at', { ascending: true });
    request = disableQueryRetry(request);
    if (typeof request?.abortSignal === 'function') request = request.abortSignal(controller.signal);
    const { data, error } = await withTimeout(request, 8000, 'La carga de categorías');
    if (error) { console.error(error); showToast('No se pudieron cargar las categorías', 'error'); return false; }
    state.categories = data || [];
    return true;
  } catch (error) {
    if (error?.name !== 'AbortError') console.error('[Categories]', error);
    showToast('La carga de categorías tardó demasiado', 'error');
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export function loadCategoriesData() {
  if (!categoriesLoadPromise) {
    categoriesLoadPromise = performCategoriesLoad().finally(() => { categoriesLoadPromise = null; });
  }
  return categoriesLoadPromise;
}


function renderCategoryFilters() {
  const container = document.getElementById('category-filters');
  if (!container) return;
  const allPill = container.querySelector('[data-filter="all"]');
  if (!allPill) return;
  container.innerHTML = '';
  container.appendChild(allPill);
  state.categories.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'pill' + (state.activeFilter === cat.slug ? ' is-active' : '');
    pill.dataset.filter = cat.slug;
    pill.textContent = `${cat.emoji} ${cat.label}`;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.activeFilter === 'all');
  container.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      state.activeFilter = pill.dataset.filter;
      state.logsPage = 1;
      onCategoryFiltersChanged();
    });
  });
}


export function renderCategorySelectOptions() {
  const select = document.getElementById('log-category-input');
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = state.categories.map(cat => `<option value="${cat.slug}">${cat.emoji} ${cat.label}</option>`).join('');
  if (currentValue && state.categories.some(c => c.slug === currentValue)) select.value = currentValue;
}


function syncCategoryEditorMode() {
  const title = document.getElementById('category-modal-title');
  const submit = document.getElementById('submit-category-btn');
  const cancel = document.getElementById('cancel-category-edit-btn');
  const editing = !!editingCategorySlug;
  if (title) title.textContent = editing ? '✎ EDITAR CATEGORÍA' : '🏷 NUEVA CATEGORÍA';
  if (submit) submit.textContent = editing ? 'Guardar categoría' : 'Crear categoría';
  cancel?.classList.toggle('hidden', !editing);
}

function resetCategoryEditor({ keepModal = true } = {}) {
  editingCategorySlug = null;
  const label = document.getElementById('category-label-input');
  const emoji = document.getElementById('category-emoji-input');
  const color = document.getElementById('category-color-input');
  const error = document.getElementById('category-modal-error');
  if (label) label.value = '';
  if (emoji) emoji.value = '📦';
  if (color) color.value = '#4dd4e8';
  error?.classList.add('hidden');
  syncCategoryEditorMode();
  if (keepModal) renderCategoryManageList();
}

function startCategoryEdit(slug) {
  const category = state.categories.find(item => item.slug === slug);
  if (!category) return;
  editingCategorySlug = slug;
  document.getElementById('category-label-input').value = category.label || '';
  document.getElementById('category-emoji-input').value = category.emoji || '📦';
  document.getElementById('category-color-input').value = category.color || '#4dd4e8';
  document.getElementById('category-modal-error')?.classList.add('hidden');
  syncCategoryEditorMode();
  renderCategoryManageList();
  document.getElementById('category-label-input')?.focus({ preventScroll: true });
}

function renderCategoryManageList() {
  const container = document.getElementById('category-manage-list');
  if (!container) return;
  if (state.categories.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`; return; }
  container.innerHTML = state.categories.map(cat => `
    <div class="category-manage-row${editingCategorySlug === cat.slug ? ' is-editing' : ''}">
      <span class="category-manage-label"><span class="category-manage-dot" style="background:${escapeHtml(cat.color || '#9a92b8')}"></span>${escapeHtml(cat.emoji || '📦')} ${escapeHtml(cat.label)}</span>
      <span class="category-manage-actions">
        <button type="button" class="category-manage-edit" data-slug="${escapeHtml(cat.slug)}">✎ Editar</button>
        <button type="button" class="category-manage-delete" data-slug="${escapeHtml(cat.slug)}">🗑 Borrar</button>
      </span>
    </div>
  `).join('');
  container.querySelectorAll('.category-manage-edit').forEach(btn => {
    btn.addEventListener('click', () => startCategoryEdit(btn.dataset.slug));
  });
  container.querySelectorAll('.category-manage-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.slug));
  });
}


export function openNewCategoryModal() {
  resetCategoryEditor({ keepModal: false });
  renderCategoryManageList();
  const cancel = document.getElementById('cancel-category-edit-btn');
  if (cancel && cancel.dataset.bound !== 'true') {
    cancel.dataset.bound = 'true';
    cancel.addEventListener('click', () => resetCategoryEditor());
  }
  document.getElementById('category-modal').classList.remove('hidden');
}


export async function submitCategory() {
  const errorBox = document.getElementById('category-modal-error');
  const label = document.getElementById('category-label-input').value.trim();
  const emoji = document.getElementById('category-emoji-input').value.trim() || '📦';
  const color = document.getElementById('category-color-input').value || '#4dd4e8';
  if (!label) { errorBox.textContent = 'Ponle un nombre a la categoría.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminMode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }

  const wasEditing = !!editingCategorySlug;
  const rpcName = wasEditing ? 'update_category' : 'create_category';
  const payload = wasEditing
    ? { input_code: state.adminMode, input_slug: editingCategorySlug, input_label: label, input_emoji: emoji, input_color: color }
    : { input_code: state.adminMode, input_slug: '', input_label: label, input_emoji: emoji, input_color: color };
  const { data, error } = await supabaseClient.rpc(rpcName, payload);
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }

  errorBox.classList.add('hidden');
  const selectedSlug = data?.slug || editingCategorySlug;
  showToast(wasEditing ? `Categoría "${label}" actualizada` : `Categoría "${data.label}" creada`, 'success');
  editingCategorySlug = null;
  await loadCategories();
  resetCategoryEditor({ keepModal: false });
  renderCategoryManageList();
  if (selectedSlug) document.getElementById('log-category-input').value = selectedSlug;
  onCategoryFiltersChanged();
}


async function deleteCategory(slug) {
  const cat = getCategory(slug);
  if (!(await confirmAction({
    title: 'Borrar categoría',
    message: `Borrar la categoría "${cat.label}". Solo funcionará si ningún log la está usando.`,
    confirmLabel: 'Borrar categoría',
    danger: true,
  }))) return;
  if (!state.adminMode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_category', { input_code: state.adminMode, input_slug: slug });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast(`Categoría "${cat.label}" eliminada`, 'success');
  if (state.activeFilter === slug) state.activeFilter = 'all';
  await loadCategories();
  onCategoryFiltersChanged();
}

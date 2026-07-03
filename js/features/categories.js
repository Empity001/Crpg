// =========================================================
// categories.js
// =========================================================
// CRUD de categorías dinámicas de logs: carga, filtros, selects, panel
// de gestión admin y alta/baja.
// =========================================================

import { supabaseClient } from '../config.js';
import { getCategory, state } from '../core/state.js';
import { confirmAction, escapeHtml, showToast } from '../core/utils.js';

let onCategoryFiltersChanged = () => {};

export function setCategoryFiltersChangedHandler(handler) {
  onCategoryFiltersChanged = typeof handler === 'function' ? handler : () => {};
}

export async function loadCategories() {
  const ok = await loadCategoriesData();
  if (!ok) return;
  renderCategoryFilters();
  renderCategorySelectOptions();
  renderCategoryManageList();
}

export async function loadCategoriesData() {
  const { data, error } = await supabaseClient.from('categories').select('slug,label,emoji,color,created_at').order('created_at', { ascending: true });
  if (error) { console.error(error); showToast('No se pudieron cargar las categorías', 'error'); return false; }
  state.categories = data || [];
  return true;
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


function renderCategoryManageList() {
  const container = document.getElementById('category-manage-list');
  if (!container) return;
  if (state.categories.length === 0) { container.innerHTML = `<p class="category-manage-empty">No hay categorías todavía.</p>`; return; }
  container.innerHTML = state.categories.map(cat => `
    <div class="category-manage-row">
      <span class="category-manage-label">${cat.emoji} ${escapeHtml(cat.label)}</span>
      <button type="button" class="category-manage-delete" data-slug="${cat.slug}">🗑 Borrar</button>
    </div>
  `).join('');
  container.querySelectorAll('.category-manage-delete').forEach(btn => {
    btn.addEventListener('click', () => deleteCategory(btn.dataset.slug));
  });
}


export function openNewCategoryModal() {
  document.getElementById('category-label-input').value = '';
  document.getElementById('category-emoji-input').value = '📦';
  document.getElementById('category-color-input').value = '#4dd4e8';
  document.getElementById('category-modal-error').classList.add('hidden');
  renderCategoryManageList();
  document.getElementById('category-modal').classList.remove('hidden');
}


export async function submitCategory() {
  const errorBox = document.getElementById('category-modal-error');
  const label = document.getElementById('category-label-input').value.trim();
  const emoji = document.getElementById('category-emoji-input').value.trim() || '📦';
  const color = document.getElementById('category-color-input').value || '#4dd4e8';
  if (!label) { errorBox.textContent = 'Ponle un nombre a la categoría.'; errorBox.classList.remove('hidden'); return; }
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const { data, error } = await supabaseClient.rpc('create_category', { input_code: state.adminCode, input_slug: '', input_label: label, input_emoji: emoji, input_color: color });
  if (error) { errorBox.textContent = 'Error: ' + error.message; errorBox.classList.remove('hidden'); return; }
  errorBox.classList.add('hidden');
  document.getElementById('category-label-input').value = '';
  showToast(`Categoría "${data.label}" creada`, 'success');
  await loadCategories();
  document.getElementById('log-category-input').value = data.slug;
}


async function deleteCategory(slug) {
  const cat = getCategory(slug);
  if (!(await confirmAction({
    title: 'Borrar categoría',
    message: `Borrar la categoría "${cat.label}". Solo funcionará si ningún log la está usando.`,
    confirmLabel: 'Borrar categoría',
    danger: true,
  }))) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_category', { input_code: state.adminCode, input_slug: slug });
  if (error) { showToast(error.message.replace(/^.*?:\s*/, '') || 'No se pudo borrar', 'error'); return; }
  showToast(`Categoría "${cat.label}" eliminada`, 'success');
  if (state.activeFilter === slug) state.activeFilter = 'all';
  await loadCategories();
  onCategoryFiltersChanged();
}

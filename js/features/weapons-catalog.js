// =========================================================
// weapons-catalog.js
// =========================================================
// Catálogo público de armas: filtros por búsqueda/categoría/tipo y
// render de la grilla de tarjetas.
// =========================================================

import { isAdmin, state } from '../core/state.js';
import { initialsOf } from './tierlist.js';
import { escapeHtml, safeUrl } from '../core/utils.js';
import { openWeaponDetail } from './weapons-detail.js';
import { getWeaponCategory, getWeaponType, isWeaponVisible } from './weapons-state.js';

function weaponMatchesFilters(w) {
  if (!isWeaponVisible(w)) return false;
  if (state.weaponActiveCategoryFilter !== 'all' && (w.category_id || '') !== state.weaponActiveCategoryFilter) return false;
  if (state.weaponActiveTypeFilter !== 'all' && (w.type_id || '') !== state.weaponActiveTypeFilter) return false;
  if (state.weaponSearchTerm) {
    if (!w.name.toLowerCase().includes(state.weaponSearchTerm.toLowerCase())) return false;
  }
  return true;
}

function bindWeaponCategoryFilterEvents(container) {
  if (container.dataset.weaponCategoryFilterBound === 'true') return;
  container.dataset.weaponCategoryFilterBound = 'true';
  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const pill = target?.closest('.pill[data-wcat]');
    if (!pill || !container.contains(pill)) return;
    state.weaponActiveCategoryFilter = pill.dataset.wcat;
    renderWeaponCategoryFilters();
    renderWeaponsGrid();
  });
}

function bindWeaponTypeFilterEvents(container) {
  if (container.dataset.weaponTypeFilterBound === 'true') return;
  container.dataset.weaponTypeFilterBound = 'true';
  container.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const pill = target?.closest('.pill[data-wtype]');
    if (!pill || !container.contains(pill)) return;
    state.weaponActiveTypeFilter = pill.dataset.wtype;
    renderWeaponTypeFilters();
    renderWeaponsGrid();
  });
}

function bindWeaponsGridEvents(grid) {
  if (grid.dataset.weaponGridBound === 'true') return;
  grid.dataset.weaponGridBound = 'true';
  grid.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest('.weapon-card[data-weapon-id]');
    if (!card || !grid.contains(card)) return;
    openWeaponDetail(card.dataset.weaponId);
  });
}


export function renderWeaponCategoryFilters() {
  const container = document.getElementById('weapon-category-filters');
  const allPill = container.querySelector('[data-wcat="all"]');
  container.innerHTML = '';
  container.appendChild(allPill);
  state.weaponCategories.forEach(cat => {
    const pill = document.createElement('button');
    const active = state.weaponActiveCategoryFilter === cat.id;
    pill.className = 'pill' + (active ? ' is-active' : '');
    pill.dataset.wcat = cat.id;
    pill.style.borderColor = cat.color;
    if (active) { pill.style.background = cat.color; pill.style.color = '#0c0a14'; }
    else { pill.style.color = cat.color; }
    pill.textContent = cat.label;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.weaponActiveCategoryFilter === 'all');
  bindWeaponCategoryFilterEvents(container);
}


export function renderWeaponTypeFilters() {
  const container = document.getElementById('weapon-type-filters');
  const allPill = container.querySelector('[data-wtype="all"]');
  container.innerHTML = '';
  container.appendChild(allPill);
  state.weaponTypes.forEach(t => {
    const pill = document.createElement('button');
    pill.className = 'pill' + (state.weaponActiveTypeFilter === t.id ? ' is-active' : '');
    pill.dataset.wtype = t.id;
    pill.textContent = t.label;
    container.appendChild(pill);
  });
  allPill.classList.toggle('is-active', state.weaponActiveTypeFilter === 'all');
  bindWeaponTypeFilterEvents(container);
}

// ---------------------------------------------------------
// GRID DE CATÁLOGO
// ---------------------------------------------------------

export function renderWeaponsGrid() {
  const grid = document.getElementById('weapons-grid');
  if (!grid) return;
  const list = state.weapons.filter(weaponMatchesFilters).sort((a, b) => a.name.localeCompare(b.name, 'es'));

  if (list.length === 0) {
    grid.innerHTML = `<div class="weapons-empty"><p>No hay armas que coincidan con la búsqueda/filtros.${isAdmin() ? ' Crea la primera con "+ Nueva arma".' : ''}</p></div>`;
    return;
  }

  grid.innerHTML = list.map(w => {
    const cat = getWeaponCategory(w.category_id);
    const safe = safeUrl(w.image_url);
    const type = getWeaponType(w.type_id);
    const thumb = safe
      ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(w.name)}" class="pixel-art" />`
      : `<span class="tier-chip-initials">${escapeHtml(initialsOf(w.name))}</span>`;
    return `
      <div class="weapon-card ${!w.published ? 'is-unpublished' : ''}" data-weapon-id="${w.id}">
        ${!w.published ? '<span class="weapon-unpublished-tag">Oculta</span>' : ''}
        <div class="weapon-card-thumb">${thumb}</div>
        <p class="weapon-card-name">${escapeHtml(w.name)}</p>
        <div class="weapon-card-badges">
          ${cat ? `<span class="weapon-cat-dot" style="background:${cat.color};"></span>` : ''}
          ${type ? `<span class="weapon-card-type">${escapeHtml(type.label)}</span>` : ''}
        </div>
      </div>`;
  }).join('');

  bindWeaponsGridEvents(grid);
}

// =========================================================
// weapons-detail.js
// =========================================================
// Vista de detalle de un arma: render de rango activo, habilidades,
// receta de mejora, secciones extra, y el guardado parcial de un rango
// (saveRankPatch).
// =========================================================

import { supabaseClient } from '../config.js';
import { renderKeyValueRows } from './blocks-display.js';
import { isAdmin, state } from '../core/state.js';
import { asArray, escapeHtml, safeUrl } from '../core/utils.js';
import { deleteAbility, deleteSection, deleteWeaponAction, deleteWeaponRank, openWeaponAbilityModal, openWeaponModal, openWeaponRankModal, openWeaponRecipeModal, openWeaponSectionModal, openWeaponStatsModal, toggleWeaponPublished } from './weapons-admin.js';
import { getCurrentWeapon, getWeaponCategory, getWeaponRanks, getWeaponType } from './weapons-state.js';

export function openWeaponDetail(weaponId) {
  state.currentWeaponId = weaponId;
  const ranks = getWeaponRanks(weaponId);
  state.currentWeaponRankId = ranks[0] ? ranks[0].id : null;
  document.getElementById('weapons-catalog-view').classList.add('hidden');
  document.getElementById('weapon-detail-view').classList.remove('hidden');
  renderWeaponDetail();
}


export function closeWeaponDetail() {
  document.getElementById('weapon-detail-view').classList.add('hidden');
  document.getElementById('weapons-catalog-view').classList.remove('hidden');
  state.currentWeaponId = null;
  state.currentWeaponRankId = null;
}


export function renderWeaponDetail() {
  const weapon = getCurrentWeapon();
  const container = document.getElementById('weapon-detail-content');
  if (!weapon) {
    container.innerHTML = `<p class="comments-empty">Esta arma ya no existe.</p>`;
    return;
  }

  const ranks = getWeaponRanks(weapon.id);
  if (!state.currentWeaponRankId || !ranks.some(r => r.id === state.currentWeaponRankId)) {
    state.currentWeaponRankId = ranks[0] ? ranks[0].id : null;
  }
  const rank = ranks.find(r => r.id === state.currentWeaponRankId) || null;

  const cat = getWeaponCategory(weapon.category_id);
  const type = getWeaponType(weapon.type_id);
  const safeImg = safeUrl((rank && rank.image_url) || weapon.image_url);
  const admin = isAdmin();

  const headerHtml = `
    <div class="weapon-detail-header">
      ${safeImg
        ? `<img src="${escapeHtml(safeImg)}" alt="${escapeHtml(weapon.name)}" class="weapon-detail-image pixel-art js-open-asset" data-asset-src="${escapeHtml(safeImg)}" data-asset-title="${escapeHtml(weapon.name)}" />`
        : `<div class="weapon-detail-image"></div>`}
      <div class="weapon-detail-headinfo">
        <h2 class="weapon-detail-name">${escapeHtml(weapon.name)}</h2>
        <div class="weapon-detail-badges">
          ${!weapon.published ? '<span class="weapon-unpublished-tag" style="position:static;">Oculta</span>' : ''}
          ${cat ? `<span class="weapon-cat-badge" style="border-color:${cat.color};color:${cat.color};">${escapeHtml(cat.label)}</span>` : ''}
          ${type ? `<span class="weapon-type-badge">${escapeHtml(type.label)}</span>` : ''}
        </div>
      </div>
      ${admin ? `
        <div class="weapon-detail-admin-actions">
          <button type="button" class="btn-secondary-admin" data-action="edit-weapon-info">✏️ Editar info</button>
          <button type="button" class="btn-secondary-admin" data-action="toggle-weapon-published">${weapon.published ? '🙈 Despublicar' : '👁 Publicar'}</button>
          <button type="button" class="btn-secondary-admin danger" data-action="delete-weapon">🗑 Borrar arma</button>
        </div>` : ''}
    </div>`;

  const rankSelectorHtml = `
    <div class="weapon-rank-selector">
      ${ranks.map(r => `
        <div class="weapon-rank-pill-wrap">
          <button type="button" class="pill ${rank && r.id === rank.id ? 'is-active' : ''}" data-action="select-rank" data-rank-id="${r.id}">${escapeHtml(r.name)}</button>
          ${admin ? `<button type="button" class="weapon-rank-admin-mini danger" data-action="delete-rank" data-rank-id="${r.id}" title="Borrar rango">✕</button>` : ''}
        </div>`).join('')}
      ${admin ? `<button type="button" class="pill" data-action="add-rank">+ Rango</button>` : ''}
    </div>`;

  const bodyHtml = rank
    ? renderWeaponRankBody(weapon, rank, admin)
    : `<p class="comments-empty">${admin ? 'Esta arma no tiene rangos todavía. Agrega el primero con "+ Rango".' : 'Esta arma no tiene información todavía.'}</p>`;

  container.innerHTML = headerHtml + rankSelectorHtml + bodyHtml;
  bindWeaponDetailEvents(container);
}


function renderWeaponRankBody(weapon, rank, admin) {
  let html = '';

  // ---- Descripción del rango ----
  html += `
    <div class="weapon-section-block">
      <div class="weapon-section-head">
        <h3 class="weapon-section-title">📈 ${escapeHtml(rank.name)}</h3>
        ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-rank-info" data-rank-id="${rank.id}">✏️ Editar rango</button></div>` : ''}
      </div>
      ${rank.description ? `<p class="weapon-rank-desc">${escapeHtml(rank.description)}</p>` : (admin ? '<p class="comments-empty">Sin descripción todavía.</p>' : '')}
    </div>`;

  // ---- Estadísticas ----
  const stats = asArray(rank.stats);
  if (stats.length > 0 || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">📊 Estadísticas</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-stats" data-rank-id="${rank.id}">✏️ Editar</button></div>` : ''}
        </div>
        ${stats.length > 0 ? `<div class="weapon-stats-grid">${stats.map(s => `
          <div class="stat-row">
            <span class="stat-row-label">${escapeHtml(s.key)}</span>
            <div class="bar-track"><div class="bar-fill bar-stat" style="width:100%"></div></div>
            <span class="stat-row-value" style="width:auto;">${escapeHtml(String(s.value ?? ''))}</span>
          </div>`).join('')}</div>` : '<p class="comments-empty">Sin estadísticas todavía.</p>'}
      </div>`;
  }

  // ---- Habilidades ----
  const abilities = asArray(rank.abilities);
  if (abilities.length > 0 || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">✨ Habilidades</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="add-ability" data-rank-id="${rank.id}">+ Habilidad</button></div>` : ''}
        </div>
        ${abilities.length > 0
          ? `<div class="weapon-abilities-list">${abilities.map((ab, idx) => renderAbilityCard(ab, idx, rank.id, admin)).join('')}</div>`
          : '<p class="comments-empty">Sin habilidades todavía.</p>'}
      </div>`;
  }

  // ---- Receta de mejora ----
  const recipe = rank.upgrade_recipe;
  if (recipe || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">🔁 Mejora</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-recipe" data-rank-id="${rank.id}">✏️ Editar receta</button></div>` : ''}
        </div>
        ${recipe ? renderRecipeTrade(recipe) : '<p class="comments-empty">Este rango no tiene receta de mejora configurada.</p>'}
      </div>`;
  }

  // ---- Secciones extra (futuro: curiosidades, notas, builds...) ----
  const sections = asArray(rank.extra_sections);
  sections.forEach((sec, idx) => {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">${escapeHtml(sec.title)}</h3>
          ${admin ? `<div class="weapon-section-admin-actions">
            <button type="button" class="btn-secondary-admin" data-action="edit-section" data-rank-id="${rank.id}" data-section-idx="${idx}">✏️</button>
            <button type="button" class="btn-secondary-admin danger" data-action="delete-section" data-rank-id="${rank.id}" data-section-idx="${idx}">🗑</button>
          </div>` : ''}
        </div>
        ${sec.kind === 'keyvalue'
          ? `<div class="item-detail-grid">${renderKeyValueRows(asArray(sec.fields))}</div>`
          : `<p class="weapon-extra-text">${escapeHtml(sec.text || '')}</p>`}
      </div>`;
  });

  if (admin) {
    html += `<button type="button" class="link-btn" data-action="add-section" data-rank-id="${rank.id}">+ Agregar sección</button>`;
  }

  return html;
}


function renderAbilityCard(ab, idx, rankId, admin) {
  const level = ab.level ?? 0;
  const levelMax = ab.level_max ?? 10;
  const pct = levelMax > 0 ? Math.min(100, Math.max(0, Math.round((level / levelMax) * 100))) : 0;
  const statsHtml = asArray(ab.stats).map(s => `
    <div class="weapon-ability-stat-row"><span class="stat-label">${escapeHtml(s.key)}</span><span class="stat-value">${escapeHtml(String(s.value ?? ''))}</span></div>`).join('');
  return `
    <div class="weapon-ability-card">
      <div class="weapon-ability-head">
        <p class="weapon-ability-name">${escapeHtml(ab.name || 'Habilidad')}</p>
        ${ab.tag ? `<span class="weapon-ability-tag">${escapeHtml(ab.tag)}</span>` : ''}
        ${admin ? `<div class="weapon-ability-admin-actions">
          <button type="button" class="btn-secondary-admin" data-action="edit-ability" data-rank-id="${rankId}" data-ability-idx="${idx}">✏️</button>
          <button type="button" class="btn-secondary-admin danger" data-action="delete-ability" data-rank-id="${rankId}" data-ability-idx="${idx}">🗑</button>
        </div>` : ''}
      </div>
      ${ab.description ? `<p class="weapon-ability-desc">${escapeHtml(ab.description)}</p>` : ''}
      <div class="weapon-ability-level-row">
        <span class="weapon-ability-level-label">Nivel: ${escapeHtml(String(level))}${levelMax ? ' / ' + escapeHtml(String(levelMax)) : ''}</span>
        <div class="bar-track"><div class="bar-fill bar-level" style="width:${pct}%"></div></div>
      </div>
      ${statsHtml ? `<div class="weapon-ability-stats-grid">${statsHtml}</div>` : ''}
    </div>`;
}


function renderRecipeTrade(recipe) {
  const materials = asArray(recipe.materials);
  const result = recipe.result || {};
  const matsHtml = materials.map(m => {
    const safe = safeUrl(m.image_url);
    return `
      <div class="weapon-recipe-material">
        <div class="weapon-recipe-material-thumb">
          ${safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(m.name || '')}" class="js-open-asset" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(m.name || '')}" />` : ''}
          <span class="weapon-recipe-material-qty">×${escapeHtml(String(m.qty ?? 1))}</span>
        </div>
        <span class="weapon-recipe-material-name">${escapeHtml(m.name || '')}</span>
      </div>`;
  }).join('');
  const safeResult = safeUrl(result.image_url);
  return `
    <div class="weapon-recipe-trade">
      <div class="weapon-recipe-materials">${matsHtml || '<p class="comments-empty">Sin materiales.</p>'}</div>
      <span class="weapon-recipe-arrow">→</span>
      <div class="weapon-recipe-result">
        <div class="weapon-recipe-result-thumb">${safeResult ? `<img src="${escapeHtml(safeResult)}" alt="${escapeHtml(result.name || '')}" class="js-open-asset" data-asset-src="${escapeHtml(safeResult)}" data-asset-title="${escapeHtml(result.name || '')}" />` : ''}</div>
        <span class="weapon-recipe-result-name">${escapeHtml(result.name || '')}</span>
      </div>
    </div>`;
}


function bindWeaponDetailEvents(container) {
  container.querySelectorAll('[data-action="select-rank"]').forEach(btn =>
    btn.addEventListener('click', () => { state.currentWeaponRankId = btn.dataset.rankId; renderWeaponDetail(); }));
  container.querySelectorAll('[data-action="add-rank"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRankModal(null)));
  container.querySelectorAll('[data-action="delete-rank"]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteWeaponRank(btn.dataset.rankId); }));
  container.querySelectorAll('[data-action="edit-weapon-info"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponModal(state.currentWeaponId)));
  container.querySelectorAll('[data-action="toggle-weapon-published"]').forEach(btn =>
    btn.addEventListener('click', () => toggleWeaponPublished(state.currentWeaponId)));
  container.querySelectorAll('[data-action="delete-weapon"]').forEach(btn =>
    btn.addEventListener('click', () => deleteWeaponAction(state.currentWeaponId)));
  container.querySelectorAll('[data-action="edit-rank-info"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRankModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="edit-stats"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponStatsModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="add-ability"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponAbilityModal(btn.dataset.rankId, null)));
  container.querySelectorAll('[data-action="edit-ability"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponAbilityModal(btn.dataset.rankId, Number(btn.dataset.abilityIdx))));
  container.querySelectorAll('[data-action="delete-ability"]').forEach(btn =>
    btn.addEventListener('click', () => deleteAbility(btn.dataset.rankId, Number(btn.dataset.abilityIdx))));
  container.querySelectorAll('[data-action="edit-recipe"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponRecipeModal(btn.dataset.rankId)));
  container.querySelectorAll('[data-action="add-section"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponSectionModal(btn.dataset.rankId, null)));
  container.querySelectorAll('[data-action="edit-section"]').forEach(btn =>
    btn.addEventListener('click', () => openWeaponSectionModal(btn.dataset.rankId, Number(btn.dataset.sectionIdx))));
  container.querySelectorAll('[data-action="delete-section"]').forEach(btn =>
    btn.addEventListener('click', () => deleteSection(btn.dataset.rankId, Number(btn.dataset.sectionIdx))));
}

// Aplica un cambio parcial a un rango, conservando todo lo demás
// tal cual está — upsert_weapon_rank siempre reemplaza el rango
// completo (mismo patrón que update_log con mobs/items, o
// set_field_config con la config entera).

export async function saveRankPatch(rankId, patch) {
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return { error: { message: 'Este rango ya no existe' } };
  return supabaseClient.rpc('upsert_weapon_rank', {
    input_code: state.adminCode,
    input_id: rank.id,
    input_weapon_id: rank.weapon_id,
    input_name: rank.name,
    input_description: rank.description,
    input_image_url: rank.image_url,
    input_stats: rank.stats,
    input_abilities: rank.abilities,
    input_extra_sections: rank.extra_sections,
    input_upgrade_recipe: rank.upgrade_recipe,
    ...patch,
  });
}

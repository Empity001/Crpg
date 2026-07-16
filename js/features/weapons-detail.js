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
import { asArray, cloneData, copyEditorPayload, escapeHtml, getEditorPayload, hasEditorPayload, safeUrl, showToast } from '../core/utils.js';
import { appendActionGrid, openContextPanel } from '../core/context-actions.js';
import { guideLinkUrl } from './guide-links.js';
import { getGuideRelationsStatus, loadGuideRelations, renderGuideRelations } from './guide-relations.js';
import { getInfoVisuals, visibleRankSections } from './weapons-rank-extras.js';
import { getCurrentWeapon, getWeaponCategory, getWeaponRanks, getWeaponType, replaceWeaponRank } from './weapons-state.js';

function loadWeaponAdminActions() {
  return import('./weapons-admin.js');
}

function guideViewUrl(weaponId = null, rankId = null) {
  const url = new URL(window.location.href);
  url.hash = '';
  if (weaponId) url.searchParams.set('weapon', weaponId);
  else url.searchParams.delete('weapon');
  if (weaponId && rankId) url.searchParams.set('rank', rankId);
  else url.searchParams.delete('rank');
  return `${url.pathname.split('/').pop() || 'guides.html'}${url.search}`;
}

function writeGuideHistory(mode, weaponId = null, rankId = null, { fromCatalog = false } = {}) {
  if (mode === 'none') return;
  const method = mode === 'push' ? 'pushState' : 'replaceState';
  window.history[method]({
    ...(window.history.state || {}),
    culonesGuideView: weaponId ? 'detail' : 'catalog',
    culonesGuideFromCatalog: !!fromCatalog,
  }, '', guideViewUrl(weaponId, rankId));
}

export function openWeaponDetail(weaponId, { rankId = null, historyMode = 'push' } = {}) {
  const wasCatalog = !state.currentWeaponId;
  state.currentWeaponId = weaponId;
  const ranks = getWeaponRanks(weaponId);
  state.currentWeaponRankId = rankId && ranks.some(rank => rank.id === rankId)
    ? rankId
    : (ranks[0] ? ranks[0].id : null);
  writeGuideHistory(historyMode, weaponId, state.currentWeaponRankId, {
    fromCatalog: historyMode === 'push' && wasCatalog,
  });
  document.getElementById('weapons-catalog-view').classList.add('hidden');
  document.getElementById('weapon-detail-view').classList.remove('hidden');
  renderWeaponDetail();
}


export function closeWeaponDetail({ historyMode = 'replace' } = {}) {
  document.getElementById('weapon-detail-view').classList.add('hidden');
  document.getElementById('weapons-catalog-view').classList.remove('hidden');
  state.currentWeaponId = null;
  state.currentWeaponRankId = null;
  writeGuideHistory(historyMode, null, null);
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
          <button type="button" class="context-menu-trigger" data-action="weapon-actions">⋯ Acciones</button>
        </div>` : ''}
    </div>`;

  const rankSelectorHtml = `
    <div class="weapon-rank-selector">
      ${ranks.map(r => `
        <div class="weapon-rank-pill-wrap">
          <button type="button" class="pill ${rank && r.id === rank.id ? 'is-active' : ''}" data-action="select-rank" data-rank-id="${r.id}">${escapeHtml(r.name)}</button>
          ${admin ? `<button type="button" class="weapon-rank-admin-mini context-menu-trigger" data-action="rank-actions" data-rank-id="${r.id}" title="Acciones del rango" aria-label="Acciones del rango ${escapeHtml(r.name)}">⋯</button>` : ''}
        </div>`).join('')}
      ${admin ? `<button type="button" class="pill" data-action="add-rank">+ Rango</button>` : ''}
    </div>`;

  const forumHtml = admin ? `<div id="guide-forum-controls" data-weapon-id="${escapeHtml(weapon.id)}"></div>` : '';

  const bodyHtml = rank
    ? renderWeaponRankBody(weapon, rank, admin)
    : `<p class="comments-empty">${admin ? 'Esta arma no tiene rangos todavía. Agrega el primero con "+ Rango".' : 'Esta arma no tiene información todavía.'}</p>`;

  const relationsHtml = renderGuideRelations(weapon.id, rank?.id || null);

  container.innerHTML = headerHtml + forumHtml + rankSelectorHtml + bodyHtml + relationsHtml;
  bindWeaponDetailEvents(container);
  if (getGuideRelationsStatus(weapon.id) === 'idle') {
    void loadGuideRelations(weapon.id).then(() => {
      if (state.currentWeaponId === weapon.id && container.isConnected) renderWeaponDetail();
    });
  }
  if (admin) {
    void import('./guide-forum.js').then(({ bindGuideForumControls, renderGuideForumControls }) => {
      if (!isAdmin() || state.currentWeaponId !== weapon.id || !container.isConnected) return;
      bindGuideForumControls(container, getCurrentWeapon);
      return renderGuideForumControls(weapon);
    }).catch(error => console.warn('[Guides] Controles del foro:', error));
  }
}


function renderWeaponRankBody(weapon, rank, admin) {
  let html = '';
  const infoVisuals = getInfoVisuals(rank.extra_sections);
  const infoVisualsHtml = infoVisuals.length ? `
    <div class="weapon-info-visuals">
      ${infoVisuals.map((item) => {
        const safe = safeUrl(item.image_url);
        const link = guideLinkUrl(item.guide_link);
        const title = item.name || 'Recurso visual';
        const media = safe
          ? `<button type="button" class="weapon-info-visual-thumb js-open-asset" data-asset-src="${escapeHtml(safe)}" data-asset-title="${escapeHtml(title)}" aria-label="Ampliar ${escapeHtml(title)}" title="Ver imagen completa">
              <img src="${escapeHtml(safe)}" alt="${escapeHtml(title)}" class="pixel-art" loading="lazy" />
              <span class="weapon-info-visual-zoom" aria-hidden="true">⛶</span>
            </button>`
          : `<span class="weapon-info-visual-thumb is-placeholder"><span class="tier-chip-initials">${escapeHtml((title || '?').slice(0, 2).toUpperCase())}</span></span>`;
        const label = link
          ? `<a class="weapon-info-visual-name weapon-info-visual-link" href="${escapeHtml(link)}">${escapeHtml(title)} <span aria-hidden="true">↗</span></a>`
          : `<span class="weapon-info-visual-name">${escapeHtml(title)}</span>`;
        return `<div class="weapon-info-visual-card">${media}${label}</div>`;
      }).join('')}
    </div>` : '';

  // ---- Descripción del rango ----
  html += `
    <div class="weapon-section-block">
      <div class="weapon-section-head">
        <h3 class="weapon-section-title">📈 ${escapeHtml(rank.name)}</h3>
        ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-rank-info" data-rank-id="${rank.id}">✏️ Editar rango</button></div>` : ''}
      </div>
      ${rank.description ? `<p class="weapon-rank-desc">${escapeHtml(rank.description)}</p>` : (admin ? '<p class="comments-empty">Sin descripción todavía.</p>' : '')}
      ${infoVisualsHtml}
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

  // ---- Mesas de trabajo ----
  const recipe = rank.upgrade_recipe;
  if (recipe || admin) {
    html += `
      <div class="weapon-section-block">
        <div class="weapon-section-head">
          <h3 class="weapon-section-title">🛠️ Mesas de trabajo</h3>
          ${admin ? `<div class="weapon-section-admin-actions"><button type="button" class="btn-secondary-admin" data-action="edit-recipe" data-rank-id="${rank.id}">✏️ Editar mesas de trabajo</button></div>` : ''}
        </div>
        ${recipe ? renderRecipeTrade(recipe) : '<p class="comments-empty">Este rango no tiene mesas de trabajo configuradas.</p>'}
      </div>`;
  }

  // ---- Secciones extra (futuro: curiosidades, notas, builds...) ----
  const sections = visibleRankSections(rank.extra_sections);
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
          <button type="button" class="context-menu-trigger" data-action="ability-actions" data-rank-id="${rankId}" data-ability-idx="${idx}">⋯</button>
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
  if (Array.isArray(recipe.methods) && recipe.methods.length) {
    return `<div class="weapon-recipe-methods">${recipe.methods.map(renderRecipeMethod).join('')}</div>`;
  }
  return renderRecipeMethod(recipe);
}

function renderRecipeMethod(recipe) {
  const mode = recipe.mode || 'trade';
  const body = mode === 'crafting'
    ? renderCraftingRecipe(recipe)
    : mode === 'furnace'
      ? renderFurnaceRecipe(recipe)
      : mode === 'smithing'
        ? renderSmithingRecipe(recipe)
        : renderTradeRecipe(recipe);
  return `
    <div class="weapon-recipe-method">
      ${recipe.title ? `<h4 class="weapon-recipe-method-title">${escapeHtml(recipe.title)}</h4>` : ''}
      ${body}
    </div>`;
}

function renderRecipeSlot(item = {}, { result = false, empty = false } = {}) {
  const safe = safeUrl(item.image_url);
  const name = item.name || (empty ? 'Slot vacío' : 'Recurso sin nombre');
  const qty = Math.max(1, Number(item.qty) || 1);
  const link = guideLinkUrl(item.guide_link);
  const hasContent = !!(item.name || item.image_url || item.guide_link);
  const slotHtml = `
    <div class="weapon-recipe-slot ${result ? 'is-result' : ''} ${safe ? 'has-image' : ''}"
         tabindex="0"
         data-minecraft-tooltip="${escapeHtml(name)}"
         aria-label="${escapeHtml(name)}">
      ${safe ? `<img src="${escapeHtml(safe)}" alt="${escapeHtml(name)}" class="pixel-art" loading="lazy" />` : ''}
      ${!safe && !empty ? `<span class="tier-chip-initials">${escapeHtml((name || '?').slice(0, 2).toUpperCase())}</span>` : ''}
      ${hasContent && !empty ? `<span class="weapon-recipe-material-qty">×${escapeHtml(String(qty))}</span>` : ''}
    </div>`;
  if (!link) return slotHtml;
  return `<a class="weapon-recipe-slot-link" href="${escapeHtml(link)}" aria-label="Ver ${escapeHtml(name)} en Guías">${slotHtml}</a>`;
}

function renderRecipeResult(result = {}) {
  return `
    <div class="weapon-recipe-result">
      ${renderRecipeSlot(result, { result: true, empty: !result?.name && !result?.image_url && !result?.guide_link })}
      <span class="weapon-recipe-result-name">${escapeHtml(result.name || '')}</span>
    </div>`;
}

function renderTradeRecipe(recipe) {
  const materials = asArray(recipe.materials);
  const result = recipe.result || {};
  const matsHtml = materials.map(m => {
    return `
      <div class="weapon-recipe-material">
        ${renderRecipeSlot(m)}
        <span class="weapon-recipe-material-name">${escapeHtml(m.name || '')}</span>
      </div>`;
  }).join('');
  return `
    <div class="weapon-recipe-trade">
      <div class="weapon-recipe-materials">${matsHtml || '<p class="comments-empty">Sin materiales.</p>'}</div>
      <span class="weapon-recipe-arrow">→</span>
      ${renderRecipeResult(result)}
    </div>`;
}

function renderCraftingRecipe(recipe) {
  const grid = asArray(recipe.grid);
  const result = recipe.result || {};
  return `
    <div class="weapon-recipe-crafting">
      <div class="weapon-crafting-grid" aria-label="Mesa de crafteo">
        ${Array.from({ length: 9 }, (_, idx) => renderRecipeSlot(grid[idx] || {}, { empty: true })).join('')}
      </div>
      <span class="weapon-recipe-arrow">→</span>
      ${renderRecipeResult(result)}
    </div>`;
}

function renderFurnaceRecipe(recipe) {
  const inputs = asArray(recipe.inputs);
  const result = recipe.result || {};
  const furnaceLabels = {
    furnace: 'Horno normal',
    blast_furnace: 'Alto horno',
    smoker: 'Ahumador',
  };
  return `
    <div class="weapon-recipe-furnace">
      <div class="weapon-furnace-machine">
        <span class="weapon-furnace-label">${escapeHtml(furnaceLabels[recipe.furnace_type] || 'Horno normal')}</span>
        ${renderRecipeSlot(inputs[0] || {}, { empty: true })}
        <span class="weapon-furnace-flame" aria-hidden="true">🔥</span>
        ${renderRecipeSlot(inputs[1] || {}, { empty: true })}
      </div>
      <span class="weapon-recipe-arrow">→</span>
      ${renderRecipeResult(result)}
    </div>`;
}

function renderSmithingRecipe(recipe) {
  const inputs = asArray(recipe.inputs);
  const result = recipe.result || {};
  return `
    <div class="weapon-recipe-smithing">
      <div class="weapon-smithing-machine" aria-label="Mesa de herrería">
        ${Array.from({ length: 3 }, (_, idx) => renderRecipeSlot(inputs[idx] || {}, { empty: true })).join('')}
      </div>
      <span class="weapon-recipe-arrow">→</span>
      ${renderRecipeResult(result)}
    </div>`;
}


function weaponBasicPayload(weapon) {
  return {
    name: weapon?.name || '',
    image_url: weapon?.image_url || '',
    category_id: weapon?.category_id || '',
    type_id: weapon?.type_id || '',
  };
}

async function openWeaponAsNew(payload) {
  const adminActions = await loadWeaponAdminActions();
  adminActions.openWeaponModal(null);
  const name = document.getElementById('weapon-name-input');
  const image = document.getElementById('weapon-image-input');
  const category = document.getElementById('weapon-category-input');
  const type = document.getElementById('weapon-type-input');
  if (name) name.value = payload?.name || '';
  if (image) {
    image.value = payload?.image_url || '';
    image.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (category && payload?.category_id) category.value = payload.category_id;
  if (type && payload?.type_id) type.value = payload.type_id;
}

function openWeaponActions(anchor, weapon) {
  openContextPanel({
    anchor,
    title: 'Acciones del arma',
    subtitle: weapon.name || '',
    width: 350,
    build(root, close) {
      appendActionGrid(root, [
        { label: 'Editar información', icon: '✏', onClick: async () => {
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.openWeaponModal(weapon.id);
        } },
        { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('weapon-basic', weaponBasicPayload(weapon)) },
        { label: 'Duplicar', icon: '⧉', onClick: async () => {
          const payload = weaponBasicPayload(weapon);
          payload.name = `${payload.name} (copia)`;
          close();
          await openWeaponAsNew(payload);
        } },
        { label: 'Pegar como nueva', icon: '↧', disabled: !hasEditorPayload('weapon-basic'), onClick: async () => {
          const payload = getEditorPayload('weapon-basic');
          if (!payload) return;
          close();
          await openWeaponAsNew(payload);
        } },
        { label: weapon.published ? 'Despublicar' : 'Publicar', icon: weapon.published ? '🙈' : '👁', tone: weapon.published ? 'warning' : 'success', onClick: async () => {
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.toggleWeaponPublished(weapon.id);
        } },
        { label: 'Borrar arma', icon: '🗑', tone: 'danger', onClick: async () => {
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.deleteWeaponAction(weapon.id);
        } },
      ]);
    },
  });
}

function openAbilityActions(anchor, rankId, abilityIdx) {
  const weapon = getCurrentWeapon();
  const rank = getWeaponRanks(weapon?.id).find(entry => entry.id === rankId);
  const ability = asArray(rank?.abilities)[abilityIdx];
  if (!ability) return;
  openContextPanel({
    anchor,
    title: 'Acciones de la habilidad',
    subtitle: ability.name || `Habilidad ${abilityIdx + 1}`,
    width: 330,
    build(root, close) {
      appendActionGrid(root, [
        { label: 'Editar', icon: '✏', onClick: async () => {
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.openWeaponAbilityModal(rankId, abilityIdx);
        } },
        { label: 'Copiar', icon: '⎘', onClick: () => copyEditorPayload('weapon-ability', ability) },
        { label: 'Duplicar', icon: '⧉', onClick: async () => {
          const payload = cloneData(ability);
          payload.name = `${payload.name || 'Habilidad'} (copia)`;
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.openWeaponAbilityModal(rankId, null, payload);
        } },
        { label: 'Pegar como nueva', icon: '↧', disabled: !hasEditorPayload('weapon-ability'), onClick: async () => {
          const payload = getEditorPayload('weapon-ability');
          if (!payload) return;
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.openWeaponAbilityModal(rankId, null, payload);
        } },
        { label: 'Eliminar', icon: '🗑', tone: 'danger', onClick: async () => {
          close();
          const adminActions = await loadWeaponAdminActions();
          adminActions.deleteAbility(rankId, abilityIdx);
        } },
      ]);
    },
  });
}

function weaponRankPayload(rank) {
  return {
    name: rank?.name || '',
    description: rank?.description || '',
    image_url: rank?.image_url || '',
    stats: cloneData(asArray(rank?.stats)),
    abilities: cloneData(asArray(rank?.abilities)),
    extra_sections: cloneData(asArray(rank?.extra_sections)),
    upgrade_recipe: cloneData(rank?.upgrade_recipe || null),
  };
}

function openRankActions(anchor, rankId) {
  const rank = getWeaponRanks(state.currentWeaponId).find(entry => entry.id === rankId);
  if (!rank) return;
  openContextPanel({
    anchor,
    title: 'Acciones del rango',
    subtitle: rank.name || '',
    width: 350,
    build(root, close) {
      appendActionGrid(root, [
        {
          label: 'Editar rango', icon: '✏', onClick: async () => {
            close();
            const adminActions = await loadWeaponAdminActions();
            adminActions.openWeaponRankModal(rank.id);
          },
        },
        {
          label: 'Copiar', icon: '⎘', onClick: () => {
            copyEditorPayload('weapon-rank', weaponRankPayload(rank));
            showToast('Rango copiado', 'success');
          },
        },
        {
          label: 'Duplicar', icon: '⧉', onClick: async () => {
            close();
            const adminActions = await loadWeaponAdminActions();
            await adminActions.duplicateWeaponRank(rank.id);
          },
        },
        {
          label: 'Pegar como nuevo', icon: '↧', disabled: !hasEditorPayload('weapon-rank'), onClick: async () => {
            const payload = getEditorPayload('weapon-rank');
            if (!payload) return;
            close();
            const adminActions = await loadWeaponAdminActions();
            await adminActions.createWeaponRankFromPayload(payload, { addCopySuffix: false });
          },
        },
        {
          label: 'Eliminar rango', icon: '🗑', tone: 'danger', onClick: async () => {
            close();
            const adminActions = await loadWeaponAdminActions();
            await adminActions.deleteWeaponRank(rank.id);
          },
        },
      ]);
    },
  });
}


function bindWeaponDetailEvents(container) {
  if (container.dataset.weaponDetailActionsBound === 'true') return;
  container.dataset.weaponDetailActionsBound = 'true';
  container.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const btn = target?.closest('[data-action]');
    if (!btn || !container.contains(btn)) return;

    const { action, rankId, abilityIdx, sectionIdx } = btn.dataset;
    if (action === 'select-rank') {
      state.currentWeaponRankId = rankId;
      writeGuideHistory('replace', state.currentWeaponId, rankId, {
        fromCatalog: !!window.history.state?.culonesGuideFromCatalog,
      });
      renderWeaponDetail();
      return;
    }

    if (action === 'weapon-actions') {
      openWeaponActions(btn, getCurrentWeapon());
      return;
    }
    if (action === 'ability-actions') {
      openAbilityActions(btn, rankId, Number(abilityIdx));
      return;
    }
    if (action === 'rank-actions') {
      openRankActions(btn, rankId);
      return;
    }

    const adminActions = await loadWeaponAdminActions();
    switch (action) {
      case 'add-rank':
        adminActions.openWeaponRankModal(null);
        break;
      case 'delete-rank':
        event.stopPropagation();
        adminActions.deleteWeaponRank(rankId);
        break;
      case 'edit-weapon-info':
        adminActions.openWeaponModal(state.currentWeaponId);
        break;
      case 'toggle-weapon-published':
        adminActions.toggleWeaponPublished(state.currentWeaponId);
        break;
      case 'delete-weapon':
        adminActions.deleteWeaponAction(state.currentWeaponId);
        break;
      case 'edit-rank-info':
        adminActions.openWeaponRankModal(rankId);
        break;
      case 'edit-stats':
        adminActions.openWeaponStatsModal(rankId);
        break;
      case 'add-ability':
        adminActions.openWeaponAbilityModal(rankId, null);
        break;
      case 'edit-ability':
        adminActions.openWeaponAbilityModal(rankId, Number(abilityIdx));
        break;
      case 'delete-ability':
        adminActions.deleteAbility(rankId, Number(abilityIdx));
        break;
      case 'edit-recipe':
        adminActions.openWeaponRecipeModal(rankId);
        break;
      case 'add-section':
        adminActions.openWeaponSectionModal(rankId, null);
        break;
      case 'edit-section':
        adminActions.openWeaponSectionModal(rankId, Number(sectionIdx));
        break;
      case 'delete-section':
        adminActions.deleteSection(rankId, Number(sectionIdx));
        break;
    }
  });
}

function isMissingPatchRankRpc(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('patch_weapon_rank') || msg.includes('function') || msg.includes('schema cache');
}

export async function saveRankPatch(rankId, patch) {
  const rank = getWeaponRanks(state.currentWeaponId).find(r => r.id === rankId);
  if (!rank) return { error: { message: 'Este rango ya no existe' } };
  const patchResult = await supabaseClient.rpc('patch_weapon_rank', {
    input_code: state.adminMode,
    input_id: rank.id,
    ...patch,
  });
  if (!patchResult.error) {
    replaceWeaponRank(patchResult.data);
    return patchResult;
  }
  if (!isMissingPatchRankRpc(patchResult.error)) return patchResult;

  const fallback = await supabaseClient.rpc('upsert_weapon_rank', {
    input_code: state.adminMode,
    input_id: rank.id,
    input_weapon_id: rank.weapon_id,
    input_name: patch.input_name ?? rank.name,
    input_description: patch.input_description ?? rank.description,
    input_image_url: patch.input_image_url ?? rank.image_url,
    input_stats: patch.input_stats ?? rank.stats,
    input_abilities: patch.input_abilities ?? rank.abilities,
    input_extra_sections: patch.input_extra_sections ?? rank.extra_sections,
    input_upgrade_recipe: patch.input_clear_upgrade_recipe ? null : (patch.input_upgrade_recipe ?? rank.upgrade_recipe),
  });
  if (!fallback.error) replaceWeaponRank(fallback.data);
  return fallback;
}

// =========================================================
// blocks-display.js
// =========================================================
// Renderizado de solo lectura de las fichas adjuntas a un log
// (Mob/Item/Bloque Libre): parseo de equipamiento/campos libres y
// construcción de los paneles y chips que se ven en la tarjeta/detalle
// de un log.
// =========================================================

import { DEFAULT_ITEM_FIELDS, DEFAULT_MOB_FIELDS, state } from '../core/state.js';
import { renderBlockAssetHtml } from '../core/storage.js';
import { asArray, escapeHtml } from '../core/utils.js';

export function parseEquipment(raw) {
  if (!raw) return [];
  if (raw.startsWith('[')) {
    try { return JSON.parse(raw); } catch(e) {}
  }
  // Legacy: texto plano → convertir a array sin encantamientos
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(name => ({ name, enchantments: [] }));
}

// Parsea campos libres de un bloque libre

export function parseLibreFields(item) {
  // stored as item_type = '_libre', name = nombre del bloque, obtained_from = JSON fields
  try {
    return JSON.parse(item.obtained_from || '[]');
  } catch(e) { return []; }
}

// Devuelve siempre un array, sea que la columna jsonb ya venga
// parseada (caso normal de supabase-js) o, defensivamente, como
// texto JSON crudo.

export function renderKeyValueRows(fields) {
  if (!fields || fields.length === 0) return '';
  function renderFieldValue(field) {
    if (field.subfields && field.subfields.length > 0) {
      return `<div class="libre-subfields">${field.subfields.map(sf =>
        `<div class="item-detail-row libre-subrow">
          <span class="item-detail-label libre-sublabel">↳ ${escapeHtml(sf.key)}</span>
          <span class="item-detail-value">${escapeHtml(sf.value || '')}</span>
        </div>`
      ).join('')}</div>`;
    }
    return `<span class="item-detail-value">${escapeHtml(field.value || '')}</span>`;
  }
  return fields.map(f => `
    <div class="item-detail-row libre-row">
      <span class="item-detail-label">${escapeHtml(f.key)}</span>
      ${renderFieldValue(f)}
    </div>`).join('');
}

// Bloque de imagen de referencia: thumbnail + botón de pantalla
// completa (abre asset-view.html en otra pestaña, con su propio
// botón de "Volver").

function renderMobDetailPanel(mob, contextKey) {
  const fieldsConfig = (state.fieldConfig.mob && state.fieldConfig.mob.length > 0) ? state.fieldConfig.mob : DEFAULT_MOB_FIELDS;
  const rows = [];

  // Equipamiento: puede ser JSON array o texto legacy
  function buildEquipHtml() {
    if (!mob.equipment) return '';
    const equipList = parseEquipment(mob.equipment);
    if (equipList.length === 0) return '';
    const itemsHtml = equipList.map(eq => {
      let enchHtml = '';
      if (eq.enchantments && eq.enchantments.length > 0) {
        enchHtml = eq.enchantments.map(en =>
          `<span class="enchant-tag">${escapeHtml(en.name)}</span>`
        ).join('');
        enchHtml = `<span class="enchant-list">${enchHtml}</span>`;
      }
      return `<div class="equip-item"><span class="equip-name">⚙ ${escapeHtml(eq.name)}</span>${enchHtml}</div>`;
    }).join('');
    return `
      <div class="item-detail-row equip-section">
        <span class="item-detail-label">Equipamiento</span>
        <div class="equip-list">${itemsHtml}</div>
      </div>`;
  }

  fieldsConfig.filter(f => f.enabled).forEach(f => {
    switch (f.key) {
      case 'health':
        if (mob.health != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">❤️ Vida</span>
            <div class="bar-track"><div class="bar-fill bar-health" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.health}</span>
          </div>`);
        break;
      case 'damage':
        if (mob.damage != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">⚔️ Daño</span>
            <div class="bar-track"><div class="bar-fill bar-damage" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.damage}</span>
          </div>`);
        break;
      case 'armor':
        if (mob.armor != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">🛡 Armor</span>
            <div class="bar-track"><div class="bar-fill bar-armor" style="width:100%"></div></div>
            <span class="stat-row-value">${mob.armor}</span>
          </div>`);
        break;
      case 'equipment':
        rows.push(buildEquipHtml());
        break;
      case 'location':
        if (mob.location) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Dónde aparece</span><span class="item-detail-value">${escapeHtml(mob.location)}</span></div>`);
        break;
    }
  });

  const statRows = rows.filter(r => r.includes('stat-row')).join('');
  const otherRows = rows.filter(r => !r.includes('stat-row')).join('');

  const descHtml = mob.description ? `<p class="block-detail-desc">${escapeHtml(mob.description)}</p>` : '';
  const extraRows = renderKeyValueRows(asArray(mob.extra_fields));
  const extraHtml = extraRows ? `<div class="block-detail-extra"><p class="block-detail-extra-label">Algo más</p><div class="item-detail-grid">${extraRows}</div></div>` : '';
  const assetHtml = renderBlockAssetHtml(mob.image_url, mob.name);

  const panelId = `block-detail-${contextKey}-${mob.id}`;
  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">👾 ${escapeHtml(mob.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${statRows}
      ${otherRows ? `<div class="item-detail-grid" style="margin-top:8px;">${otherRows}</div>` : ''}
      ${extraHtml}
    </div>`;
}


function renderItemDetailPanel(item, contextKey) {
  if (item.item_type === '_libre') {
    return renderLibreDetailPanel(item, contextKey);
  }
  const fieldsConfig = (state.fieldConfig.item && state.fieldConfig.item.length > 0) ? state.fieldConfig.item : DEFAULT_ITEM_FIELDS;
  const rows = [];
  const enchantments = asArray(item.enchantments);

  fieldsConfig.filter(f => f.enabled).forEach(f => {
    switch (f.key) {
      case 'tier':
        if (item.tier) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Rango/Tier</span><span class="item-detail-value">${escapeHtml(item.tier)}</span></div>`);
        break;
      case 'item_type':
        if (item.item_type) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Tipo</span><span class="item-detail-value">${escapeHtml(item.item_type)}</span></div>`);
        break;
      case 'damage':
        if (item.damage != null) rows.push(`
          <div class="stat-row">
            <span class="stat-row-label">⚔️ Daño</span>
            <div class="bar-track"><div class="bar-fill bar-damage" style="width:100%"></div></div>
            <span class="stat-row-value">${item.damage}</span>
          </div>`);
        break;
      case 'enchantments':
        if (enchantments.length > 0) {
          const tags = enchantments.map(en => `<span class="enchant-tag">${escapeHtml(en.name)}</span>`).join('');
          rows.push(`<div class="item-detail-row equip-section"><span class="item-detail-label">Encantamientos</span><div class="item-enchant-tags">${tags}</div></div>`);
        }
        break;
      case 'obtained_from':
        if (item.obtained_from) rows.push(`<div class="item-detail-row"><span class="item-detail-label">Dónde se obtiene</span><span class="item-detail-value">${escapeHtml(item.obtained_from)}</span></div>`);
        break;
    }
  });

  const statRows = rows.filter(r => r.includes('stat-row')).join('');
  const otherRows = rows.filter(r => !r.includes('stat-row')).join('');

  const descHtml = item.description ? `<p class="block-detail-desc">${escapeHtml(item.description)}</p>` : '';
  const extraRows = renderKeyValueRows(asArray(item.extra_fields));
  const extraHtml = extraRows ? `<div class="block-detail-extra"><p class="block-detail-extra-label">Algo más</p><div class="item-detail-grid">${extraRows}</div></div>` : '';
  const assetHtml = renderBlockAssetHtml(item.image_url, item.name);

  const panelId = `block-detail-${contextKey}-${item.id}`;
  const hasContent = statRows || otherRows || descHtml || extraHtml || assetHtml;
  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">🗡 ${escapeHtml(item.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${statRows}
      ${otherRows ? `<div class="item-detail-grid"${statRows ? ' style="margin-top:8px;"' : ''}>${otherRows}</div>` : ''}
      ${extraHtml}
      ${hasContent ? '' : '<p class="comments-empty">Sin datos adicionales.</p>'}
    </div>`;
}


function renderLibreDetailPanel(item, contextKey) {
  const fields = parseLibreFields(item);
  const panelId = `block-detail-${contextKey}-${item.id}`;
  const rows = renderKeyValueRows(fields);

  const descHtml = item.description ? `<p class="block-detail-desc">${escapeHtml(item.description)}</p>` : '';
  const assetHtml = renderBlockAssetHtml(item.image_url, item.name);

  return `
    <div class="block-detail-panel hidden" id="${panelId}">
      <p class="block-detail-name">📋 ${escapeHtml(item.name)}</p>
      ${descHtml}
      ${assetHtml}
      ${rows ? `<div class="item-detail-grid">${rows}</div>` : (descHtml || assetHtml ? '' : '<p class="comments-empty">Sin campos.</p>')}
    </div>`;
}

// FIX PRINCIPAL: usa contextKey para que los IDs sean únicos entre
// tarjeta y modal de detalle. bindBlockChipEvents busca en el
// contenedor padre, no en el documento entero.

export function renderBlocksSection(logId, contextKey) {
  const mobs = state.mobsByLog[logId] || [];
  const items = state.itemsByLog[logId] || [];
  const libres = items.filter(i => i.item_type === '_libre');
  const normalItems = items.filter(i => i.item_type !== '_libre');

  if (mobs.length === 0 && items.length === 0) return '';

  const chips = [
    ...mobs.map(m => `<button type="button" class="block-chip chip-mob" data-panel-id="block-detail-${contextKey}-${m.id}">👾 ${escapeHtml(m.name)} <span class="block-chip-caret">▾</span></button>`),
    ...normalItems.map(i => `<button type="button" class="block-chip chip-item" data-panel-id="block-detail-${contextKey}-${i.id}">🗡 ${escapeHtml(i.name)} <span class="block-chip-caret">▾</span></button>`),
    ...libres.map(i => `<button type="button" class="block-chip chip-libre" data-panel-id="block-detail-${contextKey}-${i.id}">📋 ${escapeHtml(i.name)} <span class="block-chip-caret">▾</span></button>`),
  ].join('');

  const panels = [
    ...mobs.map(m => renderMobDetailPanel(m, contextKey)),
    ...items.map(i => renderItemDetailPanel(i, contextKey)),
  ].join('');

  return `<div class="block-chip-row">${chips}</div>${panels}`;
}

// FIX: busca el panel por ID dentro del contenedor, no document.getElementById

export function bindBlockChipEvents(container) {
  container.querySelectorAll('.block-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const panelId = chip.dataset.panelId;
      // Buscar dentro del mismo contenedor o en todo el documento si está en un modal
      const panel = container.querySelector(`#${CSS.escape(panelId)}`) || document.getElementById(panelId);
      if (!panel) return;
      const wasHidden = panel.classList.contains('hidden');
      // Cierra todos los paneles del mismo contenedor primero
      container.querySelectorAll('.block-detail-panel').forEach(p => {
        p.classList.add('hidden');
      });
      container.querySelectorAll('.block-chip').forEach(c => c.classList.remove('is-expanded'));
      if (wasHidden) {
        panel.classList.remove('hidden');
        chip.classList.add('is-expanded');
      }
    });
  });
}

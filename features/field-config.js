// =========================================================
// field-config.js
// =========================================================
// Configuración de qué campos fijos de las fichas de Mob/Item están
// activos y en qué orden (tabla app_settings). Carga también el resto de
// app_settings (about, fondo, favicon) porque comparten la misma tabla.
// =========================================================

import { supabaseClient } from '../config.js';
import { renderAboutContent } from './about.js';
import { applyCustomBackground, normalizeBackgroundOpacity, normalizeBackgroundPresentation, populateBackgroundForm } from './background.js';
import { applyFavicon, populateFaviconForm } from './favicon.js';
import { DEFAULT_ITEM_FIELDS, DEFAULT_MOB_FIELDS, state } from '../core/state.js';
import { escapeHtml, showToast } from '../core/utils.js';

let onFieldConfigSaved = () => {};

export function setFieldConfigSavedHandler(handler) {
  onFieldConfigSaved = typeof handler === 'function' ? handler : () => {};
}

export async function loadAppSettings() {
  state.fieldConfig = { mob: DEFAULT_MOB_FIELDS, item: DEFAULT_ITEM_FIELDS };
  state.aboutBlocks = null;
  state.backgroundConfig = { image_url: '', mode: 'fixed', tabs: [], presentation: null, opacity: 1 };
  state.faviconUrl = '';

  const { data, error } = await supabaseClient.from('app_settings').select('key,value');
  if (error || !data) return;

  const mobRow   = data.find(r => r.key === 'mob_fields');
  const itemRow  = data.find(r => r.key === 'item_fields');
  const aboutRow = data.find(r => r.key === 'about_blocks');
  const bgRow    = data.find(r => r.key === 'background_config');
  const faviRow  = data.find(r => r.key === 'favicon_url');

  if (mobRow  && Array.isArray(mobRow.value)  && mobRow.value.length  > 0) state.fieldConfig.mob  = mobRow.value;
  if (itemRow && Array.isArray(itemRow.value) && itemRow.value.length > 0) state.fieldConfig.item = itemRow.value;

  if (aboutRow && Array.isArray(aboutRow.value)) {
    state.aboutBlocks = aboutRow.value;
  }

  if (bgRow && bgRow.value && typeof bgRow.value === 'object') {
    state.backgroundConfig = {
      image_url: bgRow.value.image_url || '',
      mode: ['fixed','continuous','contain'].includes(bgRow.value.mode) ? bgRow.value.mode : 'fixed',
      tabs: Array.isArray(bgRow.value.tabs) ? bgRow.value.tabs : [],
      presentation: bgRow.value.presentation ? normalizeBackgroundPresentation(bgRow.value.presentation, bgRow.value.opacity ?? 1) : null,
      opacity: normalizeBackgroundOpacity(bgRow.value.opacity ?? 1),
    };
  }

  if (faviRow && typeof faviRow.value === 'string') {
    state.faviconUrl = faviRow.value;
  } else if (faviRow && faviRow.value && typeof faviRow.value === 'object') {
    state.faviconUrl = faviRow.value.url || '';
  }

  renderAboutContent();
  populateBackgroundForm();
  applyCustomBackground();
  applyFavicon(state.faviconUrl);
  populateFaviconForm();
}


export function openFieldConfigModal() {
  state.fieldConfigDraft = {
    mob: JSON.parse(JSON.stringify(state.fieldConfig.mob)),
    item: JSON.parse(JSON.stringify(state.fieldConfig.item)),
  };
  renderFieldConfigList('mob');
  renderFieldConfigList('item');
  document.getElementById('field-config-modal-error').classList.add('hidden');
  document.getElementById('field-config-modal').classList.remove('hidden');
}


function renderFieldConfigList(kind) {
  const container = document.getElementById(`fieldcfg-${kind}-list`);
  const list = state.fieldConfigDraft[kind];
  container.innerHTML = list.map((f, idx) => `
    <div class="fieldcfg-row ${f.enabled ? '' : 'is-disabled'}">
      <input type="checkbox" class="fieldcfg-enabled" data-kind="${kind}" data-idx="${idx}" ${f.enabled ? 'checked' : ''} />
      <span class="fieldcfg-label">${escapeHtml(f.label)}</span>
      <div class="fieldcfg-move-group">
        <button type="button" class="fieldcfg-move-btn fieldcfg-up" data-kind="${kind}" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="fieldcfg-move-btn fieldcfg-down" data-kind="${kind}" data-idx="${idx}" ${idx === list.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.fieldcfg-enabled').forEach(cb => {
    cb.addEventListener('change', () => {
      state.fieldConfigDraft[cb.dataset.kind][Number(cb.dataset.idx)].enabled = cb.checked;
      renderFieldConfigList(cb.dataset.kind);
    });
  });
  container.querySelectorAll('.fieldcfg-up').forEach(btn => {
    btn.addEventListener('click', () => moveFieldConfig(btn.dataset.kind, Number(btn.dataset.idx), -1));
  });
  container.querySelectorAll('.fieldcfg-down').forEach(btn => {
    btn.addEventListener('click', () => moveFieldConfig(btn.dataset.kind, Number(btn.dataset.idx), 1));
  });
}


function moveFieldConfig(kind, idx, dir) {
  const list = state.fieldConfigDraft[kind];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= list.length) return;
  [list[idx], list[newIdx]] = [list[newIdx], list[idx]];
  renderFieldConfigList(kind);
}


export async function saveFieldConfig() {
  const errorBox = document.getElementById('field-config-modal-error');
  if (!state.adminCode) { errorBox.textContent = 'Tu sesión de administrador expiró.'; errorBox.classList.remove('hidden'); return; }
  const [r1, r2] = await Promise.all([
    supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'mob_fields', input_value: state.fieldConfigDraft.mob }),
    supabaseClient.rpc('update_app_setting', { input_code: state.adminCode, input_key: 'item_fields', input_value: state.fieldConfigDraft.item }),
  ]);
  if (r1.error || r2.error) { errorBox.textContent = 'Error: ' + (r1.error || r2.error).message; errorBox.classList.remove('hidden'); return; }
  state.fieldConfig = { mob: state.fieldConfigDraft.mob, item: state.fieldConfigDraft.item };
  document.getElementById('field-config-modal').classList.add('hidden');
  showToast('Configuración de fichas guardada', 'success');
  onFieldConfigSaved();
}

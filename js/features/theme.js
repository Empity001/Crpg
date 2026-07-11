import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { showToast } from '../core/utils.js';

export const DEFAULT_THEME_CONFIG = Object.freeze({
  pageBackground: '#070914',
  sidebarBackground: '#0b0e1d',
  panelBackground: '#111528',
  elevatedBackground: '#171b32',
  inputBackground: '#1d2240',
  textPrimary: '#f5f3ff',
  textSecondary: '#aaa6c5',
  textMuted: '#6d6a87',
  border: '#8570bf',
  selection: '#8b3dff',
  primary: '#8b3dff',
  primarySoft: '#b46cff',
  accent: '#ffb83e',
  event: '#ff3d8d',
  info: '#38bdf8',
  confirmation: '#35d98b',
  warning: '#f5c542',
  danger: '#ef4444',
});

const LOCAL_THEME_STORAGE_KEY = 'culones_theme_local_v1';
const THEME_SCOPE_STORAGE_KEY = 'culones_theme_editor_scope_v1';

const THEME_GROUPS = [
  ['Fondos y superficies', [
    ['pageBackground', 'Fondo de la página', 'Área exterior y base del sitio.'],
    ['sidebarBackground', 'Fondo del menú', 'Sidebar y barras principales.'],
    ['panelBackground', 'Paneles y tarjetas', 'Cajas, tarjetas y modales.'],
    ['elevatedBackground', 'Panel elevado', 'Hover y bloques internos.'],
    ['inputBackground', 'Campos y selectores', 'Inputs, textareas y listas.'],
    ['border', 'Bordes generales', 'Separadores y contornos neutrales.'],
  ]],
  ['Texto', [
    ['textPrimary', 'Texto principal', 'Títulos y contenido importante.'],
    ['textSecondary', 'Texto secundario', 'Descripciones y ayudas.'],
    ['textMuted', 'Texto apagado', 'Fechas, metadatos y placeholders.'],
  ]],
  ['Interacción y acentos', [
    ['selection', 'Color de selección', 'Texto seleccionado, foco y opción activa.'],
    ['primary', 'Acción principal', 'Botones principales y Modo Admin.'],
    ['primarySoft', 'Acento morado claro', 'Gradientes y detalles secundarios.'],
    ['accent', 'Destacado dorado', 'Logo, rareza y elementos especiales.'],
    ['event', 'Eventos y corazones', 'Eventos, likes y detalles rosados.'],
    ['info', 'Mecánicas e información', 'Estados informativos y mecánicas.'],
  ]],
  ['Estados del sistema', [
    ['confirmation', 'Color de confirmación', 'Guardado, conexión y acciones correctas.'],
    ['warning', 'Advertencia', 'Avisos, relevancia alta y precauciones.'],
    ['danger', 'Error y eliminación', 'Acciones destructivas y mensajes críticos.'],
  ]],
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

function validHex(value, fallback) {
  return HEX_RE.test(String(value || '').trim())
    ? String(value).trim().toLowerCase()
    : fallback;
}

export function normalizeThemeConfig(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    Object.entries(DEFAULT_THEME_CONFIG).map(([key, fallback]) => [
      key,
      validHex(source[key], fallback),
    ]),
  );
}

export function getLocalThemeOverride() {
  try {
    const raw = localStorage.getItem(LOCAL_THEME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const config = parsed?.config && typeof parsed.config === 'object' ? parsed.config : parsed;
    return normalizeThemeConfig(config);
  } catch (error) {
    console.warn('No se pudo leer la paleta local:', error);
    return null;
  }
}

export function saveLocalThemeOverride(config) {
  const normalized = normalizeThemeConfig(config);
  localStorage.setItem(LOCAL_THEME_STORAGE_KEY, JSON.stringify({ version: 1, config: normalized }));
  return normalized;
}

export function clearLocalThemeOverride() {
  localStorage.removeItem(LOCAL_THEME_STORAGE_KEY);
}

export function resolveEffectiveThemeConfig(serverConfig = state.serverThemeConfig) {
  return getLocalThemeOverride() || normalizeThemeConfig(serverConfig || {});
}

function renderThemeControls() {
  const grid = document.getElementById('theme-color-grid');
  if (!grid || grid.children.length) return;

  grid.innerHTML = THEME_GROUPS.map(([title, fields]) => `
    <section class="theme-color-group">
      <h3>${title}</h3>
      <div class="theme-color-list">
        ${fields.map(([key, label, hint]) => `
          <label class="theme-color-control">
            <span class="theme-color-swatch" data-theme-swatch="${key}"></span>
            <span class="theme-color-copy">
              <strong>${label}</strong>
              <small>${hint}</small>
            </span>
            <input type="color" data-theme-key="${key}" value="${DEFAULT_THEME_CONFIG[key]}">
            <input type="text" data-theme-key="${key}" value="${DEFAULT_THEME_CONFIG[key]}" maxlength="7" spellcheck="false">
          </label>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function rgb(hex) {
  const value = validHex(hex, '#000000').slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const color = rgb(hex);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function mix(a, b, ratio = 0.5) {
  const first = rgb(a);
  const second = rgb(b);
  const toHex = value => Math.round(value).toString(16).padStart(2, '0');
  return `#${toHex(first.r + (second.r - first.r) * ratio)}${toHex(first.g + (second.g - first.g) * ratio)}${toHex(first.b + (second.b - first.b) * ratio)}`;
}

function set(root, name, value) {
  root.style.setProperty(name, value);
}

export function applyThemeConfig(config = state.themeConfig) {
  const colors = normalizeThemeConfig(config);
  const root = document.documentElement;
  const variables = {
    '--bg': colors.pageBackground,
    '--bg-deep': mix(colors.pageBackground, '#000000', 0.32),
    '--bg-panel': colors.sidebarBackground,
    '--bg-card': colors.panelBackground,
    '--bg-card-hover': colors.elevatedBackground,
    '--surface': colors.panelBackground,
    '--surface-2': colors.elevatedBackground,
    '--surface-3': colors.inputBackground,
    '--panel-glass': rgba(colors.panelBackground, 0.84),
    '--ink-100': colors.textPrimary,
    '--ink-200': mix(colors.textPrimary, colors.textSecondary, 0.28),
    '--ink-300': mix(colors.textPrimary, colors.textSecondary, 0.58),
    '--ink-400': colors.textSecondary,
    '--ink-500': mix(colors.textSecondary, colors.textMuted, 0.45),
    '--ink-600': colors.textMuted,
    '--ink-700': mix(colors.textMuted, colors.pageBackground, 0.4),
    '--gold': colors.accent,
    '--gold-dim': mix(colors.accent, colors.pageBackground, 0.52),
    '--magenta': colors.event,
    '--magenta-dim': mix(colors.event, colors.pageBackground, 0.52),
    '--cyan': colors.info,
    '--hud-green': colors.confirmation,
    '--hud-green-dim': mix(colors.confirmation, colors.pageBackground, 0.56),
    '--purple': colors.primarySoft,
    '--admin-purple': colors.primary,
    '--admin-purple-dark': mix(colors.primary, colors.pageBackground, 0.32),
    '--admin-purple-soft': mix(colors.primary, colors.primarySoft, 0.46),
    '--admin-purple-light': mix(colors.primarySoft, '#ffffff', 0.3),
    '--border-dim': rgba(colors.border, 0.14),
    '--border-soft': rgba(colors.border, 0.24),
    '--border-strong': rgba(colors.border, 0.5),
    '--theme-selection': colors.selection,
    '--theme-selection-soft': rgba(colors.selection, 0.22),
    '--theme-selection-glow': rgba(colors.selection, 0.34),
    '--admin-bg-deep': colors.pageBackground,
    '--admin-bg-panel': colors.sidebarBackground,
    '--admin-bg-elevated': colors.elevatedBackground,
    '--admin-surface-root': colors.pageBackground,
    '--admin-surface-card': colors.panelBackground,
    '--admin-surface-input': colors.inputBackground,
    '--admin-ink': colors.textPrimary,
    '--admin-ink-soft': rgba(colors.textPrimary, 0.76),
    '--admin-ink-muted': rgba(colors.textSecondary, 0.76),
    '--admin-ink-faint': rgba(colors.textMuted, 0.72),
    '--admin-ink-placeholder': rgba(colors.textMuted, 0.78),
    '--admin-border': rgba(colors.primary, 0.44),
    '--admin-border-muted': rgba(colors.primary, 0.3),
    '--admin-border-soft': rgba(colors.primary, 0.34),
    '--admin-border-control': rgba(colors.primary, 0.38),
    '--admin-border-faint': rgba(colors.primary, 0.23),
    '--admin-border-strong': rgba(colors.primary, 0.62),
    '--admin-danger': colors.danger,
    '--admin-danger-ink': mix(colors.danger, '#ffffff', 0.68),
    '--admin-danger-bg-faint': rgba(colors.danger, 0.07),
    '--admin-danger-bg': rgba(colors.danger, 0.1),
    '--admin-danger-bg-hover': rgba(colors.danger, 0.2),
    '--admin-danger-border': rgba(colors.danger, 0.54),
    '--admin-danger-border-soft': rgba(colors.danger, 0.4),
    '--admin-success': colors.confirmation,
    '--admin-success-ink': mix(colors.confirmation, '#ffffff', 0.28),
    '--admin-success-bg': rgba(colors.confirmation, 0.11),
    '--admin-success-bg-hover': rgba(colors.confirmation, 0.22),
    '--admin-warning': colors.warning,
    '--admin-warning-bg': rgba(colors.warning, 0.09),
    '--admin-warning-border': rgba(colors.warning, 0.44),
    '--admin-cyan-bg-faint': rgba(colors.info, 0.07),
    '--admin-cyan-bg-soft': rgba(colors.info, 0.1),
    '--admin-cyan-bg-banner': rgba(colors.info, 0.08),
    '--admin-cyan-bg-hover': rgba(colors.info, 0.2),
    '--admin-cyan-border-soft': rgba(colors.info, 0.34),
    '--theme-page-bg': colors.pageBackground,
    '--theme-sidebar-bg': colors.sidebarBackground,
    '--theme-panel-bg': colors.panelBackground,
    '--theme-elevated-bg': colors.elevatedBackground,
    '--theme-input-bg': colors.inputBackground,
    '--theme-primary': colors.primary,
    '--theme-primary-soft': colors.primarySoft,
    '--theme-accent': colors.accent,
    '--theme-event': colors.event,
    '--theme-info': colors.info,
    '--theme-confirmation': colors.confirmation,
    '--theme-warning': colors.warning,
    '--theme-danger': colors.danger,
    '--glow-gold': `0 0 26px ${rgba(colors.accent, 0.18)}`,
    '--glow-magenta': `0 0 26px ${rgba(colors.event, 0.18)}`,
    '--glow-admin': `0 0 30px ${rgba(colors.primary, 0.24)}`,
  };

  Object.entries(variables).forEach(([name, value]) => set(root, name, value));
}

function readForm() {
  const values = {};
  document.querySelectorAll('[data-theme-key]').forEach(element => {
    if (element.type !== 'color') values[element.dataset.themeKey] = element.value;
  });
  return normalizeThemeConfig(values);
}

function syncPair(key, value, source) {
  const normalized = validHex(value, DEFAULT_THEME_CONFIG[key]);
  document.querySelectorAll(`[data-theme-key="${key}"]`).forEach(element => {
    if (element !== source) element.value = normalized;
  });
  const swatch = document.querySelector(`[data-theme-swatch="${key}"]`);
  if (swatch) swatch.style.background = normalized;
}

export function populateThemeForm(config = state.themeConfig) {
  renderThemeControls();
  const colors = normalizeThemeConfig(config);
  Object.entries(colors).forEach(([key, value]) => syncPair(key, value));
  applyThemeConfig(colors);
}

function getSavedEditorScope() {
  const stored = localStorage.getItem(THEME_SCOPE_STORAGE_KEY);
  if (stored === 'local' || stored === 'server') return stored;
  return state.localThemeConfig ? 'local' : 'server';
}

function getCurrentScope() {
  return document.querySelector('input[name="theme-save-scope"]:checked')?.value || getSavedEditorScope();
}

function getScopeBaseConfig(scope) {
  if (scope === 'local') {
    return state.localThemeConfig || state.themeConfig || state.serverThemeConfig || DEFAULT_THEME_CONFIG;
  }
  return state.serverThemeConfig || DEFAULT_THEME_CONFIG;
}

function updateScopeUi(scope = getCurrentScope()) {
  document.querySelectorAll('[data-theme-scope-card]').forEach(card => {
    card.classList.toggle('is-selected', card.dataset.themeScopeCard === scope);
  });

  const note = document.getElementById('theme-scope-note');
  const badge = document.getElementById('theme-source-badge');
  const clearButton = document.getElementById('theme-clear-local-btn');
  const saveButton = document.getElementById('theme-save-btn');
  const hasLocal = !!state.localThemeConfig;

  if (badge) {
    badge.textContent = hasLocal ? 'Paleta local activa' : 'Usando paleta del servidor';
    badge.classList.toggle('is-local', hasLocal);
  }

  if (note) {
    note.innerHTML = scope === 'local'
      ? '<strong>Solo este navegador:</strong> se guarda en este dispositivo y dominio. Nadie más verá estos colores.'
      : '<strong>Todo el servidor:</strong> se publica para todos los visitantes. Quienes tengan una paleta local seguirán viendo la suya.';
  }

  if (clearButton) {
    clearButton.classList.toggle('hidden', !hasLocal);
  }

  if (saveButton) {
    saveButton.textContent = scope === 'local'
      ? 'Guardar solo en este navegador'
      : 'Publicar colores para todos';
  }
}

function setEditorScope(scope, { populate = true, announce = false } = {}) {
  const normalizedScope = scope === 'local' ? 'local' : 'server';
  const radio = document.querySelector(`input[name="theme-save-scope"][value="${normalizedScope}"]`);
  if (radio) radio.checked = true;
  localStorage.setItem(THEME_SCOPE_STORAGE_KEY, normalizedScope);
  updateScopeUi(normalizedScope);

  if (populate) {
    populateThemeForm(getScopeBaseConfig(normalizedScope));
  }

  if (announce) {
    showToast(
      normalizedScope === 'local'
        ? 'Edición cambiada a este navegador'
        : 'Edición cambiada a la paleta del servidor',
      'info',
    );
  }
}

async function saveTheme() {
  const errorBox = document.getElementById('theme-config-error');
  errorBox?.classList.add('hidden');

  const scope = getCurrentScope();
  const value = readForm();

  if (scope === 'local') {
    const stored = saveLocalThemeOverride(value);
    state.localThemeConfig = stored;
    state.themeConfig = stored;
    applyThemeConfig(stored);
    updateScopeUi('local');
    showToast('Colores guardados solo en este navegador', 'success');
    return;
  }

  if (!state.adminCode) {
    if (errorBox) {
      errorBox.textContent = 'Tu sesión de administrador expiró.';
      errorBox.classList.remove('hidden');
    }
    return;
  }

  const { error } = await supabaseClient.rpc('update_app_setting', {
    input_code: state.adminCode,
    input_key: 'theme_config',
    input_value: value,
  });

  if (error) {
    if (errorBox) {
      errorBox.textContent = `Error: ${error.message}`;
      errorBox.classList.remove('hidden');
    }
    return;
  }

  state.serverThemeConfig = value;
  state.themeConfig = value;
  applyThemeConfig(value);
  showToast(
    state.localThemeConfig
      ? 'Paleta global publicada. Este navegador conserva su paleta local al recargar.'
      : 'Colores publicados para todos',
    'success',
  );
}

function clearBrowserTheme() {
  clearLocalThemeOverride();
  state.localThemeConfig = null;
  state.themeConfig = normalizeThemeConfig(state.serverThemeConfig || {});
  setEditorScope('server', { populate: true });
  showToast('Este navegador vuelve a usar los colores del servidor', 'success');
}

function bindScopeControls() {
  document.querySelectorAll('input[name="theme-save-scope"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      setEditorScope(input.value, { populate: true, announce: true });
    });
  });

  document.getElementById('theme-clear-local-btn')?.addEventListener('click', clearBrowserTheme);
}

export function initThemeTool() {
  renderThemeControls();
  const grid = document.getElementById('theme-color-grid');
  if (!grid) return;

  grid.addEventListener('input', event => {
    const element = event.target.closest('[data-theme-key]');
    if (!element) return;
    const key = element.dataset.themeKey;

    if (element.type === 'color') {
      syncPair(key, element.value, element);
      applyThemeConfig(readForm());
      return;
    }

    if (HEX_RE.test(element.value.trim())) {
      element.classList.remove('input-error');
      syncPair(key, element.value, element);
      applyThemeConfig(readForm());
    } else {
      element.classList.add('input-error');
    }
  });

  bindScopeControls();

  document.getElementById('theme-save-btn')?.addEventListener('click', saveTheme);
  document.getElementById('theme-reset-btn')?.addEventListener('click', () => {
    populateThemeForm(DEFAULT_THEME_CONFIG);
    showToast('Paleta original cargada. Guarda para aplicarla en el alcance elegido.', 'info');
  });
  document.getElementById('theme-revert-btn')?.addEventListener('click', () => {
    populateThemeForm(getScopeBaseConfig(getCurrentScope()));
    showToast('Cambios sin guardar descartados', 'info');
  });

  setEditorScope(getSavedEditorScope(), { populate: true });

  window.addEventListener('storage', event => {
    if (event.key !== LOCAL_THEME_STORAGE_KEY) return;
    state.localThemeConfig = getLocalThemeOverride();
    if (getCurrentScope() === 'local') {
      state.themeConfig = state.localThemeConfig || normalizeThemeConfig(state.serverThemeConfig || {});
      populateThemeForm(state.themeConfig);
    }
    updateScopeUi();
  });
}

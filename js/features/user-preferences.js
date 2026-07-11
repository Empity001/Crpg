// =========================================================
// user-preferences.js
// =========================================================
// Preferencias visuales de cada visitante. Se guardan únicamente en
// localStorage y nunca modifican la configuración global de Supabase.
// =========================================================

const STORAGE_KEY = 'culones_user_preferences_v1';
const DEFAULT_PREFERENCES = Object.freeze({ showCustomBackground: true });

let initialized = false;
let controller = null;

function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { ...DEFAULT_PREFERENCES, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

function savePreferences(preferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch (error) {
    console.warn('[VisitorPreferences] No se pudo guardar la preferencia local:', error);
  }
}

function applyPreferences(preferences = readPreferences()) {
  document.documentElement.classList.toggle('user-background-disabled', preferences.showCustomBackground === false);
  const toggle = document.getElementById('visitor-background-toggle');
  if (toggle) toggle.checked = preferences.showCustomBackground !== false;
}

function setPanelOpen(open) {
  const panel = document.getElementById('visitor-settings-panel');
  const button = document.getElementById('visitor-settings-toggle');
  if (!panel || !button) return;
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

export function initUserPreferences() {
  applyPreferences();
  if (initialized) return;

  const button = document.getElementById('visitor-settings-toggle');
  const panel = document.getElementById('visitor-settings-panel');
  const close = document.getElementById('visitor-settings-close');
  const toggle = document.getElementById('visitor-background-toggle');
  if (!button || !panel || !toggle) return;

  initialized = true;
  controller = new AbortController();
  const { signal } = controller;

  button.addEventListener('click', event => {
    event.stopPropagation();
    setPanelOpen(!panel.classList.contains('is-open'));
  }, { signal });

  close?.addEventListener('click', () => setPanelOpen(false), { signal });

  toggle.addEventListener('change', () => {
    const preferences = readPreferences();
    preferences.showCustomBackground = toggle.checked;
    savePreferences(preferences);
    applyPreferences(preferences);
  }, { signal });

  document.addEventListener('pointerdown', event => {
    if (!panel.classList.contains('is-open')) return;
    if (panel.contains(event.target) || button.contains(event.target)) return;
    setPanelOpen(false);
  }, { signal });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setPanelOpen(false);
  }, { signal });

  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) applyPreferences();
  }, { signal });

  window.addEventListener('pagehide', () => destroyUserPreferences(), { once: true, signal });
}

export function destroyUserPreferences() {
  controller?.abort();
  controller = null;
  initialized = false;
}

// Aplica la preferencia incluso antes de que el shell termine de enlazar
// controles. La llamada posterior a initUserPreferences sincroniza el UI.
applyPreferences();

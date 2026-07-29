import { supabaseClient } from './api.js';

let site = null;

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function breakpoint() {
  if (window.matchMedia('(max-width: 680px)').matches) return 'mobile';
  if (window.matchMedia('(max-width: 980px)').matches) return 'tablet';
  return 'desktop';
}

function safeNavigationUrl(value) {
  const raw = String(value || '#').trim();
  if (raw.startsWith('//')) return '#';
  try {
    const parsed = new URL(raw, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch {
    return '#';
  }
}

export function applyTheme(config = {}) {
  const palette = config?.palette || {};
  const root = document.documentElement;
  root.style.setProperty('--site-bg', safeHex(palette.background, '#050505'));
  root.style.setProperty('--site-surface', safeHex(palette.surface, '#101010'));
  root.style.setProperty('--site-text', safeHex(palette.text, '#ffffff'));
  root.style.setProperty('--site-muted', safeHex(palette.muted, '#a3a3a3'));
  root.style.setProperty('--site-accent', safeHex(palette.accent, '#ffffff'));
}

export function applyNavigation(config = {}) {
  const nav = document.getElementById('instance-nav');
  const header = document.getElementById('instance-header');
  const anchor = document.getElementById('instance-nav-anchor');
  const main = document.getElementById('instance-main');
  const title = document.getElementById('instance-name');
  const toggle = document.getElementById('instance-nav-toggle');
  if (!nav || !header || !anchor || !main || !title || !toggle) return;
  const current = config[breakpoint()] || {};
  const position = current.visible === false ? 'hidden' : (current.position || 'top');
  header.dataset.navPosition = position;
  document.body.dataset.navPosition = position;
  document.body.classList.remove('instance-nav-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.classList.toggle('hidden', position !== 'drawer');
  nav.classList.toggle('hidden', position === 'hidden');
  nav.classList.toggle('is-hero', position === 'hero');
  nav.dataset.alignment = current.alignment || 'center';
  const searchButton = document.getElementById('instance-search-button');
  const searchAnchor = document.getElementById('instance-search-anchor');
  if (searchButton && searchAnchor && nav.contains(searchButton)) {
    searchAnchor.insertAdjacentElement('afterend', searchButton);
  }
  if (position === 'hero') main.insertBefore(nav, title);
  else anchor.insertAdjacentElement('afterend', nav);
  nav.replaceChildren();
  for (const item of Array.isArray(config.items) ? config.items : []) {
    const anchor = document.createElement('a');
    anchor.textContent = String(item.label || item.key || 'Página');
    anchor.href = safeNavigationUrl(item.url);
    nav.append(anchor);
  }
}

export function applySearch(config = {}) {
  const button = document.getElementById('instance-search-button');
  const input = document.getElementById('instance-search-input');
  const anchor = document.getElementById('instance-search-anchor');
  const nav = document.getElementById('instance-nav');
  const main = document.getElementById('instance-main');
  const title = document.getElementById('instance-name');
  const enabled = config.enabled !== false && config.position !== 'hidden';
  let position = enabled ? (config.position || 'header') : 'hidden';
  if (position === 'navigation' && document.body.dataset.navPosition === 'hidden') position = 'header';
  if (!button || !anchor || !nav || !main || !title) return;
  document.body.dataset.searchPosition = position;
  button.dataset.searchPosition = position;
  button?.classList.toggle('hidden', !enabled);
  if (position === 'navigation') nav.append(button);
  else if (position === 'hero') main.insertBefore(button, title.nextSibling);
  else if (position === 'block') main.append(button);
  else anchor.insertAdjacentElement('afterend', button);
  if (input) input.placeholder = String(config.placeholder || 'Buscar…');
}

function showFailure(message) {
  document.getElementById('instance-name').textContent = 'Instancia no disponible';
  document.getElementById('instance-description').textContent = message;
}

async function boot() {
  const slug = new URLSearchParams(window.location.search).get('site') || '';
  if (!slug) {
    showFailure('No se indicó qué instancia abrir.');
    return;
  }
  const { data, error } = await supabaseClient.from('sites')
    .select('id,slug,name,description,status,theme_config,navigation_config,search_config')
    .eq('slug', slug).eq('status', 'active').maybeSingle();
  if (error || !data) {
    showFailure('La instancia no existe, no está publicada o todavía no se aplicó la migración de Empi Network.');
    return;
  }
  site = data;
  document.title = `${site.name} · Empi Network`;
  document.getElementById('instance-name').textContent = site.name;
  document.getElementById('instance-description').textContent = site.description || '';
  applyTheme(site.theme_config);
  applyNavigation(site.navigation_config);
  applySearch(site.search_config);

  document.getElementById('instance-search-button')?.addEventListener('click', () => {
    document.getElementById('instance-search')?.classList.remove('hidden');
    document.getElementById('instance-search-input')?.focus();
  });
  document.getElementById('instance-search-close')?.addEventListener('click', () => document.getElementById('instance-search')?.classList.add('hidden'));
  document.getElementById('instance-nav-toggle')?.addEventListener('click', event => {
    const open = document.body.classList.toggle('instance-nav-open');
    event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    document.body.classList.remove('instance-nav-open');
    document.getElementById('instance-nav-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('instance-search')?.classList.add('hidden');
  });
  window.addEventListener('resize', () => {
    applyNavigation(site.navigation_config);
    applySearch(site.search_config);
  });
}

// API pequeña para la vista previa del panel Owner y las pruebas responsive.
// Solo modifica presentación local; no concede acceso ni escribe en Supabase.
window.EmpiInstanceRenderer = Object.freeze({ applyTheme, applyNavigation, applySearch });

void boot();

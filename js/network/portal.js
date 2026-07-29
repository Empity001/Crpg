import { listPublicSites } from './api.js';
import { initializeNetworkSession, setNetworkMode, signInNetwork, signOutNetwork } from './session.js';

const fallbackSites = [{
  id: '00000000-0000-4000-8000-000000000001',
  slug: 'culones-rpg',
  name: 'Culones RPG',
  description: 'Servidor RPG/Gacha y primera instancia de Empi Network.',
  status: 'active',
  public_base_url: 'logs.html',
}];

let sites = [];
let toastTimer = null;

function showToast(message, error = false) {
  const toast = document.getElementById('network-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3600);
}

function siteUrl(site) {
  if (site.slug === 'culones-rpg') return 'logs.html';
  const fallback = `site.html?site=${encodeURIComponent(site.slug)}`;
  if (!site.public_base_url) return fallback;
  try {
    const parsed = new URL(site.public_base_url, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

function siteInitials(name) {
  return String(name || 'EN').split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
}

function renderSites(query = '') {
  const grid = document.getElementById('network-site-grid');
  const empty = document.getElementById('network-sites-empty');
  if (!grid) return;
  const normalized = query.trim().toLocaleLowerCase('es');
  const filtered = sites.filter(site => `${site.name} ${site.description} ${site.slug}`.toLocaleLowerCase('es').includes(normalized));
  grid.replaceChildren();
  for (const site of filtered) {
    const card = document.createElement('a');
    card.className = 'network-site-card';
    card.href = siteUrl(site);
    const head = document.createElement('div');
    head.className = 'network-site-card-head';
    const type = document.createElement('span');
    type.textContent = 'COMUNIDAD MINECRAFT';
    const status = document.createElement('span');
    status.textContent = site.status === 'active' ? 'ACTIVA' : String(site.status || '').toUpperCase();
    head.append(type, status);
    const mark = document.createElement('span');
    mark.className = 'network-site-card-mark';
    mark.textContent = siteInitials(site.name);
    const title = document.createElement('h3');
    title.textContent = site.name;
    const description = document.createElement('p');
    description.textContent = site.description || 'Entrar a esta comunidad.';
    const foot = document.createElement('div');
    foot.className = 'network-site-card-foot';
    const slug = document.createElement('span');
    slug.textContent = site.slug;
    const arrow = document.createElement('span');
    arrow.textContent = 'ENTRAR →';
    foot.append(slug, arrow);
    card.append(head, mark, title, description, foot);
    grid.append(card);
  }
  empty?.classList.toggle('hidden', filtered.length > 0);
}

function applySession(state) {
  const login = document.getElementById('network-login-btn');
  const modeWrap = document.getElementById('network-mode-wrap');
  const modeSelect = document.getElementById('network-mode-select');
  const ownerLink = document.getElementById('owner-panel-link');
  if (login) login.textContent = state.session ? (state.profile?.displayName || state.profile?.username || 'Cuenta') : 'Conectar Discord';
  if (login) login.dataset.logged = String(!!state.session);
  modeWrap?.classList.toggle('hidden', !state.isOwner);
  if (modeSelect) modeSelect.value = state.mode;
  ownerLink?.classList.toggle('hidden', !state.isOwner || state.mode !== 'platform_owner');
  document.body.dataset.accountMode = state.mode;
}

async function loadSites() {
  try {
    sites = await listPublicSites();
    if (!sites.length) sites = fallbackSites;
  } catch (error) {
    // La migración 025 puede no estar desplegada todavía. Culones sigue
    // accesible y la portada explica el estado sin quedar rota.
    console.warn('[Empi Network] Catálogo remoto no disponible:', error);
    sites = fallbackSites;
  }
  renderSites();
}

async function boot() {
  await loadSites();
  try {
    const state = await initializeNetworkSession();
    applySession(state);
  } catch (error) {
    console.warn('[Empi Network] Sesión central no disponible:', error);
  }

  document.getElementById('network-search-toggle')?.addEventListener('click', () => {
    const search = document.getElementById('network-search');
    search?.classList.toggle('hidden');
    if (!search?.classList.contains('hidden')) document.getElementById('network-search-input')?.focus();
  });
  document.getElementById('network-search-input')?.addEventListener('input', event => renderSites(event.target.value));
  document.getElementById('network-mode-select')?.addEventListener('change', event => {
    const mode = setNetworkMode(event.target.value);
    const login = document.getElementById('network-login-btn');
    applySession({ mode, isOwner: true, session: login?.dataset.logged === 'true', profile: null });
    if (mode === 'platform_owner') showToast('Modo Owner activo.');
  });
  document.getElementById('network-login-btn')?.addEventListener('click', async () => {
    const button = document.getElementById('network-login-btn');
    if (button?.dataset.logged === 'true') {
      await signOutNetwork();
      window.location.reload();
      return;
    }
    try { await signInNetwork(); } catch (error) { showToast(error.message, true); }
  });
  document.addEventListener('empi:network-session', event => applySession(event.detail));
}

void boot();

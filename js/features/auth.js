// =========================================================
// auth.js
// Inicio de sesión con Discord mediante Supabase Auth y control del modo
// administrador. El rol se valida en una Edge Function segura.
// =========================================================

import { OFFICIAL_SITE_URL, supabaseClient } from '../config.js';
import { getDiscordAdminStatus } from '../core/admin-api.js';
import { isAdmin, state } from '../core/state.js';
import { showToast } from '../core/utils.js';

const adminUiRefreshHandlers = new Set();
const ROLE_RECHECK_MS = 3 * 60 * 1000;
let initialized = false;
let validationPromise = null;
let authSubscription = null;
let visibilityHandler = null;

function setAdminMode(enabled) {
  const next = !!(enabled && state.discordAdminEligible && state.authSession);
  state.adminMode = next;
  if (next) sessionStorage.setItem('culones_admin_mode', '1');
  else sessionStorage.removeItem('culones_admin_mode');
}

function resetIdentity() {
  state.authSession = null;
  state.discordProfile = null;
  state.discordAdminEligible = false;
  state.discordMembership = 'unknown';
  state.discordAuthCheckedAt = 0;
  setAdminMode(false);
}

function profileName(profile) {
  return profile?.displayName || profile?.globalName || profile?.username || 'Cuenta de Discord';
}

function updateAccountModal() {
  const profile = state.discordProfile;
  const loggedIn = !!state.authSession;
  const avatar = document.getElementById('discord-account-avatar');
  const name = document.getElementById('discord-account-name');
  const status = document.getElementById('discord-account-status');
  const login = document.getElementById('discord-login-btn');
  const logout = document.getElementById('discord-logout-btn');
  const toggle = document.getElementById('discord-admin-mode-btn');
  const error = document.getElementById('discord-auth-error');

  if (avatar) {
    avatar.src = profile?.avatarUrl || '';
    avatar.classList.toggle('hidden', !profile?.avatarUrl);
  }
  if (name) name.textContent = loggedIn ? profileName(profile) : 'Discord no conectado';
  if (status) {
    if (!loggedIn) status.textContent = 'Conecta tu cuenta para identificarte en la página.';
    else if (state.discordAdminEligible) status.textContent = isAdmin() ? 'Modo administrador activo.' : 'Tu cuenta tiene el rol administrativo.';
    else if (state.discordMembership === 'not_member') status.textContent = 'Esta cuenta no pertenece actualmente al servidor.';
    else status.textContent = 'Sesión normal: esta cuenta no tiene el rol administrativo.';
  }
  login?.classList.toggle('hidden', loggedIn);
  logout?.classList.toggle('hidden', !loggedIn);
  toggle?.classList.toggle('hidden', !loggedIn || !state.discordAdminEligible);
  if (toggle) toggle.textContent = isAdmin() ? 'Desactivar modo administrador' : 'Activar modo administrador';
  error?.classList.add('hidden');
}

function showAuthError(message) {
  const box = document.getElementById('discord-auth-error');
  if (box) {
    box.textContent = message;
    box.classList.remove('hidden');
  }
}

export function registerAdminUiRefreshHandler(handler) {
  if (typeof handler === 'function') adminUiRefreshHandlers.add(handler);
}

export function updateAdminUI() {
  const dot = document.getElementById('admin-dot');
  const badge = document.getElementById('admin-mode-badge');
  const label = document.getElementById('admin-toggle-label');
  const sublabel = document.getElementById('admin-toggle-sublabel');
  const subtitle = document.getElementById('hud-subtitle');
  const mobileIndicator = document.getElementById('mobile-admin-indicator');
  const accountAvatar = document.getElementById('sidebar-account-avatar');
  const accountName = document.getElementById('sidebar-account-name');
  const accountWrap = document.getElementById('sidebar-account');
  const admin = isAdmin();
  const loggedIn = !!state.authSession;
  const eligible = !!state.discordAdminEligible;

  if (dot) dot.className = admin ? 'dot-online' : 'dot-offline';
  badge?.classList.toggle('hidden', !admin);
  mobileIndicator?.classList.toggle('hidden', !admin);
  document.body?.classList.toggle('is-admin-mode', admin);
  document.body?.classList.toggle('has-discord-session', loggedIn);

  if (label) {
    if (!loggedIn) label.textContent = 'Iniciar sesión con Discord';
    else if (!eligible) label.textContent = profileName(state.discordProfile);
    else label.textContent = admin ? 'Desactivar Modo Admin' : 'Activar Modo Admin';
  }
  if (sublabel) {
    if (!loggedIn) sublabel.textContent = 'Cuenta y acceso administrativo';
    else if (!eligible) sublabel.textContent = 'Sesión de visitante';
    else sublabel.textContent = admin ? 'Edición habilitada' : 'Rol administrativo verificado';
  }
  if (subtitle) subtitle.textContent = admin ? 'Panel de Administración' : 'Página oficial';
  if (accountName) accountName.textContent = loggedIn ? profileName(state.discordProfile) : '';
  if (accountAvatar) {
    accountAvatar.src = state.discordProfile?.avatarUrl || '';
    accountAvatar.classList.toggle('hidden', !state.discordProfile?.avatarUrl);
  }
  accountWrap?.classList.toggle('hidden', !loggedIn);

  const adminOnlyIds = [
    'open-new-log-btn', 'open-field-config-btn', 'open-action-log-btn',
    'open-new-tier-row-btn', 'open-new-tier-item-btn', 'admin-panel-tab',
    'open-new-weapon-btn', 'open-weapon-category-manage-btn', 'open-weapon-type-manage-btn',
    'open-new-kit-btn', 'about-admin-toolbar',
  ];
  adminOnlyIds.forEach(id => document.getElementById(id)?.classList.toggle('hidden', !admin));

  if (!admin && state.activeTab === 'admin') {
    window.location.href = 'index.html';
    return;
  }

  updateAccountModal();
  adminUiRefreshHandlers.forEach(handler => handler(admin));
  document.dispatchEvent(new CustomEvent('culones:admin-state-changed', {
    detail: { admin, loggedIn, eligible, profile: state.discordProfile },
  }));
}

export async function signInWithDiscord() {
  const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const safeRedirect = window.location.origin === new URL(OFFICIAL_SITE_URL).origin ? redirectTo : OFFICIAL_SITE_URL;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: safeRedirect, scopes: 'identify email' },
  });
  if (error) {
    showAuthError(`No se pudo iniciar sesión con Discord: ${error.message}`);
    throw error;
  }
}

export async function logoutDiscord() {
  setAdminMode(false);
  const { error } = await supabaseClient.auth.signOut();
  resetIdentity();
  updateAdminUI();
  if (error) showToast(`La sesión local se cerró, pero Discord respondió: ${error.message}`, 'error');
  else showToast('Sesión de Discord cerrada');
}

export async function revalidateDiscordAccess({ force = false, silent = false, reason = 'manual' } = {}) {
  if (!state.authSession) {
    resetIdentity();
    updateAdminUI();
    return { isAdmin: false, reason: 'no_session' };
  }
  const now = Date.now();
  if (!force && now - state.discordAuthCheckedAt < ROLE_RECHECK_MS) {
    return { isAdmin: state.discordAdminEligible, profile: state.discordProfile, cached: true };
  }
  if (validationPromise) return validationPromise;

  validationPromise = (async () => {
    const { data, error } = await getDiscordAdminStatus();
    if (error) {
      state.discordAdminEligible = false;
      state.discordMembership = 'unknown';
      setAdminMode(false);
      updateAdminUI();
      if (!silent) showToast(`No se pudo verificar tu rol: ${error.message}`, 'error');
      return { isAdmin: false, error, reason };
    }

    state.discordProfile = data?.profile || null;
    state.discordAdminEligible = !!data?.isAdmin;
    state.discordMembership = data?.isMember ? 'member' : 'not_member';
    state.discordAuthCheckedAt = now;
    if (!state.discordAdminEligible) setAdminMode(false);
    updateAdminUI();
    return data;
  })().finally(() => { validationPromise = null; });

  return validationPromise;
}

export async function toggleAdminMode() {
  if (!state.authSession) {
    openAdminLoginModal();
    return;
  }
  if (isAdmin()) {
    setAdminMode(false);
    updateAdminUI();
    showToast('Modo administrador desactivado');
    return;
  }
  const result = await revalidateDiscordAccess({ force: true, reason: 'toggle' });
  if (!result?.isAdmin) {
    openAdminLoginModal();
    showAuthError(result?.error?.message || 'Tu cuenta no tiene el rol administrativo configurado.');
    return;
  }
  setAdminMode(true);
  updateAdminUI();
  showToast('Modo administrador activado', 'success');
}

export function openAdminLoginModal() {
  updateAccountModal();
  document.getElementById('admin-modal')?.classList.remove('hidden');
}

export function closeAdminLoginModal() {
  document.getElementById('admin-modal')?.classList.add('hidden');
  document.getElementById('discord-auth-error')?.classList.add('hidden');
}

// Alias de compatibilidad temporal para módulos que importaban los nombres
// antiguos. Ya no aceptan ni validan códigos.
export function prepareAdminLoginModal() { updateAccountModal(); }
export function skipAdminLoginIntro() { return false; }
export function submitAdminCode() { return signInWithDiscord(); }
export function logoutAdmin() { return toggleAdminMode(); }

export async function initializeDiscordAuth() {
  if (initialized) return;
  initialized = true;
  const { data: { session }, error } = await supabaseClient.auth.getSession();
  if (error) console.warn('[Auth] No se pudo recuperar la sesión:', error.message);
  state.authSession = session || null;
  if (!session) resetIdentity();
  else await revalidateDiscordAccess({ force: true, silent: true, reason: 'page_load' });
  updateAdminUI();

  const listener = supabaseClient.auth.onAuthStateChange((_event, nextSession) => {
    state.authSession = nextSession || null;
    if (!nextSession) {
      resetIdentity();
      updateAdminUI();
    } else {
      queueMicrotask(() => void revalidateDiscordAccess({ force: true, silent: true, reason: 'auth_change' }));
    }
  });
  authSubscription = listener?.data?.subscription || null;

  visibilityHandler = () => {
    if (document.visibilityState !== 'visible' || !state.authSession) return;
    void revalidateDiscordAccess({ force: false, silent: true, reason: 'visibility' });
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

export function destroyDiscordAuth() {
  authSubscription?.unsubscribe?.();
  authSubscription = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  initialized = false;
}

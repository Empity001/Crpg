// =========================================================
// auth.js
// Inicio de sesión con Discord mediante Supabase Auth y control del modo
// administrador. El rol se valida en una Edge Function segura.
// =========================================================

import { OFFICIAL_SITE_URL, getAdminCode, setAdminCode, supabaseClient } from '../config.js';
import { getDiscordAdminStatus } from '../core/admin-api.js';
import { isAdmin, state } from '../core/state.js';
import { showToast } from '../core/utils.js';

const adminUiRefreshHandlers = new Set();
const ROLE_RECHECK_MS = 3 * 60 * 1000;
const AUTH_STATUS_CACHE_KEY = 'culones_discord_status_cache_v1';
let initialized = false;
let validationPromise = null;
let authSubscription = null;
let visibilityHandler = null;
let authInitializationPromise = null;
let lastObservedSessionToken = null;
let adminTogglePromise = null;
let lastAdminUiNotificationKey = '';


function clearCachedDiscordStatus() {
  try { sessionStorage.removeItem(AUTH_STATUS_CACHE_KEY); } catch { /* almacenamiento no disponible */ }
}

function readCachedDiscordStatus(session) {
  if (!session?.user?.id) return false;
  try {
    const cached = JSON.parse(sessionStorage.getItem(AUTH_STATUS_CACHE_KEY) || 'null');
    const checkedAt = Number(cached?.checkedAt || 0);
    if (!cached || cached.userId !== session.user.id || Date.now() - checkedAt >= ROLE_RECHECK_MS) return false;
    state.discordProfile = cached.profile || null;
    state.discordAdminEligible = !!cached.isAdmin;
    state.discordMembership = cached.isMember ? 'member' : 'not_member';
    state.discordAuthCheckedAt = checkedAt;
    return true;
  } catch {
    return false;
  }
}

function cacheDiscordStatus(data, session = state.authSession) {
  if (!session?.user?.id) return;
  try {
    sessionStorage.setItem(AUTH_STATUS_CACHE_KEY, JSON.stringify({
      userId: session.user.id,
      isAdmin: !!data?.isAdmin,
      isMember: !!data?.isMember,
      profile: data?.profile || null,
      checkedAt: state.discordAuthCheckedAt || Date.now(),
    }));
  } catch { /* almacenamiento no disponible */ }
}

// Una identidad administrativa puede venir del rol de Discord o del código de acceso.
function hasAdminIdentity() {
  return !!(state.codeAdmin || (state.discordAdminEligible && state.authSession));
}

function setAdminMode(enabled) {
  const next = !!(enabled && hasAdminIdentity());
  state.adminMode = next;
  if (next) sessionStorage.setItem('culones_admin_mode', '1');
  else sessionStorage.removeItem('culones_admin_mode');
}

function resetIdentity({ clearCache = true } = {}) {
  state.authSession = null;
  state.discordProfile = null;
  state.discordAdminEligible = false;
  state.discordMembership = 'unknown';
  state.discordAuthCheckedAt = 0;
  if (!state.codeAdmin) setAdminMode(false);
  if (clearCache) clearCachedDiscordStatus();
}

function profileName(profile) {
  return profile?.displayName || profile?.globalName || profile?.username || 'Cuenta de Discord';
}

function updateAccountModal() {
  const profile = state.discordProfile;
  const loggedIn = !!state.authSession;
  const viaCode = !!state.codeAdmin;
  const avatar = document.getElementById('discord-account-avatar');
  const name = document.getElementById('discord-account-name');
  const status = document.getElementById('discord-account-status');
  const login = document.getElementById('discord-login-btn');
  const logout = document.getElementById('discord-logout-btn');
  const toggle = document.getElementById('discord-admin-mode-btn');
  const codeForm = document.getElementById('admin-code-form');
  const codeLogout = document.getElementById('admin-code-logout-btn');
  const error = document.getElementById('discord-auth-error');

  if (avatar) {
    avatar.src = profile?.avatarUrl || '';
    avatar.classList.toggle('hidden', !profile?.avatarUrl);
  }
  if (name) name.textContent = loggedIn ? profileName(profile) : (viaCode ? 'Administrador' : 'Discord no conectado');
  if (status) {
    if (!loggedIn && viaCode) status.textContent = isAdmin() ? 'Modo administrador activo (acceso por código).' : 'Acceso por código verificado.';
    else if (!loggedIn) status.textContent = 'Conecta tu cuenta para identificarte en la página.';
    else if (state.discordAdminEligible) status.textContent = isAdmin() ? 'Modo administrador activo.' : 'Tu cuenta tiene el rol administrativo.';
    else if (state.discordMembership === 'not_member') status.textContent = 'Esta cuenta no pertenece actualmente al servidor.';
    else status.textContent = 'Sesión normal: esta cuenta no tiene el rol administrativo.';
  }
  login?.classList.toggle('hidden', loggedIn);
  logout?.classList.toggle('hidden', !loggedIn);
  toggle?.classList.toggle('hidden', !hasAdminIdentity());
  codeForm?.classList.toggle('hidden', viaCode);
  codeLogout?.classList.toggle('hidden', !viaCode);
  if (toggle) toggle.textContent = isAdmin() ? 'Desactivar modo administrador' : 'Activar modo administrador';
  error?.classList.add('hidden');
}

function setAdminToggleBusy(busy) {
  const controls = [
    document.getElementById('admin-toggle-btn'),
    document.getElementById('discord-admin-mode-btn'),
  ].filter(Boolean);

  controls.forEach(control => {
    control.disabled = !!busy;
    control.classList.toggle('is-busy', !!busy);
    control.setAttribute('aria-busy', busy ? 'true' : 'false');
  });

  const modalToggle = document.getElementById('discord-admin-mode-btn');
  if (modalToggle) {
    if (busy) {
      modalToggle.dataset.idleText = modalToggle.dataset.idleText || modalToggle.textContent;
      modalToggle.textContent = 'Verificando acceso…';
    } else if (modalToggle.dataset.idleText) {
      modalToggle.textContent = modalToggle.dataset.idleText;
      delete modalToggle.dataset.idleText;
    }
  }
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
  const accountFallback = document.getElementById('sidebar-account-fallback');
  const accountWrap = document.getElementById('sidebar-account');
  const accountAction = document.getElementById('admin-toggle-action');
  const accountManage = document.getElementById('sidebar-account-manage-btn');
  const admin = isAdmin();
  const loggedIn = !!state.authSession;
  const viaCode = !!state.codeAdmin;
  const eligible = viaCode || !!state.discordAdminEligible;
  const notificationKey = JSON.stringify({
    admin,
    loggedIn,
    viaCode,
    eligible,
    membership: state.discordMembership,
    userId: state.authSession?.user?.id || null,
    discordId: state.discordProfile?.discordId || null,
    displayName: state.discordProfile?.displayName || null,
    avatarUrl: state.discordProfile?.avatarUrl || null,
  });

  if (dot) dot.className = admin ? 'dot-online' : 'dot-offline';
  badge?.classList.toggle('hidden', !admin);
  mobileIndicator?.classList.toggle('hidden', !admin);
  document.body?.classList.toggle('is-admin-mode', admin);
  document.body?.classList.toggle('has-discord-session', loggedIn);
  document.body?.classList.toggle('has-admin-role', eligible);
  accountWrap?.classList.toggle('is-connected', loggedIn);
  accountWrap?.classList.toggle('is-eligible', eligible);
  accountWrap?.classList.toggle('is-active', admin);

  if (label) {
    if (loggedIn) label.textContent = profileName(state.discordProfile);
    else label.textContent = viaCode ? 'Administrador' : 'Iniciar sesión';
  }
  if (sublabel) {
    if (!loggedIn && viaCode) sublabel.textContent = admin ? 'Acceso por código · Edición activa' : 'Acceso por código verificado';
    else if (!loggedIn) sublabel.textContent = 'Discord y administración';
    else if (!eligible && state.discordMembership === 'not_member') sublabel.textContent = 'Cuenta fuera del servidor';
    else if (!eligible) sublabel.textContent = 'Sesión de visitante';
    else sublabel.textContent = admin ? 'Rol verificado · Edición activa' : 'Rol administrativo verificado';
  }
  if (accountAction) {
    if (!loggedIn && !viaCode) accountAction.textContent = 'Conectar cuenta';
    else if (!eligible) accountAction.textContent = 'Revisar acceso';
    else accountAction.textContent = admin ? 'Desactivar edición' : 'Activar edición';
  }
  if (subtitle) subtitle.textContent = admin ? 'Panel de Administración' : 'Página oficial';
  if (accountAvatar) {
    accountAvatar.src = state.discordProfile?.avatarUrl || '';
    accountAvatar.classList.toggle('hidden', !state.discordProfile?.avatarUrl);
  }
  accountFallback?.classList.toggle('hidden', !!state.discordProfile?.avatarUrl);
  accountManage?.classList.toggle('hidden', !loggedIn && !viaCode);

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
  // Varias rutas de autenticación pueden terminar casi al mismo tiempo
  // (getSession, onAuthStateChange y validación de Discord). El DOM se
  // sincroniza siempre, pero los renders pesados de cada página solo se
  // notifican cuando el estado visible realmente cambió.
  if (notificationKey === lastAdminUiNotificationKey) return;
  lastAdminUiNotificationKey = notificationKey;
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

function setCodeBusy(busy) {
  const submit = document.getElementById('admin-code-submit');
  const input = document.getElementById('admin-code-input');
  if (input) input.disabled = !!busy;
  if (submit) {
    submit.disabled = !!busy;
    submit.textContent = busy ? 'Verificando…' : 'Entrar';
  }
}

// Entra con el código de administrador. La Edge Function lo verifica en el servidor;
// aquí solo se guarda mientras la pestaña siga abierta.
export async function signInWithCode(rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) {
    showAuthError('Escribe el código de administrador.');
    return { ok: false };
  }
  const previous = getAdminCode();
  setAdminCode(code);
  setCodeBusy(true);
  const { data, error } = await getDiscordAdminStatus();
  setCodeBusy(false);
  if (error || !data?.isAdmin || !data?.viaCode) {
    setAdminCode(previous);
    showAuthError(error?.message || 'Ese código no es válido.');
    return { ok: false };
  }
  state.codeAdmin = true;
  setAdminMode(true);
  updateAdminUI();
  closeAdminLoginModal();
  showToast('Modo administrador activado', 'success');
  return { ok: true };
}

export function logoutAdminCode() {
  setAdminCode('');
  state.codeAdmin = false;
  if (!(state.discordAdminEligible && state.authSession)) setAdminMode(false);
  updateAdminUI();
  showToast('Acceso por código cerrado');
}

// Al cambiar de página el código sigue guardado en la pestaña: se vuelve a comprobar en segundo plano.
async function validateStoredAdminCode() {
  const { data, error } = await getDiscordAdminStatus();
  const rejected = ['CODE_INVALID', 'CODE_LOGIN_DISABLED'].includes(error?.code) || (!error && !data?.viaCode);
  if (!rejected) return;
  setAdminCode('');
  state.codeAdmin = false;
  if (!(state.discordAdminEligible && state.authSession)) setAdminMode(false);
  updateAdminUI();
  showToast('El código de administrador ya no es válido.', 'error');
}

export async function revalidateDiscordAccess({ force = false, silent = false, reason = 'manual', notifyUi = true } = {}) {
  if (!state.authSession) {
    resetIdentity();
    if (notifyUi) updateAdminUI();
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
      clearCachedDiscordStatus();
      state.discordAdminEligible = false;
      state.discordMembership = 'unknown';
      if (!state.codeAdmin) setAdminMode(false);
      if (notifyUi) updateAdminUI();
      if (!silent) showToast(`No se pudo verificar tu rol: ${error.message}`, 'error');
      return { isAdmin: false, error, reason };
    }

    state.discordProfile = data?.profile || null;
    state.discordAdminEligible = !!data?.isAdmin;
    state.discordMembership = data?.isMember ? 'member' : 'not_member';
    state.discordAuthCheckedAt = now;
    cacheDiscordStatus(data);
    if (!state.discordAdminEligible && !state.codeAdmin) setAdminMode(false);
    if (notifyUi) updateAdminUI();
    return data;
  })().finally(() => { validationPromise = null; });

  return validationPromise;
}

export async function toggleAdminMode() {
  if (adminTogglePromise) return adminTogglePromise;
  if (!state.authSession && !state.codeAdmin) {
    openAdminLoginModal();
    return;
  }
  if (isAdmin()) {
    setAdminMode(false);
    updateAdminUI();
    showToast('Modo administrador desactivado');
    return;
  }
  if (state.codeAdmin) {
    // El código ya se verificó en el servidor: activar la edición no necesita otra consulta.
    setAdminMode(true);
    updateAdminUI();
    showToast('Modo administrador activado', 'success');
    return;
  }

  adminTogglePromise = (async () => {
    setAdminToggleBusy(true);
    try {
      // Si el rol ya se comprobó recientemente, activar la interfaz no debe
      // esperar otra llamada a Discord. Las operaciones administrativas
      // continúan verificándose de forma segura en la Edge Function.
      const result = await revalidateDiscordAccess({
        force: false,
        reason: 'toggle',
        notifyUi: false,
      });
      if (!result?.isAdmin) {
        updateAdminUI();
        openAdminLoginModal();
        showAuthError(result?.error?.message || 'Tu cuenta no tiene el rol administrativo configurado.');
        return;
      }
      setAdminMode(true);
      updateAdminUI();
      showToast('Modo administrador activado', 'success');
    } finally {
      setAdminToggleBusy(false);
      updateAccountModal();
    }
  })().finally(() => { adminTogglePromise = null; });

  return adminTogglePromise;
}

export function openAdminLoginModal() {
  updateAccountModal();
  document.getElementById('admin-modal')?.classList.remove('hidden');
}

export function closeAdminLoginModal() {
  document.getElementById('admin-modal')?.classList.add('hidden');
  document.getElementById('discord-auth-error')?.classList.add('hidden');
}

export function prepareAdminLoginModal() { updateAccountModal(); }

export function initializeDiscordAuth({ awaitValidation = false } = {}) {
  if (authInitializationPromise) return authInitializationPromise;

  authInitializationPromise = (async () => {
    if (initialized) {
      if (awaitValidation && state.authSession) {
        await revalidateDiscordAccess({ force: false, silent: true, reason: 'page_resume' });
      }
      return;
    }

    initialized = true;
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error) console.warn('[Auth] No se pudo recuperar la sesión:', error.message);

    // El código guardado en esta pestaña se restaura antes de resetIdentity() para conservar el modo activo.
    if (getAdminCode()) state.codeAdmin = true;
    state.authSession = session || null;
    lastObservedSessionToken = session?.access_token || null;
    if (!session) resetIdentity();
    else readCachedDiscordStatus(session);
    updateAdminUI();
    if (state.codeAdmin) void validateStoredAdminCode();

    const listener = supabaseClient.auth.onAuthStateChange((event, nextSession) => {
      const nextToken = nextSession?.access_token || null;

      // Supabase emite INITIAL_SESSION justo después de registrar el listener.
      // La sesión ya se leyó arriba con getSession(), por lo que repetir aquí la
      // validación remota provocaba dos consultas consecutivas a Discord.
      if (event === 'INITIAL_SESSION' && nextToken === lastObservedSessionToken) return;

      const sessionChanged = nextToken !== lastObservedSessionToken;
      lastObservedSessionToken = nextToken;
      state.authSession = nextSession || null;

      if (!nextSession) {
        resetIdentity();
        updateAdminUI();
        return;
      }

      if (sessionChanged) readCachedDiscordStatus(nextSession);
      updateAdminUI();
      if (sessionChanged || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        queueMicrotask(() => void revalidateDiscordAccess({
          force: event === 'SIGNED_IN',
          silent: true,
          reason: `auth_${String(event || 'change').toLowerCase()}`,
        }));
      }
    });
    authSubscription = listener?.data?.subscription || null;

    visibilityHandler = () => {
      if (document.visibilityState !== 'visible' || !state.authSession) return;
      void revalidateDiscordAccess({ force: false, silent: true, reason: 'visibility' });
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    if (session) {
      const validation = revalidateDiscordAccess({ force: false, silent: true, reason: 'page_load' });
      if (awaitValidation) await validation;
      else void validation;
    }
  })().finally(() => {
    // Conservamos una promesa resuelta mientras la instancia siga inicializada.
    // Así varias páginas/módulos que llamen a la función comparten el mismo arranque.
    if (!initialized) authInitializationPromise = null;
  });

  return authInitializationPromise;
}

export function destroyDiscordAuth() {
  authSubscription?.unsubscribe?.();
  authSubscription = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  lastObservedSessionToken = null;
  initialized = false;
  authInitializationPromise = null;
  adminTogglePromise = null;
  lastAdminUiNotificationKey = '';
}

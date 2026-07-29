import { OFFICIAL_SITE_URL } from '../config.js';
import { networkApi, supabaseClient } from './api.js';

const MODE_KEY = 'empi_network_owner_mode_v1';
const MODES = new Set(['normal', 'site_admin_supreme', 'platform_owner']);

const sessionState = {
  session: null,
  profile: null,
  isOwner: false,
  modes: ['normal'],
  mode: 'normal',
};

function readMode() {
  try {
    const mode = localStorage.getItem(MODE_KEY) || 'normal';
    return MODES.has(mode) ? mode : 'normal';
  } catch {
    return 'normal';
  }
}

function saveMode(mode) {
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* almacenamiento no disponible */ }
}

async function refreshStatus() {
  if (!sessionState.session) {
    sessionState.profile = null;
    sessionState.isOwner = false;
    sessionState.modes = ['normal'];
    sessionState.mode = 'normal';
    return sessionState;
  }
  const status = await networkApi('status');
  sessionState.profile = status?.profile || null;
  sessionState.isOwner = !!status?.isOwner;
  sessionState.modes = Array.isArray(status?.modes) ? status.modes : ['normal'];
  const preferred = readMode();
  sessionState.mode = sessionState.isOwner && sessionState.modes.includes(preferred) ? preferred : 'normal';
  return sessionState;
}

export async function initializeNetworkSession({ watch = true } = {}) {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  sessionState.session = data?.session || null;
  await refreshStatus();
  if (watch) {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
      sessionState.session = session || null;
      void refreshStatus().then(() => {
        document.dispatchEvent(new CustomEvent('empi:network-session', { detail: { ...sessionState } }));
      });
    });
  }
  return { ...sessionState };
}

export function getNetworkSession() {
  return { ...sessionState };
}

export function setNetworkMode(mode) {
  const next = MODES.has(mode) && sessionState.isOwner && sessionState.modes.includes(mode) ? mode : 'normal';
  sessionState.mode = next;
  saveMode(next);
  document.dispatchEvent(new CustomEvent('empi:network-mode', { detail: { mode: next } }));
  return next;
}

export async function signInNetwork() {
  const current = `${window.location.origin}${window.location.pathname}${window.location.search}`;
  const official = new URL(OFFICIAL_SITE_URL);
  const redirectTo = window.location.origin === official.origin ? current : OFFICIAL_SITE_URL;
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo, scopes: 'identify email' },
  });
  if (error) throw error;
}

export async function signOutNetwork() {
  setNetworkMode('normal');
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw error;
  sessionState.session = null;
  sessionState.profile = null;
  sessionState.isOwner = false;
  sessionState.modes = ['normal'];
  return { ...sessionState };
}

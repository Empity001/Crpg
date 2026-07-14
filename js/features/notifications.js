// =========================================================
// notifications.js
// =========================================================
// Novedades simples por navegador. Compara una instantánea pública de
// Logs, Guías, Tierlist, Kits y Acerca del servidor. No crea cuentas ni
// escribe nada en Supabase: instantánea, leídos y lista viven localmente.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { escapeHtml, safeUrl, withTimeout } from '../core/utils.js';

const SNAPSHOT_KEY = 'culones_notifications_snapshot_v1';
const ITEMS_KEY = 'culones_notifications_v1';
const LAST_REFRESH_KEY = 'culones_notifications_last_refresh_v1';
const MAX_ITEMS = 60;
const REFRESH_COOLDOWN = 5 * 60 * 1000;

let initialized = false;
let controller = null;
let refreshPromise = null;
let lastRefreshAt = Number(localStorage.getItem(LAST_REFRESH_KEY) || 0) || 0;
let versionsRpcAvailable = true;

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn('[Notifications] No se pudo guardar información local:', error);
  }
}

function normalizeList(value) {
  return Array.isArray(value) ? value : [];
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((acc, key) => {
    acc[key] = stableObject(value[key]);
    return acc;
  }, {});
}

function hashValue(value) {
  const text = JSON.stringify(stableObject(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function safeFetch(label, request) {
  const abortController = new AbortController();
  const timer = window.setTimeout(() => abortController.abort(), 6500);
  try {
    let query = disableQueryRetry(request);
    if (typeof query?.abortSignal === 'function') query = query.abortSignal(abortController.signal);
    const { data, error } = await withTimeout(query, 7000, `Las novedades de ${label}`);
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn(`[Notifications] ${label}:`, error?.message || error);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function tryBuildVersionSnapshot() {
  if (!versionsRpcAvailable) return null;

  const abortController = new AbortController();
  const timer = window.setTimeout(() => abortController.abort(), 4500);
  try {
    let request = disableQueryRetry(supabaseClient.rpc('get_site_content_versions'));
    if (typeof request?.abortSignal === 'function') request = request.abortSignal(abortController.signal);
    const { data, error } = await withTimeout(request, 5000, 'El índice de novedades');
    if (error) {
      const message = `${error.message || ''} ${error.details || ''}`;
      if (/get_site_content_versions|schema cache|could not find the function/i.test(message)) {
        versionsRpcAvailable = false;
      } else {
        console.warn('[Notifications] Índice de versiones:', error.message || error);
      }
      return null;
    }

    const sections = {};
    normalizeList(data).forEach(row => {
      const section = String(row.section || '').trim();
      if (!section) return;
      sections[section] = {
        version: Number(row.version) || 0,
        updatedAt: row.updated_at || '',
        latestId: row.latest_id ? String(row.latest_id) : '',
        latestTitle: String(row.latest_title || ''),
        changeKind: String(row.change_kind || 'updated'),
      };
    });
    if (!Object.keys(sections).length) return null;
    return { version: 2, generatedAt: new Date().toISOString(), sections };
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn('[Notifications] Índice de versiones:', error?.message || error);
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

async function buildLegacySnapshot() {
  const [logs, guides, tierRows, tierItems, kits, aboutRows] = await Promise.all([
    safeFetch('Logs', supabaseClient.from('logs').select('id,title,created_at').order('created_at', { ascending: false }).limit(30)),
    safeFetch('Guías', supabaseClient.from('weapons').select('id,name,published,updated_at').eq('published', true).order('updated_at', { ascending: false }).limit(50)),
    safeFetch('Tierlist', supabaseClient.from('tierlist_rows').select('id,name,color,sort_order,created_at').order('sort_order')),
    safeFetch('Tierlist', supabaseClient.from('tierlist_items').select('id,row_id,column_key,name,sort_order,created_at').order('sort_order')),
    safeFetch('Kits', supabaseClient.from('kits').select('id,name,published,sort_order,updated_at').eq('published', true).order('sort_order')),
    safeFetch('Acerca del servidor', supabaseClient.from('app_settings').select('key,updated_at').eq('key', 'about_blocks').limit(1)),
  ]);

  // Si todo falló no reemplazamos la última instantánea válida.
  if ([logs, guides, tierRows, tierItems, kits, aboutRows].every(value => value === null)) return null;

  const publicGuides = guides === null ? null : normalizeList(guides).filter(item => item.published !== false);
  const publicKits = kits === null ? null : normalizeList(kits).filter(item => item.published !== false);
  const aboutRow = aboutRows === null ? null : (normalizeList(aboutRows)[0] || false);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    logs: logs === null ? null : normalizeList(logs).map(item => ({ id: String(item.id), title: String(item.title || 'Nuevo log'), createdAt: item.created_at || '' })),
    guides: publicGuides === null ? null : publicGuides.map(item => ({ id: String(item.id), title: String(item.name || 'Nueva guía'), updatedAt: item.updated_at || '' })),
    tierlistHash: tierRows === null || tierItems === null ? null : hashValue({ rows: normalizeList(tierRows), items: normalizeList(tierItems) }),
    kitsHash: publicKits === null ? null : hashValue(publicKits),
    aboutHash: aboutRows === null ? null : hashValue(aboutRow ? { updatedAt: aboutRow.updated_at } : null),
  };
}

async function buildSnapshot() {
  return (await tryBuildVersionSnapshot()) || buildLegacySnapshot();
}

function createNotification({ id, type, entityId = '', title, description, url }) {
  return {
    id,
    type,
    entityId: String(entityId || ''),
    title,
    description,
    url,
    createdAt: new Date().toISOString(),
    read: false,
  };
}

function compareVersionSnapshots(previous, current, existingItems) {
  let items = normalizeList(existingItems).filter(item => item && item.id);
  const previousSections = previous?.sections || {};
  const currentSections = current?.sections || {};

  const addSectionChange = ({ section, type, singular, plural, description, urlBuilder }) => {
    const currentEntry = currentSections[section];
    const previousEntry = previousSections[section];
    if (!currentEntry || !previousEntry || currentEntry.version === previousEntry.version) return;

    const isPublished = currentEntry.changeKind === 'published' && currentEntry.latestId;
    const isSpecificUpdate = currentEntry.changeKind === 'updated' && currentEntry.latestId;
    const url = urlBuilder(isPublished || isSpecificUpdate ? currentEntry.latestId : '');
    const id = isPublished
      ? `${type}:${currentEntry.latestId}:v${currentEntry.version}`
      : `${type}:version:${currentEntry.version}`;
    if (items.some(item => item.id === id)) return;

    let title = `${plural} actualizados`;
    let detail = description;
    if (isPublished) {
      title = currentEntry.latestTitle || `Nuevo ${singular}`;
      detail = `Nuevo ${singular.toLocaleLowerCase('es')} publicado`;
    } else if (isSpecificUpdate && currentEntry.latestTitle) {
      title = `${singular} actualizado: ${currentEntry.latestTitle}`;
    } else if (currentEntry.changeKind === 'removed') {
      detail = `Se retiró contenido de ${plural.toLocaleLowerCase('es')}.`;
    }

    items.unshift(createNotification({
      id,
      type,
      entityId: isPublished || isSpecificUpdate ? currentEntry.latestId : '',
      title,
      description: detail,
      url,
    }));
  };

  addSectionChange({
    section: 'logs', type: 'logs', singular: 'Log', plural: 'Logs',
    description: 'Hay cambios nuevos en los Logs.',
    urlBuilder: id => id ? `index.html?log=${encodeURIComponent(id)}` : 'index.html',
  });
  addSectionChange({
    section: 'guides', type: 'guides', singular: 'Guía', plural: 'Guías',
    description: 'Hay cambios nuevos en las Guías.',
    urlBuilder: id => id ? `guides.html?weapon=${encodeURIComponent(id)}` : 'guides.html',
  });
  addSectionChange({
    section: 'tierlist', type: 'tierlist', singular: 'Tierlist', plural: 'Tierlist',
    description: 'Hay cambios nuevos en la clasificación.',
    urlBuilder: () => 'tierlist.html',
  });
  addSectionChange({
    section: 'kits', type: 'kits', singular: 'Kit', plural: 'Kits',
    description: 'Hay combinaciones nuevas o modificadas.',
    urlBuilder: id => id ? `kits.html?kit=${encodeURIComponent(id)}` : 'kits.html',
  });
  addSectionChange({
    section: 'about', type: 'about', singular: 'Sección', plural: 'Acerca del servidor',
    description: 'La información pública del servidor cambió.',
    urlBuilder: () => 'about.html',
  });
  return items.slice(0, MAX_ITEMS);
}

function compareSnapshots(previous, current, existingItems) {
  let items = normalizeList(existingItems).filter(item => item && item.id);
  if (!previous) return items;
  if (previous.version === 2 && current.version === 2) {
    return compareVersionSnapshots(previous, current, items);
  }
  if (previous.version !== current.version) return items;

  if (Array.isArray(previous.logs) && Array.isArray(current.logs)) {
    const previousLogIds = new Set(previous.logs.map(item => String(item.id)));
    current.logs.forEach(log => {
      if (previousLogIds.has(String(log.id))) return;
      const id = `log:${log.id}`;
      if (!items.some(item => item.id === id)) {
        items.unshift(createNotification({
          id,
          type: 'logs',
          entityId: log.id,
          title: log.title,
          description: 'Nuevo log publicado',
          url: `index.html?log=${encodeURIComponent(log.id)}`,
        }));
      }
    });
  }

  if (Array.isArray(current.guides)) {
    const currentGuideIds = new Set(current.guides.map(item => String(item.id)));
    // Al despublicar una Guía desaparece también su aviso local.
    items = items.filter(item => item.type !== 'guides' || currentGuideIds.has(String(item.entityId)));
    if (Array.isArray(previous.guides)) {
      const previousGuideIds = new Set(previous.guides.map(item => String(item.id)));
      current.guides.forEach(guide => {
        if (previousGuideIds.has(String(guide.id))) return;
        const id = `guide:${guide.id}`;
        if (!items.some(item => item.id === id)) {
          items.unshift(createNotification({
            id,
            type: 'guides',
            entityId: guide.id,
            title: guide.title,
            description: 'Nueva Guía publicada',
            url: `guides.html?weapon=${encodeURIComponent(guide.id)}`,
          }));
        }
      });
    }
  }

  if (previous.tierlistHash && current.tierlistHash && previous.tierlistHash !== current.tierlistHash) {
    const id = `tierlist:${current.tierlistHash}`;
    if (!items.some(item => item.id === id)) items.unshift(createNotification({
      id, type: 'tierlist', title: 'Tierlist actualizada', description: 'Hay cambios nuevos en la clasificación.', url: 'tierlist.html',
    }));
  }

  if (previous.kitsHash && current.kitsHash && previous.kitsHash !== current.kitsHash) {
    const id = `kits:${current.kitsHash}`;
    if (!items.some(item => item.id === id)) items.unshift(createNotification({
      id, type: 'kits', title: 'Kits actualizados', description: 'Hay combinaciones nuevas o modificadas.', url: 'kits.html',
    }));
  }

  if (previous.aboutHash && current.aboutHash && previous.aboutHash !== current.aboutHash) {
    const id = `about:${current.aboutHash}`;
    if (!items.some(item => item.id === id)) items.unshift(createNotification({
      id, type: 'about', title: 'Acerca del servidor actualizado', description: 'La información pública del servidor cambió.', url: 'about.html',
    }));
  }

  return items.slice(0, MAX_ITEMS);
}

function iconForType(type) {
  return ({ logs: '📜', guides: '⚔️', tierlist: '🏆', kits: '🎒', about: '🎮' })[type] || '✦';
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function getItems() {
  return normalizeList(readJson(ITEMS_KEY, []));
}

function saveItems(items) {
  writeJson(ITEMS_KEY, items.slice(0, MAX_ITEMS));
}

function updateBadges(items = getItems()) {
  const unread = items.filter(item => !item.read).length;
  document.querySelectorAll('[data-notification-badge]').forEach(badge => {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
  });
  document.querySelectorAll('[data-notification-toggle]').forEach(button => {
    button.setAttribute('aria-label', unread ? `Ver ${unread} novedades` : 'Ver novedades');
  });
}

function renderPanel(items = getItems()) {
  const list = document.getElementById('site-notification-list');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<div class="site-notification-empty"><span>✓</span><strong>Todo al día</strong><p>Las próximas novedades aparecerán aquí.</p></div>';
    return;
  }

  list.innerHTML = items.map(item => `
    <a class="site-notification-item ${item.read ? '' : 'is-unread'}" href="${escapeHtml(safeUrl(item.url) || '#')}">
      <span class="site-notification-icon" aria-hidden="true">${iconForType(item.type)}</span>
      <span class="site-notification-copy">
        <strong>${escapeHtml(item.title || 'Novedad')}</strong>
        <span>${escapeHtml(item.description || '')}</span>
        <small>${escapeHtml(formatDate(item.createdAt))}</small>
      </span>
      <span class="site-notification-arrow" aria-hidden="true">→</span>
    </a>`).join('');
}

function markAllRead() {
  const items = getItems().map(item => ({ ...item, read: true }));
  saveItems(items);
  updateBadges(items);
  renderPanel(items);
}

function setPanelOpen(open) {
  const panel = document.getElementById('site-notification-panel');
  if (!panel) return;
  if (open) {
    document.querySelectorAll('[data-global-search-root].is-open').forEach(root => {
      root.classList.remove('is-open');
      root.querySelector('[data-global-search-toggle]')?.setAttribute('aria-expanded', 'false');
    });
    document.body.classList.remove('global-search-mobile-open');
  }
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', open ? 'false' : 'true');
  document.querySelectorAll('[data-notification-toggle]').forEach(button => button.setAttribute('aria-expanded', open ? 'true' : 'false'));
  if (open) {
    markAllRead();
    void refreshNotifications({ render: true });
  }
}

export async function refreshNotifications({ force = false, render = false } = {}) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() - lastRefreshAt < REFRESH_COOLDOWN) return getItems();

  refreshPromise = (async () => {
    const current = await buildSnapshot();
    if (!current) return getItems();

    const previous = readJson(SNAPSHOT_KEY, null);
    let items = getItems();
    if (previous) items = compareSnapshots(previous, current, items);
    if (document.getElementById('site-notification-panel')?.classList.contains('is-open')) {
      items = items.map(item => ({ ...item, read: true }));
    }
    const mergedSnapshot = previous && previous.version === 1 && current.version === 1 ? {
      ...previous,
      ...Object.fromEntries(Object.entries(current).filter(([, value]) => value !== null)),
      generatedAt: current.generatedAt,
      version: current.version,
    } : current;
    writeJson(SNAPSHOT_KEY, mergedSnapshot);
    saveItems(items);
    lastRefreshAt = Date.now();
    try { localStorage.setItem(LAST_REFRESH_KEY, String(lastRefreshAt)); } catch { /* almacenamiento no disponible */ }
    updateBadges(items);
    if (render || document.getElementById('site-notification-panel')?.classList.contains('is-open')) renderPanel(items);
    return items;
  })().finally(() => { refreshPromise = null; });

  return refreshPromise;
}

export function initSiteNotifications() {
  if (initialized) return;
  const panel = document.getElementById('site-notification-panel');
  const buttons = [...document.querySelectorAll('[data-notification-toggle]')];
  if (!panel || !buttons.length) return;

  initialized = true;
  controller = new AbortController();
  const { signal } = controller;
  updateBadges();
  renderPanel();

  buttons.forEach(button => button.addEventListener('click', event => {
    event.stopPropagation();
    setPanelOpen(!panel.classList.contains('is-open'));
  }, { signal }));

  document.querySelector('[data-notification-close]')?.addEventListener('click', () => setPanelOpen(false), { signal });
  document.addEventListener('pointerdown', event => {
    if (!panel.classList.contains('is-open')) return;
    if (panel.contains(event.target) || event.target.closest?.('[data-notification-toggle]')) return;
    setPanelOpen(false);
  }, { signal });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setPanelOpen(false);
  }, { signal });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshNotifications();
  }, { signal });
  window.addEventListener('storage', event => {
    if (event.key === LAST_REFRESH_KEY) {
      lastRefreshAt = Number(event.newValue || 0) || lastRefreshAt;
    }
    if (event.key === ITEMS_KEY) {
      updateBadges();
      renderPanel();
    }
  }, { signal });
  window.addEventListener('pagehide', () => destroySiteNotifications(), { once: true, signal });

  const schedule = window.requestIdleCallback || (callback => window.setTimeout(callback, 900));
  schedule(() => void refreshNotifications(), { timeout: 2500 });
}

export function destroySiteNotifications() {
  controller?.abort();
  controller = null;
  initialized = false;
  refreshPromise = null;
}

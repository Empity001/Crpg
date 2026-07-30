// =========================================================
// global-search.js
// =========================================================
// Buscador compartido del sitio. Construye un índice ligero con los
// nombres y textos principales de Logs, Guías, Tierlist, Kits y
// Acerca del servidor. Se carga bajo demanda al abrir la lupa para no
// ralentizar el arranque de cada página.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { isAdmin, state } from '../core/state.js';
import { escapeHtml, safeUrl, withTimeout } from '../core/utils.js';

const SECTION_META = {
  logs: { label: 'Logs', icon: '📜', order: 0 },
  guides: { label: 'Guías', icon: '⚔️', order: 1 },
  tierlist: { label: 'Tierlist', icon: '🏆', order: 2 },
  kits: { label: 'Kits', icon: '🎒', order: 3 },
  about: { label: 'Acerca del servidor', icon: '🎮', order: 4 },
  admin: { label: 'Herramientas', icon: '🛠️', order: 5 },
};

let searchIndex = null;
let searchIndexPromise = null;
let searchIndexAdminState = null;
let searchIndexBuiltAt = 0;
let initialized = false;
let lifecycleController = null;
const SEARCH_INDEX_TTL = 90_000;

function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max = 118) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function cleanUrl(url) {
  return safeUrl(String(url || '').trim()) || '';
}

async function safeFetch(label, request) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 7000);
  try {
    const stableRequest = disableQueryRetry(request);
    const abortable = typeof stableRequest?.abortSignal === 'function'
      ? stableRequest.abortSignal(controller.signal)
      : stableRequest;
    const { data, error } = await withTimeout(abortable, 7500, `La búsqueda de ${label}`);
    if (error) {
      console.warn(`[GlobalSearch] ${label}:`, error.message || error);
      return [];
    }
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error?.name !== 'AbortError') console.warn(`[GlobalSearch] ${label}:`, error);
    return [];
  } finally {
    window.clearTimeout(timer);
  }
}

function addEntry(entries, seen, raw) {
  const title = String(raw.title || '').trim();
  const section = SECTION_META[raw.sectionKey];
  if (!title || !section || !raw.url) return;

  const key = String(raw.key || `${raw.sectionKey}:${raw.url}:${title}`);
  if (seen.has(key)) return;
  seen.add(key);

  const description = truncate(raw.description || '', 150);
  const kind = String(raw.kind || '').trim();
  const keywords = Array.isArray(raw.keywords) ? raw.keywords.filter(Boolean).join(' ') : String(raw.keywords || '');
  const titleNorm = normalizeSearchText(title);
  const descriptionNorm = normalizeSearchText(description);
  const sectionNorm = normalizeSearchText(section.label);
  const keywordNorm = normalizeSearchText(keywords);

  // Guardamos una sola cadena normalizada para evitar duplicar varias veces
  // el mismo texto en memoria cuando el índice contiene cientos de objetos.
  entries.push({
    key,
    title,
    titleNorm,
    description,
    kind,
    sectionKey: raw.sectionKey,
    sectionLabel: section.label,
    sectionIcon: section.icon,
    sectionOrder: section.order,
    sectionNorm,
    url: raw.url,
    imageUrl: cleanUrl(raw.imageUrl),
    searchBlob: [titleNorm, descriptionNorm, normalizeSearchText(kind), sectionNorm, keywordNorm].filter(Boolean).join(' '),
  });
}

function collectNamedRecipeValues(value, result = [], seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return result;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => collectNamedRecipeValues(item, result, seen));
    return result;
  }
  if (typeof value.name === 'string' && value.name.trim()) result.push(value.name.trim());
  Object.values(value).forEach(child => collectNamedRecipeValues(child, result, seen));
  return result;
}

function buildAboutEntries(entries, seen, sourceBlocks = state.aboutBlocks) {
  const blocks = Array.isArray(sourceBlocks) ? sourceBlocks : [];
  let currentHeading = 'Acerca del servidor';

  blocks.forEach((block, index) => {
    const kind = String(block?.kind || '');
    const content = String(block?.content || '').trim();
    const caption = String(block?.caption || '').trim();
    if (kind === 'heading' && content) currentHeading = content;

    if (kind === 'heading' || kind === 'highlight') {
      addEntry(entries, seen, {
        key: `about:block:${index}`,
        title: content,
        sectionKey: 'about',
        kind: kind === 'heading' ? 'Título' : 'Destacado',
        description: kind === 'heading' ? 'Sección de Acerca del servidor' : content,
        url: `about.html?block=${index}`,
      });
      return;
    }

    if (kind === 'text' && content) {
      addEntry(entries, seen, {
        key: `about:text:${index}`,
        title: currentHeading,
        sectionKey: 'about',
        kind: 'Texto',
        description: content,
        keywords: content,
        url: `about.html?block=${index}`,
      });
      return;
    }

    if (kind === 'statistic') {
      const title = String(block?.title || '').trim() || currentHeading || 'Estadística del servidor';
      const tasks = Array.isArray(block?.tasks) ? block.tasks : [];
      const taskLabels = tasks.map(task => typeof task === 'string' ? task : String(task?.label || task?.name || '')).filter(Boolean);
      const completed = tasks.filter(task => typeof task === 'object' && Boolean(task?.done ?? task?.completed)).length;
      addEntry(entries, seen, {
        key: `about:statistic:${index}`,
        title,
        sectionKey: 'about',
        kind: 'Estadística',
        description: `${completed} de ${tasks.length} tareas completadas`,
        keywords: taskLabels,
        url: `about.html?block=${index}`,
      });
      return;
    }

    if (kind === 'image' && caption) {
      addEntry(entries, seen, {
        key: `about:image:${index}`,
        title: caption,
        sectionKey: 'about',
        kind: 'Imagen',
        description: `Imagen en ${currentHeading}`,
        imageUrl: block.url,
        url: `about.html?block=${index}`,
      });
    }
  });
}

async function createSearchIndex() {
  const adminCode = isAdmin() ? state.adminMode : null;

  const logsRequest = isAdmin()
    ? supabaseClient.rpc('list_logs_admin', { input_code: state.adminMode })
    : supabaseClient.from('logs').select('id,title,description,category,published');
  const mobsRequest = isAdmin()
    ? supabaseClient.rpc('list_log_mobs_admin', { input_code: state.adminMode })
    : supabaseClient.from('log_mobs').select('id,log_id,name,description,location,image_url');
  const logItemsRequest = isAdmin()
    ? supabaseClient.rpc('list_log_items_admin', { input_code: state.adminMode })
    : supabaseClient.from('log_items').select('id,log_id,name,description,item_type,tier,obtained_from,image_url');

  const [logs, mobs, logItems, weapons, ranks, tierRows, tierItems, kits, aboutSettings] = await Promise.all([
    safeFetch('logs', logsRequest),
    safeFetch('log_mobs', mobsRequest),
    safeFetch('log_items', logItemsRequest),
    safeFetch('weapons', supabaseClient.from('weapons').select('id,name,image_url,published,category_id,type_id')),
    safeFetch('weapon_ranks', supabaseClient.from('weapon_ranks').select('id,weapon_id,name,description,image_url,abilities,upgrade_recipe,extra_sections,sort_order').order('sort_order', { ascending: true })),
    safeFetch('tierlist_rows', supabaseClient.from('tierlist_rows').select('id,name,color,sort_order')),
    safeFetch('tierlist_items', supabaseClient.from('tierlist_items').select('id,row_id,column_key,name,image_url,extra_fields,sort_order')),
    safeFetch('kits', supabaseClient.rpc('list_kits', { input_code: adminCode })),
    safeFetch('about', supabaseClient.from('app_settings').select('value').eq('key', 'about_blocks').limit(1)),
  ]);

  const entries = [];
  const seen = new Set();

  // Accesos por nombre de sección. También permiten buscar "logs",
  // "guías", "kits", etc. aunque todavía no haya registros.
  [
    ['logs', 'Logs', 'Consulta los cambios y eventos del servidor.', 'index.html'],
    ['guides', 'Guías', 'Consulta objetos, armas, rangos y sus formas de obtención.', 'guides.html'],
    ['tierlist', 'Tierlist', 'Clasificación de armas, accesorios y subarmas.', 'tierlist.html'],
    ['kits', 'Kits', 'Combinaciones recomendadas del servidor.', 'kits.html'],
    ['about', 'Acerca del servidor', 'Información general de la comunidad y el proyecto.', 'about.html'],
  ].forEach(([sectionKey, title, description, url]) => addEntry(entries, seen, {
    key: `page:${sectionKey}`, title, sectionKey, kind: 'Sección', description, url,
  }));

  if (isAdmin()) {
    addEntry(entries, seen, {
      key: 'page:admin',
      title: 'Herramientas',
      sectionKey: 'admin',
      kind: 'Administración',
      description: 'Biblioteca, ajustes, exportaciones, borradores y configuración global.',
      url: 'admin.html',
    });
  }

  const logsById = new Map(logs.map(log => [String(log.id), log]));
  logs.filter(log => isAdmin() || log.published !== false).forEach(log => addEntry(entries, seen, {
    key: `log:${log.id}`,
    title: log.title,
    sectionKey: 'logs',
    kind: 'Log',
    description: log.description,
    keywords: [log.category],
    url: `index.html?log=${encodeURIComponent(log.id)}`,
  }));

  mobs.forEach(mob => {
    const log = logsById.get(String(mob.log_id));
    if (!log) return;
    addEntry(entries, seen, {
      key: `log-mob:${mob.id}`,
      title: mob.name,
      sectionKey: 'logs',
      kind: 'Mob',
      description: `${log.title}${mob.description ? ` · ${mob.description}` : ''}`,
      keywords: [mob.location, log.description],
      imageUrl: mob.image_url,
      url: `index.html?log=${encodeURIComponent(log.id)}&tab=mobs&entry=${encodeURIComponent(mob.id)}`,
    });
  });

  logItems.forEach(item => {
    const log = logsById.get(String(item.log_id));
    if (!log) return;
    const libre = item.item_type === '_libre';
    addEntry(entries, seen, {
      key: `log-item:${item.id}`,
      title: item.name,
      sectionKey: 'logs',
      kind: libre ? 'Extra' : 'Item',
      description: `${log.title}${item.description ? ` · ${item.description}` : ''}`,
      keywords: [item.tier, item.item_type, item.obtained_from, log.description],
      imageUrl: item.image_url,
      url: `index.html?log=${encodeURIComponent(log.id)}&tab=${libre ? 'blocks' : 'items'}&entry=${encodeURIComponent(item.id)}`,
    });
  });

  const weaponsById = new Map();
  weapons.forEach(weapon => {
    // La RLS pública ya filtra registros privados. Este filtro adicional
    // evita mostrar uno no publicado si la tabla se leyera con una
    // política administrativa más amplia.
    if (!weapon.published && !isAdmin()) return;
    weaponsById.set(String(weapon.id), weapon);
    addEntry(entries, seen, {
      key: `weapon:${weapon.id}`,
      title: weapon.name,
      sectionKey: 'guides',
      kind: 'Guía',
      description: 'Objeto del catálogo de Guías',
      imageUrl: weapon.image_url,
      url: `guides.html?weapon=${encodeURIComponent(weapon.id)}`,
    });
  });

  ranks.forEach(rank => {
    const weapon = weaponsById.get(String(rank.weapon_id));
    if (!weapon) return;
    const rankUrl = `guides.html?weapon=${encodeURIComponent(weapon.id)}&rank=${encodeURIComponent(rank.id)}`;
    addEntry(entries, seen, {
      key: `weapon-rank:${rank.id}`,
      title: rank.name,
      sectionKey: 'guides',
      kind: 'Rango',
      description: `${weapon.name}${rank.description ? ` · ${rank.description}` : ''}`,
      imageUrl: rank.image_url || weapon.image_url,
      url: rankUrl,
    });

    const abilities = Array.isArray(rank.abilities) ? rank.abilities : [];
    abilities.forEach((ability, index) => {
      const name = String(ability?.name || ability?.title || '').trim();
      if (!name) return;
      addEntry(entries, seen, {
        key: `weapon-ability:${rank.id}:${index}`,
        title: name,
        sectionKey: 'guides',
        kind: 'Habilidad',
        description: `${weapon.name} · ${rank.name}`,
        keywords: [ability?.description, ability?.text],
        url: rankUrl,
      });
    });

    collectNamedRecipeValues(rank.upgrade_recipe).forEach((name, index) => addEntry(entries, seen, {
      key: `weapon-recipe:${rank.id}:${index}:${normalizeSearchText(name)}`,
      title: name,
      sectionKey: 'guides',
      kind: 'Mesa de trabajo',
      description: `${weapon.name} · ${rank.name}`,
      url: rankUrl,
    }));

    const sections = Array.isArray(rank.extra_sections) ? rank.extra_sections : [];
    sections.forEach((section, index) => {
      const title = String(section?.title || '').trim();
      if (!title) return;
      addEntry(entries, seen, {
        key: `weapon-section:${rank.id}:${index}`,
        title,
        sectionKey: 'guides',
        kind: 'Sección',
        description: `${weapon.name} · ${rank.name}`,
        keywords: [section?.text, section?.content],
        url: rankUrl,
      });
    });
  });

  const tierRowsById = new Map(tierRows.map(row => [String(row.id), row]));
  tierItems.forEach(item => {
    const row = tierRowsById.get(String(item.row_id));
    const columnLabel = ({ weapon: 'Arma', subweapon: 'Sub-arma', accessory: 'Accesorio' })[item.column_key] || 'Elemento';
    addEntry(entries, seen, {
      key: `tier-item:${item.id}`,
      title: item.name,
      sectionKey: 'tierlist',
      kind: columnLabel,
      description: row?.name ? `Rango ${row.name}` : 'Sin clasificar',
      imageUrl: item.image_url,
      keywords: [row?.name, item.column_key],
      url: `tierlist.html?item=${encodeURIComponent(item.id)}`,
    });
  });

  kits.forEach(kit => {
    addEntry(entries, seen, {
      key: `kit:${kit.id}`,
      title: kit.name,
      sectionKey: 'kits',
      kind: 'Kit',
      description: kit.description,
      url: `kits.html?kit=${encodeURIComponent(kit.id)}`,
    });

    const groups = kit?.items && typeof kit.items === 'object' ? kit.items : {};
    Object.entries(groups).forEach(([column, list]) => {
      if (!Array.isArray(list)) return;
      list.forEach((item, index) => {
        const title = String(item?.name || '').trim();
        if (!title) return;
        const label = ({ weapon: 'Arma', accessory: 'Accesorio', subweapon: 'Sub-arma' })[column] || 'Elemento';
        addEntry(entries, seen, {
          key: `kit-item:${kit.id}:${column}:${index}`,
          title,
          sectionKey: 'kits',
          kind: label,
          description: kit.name,
          imageUrl: item?.image_url,
          url: `kits.html?kit=${encodeURIComponent(kit.id)}&item=${encodeURIComponent(title)}`,
        });
      });
    });
  });

  buildAboutEntries(entries, seen, aboutSettings[0]?.value);
  return entries;
}

async function getSearchIndex() {
  const adminState = isAdmin();
  if (searchIndex && searchIndexAdminState === adminState && Date.now() - searchIndexBuiltAt < SEARCH_INDEX_TTL) return searchIndex;
  if (searchIndexPromise) return searchIndexPromise;

  searchIndexPromise = createSearchIndex()
    .then(index => {
      searchIndex = index;
      searchIndexAdminState = adminState;
      searchIndexBuiltAt = Date.now();
      return index;
    })
    .finally(() => { searchIndexPromise = null; });
  return searchIndexPromise;
}

export function invalidateGlobalSearchIndex() {
  searchIndex = null;
  searchIndexPromise = null;
  searchIndexAdminState = null;
  searchIndexBuiltAt = 0;
}

function scoreEntry(entry, query, tokens) {
  if (!query) return Number.POSITIVE_INFINITY;
  if (!tokens.every(token => entry.searchBlob.includes(token))) return Number.POSITIVE_INFINITY;

  let score = 100;
  if (entry.titleNorm === query) score = 0;
  else if (entry.titleNorm.startsWith(query)) score = 8;
  else if (entry.titleNorm.split(' ').some(word => word.startsWith(query))) score = 14;
  else if (entry.titleNorm.includes(query)) score = 22;
  else if (entry.sectionNorm === query) score = 30;
  else if (entry.searchBlob.includes(query)) score = 42;

  const tokenTitleMatches = tokens.filter(token => entry.titleNorm.includes(token)).length;
  score -= tokenTitleMatches * 3;
  score += Math.min(entry.title.length / 80, 2);
  return score;
}

function findResults(index, rawQuery) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return [];
  const tokens = query.split(' ').filter(Boolean);
  const scored = index
    .map(entry => ({ entry, score: scoreEntry(entry, query, tokens) }))
    .filter(item => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score
      || a.entry.sectionOrder - b.entry.sectionOrder
      || a.entry.title.localeCompare(b.entry.title, 'es', { sensitivity: 'base' }))
    .slice(0, 120);

  // Un mismo nombre puede aparecer varias veces dentro de la misma sección
  // (por ejemplo como rango, material y resultado). Se presenta una sola vez
  // con xN, pero se mantiene separado si también existe en otra sección.
  const aggregated = new Map();
  scored.forEach(({ entry, score }) => {
    const key = `${entry.sectionKey}:${entry.titleNorm}`;
    const current = aggregated.get(key);
    if (!current) {
      aggregated.set(key, {
        ...entry,
        bestScore: score,
        mentionCount: 1,
        kinds: new Set(entry.kind ? [entry.kind] : []),
      });
      return;
    }
    current.mentionCount += 1;
    if (entry.kind) current.kinds.add(entry.kind);
    if (score < current.bestScore) {
      current.bestScore = score;
      current.url = entry.url;
      current.imageUrl = entry.imageUrl || current.imageUrl;
      current.description = entry.description || current.description;
      current.kind = entry.kind || current.kind;
    }
  });

  const grouped = new Map();
  [...aggregated.values()]
    .sort((a, b) => a.sectionOrder - b.sectionOrder
      || a.bestScore - b.bestScore
      || a.title.localeCompare(b.title, 'es', { sensitivity: 'base' }))
    .forEach(entry => {
      entry.kindSummary = [...entry.kinds].slice(0, 3).join(' · ');
      if (!grouped.has(entry.sectionKey)) grouped.set(entry.sectionKey, {
        sectionKey: entry.sectionKey,
        sectionLabel: entry.sectionLabel,
        sectionIcon: entry.sectionIcon,
        sectionOrder: entry.sectionOrder,
        entries: [],
      });
      const group = grouped.get(entry.sectionKey);
      if (group.entries.length < 10) group.entries.push(entry);
    });

  return [...grouped.values()]
    .sort((a, b) => a.sectionOrder - b.sectionOrder)
    .filter(group => group.entries.length)
    .slice(0, 6);
}

function highlightMatch(text, rawQuery) {
  const source = String(text || '');
  const query = String(rawQuery || '').trim();
  if (!query) return escapeHtml(source);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escapeHtml(source).replace(new RegExp(`(${escaped})`, 'ig'), '<mark>$1</mark>');
  } catch {
    return escapeHtml(source);
  }
}

function resultMarkup(entry, query, index) {
  const media = entry.imageUrl
    ? `<span class="global-search-result-media"><img src="${escapeHtml(entry.imageUrl)}" alt="" loading="lazy" decoding="async" /><span>${entry.sectionIcon}</span></span>`
    : `<span class="global-search-result-media is-fallback">${entry.sectionIcon}</span>`;
  const count = Number(entry.mentionCount || 1);
  return `
    <a class="global-search-result" role="option" aria-selected="false" data-search-result-index="${index}" href="${escapeHtml(entry.url)}">
      ${media}
      <span class="global-search-result-copy">
        <span class="global-search-result-title">${highlightMatch(entry.title, query)}${count > 1 ? `<b class="global-search-result-count">x${count}</b>` : ''}</span>
        <span class="global-search-result-meta">${entry.kindSummary || entry.kind ? `<b>${escapeHtml(entry.kindSummary || entry.kind)}</b>` : ''}${entry.description ? `<span>${escapeHtml(entry.description)}</span>` : ''}</span>
      </span>
      <span class="global-search-result-arrow" aria-hidden="true">↗</span>
    </a>`;
}

function groupedResultsMarkup(groups, query) {
  let resultIndex = 0;
  return groups.map(group => `
    <section class="global-search-result-group" aria-labelledby="search-group-${escapeHtml(group.sectionKey)}">
      <header class="global-search-result-group-head" id="search-group-${escapeHtml(group.sectionKey)}">
        <span aria-hidden="true">${group.sectionIcon}</span>
        <strong>${escapeHtml(group.sectionLabel)}</strong>
        <small>${group.entries.length}</small>
      </header>
      <div class="global-search-result-group-list">
        ${group.entries.map(entry => resultMarkup(entry, query, resultIndex++)).join('')}
      </div>
    </section>`).join('');
}

function setRootOpen(root, open) {
  root.classList.toggle('is-open', open);
  const toggle = root.querySelector('[data-global-search-toggle]');
  toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (root.dataset.searchVariant === 'mobile') {
    document.body.classList.toggle('global-search-mobile-open', open);
  }
}

function closeSearchRoot(root, { clear = false } = {}) {
  setRootOpen(root, false);
  const input = root.querySelector('[data-global-search-input]');
  const results = root.querySelector('[data-global-search-results]');
  if (clear && input) input.value = '';
  if (results) results.innerHTML = '';
  root.dataset.activeIndex = '-1';
}

function closeOtherRoots(current) {
  document.querySelectorAll('[data-global-search-root].is-open').forEach(root => {
    if (root !== current) closeSearchRoot(root);
  });
}

function setStatus(root, message, { loading = false } = {}) {
  const results = root.querySelector('[data-global-search-results]');
  if (!results) return;
  results.innerHTML = `<div class="global-search-message ${loading ? 'is-loading' : ''}">${loading ? '<span class="global-search-spinner"></span>' : '<span aria-hidden="true">⌕</span>'}<p>${escapeHtml(message)}</p></div>`;
  root.dataset.activeIndex = '-1';
}

function setActiveResult(root, index) {
  const items = [...root.querySelectorAll('.global-search-result')];
  if (!items.length) {
    root.dataset.activeIndex = '-1';
    return;
  }
  const next = Math.max(0, Math.min(items.length - 1, index));
  items.forEach((item, idx) => {
    const active = idx === next;
    item.classList.toggle('is-keyboard-active', active);
    item.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  root.dataset.activeIndex = String(next);
  items[next].scrollIntoView({ block: 'nearest' });
}

async function executeSearch(root) {
  const input = root.querySelector('[data-global-search-input]');
  const results = root.querySelector('[data-global-search-results]');
  if (!input || !results) return;
  const rawQuery = input.value.trim();
  root.dataset.activeIndex = '-1';

  if (!rawQuery) {
    setStatus(root, 'Escribe el nombre de un log, objeto, guía, kit o sección.');
    return;
  }

  const requestToken = String(Number(root.dataset.requestToken || 0) + 1);
  root.dataset.requestToken = requestToken;
  setStatus(root, 'Buscando en toda la web…', { loading: true });
  const index = await getSearchIndex();
  if (root.dataset.requestToken !== requestToken) return;
  const groups = findResults(index, rawQuery);

  if (!groups.length) {
    setStatus(root, `No encontramos resultados para “${rawQuery}”.`);
    return;
  }

  results.innerHTML = groupedResultsMarkup(groups, rawQuery);
  results.querySelectorAll('img').forEach(image => {
    image.addEventListener('error', () => image.closest('.global-search-result-media')?.classList.add('is-broken'), { once: true });
  });
}

function wireSearchRoot(root) {
  if (root.dataset.searchBound === 'true') return;
  root.dataset.searchBound = 'true';
  root.dataset.searchReady = 'true';
  root.dataset.activeIndex = '-1';
  root.dataset.requestToken = '0';

  const toggle = root.querySelector('[data-global-search-toggle]');
  const input = root.querySelector('[data-global-search-input]');
  const clear = root.querySelector('[data-global-search-clear]');
  let timer = null;
  const signal = lifecycleController?.signal;

  const open = () => {
    closeOtherRoots(root);
    const notificationPanel = document.getElementById('site-notification-panel');
    notificationPanel?.classList.remove('is-open');
    notificationPanel?.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('[data-notification-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
    setRootOpen(root, true);
    window.requestAnimationFrame(() => {
      if (document.activeElement !== input) input?.focus({ preventScroll: true });
      if (!input?.value.trim()) setStatus(root, 'Escribe el nombre de un log, objeto, guía, kit o sección.');
      else executeSearch(root);
    });
  };

  toggle?.addEventListener('click', () => {
    if (root.classList.contains('is-open')) {
      input?.focus({ preventScroll: true });
      return;
    }
    open();
  }, { signal });

  input?.addEventListener('focus', () => {
    if (!root.classList.contains('is-open')) open();
  }, { signal });
  input?.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => executeSearch(root), 110);
  }, { signal });

  input?.addEventListener('keydown', event => {
    const items = [...root.querySelectorAll('.global-search-result')];
    const activeIndex = Number(root.dataset.activeIndex || -1);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveResult(root, activeIndex < 0 ? 0 : activeIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveResult(root, activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0 && items[activeIndex]) {
      event.preventDefault();
      items[activeIndex].click();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearchRoot(root);
      toggle?.focus({ preventScroll: true });
    }
  }, { signal });

  clear?.addEventListener('click', () => {
    if (input) input.value = '';
    setStatus(root, 'Escribe el nombre de un log, objeto, guía, kit o sección.');
    input?.focus({ preventScroll: true });
  }, { signal });

  root.addEventListener('click', event => {
    const result = event.target.closest('.global-search-result');
    if (result) closeSearchRoot(root);
  }, { signal });

  signal?.addEventListener('abort', () => window.clearTimeout(timer), { once: true });
}

function preferredSearchRoot() {
  const mobile = window.matchMedia('(max-width: 900px)').matches;
  return document.querySelector(`[data-global-search-root][data-search-variant="${mobile ? 'mobile' : 'desktop'}"]`);
}

export function openGlobalSearch(root = null) {
  const target = root instanceof Element ? root : preferredSearchRoot();
  if (!target) return;
  if (!initialized) initGlobalSearch();
  closeOtherRoots(target);
  const notificationPanel = document.getElementById('site-notification-panel');
  notificationPanel?.classList.remove('is-open');
  notificationPanel?.setAttribute('aria-hidden', 'true');
  document.querySelectorAll('[data-notification-toggle]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  setRootOpen(target, true);
  window.requestAnimationFrame(() => {
    const input = target.querySelector('[data-global-search-input]');
    if (document.activeElement !== input) input?.focus({ preventScroll: true });
    if (!input?.value.trim()) setStatus(target, 'Escribe el nombre de un log, objeto, guía, kit o sección.');
  });
}

export function destroyGlobalSearch() {
  lifecycleController?.abort();
  lifecycleController = null;
  initialized = false;
  document.documentElement.dataset.globalSearchReady = 'false';
  document.body.classList.remove('global-search-mobile-open');
  document.querySelectorAll('[data-global-search-root]').forEach(root => {
    root.dataset.searchBound = 'false';
    closeSearchRoot(root, { clear: true });
  });
  invalidateGlobalSearchIndex();
}

export function initGlobalSearch() {
  if (initialized) return;
  const roots = [...document.querySelectorAll('[data-global-search-root]')];
  if (!roots.length) return;
  initialized = true;
  lifecycleController = new AbortController();
  const { signal } = lifecycleController;
  document.documentElement.dataset.globalSearchReady = 'true';
  roots.forEach(wireSearchRoot);

  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('[data-global-search-root].is-open').forEach(root => {
      if (!root.contains(event.target)) closeSearchRoot(root);
    });
  }, { signal });

  document.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      document.querySelectorAll('[data-global-search-root].is-open').forEach(root => closeSearchRoot(root));
    }
  }, { signal });

  window.addEventListener('resize', () => {
    const mobile = window.matchMedia('(max-width: 900px)').matches;
    document.querySelectorAll('[data-global-search-root].is-open').forEach(root => {
      const rootIsMobile = root.dataset.searchVariant === 'mobile';
      if (rootIsMobile !== mobile) closeSearchRoot(root);
    });
  }, { signal });

  document.addEventListener('culones:admin-state-changed', invalidateGlobalSearchIndex, { signal });
  window.addEventListener('pagehide', destroyGlobalSearch, { once: true, signal });
}

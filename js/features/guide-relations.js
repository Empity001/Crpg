// =========================================================
// guide-relations.js
// =========================================================
// Relaciones inversas de una Guía. Reutiliza el `guide_link` que ya
// guardan los bloques de Logs, los Kits y la Tierlist; no crea IDs ni
// tablas paralelas. Los datos se cargan solo al abrir una Guía.
// =========================================================

import { disableQueryRetry, supabaseClient } from '../config.js';
import { KIT_COLUMNS, RELEVANCE_LABELS, TIER_COLUMNS, isAdmin, state } from '../core/state.js';
import { asArray, escapeHtml, formatDate, withTimeout } from '../core/utils.js';
import { getGuideLinkFromFields, normalizeGuideLink } from './guide-links.js';
import { getAdminLogsBundle } from '../core/admin-api.js';

const CACHE_TTL_MS = 45 * 1000;
const relationCache = new Map();
const relationPromises = new Map();

function emptyRelations() {
  return { logs: [], kits: [], tiers: [], errors: [] };
}

function relationKey(weaponId, admin = isAdmin()) {
  return `${admin ? 'admin' : 'public'}:${String(weaponId || '')}`;
}

function relationSnapshot(weaponId) {
  return relationCache.get(relationKey(weaponId)) || {
    status: 'idle',
    loadedAt: 0,
    data: emptyRelations(),
  };
}

function linkMatchesWeapon(link, weaponId) {
  const normalized = normalizeGuideLink(link);
  return !!normalized && normalized.weapon_id === String(weaponId || '');
}

function linkMatchesRank(link, rankId) {
  const normalized = normalizeGuideLink(link);
  if (!normalized) return false;
  if (!rankId) return true;
  return !normalized.rank_id || normalized.rank_id === String(rankId);
}

function containsPayload(weaponId) {
  return [{ _kind: 'guide_link', value: { weapon_id: String(weaponId) } }];
}

async function publicGuideRows(table, select, weaponId) {
  let result = await disableQueryRetry(
    supabaseClient.from(table)
      .select(select)
      .contains('extra_fields', containsPayload(weaponId)),
  );

  // Compatibilidad con instalaciones antiguas de PostgREST: si el filtro de
  // contención no está disponible, recuperamos únicamente filas con metadata
  // y aplicamos el filtro en el navegador.
  if (result.error) {
    console.warn(`[Guías] Filtro inverso ${table}:`, result.error.message);
    result = await disableQueryRetry(
      supabaseClient.from(table)
        .select(select)
        .not('extra_fields', 'eq', '[]'),
    );
  }

  if (result.error) throw result.error;
  return (result.data || []).filter(row => linkMatchesWeapon(getGuideLinkFromFields(row.extra_fields), weaponId));
}

function logMatch(entry, kind) {
  const link = getGuideLinkFromFields(entry.extra_fields);
  const libre = kind === 'item' && entry.item_type === '_libre';
  return {
    id: String(entry.id),
    name: String(entry.name || (libre ? 'Extra' : kind === 'mob' ? 'Mob' : 'Ítem')),
    kind: libre ? 'extra' : kind,
    tab: libre ? 'blocks' : kind === 'mob' ? 'mobs' : 'items',
    link,
  };
}

function collectRelatedLogs(logs, mobs, items, weaponId) {
  const matchesByLog = new Map();
  const add = (entry, kind) => {
    const link = getGuideLinkFromFields(entry.extra_fields);
    if (!linkMatchesWeapon(link, weaponId)) return;
    const key = String(entry.log_id || '');
    if (!key) return;
    if (!matchesByLog.has(key)) matchesByLog.set(key, []);
    matchesByLog.get(key).push(logMatch(entry, kind));
  };
  mobs.forEach(entry => add(entry, 'mob'));
  items.forEach(entry => add(entry, 'item'));

  return (logs || [])
    .filter(log => matchesByLog.has(String(log.id)))
    .map(log => ({ ...log, matches: matchesByLog.get(String(log.id)) || [] }))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

async function fetchPublicLogsByIds(ids) {
  if (!ids.length) return [];
  let result = await disableQueryRetry(
    supabaseClient.from('logs')
      .select('id,title,description,category,relevance,likes,created_at,cover_image_url,published')
      .in('id', ids)
      .order('created_at', { ascending: false }),
  );
  if (result.error && /published|cover_image_url/i.test(`${result.error.message || ''} ${result.error.details || ''}`)) {
    result = await disableQueryRetry(
      supabaseClient.from('logs')
        .select('id,title,description,category,relevance,likes,created_at')
        .in('id', ids)
        .order('created_at', { ascending: false }),
    );
  }
  if (result.error) throw result.error;
  return result.data || [];
}

async function fetchRelatedLogs(weaponId) {
  if (isAdmin()) {
    const bundle = await getAdminLogsBundle();
    if (!bundle.error) {
      const mobs = (bundle.data?.mobs || []).filter(row => linkMatchesWeapon(getGuideLinkFromFields(row.extra_fields), weaponId));
      const items = (bundle.data?.items || []).filter(row => linkMatchesWeapon(getGuideLinkFromFields(row.extra_fields), weaponId));
      return collectRelatedLogs(bundle.data?.logs || [], mobs, items, weaponId);
    }

    const [logsRes, mobsRes, itemsRes] = await Promise.all([
      supabaseClient.rpc('list_logs_admin', { input_code: state.adminMode }),
      supabaseClient.rpc('list_log_mobs_admin', { input_code: state.adminMode }),
      supabaseClient.rpc('list_log_items_admin', { input_code: state.adminMode }),
    ]);
    const fallbackError = logsRes.error || mobsRes.error || itemsRes.error;
    if (fallbackError) throw fallbackError;
    const mobs = (mobsRes.data || []).filter(row => linkMatchesWeapon(getGuideLinkFromFields(row.extra_fields), weaponId));
    const items = (itemsRes.data || []).filter(row => linkMatchesWeapon(getGuideLinkFromFields(row.extra_fields), weaponId));
    return collectRelatedLogs(logsRes.data || [], mobs, items, weaponId);
  }

  const [mobs, items] = await Promise.all([
    publicGuideRows('log_mobs', 'id,log_id,name,extra_fields,sort_order', weaponId),
    publicGuideRows('log_items', 'id,log_id,name,item_type,extra_fields,sort_order', weaponId),
  ]);
  const logIds = [...new Set([...mobs, ...items].map(row => String(row.log_id || '')).filter(Boolean))];
  const logs = await fetchPublicLogsByIds(logIds);
  return collectRelatedLogs(logs, mobs, items, weaponId);
}

function kitMatches(kit, weaponId) {
  const matches = [];
  const source = kit?.items && typeof kit.items === 'object' && !Array.isArray(kit.items) ? kit.items : {};
  KIT_COLUMNS.forEach(column => {
    asArray(source[column.key]).forEach((item, index) => {
      const link = normalizeGuideLink(item?.guide_link);
      if (!linkMatchesWeapon(link, weaponId)) return;
      matches.push({
        name: String(item?.name || column.label),
        columnKey: column.key,
        columnLabel: column.label,
        index,
        link,
      });
    });
  });
  return matches;
}

async function fetchRelatedKits(weaponId) {
  const { data, error } = await supabaseClient.rpc('list_kits', { input_code: state.adminMode });
  if (error) throw error;
  return (data || [])
    .map(kit => ({ ...kit, matches: kitMatches(kit, weaponId) }))
    .filter(kit => kit.matches.length > 0)
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
}

async function fetchRelatedTiers(weaponId) {
  const [rowsRes, items] = await Promise.all([
    disableQueryRetry(supabaseClient.from('tierlist_rows').select('id,name,color,sort_order').order('sort_order', { ascending: true })),
    publicGuideRows('tierlist_items', 'id,row_id,column_key,name,image_url,extra_fields,sort_order', weaponId),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  const rows = new Map((rowsRes.data || []).map(row => [String(row.id), row]));
  return items
    .map(item => ({
      ...item,
      link: getGuideLinkFromFields(item.extra_fields),
      row: rows.get(String(item.row_id || '')) || null,
      column: TIER_COLUMNS.find(column => column.key === item.column_key) || null,
    }))
    .sort((a, b) => {
      const rowDelta = Number(a.row?.sort_order ?? 9999) - Number(b.row?.sort_order ?? 9999);
      return rowDelta || Number(a.sort_order || 0) - Number(b.sort_order || 0);
    });
}

async function settleSection(label, request, errors) {
  try {
    return await request;
  } catch (error) {
    console.warn(`[Guías] ${label}:`, error?.message || error);
    errors.push(label);
    return [];
  }
}

export function loadGuideRelations(weaponId, { force = false } = {}) {
  const weaponKey = String(weaponId || '');
  if (!weaponKey) return Promise.resolve(emptyRelations());
  const key = relationKey(weaponKey);
  const current = relationSnapshot(weaponKey);
  if (!force && current.status === 'ready' && Date.now() - current.loadedAt < CACHE_TTL_MS) {
    return Promise.resolve(current.data);
  }
  if (relationPromises.has(key)) return relationPromises.get(key);

  relationCache.set(key, { ...current, status: 'loading' });
  const promise = withTimeout((async () => {
    const errors = [];
    const [logs, kits, tiers] = await Promise.all([
      settleSection('cambios relacionados', fetchRelatedLogs(weaponKey), errors),
      settleSection('kits relacionados', fetchRelatedKits(weaponKey), errors),
      settleSection('tierlist relacionada', fetchRelatedTiers(weaponKey), errors),
    ]);
    const data = { logs, kits, tiers, errors };
    relationCache.set(key, { status: 'ready', loadedAt: Date.now(), data });
    return data;
  })(), 12000, 'Las conexiones de la Guía').catch(error => {
    console.warn('[Guías] Relaciones:', error?.message || error);
    const data = { ...emptyRelations(), errors: ['conexiones'] };
    relationCache.set(key, { status: 'error', loadedAt: Date.now(), data });
    return data;
  }).finally(() => relationPromises.delete(key));

  relationPromises.set(key, promise);
  return promise;
}

export function clearGuideRelations(weaponId = null) {
  if (weaponId) {
    relationCache.delete(relationKey(weaponId, false));
    relationCache.delete(relationKey(weaponId, true));
    relationPromises.delete(relationKey(weaponId, false));
    relationPromises.delete(relationKey(weaponId, true));
    return;
  }
  relationCache.clear();
  relationPromises.clear();
}

function filterForRank(list, rankId, matchSelector) {
  if (!rankId) return list;
  return list.map(entry => {
    const matches = matchSelector(entry).filter(match => linkMatchesRank(match.link, rankId));
    return { ...entry, matches };
  }).filter(entry => entry.matches.length > 0);
}

function relationLogUrl(log, match) {
  const params = new URLSearchParams({ log: String(log.id) });
  if (match?.tab) params.set('tab', match.tab);
  if (match?.id) params.set('entry', match.id);
  return `logs.html?${params.toString()}`;
}

function renderRecentLogs(logs) {
  if (!logs.length) return '<p class="guide-relation-empty">Todavía no hay cambios asociados.</p>';
  return `<div class="guide-change-list">${logs.slice(0, 6).map(log => {
    const first = log.matches[0];
    const extraCount = Math.max(0, log.matches.length - 1);
    const matchLabel = first ? `${first.name}${extraCount ? ` y ${extraCount} más` : ''}` : 'Cambio relacionado';
    const relevance = RELEVANCE_LABELS[log.relevance] || log.relevance || 'Normal';
    return `<a class="guide-change-card" href="${escapeHtml(relationLogUrl(log, first))}">
      <span class="guide-change-meta"><time>${escapeHtml(formatDate(log.created_at))}</time><span>${escapeHtml(relevance)}</span></span>
      <strong>${escapeHtml(log.title || 'Log sin título')}</strong>
      <small>${escapeHtml(matchLabel)}</small>
    </a>`;
  }).join('')}</div>${logs.length > 6 ? `<p class="guide-relation-more">${logs.length - 6} cambios anteriores no mostrados</p>` : ''}`;
}

function renderRelatedKits(kits) {
  if (!kits.length) return '<p class="guide-relation-empty">No aparece en ningún kit publicado.</p>';
  return `<div class="guide-compact-links">${kits.map(kit => {
    const names = kit.matches.map(match => match.columnLabel).filter((value, index, list) => list.indexOf(value) === index);
    const itemName = kit.matches[0]?.name || '';
    const params = new URLSearchParams({ kit: String(kit.id) });
    if (itemName) params.set('item', itemName);
    if (kit.matches[0]?.columnKey) params.set('column', kit.matches[0].columnKey);
    if (Number.isInteger(kit.matches[0]?.index)) params.set('slot', String(kit.matches[0].index));
    return `<a class="guide-compact-link" href="kits.html?${escapeHtml(params.toString())}">
      <strong>${escapeHtml(kit.name || 'Kit sin nombre')}</strong>
      <small>${escapeHtml(names.join(' · ') || 'Objeto relacionado')}</small>
    </a>`;
  }).join('')}</div>`;
}

function renderRelatedTiers(tiers) {
  if (!tiers.length) return '<p class="guide-relation-empty">Aún no tiene posición en la Tierlist.</p>';
  return `<div class="guide-tier-links">${tiers.map(item => {
    const tierName = item.row?.name || 'Sin clasificar';
    const color = item.row?.color || 'var(--theme-text-muted)';
    return `<a class="guide-tier-link" href="tierlist.html?item=${encodeURIComponent(item.id)}">
      <span class="guide-tier-rank" style="--guide-tier-color:${escapeHtml(color)}">${escapeHtml(tierName)}</span>
      <span><strong>${escapeHtml(item.name || 'Elemento')}</strong><small>${escapeHtml(item.column?.label || 'Tierlist')}</small></span>
    </a>`;
  }).join('')}</div>`;
}

export function renderGuideRelations(weaponId, rankId = null) {
  const snapshot = relationSnapshot(weaponId);
  if (snapshot.status === 'idle' || snapshot.status === 'loading') {
    return `<section class="weapon-section-block guide-relations-section" aria-busy="true">
      <div class="guide-relations-heading"><div><span class="guide-relations-eyebrow">Conexiones</span><h3>Relacionado con esta guía</h3></div></div>
      <div class="guide-relations-loading"><span></span><span></span><span></span></div>
    </section>`;
  }

  const data = snapshot.data || emptyRelations();
  const logs = filterForRank(data.logs || [], rankId, entry => entry.matches || []);
  const kits = filterForRank(data.kits || [], rankId, entry => entry.matches || []);
  const tiers = (data.tiers || []).filter(item => linkMatchesRank(item.link, rankId));
  const total = logs.length + kits.length + tiers.length;

  return `<section class="weapon-section-block guide-relations-section" aria-label="Contenido relacionado">
    <div class="guide-relations-heading">
      <div><span class="guide-relations-eyebrow">Conexiones</span><h3>Relacionado con esta guía</h3></div>
      <span class="guide-relations-count">${total} ${total === 1 ? 'referencia' : 'referencias'}</span>
    </div>
    <div class="guide-relations-grid">
      <section class="guide-relation-panel guide-relation-changes">
        <header><span class="guide-relation-icon" aria-hidden="true">↻</span><div><h4>Cambios recientes</h4><small>Últimos logs asociados</small></div><b>${logs.length}</b></header>
        ${renderRecentLogs(logs)}
      </section>
      <section class="guide-relation-panel">
        <header><span class="guide-relation-icon" aria-hidden="true">◇</span><div><h4>Kits</h4><small>Combinaciones donde aparece</small></div><b>${kits.length}</b></header>
        ${renderRelatedKits(kits)}
      </section>
      <section class="guide-relation-panel">
        <header><span class="guide-relation-icon" aria-hidden="true">△</span><div><h4>Tierlist</h4><small>Posición y categoría</small></div><b>${tiers.length}</b></header>
        ${renderRelatedTiers(tiers)}
      </section>
    </div>
    ${data.errors?.length ? '<p class="guide-relations-warning">Algunas conexiones no pudieron comprobarse. El resto de la guía sigue disponible.</p>' : ''}
  </section>`;
}

export function getGuideRelationsStatus(weaponId) {
  return relationSnapshot(weaponId).status;
}

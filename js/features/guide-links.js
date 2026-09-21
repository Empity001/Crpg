import { state } from '../core/state.js';
import { asArray, escapeHtml } from '../core/utils.js';
import { fetchWeaponsAndRanks } from './weapons-source.js';

const GUIDE_LINK_FIELD_KIND = 'guide_link';

let guideOptionsLoaded = false;
let guideOptionsLoading = null;

export function normalizeGuideLink(value = null) {
  if (!value || typeof value !== 'object') return null;
  const weaponId = String(value.weapon_id || '').trim();
  const rankId = String(value.rank_id || '').trim();
  if (!weaponId) return null;
  return { weapon_id: weaponId, rank_id: rankId || '' };
}

export function guideLinkValue(link = null) {
  const normalized = normalizeGuideLink(link);
  return normalized ? `${normalized.weapon_id}|${normalized.rank_id || ''}` : '';
}

export function parseGuideLinkValue(value = '') {
  const [weaponId, rankId = ''] = String(value || '').split('|');
  return normalizeGuideLink({ weapon_id: weaponId, rank_id: rankId });
}

export function getGuideLinkFromFields(fields = []) {
  const found = asArray(fields).find(field => field?._kind === GUIDE_LINK_FIELD_KIND);
  return normalizeGuideLink(found?.value || found);
}

export function setGuideLinkInFields(fields = [], link = null) {
  const clean = asArray(fields).filter(field => field?._kind !== GUIDE_LINK_FIELD_KIND);
  const normalized = normalizeGuideLink(link);
  if (normalized) clean.push({ _kind: GUIDE_LINK_FIELD_KIND, value: normalized });
  return clean;
}

export function visibleExtraFields(fields = []) {
  return asArray(fields).filter(field => field?._kind !== GUIDE_LINK_FIELD_KIND);
}

export function guideLinkUrl(link = null) {
  const normalized = normalizeGuideLink(link);
  if (!normalized) return '';
  const params = new URLSearchParams({ weapon: normalized.weapon_id });
  if (normalized.rank_id) params.set('rank', normalized.rank_id);
  return `guides.html?${params.toString()}`;
}

export function openGuideLink(link = null) {
  const url = guideLinkUrl(link);
  if (url) window.location.href = url;
}

export function renderGuideLinkButton(link = null) {
  const url = guideLinkUrl(link);
  if (!url) return '';
  return `<a class="guide-link-btn" href="${escapeHtml(url)}">Abrir guía</a>`;
}

export async function ensureGuideOptions() {
  if (guideOptionsLoaded || (state.weapons.length && Object.keys(state.weaponRanksByWeapon).length)) {
    guideOptionsLoaded = true;
    return true;
  }
  if (guideOptionsLoading) return guideOptionsLoading;
  guideOptionsLoading = (async () => {
    const [weaponsRes, ranksRes] = await fetchWeaponsAndRanks({
      weaponColumns: 'id,name,published,sort_order',
      rankColumns: 'id,weapon_id,name,sort_order',
    });
    if (weaponsRes.error || ranksRes.error) {
      console.error(weaponsRes.error || ranksRes.error);
      return false;
    }
    state.weapons = weaponsRes.data || [];
    state.weaponRanksByWeapon = {};
    (ranksRes.data || []).forEach((rank) => {
      if (!state.weaponRanksByWeapon[rank.weapon_id]) state.weaponRanksByWeapon[rank.weapon_id] = [];
      state.weaponRanksByWeapon[rank.weapon_id].push(rank);
    });
    guideOptionsLoaded = true;
    return true;
  })();
  return guideOptionsLoading;
}

export function renderGuideLinkOptions(selected = null) {
  const selectedValue = guideLinkValue(selected);
  const weapons = [...state.weapons].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  const options = ['<option value="">Sin asociación</option>'];
  weapons.forEach((weapon) => {
    const ranks = asArray(state.weaponRanksByWeapon[weapon.id]);
    if (!ranks.length) {
      const value = `${weapon.id}|`;
      options.push(`<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(weapon.name || 'Guía sin nombre')}</option>`);
      return;
    }
    ranks.forEach((rank) => {
      const value = `${weapon.id}|${rank.id}`;
      options.push(`<option value="${escapeHtml(value)}" ${value === selectedValue ? 'selected' : ''}>${escapeHtml(weapon.name || 'Guía sin nombre')} / ${escapeHtml(rank.name || 'Rango')}</option>`);
    });
  });
  return options.join('');
}

export async function hydrateGuideLinkSelect(selectId, selected = null) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '<option value="">Cargando guías...</option>';
  const ok = await ensureGuideOptions();
  select.innerHTML = ok
    ? renderGuideLinkOptions(selected)
    : '<option value="">No se pudieron cargar las guías</option>';
}

export function readGuideLinkSelect(selectId) {
  return parseGuideLinkValue(document.getElementById(selectId)?.value || '');
}

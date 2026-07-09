import { asArray } from '../core/utils.js';
import { normalizeGuideLink } from './guide-links.js';

const INFO_VISUALS_KIND = 'info_visuals';

export function normalizeInfoVisuals(visuals = []) {
  return asArray(visuals)
    .map(item => ({
      name: String(item?.name || '').trim(),
      image_url: String(item?.image_url || '').trim(),
      guide_link: normalizeGuideLink(item?.guide_link),
    }))
    .filter(item => item.name || item.image_url || item.guide_link);
}

export function getInfoVisuals(sections = []) {
  const section = asArray(sections).find(item => item?._kind === INFO_VISUALS_KIND);
  return normalizeInfoVisuals(section?.images || section?.visuals || []);
}

export function visibleRankSections(sections = []) {
  return asArray(sections).filter(item => item?._kind !== INFO_VISUALS_KIND);
}

export function setInfoVisualsInSections(sections = [], visuals = []) {
  const clean = visibleRankSections(sections);
  const normalized = normalizeInfoVisuals(visuals);
  if (normalized.length) {
    clean.unshift({
      _kind: INFO_VISUALS_KIND,
      title: 'Recursos visuales',
      images: normalized,
    });
  }
  return clean;
}

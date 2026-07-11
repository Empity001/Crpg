export const PAGE_KEYS = Object.freeze(['logs', 'guides', 'tierlist', 'kits', 'about', 'admin']);

export function normalizePageKey(value) {
  return value === 'weapons' ? 'guides' : value;
}

export function normalizePageKeys(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map(normalizePageKey))]
    .filter(value => PAGE_KEYS.includes(value));
}

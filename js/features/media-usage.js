import { supabaseClient } from '../config.js';
import { state } from '../core/state.js';
import { asArray, escapeHtml, safeUrl } from '../core/utils.js';

function addUsage(map, url, label) {
  const normalized = safeUrl(url);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(label);
}

async function loadLogsWithOptionalCover() {
  let result = await supabaseClient.from('logs').select('id,title,cover_image_url');
  const details = `${result.error?.message || ''} ${result.error?.details || ''}`;
  if (result.error && /cover_image_url/i.test(details)) {
    result = await supabaseClient.from('logs').select('id,title');
    if (!result.error) result.data = (result.data || []).map(log => ({ ...log, cover_image_url: null }));
  }
  return result.data || [];
}

function addRecipeUsages(usage, ranks, weapons) {
  const weaponById = new Map(weapons.map(weapon => [weapon.id, weapon]));
  weapons.forEach(weapon => addUsage(usage, weapon.image_url, `Arma: ${weapon.name}`));

  ranks.forEach(rank => {
    const weaponName = weaponById.get(rank.weapon_id)?.name || 'Arma';
    const configuredMethods = asArray(rank.upgrade_recipe?.methods);
    const methods = configuredMethods.length ? configuredMethods : (rank.upgrade_recipe ? [rank.upgrade_recipe] : []);
    addUsage(usage, rank.image_url, `Arma: ${weaponName} > Rango: ${rank.name}`);

    methods.forEach((method, methodIndex) => {
      const inputLabels = method.mode === 'smithing'
        ? ['Plantilla', 'Equipo', 'Material']
        : method.mode === 'furnace' ? ['Ingrediente', 'Combustible'] : [];
      const methodLabel = method.title || `Método ${methodIndex + 1}`;
      asArray(method.materials).forEach(material => addUsage(usage, material.image_url, `Receta: ${weaponName} > ${methodLabel} > ${material.name}`));
      asArray(method.grid).forEach((material, index) => addUsage(usage, material.image_url, `Crafteo: ${weaponName} > ${methodLabel} > Slot ${index + 1}${material.name ? ` (${material.name})` : ''}`));
      asArray(method.inputs).forEach((material, index) => addUsage(usage, material.image_url, `Fabricación: ${weaponName} > ${methodLabel} > ${inputLabels[index] || `Slot ${index + 1}`}${material.name ? ` (${material.name})` : ''}`));
      addUsage(usage, method.result?.image_url, `Receta: ${weaponName} > ${methodLabel} > Resultado`);
    });
  });
}

export async function buildMediaUsageIndex() {
  const usage = new Map();
  const [logs, mobsResult, itemsResult, tierResult, weaponsResult, ranksResult, kitsResult] = await Promise.all([
    loadLogsWithOptionalCover(),
    supabaseClient.from('log_mobs').select('log_id,name,image_url'),
    supabaseClient.from('log_items').select('log_id,name,item_type,image_url'),
    supabaseClient.from('tierlist_items').select('name,image_url'),
    supabaseClient.from('weapons').select('id,name,image_url'),
    supabaseClient.from('weapon_ranks').select('id,weapon_id,name,image_url,upgrade_recipe'),
    supabaseClient.from('kits').select('name,items'),
  ]);
  const mobs = mobsResult.data || [];
  const logItems = itemsResult.data || [];
  const tierItems = tierResult.data || [];
  const weapons = weaponsResult.data || [];
  const ranks = ranksResult.data || [];
  const kits = kitsResult.data || [];
  const logById = new Map(logs.map(log => [log.id, log]));

  logs.forEach(log => addUsage(usage, log.cover_image_url, `Log: ${log.title} > Portada`));
  mobs.forEach(mob => addUsage(usage, mob.image_url, `Log: ${logById.get(mob.log_id)?.title || 'Log'} > Mob: ${mob.name}`));
  logItems.forEach(item => addUsage(usage, item.image_url, `Log: ${logById.get(item.log_id)?.title || 'Log'} > ${item.item_type === '_libre' ? 'Libre' : 'Item'}: ${item.name}`));
  tierItems.forEach(item => addUsage(usage, item.image_url, `Tierlist: ${item.name}`));
  addRecipeUsages(usage, ranks, weapons);

  kits.forEach(kit => {
    ['weapon', 'accessory', 'subweapon'].forEach(column => {
      asArray(kit.items?.[column]).forEach((item, index) => {
        addUsage(usage, item?.image_url, `Kit: ${kit.name || 'Kit'} > ${column} ${index + 1}${item?.name ? ` (${item.name})` : ''}`);
      });
    });
  });

  addUsage(usage, state.backgroundConfig?.image_url, 'Fondo de página');
  Object.entries(state.heroBannerConfig || {}).forEach(([pageKey, entry]) => addUsage(usage, entry?.image_url, `Banner de cabecera: ${pageKey}`));
  addUsage(usage, state.faviconUrl, 'Favicon');
  addUsage(usage, state.siteLogoUrl, 'Logo del sitio');
  asArray(state.aboutBlocks).forEach((block, index) => {
    if (block.kind === 'image') addUsage(usage, block.url, `Acerca del Server: imagen ${index + 1}`);
  });
  return usage;
}

export function renderMediaUsageList(asset, usageIndex) {
  const usages = usageIndex.get(safeUrl(asset.url)) || [];
  if (!usages.length) return '<p class="media-usage-empty">Sin usos detectados</p>';
  const visible = usages.slice(0, 4);
  const extra = usages.length - visible.length;
  return `
    <ul class="media-usage-list">
      ${visible.map(usage => `<li>${escapeHtml(usage)}</li>`).join('')}
      ${extra > 0 ? `<li>+ ${extra} uso(s) más</li>` : ''}
    </ul>`;
}

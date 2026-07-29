import { networkApi } from './api.js';
import { initializeNetworkSession, setNetworkMode, signInNetwork, signOutNetwork } from './session.js';

let sites = [];
let selectedSite = null;
let roleBundle = { roles: [], permissions: [], mappings: [] };
let themeVersions = [];
let toastTimer = null;
let confirmResolver = null;

function showToast(message, error = false) {
  const toast = document.getElementById('network-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('is-error', error);
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 3800);
}

function setBusy(button, busy, busyText = 'Guardando…') {
  if (!button) return;
  if (busy) {
    button.dataset.idleText = button.textContent;
    button.textContent = busyText;
  } else if (button.dataset.idleText) {
    button.textContent = button.dataset.idleText;
    delete button.dataset.idleText;
  }
  button.disabled = busy;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

function parseSubmenu(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const [label, ...urlParts] = line.split('|');
    const cleanLabel = label.trim() || `Subtab ${index + 1}`;
    return { key: slugify(cleanLabel) || `subtab-${index + 1}`, label: cleanLabel, url: urlParts.join('|').trim() || '#', icon: '' };
  });
}

function addNavigationRow(item = {}) {
  const list = document.getElementById('owner-navigation-list');
  const row = document.createElement('article');
  row.className = 'owner-navigation-row';
  row.dataset.key = item.key || '';
  row.innerHTML = `
    <div class="owner-navigation-row-head"><strong></strong><div><button type="button" data-nav-up title="Mover arriba">↑</button><button type="button" data-nav-down title="Mover abajo">↓</button><button type="button" data-nav-remove title="Eliminar">×</button></div></div>
    <div class="owner-navigation-fields">
      <label><span>Etiqueta</span><input data-nav-label maxlength="80" /></label>
      <label><span>Icono o emoji</span><input data-nav-icon maxlength="32" /></label>
      <label class="owner-field-wide"><span>URL</span><input data-nav-url maxlength="500" /></label>
      <label><span>Rol requerido</span><input data-nav-role maxlength="48" placeholder="Vacío = todos" /></label>
      <label class="owner-check"><input data-nav-item-visible type="checkbox" /> Visible</label>
      <label class="owner-check"><input data-nav-item-sticky type="checkbox" /> Destacada</label>
      <label class="owner-field-wide"><span>Submenú — Etiqueta | URL, uno por línea</span><textarea data-nav-children rows="3"></textarea></label>
    </div>`;
  row.querySelector('strong').textContent = item.label || 'Nueva tab';
  row.querySelector('[data-nav-label]').value = item.label || '';
  row.querySelector('[data-nav-icon]').value = item.icon || '';
  row.querySelector('[data-nav-url]').value = item.url || '#';
  row.querySelector('[data-nav-role]').value = item.requiredRole || '';
  row.querySelector('[data-nav-item-visible]').checked = item.visible !== false;
  row.querySelector('[data-nav-item-sticky]').checked = item.sticky === true;
  row.querySelector('[data-nav-children]').value = (Array.isArray(item.children) ? item.children : []).map(child => `${child.label || child.key} | ${child.url || '#'}`).join('\n');
  row.querySelector('[data-nav-label]').addEventListener('input', event => { row.querySelector('strong').textContent = event.target.value || 'Nueva tab'; });
  row.querySelector('[data-nav-up]').addEventListener('click', () => row.previousElementSibling?.before(row));
  row.querySelector('[data-nav-down]').addEventListener('click', () => row.nextElementSibling?.after(row));
  row.querySelector('[data-nav-remove]').addEventListener('click', () => row.remove());
  list.append(row);
}

function renderNavigationEditor(items) {
  const list = document.getElementById('owner-navigation-list');
  list.replaceChildren();
  (Array.isArray(items) ? items : []).forEach(addNavigationRow);
}

function collectNavigationItems() {
  return [...document.querySelectorAll('.owner-navigation-row')].map((row, index) => {
    const label = row.querySelector('[data-nav-label]').value.trim() || `Tab ${index + 1}`;
    return {
      key: row.dataset.key || slugify(label) || `tab-${index + 1}`,
      label,
      icon: row.querySelector('[data-nav-icon]').value.trim(),
      url: row.querySelector('[data-nav-url]').value.trim() || '#',
      visible: row.querySelector('[data-nav-item-visible]').checked,
      sticky: row.querySelector('[data-nav-item-sticky]').checked,
      requiredRole: row.querySelector('[data-nav-role]').value.trim() || null,
      children: parseSubmenu(row.querySelector('[data-nav-children]').value),
    };
  });
}

function weightsText(weights) {
  return Object.entries(weights || {}).map(([field, weight]) => `${field} = ${weight}`).join('\n');
}

function parseWeights(value) {
  return Object.fromEntries(String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [field, rawWeight] = line.split('=');
    return [field.trim(), Math.max(0, Math.min(20, Number(rawWeight) || 0))];
  }).filter(([field]) => field));
}

function synonymsText(synonyms) {
  return (Array.isArray(synonyms) ? synonyms : []).map(row => `${row.term} = ${(row.alternatives || []).join(', ')}`).join('\n');
}

function parseSynonyms(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
    const [term, rawAlternatives] = line.split('=');
    return { term: term.trim(), alternatives: String(rawAlternatives || '').split(',').map(item => item.trim()).filter(Boolean) };
  }).filter(row => row.term && row.alternatives.length);
}

function siteLink(site) {
  if (site.slug === 'culones-rpg') return 'logs.html';
  const fallback = `site.html?site=${encodeURIComponent(site.slug)}`;
  if (!site.public_base_url) return fallback;
  try {
    const parsed = new URL(site.public_base_url, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : fallback;
  } catch {
    return fallback;
  }
}

function requestConfirm(title, copy, requiredText = '') {
  const dialog = document.getElementById('owner-confirm-dialog');
  document.getElementById('owner-confirm-title').textContent = title;
  document.getElementById('owner-confirm-copy').textContent = copy;
  document.getElementById('owner-confirm-input-wrap').classList.toggle('hidden', !requiredText);
  document.getElementById('owner-confirm-label').textContent = requiredText ? `Escribe ${requiredText}` : 'Confirmación';
  const input = document.getElementById('owner-confirm-input');
  const submit = document.getElementById('owner-confirm-submit');
  input.value = '';
  submit.disabled = !!requiredText;
  input.oninput = () => { submit.disabled = input.value !== requiredText; };
  dialog.showModal();
  return new Promise(resolve => { confirmResolver = resolve; });
}

function settleConfirm(value) {
  if (confirmResolver) confirmResolver(value);
  confirmResolver = null;
}

function renderSiteList() {
  const list = document.getElementById('owner-site-list');
  if (!list) return;
  list.replaceChildren();
  for (const site of sites) {
    const button = document.createElement('button');
    button.type = 'button';
    button.classList.toggle('is-active', selectedSite?.id === site.id);
    button.dataset.siteId = site.id;
    const name = document.createElement('strong');
    name.textContent = site.name;
    const slug = document.createElement('small');
    slug.textContent = site.slug;
    const status = document.createElement('i');
    status.dataset.status = site.status;
    status.title = site.status;
    button.append(name, slug, status);
    button.addEventListener('click', () => void selectSite(site.id));
    list.append(button);
  }
}

function setField(id, value) {
  const element = document.getElementById(id);
  if (element) element.value = value ?? '';
}

function themeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function updateThemePreview() {
  const preview = document.getElementById('owner-theme-preview');
  if (!preview) return;
  preview.style.setProperty('--preview-bg', document.getElementById('owner-color-background').value);
  preview.style.setProperty('--preview-surface', document.getElementById('owner-color-surface').value);
  preview.style.setProperty('--preview-text', document.getElementById('owner-color-text').value);
  preview.style.setProperty('--preview-muted', document.getElementById('owner-color-muted').value);
  preview.style.setProperty('--preview-accent', document.getElementById('owner-color-accent').value);
  preview.style.setProperty('--preview-border', document.getElementById('owner-color-border')?.value || '#303030');
  preview.style.setProperty('--preview-heading-font', document.getElementById('owner-font-heading')?.value || 'Inter, sans-serif');
  preview.style.setProperty('--preview-radius', `${document.getElementById('owner-radius')?.value || 16}px`);
}

function fillSiteForm(site) {
  const nav = site.navigation_config || {};
  const search = site.search_config || {};
  const themeConfig = site.draft_theme_config || site.theme_config || {};
  const palette = themeConfig.palette || {};
  setField('owner-site-id', site.id);
  setField('owner-site-name', site.name);
  setField('owner-site-slug', site.slug);
  setField('owner-site-description', site.description);
  setField('owner-site-status', site.status);
  setField('owner-site-guild', site.discord_guild_id);
  setField('owner-site-url', site.public_base_url);
  renderNavigationEditor(nav.items);
  setField('owner-search-position', search.position || 'header');
  setField('owner-search-scope', search.scope || 'site');
  setField('owner-search-placeholder', search.placeholder || 'Buscar…');
  setField('owner-search-sources', Array.isArray(search.sources) ? search.sources.join(', ') : '');
  setField('owner-search-weights', weightsText(search.weights));
  setField('owner-search-synonyms', synonymsText(search.synonyms));
  setField('owner-search-group', search.groupBy || '');
  setField('owner-search-renderer', search.renderer || 'default');
  setField('owner-search-filters', Array.isArray(search.filters) ? search.filters.join(', ') : '');
  setField('owner-color-background', themeColor(palette.background, '#050505'));
  setField('owner-color-surface', themeColor(palette.surface, '#101010'));
  setField('owner-color-elevated', themeColor(palette.elevated, '#171717'));
  setField('owner-color-text', themeColor(palette.text, '#ffffff'));
  setField('owner-color-muted', themeColor(palette.muted, '#a3a3a3'));
  setField('owner-color-accent', themeColor(palette.accent, '#ffffff'));
  setField('owner-color-secondary', themeColor(palette.secondary, '#d4d4d4'));
  setField('owner-color-border', themeColor(palette.border, '#303030'));
  setField('owner-color-selection', themeColor(palette.selection, '#ffffff'));
  setField('owner-color-success', themeColor(palette.success, '#2fd18a'));
  setField('owner-color-info', themeColor(palette.info, '#38bdf8'));
  setField('owner-color-warning', themeColor(palette.warning, '#f6c453'));
  setField('owner-color-event', themeColor(palette.event, '#f472b6'));
  setField('owner-color-danger', themeColor(palette.danger, '#ef4444'));
  setField('owner-color-disabled', themeColor(palette.disabled, '#525252'));
  setField('owner-font-body', themeConfig.typography?.body || 'Inter, system-ui, sans-serif');
  setField('owner-font-heading', themeConfig.typography?.heading || 'Inter, system-ui, sans-serif');
  setField('owner-font-mono', themeConfig.typography?.mono || 'ui-monospace, monospace');
  setField('owner-font-scale', themeConfig.typography?.scale || 1);
  setField('owner-line-height', themeConfig.typography?.lineHeight || 1.5);
  setField('owner-spacing-scale', themeConfig.density?.spacing || 1);
  setField('owner-radius', themeConfig.density?.radius ?? 16);
  setField('owner-border-width', themeConfig.density?.borderWidth ?? 1);
  setField('owner-motion-duration', themeConfig.motion?.duration ?? 220);
  setField('owner-motion-easing', themeConfig.motion?.easing || 'ease');
  setField('owner-asset-logo', themeConfig.assets?.logo || '');
  setField('owner-asset-favicon', themeConfig.assets?.favicon || '');
  setField('owner-asset-background', themeConfig.assets?.background || '');
  setField('owner-asset-banner', themeConfig.assets?.banner || '');
  setField('owner-custom-css', themeConfig.customCss || '');
  document.getElementById('owner-motion-enabled').checked = themeConfig.motion?.enabled !== false;
  updateThemePreview();
  document.getElementById('owner-search-enabled').checked = search.enabled !== false;
  document.querySelectorAll('[data-breakpoint]').forEach(fieldset => {
    const key = fieldset.dataset.breakpoint;
    const config = nav[key] || {};
    fieldset.querySelector('[data-nav-position]').value = config.position || (key === 'mobile' ? 'bottom' : 'top');
    fieldset.querySelector('[data-nav-visible]').checked = config.visible !== false;
    fieldset.querySelector('[data-nav-alignment]').value = config.alignment || (key === 'desktop' ? 'center' : 'start');
    fieldset.querySelector('[data-nav-overflow]').value = config.overflow || 'scroll';
    fieldset.querySelector('[data-nav-sticky]').checked = config.sticky === true;
  });
  document.querySelectorAll('[data-search-breakpoint]').forEach(fieldset => {
    const key = fieldset.dataset.searchBreakpoint;
    const config = search.breakpoints?.[key] || {};
    fieldset.querySelector('[data-search-position]').value = config.position || 'inherit';
    fieldset.querySelector('[data-search-visible]').checked = config.visible !== false;
  });
  document.getElementById('owner-site-title').textContent = site.name;
  document.getElementById('owner-site-status-label').textContent = `${site.status} · ${site.slug}`;
  const open = document.getElementById('owner-open-site');
  open.href = siteLink(site);
  open.classList.toggle('hidden', !!site.deleted_at);
  const builder = document.getElementById('owner-open-builder');
  builder.href = `builder.html?site=${encodeURIComponent(site.id)}`;
  builder.classList.toggle('hidden', !!site.deleted_at);
  const archiveButton = document.getElementById('owner-archive-site-btn');
  const protectedSite = site.id === '00000000-0000-4000-8000-000000000001';
  archiveButton.hidden = protectedSite;
  archiveButton.textContent = site.deleted_at ? 'Restaurar instancia' : 'Archivar instancia';
  archiveButton.dataset.action = site.deleted_at ? 'restore' : 'archive';
  document.getElementById('owner-danger-zone').classList.toggle('is-protected', protectedSite);
}

function permissionKeysFor(roleId) {
  return roleBundle.permissions.filter(item => item.role_profile_id === roleId && item.effect === 'allow').map(item => item.permission_key);
}

function mappingsFor(roleId) {
  return roleBundle.mappings.filter(item => item.role_profile_id === roleId);
}

function renderRoles() {
  const list = document.getElementById('owner-role-list');
  if (!list) return;
  list.replaceChildren();
  for (const role of roleBundle.roles) {
    const permissions = permissionKeysFor(role.id);
    const mappings = mappingsFor(role.id);
    const card = document.createElement('article');
    card.className = 'owner-role-card';
    const copy = document.createElement('div');
    const title = document.createElement('h4');
    title.textContent = role.display_name;
    const code = document.createElement('code');
    code.textContent = ` <${role.role_key}>`;
    title.append(code);
    const description = document.createElement('p');
    description.textContent = role.description || 'Sin descripción.';
    const meta = document.createElement('small');
    meta.textContent = `${permissions.length} permiso(s) · ${mappings.length ? `Discord ${mappings.map(item => item.discord_role_id).join(', ')}` : 'sin rol Discord'}`;
    copy.append(title, description, meta);
    const actions = document.createElement('div');
    actions.className = 'owner-role-actions';
    const edit = document.createElement('button');
    edit.type = 'button'; edit.textContent = 'Editar';
    edit.addEventListener('click', () => openRoleDialog(role));
    actions.append(edit);
    if (!role.is_system) {
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = 'Eliminar';
      remove.addEventListener('click', () => void removeRole(role));
      actions.append(remove);
    }
    card.append(copy, actions);
    list.append(card);
  }
}

function renderThemeVersions() {
  const list = document.getElementById('owner-theme-version-list');
  if (!list) return;
  list.replaceChildren();
  for (const version of themeVersions) {
    const card = document.createElement('article');
    card.className = 'owner-theme-version-card';
    const copy = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = `Versión ${version.version_number} · ${version.stage}`;
    const meta = document.createElement('small'); meta.textContent = `${new Date(version.created_at).toLocaleString('es')} · ${version.reason || 'Sin nota'}`;
    copy.append(title, meta);
    const restore = document.createElement('button'); restore.type = 'button'; restore.textContent = 'Restaurar';
    restore.addEventListener('click', () => void restoreThemeVersion(version));
    card.append(copy, restore); list.append(card);
  }
  if (!list.children.length) {
    const empty = document.createElement('p'); empty.className = 'owner-empty'; empty.textContent = 'Todavía no hay versiones visuales.'; list.append(empty);
  }
}

async function loadSites(preferredId = null) {
  sites = await networkApi('list_sites');
  const nextId = preferredId || selectedSite?.id || sites[0]?.id;
  renderSiteList();
  if (nextId) await selectSite(nextId);
}

async function selectSite(siteId) {
  selectedSite = sites.find(site => site.id === siteId) || null;
  renderSiteList();
  if (!selectedSite) return;
  fillSiteForm(selectedSite);
  [roleBundle, themeVersions] = await Promise.all([
    networkApi('list_roles', { site_id: selectedSite.id }),
    networkApi('list_theme_versions', { site_id: selectedSite.id }).catch(() => []),
  ]);
  renderRoles();
  renderThemeVersions();
}

async function restoreThemeVersion(version) {
  if (!selectedSite) return;
  const publish = document.querySelector('input[name="owner-theme-scope"]:checked')?.value === 'published';
  if (!await requestConfirm(
    'Restaurar apariencia',
    `La versión ${version.version_number} se restaurará como ${publish ? 'apariencia publicada' : 'borrador visual'}.`,
  )) return;
  try {
    const updated = await networkApi('restore_theme_version', {
      site_id: selectedSite.id,
      version_number: version.version_number,
      publish,
    });
    const index = sites.findIndex(site => site.id === updated.id); if (index >= 0) sites[index] = updated;
    selectedSite = updated; fillSiteForm(updated);
    themeVersions = await networkApi('list_theme_versions', { site_id: selectedSite.id }); renderThemeVersions();
    showToast(`Versión visual ${version.version_number} restaurada.`);
  } catch (error) { showToast(error.message, true); }
}

function sitePayload() {
  const navigation = { ...(selectedSite.navigation_config || {}) };
  for (const key of ['desktop', 'tablet', 'mobile']) {
    const fieldset = document.querySelector(`[data-breakpoint="${key}"]`);
    navigation[key] = {
      ...(navigation[key] || {}),
      position: fieldset.querySelector('[data-nav-position]').value,
      visible: fieldset.querySelector('[data-nav-visible]').checked,
      alignment: fieldset.querySelector('[data-nav-alignment]').value,
      overflow: fieldset.querySelector('[data-nav-overflow]').value,
      sticky: fieldset.querySelector('[data-nav-sticky]').checked,
    };
  }
  navigation.items = collectNavigationItems();
  const searchBreakpoints = {};
  document.querySelectorAll('[data-search-breakpoint]').forEach(fieldset => {
    searchBreakpoints[fieldset.dataset.searchBreakpoint] = {
      position: fieldset.querySelector('[data-search-position]').value,
      visible: fieldset.querySelector('[data-search-visible]').checked,
    };
  });
  return {
    site_id: selectedSite.id,
    name: document.getElementById('owner-site-name').value,
    slug: document.getElementById('owner-site-slug').value,
    description: document.getElementById('owner-site-description').value,
    status: document.getElementById('owner-site-status').value,
    discord_guild_id: document.getElementById('owner-site-guild').value,
    public_base_url: document.getElementById('owner-site-url').value,
    theme_config: {
      ...(selectedSite.draft_theme_config || selectedSite.theme_config || {}),
      mode: 'custom',
      palette: {
        background: document.getElementById('owner-color-background').value,
        surface: document.getElementById('owner-color-surface').value,
        elevated: document.getElementById('owner-color-elevated').value,
        text: document.getElementById('owner-color-text').value,
        muted: document.getElementById('owner-color-muted').value,
        accent: document.getElementById('owner-color-accent').value,
        secondary: document.getElementById('owner-color-secondary').value,
        border: document.getElementById('owner-color-border').value,
        selection: document.getElementById('owner-color-selection').value,
        success: document.getElementById('owner-color-success').value,
        info: document.getElementById('owner-color-info').value,
        warning: document.getElementById('owner-color-warning').value,
        event: document.getElementById('owner-color-event').value,
        danger: document.getElementById('owner-color-danger').value,
        disabled: document.getElementById('owner-color-disabled').value,
      },
      typography: {
        body: document.getElementById('owner-font-body').value,
        heading: document.getElementById('owner-font-heading').value,
        mono: document.getElementById('owner-font-mono').value,
        scale: Number(document.getElementById('owner-font-scale').value),
        lineHeight: Number(document.getElementById('owner-line-height').value),
      },
      density: {
        spacing: Number(document.getElementById('owner-spacing-scale').value),
        radius: Number(document.getElementById('owner-radius').value),
        borderWidth: Number(document.getElementById('owner-border-width').value),
      },
      motion: {
        enabled: document.getElementById('owner-motion-enabled').checked,
        duration: Number(document.getElementById('owner-motion-duration').value),
        easing: document.getElementById('owner-motion-easing').value,
      },
      assets: {
        logo: document.getElementById('owner-asset-logo').value,
        favicon: document.getElementById('owner-asset-favicon').value,
        background: document.getElementById('owner-asset-background').value,
        banner: document.getElementById('owner-asset-banner').value,
      },
      customCss: document.getElementById('owner-custom-css').value,
    },
    navigation_config: navigation,
    search_config: {
      ...(selectedSite.search_config || {}),
      enabled: document.getElementById('owner-search-enabled').checked,
      position: document.getElementById('owner-search-position').value,
      scope: document.getElementById('owner-search-scope').value,
      placeholder: document.getElementById('owner-search-placeholder').value,
      sources: document.getElementById('owner-search-sources').value.split(',').map(value => value.trim()).filter(Boolean),
      weights: parseWeights(document.getElementById('owner-search-weights').value),
      synonyms: parseSynonyms(document.getElementById('owner-search-synonyms').value),
      groupBy: document.getElementById('owner-search-group').value.trim() || null,
      renderer: document.getElementById('owner-search-renderer').value,
      filters: document.getElementById('owner-search-filters').value.split(',').map(value => value.trim()).filter(Boolean),
      breakpoints: searchBreakpoints,
    },
  };
}

async function saveSite() {
  if (!selectedSite) return;
  const button = document.getElementById('owner-save-site-btn');
  setBusy(button, true);
  try {
    const payload = sitePayload();
    const themeConfig = payload.theme_config;
    delete payload.theme_config;
    let updated = await networkApi('update_site', payload);
    const themeScope = document.querySelector('input[name="owner-theme-scope"]:checked')?.value || 'draft';
    if (themeScope === 'personal') {
      localStorage.setItem(`empi_network_theme_preview_${selectedSite.id}`, JSON.stringify(themeConfig));
      updated = { ...updated, draft_theme_config: themeConfig };
    } else {
      updated = await networkApi('save_theme', {
        site_id: selectedSite.id,
        theme_config: themeConfig,
        publish: themeScope === 'published',
        reason: themeScope === 'published' ? 'Apariencia publicada desde Owner' : 'Borrador de apariencia desde Owner',
      });
    }
    const index = sites.findIndex(site => site.id === updated.id);
    if (index >= 0) sites[index] = updated;
    selectedSite = updated;
    fillSiteForm(updated);
    renderSiteList();
    const message = themeScope === 'personal'
      ? 'Configuración guardada; la apariencia quedó solo en este navegador.'
      : themeScope === 'published'
        ? 'Instancia y apariencia publicadas con una nueva versión.'
        : 'Instancia guardada; la apariencia quedó como borrador versionado.';
    showToast(message);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function openNewSiteDialog() {
  const dialog = document.getElementById('new-site-dialog');
  document.getElementById('new-site-form').reset();
  delete document.getElementById('new-site-slug').dataset.touched;
  dialog.showModal();
  document.getElementById('new-site-name').focus();
}

async function createSite(event) {
  event.preventDefault();
  const button = document.getElementById('new-site-submit');
  setBusy(button, true, 'Creando…');
  try {
    const created = await networkApi('create_site', {
      name: document.getElementById('new-site-name').value,
      slug: document.getElementById('new-site-slug').value,
      discord_guild_id: document.getElementById('new-site-guild').value,
      public_base_url: '',
    });
    document.getElementById('new-site-dialog').close();
    await loadSites(created.id);
    showToast('Instancia creada con su perfil <administrador>.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function openRoleDialog(role = null) {
  const form = document.getElementById('role-form');
  form.reset();
  setField('role-id', role?.id || '');
  setField('role-name', role?.display_name || '');
  setField('role-key', role?.role_key || '');
  setField('role-description', role?.description || '');
  const mapping = role ? mappingsFor(role.id)[0] : null;
  setField('role-discord-id', mapping?.discord_role_id || '');
  const permissions = new Set(role ? permissionKeysFor(role.id) : []);
  const knownPermissions = new Set([...form.querySelectorAll('.owner-permissions input')].map(input => input.value));
  form.querySelectorAll('.owner-permissions input').forEach(input => { input.checked = permissions.has(input.value); });
  setField('role-custom-permissions', [...permissions].filter(permission => !knownPermissions.has(permission) && permission !== 'site.admin.*').join('\n'));
  const keyInput = document.getElementById('role-key');
  delete keyInput.dataset.touched;
  keyInput.disabled = !!role?.is_system;
  document.getElementById('role-dialog-title').textContent = role ? `Editar <${role.role_key}>` : 'Nuevo perfil';
  document.getElementById('role-dialog').showModal();
}

async function saveRole(event) {
  event.preventDefault();
  if (!selectedSite) return;
  const button = document.getElementById('role-submit');
  const roleId = document.getElementById('role-id').value || null;
  const oldMappings = roleId ? mappingsFor(roleId) : [];
  setBusy(button, true);
  try {
    const customPermissions = document.getElementById('role-custom-permissions').value
      .split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const role = await networkApi('upsert_role', {
      site_id: selectedSite.id,
      role_id: roleId,
      display_name: document.getElementById('role-name').value,
      role_key: document.getElementById('role-key').value,
      description: document.getElementById('role-description').value,
      permissions: [...new Set([
        ...[...document.querySelectorAll('.owner-permissions input:checked')].map(input => input.value),
        ...customPermissions,
      ])],
    });
    const discordRoleId = document.getElementById('role-discord-id').value.trim();
    for (const mapping of oldMappings) {
      if (!discordRoleId || mapping.discord_role_id !== discordRoleId) {
        await networkApi('delete_role_mapping', { mapping_id: mapping.id });
      }
    }
    if (discordRoleId && !oldMappings.some(mapping => mapping.discord_role_id === discordRoleId)) {
      await networkApi('set_role_mapping', {
        site_id: selectedSite.id,
        role_profile_id: role.id,
        discord_role_id: discordRoleId,
      });
    }
    document.getElementById('role-dialog').close();
    roleBundle = await networkApi('list_roles', { site_id: selectedSite.id });
    renderRoles();
    showToast(`Perfil <${role.role_key}> guardado.`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

async function removeRole(role) {
  if (!selectedSite || !await requestConfirm('Eliminar perfil', `El perfil <${role.role_key}> y sus mapeos Discord serán eliminados.`)) return;
  try {
    await networkApi('delete_role', { site_id: selectedSite.id, role_id: role.id });
    roleBundle = await networkApi('list_roles', { site_id: selectedSite.id });
    renderRoles();
    showToast('Perfil eliminado.');
  } catch (error) {
    showToast(error.message, true);
  }
}

async function toggleArchiveSite() {
  if (!selectedSite || selectedSite.id === '00000000-0000-4000-8000-000000000001') return;
  const button = document.getElementById('owner-archive-site-btn');
  setBusy(button, true, selectedSite.deleted_at ? 'Restaurando…' : 'Archivando…');
  try {
    const action = selectedSite.deleted_at ? 'restore_site' : 'archive_site';
    if (action === 'archive_site') {
      const confirmed = await requestConfirm(
        'Archivar instancia',
        'La instancia dejará de ser pública, pero todos sus datos y versiones se conservarán.',
        selectedSite.slug,
      );
      if (!confirmed) return;
    } else if (!await requestConfirm('Restaurar instancia', 'La instancia volverá como borrador y tendrás que publicarla cuando esté lista.')) return;
    const updated = await networkApi(action, {
      site_id: selectedSite.id,
      confirm_slug: selectedSite.slug,
      reason: 'Cambio solicitado desde el panel Owner',
    });
    await loadSites(updated.id);
    showToast(action === 'archive_site' ? 'Instancia archivada de forma recuperable.' : 'Instancia restaurada como borrador.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(button, false);
  }
}

function bindTabs() {
  document.querySelectorAll('[data-owner-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-owner-tab]').forEach(item => item.classList.toggle('is-active', item === button));
    document.querySelectorAll('[data-owner-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.ownerPanel !== button.dataset.ownerTab));
  }));
}

function bindEvents() {
  document.getElementById('owner-new-site-btn')?.addEventListener('click', openNewSiteDialog);
  document.getElementById('new-site-name')?.addEventListener('input', event => {
    const slugInput = document.getElementById('new-site-slug');
    if (!slugInput.dataset.touched) slugInput.value = slugify(event.target.value);
  });
  document.getElementById('new-site-slug')?.addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  document.getElementById('new-site-submit')?.addEventListener('click', createSite);
  document.getElementById('owner-save-site-btn')?.addEventListener('click', () => void saveSite());
  document.getElementById('owner-new-role-btn')?.addEventListener('click', () => openRoleDialog());
  document.getElementById('owner-archive-site-btn')?.addEventListener('click', () => void toggleArchiveSite());
  document.getElementById('owner-add-navigation-item')?.addEventListener('click', () => addNavigationRow({ label: 'Nueva tab', url: '#', visible: true }));
  document.querySelectorAll('.owner-color-grid input[type="color"]').forEach(input => input.addEventListener('input', updateThemePreview));
  ['owner-font-heading', 'owner-radius'].forEach(id => document.getElementById(id)?.addEventListener('input', updateThemePreview));
  document.getElementById('role-submit')?.addEventListener('click', saveRole);
  document.getElementById('role-name')?.addEventListener('input', event => {
    const keyInput = document.getElementById('role-key');
    if (!keyInput.disabled && !keyInput.dataset.touched) keyInput.value = slugify(event.target.value).replace(/-/g, '_');
  });
  document.getElementById('role-key')?.addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  document.getElementById('owner-login-btn')?.addEventListener('click', () => void signInNetwork().catch(error => showToast(error.message, true)));
  document.getElementById('owner-logout-btn')?.addEventListener('click', async () => {
    try { await signOutNetwork(); window.location.href = 'index.html'; } catch (error) { showToast(error.message, true); }
  });
  document.getElementById('owner-confirm-submit')?.addEventListener('click', () => settleConfirm(true));
  document.getElementById('owner-confirm-dialog')?.addEventListener('close', () => settleConfirm(document.getElementById('owner-confirm-dialog').returnValue === 'default'));
  bindTabs();
}

async function boot() {
  bindEvents();
  const locked = document.getElementById('owner-locked');
  const editor = document.getElementById('owner-editor');
  try {
    const session = await initializeNetworkSession();
    if (!session.session) {
      locked.querySelector('h2').textContent = 'Conecta tu cuenta de Discord';
      locked.querySelector('p').textContent = 'Solo la identidad PLATFORM_OWNER puede abrir este panel.';
      document.getElementById('owner-login-btn').classList.remove('hidden');
      return;
    }
    if (!session.isOwner) {
      locked.querySelector('h2').textContent = 'Acceso Owner denegado';
      locked.querySelector('p').textContent = 'Tu sesión es válida, pero esta cuenta no es PLATFORM_OWNER.';
      return;
    }
    setNetworkMode('platform_owner');
    document.getElementById('owner-logout-btn').classList.remove('hidden');
    locked.classList.add('hidden');
    editor.classList.remove('hidden');
    await loadSites();
  } catch (error) {
    locked.querySelector('h2').textContent = 'Panel Owner todavía no disponible';
    locked.querySelector('p').textContent = `${error.message} Aplica migration_025 y despliega network-admin-api en staging.`;
    showToast(error.message, true);
  }
}

void boot();

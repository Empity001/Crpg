import { networkApi } from './api.js';
import { initializeNetworkSession, setNetworkMode, signInNetwork, signOutNetwork } from './session.js';

let sites = [];
let selectedSite = null;
let roleBundle = { roles: [], permissions: [], mappings: [] };
let toastTimer = null;

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

function parseNavigationItems(value) {
  return String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    const [label, ...urlParts] = line.split('|');
    const url = urlParts.join('|').trim() || '#';
    return { key: slugify(label) || `tab-${index + 1}`, label: label.trim() || `Tab ${index + 1}`, url };
  });
}

function navigationItemsText(items) {
  return (Array.isArray(items) ? items : []).map(item => `${item.label || item.key || 'Página'} | ${item.url || '#'}`).join('\n');
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
}

function fillSiteForm(site) {
  const nav = site.navigation_config || {};
  const search = site.search_config || {};
  const palette = site.theme_config?.palette || {};
  setField('owner-site-id', site.id);
  setField('owner-site-name', site.name);
  setField('owner-site-slug', site.slug);
  setField('owner-site-description', site.description);
  setField('owner-site-status', site.status);
  setField('owner-site-guild', site.discord_guild_id);
  setField('owner-site-url', site.public_base_url);
  setField('owner-navigation-items', navigationItemsText(nav.items));
  setField('owner-search-position', search.position || 'header');
  setField('owner-search-scope', search.scope || 'site');
  setField('owner-search-placeholder', search.placeholder || 'Buscar…');
  setField('owner-search-sources', Array.isArray(search.sources) ? search.sources.join(', ') : '');
  setField('owner-color-background', themeColor(palette.background, '#050505'));
  setField('owner-color-surface', themeColor(palette.surface, '#101010'));
  setField('owner-color-text', themeColor(palette.text, '#ffffff'));
  setField('owner-color-muted', themeColor(palette.muted, '#a3a3a3'));
  setField('owner-color-accent', themeColor(palette.accent, '#ffffff'));
  updateThemePreview();
  document.getElementById('owner-search-enabled').checked = search.enabled !== false;
  document.querySelectorAll('[data-breakpoint]').forEach(fieldset => {
    const key = fieldset.dataset.breakpoint;
    const config = nav[key] || {};
    fieldset.querySelector('[data-nav-position]').value = config.position || (key === 'mobile' ? 'bottom' : 'top');
    fieldset.querySelector('[data-nav-visible]').checked = config.visible !== false;
  });
  document.getElementById('owner-site-title').textContent = site.name;
  document.getElementById('owner-site-status-label').textContent = `${site.status} · ${site.slug}`;
  const open = document.getElementById('owner-open-site');
  open.href = siteLink(site);
  open.classList.remove('hidden');
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
  roleBundle = await networkApi('list_roles', { site_id: selectedSite.id });
  renderRoles();
}

function sitePayload() {
  const navigation = { ...(selectedSite.navigation_config || {}) };
  for (const key of ['desktop', 'tablet', 'mobile']) {
    const fieldset = document.querySelector(`[data-breakpoint="${key}"]`);
    navigation[key] = {
      ...(navigation[key] || {}),
      position: fieldset.querySelector('[data-nav-position]').value,
      visible: fieldset.querySelector('[data-nav-visible]').checked,
      alignment: navigation[key]?.alignment || (key === 'desktop' ? 'center' : 'start'),
    };
  }
  navigation.items = parseNavigationItems(document.getElementById('owner-navigation-items').value);
  return {
    site_id: selectedSite.id,
    name: document.getElementById('owner-site-name').value,
    slug: document.getElementById('owner-site-slug').value,
    description: document.getElementById('owner-site-description').value,
    status: document.getElementById('owner-site-status').value,
    discord_guild_id: document.getElementById('owner-site-guild').value,
    public_base_url: document.getElementById('owner-site-url').value,
    theme_config: {
      ...(selectedSite.theme_config || {}),
      mode: 'custom',
      palette: {
        background: document.getElementById('owner-color-background').value,
        surface: document.getElementById('owner-color-surface').value,
        text: document.getElementById('owner-color-text').value,
        muted: document.getElementById('owner-color-muted').value,
        accent: document.getElementById('owner-color-accent').value,
      },
    },
    navigation_config: navigation,
    search_config: {
      ...(selectedSite.search_config || {}),
      enabled: document.getElementById('owner-search-enabled').checked,
      position: document.getElementById('owner-search-position').value,
      scope: document.getElementById('owner-search-scope').value,
      placeholder: document.getElementById('owner-search-placeholder').value,
      sources: document.getElementById('owner-search-sources').value.split(',').map(value => value.trim()).filter(Boolean),
    },
  };
}

async function saveSite() {
  if (!selectedSite) return;
  const button = document.getElementById('owner-save-site-btn');
  setBusy(button, true);
  try {
    const updated = await networkApi('update_site', sitePayload());
    const index = sites.findIndex(site => site.id === updated.id);
    if (index >= 0) sites[index] = updated;
    selectedSite = updated;
    fillSiteForm(updated);
    renderSiteList();
    showToast('Instancia guardada y versionada.');
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
  form.querySelectorAll('.owner-permissions input').forEach(input => { input.checked = permissions.has(input.value); });
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
    const role = await networkApi('upsert_role', {
      site_id: selectedSite.id,
      role_id: roleId,
      display_name: document.getElementById('role-name').value,
      role_key: document.getElementById('role-key').value,
      description: document.getElementById('role-description').value,
      permissions: [...document.querySelectorAll('.owner-permissions input:checked')].map(input => input.value),
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
  if (!selectedSite || !window.confirm(`Eliminar el perfil <${role.role_key}> y sus mapeos Discord?`)) return;
  try {
    await networkApi('delete_role', { site_id: selectedSite.id, role_id: role.id });
    roleBundle = await networkApi('list_roles', { site_id: selectedSite.id });
    renderRoles();
    showToast('Perfil eliminado.');
  } catch (error) {
    showToast(error.message, true);
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
  document.querySelectorAll('.owner-color-grid input[type="color"]').forEach(input => input.addEventListener('input', updateThemePreview));
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

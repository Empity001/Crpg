import { networkApi } from './api.js';
import { initializeNetworkSession, setNetworkMode } from './session.js';
import {
  BLOCK_DEFINITIONS, CONTAINER_TYPES, clone, createNode, defaultDocument, duplicateNode,
  findNode, findParent, getAtPath, insertNode, inspectorFields, moveNode, removeNode,
  renderPageDocument, setAtPath,
} from './builder-schema.js';

const CULONES_SITE_ID = '00000000-0000-4000-8000-000000000001';
const state = {
  sites: [],
  pages: [],
  site: null,
  page: null,
  versions: [],
  document: defaultDocument('Página'),
  selectedId: null,
  history: [],
  future: [],
  dirty: false,
  device: 'desktop',
  previewMode: 'normal',
  previewRole: '',
  roles: [],
  collections: { collections: [], fields: [], relations: [] },
  modules: { registry: [], instances: [], capabilities: [] },
  workflows: [],
  components: [],
  records: { collectionId: null, records: [], submissions: [], total: 0 },
  adminControls: [],
  audit: [],
  warnings: [],
};

const PRESET_DEFINITIONS = Object.freeze([
  { id: 'hero', icon: '01', label: 'Portada', detail: 'Etiqueta, título, texto y dos botones' },
  { id: 'features', icon: '02', label: 'Tarjetas', detail: 'Introducción y tres tarjetas informativas' },
  { id: 'split', icon: '03', label: 'Contenido dividido', detail: 'Texto principal y panel destacado' },
  { id: 'cta', icon: '04', label: 'Llamado a la acción', detail: 'Mensaje centrado con un botón' },
  { id: 'footer', icon: '05', label: 'Pie de página', detail: 'Separador, enlaces y cierre' },
]);

let toastTimer = null;
let confirmResolver = null;
let importBundle = null;
let previewFrame = null;
let previewNeedsLayers = false;
let previewNeedsWarnings = false;

const byId = id => document.getElementById(id);
const slugify = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
const roleKey = value => slugify(value).replace(/-/g, '_');

function showToast(message, error = false) {
  const toast = byId('network-toast');
  const rawMessage = String(message || 'Ocurrió un error inesperado.');
  const copy = toast.querySelector('.network-toast-copy') || toast;
  copy.textContent = /draft_theme_config[\s\S]*not-null|null value[\s\S]*draft_theme_config/i.test(rawMessage)
    ? 'Falta aplicar la corrección 027 de la base de datos antes de crear instancias.'
    : rawMessage;
  toast.classList.toggle('is-error', error);
  toast.setAttribute('role', error ? 'alert' : 'status');
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), error ? 9000 : 5200);
}

function hideToast() {
  clearTimeout(toastTimer);
  byId('network-toast')?.classList.remove('is-visible');
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

function setSaveState(kind, message) {
  const label = byId('builder-save-state');
  label.className = `builder-save-state${kind ? ` is-${kind}` : ''}`;
  label.textContent = message;
}

function markDirty() {
  if (state.dirty) return;
  state.dirty = true;
  setSaveState('dirty', 'Cambios sin guardar');
}

function pushHistory() {
  state.history.push(clone(state.document));
  if (state.history.length > 80) state.history.shift();
  state.future = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  byId('builder-undo').disabled = !state.history.length;
  byId('builder-redo').disabled = !state.future.length;
}

function undo() {
  if (!state.history.length) return;
  state.future.push(clone(state.document));
  state.document = state.history.pop();
  if (state.selectedId && !findNode(state.document, state.selectedId)) state.selectedId = null;
  markDirty();
  renderBuilder();
  updateHistoryButtons();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(clone(state.document));
  state.document = state.future.pop();
  if (state.selectedId && !findNode(state.document, state.selectedId)) state.selectedId = null;
  markDirty();
  renderBuilder();
  updateHistoryButtons();
}

function applyBuilderTheme(site) {
  const root = byId('builder-canvas');
  let theme = site?.draft_theme_config || site?.theme_config || {};
  try {
    const personal = JSON.parse(localStorage.getItem(`empi_network_theme_preview_${site?.id}`) || 'null');
    if (personal && typeof personal === 'object') theme = personal;
  } catch { /* preferencia local no disponible */ }
  const palette = theme.palette || {};
  const variables = {
    '--site-bg': palette.background || '#050505',
    '--site-surface': palette.surface || '#101010',
    '--site-elevated': palette.elevated || '#171717',
    '--site-text': palette.text || '#ffffff',
    '--site-muted': palette.muted || '#a3a3a3',
    '--site-accent': palette.accent || '#ffffff',
    '--site-secondary': palette.secondary || '#d4d4d4',
    '--site-border': palette.border || '#303030',
    '--site-selection': palette.selection || '#ffffff',
    '--site-success': palette.success || '#2fd18a',
    '--site-info': palette.info || '#38bdf8',
    '--site-warning': palette.warning || '#f6c453',
    '--site-event': palette.event || '#f472b6',
    '--site-danger': palette.danger || '#ef4444',
    '--site-disabled': palette.disabled || '#525252',
    '--site-font-body': theme.typography?.body || 'Inter, system-ui, sans-serif',
    '--site-font-heading': theme.typography?.heading || 'Inter, system-ui, sans-serif',
    '--site-font-mono': theme.typography?.mono || 'ui-monospace, monospace',
    '--site-type-scale': String(theme.typography?.scale || 1),
    '--site-line-height': String(theme.typography?.lineHeight || 1.5),
    '--site-space-scale': String(theme.density?.spacing || 1),
    '--site-radius': `${Number(theme.density?.radius) || 16}px`,
    '--site-border-width': `${Number(theme.density?.borderWidth) || 1}px`,
    '--site-motion-duration': `${theme.motion?.enabled === false ? 0 : (Number(theme.motion?.duration) || 220)}ms`,
  };
  Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
  if (theme.assets?.background) {
    root.style.backgroundImage = `linear-gradient(rgba(0,0,0,.3), rgba(0,0,0,.3)), url("${String(theme.assets.background).replace(/["\\]/g, '')}")`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
  } else root.style.backgroundImage = '';
}

function previewContext() {
  return {
    builder: true,
    device: state.device,
    mode: state.previewMode,
    roles: state.previewRole ? [state.previewRole] : [],
  };
}

function renderCanvas() {
  const canvas = byId('builder-canvas');
  applyBuilderTheme(state.site);
  if (state.document?.kind === 'legacy') {
    canvas.replaceChildren();
    const protectedPanel = document.createElement('section');
    protectedPanel.className = 'builder-legacy-guide';
    const title = document.createElement('h1');
    title.textContent = 'Culones original no se edita aquí';
    const copy = document.createElement('p');
    copy.textContent = 'Esta entrada abre logs.html y conserva intactos Logs, Guías, Tierlist, Kits y Herramientas. Para usar el constructor, crea una página nueva y editable dentro de Culones.';
    const steps = document.createElement('div');
    steps.className = 'builder-legacy-steps';
    for (const [heading, detail] of [
      ['1. Crea una página', 'Pulsa el botón de abajo y asigna su nombre y dirección.'],
      ['2. Agrega bloques', 'Abre Bloques en la barra izquierda y elige títulos, texto, botones o secciones.'],
      ['3. Publica', 'Guarda el borrador, revísalo y pulsa Publicar cuando esté listo.'],
    ]) {
      const step = document.createElement('article');
      const stepTitle = document.createElement('strong'); stepTitle.textContent = heading;
      const stepCopy = document.createElement('span'); stepCopy.textContent = detail;
      step.append(stepTitle, stepCopy); steps.append(step);
    }
    const actions = document.createElement('div'); actions.className = 'builder-legacy-actions';
    const create = document.createElement('button');
    create.type = 'button'; create.className = 'network-button network-button-light'; create.textContent = 'Crear página editable';
    create.addEventListener('click', () => openPageDialog());
    const link = document.createElement('a');
    link.className = 'network-button network-button-quiet';
    link.href = state.document.legacyUrl || 'logs.html';
    link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Abrir Culones original';
    actions.append(create, link);
    protectedPanel.append(title, copy, steps, actions);
    canvas.append(protectedPanel);
  } else {
    renderPageDocument(state.document, canvas, previewContext());
  }
  canvas.querySelectorAll('[data-block-id]').forEach(element => {
    element.classList.toggle('is-selected', element.dataset.blockId === state.selectedId);
  });
}

function renderLayers() {
  const tree = byId('builder-layer-tree');
  tree.replaceChildren();
  const add = (nodes, depth = 0) => {
    for (const node of nodes || []) {
      const definition = BLOCK_DEFINITIONS[node.type] || { label: node.type, icon: '?' };
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'builder-layer';
      button.classList.toggle('is-active', node.id === state.selectedId);
      button.style.setProperty('--layer-depth', String(depth));
      const icon = document.createElement('span'); icon.className = 'builder-layer-icon'; icon.textContent = definition.icon;
      const copy = document.createElement('span'); copy.textContent = String(node.props?.text || node.props?.label || definition.label).slice(0, 48);
      const type = document.createElement('small'); type.textContent = definition.label;
      button.append(icon, copy, type);
      button.addEventListener('click', () => selectNode(node.id));
      tree.append(button);
      add(node.children, depth + 1);
    }
  };
  add(state.document?.nodes);
  if (!tree.children.length) {
    const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'Esta página no contiene bloques.'; tree.append(empty);
  }
}

function renderWarnings() {
  const warnings = [];
  let previousHeading = 0;
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node.type === 'image' && node.props?.src && !String(node.props?.alt || '').trim()) warnings.push(`Imagen ${node.id} sin texto alternativo`);
      if (node.type === 'button' && !String(node.props?.text || '').trim()) warnings.push(`Botón ${node.id} sin texto`);
      if (node.type === 'heading') {
        const level = Number(node.props?.level) || 2;
        if (previousHeading && level > previousHeading + 1) warnings.push(`Salto de H${previousHeading} a H${level}`);
        previousHeading = level;
      }
      visit(node.children);
    }
  };
  visit(state.document?.nodes);
  const theme = state.site?.draft_theme_config || state.site?.theme_config || {};
  const contrast = (foreground, background) => {
    const luminance = value => {
      const hex = String(value || '').replace('#', '');
      if (!/^[0-9a-f]{6}$/i.test(hex)) return 1;
      const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
        .map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const a = luminance(foreground); const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  if (contrast(theme.palette?.text || '#ffffff', theme.palette?.background || '#050505') < 4.5) warnings.push('Contraste insuficiente entre texto y fondo');
  byId('builder-canvas').querySelectorAll('a,button').forEach(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.height && (rect.width < 44 || rect.height < 44)) warnings.push(`Área táctil pequeña en ${element.dataset.blockId || element.textContent?.trim() || 'acción'}`);
  });
  state.warnings = warnings;
  const status = byId('builder-a11y-status');
  status.textContent = warnings.length ? `${warnings.length} aviso${warnings.length === 1 ? '' : 's'}` : 'Sin avisos';
  status.dataset.state = warnings.length ? 'warning' : 'ok';
  status.title = warnings.length ? 'Abrir los avisos de revisión' : 'La revisión automática no encontró problemas';
}

function openIssuesDialog() {
  const list = byId('builder-issues-list');
  list.replaceChildren();
  if (!state.warnings.length) {
    const ok = document.createElement('p');
    ok.textContent = 'No hay avisos: contraste, jerarquía, imágenes, botones y áreas táctiles pasaron la revisión básica.';
    list.append(ok);
  } else {
    const items = document.createElement('ul');
    for (const warning of state.warnings) {
      const item = document.createElement('li'); item.textContent = warning; items.append(item);
    }
    list.append(items);
  }
  byId('builder-issues-dialog').showModal();
}

function renderBreadcrumb() {
  const parts = [];
  let match = state.selectedId ? findParent(state.document, state.selectedId) : null;
  if (match) {
    parts.unshift(BLOCK_DEFINITIONS[match.node.type]?.label || match.node.type);
    let parent = match.parent;
    while (parent) {
      parts.unshift(BLOCK_DEFINITIONS[parent.type]?.label || parent.type);
      parent = findParent(state.document, parent.id)?.parent || null;
    }
  }
  byId('builder-breadcrumb').textContent = `${state.page?.name || 'Página'}${parts.length ? ` / ${parts.join(' / ')}` : ''}`;
}

function cancelPreviewRender() {
  if (previewFrame != null) cancelAnimationFrame(previewFrame);
  previewFrame = null;
  previewNeedsLayers = false;
  previewNeedsWarnings = false;
}

function schedulePreviewRender({ layers = false, warnings = false } = {}) {
  previewNeedsLayers ||= layers;
  previewNeedsWarnings ||= warnings;
  if (previewFrame != null) return;
  previewFrame = requestAnimationFrame(() => {
    previewFrame = null;
    const renderLayersNow = previewNeedsLayers;
    const renderWarningsNow = previewNeedsWarnings;
    previewNeedsLayers = false;
    previewNeedsWarnings = false;
    renderCanvas();
    if (renderLayersNow) renderLayers();
    if (renderWarningsNow) renderWarnings();
  });
}

function renderBuilder() {
  cancelPreviewRender();
  renderCanvas();
  renderLayers();
  renderInspector();
  renderWarnings();
  renderBreadcrumb();
  const selected = state.selectedId ? findNode(state.document, state.selectedId) : null;
  byId('builder-selection-status').textContent = selected ? `#${selected.id}` : 'Nada seleccionado';
  const legacy = state.document?.kind === 'legacy';
  for (const id of ['builder-save', 'builder-publish', 'builder-duplicate-page', 'builder-page-settings', 'builder-archive-page']) {
    byId(id).disabled = legacy;
  }
  const publicReady = legacy || (state.site?.status === 'active' && state.page?.status === 'published');
  byId('builder-preview-link').disabled = !state.page || !publicReady;
  byId('builder-preview-link').title = publicReady ? 'Abrir la versión publicada' : 'Publica esta página para abrir su vista pública';
}

function selectNode(nodeId) {
  state.selectedId = findNode(state.document, nodeId) ? nodeId : null;
  renderBuilder();
}

function fieldInput(field, node) {
  const wrapper = document.createElement('label');
  wrapper.className = `builder-property-field${field.type === 'checkbox' ? ' is-checkbox' : ''}`;
  const label = document.createElement('span'); label.textContent = field.label;
  let input;
  const value = getAtPath(node.props, field.path, field.default ?? '');
  if (field.type === 'textarea' || field.type === 'link-list') {
    input = document.createElement('textarea'); input.rows = field.type === 'link-list' ? 5 : 3;
    input.value = field.type === 'link-list'
      ? (Array.isArray(value) ? value.map(item => `${item.label || 'Enlace'} | ${item.url || '#'}`).join('\n') : '')
      : String(value ?? '');
  } else if (field.type === 'select' || field.type === 'collection') {
    input = document.createElement('select');
    const options = field.type === 'collection'
      ? [{ value: '', label: 'Sin conectar' }, ...state.collections.collections.map(item => ({ value: item.id, label: item.plural_name }))]
      : (field.options || []).map(item => ({ value: String(item), label: String(item) }));
    for (const optionData of options) {
      const option = document.createElement('option'); option.value = optionData.value; option.textContent = optionData.label; input.append(option);
    }
    input.value = String(value ?? '');
  } else {
    input = document.createElement('input');
    input.type = field.type === 'checkbox' ? 'checkbox' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text';
    if (field.type === 'checkbox') input.checked = value !== false;
    else input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (field.min != null) input.min = String(field.min);
    if (field.max != null) input.max = String(field.max);
    if (field.placeholder) input.placeholder = field.placeholder;
  }
  input.dataset.propertyPath = field.path;
  input.dataset.propertyType = field.type;
  input.addEventListener('focus', () => {
    if (!input.dataset.historyCaptured) {
      pushHistory();
      input.dataset.historyCaptured = 'true';
    }
  });
  const update = () => {
    let next;
    if (field.type === 'checkbox') next = input.checked;
    else if (field.type === 'number') next = input.value === '' ? null : Number(input.value);
    else if (field.type === 'tags') next = input.value.split(',').map(item => item.trim()).filter(Boolean);
    else if (field.type === 'link-list') next = input.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
      const [itemLabel, ...urlParts] = line.split('|');
      return { label: itemLabel.trim() || 'Enlace', url: urlParts.join('|').trim() || '#' };
    });
    else next = input.value;
    setAtPath(node.props, field.path, next);
    markDirty();
    schedulePreviewRender({ layers: /(?:^|\.)(?:text|label)$/.test(field.path) });
  };
  input.addEventListener('input', update);
  input.addEventListener('change', () => {
    update();
    schedulePreviewRender({ layers: true, warnings: true });
    delete input.dataset.historyCaptured;
  });
  if (field.type === 'checkbox') wrapper.append(input, label);
  else wrapper.append(label, input);
  if (state.page) {
    const propertyPath = `block.${node.id}.props.${field.path}`;
    const existingControl = state.adminControls.find(control => control.target_type === 'block'
      && control.target_id === state.page.id && control.property_path === propertyPath);
    const exposure = document.createElement('details'); exposure.className = 'builder-admin-exposure';
    const summary = document.createElement('summary'); summary.textContent = 'Permisos administrativos';
    const row = document.createElement('span'); row.className = 'builder-admin-exposure-row';
    const exposeInput = document.createElement('input'); exposeInput.type = 'checkbox'; exposeInput.checked = !!existingControl;
    const exposeLabel = document.createElement('span'); exposeLabel.textContent = 'Disponible para administradores';
    const permission = document.createElement('code');
    permission.textContent = existingControl?.permission_key || `builder.block.edit.${field.path.toLowerCase().replace(/[^a-z0-9_.:-]/g, '_')}`;
    row.append(exposeInput, exposeLabel, permission); exposure.append(summary, row);
    exposeInput.addEventListener('change', () => void toggleAdminExposure({ field, node, propertyPath, existingControl, checkbox: exposeInput, permission: permission.textContent }));
    wrapper.append(exposure);
  }
  return wrapper;
}

async function toggleAdminExposure({ field, node, propertyPath, existingControl, checkbox, permission }) {
  checkbox.disabled = true;
  try {
    if (checkbox.checked) {
      const saved = await networkApi('upsert_admin_control', {
        site_id: state.site.id,
        control_id: existingControl?.id || null,
        target_type: 'block',
        target_id: state.page.id,
        property_path: propertyPath,
        display_name: `${BLOCK_DEFINITIONS[node.type]?.label || node.type} · ${field.label}`,
        control_type: field.type,
        permission_key: permission,
        settings: { blockId: node.id, propertyPath: field.path, pageId: state.page.id },
        enabled: true,
      });
      state.adminControls = state.adminControls.filter(control => control.id !== saved.id);
      state.adminControls.push(saved);
      showToast(`Control expuesto con permiso ${saved.permission_key}.`);
    } else if (existingControl) {
      await networkApi('delete_admin_control', { site_id: state.site.id, control_id: existingControl.id });
      state.adminControls = state.adminControls.filter(control => control.id !== existingControl.id);
      showToast('Control retirado de las herramientas administrativas.');
    }
    renderInspector();
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showToast(error.message, true);
  } finally { checkbox.disabled = false; }
}

function renderInspector() {
  const node = state.selectedId ? findNode(state.document, state.selectedId) : null;
  const list = byId('builder-property-list');
  list.replaceChildren();
  const actionButtons = ['builder-move-up', 'builder-move-down', 'builder-duplicate-node', 'builder-delete-node'];
  actionButtons.forEach(id => { byId(id).disabled = !node || state.document?.kind === 'legacy'; });
  if (!node) {
    byId('builder-selection-type').textContent = 'Página';
    byId('builder-selection-name').textContent = state.page?.title || 'Selecciona un bloque';
    const empty = document.createElement('p'); empty.className = 'builder-empty';
    empty.textContent = state.document?.kind === 'legacy'
      ? 'La página legacy está protegida. Crea una página nueva para usar el constructor.'
      : 'Haz clic en cualquier bloque del lienzo para editar cada propiedad.';
    list.append(empty);
    return;
  }
  const definition = BLOCK_DEFINITIONS[node.type] || { label: node.type };
  byId('builder-selection-type').textContent = definition.category || 'Bloque';
  byId('builder-selection-name').textContent = definition.label;
  const query = byId('builder-property-search').value.trim().toLowerCase();
  const groups = new Map();
  for (const field of inspectorFields(node)) {
    if (query && !`${field.group} ${field.label} ${field.path}`.toLowerCase().includes(query)) continue;
    if (!groups.has(field.group)) groups.set(field.group, []);
    groups.get(field.group).push(field);
  }
  for (const [groupName, fields] of groups) {
    const group = document.createElement('section'); group.className = 'builder-property-group';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = groupName;
    toggle.addEventListener('click', () => group.classList.toggle('is-collapsed'));
    const fieldList = document.createElement('div'); fieldList.className = 'builder-property-fields';
    fields.forEach(field => fieldList.append(fieldInput(field, node)));
    group.append(toggle, fieldList); list.append(group);
  }
  if (!list.children.length) {
    const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay propiedades que coincidan.'; list.append(empty);
  }
}

function renderBlockLibrary(filter = '') {
  renderPresetLibrary(filter);
  const library = byId('builder-block-library');
  library.replaceChildren();
  const groups = new Map();
  Object.entries(BLOCK_DEFINITIONS).forEach(([type, definition]) => {
    if (filter && !`${definition.label} ${definition.category} ${type}`.toLowerCase().includes(filter.toLowerCase())) return;
    if (!groups.has(definition.category)) groups.set(definition.category, []);
    groups.get(definition.category).push([type, definition]);
  });
  for (const [category, entries] of groups) {
    const group = document.createElement('section'); group.className = 'builder-block-group';
    const title = document.createElement('h2'); title.className = 'builder-block-group-title'; title.textContent = category; group.append(title);
    for (const [type, definition] of entries) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'builder-block-button';
      const icon = document.createElement('b'); icon.textContent = definition.icon;
      const label = document.createElement('span'); label.textContent = definition.label;
      button.append(icon, label); button.addEventListener('click', () => addBlock(type)); group.append(button);
    }
    library.append(group);
  }
}

function presetNode(type, patch = {}, children = []) {
  const node = createNode(type);
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) node.props[key] = { ...(node.props[key] || {}), ...clone(value) };
    else node.props[key] = clone(value);
  }
  node.children = children;
  return node;
}

function buildPreset(presetId) {
  const serverName = state.site?.name || 'Tu servidor';
  if (presetId === 'hero') {
    const actions = presetNode('stack', { layout: { direction: 'row', gap: 10, align: 'center', justify: 'start' }, responsive: { mobile: { layout: { direction: 'column', align: 'stretch' } } } }, [
      presetNode('button', { text: 'Comenzar', url: '#contenido', variant: 'primary' }),
      presetNode('button', { text: 'Conocer más', url: '#informacion', variant: 'outline' }),
    ]);
    return presetNode('section', { layout: { maxWidth: '1180px', minHeight: '72vh', padding: '96px 40px', gap: 20, align: 'start', justify: 'center' } }, [
      presetNode('badge', { text: 'SERVIDOR OFICIAL' }),
      presetNode('heading', { text: serverName, level: 1, typography: { size: 'clamp(3.4rem, 9vw, 8rem)', weight: 700 } }),
      presetNode('text', { text: 'Una comunidad hecha para jugar, descubrir y compartir.', typography: { size: '1.15rem' }, appearance: { color: 'var(--site-muted)' } }),
      actions,
    ]);
  }
  if (presetId === 'features') {
    const cards = ['Comunidad', 'Experiencias', 'Actualizaciones'].map((label, index) => presetNode('card', { layout: { padding: '26px', gap: 12 }, appearance: { background: 'var(--site-surface)', borderColor: 'var(--site-border)', borderWidth: 1, radius: 18 } }, [
      presetNode('badge', { text: `0${index + 1}` }),
      presetNode('heading', { text: label, level: 3 }),
      presetNode('text', { text: 'Edita este texto para explicar qué hace especial esta parte del servidor.', appearance: { color: 'var(--site-muted)' } }),
    ]));
    return presetNode('section', { layout: { maxWidth: '1180px', padding: '88px 32px', gap: 22 } }, [
      presetNode('heading', { text: 'Todo en un mismo lugar', level: 2, typography: { size: 'clamp(2.3rem, 5vw, 4.8rem)' } }),
      presetNode('text', { text: 'Presenta las funciones principales de tu comunidad.', appearance: { color: 'var(--site-muted)' } }),
      presetNode('grid', { layout: { columns: 3, gap: 16 }, responsive: { tablet: { columns: 2 }, mobile: { columns: 1 } } }, cards),
    ]);
  }
  if (presetId === 'split') {
    const copy = presetNode('stack', { layout: { gap: 16, justify: 'center' } }, [
      presetNode('badge', { text: 'DESCUBRE' }),
      presetNode('heading', { text: 'Una sección con dos lados', level: 2, typography: { size: 'clamp(2.2rem, 5vw, 4.5rem)' } }),
      presetNode('text', { text: 'Usa este lado para contar una historia y el otro para destacar datos, reglas o ventajas.', appearance: { color: 'var(--site-muted)' } }),
    ]);
    const panel = presetNode('card', { layout: { padding: '38px', gap: 18, justify: 'center' }, appearance: { background: 'var(--site-surface)', borderColor: 'var(--site-border)', borderWidth: 1, radius: 24 } }, [
      presetNode('stat', { value: '24/7', label: 'Servidor disponible' }),
      presetNode('divider'),
      presetNode('text', { text: 'Cambia este panel por cualquier contenido que necesites.' }),
    ]);
    return presetNode('section', { layout: { maxWidth: '1180px', padding: '88px 32px' } }, [presetNode('columns', { layout: { columns: 2, gap: 28 }, responsive: { mobile: { columns: 1 } } }, [copy, panel])]);
  }
  if (presetId === 'cta') {
    return presetNode('section', { layout: { maxWidth: '1060px', padding: '88px 32px', gap: 18, align: 'center', justify: 'center' }, appearance: { background: 'var(--site-surface)', borderColor: 'var(--site-border)', borderWidth: 1, radius: 28 } }, [
      presetNode('badge', { text: '¿LISTO?' }),
      presetNode('heading', { text: `Entra a ${serverName}`, level: 2, textAlign: 'center', typography: { size: 'clamp(2.4rem, 6vw, 5.4rem)' } }),
      presetNode('text', { text: 'Cambia el botón por Discord, tu launcher, una guía o cualquier destino.', textAlign: 'center', appearance: { color: 'var(--site-muted)' } }),
      presetNode('button', { text: 'Entrar ahora', url: '#', variant: 'primary' }),
    ]);
  }
  return presetNode('section', { layout: { maxWidth: '1180px', padding: '56px 32px', gap: 18 } }, [
    presetNode('divider'),
    presetNode('stack', { layout: { direction: 'row', gap: 18, align: 'center', justify: 'space-between' }, responsive: { mobile: { layout: { direction: 'column', align: 'start' } } } }, [
      presetNode('text', { text: `© ${new Date().getFullYear()} ${serverName}` }),
      presetNode('link-list', { items: [{ label: 'Inicio', url: '#' }, { label: 'Discord', url: '#' }, { label: 'Contacto', url: '#' }] }),
    ]),
  ]);
}

function renderPresetLibrary(filter = '') {
  const library = byId('builder-preset-library');
  library.replaceChildren();
  const normalized = filter.trim().toLowerCase();
  for (const preset of PRESET_DEFINITIONS) {
    if (normalized && !`${preset.label} ${preset.detail}`.toLowerCase().includes(normalized)) continue;
    const button = document.createElement('button'); button.type = 'button'; button.className = 'builder-preset-button';
    const icon = document.createElement('b'); icon.textContent = preset.icon;
    const copy = document.createElement('span');
    const label = document.createElement('strong'); label.textContent = preset.label;
    const detail = document.createElement('small'); detail.textContent = preset.detail;
    const arrow = document.createElement('i'); arrow.textContent = '＋';
    copy.append(label, detail); button.append(icon, copy, arrow);
    button.addEventListener('click', () => addPreset(preset.id)); library.append(button);
  }
  library.closest('.builder-preset-section')?.classList.toggle('hidden', !library.children.length);
}

function addPreset(presetId) {
  if (!state.page || state.document?.kind === 'legacy') {
    showToast('Crea o selecciona una página editable antes de agregar una sección.', true); return;
  }
  pushHistory();
  const section = buildPreset(presetId);
  state.document.nodes ||= [];
  state.document.nodes.push(section);
  state.selectedId = section.id;
  markDirty(); renderBuilder();
  showToast('Sección completa agregada. Selecciona cualquier elemento para personalizarlo.');
}

function addBlock(type) {
  if (!state.page || state.document?.kind === 'legacy') {
    showToast('Crea o selecciona una página del constructor.', true); return;
  }
  pushHistory();
  const node = createNode(type);
  const selected = state.selectedId ? findNode(state.document, state.selectedId) : null;
  insertNode(state.document, node, selected && CONTAINER_TYPES.has(selected.type) ? selected.id : null);
  state.selectedId = node.id;
  markDirty(); renderBuilder();
}

function renderPageList() {
  const list = byId('builder-page-list'); list.replaceChildren();
  for (const page of state.pages) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'builder-page-card';
    button.classList.toggle('is-active', page.id === state.page?.id);
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = `${page.is_home ? '⌂ ' : ''}${page.name}`;
    const meta = document.createElement('small'); meta.textContent = `/${page.slug}`; copy.append(name, meta);
    const status = document.createElement('span'); status.className = 'builder-page-status'; status.dataset.status = page.status; status.textContent = page.status;
    button.append(copy, status); button.addEventListener('click', () => void selectPage(page.id)); list.append(button);
  }
}

function renderSiteSelect() {
  const select = byId('builder-site-select'); select.replaceChildren();
  for (const site of state.sites) {
    const option = document.createElement('option'); option.value = site.id; option.textContent = `${site.name}${site.deleted_at ? ' (archivada)' : ''}`; select.append(option);
  }
  if (state.site) select.value = state.site.id;
}

function renderPageSelect() {
  const select = byId('builder-page-select'); select.replaceChildren();
  for (const page of state.pages) {
    const option = document.createElement('option'); option.value = page.id; option.textContent = page.name; select.append(option);
  }
  if (state.page) select.value = state.page.id;
}

async function loadSites() {
  state.sites = await networkApi('list_sites');
  renderSiteSelect();
  const params = new URLSearchParams(location.search);
  const preferred = params.get('site');
  const site = state.sites.find(item => item.id === preferred || item.slug === preferred) || state.sites.find(item => !item.deleted_at) || state.sites[0];
  if (site) await selectSite(site.id, params.get('page'));
}

async function selectSite(siteId, preferredPage = null) {
  if (state.dirty && !await requestConfirm('Cambios sin guardar', 'Cambiar de instancia descartará los cambios locales. ¿Continuar?')) {
    byId('builder-site-select').value = state.site?.id || ''; return;
  }
  state.site = state.sites.find(item => item.id === siteId) || null;
  if (!state.site) return;
  state.pages = await networkApi('list_pages', { site_id: siteId });
  const [roles, collections, modules, workflows, components, adminControls, audit] = await Promise.all([
    networkApi('list_roles', { site_id: siteId }),
    networkApi('list_collections', { site_id: siteId }),
    networkApi('list_modules', { site_id: siteId }),
    networkApi('list_workflows', { site_id: siteId }),
    networkApi('list_components', { site_id: siteId }),
    networkApi('list_admin_controls', { site_id: siteId }),
    networkApi('list_audit', { site_id: siteId, limit: 100 }),
  ]);
  state.roles = roles.roles || [];
  state.collections = collections;
  state.modules = modules;
  state.workflows = workflows;
  state.components = components;
  state.adminControls = adminControls;
  state.audit = audit;
  renderSiteSelect(); renderPageList(); renderPageSelect(); renderRoles(); renderCollections(); renderModules(); renderWorkflows(); renderComponents(); renderAudit();
  const page = state.pages.find(item => item.id === preferredPage || item.slug === preferredPage) || state.pages.find(item => item.is_home) || state.pages[0];
  if (page) await selectPage(page.id, true);
  else resetPage();
  const url = new URL(location.href); url.searchParams.set('site', state.site.slug); history.replaceState(null, '', url);
}

function resetPage() {
  state.page = null; state.versions = []; state.document = defaultDocument(state.site?.name || 'Página'); state.selectedId = null;
  state.history = []; state.future = []; state.dirty = false;
  renderPageList(); renderPageSelect(); renderVersions(); renderBuilder(); updateHistoryButtons(); setSaveState('', 'Sin página');
}

async function selectPage(pageId, force = false) {
  if (!force && state.dirty && !await requestConfirm('Cambios sin guardar', 'Cambiar de página descartará los cambios locales. ¿Continuar?')) {
    byId('builder-page-select').value = state.page?.id || ''; return;
  }
  const result = await networkApi('get_page', { site_id: state.site.id, page_id: pageId });
  state.page = result.page;
  state.versions = result.versions || [];
  state.document = clone(state.page.draft_document || defaultDocument(state.page.title));
  state.selectedId = null; state.history = []; state.future = []; state.dirty = false;
  renderPageList(); renderPageSelect(); renderVersions(); renderBuilder(); updateHistoryButtons(); setSaveState('saved', 'Borrador cargado');
  const url = new URL(location.href); url.searchParams.set('site', state.site.slug); url.searchParams.set('page', state.page.slug); history.replaceState(null, '', url);
}

async function saveDraft({ silent = false } = {}) {
  if (!state.page || state.document?.kind === 'legacy') return state.page;
  const button = byId('builder-save'); setBusy(button, true); setSaveState('saving', 'Guardando…');
  try {
    const updated = await networkApi('save_page', {
      site_id: state.site.id,
      page_id: state.page.id,
      name: state.page.name,
      title: state.page.title,
      slug: state.page.slug,
      description: state.page.description,
      is_home: state.page.is_home,
      sort_order: state.page.sort_order,
      draft_document: state.document,
      seo_config: state.page.seo_config || {},
      access_config: state.page.access_config || { visibility: 'public', roles: [] },
      reason: 'Guardado desde Empi Builder',
    });
    state.page = updated; state.dirty = false; state.history = []; state.future = [];
    const index = state.pages.findIndex(item => item.id === updated.id); if (index >= 0) state.pages[index] = updated;
    setSaveState('saved', 'Guardado'); renderPageList(); updateHistoryButtons();
    const detail = await networkApi('get_page', { site_id: state.site.id, page_id: state.page.id }); state.versions = detail.versions || []; renderVersions();
    if (!silent) showToast('Borrador guardado y versionado.');
    return updated;
  } catch (error) {
    setSaveState('dirty', 'Error al guardar'); showToast(error.message, true); throw error;
  } finally { setBusy(button, false); }
}

async function publishCurrentPage() {
  if (!state.page || state.document?.kind === 'legacy') return;
  if (!await requestConfirm('Publicar página', 'La versión pública será reemplazada por este borrador. El historial permitirá restaurarla.')) return;
  const button = byId('builder-publish'); setBusy(button, true, 'Publicando…');
  try {
    if (state.dirty) await saveDraft({ silent: true });
    const activatingPortal = state.site.status === 'draft';
    state.page = await networkApi('publish_page', { site_id: state.site.id, page_id: state.page.id, reason: 'Publicación desde Empi Builder' });
    if (activatingPortal) {
      state.site.status = 'active';
      const siteIndex = state.sites.findIndex(item => item.id === state.site.id);
      if (siteIndex >= 0) state.sites[siteIndex] = { ...state.sites[siteIndex], status: 'active' };
    }
    const index = state.pages.findIndex(item => item.id === state.page.id); if (index >= 0) state.pages[index] = state.page;
    renderSiteSelect(); renderPageList(); renderBuilder();
    showToast(activatingPortal ? 'Página publicada y portal activado. Ya puedes abrir la vista pública.' : 'Página publicada correctamente.');
    setSaveState('saved', 'Publicado');
    const detail = await networkApi('get_page', { site_id: state.site.id, page_id: state.page.id }); state.versions = detail.versions || []; renderVersions();
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a'); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportCurrentSite() {
  if (!state.site) return;
  const button = byId('builder-export'); setBusy(button, true, 'Exportando…');
  try {
    const bundle = await networkApi('export_structure', { site_id: state.site.id, include_records: true });
    downloadJson(`${state.site.slug}-empi-network-v1.json`, bundle);
    showToast('Estructura y contenido exportados.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

async function chooseImportFile(event) {
  const file = event.target.files?.[0]; event.target.value = '';
  if (!file) return;
  if (file.size > 5_000_000) { showToast('El archivo supera el límite de 5 MB.', true); return; }
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.format !== 'empi-network-site' || Number(parsed?.version) !== 1) throw new Error('El archivo no es una exportación compatible.');
    importBundle = parsed;
    const name = `${parsed.site?.name || 'Instancia'} copia`;
    byId('builder-import-form').reset(); byId('builder-import-name').value = name;
    byId('builder-import-slug').value = `${slugify(parsed.site?.slug || name)}-copia-${Date.now().toString(36).slice(-4)}`;
    byId('builder-import-dialog').showModal();
  } catch (error) { importBundle = null; showToast(error.message, true); }
}

async function submitImport(event) {
  event.preventDefault();
  if (!importBundle) return;
  const button = byId('builder-import-submit'); setBusy(button, true, 'Importando…');
  try {
    const result = await networkApi('import_structure', {
      bundle: importBundle,
      name: byId('builder-import-name').value,
      slug: byId('builder-import-slug').value,
    });
    importBundle = null; byId('builder-import-dialog').close();
    state.sites = await networkApi('list_sites'); renderSiteSelect(); await selectSite(result.site_id);
    showToast('Instancia importada como borrador aislado.');
  } catch (error) { showToast(`${error.message} Si alcanzó a crear datos, quedaron archivados de forma recuperable.`, true); }
  finally { setBusy(button, false); }
}

function openPageDialog(page = null) {
  const form = byId('builder-page-form'); form.reset();
  delete byId('builder-page-slug').dataset.touched;
  delete byId('builder-page-title').dataset.touched;
  byId('builder-page-dialog-title').textContent = page ? 'Ajustes de página' : 'Nueva página';
  byId('builder-page-id').value = page?.id || '';
  byId('builder-page-name').value = page?.name || '';
  byId('builder-page-title').value = page?.title || '';
  byId('builder-page-slug').value = page?.slug || '';
  byId('builder-page-description').value = page?.description || '';
  byId('builder-page-home').checked = !!page?.is_home;
  byId('builder-page-visibility').value = page?.access_config?.visibility || 'public';
  byId('builder-page-roles').value = Array.isArray(page?.access_config?.roles) ? page.access_config.roles.join(', ') : '';
  byId('builder-page-seo-title').value = page?.seo_config?.title || page?.title || '';
  byId('builder-page-seo-description').value = page?.seo_config?.description || page?.description || '';
  byId('builder-page-og-image').value = page?.seo_config?.image || '';
  byId('builder-page-noindex').checked = !!page?.seo_config?.noindex;
  byId('builder-page-dialog').showModal();
}

async function submitPage(event) {
  event.preventDefault();
  const pageId = byId('builder-page-id').value;
  const payload = {
    site_id: state.site.id,
    name: byId('builder-page-name').value,
    title: byId('builder-page-title').value || byId('builder-page-name').value,
    slug: byId('builder-page-slug').value,
    description: byId('builder-page-description').value,
    is_home: byId('builder-page-home').checked,
    seo_config: {
      title: byId('builder-page-seo-title').value,
      description: byId('builder-page-seo-description').value,
      image: byId('builder-page-og-image').value,
      noindex: byId('builder-page-noindex').checked,
    },
    access_config: {
      visibility: byId('builder-page-visibility').value,
      roles: byId('builder-page-roles').value.split(',').map(value => value.trim()).filter(Boolean),
    },
  };
  const button = byId('builder-page-submit'); setBusy(button, true);
  try {
    let saved;
    if (pageId) {
      saved = await networkApi('save_page', { ...payload, page_id: pageId, draft_document: state.document, reason: 'Ajustes de página' });
    } else {
      saved = await networkApi('create_page', payload);
      saved = await networkApi('save_page', { ...payload, page_id: saved.id, draft_document: saved.draft_document, reason: 'Metadatos iniciales' });
    }
    byId('builder-page-dialog').close();
    state.pages = await networkApi('list_pages', { site_id: state.site.id });
    renderPageList(); renderPageSelect(); await selectPage(saved.id, true);
    showToast(pageId ? 'Página actualizada.' : 'Página creada.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

async function duplicateCurrentPage() {
  if (!state.page) return;
  const newSlug = `${state.page.slug}-copia-${Date.now().toString(36).slice(-4)}`;
  try {
    const duplicate = await networkApi('duplicate_page', {
      site_id: state.site.id, page_id: state.page.id,
      name: `${state.page.name} copia`, title: `${state.page.title} copia`, slug: newSlug,
    });
    state.pages = await networkApi('list_pages', { site_id: state.site.id }); renderPageList(); renderPageSelect(); await selectPage(duplicate.id, true);
    showToast('Página duplicada.');
  } catch (error) { showToast(error.message, true); }
}

async function archiveCurrentPage() {
  if (!state.page) return;
  if (!await requestConfirm('Archivar página', `La página “${state.page.name}” dejará de estar disponible. Sus versiones se conservarán.`)) return;
  try {
    await networkApi('archive_page', { site_id: state.site.id, page_id: state.page.id });
    state.pages = await networkApi('list_pages', { site_id: state.site.id }); renderPageList(); renderPageSelect();
    if (state.pages[0]) await selectPage(state.pages[0].id, true); else resetPage();
    showToast('Página archivada.');
  } catch (error) { showToast(error.message, true); }
}

function renderVersions() {
  const list = byId('builder-version-list'); list.replaceChildren();
  for (const version of state.versions) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'builder-version-card';
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = `Versión ${version.version_number} · ${version.stage}`;
    const meta = document.createElement('small'); meta.textContent = `${new Date(version.created_at).toLocaleString('es')} · ${version.reason || 'Sin nota'}`;
    copy.append(name, meta);
    const action = document.createElement('span'); action.textContent = 'Restaurar';
    button.append(copy, action); button.addEventListener('click', () => void restoreVersion(version)); list.append(button);
  }
  if (!state.versions.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'Todavía no hay versiones.'; list.append(empty); }
}

function renderAudit() {
  const list = byId('builder-audit-list');
  list.replaceChildren();
  const actionNames = {
    'site.create': 'Instancia creada',
    'site.update': 'Instancia actualizada',
    'site.archive': 'Instancia archivada',
    'site.restore': 'Instancia restaurada',
    'page.create': 'Página creada',
    'page.save': 'Borrador guardado',
    'page.publish': 'Página publicada',
    'page.rollback': 'Versión restaurada',
    'page.archive': 'Página archivada',
    'theme.save_draft': 'Apariencia guardada',
    'theme.publish': 'Apariencia publicada',
    'theme.rollback': 'Apariencia restaurada',
  };
  for (const entry of state.audit) {
    const card = document.createElement('article');
    card.className = 'builder-version-card builder-audit-card';
    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = actionNames[entry.action] || String(entry.action || 'Cambio administrativo');
    const meta = document.createElement('small');
    const actor = entry.discord_user_id ? `Discord ${entry.discord_user_id}` : (entry.actor_mode || 'sistema');
    meta.textContent = `${new Date(entry.created_at).toLocaleString('es')} · ${actor}`;
    copy.append(name, meta);
    const entity = document.createElement('span');
    entity.className = 'builder-audit-entity';
    entity.textContent = entry.success === false ? 'Falló' : (entry.entity_type || 'cambio');
    card.append(copy, entity);
    list.append(card);
  }
  if (!state.audit.length) {
    const empty = document.createElement('p');
    empty.className = 'builder-empty';
    empty.textContent = 'Todavía no hay acciones registradas.';
    list.append(empty);
  }
}

async function restoreVersion(version) {
  if (!await requestConfirm('Restaurar versión', `Se creará un nuevo borrador a partir de la versión ${version.version_number}. La versión pública no cambiará hasta que publiques.`)) return;
  try {
    await networkApi('restore_page_version', { site_id: state.site.id, page_id: state.page.id, version_number: version.version_number });
    await selectPage(state.page.id, true); showToast(`Versión ${version.version_number} restaurada como borrador.`);
  } catch (error) { showToast(error.message, true); }
}

function renderRoles() {
  const select = byId('builder-preview-role'); select.replaceChildren();
  const none = document.createElement('option'); none.value = ''; none.textContent = 'Ninguno'; select.append(none);
  for (const role of state.roles) { const option = document.createElement('option'); option.value = role.role_key; option.textContent = `<${role.role_key}>`; select.append(option); }
  select.value = state.previewRole;
}

function entityCard(title, subtitle, status, onClick) {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'builder-entity-card';
  const copy = document.createElement('span'); const strong = document.createElement('strong'); strong.textContent = title;
  const small = document.createElement('small'); small.textContent = subtitle; copy.append(strong, small);
  const badge = document.createElement('span'); badge.className = 'builder-entity-status'; badge.dataset.status = status; badge.textContent = status;
  button.append(copy, badge); button.addEventListener('click', onClick); return button;
}

function renderCollections() {
  const list = byId('builder-collection-list'); list.replaceChildren();
  for (const collection of state.collections.collections || []) {
    const count = state.collections.fields.filter(field => field.collection_id === collection.id).length;
    list.append(entityCard(collection.plural_name, `<${collection.collection_key}> · ${count} campo(s)`, collection.status, () => openCollectionDialog(collection)));
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay colecciones.'; list.append(empty); }
}

function addFieldRow(field = {}) {
  const row = document.createElement('div'); row.className = 'builder-field-row'; row.dataset.fieldId = field.id || '';
  const make = (label, type, value, className) => {
    const wrapper = document.createElement('label'); const caption = document.createElement('span'); caption.textContent = label;
    const input = document.createElement(type === 'select' ? 'select' : 'input'); input.className = className;
    if (type === 'checkbox') { input.type = 'checkbox'; input.checked = !!value; }
    else input.value = value || '';
    wrapper.append(caption, input); return { wrapper, input };
  };
  const name = make('Nombre', 'text', field.display_name, 'field-name');
  const keyInput = make('Variable', 'text', field.field_key, 'field-key');
  const type = make('Tipo', 'select', field.field_type || 'text', 'field-type');
  ['text','long_text','rich_text','number','boolean','date','datetime','select','multi_select','image','file','url','email','color','relation','user','minecraft_uuid','discord_id','formula','json']
    .forEach(item => { const option = document.createElement('option'); option.value = item; option.textContent = item; type.input.append(option); });
  type.input.value = field.field_type || 'text';
  const required = make('Obligatorio', 'checkbox', field.required, 'field-required');
  const searchable = make('Buscable', 'checkbox', field.searchable, 'field-searchable');
  const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = 'Quitar campo'; remove.addEventListener('click', () => row.remove());
  name.input.addEventListener('input', () => { if (!keyInput.input.dataset.touched) keyInput.input.value = roleKey(name.input.value); });
  keyInput.input.addEventListener('input', () => { keyInput.input.dataset.touched = 'true'; });
  row.append(name.wrapper, keyInput.wrapper, type.wrapper, required.wrapper, searchable.wrapper, remove); byId('builder-field-list').append(row);
}

function openCollectionDialog(collection = null) {
  const form = byId('builder-collection-form'); form.reset(); byId('builder-field-list').replaceChildren();
  delete byId('builder-collection-key').dataset.touched;
  byId('builder-collection-title').textContent = collection ? `Editar ${collection.plural_name}` : 'Nueva colección';
  byId('builder-collection-id').value = collection?.id || '';
  byId('builder-collection-singular').value = collection?.singular_name || '';
  byId('builder-collection-plural').value = collection?.plural_name || '';
  byId('builder-collection-key').value = collection?.collection_key || '';
  byId('builder-collection-status').value = collection?.status || 'draft';
  byId('builder-collection-visibility').value = collection?.visibility || 'public';
  byId('builder-collection-description').value = collection?.description || '';
  byId('builder-collection-public-submissions').checked = collection?.settings?.allowPublicSubmissions === true;
  const fields = collection ? state.collections.fields.filter(field => field.collection_id === collection.id) : [];
  fields.forEach(addFieldRow); if (!fields.length) addFieldRow({ display_name: 'Título', field_key: 'title', field_type: 'text', required: true, searchable: true });
  state.records = { collectionId: collection?.id || null, records: [], submissions: [], total: 0 };
  byId('builder-records-section').hidden = !collection;
  renderRecords();
  if (collection) void loadCollectionRecords(collection.id);
  byId('builder-collection-dialog').showModal();
}

async function loadCollectionRecords(collectionId) {
  const list = byId('builder-record-list');
  list.replaceChildren();
  const loading = document.createElement('p'); loading.className = 'builder-empty'; loading.textContent = 'Cargando contenido…'; list.append(loading);
  try {
    const result = await networkApi('list_records', { site_id: state.site.id, collection_id: collectionId, page: 1, page_size: 100 });
    if (state.records.collectionId !== collectionId) return;
    state.records = { collectionId, records: result.records || [], submissions: result.submissions || [], total: result.total || 0 };
    renderRecords();
  } catch (error) { showToast(error.message, true); }
}

function renderRecords() {
  const list = byId('builder-record-list'); list.replaceChildren();
  const collectionId = state.records.collectionId;
  if (!collectionId) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'Guarda la colección antes de crear contenido.'; list.append(empty); return; }
  const fields = state.collections.fields.filter(field => field.collection_id === collectionId);
  const titleField = fields.find(field => ['title', 'name', 'nombre', 'titulo'].includes(field.field_key)) || fields[0];
  const submissionByRecord = new Map(state.records.submissions.map(item => [item.record_id, item]));
  for (const record of state.records.records) {
    const title = String(record.data?.[titleField?.field_key] || record.slug || 'Registro sin título');
    const submission = submissionByRecord.get(record.id);
    const source = submission ? `formulario: ${submission.status}` : 'manual';
    list.append(entityCard(title, `${source} · ${new Date(record.updated_at).toLocaleString('es')}`, record.status, () => openRecordDialog(record)));
  }
  if (!state.records.records.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay registros todavía.'; list.append(empty); }
  if (state.records.total > state.records.records.length) {
    const note = document.createElement('p'); note.className = 'builder-empty'; note.textContent = `Mostrando 100 de ${state.records.total}.`; list.append(note);
  }
}

function recordInput(field, value) {
  const label = document.createElement('label');
  const caption = document.createElement('span'); caption.textContent = `${field.display_name}${field.required ? ' *' : ''}`;
  let input;
  if (['long_text', 'rich_text', 'json'].includes(field.field_type)) {
    input = document.createElement('textarea'); input.rows = field.field_type === 'rich_text' ? 8 : 4;
    input.value = field.field_type === 'json' && value != null ? JSON.stringify(value, null, 2) : String(value ?? '');
  } else if (['select', 'multi_select'].includes(field.field_type)) {
    input = document.createElement('select'); input.multiple = field.field_type === 'multi_select';
    if (!input.multiple) { const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona…'; input.append(empty); }
    for (const raw of Array.isArray(field.settings?.options) ? field.settings.options : []) {
      const option = document.createElement('option'); option.value = String(typeof raw === 'object' && raw ? raw.value ?? '' : raw);
      option.textContent = String(typeof raw === 'object' && raw ? raw.label ?? raw.value ?? '' : raw);
      option.selected = input.multiple ? (Array.isArray(value) && value.map(String).includes(option.value)) : String(value ?? '') === option.value;
      input.append(option);
    }
  } else {
    input = document.createElement('input');
    const inputTypes = { number: 'number', boolean: 'checkbox', date: 'date', datetime: 'datetime-local', email: 'email', url: 'url', color: 'color' };
    input.type = inputTypes[field.field_type] || 'text';
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = String(value ?? '');
  }
  input.dataset.fieldKey = field.field_key;
  input.dataset.fieldType = field.field_type;
  input.required = field.required;
  label.append(caption, input); return label;
}

function openRecordDialog(record = null) {
  const collectionId = state.records.collectionId;
  if (!collectionId) return;
  byId('builder-record-form').reset();
  byId('builder-record-title').textContent = record ? 'Editar registro' : 'Nuevo registro';
  byId('builder-record-id').value = record?.id || '';
  byId('builder-record-slug').value = record?.slug || '';
  byId('builder-record-status').value = record?.status || 'draft';
  byId('builder-record-archive').hidden = !record;
  const container = byId('builder-record-fields'); container.replaceChildren();
  for (const field of state.collections.fields.filter(item => item.collection_id === collectionId)) {
    container.append(recordInput(field, record?.data?.[field.field_key]));
  }
  byId('builder-record-dialog').showModal();
}

async function submitRecord(event) {
  event.preventDefault();
  const collectionId = state.records.collectionId;
  if (!collectionId) return;
  const data = {};
  try {
    for (const input of byId('builder-record-fields').querySelectorAll('[data-field-key]')) {
      let value;
      if (input.dataset.fieldType === 'boolean') value = input.checked;
      else if (input.dataset.fieldType === 'multi_select') value = [...input.selectedOptions].map(option => option.value);
      else if (input.dataset.fieldType === 'json') value = input.value.trim() ? JSON.parse(input.value) : null;
      else value = input.value;
      data[input.dataset.fieldKey] = value;
    }
  } catch { showToast('Uno de los campos JSON no es válido.', true); return; }
  const button = byId('builder-record-submit'); setBusy(button, true);
  try {
    await networkApi('upsert_record', {
      site_id: state.site.id, collection_id: collectionId,
      record_id: byId('builder-record-id').value || null,
      slug: byId('builder-record-slug').value || null,
      status: byId('builder-record-status').value,
      data,
    });
    byId('builder-record-dialog').close(); await loadCollectionRecords(collectionId);
    showToast('Registro guardado.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

async function archiveCurrentRecord() {
  const recordId = byId('builder-record-id').value;
  if (!recordId || !await requestConfirm('Archivar registro', 'El registro dejará de mostrarse y la respuesta asociada quedará archivada.')) return;
  try {
    await networkApi('archive_record', { site_id: state.site.id, record_id: recordId });
    byId('builder-record-dialog').close(); await loadCollectionRecords(state.records.collectionId); showToast('Registro archivado.');
  } catch (error) { showToast(error.message, true); }
}

async function submitCollection(event) {
  event.preventDefault();
  const fields = [...byId('builder-field-list').querySelectorAll('.builder-field-row')].map(row => ({
    id: row.dataset.fieldId || null,
    display_name: row.querySelector('.field-name').value,
    field_key: row.querySelector('.field-key').value,
    field_type: row.querySelector('.field-type').value,
    required: row.querySelector('.field-required').checked,
    searchable: row.querySelector('.field-searchable').checked,
    settings: {},
  }));
  const button = byId('builder-collection-submit'); setBusy(button, true);
  try {
    await networkApi('upsert_collection', {
      site_id: state.site.id,
      collection_id: byId('builder-collection-id').value || null,
      singular_name: byId('builder-collection-singular').value,
      plural_name: byId('builder-collection-plural').value,
      collection_key: byId('builder-collection-key').value,
      status: byId('builder-collection-status').value,
      visibility: byId('builder-collection-visibility').value,
      description: byId('builder-collection-description').value,
      settings: {
        ...(state.collections.collections.find(item => item.id === byId('builder-collection-id').value)?.settings || {}),
        allowPublicSubmissions: byId('builder-collection-public-submissions').checked,
      },
      fields,
    });
    byId('builder-collection-dialog').close();
    state.collections = await networkApi('list_collections', { site_id: state.site.id }); renderCollections(); renderInspector();
    showToast('Colección y campos guardados.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

function renderModules() {
  const list = byId('builder-module-list'); list.replaceChildren();
  for (const module of state.modules.instances || []) {
    list.append(entityCard(module.display_name, `<${module.instance_key}> · ${module.module_type}`, module.status, () => openModuleDialog(module)));
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay módulos instalados.'; list.append(empty); }
  const select = byId('builder-module-type'); select.replaceChildren();
  for (const definition of state.modules.registry || []) { const option = document.createElement('option'); option.value = definition.module_type; option.textContent = definition.display_name; select.append(option); }
}

function renderModuleCapabilities(moduleType, enabled = []) {
  const list = byId('builder-module-capabilities'); list.replaceChildren();
  const definition = state.modules.registry.find(item => item.module_type === moduleType);
  const enabledMap = new Map(enabled.map(item => [item.capability_type, item]));
  for (const capability of definition?.manifest?.capabilities || []) {
    const label = document.createElement('label'); label.className = 'builder-capability-row';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = capability; input.checked = enabledMap.get(capability)?.enabled === true;
    const textNode = document.createElement('span'); textNode.textContent = capability; label.append(input, textNode); list.append(label);
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'Este módulo no declara capacidades externas.'; list.append(empty); }
}

function openModuleDialog(module = null) {
  delete byId('builder-module-key').dataset.touched;
  const form = byId('builder-module-form'); form.reset(); byId('builder-module-id').value = module?.id || '';
  byId('builder-module-title').textContent = module ? `Editar ${module.display_name}` : 'Instalar módulo';
  byId('builder-module-type').value = module?.module_type || state.modules.registry[0]?.module_type || '';
  byId('builder-module-type').disabled = !!module;
  byId('builder-module-name').value = module?.display_name || '';
  byId('builder-module-key').value = module?.instance_key || '';
  byId('builder-module-description').value = module?.description || '';
  byId('builder-module-status').value = module?.status || 'draft';
  renderModuleCapabilities(byId('builder-module-type').value, module ? state.modules.capabilities.filter(item => item.module_instance_id === module.id) : []);
  byId('builder-module-dialog').showModal();
}

async function submitModule(event) {
  event.preventDefault(); const button = byId('builder-module-submit'); setBusy(button, true);
  try {
    await networkApi('upsert_module', {
      site_id: state.site.id,
      module_id: byId('builder-module-id').value || null,
      module_type: byId('builder-module-type').value,
      display_name: byId('builder-module-name').value,
      instance_key: byId('builder-module-key').value,
      description: byId('builder-module-description').value,
      status: byId('builder-module-status').value,
      settings: {}, admin_config: { exposedControls: [] },
      capabilities: [...byId('builder-module-capabilities').querySelectorAll('input')].map(input => ({ capability_type: input.value, enabled: input.checked, contract_version: 1, settings: {} })),
    });
    byId('builder-module-dialog').close(); state.modules = await networkApi('list_modules', { site_id: state.site.id }); renderModules();
    showToast('Módulo guardado con sus capacidades.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

function renderWorkflows() {
  const list = byId('builder-workflow-list'); list.replaceChildren();
  for (const workflow of state.workflows) list.append(entityCard(workflow.display_name, `<${workflow.workflow_key}>`, workflow.enabled ? 'active' : 'draft', () => openWorkflowDialog(workflow)));
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay workflows.'; list.append(empty); }
}

function openWorkflowDialog(workflow = null) {
  delete byId('builder-workflow-key').dataset.touched;
  byId('builder-workflow-form').reset(); byId('builder-workflow-id').value = workflow?.id || '';
  byId('builder-workflow-title').textContent = workflow ? `Editar ${workflow.display_name}` : 'Nuevo workflow';
  byId('builder-workflow-name').value = workflow?.display_name || '';
  byId('builder-workflow-key').value = workflow?.workflow_key || '';
  byId('builder-workflow-description').value = workflow?.description || '';
  byId('builder-workflow-trigger').value = workflow?.trigger_config?.event || 'record.created';
  byId('builder-workflow-actions').value = (workflow?.actions_config || []).map(item => item.type || '').filter(Boolean).join('\n');
  byId('builder-workflow-error').value = workflow?.error_config?.strategy || 'stop';
  byId('builder-workflow-enabled').checked = !!workflow?.enabled;
  byId('builder-workflow-dialog').showModal();
}

async function submitWorkflow(event) {
  event.preventDefault(); const button = byId('builder-workflow-submit'); setBusy(button, true);
  try {
    await networkApi('upsert_workflow', {
      site_id: state.site.id,
      workflow_id: byId('builder-workflow-id').value || null,
      display_name: byId('builder-workflow-name').value,
      workflow_key: byId('builder-workflow-key').value,
      description: byId('builder-workflow-description').value,
      trigger_config: { event: byId('builder-workflow-trigger').value },
      condition_config: { all: [] },
      actions_config: byId('builder-workflow-actions').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(type => ({ type, settings: {} })),
      error_config: { strategy: byId('builder-workflow-error').value },
      enabled: byId('builder-workflow-enabled').checked,
    });
    byId('builder-workflow-dialog').close(); state.workflows = await networkApi('list_workflows', { site_id: state.site.id }); renderWorkflows();
    showToast('Workflow guardado.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

function renderComponents() {
  const list = byId('builder-component-list'); list.replaceChildren();
  for (const component of state.components) {
    list.append(entityCard(component.display_name, `<${component.component_key}>`, component.category, () => addSavedComponent(component)));
  }
  if (!list.children.length) { const empty = document.createElement('p'); empty.className = 'builder-empty'; empty.textContent = 'No hay componentes guardados.'; list.append(empty); }
}

function addSavedComponent(component) {
  const node = clone(component.document?.nodes?.[0]);
  if (!node) return;
  const refresh = item => { item.id = `${item.type}-${Math.random().toString(36).slice(2, 9)}`; (item.children || []).forEach(refresh); };
  refresh(node); pushHistory();
  const selected = state.selectedId ? findNode(state.document, state.selectedId) : null;
  insertNode(state.document, node, selected && CONTAINER_TYPES.has(selected.type) ? selected.id : null);
  state.selectedId = node.id; markDirty(); renderBuilder(); showToast('Componente agregado al lienzo.');
}

function openComponentDialog() {
  delete byId('builder-component-key').dataset.touched;
  const node = state.selectedId ? findNode(state.document, state.selectedId) : null;
  if (!node) { showToast('Selecciona un bloque para guardarlo como componente.', true); return; }
  const name = BLOCK_DEFINITIONS[node.type]?.label || 'Componente';
  byId('builder-component-form').reset();
  byId('builder-component-name').value = name;
  byId('builder-component-key').value = `${roleKey(name)}_${Date.now().toString(36).slice(-4)}`;
  byId('builder-component-dialog').showModal();
}

async function saveSelectedComponent(event) {
  event.preventDefault();
  const node = state.selectedId ? findNode(state.document, state.selectedId) : null;
  if (!node) { showToast('La selección ya no existe.', true); return; }
  const button = byId('builder-component-submit'); setBusy(button, true);
  try {
    await networkApi('upsert_component', {
      site_id: state.site.id,
      component_key: byId('builder-component-key').value,
      display_name: byId('builder-component-name').value,
      description: byId('builder-component-description').value,
      category: node.type,
      node,
    });
    byId('builder-component-dialog').close();
    state.components = await networkApi('list_components', { site_id: state.site.id }); renderComponents(); showToast('Componente reutilizable guardado.');
  } catch (error) { showToast(error.message, true); } finally { setBusy(button, false); }
}

function switchArea(area) {
  if (area === 'blocks' && state.document?.kind === 'legacy') {
    showToast('Primero crea una página editable; Culones original está protegido.', true);
    area = 'pages';
  }
  document.querySelectorAll('[data-builder-area]').forEach(button => button.classList.toggle('is-active', button.dataset.builderArea === area));
  document.querySelectorAll('[data-builder-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.builderPanel !== area));
  const labels = {
    pages: ['Estructura', 'Páginas'], blocks: ['Constructor', 'Bloques'], collections: ['Modelo de datos', 'Colecciones'],
    modules: ['Capacidades', 'Módulos'], workflows: ['Automatización', 'Workflows'], components: ['Reutilización', 'Componentes'],
  };
  byId('builder-area-kicker').textContent = labels[area][0]; byId('builder-area-title').textContent = labels[area][1];
  const add = byId('builder-area-add'); add.hidden = area === 'blocks' || area === 'components'; add.dataset.area = area;
  add.title = `Agregar ${labels[area][1].toLowerCase()}`;
}

function requestConfirm(title, copy, requiredText = '') {
  byId('builder-confirm-title').textContent = title;
  byId('builder-confirm-copy').textContent = copy;
  byId('builder-confirm-input-wrap').classList.toggle('hidden', !requiredText);
  byId('builder-confirm-label').textContent = requiredText ? `Escribe ${requiredText}` : 'Confirmación';
  byId('builder-confirm-input').value = '';
  byId('builder-confirm-submit').disabled = !!requiredText;
  byId('builder-confirm-input').oninput = () => { byId('builder-confirm-submit').disabled = byId('builder-confirm-input').value !== requiredText; };
  byId('builder-confirm-dialog').showModal();
  return new Promise(resolve => { confirmResolver = resolve; });
}

function settleConfirm(value) {
  if (confirmResolver) confirmResolver(value);
  confirmResolver = null;
}

function bindEvents() {
  byId('builder-canvas').addEventListener('click', event => {
    const block = event.target.closest('[data-block-id]'); if (!block) return; event.preventDefault(); event.stopPropagation(); selectNode(block.dataset.blockId);
  });
  byId('builder-site-select').addEventListener('change', event => void selectSite(event.target.value));
  byId('builder-page-select').addEventListener('change', event => void selectPage(event.target.value));
  byId('builder-save').addEventListener('click', () => void saveDraft().catch(() => {}));
  byId('builder-publish').addEventListener('click', () => void publishCurrentPage());
  byId('builder-undo').addEventListener('click', undo); byId('builder-redo').addEventListener('click', redo);
  byId('builder-preview-link').addEventListener('click', () => {
    if (!state.site || !state.page) return;
    if (state.site.id !== CULONES_SITE_ID && (state.site.status !== 'active' || state.page.status !== 'published')) {
      showToast('Esta vista todavía no es pública. Pulsa Publicar para activar el portal y esta página.', true); return;
    }
    const url = state.site.id === CULONES_SITE_ID && state.document?.kind === 'legacy'
      ? 'logs.html'
      : `site.html?site=${encodeURIComponent(state.site.slug)}&page=${encodeURIComponent(state.page.slug)}`;
    window.open(url, '_blank', 'noopener');
  });
  byId('builder-export').addEventListener('click', () => void exportCurrentSite());
  byId('builder-import').addEventListener('click', () => byId('builder-import-input').click());
  byId('builder-import-input').addEventListener('change', event => void chooseImportFile(event));
  byId('builder-import-submit').addEventListener('click', submitImport);
  document.querySelectorAll('[data-builder-area]').forEach(button => button.addEventListener('click', () => switchArea(button.dataset.builderArea)));
  byId('builder-area-add').addEventListener('click', () => {
    const area = byId('builder-area-add').dataset.area || 'pages';
    if (area === 'pages') openPageDialog(); else if (area === 'collections') openCollectionDialog(); else if (area === 'modules') openModuleDialog(); else if (area === 'workflows') openWorkflowDialog();
  });
  byId('builder-block-search').addEventListener('input', event => renderBlockLibrary(event.target.value));
  byId('builder-property-search').addEventListener('input', renderInspector);
  byId('builder-page-settings').addEventListener('click', () => state.page && openPageDialog(state.page));
  byId('builder-duplicate-page').addEventListener('click', () => void duplicateCurrentPage());
  byId('builder-archive-page').addEventListener('click', () => void archiveCurrentPage());
  byId('builder-page-submit').addEventListener('click', submitPage);
  byId('builder-add-field').addEventListener('click', () => addFieldRow());
  byId('builder-collection-submit').addEventListener('click', submitCollection);
  byId('builder-add-record').addEventListener('click', () => openRecordDialog());
  byId('builder-record-submit').addEventListener('click', submitRecord);
  byId('builder-record-archive').addEventListener('click', () => void archiveCurrentRecord());
  byId('builder-module-submit').addEventListener('click', submitModule);
  byId('builder-module-type').addEventListener('change', event => renderModuleCapabilities(event.target.value));
  byId('builder-workflow-submit').addEventListener('click', submitWorkflow);
  byId('builder-save-component').addEventListener('click', openComponentDialog);
  byId('builder-component-submit').addEventListener('click', saveSelectedComponent);
  byId('builder-move-up').addEventListener('click', () => { if (!state.selectedId) return; pushHistory(); if (moveNode(state.document, state.selectedId, 'up')) { markDirty(); renderBuilder(); } else state.history.pop(); updateHistoryButtons(); });
  byId('builder-move-down').addEventListener('click', () => { if (!state.selectedId) return; pushHistory(); if (moveNode(state.document, state.selectedId, 'down')) { markDirty(); renderBuilder(); } else state.history.pop(); updateHistoryButtons(); });
  byId('builder-duplicate-node').addEventListener('click', () => { if (!state.selectedId) return; pushHistory(); const copy = duplicateNode(state.document, state.selectedId); if (copy) { state.selectedId = copy.id; markDirty(); renderBuilder(); } });
  byId('builder-delete-node').addEventListener('click', async () => {
    if (!state.selectedId || !await requestConfirm('Eliminar bloque', 'El bloque se quitará del borrador. Puedes deshacerlo mientras no cambies de página.')) return;
    pushHistory(); removeNode(state.document, state.selectedId); state.selectedId = null; markDirty(); renderBuilder();
  });
  document.querySelectorAll('[data-device]').forEach(button => button.addEventListener('click', () => {
    state.device = button.dataset.device; document.querySelectorAll('[data-device]').forEach(item => item.classList.toggle('is-active', item === button));
    const viewport = byId('builder-viewport'); viewport.className = `builder-viewport is-${state.device}`; viewport.dataset.device = state.device; renderCanvas();
  }));
  byId('builder-preview-mode').addEventListener('change', event => { state.previewMode = event.target.value; renderCanvas(); });
  byId('builder-preview-role').addEventListener('change', event => { state.previewRole = event.target.value; renderCanvas(); });
  byId('builder-toggle-outline').addEventListener('click', event => {
    const active = event.currentTarget.getAttribute('aria-pressed') !== 'true'; event.currentTarget.setAttribute('aria-pressed', String(active)); byId('builder-canvas').classList.toggle('has-outlines', active);
  });
  byId('builder-a11y-status').addEventListener('click', openIssuesDialog);
  byId('builder-help-open').addEventListener('click', () => byId('builder-help-dialog').showModal());
  document.querySelectorAll('[data-open-builder-help]').forEach(button => button.addEventListener('click', () => byId('builder-help-dialog').showModal()));
  byId('network-toast').querySelector('.network-toast-close')?.addEventListener('click', hideToast);
  document.querySelectorAll('[data-inspector-tab]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-inspector-tab]').forEach(item => item.classList.toggle('is-active', item === button));
    document.querySelectorAll('[data-inspector-panel]').forEach(panel => panel.classList.toggle('hidden', panel.dataset.inspectorPanel !== button.dataset.inspectorTab));
  }));
  byId('builder-confirm-submit').addEventListener('click', () => settleConfirm(true));
  byId('builder-confirm-dialog').addEventListener('close', () => settleConfirm(byId('builder-confirm-dialog').returnValue === 'default'));
  window.addEventListener('beforeunload', event => { if (!state.dirty) return; event.preventDefault(); event.returnValue = ''; });
  document.addEventListener('keydown', event => {
    const editing = event.target.matches('input,textarea,select,[contenteditable="true"]');
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void saveDraft().catch(() => {}); }
    if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
    if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
    if (!editing && event.key === 'Delete' && state.selectedId) byId('builder-delete-node').click();
  });
  byId('builder-page-name').addEventListener('input', event => {
    if (!byId('builder-page-slug').dataset.touched) byId('builder-page-slug').value = slugify(event.target.value);
    if (!byId('builder-page-title').dataset.touched) byId('builder-page-title').value = event.target.value;
  });
  byId('builder-page-slug').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  byId('builder-page-title').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  byId('builder-collection-singular').addEventListener('input', event => { if (!byId('builder-collection-key').dataset.touched) byId('builder-collection-key').value = roleKey(event.target.value); });
  byId('builder-collection-key').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  byId('builder-module-name').addEventListener('input', event => { if (!byId('builder-module-key').dataset.touched) byId('builder-module-key').value = roleKey(event.target.value); });
  byId('builder-module-key').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  byId('builder-workflow-name').addEventListener('input', event => { if (!byId('builder-workflow-key').dataset.touched) byId('builder-workflow-key').value = roleKey(event.target.value); });
  byId('builder-workflow-key').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
  byId('builder-component-name').addEventListener('input', event => {
    if (!byId('builder-component-key').dataset.touched) byId('builder-component-key').value = roleKey(event.target.value);
  });
  byId('builder-component-key').addEventListener('input', event => { event.target.dataset.touched = 'true'; });
}

async function boot() {
  bindEvents(); renderBlockLibrary(); switchArea('pages');
  try {
    const session = await initializeNetworkSession();
    if (!session.session || !session.isOwner) {
      location.replace(`owner.html${location.search}`); return;
    }
    setNetworkMode('platform_owner');
    await loadSites();
  } catch (error) {
    showToast(error.message, true);
    byId('builder-canvas').textContent = `El constructor no está disponible: ${error.message}`;
  }
}

void boot();

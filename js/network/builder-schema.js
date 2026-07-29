const idPart = () => Math.random().toString(36).slice(2, 9);

export const CONTAINER_TYPES = new Set(['section', 'container', 'stack', 'grid', 'columns', 'card']);

const COMMON_FIELDS = [
  { group: 'Diseño', path: 'layout.maxWidth', label: 'Ancho máximo', type: 'text', placeholder: '1200px' },
  { group: 'Diseño', path: 'layout.minHeight', label: 'Alto mínimo', type: 'text', placeholder: 'auto / 70vh' },
  { group: 'Diseño', path: 'layout.padding', label: 'Relleno', type: 'spacing', default: '24px' },
  { group: 'Diseño', path: 'layout.margin', label: 'Margen', type: 'spacing', default: '0' },
  { group: 'Diseño', path: 'layout.gap', label: 'Separación', type: 'number', min: 0, max: 160, suffix: 'px' },
  { group: 'Diseño', path: 'layout.align', label: 'Alineación', type: 'select', options: ['start', 'center', 'end', 'stretch'] },
  { group: 'Diseño', path: 'layout.justify', label: 'Distribución', type: 'select', options: ['start', 'center', 'end', 'space-between', 'space-around'] },
  { group: 'Apariencia', path: 'appearance.background', label: 'Fondo', type: 'color-text' },
  { group: 'Apariencia', path: 'appearance.color', label: 'Texto', type: 'color-text' },
  { group: 'Apariencia', path: 'appearance.borderColor', label: 'Borde', type: 'color-text' },
  { group: 'Apariencia', path: 'appearance.borderWidth', label: 'Grosor de borde', type: 'number', min: 0, max: 12, suffix: 'px' },
  { group: 'Apariencia', path: 'appearance.radius', label: 'Radio', type: 'number', min: 0, max: 120, suffix: 'px' },
  { group: 'Apariencia', path: 'appearance.opacity', label: 'Opacidad', type: 'number', min: 0, max: 100, suffix: '%' },
  { group: 'Responsive', path: 'visibility.desktop', label: 'Visible en escritorio', type: 'checkbox', default: true },
  { group: 'Responsive', path: 'visibility.tablet', label: 'Visible en tablet', type: 'checkbox', default: true },
  { group: 'Responsive', path: 'visibility.mobile', label: 'Visible en móvil', type: 'checkbox', default: true },
  { group: 'Responsive', path: 'responsive.tablet.layout.padding', label: 'Relleno en tablet', type: 'spacing', placeholder: '24px' },
  { group: 'Responsive', path: 'responsive.tablet.layout.gap', label: 'Separación en tablet', type: 'number', min: 0, max: 160, suffix: 'px' },
  { group: 'Responsive', path: 'responsive.tablet.layout.maxWidth', label: 'Ancho máximo en tablet', type: 'text', placeholder: '100%' },
  { group: 'Responsive', path: 'responsive.tablet.layout.minHeight', label: 'Alto mínimo en tablet', type: 'text', placeholder: 'auto' },
  { group: 'Responsive', path: 'responsive.tablet.layout.direction', label: 'Dirección en tablet', type: 'select', options: ['', 'column', 'row'] },
  { group: 'Responsive', path: 'responsive.tablet.layout.align', label: 'Alineación en tablet', type: 'select', options: ['', 'start', 'center', 'end', 'stretch'] },
  { group: 'Responsive', path: 'responsive.tablet.layout.justify', label: 'Distribución en tablet', type: 'select', options: ['', 'start', 'center', 'end', 'space-between', 'space-around'] },
  { group: 'Responsive', path: 'responsive.tablet.typography.size', label: 'Tamaño de texto en tablet', type: 'text', placeholder: '2rem' },
  { group: 'Responsive', path: 'responsive.mobile.layout.padding', label: 'Relleno en móvil', type: 'spacing', placeholder: '16px' },
  { group: 'Responsive', path: 'responsive.mobile.layout.gap', label: 'Separación en móvil', type: 'number', min: 0, max: 160, suffix: 'px' },
  { group: 'Responsive', path: 'responsive.mobile.layout.maxWidth', label: 'Ancho máximo en móvil', type: 'text', placeholder: '100%' },
  { group: 'Responsive', path: 'responsive.mobile.layout.minHeight', label: 'Alto mínimo en móvil', type: 'text', placeholder: 'auto' },
  { group: 'Responsive', path: 'responsive.mobile.layout.direction', label: 'Dirección en móvil', type: 'select', options: ['', 'column', 'row'] },
  { group: 'Responsive', path: 'responsive.mobile.layout.align', label: 'Alineación en móvil', type: 'select', options: ['', 'start', 'center', 'end', 'stretch'] },
  { group: 'Responsive', path: 'responsive.mobile.layout.justify', label: 'Distribución en móvil', type: 'select', options: ['', 'start', 'center', 'end', 'space-between', 'space-around'] },
  { group: 'Responsive', path: 'responsive.mobile.textAlign', label: 'Texto en móvil', type: 'select', options: ['', 'left', 'center', 'right'] },
  { group: 'Responsive', path: 'responsive.mobile.typography.size', label: 'Tamaño de texto en móvil', type: 'text', placeholder: '1.5rem' },
  { group: 'Acceso', path: 'visibility.mode', label: 'Contexto visible', type: 'select', options: ['all', 'normal', 'site_admin_supreme', 'platform_owner'] },
  { group: 'Acceso', path: 'visibility.roles', label: 'Roles permitidos', type: 'tags', placeholder: 'helper, moderador' },
  { group: 'Accesibilidad', path: 'accessibility.label', label: 'Etiqueta accesible', type: 'text' },
];

export const BLOCK_DEFINITIONS = Object.freeze({
  section: {
    label: 'Sección', icon: '▱', category: 'Estructura', container: true,
    defaults: { layout: { maxWidth: '1200px', padding: '72px 24px', gap: 24, align: 'stretch', justify: 'start' } },
    fields: [],
  },
  container: {
    label: 'Contenedor', icon: '□', category: 'Estructura', container: true,
    defaults: { layout: { maxWidth: '1100px', padding: '24px', gap: 20, align: 'stretch', justify: 'start' } },
    fields: [],
  },
  stack: {
    label: 'Pila', icon: '☷', category: 'Estructura', container: true,
    defaults: { layout: { direction: 'column', gap: 16, align: 'stretch', justify: 'start' } },
    fields: [{ group: 'Diseño', path: 'layout.direction', label: 'Dirección', type: 'select', options: ['column', 'row'] }],
  },
  grid: {
    label: 'Grid', icon: '▦', category: 'Estructura', container: true,
    defaults: { layout: { columns: 3, gap: 20, align: 'stretch' } },
    fields: [
      { group: 'Diseño', path: 'layout.columns', label: 'Columnas', type: 'number', min: 1, max: 12 },
      { group: 'Responsive', path: 'responsive.tablet.columns', label: 'Columnas tablet', type: 'number', min: 1, max: 12 },
      { group: 'Responsive', path: 'responsive.mobile.columns', label: 'Columnas móvil', type: 'number', min: 1, max: 12 },
    ],
  },
  columns: {
    label: 'Columnas', icon: '▥', category: 'Estructura', container: true,
    defaults: { layout: { columns: 2, gap: 24, align: 'stretch' } },
    fields: [
      { group: 'Diseño', path: 'layout.columns', label: 'Columnas', type: 'number', min: 1, max: 12 },
      { group: 'Responsive', path: 'responsive.mobile.columns', label: 'Columnas móvil', type: 'number', min: 1, max: 12 },
    ],
  },
  card: {
    label: 'Tarjeta', icon: '▢', category: 'Estructura', container: true,
    defaults: { layout: { padding: '24px', gap: 14 }, appearance: { background: 'var(--site-surface)', borderColor: 'var(--site-border)', borderWidth: 1, radius: 18 } },
    fields: [],
  },
  heading: {
    label: 'Título', icon: 'H', category: 'Contenido',
    defaults: { text: 'Nuevo título', level: 2, layout: { margin: '0' } },
    fields: [
      { group: 'Contenido', path: 'text', label: 'Texto', type: 'textarea' },
      { group: 'Contenido', path: 'level', label: 'Nivel', type: 'select', options: [1, 2, 3, 4, 5, 6] },
      { group: 'Diseño', path: 'textAlign', label: 'Alineación de texto', type: 'select', options: ['left', 'center', 'right'] },
      { group: 'Tipografía', path: 'typography.size', label: 'Tamaño', type: 'text', placeholder: 'clamp(2rem, 6vw, 5rem)' },
      { group: 'Tipografía', path: 'typography.weight', label: 'Peso', type: 'number', min: 100, max: 900 },
    ],
  },
  text: {
    label: 'Texto', icon: '¶', category: 'Contenido',
    defaults: { text: 'Escribe aquí el contenido.', layout: { margin: '0' } },
    fields: [
      { group: 'Contenido', path: 'text', label: 'Texto', type: 'textarea' },
      { group: 'Diseño', path: 'textAlign', label: 'Alineación', type: 'select', options: ['left', 'center', 'right'] },
      { group: 'Tipografía', path: 'typography.size', label: 'Tamaño', type: 'text', placeholder: '1rem' },
      { group: 'Tipografía', path: 'typography.weight', label: 'Peso', type: 'number', min: 100, max: 900 },
    ],
  },
  button: {
    label: 'Botón', icon: '↗', category: 'Contenido',
    defaults: { text: 'Botón', action: 'navigate', url: '#', variant: 'primary', openNew: false, layout: { padding: '12px 20px' }, appearance: { radius: 999 } },
    fields: [
      { group: 'Contenido', path: 'text', label: 'Texto', type: 'text' },
      { group: 'Contenido', path: 'icon', label: 'Icono o emoji', type: 'text' },
      { group: 'Acción', path: 'action', label: 'Acción', type: 'select', options: ['navigate', 'open-url', 'scroll-to', 'open-search'] },
      { group: 'Acción', path: 'url', label: 'Destino', type: 'text' },
      { group: 'Acción', path: 'openNew', label: 'Abrir en otra pestaña', type: 'checkbox' },
      { group: 'Apariencia', path: 'variant', label: 'Variante', type: 'select', options: ['primary', 'secondary', 'outline', 'ghost', 'danger'] },
    ],
  },
  image: {
    label: 'Imagen', icon: '▧', category: 'Contenido',
    defaults: { src: '', alt: '', fit: 'cover', loading: 'lazy', layout: { maxWidth: '100%' }, appearance: { radius: 16 } },
    fields: [
      { group: 'Contenido', path: 'src', label: 'URL de imagen', type: 'url' },
      { group: 'Accesibilidad', path: 'alt', label: 'Texto alternativo', type: 'text' },
      { group: 'Diseño', path: 'fit', label: 'Ajuste', type: 'select', options: ['cover', 'contain', 'fill', 'none'] },
      { group: 'Diseño', path: 'aspectRatio', label: 'Proporción', type: 'text', placeholder: '16 / 9' },
    ],
  },
  spacer: {
    label: 'Espacio', icon: '↕', category: 'Contenido',
    defaults: { size: 32 },
    fields: [{ group: 'Diseño', path: 'size', label: 'Alto', type: 'number', min: 0, max: 500, suffix: 'px' }],
  },
  divider: {
    label: 'Separador', icon: '—', category: 'Contenido',
    defaults: { thickness: 1, appearance: { borderColor: 'var(--site-border)' } },
    fields: [{ group: 'Diseño', path: 'thickness', label: 'Grosor', type: 'number', min: 1, max: 20, suffix: 'px' }],
  },
  badge: {
    label: 'Etiqueta', icon: '●', category: 'Contenido',
    defaults: { text: 'Etiqueta', layout: { padding: '6px 10px' }, appearance: { background: 'var(--site-surface)', radius: 999 } },
    fields: [{ group: 'Contenido', path: 'text', label: 'Texto', type: 'text' }],
  },
  stat: {
    label: 'Estadística', icon: '#', category: 'Contenido',
    defaults: { value: '0', label: 'Estadística', layout: { padding: '20px' }, appearance: { background: 'var(--site-surface)', radius: 16 } },
    fields: [
      { group: 'Contenido', path: 'value', label: 'Valor', type: 'text' },
      { group: 'Contenido', path: 'label', label: 'Etiqueta', type: 'text' },
    ],
  },
  'link-list': {
    label: 'Lista de enlaces', icon: '☰', category: 'Contenido',
    defaults: { items: [{ label: 'Enlace', url: '#' }], layout: { gap: 10 } },
    fields: [{ group: 'Contenido', path: 'items', label: 'Enlaces', type: 'link-list' }],
  },
  'collection-view': {
    label: 'Vista de colección', icon: '▤', category: 'Datos',
    defaults: { collectionId: '', view: 'cards', pageSize: 12, titleField: 'title', summaryField: 'summary', imageField: 'image', emptyText: 'No hay contenido todavía.' },
    fields: [
      { group: 'Datos', path: 'collectionId', label: 'Colección', type: 'collection' },
      { group: 'Datos', path: 'view', label: 'Vista', type: 'select', options: ['cards', 'list', 'table', 'timeline', 'calendar', 'kanban', 'tierlist'] },
      { group: 'Datos', path: 'pageSize', label: 'Resultados', type: 'number', min: 1, max: 100 },
      { group: 'Datos', path: 'titleField', label: 'Campo de título', type: 'text' },
      { group: 'Datos', path: 'summaryField', label: 'Campo de resumen', type: 'text' },
      { group: 'Datos', path: 'imageField', label: 'Campo de imagen', type: 'text' },
      { group: 'Datos', path: 'emptyText', label: 'Mensaje vacío', type: 'text' },
    ],
  },
  form: {
    label: 'Formulario', icon: '✎', category: 'Datos',
    defaults: { collectionId: '', submitLabel: 'Enviar', successMessage: 'Enviado correctamente.', layout: { gap: 14 } },
    fields: [
      { group: 'Datos', path: 'collectionId', label: 'Colección', type: 'collection' },
      { group: 'Contenido', path: 'submitLabel', label: 'Texto del botón', type: 'text' },
      { group: 'Contenido', path: 'successMessage', label: 'Confirmación', type: 'text' },
    ],
  },
  embed: {
    label: 'Contenido externo', icon: '◫', category: 'Datos',
    defaults: { url: '', title: 'Contenido externo', aspectRatio: '16 / 9' },
    fields: [
      { group: 'Contenido', path: 'url', label: 'URL', type: 'url' },
      { group: 'Accesibilidad', path: 'title', label: 'Título accesible', type: 'text' },
      { group: 'Diseño', path: 'aspectRatio', label: 'Proporción', type: 'text' },
    ],
  },
  navigation: {
    label: 'Navegación', icon: '⌘', category: 'Sistema',
    defaults: { source: 'site', layout: { direction: 'row', gap: 12 } },
    fields: [{ group: 'Datos', path: 'source', label: 'Fuente', type: 'select', options: ['site', 'page-children'] }],
  },
  search: {
    label: 'Búsqueda', icon: '⌕', category: 'Sistema',
    defaults: { placeholder: 'Buscar…', buttonLabel: 'Buscar' },
    fields: [
      { group: 'Contenido', path: 'placeholder', label: 'Placeholder', type: 'text' },
      { group: 'Contenido', path: 'buttonLabel', label: 'Botón', type: 'text' },
    ],
  },
});

export function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function createNode(type) {
  const definition = BLOCK_DEFINITIONS[type];
  if (!definition) throw new Error(`Bloque desconocido: ${type}`);
  return {
    id: `${type}-${idPart()}`,
    type,
    props: clone(definition.defaults || {}),
    children: [],
  };
}

export function defaultDocument(title = 'Nueva página') {
  const section = createNode('section');
  const heading = createNode('heading');
  heading.props.text = title;
  heading.props.level = 1;
  section.children.push(heading);
  return { schemaVersion: 1, kind: 'page', nodes: [section] };
}

export function getAtPath(target, path, fallback = '') {
  const value = String(path).split('.').reduce((current, part) => current?.[part], target);
  return value == null ? fallback : value;
}

export function setAtPath(target, path, value) {
  const parts = String(path).split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) current = current[part] ||= {};
  current[parts.at(-1)] = value;
  return target;
}

export function findNode(document, nodeId) {
  let result = null;
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node.id === nodeId) { result = node; return true; }
      if (visit(node.children)) return true;
    }
    return false;
  };
  visit(document?.nodes);
  return result;
}

export function findParent(document, nodeId) {
  let result = null;
  const visit = (nodes, parent) => {
    for (let index = 0; index < (nodes || []).length; index += 1) {
      const node = nodes[index];
      if (node.id === nodeId) { result = { parent, nodes, index, node }; return true; }
      if (visit(node.children, node)) return true;
    }
    return false;
  };
  visit(document?.nodes, null);
  return result;
}

export function insertNode(document, node, parentId = null, index = null) {
  const target = parentId ? findNode(document, parentId) : null;
  const nodes = target && CONTAINER_TYPES.has(target.type) ? (target.children ||= []) : (document.nodes ||= []);
  const position = Number.isInteger(index) ? Math.max(0, Math.min(index, nodes.length)) : nodes.length;
  nodes.splice(position, 0, node);
  return node;
}

export function removeNode(document, nodeId) {
  const match = findParent(document, nodeId);
  if (!match) return null;
  return match.nodes.splice(match.index, 1)[0] || null;
}

export function moveNode(document, nodeId, direction) {
  const match = findParent(document, nodeId);
  if (!match) return false;
  const next = direction === 'up' ? match.index - 1 : match.index + 1;
  if (next < 0 || next >= match.nodes.length) return false;
  [match.nodes[match.index], match.nodes[next]] = [match.nodes[next], match.nodes[match.index]];
  return true;
}

export function duplicateNode(document, nodeId) {
  const match = findParent(document, nodeId);
  if (!match) return null;
  const copy = clone(match.node);
  const refreshIds = node => {
    node.id = `${node.type}-${idPart()}`;
    (node.children || []).forEach(refreshIds);
  };
  refreshIds(copy);
  match.nodes.splice(match.index + 1, 0, copy);
  return copy;
}

export function inspectorFields(node) {
  const definition = BLOCK_DEFINITIONS[node?.type];
  return definition ? [...definition.fields, ...COMMON_FIELDS] : COMMON_FIELDS;
}

function safeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('//')) return '';
  try {
    const parsed = new URL(raw, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

function cssLength(value, fallback = '') {
  const raw = String(value ?? '').trim();
  return /^(?:auto|none|0|\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%|ch)|clamp\([^;{}]+\)|min\([^;{}]+\)|max\([^;{}]+\))$/i.test(raw) ? raw : fallback;
}

function cssColor(value, fallback = '') {
  const raw = String(value ?? '').trim();
  return /^(?:#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|transparent|currentColor|var\(--[a-z0-9_-]+\))$/i.test(raw) ? raw : fallback;
}

function applyStyles(element, props = {}, context = {}) {
  const device = context.device || (matchMedia('(max-width: 680px)').matches ? 'mobile' : matchMedia('(max-width: 980px)').matches ? 'tablet' : 'desktop');
  const override = props.responsive?.[device] || {};
  const effective = {
    ...props,
    ...override,
    layout: {
      ...(props.layout || {}),
      ...(override.layout || {}),
      ...(override.columns != null ? { columns: override.columns } : {}),
    },
    appearance: { ...(props.appearance || {}), ...(override.appearance || {}) },
    typography: { ...(props.typography || {}), ...(override.typography || {}) },
  };
  const layout = effective.layout || {};
  const appearance = effective.appearance || {};
  if (layout.maxWidth) element.style.maxWidth = cssLength(layout.maxWidth, '');
  if (layout.minHeight) element.style.minHeight = cssLength(layout.minHeight, '');
  if (layout.padding) element.style.padding = String(layout.padding).slice(0, 80);
  if (layout.margin) element.style.margin = String(layout.margin).slice(0, 80);
  if (Number.isFinite(Number(layout.gap))) element.style.gap = `${Math.max(0, Math.min(160, Number(layout.gap)))}px`;
  if (['start', 'center', 'end', 'stretch'].includes(layout.align)) element.style.alignItems = layout.align === 'start' ? 'flex-start' : layout.align === 'end' ? 'flex-end' : layout.align;
  if (['start', 'center', 'end', 'space-between', 'space-around'].includes(layout.justify)) element.style.justifyContent = layout.justify === 'start' ? 'flex-start' : layout.justify === 'end' ? 'flex-end' : layout.justify;
  if (['row', 'column'].includes(layout.direction)) element.style.flexDirection = layout.direction;
  if (Number.isFinite(Number(layout.columns))) element.style.setProperty('--block-columns', String(Math.max(1, Math.min(12, Number(layout.columns)))));
  if (appearance.background) element.style.background = cssColor(appearance.background, '');
  if (appearance.color) element.style.color = cssColor(appearance.color, '');
  if (appearance.borderColor) element.style.borderColor = cssColor(appearance.borderColor, '');
  if (Number.isFinite(Number(appearance.borderWidth))) {
    element.style.borderWidth = `${Math.max(0, Math.min(12, Number(appearance.borderWidth)))}px`;
    element.style.borderStyle = Number(appearance.borderWidth) > 0 ? 'solid' : 'none';
  }
  if (Number.isFinite(Number(appearance.radius))) element.style.borderRadius = `${Math.max(0, Math.min(120, Number(appearance.radius)))}px`;
  if (Number.isFinite(Number(appearance.opacity))) element.style.opacity = String(Math.max(0, Math.min(100, Number(appearance.opacity))) / 100);
  if (['left', 'center', 'right'].includes(effective.textAlign)) element.style.textAlign = effective.textAlign;
  if (effective.typography?.size) element.style.fontSize = cssLength(effective.typography.size, '');
  if (Number.isFinite(Number(effective.typography?.weight))) element.style.fontWeight = String(Math.max(100, Math.min(900, Number(effective.typography.weight))));
  element.dataset.desktopVisible = String(props.visibility?.desktop !== false);
  element.dataset.tabletVisible = String(props.visibility?.tablet !== false);
  element.dataset.mobileVisible = String(props.visibility?.mobile !== false);
  element.dataset.visibleMode = String(props.visibility?.mode || 'all');
  element.dataset.visibleRoles = Array.isArray(props.visibility?.roles) ? props.visibility.roles.join(',') : '';
  if (props.accessibility?.label) element.setAttribute('aria-label', String(props.accessibility.label).slice(0, 200));
}

function visibleForContext(element, context) {
  const device = context.device || (matchMedia('(max-width: 680px)').matches ? 'mobile' : matchMedia('(max-width: 980px)').matches ? 'tablet' : 'desktop');
  if (element.dataset[`${device}Visible`] === 'false') return false;
  const requiredMode = element.dataset.visibleMode || 'all';
  if (requiredMode !== 'all' && requiredMode !== (context.mode || 'normal')) return false;
  const roles = (element.dataset.visibleRoles || '').split(',').map(value => value.trim()).filter(Boolean);
  if (roles.length && !roles.some(role => (context.roles || []).includes(role))) return false;
  return true;
}

function renderNode(node, context) {
  const props = node.props || {};
  let element;
  if (CONTAINER_TYPES.has(node.type)) {
    element = document.createElement(node.type === 'section' ? 'section' : 'div');
    element.className = `empi-block empi-${node.type}`;
    for (const child of node.children || []) element.append(renderNode(child, context));
  } else if (node.type === 'heading') {
    const level = Math.max(1, Math.min(6, Number(props.level) || 2));
    element = document.createElement(`h${level}`);
    element.textContent = String(props.text || '');
  } else if (node.type === 'text') {
    element = document.createElement('p');
    element.textContent = String(props.text || '');
  } else if (node.type === 'button') {
    element = document.createElement('a');
    element.className = `empi-button empi-button-${props.variant || 'primary'}`;
    element.href = props.action === 'scroll-to' ? String(props.url || '#') : (safeUrl(props.url) || '#');
    if (props.openNew) { element.target = '_blank'; element.rel = 'noopener'; }
    element.dataset.action = String(props.action || 'navigate');
    element.textContent = `${props.icon ? `${props.icon} ` : ''}${props.text || 'Botón'}`;
  } else if (node.type === 'image') {
    element = document.createElement('img');
    element.src = safeUrl(props.src);
    element.alt = String(props.alt || '');
    element.loading = props.loading === 'eager' ? 'eager' : 'lazy';
    element.style.objectFit = ['cover', 'contain', 'fill', 'none'].includes(props.fit) ? props.fit : 'cover';
    if (props.aspectRatio) element.style.aspectRatio = String(props.aspectRatio).replace(/[^\d\s/.]/g, '');
  } else if (node.type === 'spacer') {
    element = document.createElement('div');
    element.className = 'empi-spacer';
    element.style.height = `${Math.max(0, Math.min(500, Number(props.size) || 0))}px`;
    element.setAttribute('aria-hidden', 'true');
  } else if (node.type === 'divider') {
    element = document.createElement('hr');
    element.style.borderTopWidth = `${Math.max(1, Math.min(20, Number(props.thickness) || 1))}px`;
  } else if (node.type === 'badge') {
    element = document.createElement('span');
    element.className = 'empi-badge'; element.textContent = String(props.text || '');
  } else if (node.type === 'stat') {
    element = document.createElement('article'); element.className = 'empi-stat';
    const value = document.createElement('strong'); value.textContent = String(props.value || '0');
    const label = document.createElement('span'); label.textContent = String(props.label || '');
    element.append(value, label);
  } else if (node.type === 'link-list') {
    element = document.createElement('nav'); element.className = 'empi-link-list';
    for (const item of Array.isArray(props.items) ? props.items : []) {
      const link = document.createElement('a'); link.href = safeUrl(item.url) || '#'; link.textContent = String(item.label || 'Enlace'); element.append(link);
    }
  } else if (node.type === 'collection-view') {
    element = document.createElement('section'); element.className = `empi-collection-view empi-view-${props.view || 'cards'}`;
    element.dataset.collectionId = String(props.collectionId || '');
    element.dataset.view = String(props.view || 'cards');
    element.dataset.pageSize = String(Math.max(1, Math.min(100, Number(props.pageSize) || 12)));
    element.dataset.titleField = String(props.titleField || 'title');
    element.dataset.summaryField = String(props.summaryField || 'summary');
    element.dataset.imageField = String(props.imageField || 'image');
    element.dataset.emptyText = String(props.emptyText || 'No hay contenido todavía.');
    element.textContent = context.builder ? 'Vista de colección' : 'Cargando contenido…';
  } else if (node.type === 'form') {
    element = document.createElement('form'); element.className = 'empi-generated-form';
    element.dataset.collectionId = String(props.collectionId || '');
    element.dataset.submitLabel = String(props.submitLabel || 'Enviar');
    element.dataset.successMessage = String(props.successMessage || 'Enviado correctamente.');
    const placeholder = document.createElement('p'); placeholder.textContent = context.builder ? 'Formulario conectado a una colección' : 'Cargando formulario…';
    element.append(placeholder);
  } else if (node.type === 'embed') {
    element = document.createElement('iframe'); element.className = 'empi-embed';
    element.src = safeUrl(props.url); element.title = String(props.title || 'Contenido externo'); element.loading = 'lazy';
    element.referrerPolicy = 'strict-origin-when-cross-origin'; element.sandbox = 'allow-scripts allow-same-origin allow-popups';
    element.style.aspectRatio = String(props.aspectRatio || '16 / 9').replace(/[^\d\s/.]/g, '');
  } else if (node.type === 'navigation') {
    element = document.createElement('nav'); element.className = 'empi-inline-navigation'; element.dataset.navigationSource = String(props.source || 'site');
  } else if (node.type === 'search') {
    element = document.createElement('form'); element.className = 'empi-inline-search'; element.setAttribute('role', 'search');
    const input = document.createElement('input'); input.type = 'search'; input.placeholder = String(props.placeholder || 'Buscar…');
    const button = document.createElement('button'); button.type = 'submit'; button.textContent = String(props.buttonLabel || 'Buscar');
    element.append(input, button);
  } else {
    element = document.createElement('div'); element.textContent = `Bloque ${node.type}`;
  }
  element.classList.add('empi-block');
  element.dataset.blockId = node.id;
  element.dataset.blockType = node.type;
  applyStyles(element, props, context);
  element.hidden = !visibleForContext(element, context);
  return element;
}

export function renderPageDocument(pageDocument, container, context = {}) {
  container.replaceChildren();
  const doc = pageDocument?.kind === 'page' ? pageDocument : defaultDocument('Página');
  for (const node of doc.nodes || []) container.append(renderNode(node, context));
  return container;
}

export function refreshVisibility(container, context = {}) {
  container.querySelectorAll('[data-block-id]').forEach(element => { element.hidden = !visibleForContext(element, context); });
}

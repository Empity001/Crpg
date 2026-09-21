// =========================================================
// desk/layout.js
// =========================================================
// Modelo de la portada: una lista de ventanas colocadas libremente.
//
//   { id, type, title, chrome, x, y, w, h, z, props }
//
//   x, w  porcentaje del ancho del escritorio (así se adapta a cualquier pantalla)
//   y, h  píxeles (la altura no escala con el ancho; el contenido hace scroll dentro)
//   z     orden de apilado
//
// El contenido lo escribe el admin y lo pinta la web pública, así que todo lo
// que entra desde la base de datos pasa por normalizeLayout(): tipos conocidos,
// números acotados, textos recortados y enlaces solo http/https o relativos.
// =========================================================

import { PICKABLE_ICONS } from '../core/icons.js';

export const SETTING_KEY = 'layout_home';
export const LAYOUT_VERSION = 1;

export const CHROMES = Object.freeze({
  retro: { label: 'Retro', hint: 'Borde grueso, sombra dura y letra pixelada' },
  glass: { label: 'Cristal', hint: 'Suave, translúcida y con barra pastel' },
  hud:   { label: 'HUD',    hint: 'Líneas finas, esquinas y letra técnica' },
});

export const LIMITS = Object.freeze({
  windows: 40,
  title: 60,
  text: 2400,
  heading: 90,
  label: 40,
  url: 600,
  links: 12,
  minW: 16,
  maxW: 100,
  minH: 120,
  maxH: 1600,
  maxY: 6000,
});

// Campos editables por tipo. El editor genera el formulario a partir de aquí.
//   kind: text | textarea | url | number | links | icon
export const TYPES = Object.freeze({
  bienvenida: {
    label: 'Bienvenida', icon: 'sparkle', chrome: 'retro', title: 'Bienvenido.exe',
    size: { w: 52, h: 310 },
    fields: [
      { key: 'heading', label: 'Titular', kind: 'text', max: LIMITS.heading },
      { key: 'text', label: 'Texto', kind: 'textarea', max: LIMITS.text, help: 'Puedes usar **negrita** y [texto](https://enlace).' },
      { key: 'buttons', label: 'Botones', kind: 'links', max: 2 },
    ],
    props: {
      heading: 'Bienvenido a Culones RPG',
      text: 'Aquí vas a encontrar los logs del server, las guías de armas, la tierlist y los kits.\n\nTodavía estoy armando todo esto, así que si algo se ve raro es que voy a mitad de obra ;3',
      buttons: [{ label: 'Ver los logs', href: 'logs.html' }, { label: 'Guías de armas', href: 'guides.html' }],
    },
  },
  texto: {
    label: 'Texto', icon: 'text-t', chrome: 'glass', title: 'Nota.txt',
    size: { w: 34, h: 230 },
    fields: [{ key: 'text', label: 'Texto', kind: 'textarea', max: LIMITS.text, help: 'Puedes usar **negrita** y [texto](https://enlace).' }],
    props: { text: 'Escribe aquí lo que quieras contar.' },
  },
  enlaces: {
    label: 'Lista de enlaces', icon: 'folder-open', chrome: 'glass', title: 'Explorar',
    size: { w: 36, h: 322 },
    fields: [{ key: 'items', label: 'Enlaces', kind: 'links', max: LIMITS.links, icons: true }],
    props: {
      items: [
        { label: 'Logs', href: 'logs.html', icon: 'scroll' },
        { label: 'Guías', href: 'guides.html', icon: 'sword' },
        { label: 'Tierlist', href: 'tierlist.html', icon: 'trophy' },
        { label: 'Kits', href: 'kits.html', icon: 'backpack' },
        { label: 'Acerca del servidor', href: 'about.html', icon: 'game-controller' },
      ],
    },
  },
  ip: {
    label: 'Dirección del servidor', icon: 'globe', chrome: 'hud', title: 'Conectar',
    size: { w: 30, h: 190 },
    fields: [
      { key: 'address', label: 'Dirección (IP o dominio)', kind: 'text', max: 120 },
      { key: 'note', label: 'Nota', kind: 'text', max: 160 },
    ],
    props: { address: '', note: '' },
  },
  imagen: {
    label: 'Imagen', icon: 'image', chrome: 'retro', title: 'Imagen.png',
    size: { w: 34, h: 270 },
    fields: [
      { key: 'src', label: 'URL de la imagen', kind: 'url', max: LIMITS.url },
      { key: 'alt', label: 'Descripción (para lectores de pantalla)', kind: 'text', max: 160 },
      { key: 'caption', label: 'Pie de foto', kind: 'text', max: 160 },
    ],
    props: { src: '', alt: '', caption: '' },
  },
  logs: {
    label: 'Últimos logs', icon: 'scroll', chrome: 'hud', title: 'Últimos logs',
    size: { w: 42, h: 300 },
    fields: [{ key: 'limit', label: 'Cuántos mostrar', kind: 'number', min: 1, max: 12 }],
    props: { limit: 5 },
  },
  armas: {
    label: 'Armas nuevas', icon: 'sword', chrome: 'retro', title: 'Armas nuevas',
    size: { w: 42, h: 300 },
    fields: [{ key: 'limit', label: 'Cuántas mostrar', kind: 'number', min: 1, max: 12 }],
    props: { limit: 6 },
  },
  estadisticas: {
    label: 'Números del server', icon: 'chart-bar', chrome: 'hud', title: 'Estado',
    size: { w: 30, h: 220 },
    fields: [],
    props: {},
  },
});

export const TYPE_KEYS = Object.freeze(Object.keys(TYPES));

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const round1 = (n) => Math.round(n * 10) / 10;
const cut = (value, max) => String(value ?? '').replace(/\u0000/g, '').slice(0, max);

export function uid() {
  return 'w' + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
}

// Enlaces: solo http(s) o rutas relativas. Nunca javascript:, data:, etc.
export function cleanHref(value) {
  const v = String(value ?? '').trim().slice(0, LIMITS.url);
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) {
    try { return new URL(v).href; } catch { return ''; }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return '';
  return /^[\w./?=&%#~+\-@!,;:$*()']*$/.test(v) ? v : '';
}

function cleanLinks(list, max, withIcons) {
  if (!Array.isArray(list)) return [];
  // Primero se descartan los inválidos y luego se aplica el cupo: una fila basura no debe quitar sitio a una buena.
  return list.slice(0, 60).map((row) => {
    const label = cut(row?.label, LIMITS.label).trim();
    const href = cleanHref(row?.href);
    if (!label || !href) return null;
    const item = { label, href };
    if (withIcons) item.icon = PICKABLE_ICONS.includes(row?.icon) ? row.icon : 'link';
    return item;
  }).filter(Boolean).slice(0, max);
}

function cleanProps(type, raw) {
  const spec = TYPES[type];
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const field of spec.fields) {
    const value = src[field.key];
    if (field.kind === 'links') out[field.key] = cleanLinks(value, field.max, !!field.icons);
    else if (field.kind === 'number') out[field.key] = Math.round(clamp(value, field.min, field.max, spec.props[field.key]));
    else if (field.kind === 'url') out[field.key] = cleanHref(value);
    else out[field.key] = cut(value, field.max);
  }
  return out;
}

export function normalizeWindow(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || !Object.hasOwn(TYPES, raw.type)) return null;
  const spec = TYPES[raw.type];
  const w = round1(clamp(raw.w, LIMITS.minW, LIMITS.maxW, spec.size.w));
  const id = /^[a-z0-9_-]{1,24}$/i.test(String(raw.id ?? '')) ? String(raw.id) : uid();
  return {
    id,
    type: raw.type,
    title: cut(raw.title, LIMITS.title) || spec.title,
    chrome: Object.hasOwn(CHROMES, raw.chrome) ? raw.chrome : spec.chrome,
    w,
    x: round1(clamp(raw.x, 0, 100 - w, 0)),
    y: Math.round(clamp(raw.y, 0, LIMITS.maxY, 0)),
    h: Math.round(clamp(raw.h, LIMITS.minH, LIMITS.maxH, spec.size.h)),
    z: Math.round(clamp(raw.z, 1, 9999, index + 1)),
    props: cleanProps(raw.type, raw.props),
  };
}

// Devuelve un layout válido o null si el valor guardado no sirve.
export function normalizeLayout(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.windows)) return null;
  const seen = new Set();
  const windows = [];
  raw.windows.slice(0, LIMITS.windows).forEach((row, index) => {
    // Una fila corrupta no debe tumbar toda la portada: se descarta y se sigue.
    let win = null;
    try { win = normalizeWindow(row, index); } catch (error) { console.warn('[Portada] Ventana descartada:', error); }
    if (!win) return;
    while (seen.has(win.id)) win.id = uid();
    seen.add(win.id);
    windows.push(win);
  });
  return { v: LAYOUT_VERSION, windows };
}

export function newWindow(type, patch = {}) {
  const spec = TYPES[type];
  if (!spec) return null;
  return normalizeWindow({
    id: uid(), type, title: spec.title, chrome: spec.chrome,
    x: 4, y: 24, w: spec.size.w, h: spec.size.h, z: 1,
    props: JSON.parse(JSON.stringify(spec.props)),
    ...patch,
  });
}

// Composición inicial: se usa mientras el admin no haya guardado ninguna.
export function defaultLayout() {
  const make = (type, patch) => newWindow(type, patch);
  return {
    v: LAYOUT_VERSION,
    windows: [
      make('bienvenida', { id: 'bienvenida', x: 2, y: 0, w: 55, h: 330, z: 2 }),
      make('enlaces', { id: 'explorar', x: 60, y: 18, w: 38, h: 322, z: 3 }),
      make('logs', { id: 'logs', x: 7, y: 316, w: 44, h: 300, z: 5 }),
      make('armas', { id: 'armas', x: 54, y: 364, w: 44, h: 290, z: 4 }),
    ],
  };
}

export function layoutHeight(layout) {
  return layout.windows.reduce((max, win) => Math.max(max, win.y + win.h), 0);
}

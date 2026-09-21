// Genera assets/icons.svg (sprite) a partir de Phosphor Icons (MIT), peso "bold".
//
// La web no tiene paso de compilación, así que el sprite se genera a mano solo
// cuando hace falta un icono nuevo:
//
//   1. Añade el nombre del icono a ICONS.
//   2. npm install --no-save @phosphor-icons/core
//   3. node tools/build-icons.mjs
//
// Uso en el HTML:  <svg class="cw-ic" aria-hidden="true"><use href="assets/icons.svg#i-house"/></svg>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = [
  // navegación y sección
  'house', 'scroll', 'sword', 'trophy', 'backpack', 'info', 'wrench', 'desktop',
  // utilidades globales
  'bell', 'magnifying-glass', 'gear', 'user-circle', 'sign-out', 'key', 'lock-key',
  // controles de ventana
  'minus', 'corners-out', 'x', 'caret-right', 'caret-down', 'dots-six-vertical',
  // edición
  'plus', 'trash', 'copy-simple', 'pencil-simple', 'floppy-disk', 'arrow-counter-clockwise',
  'arrow-clockwise', 'eye', 'eye-slash', 'grid-four', 'stack', 'check', 'magic-wand', 'push-pin',
  // contenido de las ventanas
  'image', 'text-t', 'link', 'sparkle', 'crown', 'discord-logo', 'globe', 'list-bullets',
  'folder', 'folder-open', 'file-text', 'chart-bar', 'users', 'cube', 'arrow-square-out',
  'game-controller', 'cursor',
];

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const pkg = path.resolve(process.argv[2] || 'node_modules/@phosphor-icons/core');
const symbols = ICONS.map((name) => {
  const svg = readFileSync(path.join(pkg, 'assets', 'bold', `${name}-bold.svg`), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').trim();
  return `  <symbol id="i-${name}" viewBox="0 0 256 256">${inner}</symbol>`;
});

const out = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<!-- Generado por tools/build-icons.mjs con Phosphor Icons (MIT), peso bold. No editar a mano. -->',
  '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true">',
  ...symbols,
  '</svg>',
  '',
].join('\n');

mkdirSync(path.join(root, 'assets'), { recursive: true });
writeFileSync(path.join(root, 'assets', 'icons.svg'), out);
console.log(`assets/icons.svg: ${ICONS.length} iconos, ${(out.length / 1024).toFixed(1)} KB`);

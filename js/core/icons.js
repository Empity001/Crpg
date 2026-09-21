// Iconos del sitio: sprite local generado con tools/build-icons.mjs (Phosphor, MIT).
// Uso: element.innerHTML = icon('house');  ->  <svg class="cw-ic"><use href="assets/icons.svg#i-house"/></svg>

const SPRITE = 'assets/icons.svg';

// Iconos que el admin puede elegir a mano en las ventanas de la portada.
export const PICKABLE_ICONS = Object.freeze([
  'house', 'scroll', 'sword', 'trophy', 'backpack', 'info', 'game-controller', 'discord-logo',
  'globe', 'link', 'image', 'sparkle', 'crown', 'users', 'cube', 'chart-bar', 'file-text',
  'folder', 'key', 'push-pin', 'arrow-square-out',
]);

const KNOWN = new Set(PICKABLE_ICONS);

export function icon(name, className = 'cw-ic') {
  const safe = KNOWN.has(name) || /^[a-z][a-z0-9-]{0,30}$/.test(name) ? name : 'link';
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="${SPRITE}#i-${safe}"/></svg>`;
}

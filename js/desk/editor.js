// =========================================================
// desk/editor.js
// =========================================================
// Editor de la portada para el administrador. Solo se carga si hay sesión
// de admin (ver pages/home.js). Trabaja sobre el propio escritorio: arrastrar
// y redimensionar ventanas lo hace el motor; aquí viven la barra de
// herramientas, el panel de propiedades, deshacer/rehacer y guardar.
//
// Nada se guarda hasta pulsar "Guardar". Mientras tanto, todo es un borrador
// local con historial.
// =========================================================

import { icon, PICKABLE_ICONS } from '../core/icons.js';
import { escapeHtml, showToast } from '../core/utils.js';
import {
  CHROMES, LIMITS, TEMPLATES, TYPES, TYPE_KEYS, cleanHref, newWindow, normalizeLayout, normalizeWindow, uid,
} from './layout.js';
import { saveLayout } from './store.js';

const esc = escapeHtml;
const attr = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const clone = (value) => JSON.parse(JSON.stringify(value));
const markInvalid = (el, bad) => { if (bad) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid'); };
const HISTORY_MAX = 60;
const DRAFT_KEY = 'culones_desk_draft_v1';
const ICON_LABELS = {
  house: 'Casa', scroll: 'Pergamino', sword: 'Espada', trophy: 'Trofeo', backpack: 'Mochila', info: 'Información',
  'game-controller': 'Mando', 'discord-logo': 'Discord', globe: 'Mundo', link: 'Enlace', image: 'Imagen',
  sparkle: 'Destello', crown: 'Corona', users: 'Personas', cube: 'Cubo', 'chart-bar': 'Gráfico',
  'file-text': 'Documento', folder: 'Carpeta', key: 'Llave', 'push-pin': 'Chincheta', 'arrow-square-out': 'Salir',
};

export function initEditor({ desk, stage, getSaved, save = saveLayout, canEdit = () => true }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const host = stage.querySelector('.desk-stage');

  let editing = false;
  let saving = false;
  let savedJson = '';
  let history = [];
  let cursor = -1;
  let draft = null;            // { id, props } copia "cruda" de lo que teclea el admin
  let panelOpen = true;
  let snapOn = false;
  let commitTimer = 0;

  // ---------- esqueleto ----------

  const bar = document.createElement('div');
  bar.className = 'dk-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Editor de la portada');
  host.prepend(bar);

  const panel = document.createElement('aside');
  panel.className = 'dk-panel';
  panel.setAttribute('aria-label', 'Propiedades de la ventana');
  panel.hidden = true;
  document.body.append(panel);

  const json = () => JSON.stringify(desk.getLayout());
  const isDirty = () => editing && json() !== savedJson;

  // ---------- historial ----------

  function record() {
    const now = json();
    if (history[cursor] === now) return;
    history = history.slice(0, cursor + 1);
    history.push(now);
    if (history.length > HISTORY_MAX) history.shift();
    cursor = history.length - 1;
    renderBar();
  }

  function restore(index) {
    if (index < 0 || index >= history.length) return;
    cursor = index;
    desk.setLayout(JSON.parse(history[cursor]));
    seedDraft();
    renderPanel();
    renderBar();
  }

  // Si el editor se cierra sin guardar (sesión que caduca, recarga de la página),
  // el borrador queda en sessionStorage y se ofrece recuperarlo al volver a editar.
  function stashDraft() {
    if (!isDirty()) return;
    try { window.sessionStorage.setItem(DRAFT_KEY, json()); } catch { /* sin almacenamiento */ }
  }

  function takeDraft() {
    try {
      const raw = window.sessionStorage.getItem(DRAFT_KEY);
      window.sessionStorage.removeItem(DRAFT_KEY);
      return raw ? normalizeLayout(JSON.parse(raw)) : null;
    } catch { return null; }
  }

  function flushRecord() {
    window.clearTimeout(commitTimer);
    commitTimer = 0;
    record();
  }
  function undo() { flushRecord(); restore(cursor - 1); }
  function redo() { flushRecord(); restore(cursor + 1); }

  function scheduleRecord() {
    window.clearTimeout(commitTimer);
    commitTimer = window.setTimeout(record, 600);
  }

  // ---------- entrar y salir ----------

  function enter() {
    if (editing) return;
    if (!canEdit()) {
      showToast('No se cargó la portada guardada, así que no se puede editar sin pisarla. Recarga la página.', 'error');
      return;
    }
    desk.resetView(getSaved());
    desk.setEditing(true);
    editing = true;
    savedJson = json();
    history = [savedJson];
    cursor = 0;
    panelOpen = true;
    document.body.classList.add('desk-editing');
    const rescued = takeDraft();
    if (rescued && JSON.stringify(rescued) !== savedJson
        && window.confirm('La última vez se cerró el editor con cambios sin guardar. ¿Recuperarlos?')) {
      desk.setLayout(rescued);
      record();
    }
    seedDraft();
    renderBar();
    renderPanel();
  }

  function leave({ force = false } = {}) {
    if (!editing) return;
    if (!force && isDirty() && !window.confirm('Tienes cambios sin guardar. ¿Salir y descartarlos?')) return;
    window.clearTimeout(commitTimer);
    desk.setEditing(false);
    desk.resetView(getSaved());
    editing = false;
    draft = null;
    document.body.classList.remove('desk-editing');
    panel.hidden = true;
    renderBar();
  }

  async function commitSave() {
    if (saving || !editing) return;
    flushRecord();
    const layout = desk.getLayout();
    const sent = JSON.stringify(layout);
    saving = true;
    renderBar();
    try {
      await save(layout);
      // Lo editado mientras la petición estaba en vuelo no se marca como guardado.
      savedJson = sent;
      try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* sin almacenamiento */ }
      showToast('Portada guardada.', 'success');
    } catch (error) {
      console.warn('[Portada] Guardado fallido:', error);
      showToast(error?.message || 'No se pudo guardar la portada.', 'error');
    } finally {
      saving = false;
      renderBar();
    }
  }

  // ---------- acciones sobre ventanas ----------

  function addWindow(type) {
    const list = desk.getLayout().windows;
    const spec = TYPES[type];
    const deskTop = document.getElementById('desk')?.getBoundingClientRect().top ?? 0;
    const y = Math.max(0, Math.round((-deskTop + 80) / 8) * 8);
    const x = Math.min(100 - spec.size.w, 3 + (list.length % 6) * 4);
    const win = newWindow(type, { x, y });
    if (!win || list.length >= LIMITS.windows) {
      showToast(`La portada admite hasta ${LIMITS.windows} ventanas.`, 'error');
      return;
    }
    desk.add(win);
    desk.select(win.id);
    record();
  }

  function removeSelected(id = desk.selectedId) {
    if (!id) return;
    desk.remove(id);
    record();
    renderPanel();
  }

  function duplicateSelected() {
    const win = desk.get(desk.selectedId);
    if (!win) return;
    if (desk.getLayout().windows.length >= LIMITS.windows) {
      showToast(`La portada admite hasta ${LIMITS.windows} ventanas.`, 'error');
      return;
    }
    const copy = normalizeWindow({ ...clone(win), id: uid(), x: Math.min(win.x + 3, 100 - win.w), y: win.y + 24 });
    desk.add(copy);
    desk.select(copy.id);
    record();
  }

  function patchWindow(id, patch, { immediate = false } = {}) {
    const current = desk.get(id);
    if (!current) return;
    const merged = normalizeWindow({ ...current, ...patch });
    // x, y, w y h se limitan entre sí (x + w no puede pasar de 100): se aplican juntos.
    const keys = new Set(Object.keys(patch));
    if (['x', 'y', 'w', 'h'].some((key) => keys.has(key))) ['x', 'y', 'w', 'h'].forEach((key) => keys.add(key));
    const applied = {};
    keys.forEach((key) => { applied[key] = merged[key]; });
    desk.update(id, applied);
    syncGeometryInputs();
    if (immediate) { window.clearTimeout(commitTimer); record(); } else scheduleRecord();
  }

  function seedDraft() {
    const win = desk.get(desk.selectedId);
    draft = win ? { id: win.id, props: clone(win.props) } : null;
  }

  function pushDraftProps() {
    if (!draft) return;
    const current = desk.get(draft.id);
    if (!current) return;
    const merged = normalizeWindow({ ...current, props: draft.props });
    desk.update(draft.id, { props: merged.props });
    scheduleRecord();
  }

  // ---------- barra ----------

  // La estructura de la barra se construye una sola vez por modo; después solo
  // se actualizan los valores que cambian. Reconstruirla cerraba el menú
  // "Añadir ventana" y hacía perder el foco del teclado.
  function buildBar(mode) {
    bar.dataset.mode = mode;
    if (mode === 'idle') {
      bar.className = 'dk-bar';
      bar.innerHTML = `<button type="button" class="dk-btn dk-btn-primary" data-act="enter">${icon('pencil-simple')}<span>Editar portada</span></button>
        <span class="dk-note" data-note></span>`;
      return;
    }
    bar.className = 'dk-bar is-editing';
    bar.innerHTML = `
      <div class="dk-menu-wrap">
        <button type="button" class="dk-btn" data-act="add-menu" aria-controls="dk-add-menu" aria-expanded="false">${icon('plus')}<span>Añadir ventana</span></button>
        <div class="dk-menu" id="dk-add-menu" data-menu hidden>
          ${TYPE_KEYS.map((type) => `<button type="button" data-add="${type}">${icon(TYPES[type].icon)}<span>${esc(TYPES[type].label)}</span></button>`).join('')}
        </div>
      </div>
      <span class="dk-sep" aria-hidden="true"></span>
      <button type="button" class="dk-icon-btn" data-act="undo" aria-label="Deshacer" title="Deshacer (Ctrl+Z)">${icon('arrow-counter-clockwise')}</button>
      <button type="button" class="dk-icon-btn" data-act="redo" aria-label="Rehacer" title="Rehacer (Ctrl+Mayús+Z)">${icon('arrow-clockwise')}</button>
      <button type="button" class="dk-btn dk-btn-ghost" data-act="snap" title="Alinear a una cuadrícula al mover y redimensionar">${icon('grid-four')}<span>Cuadrícula</span></button>
      <div class="dk-menu-wrap">
        <button type="button" class="dk-btn dk-btn-ghost" data-act="tpl-menu" aria-controls="dk-tpl-menu" aria-expanded="false" title="Empezar desde una composición de ejemplo">${icon('magic-wand')}<span>Plantillas</span></button>
        <div class="dk-menu" id="dk-tpl-menu" data-menu-tpl hidden>
          ${TEMPLATES.map((tpl) => `<button type="button" data-tpl="${tpl.id}"><span class="dk-menu-copy"><strong>${esc(tpl.label)}</strong><small>${esc(tpl.hint)}</small></span></button>`).join('')}
        </div>
      </div>
      <button type="button" class="dk-btn dk-btn-ghost" data-act="panel">${icon('stack')}<span>Panel</span></button>
      <span class="dk-grow"></span>
      <span class="dk-note" data-note role="status"></span>
      <button type="button" class="dk-btn dk-btn-ghost" data-act="leave">Salir</button>
      <button type="button" class="dk-btn dk-btn-primary" id="dk-save-btn" data-act="save">${icon('floppy-disk')}<span>Guardar</span></button>`;
  }

  function renderBar() {
    const mode = editing ? 'editing' : 'idle';
    if (bar.dataset.mode !== mode) buildBar(mode);
    const note = bar.querySelector('[data-note]');

    if (mode === 'idle') {
      const enter = bar.querySelector('[data-act="enter"]');
      const blocked = !canEdit();
      enter.disabled = blocked;
      enter.title = '';
      note.textContent = blocked
        ? 'No se cargó la portada guardada: recarga para editar'
        : desk.stacked ? 'Pantalla estrecha: se edita en vista apilada' : 'Modo administrador';
      return;
    }

    const dirty = isDirty();
    bar.querySelector('[data-act="undo"]').disabled = cursor <= 0;
    bar.querySelector('[data-act="redo"]').disabled = cursor >= history.length - 1;
    bar.querySelector('[data-act="snap"]').setAttribute('aria-pressed', String(snapOn));
    bar.querySelector('[data-act="panel"]').setAttribute('aria-pressed', String(panelOpen));
    bar.querySelector('[data-act="save"]').disabled = saving || !dirty;
    note.className = `dk-note${dirty ? ' is-dirty' : ''}`;
    note.textContent = saving ? 'Guardando…' : dirty ? 'Cambios sin guardar' : 'Todo guardado';
  }

  function closeMenu({ returnFocus = false } = {}) {
    let focusTarget = null;
    [['[data-menu]', '[data-act="add-menu"]'], ['[data-menu-tpl]', '[data-act="tpl-menu"]']].forEach(([menuSel, openerSel]) => {
      const menu = bar.querySelector(menuSel);
      const opener = bar.querySelector(openerSel);
      if (!menu || menu.hidden) return;
      menu.hidden = true;
      opener?.setAttribute('aria-expanded', 'false');
      focusTarget = opener;
    });
    if (returnFocus) focusTarget?.focus();
  }

  function applyTemplate(id) {
    const tpl = TEMPLATES.find((item) => item.id === id);
    if (!tpl) return;
    if (desk.getLayout().windows.length && !window.confirm(`Esto sustituye la composición actual por la plantilla "${tpl.label}". Puedes deshacerlo antes de guardar. ¿Seguir?`)) return;
    desk.setLayout(normalizeLayout(tpl.build()));
    seedDraft();
    record();
    renderPanel();
  }

  // Sin arrastre (vista apilada) hay que poder cambiar el orden de otra forma:
  // se intercambian las posiciones con la ventana anterior o posterior.
  function moveSelected(direction) {
    const list = [...desk.getLayout().windows].sort((a, b) => a.y - b.y || a.x - b.x);
    const at = list.findIndex((win) => win.id === desk.selectedId);
    const other = list[at + (direction === 'up' ? -1 : 1)];
    if (at < 0 || !other) return;
    const a = list[at];
    desk.update(a.id, { x: other.x, y: other.y });
    desk.update(other.id, { x: a.x, y: a.y });
    desk.resort();
    record();
    syncGeometryInputs();
  }

  bar.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const menu = bar.querySelector('[data-menu]');
    if (button.dataset.add) {
      addWindow(button.dataset.add);
      closeMenu();
      return;
    }
    if (button.dataset.tpl) {
      applyTemplate(button.dataset.tpl);
      closeMenu();
      return;
    }
    switch (button.dataset.act) {
      case 'enter': enter(); break;
      case 'leave': leave(); break;
      case 'save': void commitSave(); break;
      case 'undo': undo(); break;
      case 'redo': redo(); break;
      case 'snap': snapOn = !snapOn; desk.setSnap(snapOn); renderBar(); break;
      case 'tpl-menu': {
        const tplMenu = bar.querySelector('[data-menu-tpl]');
        if (!tplMenu) break;
        const willOpen = tplMenu.hidden;
        closeMenu();
        tplMenu.hidden = !willOpen;
        button.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) tplMenu.querySelector('button')?.focus();
        break;
      }
      case 'panel':
        panelOpen = !panelOpen;
        renderPanel();
        renderBar();
        // Al abrirlo con el teclado, el foco entra en el panel (está al final del documento).
        if (panelOpen) panel.querySelector('input, button, select, textarea')?.focus();
        break;
      case 'add-menu': {
        if (!menu) break;
        if (menu.hidden) closeMenu();
        menu.hidden = !menu.hidden;
        button.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
        if (!menu.hidden) menu.querySelector('button')?.focus();
        break;
      }
      default: break;
    }
  });
  document.addEventListener('click', (event) => {
    const menu = bar.querySelector('[data-menu]');
    if (!event.target.closest('.dk-menu-wrap')) closeMenu();
  }, { signal });

  // ---------- panel de propiedades ----------

  function fieldHtml(field, props) {
    const id = `dk-f-${field.key}`;
    const value = props[field.key];
    const label = `<label class="dk-label" for="${id}">${esc(field.label)}</label>`;
    const help = field.help ? `<p class="dk-help">${esc(field.help)}</p>` : '';
    if (field.kind === 'textarea') {
      return `<div class="dk-field">${label}<textarea class="dk-input" id="${id}" data-field="${field.key}" rows="7" maxlength="${field.max}">${esc(value ?? '')}</textarea>${help}</div>`;
    }
    if (field.kind === 'number') {
      return `<div class="dk-field">${label}<input class="dk-input" id="${id}" type="number" data-field="${field.key}" min="${field.min}" max="${field.max}" value="${attr(value)}"></div>`;
    }
    if (field.kind === 'links') {
      const rows = Array.isArray(value) ? value : [];
      return `<div class="dk-field"><span class="dk-label">${esc(field.label)}</span>
        <div class="dk-links" data-links="${field.key}" data-max="${field.max}" data-icons="${field.icons ? '1' : ''}">
          ${rows.map((row, index) => linkRowHtml(row, index, !!field.icons)).join('')}
          <button type="button" class="dk-btn dk-btn-ghost dk-add-link" data-link-add ${rows.length >= field.max ? 'disabled' : ''}>${icon('plus')}<span>Añadir enlace</span></button>
        </div></div>`;
    }
    const invalid = field.kind === 'url' && value && !cleanHref(value) ? ' aria-invalid="true"' : '';
    return `<div class="dk-field">${label}<input class="dk-input" id="${id}" type="text" data-field="${field.key}" data-kind="${field.kind}" maxlength="${field.max}" value="${attr(value ?? '')}"${invalid}>${help}</div>`;
  }

  function linkRowHtml(row, index, withIcons) {
    const bad = row.href && !cleanHref(row.href);
    return `<div class="dk-link-row" data-i="${index}">
      <input class="dk-input" data-link="label" value="${attr(row.label ?? '')}" placeholder="Texto" maxlength="${LIMITS.label}" aria-label="Texto del enlace ${index + 1}">
      <input class="dk-input" data-link="href" value="${attr(row.href ?? '')}" placeholder="https://... o logs.html" maxlength="${LIMITS.url}" aria-label="Dirección del enlace ${index + 1}" ${bad ? 'aria-invalid="true"' : ''}>
      ${withIcons ? `<select class="dk-input" data-link="icon" aria-label="Icono del enlace ${index + 1}">${PICKABLE_ICONS.map((name) => `<option value="${name}" ${row.icon === name ? 'selected' : ''}>${esc(ICON_LABELS[name] || name)}</option>`).join('')}</select>` : ''}
      <button type="button" class="dk-icon-btn" data-link-remove aria-label="Quitar enlace ${index + 1}">${icon('trash')}</button>
    </div>`;
  }

  function layersHtml() {
    const list = [...desk.getLayout().windows].sort((a, b) => b.z - a.z);
    if (!list.length) return '<p class="dk-help">La portada está vacía. Usa "Añadir ventana".</p>';
    return `<ul class="dk-layers">${list.map((win) => `<li><button type="button" data-select="${attr(win.id)}">${icon(TYPES[win.type]?.icon || 'cube')}<span>${esc(win.title)}</span><small>${esc(TYPES[win.type]?.label || win.type)}</small></button></li>`).join('')}</ul>`;
  }

  // Al reconstruir el panel el elemento con foco se destruye: se recuerda cuál era
  // (por id o por atributo data-*) y se vuelve a enfocar su equivalente.
  function panelFocusKey() {
    const el = document.activeElement;
    if (!el || !panel.contains(el)) return null;
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const name of ['data-chrome', 'data-order', 'data-act2', 'data-select', 'data-link-add', 'data-panel-close']) {
      if (el.hasAttribute(name)) return `[${name}="${CSS.escape(el.getAttribute(name))}"]`;
    }
    return null;
  }

  function renderPanel() {
    const key = panelFocusKey();
    renderPanelContent();
    if (key) panel.querySelector(key)?.focus();
  }

  function renderPanelContent() {
    if (!editing || !panelOpen) { panel.hidden = true; return; }
    panel.hidden = false;
    const win = desk.get(desk.selectedId);
    if (!win) {
      panel.innerHTML = `<header class="dk-panel-head"><h2>Ventanas</h2></header>
        <div class="dk-panel-body">
          <p class="dk-help">Toca una ventana para editarla. Arrastra su barra para moverla y el borde derecho, inferior o la esquina para cambiar el tamaño.</p>
          ${layersHtml()}
        </div>`;
      return;
    }
    if (!draft || draft.id !== win.id) seedDraft();
    const spec = TYPES[win.type];
    panel.innerHTML = `<header class="dk-panel-head"><h2>${icon(spec.icon)}<span>${esc(spec.label)}</span></h2>
        <button type="button" class="dk-icon-btn" data-panel-close aria-label="Quitar selección">${icon('x')}</button></header>
      <div class="dk-panel-body">
        <div class="dk-field"><label class="dk-label" for="dk-title">Título de la ventana</label>
          <input class="dk-input" id="dk-title" type="text" data-win="title" maxlength="${LIMITS.title}" value="${attr(win.title)}"></div>
        <div class="dk-field dk-chromes" role="group" aria-labelledby="dk-chrome-l"><span class="dk-label" id="dk-chrome-l">Estilo</span>
          ${Object.entries(CHROMES).map(([key, value]) => `<button type="button" class="dk-chrome" data-chrome="${key}" aria-pressed="${win.chrome === key}"><strong>${esc(value.label)}</strong><small>${esc(value.hint)}</small></button>`).join('')}
        </div>
        ${spec.fields.map((field) => fieldHtml(field, draft.props)).join('')}
        <div class="dk-field dk-geo" role="group" aria-labelledby="dk-geo-l"><span class="dk-label" id="dk-geo-l">Posición y tamaño</span>
          <label>X (%)<input class="dk-input" type="number" data-geo="x" step="0.5" min="0" max="100" value="${win.x}"></label>
          <label>Y (px)<input class="dk-input" type="number" data-geo="y" step="8" min="0" max="${LIMITS.maxY}" value="${win.y}"></label>
          <label>Ancho (%)<input class="dk-input" type="number" data-geo="w" step="0.5" min="${LIMITS.minW}" max="${LIMITS.maxW}" value="${win.w}"></label>
          <label>Alto (px)<input class="dk-input" type="number" data-geo="h" step="8" min="${LIMITS.minH}" max="${LIMITS.maxH}" value="${win.h}"></label>
        </div>
        <div class="dk-actions">
          <button type="button" class="dk-btn dk-btn-ghost" data-move="up">Subir</button>
          <button type="button" class="dk-btn dk-btn-ghost" data-move="down">Bajar</button>
          <button type="button" class="dk-btn dk-btn-ghost" data-order="front">Traer al frente</button>
          <button type="button" class="dk-btn dk-btn-ghost" data-order="back">Enviar atrás</button>
          <button type="button" class="dk-btn dk-btn-ghost" data-act2="dup">${icon('copy-simple')}<span>Duplicar</span></button>
          <button type="button" class="dk-btn dk-btn-danger" data-act2="del">${icon('trash')}<span>Eliminar</span></button>
        </div>
      </div>`;
  }

  // Mantiene los números de posición al día sin reconstruir el panel entero.
  function syncGeometryInputs() {
    const win = desk.get(desk.selectedId);
    if (!win || panel.hidden) return;
    panel.querySelectorAll('[data-geo]').forEach((input) => {
      if (document.activeElement !== input) input.value = String(win[input.dataset.geo]);
    });
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target) return;
    const id = desk.selectedId;
    if (target.dataset.select) { desk.select(target.dataset.select); return; }
    if (target.hasAttribute('data-panel-close')) { desk.select(null); return; }
    if (!id) return;
    if (target.dataset.chrome) { patchWindow(id, { chrome: target.dataset.chrome }, { immediate: true }); renderPanel(); return; }
    if (target.dataset.order) { desk.reorder(id, target.dataset.order); return; }
    if (target.dataset.move) { moveSelected(target.dataset.move); return; }
    if (target.dataset.act2 === 'dup') { duplicateSelected(); return; }
    if (target.dataset.act2 === 'del') { removeSelected(); return; }
    const links = target.closest('[data-links]');
    if (links && draft) {
      const key = links.dataset.links;
      const rows = Array.isArray(draft.props[key]) ? draft.props[key] : (draft.props[key] = []);
      if (target.hasAttribute('data-link-add')) {
        rows.push(links.dataset.icons ? { label: '', href: '', icon: 'link' } : { label: '', href: '' });
        renderPanel();
        panel.querySelectorAll(`[data-links="${key}"] .dk-link-row`).item(rows.length - 1)?.querySelector('input')?.focus();
      } else if (target.hasAttribute('data-link-remove')) {
        rows.splice(Number(target.closest('.dk-link-row').dataset.i), 1);
        pushDraftProps();
        renderPanel();
        record();
      }
    }
  });

  panel.addEventListener('input', (event) => {
    const el = event.target;
    const id = desk.selectedId;
    if (!id || !draft) return;
    if (el.dataset.win === 'title') { patchWindow(id, { title: el.value }); return; }
    if (el.dataset.geo) {
      const n = Number(el.value);
      if (Number.isFinite(n)) patchWindow(id, { [el.dataset.geo]: n });
      return;
    }
    if (el.dataset.field) {
      const field = TYPES[desk.get(id).type].fields.find((f) => f.key === el.dataset.field);
      draft.props[el.dataset.field] = field?.kind === 'number' ? Number(el.value) : el.value;
      if (field?.kind === 'url') markInvalid(el, !!el.value && !cleanHref(el.value));
      pushDraftProps();
      return;
    }
    const row = el.closest('.dk-link-row');
    if (row && el.dataset.link) {
      const key = row.closest('[data-links]').dataset.links;
      const item = draft.props[key]?.[Number(row.dataset.i)];
      if (!item) return;
      item[el.dataset.link] = el.value;
      if (el.dataset.link === 'href') markInvalid(el, !!el.value && !cleanHref(el.value));
      pushDraftProps();
    }
  });
  panel.addEventListener('change', () => { window.clearTimeout(commitTimer); record(); });

  // ---------- eventos del motor ----------

  // Estrechar la pantalla ya no cierra el editor ni descarta lo hecho: las ventanas
  // se apilan (sin arrastre) y todo lo demás sigue funcionando.
  const unsubscribe = [
    desk.on('commit', () => { record(); syncGeometryInputs(); }),
    desk.on('select', () => { if (!editing) return; seedDraft(); renderPanel(); }),
    desk.on('mode', ({ stacked }) => {
      if (stacked && editing) showToast('La pantalla es estrecha: las ventanas se ven apiladas y no se pueden mover, pero tus cambios siguen aquí.', 'error');
      renderBar();
    }),
    desk.on('delete-request', ({ id }) => { if (editing) removeSelected(id); }),
  ];

  // ---------- teclado y salida de la página ----------

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu({ returnFocus: true });
    if (!editing) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '');
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.altKey && event.key.toLowerCase() === 'z' && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    } else if (mod && !event.altKey && event.key.toLowerCase() === 'y' && !typing) {
      event.preventDefault();
      redo();
    }
  }, { signal });

  window.addEventListener('beforeunload', (event) => {
    if (!isDirty()) return;
    event.preventDefault();
    event.returnValue = '';
  }, { signal });
  window.addEventListener('pagehide', stashDraft, { signal });

  renderBar();

  return {
    refresh: renderBar,
    dispose() {
      window.clearTimeout(commitTimer);
      if (editing) { stashDraft(); leave({ force: true }); }
      unsubscribe.forEach((off) => off());
      lifetime.abort();
      bar.remove();
      panel.remove();
    },
  };
}

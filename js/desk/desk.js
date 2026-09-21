// =========================================================
// desk/desk.js
// =========================================================
// Motor del escritorio: ventanas que se arrastran, se redimensionan, se
// apilan, se minimizan y se maximizan. No sabe nada de Supabase ni del
// editor: recibe un layout, pinta ventanas y avisa de lo que pasa.
//
//   const desk = createDesk({ root, taskbar, ctx, layout });
//   desk.on('commit', ({ id, kind }) => ...);   // move | resize
//   desk.on('select', ({ id }) => ...);
//   desk.setEditing(true);
//
// En modo libre las ventanas se colocan con x/w en % y y/h en px. Si el
// escritorio es demasiado estrecho (móvil), pasa a modo apilado: una
// columna ordenada por posición, sin arrastre.
// =========================================================

import { icon } from '../core/icons.js';
import { CHROMES, LIMITS, layoutHeight } from './layout.js';
import { renderContent } from './contents.js';

const STACK_BELOW = 760;      // px de ancho del escritorio por debajo de los que se apila
const DRAG_THRESHOLD = 3;     // px antes de considerar que es un arrastre
const GRID_X = 0.5;           // % de la cuadrícula
const GRID_Y = 8;             // px de la cuadrícula

const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const round1 = (n) => Math.round(n * 10) / 10;
const snapTo = (n, step) => Math.round(n / step) * step;
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createDesk({ root, taskbar, ctx, layout }) {
  const listeners = { commit: [], select: [], 'delete-request': [], mode: [] };
  const lifetime = new AbortController();
  const wins = new Map();            // id -> { data, el, body, hidden, collapsed }
  let zTop = 0;
  let editing = false;
  let snap = false;
  let selectedId = null;
  let maximizedId = null;
  let stacked = false;
  let firstPaint = true;

  const scrim = document.createElement('div');
  scrim.className = 'cw-scrim';
  scrim.hidden = true;
  root.after(scrim);

  const emit = (name, payload) => listeners[name].forEach((cb) => cb(payload));

  // ---------- construcción de una ventana ----------

  function buildWindow(data, index) {
    const el = document.createElement('section');
    el.className = 'cw';
    el.dataset.id = data.id;
    el.dataset.type = data.type;
    el.style.setProperty('--i', String(index));
    el.setAttribute('aria-labelledby', `cw-title-${data.id}`);
    el.innerHTML = `
      <header class="cw-bar">
        <div class="cw-dots">
          <button type="button" class="cw-dot cw-dot-close" data-act="close" aria-label="Cerrar ventana">${icon('x', 'cw-ic cw-dot-ic')}</button>
          <button type="button" class="cw-dot cw-dot-min" data-act="min" aria-label="Minimizar ventana">${icon('minus', 'cw-ic cw-dot-ic')}</button>
          <button type="button" class="cw-dot cw-dot-max" data-act="max" aria-label="Maximizar ventana">${icon('corners-out', 'cw-ic cw-dot-ic')}</button>
        </div>
        <h2 class="cw-title" id="cw-title-${data.id}"></h2>
        <span class="cw-bar-deco" aria-hidden="true"></span>
      </header>
      <div class="cw-body"></div>
      <span class="cw-grip cw-grip-e" data-dir="e" aria-hidden="true"></span>
      <span class="cw-grip cw-grip-s" data-dir="s" aria-hidden="true"></span>
      <span class="cw-grip cw-grip-se" data-dir="se" aria-hidden="true"></span>`;
    const entry = { data, el, body: el.querySelector('.cw-body'), hidden: false, collapsed: false };
    wireWindow(entry);
    return entry;
  }

  function applyChrome(entry) {
    entry.el.className = entry.el.className.replace(/\bcw-(retro|glass|hud)\b/g, '').trim();
    entry.el.classList.add(`cw-${CHROMES[entry.data.chrome] ? entry.data.chrome : 'retro'}`);
  }

  function applyGeometry(entry) {
    const { el, data } = entry;
    el.style.left = `${data.x}%`;
    el.style.top = `${data.y}px`;
    el.style.width = `${data.w}%`;
    el.style.height = `${data.h}px`;
    el.style.zIndex = String(data.z);
  }

  function paint(entry) {
    entry.el.querySelector('.cw-title').textContent = entry.data.title;
    applyChrome(entry);
    applyGeometry(entry);
    entry.el.classList.toggle('is-hidden', entry.hidden);
    entry.el.classList.toggle('is-collapsed', entry.collapsed);
    entry.el.classList.toggle('is-selected', entry.data.id === selectedId);
    entry.el.classList.toggle('is-max', entry.data.id === maximizedId);
    entry.el.setAttribute('aria-hidden', entry.hidden ? 'true' : 'false');
    entry.el.inert = entry.hidden;
  }

  function fillContent(entry) {
    try {
      const result = renderContent(entry.data, entry.body, ctx);
      if (result && typeof result.catch === 'function') result.catch((error) => console.warn('[Portada] contenido:', error));
    } catch (error) {
      console.warn('[Portada] contenido:', error);
    }
  }

  // ---------- gestos: arrastrar y redimensionar ----------

  function wireWindow(entry) {
    const { el } = entry;

    el.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (editing) select(entry.data.id);
      else if (!stacked) bringToFront(entry.data.id);
    });

    el.querySelector('.cw-bar').addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || stacked || maximizedId === entry.data.id) return;
      if (event.target.closest('.cw-dot')) return;
      startGesture(event, entry, 'move', event.currentTarget);
    });
    el.querySelector('.cw-bar').addEventListener('dblclick', (event) => {
      if (event.target.closest('.cw-dot') || stacked) return;
      toggleMax(entry.data.id);
    });

    el.querySelectorAll('.cw-grip').forEach((grip) => {
      grip.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !editing || stacked) return;
        event.stopPropagation();
        select(entry.data.id);
        startGesture(event, entry, 'resize', grip, grip.dataset.dir);
      });
    });

    el.querySelectorAll('.cw-dot').forEach((dot) => {
      dot.addEventListener('click', () => {
        const act = dot.dataset.act;
        if (act === 'close') hide(entry.data.id, 'close');
        else if (act === 'min') minimize(entry.data.id);
        else if (act === 'max') toggleMax(entry.data.id);
      });
    });

    el.addEventListener('keydown', (event) => onWindowKey(event, entry));
  }

  function startGesture(event, entry, mode, handle, dir = '') {
    event.preventDefault();
    const deskWidth = root.getBoundingClientRect().width || 1;
    const start = { x: entry.data.x, y: entry.data.y, w: entry.data.w, h: entry.data.h };
    const from = { px: event.clientX, py: event.clientY };
    let moved = false;
    let last = { ...start };
    handle.setPointerCapture(event.pointerId);
    entry.el.classList.add(mode === 'move' ? 'is-dragging' : 'is-resizing');

    const onMove = (e) => {
      const dx = e.clientX - from.px;
      const dy = e.clientY - from.py;
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      moved = true;
      const dxPct = (dx / deskWidth) * 100;
      if (mode === 'move') {
        let x = clamp(start.x + dxPct, 0, 100 - start.w);
        let y = Math.max(0, start.y + dy);
        if (snap && editing) { x = clamp(snapTo(x, GRID_X), 0, 100 - start.w); y = Math.max(0, snapTo(y, GRID_Y)); }
        last = { ...start, x: round1(x), y: Math.round(y) };
        const tx = ((last.x - start.x) / 100) * deskWidth;
        const ty = last.y - start.y;
        entry.el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
      } else {
        let w = start.w;
        let h = start.h;
        if (dir.includes('e')) w = clamp(start.w + dxPct, LIMITS.minW, Math.min(LIMITS.maxW, 100 - start.x));
        if (dir.includes('s')) h = clamp(start.h + dy, LIMITS.minH, LIMITS.maxH);
        if (snap && editing) {
          w = clamp(snapTo(w, GRID_X), LIMITS.minW, 100 - start.x);
          h = clamp(snapTo(h, GRID_Y), LIMITS.minH, LIMITS.maxH);
        }
        last = { ...start, w: round1(w), h: Math.round(h) };
        entry.el.style.width = `${last.w}%`;
        entry.el.style.height = `${last.h}px`;
      }
    };

    const finish = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      if (moved) {
        // Con las transiciones aún desactivadas (is-dragging) se cambia el
        // transform por left/top de golpe; si no, la ventana rebotaría.
        entry.el.style.transform = '';
        Object.assign(entry.data, last);
        applyGeometry(entry);
        void entry.el.offsetWidth;
      }
      entry.el.classList.remove('is-dragging', 'is-resizing');
      if (!moved) return;
      fitHeight();
      emit('commit', { id: entry.data.id, kind: mode === 'move' ? 'move' : 'resize' });
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  function onWindowKey(event, entry) {
    if (!editing || stacked || event.target !== entry.el) return;
    const step = { ArrowLeft: [-GRID_X, 0], ArrowRight: [GRID_X, 0], ArrowUp: [0, -GRID_Y], ArrowDown: [0, GRID_Y] }[event.key];
    if (step) {
      event.preventDefault();
      const d = entry.data;
      if (event.shiftKey) {
        d.w = round1(clamp(d.w + step[0], LIMITS.minW, Math.min(LIMITS.maxW, 100 - d.x)));
        d.h = Math.round(clamp(d.h + step[1], LIMITS.minH, LIMITS.maxH));
      } else {
        d.x = round1(clamp(d.x + step[0], 0, 100 - d.w));
        d.y = Math.round(Math.max(0, d.y + step[1]));
      }
      applyGeometry(entry);
      fitHeight();
      emit('commit', { id: d.id, kind: event.shiftKey ? 'resize' : 'move' });
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      emit('delete-request', { id: entry.data.id });
    } else if (event.key === 'Escape') {
      select(null);
    }
  }

  // ---------- estado de las ventanas ----------

  function bringToFront(id) {
    const entry = wins.get(id);
    if (!entry) return;
    const alreadyOnTop = [...wins.values()].every((w) => w === entry || w.data.z < entry.data.z);
    if (alreadyOnTop) return;
    zTop += 1;
    entry.data.z = zTop;
    entry.el.style.zIndex = String(zTop);
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    wins.forEach((entry) => entry.el.classList.toggle('is-selected', entry.data.id === id));
    emit('select', { id });
  }

  function hide(id, via = 'min') {
    const entry = wins.get(id);
    if (!entry) return;
    if (maximizedId === id) toggleMax(id);
    entry.hidden = true;
    entry.el.dataset.via = via;
    paint(entry);
    renderTaskbar();
  }

  function minimize(id) {
    const entry = wins.get(id);
    if (!entry) return;
    if (stacked) {
      entry.collapsed = !entry.collapsed;
      paint(entry);
      return;
    }
    hide(id, 'min');
  }

  function show(id) {
    const entry = wins.get(id);
    if (!entry) return;
    entry.hidden = false;
    entry.collapsed = false;
    paint(entry);
    if (!editing) bringToFront(id);
    renderTaskbar();
  }

  function toggleMax(id) {
    const entry = wins.get(id);
    if (!entry || stacked) return;
    const next = maximizedId === id ? null : id;
    const prev = maximizedId;
    maximizedId = next;
    if (prev && wins.get(prev)) paint(wins.get(prev));
    if (next) { paint(entry); bringToFront(id); }
    scrim.hidden = !next;
    document.body.classList.toggle('desk-has-max', !!next);
    if (next) entry.el.querySelector('.cw-dot-max')?.focus?.();
  }

  function fitHeight() {
    if (stacked) { root.style.minHeight = ''; return; }
    const extra = editing ? 280 : 90;
    root.style.minHeight = `${Math.max(380, layoutHeight(snapshot()) + extra)}px`;
  }

  function snapshot() {
    return { v: 1, windows: [...wins.values()].map((entry) => clone(entry.data)) };
  }

  // ---------- barra de tareas ----------

  function renderTaskbar() {
    if (!taskbar) return;
    taskbar.hidden = stacked;
    if (stacked) return;
    const list = taskbar.querySelector('[data-taskbar-list]');
    if (!list) return;
    list.innerHTML = '';
    [...wins.values()].sort((a, b) => a.data.z - b.data.z).forEach((entry) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cw-task';
      button.dataset.id = entry.data.id;
      button.setAttribute('aria-pressed', entry.hidden ? 'false' : 'true');
      button.title = entry.hidden ? `Abrir ${entry.data.title}` : `Minimizar ${entry.data.title}`;
      const label = document.createElement('span');
      label.textContent = entry.data.title;
      button.append(label);
      button.addEventListener('click', () => {
        if (entry.hidden) show(entry.data.id);
        else if (editing) select(entry.data.id);
        else minimize(entry.data.id);
      });
      list.append(button);
    });
  }

  // ---------- modo libre / apilado ----------

  function applyMode() {
    const width = root.getBoundingClientRect().width;
    const next = width > 0 && width < STACK_BELOW;
    if (next === stacked && root.classList.contains('is-stacked') === next) return;
    stacked = next;
    root.classList.toggle('is-stacked', stacked);
    if (stacked && maximizedId) toggleMax(maximizedId);
    // En modo apilado no hay barra de tareas para reabrir ventanas: se muestran todas.
    if (stacked) wins.forEach((entry) => { if (entry.hidden) { entry.hidden = false; paint(entry); } });
    const order = [...wins.values()].sort((a, b) => a.data.y - b.data.y || a.data.x - b.data.x);
    order.forEach((entry, index) => { entry.el.style.order = String(index); });
    if (!stacked) wins.forEach((entry) => { entry.el.style.order = ''; });
    fitHeight();
    renderTaskbar();
    emit('mode', { stacked });
  }

  const observer = new ResizeObserver(() => applyMode());

  // ---------- API pública ----------

  function mount(newLayout) {
    root.querySelectorAll('.cw').forEach((node) => node.remove());
    wins.clear();
    zTop = 0;
    const list = clone(newLayout.windows);
    list.forEach((data, index) => {
      zTop = Math.max(zTop, data.z);
      const entry = buildWindow(data, index);
      wins.set(data.id, entry);
      root.append(entry.el);
      paint(entry);
      fillContent(entry);
    });
    if (selectedId && !wins.has(selectedId)) selectedId = null;
    root.classList.toggle('cw-enter', firstPaint && !reduceMotion());
    firstPaint = false;
    window.setTimeout(() => root.classList.remove('cw-enter'), 1400);
    applyMode();
    fitHeight();
    renderTaskbar();
  }

  const api = {
    on(name, callback) { listeners[name]?.push(callback); },
    getLayout: snapshot,
    setLayout(newLayout) { mount(newLayout); },
    has: (id) => wins.has(id),
    get(id) { return wins.get(id) ? clone(wins.get(id).data) : null; },
    get selectedId() { return selectedId; },
    get stacked() { return stacked; },
    get editing() { return editing; },
    select,

    setEditing(value) {
      editing = !!value;
      root.classList.toggle('is-editing', editing);
      wins.forEach((entry) => { entry.el.tabIndex = editing ? 0 : -1; if (!editing) entry.el.removeAttribute('tabindex'); });
      if (!editing) select(null);
      fitHeight();
    },
    setSnap(value) { snap = !!value; root.classList.toggle('has-snap', snap); },

    update(id, patch) {
      const entry = wins.get(id);
      if (!entry) return;
      const contentChanged = 'props' in patch || 'type' in patch;
      Object.assign(entry.data, patch);
      paint(entry);
      if (contentChanged) fillContent(entry);
      fitHeight();
      renderTaskbar();
    },

    add(data) {
      zTop += 1;
      data.z = zTop;
      const entry = buildWindow(data, wins.size);
      wins.set(data.id, entry);
      root.append(entry.el);
      paint(entry);
      fillContent(entry);
      fitHeight();
      applyMode();
      renderTaskbar();
      return clone(data);
    },

    remove(id) {
      const entry = wins.get(id);
      if (!entry) return;
      if (maximizedId === id) toggleMax(id);
      entry.el.remove();
      wins.delete(id);
      if (selectedId === id) select(null);
      fitHeight();
      renderTaskbar();
    },

    reorder(id, where) {
      const entry = wins.get(id);
      if (!entry) return;
      const sorted = [...wins.values()].sort((a, b) => a.data.z - b.data.z);
      const at = sorted.indexOf(entry);
      sorted.splice(at, 1);
      const to = { front: sorted.length, back: 0, up: Math.min(sorted.length, at + 1), down: Math.max(0, at - 1) }[where];
      sorted.splice(to ?? at, 0, entry);
      sorted.forEach((w, index) => { w.data.z = index + 1; w.el.style.zIndex = String(index + 1); });
      zTop = sorted.length;
      renderTaskbar();
      emit('commit', { id, kind: 'order' });
    },

    /** Vuelve a mostrar todas las ventanas y a la posición del layout (para "Ordenar"). */
    resetView(newLayout) {
      wins.forEach((entry) => { entry.hidden = false; entry.collapsed = false; });
      maximizedId = null;
      scrim.hidden = true;
      document.body.classList.remove('desk-has-max');
      mount(newLayout);
    },

    destroy() {
      lifetime.abort();
      observer.disconnect();
      scrim.remove();
      root.querySelectorAll('.cw').forEach((node) => node.remove());
      document.body.classList.remove('desk-has-max');
    },
  };

  scrim.addEventListener('click', () => { if (maximizedId) toggleMax(maximizedId); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && maximizedId) toggleMax(maximizedId);
  }, { signal: lifetime.signal });
  // En modo edición un clic en un enlace no debe sacar al admin de la página.
  root.addEventListener('click', (event) => {
    if (editing && event.target.closest('.cw-body a')) event.preventDefault();
  }, true);
  root.addEventListener('pointerdown', (event) => {
    if (editing && event.target === root) select(null);
  });

  observer.observe(root);
  mount(layout);
  return api;
}

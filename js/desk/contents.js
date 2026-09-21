// =========================================================
// desk/contents.js
// =========================================================
// Qué se pinta dentro de cada tipo de ventana. Los tipos con datos
// (logs, armas, números) leen solo tablas y funciones públicas.
// =========================================================

import { escapeHtml } from '../core/utils.js';
import { icon } from '../core/icons.js';
import { cleanHref, TYPES } from './layout.js';

const esc = escapeHtml;

async function copyText(value) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('sin Clipboard API');
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(input);
    input.select();
    let copied = false;
    try { copied = document.execCommand?.('copy') === true; } catch { copied = false; }
    input.remove();
    return copied;
  }
}
const attr = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const isExternal = (href) => /^https?:\/\//i.test(href);

// ---------- texto enriquecido (negrita y enlaces, nada más) ----------

function inline(text) {
  let html = esc(text);
  html = html.replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\[([^\]\n]{1,80})\]\(([^)\s]{1,600})\)/g, (match, label, url) => {
    const href = cleanHref(url.replace(/&amp;/g, '&'));
    if (!href) return match;
    const ext = isExternal(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a href="${attr(href)}"${ext}>${label}</a>`;
  });
  return html.replace(/\n/g, '<br>');
}

export function richText(raw) {
  return String(raw ?? '')
    .replace(/\r/g, '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${inline(part)}</p>`)
    .join('');
}

// ---------- datos públicos con caché por carga de página ----------

export function createDataSource(supabase) {
  const cache = new Map();
  const once = (key, load) => {
    if (!cache.has(key)) {
      cache.set(key, Promise.resolve().then(load).catch((error) => { cache.delete(key); throw error; }));
    }
    return cache.get(key);
  };
  const rows = (result) => {
    if (result.error) throw result.error;
    return result.data || [];
  };
  return {
    logs: () => once('logs', async () => rows(await supabase.rpc('list_public_logs_with_counts'))),
    categories: () => once('categories', async () => rows(await supabase.from('categories').select('slug,label,color'))),
    weapons: () => once('weapons', async () => rows(await supabase
      .from('weapons').select('id,name,image_url,updated_at')
      .eq('published', true).order('updated_at', { ascending: false }).limit(24))),
    counts: () => once('counts', async () => {
      const head = { count: 'exact', head: true };
      const [logs, weapons, kits] = await Promise.all([
        supabase.from('logs').select('id', head),
        supabase.from('weapons').select('id', head).eq('published', true),
        supabase.from('kits').select('id', head),
      ]);
      const fail = [logs, weapons, kits].find((r) => r.error);
      if (fail) throw fail.error;
      return { logs: logs.count ?? 0, weapons: weapons.count ?? 0, kits: kits.count ?? 0 };
    }),
    clear: () => cache.clear(),
  };
}

// ---------- piezas comunes ----------

const skeleton = (rows = 3) => `<div class="cw-skel" aria-hidden="true">${'<span></span>'.repeat(rows)}</div>`;

function emptyState(message, admin, hint) {
  return `<div class="cw-empty"><p>${esc(message)}</p>${admin && hint ? `<p class="cw-empty-admin">${hint}</p>` : ''}</div>`;
}

function errorState(body, retry) {
  body.innerHTML = `<div class="cw-empty cw-empty-error" role="alert">
    <p>No pude cargar esto ahora mismo.</p>
    <button type="button" class="cw-btn cw-btn-ghost" data-retry>Reintentar</button>
  </div>`;
  body.querySelector('[data-retry]')?.addEventListener('click', retry);
}

const shortDate = (iso) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es', { day: 'numeric', month: 'short' });
};

// ---------- renderizadores por tipo ----------
// Cada uno recibe (window, body, ctx) y rellena el body. Pueden ser async.

const RENDER = {
  bienvenida(win, body) {
    const p = win.props;
    const buttons = (p.buttons || []).map((b, i) =>
      `<a class="cw-btn${i ? ' cw-btn-ghost' : ''}" href="${attr(b.href)}"${isExternal(b.href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>${esc(b.label)}</a>`).join('');
    body.innerHTML = `<div class="cw-hero">
      ${p.heading ? `<h3 class="cw-hero-title">${esc(p.heading)}</h3>` : ''}
      <div class="cw-prose">${richText(p.text)}</div>
      ${buttons ? `<div class="cw-actions">${buttons}</div>` : ''}
    </div>`;
  },

  texto(win, body) {
    body.innerHTML = `<div class="cw-prose">${richText(win.props.text)}</div>`;
  },

  enlaces(win, body) {
    const items = win.props.items || [];
    if (!items.length) { body.innerHTML = emptyState('Esta lista está vacía.', false); return; }
    body.innerHTML = `<ul class="cw-tree">${items.map((it) => `<li>
      <a href="${attr(it.href)}"${isExternal(it.href) ? ' target="_blank" rel="noopener noreferrer"' : ''}>
        <span class="cw-tree-ic">${icon(it.icon || 'link')}</span>
        <span class="cw-tree-label">${esc(it.label)}</span>
        ${icon('caret-right', 'cw-ic cw-tree-go')}
      </a></li>`).join('')}</ul>`;
  },

  ip(win, body, ctx) {
    const { address, note } = win.props;
    if (!address) {
      body.innerHTML = emptyState('Todavía no puse la dirección del server. Cuando la tenga, sale aquí.', ctx.admin,
        'Edítala en el modo edición de la portada.');
      return;
    }
    body.innerHTML = `<div class="cw-ip">
      <code class="cw-ip-address" id="cw-ip-${attr(win.id)}">${esc(address)}</code>
      <button type="button" class="cw-btn" data-copy>${icon('copy-simple')}<span>Copiar</span></button>
    </div>${note ? `<p class="cw-muted">${esc(note)}</p>` : ''}`;
    const btn = body.querySelector('[data-copy]');
    btn?.addEventListener('click', async () => {
      const ok = await copyText(address);
      const label = btn.querySelector('span');
      if (!label) return;
      label.textContent = ok ? '¡Copiado!' : 'No se pudo';
      window.setTimeout(() => { label.textContent = 'Copiar'; }, 1600);
    });
  },

  imagen(win, body, ctx) {
    const { src, alt, caption } = win.props;
    if (!src) {
      body.innerHTML = emptyState('Aquí va una imagen.', ctx.admin, 'Pega su URL en el modo edición.');
      return;
    }
    body.innerHTML = `<figure class="cw-figure">
      <img src="${attr(src)}" alt="${attr(alt)}" loading="lazy" decoding="async">
      ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ''}
    </figure>`;
    body.querySelector('img')?.addEventListener('error', () => {
      body.innerHTML = emptyState('No se pudo cargar la imagen.', false);
    }, { once: true });
  },

  async logs(win, body, ctx) {
    body.innerHTML = skeleton(4);
    try {
      const [logs, categories] = await Promise.all([ctx.data.logs(), ctx.data.categories().catch(() => [])]);
      if (!body.isConnected) return;
      const label = new Map(categories.map((c) => [c.slug, c.label]));
      const list = [...logs].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, win.props.limit || 5);
      if (!list.length) {
        body.innerHTML = emptyState('Aquí van a salir los logs del server. Todavía no he publicado ninguno, dame chance ;3', ctx.admin,
          'Crea el primero desde <a href="logs.html">Logs</a>.');
        return;
      }
      body.innerHTML = `<ul class="cw-feed">${list.map((log) => `<li>
        <a href="logs.html?log=${encodeURIComponent(log.id)}">
          <span class="cw-feed-title">${esc(log.title)}</span>
          <span class="cw-feed-meta"><span class="cw-chip">${esc(label.get(log.category) || log.category)}</span><time datetime="${attr(log.created_at)}">${esc(shortDate(log.created_at))}</time></span>
        </a></li>`).join('')}</ul>`;
    } catch (error) {
      console.warn('[Portada] logs:', error);
      if (body.isConnected) errorState(body, () => { ctx.data.clear(); RENDER.logs(win, body, ctx); });
    }
  },

  async armas(win, body, ctx) {
    body.innerHTML = skeleton(4);
    try {
      const weapons = (await ctx.data.weapons()).slice(0, win.props.limit || 6);
      if (!body.isConnected) return;
      if (!weapons.length) {
        body.innerHTML = emptyState('Las guías de armas llegan pronto. Estoy pasando todo a limpio, cero drama.', ctx.admin,
          'Publica la primera desde <a href="guides.html">Guías</a>.');
        return;
      }
      body.innerHTML = `<ul class="cw-grid">${weapons.map((w) => `<li>
        <a href="guides.html?weapon=${encodeURIComponent(w.id)}">
          <span class="cw-thumb">${w.image_url ? `<img src="${attr(w.image_url)}" alt="" loading="lazy" decoding="async">` : icon('sword')}</span>
          <span class="cw-grid-name">${esc(w.name)}</span>
        </a></li>`).join('')}</ul>`;
    } catch (error) {
      console.warn('[Portada] armas:', error);
      if (body.isConnected) errorState(body, () => { ctx.data.clear(); RENDER.armas(win, body, ctx); });
    }
  },

  async estadisticas(win, body, ctx) {
    body.innerHTML = skeleton(3);
    try {
      const c = await ctx.data.counts();
      if (!body.isConnected) return;
      const stat = (n, label) => `<div class="cw-stat"><strong>${n.toLocaleString('es')}</strong><span>${label}</span></div>`;
      body.innerHTML = `<div class="cw-stats">${stat(c.logs, 'Logs')}${stat(c.weapons, 'Armas')}${stat(c.kits, 'Kits')}</div>`;
    } catch (error) {
      console.warn('[Portada] números:', error);
      if (body.isConnected) errorState(body, () => { ctx.data.clear(); RENDER.estadisticas(win, body, ctx); });
    }
  },
};

export function renderContent(win, body, ctx) {
  const render = RENDER[win.type];
  if (!render || !TYPES[win.type]) {
    body.innerHTML = emptyState('Este tipo de ventana ya no existe.', false);
    return undefined;
  }
  return render(win, body, ctx);
}

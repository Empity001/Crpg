import { supabaseClient } from './api.js';
import { renderPageDocument, refreshVisibility } from './builder-schema.js';
import { NETWORK_PUBLIC_FUNCTION } from '../config.js';

let site = null;
let page = null;
let pages = [];
let collections = [];
let renderedBreakpoint = 'desktop';
let resizeFrame = null;
let searchTimer = null;

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : fallback;
}

function safeCssNumber(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function breakpoint() {
  if (window.matchMedia('(max-width: 680px)').matches) return 'mobile';
  if (window.matchMedia('(max-width: 980px)').matches) return 'tablet';
  return 'desktop';
}

function safeNavigationUrl(value) {
  const raw = String(value || '#').trim();
  if (raw.startsWith('//')) return '#';
  try {
    const parsed = new URL(raw, window.location.href);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '#';
  } catch { return '#'; }
}

function pageUrl(targetPage) {
  return `site.html?site=${encodeURIComponent(site.slug)}&page=${encodeURIComponent(targetPage.slug)}`;
}

function setVar(name, value) {
  document.documentElement.style.setProperty(name, value);
  document.getElementById('instance-builder-content')?.style.setProperty(name, value);
}

export function applyTheme(config = {}) {
  const palette = config?.palette || {};
  const typography = config?.typography || {};
  const density = config?.density || {};
  const motion = config?.motion || {};
  const colors = {
    '--site-bg': safeHex(palette.background, '#050505'),
    '--site-surface': safeHex(palette.surface, '#101010'),
    '--site-elevated': safeHex(palette.elevated, '#171717'),
    '--site-text': safeHex(palette.text, '#ffffff'),
    '--site-muted': safeHex(palette.muted, '#a3a3a3'),
    '--site-accent': safeHex(palette.accent, '#ffffff'),
    '--site-secondary': safeHex(palette.secondary, '#d4d4d4'),
    '--site-border': safeHex(palette.border, '#303030'),
    '--site-selection': safeHex(palette.selection, '#ffffff'),
    '--site-success': safeHex(palette.success, '#2fd18a'),
    '--site-info': safeHex(palette.info, '#38bdf8'),
    '--site-warning': safeHex(palette.warning, '#f6c453'),
    '--site-event': safeHex(palette.event, '#f472b6'),
    '--site-danger': safeHex(palette.danger, '#ef4444'),
    '--site-disabled': safeHex(palette.disabled, '#525252'),
  };
  Object.entries(colors).forEach(([name, value]) => setVar(name, value));
  setVar('--site-font-body', String(typography.body || 'Inter, system-ui, sans-serif').slice(0, 180));
  setVar('--site-font-heading', String(typography.heading || 'Inter, system-ui, sans-serif').slice(0, 180));
  setVar('--site-font-mono', String(typography.mono || 'ui-monospace, monospace').slice(0, 180));
  setVar('--site-type-scale', String(safeCssNumber(typography.scale, 1, 0.75, 1.5)));
  setVar('--site-line-height', String(safeCssNumber(typography.lineHeight, 1.5, 1.1, 2)));
  setVar('--site-space-scale', String(safeCssNumber(density.spacing, 1, 0.5, 2)));
  setVar('--site-radius', `${safeCssNumber(density.radius, 16, 0, 48)}px`);
  setVar('--site-border-width', `${safeCssNumber(density.borderWidth, 1, 0, 6)}px`);
  setVar('--site-motion-duration', `${motion.enabled === false ? 0 : safeCssNumber(motion.duration, 220, 0, 1200)}ms`);
  document.body.style.background = colors['--site-bg'];
  document.body.style.color = colors['--site-text'];
  if (config.assets?.background) {
    document.body.style.backgroundImage = `linear-gradient(rgba(0,0,0,.35), rgba(0,0,0,.35)), url("${String(config.assets.background).replace(/["\\]/g, '')}")`;
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
  } else {
    document.body.style.backgroundImage = '';
  }

  document.getElementById('instance-custom-theme')?.remove();
  if (config.customCss) {
    const style = document.createElement('style');
    style.id = 'instance-custom-theme';
    style.textContent = String(config.customCss).slice(0, 30000);
    document.head.append(style);
  }
  const favicon = config.assets?.favicon;
  if (favicon) document.querySelector('link[rel="icon"]')?.setAttribute('href', favicon);
}

function navigationItems(config) {
  const configured = Array.isArray(config.items)
    ? config.items.filter(item => item.visible !== false && !item.requiredRole)
    : [];
  if (configured.length) return configured.map(item => {
    const linkedPage = item.pageId ? pages.find(candidate => candidate.id === item.pageId) : null;
    return { ...item, url: linkedPage ? pageUrl(linkedPage) : item.url };
  });
  return pages.map(item => ({ key: item.slug, label: item.name, url: pageUrl(item), pageId: item.id }));
}

export function applyNavigation(config = {}) {
  const nav = document.getElementById('instance-nav');
  const header = document.getElementById('instance-header');
  const anchor = document.getElementById('instance-nav-anchor');
  const main = document.getElementById('instance-main');
  const content = document.getElementById('instance-builder-content');
  const toggle = document.getElementById('instance-nav-toggle');
  if (!nav || !header || !anchor || !main || !content || !toggle) return;
  const current = config[breakpoint()] || {};
  const position = current.visible === false ? 'hidden' : (current.position || 'top');
  header.dataset.navPosition = position;
  document.body.dataset.navPosition = position;
  document.body.classList.remove('instance-nav-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.classList.toggle('hidden', position !== 'drawer');
  nav.classList.toggle('hidden', position === 'hidden');
  nav.classList.toggle('is-hero', position === 'hero');
  nav.classList.toggle('is-sticky', current.sticky === true);
  nav.dataset.alignment = current.alignment || 'center';
  nav.dataset.overflow = current.overflow || 'scroll';
  const searchButton = document.getElementById('instance-search-button');
  const searchAnchor = document.getElementById('instance-search-anchor');
  if (searchButton && searchAnchor && nav.contains(searchButton)) searchAnchor.insertAdjacentElement('afterend', searchButton);
  if (position === 'hero') main.insertBefore(nav, content);
  else anchor.insertAdjacentElement('afterend', nav);
  nav.replaceChildren();
  for (const item of navigationItems(config)) {
    const wrapper = item.children?.length ? document.createElement('span') : null;
    if (wrapper) wrapper.className = 'instance-nav-group';
    const link = document.createElement('a');
    link.textContent = `${item.icon ? `${item.icon} ` : ''}${item.label || item.key || 'Página'}`;
    link.href = safeNavigationUrl(item.url);
    link.classList.toggle('is-active', item.pageId === page?.id || (!item.pageId && new URL(link.href).href === location.href));
    if (wrapper) {
      wrapper.append(link);
      const submenu = document.createElement('span'); submenu.className = 'instance-submenu';
      for (const child of item.children) {
        const childLink = document.createElement('a'); childLink.href = safeNavigationUrl(child.url); childLink.textContent = `${child.icon ? `${child.icon} ` : ''}${child.label}`; submenu.append(childLink);
      }
      wrapper.append(submenu); nav.append(wrapper);
    } else nav.append(link);
  }
}

export function applySearch(config = {}) {
  const button = document.getElementById('instance-search-button');
  const input = document.getElementById('instance-search-input');
  const anchor = document.getElementById('instance-search-anchor');
  const nav = document.getElementById('instance-nav');
  const main = document.getElementById('instance-main');
  const content = document.getElementById('instance-builder-content');
  const responsive = config.breakpoints?.[breakpoint()] || {};
  const responsivePosition = responsive.position && responsive.position !== 'inherit' ? responsive.position : null;
  const enabled = config.enabled !== false && responsive.visible !== false && responsivePosition !== 'hidden' && config.position !== 'hidden';
  let position = enabled ? (responsivePosition || config.position || 'header') : 'hidden';
  if (position === 'navigation' && document.body.dataset.navPosition === 'hidden') position = 'header';
  if (!button || !anchor || !nav || !main || !content) return;
  document.body.dataset.searchPosition = position;
  button.dataset.searchPosition = position;
  button.classList.toggle('hidden', !enabled);
  if (position === 'navigation') nav.append(button);
  else if (position === 'hero') main.insertBefore(button, content);
  else if (position === 'block') main.append(button);
  else anchor.insertAdjacentElement('afterend', button);
  if (input) input.placeholder = String(config.placeholder || 'Buscar…');
}

function showFailure(message) {
  document.getElementById('instance-name').textContent = 'Instancia no disponible';
  document.getElementById('instance-description').textContent = message;
}

function recordCard(record, block) {
  const data = record.data || {};
  const article = document.createElement('article'); article.className = 'empi-record-card';
  const imageValue = data[block.dataset.imageField];
  if (imageValue) { const image = document.createElement('img'); image.src = String(imageValue); image.alt = ''; image.loading = 'lazy'; article.append(image); }
  const title = document.createElement('h3'); title.textContent = String(data[block.dataset.titleField] ?? record.slug ?? 'Contenido'); article.append(title);
  const summaryValue = data[block.dataset.summaryField];
  if (summaryValue) { const summary = document.createElement('p'); summary.textContent = String(summaryValue); article.append(summary); }
  return article;
}

async function hydrateCollection(block) {
  const collectionId = block.dataset.collectionId;
  if (!collectionId) { block.textContent = 'Esta vista todavía no está conectada a una colección.'; return; }
  const limit = Math.max(1, Math.min(100, Number(block.dataset.pageSize) || 12));
  const { data, error } = await supabaseClient.from('site_collection_records').select('id,slug,data,published_at')
    .eq('site_id', site.id).eq('collection_id', collectionId).eq('status', 'published')
    .order('published_at', { ascending: false }).limit(limit);
  block.replaceChildren();
  if (error) { const message = document.createElement('p'); message.textContent = 'No se pudo cargar esta colección.'; block.append(message); return; }
  if (!data?.length) { const empty = document.createElement('p'); empty.textContent = block.dataset.emptyText || 'No hay contenido todavía.'; block.append(empty); return; }
  if (block.dataset.view === 'table') {
    const table = document.createElement('table'); const body = document.createElement('tbody');
    for (const record of data) { const row = document.createElement('tr'); Object.values(record.data || {}).slice(0, 8).forEach(value => { const cell = document.createElement('td'); cell.textContent = Array.isArray(value) ? value.join(', ') : String(value ?? ''); row.append(cell); }); body.append(row); }
    table.append(body); block.append(table); return;
  }
  for (const record of data) block.append(recordCard(record, block));
}

async function hydrateForm(form) {
  const collectionId = form.dataset.collectionId;
  form.replaceChildren();
  if (!collectionId) { const message = document.createElement('p'); message.textContent = 'Formulario sin colección configurada.'; form.append(message); return; }
  const [collectionResult, fieldsResult] = await Promise.all([
    supabaseClient.from('site_collections').select('id,settings').eq('site_id', site.id).eq('id', collectionId).maybeSingle(),
    supabaseClient.from('site_collection_fields').select('*').eq('site_id', site.id).eq('collection_id', collectionId).order('position'),
  ]);
  const fields = fieldsResult.data || [];
  if (collectionResult.error || fieldsResult.error || !fields.length || collectionResult.data?.settings?.allowPublicSubmissions !== true) {
    const message = document.createElement('p'); message.textContent = 'Este formulario todavía no está aceptando respuestas.'; form.append(message); return;
  }
  const supported = new Set(['text','long_text','rich_text','number','boolean','date','datetime','select','multi_select','url','email','color','minecraft_uuid','discord_id']);
  if (fields.some(field => field.required && !supported.has(field.field_type))) {
    const message = document.createElement('p'); message.textContent = 'Este formulario tiene un campo obligatorio que no admite entrada pública.'; form.append(message); return;
  }
  for (const field of fields) {
    if (!supported.has(field.field_type)) continue;
    const label = document.createElement('label'); const caption = document.createElement('span'); caption.textContent = field.display_name;
    let input;
    if (field.field_type === 'long_text' || field.field_type === 'rich_text') input = document.createElement('textarea');
    else if (field.field_type === 'select' || field.field_type === 'multi_select') {
      input = document.createElement('select'); input.multiple = field.field_type === 'multi_select';
      if (!input.multiple) { const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Selecciona…'; input.append(empty); }
      for (const raw of Array.isArray(field.settings?.options) ? field.settings.options : []) {
        const option = document.createElement('option');
        option.value = String(typeof raw === 'object' && raw ? raw.value ?? '' : raw);
        option.textContent = String(typeof raw === 'object' && raw ? raw.label ?? raw.value ?? '' : raw);
        input.append(option);
      }
    } else input = document.createElement('input');
    input.name = field.field_key; input.required = field.required;
    if (input instanceof HTMLInputElement) {
      const types = { number: 'number', email: 'email', url: 'url', date: 'date', datetime: 'datetime-local', boolean: 'checkbox', color: 'color' };
      input.type = types[field.field_type] || 'text';
      if (field.field_type === 'discord_id') input.inputMode = 'numeric';
    }
    label.append(caption, input); form.append(label);
  }
  const trap = document.createElement('label'); trap.className = 'empi-honeypot'; trap.setAttribute('aria-hidden', 'true');
  const trapInput = document.createElement('input'); trapInput.name = 'website'; trapInput.tabIndex = -1; trapInput.autocomplete = 'off'; trap.append(trapInput); form.append(trap);
  const button = document.createElement('button'); button.type = 'submit'; button.textContent = form.dataset.submitLabel || 'Enviar';
  const status = document.createElement('small'); status.className = 'empi-form-status'; status.setAttribute('role', 'status');
  form.append(button, status);
  let startedAt = Date.now();
  let requestId = crypto.randomUUID();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const payload = {};
    for (const field of fields.filter(item => supported.has(item.field_type))) {
      const input = form.elements.namedItem(field.field_key);
      if (input instanceof HTMLInputElement && input.type === 'checkbox') payload[field.field_key] = input.checked;
      else if (input instanceof HTMLSelectElement && input.multiple) payload[field.field_key] = [...input.selectedOptions].map(option => option.value);
      else payload[field.field_key] = input?.value ?? '';
    }
    button.disabled = true; status.className = 'empi-form-status'; status.textContent = 'Enviando…';
    try {
      const { data, error } = await supabaseClient.functions.invoke(NETWORK_PUBLIC_FUNCTION, {
        body: {
          site_id: site.id, collection_id: collectionId, request_id: requestId,
          started_at: startedAt, website: trapInput.value, data: payload,
        },
      });
      if (error || data?.error) {
        let remote = data;
        if (!remote && error?.context && typeof error.context.clone === 'function') {
          try { remote = await error.context.clone().json(); } catch { /* respuesta no JSON */ }
        }
        throw new Error(remote?.error?.message || remote?.message || error?.message || 'No se pudo enviar el formulario.');
      }
      form.reset(); startedAt = Date.now(); requestId = crypto.randomUUID();
      status.className = 'empi-form-status is-success'; status.textContent = form.dataset.successMessage || 'Enviado correctamente.';
    } catch (error) {
      status.className = 'empi-form-status is-error'; status.textContent = error.message || 'No se pudo enviar el formulario.';
    } finally { button.disabled = false; }
  });
}

async function hydrateDynamicBlocks() {
  const content = document.getElementById('instance-builder-content');
  await Promise.allSettled([
    ...[...content.querySelectorAll('.empi-collection-view')].map(hydrateCollection),
    ...[...content.querySelectorAll('.empi-generated-form')].map(hydrateForm),
  ]);
  content.querySelectorAll('[data-action="open-search"]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault(); openSearch();
  }));
  content.querySelectorAll('.empi-inline-search').forEach(form => form.addEventListener('submit', event => {
    event.preventDefault(); const input = form.querySelector('input'); openSearch(); const global = document.getElementById('instance-search-input'); global.value = input.value; void runSearch(input.value);
  }));
}

function renderSearchResults(results, query) {
  const container = document.getElementById('instance-search-results'); container.replaceChildren();
  container.dataset.renderer = site?.search_config?.renderer || 'default';
  if (!results.length) { const empty = document.createElement('p'); empty.textContent = `No encontramos “${query}” en esta instancia.`; container.append(empty); return; }
  for (const result of results) {
    const link = document.createElement('a'); link.href = result.url; link.className = 'instance-search-result';
    const title = document.createElement('strong'); title.textContent = result.title;
    const meta = document.createElement('small'); meta.textContent = result.type;
    const summary = document.createElement('span'); summary.textContent = result.summary;
    link.append(title, meta, summary); container.append(link);
  }
}

async function runSearch(rawQuery) {
  const query = String(rawQuery || '').trim();
  const container = document.getElementById('instance-search-results');
  if (query.length < 2) {
    container.replaceChildren();
    const hint = document.createElement('p'); hint.textContent = 'Escribe al menos dos caracteres.'; container.append(hint);
    return;
  }
  const normalized = query.toLocaleLowerCase('es');
  const synonym = (site.search_config?.synonyms || []).find(row => String(row.term || '').toLocaleLowerCase('es') === normalized);
  const terms = [query, ...(synonym?.alternatives || [])].map(value => String(value).replace(/[^\p{L}\p{N}\s-]/gu, '').trim()).filter(Boolean).slice(0, 8);
  const sources = new Set((site.search_config?.sources || []).map(String));
  const includeAll = !sources.size || sources.has('site') || sources.has('*');
  const includePages = includeAll || sources.has('pages') || sources.has('page');
  const pageResults = includePages ? pages.map(item => {
    const title = `${item.name} ${item.title}`.toLocaleLowerCase('es');
    const description = String(item.description || '').toLocaleLowerCase('es');
    const score = terms.reduce((total, term) => {
      const lowered = term.toLocaleLowerCase('es');
      return total + (title.includes(lowered) ? Number(site.search_config?.weights?.title || 10) : 0)
        + (description.includes(lowered) ? Number(site.search_config?.weights?.description || 3) : 0);
    }, 0);
    return { type: 'Página', title: item.title, summary: item.description || `Abrir ${item.name}`, url: pageUrl(item), score };
  }).filter(item => item.score > 0) : [];
  const allowedCollections = collections.filter(item => includeAll || sources.has(item.id) || sources.has(item.collection_key));
  let recordQuery = supabaseClient.from('site_collection_records').select('id,slug,data,collection_id')
    .eq('site_id', site.id).eq('status', 'published');
  if (!includeAll && allowedCollections.length) recordQuery = recordQuery.in('collection_id', allowedCollections.map(item => item.id));
  if (!includeAll && !allowedCollections.length) recordQuery = recordQuery.in('collection_id', ['00000000-0000-0000-0000-000000000000']);
  if (terms.length) recordQuery = recordQuery.or(terms.map(term => `search_text.ilike.%${term.replace(/[%_,()]/g, '')}%`).join(','));
  const { data: records } = await recordQuery.limit(80);
  const recordResults = (records || []).map(record => {
    const values = Object.values(record.data || {}).filter(value => typeof value === 'string');
    const collection = collections.find(item => item.id === record.collection_id);
    const score = Object.entries(record.data || {}).reduce((total, [field, value]) => {
      const haystack = String(value || '').toLocaleLowerCase('es');
      const weight = Number(site.search_config?.weights?.[field] || 1);
      return total + terms.reduce((subtotal, term) => subtotal + (haystack.includes(term.toLocaleLowerCase('es')) ? weight : 0), 0);
    }, 0);
    return { type: collection?.plural_name || 'Contenido', title: values[0] || record.slug || 'Contenido', summary: values.slice(1, 3).join(' · '), url: page ? `${pageUrl(page)}#record-${record.id}` : '#', score };
  });
  renderSearchResults([...pageResults, ...recordResults].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es')).slice(0, 60), query);
}

function openSearch() {
  document.getElementById('instance-search')?.classList.remove('hidden');
  document.getElementById('instance-search-input')?.focus();
}

async function loadBuilderPage() {
  const pageSlug = new URLSearchParams(window.location.search).get('page');
  let query = supabaseClient.from('site_pages').select('id,site_id,slug,name,title,description,status,is_home,sort_order,published_document,seo_config,access_config')
    .eq('site_id', site.id).eq('status', 'published').order('sort_order').order('created_at');
  const { data, error } = await query;
  if (error) return false;
  pages = data || [];
  page = pages.find(item => item.slug === pageSlug) || pages.find(item => item.is_home) || pages[0] || null;
  if (!page) return false;
  if (page.published_document?.kind === 'legacy') {
    window.location.replace(page.published_document.legacyUrl || 'logs.html'); return true;
  }
  const visibility = page.access_config?.visibility || 'public';
  if (visibility !== 'public') {
    showFailure('Esta página requiere un acceso que todavía no está activo en esta sesión.'); return true;
  }
  document.title = page.seo_config?.title || `${page.title} · ${site.name}`;
  const descriptionMeta = document.querySelector('meta[name="description"]') || document.head.appendChild(document.createElement('meta'));
  descriptionMeta.name = 'description'; descriptionMeta.content = page.seo_config?.description || page.description || site.description || '';
  if (page.seo_config?.noindex) { const robots = document.createElement('meta'); robots.name = 'robots'; robots.content = 'noindex,nofollow'; document.head.append(robots); }
  document.getElementById('instance-loading').classList.add('hidden');
  const content = document.getElementById('instance-builder-content'); content.classList.remove('hidden');
  renderedBreakpoint = breakpoint();
  renderPageDocument(page.published_document, content, { builder: false, device: renderedBreakpoint, mode: 'normal', roles: [] });
  await hydrateDynamicBlocks();
  return true;
}

async function boot() {
  const slug = new URLSearchParams(window.location.search).get('site') || '';
  if (!slug) { showFailure('No se indicó qué instancia abrir.'); return; }
  const { data, error } = await supabaseClient.from('sites')
    .select('id,slug,name,description,status,theme_config,navigation_config,search_config')
    .eq('slug', slug).eq('status', 'active').maybeSingle();
  if (error || !data) { showFailure('Este portal todavía está en borrador, fue archivado o la dirección no existe. Vuelve al constructor y pulsa Publicar.'); return; }
  site = data;
  document.title = `${site.name} · Empi Network`;
  document.getElementById('instance-name').textContent = site.name;
  document.getElementById('instance-description').textContent = site.description || '';
  applyTheme(site.theme_config);
  const brand = document.querySelector('.instance-header .network-brand');
  if (brand) {
    brand.querySelector('span').textContent = site.name;
    if (site.theme_config?.assets?.logo) brand.querySelector('img').src = site.theme_config.assets.logo;
  }
  if (site.theme_config?.assets?.banner) {
    const banner = document.createElement('div'); banner.className = 'instance-site-banner'; banner.style.backgroundImage = `url("${String(site.theme_config.assets.banner).replace(/["\\]/g, '')}")`;
    document.getElementById('instance-main').prepend(banner);
  }
  const { data: publicCollections } = await supabaseClient.from('site_collections')
    .select('id,collection_key,singular_name,plural_name').eq('site_id', site.id).eq('status', 'active');
  collections = publicCollections || [];
  const rendered = await loadBuilderPage();
  applyNavigation(site.navigation_config);
  applySearch(site.search_config);
  if (!rendered) {
    document.getElementById('instance-name').textContent = site.name;
    document.getElementById('instance-description').textContent = site.description || '';
  }

  document.getElementById('instance-search-button')?.addEventListener('click', openSearch);
  document.getElementById('instance-search-close')?.addEventListener('click', () => document.getElementById('instance-search')?.classList.add('hidden'));
  document.getElementById('instance-search-input')?.addEventListener('input', event => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => void runSearch(event.target.value), 220);
  });
  document.getElementById('instance-nav-toggle')?.addEventListener('click', event => {
    const open = document.body.classList.toggle('instance-nav-open'); event.currentTarget.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); }
    if (event.key !== 'Escape') return;
    document.body.classList.remove('instance-nav-open');
    document.getElementById('instance-nav-toggle')?.setAttribute('aria-expanded', 'false');
    document.getElementById('instance-search')?.classList.add('hidden');
  });
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      applyNavigation(site.navigation_config); applySearch(site.search_config);
      const nextBreakpoint = breakpoint();
      const content = document.getElementById('instance-builder-content');
      if (page?.published_document && nextBreakpoint !== renderedBreakpoint) {
        renderedBreakpoint = nextBreakpoint;
        renderPageDocument(page.published_document, content, { builder: false, device: renderedBreakpoint, mode: 'normal', roles: [] });
        void hydrateDynamicBlocks();
      } else refreshVisibility(content, { device: nextBreakpoint, mode: 'normal', roles: [] });
    });
  });
}

window.EmpiInstanceRenderer = Object.freeze({ applyTheme, applyNavigation, applySearch, renderPageDocument });
void boot();

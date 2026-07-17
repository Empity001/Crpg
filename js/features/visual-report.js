import { downloadFile } from './backup-helpers.js';
import { createStoredZip } from './zip-store.js';

const list = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function safeImage(value) {
  const url = String(value || '').trim();
  return /^(https?:|data:image\/)/i.test(url) ? esc(url) : '';
}

function image(value, alt = '') {
  const url = safeImage(value);
  return url
    ? `<img src="${url}" alt="${esc(alt)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="fallback" hidden>${esc(String(alt || '?').slice(0, 2).toUpperCase())}</span>`
    : `<span class="fallback">${esc(String(alt || '?').slice(0, 2).toUpperCase())}</span>`;
}

function reportDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short' });
}

function textValue(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? Object.values(item).filter(Boolean).join(': ') : item).join(' · ');
  if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key}: ${textValue(item)}`).join(' · ');
  return String(value);
}

function renderLog(log) {
  const mobs = list(log.mobs);
  const items = list(log.items);
  const blocks = [...mobs.map(item => ({ ...item, _kind: 'Mob' })), ...items.map(item => ({ ...item, _kind: item.item_type === '_libre' ? 'Extra' : 'Item' }))];
  return `<article class="record searchable" data-search="${esc([log.title, log.description, log.category, ...blocks.map(item => item.name)].join(' ').toLowerCase())}">
    <div class="record-cover">${image(log.cover_image_url, log.title)}</div>
    <div class="record-main"><div class="badges"><span>${esc(log.category || 'Sin categoría')}</span><span>${esc(log.relevance || 'normal')}</span></div><h3>${esc(log.title || 'Log sin título')}</h3><p>${esc(log.description || 'Sin descripción')}</p><small>${esc(reportDate(log.created_at))} · ${mobs.length} mobs · ${items.filter(item => item.item_type !== '_libre').length} items · ${items.filter(item => item.item_type === '_libre').length} extras</small></div>
    ${blocks.length ? `<details><summary>Ver fichas relacionadas (${blocks.length})</summary><div class="subgrid">${blocks.map(item => `<div class="subcard"><div class="thumb">${image(item.image_url, item.name)}</div><div><b>${esc(item.name || item._kind)}</b><small>${esc(item._kind)}</small><p>${esc(item.description || textValue(item.extra_fields) || '')}</p></div></div>`).join('')}</div></details>` : ''}
  </article>`;
}

function renderGuide(weapon, bundle) {
  const ranks = list(bundle.weapon_ranks?.[weapon.id]);
  const category = list(bundle.weapon_categories).find(item => item.id === weapon.category_id);
  const type = list(bundle.weapon_types).find(item => item.id === weapon.type_id);
  return `<article class="guide searchable" data-search="${esc([weapon.name, category?.label, type?.label, ...ranks.map(rank => rank.name)].join(' ').toLowerCase())}">
    <div class="guide-head"><div class="guide-image">${image(weapon.image_url || ranks[0]?.image_url, weapon.name)}</div><div><div class="badges"><span>${esc(category?.label || 'Sin categoría')}</span><span>${esc(type?.label || 'Sin tipo')}</span></div><h3>${esc(weapon.name || 'Guía sin nombre')}</h3><small>${weapon.published ? 'Publicada' : 'Oculta'} · ${ranks.length} variante(s)</small></div></div>
    <div class="rank-list">${ranks.map(rank => `<details><summary>${esc(rank.name || 'Variante')}</summary><div class="rank-body">${rank.description ? `<p>${esc(rank.description)}</p>` : ''}<dl>${list(rank.stats).map(stat => `<div><dt>${esc(stat.label || stat.key || 'Dato')}</dt><dd>${esc(stat.value ?? '—')}</dd></div>`).join('')}</dl>${list(rank.abilities).length ? `<h4>Habilidades</h4>${list(rank.abilities).map(ability => `<p><b>${esc(ability.name || 'Habilidad')}</b> — ${esc(ability.description || '')}</p>`).join('')}` : ''}</div></details>`).join('') || '<p class="muted">Sin variantes.</p>'}</div>
  </article>`;
}

function renderKit(kit) {
  const columns = [ ['weapon', 'Arma'], ['accessory', 'Accesorio'], ['subweapon', 'Sub-arma'] ];
  const allItems = columns.flatMap(([key]) => list(kit.items?.[key]));
  return `<article class="kit searchable" data-search="${esc([kit.name, kit.description, ...allItems.map(item => item.name)].join(' ').toLowerCase())}"><h3>${esc(kit.name || 'Kit sin nombre')}</h3><p>${esc(kit.description || 'Sin descripción')}</p><div class="kit-columns">${columns.map(([key, label]) => `<section><h4>${label}</h4>${list(kit.items?.[key]).map(item => `<div class="kit-item"><div class="thumb">${image(item.image_url, item.name)}</div><span>${esc(item.name || 'Sin nombre')}</span></div>`).join('') || '<small>Vacío</small>'}</section>`).join('')}</div></article>`;
}

function renderTierRow(row, bundle) {
  const items = list(bundle.tierlist?.items).filter(item => item.row_id === row.id);
  return `<article class="tier-row searchable" data-search="${esc([row.name, ...items.map(item => item.name)].join(' ').toLowerCase())}"><header style="--tier:${esc(row.color || '#8b3dff')}"><strong>${esc(row.name || 'Tier')}</strong><small>${items.length} elementos</small></header><div class="tier-items">${items.map(item => `<div class="tier-item"><div class="thumb">${image(item.image_url, item.name)}</div><span>${esc(item.name || 'Sin nombre')}</span><small>${esc(item.column_key || '')}</small></div>`).join('') || '<p class="muted">Fila vacía.</p>'}</div></article>`;
}

function countBlocks(bundle) {
  const logs = list(bundle.logs);
  return logs.reduce((sum, log) => sum + list(log.mobs).length + list(log.items).length, 0);
}

export function buildVisualReportHtml(bundle) {
  const logs = list(bundle.logs);
  const weapons = list(bundle.weapons);
  const kits = list(bundle.kits);
  const tierRows = list(bundle.tierlist?.rows);
  const media = list(bundle.media_assets);
  const sections = [
    logs.length && ['logs', 'Logs', logs.map(renderLog).join('')],
    weapons.length && ['guides', 'Guías', weapons.map(weapon => renderGuide(weapon, bundle)).join('')],
    kits.length && ['kits', 'Kits', kits.map(renderKit).join('')],
    tierRows.length && ['tierlist', 'Tierlist', tierRows.map(row => renderTierRow(row, bundle)).join('')],
  ].filter(Boolean);
  const first = sections[0]?.[0] || 'summary';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Culones-RPG · Reporte visual</title><style>
  :root{color-scheme:dark;--bg:#070914;--side:#0b0e1d;--panel:#111528;--card:#171b32;--line:#3b315f;--text:#f5f3ff;--muted:#aaa6c5;--purple:#8b3dff;--soft:#b46cff;--green:#35d98b}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 80% 0,#241044 0,transparent 32%),var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}button,input{font:inherit}.shell{display:grid;grid-template-columns:245px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:28px 18px;border-right:1px solid var(--line);background:#0b0e1df2}.brand{margin-bottom:28px}.brand b{display:block;font-size:20px}.brand span,.muted{color:var(--muted)}nav{display:grid;gap:7px}nav button{padding:11px 13px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--muted);text-align:left;cursor:pointer}nav button.active{border-color:#8b3dff88;background:#8b3dff26;color:var(--text)}main{min-width:0;padding:34px}.hero{display:flex;justify-content:space-between;gap:20px;padding:26px;margin-bottom:14px;border:1px solid var(--line);border-radius:19px;background:linear-gradient(130deg,#171b32e8,#111528cc)}h1{margin:0;font-size:clamp(27px,4vw,48px);letter-spacing:-.04em}.hero p{margin:7px 0 0;color:var(--muted)}.date{color:var(--soft);font-size:12px}.toolbar{position:sticky;top:0;z-index:3;padding:10px 0;background:linear-gradient(var(--bg) 72%,transparent)}#search{width:100%;padding:13px 15px;border:1px solid var(--line);border-radius:12px;outline:0;background:#111528e8;color:var(--text)}#search:focus{border-color:var(--purple)}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;margin:12px 0}.stat{padding:16px;border:1px solid var(--line);border-radius:14px;background:#111528c7}.stat b{display:block;font-size:24px}.stat small{color:var(--muted)}.section{display:none}.section.active{display:block}.section-title{margin:24px 0 10px}.record,.guide,.kit,.tier-row{margin-bottom:10px;padding:15px;border:1px solid var(--line);border-radius:15px;background:#111528c7}.record{display:grid;grid-template-columns:105px 1fr;gap:15px}.record-cover,.guide-image{display:grid;min-height:92px;place-items:center;overflow:hidden;border-radius:11px;background:#070914}.record-cover img,.guide-image img,.thumb img{width:100%;height:100%;object-fit:contain;image-rendering:auto}.fallback{display:grid;width:100%;height:100%;min-height:48px;place-items:center;color:var(--soft);font-weight:800}.record h3,.guide h3,.kit h3{margin:4px 0}.record p,.kit p{margin:4px 0;color:var(--muted)}.record small,.guide small{color:var(--muted)}.record details{grid-column:1/-1}.badges{display:flex;flex-wrap:wrap;gap:6px}.badges span{padding:3px 7px;border:1px solid #8b3dff66;border-radius:999px;color:var(--soft);font-size:10px;text-transform:uppercase}.subgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:7px;margin-top:9px}.subcard{display:grid;grid-template-columns:48px 1fr;gap:8px;padding:8px;border:1px solid #3b315f99;border-radius:10px}.subcard p{font-size:12px}.subcard small{display:block}.thumb{display:grid;width:48px;height:48px;place-items:center;overflow:hidden;border-radius:8px;background:#070914}.guide-head{display:grid;grid-template-columns:84px 1fr;gap:12px}.rank-list{margin-top:12px}.rank-list details{border-top:1px solid #3b315f80}.rank-list summary,.record summary{padding:9px 0;cursor:pointer;color:var(--soft)}.rank-body dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px}.rank-body dl div{padding:7px;border-radius:8px;background:#07091499}.rank-body dt{color:var(--muted);font-size:10px}.rank-body dd{margin:0}.kit-columns{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px}.kit-columns section{padding:9px;border:1px solid #3b315f99;border-radius:10px}.kit-columns h4{margin:0 0 8px}.kit-item{display:flex;align-items:center;gap:7px;margin-top:6px}.tier-row{display:grid;grid-template-columns:100px 1fr;padding:0;overflow:hidden}.tier-row header{display:flex;flex-direction:column;justify-content:center;padding:15px;background:color-mix(in srgb,var(--tier) 72%,#111528)}.tier-items{display:flex;flex-wrap:wrap;gap:8px;padding:12px}.tier-item{width:83px;padding:7px;border:1px solid #3b315f99;border-radius:9px;text-align:center}.tier-item .thumb{width:54px;height:54px;margin:auto}.tier-item span,.tier-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.tier-item span{font-size:11px}.tier-item small{color:var(--muted);font-size:9px}details summary{user-select:none}.empty{padding:40px;text-align:center;color:var(--muted)}footer{margin-top:30px;padding-top:15px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}@media(max-width:850px){.shell{grid-template-columns:1fr}.sidebar{position:static;width:100%;height:auto;border-right:0;border-bottom:1px solid var(--line)}nav{grid-template-columns:repeat(${Math.max(1, sections.length)},minmax(110px,1fr));overflow:auto}.brand{margin-bottom:14px}main{padding:18px}.stats{grid-template-columns:repeat(2,1fr)}.record{grid-template-columns:74px 1fr}.kit-columns{grid-template-columns:1fr}.tier-row{grid-template-columns:70px 1fr}}
  </style></head><body><div class="shell"><aside class="sidebar"><div class="brand"><b>CULONES-RPG</b><span>Reporte visual portátil</span></div><nav>${sections.map(([id, label], index) => `<button data-section="${id}" class="${index === 0 ? 'active' : ''}">${label}</button>`).join('') || '<button class="active" data-section="summary">Resumen</button>'}</nav></aside><main><header class="hero"><div><h1>Reporte de contenido</h1><p>Una lectura visual del estado exportado de la web.</p></div><div class="date">${esc(reportDate(bundle.exported_at))}</div></header><div class="stats"><div class="stat"><b>${logs.length}</b><small>Logs</small></div><div class="stat"><b>${countBlocks(bundle)}</b><small>Fichas en logs</small></div><div class="stat"><b>${weapons.length}</b><small>Guías</small></div><div class="stat"><b>${kits.length}</b><small>Kits</small></div><div class="stat"><b>${media.length}</b><small>Multimedia</small></div></div><div class="toolbar"><input id="search" type="search" placeholder="Buscar en la sección actual…"></div>${sections.map(([id, label, content], index) => `<section id="${id}" class="section ${index === 0 ? 'active' : ''}"><h2 class="section-title">${label}</h2>${content || '<div class="empty">Sin datos.</div>'}</section>`).join('') || `<section id="summary" class="section active"><div class="empty">El respaldo no contiene registros para mostrar.</div></section>`}<footer>Generado por Culones-RPG · El archivo data.json incluido en el ZIP conserva los datos técnicos.</footer></main></div><script>
  const buttons=[...document.querySelectorAll('[data-section]')],sections=[...document.querySelectorAll('.section')],search=document.querySelector('#search');function openSection(id){buttons.forEach(b=>b.classList.toggle('active',b.dataset.section===id));sections.forEach(s=>s.classList.toggle('active',s.id===id));search.value='';filter('')}function filter(value){const q=value.trim().toLowerCase(),active=document.querySelector('.section.active');active?.querySelectorAll('.searchable').forEach(card=>card.hidden=!!q&&!card.dataset.search.includes(q))}buttons.forEach(b=>b.addEventListener('click',()=>openSection(b.dataset.section)));search.addEventListener('input',()=>filter(search.value));openSection('${first}');
  <\/script></body></html>`;
}

export function downloadVisualReport(bundle, filename) {
  const html = buildVisualReportHtml(bundle);
  const json = JSON.stringify(bundle, null, 2);
  const readme = `CULONES-RPG — REPORTE VISUAL\n\n1. Abre index.html en tu navegador.\n2. data.json contiene la copia técnica de los datos exportados y también puede importarse desde Herramientas después de extraer el ZIP.\n3. Las imágenes usan sus URLs de Supabase; sin conexión, el contenido y el diseño siguen disponibles, pero las imágenes remotas pueden no mostrarse.\n4. El respaldo JSON descargado directamente sigue siendo la opción más clara para restauraciones rutinarias.\n`;
  const bytes = createStoredZip([
    { name: 'index.html', data: html },
    { name: 'data.json', data: json },
    { name: 'LEEME.txt', data: readme },
  ]);
  downloadFile(bytes, filename, 'application/zip');
}

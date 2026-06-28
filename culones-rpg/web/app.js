// web/app.js
const { createClient } = window.supabase;
const sb = createClient(window.CULONES_CONFIG.SUPABASE_URL, window.CULONES_CONFIG.SUPABASE_PUBLISHABLE_KEY);

// ---------------- Estado ----------------
let allLogs = [];
let adminToken = localStorage.getItem('culones_admin_token') || null;
let adminTokenExpires = localStorage.getItem('culones_admin_token_expires') || null;
let editingLogId = null;

const RELEVANCE_LABEL = { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' };
const CATEGORY_LABEL = {
  item: 'Item', mob: 'Mob', mecanica: 'Mecánica', evento: 'Evento',
  npc: 'NPC', casino: 'Casino', forja: 'Forja', otro: 'Otro',
};

// ---------------- Helpers ----------------
function $(id) { return document.getElementById(id); }
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function showToast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.style.borderColor = isError ? 'var(--red)' : 'var(--cyan)';
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function getVoterId() {
  let id = localStorage.getItem('culones_voter_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('culones_voter_id', id);
  }
  return id;
}

function isAdminLoggedIn() {
  return adminToken && adminTokenExpires && new Date(adminTokenExpires) > new Date();
}

function formatDate(iso) {
  // Esto usa automáticamente la zona horaria local del navegador de quien mira la página
  return new Date(iso).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ---------------- Carga y render de logs ----------------
async function fetchLogs() {
  const { data, error } = await sb
    .from('logs')
    .select('*, log_likes(count), log_comments(count)')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    showToast('No se pudieron cargar los logs', true);
    return;
  }
  allLogs = data || [];
  renderLogs();
}

function applySortAndFilter(logs) {
  const sort = $('sortSelect').value;
  const catFilter = $('filterCategory').value;
  const relFilter = $('filterRelevance').value;

  let result = logs.filter((l) => (!catFilter || l.category === catFilter) && (!relFilter || l.relevance === relFilter));

  const relOrder = { baja: 0, media: 1, alta: 2, critica: 3 };

  if (sort === 'date_desc') result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (sort === 'date_asc') result.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  if (sort === 'relevance') result.sort((a, b) => relOrder[b.relevance] - relOrder[a.relevance]);
  if (sort === 'category') result.sort((a, b) => a.category.localeCompare(b.category));

  return result;
}

function renderLogs() {
  const logs = applySortAndFilter(allLogs);
  const grid = $('logsGrid');
  grid.innerHTML = '';
  $('logCount').textContent = `${logs.length} log${logs.length === 1 ? '' : 's'}`;
  $('emptyState').classList.toggle('hidden', logs.length > 0);

  for (const log of logs) {
    const likeCount = log.log_likes?.[0]?.count ?? 0;
    const commentCount = log.log_comments?.[0]?.count ?? 0;
    const alreadyLiked = localStorage.getItem(`liked_${log.id}`) === '1';

    const card = document.createElement('article');
    card.className = 'log-card';
    card.innerHTML = `
      <div class="log-card-header">
        <h3>${escapeHtml(log.title)}</h3>
        ${log.version ? `<span class="version-pill">${escapeHtml(log.version)}</span>` : ''}
      </div>
      <div class="badges">
        <span class="badge badge-category">${CATEGORY_LABEL[log.category] ?? log.category}</span>
        <span class="badge badge-relevance-${log.relevance}">${RELEVANCE_LABEL[log.relevance] ?? log.relevance}</span>
      </div>
      ${log.description ? `<p class="desc">${escapeHtml(log.description)}</p>` : ''}
      <div class="log-card-footer">
        <span class="log-date">${formatDate(log.created_at)}</span>
        <div class="card-actions">
          <button class="icon-btn btn-like ${alreadyLiked ? 'liked' : ''}" data-id="${log.id}">
            <span class="icon-heart-mini"></span> ${likeCount}
          </button>
          <button class="icon-btn btn-view" data-id="${log.id}">💬 ${commentCount}</button>
          ${isAdminLoggedIn() ? `
            <button class="icon-btn btn-edit" data-id="${log.id}">✏️</button>
            <button class="icon-btn btn-delete" data-id="${log.id}">🗑️</button>
          ` : ''}
        </div>
      </div>
    `;
    grid.appendChild(card);
  }

  // listeners
  grid.querySelectorAll('.btn-like').forEach((b) => b.addEventListener('click', () => handleLike(b.dataset.id)));
  grid.querySelectorAll('.btn-view').forEach((b) => b.addEventListener('click', () => openLogDetail(b.dataset.id)));
  grid.querySelectorAll('.btn-edit').forEach((b) => b.addEventListener('click', () => openEditModal(b.dataset.id)));
  grid.querySelectorAll('.btn-delete').forEach((b) => b.addEventListener('click', () => handleDelete(b.dataset.id)));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------------- Likes ----------------
async function handleLike(logId) {
  if (localStorage.getItem(`liked_${logId}`) === '1') {
    showToast('Ya le diste like a este log');
    return;
  }
  const { error } = await sb.from('log_likes').insert({ log_id: logId, voter_id: getVoterId() });
  if (error) {
    if (error.code === '23505') {
      showToast('Ya le habías dado like desde este navegador');
    } else {
      console.error(error);
      showToast('No se pudo registrar el like', true);
    }
    return;
  }
  localStorage.setItem(`liked_${logId}`, '1');
  await fetchLogs();
}

// ---------------- Detalle + comentarios ----------------
let currentViewLogId = null;

async function openLogDetail(logId) {
  currentViewLogId = logId;
  const log = allLogs.find((l) => l.id === logId);
  if (!log) return;

  const sections = Array.isArray(log.content) ? log.content : [];
  const sectionsHtml = sections.map((s) => `
    <div class="view-spec-section">
      <h4>${escapeHtml(s.seccion ?? '')}</h4>
      ${(s.items || []).map((it) => `<div class="view-spec-row"><b>${escapeHtml(it.clave)}:</b>${escapeHtml(it.valor)}</div>`).join('')}
    </div>
  `).join('');

  $('viewLogContent').innerHTML = `
    <div class="log-card-header">
      <h2>${escapeHtml(log.title)}</h2>
      ${log.version ? `<span class="version-pill">${escapeHtml(log.version)}</span>` : ''}
    </div>
    <div class="badges">
      <span class="badge badge-category">${CATEGORY_LABEL[log.category] ?? log.category}</span>
      <span class="badge badge-relevance-${log.relevance}">${RELEVANCE_LABEL[log.relevance] ?? log.relevance}</span>
      ${(log.tags || []).map((t) => `<span class="badge badge-category">#${escapeHtml(t)}</span>`).join('')}
    </div>
    ${log.description ? `<p class="desc">${escapeHtml(log.description)}</p>` : ''}
    <p class="log-date">Publicado: ${formatDate(log.created_at)}${log.updated_at !== log.created_at ? ` · editado ${formatDate(log.updated_at)}` : ''}</p>
    ${sectionsHtml}
  `;

  await loadComments(logId);
  openModal('modalView');
}

async function loadComments(logId) {
  const { data, error } = await sb
    .from('log_comments')
    .select('*')
    .eq('log_id', logId)
    .order('created_at', { ascending: true });

  const list = $('commentsList');
  if (error) {
    list.innerHTML = `<p class="error-text">No se pudieron cargar los comentarios</p>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = `<p class="modal-hint">Sé el primero en comentar.</p>`;
    return;
  }
  list.innerHTML = data.map((c) => `
    <div class="comment-item">
      <span class="author">${escapeHtml(c.author_name)}</span>
      <span class="date">${formatDate(c.created_at)}</span>
      <p>${escapeHtml(c.content)}</p>
    </div>
  `).join('');
}

$('btnSubmitComment').addEventListener('click', async () => {
  const author_name = $('commentName').value.trim() || 'Anónimo';
  const content = $('commentText').value.trim();
  if (!content) { showToast('Escribe algo antes de comentar', true); return; }

  const { error } = await sb.from('log_comments').insert({ log_id: currentViewLogId, author_name, content });
  if (error) {
    console.error(error);
    showToast('No se pudo publicar el comentario', true);
    return;
  }
  $('commentText').value = '';
  await loadComments(currentViewLogId);
  await fetchLogs();
});

// ---------------- Login admin ----------------
$('btnAdminLogin').addEventListener('click', () => openModal('modalLogin'));

$('btnSubmitLogin').addEventListener('click', async () => {
  const code = $('inputAdminCode').value.trim().toUpperCase();
  $('loginError').classList.add('hidden');

  try {
    const res = await fetch(window.CULONES_CONFIG.ADMIN_LOGIN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Código inválido');

    adminToken = json.token;
    adminTokenExpires = json.expires_at;
    localStorage.setItem('culones_admin_token', adminToken);
    localStorage.setItem('culones_admin_token_expires', adminTokenExpires);

    closeModal('modalLogin');
    $('inputAdminCode').value = '';
    updateAdminUI();
    renderLogs();
    showToast('Sesión de admin iniciada');
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').classList.remove('hidden');
  }
});

$('btnAdminLogout').addEventListener('click', () => {
  adminToken = null;
  adminTokenExpires = null;
  localStorage.removeItem('culones_admin_token');
  localStorage.removeItem('culones_admin_token_expires');
  updateAdminUI();
  renderLogs();
});

function updateAdminUI() {
  const logged = isAdminLoggedIn();
  $('adminBadge').classList.toggle('hidden', !logged);
  $('btnAddLog').classList.toggle('hidden', !logged);
  $('btnAdminLogin').classList.toggle('hidden', logged);
  $('btnAdminLogout').classList.toggle('hidden', !logged);
}

// ---------------- Crear / editar log ----------------
$('btnAddLog').addEventListener('click', () => openCreateModal());

function clearLogForm() {
  editingLogId = null;
  $('logModalTitle').textContent = 'Agregar log';
  $('fieldTitle').value = '';
  $('fieldVersion').value = '';
  $('fieldCategory').value = 'item';
  $('fieldRelevance').value = 'media';
  $('fieldTags').value = '';
  $('fieldDescription').value = '';
  $('sectionsBuilder').innerHTML = '';
  $('logFormError').classList.add('hidden');
}

function openCreateModal() {
  clearLogForm();
  openModal('modalLog');
}

function openEditModal(logId) {
  const log = allLogs.find((l) => l.id === logId);
  if (!log) return;
  clearLogForm();
  editingLogId = logId;
  $('logModalTitle').textContent = 'Editar log';
  $('fieldTitle').value = log.title;
  $('fieldVersion').value = log.version || '';
  $('fieldCategory').value = log.category;
  $('fieldRelevance').value = log.relevance;
  $('fieldTags').value = (log.tags || []).join(', ');
  $('fieldDescription').value = log.description || '';
  (log.content || []).forEach((s) => addSectionBlock(s));
  openModal('modalLog');
}

function addSectionBlock(prefill) {
  const wrapper = document.createElement('div');
  wrapper.className = 'section-block';
  wrapper.innerHTML = `
    <input class="section-name" type="text" placeholder="Nombre de sección (ej: Mob: Esqueleto Cumpleañero)" value="${escapeHtml(prefill?.seccion || '')}" />
    <div class="kv-list"></div>
    <button type="button" class="btn-add-kv">+ Agregar dato</button>
    <button type="button" class="btn-remove-section">Quitar sección</button>
  `;
  const kvList = wrapper.querySelector('.kv-list');

  function addKvRow(clave = '', valor = '') {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `
      <input type="text" placeholder="Clave (ej: Vida)" class="kv-clave" value="${escapeHtml(clave)}" />
      <input type="text" placeholder="Valor (ej: 200)" class="kv-valor" value="${escapeHtml(valor)}" />
      <button type="button">×</button>
    `;
    row.querySelector('button').addEventListener('click', () => row.remove());
    kvList.appendChild(row);
  }

  (prefill?.items || []).forEach((it) => addKvRow(it.clave, it.valor));
  if (!prefill) addKvRow();

  wrapper.querySelector('.btn-add-kv').addEventListener('click', () => addKvRow());
  wrapper.querySelector('.btn-remove-section').addEventListener('click', () => wrapper.remove());

  $('sectionsBuilder').appendChild(wrapper);
}

$('btnAddSection').addEventListener('click', () => addSectionBlock());

function collectSectionsFromForm() {
  const blocks = $('sectionsBuilder').querySelectorAll('.section-block');
  const sections = [];
  blocks.forEach((block) => {
    const seccion = block.querySelector('.section-name').value.trim();
    const items = [];
    block.querySelectorAll('.kv-row').forEach((row) => {
      const clave = row.querySelector('.kv-clave').value.trim();
      const valor = row.querySelector('.kv-valor').value.trim();
      if (clave) items.push({ clave, valor });
    });
    if (seccion || items.length) sections.push({ seccion, items });
  });
  return sections;
}

$('btnSubmitLog').addEventListener('click', async () => {
  const title = $('fieldTitle').value.trim();
  const category = $('fieldCategory').value;
  if (!title) {
    $('logFormError').textContent = 'El título es obligatorio';
    $('logFormError').classList.remove('hidden');
    return;
  }

  const payload = {
    title,
    version: $('fieldVersion').value.trim() || null,
    category,
    relevance: $('fieldRelevance').value,
    tags: $('fieldTags').value.split(',').map((t) => t.trim()).filter(Boolean),
    description: $('fieldDescription').value.trim() || null,
    content: collectSectionsFromForm(),
  };

  if (editingLogId) payload.id = editingLogId;

  try {
    const res = await fetch(window.CULONES_CONFIG.ADMIN_WRITE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken, action: editingLogId ? 'update' : 'create', payload }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al guardar');

    closeModal('modalLog');
    showToast(editingLogId ? 'Log actualizado' : 'Log publicado');
    await fetchLogs();
  } catch (err) {
    $('logFormError').textContent = err.message;
    $('logFormError').classList.remove('hidden');
  }
});

async function handleDelete(logId) {
  if (!confirm('¿Seguro que quieres borrar este log? No se puede deshacer.')) return;
  try {
    const res = await fetch(window.CULONES_CONFIG.ADMIN_WRITE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: adminToken, action: 'delete', payload: { id: logId } }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Error al borrar');
    showToast('Log eliminado');
    await fetchLogs();
  } catch (err) {
    showToast(err.message, true);
  }
}

// ---------------- Listeners generales ----------------
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });
});

$('sortSelect').addEventListener('change', renderLogs);
$('filterCategory').addEventListener('change', renderLogs);
$('filterRelevance').addEventListener('change', renderLogs);

// ---------------- Init ----------------
updateAdminUI();
fetchLogs();

// Refresca solo en vivo si quieres (opcional): cada 60s vuelve a pedir los logs
setInterval(fetchLogs, 60000);

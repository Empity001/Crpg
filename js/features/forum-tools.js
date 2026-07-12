// =========================================================
// forum-tools.js
// Configuración de las reacciones que el bot coloca en el primer mensaje
// de cada publicación del foro de Guías.
// =========================================================

import { getDiscordGuildConfig, saveForumReactions } from '../core/admin-api.js';
import { escapeHtml, showToast } from '../core/utils.js';

function parseToken(token) {
  const custom = token.match(/^<(a?):([^:>]+):(\d+)>$/);
  if (custom) return { type: 'custom', value: custom[3], name: custom[2], animated: custom[1] === 'a', display: token };
  return { type: 'unicode', value: token, display: token };
}

function parseReactions(text) {
  const values = String(text || '').trim().split(/\s+/u).filter(Boolean);
  const output = [];
  for (const value of values) {
    const item = parseToken(value);
    if (!output.some(existing => existing.type === item.type && existing.value === item.value)) output.push(item);
    if (output.length >= 20) break;
  }
  return output;
}

function displayReaction(item) {
  if (item?.display) return item.display;
  if (item?.type === 'custom') return item.name ? `<${item.animated ? 'a' : ''}:${item.name}:${item.value}>` : String(item.value || '');
  return String(item?.value || '');
}

function sectionHtml() {
  return `<div class="admin-section forum-reactions-section" id="forum-reactions-section">
    <div class="admin-section-head">
      <div>
        <h2 class="admin-section-title">💬 Reacciones del foro de Guías</h2>
        <p class="admin-section-hint">El bot coloca estas reacciones en la portada de cada Guía. Los miembros pueden pulsarlas aunque el foro sea de solo lectura.</p>
      </div>
    </div>
    <div class="forum-reactions-status" id="forum-reactions-status">Cargando configuración de Discord…</div>
    <label class="field-label" for="forum-reactions-input">Emojis, separados por espacios · máximo 20</label>
    <textarea class="media-input forum-reactions-input" id="forum-reactions-input" rows="3" placeholder="❌ ✅ ⭐"></textarea>
    <p class="admin-section-hint">Para un emoji personalizado pega su formato de Discord, por ejemplo <code>&lt;:nombre:123456789&gt;</code>.</p>
    <div class="forum-reactions-preview" id="forum-reactions-preview" aria-live="polite"></div>
    <label class="forum-reactions-apply-existing"><input type="checkbox" id="forum-reactions-apply-existing" /> Aplicar también a todas las publicaciones existentes</label>
    <div class="modal-error hidden" id="forum-reactions-error"></div>
    <button type="button" class="btn-primary" id="forum-reactions-save">Guardar reacciones</button>
  </div>`;
}

function renderPreview(input) {
  const target = document.getElementById('forum-reactions-preview');
  if (!target) return;
  const reactions = parseReactions(input.value);
  target.innerHTML = reactions.length
    ? reactions.map((reaction, index) => `<span title="Reacción ${index + 1}">${escapeHtml(displayReaction(reaction))}</span>`).join('')
    : '<small>Sin reacciones configuradas.</small>';
}

export async function initForumTools() {
  const anchor = document.getElementById('forum-reactions-anchor');
  if (!anchor || document.getElementById('forum-reactions-section')) return;
  anchor.insertAdjacentHTML('afterend', sectionHtml());
  const input = document.getElementById('forum-reactions-input');
  const errorBox = document.getElementById('forum-reactions-error');
  const status = document.getElementById('forum-reactions-status');
  const save = document.getElementById('forum-reactions-save');
  input?.addEventListener('input', () => renderPreview(input));

  const configResult = await getDiscordGuildConfig();
  if (configResult.error) {
    status.textContent = 'No se pudo consultar el foro configurado.';
    errorBox.textContent = configResult.error.message;
    errorBox.classList.remove('hidden');
  } else {
    const config = configResult.data || {};
    status.textContent = config.guidesForumChannelId
      ? `Foro configurado: ${config.guidesForumChannelId}`
      : 'No hay foro configurado. Usa /guidesforum set en Discord.';
    input.value = (config.forumReactions || []).map(displayReaction).join(' ');
    renderPreview(input);
  }

  save?.addEventListener('click', async () => {
    errorBox.classList.add('hidden');
    const reactions = parseReactions(input.value);
    const applyExisting = document.getElementById('forum-reactions-apply-existing')?.checked;
    if (applyExisting && !window.confirm('Aplicar esta configuración puede quitar reacciones anteriores y borrar sus votos. ¿Continuar?')) return;
    save.disabled = true;
    save.textContent = 'Guardando…';
    const result = await saveForumReactions(reactions, applyExisting);
    save.disabled = false;
    save.textContent = 'Guardar reacciones';
    if (result.error) {
      errorBox.textContent = result.error.message;
      errorBox.classList.remove('hidden');
      return;
    }
    showToast(applyExisting ? 'Reacciones guardadas; Discord las aplicará por cola' : 'Reacciones guardadas para futuras publicaciones', 'success');
  });
}

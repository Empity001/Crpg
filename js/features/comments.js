// =========================================================
// comments.js
// =========================================================
// Comentarios de un log: carga, árbol de respuestas de un nivel, likes,
// moderación admin (ocultar/mostrar/borrar) y envío de comentarios
// nuevos.
// =========================================================

import { supabaseClient } from '../config.js';
import { isAdmin, state } from '../core/state.js';
import { confirmAction, escapeHtml, formatDate, showToast } from '../core/utils.js';

export async function loadComments(logId) {
  const list = document.getElementById('comments-list');
  list.innerHTML = `<p class="comments-empty">Cargando comentarios...</p>`;
  const { data, error } = await supabaseClient.from('comments').select('id,log_id,username,comment,likes,hidden,parent_id,created_at').eq('log_id', logId).order('created_at', { ascending: true });
  if (error) { list.innerHTML = `<p class="comments-empty">No se pudieron cargar.</p>`; return; }
  state.commentsFlat = data || [];
  renderCommentsList();
}


function isCommentVisible(c) {
  return isAdmin() || !c.hidden;
}


function renderCommentNode(c, repliesByParent, isReply) {
  const liked = state.likedCommentIds.has(c.id);
  const hiddenTag = c.hidden ? `<span class="comment-hidden-tag">OCULTO</span>` : '';
  const replies = (repliesByParent[c.id] || []).filter(isCommentVisible);
  const repliesHtml = replies.map(r => renderCommentNode(r, repliesByParent, true)).join('');
  const adminBtns = isAdmin() ? `
        <button type="button" class="comment-action-btn comment-hide-btn" data-comment-id="${c.id}" data-hidden="${c.hidden}">${c.hidden ? '👁 Mostrar' : '🙈 Ocultar'}</button>
        <button type="button" class="comment-action-btn is-danger comment-delete-btn" data-comment-id="${c.id}">🗑 Borrar</button>` : '';
  return `
    <div class="comment-item ${c.hidden ? 'is-hidden' : ''}">
      <div class="comment-meta">
        <span class="comment-username">${escapeHtml(c.username || 'Anónimo')} ${hiddenTag}</span>
        <span>${formatDate(c.created_at)}</span>
      </div>
      <p class="comment-text">${escapeHtml(c.comment)}</p>
      <div class="comment-actions">
        <button type="button" class="comment-action-btn comment-like-btn ${liked ? 'is-liked' : ''}" data-comment-id="${c.id}">${liked ? '❤️' : '🤍'} ${c.likes || 0}</button>
        ${!isReply ? `<button type="button" class="comment-action-btn comment-reply-btn" data-comment-id="${c.id}" data-username="${escapeHtml(c.username || 'Anónimo')}">↩ Responder</button>` : ''}
        ${adminBtns}
      </div>
      ${repliesHtml ? `<div class="comment-replies">${repliesHtml}</div>` : ''}
    </div>`;
}


function renderCommentsList() {
  const list = document.getElementById('comments-list');
  const flat = state.commentsFlat;
  const repliesByParent = {};
  flat.forEach(c => { if (c.parent_id) { (repliesByParent[c.parent_id] = repliesByParent[c.parent_id] || []).push(c); } });
  const roots = flat.filter(c => !c.parent_id).filter(isCommentVisible);
  if (roots.length === 0) { list.innerHTML = `<p class="comments-empty">Sé el primero en comentar este log.</p>`; return; }
  list.innerHTML = roots.map(root => renderCommentNode(root, repliesByParent, false)).join('');
}


export function startReplyTo(commentId, username) {
  state.replyToCommentId = commentId;
  document.getElementById('comment-reply-target').textContent = username || 'Anónimo';
  document.getElementById('comment-reply-banner').classList.remove('hidden');
  document.getElementById('comment-text-input').focus();
}


export function cancelReply() {
  state.replyToCommentId = null;
  const banner = document.getElementById('comment-reply-banner');
  if (banner) banner.classList.add('hidden');
}


export async function toggleCommentLike(commentId) {
  const { data, error } = await supabaseClient.rpc('like_comment', { input_comment_id: commentId, input_client_id: state.clientId });
  if (error) { console.error(error); showToast('No se pudo procesar el like', 'error'); return; }
  if (state.likedCommentIds.has(commentId)) state.likedCommentIds.delete(commentId); else state.likedCommentIds.add(commentId);
  localStorage.setItem('culones_liked_comments', JSON.stringify([...state.likedCommentIds]));
  const c = state.commentsFlat.find(x => x.id === commentId);
  if (c) c.likes = data;
  renderCommentsList();
}


export async function toggleCommentHidden(commentId, currentlyHidden) {
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('set_comment_hidden', { input_code: state.adminCode, input_id: commentId, input_hidden: !currentlyHidden });
  if (error) { showToast('No se pudo actualizar el comentario', 'error'); return; }
  const c = state.commentsFlat.find(x => x.id === commentId);
  if (c) c.hidden = !currentlyHidden;
  renderCommentsList();
  showToast(!currentlyHidden ? 'Comentario oculto' : 'Comentario visible de nuevo', 'success');
}


export async function deleteCommentAction(commentId) {
  if (!(await confirmAction({
    title: 'Borrar comentario',
    message: 'Borrar este comentario y sus respuestas asociadas.',
    confirmLabel: 'Borrar comentario',
    danger: true,
  }))) return;
  if (!state.adminCode) { showToast('Tu sesión de administrador expiró.', 'error'); return; }
  const { error } = await supabaseClient.rpc('delete_comment', { input_code: state.adminCode, input_id: commentId });
  if (error) { showToast('No se pudo borrar el comentario', 'error'); return; }
  state.commentsFlat = state.commentsFlat.filter(c => c.id !== commentId && c.parent_id !== commentId);
  renderCommentsList();
  showToast('Comentario eliminado', 'success');
}


export async function submitComment() {
  const logId = state.currentDetailLogId;
  const usernameInput = document.getElementById('comment-username-input');
  const textInput = document.getElementById('comment-text-input');
  const username = usernameInput.value.trim() || 'Anónimo';
  const comment = textInput.value.trim();
  if (!comment) { showToast('Escribe un comentario antes de enviar', 'error'); return; }
  const { error } = await supabaseClient.from('comments').insert({ log_id: logId, username, comment, parent_id: state.replyToCommentId });
  if (error) { showToast('No se pudo publicar el comentario', 'error'); return; }
  textInput.value = '';
  cancelReply();
  showToast('Comentario publicado', 'success');
  await loadComments(logId);
}

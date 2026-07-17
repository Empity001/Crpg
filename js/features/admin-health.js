// =========================================================
// admin-health.js
// =========================================================
// Diagnóstico bajo demanda del panel administrativo. No usa intervalos ni
// suscripciones permanentes: abre un canal temporal de Realtime, lo cierra y
// guarda el último resultado únicamente para pintar la UI al volver.
// =========================================================

import { supabaseClient } from '../config.js';
import { getAdminHealth } from '../core/admin-api.js';

const CACHE_KEY = 'culones_admin_health_snapshot_v1';
let healthPromise = null;

function withDeadline(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([
    promise,
    timeout,
  ]).finally(() => window.clearTimeout(timer));
}

async function testRealtime() {
  const channel = supabaseClient.channel(`admin-health-${crypto.randomUUID()}`);
  const started = performance.now();
  try {
    const status = await withDeadline(new Promise((resolve) => {
      channel.subscribe(value => {
        if (value === 'SUBSCRIBED') resolve(value);
        else if (value === 'CHANNEL_ERROR' || value === 'TIMED_OUT' || value === 'CLOSED') resolve(value);
      });
    }), 5500, 'Realtime no respondió a tiempo');
    const ok = status === 'SUBSCRIBED';
    return { ok, status, latency_ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, status: 'TIMED_OUT', latency_ms: Math.round(performance.now() - started), message: error.message };
  } finally {
    try { await supabaseClient.removeChannel(channel); } catch { /* canal temporal */ }
  }
}

function card(key) {
  return document.querySelector(`[data-health-key="${key}"]`);
}

function paintCard(key, status = {}) {
  const element = card(key);
  if (!element) return;
  const level = status.level || (status.ok ? 'good' : 'error');
  element.classList.remove('is-good', 'is-warning', 'is-error');
  element.classList.add(`is-${level}`);
  const label = element.querySelector('.health-state');
  if (label) label.textContent = status.label || (status.ok ? 'Operativo' : 'Sin conexión');
  element.title = status.detail || '';
}

function normalizeSnapshot(edgeResult, realtime) {
  const data = edgeResult?.data || {};
  const apiLatency = Number(data.edge?.latency_ms || 0);
  const forum = data.forum || {};
  const queueCount = Number(forum.pending || 0) + Number(forum.processing || 0);
  const failed = Number(forum.failed || 0);

  return {
    checked_at: new Date().toISOString(),
    database: edgeResult?.error
      ? { ok: false, label: 'No comprobado', detail: edgeResult.error.message }
      : { ok: data.database?.ok !== false, label: data.database?.ok === false ? 'Con error' : `${data.database?.latency_ms || 0} ms`, detail: data.database?.message || 'Lectura de Supabase completada.' },
    edge: edgeResult?.error
      ? { ok: false, label: 'No responde', detail: edgeResult.error.message }
      : { ok: true, label: apiLatency ? `${apiLatency} ms` : 'Operativa', detail: 'La Edge Function autenticó la sesión administrativa.' },
    discord: edgeResult?.error
      ? { ok: false, label: 'No comprobado', detail: edgeResult.error.message }
      : data.discord?.is_admin
        ? { ok: true, label: 'Rol verificado', detail: 'La cuenta pertenece al servidor y conserva el rol administrativo.' }
        : { ok: false, label: 'Sin rol', detail: 'Discord no confirmó el rol administrativo.' },
    realtime: realtime?.ok
      ? { ok: true, label: `${realtime.latency_ms || 0} ms`, detail: 'El canal temporal abrió y se cerró correctamente.' }
      : { ok: false, level: 'warning', label: 'No disponible', detail: realtime?.message || realtime?.status || 'No se pudo abrir el canal temporal.' },
    forum: edgeResult?.error
      ? { ok: false, level: 'warning', label: 'No comprobado', detail: edgeResult.error.message }
      : forum.query_ok === false
        ? { ok: false, level: 'warning', label: 'No disponible', detail: forum.message || 'No se pudo consultar la cola del foro.' }
      : failed > 0
        ? { ok: false, level: 'warning', label: `${failed} con error`, detail: `${queueCount} trabajo(s) en curso y ${failed} fallido(s) entre los últimos registros.` }
        : { ok: true, label: queueCount ? `${queueCount} en cola` : 'Cola limpia', detail: forum.configured ? `${queueCount} trabajo(s) pendiente(s) o procesándose.` : 'El foro de Guías todavía no está configurado.' },
  };
}

function renderSnapshot(snapshot) {
  if (!snapshot) return;
  ['database', 'edge', 'discord', 'realtime', 'forum'].forEach(key => paintCard(key, snapshot[key]));
  const warning = ['database', 'edge', 'discord', 'realtime', 'forum'].some(key => !snapshot[key]?.ok);
  const fatal = ['database', 'edge', 'discord'].some(key => !snapshot[key]?.ok && snapshot[key]?.level !== 'warning');
  const dot = document.getElementById('health-overall-dot');
  dot?.classList.remove('is-checking', 'is-good', 'is-warning', 'is-error');
  dot?.classList.add(fatal ? 'is-error' : warning ? 'is-warning' : 'is-good');
  const overall = document.getElementById('health-overall-copy');
  if (overall) overall.textContent = fatal ? 'Hay servicios importantes que requieren atención.' : warning ? 'La web funciona, con una advertencia por revisar.' : 'Los servicios principales responden correctamente.';
  const last = document.getElementById('health-last-check');
  if (last) {
    const date = new Date(snapshot.checked_at);
    last.dateTime = snapshot.checked_at;
    last.textContent = `Comprobado ${date.toLocaleTimeString('es-DO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }
  const detail = document.getElementById('health-detail');
  if (detail) detail.textContent = Object.entries(snapshot)
    .filter(([key]) => ['database', 'edge', 'discord', 'realtime', 'forum'].includes(key))
    .map(([key, value]) => `${({ database: 'Supabase', edge: 'API', discord: 'Discord', realtime: 'Realtime', forum: 'Foro' })[key]}: ${value.detail}`)
    .join(' · ');
}

function setChecking(checking) {
  const button = document.getElementById('health-refresh-btn');
  if (button) {
    button.disabled = checking;
    button.textContent = checking ? 'Comprobando…' : 'Comprobar ahora';
  }
  if (checking) {
    const dot = document.getElementById('health-overall-dot');
    dot?.classList.remove('is-good', 'is-warning', 'is-error');
    dot?.classList.add('is-checking');
    document.getElementById('health-overall-copy').textContent = 'Consultando servicios sin activar monitoreo permanente…';
  }
}

async function runHealthCheck() {
  if (healthPromise) return healthPromise;
  healthPromise = (async () => {
    setChecking(true);
    const edgeStarted = performance.now();
    const [edgeResult, realtime] = await Promise.all([getAdminHealth(), testRealtime()]);
    if (edgeResult.data?.edge) edgeResult.data.edge.latency_ms = Math.round(performance.now() - edgeStarted);
    const snapshot = normalizeSnapshot(edgeResult, realtime);
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(snapshot)); } catch { /* caché opcional */ }
    renderSnapshot(snapshot);
    return snapshot;
  })().finally(() => {
    setChecking(false);
    healthPromise = null;
  });
  return healthPromise;
}

export function initAdminHealth() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (cached) renderSnapshot(cached);
  } catch { /* snapshot antiguo inválido */ }
  document.getElementById('health-refresh-btn')?.addEventListener('click', () => void runHealthCheck());
  void runHealthCheck();
}

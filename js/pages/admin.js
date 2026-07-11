// =========================================================
// pages/admin.js — Entry point de admin.html (🛠 Herramientas)
// =========================================================
// Página exclusiva de administración: borradores, exportar/importar,
// fondo de página, favicon y bitácora de acciones. No importa nada de
// Logs, Tierlist, Armas ni About — solo lee datos de esas secciones
// cuando el propio export/import lo necesita (funciones de datos, sin
// UI: fetchWeaponsDataForExport, loadTierlist).
//
// Acceso restringido: si no hay sesión de admin activa, se redirige
// de inmediato a la portada (esta página nunca se ofrece a un
// visitante normal — el enlace en el menú ya está oculto para ellos).
// =========================================================

import { bootShell } from '../app/shell.js';
import { loadActionLog, openActionLogModal } from '../features/action-log.js';
import { initAdminPanel } from '../features/admin-panel.js';
import { isAdmin } from '../core/state.js';

function initToolsModals() {
  document.getElementById('open-action-log-btn').addEventListener('click', openActionLogModal);
  document.getElementById('close-action-log-modal').addEventListener('click', () => document.getElementById('action-log-modal').classList.add('hidden'));
  document.getElementById('close-action-log-btn-bottom').addEventListener('click', () => document.getElementById('action-log-modal').classList.add('hidden'));
  document.getElementById('refresh-action-log-btn').addEventListener('click', loadActionLog);
}

async function init() {
  await bootShell('admin');
  if (!isAdmin()) { window.location.href = 'index.html'; return; }
  initToolsModals();
  initAdminPanel();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch(error => {
    console.error('[Boot] Error al iniciar la página:', error);
    const main = document.querySelector('.app-main') || document.body;
    const existing = document.getElementById('boot-error-panel');
    if (existing) return;
    const panel = document.createElement('section');
    panel.id = 'boot-error-panel';
    panel.className = 'boot-error-panel';
    panel.innerHTML = `
      <strong>No se pudo iniciar esta página</strong>
      <p>Recarga con Ctrl + F5. Si continúa, revisa la consola del navegador o la conexión con Supabase.</p>
      <button type="button">Recargar</button>`;
    panel.querySelector('button')?.addEventListener('click', () => window.location.reload());
    main.prepend(panel);
  });
});

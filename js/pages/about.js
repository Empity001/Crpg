// =========================================================
// pages/about.js — Entry point de about.html (🎮 Acerca del Server)
// =========================================================
// Carga y cablea EXCLUSIVAMENTE el editor de bloques de "Acerca del
// Server". El contenido en sí (renderAboutContent) ya se pinta desde
// bootShell() -> loadAppSettings(), porque el fondo/favicon/about
// viven todos en la misma tabla app_settings y se cargan juntos.
// =========================================================

import { bootShell } from '../app/shell.js';
import { initAboutEditor } from '../features/about.js';


function focusLinkedAboutBlock() {
  const blockIndex = new URLSearchParams(window.location.search).get('block');
  if (blockIndex == null) return;
  window.requestAnimationFrame(() => {
    const block = document.querySelector(`[data-about-block-index="${CSS.escape(blockIndex)}"]`);
    if (!block) return;
    block.scrollIntoView({ behavior: 'smooth', block: 'center' });
    block.classList.add('global-search-target');
    window.setTimeout(() => block.classList.remove('global-search-target'), 2100);
  });
}

async function init() {
  await bootShell('about');
  initAboutEditor();
  focusLinkedAboutBlock();
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

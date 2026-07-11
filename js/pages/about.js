// =========================================================
// pages/about.js — Entry point de about.html (🎮 Acerca del Server)
// =========================================================
// Carga y cablea EXCLUSIVAMENTE el editor de bloques de "Acerca del
// Server". El contenido en sí (renderAboutContent) ya se pinta desde
// bootShell() -> loadAppSettings(), porque el fondo/favicon/about
// viven todos en la misma tabla app_settings y se cargan juntos.
// =========================================================

import { startPage } from '../app/page-bootstrap.js';
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

startPage(init);

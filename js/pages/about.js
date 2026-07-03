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

async function init() {
  await bootShell('about');
  initAboutEditor();
}

document.addEventListener('DOMContentLoaded', init);

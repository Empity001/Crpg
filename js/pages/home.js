// =========================================================
// pages/home.js: entry point de index.html (la portada)
// =========================================================
// La portada es un escritorio de ventanas. Para las visitas es solo lectura
// (pueden arrastrar, minimizar y maximizar sin guardar nada). Si hay un admin
// en sesión se carga el editor (desk/editor.js), que guarda la disposición en
// app_settings.layout_home.
// =========================================================

import { startPage } from '../app/page-bootstrap.js';
import { bootShell } from '../app/shell.js';
import { supabaseClient } from '../config.js';
import { registerAdminUiRefreshHandler } from '../features/auth.js';
import { loadAppSettings } from '../features/field-config.js';
import { isAdmin, state } from '../core/state.js';
import { withTimeout } from '../core/utils.js';
import { createDataSource } from '../desk/contents.js';
import { createDesk } from '../desk/desk.js';
import { defaultLayout, normalizeLayout } from '../desk/layout.js';

let desk = null;
let editor = null;
let editorLoading = null;

const savedOrDefaultLayout = () => normalizeLayout(state.homeLayout) || defaultLayout();

async function ensureEditor() {
  if (editor || editorLoading || !desk || !isAdmin()) return;
  editorLoading = import('../desk/editor.js')
    .then((module) => {
      editor = module.initEditor({ desk, stage: document.getElementById('desk-shell'), getSaved: savedOrDefaultLayout });
    })
    .catch((error) => console.warn('[Portada] No se pudo cargar el editor:', error))
    .finally(() => { editorLoading = null; });
  await editorLoading;
}

function syncEditorWithSession(admin) {
  if (admin) { void ensureEditor(); return; }
  editor?.dispose();
  editor = null;
}

async function init() {
  await bootShell('home');

  // Los ajustes (incluida la disposición guardada) se cargan en segundo plano
  // desde bootShell; aquí se espera esa misma petición, con tiempo límite.
  try {
    await withTimeout(loadAppSettings('home'), 5000, 'La configuración de la portada');
  } catch (error) {
    console.warn('[Portada] Se usa la disposición predeterminada:', error);
  }

  const ctx = {
    data: createDataSource(supabaseClient),
    get admin() { return isAdmin(); },
  };
  desk = createDesk({
    root: document.getElementById('desk'),
    taskbar: document.getElementById('desk-taskbar'),
    ctx,
    layout: savedOrDefaultLayout(),
  });

  document.getElementById('desk-reset')?.addEventListener('click', () => {
    if (desk.editing) return;
    desk.resetView(savedOrDefaultLayout());
  });

  registerAdminUiRefreshHandler(syncEditorWithSession);
  syncEditorWithSession(isAdmin());
}

startPage(init);

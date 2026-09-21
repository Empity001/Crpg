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
// Solo se puede editar si la disposición guardada se cargó de verdad. Si la
// carga falla, la pantalla muestra la composición inicial y guardar encima
// pisaría la portada real.
let savedLayoutLoaded = false;

// Nunca lanza: si lo guardado no se puede leer, se muestra la composición inicial.
const savedOrDefaultLayout = () => {
  try { return normalizeLayout(state.homeLayout) || defaultLayout(); } catch (error) {
    console.warn('[Portada] La disposición guardada no es válida:', error);
    return defaultLayout();
  }
};

async function ensureEditor() {
  if (editor || editorLoading || !desk || !isAdmin()) return;
  editorLoading = import('../desk/editor.js')
    .then((module) => {
      if (!isAdmin()) return; // se cerró la sesión mientras cargaba el editor
      editor = module.initEditor({
        desk,
        stage: document.getElementById('desk-shell'),
        getSaved: savedOrDefaultLayout,
        canEdit: () => savedLayoutLoaded,
      });
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
  const pending = loadAppSettings('home');
  try {
    savedLayoutLoaded = (await withTimeout(pending, 5000, 'La configuración de la portada')) === true;
  } catch (error) {
    console.warn('[Portada] Se usa la disposición predeterminada:', error);
    // Si la carga termina más tarde, se coloca lo guardado y se habilita el editor.
    pending.then((ok) => {
      if (ok !== true) return;
      savedLayoutLoaded = true;
      if (desk && !desk.editing) desk.resetView(savedOrDefaultLayout());
      editor?.refresh();
    }).catch(() => {});
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

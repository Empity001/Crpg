// =========================================================
// include.js
// =========================================================
// Carga fragmentos HTML compartidos (partials/header.html,
// partials/footer.html) e los inyecta en placeholders del documento.
// Es el mecanismo que permite reutilizar el header, la barra de
// navegación, el modal de login y los toasts entre TODAS las páginas
// sin duplicar ese HTML en cada archivo .html del proyecto.
// =========================================================

async function loadPartial(url, targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    el.innerHTML = await res.text();
  } catch (err) {
    console.error(`[include] No se pudo cargar ${url}:`, err);
  }
}

// Carga en paralelo el header y el footer compartidos. Se espera que
// cada página tenga <div id="shell-header"></div> justo después de
// <body> y <div id="shell-footer"></div> justo antes de los <script>
// finales.

export async function loadSharedShell() {
  await Promise.all([
    loadPartial('partials/header.html', 'shell-header'),
    loadPartial('partials/footer.html', 'shell-footer'),
  ]);
}

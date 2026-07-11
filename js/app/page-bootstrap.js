// Shared entry-point bootstrap for every application page.

function showPageBootError(error) {
  console.error('[Boot] Error al iniciar la pagina:', error);

  if (document.getElementById('boot-error-panel')) return;
  const main = document.querySelector('.app-main') || document.body;
  const panel = document.createElement('section');
  panel.id = 'boot-error-panel';
  panel.className = 'boot-error-panel';
  panel.innerHTML = `
    <strong>No se pudo iniciar esta pagina</strong>
    <p>Recarga con Ctrl + F5. Si continua, revisa la consola del navegador o la conexion con Supabase.</p>
    <button type="button">Recargar</button>`;
  panel.querySelector('button')?.addEventListener('click', () => window.location.reload());
  main.prepend(panel);
}

export function startPage(init) {
  const run = () => Promise.resolve()
    .then(init)
    .catch(showPageBootError);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    void run();
  }
}

// =========================================================
// boot-watchdog.js
// =========================================================
// Respaldo mínimo independiente de los módulos ES. Si un archivo quedó en
// caché, falta en el despliegue o el navegador no puede resolver el grafo de
// imports, evita que el usuario vea una pantalla vacía indefinidamente.
// =========================================================
(() => {
  const TIMEOUT_MS = 12000;
  let timer = null;

  function clearWatchdog() {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  }

  function showBootFailure() {
    if (document.documentElement.dataset.shellReady === 'true') return;
    if (document.getElementById('boot-watchdog-panel')) return;

    const panel = document.createElement('section');
    panel.id = 'boot-watchdog-panel';
    panel.setAttribute('role', 'alert');
    panel.style.cssText = [
      'position:fixed',
      'z-index:2147483600',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'width:min(520px,calc(100vw - 32px))',
      'padding:24px',
      'border:1px solid rgba(139,61,255,.55)',
      'border-radius:18px',
      'background:#111528',
      'color:#f5f3ff',
      'font:15px/1.55 system-ui,sans-serif',
      'box-shadow:0 24px 80px rgba(0,0,0,.55)',
    ].join(';');
    panel.innerHTML = `
      <strong style="display:block;font-size:20px;margin-bottom:8px">La página no terminó de iniciar</strong>
      <p style="margin:0 0 18px;color:#aaa6c5">Puede haber archivos antiguos en caché o una dependencia que no se descargó. Haz una recarga completa.</p>
      <button type="button" style="width:100%;min-height:44px;border:0;border-radius:11px;background:#8b3dff;color:white;font-weight:700;cursor:pointer">Recargar sin caché</button>`;
    panel.querySelector('button')?.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.set('_reload', Date.now().toString());
      window.location.replace(url.toString());
    }, { once: true });
    document.body?.appendChild(panel);
  }

  window.addEventListener('culones:boot-ready', clearWatchdog, { once: true });
  window.addEventListener('pagehide', clearWatchdog, { once: true });
  timer = window.setTimeout(showBootFailure, TIMEOUT_MS);
})();

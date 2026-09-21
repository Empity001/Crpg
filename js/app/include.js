// =========================================================
// include.js — carga robusta de los fragmentos compartidos
// =========================================================

async function fetchTextWithTimeout(url, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    window.clearTimeout(timer);
  }
}

async function loadPartial(url, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return false;
  try {
    target.innerHTML = await fetchTextWithTimeout(url);
    return true;
  } catch (error) {
    console.error(`[include] No se pudo cargar ${url}:`, error);
    target.dataset.partialFailed = 'true';
    return false;
  }
}

let sharedShellPromise = null;

export function loadSharedShell() {
  if (!sharedShellPromise) {
    sharedShellPromise = Promise.all([
      loadPartial('partials/header.html?v=20260921-3', 'shell-header'),
      loadPartial('partials/footer.html?v=20260921-2', 'shell-footer'),
    ]).then(([headerLoaded, footerLoaded]) => ({ headerLoaded, footerLoaded }));
  }
  return sharedShellPromise;
}

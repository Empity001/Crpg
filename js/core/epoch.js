// =========================================================
// core/epoch.js
// =========================================================
// La web empezó de cero el 2026-09-21: sin contenido ni datos de versiones
// anteriores. Los visitantes que ya habían entrado guardan en su navegador cosas
// del sitio viejo (tema local, novedades, preferencias, "me gusta"). La primera
// vez que cargan esta versión se borra todo eso, una sola vez, y se anota la
// época. Se conserva únicamente la sesión de inicio de sesión de Supabase.
//
// Para volver a empezar de cero en el futuro basta con cambiar SITE_EPOCH.
// =========================================================

const SITE_EPOCH = '2026-09-21-en-blanco';
const EPOCH_KEY = 'culones_site_epoch';
const KEEP = new Set([EPOCH_KEY, 'culones-rpg-auth']);

try {
  if (window.localStorage.getItem(EPOCH_KEY) !== SITE_EPOCH) {
    Object.keys(window.localStorage)
      .filter((key) => /^culones/i.test(key) && !KEEP.has(key))
      .forEach((key) => window.localStorage.removeItem(key));
    window.localStorage.setItem(EPOCH_KEY, SITE_EPOCH);
  }
} catch {
  /* sin acceso al almacenamiento (modo privado, permisos): no hay nada que limpiar */
}

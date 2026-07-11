// =========================================================
// shell.js
// =========================================================
// Arranque compartido por TODAS las páginas de la aplicación
// (index.html, guides.html, tierlist.html, about.html, admin.html).
// Se encarga de:
//   1. Inyectar el header/nav/footer compartidos (partials/).
//   2. Marcar la pestaña activa según la página actual.
//   3. Cablear el modal de login de admin (compartido por el botón
//      ADMIN del header).
//   4. Delegación global para abrir imágenes en pantalla completa
//      (usada por prácticamente todas las páginas: logs, tierlist,
//      armas, about, fondo, favicon...).
//   5. Cargar app_settings (fondo, favicon, config de fichas, bloques
//      de "about") — son datos globales que afectan a todas las
//      páginas por igual (el fondo/favicon se aplican siempre).
//   6. Refrescar la UI dependiente de si hay sesión de admin activa.
//
// Cada página, después de llamar a `bootShell(pageKey)`, solo debe
// cablear los modales y cargar los datos que le pertenecen a ELLA
// (logs, tierlist, armas...), nunca los de otra sección.
// =========================================================

import { loadSharedShell } from './include.js';
import { closeAdminLoginModal, initializeDiscordAuth, logoutDiscord, openAdminLoginModal, prepareAdminLoginModal, signInWithDiscord, toggleAdminMode, updateAdminUI } from '../features/auth.js';
import { loadAppSettings } from '../features/field-config.js';
import { isAdmin, state } from '../core/state.js';
import { openAssetFullscreen } from '../core/storage.js';
import { registerModalLifecycleCleanup, setupModalLifecycleObserver, withTimeout } from '../core/utils.js';
import { initCommandCenter } from '../features/command-center.js';

let modalVisualCleanupsRegistered = false;
let shellBootPromise = null;
let shellListenersController = null;
let globalSearchModulePromise = null;
let visitorPreferencesModulePromise = null;
let notificationsModulePromise = null;

const PAGE_HERO_COPY = {
  logs: {
    eyebrow: 'Registro del servidor',
    title: 'Centro de Logs',
    normal: 'Explora los eventos, cambios y mecánicas más importantes del servidor.',
    admin: 'Explora y administra los eventos, cambios y mecánicas más importantes del servidor.',
  },
  guides: {
    eyebrow: 'Catálogo y progresión',
    title: 'Guías del servidor',
    normal: 'Consulta armas, objetos, rangos, estadísticas y formas de obtención.',
    admin: 'Consulta y administra armas, objetos, rangos, estadísticas y formas de obtención.',
  },
  tierlist: {
    eyebrow: 'Clasificación oficial',
    title: 'Tierlist',
    normal: 'Compara armas, subarmas y accesorios organizados por su rendimiento.',
    admin: 'Organiza y administra las posiciones de armas, subarmas y accesorios.',
  },
  kits: {
    eyebrow: 'Combinaciones recomendadas',
    title: 'Kits',
    normal: 'Descubre combinaciones de arma, accesorio y subarma preparadas para el servidor.',
    admin: 'Crea y administra combinaciones de arma, accesorio y subarma para el servidor.',
  },
  about: {
    eyebrow: 'Nuestra comunidad',
    title: 'Acerca del servidor',
    normal: 'Conoce el mundo, la comunidad y la identidad detrás de Culones-RPG.',
    admin: 'Conoce y administra la información pública que representa a Culones-RPG.',
  },
  admin: {
    eyebrow: 'Gestión completa',
    title: 'Herramientas',
    normal: 'Área privada de administración del servidor.',
    admin: 'Administra recursos, copias de seguridad, borradores y ajustes globales del sitio.',
  },
};

function ensurePageHero(pageKey) {
  const panel = document.querySelector('.tab-panel.is-active') || document.querySelector('.tab-panel');
  const copy = PAGE_HERO_COPY[pageKey];
  if (!panel || !copy || panel.querySelector('.page-hero')) return;

  const hero = document.createElement('section');
  hero.className = 'page-hero';
  hero.setAttribute('aria-labelledby', `page-title-${pageKey}`);
  hero.innerHTML = `
    <div class="page-hero-copy">
      <span class="page-hero-eyebrow">${copy.eyebrow}</span>
      <h1 id="page-title-${pageKey}">${copy.title}<span class="hero-spark" aria-hidden="true">✦</span></h1>
      <p><span class="hero-copy-normal">${copy.normal}</span><span class="hero-copy-admin">${copy.admin}</span></p>
    </div>
    <div class="page-hero-art" aria-hidden="true">
      <span class="hero-moon"></span>
      <span class="hero-castle"></span>
      <span class="hero-flag"></span>
    </div>`;
  panel.prepend(hero);
}

function wireMobileSidebar() {
  const toggle = document.getElementById('sidebar-menu-toggle');
  const scrim = document.getElementById('sidebar-scrim');
  const sidebar = document.getElementById('app-sidebar');
  const tabs = sidebar?.querySelector('.browser-tabs');
  const normalizeDrawerScroll = () => {
    if (!tabs) return;
    // Al cambiar entre escritorio y drawer el navegador puede conservar
    // un scroll vertical antiguo. En alturas intermedias eso deja el
    // menú situado sobre el espacio flexible y parece que las pestañas
    // desaparecieron. Cada apertura siempre empieza desde el principio.
    tabs.scrollLeft = 0;
    tabs.scrollTop = 0;
  };
  const close = () => {
    document.body.classList.remove('sidebar-open');
    toggle?.setAttribute('aria-expanded', 'false');
    normalizeDrawerScroll();
  };
  const switchState = () => {
    const open = !document.body.classList.contains('sidebar-open');
    document.body.classList.toggle('sidebar-open', open);
    toggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      normalizeDrawerScroll();
      window.requestAnimationFrame(normalizeDrawerScroll);
    }
  };

  toggle?.addEventListener('click', switchState);
  scrim?.addEventListener('click', close);
  document.querySelectorAll('.tab-item').forEach(item => item.addEventListener('click', close));
  window.addEventListener('resize', () => {
    if (window.innerWidth > 900) {
      close();
      return;
    }

    // Si el drawer sigue abierto mientras la ventana cambia de tamaño,
    // recalculamos su posición y evitamos que conserve un scroll inválido.
    if (document.body.classList.contains('sidebar-open')) {
      window.requestAnimationFrame(normalizeDrawerScroll);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) close();
  });
}


function registerModalVisualCleanups() {
  if (modalVisualCleanupsRegistered) return;
  modalVisualCleanupsRegistered = true;

  [
    ['admin-modal', { onClose: closeAdminLoginModal }],
    ['app-confirm-modal', { resetTextSelectors: ['#app-confirm-title', '#app-confirm-message', '#app-confirm-accept'] }],
    ['media-picker-modal', { clearSelectors: ['#media-picker-grid'] }],
    ['media-confirm-modal', { clearSelectors: ['#media-confirm-preview', '#media-confirm-usage'] }],
    ['media-external-modal', { clearSelectors: ['#media-external-preview'], resetTextSelectors: ['#media-external-status'] }],
    ['media-edit-modal', { clearSelectors: ['#media-edit-preview'] }],
    ['action-log-modal', { clearSelectors: ['#action-log-list'] }],
    ['import-conflict-modal', { clearSelectors: ['#import-conflict-list'], resetTextSelectors: ['#import-conflict-summary'] }],
    ['detail-modal', { clearSelectors: ['#detail-content', '#comments-list'] }],
    ['log-modal', { clearSelectors: ['#draft-blocks-list'] }],
    ['category-modal', { clearSelectors: ['#category-manage-list'] }],
    ['field-config-modal', { clearSelectors: ['#fieldcfg-mob-list', '#fieldcfg-item-list'] }],
    ['mob-modal', { clearSelectors: ['#mob-equipment-list', '#mob-extra-fields-list'], assetPreviewPrefixes: ['mob'] }],
    ['item-modal', { clearSelectors: ['#item-enchant-list', '#item-extra-fields-list'], assetPreviewPrefixes: ['item'] }],
    ['libre-modal', { clearSelectors: ['#libre-fields-list'], assetPreviewPrefixes: ['libre'] }],
    ['tier-item-modal', { assetPreviewPrefixes: ['tier-item'] }],
    ['tier-move-modal', { resetTextSelectors: ['#tier-move-item-name'] }],
    ['kit-modal', { clearSelectors: ['#kit-columns-editor'] }],
    ['weapon-modal', { assetPreviewPrefixes: ['weapon'] }],
    ['weapon-category-modal', { clearSelectors: ['#weapon-category-manage-list'] }],
    ['weapon-type-modal', { clearSelectors: ['#weapon-type-manage-list'] }],
    ['weapon-rank-modal', { assetPreviewPrefixes: ['weapon-rank'] }],
    ['weapon-stats-modal', { clearSelectors: ['#weapon-stats-list'] }],
    ['weapon-ability-modal', { clearSelectors: ['#weapon-ability-stats-list'] }],
    ['weapon-recipe-modal', { clearSelectors: ['#weapon-recipe-materials-list'], resetTextSelectors: ['#weapon-recipe-result-img-name'], hideSelectors: ['#weapon-recipe-result-img-name'] }],
    ['weapon-section-modal', { clearSelectors: ['#weapon-section-fields-list'] }],
    ['about-editor-modal', { clearSelectors: ['#about-blocks-editor'] }],
  ].forEach(([id, config]) => registerModalLifecycleCleanup(id, config));
}

function wireHeaderNav(pageKey) {
  document.querySelectorAll('.tab-item').forEach(tab => {
    const active = tab.dataset.page === pageKey;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  const pathEl = document.getElementById('active-tab-path');
  if (pathEl) pathEl.textContent = pageKey;
}

function wireAdminModal() {
  document.getElementById('admin-toggle-btn')?.addEventListener('click', () => {
    if (!state.authSession || !state.discordAdminEligible) openAdminLoginModal();
    else void toggleAdminMode();
  });
  document.getElementById('close-admin-modal')?.addEventListener('click', closeAdminLoginModal);
  document.getElementById('discord-login-btn')?.addEventListener('click', () => {
    void signInWithDiscord().catch(error => console.error('[Auth] OAuth:', error));
  });
  document.getElementById('discord-logout-btn')?.addEventListener('click', () => {
    void logoutDiscord();
  });
  document.getElementById('discord-admin-mode-btn')?.addEventListener('click', () => {
    void toggleAdminMode();
  });
  document.addEventListener('click', (e) => {
    const overlay = e.target.closest?.('.modal-overlay');
    if (!overlay || e.target !== overlay) return;
    e.preventDefault();
  });
}

function wireAssetFullscreenDelegation() {
  document.addEventListener('click', (e) => {
    const assetEl = e.target.closest('.js-open-asset');
    if (assetEl) openAssetFullscreen(assetEl.dataset.assetSrc, assetEl.dataset.assetTitle);
  });
}

// pageKey: 'logs' | 'guides' | 'tierlist' | 'kits' | 'about' | 'admin'
// Devuelve una promesa que se resuelve cuando el shell está listo
// (header/footer inyectados, admin UI actualizada, app_settings
// cargados). Cada página debe `await`earla antes de cablear lo suyo.

function initVisitorTools() {
  if (!visitorPreferencesModulePromise) {
    visitorPreferencesModulePromise = import('../features/user-preferences.js')
      .then(module => { module.initUserPreferences(); return module; })
      .catch(error => {
        visitorPreferencesModulePromise = null;
        console.warn('[VisitorPreferences] No se pudo iniciar:', error);
      });
  }

  const schedule = window.requestIdleCallback || (callback => window.setTimeout(callback, 800));
  schedule(() => {
    if (notificationsModulePromise) return;
    notificationsModulePromise = import('../features/notifications.js')
      .then(module => { module.initSiteNotifications(); return module; })
      .catch(error => {
        notificationsModulePromise = null;
        console.warn('[Notifications] No se pudo iniciar:', error);
      });
  }, { timeout: 2200 });
}

function loadGlobalSearchModule() {
  if (!globalSearchModulePromise) {
    globalSearchModulePromise = import('../features/global-search.js')
      .then(module => {
        module.initGlobalSearch();
        return module;
      })
      .catch(error => {
        globalSearchModulePromise = null;
        console.error('[GlobalSearch] No se pudo cargar:', error);
        throw error;
      });
  }
  return globalSearchModulePromise;
}

function wireLazyGlobalSearch() {
  if (shellListenersController) return;
  shellListenersController = new AbortController();
  const { signal } = shellListenersController;

  // El buscador no se importa al arrancar. Solo se descarga cuando se pulsa
  // la lupa. Ctrl/Cmd + K pasa por command-center.js y termina haciendo clic
  // en este mismo control; así todos los atajos se resuelven en un único
  // lugar y ninguna combinación puede disparar dos acciones.
  document.addEventListener('click', event => {
    const trigger = event.target instanceof Element
      ? event.target.closest('[data-global-search-toggle]')
      : null;
    if (!trigger) return;
    const root = trigger.closest('[data-global-search-root]');
    if (!root || root.dataset.searchReady === 'true') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    loadGlobalSearchModule()
      .then(module => {
        root.dataset.searchReady = 'true';
        module.openGlobalSearch(root);
      })
      .catch(() => {});
  }, { capture: true, signal });

  window.addEventListener('pagehide', () => {
    shellListenersController?.abort();
    shellListenersController = null;
  }, { once: true });
}

export function bootShell(pageKey) {
  if (shellBootPromise) return shellBootPromise;

  shellBootPromise = (async () => {
    state.activeTab = pageKey;
    // Activa el layout específico desde el primer frame, antes de cualquier red.
    if (document.body) document.body.dataset.page = pageKey;
    await withTimeout(loadSharedShell(), 6500, 'La interfaz compartida');
    prepareAdminLoginModal();
    registerModalVisualCleanups();
    setupModalLifecycleObserver();
    document.body.dataset.page = pageKey;
    wireHeaderNav(pageKey);
    ensurePageHero(pageKey);
    wireMobileSidebar();
    wireAdminModal();
    wireAssetFullscreenDelegation();
    wireLazyGlobalSearch();
    initCommandCenter(pageKey);
    initVisitorTools();
    await initializeDiscordAuth();
    updateAdminUI();

    // Los valores locales/predeterminados se aplican de forma síncrona al
    // iniciar loadAppSettings(). La consulta remota continúa en segundo plano:
    // nunca debe bloquear el header, la navegación ni la carga de la página.
    void loadAppSettings().catch(error => {
      console.warn('[Boot] Se usará la configuración visual local:', error);
    });

    document.documentElement.dataset.shellReady = 'true';
    window.dispatchEvent(new Event('culones:boot-ready'));
    return true;
  })().catch(error => {
    shellBootPromise = null;
    throw error;
  });

  return shellBootPromise;
}

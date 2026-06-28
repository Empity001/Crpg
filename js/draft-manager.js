// =========================================================
// CULONES-RPG · DraftManager (js/draft-manager.js)
// =========================================================
// Módulo de borradores híbrido: localStorage como buffer
// inmediato + Supabase como persistencia entre dispositivos.
//
// FILOSOFÍA DE DISEÑO:
//   - Cero dependencias externas — usa supabaseClient global
//     definido en config.js, igual que el resto de la app.
//   - API uniforme: cualquier editor futuro (categorías,
//     configuración de fichas, etc.) puede incorporar drafts
//     con 3 llamadas: init(), markDirty(), teardown().
//   - Nunca lanza excepciones al caller — todos los errores
//     de red/storage se absorben y loguean internamente para
//     no interrumpir el flujo del editor.
//
// USO BÁSICO DESDE app.js:
//
//   // Al abrir un editor:
//   const draft = DraftManager.init({
//     entityType: 'log',
//     entityId:   logId || 'new',
//     adminCode:  state.adminCode,
//     getPayload: () => collectLogFormData(),   // función que serializa el form
//     onRestore:  (payload) => fillLogForm(payload),
//     onDirtyChange: (isDirty) => updateDraftStatusBar(isDirty),
//   });
//
//   // Cuando el usuario cambia algo en el form:
//   draft.markDirty();
//
//   // Guardar borrador manualmente:
//   await draft.saveNow();
//
//   // Al publicar o cerrar el editor:
//   await draft.teardown({ discard: true }); // discard=true borra el draft
//   await draft.teardown({ discard: false }); // discard=false solo para el autosave
// =========================================================

const DraftManager = (() => {

  // ---------------------------------------------------------
  // CONSTANTES
  // ---------------------------------------------------------
  const AUTOSAVE_INTERVAL_MS  = 30_000; // 30 segundos
  const DEBOUNCE_MS           = 2_000;  // espera 2s tras el último cambio antes de autoguardar
  const LS_PREFIX             = 'culones_draft_';

  // ---------------------------------------------------------
  // ESTADO INTERNO DEL MÓDULO
  // (no expuesto — los controladores de cada instancia
  //  se manejan a través del objeto que devuelve init())
  // ---------------------------------------------------------

  // ---------------------------------------------------------
  // HELPERS PRIVADOS
  // ---------------------------------------------------------

  function lsKey(entityType, entityId) {
    return `${LS_PREFIX}${entityType}_${entityId}`;
  }

  function lsMetaKey(entityType, entityId) {
    return `${LS_PREFIX}meta_${entityType}_${entityId}`;
  }

  // Guarda en localStorage. Nunca lanza.
  function lsSave(entityType, entityId, payload) {
    try {
      const key     = lsKey(entityType, entityId);
      const metaKey = lsMetaKey(entityType, entityId);
      localStorage.setItem(key, JSON.stringify(payload));
      localStorage.setItem(metaKey, JSON.stringify({ savedAt: new Date().toISOString() }));
    } catch (e) {
      console.warn('[DraftManager] localStorage write failed:', e);
    }
  }

  // Lee desde localStorage. Devuelve null si no hay nada.
  function lsLoad(entityType, entityId) {
    try {
      const raw = localStorage.getItem(lsKey(entityType, entityId));
      if (!raw) return null;
      const meta = JSON.parse(localStorage.getItem(lsMetaKey(entityType, entityId)) || 'null');
      return { payload: JSON.parse(raw), savedAt: meta?.savedAt || null };
    } catch (e) {
      return null;
    }
  }

  // Borra de localStorage.
  function lsDelete(entityType, entityId) {
    try {
      localStorage.removeItem(lsKey(entityType, entityId));
      localStorage.removeItem(lsMetaKey(entityType, entityId));
    } catch (e) {}
  }

  // Guarda en Supabase (async, silencioso — no bloquea el UI).
  async function sbSave(adminCode, entityType, entityId, payload) {
    if (!adminCode) return null;
    try {
      const { data, error } = await supabaseClient.rpc('upsert_draft', {
        input_code:        adminCode,
        input_entity_type: entityType,
        input_entity_id:   entityId,
        input_payload:     payload,
      });
      if (error) {
        console.warn('[DraftManager] Supabase save failed:', error.message);
        return null;
      }
      return data; // { entity_type, entity_id, saved_at }
    } catch (e) {
      console.warn('[DraftManager] Supabase save exception:', e);
      return null;
    }
  }

  // Lee desde Supabase.
  async function sbLoad(adminCode, entityType, entityId) {
    if (!adminCode) return null;
    try {
      const { data, error } = await supabaseClient.rpc('get_draft', {
        input_code:        adminCode,
        input_entity_type: entityType,
        input_entity_id:   entityId,
      });
      if (error) {
        console.warn('[DraftManager] Supabase load failed:', error.message);
        return null;
      }
      return data; // { payload, saved_at, entity_id } o null
    } catch (e) {
      return null;
    }
  }

  // Borra desde Supabase.
  async function sbDelete(adminCode, entityType, entityId) {
    if (!adminCode) return;
    try {
      await supabaseClient.rpc('delete_draft', {
        input_code:        adminCode,
        input_entity_type: entityType,
        input_entity_id:   entityId,
      });
    } catch (e) {
      console.warn('[DraftManager] Supabase delete failed:', e);
    }
  }

  // Formatea "hace N minutos/segundos" a partir de un ISO string.
  function timeAgo(isoString) {
    if (!isoString) return null;
    const diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (diff < 5)  return 'hace un momento';
    if (diff < 60) return `hace ${diff}s`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `hace ${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `hace ${hrs}h`;
  }

  // ---------------------------------------------------------
  // init() — punto de entrada principal
  // Devuelve un controlador de instancia con métodos públicos.
  // ---------------------------------------------------------
  function init({ entityType, entityId, adminCode, getPayload, onRestore, onDirtyChange }) {

    // Estado de esta instancia concreta
    let isDirty          = false;
    let lastSavedAt      = null;   // ISO string del último guardado exitoso
    let autosaveTimer    = null;   // setInterval handle
    let debounceTimer    = null;   // setTimeout handle para debounce
    let beforeUnloadBound = false;
    let destroyed        = false;

    // Handler de beforeunload — guardado de emergencia en localStorage
    function beforeUnloadHandler(e) {
      if (!isDirty || destroyed) return;
      try {
        const payload = getPayload();
        lsSave(entityType, entityId, payload);
      } catch (_) {}
      e.preventDefault();
      e.returnValue = '¿Salir? Hay cambios sin guardar en el borrador.';
      return e.returnValue;
    }

    function attachBeforeUnload() {
      if (beforeUnloadBound) return;
      window.addEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadBound = true;
    }

    function detachBeforeUnload() {
      if (!beforeUnloadBound) return;
      window.removeEventListener('beforeunload', beforeUnloadHandler);
      beforeUnloadBound = false;
    }

    function setDirty(value) {
      const changed = isDirty !== value;
      isDirty = value;
      if (value) attachBeforeUnload();
      else       detachBeforeUnload();
      if (changed && onDirtyChange) onDirtyChange(isDirty, lastSavedAt);
    }

    // Autosave periódico
    function startAutosave() {
      if (autosaveTimer) clearInterval(autosaveTimer);
      autosaveTimer = setInterval(async () => {
        if (!isDirty || destroyed) return;
        await saveNow({ silent: true });
      }, AUTOSAVE_INTERVAL_MS);
    }

    function stopAutosave() {
      if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
      if (debounceTimer) { clearTimeout(debounceTimer);  debounceTimer = null; }
    }

    // ---------------------------------------------------------
    // GUARDAR (interno y externo)
    // ---------------------------------------------------------
    async function saveNow({ silent = false } = {}) {
      if (destroyed) return;
      let payload;
      try { payload = getPayload(); } catch (e) {
        console.warn('[DraftManager] getPayload() threw:', e);
        return;
      }

      // 1. localStorage primero (síncrono, siempre funciona)
      lsSave(entityType, entityId, payload);

      // 2. Supabase async (puede fallar sin romper nada)
      const result = await sbSave(adminCode, entityType, entityId, payload);

      lastSavedAt = (result?.saved_at) || new Date().toISOString();
      setDirty(false);

      if (!silent && onDirtyChange) onDirtyChange(false, lastSavedAt);
    }

    // ---------------------------------------------------------
    // VERIFICAR SI EXISTE BORRADOR AL ABRIR EL EDITOR
    // Estrategia: localStorage tiene prioridad (más reciente),
    // Supabase como fallback. Combina ambos eligiendo el más nuevo.
    // ---------------------------------------------------------
    async function checkForExistingDraft() {
      const lsDraft = lsLoad(entityType, entityId);
      const sbDraft = await sbLoad(adminCode, entityType, entityId);

      // Determinar cuál es más reciente
      let best = null;

      if (lsDraft && sbDraft) {
        const lsDate = new Date(lsDraft.savedAt || 0);
        const sbDate = new Date(sbDraft.saved_at || 0);
        best = lsDate >= sbDate
          ? { payload: lsDraft.payload, savedAt: lsDraft.savedAt }
          : { payload: sbDraft.payload, savedAt: sbDraft.saved_at };
      } else if (lsDraft) {
        best = { payload: lsDraft.payload, savedAt: lsDraft.savedAt };
      } else if (sbDraft) {
        best = { payload: sbDraft.payload, savedAt: sbDraft.saved_at };
      }

      return best; // null si no hay borrador
    }

    // ---------------------------------------------------------
    // DESCARTAR
    // ---------------------------------------------------------
    async function discardDraft() {
      lsDelete(entityType, entityId);
      await sbDelete(adminCode, entityType, entityId);
      lastSavedAt = null;
      setDirty(false);
    }

    // ---------------------------------------------------------
    // TEARDOWN — llamar siempre al cerrar el editor
    // discard: true  → borra el borrador (cuando el admin publica)
    // discard: false → deja el borrador (cierra sin publicar)
    // ---------------------------------------------------------
    async function teardown({ discard = false } = {}) {
      if (destroyed) return;
      destroyed = true;
      stopAutosave();
      detachBeforeUnload();
      if (discard) {
        await discardDraft();
      } else if (isDirty) {
        // Guardar en localStorage antes de cerrar (Supabase async no garantiza timing)
        try {
          const payload = getPayload();
          lsSave(entityType, entityId, payload);
        } catch (_) {}
      }
    }

    // ---------------------------------------------------------
    // API PÚBLICA DEL CONTROLADOR DE INSTANCIA
    // ---------------------------------------------------------
    return {
      /** Marca el editor como modificado y programa el autoguardado con debounce. */
      markDirty() {
        if (destroyed) return;
        setDirty(true);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => saveNow({ silent: true }), DEBOUNCE_MS);
      },

      /** Guarda inmediatamente (llamado por el botón "Guardar borrador"). */
      saveNow,

      /** Revisa si hay borrador existente. Devuelve { payload, savedAt } o null. */
      checkForExistingDraft,

      /** Restaura un payload en el editor. */
      restore(payload) {
        if (onRestore) onRestore(payload);
        // El editor queda "limpio" después de restaurar — todavía no hay nuevos cambios
        setDirty(false);
      },

      /** Descarta el borrador de Supabase y localStorage. */
      discardDraft,

      /** Limpia timers y listeners. Siempre llamar al cerrar el editor. */
      teardown,

      /** Devuelve el texto "Guardado hace N min" o null. */
      getLastSavedText() {
        return timeAgo(lastSavedAt);
      },

      /** True si hay cambios sin guardar. */
      isDirty() { return isDirty; },

      /** Inicia el ciclo de autoguardado periódico. */
      startAutosave,
    };
  }

  // ---------------------------------------------------------
  // API PÚBLICA DEL MÓDULO
  // ---------------------------------------------------------
  return { init, timeAgo };

})();

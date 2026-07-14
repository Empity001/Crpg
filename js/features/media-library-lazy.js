// Cargador diferido de la Biblioteca Multimedia.
// Evita descargar el módulo completo (y sus dependencias administrativas)
// en páginas públicas hasta que una herramienta realmente lo necesita.

let mediaLibraryPromise = null;

function loadMediaLibrary() {
  if (!mediaLibraryPromise) {
    mediaLibraryPromise = import('./media-library.js').catch(error => {
      mediaLibraryPromise = null;
      console.error('[MediaLibrary] No se pudo cargar:', error);
      throw error;
    });
  }
  return mediaLibraryPromise;
}

export function openMediaPicker(options) {
  return loadMediaLibrary().then(module => module.openMediaPicker(options));
}

export function attachMediaPickerButton(options) {
  return loadMediaLibrary().then(module => module.attachMediaPickerButton(options));
}

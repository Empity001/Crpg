// =========================================================
// CONFIGURACIÓN DE SUPABASE
// =========================================================
// La anon key es pública; la seguridad real depende de RLS y las RPC.
// Nunca coloques aquí la service_role key.
// =========================================================

const SUPABASE_URL = 'https://xuaeaebypcggoqwgshjy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_JTg72e9jfhMLYOErILzLVw_Ohd2bYmk';

function createUnavailableQuery(message) {
  const response = Promise.resolve({ data: [], error: { message } });
  const methods = new Set([
    'select', 'insert', 'update', 'upsert', 'delete', 'order', 'eq', 'neq',
    'in', 'is', 'not', 'or', 'filter', 'limit', 'range', 'single',
    'maybeSingle', 'match', 'contains', 'containedBy', 'overlaps', 'abortSignal',
  ]);
  return new Proxy({}, {
    get(_target, property) {
      if (property === 'then') return response.then.bind(response);
      if (property === 'catch') return response.catch.bind(response);
      if (property === 'finally') return response.finally.bind(response);
      if (methods.has(property)) return () => createUnavailableQuery(message);
      return undefined;
    },
  });
}

function createUnavailableClient(message) {
  const channel = {
    on() { return this; },
    subscribe(callback) { callback?.('CHANNEL_ERROR'); return this; },
    unsubscribe() { return Promise.resolve('ok'); },
  };
  return {
    from: () => createUnavailableQuery(message),
    rpc: () => createUnavailableQuery(message),
    channel: () => channel,
    removeChannel: () => Promise.resolve('ok'),
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: { message } }),
        update: () => Promise.resolve({ data: null, error: { message } }),
        remove: () => Promise.resolve({ data: null, error: { message } }),
        list: () => Promise.resolve({ data: [], error: { message } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}

const factory = window.supabase?.createClient;
export const supabaseClient = typeof factory === 'function'
  ? factory(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Este proyecto usa su propio código de administrador y no Supabase Auth.
      // Entregar directamente la anon key evita inicializar GoTrue, BroadcastChannel
      // y listeners de sesión que no se usan.
      accessToken: async () => SUPABASE_ANON_KEY,
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        skipAutoInitialize: true,
      },
      db: { timeout: 12000 },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-client-info': 'culones-rpg-web' } },
    })
  : createUnavailableClient('No se pudo cargar el cliente local de Supabase.');

export const supabaseAvailable = typeof factory === 'function';


/**
 * PostgREST reintenta automáticamente los GET fallidos. Durante una caída de
 * red eso multiplicaba peticiones, listeners y memoria. Las cargas de interfaz
 * usan esta función para fallar una sola vez y dejar visible un estado de error.
 */
export function disableQueryRetry(request) {
  if (typeof request?.retry === 'function') return request.retry(false);
  return request;
}

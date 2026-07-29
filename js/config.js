// =========================================================
// CONFIGURACIÓN DE SUPABASE
// =========================================================
// La anon key es pública. La seguridad real depende de RLS y de la
// Edge Function discord-admin-api, que valida la sesión y el rol de
// Discord antes de cualquier escritura administrativa.
// =========================================================

export const SUPABASE_URL = 'https://xuaeaebypcggoqwgshjy.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_JTg72e9jfhMLYOErILzLVw_Ohd2bYmk';
export const DISCORD_ADMIN_FUNCTION = 'discord-admin-api';
export const NETWORK_ADMIN_FUNCTION = 'network-admin-api';
export const NETWORK_PUBLIC_FUNCTION = 'network-public-api';
export const OFFICIAL_SITE_URL = 'https://empity001.github.io/empi-network/';

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
  const authResponse = Promise.resolve({ data: { session: null, user: null }, error: { message } });
  return {
    from: () => createUnavailableQuery(message),
    rpc: () => createUnavailableQuery(message),
    channel: () => channel,
    removeChannel: () => Promise.resolve('ok'),
    auth: {
      getSession: () => authResponse,
      getUser: () => authResponse,
      signInWithOAuth: () => authResponse,
      signOut: () => authResponse,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    functions: {
      invoke: () => Promise.resolve({ data: null, error: { message } }),
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: { message } }),
        uploadToSignedUrl: () => Promise.resolve({ data: null, error: { message } }),
        update: () => Promise.resolve({ data: null, error: { message } }),
        remove: () => Promise.resolve({ data: null, error: { message } }),
        list: () => Promise.resolve({ data: [], error: { message } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
      }),
    },
  };
}

const factory = window.supabase?.createClient;
const rawClient = typeof factory === 'function'
  ? factory(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
        storageKey: 'culones-rpg-auth',
      },
      db: { timeout: 12000 },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { headers: { 'x-client-info': 'culones-rpg-web' } },
    })
  : createUnavailableClient('No se pudo cargar el cliente local de Supabase.');

const secureRpcInFlight = new Map();

/**
 * Las RPC legacy todavía reciben `input_code` en su firma. Mientras la
 * migración elimina gradualmente esas firmas, cualquier llamada que incluya
 * un valor truthy en `input_code` se envía a la Edge Function segura. La
 * función valida Discord y ejecuta la RPC con service_role; el navegador
 * nunca conoce un código ni una clave privilegiada.
 */
async function secureRpc(name, args = {}) {
  const cleanArgs = { ...args };
  delete cleanArgs.input_code;
  // Un doble clic o dos módulos solicitando la misma lectura en el mismo
  // instante comparten petición. Para escrituras esto también funciona como
  // barrera de idempotencia mientras la primera llamada sigue pendiente.
  const requestKey = `${name}:${JSON.stringify(cleanArgs)}`;
  if (secureRpcInFlight.has(requestKey)) return secureRpcInFlight.get(requestKey);

  const request = (async () => {
    const { data, error } = await rawClient.functions.invoke(DISCORD_ADMIN_FUNCTION, {
      body: { action: 'rpc', rpc_name: name, params: cleanArgs },
    });
    if (error) {
      let remote = null;
      if (error.context && typeof error.context.clone === 'function') {
        try { remote = await error.context.clone().json(); } catch { /* sin cuerpo JSON */ }
      }
      const payload = remote?.error || remote;
      return { data: null, error: payload || error };
    }
    if (data?.error) return { data: data.data ?? null, error: data.error };
    return { data: data?.data ?? data ?? null, error: null };
  })().finally(() => secureRpcInFlight.delete(requestKey));

  secureRpcInFlight.set(requestKey, request);
  return request;
}

export const supabaseClient = new Proxy(rawClient, {
  get(target, property, receiver) {
    if (property === 'rpc') {
      return (name, args = {}, options) => {
        if (args && Object.prototype.hasOwnProperty.call(args, 'input_code')) {
          if (args.input_code) return secureRpc(name, args);
          return target.rpc(name, { ...args, input_code: null }, options);
        }
        return target.rpc(name, args, options);
      };
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});

export function disableQueryRetry(request) {
  if (typeof request?.retry === 'function') return request.retry(false);
  return request;
}

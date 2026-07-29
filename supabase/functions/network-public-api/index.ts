import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const WRITABLE_TYPES = new Set([
  'text', 'long_text', 'rich_text', 'number', 'boolean', 'date', 'datetime',
  'select', 'multi_select', 'url', 'email', 'color', 'minecraft_uuid', 'discord_id',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function failure(message: string, code: string, status = 400) {
  return json({ error: { message, code } }, status);
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta el secreto ${name}.`);
  return value;
}

function cleanText(value: unknown, max: number) {
  return String(value ?? '').trim().slice(0, max);
}

function uuid(value: unknown, label: string) {
  const result = cleanText(value, 64);
  if (!UUID_PATTERN.test(result)) throw Object.assign(new Error(`${label} inválido.`), { code: 'ID_INVALID', status: 400 });
  return result;
}

function cleanPayload(value: unknown) {
  let encoded = '';
  try { encoded = JSON.stringify(value); } catch { /* handled below */ }
  if (!encoded || encoded.length > 40_000 || /"(?:__proto__|prototype|constructor)"\s*:/.test(encoded)) {
    throw Object.assign(new Error('Los datos del formulario no son válidos.'), { code: 'FORM_DATA_INVALID', status: 400 });
  }
  const parsed = JSON.parse(encoded);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw Object.assign(new Error('Los datos del formulario deben ser un objeto.'), { code: 'FORM_DATA_INVALID', status: 400 });
  }
  return parsed as Record<string, unknown>;
}

function optionValues(settings: Record<string, unknown>) {
  return new Set((Array.isArray(settings.options) ? settings.options : []).slice(0, 200).map(raw => {
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return cleanText((raw as Record<string, unknown>).value, 500);
    return cleanText(raw, 500);
  }).filter(Boolean));
}

function normalizeField(field: any, raw: unknown) {
  const type = String(field.field_type || 'text');
  if (!WRITABLE_TYPES.has(type)) {
    if (field.required) throw Object.assign(new Error(`El campo ${field.display_name} todavía no admite entrada pública.`), { code: 'FIELD_TYPE_UNSUPPORTED', status: 409 });
    return undefined;
  }
  if (type === 'boolean') return raw === true || raw === 'true' || raw === 'on' || raw === 1 || raw === '1';
  if (type === 'number') {
    if (raw == null || raw === '') return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw Object.assign(new Error(`${field.display_name} debe ser un número.`), { code: 'FIELD_INVALID', status: 400 });
    return value;
  }
  if (type === 'multi_select') {
    const values = (Array.isArray(raw) ? raw : raw == null || raw === '' ? [] : [raw]).slice(0, 50).map(item => cleanText(item, 500)).filter(Boolean);
    const allowed = optionValues(field.settings || {});
    if (allowed.size && values.some(value => !allowed.has(value))) throw Object.assign(new Error(`${field.display_name} contiene una opción no permitida.`), { code: 'FIELD_INVALID', status: 400 });
    return values;
  }
  const max = type === 'rich_text' || type === 'long_text' ? 20_000 : 2_000;
  const value = cleanText(raw, max);
  if (type === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw Object.assign(new Error(`${field.display_name} no es un correo válido.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'url' && value) {
    try { const parsed = new URL(value); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol'); } catch { throw Object.assign(new Error(`${field.display_name} no es una URL válida.`), { code: 'FIELD_INVALID', status: 400 }); }
  }
  if (type === 'color' && value && !/^#[0-9a-f]{6}$/i.test(value)) throw Object.assign(new Error(`${field.display_name} no es un color válido.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'minecraft_uuid' && value && !/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(value)) throw Object.assign(new Error(`${field.display_name} no es un UUID de Minecraft válido.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'discord_id' && value && !/^\d{15,22}$/.test(value)) throw Object.assign(new Error(`${field.display_name} no es un ID de Discord válido.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'date' && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Object.assign(new Error(`${field.display_name} no es una fecha válida.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'datetime' && value && !Number.isFinite(Date.parse(value))) throw Object.assign(new Error(`${field.display_name} no es una fecha y hora válidas.`), { code: 'FIELD_INVALID', status: 400 });
  if (type === 'select') {
    const allowed = optionValues(field.settings || {});
    if (allowed.size && value && !allowed.has(value)) throw Object.assign(new Error(`${field.display_name} contiene una opción no permitida.`), { code: 'FIELD_INVALID', status: 400 });
  }
  return value;
}

async function fingerprint(request: Request, siteId: string) {
  const forwarded = cleanText(request.headers.get('x-forwarded-for')?.split(',')[0], 100);
  const source = forwarded || cleanText(request.headers.get('cf-connecting-ip'), 100) || 'unknown';
  const agent = cleanText(request.headers.get('user-agent'), 300);
  const bytes = new TextEncoder().encode(`${siteId}:${source}:${agent}:${env('SUPABASE_SERVICE_ROLE_KEY').slice(-24)}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return failure('Método no permitido.', 'METHOD_NOT_ALLOWED', 405);

  try {
    const body = await request.json();
    const siteId = uuid(body?.site_id, 'Sitio');
    const collectionId = uuid(body?.collection_id, 'Colección');
    const requestId = uuid(body?.request_id, 'Solicitud');
    const startedAt = Number(body?.started_at);
    if (cleanText(body?.website, 200)) return failure('Solicitud rechazada.', 'FORM_SPAM', 400);
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < 800 || Date.now() - startedAt > 21_600_000) {
      return failure('El formulario expiró. Recarga la página e inténtalo de nuevo.', 'FORM_EXPIRED', 409);
    }

    const rawData = cleanPayload(body?.data);
    const service = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: collection, error: collectionError } = await service.from('site_collections')
      .select('id,site_id,status,visibility,settings')
      .eq('id', collectionId).eq('site_id', siteId).eq('status', 'active')
      .eq('visibility', 'public').is('deleted_at', null).single();
    if (collectionError || !collection || collection.settings?.allowPublicSubmissions !== true) {
      return failure('Este formulario no está aceptando respuestas.', 'FORM_NOT_AVAILABLE', 404);
    }

    const { data: fields, error: fieldsError } = await service.from('site_collection_fields').select('*')
      .eq('site_id', siteId).eq('collection_id', collectionId).order('position');
    if (fieldsError || !fields?.length) return failure('El formulario no tiene campos disponibles.', 'FORM_FIELDS_MISSING', 409);
    if (fields.length > 40) return failure('El formulario supera el límite de campos públicos.', 'FORM_FIELD_LIMIT', 409);

    const allowedKeys = new Set(fields.map(field => field.field_key));
    if (Object.keys(rawData).some(key => !allowedKeys.has(key))) return failure('El formulario contiene campos desconocidos.', 'FORM_FIELD_UNKNOWN', 400);
    const normalized: Record<string, unknown> = {};
    for (const field of fields) {
      const value = normalizeField(field, rawData[field.field_key]);
      const missing = value == null || value === '' || (Array.isArray(value) && !value.length);
      if (field.required && missing) return failure(`Completa el campo ${field.display_name}.`, 'FORM_FIELD_REQUIRED', 400);
      if (value !== undefined) normalized[field.field_key] = value;
    }
    if (JSON.stringify(normalized).length > 40_000) return failure('La respuesta es demasiado grande.', 'FORM_DATA_LIMIT', 413);

    let authUserId: string | null = null;
    const bearer = cleanText(request.headers.get('authorization'), 3000).replace(/^Bearer\s+/i, '');
    if (bearer) {
      const { data: authData } = await service.auth.getUser(bearer);
      authUserId = authData.user?.id || null;
    }
    const searchable = fields.filter(field => field.searchable).map(field => normalized[field.field_key])
      .flatMap(value => Array.isArray(value) ? value : [value]).filter(value => value != null).join(' ').slice(0, 12_000);
    const { data, error } = await service.rpc('network_submit_collection_form', {
      input_site_id: siteId,
      input_collection_id: collectionId,
      input_data: normalized,
      input_search_text: searchable,
      input_request_id: requestId,
      input_fingerprint: await fingerprint(request, siteId),
      input_auth_user_id: authUserId,
    });
    if (error) {
      if (error.message?.includes('FORM_RATE_LIMIT')) return failure('Has enviado demasiadas respuestas. Inténtalo de nuevo más tarde.', 'FORM_RATE_LIMIT', 429);
      if (error.message?.includes('FORM_NOT_AVAILABLE')) return failure('Este formulario no está aceptando respuestas.', 'FORM_NOT_AVAILABLE', 404);
      throw error;
    }
    return json({ data }, 201);
  } catch (error: any) {
    console.error('[network-public-api]', error);
    return failure(cleanText(error?.message || 'No se pudo enviar el formulario.', 600), error?.code || 'PUBLIC_API_ERROR', error?.status || 500);
  }
});

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SITE_STATUSES = new Set(['draft', 'active', 'maintenance', 'archived', 'suspended']);
const NAV_POSITIONS = new Set(['top', 'bottom', 'left', 'right', 'floating', 'hero', 'drawer', 'hidden']);
const SEARCH_POSITIONS = new Set(['header', 'navigation', 'sidebar', 'hero', 'block', 'floating', 'dock', 'overlay', 'palette', 'hidden']);
const PAGE_STATUSES = new Set(['draft', 'published', 'archived']);
const MODULE_STATUSES = new Set(['draft', 'active', 'disabled', 'archived']);
const COLLECTION_STATUSES = new Set(['draft', 'active', 'archived']);
const COLLECTION_VISIBILITIES = new Set(['public', 'authenticated', 'private']);
const FIELD_TYPES = new Set([
  'text', 'long_text', 'rich_text', 'number', 'boolean', 'date', 'datetime', 'select', 'multi_select',
  'image', 'file', 'url', 'email', 'color', 'relation', 'user', 'minecraft_uuid', 'discord_id', 'formula', 'json',
]);
const BLOCK_TYPES = new Set([
  'section', 'container', 'stack', 'grid', 'columns', 'card', 'heading', 'text', 'button', 'image',
  'spacer', 'divider', 'badge', 'stat', 'link-list', 'collection-view', 'form', 'embed', 'navigation', 'search',
]);
const OWNER_FALLBACK_ID = '726444396970770494';
const CULONES_SITE_ID = '00000000-0000-4000-8000-000000000001';
const CULONES_LEGACY_PAGE_ID = '00000000-0000-4000-8000-000000000201';
const MAX_DOCUMENT_BYTES = 750_000;
const MAX_DOCUMENT_NODES = 600;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function failure(message: string, code: string, status = 400, details: unknown = null) {
  return json({ error: { message, code, details } }, status);
}

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw Object.assign(new Error(`Falta el secreto ${name}.`), { code: 'ENV_MISSING', status: 500 });
  return value;
}

function text(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function optionalText(value: unknown, max = 500) {
  return text(value, max) || null;
}

function absoluteWebUrl(value: unknown, optional = true) {
  const raw = text(value, 500);
  if (!raw && optional) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return parsed.toString();
  } catch {
    throw Object.assign(new Error('La URL pública debe comenzar con http:// o https://.'), {
      code: 'PUBLIC_URL_INVALID', status: 400,
    });
  }
}

function navigationUrl(value: unknown) {
  const raw = text(value || '#', 500);
  if (raw.startsWith('//')) throw new Error('protocol-relative');
  try {
    const parsed = new URL(raw, 'https://empi-network.invalid/');
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('protocol');
    return raw;
  } catch {
    throw Object.assign(new Error(`URL de tab no permitida: ${raw.slice(0, 80)}`), {
      code: 'NAVIGATION_URL_INVALID', status: 400,
    });
  }
}

function snowflake(value: unknown, required = false) {
  const result = text(value, 22);
  if (!result && !required) return null;
  if (!/^\d{15,22}$/.test(result)) {
    throw Object.assign(new Error('El ID de Discord debe ser un snowflake numérico válido.'), {
      code: 'DISCORD_ID_INVALID', status: 400,
    });
  }
  return result;
}

function slug(value: unknown) {
  const result = text(value, 64).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) {
    throw Object.assign(new Error('El slug solo puede contener minúsculas, números y guiones simples.'), {
      code: 'SLUG_INVALID', status: 400,
    });
  }
  return result;
}

function uuid(value: unknown, label = 'ID') {
  const result = text(value, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result)) {
    throw Object.assign(new Error(`${label} inválido.`), { code: 'ID_INVALID', status: 400 });
  }
  return result;
}

function object(value: unknown, fallback: Record<string, unknown> = {}) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
}

function boolean(value: unknown, fallback = false) {
  return value == null ? fallback : value === true || value === 'true';
}

function integer(value: unknown, min: number, max: number, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function key(value: unknown, label = 'Clave', max = 64) {
  const result = text(value, max).toLowerCase();
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(result)) {
    throw Object.assign(new Error(`${label} inválida. Usa letras minúsculas, números, guion o guion bajo.`), {
      code: 'KEY_INVALID', status: 400,
    });
  }
  return result;
}

function safeJson(value: unknown, label = 'Configuración', maxBytes = 200_000) {
  const result = value == null ? {} : value;
  if (typeof result !== 'object' || Array.isArray(result)) {
    throw Object.assign(new Error(`${label} debe ser un objeto.`), { code: 'JSON_OBJECT_REQUIRED', status: 400 });
  }
  const encoded = JSON.stringify(result);
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) {
    throw Object.assign(new Error(`${label} supera el tamaño permitido.`), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  }
  if (/"(?:__proto__|prototype|constructor)"\s*:/.test(encoded)) {
    throw Object.assign(new Error(`${label} contiene una propiedad no permitida.`), { code: 'JSON_KEY_FORBIDDEN', status: 400 });
  }
  return result as Record<string, unknown>;
}

function pageDocument(value: unknown) {
  const doc = safeJson(value, 'El documento de página', MAX_DOCUMENT_BYTES);
  if (Number(doc.schemaVersion) !== 1 || !['page', 'legacy'].includes(String(doc.kind || 'page'))) {
    throw Object.assign(new Error('Versión o tipo de documento no compatible.'), { code: 'DOCUMENT_VERSION_INVALID', status: 400 });
  }
  if (doc.kind === 'legacy') {
    const legacyUrl = text(doc.legacyUrl, 160);
    if (!/^[a-z0-9][a-z0-9/_-]*\.html(?:#[a-z0-9_-]+)?$/i.test(legacyUrl) || legacyUrl.includes('..')) {
      throw Object.assign(new Error('La página heredada debe apuntar a un HTML local permitido.'), {
        code: 'LEGACY_URL_INVALID', status: 400,
      });
    }
    return { schemaVersion: 1, kind: 'legacy', legacyUrl, nodes: [] };
  }
  if (!Array.isArray(doc.nodes)) {
    throw Object.assign(new Error('El documento necesita una lista de bloques.'), { code: 'DOCUMENT_NODES_REQUIRED', status: 400 });
  }
  let count = 0;
  const ids = new Set<string>();
  const visit = (raw: unknown, depth: number) => {
    if (depth > 16) throw Object.assign(new Error('La página tiene demasiados niveles anidados.'), { code: 'DOCUMENT_DEPTH_LIMIT', status: 400 });
    const node = object(raw);
    count += 1;
    if (count > MAX_DOCUMENT_NODES) throw Object.assign(new Error('La página supera el límite de bloques.'), { code: 'DOCUMENT_NODE_LIMIT', status: 400 });
    const id = text(node.id, 80);
    const type = text(node.type, 40);
    if (!/^[a-zA-Z0-9_-]{3,80}$/.test(id) || ids.has(id)) {
      throw Object.assign(new Error('Cada bloque necesita un ID único y válido.'), { code: 'DOCUMENT_NODE_ID_INVALID', status: 400 });
    }
    if (!BLOCK_TYPES.has(type)) {
      throw Object.assign(new Error(`Tipo de bloque no permitido: ${type || '(vacío)'}.`), { code: 'DOCUMENT_BLOCK_INVALID', status: 400 });
    }
    ids.add(id);
    safeJson(node.props || {}, `Propiedades de ${id}`, 80_000);
    if (node.children != null && !Array.isArray(node.children)) {
      throw Object.assign(new Error(`Los hijos de ${id} deben ser una lista.`), { code: 'DOCUMENT_CHILDREN_INVALID', status: 400 });
    }
    for (const child of (Array.isArray(node.children) ? node.children : [])) visit(child, depth + 1);
  };
  for (const node of doc.nodes) visit(node, 0);
  return doc;
}

function validateCustomCss(value: unknown) {
  const css = text(value, 30_000);
  if (!css) return '';
  if (/@import|javascript\s*:|expression\s*\(|behavior\s*:|<\/?(?:script|style)/i.test(css)) {
    throw Object.assign(new Error('El CSS personalizado contiene una construcción no permitida.'), {
      code: 'CUSTOM_CSS_UNSAFE', status: 400,
    });
  }
  return css;
}

function discordIdentity(user: any) {
  const identity = (user?.identities || []).find((item: any) => item.provider === 'discord');
  const data = identity?.identity_data || user?.user_metadata || {};
  const candidates = [
    data.provider_id,
    data.sub,
    user?.user_metadata?.provider_id,
    user?.user_metadata?.sub,
  ].map(value => text(value, 64));
  const discordId = candidates.find(value => /^\d{15,22}$/.test(value)) || '';
  return {
    discordId,
    username: text(data.user_name || data.username || user?.user_metadata?.user_name || 'Usuario', 80),
    displayName: text(data.full_name || data.global_name || data.name || data.user_name || 'Usuario', 100),
    avatarUrl: text(data.avatar_url || user?.user_metadata?.avatar_url || '', 600),
  };
}

function validateNavigation(value: unknown) {
  const config = safeJson(value, 'La navegación');
  for (const breakpoint of ['desktop', 'tablet', 'mobile']) {
    const entry = object(config[breakpoint]);
    if (entry.position && !NAV_POSITIONS.has(String(entry.position))) {
      throw Object.assign(new Error(`Posición de navegación inválida para ${breakpoint}.`), {
        code: 'NAVIGATION_INVALID', status: 400,
      });
    }
  }
  if (config.items != null && !Array.isArray(config.items)) {
    throw Object.assign(new Error('Los tabs deben enviarse como una lista.'), {
      code: 'NAVIGATION_ITEMS_INVALID', status: 400,
    });
  }
  const items = (Array.isArray(config.items) ? config.items : []).slice(0, 100).map((rawItem, index) => {
    const item = object(rawItem);
    const label = text(item.label || item.key, 80);
    const key = text(item.key || `tab-${index + 1}`, 64).toLowerCase();
    if (!label || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key)) {
      throw Object.assign(new Error('Cada tab necesita una etiqueta y una clave válida.'), {
        code: 'NAVIGATION_ITEM_INVALID', status: 400,
      });
    }
    const children = (Array.isArray(item.children) ? item.children : []).slice(0, 30).map((rawChild, childIndex) => {
      const child = object(rawChild);
      const childLabel = text(child.label || `Subtab ${childIndex + 1}`, 80);
      return {
        key: text(child.key || `${key}-${childIndex + 1}`, 64).toLowerCase().replace(/[^a-z0-9_-]/g, '-'),
        label: childLabel,
        url: navigationUrl(child.url),
        icon: text(child.icon, 32),
      };
    });
    return {
      key,
      label,
      url: navigationUrl(item.url),
      icon: text(item.icon, 32),
      pageId: item.pageId ? uuid(item.pageId, 'Página de navegación') : null,
      visible: item.visible !== false,
      sticky: item.sticky === true,
      requiredRole: optionalText(item.requiredRole, 48),
      children,
    };
  });
  config.items = items;
  return config;
}

function validateSearch(value: unknown) {
  const config = safeJson(value, 'La búsqueda');
  if (config.position && !SEARCH_POSITIONS.has(String(config.position))) {
    throw Object.assign(new Error('La posición de búsqueda no es válida.'), {
      code: 'SEARCH_INVALID', status: 400,
    });
  }
  if (config.sources != null && !Array.isArray(config.sources)) {
    throw Object.assign(new Error('Las fuentes de búsqueda deben enviarse como una lista.'), {
      code: 'SEARCH_SOURCES_INVALID', status: 400,
    });
  }
  config.sources = (Array.isArray(config.sources) ? config.sources : [])
    .map(value => text(value, 80)).filter(Boolean).slice(0, 50);
  config.weights = Object.fromEntries(Object.entries(object(config.weights)).slice(0, 100).map(([field, weight]) => [
    text(field, 80), Math.max(0, Math.min(20, Number(weight) || 0)),
  ]).filter(([field]) => !!field));
  config.synonyms = (Array.isArray(config.synonyms) ? config.synonyms : []).slice(0, 100).map(raw => {
    const row = object(raw);
    return {
      term: text(row.term, 80),
      alternatives: (Array.isArray(row.alternatives) ? row.alternatives : []).map(value => text(value, 80)).filter(Boolean).slice(0, 20),
    };
  }).filter(row => row.term && row.alternatives.length);
  config.filters = (Array.isArray(config.filters) ? config.filters : []).map(value => text(value, 80)).filter(Boolean).slice(0, 50);
  config.groupBy = optionalText(config.groupBy, 80);
  config.renderer = text(config.renderer || 'default', 40);
  const breakpoints = object(config.breakpoints);
  config.breakpoints = Object.fromEntries(['desktop', 'tablet', 'mobile'].map(name => {
    const entry = object(breakpoints[name]);
    const position = text(entry.position || 'inherit', 30);
    if (position !== 'inherit' && !SEARCH_POSITIONS.has(position)) {
      throw Object.assign(new Error(`La posición de búsqueda para ${name} no es válida.`), { code: 'SEARCH_INVALID', status: 400 });
    }
    return [name, { position, visible: entry.visible !== false }];
  }));
  return config;
}

function validateTheme(value: unknown) {
  const config = safeJson(value, 'La apariencia');
  const palette = object(config.palette);
  const defaults: Record<string, string> = {
    background: '#050505', surface: '#101010', elevated: '#171717', text: '#ffffff', muted: '#a3a3a3',
    accent: '#ffffff', secondary: '#d4d4d4', border: '#303030', selection: '#ffffff',
    success: '#2fd18a', info: '#38bdf8', warning: '#f6c453', event: '#f472b6', danger: '#ef4444', disabled: '#525252',
  };
  const normalized: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const color = text(palette[key] || fallback, 7).toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) {
      throw Object.assign(new Error(`Color inválido en ${key}. Usa formato #RRGGBB.`), {
        code: 'THEME_COLOR_INVALID', status: 400,
      });
    }
    normalized[key] = color;
  }
  const typography = object(config.typography);
  const density = object(config.density);
  const motion = object(config.motion);
  const assets = object(config.assets);
  return {
    ...config,
    mode: text(config.mode || 'custom', 20),
    palette: normalized,
    typography: {
      body: text(typography.body || 'Inter, system-ui, sans-serif', 180),
      heading: text(typography.heading || 'Inter, system-ui, sans-serif', 180),
      mono: text(typography.mono || 'ui-monospace, monospace', 180),
      scale: Math.max(0.75, Math.min(1.5, Number(typography.scale) || 1)),
      lineHeight: Math.max(1.1, Math.min(2, Number(typography.lineHeight) || 1.5)),
    },
    density: {
      spacing: Math.max(0.5, Math.min(2, Number(density.spacing) || 1)),
      radius: Math.max(0, Math.min(48, Number(density.radius) || 16)),
      borderWidth: Math.max(0, Math.min(6, Number(density.borderWidth) || 1)),
    },
    motion: {
      enabled: motion.enabled !== false,
      duration: Math.max(0, Math.min(1200, Number(motion.duration) || 220)),
      easing: text(motion.easing || 'ease', 60),
    },
    assets: {
      logo: absoluteWebUrl(assets.logo, true),
      favicon: absoluteWebUrl(assets.favicon, true),
      background: absoluteWebUrl(assets.background, true),
      banner: absoluteWebUrl(assets.banner, true),
    },
    customCss: validateCustomCss(config.customCss),
  };
}

async function authenticate(req: Request) {
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Inicia sesión con Discord.'), { code: 'AUTH_REQUIRED', status: 401 });

  const supabaseUrl = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    throw Object.assign(new Error('La sesión expiró. Vuelve a iniciar sesión.'), { code: 'AUTH_INVALID', status: 401 });
  }

  const identity = discordIdentity(data.user);
  if (!identity.discordId) {
    throw Object.assign(new Error('La sesión no contiene una identidad Discord válida.'), {
      code: 'DISCORD_IDENTITY_MISSING', status: 403,
    });
  }

  const configuredOwner = text(Deno.env.get('PLATFORM_OWNER_DISCORD_ID') || OWNER_FALLBACK_ID, 22);
  const { data: ownerRow, error: ownerError } = await service
    .from('platform_owners')
    .select('discord_user_id,active')
    .eq('discord_user_id', identity.discordId)
    .eq('active', true)
    .maybeSingle();
  if (ownerError) throw ownerError;

  return {
    service,
    user: data.user,
    identity,
    isOwner: identity.discordId === configuredOwner && !!ownerRow,
  };
}

function requireOwner(ctx: Awaited<ReturnType<typeof authenticate>>) {
  if (!ctx.isOwner) {
    throw Object.assign(new Error('Esta operación está reservada al Owner de Empi Network.'), {
      code: 'PLATFORM_OWNER_REQUIRED', status: 403,
    });
  }
}

async function audit(ctx: Awaited<ReturnType<typeof authenticate>>, fields: Record<string, unknown>) {
  const { error } = await ctx.service.from('site_audit_log').insert({
    site_id: fields.site_id || null,
    auth_user_id: ctx.user.id,
    discord_user_id: ctx.identity.discordId,
    actor_mode: 'platform_owner',
    action: text(fields.action, 120),
    entity_type: optionalText(fields.entity_type, 80),
    entity_id: optionalText(fields.entity_id, 160),
    old_value: fields.old_value ?? null,
    new_value: fields.new_value ?? null,
    metadata: object(fields.metadata),
    success: fields.success !== false,
  });
  if (error) console.error('[network-admin-api] No se pudo registrar auditoría:', error.message);
}

async function listSites(ctx: Awaited<ReturnType<typeof authenticate>>) {
  const { data, error } = await ctx.service
    .from('sites')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createSite(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const name = text(body.name, 100);
  if (!name) throw Object.assign(new Error('Indica el nombre del servidor.'), { code: 'NAME_REQUIRED', status: 400 });
  const args = {
    input_name: name,
    input_slug: slug(body.slug),
    input_discord_guild_id: snowflake(body.discord_guild_id) || '',
    input_public_base_url: absoluteWebUrl(body.public_base_url) || '',
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  };
  const { data, error } = await ctx.service.rpc('network_create_site', args);
  if (error) throw error;
  return data;
}

async function updateSite(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data: before, error: beforeError } = await ctx.service
    .from('sites').select('*').eq('id', siteId).single();
  if (beforeError) throw beforeError;

  const patch: Record<string, unknown> = {};
  if (body.name != null) {
    const name = text(body.name, 100);
    if (!name) throw Object.assign(new Error('El nombre no puede quedar vacío.'), { code: 'NAME_REQUIRED', status: 400 });
    patch.name = name;
  }
  if (body.description != null) patch.description = text(body.description, 1000);
  if (body.slug != null) patch.slug = slug(body.slug);
  if (body.status != null) {
    const status = text(body.status, 30);
    if (!SITE_STATUSES.has(status)) throw Object.assign(new Error('Estado de sitio inválido.'), { code: 'STATUS_INVALID', status: 400 });
    patch.status = status;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'discord_guild_id')) patch.discord_guild_id = snowflake(body.discord_guild_id);
  if (Object.prototype.hasOwnProperty.call(body, 'public_base_url')) patch.public_base_url = absoluteWebUrl(body.public_base_url);
  if (body.theme_config != null) patch.theme_config = validateTheme(body.theme_config);
  if (body.navigation_config != null) patch.navigation_config = validateNavigation(body.navigation_config);
  if (body.search_config != null) patch.search_config = validateSearch(body.search_config);
  if (!Object.keys(patch).length) return before;

  if (siteId === CULONES_SITE_ID) {
    if (patch.slug != null && patch.slug !== 'culones-rpg') {
      throw Object.assign(new Error('El slug de Culones RPG está protegido para conservar sus enlaces.'), {
        code: 'CULONES_SLUG_PROTECTED', status: 409,
      });
    }
    if (patch.status != null && patch.status !== 'active') {
      throw Object.assign(new Error('Culones RPG debe permanecer activo durante la migración.'), {
        code: 'CULONES_STATUS_PROTECTED', status: 409,
      });
    }
  }

  const { data: updated, error } = await ctx.service.rpc('network_update_site', {
    input_site_id: siteId,
    input_patch: patch,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
    input_reason: text(body.reason || 'Actualización desde Owner', 300),
  });
  if (error) throw error;
  return updated;
}

async function archiveSite(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  if (siteId === CULONES_SITE_ID) {
    throw Object.assign(new Error('Culones RPG está protegido y no puede archivarse.'), { code: 'CULONES_PROTECTED', status: 409 });
  }
  const { data: site, error: siteError } = await ctx.service.from('sites').select('id,slug,name,deleted_at').eq('id', siteId).single();
  if (siteError) throw siteError;
  if (text(body.confirm_slug, 64) !== site.slug) {
    throw Object.assign(new Error(`Escribe ${site.slug} para confirmar el archivado.`), { code: 'CONFIRMATION_REQUIRED', status: 409 });
  }
  const { data, error } = await ctx.service.rpc('network_archive_site', {
    input_site_id: siteId,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
    input_reason: text(body.reason || 'Archivada desde Owner', 500),
  });
  if (error) throw error;
  return data;
}

async function restoreSite(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.rpc('network_restore_site', {
    input_site_id: siteId,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  });
  if (error) throw error;
  return data;
}

async function listThemeVersions(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.from('site_theme_versions').select(
    'id,site_id,version_number,stage,reason,created_by_discord_id,created_at',
  ).eq('site_id', siteId).order('version_number', { ascending: false }).limit(100);
  if (error) throw error;
  return data || [];
}

async function saveTheme(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const theme = validateTheme(body.theme_config);
  const { data, error } = await ctx.service.rpc('network_save_theme', {
    input_site_id: siteId,
    input_theme_config: theme,
    input_publish: body.publish === true,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
    input_reason: text(body.reason || (body.publish === true ? 'Publicación visual desde Owner' : 'Borrador visual desde Owner'), 300),
  });
  if (error) throw error;
  return data;
}

async function restoreThemeVersion(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const versionNumber = integer(body.version_number, 1, Number.MAX_SAFE_INTEGER, -1);
  if (versionNumber < 1) throw Object.assign(new Error('Versión visual inválida.'), { code: 'THEME_VERSION_INVALID', status: 400 });
  const { data, error } = await ctx.service.rpc('network_restore_theme_version', {
    input_site_id: siteId,
    input_version_number: versionNumber,
    input_publish: body.publish === true,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  });
  if (error) throw error;
  return data;
}

async function listPages(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.from('site_pages').select(
    'id,site_id,slug,name,title,description,status,is_home,sort_order,seo_config,access_config,created_at,updated_at,published_at,deleted_at',
  ).eq('site_id', siteId).is('deleted_at', null).order('sort_order').order('created_at');
  if (error) throw error;
  return data || [];
}

async function getPage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  const [pageResult, versionsResult] = await Promise.all([
    ctx.service.from('site_pages').select('*').eq('id', pageId).eq('site_id', siteId).is('deleted_at', null).single(),
    ctx.service.from('site_page_versions').select(
      'id,site_id,page_id,version_number,stage,metadata,reason,created_by_discord_id,created_at',
    ).eq('page_id', pageId).eq('site_id', siteId).order('version_number', { ascending: false }).limit(100),
  ]);
  if (pageResult.error) throw pageResult.error;
  if (versionsResult.error) throw versionsResult.error;
  return { page: pageResult.data, versions: versionsResult.data || [] };
}

async function createPage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const name = text(body.name, 100);
  if (!name) throw Object.assign(new Error('Indica el nombre de la página.'), { code: 'PAGE_NAME_REQUIRED', status: 400 });
  const { data, error } = await ctx.service.rpc('network_create_page', {
    input_site_id: siteId,
    input_name: name,
    input_slug: slug(body.slug),
    input_is_home: boolean(body.is_home),
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  });
  if (error) throw error;
  return data;
}

async function savePage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  if (siteId === CULONES_SITE_ID && pageId === CULONES_LEGACY_PAGE_ID) {
    throw Object.assign(new Error('La página heredada de Culones RPG está protegida. Su archivo logs.html no se modifica desde el constructor.'), {
      code: 'CULONES_LEGACY_PROTECTED', status: 409,
    });
  }
  const patch: Record<string, unknown> = {};
  if (body.name != null) {
    const name = text(body.name, 100);
    if (!name) throw Object.assign(new Error('El nombre de la página no puede quedar vacío.'), { code: 'PAGE_NAME_REQUIRED', status: 400 });
    patch.name = name;
  }
  if (body.title != null) {
    const title = text(body.title, 160);
    if (!title) throw Object.assign(new Error('El título de la página no puede quedar vacío.'), { code: 'PAGE_TITLE_REQUIRED', status: 400 });
    patch.title = title;
  }
  if (body.slug != null) patch.slug = slug(body.slug);
  if (body.description != null) patch.description = text(body.description, 1000);
  if (body.is_home != null) patch.is_home = boolean(body.is_home);
  if (body.sort_order != null) patch.sort_order = integer(body.sort_order, -100000, 100000);
  if (body.draft_document != null) patch.draft_document = pageDocument(body.draft_document);
  if (body.seo_config != null) patch.seo_config = safeJson(body.seo_config, 'SEO', 30_000);
  if (body.access_config != null) patch.access_config = safeJson(body.access_config, 'Acceso', 30_000);
  if (!Object.keys(patch).length) {
    const { data, error } = await ctx.service.from('site_pages').select('*').eq('id', pageId).eq('site_id', siteId).single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await ctx.service.rpc('network_save_page', {
    input_page_id: pageId,
    input_site_id: siteId,
    input_patch: patch,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
    input_reason: text(body.reason || 'Guardado desde el constructor', 300),
  });
  if (error) throw error;
  return data;
}

async function publishPage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  if (siteId === CULONES_SITE_ID && pageId === CULONES_LEGACY_PAGE_ID) {
    throw Object.assign(new Error('La página heredada de Culones RPG ya se publica desde logs.html y está protegida.'), {
      code: 'CULONES_LEGACY_PROTECTED', status: 409,
    });
  }
  const { data, error } = await ctx.service.rpc('network_publish_page', {
    input_page_id: pageId,
    input_site_id: siteId,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
    input_reason: text(body.reason || 'Publicación desde el constructor', 300),
  });
  if (error) throw error;
  return data;
}

async function restorePageVersion(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  const versionNumber = integer(body.version_number, 1, Number.MAX_SAFE_INTEGER, -1);
  if (versionNumber < 1) throw Object.assign(new Error('Versión inválida.'), { code: 'VERSION_INVALID', status: 400 });
  const { data, error } = await ctx.service.rpc('network_restore_page_version', {
    input_page_id: pageId,
    input_site_id: siteId,
    input_version_number: versionNumber,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  });
  if (error) throw error;
  return data;
}

async function archivePage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  if (siteId === CULONES_SITE_ID && pageId === CULONES_LEGACY_PAGE_ID) {
    throw Object.assign(new Error('La página heredada de Culones RPG está protegida y no puede archivarse.'), {
      code: 'CULONES_LEGACY_PROTECTED', status: 409,
    });
  }
  const { data: page, error: pageError } = await ctx.service.from('site_pages').select('*')
    .eq('id', pageId).eq('site_id', siteId).is('deleted_at', null).single();
  if (pageError) throw pageError;
  if (page.is_home) throw Object.assign(new Error('Asigna otra página como inicio antes de archivar esta.'), { code: 'HOME_PAGE_PROTECTED', status: 409 });
  const { data, error } = await ctx.service.from('site_pages').update({ status: 'archived', deleted_at: new Date().toISOString() })
    .eq('id', pageId).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'page.archive', entity_type: 'site_page', entity_id: pageId, old_value: page, new_value: data });
  return data;
}

async function duplicatePage(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const pageId = uuid(body.page_id, 'Página');
  const { data: source, error: sourceError } = await ctx.service.from('site_pages').select('*')
    .eq('id', pageId).eq('site_id', siteId).is('deleted_at', null).single();
  if (sourceError) throw sourceError;
  const name = text(body.name || `${source.name} copia`, 100);
  const newSlug = slug(body.slug);
  const created = await createPage(ctx, { site_id: siteId, name, slug: newSlug, is_home: false });
  return await savePage(ctx, {
    site_id: siteId,
    page_id: created.id,
    name,
    title: text(body.title || `${source.title} copia`, 160),
    slug: newSlug,
    description: source.description,
    draft_document: source.draft_document,
    seo_config: source.seo_config,
    access_config: source.access_config,
    reason: `Duplicada desde ${source.slug}`,
  });
}

async function listComponents(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.from('site_reusable_components').select('*')
    .eq('site_id', siteId).is('deleted_at', null).order('display_name');
  if (error) throw error;
  return data || [];
}

async function upsertComponent(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const componentId = body.component_id ? uuid(body.component_id, 'Componente') : crypto.randomUUID();
  if (body.component_id) {
    const { data: existing, error: existingError } = await ctx.service.from('site_reusable_components')
      .select('id').eq('id', componentId).eq('site_id', siteId).single();
    if (existingError || !existing) throw existingError || new Error('El componente no pertenece a la instancia.');
  }
  const row = {
    id: componentId,
    site_id: siteId,
    component_key: key(body.component_key, 'Clave del componente'),
    display_name: text(body.display_name, 100),
    description: text(body.description, 500),
    category: key(body.category || 'custom', 'Categoría'),
    document: pageDocument({ schemaVersion: 1, kind: 'page', nodes: [safeJson(body.node, 'Componente', 150_000)] }),
    version_number: integer(body.version_number, 1, Number.MAX_SAFE_INTEGER, 1),
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
    deleted_at: null,
  };
  if (!row.display_name) throw Object.assign(new Error('Indica el nombre del componente.'), { code: 'COMPONENT_NAME_REQUIRED', status: 400 });
  const { data, error } = await ctx.service.from('site_reusable_components').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'component.upsert', entity_type: 'site_reusable_component', entity_id: componentId, new_value: { ...data, document: undefined } });
  return data;
}

async function archiveComponent(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const componentId = uuid(body.component_id, 'Componente');
  const { data, error } = await ctx.service.from('site_reusable_components')
    .update({ deleted_at: new Date().toISOString() }).eq('id', componentId).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'component.archive', entity_type: 'site_reusable_component', entity_id: componentId });
  return data;
}

async function listModules(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const [registryResult, instancesResult, capabilitiesResult] = await Promise.all([
    ctx.service.from('module_registry').select('*').eq('status', 'available').order('display_name'),
    ctx.service.from('site_module_instances').select('*').eq('site_id', siteId).is('deleted_at', null).order('display_name'),
    ctx.service.from('site_module_capabilities').select('*').eq('site_id', siteId).order('capability_type'),
  ]);
  const error = registryResult.error || instancesResult.error || capabilitiesResult.error;
  if (error) throw error;
  return {
    registry: registryResult.data || [],
    instances: instancesResult.data || [],
    capabilities: capabilitiesResult.data || [],
  };
}

async function upsertModule(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const moduleId = body.module_id ? uuid(body.module_id, 'Módulo') : crypto.randomUUID();
  const moduleType = text(body.module_type, 100).toLowerCase();
  const instanceKey = key(body.instance_key, 'Variable del módulo');
  const displayName = text(body.display_name, 100);
  const status = text(body.status || 'draft', 20);
  if (!displayName) throw Object.assign(new Error('Indica el nombre visible del módulo.'), { code: 'MODULE_NAME_REQUIRED', status: 400 });
  if (!MODULE_STATUSES.has(status)) throw Object.assign(new Error('Estado de módulo inválido.'), { code: 'MODULE_STATUS_INVALID', status: 400 });
  const { data: definition, error: definitionError } = await ctx.service.from('module_registry')
    .select('module_type,schema_version,manifest').eq('module_type', moduleType).eq('status', 'available').single();
  if (definitionError || !definition) throw Object.assign(new Error('El tipo de módulo no está registrado.'), { code: 'MODULE_TYPE_UNKNOWN', status: 400 });

  if (body.module_id) {
    const { data: existing, error: existingError } = await ctx.service.from('site_module_instances')
      .select('id').eq('id', moduleId).eq('site_id', siteId).single();
    if (existingError || !existing) throw existingError || new Error('El módulo no pertenece a la instancia.');
  }
  const row = {
    id: moduleId,
    site_id: siteId,
    module_type: moduleType,
    instance_key: instanceKey,
    display_name: displayName,
    description: text(body.description, 1000),
    status,
    schema_version: Number(definition.schema_version) || 1,
    settings: safeJson(body.settings, 'Configuración del módulo', 150_000),
    admin_config: safeJson(body.admin_config || { exposedControls: [] }, 'Controles administrativos', 100_000),
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
    deleted_at: null,
  };
  const { data: instance, error } = await ctx.service.from('site_module_instances')
    .upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;

  const allowedCapabilities = new Set((Array.isArray(definition.manifest?.capabilities) ? definition.manifest.capabilities : []).map(String));
  const requested = (Array.isArray(body.capabilities) ? body.capabilities : []).slice(0, 100).map(raw => {
    const capability = object(raw);
    const capabilityType = text(capability.capability_type || capability.type, 120);
    if (!allowedCapabilities.has(capabilityType)) {
      throw Object.assign(new Error(`La capacidad ${capabilityType} no pertenece al manifiesto del módulo.`), { code: 'CAPABILITY_NOT_DECLARED', status: 400 });
    }
    return {
      site_id: siteId,
      module_instance_id: moduleId,
      capability_type: capabilityType,
      contract_version: integer(capability.contract_version, 1, 100, 1),
      enabled: capability.enabled === true,
      settings: safeJson(capability.settings, 'Configuración de capacidad', 50_000),
    };
  });
  const { error: deleteError } = await ctx.service.from('site_module_capabilities').delete()
    .eq('site_id', siteId).eq('module_instance_id', moduleId);
  if (deleteError) throw deleteError;
  if (requested.length) {
    const { error: insertError } = await ctx.service.from('site_module_capabilities').insert(requested);
    if (insertError) throw insertError;
  }
  await audit(ctx, {
    site_id: siteId, action: 'module.upsert', entity_type: 'site_module_instance', entity_id: moduleId,
    new_value: { ...instance, capabilities: requested },
  });
  return { ...instance, capabilities: requested };
}

async function archiveModule(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const moduleId = uuid(body.module_id, 'Módulo');
  const { data, error } = await ctx.service.from('site_module_instances')
    .update({ status: 'archived', deleted_at: new Date().toISOString() })
    .eq('id', moduleId).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'module.archive', entity_type: 'site_module_instance', entity_id: moduleId });
  return data;
}

async function listCollections(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const [collectionsResult, fieldsResult, relationsResult] = await Promise.all([
    ctx.service.from('site_collections').select('*').eq('site_id', siteId).is('deleted_at', null).order('plural_name'),
    ctx.service.from('site_collection_fields').select('*').eq('site_id', siteId).order('position'),
    ctx.service.from('site_relation_definitions').select('*').eq('site_id', siteId).order('relation_key'),
  ]);
  const error = collectionsResult.error || fieldsResult.error || relationsResult.error;
  if (error) throw error;
  return {
    collections: collectionsResult.data || [],
    fields: fieldsResult.data || [],
    relations: relationsResult.data || [],
  };
}

async function upsertCollection(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const collectionId = body.collection_id ? uuid(body.collection_id, 'Colección') : crypto.randomUUID();
  let existingFieldIds = new Set<string>();
  const status = text(body.status || 'draft', 20);
  const visibility = text(body.visibility || 'public', 20);
  if (!COLLECTION_STATUSES.has(status)) throw Object.assign(new Error('Estado de colección inválido.'), { code: 'COLLECTION_STATUS_INVALID', status: 400 });
  if (!COLLECTION_VISIBILITIES.has(visibility)) throw Object.assign(new Error('Visibilidad de colección inválida.'), { code: 'COLLECTION_VISIBILITY_INVALID', status: 400 });
  const singularName = text(body.singular_name, 100);
  const pluralName = text(body.plural_name, 100);
  if (!singularName || !pluralName) throw Object.assign(new Error('Indica los nombres singular y plural.'), { code: 'COLLECTION_NAME_REQUIRED', status: 400 });
  if (body.collection_id) {
    const [collectionResult, fieldsResult] = await Promise.all([
      ctx.service.from('site_collections').select('id').eq('id', collectionId).eq('site_id', siteId).single(),
      ctx.service.from('site_collection_fields').select('id').eq('collection_id', collectionId).eq('site_id', siteId),
    ]);
    if (collectionResult.error || !collectionResult.data) throw collectionResult.error || new Error('La colección no pertenece a la instancia.');
    if (fieldsResult.error) throw fieldsResult.error;
    existingFieldIds = new Set((fieldsResult.data || []).map(field => field.id));
  }

  const fields = (Array.isArray(body.fields) ? body.fields : []).slice(0, 100).map((raw, position) => {
    const field = object(raw);
    const fieldType = text(field.field_type, 30);
    if (!FIELD_TYPES.has(fieldType)) throw Object.assign(new Error(`Tipo de campo inválido: ${fieldType}.`), { code: 'FIELD_TYPE_INVALID', status: 400 });
    const displayName = text(field.display_name, 100);
    if (!displayName) throw Object.assign(new Error('Todos los campos necesitan nombre.'), { code: 'FIELD_NAME_REQUIRED', status: 400 });
    const fieldId = field.id ? uuid(field.id, 'Campo') : crypto.randomUUID();
    if (field.id && !existingFieldIds.has(fieldId)) {
      throw Object.assign(new Error('Uno de los campos no pertenece a esta colección.'), { code: 'FIELD_SITE_MISMATCH', status: 409 });
    }
    return {
      id: fieldId,
      site_id: siteId,
      collection_id: collectionId,
      field_key: key(field.field_key, 'Variable del campo'),
      display_name: displayName,
      field_type: fieldType,
      position,
      required: field.required === true,
      searchable: field.searchable === true,
      settings: safeJson(field.settings, 'Configuración de campo', 30_000),
    };
  });
  if (new Set(fields.map(field => field.field_key)).size !== fields.length) {
    throw Object.assign(new Error('No puede haber dos campos con la misma variable.'), { code: 'FIELD_KEY_DUPLICATE', status: 409 });
  }

  const row = {
    id: collectionId,
    site_id: siteId,
    collection_key: key(body.collection_key, 'Variable de la colección'),
    singular_name: singularName,
    plural_name: pluralName,
    description: text(body.description, 1000),
    status,
    visibility,
    settings: safeJson(body.settings, 'Configuración de colección', 100_000),
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
    deleted_at: null,
  };
  const { data: collection, error } = await ctx.service.from('site_collections').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  if (fields.length) {
    const { error: fieldsError } = await ctx.service.from('site_collection_fields').upsert(fields, { onConflict: 'id' });
    if (fieldsError) throw fieldsError;
  }
  const keepIds = fields.map(field => field.id);
  let removeQuery = ctx.service.from('site_collection_fields').delete().eq('site_id', siteId).eq('collection_id', collectionId);
  if (keepIds.length) removeQuery = removeQuery.not('id', 'in', `(${keepIds.join(',')})`);
  const { error: removeError } = await removeQuery;
  if (removeError) throw removeError;
  await audit(ctx, {
    site_id: siteId, action: 'collection.upsert', entity_type: 'site_collection', entity_id: collectionId,
    new_value: { ...collection, fields },
  });
  return { ...collection, fields };
}

async function archiveCollection(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const collectionId = uuid(body.collection_id, 'Colección');
  const { data, error } = await ctx.service.from('site_collections')
    .update({ status: 'archived', deleted_at: new Date().toISOString() })
    .eq('id', collectionId).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'collection.archive', entity_type: 'site_collection', entity_id: collectionId });
  return data;
}

function validateRecordValue(field: any, value: unknown) {
  if ((value == null || value === '') && field.required) {
    throw Object.assign(new Error(`El campo ${field.display_name} es obligatorio.`), { code: 'RECORD_FIELD_REQUIRED', status: 400 });
  }
  if (value == null || value === '') return null;
  if (field.field_type === 'number') {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw Object.assign(new Error(`${field.display_name} debe ser numérico.`), { code: 'RECORD_FIELD_INVALID', status: 400 });
    return parsed;
  }
  if (field.field_type === 'boolean') return value === true || value === 'true';
  if (field.field_type === 'multi_select') return (Array.isArray(value) ? value : [value]).map(item => text(item, 200)).slice(0, 100);
  if (field.field_type === 'json') return value;
  const result = text(value, field.field_type === 'rich_text' || field.field_type === 'long_text' ? 40_000 : 2000);
  if (field.field_type === 'url') absoluteWebUrl(result, false);
  if (field.field_type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) {
    throw Object.assign(new Error(`${field.display_name} no es un correo válido.`), { code: 'RECORD_FIELD_INVALID', status: 400 });
  }
  if (field.field_type === 'discord_id') snowflake(result, true);
  return result;
}

async function listRecords(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const collectionId = uuid(body.collection_id, 'Colección');
  const page = integer(body.page, 1, 100000, 1);
  const pageSize = integer(body.page_size, 1, 100, 30);
  const from = (page - 1) * pageSize;
  const { data, error, count } = await ctx.service.from('site_collection_records').select('*', { count: 'exact' })
    .eq('site_id', siteId).eq('collection_id', collectionId).is('deleted_at', null)
    .order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  const recordIds = (data || []).map(record => record.id);
  let submissions: any[] = [];
  if (recordIds.length) {
    const { data: submissionData, error: submissionError } = await ctx.service.from('site_form_submissions')
      .select('id,record_id,status,submitted_by,created_at,reviewed_at')
      .eq('site_id', siteId).in('record_id', recordIds);
    if (submissionError) throw submissionError;
    submissions = submissionData || [];
  }
  return { records: data || [], submissions, page, pageSize, total: count || 0 };
}

async function upsertRecord(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const collectionId = uuid(body.collection_id, 'Colección');
  const recordId = body.record_id ? uuid(body.record_id, 'Registro') : crypto.randomUUID();
  const [collectionResult, fieldsResult] = await Promise.all([
    ctx.service.from('site_collections').select('*').eq('id', collectionId).eq('site_id', siteId).is('deleted_at', null).single(),
    ctx.service.from('site_collection_fields').select('*').eq('collection_id', collectionId).eq('site_id', siteId).order('position'),
  ]);
  if (collectionResult.error) throw collectionResult.error;
  if (fieldsResult.error) throw fieldsResult.error;
  if (body.record_id) {
    const { data: existing, error: existingError } = await ctx.service.from('site_collection_records').select('id')
      .eq('id', recordId).eq('site_id', siteId).eq('collection_id', collectionId).single();
    if (existingError || !existing) throw existingError || new Error('El registro no pertenece a la colección.');
  }
  const inputData = safeJson(body.data, 'Datos del registro', 300_000);
  const normalized: Record<string, unknown> = {};
  for (const field of fieldsResult.data || []) normalized[field.field_key] = validateRecordValue(field, inputData[field.field_key]);
  const searchable = (fieldsResult.data || []).filter((field: any) => field.searchable)
    .flatMap((field: any) => Array.isArray(normalized[field.field_key]) ? normalized[field.field_key] as unknown[] : [normalized[field.field_key]])
    .filter(value => value != null).map(String).join(' ').slice(0, 50_000);
  const status = text(body.status || 'draft', 20);
  if (!PAGE_STATUSES.has(status)) throw Object.assign(new Error('Estado de registro inválido.'), { code: 'RECORD_STATUS_INVALID', status: 400 });
  const row = {
    id: recordId,
    site_id: siteId,
    collection_id: collectionId,
    slug: body.slug ? slug(body.slug) : null,
    status,
    data: normalized,
    search_text: searchable,
    published_at: status === 'published' ? new Date().toISOString() : null,
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
    deleted_at: null,
  };
  const { data, error } = await ctx.service.from('site_collection_records').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  if (status === 'published') {
    const { error: reviewError } = await ctx.service.from('site_form_submissions').update({
      status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: ctx.user.id,
    }).eq('site_id', siteId).eq('record_id', recordId).eq('status', 'pending');
    if (reviewError) throw reviewError;
  }
  await audit(ctx, { site_id: siteId, action: 'record.upsert', entity_type: 'site_collection_record', entity_id: recordId, new_value: { collectionId, status, slug: row.slug } });
  return data;
}

async function archiveRecord(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const recordId = uuid(body.record_id, 'Registro');
  const { data, error } = await ctx.service.from('site_collection_records')
    .update({ status: 'archived', deleted_at: new Date().toISOString() })
    .eq('id', recordId).eq('site_id', siteId).select('id,site_id,collection_id,status,deleted_at').single();
  if (error) throw error;
  const { error: submissionError } = await ctx.service.from('site_form_submissions').update({
    status: 'archived', reviewed_at: new Date().toISOString(), reviewed_by: ctx.user.id,
  }).eq('site_id', siteId).eq('record_id', recordId);
  if (submissionError) throw submissionError;
  await audit(ctx, { site_id: siteId, action: 'record.archive', entity_type: 'site_collection_record', entity_id: recordId });
  return data;
}

async function listWorkflows(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.from('site_workflows').select('*')
    .eq('site_id', siteId).is('deleted_at', null).order('display_name');
  if (error) throw error;
  return data || [];
}

async function upsertWorkflow(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const workflowId = body.workflow_id ? uuid(body.workflow_id, 'Workflow') : crypto.randomUUID();
  if (body.workflow_id) {
    const { data: existing, error: existingError } = await ctx.service.from('site_workflows').select('id')
      .eq('id', workflowId).eq('site_id', siteId).single();
    if (existingError || !existing) throw existingError || new Error('El workflow no pertenece a la instancia.');
  }
  const displayName = text(body.display_name, 100);
  if (!displayName) throw Object.assign(new Error('Indica el nombre del workflow.'), { code: 'WORKFLOW_NAME_REQUIRED', status: 400 });
  const actions = Array.isArray(body.actions_config) ? body.actions_config.slice(0, 50).map(action => safeJson(action, 'Acción del workflow', 30_000)) : [];
  const row = {
    id: workflowId,
    site_id: siteId,
    workflow_key: key(body.workflow_key, 'Variable del workflow'),
    display_name: displayName,
    description: text(body.description, 1000),
    trigger_config: safeJson(body.trigger_config, 'Disparador', 50_000),
    condition_config: safeJson(body.condition_config || { all: [] }, 'Condiciones', 50_000),
    actions_config: actions,
    error_config: safeJson(body.error_config || { strategy: 'stop' }, 'Manejo de errores', 30_000),
    enabled: body.enabled === true,
    version_number: integer(body.version_number, 1, Number.MAX_SAFE_INTEGER, 1),
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
    deleted_at: null,
  };
  const { data, error } = await ctx.service.from('site_workflows').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'workflow.upsert', entity_type: 'site_workflow', entity_id: workflowId, new_value: { ...data, actions_config: undefined } });
  return data;
}

async function archiveWorkflow(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const workflowId = uuid(body.workflow_id, 'Workflow');
  const { data, error } = await ctx.service.from('site_workflows')
    .update({ enabled: false, deleted_at: new Date().toISOString() })
    .eq('id', workflowId).eq('site_id', siteId).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'workflow.archive', entity_type: 'site_workflow', entity_id: workflowId });
  return data;
}

async function listAudit(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const limit = integer(body.limit, 1, 200, 50);
  const { data, error } = await ctx.service.from('site_audit_log').select(
    'id,site_id,discord_user_id,actor_mode,action,entity_type,entity_id,metadata,success,created_at',
  ).eq('site_id', siteId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

async function listAdminControls(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const { data, error } = await ctx.service.from('site_admin_controls').select('*')
    .eq('site_id', siteId).order('target_type').order('display_name');
  if (error) throw error;
  return data || [];
}

async function upsertAdminControl(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const controlId = body.control_id ? uuid(body.control_id, 'Control') : crypto.randomUUID();
  const targetType = text(body.target_type, 30);
  if (!['site', 'page', 'module', 'collection', 'block', 'workflow'].includes(targetType)) {
    throw Object.assign(new Error('Tipo de destino del control inválido.'), { code: 'CONTROL_TARGET_INVALID', status: 400 });
  }
  const propertyPath = text(body.property_path, 200);
  const permissionKey = text(body.permission_key, 120);
  if (!/^[a-zA-Z0-9_.:-]{1,200}$/.test(propertyPath) || !/^[a-z*][a-z0-9_.*:-]{0,119}$/.test(permissionKey)) {
    throw Object.assign(new Error('Ruta de propiedad o permiso inválido.'), { code: 'CONTROL_INVALID', status: 400 });
  }
  if (body.control_id) {
    const { data: existing, error: existingError } = await ctx.service.from('site_admin_controls').select('id')
      .eq('id', controlId).eq('site_id', siteId).single();
    if (existingError || !existing) throw existingError || new Error('El control no pertenece a la instancia.');
  }
  const targetId = body.target_id ? uuid(body.target_id, 'Destino') : null;
  if (targetId) {
    const targetTable = targetType === 'page' || targetType === 'block' ? 'site_pages'
      : targetType === 'module' ? 'site_module_instances'
        : targetType === 'collection' ? 'site_collections'
          : targetType === 'workflow' ? 'site_workflows' : 'sites';
    const { data: target, error: targetError } = await ctx.service.from(targetTable).select('id')
      .eq('id', targetId).eq(targetTable === 'sites' ? 'id' : 'site_id', siteId).single();
    if (targetError || !target) throw targetError || new Error('El destino del control no pertenece a la instancia.');
  }
  const row = {
    id: controlId,
    site_id: siteId,
    target_type: targetType,
    target_id: targetId,
    property_path: propertyPath,
    display_name: text(body.display_name, 100),
    control_type: text(body.control_type || 'text', 40),
    permission_key: permissionKey,
    settings: safeJson(body.settings, 'Configuración del control', 40_000),
    enabled: body.enabled !== false,
  };
  if (!row.display_name) throw Object.assign(new Error('Indica el nombre del control.'), { code: 'CONTROL_NAME_REQUIRED', status: 400 });
  const { data, error } = await ctx.service.from('site_admin_controls').upsert(row, { onConflict: 'id' }).select('*').single();
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'admin_control.upsert', entity_type: 'site_admin_control', entity_id: controlId, new_value: data });
  return data;
}

async function deleteAdminControl(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const controlId = uuid(body.control_id, 'Control');
  const { data: existing, error: existingError } = await ctx.service.from('site_admin_controls').select('*')
    .eq('id', controlId).eq('site_id', siteId).single();
  if (existingError) throw existingError;
  const { error } = await ctx.service.from('site_admin_controls').delete().eq('id', controlId).eq('site_id', siteId);
  if (error) throw error;
  await audit(ctx, { site_id: siteId, action: 'admin_control.delete', entity_type: 'site_admin_control', entity_id: controlId, old_value: existing });
  return { deleted: true };
}

async function exportStructure(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const includeRecords = body.include_records === true;
  const queries = await Promise.all([
    ctx.service.from('sites').select('*').eq('id', siteId).single(),
    ctx.service.from('site_pages').select('*').eq('site_id', siteId).is('deleted_at', null).order('sort_order'),
    ctx.service.from('site_reusable_components').select('*').eq('site_id', siteId).is('deleted_at', null),
    ctx.service.from('site_module_instances').select('*').eq('site_id', siteId).is('deleted_at', null),
    ctx.service.from('site_module_capabilities').select('*').eq('site_id', siteId),
    ctx.service.from('site_collections').select('*').eq('site_id', siteId).is('deleted_at', null),
    ctx.service.from('site_collection_fields').select('*').eq('site_id', siteId),
    ctx.service.from('site_relation_definitions').select('*').eq('site_id', siteId),
    ctx.service.from('site_workflows').select('*').eq('site_id', siteId).is('deleted_at', null),
    ctx.service.from('site_admin_controls').select('*').eq('site_id', siteId),
    ctx.service.from('site_role_profiles').select('*').eq('site_id', siteId),
    ctx.service.from('site_role_permissions').select('*').eq('site_id', siteId),
    includeRecords
      ? ctx.service.from('site_collection_records').select('*').eq('site_id', siteId).is('deleted_at', null).limit(10000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const error = queries.find(result => result.error)?.error;
  if (error) throw error;
  const [site, pages, components, modules, capabilities, collections, fields, relations, workflows, controls, roles, permissions, records] = queries;
  return {
    format: 'empi-network-site',
    version: 1,
    exportedAt: new Date().toISOString(),
    includesRecords: includeRecords,
    site: site.data,
    pages: pages.data || [],
    components: components.data || [],
    modules: modules.data || [],
    capabilities: capabilities.data || [],
    collections: collections.data || [],
    fields: fields.data || [],
    relations: relations.data || [],
    workflows: workflows.data || [],
    adminControls: controls.data || [],
    roles: roles.data || [],
    permissions: permissions.data || [],
    records: records.data || [],
  };
}

function remapDocumentCollections(document: Record<string, unknown>, collectionMap: Map<string, string>) {
  const copy = structuredClone(document);
  const visit = (nodes: unknown[]) => {
    for (const raw of nodes || []) {
      const node = object(raw);
      const props = object(node.props);
      const oldCollectionId = text(props.collectionId, 64);
      if (oldCollectionId && collectionMap.has(oldCollectionId)) props.collectionId = collectionMap.get(oldCollectionId);
      if (Array.isArray(node.children)) visit(node.children);
    }
  };
  if (Array.isArray(copy.nodes)) visit(copy.nodes);
  return copy;
}

async function importStructure(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const bundle = safeJson(body.bundle, 'Paquete de importación', 5_000_000);
  if (bundle.format !== 'empi-network-site' || Number(bundle.version) !== 1) {
    throw Object.assign(new Error('El archivo no es un respaldo estructural compatible de Empi Network.'), { code: 'IMPORT_FORMAT_INVALID', status: 400 });
  }
  const sourceSite = object(bundle.site);
  const name = text(body.name || `${sourceSite.name || 'Instancia'} copia`, 100);
  const imported = await createSite(ctx, {
    name,
    slug: slug(body.slug),
    discord_guild_id: '',
    public_base_url: '',
  });
  const importedSiteId = imported.id;
  try {
    const collectionMap = new Map<string, string>();
    const sourceFields = Array.isArray(bundle.fields) ? bundle.fields : [];
    for (const rawCollection of (Array.isArray(bundle.collections) ? bundle.collections : []).slice(0, 200)) {
      const source = object(rawCollection);
      const fields = sourceFields.filter(raw => object(raw).collection_id === source.id).map(raw => {
        const field = object(raw);
        return {
          display_name: field.display_name,
          field_key: field.field_key,
          field_type: field.field_type,
          required: field.required === true,
          searchable: field.searchable === true,
          settings: field.settings,
        };
      });
      const created = await upsertCollection(ctx, {
        site_id: importedSiteId,
        collection_key: source.collection_key,
        singular_name: source.singular_name,
        plural_name: source.plural_name,
        description: source.description,
        status: 'draft',
        visibility: source.visibility,
        settings: source.settings,
        fields,
      });
      collectionMap.set(String(source.id), created.id);
    }

    const generatedPages = await listPages(ctx, { site_id: importedSiteId });
    const generatedHome = generatedPages.find((item: any) => item.is_home) || generatedPages[0];
    const pageMap = new Map<string, string>();
    const sourcePages = (Array.isArray(bundle.pages) ? bundle.pages : []).filter(raw => !object(raw).deleted_at).slice(0, 500);
    const sourceHome = sourcePages.find(raw => object(raw).is_home === true) || sourcePages[0];
    for (const rawPage of sourcePages) {
      const source = object(rawPage);
      const target = rawPage === sourceHome && generatedHome
        ? generatedHome
        : await createPage(ctx, { site_id: importedSiteId, name: source.name, slug: source.slug, is_home: false });
      const sourceDocument = object(source.draft_document || source.published_document || { schemaVersion: 1, kind: 'page', nodes: [] });
      const mappedDocument = remapDocumentCollections(pageDocument(sourceDocument), collectionMap);
      const saved = await savePage(ctx, {
        site_id: importedSiteId,
        page_id: target.id,
        name: source.name,
        title: source.title,
        slug: source.slug,
        description: source.description,
        is_home: rawPage === sourceHome,
        sort_order: source.sort_order,
        draft_document: mappedDocument,
        seo_config: source.seo_config,
        access_config: source.access_config,
        reason: 'Importación estructural',
      });
      pageMap.set(String(source.id), saved.id);
    }

    const sourceCapabilities = Array.isArray(bundle.capabilities) ? bundle.capabilities : [];
    const moduleMap = new Map<string, string>();
    for (const rawModule of (Array.isArray(bundle.modules) ? bundle.modules : []).slice(0, 200)) {
      const source = object(rawModule);
      const capabilities = sourceCapabilities.filter(raw => object(raw).module_instance_id === source.id).map(raw => {
        const capability = object(raw);
        return {
          capability_type: capability.capability_type,
          contract_version: capability.contract_version,
          enabled: false,
          settings: capability.settings,
        };
      });
      const createdModule = await upsertModule(ctx, {
        site_id: importedSiteId,
        module_type: source.module_type,
        instance_key: source.instance_key,
        display_name: source.display_name,
        description: source.description,
        status: 'draft',
        settings: source.settings,
        admin_config: source.admin_config,
        capabilities,
      });
      moduleMap.set(String(source.id), createdModule.id);
    }

    const workflowMap = new Map<string, string>();
    for (const rawWorkflow of (Array.isArray(bundle.workflows) ? bundle.workflows : []).slice(0, 200)) {
      const source = object(rawWorkflow);
      const createdWorkflow = await upsertWorkflow(ctx, {
        site_id: importedSiteId,
        workflow_key: source.workflow_key,
        display_name: source.display_name,
        description: source.description,
        trigger_config: source.trigger_config,
        condition_config: source.condition_config,
        actions_config: source.actions_config,
        error_config: source.error_config,
        enabled: false,
      });
      workflowMap.set(String(source.id), createdWorkflow.id);
    }

    for (const rawComponent of (Array.isArray(bundle.components) ? bundle.components : []).slice(0, 500)) {
      const source = object(rawComponent);
      const sourceDocument = object(source.document);
      const node = Array.isArray(sourceDocument.nodes) ? sourceDocument.nodes[0] : null;
      if (!node) continue;
      await upsertComponent(ctx, {
        site_id: importedSiteId,
        component_key: source.component_key,
        display_name: source.display_name,
        description: source.description,
        category: source.category,
        node,
      });
    }

    for (const rawRelation of (Array.isArray(bundle.relations) ? bundle.relations : []).slice(0, 500)) {
      const source = object(rawRelation);
      const sourceCollectionId = collectionMap.get(String(source.source_collection_id));
      const targetCollectionId = collectionMap.get(String(source.target_collection_id));
      const relationType = text(source.relation_type, 30);
      if (!sourceCollectionId || !targetCollectionId || !['one_to_one', 'one_to_many', 'many_to_many'].includes(relationType)) continue;
      const { error: relationError } = await ctx.service.from('site_relation_definitions').insert({
        id: crypto.randomUUID(),
        site_id: importedSiteId,
        relation_key: key(source.relation_key, 'Variable de relación'),
        source_collection_id: sourceCollectionId,
        target_collection_id: targetCollectionId,
        relation_type: relationType,
        settings: safeJson(source.settings, 'Configuración de relación', 50_000),
      });
      if (relationError) throw relationError;
    }

    for (const rawRole of (Array.isArray(bundle.roles) ? bundle.roles : []).filter(raw => !object(raw).is_system).slice(0, 100)) {
      const source = object(rawRole);
      const permissions = (Array.isArray(bundle.permissions) ? bundle.permissions : [])
        .filter(raw => object(raw).role_profile_id === source.id && object(raw).effect === 'allow')
        .map(raw => object(raw).permission_key);
      await upsertRole(ctx, {
        site_id: importedSiteId,
        role_key: source.role_key,
        display_name: source.display_name,
        description: source.description,
        permissions,
      });
    }

    if (bundle.includesRecords === true && Array.isArray(bundle.records)) {
      for (const rawRecord of bundle.records.slice(0, 10000)) {
        const source = object(rawRecord);
        const mappedCollectionId = collectionMap.get(String(source.collection_id));
        if (!mappedCollectionId) continue;
        await upsertRecord(ctx, {
          site_id: importedSiteId,
          collection_id: mappedCollectionId,
          slug: source.slug,
          status: 'draft',
          data: source.data,
        });
      }
    }

    for (const rawControl of (Array.isArray(bundle.adminControls) ? bundle.adminControls : []).slice(0, 2000)) {
      const source = object(rawControl);
      const targetType = text(source.target_type, 30);
      let mappedTargetId: string | null = null;
      if (targetType === 'site') mappedTargetId = importedSiteId;
      else if (targetType === 'page' || targetType === 'block') mappedTargetId = pageMap.get(String(source.target_id)) || null;
      else if (targetType === 'module') mappedTargetId = moduleMap.get(String(source.target_id)) || null;
      else if (targetType === 'collection') mappedTargetId = collectionMap.get(String(source.target_id)) || null;
      else if (targetType === 'workflow') mappedTargetId = workflowMap.get(String(source.target_id)) || null;
      if (source.target_id && !mappedTargetId) continue;
      await upsertAdminControl(ctx, {
        site_id: importedSiteId,
        target_type: targetType,
        target_id: mappedTargetId,
        property_path: source.property_path,
        display_name: source.display_name,
        control_type: source.control_type,
        permission_key: source.permission_key,
        settings: source.settings,
        enabled: source.enabled !== false,
      });
    }

    const navigation = structuredClone(object(sourceSite.navigation_config));
    if (Array.isArray(navigation.items)) navigation.items = navigation.items.map(raw => {
      const item = object(raw);
      const mappedPageId = item.pageId ? pageMap.get(String(item.pageId)) : null;
      return { ...item, pageId: mappedPageId || null };
    });
    const importedSearch = structuredClone(object(sourceSite.search_config));
    if (Array.isArray(importedSearch.sources)) {
      importedSearch.sources = importedSearch.sources
        .map(source => collectionMap.get(String(source)) || null)
        .filter((source): source is string => Boolean(source));
    }
    await updateSite(ctx, {
      site_id: importedSiteId,
      name,
      description: text(sourceSite.description, 1000),
      navigation_config: navigation,
      search_config: importedSearch,
      status: 'draft',
      reason: 'Importación estructural completa',
    });
    await saveTheme(ctx, {
      site_id: importedSiteId,
      theme_config: sourceSite.draft_theme_config || sourceSite.theme_config,
      publish: false,
      reason: 'Apariencia importada como borrador',
    });
    await audit(ctx, {
      site_id: importedSiteId, action: 'site.import', entity_type: 'site', entity_id: importedSiteId,
      metadata: { sourceSiteId: sourceSite.id || null, sourceSlug: sourceSite.slug || null },
    });
    return { site_id: importedSiteId, slug: body.slug, imported: true };
  } catch (error) {
    try {
      const { error: archiveError } = await ctx.service.rpc('network_archive_site', {
        input_site_id: importedSiteId,
        input_created_by: ctx.user.id,
        input_created_by_discord_id: ctx.identity.discordId,
        input_reason: 'Importación incompleta archivada automáticamente',
      });
      if (archiveError) console.error('[network-admin-api] No se pudo archivar la importación incompleta:', archiveError.message);
    } catch (archiveError) {
      console.error('[network-admin-api] Falló la recuperación de una importación incompleta:', archiveError);
    }
    throw error;
  }
}

async function listRoles(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const [rolesResult, permissionsResult, mappingsResult] = await Promise.all([
    ctx.service.from('site_role_profiles').select('*').eq('site_id', siteId).order('created_at'),
    ctx.service.from('site_role_permissions').select('*').eq('site_id', siteId).order('permission_key'),
    ctx.service.from('site_discord_role_mappings').select('*').eq('site_id', siteId).order('created_at'),
  ]);
  const error = rolesResult.error || permissionsResult.error || mappingsResult.error;
  if (error) throw error;
  return {
    roles: rolesResult.data || [],
    permissions: permissionsResult.data || [],
    mappings: mappingsResult.data || [],
  };
}

async function upsertRole(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const roleId = body.role_id ? uuid(body.role_id, 'Perfil') : null;
  const displayName = text(body.display_name, 80);
  const roleKey = text(body.role_key, 48).toLowerCase();
  if (!displayName || !/^[a-z][a-z0-9_-]{1,47}$/.test(roleKey)) {
    throw Object.assign(new Error('Nombre o clave del perfil inválidos.'), { code: 'ROLE_INVALID', status: 400 });
  }

  let existing: any = null;
  if (roleId) {
    const result = await ctx.service.from('site_role_profiles').select('*')
      .eq('id', roleId).eq('site_id', siteId).single();
    if (result.error) throw result.error;
    existing = result.data;
    if (existing.is_system && roleKey !== existing.role_key) {
      throw Object.assign(new Error('La clave de un perfil del sistema no puede modificarse.'), {
        code: 'SYSTEM_ROLE_KEY_LOCKED', status: 409,
      });
    }
  }

  const permissionKeys = [...new Set((Array.isArray(body.permissions) ? body.permissions : [])
    .map(value => text(value, 120))
    .filter(value => /^[a-z*][a-z0-9_.*:-]{0,119}$/.test(value)))];
  const { data: role, error } = await ctx.service.rpc('network_upsert_role', {
    input_site_id: siteId,
    input_role_id: roleId,
    input_role_key: roleKey,
    input_display_name: displayName,
    input_description: text(body.description, 500),
    input_permissions: permissionKeys,
    input_created_by: ctx.user.id,
    input_created_by_discord_id: ctx.identity.discordId,
  });
  if (error) throw error;
  const effectivePermissions = role.is_default_admin && !permissionKeys.includes('site.admin.*')
    ? [...permissionKeys, 'site.admin.*']
    : permissionKeys;
  return { ...role, permissions: effectivePermissions };
}

async function deleteRole(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const roleId = uuid(body.role_id, 'Perfil');
  const { data: role, error: roleError } = await ctx.service.from('site_role_profiles')
    .select('*').eq('id', roleId).eq('site_id', siteId).single();
  if (roleError) throw roleError;
  if (role.is_system) {
    throw Object.assign(new Error('El perfil administrador del sistema no puede eliminarse.'), {
      code: 'SYSTEM_ROLE_DELETE_FORBIDDEN', status: 409,
    });
  }
  const { error } = await ctx.service.from('site_role_profiles').delete().eq('id', roleId).eq('site_id', siteId);
  if (error) throw error;
  await audit(ctx, {
    site_id: siteId, action: 'role.delete', entity_type: 'site_role_profile',
    entity_id: roleId, old_value: role,
  });
  return { deleted: true };
}

async function setRoleMapping(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const siteId = uuid(body.site_id, 'Sitio');
  const roleProfileId = uuid(body.role_profile_id, 'Perfil');
  const discordRoleId = snowflake(body.discord_role_id, true);
  const { data: site, error: siteError } = await ctx.service.from('sites')
    .select('id,discord_guild_id').eq('id', siteId).single();
  if (siteError) throw siteError;
  if (!site.discord_guild_id) {
    throw Object.assign(new Error('Asigna primero el Discord Guild ID de la instancia.'), {
      code: 'SITE_GUILD_REQUIRED', status: 409,
    });
  }
  const { data: role, error: roleError } = await ctx.service.from('site_role_profiles')
    .select('id').eq('id', roleProfileId).eq('site_id', siteId).single();
  if (roleError || !role) throw roleError || new Error('El perfil no pertenece al sitio.');
  const { data, error } = await ctx.service.from('site_discord_role_mappings').upsert({
    site_id: siteId,
    role_profile_id: roleProfileId,
    discord_role_id: discordRoleId,
    created_by: ctx.user.id,
    created_by_discord_id: ctx.identity.discordId,
  }, { onConflict: 'site_id,role_profile_id,discord_role_id' }).select('*').single();
  if (error) throw error;
  await audit(ctx, {
    site_id: siteId, action: 'role.map_discord', entity_type: 'site_role_profile',
    entity_id: roleProfileId, new_value: data,
  });
  return data;
}

async function deleteRoleMapping(ctx: Awaited<ReturnType<typeof authenticate>>, body: Record<string, unknown>) {
  const mappingId = uuid(body.mapping_id, 'Mapeo');
  const { data: mapping, error: mappingError } = await ctx.service.from('site_discord_role_mappings')
    .select('*').eq('id', mappingId).single();
  if (mappingError) throw mappingError;
  const { error } = await ctx.service.from('site_discord_role_mappings').delete().eq('id', mappingId);
  if (error) throw error;
  await audit(ctx, {
    site_id: mapping.site_id, action: 'role.unmap_discord', entity_type: 'site_role_mapping',
    entity_id: mappingId, old_value: mapping,
  });
  return { deleted: true };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('Método no permitido.', 'METHOD_NOT_ALLOWED', 405);

  try {
    const body = object(await req.json().catch(() => ({})));
    const action = text(body.action, 80);
    const ctx = await authenticate(req);

    if (action === 'status') {
      return json({
        data: {
          isOwner: ctx.isOwner,
          profile: ctx.identity,
          modes: ctx.isOwner ? ['normal', 'site_admin_supreme', 'platform_owner'] : ['normal'],
        },
      });
    }

    requireOwner(ctx);
    let data: unknown;
    if (action === 'list_sites') data = await listSites(ctx);
    else if (action === 'create_site') data = await createSite(ctx, body);
    else if (action === 'update_site') data = await updateSite(ctx, body);
    else if (action === 'archive_site') data = await archiveSite(ctx, body);
    else if (action === 'restore_site') data = await restoreSite(ctx, body);
    else if (action === 'list_theme_versions') data = await listThemeVersions(ctx, body);
    else if (action === 'save_theme') data = await saveTheme(ctx, body);
    else if (action === 'restore_theme_version') data = await restoreThemeVersion(ctx, body);
    else if (action === 'list_pages') data = await listPages(ctx, body);
    else if (action === 'get_page') data = await getPage(ctx, body);
    else if (action === 'create_page') data = await createPage(ctx, body);
    else if (action === 'save_page') data = await savePage(ctx, body);
    else if (action === 'publish_page') data = await publishPage(ctx, body);
    else if (action === 'restore_page_version') data = await restorePageVersion(ctx, body);
    else if (action === 'archive_page') data = await archivePage(ctx, body);
    else if (action === 'duplicate_page') data = await duplicatePage(ctx, body);
    else if (action === 'list_components') data = await listComponents(ctx, body);
    else if (action === 'upsert_component') data = await upsertComponent(ctx, body);
    else if (action === 'archive_component') data = await archiveComponent(ctx, body);
    else if (action === 'list_modules') data = await listModules(ctx, body);
    else if (action === 'upsert_module') data = await upsertModule(ctx, body);
    else if (action === 'archive_module') data = await archiveModule(ctx, body);
    else if (action === 'list_collections') data = await listCollections(ctx, body);
    else if (action === 'upsert_collection') data = await upsertCollection(ctx, body);
    else if (action === 'archive_collection') data = await archiveCollection(ctx, body);
    else if (action === 'list_records') data = await listRecords(ctx, body);
    else if (action === 'upsert_record') data = await upsertRecord(ctx, body);
    else if (action === 'archive_record') data = await archiveRecord(ctx, body);
    else if (action === 'list_workflows') data = await listWorkflows(ctx, body);
    else if (action === 'upsert_workflow') data = await upsertWorkflow(ctx, body);
    else if (action === 'archive_workflow') data = await archiveWorkflow(ctx, body);
    else if (action === 'list_admin_controls') data = await listAdminControls(ctx, body);
    else if (action === 'upsert_admin_control') data = await upsertAdminControl(ctx, body);
    else if (action === 'delete_admin_control') data = await deleteAdminControl(ctx, body);
    else if (action === 'list_audit') data = await listAudit(ctx, body);
    else if (action === 'export_structure') data = await exportStructure(ctx, body);
    else if (action === 'import_structure') data = await importStructure(ctx, body);
    else if (action === 'list_roles') data = await listRoles(ctx, body);
    else if (action === 'upsert_role') data = await upsertRole(ctx, body);
    else if (action === 'delete_role') data = await deleteRole(ctx, body);
    else if (action === 'set_role_mapping') data = await setRoleMapping(ctx, body);
    else if (action === 'delete_role_mapping') data = await deleteRoleMapping(ctx, body);
    else return failure('Acción no soportada.', 'ACTION_NOT_SUPPORTED', 404);
    return json({ data });
  } catch (error: any) {
    console.error('[network-admin-api]', error);
    const message = text(error?.message || 'Error interno.', 800);
    const code = text(error?.code || 'NETWORK_ADMIN_ERROR', 100);
    const status = Number(error?.status || (/duplicate key|unique/i.test(message) ? 409 : 500));
    return failure(message, code, status, error?.details || null);
  }
});

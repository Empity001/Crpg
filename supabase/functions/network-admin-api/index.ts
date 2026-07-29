import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SITE_STATUSES = new Set(['draft', 'active', 'maintenance', 'archived', 'suspended']);
const NAV_POSITIONS = new Set(['top', 'bottom', 'left', 'right', 'floating', 'hero', 'drawer', 'hidden']);
const SEARCH_POSITIONS = new Set(['header', 'navigation', 'sidebar', 'hero', 'block', 'floating', 'dock', 'overlay', 'palette', 'hidden']);
const OWNER_FALLBACK_ID = '726444396970770494';

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
  const config = object(value);
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
    return { key, label, url: navigationUrl(item.url) };
  });
  config.items = items;
  return config;
}

function validateSearch(value: unknown) {
  const config = object(value);
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
  return config;
}

function validateTheme(value: unknown) {
  const config = object(value);
  const palette = object(config.palette);
  const defaults: Record<string, string> = {
    background: '#050505', surface: '#101010', text: '#ffffff', muted: '#a3a3a3', accent: '#ffffff',
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
  return { ...config, mode: text(config.mode || 'custom', 20), palette: normalized };
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

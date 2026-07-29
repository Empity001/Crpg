import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Las instancias Edge se reutilizan entre solicitudes durante un tiempo. Un
// caché corto evita consultar la misma configuración y el mismo miembro de
// Discord para cada RPC sin convertir el rol en una credencial permanente.
// Cuando la instancia se reinicia, el caché desaparece automáticamente.
const GUILD_CONFIG_CACHE_MS = 60_000;
const DISCORD_MEMBER_CACHE_MS = 75_000;
const DISCORD_NON_MEMBER_CACHE_MS = 25_000;
const AUTH_USER_CACHE_MS = 30_000;
let guildConfigCache: { key: string; value: any; expiresAt: number } | null = null;
let guildConfigPromise: Promise<any> | null = null;
const discordMemberCache = new Map<string, { value: any; expiresAt: number }>();
const discordMemberPromises = new Map<string, Promise<any>>();
const authUserCache = new Map<string, { user: any; expiresAt: number }>();
const authUserPromises = new Map<string, Promise<any>>();

const ADMIN_RPCS = new Set([
  'archive_media_asset','create_log','create_tierlist_row','create_weapon',
  'create_weapon_category','create_weapon_type','delete_category','delete_comment',
  'delete_draft','delete_kit','delete_log','delete_media_asset','delete_tierlist_item',
  'delete_tierlist_row','delete_weapon','delete_weapon_category','delete_weapon_rank',
  'delete_weapon_type','find_media_duplicate','get_draft','list_action_log','list_drafts',
  'list_kits','list_logs_admin','list_log_mobs_admin','list_log_items_admin','list_comments_admin',
  'list_media_assets','list_media_picker_assets','move_tierlist_item',
  'patch_weapon_rank','record_admin_action','reorder_tierlist_rows','replace_media_asset_file',
  'set_comment_hidden','set_log_published','set_weapon_published','update_app_setting','update_category',
  'update_log','update_media_asset','update_tierlist_row','update_weapon','upsert_draft',
  'upsert_kit','upsert_media_asset','upsert_tierlist_item','upsert_weapon_rank',
  'update_weapon_category','update_weapon_type','create_category',
]);

const WRITE_RPCS = new Set([...ADMIN_RPCS].filter(name => ![
  'find_media_duplicate','get_draft','list_action_log','list_drafts','list_kits',
  'list_logs_admin','list_log_mobs_admin','list_log_items_admin','list_comments_admin',
  'list_media_assets','list_media_picker_assets',
].includes(name)));

// Estas RPC nacieron después de retirar el código compartido y no conservan
// `input_code` en su firma. Las demás siguen usando la firma legacy mientras
// migran gradualmente; service_role supera validate_admin_code sin exponer
// ninguna credencial al navegador.
const CODELESS_RPCS = new Set([
  'list_logs_admin',
  'list_log_mobs_admin',
  'list_log_items_admin',
  'list_comments_admin',
  'set_log_published',
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

function safeText(value: unknown, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

const PLATFORM_OWNER_FALLBACK_ID = '726444396970770494';

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta el secreto ${name}.`);
  return value;
}

function base64Utf8(value: unknown) {
  const bytes = new TextEncoder().encode(String(value ?? ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function discordIdentity(user: any) {
  const identity = (user?.identities || []).find((item: any) => item.provider === 'discord');
  const data = identity?.identity_data || user?.user_metadata || {};
  const candidates = [
    data.provider_id,
    data.sub,
    user?.user_metadata?.provider_id,
    user?.user_metadata?.sub,
  ].map(value => safeText(value, 64));
  // Los IDs de usuario de Discord son snowflakes numéricos. No se usa
  // identity.id como fallback porque Supabase puede guardar ahí el UUID
  // interno de la identidad, que no representa al usuario en Discord.
  const id = candidates.find(value => /^\d{15,22}$/.test(value)) || '';
  return {
    id,
    username: safeText(data.user_name || data.username || user?.user_metadata?.user_name || 'Usuario', 80),
    globalName: safeText(data.full_name || data.global_name || data.name || '', 100),
    avatarUrl: safeText(data.avatar_url || user?.user_metadata?.avatar_url || '', 600),
  };
}

async function discordRequest(path: string) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}` },
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text();
    const error: any = new Error(`Discord respondió ${response.status}: ${detail.slice(0, 300)}`);
    error.code = `DISCORD_${response.status}`;
    throw error;
  }
  return response.json();
}

async function loadGuildConfig(rawService: any) {
  const configuredGuild = Deno.env.get('DISCORD_GUILD_ID') || '';
  const cacheKey = configuredGuild || '__first_configured_guild__';
  if (guildConfigCache?.key === cacheKey && guildConfigCache.expiresAt > Date.now()) {
    return guildConfigCache.value;
  }
  if (guildConfigPromise) return guildConfigPromise;

  guildConfigPromise = (async () => {
    let configQuery = rawService.from('discord_guild_config').select('*');
    configQuery = configuredGuild
      ? configQuery.eq('guild_id', configuredGuild)
      : configQuery.order('created_at', { ascending: true }).limit(1);
    let { data: config, error: configError } = await configQuery.maybeSingle();
    if (configError) throw configError;
    if (!config && configuredGuild) {
      const upsert = await rawService
        .from('discord_guild_config')
        .upsert({ guild_id: configuredGuild, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' })
        .select('*')
        .single();
      if (upsert.error) throw upsert.error;
      config = upsert.data;
    }
    guildConfigCache = { key: cacheKey, value: config, expiresAt: Date.now() + GUILD_CONFIG_CACHE_MS };
    return config;
  })().finally(() => { guildConfigPromise = null; });
  return guildConfigPromise;
}

async function loadDiscordMember(guildId: string, identityId: string) {
  const cacheKey = `${guildId}:${identityId}`;
  const cached = discordMemberCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pendingMember = discordMemberPromises.get(cacheKey);
  if (pendingMember) return pendingMember;

  const request = (async () => {
    const member = await discordRequest(`/guilds/${guildId}/members/${identityId}`);
    discordMemberCache.set(cacheKey, {
      value: member,
      expiresAt: Date.now() + (member ? DISCORD_MEMBER_CACHE_MS : DISCORD_NON_MEMBER_CACHE_MS),
    });

    // Cota defensiva para una instancia que permanezca caliente mucho tiempo.
    if (discordMemberCache.size > 250) {
      const now = Date.now();
      for (const [key, entry] of discordMemberCache) {
        if (entry.expiresAt <= now || discordMemberCache.size > 200) discordMemberCache.delete(key);
      }
    }
    return member;
  })().finally(() => { discordMemberPromises.delete(cacheKey); });
  discordMemberPromises.set(cacheKey, request);
  return request;
}

async function loadAuthenticatedUser(userClient: any, token: string) {
  const tokenKey = await sha256(token);
  const cached = authUserCache.get(tokenKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { data: { user: cached.user }, error: null };
  }
  const pending = authUserPromises.get(tokenKey);
  if (pending) return pending;

  const request = userClient.auth.getUser(token).then((result: any) => {
    if (!result.error && result.data?.user) {
      authUserCache.set(tokenKey, { user: result.data.user, expiresAt: Date.now() + AUTH_USER_CACHE_MS });
    }
    if (authUserCache.size > 100) {
      const now = Date.now();
      for (const [key, entry] of authUserCache) {
        if (entry.expiresAt <= now || authUserCache.size > 80) authUserCache.delete(key);
      }
    }
    return result;
  }).finally(() => authUserPromises.delete(tokenKey));
  authUserPromises.set(tokenKey, request);
  return request;
}

async function authenticate(req: Request) {
  const supabaseUrl = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) throw Object.assign(new Error('Inicia sesión con Discord.'), { code: 'AUTH_REQUIRED', status: 401 });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rawService = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Sesión y configuración son independientes; resolverlas en paralelo quita
  // un viaje de red de la ruta crítica de todas las acciones administrativas.
  const [userResult, config] = await Promise.all([
    loadAuthenticatedUser(userClient, token),
    loadGuildConfig(rawService),
  ]);
  const { data: userData, error: userError } = userResult;
  if (userError || !userData.user) throw Object.assign(new Error('La sesión expiró. Vuelve a iniciar sesión.'), { code: 'AUTH_INVALID', status: 401 });

  const identity = discordIdentity(userData.user);
  if (!identity.id) throw Object.assign(new Error('La cuenta no contiene una identidad de Discord válida.'), { code: 'DISCORD_IDENTITY_MISSING', status: 403 });

  const configuredOwner = safeText(Deno.env.get('PLATFORM_OWNER_DISCORD_ID') || PLATFORM_OWNER_FALLBACK_ID, 22);
  let isPlatformOwner = false;
  if (identity.id === configuredOwner) {
    const { data: ownerRow, error: ownerError } = await rawService
      .from('platform_owners')
      .select('discord_user_id,active')
      .eq('discord_user_id', identity.id)
      .eq('active', true)
      .maybeSingle();
    if (ownerError) throw ownerError;
    isPlatformOwner = !!ownerRow;
  }

  if (!config?.guild_id || config.guild_id === 'CONFIGURE_WITH_BOT') throw Object.assign(new Error('El servidor oficial todavía no está configurado.'), { code: 'GUILD_NOT_CONFIGURED', status: 503 });

  let member = null;
  try {
    member = await loadDiscordMember(config.guild_id, identity.id);
  } catch (error) {
    // El Owner global no depende de pertenecer a una guild ni de tener el rol
    // local. El resto de cuentas mantiene exactamente la validación anterior.
    if (!isPlatformOwner) throw error;
    console.warn('[discord-admin-api] No se pudo enriquecer el perfil Owner con la guild:', error);
  }
  const isMember = !!member;
  const hasConfiguredRole = !!(member && config.admin_role_id && Array.isArray(member.roles) && member.roles.includes(config.admin_role_id));
  const isAdmin = isPlatformOwner || hasConfiguredRole;
  const guildAvatar = member?.avatar
    ? `https://cdn.discordapp.com/guilds/${config.guild_id}/users/${identity.id}/avatars/${member.avatar}.png?size=128`
    : '';
  const profile = {
    discordId: identity.id,
    username: identity.username,
    globalName: identity.globalName,
    displayName: safeText(member?.nick || identity.globalName || identity.username, 100),
    avatarUrl: guildAvatar || identity.avatarUrl,
  };
  const requestId = crypto.randomUUID();
  // Estas cabeceras solo viajan de la Edge Function a PostgREST usando la
  // service role. Un trigger de migration_021 las usa para asociar los
  // registros legacy de action_log con la cuenta Discord correcta sin hacer
  // búsquedas por tiempo que podrían mezclar dos administradores concurrentes.
  const service = createClient(supabaseUrl, serviceKey, {
    global: { headers: {
      'x-culones-auth-user': userData.user.id,
      'x-culones-discord-user': identity.id,
      'x-culones-actor-b64': base64Utf8(profile.displayName),
      'x-culones-avatar-b64': base64Utf8(profile.avatarUrl),
      'x-culones-request-id': requestId,
    } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { service, user: userData.user, identity, profile, member, config, isMember, isAdmin, isPlatformOwner, requestId };
}

function requireAdmin(ctx: any) {
  if (!ctx.isAdmin) {
    const error: any = new Error(ctx.isMember
      ? 'Tu cuenta no tiene el rol administrativo configurado.'
      : 'Tu cuenta no pertenece actualmente al servidor oficial.');
    error.code = ctx.isMember ? 'ADMIN_ROLE_REQUIRED' : 'GUILD_MEMBER_REQUIRED';
    error.status = 403;
    throw error;
  }
}

async function recordAudit(ctx: any, fields: Record<string, any>) {
  const row = {
    actor: ctx.profile.displayName || ctx.identity.username,
    action: safeText(fields.action || 'admin_action', 80),
    description: safeText(fields.description || 'Acción administrativa completada.', 1200),
    auth_user_id: ctx.user.id,
    discord_user_id: ctx.identity.id,
    actor_avatar_url: ctx.profile.avatarUrl || null,
    entity_type: safeText(fields.entity_type, 80) || null,
    entity_id: safeText(fields.entity_id, 160) || null,
    entity_name: safeText(fields.entity_name, 200) || null,
    old_value: fields.old_value ?? null,
    new_value: fields.new_value ?? null,
    metadata: fields.metadata || {},
    success: fields.success !== false,
  };
  await ctx.service.from('action_log').insert(row);
}

async function ensureRpcAudit(ctx: any, rpcName: string, params: Record<string, any>) {
  if (!WRITE_RPCS.has(rpcName)) return;
  // migration_021 añade request_id a cada fila creada por la RPC mediante un
  // trigger. Así sabemos si la propia función ya dejó auditoría sin atribuir
  // por accidente filas de otra solicitud concurrente.
  const { data: rows, error } = await ctx.service
    .from('action_log')
    .select('id')
    .eq('metadata->>request_id', ctx.requestId)
    .limit(1);
  if (error) throw error;
  if (!rows?.length) {
    await recordAudit(ctx, {
      action: rpcName,
      description: `${ctx.profile.displayName} ejecutó la acción administrativa “${rpcName}”.`,
      entity_id: params.input_id || params.id || null,
      metadata: { source: 'discord-oauth', rpc: rpcName, request_id: ctx.requestId },
    });
  }
}

async function handleRpc(ctx: any, body: any) {
  requireAdmin(ctx);
  const name = safeText(body.rpc_name, 100);
  if (!ADMIN_RPCS.has(name)) throw Object.assign(new Error('La operación solicitada no está permitida.'), { code: 'RPC_NOT_ALLOWED', status: 403 });
  const params = { ...(body.params || {}) };
  delete params.input_code;
  if (!CODELESS_RPCS.has(name)) params.input_code = null;

  if (name === 'delete_weapon' && params.input_id) {
    const existing = await ctx.service.from('guide_forum_publications').select('thread_id,status').eq('guide_id', params.input_id).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.thread_id && existing.data.status !== 'unpublished') {
      const error: any = new Error('Esta Guía sigue publicada en Discord. Despublícala del foro antes de eliminarla definitivamente.');
      error.code = 'GUIDE_STILL_PUBLISHED';
      error.status = 409;
      throw error;
    }
  }

  if (name === 'record_admin_action') {
    await recordAudit(ctx, {
      action: params.input_action,
      description: params.input_description,
      metadata: { source: 'web-client' },
    });
    return null;
  }

  const { data, error } = await ctx.service.rpc(name, params);
  if (error) throw error;

  // Ocultar una Guía elimina su publicación de Discord, pero volver a
  // mostrarla no la republica automáticamente.
  if (name === 'set_weapon_published' && params.input_id && params.input_published === false) {
    const { data: publication } = await ctx.service.from('guide_forum_publications').select('thread_id,status').eq('guide_id', params.input_id).maybeSingle();
    if (publication?.thread_id && publication.status !== 'unpublished') {
      const key = `guide:${params.input_id}:unpublish:hidden:${publication.thread_id}`;
      const payload = {
        reason: 'guide_hidden',
        guide_name: safeText((data as any)?.name || params.input_name || 'Guía', 200),
        requested_actor_name: ctx.profile.displayName,
        requested_actor_avatar_url: ctx.profile.avatarUrl || null,
      };
      const existingJob = await ctx.service.from('guide_forum_jobs').select('id,status').eq('idempotency_key', key).maybeSingle();
      if (existingJob.error) throw existingJob.error;
      if (!existingJob.data) {
        const queued = await ctx.service.from('guide_forum_jobs').insert({
          guide_id: params.input_id,
          action: 'unpublish',
          requested_by: ctx.user.id,
          requested_discord_user_id: ctx.identity.id,
          idempotency_key: key,
          payload,
          status: 'pending',
        });
        if (queued.error) throw queued.error;
      } else if (['failed', 'cancelled'].includes(existingJob.data.status)) {
        const restarted = await ctx.service.from('guide_forum_jobs').update({
          status: 'pending', attempts: 0, error_code: null, error_message: null,
          requested_by: ctx.user.id, requested_discord_user_id: ctx.identity.id,
          payload, started_at: null, completed_at: null,
        }).eq('id', existingJob.data.id);
        if (restarted.error) throw restarted.error;
      }
      await ctx.service.from('guide_forum_publications').update({ status: 'unpublishing', updated_at: new Date().toISOString() }).eq('guide_id', params.input_id);
    }
  }

  await ensureRpcAudit(ctx, name, params);
  return data;
}

function normalizeReactions(value: unknown) {
  const result: any[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const normalized = typeof item === 'string'
      ? { type: 'unicode', value: safeText(item, 100) }
      : { type: item?.type === 'custom' ? 'custom' : 'unicode', value: safeText(item?.value || item?.id || item?.name, 100), name: safeText(item?.name, 100), animated: !!item?.animated };
    if (!normalized.value) continue;
    if (!result.some(existing => existing.type === normalized.type && existing.value === normalized.value)) result.push(normalized);
    if (result.length >= 20) break;
  }
  return result;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function stable(value: any): any {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function guideHashPayload(bundle: any) {
  const weapon = bundle?.weapon || {};
  const category = bundle?.category || {};
  const type = bundle?.type || {};
  return {
    weapon: {
      id: weapon.id,
      name: weapon.name,
      image_url: weapon.image_url,
      category_id: weapon.category_id,
      type_id: weapon.type_id,
      published: weapon.published,
      sort_order: weapon.sort_order,
    },
    category: { id: category.id, label: category.label, color: category.color, emoji: category.emoji },
    type: { id: type.id, label: type.label },
    ranks: (bundle?.ranks || []).map((rank: any) => ({
      id: rank.id,
      name: rank.name,
      description: rank.description,
      image_url: rank.image_url,
      stats: rank.stats,
      abilities: rank.abilities,
      upgrade_recipe: rank.upgrade_recipe,
      extra_sections: rank.extra_sections,
      sort_order: rank.sort_order,
    })),
  };
}

async function loadGuideBundle(service: any, guideId: string) {
  const [weaponResult, ranksResult] = await Promise.all([
    service.from('weapons').select('*').eq('id', guideId).maybeSingle(),
    service.from('weapon_ranks').select('*').eq('weapon_id', guideId).order('sort_order', { ascending: true }),
  ]);
  if (weaponResult.error) throw weaponResult.error;
  if (ranksResult.error) throw ranksResult.error;
  const weapon = weaponResult.data;
  if (!weapon) return null;
  const [categoryResult, typeResult] = await Promise.all([
    weapon.category_id ? service.from('weapon_categories').select('*').eq('id', weapon.category_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    weapon.type_id ? service.from('weapon_types').select('*').eq('id', weapon.type_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (categoryResult.error) throw categoryResult.error;
  if (typeResult.error) throw typeResult.error;
  return { weapon, category: categoryResult.data || null, type: typeResult.data || null, ranks: ranksResult.data || [] };
}

async function computeGuideHash(service: any, guideId: string) {
  const bundle = await loadGuideBundle(service, guideId);
  if (!bundle) return { bundle: null, hash: null };
  return { bundle, hash: await sha256(JSON.stringify(stable(guideHashPayload(bundle)))) };
}

async function enqueueGuideJob(ctx: any, body: any) {
  requireAdmin(ctx);
  const action = safeText(body.job_action, 40);
  if (!['publish','update','unpublish','reconcile'].includes(action)) throw Object.assign(new Error('Acción de foro inválida.'), { code: 'INVALID_JOB_ACTION', status: 400 });
  const guideId = safeText(body.guide_id, 80);
  if (!guideId) throw Object.assign(new Error('Falta el ID de la Guía.'), { code: 'GUIDE_ID_REQUIRED', status: 400 });

  const { bundle, hash: currentHash } = await computeGuideHash(ctx.service, guideId);
  const guide = bundle?.weapon;
  if (!guide) throw Object.assign(new Error('La Guía no existe.'), { code: 'GUIDE_NOT_FOUND', status: 404 });
  if (['publish','update'].includes(action)) {
    if (!guide.published) throw Object.assign(new Error('La Guía está oculta en la página.'), { code: 'GUIDE_HIDDEN', status: 409 });
    if (!bundle?.category || !bundle?.type) throw Object.assign(new Error('La Guía necesita categoría y tipo antes de publicarse.'), { code: 'GUIDE_CLASSIFICATION_REQUIRED', status: 409 });
  }

  const version = safeText(currentHash || guide.updated_at || crypto.randomUUID(), 160);
  const idempotencyKey = `guide:${guideId}:${action}:${version}`;
  const row = {
    guide_id: guideId,
    action,
    requested_by: ctx.user.id,
    requested_discord_user_id: ctx.identity.id,
    idempotency_key: idempotencyKey,
    payload: {
      ...(body.payload || {}),
      content_hash: currentHash,
      guide_name: safeText(guide.name, 200),
      requested_actor_name: ctx.profile.displayName,
      requested_actor_avatar_url: ctx.profile.avatarUrl || null,
    },
    status: 'pending',
  };
  const existingJobResult = await ctx.service.from('guide_forum_jobs').select('*').eq('idempotency_key', idempotencyKey).maybeSingle();
  if (existingJobResult.error) throw existingJobResult.error;
  let data = existingJobResult.data;
  if (!data) {
    const inserted = await ctx.service.from('guide_forum_jobs').insert(row).select('*').single();
    if (inserted.error) throw inserted.error;
    data = inserted.data;
  } else if (!['pending', 'processing'].includes(data.status)) {
    const restarted = await ctx.service.from('guide_forum_jobs').update({
      status: 'pending', attempts: 0, error_code: null, error_message: null,
      requested_by: ctx.user.id, requested_discord_user_id: ctx.identity.id,
      payload: row.payload, started_at: null, completed_at: null,
    }).eq('id', data.id).select('*').single();
    if (restarted.error) throw restarted.error;
    data = restarted.data;
  }
  if (action === 'unpublish') {
    await ctx.service.from('guide_forum_publications').update({ status: 'unpublishing', updated_at: new Date().toISOString() }).eq('guide_id', guideId);
  } else {
    await ctx.service.from('guide_forum_publications').upsert({
      guide_id: guideId,
      status: action === 'publish' ? 'publishing' : 'updating',
      last_error_code: null,
      last_error_message: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guide_id' });
  }
  await recordAudit(ctx, {
    action: `guide_forum_${action}`,
    description: `${ctx.profile.displayName} solicitó ${action === 'publish' ? 'publicar' : action === 'update' ? 'actualizar' : action === 'unpublish' ? 'despublicar' : 'reconciliar'} la Guía “${guide.name}” en Discord.`,
    entity_type: 'guide', entity_id: guide.id, entity_name: guide.name,
    metadata: { job_id: data?.id || null, forum_action: action },
  });
  return data || { status: 'pending', idempotency_key: idempotencyKey };
}

async function guideStatus(ctx: any, guideId: string) {
  requireAdmin(ctx);
  const [{ hash: currentHash }, publication, job] = await Promise.all([
    computeGuideHash(ctx.service, guideId),
    ctx.service.from('guide_forum_publications').select('*').eq('guide_id', guideId).maybeSingle(),
    ctx.service.from('guide_forum_jobs').select('*').eq('guide_id', guideId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (publication.error) throw publication.error;
  if (job.error) throw job.error;
  return {
    publication: publication.data,
    latestJob: job.data,
    config: {
      guides_forum_channel_id: ctx.config.guides_forum_channel_id,
      forum_reactions: ctx.config.forum_reactions || [],
    },
    currentHash,
    isOutdated: Boolean(publication.data?.thread_id && publication.data?.published_hash !== currentHash),
  };
}

async function adminHealth(ctx: any) {
  requireAdmin(ctx);
  const databaseStarted = performance.now();
  const databasePromise = ctx.service.from('app_settings').select('key').limit(1).then((result: any) => ({
    ...result,
    latencyMs: Math.round(performance.now() - databaseStarted),
  }));
  const [databaseResult, forumJobsResult] = await Promise.all([
    databasePromise,
    ctx.service
      .from('guide_forum_jobs')
      .select('status,created_at')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(250),
  ]);
  const jobs = forumJobsResult.data || [];
  const count = (status: string) => jobs.filter((job: any) => job.status === status).length;
  return {
    checked_at: new Date().toISOString(),
    database: {
      ok: !databaseResult.error,
      latency_ms: databaseResult.latencyMs,
      message: databaseResult.error?.message || 'Lectura administrativa completada.',
    },
    edge: { ok: true },
    discord: {
      is_member: ctx.isMember,
      is_admin: ctx.isAdmin,
      role_configured: !!ctx.config.admin_role_id,
    },
    forum: {
      configured: !!ctx.config.guides_forum_channel_id,
      pending: count('pending'),
      processing: count('processing'),
      failed: count('failed'),
      latest_job_at: jobs[0]?.created_at || null,
      query_ok: !forumJobsResult.error,
      message: forumJobsResult.error?.message || null,
    },
  };
}

async function selectAllRows(service: any, table: string, order: Array<{ column: string; ascending?: boolean }> = []) {
  const output: any[] = [];
  const pageSize = 1_000;
  for (let from = 0; ; from += pageSize) {
    let query = service.from(table).select('*').range(from, from + pageSize - 1);
    for (const item of order) query = query.order(item.column, { ascending: item.ascending !== false });
    const result = await query;
    if (result.error) throw result.error;
    const page = result.data || [];
    output.push(...page);
    if (page.length < pageSize) break;
  }
  return output;
}

async function backupBundle(ctx: any, requestedScope: unknown = 'all') {
  requireAdmin(ctx);
  const scope = ['logs', 'tierlist', 'all'].includes(String(requestedScope)) ? String(requestedScope) : 'all';
  const includeLogs = scope === 'logs' || scope === 'all';
  const includeTierlist = scope === 'tierlist' || scope === 'all';
  const includeFull = scope === 'all';
  const [logs, mobs, items, categories, tierRows, tierItems, weapons, weaponCategories, weaponTypes, weaponRanks, kits, mediaAssets, appSettings] = await Promise.all([
    includeLogs ? selectAllRows(ctx.service, 'logs', [{ column: 'created_at', ascending: false }, { column: 'id' }]) : [],
    includeLogs ? selectAllRows(ctx.service, 'log_mobs', [{ column: 'log_id' }, { column: 'sort_order' }, { column: 'id' }]) : [],
    includeLogs ? selectAllRows(ctx.service, 'log_items', [{ column: 'log_id' }, { column: 'sort_order' }, { column: 'id' }]) : [],
    includeLogs ? selectAllRows(ctx.service, 'categories', [{ column: 'label' }, { column: 'slug' }]) : [],
    includeTierlist ? selectAllRows(ctx.service, 'tierlist_rows', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeTierlist ? selectAllRows(ctx.service, 'tierlist_items', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'weapons', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'weapon_categories', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'weapon_types', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'weapon_ranks', [{ column: 'weapon_id' }, { column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'kits', [{ column: 'sort_order' }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'media_assets', [{ column: 'created_at', ascending: false }, { column: 'id' }]) : [],
    includeFull ? selectAllRows(ctx.service, 'app_settings', [{ column: 'key' }]) : [],
  ]);

  const mobsByLog = new Map<string, any[]>();
  const itemsByLog = new Map<string, any[]>();
  mobs.forEach((mob: any) => {
    const key = String(mob.log_id);
    if (!mobsByLog.has(key)) mobsByLog.set(key, []);
    mobsByLog.get(key)?.push(mob);
  });
  items.forEach((item: any) => {
    const key = String(item.log_id);
    if (!itemsByLog.has(key)) itemsByLog.set(key, []);
    itemsByLog.get(key)?.push(item);
  });
  const ranksByWeapon: Record<string, any[]> = {};
  weaponRanks.forEach((rank: any) => {
    const key = String(rank.weapon_id);
    if (!ranksByWeapon[key]) ranksByWeapon[key] = [];
    ranksByWeapon[key].push(rank);
  });
  const bundle: Record<string, any> = {};
  if (includeLogs) {
    bundle.logs = logs.map((log: any) => ({
      ...log,
      mobs: mobsByLog.get(String(log.id)) || [],
      items: itemsByLog.get(String(log.id)) || [],
    }));
    bundle.categories = categories;
  }
  if (includeTierlist) bundle.tierlist = { rows: tierRows, items: tierItems };
  if (includeFull) Object.assign(bundle, {
    weapons,
    weapon_categories: weaponCategories,
    weapon_types: weaponTypes,
    weapon_ranks: ranksByWeapon,
    kits,
    media_assets: mediaAssets,
    app_settings: appSettings.map((setting: any) => pick(setting, ['key', 'value', 'updated_at'])),
  });
  return bundle;
}

function rows(value: unknown, max = 10_000) {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item === 'object').slice(0, max);
}

function pick(row: any, fields: string[]) {
  const output: Record<string, any> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row || {}, field) && row[field] !== undefined) output[field] = row[field];
  }
  return output;
}

async function upsertChunks(service: any, table: string, records: any[], onConflict = 'id', ignoreDuplicates = false) {
  if (!records.length) return;
  for (let index = 0; index < records.length; index += 200) {
    const result = await service.from(table).upsert(records.slice(index, index + 200), { onConflict, ignoreDuplicates });
    if (result.error) throw result.error;
  }
}

async function currentPublishedMap(service: any, table: string, ids: unknown[]) {
  const output = new Map<string, boolean>();
  const cleanIds = [...new Set(ids.map(id => safeText(id, 160)).filter(Boolean))];
  for (let index = 0; index < cleanIds.length; index += 200) {
    const result = await service.from(table).select('id,published').in('id', cleanIds.slice(index, index + 200));
    if (result.error) throw result.error;
    (result.data || []).forEach((row: any) => output.set(String(row.id), row.published === true));
  }
  return output;
}

async function existingIdSet(service: any, table: string, ids: unknown[]) {
  const output = new Set<string>();
  const cleanIds = [...new Set(ids.map(id => safeText(id, 160)).filter(Boolean))];
  for (let index = 0; index < cleanIds.length; index += 200) {
    const result = await service.from(table).select('id').in('id', cleanIds.slice(index, index + 200));
    if (result.error) throw result.error;
    (result.data || []).forEach((row: any) => output.add(String(row.id)));
  }
  return output;
}

async function currentParentMap(service: any, table: string, parentColumn: string, ids: unknown[]) {
  const output = new Map<string, string>();
  const cleanIds = [...new Set(ids.map(id => safeText(id, 160)).filter(Boolean))];
  for (let index = 0; index < cleanIds.length; index += 200) {
    const result = await service.from(table).select(`id,${parentColumn}`).in('id', cleanIds.slice(index, index + 200));
    if (result.error) throw result.error;
    (result.data || []).forEach((row: any) => output.set(String(row.id), String(row[parentColumn] || '')));
  }
  return output;
}

function flattenWeaponRanks(backup: any) {
  const source = backup?.weapon_ranks;
  if (Array.isArray(source)) return source.slice(0, 10_000);
  if (!source || typeof source !== 'object') return [];
  return Object.values(source).flatMap(value => rows(value)).slice(0, 10_000);
}

async function restoreBackup(ctx: any, body: any) {
  requireAdmin(ctx);
  const backup = body?.backup;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    throw Object.assign(new Error('El respaldo no contiene un objeto válido.'), { code: 'BACKUP_INVALID', status: 400 });
  }
  const type = safeText(backup.type, 40);
  if (!['logs', 'tierlist', 'full_backup'].includes(type)) {
    throw Object.assign(new Error('El tipo de respaldo no es compatible.'), { code: 'BACKUP_TYPE_UNSUPPORTED', status: 400 });
  }
  const version = Number(backup.version || 1);
  if (!Number.isFinite(version) || version < 1 || version > 2) {
    throw Object.assign(new Error('La versión del respaldo no es compatible.'), { code: 'BACKUP_VERSION_UNSUPPORTED', status: 400 });
  }

  const backupLogs = rows(backup.logs || backup.data);
  const recordCount = [
    backupLogs.length,
    backupLogs.reduce((sum: number, log: any) => sum + rows(log.mobs).length + rows(log.items).length, 0),
    rows(backup.rows || backup.tierlist?.rows).length,
    rows(backup.items || backup.tierlist?.items).length,
    rows(backup.weapons).length,
    rows(backup.categories).length,
    rows(backup.weapon_categories).length,
    rows(backup.weapon_types).length,
    flattenWeaponRanks(backup).length,
    rows(backup.kits).length,
    rows(backup.media_assets).length,
    rows(backup.app_settings).length,
  ].reduce((sum, value) => sum + value, 0);
  if (recordCount > 30_000) {
    throw Object.assign(new Error('El respaldo supera el límite de 30 000 registros.'), { code: 'BACKUP_TOO_LARGE', status: 413 });
  }

  const selection = new Set(rows(body.selections, 30_000).map((item: any) => `${safeText(item.kind, 40)}:${safeText(item.id, 160)}`));
  const chosen = (kind: string, id: unknown) => selection.has(`${kind}:${safeText(id, 160)}`);
  const counts: Record<string, number> = { logs: 0, tier_rows: 0, tier_items: 0, guides: 0, ranks: 0, kits: 0, media: 0, settings: 0 };

  const importLogs = backupLogs.filter((log: any) => chosen('log', log.id));
  if (importLogs.length) {
    importLogs.forEach((log: any) => { if (!log.id) log.id = crypto.randomUUID(); });
    const referencedCategories = new Set(importLogs.map((log: any) => String(log.category || '')).filter(Boolean));
    const categories = rows(backup.categories).map((category: any) => pick(category, ['slug', 'label', 'emoji', 'color', 'created_at'])).filter((category: any) => category.slug && category.label && referencedCategories.has(String(category.slug)));
    await upsertChunks(ctx.service, 'categories', categories, 'slug', true);
    const currentLogVisibility = await currentPublishedMap(ctx.service, 'logs', importLogs.map((log: any) => log.id));
    const logRecords = importLogs.map((log: any) => ({
      ...pick(log, ['id', 'title', 'description', 'category', 'relevance', 'cover_image_url', 'created_at']),
      id: log.id || crypto.randomUUID(),
      title: safeText(log.title || 'Log restaurado', 300),
      description: String(log.description || ''),
      // Una restauración nunca publica contenido nuevo automáticamente en
      // Discord. Los Logs existentes conservan su visibilidad actual.
      published: currentLogVisibility.has(String(log.id)) ? currentLogVisibility.get(String(log.id)) : false,
    }));
    await upsertChunks(ctx.service, 'logs', logRecords);
    const mobFields = ['id', 'name', 'health', 'damage', 'armor', 'equipment', 'location', 'description', 'extra_fields', 'image_url', 'sort_order', 'created_at'];
    const itemFields = ['id', 'name', 'tier', 'item_type', 'obtained_from', 'damage', 'enchantments', 'description', 'extra_fields', 'image_url', 'sort_order', 'created_at'];
    const mobs: any[] = [];
    const items: any[] = [];
    importLogs.forEach((log: any) => {
      rows(log.mobs).forEach((mob: any, index: number) => mobs.push({ ...pick(mob, mobFields), id: mob.id || crypto.randomUUID(), log_id: log.id, name: safeText(mob.name || `Mob ${index + 1}`, 300), sort_order: mob.sort_order ?? index }));
      rows(log.items).forEach((item: any, index: number) => items.push({ ...pick(item, itemFields), id: item.id || crypto.randomUUID(), log_id: log.id, name: safeText(item.name || `Item ${index + 1}`, 300), sort_order: item.sort_order ?? index }));
    });
    const [mobParents, itemParents] = await Promise.all([
      currentParentMap(ctx.service, 'log_mobs', 'log_id', mobs.map((mob: any) => mob.id)),
      currentParentMap(ctx.service, 'log_items', 'log_id', items.map((item: any) => item.id)),
    ]);
    mobs.forEach((mob: any) => { if (mobParents.has(String(mob.id)) && mobParents.get(String(mob.id)) !== String(mob.log_id)) mob.id = crypto.randomUUID(); });
    items.forEach((item: any) => { if (itemParents.has(String(item.id)) && itemParents.get(String(item.id)) !== String(item.log_id)) item.id = crypto.randomUUID(); });
    await upsertChunks(ctx.service, 'log_mobs', mobs);
    await upsertChunks(ctx.service, 'log_items', items);
    counts.logs = importLogs.length;
  }

  const tierRows = rows(backup.rows || backup.tierlist?.rows).filter((row: any) => chosen('tier_row', row.id)).map((row: any) => ({ ...pick(row, ['id', 'name', 'color', 'sort_order', 'created_at']), id: row.id || crypto.randomUUID() }));
  await upsertChunks(ctx.service, 'tierlist_rows', tierRows);
  counts.tier_rows = tierRows.length;

  const tierItems = rows(backup.items || backup.tierlist?.items).filter((item: any) => chosen('tier_item', item.id)).map((item: any) => ({ ...pick(item, ['id', 'row_id', 'column_key', 'name', 'image_url', 'extra_fields', 'sort_order', 'created_at']), id: item.id || crypto.randomUUID() }));
  const referencedRows = [...new Set(tierItems.map((item: any) => item.row_id).filter(Boolean))];
  if (referencedRows.length) {
    const validRows = await existingIdSet(ctx.service, 'tierlist_rows', referencedRows);
    tierItems.forEach((item: any) => { if (item.row_id && !validRows.has(String(item.row_id))) item.row_id = null; });
  }
  await upsertChunks(ctx.service, 'tierlist_items', tierItems);
  counts.tier_items = tierItems.length;

  const selectedWeapons = rows(backup.weapons).filter((weapon: any) => chosen('weapon', weapon.id));
  if (selectedWeapons.length) {
    const referencedCategoryIds = new Set(selectedWeapons.map((weapon: any) => String(weapon.category_id || '')).filter(Boolean));
    const referencedTypeIds = new Set(selectedWeapons.map((weapon: any) => String(weapon.type_id || '')).filter(Boolean));
    const categoryDependencies = rows(backup.weapon_categories).map((item: any) => pick(item, ['id', 'label', 'color', 'sort_order', 'created_at'])).filter((item: any) => item.id && item.label && referencedCategoryIds.has(String(item.id)));
    const typeDependencies = rows(backup.weapon_types).map((item: any) => pick(item, ['id', 'label', 'sort_order', 'created_at'])).filter((item: any) => item.id && item.label && referencedTypeIds.has(String(item.id)));
    await Promise.all([
      upsertChunks(ctx.service, 'weapon_categories', categoryDependencies, 'id', true),
      upsertChunks(ctx.service, 'weapon_types', typeDependencies, 'id', true),
    ]);
    const [validCategoryIds, validTypeIds] = await Promise.all([
      existingIdSet(ctx.service, 'weapon_categories', [...referencedCategoryIds]),
      existingIdSet(ctx.service, 'weapon_types', [...referencedTypeIds]),
    ]);
    const currentWeaponVisibility = await currentPublishedMap(ctx.service, 'weapons', selectedWeapons.map((weapon: any) => weapon.id));
    const weaponRecords = selectedWeapons.map((weapon: any) => ({
      ...pick(weapon, ['id', 'name', 'image_url', 'category_id', 'type_id', 'sort_order', 'created_at', 'updated_at']),
      id: weapon.id || crypto.randomUUID(),
      name: safeText(weapon.name || 'Guía restaurada', 300),
      published: currentWeaponVisibility.has(String(weapon.id)) ? currentWeaponVisibility.get(String(weapon.id)) : false,
    })).map((weapon: any) => ({
      ...weapon,
      category_id: weapon.category_id && validCategoryIds.has(String(weapon.category_id)) ? weapon.category_id : null,
      type_id: weapon.type_id && validTypeIds.has(String(weapon.type_id)) ? weapon.type_id : null,
    }));
    await upsertChunks(ctx.service, 'weapons', weaponRecords);
    const weaponIds = new Set(selectedWeapons.map((weapon: any) => String(weapon.id)));
    const ranks = flattenWeaponRanks(backup).filter((rank: any) => weaponIds.has(String(rank.weapon_id))).map((rank: any) => ({ ...pick(rank, ['id', 'weapon_id', 'name', 'description', 'image_url', 'stats', 'abilities', 'extra_sections', 'upgrade_recipe', 'sort_order', 'created_at']), id: rank.id || crypto.randomUUID(), name: safeText(rank.name || 'Variante', 200) }));
    const rankParents = await currentParentMap(ctx.service, 'weapon_ranks', 'weapon_id', ranks.map((rank: any) => rank.id));
    ranks.forEach((rank: any) => { if (rankParents.has(String(rank.id)) && rankParents.get(String(rank.id)) !== String(rank.weapon_id)) rank.id = crypto.randomUUID(); });
    await upsertChunks(ctx.service, 'weapon_ranks', ranks);
    counts.guides = weaponRecords.length;
    counts.ranks = ranks.length;
  }

  const kits = rows(backup.kits).filter((kit: any) => chosen('kit', kit.id)).map((kit: any) => ({ ...pick(kit, ['id', 'name', 'description', 'published', 'items', 'sort_order', 'created_at', 'updated_at']), id: kit.id || crypto.randomUUID(), name: safeText(kit.name || 'Kit restaurado', 300) }));
  await upsertChunks(ctx.service, 'kits', kits);
  counts.kits = kits.length;

  if (chosen('app_settings', '__all__')) {
    let settings = rows(backup.app_settings).map((setting: any) => pick(setting, ['key', 'value', 'updated_at'])).filter((setting: any) => setting.key && setting.value !== undefined);
    if (!settings.length && backup.field_config) {
      settings = [
        { key: 'mob_fields', value: backup.field_config.mob || [] },
        { key: 'item_fields', value: backup.field_config.item || [] },
      ];
    }
    await upsertChunks(ctx.service, 'app_settings', settings, 'key');
    counts.settings = settings.length;
  }

  const media = rows(backup.media_assets).filter((asset: any) => chosen('media_asset', asset.id || asset.url)).map((asset: any) => ({ ...pick(asset, ['id', 'source_type', 'bucket', 'storage_path', 'folder', 'url', 'display_name', 'description', 'mime_type', 'media_kind', 'file_size', 'file_hash', 'tags', 'presentation', 'metadata', 'is_archived', 'created_at', 'updated_at']), id: asset.id || crypto.randomUUID() }));
  if (media.length) {
    const urls = [...new Set(media.map((asset: any) => asset.url).filter(Boolean))];
    const idsByUrl = new Map<string, string>();
    for (let index = 0; index < urls.length; index += 40) {
      const existing = await ctx.service.from('media_assets').select('id,url').in('url', urls.slice(index, index + 40));
      if (existing.error) throw existing.error;
      (existing.data || []).forEach((asset: any) => idsByUrl.set(asset.url, asset.id));
    }
    media.forEach((asset: any) => { if (idsByUrl.has(asset.url)) asset.id = idsByUrl.get(asset.url); });
    await upsertChunks(ctx.service, 'media_assets', media);
    counts.media = media.length;
  }

  await recordAudit(ctx, {
    action: 'backup_restored',
    description: `${ctx.profile.displayName} restauró un respaldo v${version} sin eliminar registros existentes.`,
    entity_type: 'backup',
    metadata: { counts, backup_version: version, backup_type: type },
  });
  return { counts, version, type };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Usa POST.' } }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await authenticate(req);
    const action = safeText(body.action, 80);

    if (action === 'status') {
      return json({ data: {
        isAdmin: ctx.isAdmin,
        isMember: ctx.isMember,
        isPlatformOwner: ctx.isPlatformOwner,
        profile: ctx.profile,
        roleConfigured: !!ctx.config.admin_role_id,
      } });
    }
    if (action === 'admin_health') return json({ data: await adminHealth(ctx) });
    if (action === 'backup_bundle') return json({ data: await backupBundle(ctx, body.scope) });
    if (action === 'restore_backup') return json({ data: await restoreBackup(ctx, body) });
    if (action === 'logs_admin_bundle') {
      requireAdmin(ctx);
      // Antes la web ejecutaba tres invocaciones Edge independientes y cada
      // una repetía Auth + Discord. Este paquete conserva la misma respuesta,
      // pero autentica una sola vez y resuelve las lecturas en paralelo.
      const [logs, mobs, items] = await Promise.all([
        ctx.service.from('logs').select('*').order('created_at', { ascending: false }),
        ctx.service.from('log_mobs').select('*').order('log_id').order('sort_order').order('created_at'),
        ctx.service.from('log_items').select('*').order('log_id').order('sort_order').order('created_at'),
      ]);
      const bundleError = logs.error || mobs.error || items.error;
      if (bundleError) throw bundleError;
      return json({ data: {
        logs: logs.data || [],
        mobs: mobs.data || [],
        items: items.data || [],
      } });
    }
    if (action === 'rpc') return json({ data: await handleRpc(ctx, body) });
    if (action === 'guild_config') {
      requireAdmin(ctx);
      return json({ data: {
        guildId: ctx.config.guild_id,
        adminRoleId: ctx.config.admin_role_id,
        guidesForumChannelId: ctx.config.guides_forum_channel_id,
        logChannelId: ctx.config.log_channel_id,
        forumReactions: ctx.config.forum_reactions || [],
      } });
    }
    if (action === 'guide_forum_job') return json({ data: await enqueueGuideJob(ctx, body) });
    if (action === 'guide_forum_status') return json({ data: await guideStatus(ctx, safeText(body.guide_id, 80)) });
    if (action === 'save_forum_reactions') {
      requireAdmin(ctx);
      const reactions = normalizeReactions(body.reactions);
      const { error } = await ctx.service.from('discord_guild_config').update({ forum_reactions: reactions, updated_by: ctx.user.id, updated_at: new Date().toISOString() }).eq('guild_id', ctx.config.guild_id);
      if (error) throw error;
      guildConfigCache = null;
      guildConfigPromise = null;
      let job = null;
      if (body.apply_existing) {
        const key = `guide:all:apply_reactions:${crypto.randomUUID()}`;
        const result = await ctx.service.from('guide_forum_jobs').insert({
          action: 'apply_reactions',
          requested_by: ctx.user.id,
          requested_discord_user_id: ctx.identity.id,
          idempotency_key: key,
          payload: {
            reactions,
            remove_old: true,
            requested_actor_name: ctx.profile.displayName,
            requested_actor_avatar_url: ctx.profile.avatarUrl || null,
          },
          status: 'pending',
        }).select('*').single();
        if (result.error) throw result.error;
        job = result.data;
      }
      await recordAudit(ctx, { action: 'forum_reactions_updated', description: `${ctx.profile.displayName} configuró ${reactions.length} reacción(es) predeterminadas para las publicaciones de Guías.`, entity_type: 'discord_forum', entity_id: ctx.config.guides_forum_channel_id, metadata: { reactions, apply_existing: !!body.apply_existing } });
      return json({ data: { reactions, job } });
    }
    if (action === 'create_signed_upload') {
      requireAdmin(ctx);
      const bucket = safeText(body.bucket || 'culones', 80);
      const path = safeText(body.path, 500);
      if (!path || path.includes('..')) throw Object.assign(new Error('Ruta de archivo inválida.'), { code: 'INVALID_STORAGE_PATH', status: 400 });
      const { data, error } = await ctx.service.storage.from(bucket).createSignedUploadUrl(path);
      if (error) throw error;
      return json({ data });
    }
    if (action === 'delete_storage_objects') {
      requireAdmin(ctx);
      const bucket = safeText(body.bucket || 'culones', 80);
      const paths = (Array.isArray(body.paths) ? body.paths : []).map((path: unknown) => safeText(path, 500)).filter(Boolean).filter((path: string) => !path.includes('..')).slice(0, 100);
      if (!paths.length) return json({ data: [] });
      const { data, error } = await ctx.service.storage.from(bucket).remove(paths);
      if (error) throw error;
      return json({ data });
    }
    if (action === 'record_action') {
      requireAdmin(ctx);
      await recordAudit(ctx, body.audit || {});
      return json({ data: true });
    }

    return json({ error: { code: 'UNKNOWN_ACTION', message: 'Acción desconocida.' } }, 400);
  } catch (error: any) {
    console.error('[discord-admin-api]', error);
    const status = Number(error?.status) || 500;
    return json({ error: { code: error?.code || 'ADMIN_API_ERROR', message: error?.message || 'Error interno.', details: error?.details || null } }, status);
  }
});

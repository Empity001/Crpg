import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

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
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) throw Object.assign(new Error('La sesión expiró. Vuelve a iniciar sesión.'), { code: 'AUTH_INVALID', status: 401 });

  const identity = discordIdentity(userData.user);
  if (!identity.id) throw Object.assign(new Error('La cuenta no contiene una identidad de Discord válida.'), { code: 'DISCORD_IDENTITY_MISSING', status: 403 });

  const configuredGuild = Deno.env.get('DISCORD_GUILD_ID');
  let configQuery = rawService.from('discord_guild_config').select('*');
  configQuery = configuredGuild ? configQuery.eq('guild_id', configuredGuild) : configQuery.order('created_at', { ascending: true }).limit(1);
  let { data: config, error: configError } = await configQuery.maybeSingle();
  if (configError) throw configError;
  if (!config && configuredGuild) {
    const upsert = await rawService.from('discord_guild_config').upsert({ guild_id: configuredGuild, updated_at: new Date().toISOString() }, { onConflict: 'guild_id' }).select('*').single();
    if (upsert.error) throw upsert.error;
    config = upsert.data;
  }
  if (!config?.guild_id || config.guild_id === 'CONFIGURE_WITH_BOT') throw Object.assign(new Error('El servidor oficial todavía no está configurado.'), { code: 'GUILD_NOT_CONFIGURED', status: 503 });

  const member = await discordRequest(`/guilds/${config.guild_id}/members/${identity.id}`);
  const isMember = !!member;
  const isAdmin = !!(member && config.admin_role_id && Array.isArray(member.roles) && member.roles.includes(config.admin_role_id));
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
  return { service, user: userData.user, identity, profile, member, config, isMember, isAdmin, requestId };
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
    .contains('metadata', { request_id: ctx.requestId })
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
  const [{ hash: currentHash }, publication, job, config] = await Promise.all([
    computeGuideHash(ctx.service, guideId),
    ctx.service.from('guide_forum_publications').select('*').eq('guide_id', guideId).maybeSingle(),
    ctx.service.from('guide_forum_jobs').select('*').eq('guide_id', guideId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.service.from('discord_guild_config').select('guides_forum_channel_id,forum_reactions').eq('guild_id', ctx.config.guild_id).maybeSingle(),
  ]);
  if (publication.error) throw publication.error;
  if (job.error) throw job.error;
  if (config.error) throw config.error;
  return {
    publication: publication.data,
    latestJob: job.data,
    config: config.data,
    currentHash,
    isOutdated: Boolean(publication.data?.thread_id && publication.data?.published_hash !== currentHash),
  };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Usa POST.' } }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const ctx = await authenticate(req);
    const action = safeText(body.action, 80);

    if (action === 'status') {
      return json({ data: { isAdmin: ctx.isAdmin, isMember: ctx.isMember, profile: ctx.profile, roleConfigured: !!ctx.config.admin_role_id } });
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

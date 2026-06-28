// supabase/functions/admin-write/index.ts
//
// POST { "token": "...", "action": "create" | "update" | "delete", "payload": {...} }
//
// create -> payload: { title, version, category, tags, relevance, description, content }
// update -> payload: { id, title, version, category, tags, relevance, description, content }
// delete -> payload: { id }
//
// Devuelve el log creado/editado, o { ok: true } en delete.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { token, action, payload } = await req.json()

    if (!token) {
      return Response.json({ error: 'Falta token de sesión' }, { status: 401, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // valida sesión
    const { data: session, error: sessionErr } = await supabase
      .from('admin_sessions')
      .select('token, expires_at')
      .eq('token', token)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (sessionErr) throw sessionErr
    if (!session) {
      return Response.json({ error: 'Sesión inválida o expirada, vuelve a iniciar sesión' }, { status: 401, headers: corsHeaders })
    }

    if (action === 'create') {
      const { title, version, category, tags, relevance, description, content } = payload
      if (!title || !category) {
        return Response.json({ error: 'Faltan campos obligatorios (title, category)' }, { status: 400, headers: corsHeaders })
      }

      const { data, error } = await supabase
        .from('logs')
        .insert({
          title,
          version: version ?? null,
          category,
          tags: tags ?? [],
          relevance: relevance ?? 'media',
          description: description ?? null,
          content: content ?? [],
        })
        .select()
        .single()

      if (error) throw error
      return Response.json({ log: data }, { headers: corsHeaders })
    }

    if (action === 'update') {
      const { id, ...fields } = payload
      if (!id) return Response.json({ error: 'Falta id' }, { status: 400, headers: corsHeaders })

      const { data, error } = await supabase
        .from('logs')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return Response.json({ log: data }, { headers: corsHeaders })
    }

    if (action === 'delete') {
      const { id } = payload
      if (!id) return Response.json({ error: 'Falta id' }, { status: 400, headers: corsHeaders })

      const { error } = await supabase.from('logs').delete().eq('id', id)
      if (error) throw error
      return Response.json({ ok: true }, { headers: corsHeaders })
    }

    return Response.json({ error: 'Acción no reconocida' }, { status: 400, headers: corsHeaders })
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Error interno' }, { status: 500, headers: corsHeaders })
  }
})

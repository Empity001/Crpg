// supabase/functions/admin-login/index.ts
//
// POST { "code": "ABC12345" }
// -> 200 { "token": "...", "expires_at": "..." }      si el código es válido y no expiró
// -> 401 { "error": "..." }                            si es inválido / expiró
//
// Esta función usa la SERVICE_ROLE_KEY (nunca se expone al navegador).
// Configúrala como secreto del proyecto:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
// (SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY ya vienen inyectadas automáticamente
//  por Supabase en todas las Edge Functions del proyecto, así que normalmente
//  no necesitas configurar nada extra para esta función)

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function sha256(text: string) {
  const data = new TextEncoder().encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return Response.json({ error: 'Falta el código' }, { status: 400, headers: corsHeaders })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const hash = await sha256(code.trim())

    const { data: match, error } = await supabase
      .from('admin_codes')
      .select('id, expires_at')
      .eq('code_hash', hash)
      .eq('active', true)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw error

    if (!match) {
      return Response.json(
        { error: 'Código inválido o expirado. Pídele uno nuevo al bot en Discord.' },
        { status: 401, headers: corsHeaders }
      )
    }

    // Crea una sesión de admin (vive 12 horas en el navegador)
    const token = crypto.randomUUID() + '-' + crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

    const { error: sessionError } = await supabase
      .from('admin_sessions')
      .insert({ token, expires_at: expiresAt })

    if (sessionError) throw sessionError

    return Response.json({ token, expires_at: expiresAt }, { headers: corsHeaders })
  } catch (err) {
    console.error(err)
    return Response.json({ error: 'Error interno' }, { status: 500, headers: corsHeaders })
  }
})

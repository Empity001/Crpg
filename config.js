// =========================================================
// CONFIGURACIÓN DE SUPABASE
// =========================================================
// La "anon key" está pensada para ser pública: la seguridad
// real vive en las políticas de Row Level Security (RLS) y en
// las funciones RPC definidas en schema.sql, NO en ocultar esta
// clave. Nunca pongas aquí la "service_role key" — esa SÍ debe
// permanecer secreta (solo la usa el bot de Discord).
//
// Módulo ES: se importa `supabaseClient` desde cualquier otro
// módulo con `import { supabaseClient } from '../config.js'`.
// `window.supabase` lo inyecta el script del CDN cargado antes
// de este módulo en index.html.
// =========================================================

const SUPABASE_URL = "https://xuaeaebypcggoqwgshjy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JTg72e9jfhMLYOErILzLVw_Ohd2bYmk";

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================================
// CONFIGURACIÓN DE SUPABASE
// =========================================================
// La "anon key" está pensada para ser pública: la seguridad
// real vive en las políticas de Row Level Security (RLS) y en
// las funciones RPC definidas en schema.sql, NO en ocultar esta
// clave. Nunca pongas aquí la "service_role key" — esa SÍ debe
// permanecer secreta (solo la usa el bot de Discord).
// =========================================================

const SUPABASE_URL = "https://xuaeaebypcggoqwgshjy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_JTg72e9jfhMLYOErILzLVw_Ohd2bYmk";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

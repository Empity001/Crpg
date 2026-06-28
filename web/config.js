// web/config.js
// Estos son valores PÚBLICOS (la publishable key está hecha para usarse en el navegador,
// la seguridad real la dan las políticas de RLS en Supabase, no este archivo).

window.CULONES_CONFIG = {
  SUPABASE_URL: 'https://dbiuommtbshzshnyqyvt.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_zauKdU6CSn4IY7AgxXlspg_GUebzr9_',

  // Edge Functions (se despliegan desde supabase/functions/*)
  ADMIN_LOGIN_URL: 'https://dbiuommtbshzshnyqyvt.supabase.co/functions/v1/admin-login',
  ADMIN_WRITE_URL: 'https://dbiuommtbshzshnyqyvt.supabase.co/functions/v1/admin-write',
};

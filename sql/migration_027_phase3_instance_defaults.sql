-- =========================================================
-- EMPI NETWORK · Migración 027
-- Hotfix para la creación de instancias después de Fase 3.
-- =========================================================
-- Requiere migration_026_empi_network_builder.sql.
-- Es segura para ejecutar más de una vez y no modifica Culones RPG.
-- =========================================================

begin;

do $$
begin
  if to_regclass('public.sites') is null then
    raise exception 'Falta la tabla public.sites. Ejecuta primero las migraciones 025 y 026.';
  end if;
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sites'
      and column_name = 'draft_theme_config'
  ) then
    raise exception 'Falta sites.draft_theme_config. Ejecuta primero la migración 026.';
  end if;
end $$;

update public.sites
set draft_theme_config = theme_config
where draft_theme_config is null;

alter table public.sites
  alter column draft_theme_config set default '{
    "mode":"dark",
    "palette":{"background":"#050505","surface":"#101010","text":"#ffffff","muted":"#a3a3a3","accent":"#ffffff"}
  }'::jsonb,
  alter column draft_theme_config set not null;

commit;

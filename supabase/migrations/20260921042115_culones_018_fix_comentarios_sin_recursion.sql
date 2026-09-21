-- Una política no puede consultar su propia tabla (recursión infinita en RLS):
-- la comprobación del comentario padre se hace en el trigger, que no pasa por RLS.
drop policy if exists "comments_insert_public" on public.comments;
create policy "comments_insert_public" on public.comments for insert to anon, authenticated
  with check (
    char_length(comment) between 1 and 500
    and char_length(username) <= 40
    and likes = 0
    and hidden = false
    and exists (select 1 from public.logs l where l.id = comments.log_id and l.published = true)
  );

create or replace function public.guard_comment_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  perform public.rate_limit_guard('comment', 5, 60);
  perform public.rate_limit_guard('comment_hour', 40, 3600);

  new.username := left(btrim(coalesce(new.username, '')), 40);
  if new.username = '' then
    new.username := 'Anónimo';
  end if;
  new.comment := btrim(coalesce(new.comment, ''));

  if new.parent_id is not null and not exists (
    select 1 from public.comments p
    where p.id = new.parent_id and p.log_id = new.log_id and p.parent_id is null
  ) then
    raise exception 'La respuesta no corresponde a un comentario válido de este Log';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_comment_insert() from public, anon, authenticated;
grant execute on function public.guard_comment_insert() to service_role;

notify pgrst, 'reload schema';

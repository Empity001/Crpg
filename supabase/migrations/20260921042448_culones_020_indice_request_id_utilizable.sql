-- La Edge Function busca action_log por (metadata ->> 'request_id') = ...; el índice parcial anterior
-- (WHERE metadata ? 'request_id') no puede usarse porque el planificador no deduce esa condición.
drop index if exists public.action_log_request_id_idx;
create index action_log_request_id_idx
  on public.action_log ((metadata ->> 'request_id'))
  where (metadata ->> 'request_id') is not null;

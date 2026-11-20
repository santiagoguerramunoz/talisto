-- =====================================================================
--  TaListo!  ·  27 · Match en automático
--  · Cada minuto, dentro de Supabase (pg_cron): vence pagos no hechos,
--    pedidos que nadie tomó y confirma visitas sin respuesta. Y avisa a la
--    app para que mande los avisos al celular y por WhatsApp.
--    (Vercel gratis solo deja correr tareas una vez por día.)
--  · La app reconoce ese llamado con una llave que se genera sola acá:
--    no hace falta cargar CRON_SECRET en Vercel.
--  · El cliente tiene 20 minutos para pagar (antes 10).
--  · Al pedir un técnico solo aparecen los rubros que tienen técnicos
--    disponibles (en la app y en WhatsApp). Los rubros siguen activos
--    para que los técnicos los elijan en su perfil.
--  Correr después del 26. Se puede correr más de una vez.
-- =====================================================================

-- 1. El cliente tiene 20 minutos para pagar (solo si seguía en 10: no pisa un cambio hecho en /admin)
update public.configuracion set pago_minutos = 20 where id = 1 and pago_minutos = 10;

-- 2. Llave para que la app reconozca el llamado automático (nadie más la lee)
create table if not exists public.cron_llaves (
  nombre text primary key,
  llave  text not null,
  creado_en timestamptz not null default now()
);
alter table public.cron_llaves enable row level security;
revoke all on public.cron_llaves from anon, authenticated;
insert into public.cron_llaves (nombre, llave)
values ('match', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (nombre) do nothing;

create or replace function public.cron_llave_valida(p_llave text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.cron_llaves where nombre = 'match' and llave = p_llave and length(p_llave) >= 32);
$$;
revoke execute on function public.cron_llave_valida(text) from public, anon, authenticated;
grant execute on function public.cron_llave_valida(text) to service_role;

-- 3. Lo que corre cada minuto
create or replace function public.match_tarea_automatica()
returns json language plpgsql security definer set search_path = public as $$
declare r json; v_url text; v_llave text;
begin
  r := public.match_procesar_vencidos();
  -- la app manda los avisos al celular y los de WhatsApp (si todavía no está configurada, no pasa nada)
  select nullif(trim(app_url), '') into v_url from public.configuracion where id = 1;
  select llave into v_llave from public.cron_llaves where nombre = 'match';
  if v_url is not null and v_llave is not null and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform net.http_get(url := rtrim(v_url, '/') || '/api/match/cron',
                         headers := jsonb_build_object('authorization', 'Bearer ' || v_llave),
                         timeout_milliseconds := 20000);
  end if;
  return r;
end $$;
revoke execute on function public.match_tarea_automatica() from public, anon, authenticated;

-- 4. Programarla cada minuto con pg_cron (si la base lo tiene; en Supabase sí)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'talisto_match';
    perform cron.schedule('talisto_match', '* * * * *', 'select public.match_tarea_automatica()');
  else
    raise notice 'Esta base no tiene pg_cron: la tarea automática no quedó programada';
  end if;
end $$;

-- 5. Rubros que tienen técnicos disponibles en Match (para pedir en la app y en WhatsApp)
create or replace function public.rubros_match()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('id', k.id, 'nombre', k.nombre, 'tecnicos', k.n) order by k.orden, k.nombre), '[]'::json)
    from (select c.id, c.nombre, c.orden,
                 (select count(*) from public.match_perfiles m join public.profesionales p on p.id = m.profesional_id
                   where m.disponible and c.id = any (m.rubros) and p.activo
                     and (p.verificado or not coalesce((select solo_verificados from public.configuracion where id = 1), false))) as n
            from public.categorias c where c.activa) k
   where k.n > 0;
$$;
grant execute on function public.rubros_match() to anon, authenticated, service_role;

notify pgrst, 'reload schema';

-- =====================================================================
-- LISTO.
-- =====================================================================

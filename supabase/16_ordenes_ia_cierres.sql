-- =====================================================================
--  TaListo!  ·  ÓRDENES DE TRABAJO CON IA Y CIERRE DE PLANILLAS
--  · Cada cliente B2B puede cerrar su planilla el día que quiera (por
--    ejemplo el 25: la siguiente abre el 26). Las fechas las calcula la
--    app con clientes.cierre_planilla; lo ya liquidado no se mueve.
--  · La IA lee una orden de trabajo (foto, PDF o texto de un mail) y la
--    persona revisa los tickets antes de cargarlos. Es para Pro y Business,
--    con el permiso de agendar tickets, y usa el mismo tope mensual de
--    lecturas que los comprobantes.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 15). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.comprobantes') is null then
    raise exception 'Primero corré el SQL 14 (comprobantes con IA)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Cierre de planillas
--    { "reglas": [{ "desde": "2026-11", "dia": 25 }],   desde qué planilla rige cada día (null = fin de mes)
--      "fechas": { "2026-12": "2026-12-23" } }          la fecha de una planilla puntual
-- ---------------------------------------------------------------------
alter table public.clientes add column if not exists cierre_planilla jsonb not null default '{}'::jsonb;
alter table public.clientes drop constraint if exists clientes_cierre_planilla_check;
alter table public.clientes add constraint clientes_cierre_planilla_check check (jsonb_typeof(cierre_planilla) = 'object');

-- ---------------------------------------------------------------------
-- 2. Lecturas de órdenes: quién leyó y cuándo, para el tope del mes.
--    Los datos de los clientes finales no se guardan acá: quedan solo en
--    los tickets que la persona carga.
-- ---------------------------------------------------------------------
create table if not exists public.lecturas_ordenes (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  usuario_id      uuid references public.perfiles(id) on delete set null,
  usuario_nombre  text,
  origen          text not null default 'texto' check (origen in ('foto', 'pdf', 'texto')),
  estado          text not null default 'leyendo' check (estado in ('leyendo', 'leido', 'error')),
  ordenes         int,
  error           text,
  creado_en       timestamptz not null default now()
);
create index if not exists lecturas_ordenes_cuenta_idx on public.lecturas_ordenes (profesional_id, creado_en desc);

alter table public.lecturas_ordenes enable row level security;
revoke all on public.lecturas_ordenes from anon, authenticated;
grant all on public.lecturas_ordenes to service_role;

-- Lee órdenes: cuenta Pro o Business y permiso de agendar tickets
create or replace function public.puede_leer_ordenes(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c is not null and public.plan_de(c) <> 'free' and public.puede(c, array['tickets_asignar']);
$$;

-- El tope del mes es uno solo: comprobantes y órdenes
create or replace function public._lecturas_mes(c uuid)
returns int language sql stable security definer set search_path = public as $$
  select (select count(*) from public.comprobantes
           where profesional_id = c and creado_en >= public.inicio_mes_uy() and estado <> 'error')::int
       + (select count(*) from public.lecturas_ordenes
           where profesional_id = c and creado_en >= public.inicio_mes_uy() and estado <> 'error')::int;
$$;

-- Cuántas lecturas se usaron este mes y cuántas hay
create or replace function public.uso_lectura_ordenes(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.puede(p_cuenta, array['tickets_asignar']) then
    raise exception 'No tenés acceso a los tickets de esta cuenta';
  end if;
  return json_build_object('usadas', public._lecturas_mes(p_cuenta), 'limite', public._limite_ia(p_cuenta),
                           'puede', public.puede_leer_ordenes(p_cuenta));
end $$;

-- La llama el servidor antes de mandar la orden a la IA (controla plan, permiso y tope)
create or replace function public.iniciar_lectura_orden(p_cuenta uuid, p_origen text default 'texto')
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lim int; usadas int; v uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_cuenta is null or public.plan_de(p_cuenta) = 'free' then
    raise exception using errcode = 'TL001', message = 'Leer órdenes de trabajo con IA es parte de los planes Pro y Business.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  if not public.puede(p_cuenta, array['tickets_asignar']) then
    raise exception 'No tenés permiso para cargar tickets de esta cuenta';
  end if;
  if p_origen is null or p_origen not in ('foto', 'pdf', 'texto') then raise exception 'Origen no válido'; end if;
  -- el mismo candado que los comprobantes: el tope es compartido
  perform pg_advisory_xact_lock(hashtext('comprobantes' || p_cuenta::text));
  -- lecturas que quedaron colgadas (se cortó la conexión): no cuentan
  update public.lecturas_ordenes set estado = 'error', error = 'Se cortó la lectura'
   where profesional_id = p_cuenta and estado = 'leyendo' and creado_en < now() - interval '10 minutes';
  lim := public._limite_ia(p_cuenta);
  usadas := public._lecturas_mes(p_cuenta);
  if usadas >= lim then
    raise exception using errcode = 'TL002',
      message = format('Llegaron al tope de %s lecturas con IA este mes.', lim),
      hint = 'El mes que viene se renueva. Mientras tanto las podés cargar a mano.';
  end if;
  insert into public.lecturas_ordenes (profesional_id, usuario_id, usuario_nombre, origen)
  values (p_cuenta, uid, public._nombre_de(uid), p_origen)
  returning id into v;
  return json_build_object('id', v, 'usadas', usadas + 1, 'limite', lim);
end $$;

-- Cómo terminó la lectura (si falló no cuenta para el tope)
create or replace function public.terminar_lectura_orden(p_id uuid, p_ordenes int default null, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.lecturas_ordenes set
    estado = case when p_error is null then 'leido' else 'error' end,
    ordenes = p_ordenes,
    error = nullif(left(coalesce(p_error, ''), 300), '')
  where id = p_id and usuario_id = auth.uid() and estado = 'leyendo';
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.puede_leer_ordenes(uuid)', 'public.uso_lectura_ordenes(uuid)',
    'public.iniciar_lectura_orden(uuid, text)', 'public.terminar_lectura_orden(uuid, int, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke execute on function public._lecturas_mes(uuid) from public, anon, authenticated;
  grant execute on function public._lecturas_mes(uuid) to service_role;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

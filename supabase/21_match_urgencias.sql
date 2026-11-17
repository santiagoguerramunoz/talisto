-- =====================================================================
--  TaListo!  ·  TaListo! Match: URGENCIAS Y FUERA DE HORARIO
--  La visita técnica tiene dos tarifas que el admin edita:
--  · Normal (1.500 = 200 cliente + 200 profesional + 1.100 técnico).
--  · Urgencia (2.500 = 300 cliente + 300 profesional + 1.900 técnico).
--  Se cobra la de urgencia si el cliente marca "Es urgente" o si la
--  visita empieza fuera del horario normal (por defecto lunes a viernes
--  de 8 a 18 y sábados de 8 a 13; domingos, todo el día).
--  · Fuera del horario normal solo van los profesionales que activaron
--    "Atiendo urgencias": a ellos se les ofrecen también horarios fuera
--    de su horario de trabajo, dentro de la franja de urgencias (7 a 23).
--  · "El primero disponible" se cobra al publicar: es urgencia si está
--    marcado o si en lo pedido no queda horario normal (con una hora de
--    margen). Si se cobró normal, el técnico llega en horario normal
--    (a más tardar 15 minutos antes del cierre).
--  · Las operaciones ya creadas mantienen sus importes.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 20). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.match_operaciones') is null or not exists (
       select 1 from information_schema.columns where table_schema = 'public' and table_name = 'match_solicitudes' and column_name = 'modo') then
    raise exception 'Primero corré 19_match.sql y 20_match_primero.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Configuración (la cambia solo el admin)
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists urgencia_activa           boolean       not null default true;
alter table public.configuracion add column if not exists precio_urgencia           numeric(12,2) not null default 2500;
alter table public.configuracion add column if not exists urgencia_ret_cliente      numeric(12,2) not null default 300;
alter table public.configuracion add column if not exists urgencia_ret_profesional  numeric(12,2) not null default 300;
alter table public.configuracion add column if not exists urgencia_neto_profesional numeric(12,2) not null default 1900;
alter table public.configuracion add column if not exists urgencia_desde            time          not null default '07:00';
alter table public.configuracion add column if not exists urgencia_hasta            time          not null default '23:00';
-- Horario normal por día de la semana (0 = domingo … 6 = sábado); null = ese día todo es fuera de horario
alter table public.configuracion add column if not exists horario_normal jsonb not null default
  '{"0": null, "1": {"desde": "08:00", "hasta": "18:00"}, "2": {"desde": "08:00", "hasta": "18:00"},
    "3": {"desde": "08:00", "hasta": "18:00"}, "4": {"desde": "08:00", "hasta": "18:00"},
    "5": {"desde": "08:00", "hasta": "18:00"}, "6": {"desde": "08:00", "hasta": "13:00"}}'::jsonb;
alter table public.configuracion drop constraint if exists configuracion_urgencia_check;
alter table public.configuracion add constraint configuracion_urgencia_check check (
  urgencia_ret_cliente >= 0 and urgencia_ret_profesional >= 0 and urgencia_neto_profesional >= 0
  and precio_urgencia = urgencia_ret_cliente + urgencia_ret_profesional + urgencia_neto_profesional
  and urgencia_hasta > urgencia_desde and jsonb_typeof(horario_normal) = 'object'
);

-- Cada operación guarda si se cobró como urgencia
alter table public.match_operaciones add column if not exists urgencia boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Ayudas
-- ---------------------------------------------------------------------
-- Horario normal de un día (vacío si ese día no hay)
create or replace function public._normal_del_dia(p_fecha date)
returns tstzrange language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof(h) = 'object'
              then tstzrange((p_fecha + (h ->> 'desde')::time) at time zone 'America/Montevideo',
                             (p_fecha + (h ->> 'hasta')::time) at time zone 'America/Montevideo', '[)')
              else 'empty'::tstzrange end
    from (select c.horario_normal -> extract(dow from p_fecha)::int::text as h from public.configuracion c where c.id = 1) x;
$$;

-- ¿La visita que empieza a esta hora es en horario normal? (si las urgencias están apagadas, todo es normal)
create or replace function public._es_horario_normal(p_inicio timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select not c.urgencia_activa or public._normal_del_dia((p_inicio at time zone 'America/Montevideo')::date) @> p_inicio
    from public.configuracion c where c.id = 1;
$$;

-- ¿Esta cuenta atiende urgencias y fuera de horario?
create or replace function public._atiende_urgencias(p_cuenta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c.urgencia_activa and coalesce((select m.urgencias from public.match_perfiles m where m.profesional_id = p_cuenta), false)
    from public.configuracion c where c.id = 1;
$$;

-- ¿Está libre el profesional en ese rato? (mismas reglas que horarios_disponibles: turnos y bloques fijos)
create or replace function public._libre_match(p_pro uuid, p_ini timestamptz, p_fin timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
           select 1 from public.turnos t
            where t.profesional_id = p_pro and t.estado in ('pendiente', 'confirmado') and not t.flexible
              and tstzrange(t.inicio, t.fin, '[)') && tstzrange(p_ini, p_fin, '[)'))
     and not exists (
           select 1 from public.bloques_fijos b, (select (p_ini at time zone 'America/Montevideo')::date as f) d
            where b.profesional_id = p_pro and extract(dow from d.f)::int = any (b.dias)
              and d.f >= b.fecha_desde and (b.fecha_hasta is null or d.f <= b.fecha_hasta)
              and not exists (select 1 from public.bloques_excepciones e where e.bloque_id = b.id and e.fecha = d.f)
              and tstzrange((d.f + b.hora_inicio) at time zone 'America/Montevideo',
                            (d.f + b.hora_fin) at time zone 'America/Montevideo', '[)') && tstzrange(p_ini, p_fin, '[)'));
$$;

-- Horarios que se le ofrecen al cliente para un profesional en un día:
-- · los de su horario de trabajo que caen en horario normal;
-- · si atiende urgencias, también los de su horario fuera del normal y los
--   de la franja de urgencias fuera del horario normal (cada 30 minutos)
create or replace function public._horarios_match(p_pro uuid, p_fecha date, p_dur int)
returns table (desde timestamptz, urgencia boolean)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.configuracion where id = 1),
       u as (select public._atiende_urgencias(p_pro) as si),
       base as (select h.desde from public.horarios_disponibles(p_pro, p_fecha, p_dur) h),
       extra as (
         select g as desde
           from c, u, generate_series((p_fecha + c.urgencia_desde) at time zone 'America/Montevideo',
                                      (p_fecha + c.urgencia_hasta) at time zone 'America/Montevideo' - make_interval(mins => p_dur),
                                      interval '30 minutes') g
          where u.si and g > now()
            and exists (select 1 from public.profesionales pr where pr.id = p_pro and pr.activo)
            and not public._es_horario_normal(g)
            and public._libre_match(p_pro, g, g + make_interval(mins => p_dur)))
  select x.desde, not public._es_horario_normal(x.desde)
    from (select b.desde from base b union select e.desde from extra e) x cross join u
   where u.si or public._es_horario_normal(x.desde)
   order by 1;
$$;

-- "El primero disponible": ¿se cobra como urgencia? (marcado, o no queda horario normal en lo pedido, con 1 hora de margen)
create or replace function public._urgencia_primero(p_urgente boolean, p_cuando text, p_fecha date, p_franja text)
returns boolean language sql stable security definer set search_path = public as $$
  select c.urgencia_activa and (coalesce(p_urgente, false) or isempty(r) or
           greatest(lower(w), lower(r), now() + interval '1 hour')
             > least(upper(w) - make_interval(mins => c.duracion_visita_min), upper(r) - interval '15 minutes'))
    from public.configuracion c,
         lateral (select public._ventana_primero(p_cuando, p_fecha, p_franja, now()) as w) x,
         lateral (select public._normal_del_dia((lower(x.w) at time zone 'America/Montevideo')::date) as r) y
   where c.id = 1;
$$;

-- A qué horas puede llegar este técnico a un pedido "el primero disponible" (null si no puede tomarlo).
-- Si se cobró urgencia y el técnico atiende urgencias: todo lo que pidió el cliente; si no, solo en horario normal.
create or replace function public._ventana_toma(p_sol public.match_solicitudes, p_urgencia boolean, p_cuenta uuid)
returns tstzrange language plpgsql stable security definer set search_path = public as $$
declare w tstzrange := public._ventana_primero(p_sol.cuando, p_sol.fecha, p_sol.franja, now()); r tstzrange; d interval; a timestamptz; b timestamptz;
begin
  d := make_interval(mins => (select duracion_visita_min from public.configuracion where id = 1));
  if (p_urgencia and public._atiende_urgencias(p_cuenta))
     or not (select urgencia_activa from public.configuracion where id = 1) then
    return case when lower(w) + d <= upper(w) then w end;
  end if;
  r := public._normal_del_dia((lower(w) at time zone 'America/Montevideo')::date);
  if isempty(r) then return null; end if;
  a := greatest(lower(w), lower(r));
  b := least(upper(w), upper(r) - interval '15 minutes' + d);
  return case when a + d <= b then tstzrange(a, b, '[]') end;
end $$;

-- ---------------------------------------------------------------------
-- 3. Precio de la invitación: si el cliente marcó urgente, el profesional ya ve la tarifa de urgencia
-- ---------------------------------------------------------------------
create or replace function public._precio_invitacion()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.configuracion := public._cfg();
begin
  if c.urgencia_activa and exists (select 1 from public.match_solicitudes s where s.id = new.solicitud_id and s.urgente) then
    new.precio_visita := c.precio_urgencia;
  end if;
  return new;
end $$;
drop trigger if exists match_invitaciones_precio on public.match_invitaciones;
create trigger match_invitaciones_precio before insert on public.match_invitaciones
  for each row execute function public._precio_invitacion();

-- ---------------------------------------------------------------------
-- 4. Lo que ve y paga el cliente
-- ---------------------------------------------------------------------
-- Horarios del profesional con su precio
create or replace function public.horarios_visita_precios(p_invitacion uuid, p_desde date default null, p_dias int default 7)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  i public.match_invitaciones; s public.match_solicitudes; c public.configuracion := public._cfg();
  d0 date := coalesce(p_desde, (now() at time zone 'America/Montevideo')::date);
begin
  select * into i from public.match_invitaciones where id = p_invitacion;
  select * into s from public.match_solicitudes where id = i.solicitud_id;
  if i.id is null or s.cliente_id is distinct from auth.uid() then raise exception 'No encontramos el profesional'; end if;
  return (select coalesce(json_agg(json_build_object(
                   'desde', h.desde,
                   'urgencia', x.urg,
                   'importe', case when x.urg then c.precio_urgencia else c.precio_visita end) order by h.desde), '[]')
            from generate_series(d0, d0 + least(greatest(p_dias, 1), 21) - 1, interval '1 day') g,
                 lateral public._horarios_match(i.profesional_id, g::date, c.duracion_visita_min) h,
                 lateral (select c.urgencia_activa and (s.urgente or h.urgencia) as urg) x
           where h.desde >= now() + interval '2 hours');
end $$;

-- La de antes (lista de horarios), para pantallas viejas
create or replace function public.horarios_visita(p_invitacion uuid, p_desde date default null, p_dias int default 7)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(e -> 'desde'), '[]')
    from json_array_elements(public.horarios_visita_precios(p_invitacion, p_desde, p_dias)) e;
$$;

-- Cuánto cuesta "el primero disponible" para lo que eligió el cliente
create or replace function public.cotizar_primero(p_cuando text, p_fecha date default null, p_franja text default null, p_urgente boolean default false)
returns json language plpgsql stable security definer set search_path = public as $$
declare c public.configuracion := public._cfg(); u boolean;
begin
  if p_cuando not in ('hoy', 'dia') or (p_cuando = 'dia' and p_fecha is null) then
    return json_build_object('urgencia', coalesce(p_urgente, false) and c.urgencia_activa,
                             'importe', case when coalesce(p_urgente, false) and c.urgencia_activa then c.precio_urgencia else c.precio_visita end);
  end if;
  begin
    u := public._urgencia_primero(p_urgente, p_cuando, p_fecha, coalesce(p_franja, 'cualquiera'));
  exception when data_exception then
    -- la franja ya pasó: no se puede pedir
    return json_build_object('urgencia', false, 'importe', null, 'pasada', true);
  end;
  return json_build_object('urgencia', u, 'importe', case when u then c.precio_urgencia else c.precio_visita end,
                           'precio_visita', c.precio_visita, 'precio_urgencia', c.precio_urgencia);
end $$;

-- El cliente elige profesional y horario: tarifa según el horario elegido (o urgente si lo marcó)
create or replace function public.elegir_profesional(p_invitacion uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  i public.match_invitaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); t uuid; op public.match_operaciones;
  v_urg boolean;
begin
  perform public.match_procesar_vencidos();
  select * into i from public.match_invitaciones where id = p_invitacion;
  if i.id is null then raise exception 'No encontramos el profesional'; end if;
  select * into s from public.match_solicitudes where id = i.solicitud_id for update;
  if s.cliente_id <> auth.uid() then raise exception 'No encontramos la solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'La solicitud ya no está abierta'; end if;
  if i.estado <> 'aceptada' then raise exception 'Ese profesional todavía no aceptó la solicitud'; end if;
  if exists (select 1 from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado not in ('cancelado', 'reembolsado')) then
    raise exception 'Ya hay una visita en curso para esta solicitud';
  end if;
  if p_inicio < now() + interval '2 hours' or not exists (
       select 1 from public._horarios_match(i.profesional_id, (p_inicio at time zone 'America/Montevideo')::date, c.duracion_visita_min) h
        where h.desde = p_inicio) then
    raise exception 'Ese horario ya no está libre: elegí otro';
  end if;
  v_urg := c.urgencia_activa and (s.urgente or not public._es_horario_normal(p_inicio));
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas)
    values (i.profesional_id, left(case when v_urg then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            p_inicio, p_inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'pendiente', 'reserva',
            case when v_urg then c.precio_urgencia else c.precio_visita end,
            left(format('Solicitud Nº %s: %s', s.numero, s.titulo), 500))
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ese horario se acaba de ocupar: elegí otro';
  end;
  insert into public.match_operaciones (tipo, solicitud_id, invitacion_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                        ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
  values ('visita', s.id, i.id, t, s.cliente_id, i.profesional_id, s.categoria_id,
          case when v_urg then c.precio_urgencia else c.precio_visita end,
          case when v_urg then c.urgencia_ret_cliente else c.visita_ret_cliente end,
          case when v_urg then c.urgencia_ret_profesional else c.visita_ret_profesional end,
          case when v_urg then c.urgencia_neto_profesional else c.visita_neto_profesional end,
          c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), v_urg)
  returning * into op;
  perform public._evento(auth.uid(), 'reservo_visita', 'match');
  return json_build_object('operacion', op.id, 'importe', op.importe, 'vence', op.vence_pago_en, 'urgencia', op.urgencia);
end $$;

-- "El primero disponible": la operación a pagar con su tarifa
create or replace function public._op_primero(p_sol uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); op public.match_operaciones; nuevo uuid; v_urg boolean;
begin
  select * into s from public.match_solicitudes where id = p_sol;
  select * into op from public.match_operaciones
   where solicitud_id = p_sol and tipo = 'visita' and estado not in ('cancelado', 'reembolsado') for update;
  if op.id is not null then
    if op.estado = 'pendiente_pago' and op.vence_pago_en > now() + interval '2 minutes' then return op.id; end if;
    if op.estado <> 'pendiente_pago' then raise exception 'Este pedido ya está pago'; end if;
    update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'No se pagó a tiempo' where id = op.id;
  end if;
  v_urg := public._urgencia_primero(s.urgente, s.cuando, s.fecha, s.franja);
  insert into public.match_operaciones (tipo, solicitud_id, cliente_id, profesional_id, categoria_id, importe, ret_cliente, ret_profesional,
                                        neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
  values ('visita', s.id, s.cliente_id, null, s.categoria_id,
          case when v_urg then c.precio_urgencia else c.precio_visita end,
          case when v_urg then c.urgencia_ret_cliente else c.visita_ret_cliente end,
          case when v_urg then c.urgencia_ret_profesional else c.visita_ret_profesional end,
          case when v_urg then c.urgencia_neto_profesional else c.visita_neto_profesional end,
          c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), v_urg)
  returning id into nuevo;
  return nuevo;
end $$;

-- Perfil público: el próximo horario que el cliente puede reservar
create or replace function public.perfil_match(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('profesional', public._prof_publico(p_id),
    'disponible', coalesce((select disponible from public.match_perfiles where profesional_id = p_id), false),
    'urgencias', public._atiende_urgencias(p_id),
    'calificaciones', (select coalesce(json_agg(json_build_object('puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta,
         'tipo', k.tipo, 'fecha', k.creado_en, 'cliente', split_part(coalesce(nullif(pe.nombre, ''), 'Cliente'), ' ', 1)) order by k.creado_en desc), '[]')
       from (select * from public.match_calificaciones where profesional_id = p_id order by creado_en desc limit 30) k
       join public.perfiles pe on pe.id = k.cliente_id),
    'proximo', (select min(h.desde) from generate_series((now() at time zone 'America/Montevideo')::date,
                  (now() at time zone 'America/Montevideo')::date + 6, interval '1 day') g,
                  lateral public._horarios_match(p_id, g::date, (select duracion_visita_min from public.configuracion where id = 1)) h
                 where h.desde >= now() + interval '2 hours' and not h.urgencia))
  where exists (select 1 from public.profesionales where id = p_id and activo);
$$;

-- ---------------------------------------------------------------------
-- 5. Lo que ve y toma el técnico ("el primero disponible")
-- ---------------------------------------------------------------------
-- Pago confirmado: sale al mapa; si se cobró normal, se puede tomar hasta la última hora normal
create or replace function public._publicar_primero(p_op uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  op public.match_operaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); lim timestamptz; r record; n int := 0;
  v_normal tstzrange;
begin
  select * into op from public.match_operaciones where id = p_op;
  select * into s from public.match_solicitudes where id = op.solicitud_id for update;
  lim := case when s.cuando = 'hoy'
              then least(now() + make_interval(hours => c.primero_horas),
                         ((now() at time zone 'America/Montevideo')::date + time '20:00') at time zone 'America/Montevideo')
              else upper(public._ventana_primero('dia', s.fecha, s.franja, now())) - interval '1 hour' end;
  -- la ventana en horario normal (la que tiene cualquier técnico)
  v_normal := public._ventana_toma(s, false, null);
  if not op.urgencia and v_normal is not null then
    lim := least(lim, upper(v_normal) - make_interval(mins => c.duracion_visita_min));
  end if;
  update public.match_solicitudes set publicada_en = now(), limite_toma = lim, vence_en = greatest(vence_en, lim), actualizado_en = now()
   where id = s.id returning * into s;
  for r in select m.profesional_id from public.match_perfiles m join public.profesionales p on p.id = m.profesional_id
            where m.disponible and s.categoria_id = any (m.rubros) and s.departamento = any (p.departamentos)
              and m.profesional_id <> s.cliente_id and public._elegible_primero(m.profesional_id, s.categoria_id)
              and (v_normal is not null or (op.urgencia and public._atiende_urgencias(m.profesional_id)))
            limit 200 loop
    perform public._aviso_pro(r.profesional_id, 'match',
      format('%s disponible: %s', case when op.urgencia then 'Urgencia' else 'Servicio' end, public._rubro(s.categoria_id)),
      format('%s · %s%s · %s. Te quedan %s. Lo atiende el primero que lo toma.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento,
             public._cuando_texto(s), public._pesos(op.neto_profesional)),
      '/panel/mapa?ver=servicios');
    n := n + 1;
  end loop;
  perform public._aviso_cliente(s.cliente_id, 'match', 'Pago confirmado: tu pedido ya está en el mapa',
    format('Pagaste %s. Los técnicos de %s ya ven tu pedido. Si nadie lo toma antes de las %s del %s, te devolvemos el dinero.',
           public._pesos(op.importe), public._rubro(s.categoria_id), to_char(lim at time zone 'America/Montevideo', 'HH24:MI'),
           to_char(lim at time zone 'America/Montevideo', 'DD/MM')),
    '/match/solicitud/' || s.id);
  if n = 0 then update public.match_solicitudes set sin_profesionales = true where id = s.id; end if;
end $$;

-- Para el mapa del técnico: los pedidos que puede tomar, con las horas a las que puede llegar
create or replace function public.servicios_disponibles(p_cuenta uuid)
returns json language plpgsql security definer set search_path = public as $$
declare plan_ok boolean; m public.match_perfiles;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para tomar servicios en esta cuenta'; end if;
  perform public._vencer_primero();
  plan_ok := public.plan_de(p_cuenta) in ('pro', 'business');
  select * into m from public.match_perfiles where profesional_id = p_cuenta;
  return json_build_object(
    'plan_ok', plan_ok,
    'disponible', coalesce(m.disponible, false),
    'rubros', coalesce(cardinality(m.rubros), 0),
    'cobro_ok', exists (select 1 from public.match_datos_cobro where profesional_id = p_cuenta),
    'urgencias', public._atiende_urgencias(p_cuenta),
    'duracion_visita_min', (select duracion_visita_min from public.configuracion where id = 1),
    'servicios', case when plan_ok then (
      select coalesce(json_agg(x order by x.limite_toma), '[]') from (
        select s.id, s.numero, public._rubro(s.categoria_id) as rubro, s.titulo, s.descripcion, s.archivos, s.departamento, s.localidad,
               s.cuando, s.fecha, s.franja, s.limite_toma, s.publicada_en, s.urgente, o.urgencia,
               round(s.lat::numeric, 2) as lat, round(s.lng::numeric, 2) as lng,
               o.neto_profesional as neto, o.importe, lower(w.v) as desde, upper(w.v) as hasta
          from public.match_solicitudes s
          join public.match_operaciones o on o.solicitud_id = s.id and o.tipo = 'visita' and o.estado = 'buscando_tecnico'
          cross join lateral (select public._ventana_toma(s, o.urgencia, p_cuenta) as v) w
         where s.modo = 'primero' and s.estado = 'abierta' and s.profesional_id is null and s.publicada_en is not null
           and s.limite_toma > now() and s.cliente_id <> p_cuenta and s.cliente_id is distinct from auth.uid()
           and w.v is not null
           and public._elegible_primero(p_cuenta, s.categoria_id)
         limit 200) x) else '[]'::json end);
end $$;

-- El técnico toma el pedido: fuera del horario normal, solo si se cobró urgencia y atiende urgencias
create or replace function public.tomar_servicio(p_solicitud uuid, p_cuenta uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.match_solicitudes; op public.match_operaciones; c public.configuracion := public._cfg(); w tstzrange; t uuid;
  cli uuid; dir uuid; v_asig uuid;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para tomar servicios en esta cuenta'; end if;
  perform public._vencer_primero();
  select * into s from public.match_solicitudes where id = p_solicitud for update;
  if s.id is null or s.modo <> 'primero' then raise exception 'No encontramos el servicio'; end if;
  if s.profesional_id is not null or s.estado <> 'abierta' then raise exception 'Otro técnico ya tomó este servicio'; end if;
  select * into op from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado = 'buscando_tecnico' for update;
  if op.id is null or s.limite_toma < now() then raise exception 'Este servicio ya no está disponible'; end if;
  if s.cliente_id = p_cuenta or s.cliente_id = auth.uid() then raise exception 'No podés tomar tu propio pedido'; end if;
  if not public._elegible_primero(p_cuenta, s.categoria_id) then
    raise exception 'Para tomar servicios necesitás plan Pro o Business, Match activo con este rubro y la cuenta bancaria cargada';
  end if;
  w := public._ventana_toma(s, op.urgencia, p_cuenta);
  if w is null then
    raise exception 'Este pedido es fuera de horario: lo toman los que atienden urgencias (activalo en tu perfil Match)';
  end if;
  if p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)%', public._cuando_texto(s),
      case when op.urgencia and public._atiende_urgencias(p_cuenta) then '' else ', en horario normal' end;
  end if;
  v_asig := case when auth.uid() is distinct from p_cuenta then auth.uid() end;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas, asignado_a)
    values (p_cuenta, left(case when op.urgencia then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            p_inicio, p_inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'confirmado', 'reserva', op.importe,
            left(format('Pedido Nº %s (el primero disponible): %s', s.numero, s.titulo), 500), v_asig)
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ya tenés algo agendado a esa hora: elegí otra';
  end;
  -- el cliente queda en la lista de clientes del técnico, con la dirección
  begin
    select id into cli from public.clientes where profesional_id = p_cuenta and usuario_id = s.cliente_id limit 1;
    if cli is null then
      insert into public.clientes (profesional_id, nombre, telefono, email, usuario_id, notas)
      select p_cuenta, coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1)), pe.telefono, pe.email, pe.id, 'Cliente de TaListo! Match'
        from public.perfiles pe where pe.id = s.cliente_id returning id into cli;
    end if;
    insert into public.direcciones (cliente_id, etiqueta, direccion, referencia, lat, lng)
    values (cli, 'TaListo! Match', concat_ws(', ', s.direccion, s.localidad, s.departamento), s.referencia, s.lat, s.lng)
    returning id into dir;
    update public.turnos set cliente_id = cli, direccion_id = dir where id = t;
  exception when others then
    raise warning 'Match: no se pudo agregar el cliente a la agenda: %', sqlerrm;
  end;
  update public.match_operaciones set profesional_id = p_cuenta, turno_id = t, estado = 'reserva_confirmada', actualizado_en = now()
   where id = op.id;
  update public.match_solicitudes set estado = 'reservada', profesional_id = p_cuenta, modalidad = 'visita', tomada_en = now(),
         tomada_por = auth.uid(), sin_profesionales = false, actualizado_en = now()
   where id = s.id;
  perform public._aviso_cliente(s.cliente_id, 'match', 'Un técnico tomó tu pedido',
    format('%s te visita el %s a las %s.', public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
           to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI')),
    '/match/solicitud/' || s.id);
  perform public._aviso_pro(p_cuenta, 'match', 'Servicio tomado',
    format('%s · %s. Ya está en la agenda.', s.titulo, to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
    '/panel/match?ver=visitas');
  perform public._evento(auth.uid(), 'acepto_solicitud', 'match', p_cuenta);
  perform public._evento(p_cuenta, 'recibio_contratacion', 'match', p_cuenta);
  return json_build_object('operacion', op.id, 'turno', t, 'inicio', p_inicio);
end $$;

-- ---------------------------------------------------------------------
-- 6. El admin guarda la configuración (ahora con urgencias y horario normal)
-- ---------------------------------------------------------------------
create or replace function public.guardar_config_match(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare c public.configuracion := public._cfg(); n public.configuracion; hn jsonb := '{}'::jsonb; d int; v_dia jsonb;
begin
  perform public._exigir_admin();
  n := jsonb_populate_record(c, p - 'id' - 'actualizado_en' - 'actualizado_por');
  if n.precio_visita <> n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional then
    raise exception 'El reparto no coincide con el precio: % + % + % = %, y la visita cuesta %', public._pesos(n.visita_ret_cliente),
      public._pesos(n.visita_ret_profesional), public._pesos(n.visita_neto_profesional),
      public._pesos(n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional), public._pesos(n.precio_visita);
  end if;
  if n.precio_urgencia <> n.urgencia_ret_cliente + n.urgencia_ret_profesional + n.urgencia_neto_profesional then
    raise exception 'El reparto de la urgencia no coincide con su precio: % + % + % = %, y la urgencia cuesta %', public._pesos(n.urgencia_ret_cliente),
      public._pesos(n.urgencia_ret_profesional), public._pesos(n.urgencia_neto_profesional),
      public._pesos(n.urgencia_ret_cliente + n.urgencia_ret_profesional + n.urgencia_neto_profesional), public._pesos(n.precio_urgencia);
  end if;
  if n.urgencia_hasta <= n.urgencia_desde then raise exception 'La franja de urgencias tiene que terminar después de empezar'; end if;
  -- horario normal: cada día, cerrado (null) o desde < hasta
  for d in 0..6 loop
    v_dia := coalesce(n.horario_normal, '{}'::jsonb) -> d::text;
    if jsonb_typeof(v_dia) = 'object' then
      begin
        if (v_dia ->> 'hasta')::time <= (v_dia ->> 'desde')::time then
          raise exception 'En el horario normal, la hora de fin tiene que ser después de la de inicio';
        end if;
        hn := hn || jsonb_build_object(d::text, jsonb_build_object('desde', to_char((v_dia ->> 'desde')::time, 'HH24:MI'),
                                                                   'hasta', to_char((v_dia ->> 'hasta')::time, 'HH24:MI')));
      exception when invalid_datetime_format or datetime_field_overflow then
        raise exception 'Revisá las horas del horario normal (formato 08:00)';
      end;
    else
      hn := hn || jsonb_build_object(d::text, null);
    end if;
  end loop;
  update public.configuracion set
    precio_visita = n.precio_visita, comision_visita = n.visita_ret_cliente + n.visita_ret_profesional,
    visita_ret_cliente = n.visita_ret_cliente, visita_ret_profesional = n.visita_ret_profesional, visita_neto_profesional = n.visita_neto_profesional,
    duracion_visita_min = n.duracion_visita_min, trabajo_comision_pct = n.trabajo_comision_pct, trabajo_comision_activa = n.trabajo_comision_activa,
    comision_por_rubro = n.comision_por_rubro, mp_costo_profesional_pct = n.mp_costo_profesional_pct, acreditar_visita = n.acreditar_visita,
    confirmacion_auto_horas = n.confirmacion_auto_horas, liquidacion_dias = n.liquidacion_dias, cancelacion_horas = n.cancelacion_horas,
    cancelacion_tarde_pct = n.cancelacion_tarde_pct, penalizacion_profesional = n.penalizacion_profesional, devolucion_dias = n.devolucion_dias,
    pago_minutos = n.pago_minutos, solicitud_dias = n.solicitud_dias, max_invitados = n.max_invitados, solo_verificados = n.solo_verificados,
    garantia_dias = n.garantia_dias, garantia_cobertura = left(n.garantia_cobertura, 1500), garantia_exclusiones = left(n.garantia_exclusiones, 1500),
    reclamo_procedimiento = left(n.reclamo_procedimiento, 1500), primero_activo = n.primero_activo, primero_horas = n.primero_horas,
    urgencia_activa = n.urgencia_activa, precio_urgencia = n.precio_urgencia, urgencia_ret_cliente = n.urgencia_ret_cliente,
    urgencia_ret_profesional = n.urgencia_ret_profesional, urgencia_neto_profesional = n.urgencia_neto_profesional,
    urgencia_desde = n.urgencia_desde, urgencia_hasta = n.urgencia_hasta, horario_normal = hn
   where id = 1;
  return (select to_json(x) from public.configuracion x where id = 1);
end $$;

-- ---------------------------------------------------------------------
-- 7. Quién puede llamar a qué
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.horarios_visita_precios(uuid, date, int)', 'public.cotizar_primero(text, date, text, boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._normal_del_dia(date)', 'public._es_horario_normal(timestamptz)', 'public._atiende_urgencias(uuid)',
    'public._libre_match(uuid, timestamptz, timestamptz)', 'public._horarios_match(uuid, date, int)',
    'public._urgencia_primero(boolean, text, date, text)', 'public._ventana_toma(public.match_solicitudes, boolean, uuid)',
    'public._precio_invitacion()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

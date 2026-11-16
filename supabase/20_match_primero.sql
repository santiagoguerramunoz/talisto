-- =====================================================================
--  TaListo!  ·  TaListo! Match: "EL PRIMERO DISPONIBLE"
--  El cliente pide la visita sin elegir profesional: paga al publicar
--  y el pedido aparece en el mapa de los técnicos Pro y Business del
--  rubro (en cualquier zona). El primero que lo toma, lo atiende: elige
--  la hora de llegada dentro de lo que pidió el cliente ("hoy, lo antes
--  posible" o un día y franja) y la visita entra a su agenda.
--
--  · Antes de tomarlo, el técnico ve la zona aproximada (barrio, a
--    ~1 km), el rubro, el pedido y las fotos. La dirección exacta y el
--    teléfono, recién cuando lo toma.
--  · Si nadie lo toma a tiempo, o el cliente lo cancela antes, se le
--    devuelve todo (queda para que lo apruebe el admin, como siempre).
--  · Mismo precio y mismo reparto que la visita técnica: el técnico
--    recibe lo mismo y TaListo! cobra lo mismo.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 19). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.match_operaciones') is null then
    raise exception 'Primero corré 19_match.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Configuración (la cambia solo el admin)
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists primero_activo boolean not null default true;
alter table public.configuracion add column if not exists primero_horas  int     not null default 4;
alter table public.configuracion drop constraint if exists configuracion_primero_check;
alter table public.configuracion add constraint configuracion_primero_check check (primero_horas between 1 and 24);

-- ---------------------------------------------------------------------
-- 2. Solicitudes "el primero disponible" y operaciones todavía sin técnico
-- ---------------------------------------------------------------------
alter table public.match_solicitudes add column if not exists modo         text not null default 'invitar';
alter table public.match_solicitudes add column if not exists cuando       text;
alter table public.match_solicitudes add column if not exists fecha        date;
alter table public.match_solicitudes add column if not exists franja       text;
alter table public.match_solicitudes add column if not exists publicada_en timestamptz;
alter table public.match_solicitudes add column if not exists limite_toma  timestamptz;
alter table public.match_solicitudes add column if not exists tomada_en    timestamptz;
alter table public.match_solicitudes add column if not exists tomada_por   uuid;
alter table public.match_solicitudes drop constraint if exists match_solicitudes_primero_check;
alter table public.match_solicitudes add constraint match_solicitudes_primero_check check (
  modo in ('invitar', 'primero')
  and (cuando is null or cuando in ('hoy', 'dia'))
  and (franja is null or franja in ('manana', 'tarde', 'cualquiera'))
  and (modo = 'invitar' or (cuando is not null and lat is not null and direccion is not null
                             and (cuando = 'hoy' or (fecha is not null and franja is not null)))));
create index if not exists match_solicitudes_primero_idx on public.match_solicitudes (limite_toma)
  where modo = 'primero' and estado = 'abierta';

-- la operación de "el primero disponible" se paga antes de tener técnico
alter table public.match_operaciones alter column profesional_id drop not null;
alter table public.match_operaciones drop constraint if exists match_operaciones_estado_check;
alter table public.match_operaciones add constraint match_operaciones_estado_check check (estado in (
  'pendiente_pago', 'buscando_tecnico', 'reserva_confirmada', 'visita_realizada', 'trabajo_en_curso', 'pendiente_confirmacion',
  'pendiente_liquidacion', 'liquidado', 'reembolsado', 'en_disputa', 'cancelado'));
alter table public.match_operaciones drop constraint if exists match_operaciones_tecnico_check;
alter table public.match_operaciones add constraint match_operaciones_tecnico_check
  check (profesional_id is not null or estado in ('pendiente_pago', 'buscando_tecnico', 'cancelado', 'reembolsado'));
alter table public.match_devoluciones drop constraint if exists match_devoluciones_origen_check;
alter table public.match_devoluciones add constraint match_devoluciones_origen_check
  check (origen in ('cliente', 'profesional', 'reclamo', 'pago_tardio', 'pago_duplicado', 'monto_incorrecto', 'admin', 'sin_tecnico'));

-- ---------------------------------------------------------------------
-- 3. Ayudas y funciones nuevas
-- ---------------------------------------------------------------------
create or replace function public._hoy_uy()
returns date language sql stable as $$ select (now() at time zone 'America/Montevideo')::date $$;

-- Horas en que el técnico puede llegar: "hoy" desde ya hasta las 21; un día, en su franja
create or replace function public._ventana_primero(p_cuando text, p_fecha date, p_franja text, p_ahora timestamptz)
returns tstzrange language sql stable as $$
  select case when p_cuando = 'hoy' then
           tstzrange(p_ahora + interval '15 minutes',
                     ((p_ahora at time zone 'America/Montevideo')::date + time '21:00') at time zone 'America/Montevideo', '[]')
         else
           tstzrange(greatest(p_ahora + interval '15 minutes',
                              (p_fecha + case p_franja when 'tarde' then time '13:00' else time '08:00' end) at time zone 'America/Montevideo'),
                     (p_fecha + case p_franja when 'manana' then time '13:00' else time '19:00' end) at time zone 'America/Montevideo', '[]')
         end;
$$;

create or replace function public._cuando_texto(s public.match_solicitudes)
returns text language sql stable as $$
  select case when s.cuando = 'hoy' then 'hoy, lo antes posible'
              else 'el ' || to_char(s.fecha, 'DD/MM') || case s.franja when 'manana' then ' de mañana' when 'tarde' then ' de tarde' else '' end end;
$$;

-- ¿Esta cuenta puede tomar pedidos de "el primero disponible" de este rubro?
create or replace function public._elegible_primero(p_cuenta uuid, p_categoria smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cuenta is not null
     and public.plan_de(p_cuenta) in ('pro', 'business')
     and exists (select 1 from public.match_perfiles m where m.profesional_id = p_cuenta and m.disponible and p_categoria = any (m.rubros))
     and exists (select 1 from public.match_datos_cobro d where d.profesional_id = p_cuenta)
     and exists (select 1 from public.profesionales p, public.configuracion c
                  where p.id = p_cuenta and p.activo and c.id = 1 and (not c.solo_verificados or p.verificado));
$$;

-- La operación a pagar (una sola viva por solicitud; si la anterior venció sin pagar, se hace otra)
create or replace function public._op_primero(p_sol uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); op public.match_operaciones; nuevo uuid;
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
  insert into public.match_operaciones (tipo, solicitud_id, cliente_id, profesional_id, categoria_id, importe, ret_cliente, ret_profesional,
                                        neto_profesional, mp_costo_profesional_pct, vence_pago_en)
  values ('visita', s.id, s.cliente_id, null, s.categoria_id, c.precio_visita, c.visita_ret_cliente, c.visita_ret_profesional,
          c.visita_neto_profesional, c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos))
  returning id into nuevo;
  return nuevo;
end $$;

-- El cliente vuelve a pagar un pedido "el primero disponible" que todavía no pagó
create or replace function public.pagar_primero(p_solicitud uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes;
begin
  select * into s from public.match_solicitudes where id = p_solicitud for update;
  if s.id is null or s.cliente_id <> auth.uid() then raise exception 'No encontramos el pedido'; end if;
  if s.modo <> 'primero' or s.estado <> 'abierta' or s.publicada_en is not null then raise exception 'Este pedido no está para pagar'; end if;
  if s.cuando = 'hoy' and (now() at time zone 'America/Montevideo')::time >= time '19:00' then
    raise exception 'Para hoy ya es tarde: cancelalo y pedilo para otro día';
  end if;
  if s.cuando = 'dia' and upper(public._ventana_primero('dia', s.fecha, s.franja, now())) < now() + interval '1 hour' then
    raise exception 'Esa franja ya pasó: cancelalo y pedilo para otro día';
  end if;
  return json_build_object('operacion', public._op_primero(s.id));
end $$;

-- Pago confirmado: el pedido sale al mapa y se avisa a los técnicos de ese departamento
create or replace function public._publicar_primero(p_op uuid)
returns void language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); lim timestamptz; r record; n int := 0;
begin
  select * into op from public.match_operaciones where id = p_op;
  select * into s from public.match_solicitudes where id = op.solicitud_id for update;
  lim := case when s.cuando = 'hoy'
              then least(now() + make_interval(hours => c.primero_horas),
                         ((now() at time zone 'America/Montevideo')::date + time '20:00') at time zone 'America/Montevideo')
              else upper(public._ventana_primero('dia', s.fecha, s.franja, now())) - interval '1 hour' end;
  update public.match_solicitudes set publicada_en = now(), limite_toma = lim, vence_en = greatest(vence_en, lim), actualizado_en = now()
   where id = s.id returning * into s;
  for r in select m.profesional_id from public.match_perfiles m join public.profesionales p on p.id = m.profesional_id
            where m.disponible and s.categoria_id = any (m.rubros) and s.departamento = any (p.departamentos)
              and m.profesional_id <> s.cliente_id and public._elegible_primero(m.profesional_id, s.categoria_id)
            limit 200 loop
    perform public._aviso_pro(r.profesional_id, 'match', format('Servicio disponible: %s', public._rubro(s.categoria_id)),
      format('%s · %s%s · %s. Lo atiende el primero que lo toma.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento, public._cuando_texto(s)),
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

-- Nadie lo tomó a tiempo: se devuelve todo (lo aprueba el admin)
create or replace function public._vencer_primero()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select o.id, o.numero, o.importe, o.reintegrado, o.mp_pago_id, o.cliente_id, o.solicitud_id
             from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id
            where o.estado = 'buscando_tecnico' and s.limite_toma < now()
            for update of o skip locked loop
    update public.match_operaciones set estado = 'cancelado', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'Ningún técnico lo tomó a tiempo', actualizado_en = now() where id = r.id;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen)
    values (r.id, r.mp_pago_id, r.importe - r.reintegrado, 'Ningún técnico lo tomó a tiempo', 'sin_tecnico')
    on conflict do nothing;
    update public.match_solicitudes set estado = 'vencida', sin_profesionales = true, actualizado_en = now() where id = r.solicitud_id;
    perform public._aviso_cliente(r.cliente_id, 'match', 'Ningún técnico pudo tomar tu pedido',
      'Te devolvemos el dinero por Mercado Pago. Podés pedirlo de nuevo para otro día o recibir propuestas.', '/match/solicitud/' || r.solicitud_id);
    perform public._avisar(public._admins(), null, 'match', 'Devolución para aprobar',
      format('Operación Nº %s: nadie la tomó (%s)', r.numero, public._pesos(r.importe - r.reintegrado)), '/admin/match?ver=devoluciones', '{}'::jsonb);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Para el mapa del técnico: los pedidos que puede tomar (zona aproximada, sin dirección ni contacto)
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
    'duracion_visita_min', (select duracion_visita_min from public.configuracion where id = 1),
    'servicios', case when plan_ok then (
      select coalesce(json_agg(x order by x.limite_toma), '[]') from (
        select s.id, s.numero, public._rubro(s.categoria_id) as rubro, s.titulo, s.descripcion, s.archivos, s.departamento, s.localidad,
               s.cuando, s.fecha, s.franja, s.limite_toma, s.publicada_en, s.urgente,
               round(s.lat::numeric, 2) as lat, round(s.lng::numeric, 2) as lng,
               o.neto_profesional as neto, o.importe, lower(w.v) as desde, upper(w.v) as hasta
          from public.match_solicitudes s
          join public.match_operaciones o on o.solicitud_id = s.id and o.tipo = 'visita' and o.estado = 'buscando_tecnico'
          cross join lateral (select public._ventana_primero(s.cuando, s.fecha, s.franja, now()) as v) w
         where s.modo = 'primero' and s.estado = 'abierta' and s.profesional_id is null and s.publicada_en is not null
           and s.limite_toma > now() and s.cliente_id <> p_cuenta
           and public._elegible_primero(p_cuenta, s.categoria_id)
         limit 200) x) else '[]'::json end);
end $$;

-- El técnico toma el pedido: el primero gana. Elige a qué hora llega (dentro de lo que pidió el cliente)
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
  w := public._ventana_primero(s.cuando, s.fecha, s.franja, now());
  if p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)', public._cuando_texto(s);
  end if;
  v_asig := case when auth.uid() is distinct from p_cuenta then auth.uid() end;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas, asignado_a)
    values (p_cuenta, left('Visita TaListo! Match · ' || public._rubro(s.categoria_id), 120), p_inicio,
            p_inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'confirmado', 'reserva', op.importe,
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
-- 4. Lo que ya existía, con "el primero disponible" (mismas reglas que el SQL 19)
-- ---------------------------------------------------------------------
create or replace function public.crear_solicitud(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); c public.configuracion := public._cfg(); s public.match_solicitudes; n int := 0; r record;
  v_arch text[]; v_dir uuid := public.uuid_o_null(p ->> 'dirigida_a');
  v_modo text := coalesce(nullif(p ->> 'modo', ''), 'invitar'); v_cuando text; v_fecha date; v_franja text; v_op uuid; v_hoy date := public._hoy_uy();
begin
  if u is null then raise exception 'Tenés que iniciar sesión'; end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and estado = 'abierta') >= 5 then
    raise exception 'Ya tenés 5 solicitudes abiertas: esperá respuestas o cancelá alguna';
  end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de solicitudes por día';
  end if;
  if not exists (select 1 from public.categorias where id = (p ->> 'categoria_id')::smallint and activa) then
    raise exception 'Elegí el rubro';
  end if;
  if coalesce(p ->> 'departamento', '') not in ('Artigas','Canelones','Cerro Largo','Colonia','Durazno','Flores','Florida','Lavalleja',
       'Maldonado','Montevideo','Paysandú','Río Negro','Rivera','Rocha','Salto','San José','Soriano','Tacuarembó','Treinta y Tres') then
    raise exception 'Elegí el departamento';
  end if;
  select coalesce(array_agg(x), '{}') into v_arch from jsonb_array_elements_text(coalesce(p -> 'archivos', '[]')) x;
  if exists (select 1 from unnest(v_arch) a where split_part(a, '/', 1) <> u::text) then
    raise exception 'Archivo no válido';
  end if;
  if v_dir is not null and not exists (select 1 from public.match_perfiles where profesional_id = v_dir and disponible) then
    raise exception 'Ese profesional no está recibiendo solicitudes ahora';
  end if;
  -- "El primero disponible": se paga al publicar y la toma el primer técnico Pro o Business del rubro
  if v_modo not in ('invitar', 'primero') then raise exception 'Modo no válido'; end if;
  if v_modo = 'primero' then
    if not c.primero_activo then raise exception 'La opción "el primero disponible" no está activa por ahora'; end if;
    if v_dir is not null then raise exception 'Elegiste un profesional: no puede ser "el primero disponible"'; end if;
    if (p ->> 'lat') is null or (p ->> 'lng') is null or coalesce(trim(p ->> 'direccion'), '') = '' then
      raise exception 'Poné la dirección y marcala en el mapa: así los técnicos ven la zona';
    end if;
    v_cuando := coalesce(nullif(p ->> 'cuando', ''), 'hoy');
    if v_cuando = 'hoy' then
      if (now() at time zone 'America/Montevideo')::time >= time '19:00' then
        raise exception 'Para hoy ya es tarde: elegí otro día';
      end if;
    elsif v_cuando = 'dia' then
      v_fecha := (p ->> 'fecha')::date;
      v_franja := coalesce(nullif(p ->> 'franja', ''), 'cualquiera');
      if v_fecha is null or v_fecha < v_hoy or v_fecha > v_hoy + 30 then raise exception 'Elegí un día de los próximos 30'; end if;
      if v_franja not in ('manana', 'tarde', 'cualquiera') then raise exception 'Elegí la franja'; end if;
      if upper(public._ventana_primero('dia', v_fecha, v_franja, now())) < now() + interval '1 hour' then
        raise exception 'Esa franja ya pasó: elegí otra';
      end if;
    else
      raise exception 'Elegí para cuándo';
    end if;
    if not exists (select 1 from public.match_perfiles m where (p ->> 'categoria_id')::smallint = any (m.rubros) and m.disponible
                    and public._elegible_primero(m.profesional_id, (p ->> 'categoria_id')::smallint)) then
      raise exception 'Por ahora no hay técnicos de ese rubro tomando servicios: publicala para recibir propuestas';
    end if;
  end if;
  insert into public.match_solicitudes (cliente_id, categoria_id, titulo, descripcion, departamento, localidad, direccion, referencia,
                                        lat, lng, preferencia, urgente, archivos, dirigida_a, vence_en, modo, cuando, fecha, franja)
  values (u, (p ->> 'categoria_id')::smallint, trim(p ->> 'titulo'), trim(p ->> 'descripcion'), p ->> 'departamento',
          nullif(trim(coalesce(p ->> 'localidad', '')), ''), nullif(trim(coalesce(p ->> 'direccion', '')), ''),
          nullif(trim(coalesce(p ->> 'referencia', '')), ''), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          coalesce(nullif(p ->> 'preferencia', ''), 'cualquiera'), coalesce((p ->> 'urgente')::boolean, false), v_arch, v_dir,
          case when v_modo = 'primero' then now() + interval '1 day' else now() + make_interval(days => c.solicitud_dias) end,
          v_modo, v_cuando, v_fecha, v_franja)
  returning * into s;
  if v_modo = 'primero' then
    v_op := public._op_primero(s.id);
    perform public._evento(u, 'publico_solicitud', 'match');
    if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
    return json_build_object('id', s.id, 'numero', s.numero, 'invitados', 0, 'operacion', v_op);
  end if;
  for r in select profesional_id from public._invitables(s.id) loop
    insert into public.match_invitaciones (solicitud_id, profesional_id, precio_visita) values (s.id, r.profesional_id, c.precio_visita);
    n := n + 1;
    perform public._aviso_pro(r.profesional_id, 'match',
      format('Nueva solicitud: %s', public._rubro(s.categoria_id)),
      format('%s · %s%s. Respondé si podés hacer la visita.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento),
      '/panel/match?invitacion=' || (select id from public.match_invitaciones where solicitud_id = s.id and profesional_id = r.profesional_id));
  end loop;
  if n = 0 then
    update public.match_solicitudes set sin_profesionales = true where id = s.id;
    perform public._avisar(public._admins(), null, 'match', 'Solicitud sin profesionales',
      format('%s en %s: no hay profesionales disponibles para ese rubro y zona.', public._rubro(s.categoria_id), s.departamento),
      '/admin/match', '{}'::jsonb);
  end if;
  perform public._evento(u, 'publico_solicitud', 'match');
  if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
  return json_build_object('id', s.id, 'numero', s.numero, 'invitados', n);
end $$;

create or replace function public.cancelar_solicitud(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; op public.match_operaciones;
begin
  select * into s from public.match_solicitudes where id = p_id for update;
  if s.id is null or s.cliente_id <> auth.uid() then raise exception 'No encontramos la solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'La solicitud ya tiene una visita: cancelá la visita'; end if;
  -- "el primero disponible" ya pagado y sin técnico: se devuelve todo (lo aprueba el admin)
  select * into op from public.match_operaciones where solicitud_id = p_id and tipo = 'visita' and estado = 'buscando_tecnico' for update;
  if op.id is not null then
    update public.match_operaciones set estado = 'cancelado', cancelado_en = now(), cancelado_por = 'cliente', motivo = left(p_motivo, 300),
           actualizado_en = now() where id = op.id;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen)
    values (op.id, op.mp_pago_id, op.importe - op.reintegrado, 'Cancelada antes de que un técnico la tomara', 'cliente');
    perform public._avisar(public._admins(), null, 'match', 'Devolución para aprobar',
      format('Operación Nº %s: %s', op.numero, public._pesos(op.importe - op.reintegrado)), '/admin/match?ver=devoluciones', '{}'::jsonb);
  end if;
  -- un pago empezado se cancela también (si después llega aprobado, se devuelve)
  update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'cliente'
   where solicitud_id = p_id and estado = 'pendiente_pago';
  update public.turnos set estado = 'cancelado', nota_estado = 'Solicitud cancelada por el cliente'
   where id in (select turno_id from public.match_operaciones where solicitud_id = p_id) and estado = 'pendiente';
  update public.match_solicitudes set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = left(p_motivo, 300), actualizado_en = now()
   where id = p_id;
  update public.match_invitaciones set estado = 'cancelada' where solicitud_id = p_id and estado in ('pendiente', 'aceptada');
  perform public._evento(auth.uid(), 'cancelo_solicitud', 'match');
end $$;

create or replace function public.match_aplicar_pago(p_op uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  op public.match_operaciones; s public.match_solicitudes; pid text := p ->> 'id'; st text := p ->> 'status';
  monto numeric := (p ->> 'transaction_amount')::numeric; fee numeric := coalesce((p ->> 'fee')::numeric, 0);
  res text; cli uuid; dir uuid; ok_turno boolean := true;
begin
  if pid is null or p_op is null then raise exception 'Pago sin datos'; end if;
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null then raise exception 'Operación inexistente'; end if;

  -- ya aplicado (Mercado Pago avisa varias veces)
  if op.mp_pago_id = pid and st = 'approved' then
    return json_build_object('resultado', 'ya_aplicado');
  end if;

  if st = 'approved' then
    if op.mp_pago_id is not null and op.mp_pago_id <> pid then
      res := 'duplicado';
    elsif monto is null or abs(monto - op.importe) > 0.01 or coalesce(p ->> 'currency_id', '') <> 'UYU' then
      res := 'monto_incorrecto';
    elsif op.estado = 'pendiente_pago' or (op.estado = 'cancelado' and op.estado_pago = 'vencido') then
      -- si el turno se había liberado, se intenta recuperar; si ya está ocupado, se devuelve
      if op.estado = 'cancelado' then
        if (select estado from public.match_solicitudes where id = op.solicitud_id) <> 'abierta'
           or exists (select 1 from public.match_operaciones x where x.solicitud_id = op.solicitud_id and x.id <> op.id and x.tipo = op.tipo
                       and x.estado not in ('cancelado', 'reembolsado')) then
          ok_turno := false;
        else
          if op.turno_id is not null then
            begin
              update public.turnos set estado = 'pendiente' where id = op.turno_id and estado = 'cancelado';
              if not found then ok_turno := false; end if;
            exception when exclusion_violation then ok_turno := false;
            end;
          end if;
        end if;
      end if;
      res := case when ok_turno then 'aplicado' else 'pago_tardio' end;
    else
      res := 'pago_tardio';
    end if;
  else
    res := 'estado_' || coalesce(st, 'desconocido');
  end if;

  insert into public.match_pagos (mp_pago_id, operacion_id, estado, importe, moneda, costo_mp, resultado, datos)
  values (pid, op.id, coalesce(st, '?'), monto, p ->> 'currency_id', fee, res,
          jsonb_build_object('status_detail', p ->> 'status_detail', 'date_approved', p ->> 'date_approved'))
  on conflict (mp_pago_id) do update set estado = excluded.estado, resultado = excluded.resultado, actualizado_en = now();

  if res = 'aplicado' then
    select * into s from public.match_solicitudes where id = op.solicitud_id for update;
    update public.match_operaciones
       set estado = case when tipo = 'visita' and profesional_id is null then 'buscando_tecnico'
                         when tipo = 'visita' then 'reserva_confirmada' else 'trabajo_en_curso' end, estado_pago = 'pagado',
           mp_pago_id = pid, mp_estado = st, pagado_en = coalesce((p ->> 'date_approved')::timestamptz, now()),
           mp_costo = public._r2(fee), mp_costo_profesional = public._r2(fee * mp_costo_profesional_pct / 100),
           mp_costo_talisto = public._r2(fee) - public._r2(fee * mp_costo_profesional_pct / 100),
           cancelado_en = null, cancelado_por = null, actualizado_en = now()
     where id = op.id returning * into op;
    perform public._mov(op.id, 'cobro', 'talisto', op.importe, 'Pago Mercado Pago Nº ' || pid);
    if fee > 0 then perform public._mov(op.id, 'costo_mp', 'mercadopago', fee, 'Costo de Mercado Pago'); end if;

    if op.tipo = 'visita' and op.profesional_id is null then
      perform public._publicar_primero(op.id);
    elsif op.tipo = 'visita' then
      -- el cliente queda en la lista de clientes del profesional, con la dirección
      begin
        select id into cli from public.clientes where profesional_id = op.profesional_id and usuario_id = op.cliente_id limit 1;
        if cli is null then
          insert into public.clientes (profesional_id, nombre, telefono, email, usuario_id, notas)
          select op.profesional_id, coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1)), pe.telefono, pe.email, pe.id, 'Cliente de TaListo! Match'
            from public.perfiles pe where pe.id = op.cliente_id returning id into cli;
        end if;
        if s.direccion is not null then
          insert into public.direcciones (cliente_id, etiqueta, direccion, referencia, lat, lng)
          values (cli, 'TaListo! Match', concat_ws(', ', s.direccion, s.localidad, s.departamento), s.referencia, s.lat, s.lng)
          returning id into dir;
        end if;
        update public.turnos set cliente_id = cli, direccion_id = dir where id = op.turno_id;
      exception when others then
        raise warning 'Match: no se pudo agregar el cliente a la agenda: %', sqlerrm;
      end;
      update public.turnos set estado = 'confirmado' where id = op.turno_id;
      update public.match_solicitudes set estado = 'reservada', profesional_id = op.profesional_id, modalidad = 'visita', actualizado_en = now()
       where id = op.solicitud_id;
      update public.match_invitaciones set estado = 'elegida' where id = op.invitacion_id;
      update public.match_invitaciones set estado = 'descartada' where solicitud_id = op.solicitud_id and id <> op.invitacion_id
         and estado in ('pendiente', 'aceptada');
      perform public._aviso_pro(op.profesional_id, 'match', 'Visita confirmada y paga',
        format('%s · %s. Ya está en tu agenda.', s.titulo,
               to_char((select inicio from public.turnos where id = op.turno_id) at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
        '/panel/match?operacion=' || op.id);
      perform public._aviso_cliente(op.cliente_id, 'match', 'Pago confirmado: visita reservada',
        format('Pagaste %s. %s te visita el %s.', public._pesos(op.importe), public._nombre_de(op.profesional_id),
               to_char((select inicio from public.turnos where id = op.turno_id) at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
        '/match/solicitud/' || op.solicitud_id);
    end if;
    perform public._evento(op.cliente_id, 'realizo_pago', 'match');
    perform public._evento(op.profesional_id, 'recibio_contratacion', 'match', op.profesional_id);
  elsif res in ('duplicado', 'monto_incorrecto', 'pago_tardio') then
    -- la plata entró pero no corresponde: se devuelve (lo aprueba el admin)
    if op.estado = 'pendiente_pago' and res = 'pago_tardio' then
      update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema' where id = op.id;
    end if;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen)
    values (op.id, pid, coalesce(monto, op.importe),
            case res when 'duplicado' then 'Pago repetido de la misma operación'
                     when 'monto_incorrecto' then 'El importe pagado no coincide con la operación'
                     else 'Pago aprobado después de vencer la reserva (el horario ya no estaba)' end,
            case res when 'duplicado' then 'pago_duplicado' when 'monto_incorrecto' then 'monto_incorrecto' else 'pago_tardio' end)
    on conflict do nothing;
    perform public._mov(op.id, 'cobro', 'talisto', coalesce(monto, 0), format('Pago Mercado Pago Nº %s (a devolver: %s)', pid, res));
    perform public._avisar(public._admins(), null, 'match', 'Pago a devolver', format('Operación Nº %s: %s.', op.numero, res), '/admin/match?ver=devoluciones', '{}'::jsonb);
    perform public._aviso_cliente(op.cliente_id, 'match', 'Recibimos tu pago, pero hay que devolverlo',
      'El horario ya no estaba disponible o el pago no coincidía. Te devolvemos el dinero por Mercado Pago.', '/match/solicitud/' || op.solicitud_id);
  elsif st in ('refunded', 'charged_back') and op.mp_pago_id = pid and op.estado not in ('reembolsado') then
    update public.match_operaciones set estado = 'en_disputa', mp_estado = st, actualizado_en = now() where id = op.id;
    if st = 'charged_back' then perform public._mov(op.id, 'contracargo', 'cliente', op.importe, 'Contracargo informado por Mercado Pago'); end if;
    perform public._avisar(public._admins(), null, 'match', 'Mercado Pago informó ' || st, format('Operación Nº %s', op.numero), '/admin/match', '{}'::jsonb);
  else
    update public.match_operaciones set mp_estado = st, actualizado_en = now() where id = op.id and estado = 'pendiente_pago';
  end if;
  return json_build_object('resultado', res);
end $$;

create or replace function public.match_procesar_vencidos()
returns json language plpgsql security definer set search_path = public as $$
declare a int := 0; b int := 0; k int := 0; d int := 0; r record; c public.configuracion := public._cfg();
begin
  if not pg_try_advisory_xact_lock(hashtext('match_vencidos')) then return json_build_object('omitido', true); end if;
  if (select ultima from public.match_tareas where id = 1) > now() - interval '1 minute' then return json_build_object('omitido', true); end if;
  update public.match_tareas set ultima = now() where id = 1;
  d := public._vencer_primero();

  for r in select id, turno_id from public.match_operaciones where estado = 'pendiente_pago' and vence_pago_en < now() for update skip locked loop
    update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'No se pagó a tiempo' where id = r.id;
    update public.turnos set estado = 'cancelado', nota_estado = 'Reserva sin pagar' where id = r.turno_id and estado = 'pendiente';
    a := a + 1;
  end loop;

  for r in select id from public.match_solicitudes s where estado = 'abierta' and vence_en < now()
             and not exists (select 1 from public.match_operaciones o where o.solicitud_id = s.id and o.estado in ('pendiente_pago', 'buscando_tecnico')) loop
    update public.match_solicitudes set estado = 'vencida', actualizado_en = now() where id = r.id;
    update public.match_invitaciones set estado = 'vencida' where solicitud_id = r.id and estado in ('pendiente', 'aceptada');
    b := b + 1;
  end loop;

  -- visitas pasadas que nadie marcó: se le pregunta al cliente (puede reclamar) y después se confirman solas
  for r in select o.id, o.cliente_id, o.solicitud_id from public.match_operaciones o join public.turnos t on t.id = o.turno_id
            where o.estado = 'reserva_confirmada' and t.fin < now() - interval '24 hours' loop
    update public.match_operaciones set estado = 'pendiente_confirmacion', realizado_en = coalesce(realizado_en, now()),
           confirmar_hasta = now() + make_interval(hours => c.confirmacion_auto_horas) where id = r.id;
    perform public._aviso_cliente(r.cliente_id, 'match', '¿Se hizo la visita?',
      format('Confirmala o reclamá. Si no respondés, se confirma sola en %s horas.', c.confirmacion_auto_horas), '/match/solicitud/' || r.solicitud_id);
  end loop;

  for r in select o.id from public.match_operaciones o where o.estado = 'pendiente_confirmacion' and o.confirmar_hasta < now()
             and not exists (select 1 from public.match_reclamos x where x.operacion_id = o.id and x.estado = 'abierto') loop
    perform public._confirmar_operacion(r.id, 'automatica');
    k := k + 1;
  end loop;
  return json_build_object('pagos_vencidos', a, 'solicitudes_vencidas', b, 'confirmadas', k, 'sin_tecnico', d);
end $$;

create or replace function public.solicitud_cliente(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg();
begin
  select * into s from public.match_solicitudes where id = p_id;
  if s.id is null or (s.cliente_id <> auth.uid() and not public.es_admin()) then raise exception 'No encontramos la solicitud'; end if;
  return json_build_object(
    'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo, 'descripcion', s.descripcion, 'estado', s.estado,
       'modalidad', s.modalidad, 'rubro', public._rubro(s.categoria_id), 'categoria_id', s.categoria_id, 'departamento', s.departamento,
       'localidad', s.localidad, 'direccion', s.direccion, 'referencia', s.referencia, 'preferencia', s.preferencia, 'urgente', s.urgente,
       'archivos', s.archivos, 'creado_en', s.creado_en, 'vence_en', s.vence_en, 'sin_profesionales', s.sin_profesionales,
       'modo', s.modo, 'cuando', s.cuando, 'fecha', s.fecha, 'franja', s.franja, 'publicada_en', s.publicada_en,
       'limite_toma', s.limite_toma, 'tomada_en', s.tomada_en),
    'config', json_build_object('precio_visita', c.precio_visita, 'cancelacion_horas', c.cancelacion_horas,
       'cancelacion_tarde_pct', c.cancelacion_tarde_pct, 'confirmacion_auto_horas', c.confirmacion_auto_horas,
       'duracion_visita_min', c.duracion_visita_min, 'garantia_dias', c.garantia_dias, 'comision_pct', c.trabajo_comision_pct,
       'primero_horas', c.primero_horas),
    'invitados', (select count(*) from public.match_invitaciones where solicitud_id = s.id),
    'esperando', (select count(*) from public.match_invitaciones where solicitud_id = s.id and estado = 'pendiente'),
    'propuestas', (select coalesce(json_agg(json_build_object('invitacion', i.id, 'estado', i.estado, 'mensaje', i.mensaje,
                      'precio_visita', i.precio_visita, 'respondida_en', i.respondida_en, 'profesional', public._prof_publico(i.profesional_id))
                      order by i.respondida_en), '[]')
                     from public.match_invitaciones i where i.solicitud_id = s.id and i.estado in ('aceptada', 'elegida')),
    'operaciones', (select coalesce(json_agg(json_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'estado', o.estado,
                      'estado_pago', o.estado_pago, 'importe', o.importe, 'reintegrado', o.reintegrado, 'vence_pago_en', o.vence_pago_en,
                      'pagado_en', o.pagado_en, 'realizado_en', o.realizado_en, 'confirmar_hasta', o.confirmar_hasta, 'diagnostico', o.diagnostico,
                      'profesional', public._prof_publico(o.profesional_id), 'externa', o.externa,
                      'turno', (select json_build_object('inicio', t.inicio, 'fin', t.fin, 'estado', t.estado) from public.turnos t where t.id = o.turno_id),
                      'calificacion', (select json_build_object('puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta)
                                         from public.match_calificaciones k where k.operacion_id = o.id),
                      'reclamo', (select json_build_object('id', r.id, 'estado', r.estado, 'descripcion', r.descripcion, 'resolucion', r.resolucion,
                                    'respuesta_profesional', r.respuesta_profesional) from public.match_reclamos r where r.operacion_id = o.id
                                    order by r.creado_en desc limit 1),
                      'devoluciones', (select coalesce(json_agg(json_build_object('monto', d.monto, 'estado', d.estado, 'motivo', d.motivo)), '[]')
                                         from public.match_devoluciones d where d.operacion_id = o.id))
                      order by o.creado_en desc), '[]')
                     from public.match_operaciones o where o.solicitud_id = s.id and not (o.estado = 'cancelado' and o.estado_pago = 'vencido'))
  );
end $$;

create or replace function public.ve_archivo_match(p_ruta text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_ruta, '/', 1) = auth.uid()::text or public.es_admin()
      or exists (select 1 from public.match_solicitudes s join public.match_invitaciones i on i.solicitud_id = s.id
                  where p_ruta = any(s.archivos) and public._es_match(i.profesional_id))
      or exists (select 1 from public.match_reclamos r where p_ruta = any(r.archivos) and public._es_match(r.profesional_id))
      or exists (select 1 from public.match_solicitudes s where p_ruta = any(s.archivos) and public._es_match(s.profesional_id))
      -- "el primero disponible": la ven los técnicos que la pueden tomar
      or exists (select 1 from public.match_solicitudes s where p_ruta = any(s.archivos) and s.modo = 'primero' and s.estado = 'abierta'
                  and s.publicada_en is not null and s.profesional_id is null
                  and exists (select 1 from (select auth.uid() union select public.cuentas_con(array['match'])) y(x)
                               where public._elegible_primero(y.x, s.categoria_id)));
$$;

create or replace function public.admin_match(p_ver text default 'operaciones', p_texto text default null)
returns json language plpgsql security definer set search_path = public as $$
declare q text := public.normalizar(trim(coalesce(p_texto, '')));
begin
  perform public._exigir_admin();
  perform public.match_procesar_vencidos();
  return json_build_object(
    'resumen', json_build_object(
      'a_liquidar', (select coalesce(sum(liquidacion_monto), 0) from public.match_operaciones where estado_liquidacion = 'pendiente'),
      'a_liquidar_ops', (select count(*) from public.match_operaciones where estado_liquidacion = 'pendiente'),
      'retenido', (select coalesce(sum(importe - reintegrado), 0) from public.match_operaciones
                    where estado in ('buscando_tecnico', 'reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
      'devoluciones', (select count(*) from public.match_devoluciones where estado in ('pendiente', 'aprobada', 'error')),
      'reclamos', (select count(*) from public.match_reclamos where estado = 'abierto'),
      'sin_profesionales', (select count(*) from public.match_solicitudes where sin_profesionales and estado = 'abierta')),
    'operaciones', case when p_ver in ('operaciones', 'a_liquidar') then (
      select coalesce(json_agg(x order by x.creado_en desc), '[]') from (
        select o.id, o.numero, o.tipo, o.estado, o.estado_pago, o.estado_liquidacion, o.importe, o.ret_cliente, o.ret_profesional, o.comision,
               o.neto_profesional, o.mp_costo, o.mp_costo_profesional, o.mp_costo_talisto, o.liquidacion_monto, o.ingreso_talisto, o.reintegrado,
               o.mp_pago_id, o.pagado_en, o.confirmado_en, o.confirmado_por, o.creado_en, o.profesional_id, o.externa,
               coalesce(public._nombre_de(o.profesional_id), 'El primero disponible (sin técnico)') as profesional, public._nombre_de(o.cliente_id) as cliente, public._rubro(o.categoria_id) as rubro,
               (select json_build_object('banco', d.banco, 'tipo_cuenta', d.tipo_cuenta, 'numero', d.numero, 'sucursal', d.sucursal, 'titular', d.titular,
                         'documento', d.documento) from public.match_datos_cobro d where d.profesional_id = o.profesional_id) as cobro
          from public.match_operaciones o
         where (p_ver <> 'a_liquidar' or o.estado_liquidacion = 'pendiente')
           and not (o.estado = 'cancelado' and o.estado_pago = 'vencido' and p_ver = 'operaciones' and q = '')
           and (q = '' or public.normalizar(coalesce(public._nombre_de(o.profesional_id), '') || ' ' || coalesce(public._nombre_de(o.cliente_id), '') || ' ' || o.numero) like '%' || q || '%')
         order by o.creado_en desc limit 300) x) end,
    'devoluciones', case when p_ver = 'devoluciones' then (
      select coalesce(json_agg(json_build_object('id', d.id, 'operacion', o.numero, 'operacion_id', o.id, 'monto', d.monto, 'motivo', d.motivo,
               'origen', d.origen, 'estado', d.estado, 'error', d.error, 'creado_en', d.creado_en, 'importe', o.importe, 'mp_pago_id', coalesce(d.mp_pago_id, o.mp_pago_id),
               'cliente', public._nombre_de(o.cliente_id), 'profesional', public._nombre_de(o.profesional_id)) order by d.creado_en desc), '[]')
        from public.match_devoluciones d join public.match_operaciones o on o.id = d.operacion_id
       where d.estado in ('pendiente', 'aprobada', 'error') or d.creado_en > now() - interval '60 days') end,
    'reclamos', case when p_ver = 'reclamos' then (
      select coalesce(json_agg(json_build_object('id', r.id, 'numero', r.numero, 'operacion', o.numero, 'operacion_id', o.id, 'tipo', r.tipo,
               'descripcion', r.descripcion, 'archivos', r.archivos, 'estado', r.estado, 'accion', r.accion, 'resolucion', r.resolucion,
               'respuesta_profesional', r.respuesta_profesional, 'creado_en', r.creado_en, 'importe', o.importe, 'estado_operacion', o.estado,
               'cliente', public._nombre_de(r.cliente_id), 'profesional', public._nombre_de(r.profesional_id)) order by (r.estado = 'abierto') desc, r.creado_en desc), '[]')
        from public.match_reclamos r join public.match_operaciones o on o.id = r.operacion_id
       where r.estado = 'abierto' or r.creado_en > now() - interval '90 days') end,
    'liquidaciones', case when p_ver = 'a_liquidar' then (
      select coalesce(json_agg(json_build_object('numero', l.numero, 'profesional', public._nombre_de(l.profesional_id), 'monto', l.monto,
               'fecha', l.fecha, 'referencia', l.referencia, 'operaciones', l.operaciones) order by l.creado_en desc), '[]')
        from (select * from public.match_liquidaciones order by creado_en desc limit 50) l) end
  );
end $$;

create or replace function public.guardar_config_match(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare c public.configuracion := public._cfg(); n public.configuracion;
begin
  perform public._exigir_admin();
  n := jsonb_populate_record(c, p - 'id' - 'actualizado_en' - 'actualizado_por');
  if n.precio_visita <> n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional then
    raise exception 'El reparto no coincide con el precio: % + % + % = %, y la visita cuesta %', public._pesos(n.visita_ret_cliente),
      public._pesos(n.visita_ret_profesional), public._pesos(n.visita_neto_profesional),
      public._pesos(n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional), public._pesos(n.precio_visita);
  end if;
  update public.configuracion set
    precio_visita = n.precio_visita, comision_visita = n.visita_ret_cliente + n.visita_ret_profesional,
    visita_ret_cliente = n.visita_ret_cliente, visita_ret_profesional = n.visita_ret_profesional, visita_neto_profesional = n.visita_neto_profesional,
    duracion_visita_min = n.duracion_visita_min, trabajo_comision_pct = n.trabajo_comision_pct, trabajo_comision_activa = n.trabajo_comision_activa,
    comision_por_rubro = n.comision_por_rubro, mp_costo_profesional_pct = n.mp_costo_profesional_pct, acreditar_visita = n.acreditar_visita,
    confirmacion_auto_horas = n.confirmacion_auto_horas, liquidacion_dias = n.liquidacion_dias, cancelacion_horas = n.cancelacion_horas,
    cancelacion_tarde_pct = n.cancelacion_tarde_pct, penalizacion_profesional = n.penalizacion_profesional, devolucion_dias = n.devolucion_dias,
    pago_minutos = n.pago_minutos, solicitud_dias = n.solicitud_dias, max_invitados = n.max_invitados, solo_verificados = n.solo_verificados,
    garantia_dias = n.garantia_dias, garantia_cobertura = left(n.garantia_cobertura, 1500), garantia_exclusiones = left(n.garantia_exclusiones, 1500),
    reclamo_procedimiento = left(n.reclamo_procedimiento, 1500), primero_activo = n.primero_activo, primero_horas = n.primero_horas
   where id = 1;
  return (select to_json(x) from public.configuracion x where id = 1);
end $$;

-- ---------------------------------------------------------------------
-- 5. Quién puede llamar a qué
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.pagar_primero(uuid)', 'public.servicios_disponibles(uuid)', 'public.tomar_servicio(uuid, uuid, timestamptz)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._op_primero(uuid)', 'public._publicar_primero(uuid)', 'public._vencer_primero()', 'public._elegible_primero(uuid, smallint)',
    'public._cuando_texto(public.match_solicitudes)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

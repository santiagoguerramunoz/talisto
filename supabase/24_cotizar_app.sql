-- =====================================================================
--  TaListo!  ·  24 · Cotizar también los pedidos de la app
--  "El primero disponible" desde la app pasa a funcionar como WhatsApp:
--  el cliente publica sin pagar; paga cuando un técnico lo toma al precio
--  base o cuando acepta una cotización (si la visita sale más cara).
--  Los técnicos pueden cotizar todos esos pedidos y el cliente ve las
--  cotizaciones en su pedido. Correr después del 23. Se puede correr más
--  de una vez.
-- =====================================================================

-- true = como antes (el cliente paga al publicar). Queda en false.
alter table public.configuracion add column if not exists primero_cobro_adelantado boolean not null default false;



-- 1. Crear la solicitud: "el primero disponible" sale al mapa sin pagar
create or replace function public.crear_solicitud(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); c public.configuracion := public._cfg(); s public.match_solicitudes; n int := 0; r record;
  v_arch text[]; v_dir uuid := public.uuid_o_null(p ->> 'dirigida_a');
  v_modo text := coalesce(nullif(p ->> 'modo', ''), 'invitar'); v_cuando text; v_fecha date; v_franja text; v_op uuid; v_hoy date := public._hoy_uy();
  v_wa boolean := coalesce(current_setting('talisto.canal', true), '') = 'whatsapp';
  -- desde el SQL 24 "el primero disponible" se paga cuando un técnico lo toma o al aceptar una cotización (app y WhatsApp)
  v_pago text := case when coalesce(current_setting('talisto.canal', true), '') = 'whatsapp' or not c.primero_cobro_adelantado
                      then 'al_tomar' else 'al_publicar' end;
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
  if v_wa then v_modo := 'primero'; end if;
  if v_modo not in ('invitar', 'primero') then raise exception 'Modo no válido'; end if;
  if v_modo = 'primero' then
    if not c.primero_activo then raise exception 'La opción "el primero disponible" no está activa por ahora'; end if;
    if v_dir is not null then raise exception 'Elegiste un profesional: no puede ser "el primero disponible"'; end if;
    if coalesce(trim(p ->> 'direccion'), '') = '' or (not v_wa and ((p ->> 'lat') is null or (p ->> 'lng') is null)) then
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
                                        lat, lng, preferencia, urgente, archivos, dirigida_a, vence_en, modo, cuando, fecha, franja, pago, canal)
  values (u, (p ->> 'categoria_id')::smallint, trim(p ->> 'titulo'), trim(p ->> 'descripcion'), p ->> 'departamento',
          nullif(trim(coalesce(p ->> 'localidad', '')), ''), nullif(trim(coalesce(p ->> 'direccion', '')), ''),
          nullif(trim(coalesce(p ->> 'referencia', '')), ''), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          coalesce(nullif(p ->> 'preferencia', ''), 'cualquiera'), coalesce((p ->> 'urgente')::boolean, false), v_arch, v_dir,
          case when v_modo = 'primero' then now() + interval '1 day' else now() + make_interval(days => c.solicitud_dias) end,
          v_modo, v_cuando, v_fecha, v_franja, case when v_modo = 'primero' then v_pago else 'al_publicar' end,
          case when v_wa then 'whatsapp' else 'app' end)
  returning * into s;
  if v_modo = 'primero' then
    if s.pago = 'al_tomar' then
      perform public._publicar_al_tomar(s.id);
    else
      v_op := public._op_primero(s.id);
    end if;
    perform public._evento(u, 'publico_solicitud', 'match');
    if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
    return json_build_object('id', s.id, 'numero', s.numero, 'invitados', 0, 'operacion', v_op, 'pago', s.pago);
  end if;
  for r in select profesional_id from public._invitables(s.id) loop
    insert into public.match_invitaciones (solicitud_id, profesional_id, precio_visita) values (s.id, r.profesional_id, c.precio_visita);
    n := n + 1;
    perform public._aviso_pro(r.profesional_id, 'match',
      format('Nueva solicitud: %s', public._rubro(s.categoria_id)),
      format('%s · %s%s. Respondé si podés hacer la visita o mandá tu precio.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento),
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

-- 2. Publicar sin pagar y avisar a los técnicos
create or replace function public._publicar_al_tomar(p_sol uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); lim timestamptz; v_urg boolean; v_normal tstzrange;
  r record; n int := 0; t record;
begin
  select * into s from public.match_solicitudes where id = p_sol for update;
  v_urg := public._urgencia_primero(s.urgente, s.cuando, s.fecha, s.franja);
  select * into t from public._tarifa(v_urg);
  lim := case when s.cuando = 'hoy'
              then least(now() + make_interval(hours => c.primero_horas),
                         ((now() at time zone 'America/Montevideo')::date + time '20:00') at time zone 'America/Montevideo')
              else upper(public._ventana_primero('dia', s.fecha, s.franja, now())) - interval '1 hour' end;
  v_normal := public._ventana_toma(s, false, null);
  if not v_urg and v_normal is not null then
    lim := least(lim, upper(v_normal) - make_interval(mins => c.duracion_visita_min));
  end if;
  update public.match_solicitudes set publicada_en = now(), limite_toma = lim, vence_en = greatest(vence_en, lim), urgencia_tarifa = v_urg,
         actualizado_en = now() where id = s.id returning * into s;
  for r in select m.profesional_id from public.match_perfiles m join public.profesionales p on p.id = m.profesional_id
            where m.disponible and s.categoria_id = any (m.rubros) and s.departamento = any (p.departamentos)
              and m.profesional_id <> s.cliente_id and public._elegible_primero(m.profesional_id, s.categoria_id)
              and (v_normal is not null or (v_urg and public._atiende_urgencias(m.profesional_id)))
            limit 200 loop
    perform public._aviso_pro(r.profesional_id, 'match',
      format('%s para tomar o cotizar: %s', case when v_urg then 'Urgencia' else 'Servicio' end, public._rubro(s.categoria_id)),
      format('%s · %s%s · %s. Tomalo a %s o mandá tu cotización.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento,
             public._cuando_texto(s), public._pesos(t.neto)),
      '/panel/mapa?ver=servicios');
    n := n + 1;
  end loop;
  if n = 0 then
    update public.match_solicitudes set sin_profesionales = true where id = s.id;
    perform public._avisar(public._admins(), null, 'match', case when s.canal = 'whatsapp' then 'Pedido de WhatsApp sin técnicos' else 'Pedido sin técnicos' end,
      format('%s en %s: no hay técnicos para avisar.', public._rubro(s.categoria_id), s.departamento), '/admin/match', '{}'::jsonb);
  end if;
end $$;

-- 3. El técnico lo toma: el cliente de la app recibe el aviso para pagar
create or replace function public.tomar_servicio(p_solicitud uuid, p_cuenta uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.match_solicitudes; op public.match_operaciones; c public.configuracion := public._cfg(); w tstzrange; t uuid;
  cli uuid; dir uuid; v_asig uuid; v_urg boolean; tf record;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para tomar servicios en esta cuenta'; end if;
  perform public.match_procesar_vencidos();
  select * into s from public.match_solicitudes where id = p_solicitud for update;
  if s.id is null or s.modo <> 'primero' then raise exception 'No encontramos el servicio'; end if;
  if s.profesional_id is not null or s.estado <> 'abierta' then raise exception 'Otro técnico ya tomó este servicio'; end if;
  if s.pago = 'al_tomar' then
    if s.publicada_en is null or s.limite_toma < now() or exists (
         select 1 from public.match_operaciones x where x.solicitud_id = s.id and x.tipo = 'visita' and x.estado not in ('cancelado', 'reembolsado')) then
      raise exception 'Este servicio ya no está disponible';
    end if;
    v_urg := coalesce(s.urgencia_tarifa, false);
  else
    select * into op from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado = 'buscando_tecnico' for update;
    if op.id is null or s.limite_toma < now() then raise exception 'Este servicio ya no está disponible'; end if;
    v_urg := op.urgencia;
  end if;
  if s.cliente_id = p_cuenta or s.cliente_id = auth.uid() then raise exception 'No podés tomar tu propio pedido'; end if;
  if not public._elegible_primero(p_cuenta, s.categoria_id) then
    raise exception 'Para tomar servicios necesitás plan Pro o Business, Match activo con este rubro y la cuenta bancaria cargada';
  end if;
  w := public._ventana_toma(s, v_urg, p_cuenta);
  if w is null then
    raise exception 'Este pedido es fuera de horario: lo toman los que atienden urgencias (activalo en tu perfil Match)';
  end if;
  if p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)%', public._cuando_texto(s),
      case when v_urg and public._atiende_urgencias(p_cuenta) then '' else ', en horario normal' end;
  end if;
  select * into tf from public._tarifa(v_urg);
  v_asig := case when auth.uid() is distinct from p_cuenta then auth.uid() end;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas, asignado_a)
    values (p_cuenta, left(case when v_urg then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            p_inicio, p_inicio + make_interval(mins => c.duracion_visita_min), 'visita',
            case when s.pago = 'al_tomar' then 'pendiente' else 'confirmado' end, 'reserva', coalesce(op.importe, tf.importe),
            left(format('Pedido Nº %s (el primero disponible): %s', s.numero, s.titulo), 500), v_asig)
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ya tenés algo agendado a esa hora: elegí otra';
  end;

  -- Pedido sin pagar (app o WhatsApp): se reserva y el cliente paga (si no paga a tiempo, vuelve al mapa)
  if s.pago = 'al_tomar' then
    insert into public.match_operaciones (tipo, solicitud_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                          ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
    values ('visita', s.id, t, s.cliente_id, p_cuenta, s.categoria_id, tf.importe, tf.ret_cliente, tf.ret_profesional, tf.neto,
            c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), v_urg)
    returning * into op;
    update public.match_solicitudes set profesional_id = p_cuenta, tomada_en = now(), tomada_por = auth.uid(), actualizado_en = now()
     where id = s.id;
    update public.match_cotizaciones set estado = 'vencida' where solicitud_id = s.id and estado = 'pendiente';
    perform public._wa_avisar(s.cliente_id,
      format(E'¡Un técnico tomó tu pedido! 🙌\n%s te visita el %s a las %s.\nPara confirmarlo, pagá %s con Mercado Pago (tenés %s minutos):',
             public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
             to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'), public._pesos(tf.importe), c.pago_minutos), op.id);
    if not public._es_whatsapp(s.cliente_id) then
      perform public._aviso_cliente(s.cliente_id, 'match', 'Un técnico tomó tu pedido: falta pagar',
        format('%s te visita el %s a las %s. Pagá %s para confirmarlo (tenés %s minutos).', public._nombre_de(p_cuenta),
               to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'), to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'),
               public._pesos(tf.importe), c.pago_minutos),
        '/match/solicitud/' || s.id);
    end if;
    perform public._aviso_pro(p_cuenta, 'match', 'Lo tomaste: falta el pago del cliente',
      format('%s · %s. Te confirmamos cuando el cliente pague (tiene %s minutos).', s.titulo,
             to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI'), c.pago_minutos), '/panel/match?ver=visitas');
    perform public._evento(auth.uid(), 'acepto_solicitud', 'match', p_cuenta);
    return json_build_object('operacion', op.id, 'turno', t, 'inicio', p_inicio, 'pago_pendiente', true, 'vence', op.vence_pago_en);
  end if;

  -- el cliente queda en la lista de clientes del técnico, con la dirección
  begin
    select id into cli from public.clientes where profesional_id = p_cuenta and usuario_id = s.cliente_id limit 1;
    if cli is null then
      insert into public.clientes (profesional_id, nombre, telefono, email, usuario_id, notas)
      select p_cuenta, coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1), pe.telefono, 'Cliente'), pe.telefono, pe.email, pe.id, 'Cliente de TaListo! Match'
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

-- 4. El técnico cotiza: el cliente de la app recibe el aviso
create or replace function public.cotizar_servicio(p_solicitud uuid, p_cuenta uuid, p_precio numeric, p_inicio timestamptz, p_mensaje text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); w tstzrange; v_urg boolean; v_fee numeric; k public.match_cotizaciones;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para cotizar en esta cuenta'; end if;
  select * into s from public.match_solicitudes where id = p_solicitud;
  if s.id is null or s.pago <> 'al_tomar' then raise exception 'Este pedido no recibe cotizaciones'; end if;
  if s.profesional_id is not null or s.estado <> 'abierta' or s.limite_toma < now() then raise exception 'Este pedido ya no está disponible'; end if;
  if s.cliente_id = p_cuenta or s.cliente_id = auth.uid() then raise exception 'No podés cotizar tu propio pedido'; end if;
  if not public._elegible_primero(p_cuenta, s.categoria_id) then
    raise exception 'Para cotizar necesitás plan Pro o Business, Match activo con este rubro y la cuenta para cobrar cargada';
  end if;
  p_precio := round(coalesce(p_precio, 0));
  if p_precio < c.cotizacion_min or p_precio > c.cotizacion_max then
    raise exception 'La cotización tiene que estar entre % y %', public._pesos(c.cotizacion_min), public._pesos(c.cotizacion_max);
  end if;
  w := public._ventana_toma(s, coalesce(s.urgencia_tarifa, false), p_cuenta);
  if w is null or p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)', public._cuando_texto(s);
  end if;
  v_urg := coalesce(s.urgencia_tarifa, false) or not public._es_horario_normal(p_inicio);
  v_fee := case when v_urg then c.urgencia_ret_cliente else c.visita_ret_cliente end;
  insert into public.match_cotizaciones (solicitud_id, profesional_id, precio_profesional, importe, inicio, mensaje, urgencia, creado_por)
  values (s.id, p_cuenta, p_precio, p_precio + v_fee, p_inicio, nullif(left(trim(coalesce(p_mensaje, '')), 300), ''), v_urg, auth.uid())
  on conflict (solicitud_id, profesional_id) do update set precio_profesional = excluded.precio_profesional, importe = excluded.importe,
    inicio = excluded.inicio, mensaje = excluded.mensaje, urgencia = excluded.urgencia, estado = 'pendiente', creado_por = excluded.creado_por,
    creado_en = now(), respondida_en = null
  returning * into k;
  perform public._wa_avisar(s.cliente_id,
    format(E'💬 Cotización para tu pedido Nº %s\n%s puede ir el %s a las %s. La visita sale %s (incluye TaListo!).%s\nRespondé *COTIZACIONES* para verlas y elegir.',
           s.numero, public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
           to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'), public._pesos(k.importe),
           coalesce(E'\n«' || k.mensaje || '»', '')));
  if not public._es_whatsapp(s.cliente_id) then
    perform public._aviso_cliente(s.cliente_id, 'match', 'Te mandaron una cotización',
      format('%s puede ir el %s a las %s. La visita sale %s (incluye TaListo!). Entrá para verla y aceptarla.', public._nombre_de(p_cuenta),
             to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'), to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'),
             public._pesos(k.importe)),
      '/match/solicitud/' || s.id);
  end if;
  perform public._evento(auth.uid(), 'envio_cotizacion', 'match', p_cuenta);
  return json_build_object('cotizacion', k.id, 'importe', k.importe);
end $$;

-- 5. Vencimientos sin técnico: el texto depende de si es de la app o de WhatsApp
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
  -- pedidos sin pagar (app o WhatsApp) que nadie tomó
  for r in select s.id, s.cliente_id, s.numero from public.match_solicitudes s
            where s.pago = 'al_tomar' and s.estado = 'abierta' and s.profesional_id is null and s.limite_toma < now()
            for update skip locked loop
    update public.match_solicitudes set estado = 'vencida', sin_profesionales = true, actualizado_en = now() where id = r.id;
    update public.match_cotizaciones set estado = 'vencida' where solicitud_id = r.id and estado = 'pendiente';
    perform public._aviso_cliente(r.cliente_id, 'match', 'Ningún técnico pudo tomar tu pedido',
      format('Tu pedido Nº %s venció sin técnico. No se te cobró nada. %s', r.numero,
             case when public._es_whatsapp(r.cliente_id) then 'Escribinos *HOLA* para pedirlo de nuevo.'
                  else 'Podés pedirlo de nuevo para otro día o recibir propuestas.' end),
      '/match/solicitud/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- 6. Lo que ve el cliente en su pedido: forma de pago, precio base y cotizaciones
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
       'limite_toma', s.limite_toma, 'tomada_en', s.tomada_en, 'pago', s.pago, 'canal', s.canal, 'tomada', s.profesional_id is not null,
       'urgencia_tarifa', s.urgencia_tarifa,
       'precio_base', case when s.pago = 'al_tomar' then (select t.importe from public._tarifa(coalesce(s.urgencia_tarifa, false)) t) end),
    'config', json_build_object('precio_visita', c.precio_visita, 'cancelacion_horas', c.cancelacion_horas,
       'cancelacion_tarde_pct', c.cancelacion_tarde_pct, 'confirmacion_auto_horas', c.confirmacion_auto_horas,
       'duracion_visita_min', c.duracion_visita_min, 'garantia_dias', c.garantia_dias, 'comision_pct', c.trabajo_comision_pct,
       'primero_horas', c.primero_horas, 'tarifa_talisto', c.visita_ret_cliente, 'tarifa_talisto_urgencia', c.urgencia_ret_cliente),
    -- cotizaciones de los técnicos para "el primero disponible" (mientras nadie lo tomó)
    'cotizaciones', (select coalesce(json_agg(json_build_object('id', k.id, 'importe', k.importe, 'inicio', k.inicio, 'mensaje', k.mensaje,
                      'urgencia', k.urgencia, 'creado_en', k.creado_en, 'profesional', public._prof_publico(k.profesional_id))
                      order by k.importe, k.inicio), '[]')
                     from public.match_cotizaciones k where k.solicitud_id = s.id and k.estado = 'pendiente' and s.estado = 'abierta'
                      and s.profesional_id is null and k.inicio > now() + interval '15 minutes'),
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


notify pgrst, 'reload schema';

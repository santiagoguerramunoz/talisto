-- =====================================================================
--  TaListo!  ·  26 · Calificación de 0 a 10 (puntualidad, velocidad, desempeño)
--  · Al dar el visto bueno el cliente califica de 0 (malo) a 10 (excelente)
--    la puntualidad, la velocidad y el desempeño. La nota de esa contratación
--    es el promedio de las 3.
--  · El puntaje del profesional es el promedio de sus últimas 10
--    contrataciones calificadas (de la 1 a la 10; en la 11 cuenta de la 2 a
--    la 11, y así): un mal día se supera rápido.
--  · Estrellas = promedio ÷ 2, con fracción (7 → 3,5 ★), mínimo 1 ★.
--  · Las calificaciones viejas (1 a 5 estrellas) se pasan a 0–10 (× 2).
--  · Orden para los clientes: "puntaje sostenido" = promedio del puntaje
--    día a día en los últimos 6 meses (antes de la primera calificación
--    cuenta 2,5 ★). Más puntaje por más tiempo → más arriba.
--  Correr después del 25. Se puede correr más de una vez.
-- =====================================================================

-- 1. Los 3 puntos y la nota de cada calificación
alter table public.match_calificaciones add column if not exists puntualidad smallint check (puntualidad between 0 and 10);
alter table public.match_calificaciones add column if not exists velocidad   smallint check (velocidad between 0 and 10);
alter table public.match_calificaciones add column if not exists desempeno   smallint check (desempeno between 0 and 10);
alter table public.match_calificaciones add column if not exists nota        numeric(4,2) check (nota between 0 and 10);
-- las viejas (1 a 5 estrellas) pasan a la escala de 0 a 10
update public.match_calificaciones set nota = puntaje * 2 where nota is null;

-- 2. De la nota (0 a 10) a estrellas: ÷ 2 con fracción, mínimo 1
create or replace function public._estrellas_de(p_nota numeric)
returns numeric language sql immutable set search_path = public as $$
  select case when p_nota is null then null else greatest(1, round(p_nota / 2, 1)) end;
$$;

-- 3. Puntaje sostenido: promedio del puntaje (últimas 10, en estrellas) a lo largo de los últimos p_dias.
--    El puntaje solo cambia con cada calificación, así que se suma por tramos; antes de la primera cuenta 2,5 ★.
create or replace function public._puntaje_sostenido(p_prof uuid, p_dias int default 180)
returns numeric language sql stable security definer set search_path = public as $$
  with v as (select now() - make_interval(days => p_dias) as ini, now() as fin),
  c as (
    select k.creado_en as desde, lead(k.creado_en) over w as hasta,
           public._estrellas_de(avg(k.nota) over (w rows between 9 preceding and current row)) as est
      from public.match_calificaciones k
     where k.profesional_id = p_prof and k.nota is not null
    window w as (order by k.creado_en, k.id)
  ),
  tramos as (
    select v.ini as a, least(coalesce((select min(desde) from c), v.fin), v.fin) as b, 2.5::numeric as est from v
    union all
    select greatest(c.desde, v.ini), least(coalesce(c.hasta, v.fin), v.fin), c.est from c, v
  )
  select round(sum(extract(epoch from (b - a)) * est) / (select extract(epoch from (fin - ini)) from v), 2)
    from tramos where b > a;
$$;

-- 4. Puntaje del profesional: promedio de sus últimas 10 contrataciones calificadas
create or replace function public._calif_prof(p_prof uuid)
returns json language sql stable security definer set search_path = public as $$
  with u as (select nota, puntualidad, velocidad, desempeno from public.match_calificaciones
              where profesional_id = p_prof and nota is not null order by creado_en desc, id limit 10)
  select json_build_object(
    'promedio', (select public._estrellas_de(avg(nota)) from u),        -- estrellas (1 a 5, con fracción)
    'nota', (select round(avg(nota), 1) from u),                        -- de 0 a 10
    'puntualidad', (select round(avg(puntualidad), 1) from u),
    'velocidad', (select round(avg(velocidad), 1) from u),
    'desempeno', (select round(avg(desempeno), 1) from u),
    'ultimas', (select count(*) from u),
    'cantidad', (select count(*) from public.match_calificaciones where profesional_id = p_prof),
    'sostenido', public._puntaje_sostenido(p_prof));                    -- con esto se ordena la lista
$$;

create or replace function public._estrellas_prof(p_prof uuid)
returns numeric language sql stable security definer set search_path = public as $$
  select public._estrellas_de(avg(nota)) from (select nota from public.match_calificaciones
    where profesional_id = p_prof and nota is not null order by creado_en desc, id limit 10) u;
$$;

-- 5. Técnicos para el cliente: primero los de más puntaje sostenido (y el orden se arma antes de cortar en 60)
create or replace function public.profesionales_match(p_categoria smallint default null, p_departamento text default null)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(public._prof_publico(x.id) order by x.sostenido desc, x.verificado desc, x.id), '[]') from (
    select p.id, p.verificado, public._puntaje_sostenido(p.id) as sostenido
      from public.profesionales p join public.match_perfiles m on m.profesional_id = p.id and m.disponible
     where p.activo and (p_categoria is null or p_categoria = any(m.rubros))
       and (p_departamento is null or p_departamento = any(p.departamentos))
     order by 3 desc, p.verificado desc, p.id
     limit 60) x;
$$;

-- 6. Calificar al dar el visto bueno: 3 puntos de 0 a 10
create or replace function public.calificar(p_op uuid, p_puntualidad int, p_velocidad int, p_desempeno int, p_comentario text default null)
returns json language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones; v_nota numeric;
begin
  select * into op from public.match_operaciones where id = p_op;
  if op.id is null or op.cliente_id <> auth.uid() then raise exception 'No encontramos la operación'; end if;
  if op.estado = 'reserva_confirmada' then
    -- visto bueno con la calificación: también confirma que la visita se hizo (como confirmar_visita)
    if (select inicio from public.turnos where id = op.turno_id) > now() then raise exception 'La visita todavía no llegó'; end if;
    update public.turnos set estado = 'realizado' where id = op.turno_id and estado in ('pendiente', 'confirmado');
    update public.match_operaciones set realizado_en = coalesce(realizado_en, now()) where id = op.id;
    update public.match_solicitudes set estado = 'en_curso', actualizado_en = now() where id = op.solicitud_id and estado = 'reservada';
  elsif op.realizado_en is null or op.estado not in ('pendiente_confirmacion', 'pendiente_liquidacion', 'liquidado') then
    raise exception 'Se califica cuando la % está hecha', op.tipo;
  end if;
  if p_puntualidad is null or p_velocidad is null or p_desempeno is null
     or least(p_puntualidad, p_velocidad, p_desempeno) < 0 or greatest(p_puntualidad, p_velocidad, p_desempeno) > 10 then
    raise exception 'Calificá puntualidad, velocidad y desempeño de 0 a 10';
  end if;
  v_nota := round((p_puntualidad + p_velocidad + p_desempeno)::numeric / 3, 2);
  insert into public.match_calificaciones (operacion_id, tipo, cliente_id, profesional_id, puntaje, puntualidad, velocidad, desempeno, nota, comentario)
  values (op.id, op.tipo, op.cliente_id, op.profesional_id, greatest(1, least(5, round(v_nota / 2)))::smallint,
          p_puntualidad, p_velocidad, p_desempeno, v_nota, nullif(left(trim(coalesce(p_comentario, '')), 600), ''));
  if op.estado in ('pendiente_confirmacion', 'reserva_confirmada') then perform public._confirmar_operacion(op.id, 'cliente'); end if;
  perform public._evento(auth.uid(), 'califico_profesional', 'match');
  return json_build_object('nota', round(v_nota, 1), 'estrellas', public._estrellas_de(v_nota), 'profesional', public._calif_prof(op.profesional_id));
exception when unique_violation then raise exception 'Ya calificaste esta %', op.tipo;
end $$;

-- La de antes (1 a 5 estrellas) sigue andando: cada estrella vale 2 puntos en los 3
create or replace function public.calificar(p_op uuid, p_puntaje int, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_puntaje not between 1 and 5 then raise exception 'La calificación va de 1 a 5'; end if;
  perform public.calificar(p_op, p_puntaje * 2, p_puntaje * 2, p_puntaje * 2, p_comentario);
end $$;

-- Por WhatsApp (lo llama el servidor)
create or replace function public.wa_calificar(p_usuario uuid, p_op uuid, p_puntualidad int, p_velocidad int, p_desempeno int)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  return public.calificar(p_op, p_puntualidad, p_velocidad, p_desempeno, null);
end $$;


-- =====================================================================
-- 7. Donde se muestra la calificación: promedio de las últimas 10 y el detalle de cada una
-- =====================================================================

-- match_mi_perfil (de 19_match.sql)
create or replace function public.match_mi_perfil(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  return (select json_build_object(
    'disponible', coalesce(m.disponible, false), 'rubros', coalesce(m.rubros, '{}'), 'urgencias', coalesce(m.urgencias, false),
    'departamentos', p.departamentos, 'barrios', p.barrios, 'verificado', p.verificado,
    'tiene_horario', exists (select 1 from public.horarios_trabajo h where h.profesional_id = p.id),
    'cobro', case when p.id = auth.uid() then (select to_json(d) from public.match_datos_cobro d where d.profesional_id = p.id) end,
    'tiene_cobro', exists (select 1 from public.match_datos_cobro d where d.profesional_id = p.id),
    'comision_pct', public._comision_pct(p.id, null),
    'calificacion', public._calif_prof(p.id))
    from public.profesionales p left join public.match_perfiles m on m.profesional_id = p.id where p.id = p_cuenta);
end $$;

-- _compatibles (de 19_match.sql)
create or replace function public._compatibles(p_sol uuid)
returns table (profesional_id uuid) language sql stable security definer set search_path = public as $$
  with s as (select * from public.match_solicitudes where id = p_sol), c as (select * from public.configuracion where id = 1)
  select p.id
    from public.profesionales p
    join public.match_perfiles mp on mp.profesional_id = p.id and mp.disponible
    cross join s cross join c
   where p.activo and p.id <> s.cliente_id
     and s.categoria_id = any (mp.rubros)
     and s.departamento = any (p.departamentos)
     and (cardinality(p.barrios) = 0 or s.localidad is null
          or exists (select 1 from unnest(p.barrios) b where public.normalizar(b) = public.normalizar(s.localidad)))
     and (not c.solo_verificados or p.verificado)
     and s.dirigida_a is null
   order by public._puntaje_sostenido(p.id) desc, p.verificado desc,
            (s.urgente and mp.urgencias) desc, random()
   limit (select max_invitados from c);
$$;

-- _prof_publico (de 19_match.sql)
create or replace function public._prof_publico(p uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', pr.id, 'nombre', coalesce(nullif(pr.nombre_publico, ''), pe.nombre), 'bio', pr.bio, 'verificado', pr.verificado,
    'departamentos', pr.departamentos, 'slug', pr.slug,
    'calificacion', public._calif_prof(pr.id),
    'visitas', (select count(*) from public.match_operaciones where profesional_id = pr.id and tipo = 'visita' and realizado_en is not null),
    'rubros', (select coalesce(json_agg(k.nombre order by k.orden), '[]') from public.categorias k join public.match_perfiles m on k.id = any(m.rubros)
                where m.profesional_id = pr.id))
  from public.profesionales pr join public.perfiles pe on pe.id = pr.id where pr.id = p;
$$;

-- perfil_match (de 21_match_urgencias.sql)
create or replace function public.perfil_match(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('profesional', public._prof_publico(p_id),
    'disponible', coalesce((select disponible from public.match_perfiles where profesional_id = p_id), false),
    'urgencias', public._atiende_urgencias(p_id),
    'calificaciones', (select coalesce(json_agg(json_build_object('puntaje', k.puntaje, 'estrellas', public._estrellas_de(k.nota), 'nota', round(k.nota, 1), 'puntualidad', k.puntualidad, 'velocidad', k.velocidad, 'desempeno', k.desempeno, 'comentario', k.comentario, 'respuesta', k.respuesta,
         'tipo', k.tipo, 'fecha', k.creado_en, 'cliente', split_part(coalesce(nullif(pe.nombre, ''), 'Cliente'), ' ', 1)) order by k.creado_en desc), '[]')
       from (select * from public.match_calificaciones where profesional_id = p_id order by creado_en desc limit 30) k
       join public.perfiles pe on pe.id = k.cliente_id),
    'proximo', (select min(h.desde) from generate_series((now() at time zone 'America/Montevideo')::date,
                  (now() at time zone 'America/Montevideo')::date + 6, interval '1 day') g,
                  lateral public._horarios_match(p_id, g::date, (select duracion_visita_min from public.configuracion where id = 1)) h
                 where h.desde >= now() + interval '2 hours' and not h.urgencia))
  where exists (select 1 from public.profesionales where id = p_id and activo);
$$;

-- match_bandeja (de 19_match.sql)
create or replace function public.match_bandeja(p_cuenta uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  perform public.match_procesar_vencidos();
  perform public._evento(auth.uid(), 'consulto_solicitudes', 'match', p_cuenta);
  return json_build_object(
    'solicitudes', (select coalesce(json_agg(json_build_object('invitacion', i.id, 'estado', i.estado, 'creado_en', i.creado_en, 'vista_en', i.vista_en,
        'mensaje', i.mensaje, 'precio_visita', i.precio_visita, 'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo,
          'descripcion', s.descripcion, 'rubro', public._rubro(s.categoria_id), 'departamento', s.departamento, 'localidad', s.localidad,
          'preferencia', s.preferencia, 'urgente', s.urgente, 'archivos', s.archivos, 'estado', s.estado, 'dirigida', s.dirigida_a is not null))
        order by (i.estado = 'pendiente') desc, i.creado_en desc), '[]')
      from public.match_invitaciones i join public.match_solicitudes s on s.id = i.solicitud_id
     where i.profesional_id = p_cuenta and i.estado in ('pendiente', 'aceptada') and s.estado = 'abierta'),
    'visitas', (select coalesce(json_agg(public._op_profesional(o.id) order by t.inicio), '[]')
      from public.match_operaciones o left join public.turnos t on t.id = o.turno_id
     where o.profesional_id = p_cuenta and o.estado in ('reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
    'historial', (select coalesce(json_agg(public._op_profesional(o.id) order by o.creado_en desc), '[]')
      from (select * from public.match_operaciones where profesional_id = p_cuenta and estado in ('pendiente_liquidacion', 'liquidado', 'reembolsado', 'cancelado')
              and estado_pago <> 'vencido' order by creado_en desc limit 40) o),
    'cobros', json_build_object(
      'pendiente', (select coalesce(sum(liquidacion_monto), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion = 'pendiente'),
      'retenido', (select coalesce(sum(neto_profesional), 0) from public.match_operaciones where profesional_id = p_cuenta
                    and estado in ('reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
      'cobrado', (select coalesce(sum(monto), 0) from public.match_liquidaciones where profesional_id = p_cuenta),
      'retenciones', (select coalesce(sum(ret_profesional + comision), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion <> 'no_corresponde'),
      'costo_mp', (select coalesce(sum(mp_costo_profesional), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion <> 'no_corresponde'),
      'penalizaciones', (select coalesce(-sum(importe), 0) from public.match_movimientos where profesional_id = p_cuenta and tipo = 'penalizacion' and liquidacion_id is null),
      'liquidaciones', (select coalesce(json_agg(json_build_object('numero', l.numero, 'monto', l.monto, 'fecha', l.fecha, 'referencia', l.referencia,
                          'operaciones', l.operaciones) order by l.creado_en desc), '[]')
                         from (select * from public.match_liquidaciones where profesional_id = p_cuenta order by creado_en desc limit 24) l)),
    'calificaciones', (select coalesce(json_agg(json_build_object('id', k.id, 'puntaje', k.puntaje, 'estrellas', public._estrellas_de(k.nota), 'nota', round(k.nota, 1), 'puntualidad', k.puntualidad, 'velocidad', k.velocidad, 'desempeno', k.desempeno, 'comentario', k.comentario, 'respuesta', k.respuesta,
                          'tipo', k.tipo, 'fecha', k.creado_en) order by k.creado_en desc), '[]')
                        from (select * from public.match_calificaciones where profesional_id = p_cuenta order by creado_en desc limit 30) k),
    'perfil', public.match_mi_perfil(p_cuenta),
    'config', (select json_build_object('precio_visita', precio_visita, 'neto_visita', visita_neto_profesional, 'ret_profesional', visita_ret_profesional,
                 'mp_costo_profesional_pct', mp_costo_profesional_pct, 'liquidacion_dias', liquidacion_dias, 'confirmacion_auto_horas', confirmacion_auto_horas,
                 'comision_pct', public._comision_pct(p_cuenta, null), 'penalizacion', penalizacion_profesional) from public.configuracion where id = 1));
end $$;

-- _op_profesional (de 19_match.sql)
create or replace function public._op_profesional(p_op uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'estado', o.estado, 'estado_pago', o.estado_pago,
    'estado_liquidacion', o.estado_liquidacion, 'importe', o.importe, 'neto_profesional', o.neto_profesional, 'ret_profesional', o.ret_profesional,
    'comision', o.comision, 'mp_costo_profesional', o.mp_costo_profesional, 'liquidacion_monto', o.liquidacion_monto, 'reintegrado', o.reintegrado,
    'confirmar_hasta', o.confirmar_hasta, 'realizado_en', o.realizado_en, 'diagnostico', o.diagnostico, 'externa', o.externa, 'motivo', o.motivo,
    'creado_en', o.creado_en,
    'turno', (select json_build_object('id', t.id, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado) from public.turnos t where t.id = o.turno_id),
    'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo, 'descripcion', s.descripcion, 'rubro', public._rubro(s.categoria_id),
       'departamento', s.departamento, 'localidad', s.localidad, 'archivos', s.archivos, 'estado', s.estado,
       'direccion', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.direccion end,
       'referencia', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.referencia end,
       'lat', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.lat end,
       'lng', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.lng end),
    'cliente', case when o.estado_pago in ('pagado', 'reembolso_parcial') then
       (select json_build_object('nombre', coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1)), 'telefono', pe.telefono)
          from public.perfiles pe where pe.id = o.cliente_id) end,
    'reclamo', (select json_build_object('id', r.id, 'estado', r.estado, 'descripcion', r.descripcion, 'archivos', r.archivos,
                  'respuesta_profesional', r.respuesta_profesional, 'resolucion', r.resolucion)
                  from public.match_reclamos r where r.operacion_id = o.id order by r.creado_en desc limit 1),
    'calificacion', (select json_build_object('id', k.id, 'puntaje', k.puntaje, 'estrellas', public._estrellas_de(k.nota), 'nota', round(k.nota, 1), 'puntualidad', k.puntualidad, 'velocidad', k.velocidad, 'desempeno', k.desempeno, 'comentario', k.comentario, 'respuesta', k.respuesta)
                       from public.match_calificaciones k where k.operacion_id = o.id))
  from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id where o.id = p_op;
$$;

-- solicitud_cliente (de 24_cotizar_app.sql)
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
                      'calificacion', (select json_build_object('puntaje', k.puntaje, 'estrellas', public._estrellas_de(k.nota), 'nota', round(k.nota, 1), 'puntualidad', k.puntualidad, 'velocidad', k.velocidad, 'desempeno', k.desempeno, 'comentario', k.comentario, 'respuesta', k.respuesta)
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

-- wa_estado (de 23_whatsapp_cotizaciones.sql)
create or replace function public.wa_estado(p_usuario uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.match_solicitudes;
begin
  select * into s from public.match_solicitudes where cliente_id = p_usuario and canal = 'whatsapp'
   order by creado_en desc, numero desc limit 1;
  return json_build_object(
    'solicitud', case when s.id is not null then json_build_object('id', s.id, 'numero', s.numero, 'estado', s.estado, 'rubro', public._rubro(s.categoria_id),
                   'titulo', s.titulo, 'limite_toma', s.limite_toma, 'profesional', public._nombre_de(s.profesional_id), 'creado_en', s.creado_en) end,
    'operacion', (select json_build_object('id', o.id, 'numero', o.numero, 'estado', o.estado, 'importe', o.importe, 'vence', o.vence_pago_en,
                   'preferencia', o.mp_preferencia_id, 'profesional', public._nombre_de(o.profesional_id),
                   'inicio', (select inicio from public.turnos where id = o.turno_id), 'calificada',
                   exists (select 1 from public.match_calificaciones k where k.operacion_id = o.id))
                    from public.match_operaciones o where o.solicitud_id = s.id and o.tipo = 'visita'
                     and o.estado not in ('cancelado') order by o.creado_en desc limit 1),
    'cotizaciones', (select coalesce(json_agg(json_build_object('id', k.id, 'numero', k.numero, 'profesional', public._nombre_de(k.profesional_id),
                       'importe', k.importe, 'inicio', k.inicio, 'mensaje', k.mensaje,
                       'calificacion', public._estrellas_prof(k.profesional_id))
                       order by k.importe, k.inicio), '[]')
                       from public.match_cotizaciones k where k.solicitud_id = s.id and k.estado = 'pendiente' and k.inicio > now() + interval '15 minutes'
                        and s.estado = 'abierta' and s.profesional_id is null));
end $$;

-- 8. Permisos
do $$
begin
  revoke execute on function public.calificar(uuid, int, int, int, text) from public, anon;
  grant execute on function public.calificar(uuid, int, int, int, text) to authenticated, service_role;
  revoke execute on function public.wa_calificar(uuid, uuid, int, int, int) from public, anon, authenticated;
  grant execute on function public.wa_calificar(uuid, uuid, int, int, int) to service_role;
  grant execute on function public._estrellas_de(numeric), public._calif_prof(uuid), public._estrellas_prof(uuid), public._puntaje_sostenido(uuid, int) to anon, authenticated, service_role;
end $$;

notify pgrst, 'reload schema';

-- =====================================================================
-- LISTO.
-- =====================================================================

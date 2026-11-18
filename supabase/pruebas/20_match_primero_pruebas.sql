-- =====================================================================
--  TaListo!  ·  PRUEBAS de 20_match_primero.sql ("el primero disponible")
--  Crea clientes y técnicos de prueba (Pro, Free, Business con equipo),
--  pide visitas "el primero disponible", simula los pagos como los aplica
--  el servidor después de consultar a Mercado Pago y verifica: quién ve
--  qué en el mapa, que el primero gana, la hora de llegada, la dirección
--  oculta hasta tomarlo, devoluciones, vencimientos, pagos tardíos y que
--  el reparto de la visita no cambia.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('20000000-0000-0000-0000-0000000000c1', 'c1@primero.test', '{"rol":"cliente","nombre":"Carla Cliente"}'),
  ('20000000-0000-0000-0000-0000000000c2', 'c2@primero.test', '{"rol":"cliente","nombre":"Ciro Cliente"}'),
  ('20000000-0000-0000-0000-0000000000b1', 'b1@primero.test', '{"rol":"profesional","nombre":"Pablo Pro"}'),
  ('20000000-0000-0000-0000-0000000000b2', 'b2@primero.test', '{"rol":"profesional","nombre":"Fede Free"}'),
  ('20000000-0000-0000-0000-0000000000b3', 'b3@primero.test', '{"rol":"profesional","nombre":"Sara Sanitaria"}'),
  ('20000000-0000-0000-0000-0000000000b4', 'b4@primero.test', '{"rol":"profesional","nombre":"Pía Canelones"}'),
  ('20000000-0000-0000-0000-0000000000b5', 'b5@primero.test', '{"rol":"profesional","nombre":"Beto Sin Cuenta"}'),
  ('20000000-0000-0000-0000-0000000000e0', 'e0@primero.test', '{"rol":"profesional","nombre":"Empresa Eléctrica"}'),
  ('20000000-0000-0000-0000-0000000000e1', 'e1@primero.test', '{"rol":"cliente","nombre":"Mateo Match"}'),
  ('20000000-0000-0000-0000-0000000000e2', 'e2@primero.test', '{"rol":"cliente","nombre":"Oscar Operario"}'),
  ('20000000-0000-0000-0000-0000000000ad', 'ad@primero.test', '{"rol":"cliente","nombre":"Admin"}');
update public.perfiles set es_admin = true where id = '20000000-0000-0000-0000-0000000000ad';
update public.perfiles set telefono = '099111222' where id = '20000000-0000-0000-0000-0000000000c1';
update public.profesionales set departamentos = '{Montevideo}', activo = true where id::text like '20000000-%' and id::text not like '%b4';
update public.profesionales set departamentos = '{Canelones}', activo = true where id = '20000000-0000-0000-0000-0000000000b4';
insert into public.planes (usuario_id, plan, origen)
select u, p, 'regalo' from (values ('20000000-0000-0000-0000-0000000000b1'::uuid, 'pro'), ('20000000-0000-0000-0000-0000000000b3'::uuid, 'pro'),
  ('20000000-0000-0000-0000-0000000000b4'::uuid, 'pro'), ('20000000-0000-0000-0000-0000000000b5'::uuid, 'pro'),
  ('20000000-0000-0000-0000-0000000000e0'::uuid, 'business')) x(u, p)
on conflict (usuario_id) do update set plan = excluded.plan, origen = 'regalo', vence_en = null;
delete from public.planes where usuario_id = '20000000-0000-0000-0000-0000000000b2';
update public.configuracion set precio_visita = 1500, visita_ret_cliente = 200, visita_ret_profesional = 200, visita_neto_profesional = 1100,
  comision_visita = 400, mp_costo_profesional_pct = 50, duracion_visita_min = 60, pago_minutos = 30, solo_verificados = false,
  primero_activo = true, primero_horas = 4 where id = 1;
update public.match_tareas set ultima = null;
-- Con el SQL 21 (urgencias) se apaga la tarifa de urgencia: estas pruebas son de la visita normal
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'configuracion' and column_name = 'urgencia_activa') then
    execute 'update public.configuracion set urgencia_activa = false where id = 1';
  end if;
end $$;

-- Con el SQL 24 "el primero disponible" de la app se paga al tomar: estas pruebas son del cobro al publicar
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'configuracion' and column_name = 'primero_cobro_adelantado') then
    execute 'update public.configuracion set primero_cobro_adelantado = true where id = 1';
  end if;
end $$;
-- Perfiles Match: rubro electricidad (b1, b2 Free, b4 Canelones, b5 sin cuenta bancaria, e0 Business), b3 solo sanitaria
insert into public.match_perfiles (profesional_id, disponible, rubros)
select p, true, array[(select id from public.categorias where slug = case when p::text like '%b3' then 'sanitaria' else 'electricidad' end)]
  from unnest(array['20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2', '20000000-0000-0000-0000-0000000000b3',
                    '20000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000b5', '20000000-0000-0000-0000-0000000000e0']::uuid[]) p
on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros;
insert into public.match_datos_cobro (profesional_id, banco, numero, titular)
select p, 'BROU', '001234567', 'Titular' from unnest(array['20000000-0000-0000-0000-0000000000b1', '20000000-0000-0000-0000-0000000000b2',
  '20000000-0000-0000-0000-0000000000b3', '20000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000e0']::uuid[]) p
on conflict (profesional_id) do nothing;

do $$
declare e uuid; rm uuid; ro uuid; m1 uuid; m2 uuid;
begin
  insert into public.empresas (dueno_id, nombre) values ('20000000-0000-0000-0000-0000000000e0', 'Empresa Eléctrica') returning id into e;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Match', array['match']) returning id into rm;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Operario', array['agenda']) returning id into ro;
  insert into public.miembros (empresa_id, usuario_id) values (e, '20000000-0000-0000-0000-0000000000e1') returning id into m1;
  insert into public.miembros (empresa_id, usuario_id) values (e, '20000000-0000-0000-0000-0000000000e2') returning id into m2;
  insert into public.miembros_roles values (m1, rm), (m2, ro);
end $$;

create function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.yo() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;
create function pg_temp.paso(nombre text) returns void language plpgsql as $$
begin
  perform set_config('pruebas.n', (coalesce(nullif(current_setting('pruebas.n', true), ''), '0')::int + 1)::text, true);
  raise notice 'OK %', nombre;
end $$;
create function pg_temp.pago(op uuid, pid text, monto numeric, fee numeric) returns text language plpgsql as $$
begin
  return public.match_aplicar_pago(op, jsonb_build_object('id', pid, 'status', 'approved', 'transaction_amount', monto, 'currency_id', 'UYU',
           'external_reference', 'match:' || op, 'fee', fee, 'date_approved', now())) ->> 'resultado';
end $$;
-- Un pedido "el primero disponible" de electricidad para mañana (cualquier horario); devuelve { id, operacion }
create function pg_temp.pedido(cli uuid, titulo text, extra jsonb default '{}') returns json language plpgsql as $$
declare r json;
begin
  perform pg_temp.como(cli);
  r := public.crear_solicitud(jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'electricidad'),
         'titulo', titulo, 'descripcion', 'No anda el disyuntor y salta todo el tiempo', 'departamento', 'Montevideo',
         'localidad', 'Pocitos', 'direccion', 'Av. Brasil 2500 apto 3', 'lat', -34.9123456, 'lng', -56.1567891,
         'modo', 'primero', 'cuando', 'dia', 'fecha', public._hoy_uy() + 1, 'franja', 'cualquiera',
         'archivos', jsonb_build_array(cli || '/solicitudes/foto1.jpg')) || extra);
  perform pg_temp.yo();
  return r;
end $$;
create function pg_temp.manana(h int) returns timestamptz language sql as $$
  select ((public._hoy_uy() + 1) + make_time(h, 0, 0)) at time zone 'America/Montevideo';
$$;

-- ---------------------------------------------------------------- 1. Publicar: se paga primero, nadie lo ve hasta pagar
do $$
declare c1 uuid := '20000000-0000-0000-0000-0000000000c1'; r json; op public.match_operaciones; s public.match_solicitudes; ok boolean; j json;
begin
  r := pg_temp.pedido(c1, 'Disyuntor que salta');
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  select * into s from public.match_solicitudes where id = (r ->> 'id')::uuid;
  assert op.id is not null and op.profesional_id is null and op.estado = 'pendiente_pago' and op.importe = 1500
     and op.ret_cliente = 200 and op.ret_profesional = 200 and op.neto_profesional = 1100, '1.1 La operación debía quedar a pagar, sin técnico y con el reparto de siempre';
  assert s.modo = 'primero' and s.publicada_en is null and (select count(*) from public.match_invitaciones where solicitud_id = s.id) = 0,
     '1.2 No se invita a nadie ni se publica antes de pagar';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  j := public.servicios_disponibles('20000000-0000-0000-0000-0000000000b1');
  perform pg_temp.yo();
  assert json_array_length(j -> 'servicios') = 0, '1.3 Sin pagar no aparece en el mapa';
  -- validaciones
  begin perform pg_temp.pedido(c1, 'Sin mapa', '{"lat": null, "lng": null}'); ok := false;
  exception when others then perform pg_temp.yo(); ok := sqlerrm like '%marcala en el mapa%'; end;
  assert ok, '1.4 Sin la ubicación en el mapa no se puede publicar';
  begin perform pg_temp.pedido(c1, 'Con profesional', jsonb_build_object('dirigida_a', '20000000-0000-0000-0000-0000000000b1')); ok := false;
  exception when others then perform pg_temp.yo(); ok := sqlerrm like '%no puede ser "el primero disponible"%'; end;
  assert ok, '1.5 Si elige un profesional, no es "el primero disponible"';
  begin perform pg_temp.pedido(c1, 'Jardín', jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'jardineria'))); ok := false;
  exception when others then perform pg_temp.yo(); ok := sqlerrm like 'Por ahora no hay técnicos de ese rubro%'; end;
  assert ok, '1.6 Sin técnicos Pro o Business del rubro no se cobra nada';
  begin perform pg_temp.pedido(c1, 'Ayer', jsonb_build_object('fecha', public._hoy_uy() - 1)); ok := false;
  exception when others then perform pg_temp.yo(); ok := sqlerrm like 'Elegí un día%'; end;
  assert ok, '1.7 No se puede pedir para un día que ya pasó';
  -- "hoy": hasta las 19
  begin
    perform pg_temp.pedido(c1, 'Hoy', '{"cuando": "hoy", "fecha": null, "franja": null}');
    ok := (now() at time zone 'America/Montevideo')::time < time '19:00';
  exception when others then perform pg_temp.yo(); ok := sqlerrm like 'Para hoy ya es tarde%' and (now() at time zone 'America/Montevideo')::time >= time '19:00'; end;
  assert ok, '1.8 "Hoy, lo antes posible" se acepta hasta las 19';
  perform pg_temp.paso('1. publicar: se paga primero, validaciones y nadie lo ve antes de pagar');
end $$;

-- ---------------------------------------------------------------- 2. Pago: sale al mapa y avisa a los técnicos del departamento
do $$
declare op uuid; s public.match_solicitudes; o public.match_operaciones;
begin
  select id into op from public.match_operaciones o2 where cliente_id = '20000000-0000-0000-0000-0000000000c1' and estado = 'pendiente_pago'
    and (select titulo from public.match_solicitudes where id = o2.solicitud_id) = 'Disyuntor que salta';
  assert pg_temp.pago(op, 'mp-p1', 1500, 110) = 'aplicado', '2.1 El pago debía aplicarse';
  assert pg_temp.pago(op, 'mp-p1', 1500, 110) = 'ya_aplicado', '2.2 El mismo aviso de Mercado Pago no se aplica dos veces';
  select * into o from public.match_operaciones where id = op;
  select * into s from public.match_solicitudes where id = o.solicitud_id;
  assert o.estado = 'buscando_tecnico' and o.estado_pago = 'pagado' and o.profesional_id is null and o.mp_costo = 110
     and o.mp_costo_profesional = 55, '2.3 Pagado y buscando técnico, con el costo de Mercado Pago repartido';
  assert s.publicada_en is not null and s.limite_toma = pg_temp.manana(19) - interval '1 hour', format('2.4 Límite para tomarlo: %s', s.limite_toma);
  assert exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000b1' and titulo like 'Servicio disponible%'),
     '2.5 El técnico de Montevideo recibe el aviso';
  assert not exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000b4' and titulo like 'Servicio disponible%'),
     '2.6 A los de otro departamento no se les avisa (igual lo ven en el mapa)';
  assert not exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000b2' and titulo like 'Servicio disponible%'),
     '2.7 Un Free no recibe el aviso';
  assert exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000c1' and titulo like 'Pago confirmado: tu pedido ya está en el mapa'),
     '2.8 El cliente recibe la confirmación';
  perform pg_temp.paso('2. pago confirmado: al mapa, avisos y sin aplicar dos veces');
end $$;

-- ---------------------------------------------------------------- 3. Quién lo ve en el mapa y qué ve
do $$
declare j json; x json; ok boolean; ruta text := '20000000-0000-0000-0000-0000000000c1/solicitudes/foto1.jpg';
begin
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  j := public.servicios_disponibles('20000000-0000-0000-0000-0000000000b1');
  assert public.ve_archivo_match(ruta), '3.1 El técnico que lo puede tomar ve las fotos';
  perform pg_temp.yo();
  assert json_array_length(j -> 'servicios') = 1, '3.2 El Pro del rubro lo ve';
  x := j -> 'servicios' -> 0;
  assert (x ->> 'lat')::numeric = -34.91 and (x ->> 'lng')::numeric = -56.16, format('3.3 Zona aproximada: %s %s', x ->> 'lat', x ->> 'lng');
  assert x::jsonb ? 'direccion' is false and x::jsonb ? 'referencia' is false and x::text not like '%Brasil%' and x::text not like '%099111222%',
     '3.4 Antes de tomarlo no se ve la dirección ni el teléfono';
  assert (x ->> 'neto')::numeric = 1100 and x ->> 'cuando' = 'dia', '3.5 Ve lo que cobra y para cuándo es';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b4');
  assert json_array_length(public.servicios_disponibles('20000000-0000-0000-0000-0000000000b4') -> 'servicios') = 1, '3.6 Un Pro del rubro de otro departamento también lo ve';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b2');
  j := public.servicios_disponibles('20000000-0000-0000-0000-0000000000b2');
  assert not (j ->> 'plan_ok')::boolean and json_array_length(j -> 'servicios') = 0, '3.7 Un Free no lo ve (se le ofrece pasar a Pro)';
  assert not public.ve_archivo_match(ruta), '3.8 Un Free no ve las fotos';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b3');
  assert json_array_length(public.servicios_disponibles('20000000-0000-0000-0000-0000000000b3') -> 'servicios') = 0, '3.9 Otro rubro no lo ve';
  assert not public.ve_archivo_match(ruta), '3.10 Otro rubro no ve las fotos';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b5');
  j := public.servicios_disponibles('20000000-0000-0000-0000-0000000000b5');
  assert json_array_length(j -> 'servicios') = 0 and not (j ->> 'cobro_ok')::boolean, '3.11 Sin cuenta bancaria no lo ve y se le dice por qué';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000e1');
  assert json_array_length(public.servicios_disponibles('20000000-0000-0000-0000-0000000000e0') -> 'servicios') = 1, '3.12 En Business lo ve quien tiene el permiso Match';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000e2');
  begin perform public.servicios_disponibles('20000000-0000-0000-0000-0000000000e0'); ok := false; exception when others then ok := true; end;
  assert ok, '3.13 Un operario sin permiso Match no lo ve';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000c2');
  begin perform public.servicios_disponibles('20000000-0000-0000-0000-0000000000b1'); ok := false; exception when others then ok := true; end;
  assert ok, '3.14 Un cliente no puede ver el mapa de servicios de otra cuenta';
  assert not exists (select 1 from public.match_solicitudes where modo = 'primero'), '3.15 Un cliente no lee pedidos ajenos';
  perform pg_temp.yo();
  perform pg_temp.paso('3. mapa: lo ven solo Pro y Business del rubro con Match y cuenta bancaria; zona aproximada y sin datos privados');
end $$;

-- ---------------------------------------------------------------- 4. Tomarlo: el primero gana y elige la hora dentro de lo pedido
do $$
declare sid uuid; ok boolean; r json; o public.match_operaciones; t public.turnos; j json;
begin
  select id into sid from public.match_solicitudes where titulo = 'Disyuntor que salta';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  begin perform public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000b1', pg_temp.manana(19)); ok := false;
  exception when others then ok := sqlerrm like 'Elegí una hora de llegada dentro de lo que pidió el cliente%'; end;
  assert ok, '4.1 No se puede llegar fuera de la franja (19:00 + 1 h de visita se pasa)';
  begin perform public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000b1', pg_temp.manana(7)); ok := false;
  exception when others then ok := sqlerrm like 'Elegí una hora de llegada%'; end;
  assert ok, '4.2 Ni antes de la franja';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b2');
  begin perform public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000b2', pg_temp.manana(10)); ok := false;
  exception when others then ok := sqlerrm like 'Para tomar servicios necesitás plan Pro o Business%'; end;
  assert ok, '4.3 Un Free no lo puede tomar';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  r := public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000b1', pg_temp.manana(10));
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b4');
  begin perform public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000b4', pg_temp.manana(11)); ok := false;
  exception when others then ok := sqlerrm = 'Otro técnico ya tomó este servicio'; end;
  assert ok, '4.4 El segundo que lo quiere tomar no puede: el primero gana';
  perform pg_temp.yo();
  select * into o from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  select * into t from public.turnos where id = o.turno_id;
  assert o.profesional_id = '20000000-0000-0000-0000-0000000000b1' and o.estado = 'reserva_confirmada' and o.importe = 1500 and o.neto_profesional = 1100,
     '4.5 La visita queda confirmada para el que la tomó, con el mismo reparto';
  assert t.profesional_id = o.profesional_id and t.estado = 'confirmado' and t.inicio = pg_temp.manana(10) and t.cliente_id is not null and t.direccion_id is not null,
     '4.6 Entra a su agenda con el cliente y la dirección';
  assert (select estado = 'reservada' and tomada_por = '20000000-0000-0000-0000-0000000000b1' from public.match_solicitudes where id = sid), '4.7 El pedido queda reservado';
  assert exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000c1' and titulo = 'Un técnico tomó tu pedido'),
     '4.8 Se avisa al cliente quién va y cuándo';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  j := public.match_bandeja('20000000-0000-0000-0000-0000000000b1');
  perform pg_temp.yo();
  assert exists (select 1 from json_array_elements(j -> 'visitas') v where v -> 'solicitud' ->> 'direccion' = 'Av. Brasil 2500 apto 3'
                   and v -> 'cliente' ->> 'telefono' = '099111222'), '4.9 Después de tomarlo ve la dirección y el teléfono';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b4');
  assert json_array_length(public.servicios_disponibles('20000000-0000-0000-0000-0000000000b4') -> 'servicios') = 0, '4.10 Ya no está en el mapa de los demás';
  perform pg_temp.yo();
  perform pg_temp.paso('4. tomarlo: el primero gana, hora dentro de lo pedido, agenda, dirección recién al tomarlo');
end $$;

-- ---------------------------------------------------------------- 5. Business: lo toma alguien del equipo y queda asignado a él
do $$
declare r json; sid uuid; ok boolean;
begin
  r := pg_temp.pedido('20000000-0000-0000-0000-0000000000c2', 'Tomacorriente quemado');
  sid := (r ->> 'id')::uuid;
  perform pg_temp.pago((r ->> 'operacion')::uuid, 'mp-p2', 1500, 110);
  perform pg_temp.como('20000000-0000-0000-0000-0000000000e2');
  begin perform public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000e0', pg_temp.manana(15)); ok := false; exception when others then ok := true; end;
  assert ok, '5.1 El operario sin permiso Match no lo puede tomar';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000e1');
  r := public.tomar_servicio(sid, '20000000-0000-0000-0000-0000000000e0', pg_temp.manana(15));
  perform pg_temp.yo();
  assert (select profesional_id = '20000000-0000-0000-0000-0000000000e0' and asignado_a = '20000000-0000-0000-0000-0000000000e1'
            from public.turnos where id = (r ->> 'turno')::uuid), '5.2 La visita es de la empresa y queda asignada a quien la tomó';
  perform pg_temp.paso('5. Business: lo toma alguien del equipo con permiso Match y queda asignado');
end $$;

-- ---------------------------------------------------------------- 6. Cancelar antes de que lo tomen: se devuelve todo
do $$
declare r json; o public.match_operaciones; d public.match_devoluciones;
begin
  r := pg_temp.pedido('20000000-0000-0000-0000-0000000000c1', 'Cambio de opinión');
  perform pg_temp.pago((r ->> 'operacion')::uuid, 'mp-p3', 1500, 110);
  perform pg_temp.como('20000000-0000-0000-0000-0000000000c1');
  perform public.cancelar_solicitud((r ->> 'id')::uuid, 'Lo arreglé solo');
  perform pg_temp.yo();
  select * into o from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  select * into d from public.match_devoluciones where operacion_id = o.id;
  assert o.estado = 'cancelado' and d.monto = 1500 and d.estado = 'pendiente' and d.origen = 'cliente', '6.1 Queda la devolución total para que la apruebe el admin';
  assert (select estado = 'cancelada' from public.match_solicitudes where id = (r ->> 'id')::uuid), '6.2 El pedido queda cancelado';
  perform public.match_devolucion_resultado(d.id, true, 'ref-1');
  assert (select estado = 'reembolsado' and estado_pago = 'reembolsado' and reintegrado = 1500 from public.match_operaciones where id = o.id),
     '6.3 Cuando Mercado Pago devuelve, la operación queda reembolsada';
  perform pg_temp.paso('6. cancelar antes de que lo tomen: devolución total aprobada por el admin');
end $$;

-- ---------------------------------------------------------------- 7. Nadie lo tomó a tiempo
do $$
declare r json; o public.match_operaciones;
begin
  r := pg_temp.pedido('20000000-0000-0000-0000-0000000000c1', 'Nadie vino');
  perform pg_temp.pago((r ->> 'operacion')::uuid, 'mp-p4', 1500, 110);
  update public.match_solicitudes set limite_toma = now() - interval '1 minute' where id = (r ->> 'id')::uuid;
  update public.match_tareas set ultima = null;
  perform public.match_procesar_vencidos();
  select * into o from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert o.estado = 'cancelado' and exists (select 1 from public.match_devoluciones where operacion_id = o.id and origen = 'sin_tecnico' and monto = 1500),
     '7.1 Se devuelve todo (para aprobar)';
  assert (select estado = 'vencida' from public.match_solicitudes where id = (r ->> 'id')::uuid), '7.2 El pedido vence';
  assert exists (select 1 from public.notificaciones where usuario_id = '20000000-0000-0000-0000-0000000000c1' and titulo = 'Ningún técnico pudo tomar tu pedido'),
     '7.3 Se avisa al cliente';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  begin perform public.tomar_servicio((r ->> 'id')::uuid, '20000000-0000-0000-0000-0000000000b1', pg_temp.manana(16)); assert false, '7.4';
  exception when assert_failure then raise; when others then null; end;
  perform pg_temp.yo();
  perform pg_temp.paso('7. vencido sin técnico: devolución total, aviso y ya no se puede tomar');
end $$;

-- ---------------------------------------------------------------- 8. Pagar más tarde, pagar de nuevo y pagos tardíos
do $$
declare r json; op1 uuid; op2 uuid; ok boolean;
begin
  r := pg_temp.pedido('20000000-0000-0000-0000-0000000000c2', 'Pago tardío');
  op1 := (r ->> 'operacion')::uuid;
  update public.match_operaciones set vence_pago_en = now() - interval '1 minute' where id = op1;
  update public.match_tareas set ultima = null;
  perform public.match_procesar_vencidos();
  -- llegó el pago aprobado de la operación vencida y no hay otra: se aplica igual (no había turno que perder)
  assert pg_temp.pago(op1, 'mp-p5', 1500, 110) = 'aplicado', '8.1 Un pago tardío sin otra operación se aplica';
  assert (select estado = 'buscando_tecnico' from public.match_operaciones where id = op1), '8.2 Y sale al mapa';
  -- otro pedido: vence sin pagar, el cliente paga de nuevo (nueva operación) y después llega el pago viejo
  r := pg_temp.pedido('20000000-0000-0000-0000-0000000000c2', 'Doble intento');
  op1 := (r ->> 'operacion')::uuid;
  update public.match_operaciones set vence_pago_en = now() - interval '1 minute' where id = op1;
  perform pg_temp.como('20000000-0000-0000-0000-0000000000c2');
  op2 := (public.pagar_primero((r ->> 'id')::uuid) ->> 'operacion')::uuid;
  assert op2 <> op1, '8.3 Pagar de nuevo crea otra operación';
  assert (public.pagar_primero((r ->> 'id')::uuid) ->> 'operacion')::uuid = op2, '8.4 Mientras no vence, reusa la misma';
  perform pg_temp.yo();
  assert (select count(*) from public.match_operaciones where solicitud_id = (r ->> 'id')::uuid and estado not in ('cancelado', 'reembolsado')) = 1,
     '8.5 Hay una sola operación viva por pedido';
  assert pg_temp.pago(op2, 'mp-p6', 1500, 110) = 'aplicado', '8.6 Se paga la nueva';
  assert pg_temp.pago(op1, 'mp-p7', 1500, 110) = 'pago_tardio', '8.7 El pago viejo que llega después se devuelve';
  assert exists (select 1 from public.match_devoluciones where operacion_id = op1 and origen = 'pago_tardio'), '8.8 Queda la devolución del pago viejo';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000c2');
  begin perform public.pagar_primero((r ->> 'id')::uuid); ok := false; exception when others then ok := true; end;
  perform pg_temp.yo();
  assert ok, '8.9 Un pedido ya pago no se vuelve a cobrar';
  perform pg_temp.paso('8. pagar más tarde, pagar de nuevo y pagos tardíos sin cobrar dos veces');
end $$;

-- ---------------------------------------------------------------- 9. La visita sigue igual: confirmación y liquidación de siempre
do $$
declare o public.match_operaciones;
begin
  select * into o from public.match_operaciones o2 where o2.profesional_id = '20000000-0000-0000-0000-0000000000b1'
    and (select titulo from public.match_solicitudes where id = o2.solicitud_id) = 'Disyuntor que salta';
  update public.turnos set inicio = now() - interval '3 hours', fin = now() - interval '2 hours' where id = o.turno_id;
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  perform public.visita_realizada(o.id, 'Cambié el disyuntor');
  perform pg_temp.como('20000000-0000-0000-0000-0000000000c1');
  perform public.confirmar_visita(o.id);
  perform pg_temp.yo();
  select * into o from public.match_operaciones where id = o.id;
  assert o.estado = 'pendiente_liquidacion' and o.liquidacion_monto = 1100 - 55 and o.ingreso_talisto = 400 - 55,
     format('9.1 Se liquida igual que una visita elegida: %s al técnico, %s TaListo!', o.liquidacion_monto, o.ingreso_talisto);
  assert o.importe = o.ret_cliente + o.ret_profesional + o.comision + o.neto_profesional, '9.2 El reparto cuadra';
  perform pg_temp.paso('9. la visita tomada se confirma y liquida igual: $ 1.045 al técnico y $ 345 TaListo!');
end $$;

-- ---------------------------------------------------------------- 10. Solo el admin lo activa o desactiva
do $$
declare ok boolean; cfg jsonb;
begin
  cfg := (select to_jsonb(c) from public.configuracion c where id = 1) || '{"primero_activo": false}';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000b1');
  begin perform public.guardar_config_match(cfg); ok := false; exception when others then ok := true; end;
  assert ok, '10.1 Un técnico no puede cambiar la configuración';
  perform pg_temp.como('20000000-0000-0000-0000-0000000000ad');
  perform public.guardar_config_match(cfg);
  perform pg_temp.yo();
  begin perform pg_temp.pedido('20000000-0000-0000-0000-0000000000c1', 'Desactivado'); ok := false;
  exception when others then perform pg_temp.yo(); ok := sqlerrm like '%no está activa%'; end;
  assert ok, '10.2 Con la opción desactivada no se puede pedir';
  assert exists (select 1 from public.config_historial where campo = 'primero_activo' and valor_nuevo = 'false'), '10.3 El cambio queda en el historial';
  perform pg_temp.paso('10. solo el admin activa o desactiva "el primero disponible", con historial');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 10 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n', true);
end $$;
rollback;

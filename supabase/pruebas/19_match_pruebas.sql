-- =====================================================================
--  TaListo!  ·  PRUEBAS de 19_match.sql (TaListo! Match, etapa 1)
--  Crea clientes, profesionales, una empresa y un admin de prueba, y
--  recorre el circuito real: solicitud → profesionales compatibles →
--  aceptar → elegir horario → pago (como lo aplica el servidor con el
--  pago consultado a Mercado Pago) → visita → confirmación → liquidación,
--  con devoluciones, reclamos, cancelaciones, permisos y aislamiento.
--
--  NO GUARDA NADA: termina con "PRUEBAS OK" (sale como error a propósito
--  para deshacer todo). Si algo falla, el mensaje dice qué prueba fue.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- datos de prueba
-- C1, C2: clientes · P1, P2: electricistas en Montevideo · P3: sanitario · P4: electricista en Canelones
-- E: empresa (cuenta) con M (rol Match) y O (operario) · ADM: administrador de TaListo!
insert into auth.users (id, email, raw_user_meta_data) values
  ('19000000-0000-0000-0000-0000000000c1', 'c1@talisto.test', '{"rol":"cliente","nombre":"Carla Cliente"}'),
  ('19000000-0000-0000-0000-0000000000c2', 'c2@talisto.test', '{"rol":"cliente","nombre":"Ciro Cliente"}'),
  ('19000000-0000-0000-0000-0000000000b1', 'p1@talisto.test', '{"rol":"profesional","nombre":"Pablo Electricista"}'),
  ('19000000-0000-0000-0000-0000000000b2', 'p2@talisto.test', '{"rol":"profesional","nombre":"Paula Electricista"}'),
  ('19000000-0000-0000-0000-0000000000b3', 'p3@talisto.test', '{"rol":"profesional","nombre":"Pedro Sanitario"}'),
  ('19000000-0000-0000-0000-0000000000b4', 'p4@talisto.test', '{"rol":"profesional","nombre":"Pía Canelones"}'),
  ('19000000-0000-0000-0000-0000000000e0', 'e@talisto.test', '{"rol":"profesional","nombre":"Empresa Eléctrica"}'),
  ('19000000-0000-0000-0000-0000000000e1', 'm@talisto.test', '{"rol":"cliente","nombre":"Marta Match"}'),
  ('19000000-0000-0000-0000-0000000000e2', 'o@talisto.test', '{"rol":"cliente","nombre":"Oscar Operario"}'),
  ('19000000-0000-0000-0000-0000000000ad', 'adm@talisto.test', '{"rol":"cliente","nombre":"Admin TaListo"}');
update public.perfiles set es_admin = true where id = '19000000-0000-0000-0000-0000000000ad';
update public.perfiles set telefono = '099123456' where id = '19000000-0000-0000-0000-0000000000c1';
update public.profesionales set departamentos = '{Montevideo}', activo = true
 where id in ('19000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-0000000000b2', '19000000-0000-0000-0000-0000000000b3',
              '19000000-0000-0000-0000-0000000000e0');
update public.profesionales set departamentos = '{Canelones}' where id = '19000000-0000-0000-0000-0000000000b4';
insert into public.planes (usuario_id, plan, origen) values ('19000000-0000-0000-0000-0000000000e0', 'business', 'regalo')
on conflict (usuario_id) do update set plan = 'business', origen = 'regalo', vence_en = null;
insert into public.horarios_trabajo (profesional_id, dia, hora_inicio, hora_fin)
select p, d, '08:00', '20:00' from unnest(array['19000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-0000000000b2',
                                              '19000000-0000-0000-0000-0000000000e0']::uuid[]) p, generate_series(0, 6) d;
update public.configuracion set precio_visita = 1500, visita_ret_cliente = 200, visita_ret_profesional = 200, visita_neto_profesional = 1100,
  comision_visita = 400, mp_costo_profesional_pct = 50, cancelacion_horas = 24, cancelacion_tarde_pct = 0, penalizacion_profesional = 0,
  confirmacion_auto_horas = 72, max_invitados = 10, solo_verificados = false where id = 1;
update public.match_tareas set ultima = null;

do $$
declare e uuid; rm uuid; ro uuid; m1 uuid; m2 uuid;
begin
  insert into public.empresas (dueno_id, nombre) values ('19000000-0000-0000-0000-0000000000e0', 'Empresa Eléctrica') returning id into e;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Match', array['match']) returning id into rm;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Operario', array['agenda']) returning id into ro;
  insert into public.miembros (empresa_id, usuario_id) values (e, '19000000-0000-0000-0000-0000000000e1') returning id into m1;
  insert into public.miembros (empresa_id, usuario_id) values (e, '19000000-0000-0000-0000-0000000000e2') returning id into m2;
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
-- El servidor aplica un pago ya consultado a Mercado Pago
create function pg_temp.pago(op uuid, pid text, monto numeric, fee numeric, st text default 'approved') returns text language plpgsql as $$
begin
  return public.match_aplicar_pago(op, jsonb_build_object('id', pid, 'status', st, 'transaction_amount', monto, 'currency_id', 'UYU',
           'external_reference', 'match:' || op, 'fee', fee, 'date_approved', now())) ->> 'resultado';
end $$;
-- Un horario libre del profesional que aceptó (como lo ve el cliente)
create function pg_temp.horario(inv uuid, k int default 0) returns timestamptz language plpgsql as $$
begin
  return (public.horarios_visita(inv, null, 7) ->> k)::timestamptz;
end $$;
-- Una solicitud de electricidad del cliente, aceptada por P1; devuelve la invitación de P1
create function pg_temp.solicitud_aceptada(cli uuid, titulo text) returns uuid language plpgsql as $$
declare s uuid; i uuid;
begin
  perform pg_temp.como(cli);
  s := (public.crear_solicitud(jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'electricidad'),
          'titulo', titulo, 'descripcion', 'Salta la llave general cuando prendo el horno', 'departamento', 'Montevideo',
          'localidad', 'Pocitos', 'direccion', 'Av. Brasil 2500 apto 3')) ->> 'id')::uuid;
  perform pg_temp.yo();
  select id into i from public.match_invitaciones where solicitud_id = s and profesional_id = '19000000-0000-0000-0000-0000000000b1';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.responder_invitacion(i, true, 'Puedo ir esta semana');
  perform pg_temp.yo();
  return i;
end $$;
-- Elegir P1, pagar y dejar la visita en el pasado (para poder marcarla hecha)
create function pg_temp.visita_paga(cli uuid, titulo text, pid text, fee numeric default 90) returns uuid language plpgsql as $$
declare i uuid; op uuid; t timestamptz;
begin
  i := pg_temp.solicitud_aceptada(cli, titulo);
  perform pg_temp.como(cli);
  t := pg_temp.horario(i);
  op := (public.elegir_profesional(i, t) ->> 'operacion')::uuid;
  perform pg_temp.yo();
  perform pg_temp.pago(op, pid, 1500, fee);
  return op;
end $$;
create function pg_temp.al_pasado(op uuid, h int default 3) returns void language plpgsql as $$
begin
  update public.turnos set inicio = now() - make_interval(hours => h), fin = now() - make_interval(hours => h - 1)
   where id = (select turno_id from public.match_operaciones where id = op);
end $$;

-- ---------------------------------------------------------------- 1. Configuración comercial: solo el admin
do $$
declare ok boolean; h record; n int;
begin
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  begin perform public.guardar_config_match('{"trabajo_comision_pct": 1}'); ok := false; exception when others then ok := sqlerrm like 'Solo el administrador%'; end;
  assert ok, '1.1 Un profesional no puede cambiar la comisión';
  update public.configuracion set precio_visita = 1 where id = 1;
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  update public.configuracion set visita_neto_profesional = 1499 where id = 1;
  perform pg_temp.yo();
  assert (select precio_visita = 1500 and visita_neto_profesional = 1100 from public.configuracion where id = 1),
     '1.2 Ni el profesional ni el cliente pueden tocar importes directo en la base';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  begin perform public.guardar_config_match('{"visita_neto_profesional": 1200}'); ok := false; exception when others then ok := sqlerrm like 'El reparto no coincide%'; end;
  assert ok, '1.3 El reparto de la visita tiene que sumar el precio';
  perform public.guardar_config_match('{"trabajo_comision_pct": 6}');
  perform pg_temp.yo();
  select * into h from public.config_historial where campo = 'trabajo_comision_pct' order by id desc limit 1;
  assert h.valor_anterior = '5.00' and h.valor_nuevo = '6.00' and h.admin_id = '19000000-0000-0000-0000-0000000000ad' and h.admin_nombre = 'Admin TaListo',
     '1.4 El cambio queda en el historial con quién, el valor anterior y el nuevo';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  perform public.guardar_config_match('{"trabajo_comision_pct": 5}');
  -- comisión especial por empresa y por rubro
  perform public.guardar_comision_especial(null, 'cuenta', null, '19000000-0000-0000-0000-0000000000e0', 3, true, 'Acuerdo de lanzamiento');
  perform public.guardar_comision_especial(null, 'rubro', (select id from public.categorias where slug = 'electricidad'), null, 7, true);
  perform pg_temp.yo();
  assert public._comision_pct('19000000-0000-0000-0000-0000000000e0', null) = 3, '1.5 La excepción de la empresa manda';
  assert public._comision_pct('19000000-0000-0000-0000-0000000000b1', (select id from public.categorias where slug = 'electricidad')) = 5,
     '1.6 La comisión por rubro solo vale si se habilita';
  update public.configuracion set comision_por_rubro = true where id = 1;
  assert public._comision_pct('19000000-0000-0000-0000-0000000000b1', (select id from public.categorias where slug = 'electricidad')) = 7,
     '1.7 Con la comisión por rubro habilitada, aplica la del rubro';
  update public.configuracion set comision_por_rubro = false, trabajo_comision_activa = false where id = 1;
  assert public._comision_pct('19000000-0000-0000-0000-0000000000e0', null) = 0, '1.8 Con la comisión desactivada no se cobra';
  update public.configuracion set trabajo_comision_activa = true where id = 1;
  select count(*) into n from public.config_historial where ambito = 'comision';
  assert n = 2, '1.9 Las comisiones especiales también quedan en el historial';
  -- rubros: el admin crea, edita y ordena
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  perform public.guardar_rubro(null, 'Domótica', array['casa inteligente'], true);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  begin perform public.guardar_rubro(null, 'Otro rubro', '{}', true); ok := false; exception when others then ok := true; end;
  perform pg_temp.yo();
  assert ok and exists (select 1 from public.categorias where nombre = 'Domótica'), '1.10 Los rubros los maneja solo el admin';
  perform pg_temp.paso('1. configuración comercial, comisiones especiales y rubros: solo el admin y con historial');
end $$;

-- ---------------------------------------------------------------- 2. Perfil Match y solicitud con profesionales compatibles
do $$
declare s json; sid uuid; n int; ok boolean; elec smallint := (select id from public.categorias where slug = 'electricidad');
begin
  foreach sid in array array['19000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-0000000000b2', '19000000-0000-0000-0000-0000000000b4']::uuid[] loop
    perform pg_temp.como(sid);
    perform public.guardar_match_perfil(sid, jsonb_build_object('disponible', true, 'rubros', jsonb_build_array(elec)));
  end loop;
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.guardar_match_perfil('19000000-0000-0000-0000-0000000000b1', jsonb_build_object('disponible', true, 'rubros', jsonb_build_array(elec),
    'cobro', jsonb_build_object('banco', 'BROU', 'numero', '001234567-00001', 'titular', 'Pablo Electricista', 'documento', '1.234.567-8')));
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b3');
  perform public.guardar_match_perfil('19000000-0000-0000-0000-0000000000b3', jsonb_build_object('disponible', true,
    'rubros', jsonb_build_array((select id from public.categorias where slug = 'sanitaria'))));
  -- la empresa: lo configura el miembro con permiso Match; el operario no puede
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e1');
  perform public.guardar_match_perfil('19000000-0000-0000-0000-0000000000e0', jsonb_build_object('disponible', true, 'rubros', jsonb_build_array(elec)));
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e2');
  begin perform public.guardar_match_perfil('19000000-0000-0000-0000-0000000000e0', '{"disponible": false}'); ok := false;
  exception when others then ok := true; end;
  assert ok, '2.1 Un operario sin permiso Match no maneja el perfil de la empresa';
  begin perform public.guardar_match_perfil('19000000-0000-0000-0000-0000000000b2', jsonb_build_object('disponible', true, 'rubros', '[]'::jsonb));
    ok := false; exception when others then ok := true; end;
  assert ok, '2.2 Nadie maneja el perfil de otro profesional';

  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  s := public.crear_solicitud(jsonb_build_object('categoria_id', elec, 'titulo', 'Se corta la luz', 'descripcion', 'Salta la llave general cuando prendo el horno',
         'departamento', 'Montevideo', 'localidad', 'Pocitos', 'direccion', 'Av. Brasil 2500 apto 3', 'referencia', 'Timbre 3B',
         'archivos', jsonb_build_array('19000000-0000-0000-0000-0000000000c1/a/foto1.jpg')));
  sid := (s ->> 'id')::uuid;
  perform pg_temp.yo();
  assert (s ->> 'invitados')::int = 3, format('2.3 Debía invitar a P1, P2 y la empresa (electricidad, Montevideo) e invitó a %s', s ->> 'invitados');
  assert not exists (select 1 from public.match_invitaciones where solicitud_id = sid and profesional_id in
     ('19000000-0000-0000-0000-0000000000b3', '19000000-0000-0000-0000-0000000000b4')), '2.4 No se invita a otro rubro ni a otro departamento';
  select count(*) into n from public.notificaciones where tipo = 'match' and titulo like 'Nueva solicitud%'
     and usuario_id in ('19000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-0000000000b2', '19000000-0000-0000-0000-0000000000e0',
                        '19000000-0000-0000-0000-0000000000e1');
  assert n = 4, format('2.5 Avisos de nueva solicitud: P1, P2, la empresa y su miembro Match (fueron %s)', n);
  assert not exists (select 1 from public.notificaciones where usuario_id = '19000000-0000-0000-0000-0000000000e2' and tipo = 'match'),
     '2.6 El operario sin permiso Match no recibe solicitudes';
  -- sin profesionales en la zona
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  s := public.crear_solicitud(jsonb_build_object('categoria_id', elec, 'titulo', 'Luz en Rocha', 'descripcion', 'Necesito revisar la instalación de la casa',
         'departamento', 'Rocha'));
  perform pg_temp.yo();
  assert (s ->> 'invitados')::int = 0 and (select sin_profesionales from public.match_solicitudes where id = (s ->> 'id')::uuid),
     '2.7 Sin profesionales en la zona queda marcada';
  assert exists (select 1 from public.notificaciones where usuario_id = '19000000-0000-0000-0000-0000000000ad' and titulo = 'Solicitud sin profesionales'),
     '2.8 El admin se entera de las solicitudes sin profesionales';
  -- archivos de otro usuario no
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  begin perform public.crear_solicitud(jsonb_build_object('categoria_id', elec, 'titulo', 'Prueba', 'descripcion', 'Una descripción suficiente',
          'departamento', 'Montevideo', 'archivos', jsonb_build_array('19000000-0000-0000-0000-0000000000c1/a/foto1.jpg'))); ok := false;
  exception when others then ok := sqlerrm = 'Archivo no válido'; end;
  perform pg_temp.yo();
  assert ok, '2.9 No se puede adjuntar un archivo de otro usuario';
  perform pg_temp.paso('2. perfil Match, solicitud y profesionales compatibles (rubro y zona) con avisos');
end $$;

-- ---------------------------------------------------------------- 3. Aceptar, rechazar, elegir horario (sin cobrar dos veces)
do $$
declare sid uuid := (select id from public.match_solicitudes where titulo = 'Se corta la luz'); i1 uuid; i2 uuid; ie uuid; t timestamptz; r json; ok boolean; op record;
begin
  select id into i1 from public.match_invitaciones where solicitud_id = sid and profesional_id = '19000000-0000-0000-0000-0000000000b1';
  select id into i2 from public.match_invitaciones where solicitud_id = sid and profesional_id = '19000000-0000-0000-0000-0000000000b2';
  select id into ie from public.match_invitaciones where solicitud_id = sid and profesional_id = '19000000-0000-0000-0000-0000000000e0';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b3');
  begin perform public.responder_invitacion(i1, true); ok := false; exception when others then ok := true; end;
  assert ok, '3.1 Un profesional no responde por otro';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e2');
  begin perform public.responder_invitacion(ie, true); ok := false; exception when others then ok := true; end;
  assert ok, '3.2 El operario de la empresa no responde solicitudes';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e1');
  perform public.responder_invitacion(ie, true, 'Vamos con un técnico');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b2');
  perform public.responder_invitacion(i2, false, 'No llego esta semana');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.responder_invitacion(i1, true, 'Puedo ir mañana');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  r := public.solicitud_cliente(sid);
  assert json_array_length(r -> 'propuestas') = 2, '3.3 El cliente ve las 2 propuestas aceptadas (no la rechazada)';
  assert (r -> 'solicitud' ->> 'direccion') = 'Av. Brasil 2500 apto 3', '3.4 El cliente ve su dirección';
  -- elegir: horario que no está libre → no; uno libre → operación a pagar de $ 1.500
  begin perform public.elegir_profesional(i1, now() + interval '400 days'); ok := false; exception when others then ok := sqlerrm like 'Ese horario%'; end;
  assert ok, '3.5 Solo se reserva un horario libre del profesional';
  begin perform public.elegir_profesional(i2, pg_temp.horario(i1)); ok := false; exception when others then ok := true; end;
  assert ok, '3.6 No se puede elegir a quien rechazó';
  t := pg_temp.horario(i1);
  r := public.elegir_profesional(i1, t);
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.importe = 1500 and op.ret_cliente = 200 and op.ret_profesional = 200 and op.neto_profesional = 1100 and op.estado = 'pendiente_pago'
     and op.mp_costo_profesional_pct = 50, '3.7 La visita se cobra $ 1.500: $ 200 + $ 200 de TaListo! y $ 1.100 del profesional';
  assert (select estado = 'pendiente' and tipo = 'visita' and inicio = t from public.turnos where id = op.turno_id), '3.8 El horario queda tomado en la agenda mientras paga';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  begin perform public.elegir_profesional(ie, pg_temp.horario(ie, 3)); ok := false; exception when others then ok := sqlerrm like 'Ya hay una visita%'; end;
  assert ok, '3.9 No se puede reservar (ni cobrar) dos visitas para la misma solicitud';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  begin perform public.operacion_a_pagar(op.id); ok := false; exception when others then ok := true; end;
  assert ok, '3.10 Otro cliente no puede pagar (ni ver) la operación';
  perform pg_temp.yo();
  perform pg_temp.paso('3. aceptar, rechazar y elegir horario: $ 1.500 con su reparto y sin doble reserva');
end $$;

-- ---------------------------------------------------------------- 4. Pago: solo el servidor, sin duplicados, monto exacto
do $$
declare op public.match_operaciones; ok boolean; n int; d record;
begin
  select o.* into op from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id where s.titulo = 'Se corta la luz';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  begin perform public.match_aplicar_pago(op.id, '{"id": "1", "status": "approved", "transaction_amount": 1500, "currency_id": "UYU"}');
    ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, '4.1 Un usuario no puede marcar un pago como hecho (solo el servidor con Mercado Pago)';
  perform pg_temp.yo();
  assert pg_temp.pago(op.id, '900', 1500, 0, 'rejected') = 'estado_rejected'
     and (select estado = 'pendiente_pago' from public.match_operaciones where id = op.id), '4.2 Un pago rechazado no confirma nada';
  assert pg_temp.pago(op.id, '901', 1400, 80) = 'monto_incorrecto', '4.3 Un pago por otro monto no confirma la reserva';
  assert (select estado = 'pendiente_pago' from public.match_operaciones where id = op.id)
     and exists (select 1 from public.match_devoluciones where mp_pago_id = '901' and origen = 'monto_incorrecto' and estado = 'pendiente'),
     '4.4 ...y queda para devolver (lo aprueba el admin)';
  assert pg_temp.pago(op.id, '1001', 1500, 90) = 'aplicado', '4.5 El pago correcto se aplica';
  select * into op from public.match_operaciones where id = op.id;
  assert op.estado = 'reserva_confirmada' and op.estado_pago = 'pagado' and op.mp_costo = 90 and op.mp_costo_profesional = 45 and op.mp_costo_talisto = 45,
     '4.6 Reserva confirmada; el costo de Mercado Pago se reparte mitad y mitad';
  assert (select estado = 'confirmado' and cliente_id is not null and direccion_id is not null from public.turnos where id = op.turno_id),
     '4.7 La visita queda confirmada en la agenda, con el cliente y la dirección';
  assert exists (select 1 from public.clientes where profesional_id = op.profesional_id and usuario_id = op.cliente_id),
     '4.8 El cliente queda en la lista de clientes del profesional';
  assert (select estado = 'reservada' and profesional_id = op.profesional_id from public.match_solicitudes where id = op.solicitud_id), '4.9 La solicitud queda reservada';
  select count(*) into n from public.match_movimientos where operacion_id = op.id;
  assert pg_temp.pago(op.id, '1001', 1500, 90) = 'ya_aplicado', '4.10 Mercado Pago avisa dos veces: se reconoce';
  assert (select count(*) from public.match_movimientos where operacion_id = op.id) = n,
     '4.10 Mercado Pago avisa dos veces: el pago no se aplica dos veces';
  assert pg_temp.pago(op.id, '1002', 1500, 90) = 'duplicado', '4.11 Un segundo pago de lo mismo se detecta';
  assert exists (select 1 from public.match_devoluciones where mp_pago_id = '1002' and origen = 'pago_duplicado'), '4.11 Un segundo pago de lo mismo se devuelve';
  assert exists (select 1 from public.notificaciones where usuario_id = op.profesional_id and titulo = 'Visita confirmada y paga')
     and exists (select 1 from public.notificaciones where usuario_id = op.cliente_id and titulo = 'Pago confirmado: visita reservada'),
     '4.12 Avisos de visita confirmada y pago confirmado';
  perform pg_temp.paso('4. pago: solo el servidor, monto exacto, idempotente, duplicados a devolver');
end $$;

-- ---------------------------------------------------------------- 5. Visita, calificación, confirmación y reparto de los $ 1.500
do $$
declare op public.match_operaciones; ok boolean; r json;
begin
  select o.* into op from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id where s.titulo = 'Se corta la luz';
  -- el profesional ve la dirección y el contacto recién pagado
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  r := public.match_bandeja('19000000-0000-0000-0000-0000000000b1');
  assert (r -> 'visitas' -> 0 -> 'solicitud' ->> 'direccion') = 'Av. Brasil 2500 apto 3' and (r -> 'visitas' -> 0 -> 'cliente' ->> 'telefono') = '099123456',
     '5.1 Con la visita paga, el profesional ve la dirección y el teléfono';
  begin perform public.visita_realizada(op.id); ok := false; exception when others then ok := sqlerrm like 'La visita todavía no llegó'; end;
  assert ok, '5.2 No se marca hecha una visita que todavía no llegó';
  perform pg_temp.yo();
  perform pg_temp.al_pasado(op.id);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  begin perform public.calificar(op.id, 5, 'Excelente'); ok := false; exception when others then ok := sqlerrm like 'Se califica cuando%'; end;
  assert ok, '5.3 No se califica una visita que no se marcó hecha';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.visita_realizada(op.id, 'Térmica del horno en corto: hay que cambiar el circuito');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  begin perform public.calificar(op.id, 1, 'Malo'); ok := false; exception when others then ok := true; end;
  assert ok, '5.4 Solo califica el cliente de esa visita';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  perform public.calificar(op.id, 5, 'Llegó puntual y explicó todo');
  begin perform public.calificar(op.id, 4); ok := false; exception when others then ok := sqlerrm like 'Ya calificaste%'; end;
  assert ok, '5.5 Una sola calificación por visita';
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = op.id;
  assert op.estado = 'pendiente_liquidacion' and op.confirmado_por = 'cliente', '5.6 Al calificar, la visita queda confirmada';
  assert op.liquidacion_monto = 1055 and op.ingreso_talisto = 355,
     format('5.7 Reparto: profesional $ 1.100 − $ 45 de MP = $ 1.055; TaListo! $ 400 − $ 45 = $ 355 (dio %s y %s)', op.liquidacion_monto, op.ingreso_talisto);
  assert op.liquidacion_monto + op.ingreso_talisto + op.mp_costo = op.importe, '5.8 La distribución coincide con lo cobrado';
  assert exists (select 1 from public.match_calificaciones where operacion_id = op.id and tipo = 'visita' and puntaje = 5), '5.9 Calificación verificada de la visita';
  perform pg_temp.paso('5. visita realizada, calificación verificada y reparto exacto de los $ 1.500');
end $$;

-- ---------------------------------------------------------------- 6. Confirmación automática y reclamo que la frena
do $$
declare a uuid; b uuid; ok boolean;
begin
  a := pg_temp.visita_paga('19000000-0000-0000-0000-0000000000c2', 'Enchufes sin corriente', '2001');
  b := pg_temp.visita_paga('19000000-0000-0000-0000-0000000000c2', 'Portero eléctrico', '2002');
  perform pg_temp.al_pasado(a, 5); perform pg_temp.al_pasado(b, 7);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.visita_realizada(a); perform public.visita_realizada(b);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  perform public.reclamar(b, 'El técnico vino 10 minutos y no revisó el portero', array['19000000-0000-0000-0000-0000000000c2/r/foto.jpg']);
  begin perform public.reclamar(b, 'Otro reclamo por lo mismo'); ok := false; exception when others then ok := true; end;
  assert ok, '6.1 Un reclamo abierto por vez';
  perform pg_temp.yo();
  assert (select estado = 'en_disputa' from public.match_operaciones where id = b), '6.2 El reclamo pone la operación en disputa';
  -- pasa el plazo sin respuesta del cliente
  update public.match_operaciones set confirmar_hasta = now() - interval '1 minute' where id in (a, b);
  update public.match_tareas set ultima = null;
  perform public.match_procesar_vencidos();
  assert (select estado = 'pendiente_liquidacion' and confirmado_por = 'automatica' from public.match_operaciones where id = a),
     '6.3 Si el cliente no responde, la visita se confirma sola después del plazo';
  assert (select estado = 'en_disputa' from public.match_operaciones where id = b), '6.4 Con un reclamo abierto no se confirma sola';
  -- el admin resuelve: devuelve $ 500
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.responder_reclamo((select id from public.match_reclamos where operacion_id = b), 'Revisé y el portero necesita cambio de placa');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  begin perform public.admin_resolver_reclamo((select id from public.match_reclamos where operacion_id = b), 'devolver_total'); ok := false;
  exception when others then ok := true; end;
  assert ok, '6.5 Solo el admin resuelve reclamos';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  perform public.admin_resolver_reclamo((select id from public.match_reclamos where operacion_id = b), 'devolver_parcial', 500, 'Se devuelve una parte');
  perform pg_temp.yo();
  perform public.match_devolucion_resultado((select id from public.match_devoluciones where operacion_id = b and origen = 'reclamo'), true, 'R-1');
  assert (select estado = 'pendiente_liquidacion' and estado_pago = 'reembolso_parcial' and reintegrado = 500 and liquidacion_monto = 688.33
                 and ingreso_talisto = 221.67 and liquidacion_monto + ingreso_talisto + mp_costo + reintegrado = importe
            from public.match_operaciones where id = b),
     '6.6 Devolución parcial: lo que queda se reparte en proporción y todo suma lo cobrado';
  perform pg_temp.paso('6. confirmación automática, reclamo que la frena y devolución parcial resuelta por el admin');
end $$;

-- ---------------------------------------------------------------- 7. Cancelaciones y devoluciones
do $$
declare a uuid; b uuid; c uuid; r json; ok boolean; s uuid; inv2 uuid;
begin
  -- 7.1 el cliente cancela con tiempo: devolución total que aprueba el admin
  a := pg_temp.visita_paga('19000000-0000-0000-0000-0000000000c1', 'Cambiar tablero', '3001');
  update public.turnos set inicio = now() + interval '3 days', fin = now() + interval '3 days 1 hour' where id = (select turno_id from public.match_operaciones where id = a);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  r := public.cancelar_visita(a, 'Lo resolví');
  perform pg_temp.yo();
  assert (r ->> 'devolucion')::numeric = 1500 and (select estado = 'pendiente' and monto = 1500 from public.match_devoluciones where operacion_id = a),
     '7.1 Cancelar con más de 24 h: devolución total pendiente de aprobación';
  assert (select estado = 'cancelado' from public.turnos where id = (select turno_id from public.match_operaciones where id = a)), '7.2 El horario se libera';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  begin perform public.admin_aprobar_devolucion((select id from public.match_devoluciones where operacion_id = a)); ok := false; exception when others then ok := true; end;
  assert ok, '7.3 Solo el admin aprueba devoluciones';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  r := public.admin_aprobar_devolucion((select id from public.match_devoluciones where operacion_id = a));
  perform pg_temp.yo();
  assert (r ->> 'mp_pago_id') = '3001', '7.4 La devolución se hace sobre el pago original';
  perform public.match_devolucion_resultado((r ->> 'id')::uuid, true, 'R-2');
  perform public.match_devolucion_resultado((r ->> 'id')::uuid, true, 'R-2');
  assert (select estado = 'reembolsado' and reintegrado = 1500 and ingreso_talisto = -90 and estado_liquidacion = 'no_corresponde' from public.match_operaciones where id = a),
     '7.5 Devuelto todo: no se liquida nada y TaListo! absorbe el costo de MP (una sola vez)';
  -- 7.6 cancelación tarde (sin devolución por defecto): se le liquida al profesional
  b := pg_temp.visita_paga('19000000-0000-0000-0000-0000000000c1', 'Instalar ventilador', '3002');
  update public.turnos set inicio = now() + interval '5 hours', fin = now() + interval '6 hours' where id = (select turno_id from public.match_operaciones where id = b);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  r := public.cancelar_visita(b);
  perform pg_temp.yo();
  assert (r ->> 'devolucion')::numeric = 0 and (select estado = 'pendiente_liquidacion' and liquidacion_monto = 1055 from public.match_operaciones where id = b),
     '7.6 Cancelación con menos de 24 h: sin devolución y el profesional cobra la visita';
  -- 7.7 el profesional cancela: devolución total, la solicitud vuelve a estar abierta y con penalización configurada
  update public.configuracion set penalizacion_profesional = 300 where id = 1;
  inv2 := pg_temp.solicitud_aceptada('19000000-0000-0000-0000-0000000000c2', 'Luz del patio');
  s := (select solicitud_id from public.match_invitaciones where id = inv2);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b2');
  perform public.responder_invitacion((select id from public.match_invitaciones where solicitud_id = s and profesional_id = '19000000-0000-0000-0000-0000000000b2'), true);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  c := (public.elegir_profesional(inv2, pg_temp.horario(inv2, 7)) ->> 'operacion')::uuid;
  perform pg_temp.yo();
  perform pg_temp.pago(c, '3003', 1500, 90);
  assert (select estado = 'descartada' from public.match_invitaciones where solicitud_id = s and profesional_id = '19000000-0000-0000-0000-0000000000b2'),
     '7.7a Al pagar, las otras propuestas quedan descartadas';
  update public.turnos set inicio = now() + interval '2 days', fin = now() + interval '2 days 1 hour' where id = (select turno_id from public.match_operaciones where id = c);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  r := public.cancelar_visita(c, 'Se me rompió el auto');
  perform pg_temp.yo();
  assert (r ->> 'devolucion')::numeric = 1500 and (select origen = 'profesional' from public.match_devoluciones where operacion_id = c),
     '7.7 Si cancela el profesional se devuelve todo';
  assert (select estado = 'abierta' and profesional_id is null from public.match_solicitudes where id = s)
     and (select estado = 'aceptada' from public.match_invitaciones where solicitud_id = s and profesional_id = '19000000-0000-0000-0000-0000000000b2'),
     '7.8 La solicitud vuelve a estar abierta y se puede elegir a otro que había aceptado';
  assert exists (select 1 from public.match_movimientos where operacion_id = c and tipo = 'penalizacion' and importe = -300), '7.9 Penalización configurada al profesional';
  assert exists (select 1 from public.notificaciones where usuario_id = '19000000-0000-0000-0000-0000000000c2' and titulo = 'El profesional canceló la visita'),
     '7.10 Aviso de cancelación al cliente';
  update public.configuracion set penalizacion_profesional = 0 where id = 1;
  perform pg_temp.paso('7. cancelaciones con y sin devolución, aprobadas por el admin, y penalización');
end $$;

-- ---------------------------------------------------------------- 8. Pago que no se hizo a tiempo y pago tardío
do $$
declare i uuid; op uuid; t timestamptz;
begin
  i := pg_temp.solicitud_aceptada('19000000-0000-0000-0000-0000000000c1', 'Timbre');
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  t := pg_temp.horario(i, 5);
  op := (public.elegir_profesional(i, t) ->> 'operacion')::uuid;
  perform pg_temp.yo();
  update public.match_operaciones set vence_pago_en = now() - interval '1 minute' where id = op;
  update public.match_tareas set ultima = null;
  perform public.match_procesar_vencidos();
  assert (select estado = 'cancelado' and estado_pago = 'vencido' from public.match_operaciones where id = op)
     and (select estado = 'cancelado' from public.turnos where id = (select turno_id from public.match_operaciones where id = op)),
     '8.1 Sin pagar a tiempo, la reserva se cancela y el horario se libera';
  -- el pago llega tarde pero el horario sigue libre: se recupera
  assert pg_temp.pago(op, '4001', 1500, 90) = 'aplicado', '8.2a El pago tardío se aplica';
  assert (select estado = 'reserva_confirmada' from public.match_operaciones where id = op),
     '8.2 Si el pago llega tarde y el horario sigue libre, la reserva se recupera';
  perform pg_temp.paso('8. reservas vencidas y pagos tardíos sin perder plata');
end $$;

-- ---------------------------------------------------------------- 9. Contratación por fuera de TaListo!
do $$
declare op uuid := (select o.id from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id where s.titulo = 'Se corta la luz');
        s uuid; ok boolean; i uuid;
begin
  s := (select solicitud_id from public.match_operaciones where id = op);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  perform public.marcar_externa(s);
  perform pg_temp.yo();
  assert (select estado = 'externa' and modalidad = 'externa' from public.match_solicitudes where id = s) and (select externa from public.match_operaciones where id = op),
     '9.1 El profesional indica que el cliente siguió por fuera: queda registrado';
  assert (select liquidacion_monto = 1055 from public.match_operaciones where id = op) and not exists
     (select 1 from public.match_operaciones where solicitud_id = s and tipo = 'trabajo'), '9.2 Sin comisión ni trabajo registrado: solo la visita';
  -- antes de la visita no se puede marcar externa
  i := pg_temp.solicitud_aceptada('19000000-0000-0000-0000-0000000000c2', 'Antes de visitar');
  s := (select solicitud_id from public.match_invitaciones where id = i);
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  begin perform public.marcar_externa(s); ok := false;
  exception when others then ok := sqlerrm like 'Primero tiene que estar hecha%'; end;
  perform pg_temp.yo();
  assert ok, '9.3 Se marca por fuera solo después de la visita técnica';
  perform pg_temp.paso('9. contratación por fuera: sin comisión, sin garantía, con el registro de la visita');
end $$;

-- ---------------------------------------------------------------- 10. Liquidación al profesional
do $$
declare ops uuid[]; total numeric; l json; ok boolean; pend numeric;
begin
  select array_agg(id), sum(liquidacion_monto) into ops, total from public.match_operaciones
   where profesional_id = '19000000-0000-0000-0000-0000000000b1' and estado_liquidacion = 'pendiente';
  select -sum(importe) into pend from public.match_movimientos where profesional_id = '19000000-0000-0000-0000-0000000000b1' and tipo = 'penalizacion' and liquidacion_id is null;
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b1');
  begin perform public.admin_liquidar('19000000-0000-0000-0000-0000000000b1', ops, 'TRF-1'); ok := false; exception when others then ok := true; end;
  assert ok, '10.1 El profesional no se liquida a sí mismo';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  l := public.admin_liquidar('19000000-0000-0000-0000-0000000000b1', ops, 'TRF-BROU-778899', current_date);
  perform pg_temp.yo();
  assert (l ->> 'monto')::numeric = total - coalesce(pend, 0) and (l ->> 'penalizaciones')::numeric = coalesce(pend, 0),
     format('10.2 La liquidación descuenta las penalizaciones (total %s, penalización %s, liquidado %s)', total, pend, l ->> 'monto');
  assert not exists (select 1 from public.match_operaciones where id = any(ops) and estado_liquidacion <> 'liquidado'), '10.3 Las operaciones quedan liquidadas';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000ad');
  begin perform public.admin_liquidar('19000000-0000-0000-0000-0000000000b1', ops, 'TRF-2'); ok := false; exception when others then ok := sqlerrm like 'Alguna operación ya se liquidó%'; end;
  perform pg_temp.yo();
  assert ok, '10.4 No se liquida dos veces lo mismo';
  assert exists (select 1 from public.notificaciones where usuario_id = '19000000-0000-0000-0000-0000000000b1' and titulo = 'Liquidación realizada'), '10.5 Aviso de liquidación';
  perform pg_temp.paso('10. liquidación registrada, con penalizaciones y sin repetir');
end $$;

-- ---------------------------------------------------------------- 11. Aislamiento y datos privados
do $$
declare n int; ok boolean; r json; sid uuid := (select id from public.match_solicitudes where titulo = 'Cambiar tablero');
begin
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c2');
  select count(*) into n from public.match_solicitudes where cliente_id = '19000000-0000-0000-0000-0000000000c1';
  assert n = 0, '11.1 Un cliente no ve las solicitudes de otro';
  begin r := public.solicitud_cliente(sid); ok := false; exception when others then ok := true; end;
  assert ok, '11.2 ...ni por la función';
  select count(*) into n from public.match_operaciones where cliente_id = '19000000-0000-0000-0000-0000000000c1';
  assert n = 0, '11.3 Ni sus pagos';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000b2');
  select count(*) into n from public.match_operaciones where profesional_id = '19000000-0000-0000-0000-0000000000b1';
  assert n = 0, '11.4 Un profesional no ve las operaciones de otro';
  select count(*) into n from public.match_datos_cobro;
  assert n = 0, '11.5 Ni sus datos de cobro';
  select count(*) into n from public.match_solicitudes;
  assert n = 0, '11.6 Los profesionales no leen las solicitudes directo (la dirección se ve recién pagada)';
  select count(*) into n from public.config_historial;
  assert n = 0, '11.7 El historial de configuración es solo del admin';
  select count(*) into n from public.eventos;
  assert n = 0, '11.8 La actividad de los usuarios es solo del admin';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e2');
  select count(*) into n from public.match_invitaciones where profesional_id = '19000000-0000-0000-0000-0000000000e0';
  assert n = 0, '11.9 El operario de la empresa no ve sus solicitudes Match';
  perform pg_temp.como('19000000-0000-0000-0000-0000000000e1');
  select count(*) into n from public.match_invitaciones where profesional_id = '19000000-0000-0000-0000-0000000000e0';
  assert n > 0, '11.10 El miembro con permiso Match sí';
  begin r := public.admin_match('operaciones'); ok := false; exception when others then ok := true; end;
  assert ok, '11.11 El panel de administración de Match es solo del admin';
  perform pg_temp.yo();
  perform set_config('role', 'anon', true);
  begin perform public.crear_solicitud('{}'); ok := false; exception when insufficient_privilege then ok := true; end;
  assert ok, '11.12 Sin sesión no se publican solicitudes';
  r := public.profesionales_match((select id from public.categorias where slug = 'electricidad'), 'Montevideo');
  perform pg_temp.yo();
  assert json_array_length(r) >= 2 and r::text not like '%BROU%' and r::text not like '%@talisto.test%',
     '11.13 La búsqueda pública muestra profesionales sin datos privados';
  perform pg_temp.paso('11. aislamiento entre clientes, profesionales y empresas; datos privados protegidos');
end $$;

-- ---------------------------------------------------------------- 12. Registro de actividad y libro de movimientos
do $$
declare n int; m int;
begin
  perform pg_temp.como('19000000-0000-0000-0000-0000000000c1');
  perform public.registrar_evento('sesion'); perform public.registrar_evento('sesion');
  perform public.registrar_evento('busco_servicio'); perform public.registrar_evento('borrar_todo');
  perform pg_temp.yo();
  select count(*) into n from public.eventos where usuario_id = '19000000-0000-0000-0000-0000000000c1' and tipo = 'sesion';
  assert n = 1, '12.1 Una sesión cada 30 minutos (no se infla)';
  assert not exists (select 1 from public.eventos where tipo = 'borrar_todo'), '12.2 Solo se registran acciones conocidas';
  assert exists (select 1 from public.eventos where tipo = 'publico_solicitud' and perfil = 'cliente')
     and exists (select 1 from public.eventos where tipo = 'acepto_solicitud' and perfil = 'empresa')
     and exists (select 1 from public.eventos where tipo = 'realizo_pago')
     and exists (select 1 from public.eventos where tipo = 'contratacion_externa'), '12.3 Las acciones de Match quedan registradas por tipo de cuenta';
  -- libro: lo cobrado = devuelto + costo MP + a liquidar + ingreso, en cada operación confirmada
  select count(*) into m from public.match_operaciones o
   where o.estado_pago in ('pagado', 'reembolso_parcial', 'reembolsado') and o.mp_pago_id is not null
     and (o.estado_liquidacion <> 'no_corresponde' or o.estado = 'reembolsado')
     and o.importe <> o.reintegrado + coalesce(o.mp_costo, 0) + coalesce(o.liquidacion_monto, 0) + coalesce(o.ingreso_talisto, 0);
  assert m = 0, format('12.4 En %s operaciones el reparto no coincide con lo cobrado', m);
  perform pg_temp.paso('12. actividad registrada sin inflar y reparto que siempre cierra');
end $$;

-- ---------------------------------------------------------------- resultado
do $$
begin
  raise exception 'PRUEBAS OK: % de 12 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n', true);
end $$;
rollback;

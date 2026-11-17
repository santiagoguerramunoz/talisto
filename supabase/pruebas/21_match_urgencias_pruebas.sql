-- =====================================================================
--  TaListo!  ·  PRUEBAS de 21_match_urgencias.sql (urgencias y fuera de horario)
--  Crea un cliente y dos técnicos (uno atiende urgencias, el otro no),
--  con horario de trabajo de 8 a 20 todos los días, y verifica: la
--  configuración del admin, qué es horario normal, qué horarios se le
--  ofrecen al cliente y a qué precio, la tarifa al reservar, el "Es
--  urgente", "el primero disponible" (precio, quién lo ve, a qué hora se
--  puede llegar y a quién se avisa) y que las operaciones ya creadas no
--  cambian. Usa días fijos de la semana que viene: da lo mismo el día en
--  que se corra.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('21000000-0000-0000-0000-0000000000c1', 'c1@urgencias.test', '{"rol":"cliente","nombre":"Carla Cliente"}'),
  ('21000000-0000-0000-0000-0000000000b1', 'b1@urgencias.test', '{"rol":"profesional","nombre":"Ulises Urgencias"}'),
  ('21000000-0000-0000-0000-0000000000b2', 'b2@urgencias.test', '{"rol":"profesional","nombre":"Hugo Horario"}'),
  ('21000000-0000-0000-0000-0000000000ad', 'ad@urgencias.test', '{"rol":"cliente","nombre":"Admin"}');
update public.perfiles set es_admin = true where id = '21000000-0000-0000-0000-0000000000ad';
update public.profesionales set departamentos = '{Montevideo}', activo = true where id::text like '21000000-%';
insert into public.planes (usuario_id, plan, origen)
select u, 'pro', 'regalo' from unnest(array['21000000-0000-0000-0000-0000000000b1', '21000000-0000-0000-0000-0000000000b2']::uuid[]) u
on conflict (usuario_id) do update set plan = 'pro', origen = 'regalo', vence_en = null;
update public.configuracion set precio_visita = 1500, visita_ret_cliente = 200, visita_ret_profesional = 200, visita_neto_profesional = 1100,
  comision_visita = 400, mp_costo_profesional_pct = 50, duracion_visita_min = 60, pago_minutos = 30, solo_verificados = false,
  max_invitados = 10, primero_activo = true, primero_horas = 4,
  urgencia_activa = true, precio_urgencia = 2500, urgencia_ret_cliente = 300, urgencia_ret_profesional = 300, urgencia_neto_profesional = 1900,
  urgencia_desde = '07:00', urgencia_hasta = '23:00',
  horario_normal = '{"0": null, "1": {"desde": "08:00", "hasta": "18:00"}, "2": {"desde": "08:00", "hasta": "18:00"},
    "3": {"desde": "08:00", "hasta": "18:00"}, "4": {"desde": "08:00", "hasta": "18:00"},
    "5": {"desde": "08:00", "hasta": "18:00"}, "6": {"desde": "08:00", "hasta": "13:00"}}'
 where id = 1;
update public.match_tareas set ultima = null;
-- Solo estos dos técnicos hacen electricidad en Montevideo durante la prueba
update public.match_perfiles set disponible = false where profesional_id::text not like '21000000-%';

-- b1 atiende urgencias, b2 no. Los dos: electricidad, cuenta bancaria y horario de 8 a 20 todos los días
insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias)
values ('21000000-0000-0000-0000-0000000000b1', true, array[(select id from public.categorias where slug = 'electricidad')], true),
       ('21000000-0000-0000-0000-0000000000b2', true, array[(select id from public.categorias where slug = 'electricidad')], false)
on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros, urgencias = excluded.urgencias;
insert into public.match_datos_cobro (profesional_id, banco, numero, titular)
select p, 'BROU', '001234567', 'Titular' from unnest(array['21000000-0000-0000-0000-0000000000b1', '21000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do nothing;
insert into public.horarios_trabajo (profesional_id, dia, hora_inicio, hora_fin)
select p, d, '08:00', '20:00' from unnest(array['21000000-0000-0000-0000-0000000000b1', '21000000-0000-0000-0000-0000000000b2']::uuid[]) p,
       generate_series(0, 6) d;

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
create function pg_temp.pago(op uuid) returns text language plpgsql as $$
declare m numeric := (select importe from public.match_operaciones where id = op);
begin
  return public.match_aplicar_pago(op, jsonb_build_object('id', 'mp-' || op, 'status', 'approved', 'transaction_amount', m, 'currency_id', 'UYU',
           'external_reference', 'match:' || op, 'fee', round(m * 0.0731, 2), 'date_approved', now())) ->> 'resultado';
end $$;
-- El próximo día de la semana pedido (0 = domingo … 6 = sábado), de pasado mañana en adelante
create function pg_temp.dia(dow int) returns date language sql as $$
  select d::date from generate_series(public._hoy_uy() + 2, public._hoy_uy() + 8, interval '1 day') d where extract(dow from d)::int = dow limit 1;
$$;
create function pg_temp.a(f date, h int, m int default 0) returns timestamptz language sql as $$
  select (f + make_time(h, m, 0)) at time zone 'America/Montevideo';
$$;
-- Una solicitud de electricidad en Pocitos; extra cambia lo que haga falta (modo, urgente, cuándo)
create function pg_temp.pedido(titulo text, extra jsonb default '{}') returns json language plpgsql as $$
declare r json;
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  r := public.crear_solicitud(jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'electricidad'),
         'titulo', titulo, 'descripcion', 'Se corta la luz de la cocina cada tanto', 'departamento', 'Montevideo',
         'localidad', 'Pocitos', 'direccion', 'Av. Brasil 2500 apto 3', 'lat', -34.9123456, 'lng', -56.1567891) || extra);
  perform pg_temp.yo();
  return r;
end $$;
-- Los dos técnicos aceptan; devuelve la invitación del pedido para ese técnico
create function pg_temp.invitacion(sol uuid, pro uuid) returns uuid language sql as $$
  select id from public.match_invitaciones where solicitud_id = sol and profesional_id = pro;
$$;
create function pg_temp.aceptan(sol uuid) returns void language plpgsql as $$
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000b1');
  perform public.responder_invitacion(pg_temp.invitacion(sol, '21000000-0000-0000-0000-0000000000b1'), true, null);
  perform pg_temp.como('21000000-0000-0000-0000-0000000000b2');
  perform public.responder_invitacion(pg_temp.invitacion(sol, '21000000-0000-0000-0000-0000000000b2'), true, null);
  perform pg_temp.yo();
end $$;
-- Horarios con precio que ve el cliente para un técnico, solo de ese día
create function pg_temp.horas(inv uuid, f date) returns setof json language plpgsql as $$
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  return query select e from json_array_elements(public.horarios_visita_precios(inv, f, 1)) e;
  perform pg_temp.yo();
end $$;

-- ---------------------------------------------------------------- 1. Configuración: solo el admin, reparto que cuadra, horario válido
do $$
declare ad uuid := '21000000-0000-0000-0000-0000000000ad'; ok boolean; j json; c public.configuracion;
begin
  select * into c from public.configuracion where id = 1;
  assert c.precio_urgencia = 2500 and c.urgencia_ret_cliente + c.urgencia_ret_profesional = 600 and c.urgencia_neto_profesional = 1900,
     '1.1 La urgencia arranca en 2.500 = 300 + 300 + 1.900';
  perform pg_temp.como(ad);
  begin perform public.guardar_config_match('{"precio_urgencia": 2600}'); ok := false;
  exception when others then ok := sqlerrm like 'El reparto de la urgencia no coincide%'; end;
  assert ok, '1.2 Si el reparto de la urgencia no suma el precio, no se guarda';
  begin perform public.guardar_config_match('{"horario_normal": {"1": {"desde": "18:00", "hasta": "08:00"}}}'); ok := false;
  exception when others then ok := sqlerrm like '%la hora de fin tiene que ser después%'; end;
  assert ok, '1.3 Un día con la hora de fin antes que la de inicio no se guarda';
  begin perform public.guardar_config_match('{"horario_normal": {"1": {"desde": "25:00", "hasta": "26:00"}}}'); ok := false;
  exception when others then ok := sqlerrm like 'Revisá las horas%'; end;
  assert ok, '1.4 Horas imposibles no se guardan';
  begin perform public.guardar_config_match('{"urgencia_desde": "23:00", "urgencia_hasta": "07:00"}'); ok := false;
  exception when others then ok := sqlerrm like 'La franja de urgencias%' or sqlerrm like '%configuracion_urgencia_check%'; end;
  assert ok, '1.5 La franja de urgencias tiene que tener sentido';
  j := public.guardar_config_match(jsonb_build_object('precio_urgencia', 2500, 'urgencia_ret_cliente', 300, 'urgencia_ret_profesional', 300,
         'urgencia_neto_profesional', 1900, 'urgencia_desde', '06:30',
         'horario_normal', jsonb_build_object('1', jsonb_build_object('desde', '8:00', 'hasta', '18:00'), '2', jsonb_build_object('desde', '08:00', 'hasta', '18:00'),
           '3', jsonb_build_object('desde', '08:00', 'hasta', '18:00'), '4', jsonb_build_object('desde', '08:00', 'hasta', '18:00'),
           '5', jsonb_build_object('desde', '08:00', 'hasta', '18:00'), '6', jsonb_build_object('desde', '08:00', 'hasta', '13:00'))));
  assert j -> 'horario_normal' -> '1' ->> 'desde' = '08:00' and (j -> 'horario_normal' -> '0') is not null
     and json_typeof(j -> 'horario_normal' -> '0') = 'null' and j ->> 'urgencia_desde' = '06:30:00',
     '1.6 El horario se guarda prolijo (08:00) y el día que falta queda sin horario normal';
  assert exists (select 1 from public.config_historial where campo = 'urgencia_desde' and valor_nuevo like '06:30%' and admin_id = ad),
     '1.7 El cambio queda en el historial con quién lo hizo';
  perform public.guardar_config_match('{"urgencia_desde": "07:00"}');
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  begin perform public.guardar_config_match('{"precio_urgencia": 1}'); ok := false;
  exception when others then ok := true; end;
  assert ok, '1.8 Un cliente no puede cambiar la configuración';
  perform pg_temp.yo();
  perform pg_temp.paso('1. configuración: solo el admin, reparto que cuadra y horario válido');
end $$;

-- ---------------------------------------------------------------- 2. Qué es horario normal
do $$
declare ma date := pg_temp.dia(2); sa date := pg_temp.dia(6); do_ date := pg_temp.dia(0);
begin
  assert public._es_horario_normal(pg_temp.a(ma, 8)) and public._es_horario_normal(pg_temp.a(ma, 17, 45)), '2.1 Martes de 8 a 17:45 es normal';
  assert not public._es_horario_normal(pg_temp.a(ma, 18)) and not public._es_horario_normal(pg_temp.a(ma, 7, 30)), '2.2 Martes a las 18 o a las 7:30 es fuera de horario';
  assert public._es_horario_normal(pg_temp.a(sa, 12)) and not public._es_horario_normal(pg_temp.a(sa, 13)), '2.3 Sábado: normal hasta las 13';
  assert not public._es_horario_normal(pg_temp.a(do_, 10)), '2.4 Domingo: todo fuera de horario';
  update public.configuracion set urgencia_activa = false where id = 1;
  assert public._es_horario_normal(pg_temp.a(do_, 10)), '2.5 Con las urgencias apagadas, todo es normal';
  update public.configuracion set urgencia_activa = true where id = 1;
  perform pg_temp.paso('2. horario normal: lunes a viernes de 8 a 18, sábado de 8 a 13, domingo nada');
end $$;

-- ---------------------------------------------------------------- 3. Horarios que ve el cliente y su precio
do $$
declare
  b1 uuid := '21000000-0000-0000-0000-0000000000b1'; b2 uuid := '21000000-0000-0000-0000-0000000000b2';
  ma date := pg_temp.dia(2); do_ date := pg_temp.dia(0); sol uuid; i1 uuid; i2 uuid; n int; viejo json;
begin
  sol := (pg_temp.pedido('Luz de la cocina') ->> 'id')::uuid;
  i1 := pg_temp.invitacion(sol, b1); i2 := pg_temp.invitacion(sol, b2);
  assert i1 is not null and i2 is not null, '3.1 Se invitó a los dos técnicos';
  assert (select bool_and(precio_visita = 1500) from public.match_invitaciones where solicitud_id = sol), '3.2 Sin "urgente", la invitación muestra la visita normal';
  perform pg_temp.aceptan(sol);
  -- b2 (no atiende urgencias): solo horario normal, todo a 1.500
  select count(*) into n from pg_temp.horas(i2, ma) h;
  assert n = 20, format('3.3 b2 el martes: de 8:00 a 17:30 cada media hora (20), y vinieron %s', n);
  assert not exists (select 1 from pg_temp.horas(i2, ma) h where (h ->> 'urgencia')::boolean or (h ->> 'importe')::numeric <> 1500),
     '3.4 b2: ningún horario de urgencia, todos a 1.500';
  assert not exists (select 1 from pg_temp.horas(i2, do_)), '3.5 b2 el domingo: nada (trabaja, pero es fuera de horario y no toma urgencias)';
  -- b1 (atiende urgencias): además, fuera de horario dentro de la franja de urgencias (7 a 23), a 2.500
  select count(*) into n from pg_temp.horas(i1, ma) h;
  assert n = 31, format('3.6 b1 el martes: 20 normales + 7:00, 7:30 y de 18:00 a 22:00 (11), y vinieron %s', n);
  assert (select count(*) from pg_temp.horas(i1, ma) h where (h ->> 'urgencia')::boolean and (h ->> 'importe')::numeric = 2500) = 11
     and exists (select 1 from pg_temp.horas(i1, ma) h where (h ->> 'desde')::timestamptz = pg_temp.a(ma, 22))
     and exists (select 1 from pg_temp.horas(i1, ma) h where (h ->> 'desde')::timestamptz = pg_temp.a(ma, 7)),
     '3.7 b1: los de fuera de horario salen marcados y a 2.500, aunque estén fuera de su horario de trabajo';
  select count(*) into n from pg_temp.horas(i1, do_) h where (h ->> 'urgencia')::boolean;
  assert n = 31, format('3.8 b1 el domingo: de 7:00 a 22:00, todos urgencia (31), y vinieron %s', n);
  -- La función de antes devuelve los mismos horarios (para pantallas viejas)
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  viejo := public.horarios_visita(i1, ma, 1);
  perform pg_temp.yo();
  assert json_array_length(viejo) = 31 and json_typeof(viejo -> 0) = 'string', '3.9 horarios_visita sigue devolviendo la lista de horas';
  -- Otro cliente no ve los horarios
  perform pg_temp.como(b2);
  begin perform public.horarios_visita_precios(i1, ma, 1); n := 0; exception when others then n := 1; end;
  perform pg_temp.yo();
  assert n = 1, '3.10 Solo el cliente de la solicitud ve los horarios';
  perform set_config('pruebas.sol', sol::text, true);
  perform pg_temp.paso('3. horarios que ve el cliente: normales para todos, fuera de horario solo de los que atienden urgencias');
end $$;

-- ---------------------------------------------------------------- 4. Reservar: la tarifa sale del horario elegido
do $$
declare
  b1 uuid := '21000000-0000-0000-0000-0000000000b1'; b2 uuid := '21000000-0000-0000-0000-0000000000b2';
  ma date := pg_temp.dia(2); sol uuid := current_setting('pruebas.sol')::uuid; r json; op public.match_operaciones; t public.turnos; ok boolean;
  i1 uuid := pg_temp.invitacion(sol, b1); i2 uuid := pg_temp.invitacion(sol, b2);
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  r := public.elegir_profesional(i1, pg_temp.a(ma, 19));
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  perform pg_temp.yo();
  select * into t from public.turnos where id = op.turno_id;
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  assert op.urgencia and op.importe = 2500 and op.ret_cliente = 300 and op.ret_profesional = 300 and op.neto_profesional = 1900
     and (r ->> 'urgencia')::boolean, '4.1 A las 19 se cobra urgencia: 2.500 = 300 + 300 + 1.900';
  assert t.monto_acordado = 2500 and t.titulo like 'Urgencia TaListo! Match%', '4.2 En la agenda del técnico figura como urgencia';
  perform public.cancelar_visita(op.id, 'Cambio de horario');
  r := public.elegir_profesional(i1, pg_temp.a(ma, 10));
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert not op.urgencia and op.importe = 1500 and op.ret_cliente = 200 and op.ret_profesional = 200 and op.neto_profesional = 1100,
     '4.3 A las 10 es la visita normal: 1.500 = 200 + 200 + 1.100';
  perform public.cancelar_visita(op.id, 'Cambio de técnico');
  begin perform public.elegir_profesional(i2, pg_temp.a(ma, 19)); ok := false;
  exception when others then ok := sqlerrm like 'Ese horario ya no está libre%'; end;
  assert ok, '4.4 Al que no atiende urgencias no se le puede reservar fuera de horario, aunque esté en su horario de trabajo';
  r := public.elegir_profesional(i2, pg_temp.a(ma, 17, 30));
  assert (r ->> 'importe')::numeric = 1500, '4.5 b2 a las 17:30: normal';
  perform pg_temp.yo();
  perform pg_temp.paso('4. reservar: la tarifa sale del horario elegido y queda guardada en la operación');
end $$;

-- ---------------------------------------------------------------- 5. "Es urgente": 2.500 a cualquier hora
do $$
declare b1 uuid := '21000000-0000-0000-0000-0000000000b1'; b2 uuid := '21000000-0000-0000-0000-0000000000b2';
  ma date := pg_temp.dia(2); sol uuid; r json; op public.match_operaciones; n int; i uuid;
begin
  sol := (pg_temp.pedido('Sin luz en el baño', '{"urgente": true}') ->> 'id')::uuid;
  assert (select bool_and(precio_visita = 2500) and count(*) = 2 from public.match_invitaciones where solicitud_id = sol),
     '5.1 Con "urgente", los técnicos ven la tarifa de urgencia desde la invitación';
  perform pg_temp.aceptan(sol);
  select count(*) into n from pg_temp.horas(pg_temp.invitacion(sol, b2), ma) h
   where (h ->> 'importe')::numeric <> 2500 or not (h ->> 'urgencia')::boolean or (h ->> 'desde')::timestamptz >= pg_temp.a(ma, 18);
  assert n = 0 and exists (select 1 from pg_temp.horas(pg_temp.invitacion(sol, b2), ma)),
     '5.2 Marcado urgente: todos los horarios a 2.500, pero b2 sigue sin horarios fuera del normal';
  i := pg_temp.invitacion(sol, b2);
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  r := public.elegir_profesional(i, pg_temp.a(ma, 10));
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.urgencia and op.importe = 2500 and op.neto_profesional = 1900, '5.3 Urgente a las 10: igual se cobra urgencia';
  perform pg_temp.paso('5. "es urgente": se cobra la urgencia a cualquier hora');
end $$;

-- ---------------------------------------------------------------- 6. "El primero disponible": precio al publicar
do $$
declare ma date := pg_temp.dia(2); sa date := pg_temp.dia(6); do_ date := pg_temp.dia(0); j json; r json; op public.match_operaciones;
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  assert (public.cotizar_primero('dia', ma, 'manana', false) ->> 'importe')::numeric = 1500, '6.1 Martes de mañana: normal';
  assert (public.cotizar_primero('dia', ma, 'tarde', false) ->> 'importe')::numeric = 1500, '6.2 Martes de tarde: queda horario normal, normal';
  assert (public.cotizar_primero('dia', ma, 'manana', true) ->> 'importe')::numeric = 2500, '6.3 Martes de mañana marcado urgente: urgencia';
  assert (public.cotizar_primero('dia', do_, 'cualquiera', false) ->> 'urgencia')::boolean, '6.4 Domingo: urgencia';
  assert (public.cotizar_primero('dia', sa, 'tarde', false) ->> 'importe')::numeric = 2500, '6.5 Sábado de tarde (después de las 13): urgencia';
  assert (public.cotizar_primero('dia', sa, 'cualquiera', false) ->> 'importe')::numeric = 1500, '6.6 Sábado en cualquier horario: queda la mañana, normal';
  j := public.cotizar_primero('dia', public._hoy_uy() - 1, 'manana', false);
  assert (j ->> 'pasada')::boolean, '6.7 Una franja que ya pasó no tiene precio';
  perform pg_temp.yo();
  r := pg_temp.pedido('Domingo sin luz', jsonb_build_object('modo', 'primero', 'cuando', 'dia', 'fecha', do_, 'franja', 'cualquiera'));
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.urgencia and op.importe = 2500 and op.ret_cliente = 300 and op.ret_profesional = 300 and op.neto_profesional = 1900,
     '6.8 La operación del domingo se cobra como urgencia';
  perform set_config('pruebas.dom', op.id::text, true);
  r := pg_temp.pedido('Martes enchufes', jsonb_build_object('modo', 'primero', 'cuando', 'dia', 'fecha', ma, 'franja', 'cualquiera'));
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert not op.urgencia and op.importe = 1500, '6.9 La del martes, normal';
  perform set_config('pruebas.mar', op.id::text, true);
  r := pg_temp.pedido('Martes tarde urgente', jsonb_build_object('modo', 'primero', 'cuando', 'dia', 'fecha', ma, 'franja', 'tarde', 'urgente', true));
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.urgencia and op.importe = 2500, '6.10 Martes de tarde marcado urgente: urgencia';
  perform set_config('pruebas.urg', op.id::text, true);
  perform pg_temp.paso('6. el primero disponible: el precio se decide al publicar');
end $$;

-- ---------------------------------------------------------------- 7. "El primero disponible": quién lo ve, a qué hora llega y a quién se avisa
do $$
declare
  b1 uuid := '21000000-0000-0000-0000-0000000000b1'; b2 uuid := '21000000-0000-0000-0000-0000000000b2';
  ma date := pg_temp.dia(2); do_ date := pg_temp.dia(0);
  dom uuid := current_setting('pruebas.dom')::uuid; mar uuid := current_setting('pruebas.mar')::uuid; urg uuid := current_setting('pruebas.urg')::uuid;
  sdom uuid; smar uuid; surg uuid; j1 json; j2 json; x json; ok boolean; s public.match_solicitudes;
begin
  select solicitud_id into sdom from public.match_operaciones where id = dom;
  select solicitud_id into smar from public.match_operaciones where id = mar;
  select solicitud_id into surg from public.match_operaciones where id = urg;
  assert pg_temp.pago(dom) = 'aplicado' and pg_temp.pago(mar) = 'aplicado' and pg_temp.pago(urg) = 'aplicado', '7.1 Se pagan y salen al mapa';
  -- avisos: el del domingo solo a b1
  assert (select count(*) from public.notificaciones where usuario_id = b1 and titulo like 'Urgencia disponible%') = 2
     and (select count(*) from public.notificaciones where usuario_id = b2 and titulo like 'Urgencia disponible%') = 1
     and (select count(*) from public.notificaciones where usuario_id = b2 and titulo like 'Servicio disponible%') = 1,
     '7.2 Del domingo solo se avisa al que atiende urgencias; de los otros, a los dos';
  -- el del martes normal: se puede tomar hasta las 17:45
  select * into s from public.match_solicitudes where id = smar;
  assert s.limite_toma = pg_temp.a(ma, 17, 45), format('7.3 Normal: se puede tomar hasta la última llegada normal (17:45) y quedó %s', s.limite_toma);
  perform pg_temp.como(b1); j1 := public.servicios_disponibles(b1);
  perform pg_temp.como(b2); j2 := public.servicios_disponibles(b2);
  perform pg_temp.yo();
  assert (j1 ->> 'urgencias')::boolean and not (j2 ->> 'urgencias')::boolean, '7.4 El mapa sabe quién atiende urgencias';
  assert exists (select 1 from json_array_elements(j1 -> 'servicios') e where (e ->> 'id')::uuid = sdom and (e ->> 'urgencia')::boolean and (e ->> 'neto')::numeric = 1900)
     and not exists (select 1 from json_array_elements(j2 -> 'servicios') e where (e ->> 'id')::uuid = sdom),
     '7.5 El del domingo lo ve solo el que atiende urgencias (y le quedan 1.900)';
  select e into x from json_array_elements(j2 -> 'servicios') e where (e ->> 'id')::uuid = smar;
  assert (x ->> 'hasta')::timestamptz = pg_temp.a(ma, 18, 45) and (x ->> 'desde')::timestamptz = pg_temp.a(ma, 8), '7.6 Normal: se llega de 8 a 17:45';
  select e into x from json_array_elements(j1 -> 'servicios') e where (e ->> 'id')::uuid = smar;
  assert (x ->> 'hasta')::timestamptz = pg_temp.a(ma, 18, 45), '7.7 Aunque atienda urgencias, a uno cobrado normal se llega en horario normal';
  select e into x from json_array_elements(j1 -> 'servicios') e where (e ->> 'id')::uuid = surg;
  assert (x ->> 'hasta')::timestamptz = pg_temp.a(ma, 19), '7.8 Urgente de tarde: el que atiende urgencias puede llegar hasta las 18:00 (franja hasta las 19)';
  select e into x from json_array_elements(j2 -> 'servicios') e where (e ->> 'id')::uuid = surg;
  assert (x ->> 'hasta')::timestamptz = pg_temp.a(ma, 18, 45), '7.9 Urgente de tarde: el otro también lo ve, pero llega en horario normal';
  -- tomar
  perform pg_temp.como(b2);
  begin perform public.tomar_servicio(sdom, b2, pg_temp.a(do_, 10)); ok := false;
  exception when others then ok := sqlerrm like 'Este pedido es fuera de horario%'; end;
  assert ok, '7.10 El que no atiende urgencias no puede tomar el del domingo';
  begin perform public.tomar_servicio(surg, b2, pg_temp.a(ma, 18)); ok := false;
  exception when others then ok := sqlerrm like '%en horario normal'; end;
  assert ok, '7.11 Ni llegar a las 18 al urgente de tarde';
  perform pg_temp.como(b1);
  begin perform public.tomar_servicio(smar, b1, pg_temp.a(ma, 18, 30)); ok := false;
  exception when others then ok := sqlerrm like '%en horario normal'; end;
  assert ok, '7.12 Al cobrado normal no se llega fuera de horario, aunque atienda urgencias';
  x := public.tomar_servicio(sdom, b1, pg_temp.a(do_, 10));
  assert (select monto_acordado = 2500 and titulo like 'Urgencia%' from public.turnos where id = (x ->> 'turno')::uuid), '7.13 b1 toma el del domingo: urgencia en su agenda';
  x := public.tomar_servicio(surg, b1, pg_temp.a(ma, 18));
  assert x ->> 'turno' is not null, '7.14 b1 llega a las 18 al urgente de tarde';
  perform pg_temp.como(b2);
  x := public.tomar_servicio(smar, b2, pg_temp.a(ma, 15));
  perform pg_temp.yo();
  assert (select neto_profesional = 1100 and profesional_id = b2 from public.match_operaciones where id = mar), '7.15 b2 toma el del martes a las 15: normal';
  perform pg_temp.paso('7. el primero disponible: fuera de horario solo los que atienden urgencias y si se cobró urgencia');
end $$;

-- ---------------------------------------------------------------- 8. Urgencias apagadas: todo como antes
do $$
declare b2 uuid := '21000000-0000-0000-0000-0000000000b2'; ma date := pg_temp.dia(3); do_ date := pg_temp.dia(0); sol uuid; n int; r json; i uuid;
begin
  update public.configuracion set urgencia_activa = false where id = 1;
  sol := (pg_temp.pedido('Todo normal', '{"urgente": true}') ->> 'id')::uuid;
  assert (select bool_and(precio_visita = 1500) from public.match_invitaciones where solicitud_id = sol), '8.1 Sin urgencias, "urgente" no cambia el precio';
  perform pg_temp.aceptan(sol);
  select count(*) into n from pg_temp.horas(pg_temp.invitacion(sol, b2), ma) h where (h ->> 'importe')::numeric = 1500;
  assert n = 23, format('8.2 Todo su horario de trabajo (8 a 19), a 1.500: %s', n);
  i := pg_temp.invitacion(sol, b2);
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  assert (public.cotizar_primero('dia', do_, 'cualquiera', false) ->> 'importe')::numeric = 1500, '8.3 El domingo también es normal';
  r := public.elegir_profesional(i, pg_temp.a(ma, 19));
  perform pg_temp.yo();
  assert (r ->> 'importe')::numeric = 1500 and not (r ->> 'urgencia')::boolean, '8.4 Y se reserva a la tarifa normal';
  update public.configuracion set urgencia_activa = true where id = 1;
  perform pg_temp.paso('8. con las urgencias apagadas, todo funciona como antes');
end $$;

-- ---------------------------------------------------------------- 9. Cambiar los precios no toca lo ya creado; perfil público
do $$
declare dom uuid := current_setting('pruebas.dom')::uuid; j json;
begin
  perform pg_temp.como('21000000-0000-0000-0000-0000000000ad');
  perform public.guardar_config_match('{"precio_urgencia": 3000, "urgencia_ret_cliente": 400, "urgencia_ret_profesional": 400, "urgencia_neto_profesional": 2200}');
  perform pg_temp.yo();
  assert (select importe = 2500 and neto_profesional = 1900 from public.match_operaciones where id = dom), '9.1 Las operaciones ya creadas mantienen su importe';
  assert (select precio_urgencia = 3000 from public.configuracion where id = 1), '9.2 La configuración nueva quedó';
  perform pg_temp.como('21000000-0000-0000-0000-0000000000c1');
  assert (public.cotizar_primero('dia', pg_temp.dia(0), 'cualquiera', false) ->> 'importe')::numeric = 3000, '9.3 Y vale para lo nuevo';
  j := public.perfil_match('21000000-0000-0000-0000-0000000000b1');
  perform pg_temp.yo();
  assert (j ->> 'urgencias')::boolean and public._es_horario_normal((j ->> 'proximo')::timestamptz),
     '9.4 El perfil dice que atiende urgencias y el próximo horario que muestra es normal';
  perform pg_temp.paso('9. cambiar precios no toca lo ya creado; el perfil muestra si atiende urgencias');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 9 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

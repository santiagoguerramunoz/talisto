-- =====================================================================
--  TaListo!  ·  PRUEBAS de 24_cotizar_app.sql
--  Un cliente de la app pide "el primero disponible" y verifica: que se
--  publica sin pagar, que los técnicos lo pueden tomar o cotizar, que el
--  cliente ve las cotizaciones y recibe los avisos en la app (no por
--  WhatsApp), que al aceptar paga el precio del técnico + $ 500 y que al
--  técnico se le libera su precio, que si lo toman al precio base paga
--  $ 1.500, que el vencimiento sin técnico no cobra nada y que con
--  "cobro adelantado" vuelve a pagarse al publicar.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('24000000-0000-0000-0000-0000000000c1', null, '{"rol":"cliente","nombre":"Wanda WhatsApp","telefono":"59899111222"}'),
  ('24000000-0000-0000-0000-0000000000c2', 'c2@cot.test', '{"rol":"cliente","nombre":"Carla App"}'),
  ('24000000-0000-0000-0000-0000000000b1', 'b1@cot.test', '{"rol":"profesional","nombre":"Bruno Toma"}'),
  ('24000000-0000-0000-0000-0000000000b2', 'b2@cot.test', '{"rol":"profesional","nombre":"Beto Cotiza"}');
update public.profesionales set departamentos = '{Montevideo}', activo = true where id::text like '24000000-%';
insert into public.planes (usuario_id, plan, origen)
select u, 'pro', 'regalo' from unnest(array['24000000-0000-0000-0000-0000000000b1', '24000000-0000-0000-0000-0000000000b2']::uuid[]) u
on conflict (usuario_id) do update set plan = 'pro', origen = 'regalo', vence_en = null;
-- el cobro nuevo, como queda al correr el SQL 23
update public.configuracion set precio_visita = 1500, visita_ret_cliente = 500, visita_ret_profesional = 0, visita_neto_profesional = 1000,
  comision_visita = 500, precio_urgencia = 2500, urgencia_ret_cliente = 500, urgencia_ret_profesional = 0, urgencia_neto_profesional = 2000,
  mp_costo_profesional_pct = 0, duracion_visita_min = 60, pago_minutos = 30, solo_verificados = false, max_invitados = 10,
  primero_activo = true, primero_horas = 4, urgencia_activa = true, cotizacion_min = 300, cotizacion_max = 30000,
  horario_normal = '{"0": null, "1": {"desde": "08:00", "hasta": "18:00"}, "2": {"desde": "08:00", "hasta": "18:00"},
    "3": {"desde": "08:00", "hasta": "18:00"}, "4": {"desde": "08:00", "hasta": "18:00"},
    "5": {"desde": "08:00", "hasta": "18:00"}, "6": {"desde": "08:00", "hasta": "13:00"}}'
 where id = 1;
update public.match_tareas set ultima = null;
update public.match_perfiles set disponible = false where profesional_id::text not like '24000000-%';
insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias)
select p, true, array[(select id from public.categorias where slug = 'electricidad')], false
from unnest(array['24000000-0000-0000-0000-0000000000b1', '24000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros, urgencias = false;
insert into public.match_datos_cobro (profesional_id, banco, numero, titular)
select p, 'BROU', '001234567', 'Titular' from unnest(array['24000000-0000-0000-0000-0000000000b1', '24000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do nothing;
insert into public.horarios_trabajo (profesional_id, dia, hora_inicio, hora_fin)
select p, d, '08:00', '18:00' from unnest(array['24000000-0000-0000-0000-0000000000b1', '24000000-0000-0000-0000-0000000000b2']::uuid[]) p,
       generate_series(0, 6) d;
-- Wanda escribe por WhatsApp
insert into public.wa_conversaciones (telefono, usuario_id, nombre) values ('59899111222', '24000000-0000-0000-0000-0000000000c1', 'Wanda');

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
  perform set_config('talisto.canal', '', true);
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
create function pg_temp.dia(dow int) returns date language sql as $$
  select d::date from generate_series(public._hoy_uy() + 2, public._hoy_uy() + 8, interval '1 day') d where extract(dow from d)::int = dow limit 1;
$$;
create function pg_temp.a(f date, h int, m int default 0) returns timestamptz language sql as $$
  select (f + make_time(h, m, 0)) at time zone 'America/Montevideo';
$$;

update public.configuracion set primero_cobro_adelantado = false where id = 1;
-- Pedido de Carla desde la app, para el martes de la semana que viene
create function pg_temp.pedido(titulo text, extra jsonb default '{}') returns json language plpgsql as $$
declare r json;
begin
  perform pg_temp.como('24000000-0000-0000-0000-0000000000c2');
  r := public.crear_solicitud(jsonb_build_object(
         'categoria_id', (select id from public.categorias where slug = 'electricidad'), 'titulo', titulo,
         'descripcion', 'El aire está en frío pero no enfría nada', 'departamento', 'Montevideo', 'localidad', 'Pocitos',
         'direccion', 'Av. Brasil 2500', 'lat', -34.91, 'lng', -56.15, 'modo', 'primero', 'cuando', 'dia', 'fecha', pg_temp.dia(2),
         'franja', 'manana') || extra);
  perform pg_temp.yo();
  return r;
end $$;
create function pg_temp.ver(sol uuid) returns json language plpgsql as $$
declare j json;
begin
  perform pg_temp.como('24000000-0000-0000-0000-0000000000c2');
  j := public.solicitud_cliente(sol);
  perform pg_temp.yo();
  return j;
end $$;
create function pg_temp.lista(pro uuid) returns json language plpgsql as $$
declare j json;
begin
  perform pg_temp.como(pro);
  j := public.servicios_disponibles(pro) -> 'servicios';
  perform pg_temp.yo();
  return j;
end $$;

-- ---------------------------------------------------------------- 1. Se publica sin pagar
do $$
declare b1 uuid := '24000000-0000-0000-0000-0000000000b1'; r json; s public.match_solicitudes; v json; x json;
begin
  r := pg_temp.pedido('Aire que no enfría');
  select * into s from public.match_solicitudes where id = (r ->> 'id')::uuid;
  assert r ->> 'operacion' is null and r ->> 'pago' = 'al_tomar', '1.1 Desde la app no se paga al publicar';
  assert s.pago = 'al_tomar' and s.canal = 'app' and s.publicada_en is not null and s.limite_toma > now()
     and not exists (select 1 from public.match_operaciones where solicitud_id = s.id), '1.2 Sale al mapa enseguida, sin operación';
  v := pg_temp.ver(s.id);
  assert v -> 'solicitud' ->> 'pago' = 'al_tomar' and (v -> 'solicitud' ->> 'precio_base')::numeric = 1500
     and not (v -> 'solicitud' ->> 'tomada')::boolean and json_array_length(v -> 'cotizaciones') = 0,
     '1.3 El cliente ve que paga 1.500 cuando lo tomen y todavía no hay cotizaciones';
  select e into x from json_array_elements(pg_temp.lista(b1)) e where (e ->> 'id')::uuid = s.id;
  assert (x ->> 'cotizable')::boolean and (x ->> 'neto')::numeric = 1000, '1.4 El técnico lo puede tomar a 1.000 o cotizar';
  perform set_config('pruebas.sol', s.id::text, true);
  perform pg_temp.paso('1. el pedido de la app se publica sin pagar');
end $$;

-- ---------------------------------------------------------------- 2. El técnico cotiza más caro y el cliente lo ve
do $$
declare b2 uuid := '24000000-0000-0000-0000-0000000000b2'; c2 uuid := '24000000-0000-0000-0000-0000000000c2';
  sol uuid := current_setting('pruebas.sol')::uuid; r json; v json; k json;
begin
  perform pg_temp.como(b2);
  r := public.cotizar_servicio(sol, b2, 2500, pg_temp.a(pg_temp.dia(2), 10), 'Hay que subir a la azotea');
  perform pg_temp.yo();
  assert (r ->> 'importe')::numeric = 3000, '2.1 Cotiza 2.500: al cliente le sale 3.000 (con TaListo!)';
  assert exists (select 1 from public.notificaciones where usuario_id = c2 and titulo = 'Te mandaron una cotización' and url = '/match/solicitud/' || sol),
     '2.2 Al cliente le llega el aviso en la app';
  assert not exists (select 1 from public.wa_salida where usuario_id = c2), '2.3 Y no por WhatsApp (no lo usa)';
  v := pg_temp.ver(sol);
  k := v -> 'cotizaciones' -> 0;
  assert json_array_length(v -> 'cotizaciones') = 1 and (k ->> 'importe')::numeric = 3000 and k ->> 'mensaje' = 'Hay que subir a la azotea'
     and k -> 'profesional' ->> 'nombre' is not null, '2.4 El cliente ve la cotización con el técnico, el precio y el mensaje';
  perform set_config('pruebas.cot', k ->> 'id', true);
  perform pg_temp.paso('2. el técnico cotiza y el cliente la ve');
end $$;

-- ---------------------------------------------------------------- 3. El cliente acepta y paga; al técnico se le libera su precio
do $$
declare b2 uuid := '24000000-0000-0000-0000-0000000000b2'; c2 uuid := '24000000-0000-0000-0000-0000000000c2';
  sol uuid := current_setting('pruebas.sol')::uuid; r json; op public.match_operaciones; s public.match_solicitudes;
begin
  perform pg_temp.como(c2);
  r := public.aceptar_cotizacion(current_setting('pruebas.cot')::uuid);
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.estado = 'pendiente_pago' and op.importe = 3000 and op.neto_profesional = 2500 and op.ret_cliente = 500 and op.profesional_id = b2,
     '3.1 Queda a pagar 3.000: 2.500 del técnico + 500 de TaListo!';
  assert json_array_length(pg_temp.ver(sol) -> 'cotizaciones') = 0 and (pg_temp.ver(sol) -> 'solicitud' ->> 'tomada')::boolean,
     '3.2 Ya no muestra cotizaciones: el pedido tiene técnico';
  assert pg_temp.pago(op.id) = 'aplicado', '3.3 El cliente paga';
  select * into op from public.match_operaciones where id = op.id;
  select * into s from public.match_solicitudes where id = sol;
  assert op.estado = 'reserva_confirmada' and s.estado = 'reservada' and (select estado from public.turnos where id = op.turno_id) = 'confirmado',
     '3.4 La visita queda confirmada en la agenda del técnico';
  perform public._confirmar_operacion(op.id, 'automatica');
  select * into op from public.match_operaciones where id = op.id;
  assert op.neto_profesional = 2500 and op.estado <> 'reserva_confirmada', '3.5 Con el visto bueno se le liberan los 2.500 al técnico';
  perform pg_temp.paso('3. el cliente acepta la cotización y paga');
end $$;

-- ---------------------------------------------------------------- 4. Si lo toman al precio base, paga 1.500 y le avisa la app
do $$
declare b1 uuid := '24000000-0000-0000-0000-0000000000b1'; c2 uuid := '24000000-0000-0000-0000-0000000000c2'; sol uuid; r json; op public.match_operaciones;
begin
  sol := (pg_temp.pedido('Enchufe quemado') ->> 'id')::uuid;
  perform pg_temp.como(b1);
  r := public.tomar_servicio(sol, b1, pg_temp.a(pg_temp.dia(2), 11));
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert (r ->> 'pago_pendiente')::boolean and op.estado = 'pendiente_pago' and op.importe = 1500 and op.neto_profesional = 1000,
     '4.1 Lo toma al precio base: el cliente paga 1.500';
  assert exists (select 1 from public.notificaciones where usuario_id = c2 and titulo = 'Un técnico tomó tu pedido: falta pagar'
                  and cuerpo like '%1.500%' and url = '/match/solicitud/' || sol), '4.2 Al cliente le llega el aviso para pagar en la app';
  assert not exists (select 1 from public.wa_salida where usuario_id = c2), '4.3 Nada por WhatsApp';
  perform pg_temp.paso('4. lo toman al precio base y el cliente recibe el aviso');
end $$;

-- ---------------------------------------------------------------- 5. Si nadie lo toma, vence sin cobrar nada
do $$
declare c2 uuid := '24000000-0000-0000-0000-0000000000c2'; sol uuid;
begin
  sol := (pg_temp.pedido('Luz del patio') ->> 'id')::uuid;
  update public.match_solicitudes set limite_toma = now() - interval '1 minute' where id = sol;
  perform public._vencer_primero();
  assert (select estado from public.match_solicitudes where id = sol) = 'vencida'
     and not exists (select 1 from public.match_devoluciones d join public.match_operaciones o on o.id = d.operacion_id where o.solicitud_id = sol),
     '5.1 Vence sin devoluciones: no se había cobrado nada';
  assert exists (select 1 from public.notificaciones where usuario_id = c2 and url = '/match/solicitud/' || sol
                  and cuerpo like '%No se te cobró nada. Podés pedirlo de nuevo%'), '5.2 El aviso es para la app (no dice "escribinos HOLA")';
  perform pg_temp.paso('5. sin técnico vence sin cobrar');
end $$;

-- ---------------------------------------------------------------- 6. Con "cobro adelantado" vuelve a pagarse al publicar
do $$
declare r json;
begin
  update public.configuracion set primero_cobro_adelantado = true where id = 1;
  r := pg_temp.pedido('Como antes');
  assert r ->> 'pago' = 'al_publicar' and r ->> 'operacion' is not null, '6.1 Con la opción prendida se paga al publicar';
  update public.configuracion set primero_cobro_adelantado = false where id = 1;
  perform pg_temp.paso('6. el cobro adelantado sigue disponible');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 6 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

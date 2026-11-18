-- =====================================================================
--  TaListo!  ·  PRUEBAS de 23_whatsapp_cotizaciones.sql
--  Crea un cliente que escribe por WhatsApp y dos técnicos Pro, y verifica:
--  el nuevo cobro (precio del técnico + $ 500, Mercado Pago a cargo de
--  TaListo!), la cotización al aceptar una solicitud, el pedido de WhatsApp
--  (se publica sin pagar, el técnico lo toma y el cliente paga), que sin
--  pago vuelve al mapa, las cotizaciones del técnico, el cobro por Abitab,
--  los avisos que salen por WhatsApp y que el servidor es el único que usa
--  las funciones de WhatsApp. Usa un martes fijo de la semana que viene.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('23000000-0000-0000-0000-0000000000c1', null, '{"rol":"cliente","nombre":"Wanda WhatsApp","telefono":"59899111222"}'),
  ('23000000-0000-0000-0000-0000000000c2', 'c2@cot.test', '{"rol":"cliente","nombre":"Carla App"}'),
  ('23000000-0000-0000-0000-0000000000b1', 'b1@cot.test', '{"rol":"profesional","nombre":"Bruno Toma"}'),
  ('23000000-0000-0000-0000-0000000000b2', 'b2@cot.test', '{"rol":"profesional","nombre":"Beto Cotiza"}');
update public.profesionales set departamentos = '{Montevideo}', activo = true where id::text like '23000000-%';
insert into public.planes (usuario_id, plan, origen)
select u, 'pro', 'regalo' from unnest(array['23000000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000b2']::uuid[]) u
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
update public.match_perfiles set disponible = false where profesional_id::text not like '23000000-%';
insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias)
select p, true, array[(select id from public.categorias where slug = 'electricidad')], false
from unnest(array['23000000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros, urgencias = false;
insert into public.match_datos_cobro (profesional_id, banco, numero, titular)
select p, 'BROU', '001234567', 'Titular' from unnest(array['23000000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do nothing;
insert into public.horarios_trabajo (profesional_id, dia, hora_inicio, hora_fin)
select p, d, '08:00', '18:00' from unnest(array['23000000-0000-0000-0000-0000000000b1', '23000000-0000-0000-0000-0000000000b2']::uuid[]) p,
       generate_series(0, 6) d;
-- Wanda escribe por WhatsApp
insert into public.wa_conversaciones (telefono, usuario_id, nombre) values ('59899111222', '23000000-0000-0000-0000-0000000000c1', 'Wanda');

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
-- Pedido por WhatsApp de Wanda (lo hace el servidor), para el martes de mañana
create function pg_temp.pedido_wa(titulo text) returns uuid language plpgsql as $$
declare r json;
begin
  r := public.wa_crear_pedido('23000000-0000-0000-0000-0000000000c1', jsonb_build_object(
         'categoria_id', (select id from public.categorias where slug = 'electricidad'), 'titulo', titulo,
         'descripcion', 'Salta la llave del baño cuando prendo el calefón', 'departamento', 'Montevideo', 'localidad', 'Pocitos',
         'direccion', 'Av. Brasil 2500 apto 3', 'cuando', 'dia', 'fecha', pg_temp.dia(2), 'franja', 'manana'));
  perform pg_temp.yo();
  return (r ->> 'id')::uuid;
end $$;
create function pg_temp.lista(pro uuid) returns json language plpgsql as $$
declare j json;
begin
  perform pg_temp.como(pro);
  j := public.servicios_disponibles(pro) -> 'servicios';
  perform pg_temp.yo();
  return j;
end $$;

-- ---------------------------------------------------------------- 1. El nuevo cobro
do $$
declare t record;
begin
  select * into t from public._tarifa(false);
  assert t.importe = 1500 and t.ret_cliente = 500 and t.ret_profesional = 0 and t.neto = 1000, '1.1 Visita: 1.000 del técnico + 500 de TaListo! = 1.500';
  select * into t from public._tarifa(true);
  assert t.importe = 2500 and t.ret_cliente = 500 and t.neto = 2000, '1.2 Urgencia: 2.000 + 500 = 2.500';
  assert (select cobro_v2_aplicado and mp_costo_profesional_pct = 0 from public.configuracion where id = 1),
     '1.3 La comisión de Mercado Pago la paga TaListo! y el cambio se aplica una sola vez';
  perform pg_temp.paso('1. nuevo cobro: precio del técnico + 500 de TaListo!');
end $$;

-- ---------------------------------------------------------------- 2. El profesional pone su precio al aceptar una solicitud
do $$
declare
  b1 uuid := '23000000-0000-0000-0000-0000000000b1'; b2 uuid := '23000000-0000-0000-0000-0000000000b2'; c2 uuid := '23000000-0000-0000-0000-0000000000c2';
  sol uuid; i1 uuid; i2 uuid; ok boolean; h json; r json; op public.match_operaciones;
begin
  perform pg_temp.como(c2);
  sol := (public.crear_solicitud(jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'electricidad'),
           'titulo', 'Cambiar el tablero', 'descripcion', 'Quiero cambiar el tablero viejo por uno nuevo', 'departamento', 'Montevideo',
           'localidad', 'Centro', 'direccion', 'Soriano 1000')) ->> 'id')::uuid;
  perform pg_temp.yo();
  select id into i1 from public.match_invitaciones where solicitud_id = sol and profesional_id = b1;
  select id into i2 from public.match_invitaciones where solicitud_id = sol and profesional_id = b2;
  perform pg_temp.como(b1);
  begin perform public.responder_invitacion(i1, true, null, 100); ok := false;
  exception when others then ok := sqlerrm like 'Tu precio tiene que estar entre%'; end;
  assert ok, '2.1 Un precio fuera del rango no se acepta';
  perform public.responder_invitacion(i1, true, 'Llevo los materiales', 1800);
  perform pg_temp.como(b2);
  perform public.responder_invitacion(i2, true, null);
  perform pg_temp.yo();
  assert (select precio_profesional = 1800 and precio_visita = 2300 from public.match_invitaciones where id = i1),
     '2.2 Con su precio: el cliente ve 1.800 + 500 = 2.300';
  assert (select precio_profesional is null and precio_visita = 1500 from public.match_invitaciones where id = i2), '2.3 Sin precio: la visita base';
  perform pg_temp.como(c2);
  h := public.horarios_visita_precios(i1, pg_temp.dia(2), 1);
  r := public.elegir_profesional(i1, (h -> 0 ->> 'desde')::timestamptz);
  perform pg_temp.yo();
  assert (h -> 0 ->> 'importe')::numeric = 2300, '2.4 Los horarios muestran su precio';
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.importe = 2300 and op.ret_cliente = 500 and op.ret_profesional = 0 and op.neto_profesional = 1800,
     '2.5 Al reservar: el técnico recibe 1.800 y TaListo! 500';
  assert pg_temp.pago(op.id) = 'aplicado', '2.6 Se paga';
  select * into op from public.match_operaciones where id = op.id;
  assert op.mp_costo > 0 and op.mp_costo_profesional = 0 and op.mp_costo_talisto = op.mp_costo,
     '2.7 La comisión de Mercado Pago la paga TaListo!: el técnico no pierde nada';
  perform pg_temp.paso('2. cotización al aceptar una solicitud');
end $$;

-- ---------------------------------------------------------------- 3. Pedido por WhatsApp: se publica sin pagar
do $$
declare b1 uuid := '23000000-0000-0000-0000-0000000000b1'; sol uuid; s public.match_solicitudes; x json; ok boolean;
begin
  sol := pg_temp.pedido_wa('Salta la llave');
  select * into s from public.match_solicitudes where id = sol;
  assert s.modo = 'primero' and s.pago = 'al_tomar' and s.canal = 'whatsapp' and s.publicada_en is not null and not s.urgencia_tarifa
     and s.lat is null, '3.1 Queda publicado, para pagar al tomarlo, aunque no tenga punto en el mapa';
  assert not exists (select 1 from public.match_operaciones where solicitud_id = sol), '3.2 Todavía no hay nada para pagar';
  assert exists (select 1 from public.notificaciones where usuario_id = b1 and titulo like 'Servicio para tomar o cotizar%'),
     '3.3 Se avisa a los técnicos del rubro y la zona';
  select e into x from json_array_elements(pg_temp.lista(b1)) e where (e ->> 'id')::uuid = sol;
  assert (x ->> 'cotizable')::boolean and (x ->> 'neto')::numeric = 1000 and (x ->> 'importe')::numeric = 1500 and x ->> 'pago' = 'al_tomar',
     '3.4 El técnico lo ve para tomar a 1.000 o cotizar';
  perform pg_temp.como('23000000-0000-0000-0000-0000000000c2');
  begin
    perform public.crear_solicitud(jsonb_build_object('categoria_id', (select id from public.categorias where slug = 'electricidad'),
      'titulo', 'Desde la app', 'descripcion', 'Probando que en la app se paga al publicar', 'departamento', 'Montevideo',
      'direccion', 'Soriano 1000', 'modo', 'primero', 'cuando', 'dia', 'fecha', pg_temp.dia(2), 'franja', 'manana', 'pago', 'al_tomar'));
    ok := false;
  exception when others then ok := sqlerrm like 'Poné la dirección y marcala en el mapa%'; end;
  perform pg_temp.yo();
  assert ok, '3.5 Desde la app no se puede pedir "pagar al tomar" ni sin mapa';
  perform set_config('pruebas.sol', sol::text, true);
  perform pg_temp.paso('3. pedido por WhatsApp: se publica sin pagar');
end $$;

-- ---------------------------------------------------------------- 4. Un técnico lo toma y el cliente paga
do $$
declare b1 uuid := '23000000-0000-0000-0000-0000000000b1'; b2 uuid := '23000000-0000-0000-0000-0000000000b2';
  sol uuid := current_setting('pruebas.sol')::uuid; r json; op public.match_operaciones; s public.match_solicitudes;
begin
  perform pg_temp.como(b1);
  r := public.tomar_servicio(sol, b1, pg_temp.a(pg_temp.dia(2), 10));
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  select * into s from public.match_solicitudes where id = sol;
  assert (r ->> 'pago_pendiente')::boolean and op.estado = 'pendiente_pago' and op.importe = 1500 and op.neto_profesional = 1000
     and op.profesional_id = b1, '4.1 Queda reservado para b1, a pagar 1.500';
  assert (select estado from public.turnos where id = op.turno_id) = 'pendiente' and s.estado = 'abierta' and s.profesional_id = b1,
     '4.2 La hora queda reservada en su agenda hasta que pague';
  assert exists (select 1 from public.wa_salida where usuario_id = s.cliente_id and operacion_pago = op.id and texto like '%tomó tu pedido%'),
     '4.3 Al cliente le sale por WhatsApp el aviso con el link de pago';
  assert not exists (select 1 from json_array_elements(pg_temp.lista(b2)) e where (e ->> 'id')::uuid = sol), '4.4 Los demás ya no lo ven';
  assert pg_temp.pago(op.id) = 'aplicado', '4.5 El cliente paga';
  select * into op from public.match_operaciones where id = op.id;
  select * into s from public.match_solicitudes where id = sol;
  assert op.estado = 'reserva_confirmada' and s.estado = 'reservada' and (select estado from public.turnos where id = op.turno_id) = 'confirmado'
     and op.mp_costo_profesional = 0, '4.6 Pago confirmado: la visita queda confirmada';
  assert exists (select 1 from public.wa_salida where usuario_id = s.cliente_id and texto like 'Pago confirmado%'),
     '4.7 Y el aviso del pago también le llega por WhatsApp';
  assert exists (select 1 from public.clientes where profesional_id = b1 and usuario_id = s.cliente_id and nombre = 'Wanda WhatsApp'),
     '4.8 El cliente de WhatsApp entra a la agenda del técnico';
  perform pg_temp.paso('4. el técnico lo toma y el cliente paga');
end $$;

-- ---------------------------------------------------------------- 5. Si no paga a tiempo, vuelve al mapa
do $$
declare b1 uuid := '23000000-0000-0000-0000-0000000000b1'; b2 uuid := '23000000-0000-0000-0000-0000000000b2'; sol uuid; r json; op uuid;
begin
  sol := pg_temp.pedido_wa('Se cortó la luz');
  perform pg_temp.como(b1);
  r := public.tomar_servicio(sol, b1, pg_temp.a(pg_temp.dia(2), 12));
  perform pg_temp.yo();
  op := (r ->> 'operacion')::uuid;
  update public.match_operaciones set vence_pago_en = now() - interval '1 minute' where id = op;
  update public.match_tareas set ultima = null;
  perform public.match_procesar_vencidos();
  assert (select estado from public.match_operaciones where id = op) = 'cancelado'
     and (select estado from public.turnos where turnos.id = (select turno_id from public.match_operaciones where id = op)) = 'cancelado',
     '5.1 La reserva sin pagar se cancela y se libera la hora';
  assert (select profesional_id is null and estado = 'abierta' from public.match_solicitudes where id = sol), '5.2 El pedido vuelve al mapa';
  assert exists (select 1 from json_array_elements(pg_temp.lista(b2)) e where (e ->> 'id')::uuid = sol), '5.3 Y otro técnico lo puede tomar';
  perform pg_temp.como('23000000-0000-0000-0000-0000000000c1');
  perform public.cancelar_solicitud(sol, 'Ya no hace falta');
  perform pg_temp.yo();
  perform pg_temp.paso('5. si no paga a tiempo, vuelve al mapa');
end $$;

-- ---------------------------------------------------------------- 6. Cotizaciones: el técnico manda su precio y el cliente elige
do $$
declare b1 uuid := '23000000-0000-0000-0000-0000000000b1'; b2 uuid := '23000000-0000-0000-0000-0000000000b2'; c1 uuid := '23000000-0000-0000-0000-0000000000c1';
  sol uuid; k1 json; k2 json; e json; r json; op public.match_operaciones; ok boolean; martes date := pg_temp.dia(2);
begin
  sol := pg_temp.pedido_wa('Instalar un enchufe');
  perform pg_temp.como(b2);
  begin perform public.cotizar_servicio(sol, b2, 50, pg_temp.a(martes, 11)); ok := false;
  exception when others then ok := sqlerrm like 'La cotización tiene que estar entre%'; end;
  assert ok, '6.1 Una cotización fuera del rango no se acepta';
  begin perform public.cotizar_servicio(sol, b2, 2000, pg_temp.a(martes, 16)); ok := false;
  exception when others then ok := sqlerrm like 'Elegí una hora de llegada%'; end;
  assert ok, '6.2 Ni una hora fuera de lo que pidió el cliente (de mañana)';
  k2 := public.cotizar_servicio(sol, b2, 2000, pg_temp.a(martes, 11), 'Llevo el enchufe');
  perform pg_temp.como(b1);
  k1 := public.cotizar_servicio(sol, b1, 1800, pg_temp.a(martes, 9));
  perform pg_temp.yo();
  assert (k2 ->> 'importe')::numeric = 2500 and (k1 ->> 'importe')::numeric = 2300, '6.3 Cada cotización: su precio + 500';
  assert exists (select 1 from public.wa_salida where usuario_id = c1 and texto like '%Cotización para tu pedido%Beto Cotiza%2.500%'),
     '6.4 Al cliente le llega cada cotización por WhatsApp';
  e := public.wa_estado(c1);
  assert json_array_length(e -> 'cotizaciones') = 2 and (e -> 'cotizaciones' -> 0 ->> 'importe')::numeric = 2300,
     '6.5 El bot ve las dos, de la más barata a la más cara';
  r := public.wa_aceptar_cotizacion(c1, (k2 ->> 'cotizacion')::uuid);
  perform pg_temp.yo();
  select * into op from public.match_operaciones where id = (r ->> 'operacion')::uuid;
  assert op.importe = 2500 and op.neto_profesional = 2000 and op.ret_cliente = 500 and op.profesional_id = b2 and op.estado = 'pendiente_pago',
     '6.6 Elige la de b2: paga 2.500, b2 recibe 2.000';
  assert (select estado from public.match_cotizaciones where id = (k2 ->> 'cotizacion')::uuid) = 'aceptada'
     and exists (select 1 from public.wa_salida where usuario_id = c1 and operacion_pago = op.id), '6.7 Y le sale el link para pagar';
  assert not exists (select 1 from json_array_elements(pg_temp.lista(b1)) x where (x ->> 'id')::uuid = sol), '6.8 Los demás ya no lo ven';
  e := public.wa_estado(c1);
  assert json_array_length(e -> 'cotizaciones') = 0 and e -> 'operacion' ->> 'estado' = 'pendiente_pago', '6.9 El bot sabe que falta pagar';
  r := json_build_object('res', pg_temp.pago(op.id));
  assert r ->> 'res' = 'aplicado' and (select estado from public.match_solicitudes where id = sol) = 'reservada', '6.10 Paga y queda confirmado';
  perform pg_temp.paso('6. cotizaciones: el técnico manda su precio y el cliente elige');
end $$;

-- ---------------------------------------------------------------- 7. Cobro por Abitab
do $$
declare b1 uuid := '23000000-0000-0000-0000-0000000000b1'; ok boolean; d public.match_datos_cobro;
begin
  perform pg_temp.como(b1);
  begin perform public.guardar_match_perfil(b1, jsonb_build_object('disponible', true, 'rubros', array[(select id from public.categorias where slug = 'electricidad')],
          'cobro', jsonb_build_object('metodo', 'abitab', 'titular', 'Bruno Toma'))); ok := false;
  exception when others then ok := sqlerrm like 'Para cobrar por Abitab poné la cédula%'; end;
  assert ok, '7.1 Por Abitab hace falta la cédula';
  perform public.guardar_match_perfil(b1, jsonb_build_object('disponible', true, 'rubros', array[(select id from public.categorias where slug = 'electricidad')],
          'cobro', jsonb_build_object('metodo', 'abitab', 'titular', 'Bruno Toma', 'documento', '1.234.567-8')));
  perform pg_temp.yo();
  select * into d from public.match_datos_cobro where profesional_id = b1;
  assert d.metodo = 'abitab' and d.banco = 'Abitab' and d.numero is null and d.documento = '1.234.567-8', '7.2 Queda para cobrar por Abitab';
  perform pg_temp.como(b1);
  perform public.guardar_match_perfil(b1, jsonb_build_object('disponible', true, 'rubros', array[(select id from public.categorias where slug = 'electricidad')],
          'cobro', jsonb_build_object('metodo', 'banco', 'banco', 'Itaú', 'numero', '7654321', 'titular', 'Bruno Toma')));
  perform pg_temp.yo();
  assert (select metodo = 'banco' and banco = 'Itaú' from public.match_datos_cobro where profesional_id = b1), '7.3 Y puede volver a la cuenta bancaria';
  perform pg_temp.paso('7. cobro por cuenta bancaria o por Abitab');
end $$;

-- ---------------------------------------------------------------- 8. Avisos por WhatsApp y funciones del servidor
do $$
declare c1 uuid := '23000000-0000-0000-0000-0000000000c1'; c2 uuid := '23000000-0000-0000-0000-0000000000c2'; n int; m int; ok boolean;
begin
  assert not exists (select 1 from public.wa_salida where usuario_id = c2), '8.1 Al cliente de la app no le sale nada por WhatsApp';
  select count(*) into n from public.wa_salida where enviado_en is null;
  select count(*) into m from public.wa_tomar_salida(100) w where w.telefono = '59899111222';
  assert m = n and m > 0, '8.2 El servidor toma los avisos pendientes, con el teléfono';
  update public.wa_salida set enviado_en = now() where usuario_id = c1;
  assert not exists (select 1 from public.wa_tomar_salida(100)), '8.3 Los ya enviados no se vuelven a mandar';
  perform pg_temp.como(c1);
  begin perform public.wa_estado(c1); ok := false; exception when others then ok := true; end;
  begin perform public.wa_crear_pedido(c1, '{}'); ok := ok and false; exception when others then ok := ok and true; end;
  perform pg_temp.yo();
  assert ok, '8.4 Desde la app nadie puede usar las funciones del servidor de WhatsApp';
  perform pg_temp.como(c1);
  select count(*) into n from public.bot_rubros;
  perform pg_temp.yo();
  assert n = 0, '8.5 Las preguntas del bot las ve y edita solo el admin';
  perform pg_temp.paso('8. avisos por WhatsApp y funciones del servidor');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 8 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

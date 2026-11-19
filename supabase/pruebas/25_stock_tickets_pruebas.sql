-- =====================================================================
--  TaListo!  ·  PRUEBAS de 25_stock_tickets.sql
--  Una empresa Business con un técnico. Instalación de 4 cámaras, DVR,
--  disco duro y fuente: Stock asigna los materiales al ticket (quedan
--  reservados y salen del depósito), el técnico los procesa ítem por ítem,
--  lo que no se procesó queda pendiente de devolución al terminar, y al
--  gestionar la devolución el ticket queda en 0. También: nadie más los
--  procesa, no se procesa de más, la anulación y la bitácora.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('25000000-0000-0000-0000-0000000000b1', 'b1@stock.test', '{"rol":"profesional","nombre":"Instaluy"}'),
  ('25000000-0000-0000-0000-0000000000a1', 'a1@stock.test', '{"rol":"profesional","nombre":"Tito Técnico"}'),
  ('25000000-0000-0000-0000-0000000000a2', 'a2@stock.test', '{"rol":"profesional","nombre":"Otra Persona"}');
insert into public.planes (usuario_id, plan, origen) values ('25000000-0000-0000-0000-0000000000b1', 'business', 'regalo')
on conflict (usuario_id) do update set plan = 'business', origen = 'regalo', vence_en = null, max_cuentas = null;
update public.configuracion set business_cuentas_defecto = 5 where id = 1;

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
create function pg_temp.mat(nombre text) returns uuid language sql as $$
  select id from public.materiales where profesional_id = '25000000-0000-0000-0000-0000000000b1' and nombre = $1;
$$;
-- Cuánto hay de un material en un lugar
create function pg_temp.hay(ubic uuid, nombre text) returns numeric language sql as $$
  select coalesce((select cantidad from public.stock where ubicacion_id = ubic and material_id = pg_temp.mat(nombre)), 0);
$$;
create function pg_temp.ver(quien uuid, tur uuid) returns json language plpgsql as $$
declare j json;
begin
  perform pg_temp.como(quien);
  j := public.stock_de_trabajo('25000000-0000-0000-0000-0000000000b1', 'turno', tur);
  perform pg_temp.yo();
  return j;
end $$;
create function pg_temp.procesar(quien uuid, tur uuid, nombre text, n numeric) returns text language plpgsql as $$
declare m uuid := pg_temp.mat(nombre);  -- se busca antes de cambiar de usuario
begin
  perform pg_temp.como(quien);
  begin
    perform public.stock_procesar('25000000-0000-0000-0000-0000000000b1', 'turno', tur,
                                  jsonb_build_array(jsonb_build_object('material_id', m, 'cantidad', n)));
  exception when others then
    perform pg_temp.yo();
    return sqlerrm;
  end;
  perform pg_temp.yo();
  return null;
end $$;

-- Empresa con un técnico (Producción), materiales y stock inicial en el depósito
do $$
declare b uuid := '25000000-0000-0000-0000-0000000000b1'; t uuid := '25000000-0000-0000-0000-0000000000a1'; e uuid; cod text; dep uuid;
begin
  perform pg_temp.como(b);
  e := public.crear_mi_empresa('Instaluy');
  insert into public.invitaciones (empresa_id, roles)
  values (e, array[(select id from public.roles_empresa where empresa_id = e and nombre = 'Producción')]) returning codigo into cod;
  perform pg_temp.yo();
  perform pg_temp.como(t);
  perform public.aceptar_invitacion(cod);
  perform pg_temp.yo();
  insert into public.materiales (profesional_id, nombre, unidad) values
    (b, 'Cámara IP 4MP', 'u'), (b, 'DVR 8 canales', 'u'), (b, 'Disco duro 1TB', 'u'), (b, 'Fuente 12V 10A', 'u');
  dep := public._stock_principal(b);
  perform pg_temp.como(b);
  perform public.stock_ingresar(b, dep, jsonb_build_array(
    jsonb_build_object('material_id', pg_temp.mat('Cámara IP 4MP'), 'cantidad', 10),
    jsonb_build_object('material_id', pg_temp.mat('DVR 8 canales'), 'cantidad', 2),
    jsonb_build_object('material_id', pg_temp.mat('Disco duro 1TB'), 'cantidad', 2),
    jsonb_build_object('material_id', pg_temp.mat('Fuente 12V 10A'), 'cantidad', 3)), 'inicial');
  perform pg_temp.yo();
  perform set_config('pruebas.dep', dep::text, true);
end $$;

-- El trabajo agendado (ticket de la agenda), asignado al técnico, con lo previsto del presupuesto
insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, asignado_a, con_materiales, materiales)
values ('25000000-0000-0000-0000-0000000000b1', 'Instalación 4 cámaras', now() + interval '1 day', now() + interval '1 day 4 hours',
        'trabajo', 'confirmado', '25000000-0000-0000-0000-0000000000a1', true,
        jsonb_build_array(jsonb_build_object('item', 'Cámara IP 4MP', 'cantidad', 4, 'unidad', 'u'),
                          jsonb_build_object('item', 'DVR 8 canales', 'cantidad', 1, 'unidad', 'u'),
                          jsonb_build_object('item', 'Disco duro 1TB', 'cantidad', 1, 'unidad', 'u'),
                          jsonb_build_object('item', 'Fuente 12V 10A', 'cantidad', 1, 'unidad', 'u')));

-- ---------------------------------------------------------------- 1. Stock asigna los materiales al ticket
do $$
declare b uuid := '25000000-0000-0000-0000-0000000000b1'; dep uuid := current_setting('pruebas.dep')::uuid; tur uuid; v json; ubic uuid;
begin
  select id into tur from public.turnos where profesional_id = b and titulo = 'Instalación 4 cámaras';
  v := pg_temp.ver(b, tur);
  assert json_array_length(v -> 'previstos') = 4
     and not exists (select 1 from json_array_elements(v -> 'previstos') p where p ->> 'material_id' is null),
     '1.1 Lo previsto en el ticket se reconoce en el stock (también en trabajos de la agenda)';
  perform pg_temp.como(b);
  perform public.stock_a_trabajo(b, dep, 'turno', tur, jsonb_build_array(
    jsonb_build_object('material_id', pg_temp.mat('Cámara IP 4MP'), 'cantidad', 4),
    jsonb_build_object('material_id', pg_temp.mat('DVR 8 canales'), 'cantidad', 1),
    jsonb_build_object('material_id', pg_temp.mat('Disco duro 1TB'), 'cantidad', 1),
    jsonb_build_object('material_id', pg_temp.mat('Fuente 12V 10A'), 'cantidad', 1)), 'Reserva para la instalación');
  perform pg_temp.yo();
  ubic := (select id from public.ubicaciones_stock where turno_id = tur);
  assert pg_temp.hay(dep, 'Cámara IP 4MP') = 6 and pg_temp.hay(dep, 'DVR 8 canales') = 1, '1.2 Salen del depósito';
  assert pg_temp.hay(ubic, 'Cámara IP 4MP') = 4 and pg_temp.hay(ubic, 'Fuente 12V 10A') = 1, '1.3 Quedan reservados en el ticket';
  v := pg_temp.ver('25000000-0000-0000-0000-0000000000a1', tur);
  assert json_array_length(v -> 'materiales') = 4 and json_array_length(v -> 'procesados') = 0 and not (v ->> 'cerrado')::boolean,
     '1.4 El técnico ve los 4 materiales reservados, sin procesar';
  perform set_config('pruebas.tur', tur::text, true);
  perform set_config('pruebas.ubic', ubic::text, true);
  perform pg_temp.paso('1. Stock asigna los materiales al ticket');
end $$;

-- ---------------------------------------------------------------- 2. El técnico procesa ítem por ítem
do $$
declare t uuid := '25000000-0000-0000-0000-0000000000a1'; tur uuid := current_setting('pruebas.tur')::uuid;
  ubic uuid := current_setting('pruebas.ubic')::uuid; v json; e text;
begin
  assert pg_temp.procesar(t, tur, 'Cámara IP 4MP', 3) is null, '2.1 Procesa 3 de las 4 cámaras (una no se instaló)';
  assert pg_temp.procesar(t, tur, 'DVR 8 canales', 1) is null and pg_temp.procesar(t, tur, 'Disco duro 1TB', 1) is null
     and pg_temp.procesar(t, tur, 'Fuente 12V 10A', 1) is null, '2.2 Procesa el DVR, el disco y la fuente';
  e := pg_temp.procesar(t, tur, 'Cámara IP 4MP', 2);
  assert e like 'No alcanza%', '2.3 No puede procesar más de lo que tiene el ticket: ' || coalesce(e, 'pasó');
  e := pg_temp.procesar('25000000-0000-0000-0000-0000000000a2', tur, 'Cámara IP 4MP', 1);
  assert e is not null, '2.4 Alguien de afuera no puede procesar';
  assert pg_temp.hay(ubic, 'Cámara IP 4MP') = 1 and pg_temp.hay(ubic, 'DVR 8 canales') = 0, '2.5 En el ticket queda solo la cámara sin procesar';
  v := pg_temp.ver(t, tur);
  assert json_array_length(v -> 'materiales') = 1 and json_array_length(v -> 'procesados') = 4
     and (select (p ->> 'cantidad')::numeric from json_array_elements(v -> 'procesados') p where p ->> 'nombre' = 'Cámara IP 4MP') = 3,
     '2.6 Se ve lo procesado (3 cámaras, DVR, disco, fuente) y lo que queda';
  assert exists (select 1 from public.bitacora where turno_id = tur and accion like 'Materiales procesados%'),
     '2.7 Queda en la bitácora del ticket';
  perform pg_temp.paso('2. el técnico procesa ítem por ítem');
end $$;

-- ---------------------------------------------------------------- 3. Al terminar, lo no procesado queda pendiente de devolución
do $$
declare b uuid := '25000000-0000-0000-0000-0000000000b1'; tur uuid := current_setting('pruebas.tur')::uuid;
  ubic uuid := current_setting('pruebas.ubic')::uuid; v json; l json; m json;
begin
  update public.turnos set estado = 'realizado', cerrado_en = now() where id = tur;
  v := pg_temp.ver(b, tur);
  assert (v ->> 'cerrado')::boolean and json_array_length(v -> 'materiales') = 1, '3.1 Trabajo terminado con 1 cámara pendiente de devolución';
  perform pg_temp.como(b);
  select x into l from json_array_elements(public.stock_existencias(b) -> 'lugares') x where (x ->> 'id')::uuid = ubic;
  select x into m from json_array_elements(public.stock_existencias(b) -> 'materiales') x where x ->> 'nombre' = 'Cámara IP 4MP';
  perform pg_temp.yo();
  assert l is not null and (l ->> 'trabajo_cerrado')::boolean and (l ->> 'materiales')::int = 1 and l ->> 'asignado' = 'Tito Técnico',
     '3.2 Stock lo ve en la lista de pendientes de devolución';
  assert (m ->> 'en_obra')::numeric = 1, '3.3 La cámara cuenta como afuera del depósito';
  perform pg_temp.paso('3. lo no procesado queda pendiente de devolución');
end $$;

-- ---------------------------------------------------------------- 4. Stock gestiona la devolución: el ticket queda en 0
do $$
declare b uuid := '25000000-0000-0000-0000-0000000000b1'; dep uuid := current_setting('pruebas.dep')::uuid;
  tur uuid := current_setting('pruebas.tur')::uuid; ubic uuid := current_setting('pruebas.ubic')::uuid; r json; ok boolean; l json;
begin
  perform pg_temp.como(b);
  r := public.stock_devolver_todo(b, 'turno', tur, dep);
  perform pg_temp.yo();
  assert (select tipo from public.movimientos_stock where id = (r ->> 'id')::uuid) = 'devolucion', '4.1 Queda el comprobante de devolución';
  assert (select coalesce(sum(cantidad), 0) from public.stock where ubicacion_id = ubic) = 0, '4.2 El stock del ticket queda en 0';
  assert pg_temp.hay(dep, 'Cámara IP 4MP') = 7, '4.3 La cámara vuelve al depósito (10 - 4 + 1)';
  perform pg_temp.como(b);
  begin perform public.stock_devolver_todo(b, 'turno', tur, dep); ok := false;
  exception when others then ok := sqlerrm like 'No queda nada para devolver%'; end;
  select x into l from json_array_elements(public.stock_existencias(b) -> 'lugares') x where (x ->> 'id')::uuid = ubic;
  perform pg_temp.yo();
  assert ok and l is null, '4.4 Ya no figura como pendiente';
  perform pg_temp.paso('4. la devolución deja el ticket en 0');
end $$;

-- ---------------------------------------------------------------- 5. Anular un procesado lo vuelve al ticket
do $$
declare b uuid := '25000000-0000-0000-0000-0000000000b1'; tur uuid := current_setting('pruebas.tur')::uuid;
  ubic uuid := current_setting('pruebas.ubic')::uuid; mov uuid; v json;
begin
  select mv.id into mov from public.movimientos_stock mv join public.movimientos_stock_items i on i.movimiento_id = mv.id
   where mv.origen_id = ubic and mv.tipo = 'consumo' and i.material_id = pg_temp.mat('DVR 8 canales');
  perform pg_temp.como(b);
  perform public.stock_anular(mov, 'El DVR no se instaló');
  perform pg_temp.yo();
  v := pg_temp.ver(b, tur);
  assert pg_temp.hay(ubic, 'DVR 8 canales') = 1 and json_array_length(v -> 'procesados') = 3,
     '5.1 El DVR vuelve al ticket como pendiente y deja de contar como procesado';
  perform pg_temp.paso('5. anular un procesado');
end $$;

-- ---------------------------------------------------------------- 6. El técnico también puede devolver todo (a su stock)
do $$
declare t uuid := '25000000-0000-0000-0000-0000000000a1'; tur uuid := current_setting('pruebas.tur')::uuid;
  ubic uuid := current_setting('pruebas.ubic')::uuid; mio uuid;
begin
  perform pg_temp.como(t);
  perform public.stock_devolver_todo('25000000-0000-0000-0000-0000000000b1', 'turno', tur, null);
  perform pg_temp.yo();
  select id into mio from public.ubicaciones_stock where tipo = 'operario' and usuario_id = t;
  assert (select coalesce(sum(cantidad), 0) from public.stock where ubicacion_id = ubic) = 0 and pg_temp.hay(mio, 'DVR 8 canales') = 1,
     '6.1 Vuelve a su stock (se le crea si no tenía) y el ticket queda en 0';
  perform pg_temp.paso('6. el técnico devuelve todo a su stock');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 6 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

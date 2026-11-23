-- =====================================================================
--  TaListo!  ·  PRUEBAS de 30_multidia_agenda.sql
--  Trabajo de varios días: registro del día trabajado en la agenda,
--  continuación con fecha o "pendiente de coordinar", coordinarla después
--  y volver a empezarlo sin coordinar.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

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
create function pg_temp.falla(sql text, texto text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  if sqlerrm not ilike '%' || texto || '%' then raise exception 'Se esperaba "%" y salió "%"', texto, sqlerrm; end if;
  return true;
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('30000000-0000-0000-0000-0000000000a1', 'a1@multi.test', '{"rol":"profesional","nombre":"Santi"}'),
  ('30000000-0000-0000-0000-0000000000a2', 'a2@multi.test', '{"rol":"profesional","nombre":"Otro"}');
insert into public.clientes (id, profesional_id, nombre, es_empresa, color)
values ('30000000-0000-0000-0000-0000000000c1', '30000000-0000-0000-0000-0000000000a1', 'Gamma', true, '#ff8800');
insert into public.ordenes (id, profesional_id, empresa_id, numero_ticket, fecha, cliente_final, direccion, pedido, estado, asignado_a)
values ('30000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000c1',
        '7001', (now() at time zone 'America/Montevideo')::date, 'Ana', 'Rivera 2200', 'Cableado de oficina', 'pendiente',
        '30000000-0000-0000-0000-0000000000a1'),
       ('30000000-0000-0000-0000-0000000000d2', '30000000-0000-0000-0000-0000000000a1', '30000000-0000-0000-0000-0000000000c1',
        '7002', (now() at time zone 'America/Montevideo')::date, 'Beto', 'Rivera 2300', 'Instalar alarma', 'pendiente',
        '30000000-0000-0000-0000-0000000000a1');
insert into public.turnos (id, profesional_id, titulo, inicio, fin, tipo, estado, asignado_a)
values ('30000000-0000-0000-0000-0000000000e1', '30000000-0000-0000-0000-0000000000a1', 'Obra Pocitos',
        date_trunc('minute', now()) - interval '2 hours', date_trunc('minute', now()) + interval '2 hours', 'trabajo', 'confirmado',
        '30000000-0000-0000-0000-0000000000a1');

-- 1. Multi día con fecha: deja el registro del día y la leyenda "sigue el"
do $$
declare a uuid := '30000000-0000-0000-0000-0000000000a1'; hoy date := (now() at time zone 'America/Montevideo')::date; j json;
begin
  perform pg_temp.como(a);
  perform public.iniciar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d1');
  perform public.terminar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d1', 'multidia', 'Quedó cableado el primer piso',
                                  null, null, null, null, null, hoy + 2, '09:00', 120);
  assert (select fecha = hoy + 2 and not continuar_pendiente from public.ordenes where id = '30000000-0000-0000-0000-0000000000d1'),
    '1.1 El ticket pasa al día elegido';
  j := public.jornadas_agenda(a, hoy, hoy);
  assert json_array_length(j) = 1, '1.2 Queda un registro en la agenda de hoy';
  assert j -> 0 ->> 'estado' = 'sigue' and (j -> 0 ->> 'sigue')::date = hoy + 2 and j -> 0 ->> 'sigue_hora' like '09:00%',
    '1.3 Dice que sigue el día y la hora elegidos';
  assert j -> 0 ->> 'avance' = 'Quedó cableado el primer piso' and j -> 0 ->> 'color' = '#ff8800' and j -> 0 ->> 'titulo' like 'Gamma%',
    '1.4 Con el avance, el color y el nombre del trabajo';
  assert (j -> 0 ->> 'desde') is not null and (j -> 0 ->> 'hasta') is not null, '1.5 Con el horario trabajado';
  perform pg_temp.paso('1. multi día con fecha');
end $$;

-- 2. Multi día sin fecha: pendiente de coordinar continuación
do $$
declare a uuid := '30000000-0000-0000-0000-0000000000a1'; hoy date := (now() at time zone 'America/Montevideo')::date; j json; p json;
begin
  perform pg_temp.como(a);
  perform public.iniciar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d2');
  perform public.terminar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d2', 'multidia', 'Falta el material');
  assert (select fecha = hoy and estado = 'multidia' and continuar_pendiente from public.ordenes where id = '30000000-0000-0000-0000-0000000000d2'),
    '2.1 El ticket queda en su día y a coordinar';
  j := public.jornadas_agenda(a, hoy, hoy);
  assert exists (select 1 from json_array_elements(j) e where e ->> 'trabajo_id' = '30000000-0000-0000-0000-0000000000d2' and e ->> 'estado' = 'pendiente'),
    '2.2 El registro dice pendiente de coordinar';
  p := public.continuaciones_pendientes(a);
  assert json_array_length(p) = 1 and p -> 0 ->> 'id' = '30000000-0000-0000-0000-0000000000d2' and (p -> 0 ->> 'desde')::date = hoy,
    '2.3 Aparece en la lista para coordinar';
  -- turno: sin fecha queda en su lugar, a coordinar
  perform public.iniciar_trabajo('turno', '30000000-0000-0000-0000-0000000000e1');
  perform public.terminar_trabajo('turno', '30000000-0000-0000-0000-0000000000e1', 'multidia', 'Primera mano de pintura');
  assert (select continuar_pendiente and estado = 'confirmado' and inicio_original is not null from public.turnos where id = '30000000-0000-0000-0000-0000000000e1'),
    '2.4 El turno queda a coordinar';
  assert json_array_length(public.continuaciones_pendientes(a)) = 2, '2.5 Los dos para coordinar';
  assert exists (select 1 from json_array_elements(public.mis_trabajos(a, hoy, hoy) -> 'turnos') t
                  where t ->> 'id' = '30000000-0000-0000-0000-0000000000e1' and (t ->> 'continuar_pendiente')::boolean),
    '2.6 Mis tickets muestra hoy el turno a coordinar';
  perform pg_temp.como('30000000-0000-0000-0000-0000000000a2');
  assert json_array_length(public.continuaciones_pendientes('30000000-0000-0000-0000-0000000000a1')) = 0, '2.7 Otro no los ve';
  assert (select count(*) from public.trabajo_jornadas) = 0, '2.8 Ni los registros';
  perform pg_temp.paso('2. pendiente de coordinar');
end $$;

-- 3. Coordinar la continuación
do $$
declare a uuid := '30000000-0000-0000-0000-0000000000a1'; hoy date := (now() at time zone 'America/Montevideo')::date; j json;
begin
  perform pg_temp.como('30000000-0000-0000-0000-0000000000a2');
  assert pg_temp.falla(format('select public.coordinar_continuacion(%L, %L, %L)', 'ticket', '30000000-0000-0000-0000-0000000000d2', hoy + 1),
    'No podés coordinar'), '3.1 Otro no lo puede coordinar';
  perform pg_temp.como(a);
  assert pg_temp.falla(format('select public.coordinar_continuacion(%L, %L, %L)', 'ticket', '30000000-0000-0000-0000-0000000000d2', hoy - 1),
    'a partir de hoy'), '3.2 No a un día que ya pasó';
  perform public.coordinar_continuacion('ticket', '30000000-0000-0000-0000-0000000000d2', hoy + 3, '14:00', 90);
  assert (select fecha = hoy + 3 and hora_inicio = '14:00' and hora_fin = '15:30' and not continuar_pendiente
            from public.ordenes where id = '30000000-0000-0000-0000-0000000000d2'), '3.3 El ticket queda con su día y hora';
  j := public.jornadas_agenda(a, hoy, hoy);
  assert exists (select 1 from json_array_elements(j) e where e ->> 'trabajo_id' = '30000000-0000-0000-0000-0000000000d2'
                   and e ->> 'estado' = 'sigue' and (e ->> 'sigue')::date = hoy + 3), '3.4 El registro de hoy ahora dice cuándo sigue';
  assert pg_temp.falla(format('select public.coordinar_continuacion(%L, %L, %L)', 'ticket', '30000000-0000-0000-0000-0000000000d2', hoy + 4),
    'ya tiene el día'), '3.5 Uno ya coordinado no se coordina de nuevo';
  assert pg_temp.falla(format('select public.coordinar_continuacion(%L, %L, %L)', 'turno', '30000000-0000-0000-0000-0000000000e1', hoy + 1),
    'a qué hora'), '3.6 El turno necesita hora';
  perform public.coordinar_continuacion('turno', '30000000-0000-0000-0000-0000000000e1', hoy + 1, '08:00', null);
  assert (select not continuar_pendiente and (inicio at time zone 'America/Montevideo') = (hoy + 1) + time '08:00'
                 and fin - inicio = interval '4 hours' from public.turnos where id = '30000000-0000-0000-0000-0000000000e1'),
    '3.7 El turno pasa al día y hora elegidos, con la misma duración';
  assert json_array_length(public.continuaciones_pendientes(a)) = 0, '3.8 No queda nada para coordinar';
  perform pg_temp.paso('3. coordinar la continuación');
end $$;

-- 4. Volver a empezarlo sin coordinar y terminarlo
do $$
declare a uuid := '30000000-0000-0000-0000-0000000000a1'; hoy date := (now() at time zone 'America/Montevideo')::date; j json;
begin
  perform pg_temp.yo();
  -- simula que el registro y el trabajo eran de ayer
  update public.trabajo_jornadas set fecha = hoy - 1 where trabajo_id = '30000000-0000-0000-0000-0000000000d1';
  update public.ordenes set fecha = hoy - 1, continuar_pendiente = true, hora_inicio = null, hora_fin = null where id = '30000000-0000-0000-0000-0000000000d1';
  perform pg_temp.como(a);
  perform public.iniciar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d1');
  assert (select fecha = hoy and not continuar_pendiente and estado = 'en_curso' from public.ordenes where id = '30000000-0000-0000-0000-0000000000d1'),
    '4.1 Al empezarlo de nuevo deja de estar a coordinar y pasa a hoy';
  perform public.terminar_trabajo('ticket', '30000000-0000-0000-0000-0000000000d1', 'finalizado', 'Terminado: quedó todo conectado', 1, 0);
  j := public.jornadas_agenda(a, hoy - 1, hoy - 1);
  assert j -> 0 ->> 'estado' = 'terminado' and (j -> 0 ->> 'sigue')::date = hoy, '4.2 El registro de ayer dice que se terminó hoy';
  perform pg_temp.paso('4. volver a empezarlo y terminarlo');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 4 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

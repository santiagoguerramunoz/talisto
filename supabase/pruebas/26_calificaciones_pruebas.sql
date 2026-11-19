-- =====================================================================
--  TaListo!  ·  PRUEBAS de 26_calificaciones.sql
--  Calificación de 0 a 10 (puntualidad, velocidad, desempeño) al dar el
--  visto bueno; nota = promedio de las 3; puntaje del profesional =
--  promedio de sus últimas 10 contrataciones; estrellas = ÷ 2 con
--  fracción (mínimo 1); las viejas de 1 a 5 se convierten (× 2).
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('26000000-0000-0000-0000-0000000000c1', null, '{"rol":"cliente","nombre":"Wanda WhatsApp","telefono":"59899111222"}'),
  ('26000000-0000-0000-0000-0000000000c2', 'c2@cot.test', '{"rol":"cliente","nombre":"Carla App"}'),
  ('26000000-0000-0000-0000-0000000000b1', 'b1@cot.test', '{"rol":"profesional","nombre":"Bruno Toma"}'),
  ('26000000-0000-0000-0000-0000000000b2', 'b2@cot.test', '{"rol":"profesional","nombre":"Beto Cotiza"}');
update public.profesionales set departamentos = '{Montevideo}', activo = true where id::text like '26000000-%';
insert into public.planes (usuario_id, plan, origen)
select u, 'pro', 'regalo' from unnest(array['26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-0000000000b2']::uuid[]) u
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
update public.match_perfiles set disponible = false where profesional_id::text not like '26000000-%';
insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias)
select p, true, array[(select id from public.categorias where slug = 'electricidad')], false
from unnest(array['26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros, urgencias = false;
insert into public.match_datos_cobro (profesional_id, banco, numero, titular)
select p, 'BROU', '001234567', 'Titular' from unnest(array['26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-0000000000b2']::uuid[]) p
on conflict (profesional_id) do nothing;
insert into public.horarios_trabajo (profesional_id, dia, hora_inicio, hora_fin)
select p, d, '08:00', '18:00' from unnest(array['26000000-0000-0000-0000-0000000000b1', '26000000-0000-0000-0000-0000000000b2']::uuid[]) p,
       generate_series(0, 6) d;
-- Wanda escribe por WhatsApp
insert into public.wa_conversaciones (telefono, usuario_id, nombre) values ('59899111222', '26000000-0000-0000-0000-0000000000c1', 'Wanda');

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
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
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
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
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


-- Una visita tomada y paga, para el martes que viene a las 11 (devuelve la operación)
create function pg_temp.visita(titulo text, pro uuid) returns uuid language plpgsql as $$
declare sol uuid; r json; op uuid;
begin
  sol := (pg_temp.pedido(titulo) ->> 'id')::uuid;
  perform pg_temp.como(pro);
  r := public.tomar_servicio(sol, pro, pg_temp.a(pg_temp.dia(2), 11));
  perform pg_temp.yo();
  op := (r ->> 'operacion')::uuid;
  perform pg_temp.pago(op);
  return op;
end $$;
-- La visita ya pasó
create function pg_temp.ya_paso(op uuid) returns void language sql as $$
  update public.turnos set inicio = now() - interval '3 hours', fin = now() - interval '2 hours'
   where id = (select turno_id from public.match_operaciones where id = op);
$$;
create function pg_temp.calif(op uuid, p int, v int, d int, com text default null) returns text language plpgsql as $$
declare r json;
begin
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
  begin
    r := public.calificar(op, p, v, d, com);
  exception when others then
    perform pg_temp.yo();
    return 'ERROR ' || sqlerrm;
  end;
  perform pg_temp.yo();
  return r::text;
end $$;

-- ---------------------------------------------------------------- 1. Estrellas: promedio ÷ 2 con fracción, mínimo 1
do $$
begin
  assert public._estrellas_de(10) = 5 and public._estrellas_de(9) = 4.5 and public._estrellas_de(7) = 3.5 and public._estrellas_de(8) = 4,
     '1.1 10 = 5 ★, 9 = 4,5 ★, 8 = 4 ★, 7 = 3,5 ★';
  assert public._estrellas_de(7.3) = 3.7 and public._estrellas_de(2) = 1 and public._estrellas_de(0) = 1 and public._estrellas_de(null) is null,
     '1.2 Con fracción (7,3 = 3,7 ★) y mínimo 1 ★';
  assert not exists (select 1 from public.match_calificaciones where nota is null or nota <> puntaje * 2 and puntualidad is null),
     '1.3 Las calificaciones viejas pasaron a 0–10 (× 2)';
  perform pg_temp.paso('1. de nota a estrellas');
end $$;

-- ---------------------------------------------------------------- 2. Visto bueno con la calificación
do $$
declare b1 uuid := '26000000-0000-0000-0000-0000000000b1'; op uuid; r text; o public.match_operaciones; k public.match_calificaciones;
begin
  op := pg_temp.visita('Aire que gotea', b1);
  r := pg_temp.calif(op, 9, 8, 10);
  assert r like 'ERROR La visita todavía no llegó%', '2.1 Antes de la hora de la visita no se da el visto bueno: ' || r;
  perform pg_temp.ya_paso(op);
  assert pg_temp.calif(op, 11, 8, 10) like 'ERROR Calificá puntualidad%', '2.2 Cada punto va de 0 a 10';
  assert pg_temp.calif(op, 9, null, 10) like 'ERROR Calificá puntualidad%', '2.3 Hay que calificar los 3';
  r := pg_temp.calif(op, 9, 8, 10, 'Llegó a la hora y dejó todo limpio');
  assert (r::json ->> 'nota')::numeric = 9 and (r::json ->> 'estrellas')::numeric = 4.5, '2.4 Nota de la contratación: promedio de los 3 (9 = 4,5 ★): ' || r;
  select * into o from public.match_operaciones where id = op;
  assert o.estado = 'pendiente_liquidacion' and o.confirmado_por = 'cliente' and o.realizado_en is not null,
     '2.5 Calificar es el visto bueno: la visita queda confirmada y al técnico se le libera el pago';
  assert (select estado from public.turnos where id = o.turno_id) = 'realizado', '2.6 La visita queda hecha en la agenda';
  select * into k from public.match_calificaciones where operacion_id = op;
  assert k.puntualidad = 9 and k.velocidad = 8 and k.desempeno = 10 and k.nota = 9 and k.puntaje = 5 and k.comentario like 'Llegó%',
     '2.7 Se guardan los 3 puntos, la nota y el comentario';
  assert pg_temp.calif(op, 5, 5, 5) like 'ERROR Ya calificaste%', '2.8 Una sola calificación por contratación';
  perform pg_temp.paso('2. visto bueno con la calificación');
end $$;

-- ---------------------------------------------------------------- 3. Puntaje del profesional: las últimas 10
do $$
declare b2 uuid := '26000000-0000-0000-0000-0000000000b2'; ops uuid[] := '{}'; op uuid; i int; c json;
begin
  -- 11 contrataciones: la 1ª fue un mal día (0, 0, 0) y las demás 10 puntos
  for i in 1 .. 11 loop
    op := pg_temp.visita('Trabajo ' || i, b2);
    perform pg_temp.ya_paso(op);
    if i = 1 then perform pg_temp.calif(op, 0, 0, 0); else perform pg_temp.calif(op, 10, 10, 10); end if;
    update public.match_calificaciones set creado_en = now() - make_interval(days => 20 - i) where operacion_id = op;
    if i = 10 then
      c := public._calif_prof(b2);
      assert (c ->> 'nota')::numeric = 9 and (c ->> 'promedio')::numeric = 4.5 and (c ->> 'ultimas')::int = 10,
         '3.1 En la 10ª: promedio de la 1 a la 10 = 9 (4,5 ★), el mal día cuenta: ' || c;
    end if;
  end loop;
  c := public._calif_prof(b2);
  assert (c ->> 'nota')::numeric = 10 and (c ->> 'promedio')::numeric = 5 and (c ->> 'cantidad')::int = 11 and (c ->> 'ultimas')::int = 10,
     '3.2 En la 11ª cuenta de la 2 a la 11: el mal día ya no pesa (10 = 5 ★): ' || c;
  assert (c ->> 'puntualidad')::numeric = 10 and (c ->> 'velocidad')::numeric = 10 and (c ->> 'desempeno')::numeric = 10,
     '3.3 También el promedio de cada punto en las últimas 10';
  assert public._estrellas_prof(b2) = 5, '3.4 Para ordenar la lista de técnicos se usa el mismo puntaje';
  perform pg_temp.paso('3. promedio de las últimas 10');
end $$;

-- ---------------------------------------------------------------- 4. Se ve en el perfil, en las tarjetas y en el panel del técnico
do $$
declare b1 uuid := '26000000-0000-0000-0000-0000000000b1'; j json; k json;
begin
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
  j := public.perfil_match(b1);
  perform pg_temp.yo();
  k := j -> 'calificaciones' -> 0;
  assert (k ->> 'nota')::numeric = 9 and (k ->> 'estrellas')::numeric = 4.5 and (k ->> 'puntualidad')::int = 9 and (k ->> 'desempeno')::int = 10,
     '4.1 En el perfil público cada calificación muestra la nota, las estrellas y los 3 puntos: ' || coalesce(k::text, 'nada');
  assert (public._prof_publico(b1) -> 'calificacion' ->> 'promedio')::numeric = 4.5, '4.2 La tarjeta del técnico muestra 4,5 ★';
  perform pg_temp.como(b1);
  j := public.match_mi_perfil(b1);
  perform pg_temp.yo();
  assert (j -> 'calificacion' ->> 'nota')::numeric = 9, '4.3 El técnico ve su promedio';
  perform pg_temp.paso('4. se ve en el perfil y en el panel');
end $$;

-- ---------------------------------------------------------------- 5. La calificación de antes (1 a 5) y la de WhatsApp
do $$
declare b1 uuid := '26000000-0000-0000-0000-0000000000b1'; op uuid; k public.match_calificaciones; r json;
begin
  op := pg_temp.visita('Enchufe flojo', b1);
  perform pg_temp.ya_paso(op);
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
  perform public.calificar(op, 4, 'Bien');
  perform pg_temp.yo();
  select * into k from public.match_calificaciones where operacion_id = op;
  assert k.nota = 8 and k.puntualidad = 8 and k.puntaje = 4, '5.1 La forma de antes (4 ★) sigue andando y vale 8';
  op := pg_temp.visita('Luz del baño', b1);
  perform pg_temp.ya_paso(op);
  r := public.wa_calificar('26000000-0000-0000-0000-0000000000c2', op, 7, 7, 7);
  perform pg_temp.yo();
  assert (r ->> 'nota')::numeric = 7 and (r ->> 'estrellas')::numeric = 3.5, '5.2 Por WhatsApp también se califican los 3 puntos';
  perform pg_temp.paso('5. la forma de antes y WhatsApp');
end $$;

-- ---------------------------------------------------------------- 6. Orden para los clientes: más puntaje por más tiempo
do $$
declare b1 uuid := '26000000-0000-0000-0000-0000000000b1'; b2 uuid := '26000000-0000-0000-0000-0000000000b2';
  s1 numeric; s2 numeric; lista json; i1 int; i2 int;
begin
  -- b2: 4,5 ★ (nota 9) desde hace casi 6 meses; b1: 5 ★ (nota 10) recién hace 10 días
  update public.match_calificaciones set nota = 9, puntualidad = 9, velocidad = 9, desempeno = 9,
         creado_en = now() - interval '175 days' + make_interval(mins => (extract(epoch from creado_en)::bigint % 1000)::int)
   where profesional_id = b2;
  update public.match_calificaciones set nota = 10, puntualidad = 10, velocidad = 10, desempeno = 10,
         creado_en = now() - interval '10 days' + make_interval(mins => (extract(epoch from creado_en)::bigint % 1000)::int)
   where profesional_id = b1;
  assert public._estrellas_prof(b1) = 5 and public._estrellas_prof(b2) = 4.5, '6.1 Hoy b1 tiene 5 ★ y b2 4,5 ★';
  s1 := public._puntaje_sostenido(b1);
  s2 := public._puntaje_sostenido(b2);
  assert s2 between 4.35 and 4.5 and s1 between 2.55 and 2.75, format('6.2 Sostenido 6 meses: b2 ≈ 4,4 ★ y b1 ≈ 2,6 ★ (dio %s y %s)', s2, s1);
  assert public._puntaje_sostenido('26000000-0000-0000-0000-0000000000c2') = 2.5, '6.3 Sin calificaciones cuenta 2,5 ★';
  perform pg_temp.como('26000000-0000-0000-0000-0000000000c2');
  lista := public.profesionales_match((select id from public.categorias where slug = 'electricidad'), 'Montevideo');
  perform pg_temp.yo();
  select n into i1 from json_array_elements(lista) with ordinality x(e, n) where (e ->> 'id')::uuid = b1;
  select n into i2 from json_array_elements(lista) with ordinality x(e, n) where (e ->> 'id')::uuid = b2;
  assert i2 < i1, format('6.4 Al cliente le aparece primero b2 (más puntaje por más tiempo): b2 en %s, b1 en %s', i2, i1);
  assert (public._calif_prof(b2) ->> 'sostenido')::numeric = s2, '6.5 El técnico ve su puntaje sostenido';
  perform pg_temp.paso('6. orden por puntaje sostenido');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 6 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

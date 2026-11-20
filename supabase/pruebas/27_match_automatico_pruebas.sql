-- =====================================================================
--  TaListo!  ·  PRUEBAS de 27_match_automatico.sql
--  Plazo de pago de 20 minutos, llave del llamado automático, la tarea que
--  corre cada minuto y los rubros que tienen técnicos disponibles.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('27000000-0000-0000-0000-0000000000b1', 'b1@auto.test', '{"rol":"profesional","nombre":"Bruno Aire"}'),
  ('27000000-0000-0000-0000-0000000000b2', 'b2@auto.test', '{"rol":"profesional","nombre":"Beto Sin Verificar"}');
update public.configuracion set solo_verificados = true where id = 1;

create function pg_temp.paso(nombre text) returns void language plpgsql as $$
begin
  perform set_config('pruebas.n', (coalesce(nullif(current_setting('pruebas.n', true), ''), '0')::int + 1)::text, true);
  raise notice 'OK %', nombre;
end $$;

-- ---------------------------------------------------------------- 1. Plazo de pago y llave
do $$
declare k text;
begin
  assert (select pago_minutos from public.configuracion where id = 1) <> 10, '1.1 El plazo de pago ya no es de 10 minutos (queda en 20, o en lo elegido en /admin)';
  select llave into k from public.cron_llaves where nombre = 'match';
  assert length(k) >= 32 and public.cron_llave_valida(k) and not public.cron_llave_valida('cualquiera') and not public.cron_llave_valida(null),
     '1.2 La llave es larga y solo vale la que está guardada';
  assert not has_table_privilege('authenticated', 'public.cron_llaves', 'select') and not has_table_privilege('anon', 'public.cron_llaves', 'select'),
     '1.3 Nadie de la app puede leer la llave';
  assert not has_function_privilege('authenticated', 'public.cron_llave_valida(text)', 'execute')
     and not has_function_privilege('anon', 'public.match_tarea_automatica()', 'execute'), '1.4 Ni probar llaves ni correr la tarea desde la app';
  perform pg_temp.paso('1. plazo de pago y llave');
end $$;

-- ---------------------------------------------------------------- 2. La tarea automática corre
do $$
declare r json;
begin
  r := public.match_tarea_automatica();
  assert r is not null, '2.1 La tarea procesa los vencimientos y responde';
  perform pg_temp.paso('2. tarea automática');
end $$;

-- ---------------------------------------------------------------- 3. Solo los rubros con técnicos disponibles
do $$
declare elec smallint := (select id from public.categorias where slug = 'electricidad');
  jard smallint := (select id from public.categorias where activa and id <> (select id from public.categorias where slug = 'electricidad') order by orden limit 1);
  antes int; j json;
begin
  -- se sacan de Match los técnicos que ya había, para probar desde cero
  update public.match_perfiles set disponible = false;
  assert json_array_length(public.rubros_match()) = 0, '3.1 Sin técnicos disponibles no aparece ningún rubro';
  update public.profesionales set verificado = true where id = '27000000-0000-0000-0000-0000000000b1';
  update public.profesionales set verificado = false where id = '27000000-0000-0000-0000-0000000000b2';
  insert into public.match_perfiles (profesional_id, disponible, rubros) values
    ('27000000-0000-0000-0000-0000000000b1', true, array[elec]),
    ('27000000-0000-0000-0000-0000000000b2', true, array[jard])
  on conflict (profesional_id) do update set disponible = true, rubros = excluded.rubros;
  j := public.rubros_match();
  assert json_array_length(j) = 1 and (j -> 0 ->> 'id')::int = elec and (j -> 0 ->> 'tecnicos')::int = 1,
     '3.2 Aparece electricidad (técnico verificado) y no el rubro del que no está verificado: ' || j;
  update public.configuracion set solo_verificados = false where id = 1;
  assert json_array_length(public.rubros_match()) = 2, '3.3 Si no se exige verificación, aparecen los dos';
  update public.configuracion set solo_verificados = true where id = 1;
  update public.match_perfiles set disponible = false where profesional_id = '27000000-0000-0000-0000-0000000000b1';
  assert json_array_length(public.rubros_match()) = 0, '3.4 Si el técnico pausa Match, el rubro deja de aparecer';
  assert (select activa from public.categorias where id = jard), '3.5 Los rubros siguen activos para que los técnicos los elijan';
  assert has_function_privilege('anon', 'public.rubros_match()', 'execute'), '3.6 Cualquiera puede ver qué rubros hay (sin datos de los técnicos)';
  perform pg_temp.paso('3. rubros con técnicos');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 3 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

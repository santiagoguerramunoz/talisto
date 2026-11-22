-- =====================================================================
--  TaListo!  ·  PRUEBAS de 29_paises_localidades.sql (+ las 3 partes)
--  Países, regiones y localidades; lugar al crear la cuenta; cambiar la
--  ubicación; localidades propuestas (aprobar, unir, rechazar); países
--  (precios, activar) y cuentas por zona.
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
create function pg_temp.reg(p text, n text) returns int language sql as $$
  select id from public.regiones where pais = p and nombre = n;
$$;
create function pg_temp.loc(p text, r text, n text) returns int language sql as $$
  select l.id from public.localidades l join public.regiones x on x.id = l.region_id
   where x.pais = p and x.nombre = r and l.clave = public._clave_lugar(n);
$$;
create function pg_temp.falla(sql text, texto text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  if sqlerrm not ilike '%' || texto || '%' then raise exception 'Se esperaba "%" y salió "%"', texto, sqlerrm; end if;
  return true;
end $$;

-- 1. Datos cargados
do $$
declare deps text[] := array['Artigas','Canelones','Cerro Largo','Colonia','Durazno','Flores','Florida','Lavalleja','Maldonado',
  'Montevideo','Paysandú','Río Negro','Rivera','Rocha','Salto','San José','Soriano','Tacuarembó','Treinta y Tres'];
begin
  assert (select count(*) from public.paises) = 20, '1.1 Hay 20 países';
  assert (select array_agg(codigo) from public.paises where activo) = array['UY']::bpchar[], '1.2 Solo Uruguay está activo';
  assert (select count(*) from public.regiones where pais = 'UY') = 19, '1.3 Uruguay tiene sus 19 departamentos';
  assert (select bool_and(pg_temp.reg('UY', d) is not null) from unnest(deps) d), '1.4 Los departamentos se llaman igual que en la app';
  assert (select count(*) from public.regiones where pais = 'AR') = 24, '1.5 Argentina tiene 23 provincias y CABA';
  assert (select count(*) from public.regiones where pais = 'BR') = 27, '1.6 Brasil tiene 26 estados y el Distrito Federal';
  assert (select count(*) from public.localidades) > 20000, '1.7 Están las localidades de los 20 países';
  assert pg_temp.loc('UY', 'Montevideo', 'Pocitos') is not null and pg_temp.loc('UY', 'Canelones', 'Ciudad de la Costa') is not null,
    '1.8 Están los barrios de Montevideo y las ciudades del interior';
  assert pg_temp.loc('BR', 'São Paulo', 'Sao Paulo') is not null, '1.9 Se encuentra sin tildes';
  assert (select count(*) from public.localidades where estado <> 'aprobada') = 0, '1.10 Las cargadas están aprobadas';
  perform pg_temp.paso('1. datos cargados');
end $$;

-- 2. Lugar al crear la cuenta
insert into auth.users (id, email, raw_user_meta_data) values
  ('29000000-0000-0000-0000-0000000000a1', 'a1@lugar.test', jsonb_build_object('rol', 'cliente', 'nombre', 'Ana', 'pais', 'UY',
      'region_id', pg_temp.reg('UY', 'Montevideo'), 'localidad_id', pg_temp.loc('UY', 'Montevideo', 'Pocitos'))),
  ('29000000-0000-0000-0000-0000000000a2', 'a2@lugar.test', jsonb_build_object('rol', 'profesional', 'nombre', 'Beto', 'pais', 'UY',
      'region_id', pg_temp.reg('UY', 'Canelones'), 'localidad_nueva', '  Barrio   Inventado  Sur ')),
  ('29000000-0000-0000-0000-0000000000a3', 'a3@lugar.test', jsonb_build_object('rol', 'cliente', 'nombre', 'Caro', 'pais', 'UY',
      'region_id', pg_temp.reg('UY', 'Rocha'), 'localidad_nueva', 'barrio inventado sur')),
  ('29000000-0000-0000-0000-0000000000a4', 'a4@lugar.test', jsonb_build_object('rol', 'cliente', 'nombre', 'Dani', 'pais', 'AR',
      'region_id', pg_temp.reg('AR', 'Córdoba'))),
  ('29000000-0000-0000-0000-0000000000a5', 'a5@lugar.test', jsonb_build_object('rol', 'cliente', 'nombre', 'Eli', 'pais', 'UY',
      'region_id', 'cualquiera', 'localidad_id', 'x')),
  ('29000000-0000-0000-0000-0000000000a6', 'a6@lugar.test', jsonb_build_object('rol', 'cliente', 'nombre', 'Fede', 'pais', 'UY',
      'region_id', pg_temp.reg('UY', 'Salto'), 'localidad_id', pg_temp.loc('UY', 'Montevideo', 'Pocitos')));
update public.perfiles set es_admin = true where id = '29000000-0000-0000-0000-0000000000a6';

do $$
declare nueva int := (select localidad_id from public.perfiles where id = '29000000-0000-0000-0000-0000000000a2');
begin
  assert (select (pais, region_id, localidad_id) = ('UY', pg_temp.reg('UY', 'Montevideo'), pg_temp.loc('UY', 'Montevideo', 'Pocitos'))
            from public.perfiles where id = '29000000-0000-0000-0000-0000000000a1'), '2.1 La cuenta guarda país, departamento y barrio';
  assert (select estado = 'pendiente' and nombre = 'Barrio Inventado Sur' and propuesta_por = '29000000-0000-0000-0000-0000000000a2'
            from public.localidades where id = nueva), '2.2 Una localidad que no está queda pendiente, con espacios limpios';
  assert exists (select 1 from public.profesionales where id = '29000000-0000-0000-0000-0000000000a2'), '2.3 El profesional se crea igual que antes';
  assert (select localidad_id is not null and localidad_id <> nueva from public.perfiles where id = '29000000-0000-0000-0000-0000000000a3'),
    '2.4 El mismo nombre en otro departamento es otra localidad';
  assert (select pais = 'UY' and region_id is null from public.perfiles where id = '29000000-0000-0000-0000-0000000000a4'),
    '2.5 Un país que no está activo no se guarda (queda Uruguay para completar)';
  assert (select region_id is null and localidad_id is null from public.perfiles where id = '29000000-0000-0000-0000-0000000000a5'),
    '2.6 Datos raros no impiden crear la cuenta';
  assert (select region_id = pg_temp.reg('UY', 'Salto') and localidad_id is null from public.perfiles where id = '29000000-0000-0000-0000-0000000000a6'),
    '2.7 Una localidad de otro departamento no se acepta';
  perform pg_temp.paso('2. lugar al crear la cuenta');
end $$;

-- 3. Mi ubicación
do $$
declare r json; nueva int := (select localidad_id from public.perfiles where id = '29000000-0000-0000-0000-0000000000a2');
begin
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a1');
  r := public.mi_ubicacion();
  assert r ->> 'localidad' = 'Pocitos' and r ->> 'region' = 'Montevideo' and r ->> 'nombre_region' = 'Departamento', '3.1 Ve su ubicación';
  assert pg_temp.falla(format('select public.mi_ubicacion_guardar(%L, %s, null, null)', 'AR', pg_temp.reg('AR', 'Córdoba')), 'todavía no está disponible'),
    '3.2 No puede elegir un país que no está activo';
  assert pg_temp.falla(format('select public.mi_ubicacion_guardar(%L, %s, null, null)', 'UY', pg_temp.reg('AR', 'Córdoba')), 'Elegí tu departamento'),
    '3.3 La región tiene que ser del país';
  assert pg_temp.falla(format('select public.mi_ubicacion_guardar(%L, %s, null, %L)', 'UY', pg_temp.reg('UY', 'Maldonado'), ' '), 'localidad o barrio'),
    '3.4 Hay que elegir o escribir la localidad';
  r := public.mi_ubicacion_guardar('uy', pg_temp.reg('UY', 'Maldonado'), null, 'punta del este');
  assert r ->> 'localidad' = 'Punta del Este' and not (r ->> 'localidad_pendiente')::boolean, '3.5 Escribir una que existe la encuentra (sin importar mayúsculas)';
  assert (select json_array_length(public.localidades_buscar(pg_temp.reg('UY', 'Canelones'), 'inventado'))) = 0,
    '3.6 Una localidad pendiente de otro no aparece en la búsqueda';
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a2');
  assert (select json_array_length(public.localidades_buscar(pg_temp.reg('UY', 'Canelones'), 'inventado'))) = 1,
    '3.7 Quien la propuso sí la ve';
  assert (select count(*) from public.localidades where id = nueva) = 1, '3.8 Y la puede leer';
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a1');
  assert (select count(*) from public.localidades where id = nueva) = 0, '3.9 Otro no la puede leer';
  -- cambiar a mano a una localidad de otro departamento no queda
  update public.perfiles set localidad_id = pg_temp.loc('UY', 'Montevideo', 'Pocitos') where id = '29000000-0000-0000-0000-0000000000a1';
  perform pg_temp.yo();
  assert (select localidad_id is null from public.perfiles where id = '29000000-0000-0000-0000-0000000000a1'),
    '3.10 La localidad tiene que ser del departamento elegido';
  perform pg_temp.paso('3. mi ubicación');
end $$;

-- 4. Localidades propuestas
do $$
declare l2 int := (select localidad_id from public.perfiles where id = '29000000-0000-0000-0000-0000000000a2');
        l3 int := (select localidad_id from public.perfiles where id = '29000000-0000-0000-0000-0000000000a3');
        lista json;
begin
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a1');
  assert pg_temp.falla('select public.admin_localidades_pendientes()', 'Solo el administrador'), '4.1 Solo el admin las ve';
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a6');
  lista := public.admin_localidades_pendientes();
  assert json_array_length(lista) = 2 and (lista -> 0 ->> 'cuentas')::int = 1, '4.2 El admin ve las 2 pendientes y cuántas cuentas la usan';
  assert pg_temp.falla(format('select public.admin_localidad_resolver(%s, %L, %L)', l2, 'aprobar', 'Ciudad de la Costa'), 'Ya existe'),
    '4.3 No deja aprobar con el nombre de una que ya existe';
  perform public.admin_localidad_resolver(l2, 'unir', null, pg_temp.loc('UY', 'Canelones', 'Ciudad de la Costa'));
  assert (select localidad_id = pg_temp.loc('UY', 'Canelones', 'Ciudad de la Costa') from public.perfiles where id = '29000000-0000-0000-0000-0000000000a2'),
    '4.4 Unir pasa las cuentas a la localidad elegida';
  assert not exists (select 1 from public.localidades where id = l2), '4.5 Y borra la repetida';
  perform public.admin_localidad_resolver(l3, 'aprobar', 'Barrio Inventado Sur de Rocha');
  assert (select estado = 'aprobada' and nombre = 'Barrio Inventado Sur de Rocha' from public.localidades where id = l3), '4.6 Aprobar con nombre corregido';
  perform pg_temp.yo();
  l2 := public._localidad_resolver(pg_temp.reg('UY', 'Rocha'), null, 'Cualquier cosa', '29000000-0000-0000-0000-0000000000a3'::uuid);
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a6');
  perform public.admin_localidad_resolver(l2, 'rechazar');
  perform pg_temp.yo();
  assert (select estado from public.localidades where region_id = pg_temp.reg('UY', 'Rocha') and clave = 'cualquier cosa') = 'rechazada', '4.7 Rechazar';
  assert pg_temp.falla(format('select public._localidad_resolver(%s, null, %L, null)', pg_temp.reg('UY', 'Rocha'), 'CUALQUIER cosa'), 'no se puede agregar'),
    '4.8 Una rechazada no se puede volver a proponer';
  perform pg_temp.paso('4. localidades propuestas');
end $$;

-- 5. Países
do $$
declare pa public.paises;
begin
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a1');
  assert pg_temp.falla($q$select public.admin_pais_guardar('AR', '{"orden": 2}')$q$, 'Solo el administrador'), '5.1 Solo el admin edita países';
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a6');
  assert pg_temp.falla($q$select public.admin_pais_guardar('AR', '{"activo": true}')$q$, 'falta conectar el cobro'), '5.2 Otro país no se activa sin su cobro';
  assert pg_temp.falla($q$select public.admin_pais_guardar('UY', '{"activo": false}')$q$, 'al menos un país'), '5.3 Siempre queda un país activo';
  assert pg_temp.falla($q$select public.admin_pais_guardar('AR', '{"precios": {"visita_cliente": "-5"}}')$q$, 'números sin signo'), '5.4 Precios válidos';
  assert pg_temp.falla($q$select public.admin_pais_guardar('AR', '{"precios": {"visita_cliente": 10000, "visita_profesional": 12000}}')$q$, 'no puede ser más'),
    '5.5 El técnico no recibe más de lo que paga el cliente';
  pa := public.admin_pais_guardar('AR', '{"precios": {"visita_cliente": "25000", "visita_profesional": 18000, "plan_pro": 15000, "otra": 3}, "nombre_localidad": "Ciudad o barrio"}');
  assert pa.precios = '{"plan_pro": 15000, "visita_cliente": 25000, "visita_profesional": 18000}'::jsonb and pa.nombre_localidad = 'Ciudad o barrio',
    '5.6 Guarda precios en moneda local y los nombres';
  assert pa.moneda = 'ARS' and not pa.activo, '5.7 La moneda no cambia y sigue sin activar';
  perform pg_temp.paso('5. países');
end $$;

-- 6. Cuentas por zona
do $$
declare z json;
begin
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a6');
  z := public.admin_cuentas_por_zona('uy');
  assert exists (select 1 from json_array_elements(z) e where e ->> 'region' = 'Canelones' and (e ->> 'profesionales')::int >= 1),
    '6.1 Cuenta profesionales por departamento';
  assert exists (select 1 from json_array_elements(z) e where e ->> 'region' = 'Sin completar' and (e ->> 'clientes')::int >= 2),
    '6.2 Muestra cuántas cuentas no completaron su ubicación';
  perform pg_temp.como('29000000-0000-0000-0000-0000000000a1');
  assert pg_temp.falla($q$select public.admin_cuentas_por_zona('UY')$q$, 'Solo el administrador'), '6.3 Solo el admin';
  perform pg_temp.paso('6. cuentas por zona');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 6 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

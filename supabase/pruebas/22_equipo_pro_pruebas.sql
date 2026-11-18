-- =====================================================================
--  TaListo!  ·  PRUEBAS de 22_equipo_pro.sql (equipo también para Pro)
--  Crea un profesional Pro, una empresa Business, una cuenta Free y tres
--  colaboradores, y verifica: que Pro arma su equipo con roles propios,
--  el cupo de 2 (y el especial que da el admin), qué permisos corren en
--  una cuenta Pro, qué pasa si sobran colaboradores (pasó de Business a
--  Pro o bajó el cupo), Business sigue igual y que con Free no entra nadie.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace y sale el mensaje "PRUEBAS OK" (como error, a propósito).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('22000000-0000-0000-0000-0000000000a1', 'pro@equipo.test',      '{"rol":"profesional","nombre":"Pedro Pro"}'),
  ('22000000-0000-0000-0000-0000000000a2', 'business@equipo.test', '{"rol":"profesional","nombre":"Beatriz Business"}'),
  ('22000000-0000-0000-0000-0000000000a3', 'free@equipo.test',     '{"rol":"profesional","nombre":"Fabián Free"}'),
  ('22000000-0000-0000-0000-0000000000c1', 'c1@equipo.test',       '{"rol":"cliente","nombre":"Carlos Uno"}'),
  ('22000000-0000-0000-0000-0000000000c2', 'c2@equipo.test',       '{"rol":"cliente","nombre":"Clara Dos"}'),
  ('22000000-0000-0000-0000-0000000000c3', 'c3@equipo.test',       '{"rol":"cliente","nombre":"Ciro Tres"}'),
  ('22000000-0000-0000-0000-0000000000ad', 'ad@equipo.test',       '{"rol":"cliente","nombre":"Admin"}');
update public.perfiles set es_admin = true where id = '22000000-0000-0000-0000-0000000000ad';
insert into public.planes (usuario_id, plan, origen) values
  ('22000000-0000-0000-0000-0000000000a1', 'pro', 'regalo'),
  ('22000000-0000-0000-0000-0000000000a2', 'business', 'regalo')
on conflict (usuario_id) do update set plan = excluded.plan, origen = 'regalo', vence_en = null, max_cuentas = null;
update public.configuracion set pro_colaboradores_defecto = 2, business_cuentas_defecto = 5 where id = 1;

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
-- El dueño crea una invitación con ese rol; el colaborador la acepta. Devuelve el error (o null si entró)
create function pg_temp.sumar(dueno uuid, quien uuid, rol text) returns text language plpgsql as $$
declare e uuid; cod text;
begin
  select id into e from public.empresas where dueno_id = dueno;
  perform pg_temp.como(dueno);
  insert into public.invitaciones (empresa_id, roles)
  values (e, array[(select id from public.roles_empresa where empresa_id = e and nombre = rol)]) returning codigo into cod;
  perform pg_temp.como(quien);
  begin
    perform public.aceptar_invitacion(cod);
  exception when others then
    perform pg_temp.yo();
    return sqlerrm;
  end;
  perform pg_temp.yo();
  return null;
end $$;
-- ¿Esta cuenta usa los datos de ese dueño con alguno de esos permisos?
create function pg_temp.accede(quien uuid, dueno uuid, permisos text[]) returns boolean language plpgsql as $$
declare r boolean;
begin
  perform pg_temp.como(quien);
  r := dueno in (select public.cuentas_con(permisos));
  perform pg_temp.yo();
  return r;
end $$;

-- ---------------------------------------------------------------- 1. Pro arma su equipo
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; e uuid; i json; ok boolean;
begin
  perform pg_temp.como(pro);
  e := public.crear_mi_empresa('Taller Pérez');
  i := public.info_empresa(e);
  perform pg_temp.yo();
  assert (i ->> 'cupo')::int = 2 and (i ->> 'activa')::boolean and i ->> 'plan' = 'pro' and (i ->> 'usadas')::int = 0,
     '1.1 Pro crea su equipo: hasta 2 colaboradores';
  assert (select count(*) from public.roles_empresa where empresa_id = e) = 2
     and not exists (select 1 from public.roles_empresa where empresa_id = e and permisos && public.permisos_solo_business()),
     '1.2 Arranca con roles de ejemplo sin lo que es solo de Business';
  perform pg_temp.como(pro);
  insert into public.roles_empresa (empresa_id, nombre, permisos, orden) values (e, 'Depósito', array['agenda', 'stock'], 3);
  perform pg_temp.yo();
  assert exists (select 1 from public.roles_empresa where empresa_id = e and nombre = 'Depósito'), '1.3 El profesional define sus propios roles';
  perform pg_temp.como('22000000-0000-0000-0000-0000000000a3');
  begin perform public.crear_mi_empresa('Free SRL'); ok := false;
  exception when others then ok := sqlstate = 'TL001'; end;
  perform pg_temp.yo();
  assert ok, '1.4 Con Free no se puede armar equipo';
  perform pg_temp.paso('1. Pro arma su equipo y define los roles');
end $$;

-- ---------------------------------------------------------------- 2. Cupo de 2
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; r text;
begin
  assert pg_temp.sumar(pro, '22000000-0000-0000-0000-0000000000c1', 'Administración') is null, '2.1 Entra el primer colaborador';
  assert pg_temp.sumar(pro, '22000000-0000-0000-0000-0000000000c2', 'Depósito') is null, '2.2 Entra el segundo';
  r := pg_temp.sumar(pro, '22000000-0000-0000-0000-0000000000c3', 'Ayudante');
  assert r like '%ya tiene 2 cuentas%', format('2.3 El tercero no entra (cupo 2): %s', r);
  assert (select rol from public.perfiles where id = '22000000-0000-0000-0000-0000000000c1') = 'profesional',
     '2.4 El colaborador conserva su cuenta personal (queda como profesional)';
  perform pg_temp.paso('2. cupo de 2 colaboradores en Pro');
end $$;

-- ---------------------------------------------------------------- 3. Qué puede hacer cada uno en una cuenta Pro
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; c1 uuid := '22000000-0000-0000-0000-0000000000c1';
  c2 uuid := '22000000-0000-0000-0000-0000000000c2'; n int; j json;
begin
  insert into public.clientes (profesional_id, nombre) values (pro, 'Cliente del taller');
  assert pg_temp.accede(c1, pro, array['clientes']) and pg_temp.accede(c1, pro, array['importes']), '3.1 Administración usa clientes e importes del Pro';
  perform pg_temp.como(c1);
  select count(*) into n from public.clientes where profesional_id = pro;
  perform pg_temp.yo();
  assert n = 1, '3.2 Y ve los clientes del Pro (lo controla la base)';
  assert pg_temp.accede(c2, pro, array['agenda']) and not pg_temp.accede(c2, pro, array['stock']),
     '3.3 Depósito usa la agenda, pero el permiso de Stock no corre en Pro';
  perform pg_temp.como(c2);
  j := (select e from json_array_elements(public.mis_empresas()) e where e ->> 'dueno_id' = pro::text);
  perform pg_temp.yo();
  assert (j ->> 'activa')::boolean and j ->> 'plan' = 'pro' and not (j -> 'permisos')::jsonb ? 'stock' and (j -> 'permisos')::jsonb ? 'agenda',
     '3.4 Su espacio de trabajo muestra solo los permisos que valen en Pro';
  perform pg_temp.como(c2);
  begin insert into public.clientes (profesional_id, nombre) values (pro, 'No debería'); n := 1;
  exception when others then n := 0; end;
  perform pg_temp.yo();
  assert n = 0, '3.5 Con la agenda ve los clientes, pero sin permiso de clientes no los carga';
  perform pg_temp.paso('3. permisos: el rol que define el Pro, sin lo que es solo de Business');
end $$;

-- ---------------------------------------------------------------- 4. El admin da un cupo especial
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; e uuid; i json; p json;
begin
  select id into e from public.empresas where dueno_id = pro;
  perform pg_temp.como('22000000-0000-0000-0000-0000000000ad');
  update public.planes set max_cuentas = 3 where usuario_id = pro;
  perform pg_temp.yo();
  assert (select max_cuentas from public.planes where usuario_id = pro) = 3, '4.1 El admin le da 3 colaboradores';
  assert pg_temp.sumar(pro, '22000000-0000-0000-0000-0000000000c3', 'Ayudante') is null, '4.2 Ahora entra el tercero';
  perform pg_temp.como(pro);
  i := public.info_empresa(e);
  p := public.mi_plan();
  perform pg_temp.yo();
  assert (i ->> 'cupo')::int = 3 and (i ->> 'usadas')::int = 3 and (p ->> 'max_cuentas')::int = 3, '4.3 El equipo y su plan muestran 3 de 3';
  perform pg_temp.como(pro);
  begin update public.planes set max_cuentas = 10 where usuario_id = pro; exception when others then null; end;
  perform pg_temp.yo();
  assert (select max_cuentas from public.planes where usuario_id = pro) = 3, '4.4 El profesional no se puede subir el cupo';
  perform pg_temp.paso('4. el admin da un cupo especial a una cuenta');
end $$;

-- ---------------------------------------------------------------- 5. Sobran colaboradores: entran los primeros
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; c1 uuid := '22000000-0000-0000-0000-0000000000c1';
  c3 uuid := '22000000-0000-0000-0000-0000000000c3'; e uuid; i json; eq json; j json;
begin
  select id into e from public.empresas where dueno_id = pro;
  -- (en la prueba todo pasa en el mismo instante: se ordena la llegada a mano)
  alter table public.miembros disable trigger talisto_proteger_miembro;
  update public.miembros set creado_en = now() - case usuario_id when c1 then interval '3 hours'
         when '22000000-0000-0000-0000-0000000000c2' then interval '2 hours' else interval '1 hour' end where empresa_id = e;
  alter table public.miembros enable trigger talisto_proteger_miembro;
  update public.planes set max_cuentas = null where usuario_id = pro;  -- vuelve al cupo del plan (2)
  perform pg_temp.como(pro);
  i := public.info_empresa(e);
  eq := public.equipo_empresa(e);
  perform pg_temp.yo();
  assert (i ->> 'fuera_de_cupo')::int = 1, '5.1 Con 3 colaboradores y cupo 2, uno queda fuera';
  assert (select (x ->> 'en_cupo')::boolean from json_array_elements(eq) x where (x ->> 'usuario_id')::uuid = c3) = false,
     '5.2 Queda fuera el último que se sumó';
  assert not pg_temp.accede(c3, pro, array['tickets_trabajar']), '5.3 Y no usa los datos del Pro';
  perform pg_temp.como(c3);
  j := (select x from json_array_elements(public.mis_empresas()) x where x ->> 'dueno_id' = pro::text);
  perform pg_temp.yo();
  assert not (j ->> 'activa')::boolean and not (j ->> 'en_cupo')::boolean, '5.4 Su espacio de trabajo dice que quedó fuera del cupo';
  -- El Pro bloquea a uno: se libera el lugar
  perform pg_temp.como(pro);
  update public.miembros set estado = 'bloqueado' where empresa_id = e and usuario_id = c1;
  perform pg_temp.yo();
  assert pg_temp.accede(c3, pro, array['tickets_trabajar']) and not pg_temp.accede(c1, pro, array['clientes']),
     '5.5 Si bloquea a uno, el siguiente entra en el cupo';
  perform pg_temp.paso('5. si sobran colaboradores, entran los primeros hasta el cupo');
end $$;

-- ---------------------------------------------------------------- 6. Business sigue igual; si baja a Pro, pierde lo de Business
do $$
declare bus uuid := '22000000-0000-0000-0000-0000000000a2'; c1 uuid := '22000000-0000-0000-0000-0000000000c1'; e uuid; i json;
begin
  perform pg_temp.como(bus);
  e := public.crear_mi_empresa('Beatriz SA');
  i := public.info_empresa(e);
  perform pg_temp.yo();
  assert (i ->> 'cupo')::int = 5 and (select count(*) from public.roles_empresa where empresa_id = e) = 4, '6.1 Business: 5 colaboradores y sus 4 roles';
  assert pg_temp.sumar(bus, c1, 'Administración') is null, '6.2 Un colaborador puede estar en dos equipos';
  assert pg_temp.accede(c1, bus, array['stock']), '6.3 En Business el permiso de Stock corre';
  update public.planes set plan = 'pro' where usuario_id = bus;
  assert not pg_temp.accede(c1, bus, array['stock']) and pg_temp.accede(c1, bus, array['clientes']),
     '6.4 Si pasa a Pro, Stock deja de correr y lo demás sigue';
  perform pg_temp.como(bus);
  i := public.info_empresa(e);
  perform pg_temp.yo();
  assert (i ->> 'cupo')::int = 2, '6.5 Y el cupo pasa a ser el de Pro';
  update public.planes set plan = 'business' where usuario_id = bus;
  perform pg_temp.paso('6. Business sigue igual; al bajar a Pro pierde lo que es de Business');
end $$;

-- ---------------------------------------------------------------- 7. Con Free no entra nadie; los números por defecto los cambia el admin
do $$
declare pro uuid := '22000000-0000-0000-0000-0000000000a1'; c3 uuid := '22000000-0000-0000-0000-0000000000c3'; r text; e uuid; i json;
begin
  select id into e from public.empresas where dueno_id = pro;
  update public.planes set plan = 'free' where usuario_id = pro;
  assert not pg_temp.accede(c3, pro, array['tickets_trabajar']), '7.1 Si el Pro pasa a Free, el equipo no entra';
  r := pg_temp.sumar(pro, '22000000-0000-0000-0000-0000000000ad', 'Ayudante');
  assert r like '%no tiene un plan Pro o Business%', format('7.2 Y no se puede sumar a nadie: %s', r);
  update public.planes set plan = 'pro' where usuario_id = pro;
  perform pg_temp.como('22000000-0000-0000-0000-0000000000ad');
  update public.configuracion set pro_colaboradores_defecto = 3 where id = 1;
  perform pg_temp.yo();
  perform pg_temp.como(pro);
  i := public.info_empresa(e);
  perform pg_temp.yo();
  assert (i ->> 'cupo')::int = 3, '7.3 El admin cambia el cupo por defecto de Pro y vale para todos';
  perform pg_temp.paso('7. con Free no entra nadie; el admin cambia el cupo por defecto');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 7 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

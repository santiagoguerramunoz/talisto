-- =====================================================================
--  TaListo!  ·  PRUEBAS de 31_roles_sin_importes.sql
--  Un encargado (agenda + agendar tickets, sin importes) crea y edita
--  tickets con puestas, MOE y materiales, y la base no le deja poner ni
--  cambiar precios. Quien tiene Importes y la cuenta principal sí.
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
create function pg_temp.entrar(u uuid, e uuid, rol text) returns void language plpgsql as $$
declare cod text;
begin
  perform pg_temp.como((select dueno_id from public.empresas where id = e));
  insert into public.invitaciones (empresa_id, roles)
  values (e, array[(select id from public.roles_empresa where empresa_id = e and nombre = rol)]) returning codigo into cod;
  perform pg_temp.yo();
  perform pg_temp.como(u);
  perform public.aceptar_invitacion(cod);
  perform pg_temp.yo();
end $$;

insert into auth.users (id, email, raw_user_meta_data) values
  ('31000000-0000-0000-0000-0000000000b1', 'b1@roles.test', '{"rol":"profesional","nombre":"Instaluy"}'),
  ('31000000-0000-0000-0000-0000000000e1', 'e1@roles.test', '{"rol":"profesional","nombre":"Ema Encargada"}'),
  ('31000000-0000-0000-0000-0000000000a1', 'a1@roles.test', '{"rol":"profesional","nombre":"Ana Administración"}'),
  ('31000000-0000-0000-0000-0000000000f9', 'v1@roles.test', '{"rol":"profesional","nombre":"Vero Ventas"}'),
  ('31000000-0000-0000-0000-0000000000c9', 'c9@roles.test', '{"rol":"cliente","nombre":"Carlos Cliente"}');
insert into public.planes (usuario_id, plan, origen) values ('31000000-0000-0000-0000-0000000000b1', 'business', 'regalo')
on conflict (usuario_id) do update set plan = 'business', origen = 'regalo', vence_en = null, max_cuentas = null;
update public.configuracion set business_cuentas_defecto = 5 where id = 1;

do $$
declare b uuid := '31000000-0000-0000-0000-0000000000b1'; e uuid;
begin
  perform pg_temp.como(b);
  e := public.crear_mi_empresa('Instaluy');
  insert into public.clientes (id, profesional_id, nombre, es_empresa, precio_acondicionamiento, factor_moe)
  values ('31000000-0000-0000-0000-0000000000c1', b, 'Gamma', true, 1200, 2);
  insert into public.ordenes (id, profesional_id, empresa_id, numero_ticket, fecha, pedido, acondicionamientos, mano_obra, materiales)
  values ('31000000-0000-0000-0000-0000000000d1', b, '31000000-0000-0000-0000-0000000000c1', '9001', current_date, 'Alarma', 2, 500,
          '[{"item":"Sensor","cantidad":2,"unidad":"u","costo":300,"margen":30,"precio":390,"proveedor":"Tienda X"},
            {"item":"Cable","cantidad":10,"unidad":"m","costo":10,"precio":15}]');
  perform pg_temp.yo();
  perform pg_temp.entrar('31000000-0000-0000-0000-0000000000e1', e, 'Encargado');
  perform pg_temp.entrar('31000000-0000-0000-0000-0000000000a1', e, 'Administración');
  perform pg_temp.entrar('31000000-0000-0000-0000-0000000000f9', e, 'Ventas');
end $$;

-- 1. El rol Encargado viene listo y no ve importes
do $$
declare b uuid := '31000000-0000-0000-0000-0000000000b1';
begin
  assert (select permisos @> array['agenda','tickets_asignar','tickets_trabajar'] and not ('importes' = any(permisos))
            from public.roles_empresa r join public.empresas e on e.id = r.empresa_id
           where e.dueno_id = b and r.nombre = 'Encargado'), '1.1 Rol Encargado creado con agenda, tickets y sin importes';
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  assert not public.ve_importes(b) and public._equipo_sin_importes(b), '1.2 La encargada no ve importes';
  perform pg_temp.yo();
  perform pg_temp.como('31000000-0000-0000-0000-0000000000a1');
  assert public.ve_importes(b) and not public._equipo_sin_importes(b), '1.3 Administración ve importes';
  perform pg_temp.yo();
  perform pg_temp.como(b);
  assert public.ve_importes(b), '1.4 La cuenta principal ve importes';
  perform pg_temp.yo();
  perform pg_temp.paso('1. rol Encargado');
end $$;

-- 2. Ticket nuevo de la encargada: precio del cliente, sin mano de obra, materiales sin precios
do $$
declare b uuid := '31000000-0000-0000-0000-0000000000b1'; o public.ordenes;
begin
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  insert into public.ordenes (id, profesional_id, empresa_id, numero_ticket, fecha, pedido, acondicionamientos, moes,
                              precio_acondicionamiento, factor_moe, mano_obra, materiales)
  values ('31000000-0000-0000-0000-0000000000d2', b, '31000000-0000-0000-0000-0000000000c1', '9002', current_date, 'Cámaras', 3, 1,
          1, 9, 99999, '[{"item":"Cámara","cantidad":2,"unidad":"u","costo":1,"precio":2,"proveedor":"Yo"}]');
  perform pg_temp.yo();
  select * into o from public.ordenes where id = '31000000-0000-0000-0000-0000000000d2';
  assert o.precio_acondicionamiento = 1200 and o.factor_moe = 2, '2.1 Precio y factor del cliente, no los que mandó';
  assert o.mano_obra is null, '2.2 Sin mano de obra';
  assert o.acondicionamientos = 3 and o.moes = 1, '2.3 Puestas y MOE como las cargó';
  assert o.materiales = '[{"item":"Cámara","cantidad":2,"unidad":"u"}]'::jsonb, '2.4 Materiales sin precios: ' || o.materiales::text;
  perform pg_temp.paso('2. ticket nuevo de la encargada');
end $$;

-- 3. Ticket que ya existe: cambia puestas y materiales; los precios quedan
do $$
declare o public.ordenes;
begin
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  update public.ordenes
     set acondicionamientos = 4, moes = 1, precio_acondicionamiento = 1, mano_obra = 0, factor_moe = 5,
         materiales = '[{"item":"Sensor","cantidad":3,"unidad":"u","precio":1},
                        {"item":"Cable","cantidad":10,"unidad":"m"},
                        {"item":"Sirena","cantidad":1,"unidad":"u","precio":1,"costo":1}]'
   where id = '31000000-0000-0000-0000-0000000000d1';
  perform pg_temp.yo();
  select * into o from public.ordenes where id = '31000000-0000-0000-0000-0000000000d1';
  assert o.acondicionamientos = 4 and o.moes = 1, '3.1 Puestas y MOE cambiadas';
  assert o.precio_acondicionamiento = 1200 and o.factor_moe = 2 and o.mano_obra = 500, '3.2 Precios como estaban';
  assert o.materiales -> 0 = '{"item":"Sensor","cantidad":3,"unidad":"u","costo":300,"margen":30,"precio":390,"proveedor":"Tienda X"}'::jsonb,
    '3.3 El renglón que estaba conserva sus precios con la cantidad nueva: ' || (o.materiales -> 0)::text;
  assert (o.materiales -> 1 ->> 'precio')::numeric = 15, '3.4 El otro renglón también';
  assert o.materiales -> 2 = '{"item":"Sirena","cantidad":1,"unidad":"u"}'::jsonb, '3.5 El renglón nuevo, sin precios';
  -- asignarlo o moverlo no toca nada más
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  update public.ordenes set asignado_a = '31000000-0000-0000-0000-0000000000e1' where id = '31000000-0000-0000-0000-0000000000d1';
  perform pg_temp.yo();
  assert (select materiales = o.materiales and asignado_a is not null from public.ordenes where id = o.id), '3.6 Asignar no cambia los materiales';
  perform pg_temp.paso('3. editar un ticket sin tocar precios');
end $$;

-- 4. Administración (con importes) y la cuenta principal sí cambian precios
do $$
declare o public.ordenes;
begin
  perform pg_temp.como('31000000-0000-0000-0000-0000000000a1');
  update public.ordenes set precio_acondicionamiento = 1300, mano_obra = 700,
         materiales = jsonb_set(materiales, '{2}', '{"item":"Sirena","cantidad":1,"unidad":"u","costo":800,"precio":1000}')
   where id = '31000000-0000-0000-0000-0000000000d1';
  perform pg_temp.yo();
  select * into o from public.ordenes where id = '31000000-0000-0000-0000-0000000000d1';
  assert o.precio_acondicionamiento = 1300 and o.mano_obra = 700 and (o.materiales -> 2 ->> 'precio')::numeric = 1000,
    '4.1 Administración pone los precios';
  perform pg_temp.como('31000000-0000-0000-0000-0000000000b1');
  update public.ordenes set mano_obra = 800 where id = '31000000-0000-0000-0000-0000000000d1';
  perform pg_temp.yo();
  assert (select mano_obra = 800 from public.ordenes where id = '31000000-0000-0000-0000-0000000000d1'), '4.2 La cuenta principal también';
  perform pg_temp.paso('4. con importes se cambian precios');
end $$;

-- 5. Turnos, horarios fijos y clientes: tampoco montos ni precios
do $$
declare b uuid := '31000000-0000-0000-0000-0000000000b1'; t public.turnos;
begin
  perform pg_temp.como(b);
  insert into public.turnos (id, profesional_id, titulo, inicio, fin, tipo, estado, monto_acordado)
  values ('31000000-0000-0000-0000-0000000000f1', b, 'Obra', now() + interval '1 day', now() + interval '1 day 2 hours', 'trabajo', 'confirmado', 5000);
  perform pg_temp.yo();
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  insert into public.turnos (id, profesional_id, titulo, inicio, fin, tipo, estado, monto_acordado)
  values ('31000000-0000-0000-0000-0000000000f2', b, 'Otra obra', now() + interval '2 days', now() + interval '2 days 2 hours', 'trabajo', 'confirmado', 9999);
  update public.turnos set monto_acordado = 1, titulo = 'Obra grande' where id = '31000000-0000-0000-0000-0000000000f1';
  perform pg_temp.yo();
  perform pg_temp.como('31000000-0000-0000-0000-0000000000f9');
  update public.clientes set precio_acondicionamiento = 1, factor_moe = 9, nombre = 'Gamma SA' where id = '31000000-0000-0000-0000-0000000000c1';
  perform pg_temp.yo();
  assert (select monto_acordado is null from public.turnos where id = '31000000-0000-0000-0000-0000000000f2'), '5.1 Turno nuevo sin monto';
  select * into t from public.turnos where id = '31000000-0000-0000-0000-0000000000f1';
  assert t.monto_acordado = 5000 and t.titulo = 'Obra grande', '5.2 Edita el turno y el monto queda';
  assert (select precio_acondicionamiento = 1200 and factor_moe = 2 and nombre = 'Gamma SA' from public.clientes
           where id = '31000000-0000-0000-0000-0000000000c1'), '5.3 Ventas edita el cliente y el precio por puesta queda';
  perform pg_temp.paso('5. turnos y clientes');
end $$;

-- 6. Lo del sistema sigue igual: el técnico cierra el trabajo y alguien de afuera no cambia nada
do $$
declare b uuid := '31000000-0000-0000-0000-0000000000b1';
begin
  perform pg_temp.como('31000000-0000-0000-0000-0000000000e1');
  perform public.iniciar_trabajo('ticket', '31000000-0000-0000-0000-0000000000d1');
  perform public.terminar_trabajo('ticket', '31000000-0000-0000-0000-0000000000d1', 'finalizado', 'Listo', 5, 1);
  perform pg_temp.yo();
  assert (select estado = 'finalizado' and acondicionamientos = 5 and precio_acondicionamiento = 1300 and mano_obra = 800
            from public.ordenes where id = '31000000-0000-0000-0000-0000000000d1'), '6.1 Cierra con sus puestas y los precios quedan';
  perform pg_temp.como('31000000-0000-0000-0000-0000000000c9');
  assert not public._equipo_sin_importes(b), '6.2 Alguien que no es del equipo no entra en la regla';
  perform pg_temp.yo();
  perform pg_temp.paso('6. cierre y personas de afuera');
end $$;

do $$
begin
  raise exception 'PRUEBAS OK: % de 6 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n');
end $$;
rollback;

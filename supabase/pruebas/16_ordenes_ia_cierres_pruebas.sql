-- =====================================================================
--  TaListo!  ·  PRUEBAS de 16_ordenes_ia_cierres.sql
--  Crea cuentas de prueba y verifica: quién puede leer órdenes con IA, el
--  tope mensual compartido con los comprobantes, que una lectura fallida no
--  cuente, el aislamiento entre cuentas y el cierre de planilla del cliente.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace. Si todo está bien, termina con el mensaje
--  "PRUEBAS OK" (sale como error a propósito: así se deshace la prueba).
--  Si algo falla, el mensaje dice qué prueba fue.
-- =====================================================================
begin;

-- A: empresa Business (dueño), T: agenda tickets en A, O: operario de A,
-- B: otra empresa Business, P: profesional Pro, F: profesional Free
insert into auth.users (id, email, raw_user_meta_data) values
  ('16000000-0000-0000-0000-00000000000a', 'prueba16a@talisto.test', '{"rol":"profesional","nombre":"Empresa A"}'),
  ('16000000-0000-0000-0000-00000000000b', 'prueba16b@talisto.test', '{"rol":"profesional","nombre":"Empresa B"}'),
  ('16000000-0000-0000-0000-00000000000c', 'prueba16p@talisto.test', '{"rol":"profesional","nombre":"Pro P"}'),
  ('16000000-0000-0000-0000-00000000000d', 'prueba16f@talisto.test', '{"rol":"profesional","nombre":"Free F"}'),
  ('16000000-0000-0000-0000-0000000000a1', 'prueba16t@talisto.test', '{"rol":"cliente","nombre":"Tina Tickets"}'),
  ('16000000-0000-0000-0000-0000000000a2', 'prueba16o@talisto.test', '{"rol":"cliente","nombre":"Oscar Operario"}');
insert into public.planes (usuario_id, plan, origen) values
  ('16000000-0000-0000-0000-00000000000a', 'business', 'regalo'),
  ('16000000-0000-0000-0000-00000000000b', 'business', 'regalo'),
  ('16000000-0000-0000-0000-00000000000c', 'pro', 'regalo')
on conflict (usuario_id) do update set plan = excluded.plan, origen = excluded.origen, vence_en = null;

do $$
declare e uuid; rt uuid; ro uuid; m1 uuid; m2 uuid;
begin
  insert into public.empresas (dueno_id, nombre) values ('16000000-0000-0000-0000-00000000000a', 'Empresa A') returning id into e;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Coordina', array['tickets_asignar']) returning id into rt;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Operario', array['tickets_trabajar']) returning id into ro;
  insert into public.miembros (empresa_id, usuario_id) values (e, '16000000-0000-0000-0000-0000000000a1') returning id into m1;
  insert into public.miembros (empresa_id, usuario_id) values (e, '16000000-0000-0000-0000-0000000000a2') returning id into m2;
  insert into public.miembros_roles values (m1, rt), (m2, ro);
end $$;

create function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.yo() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
end $$;
-- Devuelve el código de error de iniciar una lectura ('ok' si pudo)
create function pg_temp.intento(quien uuid, cuenta uuid) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.como(quien);
  begin
    perform public.iniciar_lectura_orden(cuenta, 'texto');
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  perform pg_temp.yo();
  return r;
end $$;

do $$
declare
  a constant uuid := '16000000-0000-0000-0000-00000000000a';
  b constant uuid := '16000000-0000-0000-0000-00000000000b';
  p constant uuid := '16000000-0000-0000-0000-00000000000c';
  f constant uuid := '16000000-0000-0000-0000-00000000000d';
  t constant uuid := '16000000-0000-0000-0000-0000000000a1';
  o constant uuid := '16000000-0000-0000-0000-0000000000a2';
  r json; v uuid; n int; cli uuid;
begin
  update public.configuracion set ia_lecturas_pro = 3, ia_lecturas_business = 300 where id = 1;

  -- Quién puede
  if pg_temp.intento(f, f) <> 'TL001' then raise exception 'P1: Free no tiene que poder leer órdenes'; end if;
  if pg_temp.intento(a, a) <> 'ok' then raise exception 'P2: el dueño tiene que poder'; end if;
  if pg_temp.intento(t, a) <> 'ok' then raise exception 'P3: quien agenda tickets tiene que poder'; end if;
  if pg_temp.intento(o, a) = 'ok' then raise exception 'P4: el operario no tiene que poder'; end if;
  if pg_temp.intento(b, a) = 'ok' then raise exception 'P5: otra empresa no tiene que poder usar esta cuenta'; end if;
  if pg_temp.intento(null, a) = 'ok' then raise exception 'P6: sin sesión no se puede'; end if;

  -- Quedó anotado quién leyó, sin datos de clientes
  select count(*) into n from public.lecturas_ordenes where profesional_id = a and usuario_nombre is not null;
  if n <> 2 then raise exception 'P7: tenían que quedar 2 lecturas de A, hay %', n; end if;

  -- Tope compartido con los comprobantes (Pro: 3)
  insert into public.comprobantes (profesional_id, usuario_id, estado) values (p, p, 'leido');
  perform pg_temp.como(p);
  r := public.iniciar_lectura_orden(p, 'foto');
  if (r ->> 'usadas')::int <> 2 or (r ->> 'limite')::int <> 3 then raise exception 'P8: usadas o límite mal: %', r; end if;
  v := (r ->> 'id')::uuid;

  -- Una lectura que falla no cuenta y se puede volver a leer
  perform public.terminar_lectura_orden(v, null, 'La IA está saturada');
  r := public.uso_lectura_ordenes(p);
  if (r ->> 'usadas')::int <> 1 or (r ->> 'puede')::boolean is not true then raise exception 'P9: la fallida no tenía que contar: %', r; end if;
  perform pg_temp.yo();

  if pg_temp.intento(p, p) <> 'ok' then raise exception 'P10: segunda lectura'; end if;
  if pg_temp.intento(p, p) <> 'ok' then raise exception 'P11: tercera lectura'; end if;
  if pg_temp.intento(p, p) <> 'TL002' then raise exception 'P12: la cuarta tenía que dar tope'; end if;

  -- Otro usuario no puede cerrar una lectura ajena
  select id into v from public.lecturas_ordenes where profesional_id = a and estado = 'leyendo' limit 1;
  perform pg_temp.como(b);
  perform public.terminar_lectura_orden(v, 5, null);
  perform pg_temp.yo();
  if (select estado from public.lecturas_ordenes where id = v) <> 'leyendo' then raise exception 'P13: cerró una lectura ajena'; end if;

  -- La tabla no se lee desde la app
  perform pg_temp.como(a);
  begin
    perform 1 from public.lecturas_ordenes limit 1;
    perform pg_temp.yo();
    raise exception 'P14: la tabla no tenía que poder leerse';
  exception when insufficient_privilege then
    perform pg_temp.yo();
  end;

  -- El uso del mes solo lo ve quien puede agendar
  perform pg_temp.como(o);
  begin
    perform public.uso_lectura_ordenes(a);
    perform pg_temp.yo();
    raise exception 'P15: el operario no tenía que ver el uso';
  exception when raise_exception then
    perform pg_temp.yo();
    if sqlerrm like 'P15%' then raise; end if;
  end;

  -- Cierre de planilla del cliente
  insert into public.clientes (profesional_id, nombre, es_empresa) values (a, 'Gamma', true) returning id into cli;
  if (select cierre_planilla from public.clientes where id = cli) <> '{}'::jsonb then raise exception 'P16: arranca vacío (mes calendario)'; end if;
  begin
    update public.clientes set cierre_planilla = '[]'::jsonb where id = cli;
    raise exception 'P17: tenía que rechazar lo que no es un objeto';
  exception when check_violation then null;
  end;

  -- Quien solo agenda tickets ve el cliente pero no le cambia el cierre
  perform pg_temp.como(t);
  update public.clientes set cierre_planilla = '{"reglas":[{"desde":"2026-11","dia":25}]}'::jsonb where id = cli;
  perform pg_temp.yo();
  if (select cierre_planilla from public.clientes where id = cli) <> '{}'::jsonb then raise exception 'P18: cambió el cierre sin permiso de clientes'; end if;

  -- El dueño sí, y otra cuenta no
  perform pg_temp.como(a);
  update public.clientes set cierre_planilla = '{"reglas":[{"desde":"2026-11","dia":25}]}'::jsonb where id = cli;
  perform pg_temp.como(b);
  update public.clientes set cierre_planilla = '{}'::jsonb where id = cli;
  perform pg_temp.yo();
  if (select cierre_planilla -> 'reglas' -> 0 ->> 'dia' from public.clientes where id = cli) <> '25' then raise exception 'P19: el cierre del dueño no quedó o lo pisó otra cuenta'; end if;

  -- Un ticket hecho como lo carga la app queda con la tarifa de la empresa
  update public.clientes set precio_acondicionamiento = 1200 where id = cli;
  perform pg_temp.como(t);
  insert into public.ordenes (profesional_id, empresa_id, numero_ticket, numero_cliente, fecha, hora_inicio, hora_fin, cliente_final, direccion, pedido,
                              acondicionamientos, moes, precio_acondicionamiento, factor_moe, estado, telefono_contacto, asignado_a)
  values (a, cli, '88812', '55310', current_date + 3, '09:00', '13:00', 'Ana Pérez', 'Rivera 2200', 'Instalar teclado', 1, 0, 1200, 1.75, 'pendiente', '099123456', o)
  returning id into v;
  perform pg_temp.yo();
  if (select estado || '/' || precio_acondicionamiento::int from public.ordenes where id = v) <> 'pendiente/1200' then raise exception 'P20: ticket mal cargado'; end if;
  if not exists (select 1 from public.ordenes where id = v and asignado_a = o) then raise exception 'P21: el ticket no quedó asignado'; end if;

  raise exception 'PRUEBAS OK';
end $$;

rollback;

-- =====================================================================
--  TaListo!  ·  PRUEBAS de 18_listas_pdf_ia.sql
--  Verifica quién puede leer listas de precios con IA, que toda la lista
--  cuente como una sola lectura (y solo si se leyó alguna tanda), el tope
--  compartido, los reintentos y el aislamiento entre cuentas.
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace. Si todo está bien, termina con el mensaje
--  "PRUEBAS OK" (sale como error a propósito: así se deshace la prueba).
-- =====================================================================
begin;

-- P: Pro, F: Free, B: otro Pro, A: empresa Business, C: compras en A, O: operario de A
insert into auth.users (id, email, raw_user_meta_data) values
  ('18000000-0000-0000-0000-00000000000a', 'prueba18a@talisto.test', '{"rol":"profesional","nombre":"Empresa A"}'),
  ('18000000-0000-0000-0000-00000000000b', 'prueba18b@talisto.test', '{"rol":"profesional","nombre":"Pro B"}'),
  ('18000000-0000-0000-0000-00000000000c', 'prueba18p@talisto.test', '{"rol":"profesional","nombre":"Pro P"}'),
  ('18000000-0000-0000-0000-00000000000d', 'prueba18f@talisto.test', '{"rol":"profesional","nombre":"Free F"}'),
  ('18000000-0000-0000-0000-0000000000a1', 'prueba18c@talisto.test', '{"rol":"cliente","nombre":"Carla Compras"}'),
  ('18000000-0000-0000-0000-0000000000a2', 'prueba18o@talisto.test', '{"rol":"cliente","nombre":"Oscar Operario"}');
insert into public.planes (usuario_id, plan, origen) values
  ('18000000-0000-0000-0000-00000000000a', 'business', 'regalo'),
  ('18000000-0000-0000-0000-00000000000b', 'pro', 'regalo'),
  ('18000000-0000-0000-0000-00000000000c', 'pro', 'regalo')
on conflict (usuario_id) do update set plan = excluded.plan, origen = excluded.origen, vence_en = null;

do $$
declare e uuid; rc uuid; ro uuid; m1 uuid; m2 uuid;
begin
  insert into public.empresas (dueno_id, nombre) values ('18000000-0000-0000-0000-00000000000a', 'Empresa A') returning id into e;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Compras', array['compras']) returning id into rc;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Operario', array['tickets_trabajar']) returning id into ro;
  insert into public.miembros (empresa_id, usuario_id) values (e, '18000000-0000-0000-0000-0000000000a1') returning id into m1;
  insert into public.miembros (empresa_id, usuario_id) values (e, '18000000-0000-0000-0000-0000000000a2') returning id into m2;
  insert into public.miembros_roles values (m1, rc), (m2, ro);
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
-- Código de error de empezar una lista ('ok' si pudo)
create function pg_temp.intento(quien uuid, prov uuid, tandas int default 3) returns text language plpgsql as $$
declare r text;
begin
  perform pg_temp.como(quien);
  begin
    perform public.iniciar_lectura_lista(prov, tandas);
    r := 'ok';
  exception when others then
    r := sqlstate;
  end;
  perform pg_temp.yo();
  return r;
end $$;

do $$
declare
  a constant uuid := '18000000-0000-0000-0000-00000000000a';
  b constant uuid := '18000000-0000-0000-0000-00000000000b';
  p constant uuid := '18000000-0000-0000-0000-00000000000c';
  f constant uuid := '18000000-0000-0000-0000-00000000000d';
  c constant uuid := '18000000-0000-0000-0000-0000000000a1';
  o constant uuid := '18000000-0000-0000-0000-0000000000a2';
  vp uuid; vf uuid; va uuid; vg uuid; r json; l uuid; l2 uuid; n int; i int;
begin
  update public.configuracion set ia_lecturas_pro = 3, ia_lecturas_business = 300 where id = 1;
  insert into public.proveedores (profesional_id, nombre) values (p, 'Barraca P') returning id into vp;
  insert into public.proveedores (profesional_id, nombre) values (f, 'Barraca F') returning id into vf;
  insert into public.proveedores (profesional_id, nombre) values (a, 'Barraca A') returning id into va;
  insert into public.proveedores (profesional_id, nombre) values (null, 'Proveedor de TaListo') returning id into vg;

  -- Quién puede
  if pg_temp.intento(f, vf) <> 'TL001' then raise exception 'P1: Free no tiene que poder'; end if;
  if pg_temp.intento(b, vp) = 'ok' then raise exception 'P2: otra cuenta no puede usar este proveedor'; end if;
  if pg_temp.intento(c, va) <> 'ok' then raise exception 'P3: quien tiene compras en la empresa tiene que poder'; end if;
  if pg_temp.intento(o, va) = 'ok' then raise exception 'P4: el operario no tiene que poder'; end if;
  if pg_temp.intento(p, vg) = 'ok' then raise exception 'P5: un proveedor de TaListo no se carga desde una cuenta'; end if;
  if pg_temp.intento(null, vp) = 'ok' then raise exception 'P6: sin sesión no se puede'; end if;
  if pg_temp.intento(p, vp, 0) = 'ok' or pg_temp.intento(p, vp, 41) = 'ok' then raise exception 'P7: cantidad de tandas fuera de rango'; end if;

  -- Una lista sin ninguna tanda leída no cuenta
  perform pg_temp.como(p);
  r := public.lecturas_ia(p);
  perform pg_temp.yo();
  if (r ->> 'usadas')::int <> 0 then raise exception 'P8: las listas sin leer no cuentan: %', r; end if;

  -- Una lista de 5 tandas leídas cuenta como 1
  perform pg_temp.como(p);
  r := public.iniciar_lectura_lista(vp, 5);
  l := (r ->> 'id')::uuid;
  if (r ->> 'limite')::int <> 3 then raise exception 'P9: límite mal: %', r; end if;
  for i in 1..5 loop
    r := public.tanda_lectura_lista(l);
    if (r ->> 'proveedor_id')::uuid <> vp then raise exception 'P10: proveedor mal'; end if;
    r := public.tanda_lista_leida(l, 40);
  end loop;
  if (r ->> 'usadas')::int <> 1 then raise exception 'P11: 5 tandas tienen que contar 1: %', r; end if;
  r := public.lecturas_ia(p);
  if (r ->> 'usadas')::int <> 1 then raise exception 'P12: lecturas_ia tiene que ver la lista: %', r; end if;

  -- Sin pedir la tanda, no se puede marcar leída
  perform public.tanda_lista_leida(l, 1000);
  perform pg_temp.yo();
  select leidas, productos into n, i from public.lecturas_listas where id = l;
  if n <> 5 or i <> 200 then raise exception 'P13: leidas % productos %', n, i; end if;

  -- Otro usuario no puede usar esta lectura
  perform pg_temp.como(b);
  begin
    perform public.tanda_lectura_lista(l);
    raise exception 'P14: otra cuenta usó la lectura';
  exception when sqlstate 'TL003' then null;
  end;
  perform pg_temp.yo();

  -- Reintentos con tope: 2 tandas → hasta 8 pedidos
  perform pg_temp.como(p);
  r := public.iniciar_lectura_lista(vp, 2);
  l2 := (r ->> 'id')::uuid;
  for i in 1..8 loop
    perform public.tanda_lectura_lista(l2);
  end loop;
  begin
    perform public.tanda_lectura_lista(l2);
    raise exception 'P15: tenía que cortar los reintentos';
  exception when sqlstate 'TL003' then null;
  end;
  perform pg_temp.yo();

  -- Lectura vencida
  update public.lecturas_listas set creado_en = now() - interval '4 hours', pedidas = 0 where id = l2;
  perform pg_temp.como(p);
  begin
    perform public.tanda_lectura_lista(l2);
    raise exception 'P16: tenía que estar vencida';
  exception when sqlstate 'TL003' then null;
  end;
  perform pg_temp.yo();

  -- Tope compartido con los comprobantes (Pro: 3): 1 lista + 2 comprobantes = 3
  insert into public.comprobantes (profesional_id, usuario_id, estado) values (p, p, 'leido'), (p, p, 'leido');
  if pg_temp.intento(p, vp) <> 'TL002' then raise exception 'P17: tenía que dar tope'; end if;

  -- La tabla no se lee desde la app
  perform pg_temp.como(p);
  begin
    perform 1 from public.lecturas_listas limit 1;
    perform pg_temp.yo();
    raise exception 'P18: la tabla no tenía que poder leerse';
  exception when insufficient_privilege then
    perform pg_temp.yo();
  end;

  raise exception 'PRUEBAS OK';
end $$;

rollback;

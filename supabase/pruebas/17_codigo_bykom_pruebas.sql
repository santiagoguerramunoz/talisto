-- =====================================================================
--  TaListo!  ·  PRUEBAS de 17_codigo_bykom.sql
--  Verifica que el código Bykom se guarde tal cual, que sea opcional y que
--  el técnico lo vea en Mis trabajos.
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace. Si todo está bien, termina con el mensaje
--  "PRUEBAS OK" (sale como error a propósito: así se deshace la prueba).
-- =====================================================================
begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('17000000-0000-0000-0000-00000000000a', 'prueba17a@talisto.test', '{"rol":"profesional","nombre":"Pro A"}');
insert into public.planes (usuario_id, plan, origen) values ('17000000-0000-0000-0000-00000000000a', 'pro', 'regalo')
on conflict (usuario_id) do update set plan = excluded.plan, origen = excluded.origen, vence_en = null;

do $$
declare
  a constant uuid := '17000000-0000-0000-0000-00000000000a';
  cli uuid; v1 uuid; v2 uuid; r json;
begin
  insert into public.clientes (profesional_id, nombre, es_empresa) values (a, 'Gamma', true) returning id into cli;

  -- Con letras, guión y barra: queda igual
  insert into public.ordenes (profesional_id, empresa_id, fecha, codigo_bykom, estado, asignado_a)
  values (a, cli, current_date, 'AB-12/3-b', 'pendiente', a) returning id into v1;
  if (select codigo_bykom from public.ordenes where id = v1) <> 'AB-12/3-b' then raise exception 'P1: el código cambió'; end if;

  -- Sin ningún código: se carga igual
  insert into public.ordenes (profesional_id, empresa_id, fecha, estado) values (a, cli, current_date, 'pendiente') returning id into v2;
  if (select codigo_bykom is null and numero_cliente is null and numero_ticket is null from public.ordenes where id = v2) is not true then
    raise exception 'P2: tenía que cargarse sin códigos';
  end if;

  -- Largo máximo
  begin
    update public.ordenes set codigo_bykom = repeat('x', 61) where id = v2;
    raise exception 'P3: tenía que rechazar más de 60 caracteres';
  exception when check_violation then null;
  end;

  -- El técnico lo ve
  perform set_config('request.jwt.claim.sub', a::text, true);
  perform set_config('role', 'authenticated', true);
  r := public.mis_trabajos(a, current_date, current_date);
  perform set_config('role', 'none', true);
  if r -> 'tickets' -> 0 ->> 'codigo_bykom' is distinct from 'AB-12/3-b' then raise exception 'P4: Mis trabajos no trae el código: %', r -> 'tickets'; end if;

  raise exception 'PRUEBAS OK';
end $$;

rollback;

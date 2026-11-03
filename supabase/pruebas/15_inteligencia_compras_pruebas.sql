-- =====================================================================
--  TaListo!  ·  PRUEBAS de 15_inteligencia_compras.sql
--  Crea dos empresas Business de prueba, registra compras con el mismo
--  camino que usa la app (registrar_comprobante y órdenes recibidas) y
--  verifica: productos equivalentes, aumentos y bajas, duplicados,
--  historial, aislamiento entre empresas, presupuestos y datos incompletos.
--
--  Se corre en Supabase > SQL Editor (o con psql). NO GUARDA NADA: al final
--  todo se deshace. Si todo está bien, termina con el mensaje
--  "PRUEBAS OK" (sale como error a propósito: así se deshace la prueba).
--  Si algo falla, el mensaje dice qué prueba fue.
-- =====================================================================
begin;

-- ---------------------------------------------------------------- datos de prueba
-- A: empresa Business (dueño), M: compras de A, O: operario de A (sin compras),
-- B: otra empresa Business, P: profesional Pro
insert into auth.users (id, email, raw_user_meta_data) values
  ('15000000-0000-0000-0000-00000000000a', 'prueba15a@talisto.test', '{"rol":"profesional","nombre":"Climatización A"}'),
  ('15000000-0000-0000-0000-00000000000b', 'prueba15b@talisto.test', '{"rol":"profesional","nombre":"Empresa B"}'),
  ('15000000-0000-0000-0000-00000000000c', 'prueba15p@talisto.test', '{"rol":"profesional","nombre":"Pro P"}'),
  ('15000000-0000-0000-0000-0000000000a1', 'prueba15m@talisto.test', '{"rol":"cliente","nombre":"Marta Compras"}'),
  ('15000000-0000-0000-0000-0000000000a2', 'prueba15o@talisto.test', '{"rol":"cliente","nombre":"Oscar Operario"}');
insert into public.planes (usuario_id, plan, origen) values
  ('15000000-0000-0000-0000-00000000000a', 'business', 'regalo'),
  ('15000000-0000-0000-0000-00000000000b', 'business', 'regalo'),
  ('15000000-0000-0000-0000-00000000000c', 'pro', 'regalo')
on conflict (usuario_id) do update set plan = excluded.plan, origen = excluded.origen, vence_en = null;
insert into public.ajustes (profesional_id, cotizacion_dolar) values ('15000000-0000-0000-0000-00000000000a', 40)
on conflict (profesional_id) do update set cotizacion_dolar = 40, alerta_precio_pct = 10, dias_precio_viejo = 90;

do $$
declare e uuid; rc uuid; ro uuid; m1 uuid; m2 uuid;
begin
  insert into public.empresas (dueno_id, nombre) values ('15000000-0000-0000-0000-00000000000a', 'Climatización A') returning id into e;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Compras', array['compras', 'stock']) returning id into rc;
  insert into public.roles_empresa (empresa_id, nombre, permisos) values (e, 'Operario', array['agenda']) returning id into ro;
  insert into public.miembros (empresa_id, usuario_id) values (e, '15000000-0000-0000-0000-0000000000a1') returning id into m1;
  insert into public.miembros (empresa_id, usuario_id) values (e, '15000000-0000-0000-0000-0000000000a2') returning id into m2;
  insert into public.miembros_roles values (m1, rc), (m2, ro);
end $$;

-- Ayudas: actuar como un usuario y registrar una compra como lo hace la app (comprobante leído con IA → revisado → registrado)
create function pg_temp.como(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.yo() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
end $$;
create function pg_temp.compra(cuenta uuid, quien uuid, d jsonb, forzar boolean default false) returns uuid language plpgsql as $$
declare id_ uuid;
begin
  insert into public.comprobantes (profesional_id, usuario_id, estado, datos, tipo, documento, numero, fecha, moneda, total)
  values (cuenta, quien, 'leido', d, 'compra', d ->> 'tipo_documento', d ->> 'numero', (d ->> 'fecha')::date, coalesce(d ->> 'moneda', 'UYU'),
          (d ->> 'total')::numeric)
  returning id into id_;
  perform pg_temp.como(quien);
  perform public.registrar_comprobante(id_, d, forzar);
  perform pg_temp.yo();
  return id_;
end $$;
create function pg_temp.paso(nombre text) returns void language plpgsql as $$
begin
  perform set_config('pruebas.n', (coalesce(nullif(current_setting('pruebas.n', true), ''), '0')::int + 1)::text, true);
  raise notice 'OK %', nombre;
end $$;
create function pg_temp.art(cuenta uuid, d text, u text) returns uuid language sql as $$
  select public._articulo_final(id) from public.articulos where profesional_id = cuenta and clave = public._clave_articulo(d, u);
$$;

-- ---------------------------------------------------------------- 1. Historial desde un comprobante leído con IA
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; c uuid; n int; h record;
begin
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'N-0001', 'fecha', current_date - 60, 'moneda', 'UYU',
    'subtotal', 4350, 'total', 5307, 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '211111110011'),
    'items', jsonb_build_array(
      jsonb_build_object('codigo', 'UTP6', 'descripcion', 'Cable UTP Cat 6', 'cantidad', 100, 'unidad', 'm', 'precio_unitario', 35, 'iva_pct', 22),
      jsonb_build_object('descripcion', 'Conector RJ45 Cat 6', 'cantidad', 50, 'unidad', 'u', 'precio_unitario', 12, 'iva_pct', 22),
      jsonb_build_object('descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 250, 'iva_pct', 22))));
  select count(*) into n from public.precios_historial where comprobante_id = c;
  assert n = 3, format('1.1 El comprobante debía dejar 3 precios en el historial y dejó %s', n);
  select * into h from public.precios_historial where comprobante_id = c and descripcion = 'Cable UTP Cat 6';
  assert h.precio = 35 and h.precio_base_uyu = 35 and h.proveedor_nombre = 'Distribuidora Norte' and h.origen = 'comprobante'
     and h.documento = 'e-Factura N-0001' and h.numero = 'N-0001' and h.fecha = current_date - 60 and h.cantidad = 100,
     '1.2 El precio no guardó proveedor, documento, fecha, cantidad o costo unitario';
  assert h.proveedor_id = (select proveedor_id from public.comprobantes where id = c), '1.3 El precio no quedó asociado al proveedor del comprobante';
  assert h.producto_id is not null, '1.4 El precio no quedó asociado al producto del proveedor';
  assert (select count(*) from public.alertas_precios where profesional_id = a) = 0, '1.5 Una primera compra no debe generar alertas';
  perform pg_temp.paso('1. historial desde comprobante (proveedor, producto, cantidad, costo, fecha y documento)');
end $$;

-- ---------------------------------------------------------------- 2. Productos equivalentes (y los que no lo son)
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; c uuid; x uuid; y uuid; z uuid; w uuid; j json;
begin
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'S-77', 'fecha', current_date - 40, 'moneda', 'UYU', 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Electro Sur', 'rut', '212222220011'),
    'items', jsonb_build_array(
      jsonb_build_object('codigo', 'ES-1', 'descripcion', 'CABLE UTP CAT6', 'cantidad', 50, 'unidad', 'metros', 'precio_unitario', 38, 'iva_pct', 22),
      jsonb_build_object('codigo', 'ES-2', 'descripcion', 'Cable UTP Cat 5e', 'cantidad', 50, 'unidad', 'm', 'precio_unitario', 30, 'iva_pct', 22),
      jsonb_build_object('codigo', 'ES-3', 'descripcion', 'Cable UTP Cat 6', 'cantidad', 1, 'unidad', 'rollo', 'precio_unitario', 11000, 'iva_pct', 22),
      jsonb_build_object('codigo', 'ES-4', 'descripcion', 'Flete', 'cantidad', 1, 'precio_unitario', 400, 'iva_pct', 22))));
  x := pg_temp.art(a, 'Cable UTP Cat 6', 'm');
  y := (select articulo_id from public.precios_historial where comprobante_id = c and codigo = 'ES-1');
  z := (select articulo_id from public.precios_historial where comprobante_id = c and codigo = 'ES-2');
  w := (select articulo_id from public.precios_historial where comprobante_id = c and codigo = 'ES-3');
  assert x is not null and x = y, '2.1 "CABLE UTP CAT6" en metros debía ser el mismo artículo que "Cable UTP Cat 6" en m';
  assert z <> x, '2.2 Cat 5e no es lo mismo que Cat 6: no se deben comparar';
  assert w <> x, '2.3 El rollo y el metro son presentaciones distintas: no se mezclan sin un factor';
  perform pg_temp.como(a);
  j := public.articulo_precios(x);
  perform pg_temp.yo();
  assert json_array_length(j -> 'comparador') = 2, format('2.4 El comparador debía tener 2 proveedores y tiene %s', json_array_length(j -> 'comparador'));
  assert (j -> 'comparador' -> 0 ->> 'proveedor') = 'Distribuidora Norte' and (j -> 'comparador' -> 0 ->> 'mejor')::boolean,
     '2.5 El más económico debía ser Distribuidora Norte ($ 35)';
  assert (j -> 'comparador' -> 1 ->> 'diferencia')::numeric = 3 and (j -> 'comparador' -> 1 ->> 'diferencia_pct')::numeric = 8.6,
     format('2.6 Diferencia de Electro Sur: esperaba $ 3 y 8,6%% y dio %s y %s', j -> 'comparador' -> 1 ->> 'diferencia', j -> 'comparador' -> 1 ->> 'diferencia_pct');
  assert exists (select 1 from json_array_elements(j -> 'equivalentes') e where e ->> 'nombre' ilike '%5e%') is false,
     '2.7 Cat 5e no debe sugerirse como equivalente de Cat 6 (medidas distintas)';
  -- Electro Sur es 8,6 % más caro (< 10 %): no corresponde alerta de "más barato en otro"
  assert (select count(*) from public.alertas_precios where profesional_id = a) = 0, '2.8 Una diferencia menor al umbral no debe generar alertas';
  perform pg_temp.paso('2. equivalentes: misma descripción y unidad se comparan; Cat 5e y el rollo quedan aparte');
end $$;

-- ---------------------------------------------------------------- 3. Aumento con alerta (el ejemplo del pedido) y aviso al equipo
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; m uuid := '15000000-0000-0000-0000-0000000000a1'; c uuid; al record; n int; j json;
begin
  c := pg_temp.compra(a, m, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'N-0002', 'fecha', current_date - 20, 'moneda', 'UYU', 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '211111110011'),
    'items', jsonb_build_array(
      jsonb_build_object('codigo', 'UTP6', 'descripcion', 'Cable UTP Cat 6', 'cantidad', 200, 'unidad', 'm', 'precio_unitario', 42, 'iva_pct', 22),
      jsonb_build_object('descripcion', 'Conector RJ45 Cat 6', 'cantidad', 50, 'unidad', 'u', 'precio_unitario', 12.5, 'iva_pct', 22))));
  select * into al from public.alertas_precios where comprobante_id = c and tipo = 'aumento';
  assert al.id is not null, '3.1 Un aumento del 20 % debía generar una alerta';
  assert al.variacion_pct = 20, format('3.2 La variación debía ser 20 %% y fue %s', al.variacion_pct);
  assert al.mensaje = 'Distribuidora Norte aumentó un 20% el costo de Cable UTP Cat 6 respecto a la última compra ($ 35 → $ 42). '
                     'Existe otro proveedor registrado que lo ofrece a $ 38: Electro Sur.', format('3.3 Mensaje inesperado: %s', al.mensaje);
  assert not exists (select 1 from public.alertas_precios where comprobante_id = c and articulo_id = al.articulo_id and tipo = 'mas_barato'),
     '3.4 Con la alerta de aumento alcanza: no se repite como "más barato en otro"';
  assert not exists (select 1 from public.alertas_precios where comprobante_id = c and tipo in ('aumento', 'baja') and articulo_id <> al.articulo_id),
     '3.5 El conector subió 4,2 % (menos que el umbral): no debía alertar';
  -- avisos con el sistema de siempre: al dueño (no a quien lo cargó) y no al operario
  select count(*) into n from public.notificaciones where usuario_id = a and tipo = 'precios' and titulo like 'Distribuidora Norte%';
  assert n = 1, format('3.6 El dueño debía recibir 1 aviso de precios y recibió %s', n);
  assert not exists (select 1 from public.notificaciones where usuario_id = '15000000-0000-0000-0000-0000000000a2' and tipo = 'precios'),
     '3.7 El operario (sin permiso de compras) no debe recibir avisos de precios';
  assert not exists (select 1 from public.notificaciones where usuario_id = m and tipo = 'precios'), '3.8 Quien cargó el comprobante ve las alertas en pantalla, no por aviso';
  perform pg_temp.como(m);
  j := public.alertas_de_comprobante(c);
  perform pg_temp.yo();
  assert json_array_length(j) = 1, '3.9 La pantalla de "comprobante registrado" debía mostrar la alerta';
  perform pg_temp.paso('3. aumento del 20 % con el aviso "Existe otro proveedor registrado que lo ofrece a $ 38"');
end $$;

-- ---------------------------------------------------------------- 4. Baja de precio, "más barato en otro" y umbral configurable
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; c uuid; al record; x uuid;
begin
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'S-78', 'fecha', current_date - 10, 'moneda', 'UYU', 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Electro Sur', 'rut', '212222220011'),
    'items', jsonb_build_array(jsonb_build_object('codigo', 'ES-1', 'descripcion', 'CABLE UTP CAT6', 'cantidad', 100, 'unidad', 'metros', 'precio_unitario', 33, 'iva_pct', 22))));
  select * into al from public.alertas_precios where comprobante_id = c and tipo = 'baja';
  assert al.id is not null and al.variacion_pct = -13.2, format('4.1 Bajar de $ 38 a $ 33 debía alertar una baja de 13,2 %% (dio %s)', al.variacion_pct);
  assert al.mensaje = 'Electro Sur bajó un 13,2% el costo de Cable UTP Cat 6 ($ 38 → $ 33).', format('4.1b Mensaje inesperado: %s', al.mensaje);
  -- Proveedor nuevo, mucho más caro que el mejor registrado → "más barato en otro"
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'Remito', 'numero', 'R-5', 'fecha', current_date - 9, 'moneda', 'UYU', 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Ferretería Centro'),
    'items', jsonb_build_array(jsonb_build_object('descripcion', 'Cable UTP cat. 6', 'cantidad', 20, 'unidad', 'mts', 'precio_unitario', 45, 'iva_pct', 22))));
  select * into al from public.alertas_precios where comprobante_id = c and tipo = 'mas_barato';
  assert al.id is not null and al.mensaje = 'Cable UTP Cat 6 está 26,7% más barato en Electro Sur ($ 33) que en Ferretería Centro ($ 45).',
     format('4.2 Faltó o salió mal la alerta de "más barato en otro": %s', al.mensaje);
  -- Umbral configurable: al 25 %, un aumento del 9,1 % no alerta
  perform pg_temp.como(a);
  perform public.guardar_ajustes_compras(a, 25, 120);
  perform pg_temp.yo();
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'S-79', 'fecha', current_date - 5, 'moneda', 'UYU', 'precios_con_iva', false,
    'proveedor', jsonb_build_object('nombre', 'Electro Sur', 'rut', '212222220011'),
    'items', jsonb_build_array(jsonb_build_object('codigo', 'ES-1', 'descripcion', 'CABLE UTP CAT6', 'cantidad', 10, 'unidad', 'metros', 'precio_unitario', 36, 'iva_pct', 22))));
  assert not exists (select 1 from public.alertas_precios where comprobante_id = c), '4.3 Con el umbral en 25 %, un 9,1 % no debía alertar';
  begin
    perform pg_temp.como('15000000-0000-0000-0000-0000000000a2');
    perform public.guardar_ajustes_compras(a, 5, 30);
    assert false, '4.4 El operario no debía poder cambiar el umbral';
  exception when assert_failure then raise; when others then perform pg_temp.yo();
  end;
  perform pg_temp.yo();
  update public.ajustes set alerta_precio_pct = 10 where profesional_id = a;
  perform pg_temp.paso('4. bajas, "más barato en otro" y umbral configurable (solo con permiso de compras)');
end $$;

-- ---------------------------------------------------------------- 5. Documentos duplicados
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; c uuid; n0 int; n1 int; d jsonb;
begin
  select count(*) into n0 from public.precios_historial where profesional_id = a;
  d := jsonb_build_object('tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'n-0002', 'fecha', current_date - 20, 'moneda', 'UYU',
         'precios_con_iva', false, 'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '21 111111 0011'),
         'items', jsonb_build_array(jsonb_build_object('codigo', 'UTP6', 'descripcion', 'Cable UTP Cat 6', 'cantidad', 200, 'unidad', 'm', 'precio_unitario', 42, 'iva_pct', 22)));
  -- 5.1 la app lo frena (mismo proveedor y número)
  begin
    c := pg_temp.compra(a, a, d);
    assert false, '5.1 El mismo número de factura del mismo proveedor debía frenarse';
  exception when assert_failure then raise; when others then
    perform pg_temp.yo();
    assert sqlerrm like 'El comprobante n-0002 ya se cargó%', format('5.1 Mensaje inesperado: %s', sqlerrm);
  end;
  -- 5.2 si igual lo fuerzan (por ejemplo, para cargar otra vez el stock), los precios no se duplican
  c := pg_temp.compra(a, a, d, true);
  select count(*) into n1 from public.precios_historial where profesional_id = a;
  assert n1 = n0, format('5.2 Un documento repetido no debe duplicar precios (antes %s, después %s)', n0, n1);
  -- 5.3 volver a disparar el registro del mismo comprobante no repite nada
  perform public._historial_de_comprobante((select id from public.comprobantes where numero = 'N-0002' and profesional_id = a and estado = 'registrado' order by registrado_en limit 1));
  select count(*) into n1 from public.precios_historial where profesional_id = a;
  assert n1 = n0, '5.3 Procesar dos veces el mismo comprobante no debe duplicar precios';
  -- 5.4 un comprobante ya registrado no se vuelve a registrar
  begin
    perform pg_temp.como(a);
    perform public.registrar_comprobante((select id from public.comprobantes where numero = 'N-0001' and profesional_id = a), d);
    assert false, '5.4 Registrar otra vez un comprobante ya registrado debía fallar';
  exception when assert_failure then raise; when others then perform pg_temp.yo();
  end;
  perform pg_temp.yo();
  perform pg_temp.paso('5. duplicados: mismo documento, proveedor, fecha y número no se repiten');
end $$;

-- ---------------------------------------------------------------- 6. Historial: no se borra, se anula; órdenes recibidas también suman
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; m uuid := '15000000-0000-0000-0000-0000000000a1'; x uuid; hid bigint; n int; o uuid; j json; ok boolean;
begin
  x := pg_temp.art(a, 'Cable UTP Cat 6', 'm');
  select id into hid from public.precios_historial where articulo_id = x and proveedor_nombre = 'Ferretería Centro';
  -- 6.1 nadie puede editar ni borrar el historial directo
  perform pg_temp.como(a);
  begin
    update public.precios_historial set precio = 1 where id = hid;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, '6.1 El historial no debe poder editarse directo';
  begin
    delete from public.precios_historial where id = hid;
    ok := false;
  exception when insufficient_privilege then ok := true;
  end;
  assert ok, '6.2 El historial no debe poder borrarse';
  -- 6.3 un precio mal cargado se anula con motivo: queda guardado y sale de las comparaciones
  perform pg_temp.yo();
  perform pg_temp.como(m);
  perform public.anular_precio(hid, 'Era cable de exterior, no el mismo');
  j := public.articulo_precios(x);
  perform pg_temp.yo();
  assert (select anulado and anulado_motivo like 'Era cable%' and anulado_por = m from public.precios_historial where id = hid), '6.3 El precio anulado debía quedar guardado con el motivo';
  assert not exists (select 1 from json_array_elements(j -> 'comparador') e where e ->> 'proveedor' = 'Ferretería Centro'), '6.4 Un precio anulado no se compara';
  assert exists (select 1 from json_array_elements(j -> 'historial') e where (e ->> 'id')::bigint = hid and (e ->> 'anulado')::boolean), '6.5 El historial muestra el anulado';
  assert exists (select 1 from public.bitacora where profesional_id = a and tipo = 'compras' and accion like 'Precio anulado%'), '6.6 La corrección queda en la bitácora';
  -- 6.7 orden de compra recibida → precio con origen "orden de compra"
  insert into public.ordenes_compra (profesional_id, proveedor_id, proveedor_nombre, fecha, estado, moneda, iva_incluido, items)
  values (a, (select id from public.proveedores where profesional_id = a and nombre = 'Electro Sur'), 'Electro Sur', current_date - 2, 'enviada', 'USD', false,
          jsonb_build_array(jsonb_build_object('item', 'Cable UTP Cat 6', 'cantidad', 100, 'unidad', 'm', 'precio', 0.9),
                            jsonb_build_object('item', 'Canaleta 20x10', 'cantidad', 10, 'unidad', 'u'))) returning id into o;
  update public.ordenes_compra set estado = 'recibida' where id = o;
  select count(*) into n from public.precios_historial where orden_compra_id = o;
  assert n = 1, format('6.7 La orden recibida debía dejar 1 precio (la canaleta no tiene precio) y dejó %s', n);
  assert (select precio = 0.9 and moneda = 'USD' and precio_base_uyu = 36 and origen = 'orden_compra' and documento like 'Orden de compra Nº %' and articulo_id = x
            from public.precios_historial where orden_compra_id = o), '6.8 La orden en dólares debía guardarse a $ 36 por metro (cotización 40)';
  update public.ordenes_compra set estado = 'parcial' where id = o;
  update public.ordenes_compra set estado = 'recibida' where id = o;
  assert (select count(*) from public.precios_historial where orden_compra_id = o) = 1, '6.9 Recibir dos veces la misma orden no duplica precios';
  perform pg_temp.paso('6. historial: no se edita ni se borra, se anula con motivo; órdenes recibidas suman con su origen');
end $$;

-- ---------------------------------------------------------------- 7. Aislamiento entre empresas y permisos
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; b uuid := '15000000-0000-0000-0000-00000000000b'; p uuid := '15000000-0000-0000-0000-00000000000c';
        o uuid := '15000000-0000-0000-0000-0000000000a2'; x uuid; n int; ok boolean; j json;
begin
  x := pg_temp.art(a, 'Cable UTP Cat 6', 'm');
  perform pg_temp.como(b);
  select count(*) into n from public.precios_historial; assert n = 0, '7.1 La empresa B no debe ver precios de A';
  select count(*) into n from public.articulos;         assert n = 0, '7.2 La empresa B no debe ver artículos de A';
  select count(*) into n from public.alertas_precios;   assert n = 0, '7.3 La empresa B no debe ver alertas de A';
  begin j := public.articulo_precios(x); ok := false; exception when others then ok := true; end;
  assert ok, '7.4 La empresa B no debe poder abrir la ficha de un artículo de A';
  begin j := public.inteligencia_compras(a, 90); ok := false; exception when others then ok := true; end;
  assert ok, '7.5 La empresa B no debe poder ver el panel de A';
  j := public.mejores_precios(a, '[{"i":0,"descripcion":"Cable UTP Cat 6","unidad":"m"}]');
  assert json_array_length(j) = 0, '7.6 La empresa B no debe obtener precios de A para sus presupuestos';
  begin perform public.anular_precio((select min(id) from public.precios_historial), 'x'); ok := false; exception when others then ok := true; end;
  assert ok, '7.7 La empresa B no debe poder anular precios de A';
  perform pg_temp.yo();
  -- dentro de la empresa: el operario sin compras/importes tampoco
  perform pg_temp.como(o);
  select count(*) into n from public.precios_historial; assert n = 0, '7.8 El operario no debe ver los precios de compra';
  begin j := public.inteligencia_compras(a, 90); ok := false; exception when others then ok := true; end;
  assert ok, '7.9 El operario no debe ver el panel de inteligencia';
  perform pg_temp.yo();
  -- Pro: su historial se guarda (sirve si pasa a Business) pero el panel es de Business
  perform pg_temp.compra(p, p, jsonb_build_object('tipo', 'compra', 'numero', '1', 'fecha', current_date, 'proveedor', jsonb_build_object('nombre', 'Sanitaria P'),
          'items', jsonb_build_array(jsonb_build_object('descripcion', 'Caño PPR 20', 'cantidad', 4, 'unidad', 'tira', 'precio_unitario', 180))));
  assert (select count(*) from public.precios_historial where profesional_id = p) = 1, '7.10 El historial del Pro debía guardarse';
  perform pg_temp.como(p);
  begin j := public.inteligencia_compras(p, 90); ok := false; exception when others then ok := true; end;
  perform pg_temp.yo();
  assert ok, '7.11 El panel de inteligencia es de Business';
  perform pg_temp.paso('7. aislamiento: otra empresa, el operario y el plan Pro no acceden a los precios');
end $$;

-- ---------------------------------------------------------------- 8. Presupuestos y rentabilidad
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; m uuid := '15000000-0000-0000-0000-0000000000a1'; x uuid; j json; e json; pid uuid; prod uuid; antes jsonb;
begin
  x := pg_temp.art(a, 'Cable UTP Cat 6', 'm');
  prod := (select producto_id from public.precios_historial where comprobante_id is not null and codigo = 'ES-1' limit 1);
  -- un presupuesto ya aceptado con el costo viejo (lo hace el dueño)
  perform set_config('request.jwt.claim.sub', a::text, true);
  insert into public.presupuestos (profesional_id, titulo, estado, aceptado_en, items)
  values (a, 'Red oficina', 'aceptado', now(), jsonb_build_array(jsonb_build_object('item', 'Cable UTP Cat 6', 'cantidad', 100, 'unidad', 'm', 'costo', 35, 'precio', 60, 'producto_id', prod)))
  returning id, items into pid, antes;
  perform pg_temp.como(m);
  j := public.mejores_precios(a, jsonb_build_array(
         jsonb_build_object('i', 0, 'descripcion', 'cable utp cat 6', 'unidad', 'metro'),
         jsonb_build_object('i', 1, 'producto_id', prod, 'descripcion', 'otro nombre cualquiera'),
         jsonb_build_object('i', 2, 'descripcion', 'Cable UTP Cat 6', 'unidad', 'rollo'),
         jsonb_build_object('i', 3, 'descripcion', 'Algo que nunca se compró', 'unidad', 'u')));
  perform pg_temp.yo();
  assert json_array_length(j) = 3, format('8.1 Debía devolver precios para 3 renglones (el que nunca se compró no) y devolvió %s', json_array_length(j));
  select z into e from json_array_elements(j) z where (z ->> 'i')::int = 0;
  assert (e ->> 'articulo_id')::uuid = x, '8.2 El renglón del presupuesto debía encontrar el artículo por descripción y unidad';
  assert e -> 'mejor' ->> 'proveedor' = 'Distribuidora Norte' or e -> 'mejor' ->> 'proveedor' = 'Electro Sur', '8.3 Falta el mejor proveedor';
  assert (e -> 'ultimo' ->> 'precio_uyu')::numeric = 36 and (e -> 'mejor' ->> 'precio_uyu')::numeric = 36,
     format('8.4 Último costo y mejor precio: esperaba $ 36 / $ 36 (orden en dólares) y dio %s / %s', e -> 'ultimo' ->> 'precio_uyu', e -> 'mejor' ->> 'precio_uyu');
  assert (e ->> 'opciones')::int >= 2 and not (e ->> 'desactualizado')::boolean, '8.5 Debía tener alternativas y no estar desactualizado';
  select z into e from json_array_elements(j) z where (z ->> 'i')::int = 1;
  assert (e ->> 'articulo_id')::uuid = x, '8.6 El producto del proveedor elegido en el presupuesto debía llevar al mismo artículo';
  select z into e from json_array_elements(j) z where (z ->> 'i')::int = 2;
  assert (e ->> 'articulo_id')::uuid <> x and (e -> 'ultimo' ->> 'precio_uyu')::numeric = 11000, '8.7 El rollo tiene su propio costo';
  -- 8.8 un precio viejo se marca como desactualizado
  update public.precios_historial set fecha = current_date - 200 where articulo_id = (e ->> 'articulo_id')::uuid;
  perform pg_temp.como(m);
  j := public.mejores_precios(a, '[{"i":2,"descripcion":"Cable UTP Cat 6","unidad":"rollo"}]');
  perform pg_temp.yo();
  assert (j -> 0 ->> 'desactualizado')::boolean and (j -> 0 ->> 'dias')::int = 200, '8.8 Un precio de hace 200 días debía marcarse desactualizado';
  -- 8.9 las compras nuevas no tocan presupuestos ya aceptados
  assert (select items = antes and estado = 'aceptado' from public.presupuestos where id = pid), '8.9 Un presupuesto aceptado no debe cambiar';
  -- 8.10 aviso de precios viejos (una vez por semana)
  perform pg_temp.como(m);
  assert public.revisar_precios_viejos(a) >= 1, '8.10 Debía avisar de artículos sin precio actualizado';
  assert public.revisar_precios_viejos(a) = 0, '8.11 El aviso de precios viejos sale como mucho una vez por semana';
  perform pg_temp.yo();
  assert exists (select 1 from public.notificaciones where usuario_id = a and titulo = 'Precios de compra desactualizados'), '8.12 El aviso de precios viejos llega al dueño';
  perform pg_temp.paso('8. presupuestos: último costo, mejor proveedor, alternativas, desactualizado; los aceptados no se tocan');
end $$;

-- ---------------------------------------------------------------- 9. Datos incompletos o que no cierran
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; c uuid; n int;
begin
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'N-0003', 'fecha', current_date - 3, 'moneda', 'UYU', 'precios_con_iva', false,
    'subtotal', 9999, 'total', 12198,
    'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '211111110011'),
    'items', jsonb_build_array(
      jsonb_build_object('descripcion', 'Caja estanca 10x10', 'cantidad', 10, 'unidad', 'u', 'precio_unitario', 150, 'iva_pct', 22),
      jsonb_build_object('descripcion', 'Precinto 200 mm', 'cantidad', 100, 'unidad', 'u'))));
  select count(*) into n from public.precios_historial where comprobante_id = c;
  assert n = 1, format('9.1 El renglón sin precio no debe entrar al historial (entraron %s)', n);
  assert not exists (select 1 from public.precios_historial h join public.articulos x on x.id = h.articulo_id where x.nombre like 'Precinto%'),
     '9.2 No se inventa un precio para el precinto';
  assert exists (select 1 from public.alertas_precios where comprobante_id = c and tipo = 'incompleto' and mensaje like '%1 artículo sin precio%'),
     '9.3 Debía pedir revisar el artículo sin precio';
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Factura', 'numero', 'N-0004', 'fecha', current_date - 2, 'moneda', 'UYU', 'precios_con_iva', false,
    'subtotal', 9999, 'total', 12198,
    'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '211111110011'),
    'items', jsonb_build_array(jsonb_build_object('descripcion', 'Caja estanca 10x10', 'cantidad', 10, 'unidad', 'u', 'precio_unitario', 150, 'iva_pct', 22))));
  assert exists (select 1 from public.alertas_precios where comprobante_id = c and tipo = 'inconsistencia'
                  and mensaje like '%la suma de los artículos ($ 1.500) no coincide con el subtotal del comprobante ($ 9.999)%'),
     '9.4 Una suma que no cierra con el subtotal debía marcarse para revisar';
  c := pg_temp.compra(a, a, jsonb_build_object(
    'tipo', 'compra', 'tipo_documento', 'e-Ticket', 'numero', 'N-0005', 'fecha', current_date - 1, 'moneda', 'UYU', 'precios_con_iva', true, 'total', 1830,
    'proveedor', jsonb_build_object('nombre', 'Distribuidora Norte', 'rut', '211111110011'),
    'items', jsonb_build_array(jsonb_build_object('descripcion', 'Caja estanca 10x10', 'cantidad', 10, 'unidad', 'u', 'precio_unitario', 183, 'iva_pct', 22))));
  assert not exists (select 1 from public.alertas_precios where comprobante_id = c and tipo in ('inconsistencia', 'aumento', 'baja')),
     '9.5 Un ticket con IVA incluido que cierra (y mismo precio sin IVA) no debe alertar';
  assert (select precio from public.precios_historial where comprobante_id = c) = 150, '9.6 El precio con IVA incluido se guarda sin IVA ($ 183 → $ 150)';
  perform pg_temp.paso('9. datos incompletos: sin precio no entra y se pide revisar; sumas que no cierran se marcan');
end $$;

-- ---------------------------------------------------------------- 10. Unir equivalentes con otra presentación, recomendación y panel
do $$
declare a uuid := '15000000-0000-0000-0000-00000000000a'; m uuid := '15000000-0000-0000-0000-0000000000a1'; x uuid; r uuid; ok boolean; j json; t text;
begin
  x := pg_temp.art(a, 'Cable UTP Cat 6', 'm');
  r := pg_temp.art(a, 'Cable UTP Cat 6', 'rollo');
  perform pg_temp.como(m);
  begin perform public.unir_articulos(r, x, null); ok := false; exception when others then ok := (sqlerrm like 'Las unidades son distintas%'); end;
  assert ok, '10.1 Unir rollo con metro sin decir cuántos metros trae el rollo debía pedir el factor';
  perform public.unir_articulos(r, x, 305);
  j := public.articulo_precios(r);         -- el viejo lleva al unido
  perform pg_temp.yo();
  assert (j -> 'articulo' ->> 'id')::uuid = x, '10.2 El artículo unido debía llevar al artículo destino';
  assert exists (select 1 from json_array_elements(j -> 'historial') e where (e ->> 'precio')::numeric = 11000 and round((e ->> 'precio_base_uyu')::numeric, 2) = 36.07),
     '10.3 El rollo de $ 11.000 debía quedar a $ 36,07 por metro';
  -- recomendación: clara y sin inventar
  t := j -> 'recomendacion' ->> 'texto';
  assert t like 'Recomendación: comprar a %' or t like 'Recomendación: seguir comprando a %', format('10.4 Recomendación inesperada: %s', t);
  assert exists (select 1 from json_array_elements_text(j -> 'recomendacion' -> 'notas') n where n like 'No hay datos de disponibilidad%'
                   or n like 'Stock informado%' or n like 'El proveedor informó%'), '10.5 La recomendación debía aclarar la disponibilidad';
  assert exists (select 1 from json_array_elements_text(j -> 'recomendacion' -> 'notas') n where n like 'No hay suficientes órdenes de compra%'),
     '10.6 Sin historial suficiente no se opina sobre la confiabilidad';
  assert exists (select 1 from json_array_elements_text(j -> 'recomendacion' -> 'notas') n where n = 'No hay condiciones comerciales registradas.'),
     '10.6b La nota automática del proveedor no es una condición comercial';
  -- artículo con un solo proveedor: lo dice expresamente
  r := pg_temp.art(a, 'Caja estanca 10x10', 'u');
  perform pg_temp.como(m);
  j := public.articulo_precios(r);
  perform pg_temp.yo();
  assert not (j -> 'recomendacion' ->> 'suficiente')::boolean and j -> 'recomendacion' ->> 'texto' like 'Solo hay precios de Distribuidora Norte%',
     '10.7 Con un solo proveedor debía decir que no hay con qué comparar';
  -- panel
  perform pg_temp.como(m);
  j := public.inteligencia_compras(a, 90);
  perform pg_temp.yo();
  assert (j -> 'indicadores' ->> 'proveedores')::int = 3, format('10.8 Proveedores: esperaba 3 y dio %s', j -> 'indicadores' ->> 'proveedores');
  assert (j -> 'indicadores' ->> 'articulos')::int = 4 and (j -> 'indicadores' ->> 'aumentos')::int >= 1, format('10.9 Artículos con historial (sin el flete ni el rollo unido): esperaba 4 y dio %s', j -> 'indicadores' ->> 'articulos');
  assert (j -> 'indicadores' ->> 'ahorro_potencial')::numeric > 0, '10.10 Debía detectar ahorro potencial';
  assert json_array_length(j -> 'competitivos') >= 2 and json_array_length(j -> 'ultimas') >= 5 and json_array_length(j -> 'evolucion') >= 1,
     '10.11 Faltan proveedores competitivos, últimas compras o evolución';
  assert exists (select 1 from json_array_elements(j -> 'aumentos') z where z ->> 'nombre' = 'Cable UTP Cat 6' and (z ->> 'pct')::numeric = 20), '10.12 El aumento del 20 % debía estar en el panel';
  perform pg_temp.paso('10. unir con factor, recomendación sin inventar y panel de inteligencia');
end $$;

-- ---------------------------------------------------------------- resultado
do $$
begin
  raise exception 'PRUEBAS OK: % de 10 grupos pasaron. (Este mensaje sale como error a propósito: así se deshace todo y no queda nada guardado.)',
    current_setting('pruebas.n', true);
end $$;
rollback;

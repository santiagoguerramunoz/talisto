-- =====================================================================
--  TaListo!  ·  25 · Materiales del stock reservados en cada ticket
--  · Los materiales se asignan a un ticket (de la agenda o B2B): salen del
--    depósito o de la persona y quedan reservados en ese trabajo.
--  · Quien hace el trabajo (o Stock) los procesa ítem por ítem: lo
--    procesado se usó y sale del stock.
--  · Lo que no se procesa queda pendiente de devolución. Al gestionar la
--    devolución vuelve todo al depósito y el ticket queda en 0.
--  · Lo que quedaba en trabajos ya terminados (antes contaba como usado)
--    se pasa una sola vez como procesado.
--  Correr después del 24. Se puede correr más de una vez.
-- =====================================================================

-- 1. Nuevo comprobante: "procesado en el trabajo" (consumo)
alter table public.movimientos_stock drop constraint if exists movimientos_stock_tipo_check;
alter table public.movimientos_stock add constraint movimientos_stock_tipo_check
  check (tipo in ('ingreso', 'transferencia', 'a_trabajo', 'devolucion', 'devolucion_proveedor', 'conteo', 'baja', 'anulacion', 'consumo'));
alter table public.configuracion add column if not exists stock_procesar_aplicado boolean not null default false;

-- 2. ¿El trabajo ya terminó (o se canceló)? Entonces lo que queda está pendiente de devolución
create or replace function public._trabajo_cerrado(p_tipo text, p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(case when p_tipo = 'ticket' then (select estado in ('finalizado', 'cancelado') from public.ordenes where id = p_id)
                       else (select estado in ('realizado', 'cancelado') from public.turnos where id = p_id) end, false);
$$;

-- 3. Procesar: lo que se usó en el trabajo sale del stock (ítem por ítem, todo o una parte)
create or replace function public.stock_procesar(p_cuenta uuid, p_tipo text, p_trabajo uuid, p_items jsonb, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare gestor boolean; orig uuid; rs jsonb; r jsonb; mov uuid;
begin
  perform public._stock_abrir(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  perform public._stock_trabajo_permitido(p_cuenta, p_tipo, p_trabajo, gestor, false);
  orig := public._stock_de_trabajo(p_cuenta, p_tipo, p_trabajo, false);
  if orig is null then raise exception 'Este trabajo no tiene materiales asignados'; end if;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'consumo', 'hecho', orig, null, rs, jsonb_build_object('nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, orig, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- 4. Gestionar la devolución: vuelve todo lo que no se procesó y el trabajo queda en 0
create or replace function public.stock_devolver_todo(p_cuenta uuid, p_tipo text, p_trabajo uuid, p_destino uuid,
                                                      p_motivo text default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare orig uuid; its jsonb; cancelado boolean; gestor boolean;
begin
  perform public._stock_abrir(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  -- quien hace el trabajo lo devuelve a su stock (se crea si no tenía); Stock elige (por defecto, el depósito principal)
  if not gestor then
    if not public._es_del_equipo(p_cuenta, auth.uid()) then raise exception 'Ese trabajo no está asignado a vos'; end if;
    p_destino := public._stock_de_operario(p_cuenta, auth.uid());
  elsif p_destino is null then
    p_destino := public._stock_principal(p_cuenta);
  end if;
  orig := public._stock_de_trabajo(p_cuenta, p_tipo, p_trabajo, false);
  if orig is null then raise exception 'Este trabajo no tiene materiales para devolver'; end if;
  select jsonb_agg(jsonb_build_object('material_id', s.material_id, 'cantidad', s.cantidad) order by m.nombre) into its
    from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = orig and s.cantidad > 0;
  if its is null then raise exception 'No queda nada para devolver: el trabajo ya está en 0'; end if;
  cancelado := case when p_tipo = 'ticket' then (select estado = 'cancelado' from public.ordenes where id = p_trabajo)
                    else (select estado = 'cancelado' from public.turnos where id = p_trabajo) end;
  return public.stock_desde_trabajo(p_cuenta, p_tipo, p_trabajo, p_destino, its,
           coalesce(nullif(p_motivo, ''), case when cancelado then 'cancelado' else 'sobrante' end),
           coalesce(nullif(trim(coalesce(p_nota, '')), ''), 'Devolución de lo que no se procesó'));
end $$;


-- 5. Materiales de un trabajo: reservados, procesados y si quedó pendiente de devolución
create or replace function public.stock_de_trabajo(p_cuenta uuid, p_tipo text, p_trabajo uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); ve boolean; gestor boolean; u uuid; mio uuid; asig uuid; nombre text; puede boolean := true; previstos jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  ve := public.ve_stock(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  if p_tipo = 'ticket' then
    select o.asignado_a into asig from public.ordenes o where o.id = p_trabajo and o.profesional_id = p_cuenta;
    if not found then raise exception 'Ese ticket no es de esta cuenta'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item', x ->> 'item', 'cantidad', public.numero_o_null(x ->> 'cantidad'), 'unidad', x ->> 'unidad',
             'material_id', coalesce(
               (select mt.id from public.materiales mt where mt.profesional_id = p_cuenta and mt.id = public.uuid_o_null(x ->> 'material_id')),
               (select v.material_id from public.materiales_vinculos v where v.profesional_id = p_cuenta
                  and v.producto_id = public.uuid_o_null(x ->> 'producto_id')),
               (select mt.id from public.materiales mt where mt.profesional_id = p_cuenta and mt.activo
                  and public.normalizar(mt.nombre) = public.normalizar(x ->> 'item') limit 1)))), '[]'::jsonb)
      into previstos
      from public.ordenes o, jsonb_array_elements(o.materiales) x
     where o.id = p_trabajo and nullif(trim(coalesce(x ->> 'item', '')), '') is not null;
  elsif p_tipo = 'turno' then
    select t.asignado_a into asig from public.turnos t where t.id = p_trabajo and t.profesional_id = p_cuenta;
    if not found then raise exception 'Ese trabajo no es de esta cuenta'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item', x ->> 'item', 'cantidad', public.numero_o_null(x ->> 'cantidad'), 'unidad', x ->> 'unidad',
             'material_id', coalesce(
               (select mt.id from public.materiales mt where mt.profesional_id = p_cuenta and mt.id = public.uuid_o_null(x ->> 'material_id')),
               (select v.material_id from public.materiales_vinculos v where v.profesional_id = p_cuenta
                  and v.producto_id = public.uuid_o_null(x ->> 'producto_id')),
               (select mt.id from public.materiales mt where mt.profesional_id = p_cuenta and mt.activo
                  and public.normalizar(mt.nombre) = public.normalizar(x ->> 'item') limit 1)))), '[]'::jsonb)
      into previstos
      from public.turnos t, jsonb_array_elements(t.materiales) x
     where t.id = p_trabajo and nullif(trim(coalesce(x ->> 'item', '')), '') is not null;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if not ve and not (asig = uid and public._es_del_equipo(p_cuenta, uid)) then
    raise exception 'Ese trabajo no está asignado a vos';
  end if;
  begin
    perform public._stock_trabajo_permitido(p_cuenta, p_tipo, p_trabajo, gestor, false);
  exception when others then
    puede := false;
  end;
  select id, ubicaciones_stock.nombre into u, nombre from public.ubicaciones_stock where (p_tipo = 'ticket' and orden_id = p_trabajo) or (p_tipo = 'turno' and turno_id = p_trabajo);
  select id into mio from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = uid;
  return json_build_object(
    'ubicacion', u, 'nombre', nombre, 'puede', puede, 'gestiona', gestor, 'mio', mio,
    'materiales', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                              'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                              'cantidad', s.cantidad) order by m.nombre), '[]'::json)
                     from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = u and s.cantidad > 0),
    'mi_stock', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                            'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                            'cantidad', s.cantidad) order by m.nombre), '[]'::json)
                   from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = mio and s.cantidad > 0),
    'previstos', previstos,
    -- lo que ya se procesó (se usó en el trabajo); lo que queda en 'materiales' está reservado o pendiente de devolución
    'procesados', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                              'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                              'cantidad', x.c) order by m.nombre), '[]'::json)
                     from (select i.material_id, sum(i.cantidad) as c
                             from public.movimientos_stock mv join public.movimientos_stock_items i on i.movimiento_id = mv.id
                            where u is not null and mv.origen_id = u and mv.tipo = 'consumo' and mv.estado = 'hecho' and mv.anulado_por is null
                            group by 1) x
                     join public.materiales m on m.id = x.material_id where x.c > 0),
    'cerrado', public._trabajo_cerrado(p_tipo, p_trabajo),
    'estado', case when p_tipo = 'ticket' then (select estado from public.ordenes where id = p_trabajo)
                   else (select estado from public.turnos where id = p_trabajo) end,
    'movimientos', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero desc), '[]'::json)
                      from public.movimientos_stock m where u is not null and (m.origen_id = u or m.destino_id = u))
  );
end $$;

-- 6. Existencias: los trabajos con materiales (abiertos o pendientes de devolución)
create or replace function public.stock_existencias(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare vc boolean;
begin
  if not public.ve_stock(p_cuenta) then raise exception 'No tenés permiso para ver el stock'; end if;
  vc := public.ve_costos(p_cuenta);
  return json_build_object(
    'gestiona', public.gestiona_stock(p_cuenta),
    've_costos', vc,
    'materiales', (select coalesce(json_agg(json_build_object(
        'id', m.id, 'codigo', m.codigo, 'nombre', m.nombre, 'marca', m.marca, 'categoria', m.categoria, 'unidad', m.unidad,
        'decimales', m.decimales, 'presentaciones', m.presentaciones, 'stock_minimo', m.stock_minimo, 'activo', m.activo, 'notas', m.notas,
        'costo', case when vc then c.costo end, 'moneda', case when vc then c.moneda end,
        'lugares', (select coalesce(json_agg(json_build_object('ubicacion_id', s.ubicacion_id, 'cantidad', s.cantidad)), '[]'::json)
                      from public.stock s join public.ubicaciones_stock u on u.id = s.ubicacion_id
                     where s.material_id = m.id and s.cantidad > 0 and u.tipo in ('deposito', 'operario')),
        'en_obra', (select coalesce(sum(s.cantidad), 0) from public.stock s join public.ubicaciones_stock u on u.id = s.ubicacion_id
                     left join public.ordenes o on o.id = u.orden_id left join public.turnos t on t.id = u.turno_id
                     where s.material_id = m.id and u.tipo = 'trabajo'),
        'transito', (select coalesce(sum(i.cantidad), 0) from public.movimientos_stock_items i
                      join public.movimientos_stock mv on mv.id = i.movimiento_id
                     where i.material_id = m.id and mv.estado = 'pendiente')
      ) order by m.activo desc, m.nombre), '[]'::json)
      from public.materiales m left join public.materiales_costos c on c.material_id = m.id
      where m.profesional_id = p_cuenta),
    'lugares', (select coalesce(json_agg(json_build_object(
        'id', u.id, 'tipo', u.tipo, 'nombre', u.nombre, 'principal', u.principal, 'activo', u.activo,
        'usuario_id', u.usuario_id, 'orden_id', u.orden_id, 'turno_id', u.turno_id,
        'trabajo_estado', case when u.tipo = 'trabajo' then coalesce(o.estado, t.estado, 'borrado') end,
        'trabajo_cerrado', u.tipo = 'trabajo' and coalesce(o.estado, t.estado, 'borrado') in ('finalizado', 'realizado', 'cancelado', 'borrado'),
        'trabajo_fecha', case when u.tipo = 'trabajo' then coalesce(o.fecha, (t.inicio at time zone 'America/Montevideo')::date) end,
        'asignado', case when u.tipo = 'trabajo' then public._nombre_de(coalesce(o.asignado_a, t.asignado_a)) end,
        'materiales', (select count(*) from public.stock s where s.ubicacion_id = u.id and s.cantidad > 0)
      ) order by case u.tipo when 'deposito' then 0 when 'operario' then 1 else 2 end, u.principal desc, u.nombre), '[]'::json)
      from public.ubicaciones_stock u
      left join public.ordenes o on o.id = u.orden_id left join public.turnos t on t.id = u.turno_id
      where u.profesional_id = p_cuenta
        and (u.tipo <> 'trabajo' or exists (select 1 from public.stock s where s.ubicacion_id = u.id and s.cantidad > 0))),
    'pendientes', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero), '[]'::json)
                     from public.movimientos_stock m where m.profesional_id = p_cuenta and m.estado = 'pendiente')
  );
end $$;

-- 7. Bitácora del ticket: "Materiales procesados"
create or replace function public.bitacora_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare o public.ubicaciones_stock; d public.ubicaciones_stock; ped public.pedidos_materiales; t_id uuid; o_id uuid; resumen text; n text;
begin
  if not ((old.huella is null and new.huella is not null) or (old.estado = 'pendiente' and new.estado <> 'pendiente')) then return new; end if;
  select * into o from public.ubicaciones_stock where id = new.origen_id;
  select * into d from public.ubicaciones_stock where id = new.destino_id;
  select * into ped from public.pedidos_materiales where movimiento_id = new.id limit 1;
  t_id := coalesce(d.turno_id, o.turno_id, ped.turno_id);
  o_id := coalesce(d.orden_id, o.orden_id, ped.orden_id);
  if t_id is null and o_id is null then return new; end if;
  n := 'Comprobante Nº ' || lpad(new.numero::text, 5, '0');
  select string_agg(public.cantidad_texto(i.cantidad) || ' ' || m.unidad || ' ' || m.nombre, ' · ' order by i.n) into resumen
    from public.movimientos_stock_items i join public.materiales m on m.id = i.material_id where i.movimiento_id = new.id;
  if old.huella is null and new.huella is not null then
    perform public._registrar(new.profesional_id, 'stock',
      case new.tipo when 'a_trabajo' then 'Materiales al trabajo (' || n || ')'
                    when 'devolucion' then 'Devolución del trabajo (' || n || ')'
                    when 'consumo' then 'Materiales procesados (' || n || ')'
                    when 'transferencia' then 'Entrega a ' || coalesce(d.nombre, 'alguien') || ' (' || n || ')' || case when new.estado = 'pendiente' then ': falta que confirme' else '' end
                    when 'anulacion' then 'Anulación (' || n || ')'
                    else initcap(new.tipo) || ' (' || n || ')' end,
      resumen, ped.presupuesto_id, t_id, o_id, ped.id, new.id);
  else
    perform public._registrar(new.profesional_id, 'stock',
      n || ': ' || case new.estado when 'hecho' then 'recibido por ' || coalesce(d.nombre, 'quien lo recibe') when 'rechazado' then 'rechazado'
                                    when 'cancelado' then 'cancelado' else new.estado end,
      new.respuesta, ped.presupuesto_id, t_id, o_id, ped.id, new.id);
  end if;
  return new;
end $$;

-- 8. Una sola vez: lo que quedó en trabajos ya terminados contaba como usado → se pasa como procesado
do $$
declare r record; rs jsonb; k jsonb; mov uuid;
begin
  if (select stock_procesar_aplicado from public.configuracion where id = 1) then return; end if;
  perform set_config('talisto.stock', 'si', true);
  for r in select u.id as ubic, u.profesional_id as cuenta
             from public.ubicaciones_stock u
             left join public.ordenes o on o.id = u.orden_id left join public.turnos t on t.id = u.turno_id
            where u.tipo = 'trabajo' and (o.estado = 'finalizado' or t.estado = 'realizado')
              and exists (select 1 from public.stock s where s.ubicacion_id = u.id and s.cantidad > 0)
            order by u.profesional_id loop
    perform pg_advisory_xact_lock(hashtext('stock' || r.cuenta::text));
    select jsonb_agg(jsonb_build_object('n', x.n, 'material_id', x.material_id, 'cantidad', x.cantidad)) into rs
      from (select row_number() over (order by s.material_id) as n, s.material_id, s.cantidad
              from public.stock s where s.ubicacion_id = r.ubic and s.cantidad > 0) x;
    mov := public._stock_comprobante(r.cuenta, 'consumo', 'hecho', r.ubic, null, rs,
             jsonb_build_object('nota', 'Pasaje al nuevo sistema: lo que quedó en el trabajo terminado se toma como usado'));
    for k in select * from jsonb_array_elements(rs) loop
      perform public._stock_sumar(r.cuenta, mov, r.ubic, (k ->> 'material_id')::uuid, -(k ->> 'cantidad')::numeric, 'alta');
    end loop;
  end loop;
  update public.configuracion set stock_procesar_aplicado = true where id = 1;
end $$;

-- 9. Permisos
do $$
declare f text;
begin
  foreach f in array array['public.stock_procesar(uuid, text, uuid, jsonb, text)', 'public.stock_devolver_todo(uuid, text, uuid, uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public._trabajo_cerrado(text, uuid) from public, anon, authenticated';
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

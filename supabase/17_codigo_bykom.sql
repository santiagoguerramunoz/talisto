-- =====================================================================
--  TaListo!  ·  CÓDIGO BYKOM EN LOS TICKETS
--  El código de cliente y el código Bykom pasan a ser dos datos separados.
--  El Bykom se guarda como texto, tal cual: números, letras, guiones y
--  barras (1234, AB-123, 12/3-B). Es opcional, igual que el código de
--  cliente y el nº de ticket: se puede completar después a mano.
--  Los tickets anteriores no se tocan.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 16). Es re-ejecutable.
-- =====================================================================

alter table public.ordenes add column if not exists codigo_bykom text;
alter table public.ordenes drop constraint if exists ordenes_codigo_bykom_largo;
alter table public.ordenes add constraint ordenes_codigo_bykom_largo check (char_length(codigo_bykom) <= 60);

-- Mis trabajos: el técnico ve el código Bykom en su ticket
create or replace function public.mis_trabajos(p_cuenta uuid, p_desde date, p_hasta date)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v_ini timestamptz := (p_desde::timestamp at time zone 'America/Montevideo');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'America/Montevideo');
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_cuenta <> uid and not public.puede(p_cuenta, array['tickets_trabajar']) then
    raise exception 'No tenés permiso para trabajar en tickets de esta empresa';
  end if;
  if p_hasta < p_desde or p_hasta - p_desde > 62 then raise exception 'Rango de fechas no válido'; end if;
  return json_build_object(
    'tickets', coalesce((
      select json_agg(json_build_object(
        'tipo', 'ticket', 'id', o.id, 'fecha', o.fecha, 'fecha_inicio', o.fecha_inicio,
        'hora_inicio', o.hora_inicio, 'hora_fin', o.hora_fin,
        'numero_ticket', o.numero_ticket, 'numero_cliente', o.numero_cliente, 'codigo_bykom', o.codigo_bykom,
        'empresa', e.nombre, 'color', e.color, 'cliente_final', o.cliente_final, 'telefono', o.telefono_contacto,
        'direccion', o.direccion, 'referencia', o.referencia, 'lat', o.lat, 'lng', o.lng,
        'pedido', o.pedido, 'realizado', o.realizado, 'estado', o.estado, 'nota_estado', o.nota_estado,
        'tiempos', o.tiempos, 'acondicionamientos', o.acondicionamientos, 'moes', o.moes, 'orden_ruta', o.orden_ruta,
        'materiales', (select coalesce(jsonb_agg(jsonb_build_object('item', m ->> 'item', 'cantidad', m -> 'cantidad', 'unidad', m ->> 'unidad')), '[]'::jsonb)
                       from jsonb_array_elements(o.materiales) m),
        'pedido_materiales', public._pedido_de(null, o.id)
      ) order by o.fecha, o.orden_ruta nulls last, o.hora_inicio nulls last)
      from public.ordenes o
      join public.clientes e on e.id = o.empresa_id
      where o.profesional_id = p_cuenta and o.asignado_a = uid and o.estado not in ('cancelado', 'suspendido')
        and ((o.fecha between p_desde and p_hasta) or (o.estado in ('en_curso', 'multidia') and o.fecha <= p_hasta))
    ), '[]'::json),
    'turnos', coalesce((
      select json_agg(json_build_object(
        'tipo', t.tipo, 'id', t.id, 'numero', t.numero, 'titulo', t.titulo, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado,
        'cliente', c.nombre, 'cliente_empresa', coalesce(c.es_empresa, false), 'telefono', c.telefono, 'color', c.color,
        'direccion', coalesce(d.direccion, r.direccion), 'referencia', coalesce(d.referencia, r.referencia),
        'lat', coalesce(d.lat, r.lat), 'lng', case when d.lat is not null then d.lng else r.lng end,
        'notas', t.notas, 'resolucion', t.resolucion, 'nota_estado', t.nota_estado, 'inicio_original', t.inicio_original,
        'tiempos', t.tiempos, 'orden_ruta', t.orden_ruta, 'pedido', r.pedido, 'relevamiento_id', r.id,
        'presupuesto_numero', (select p.numero from public.presupuestos p where p.id = t.presupuesto_id),
        'con_materiales', t.con_materiales, 'materiales', t.materiales,
        'pedido_materiales', case when t.con_materiales then public._pedido_de(t.id, null) end
      ) order by t.inicio, t.orden_ruta nulls last)
      from public.turnos t
      left join public.clientes c on c.id = t.cliente_id
      left join public.direcciones d on d.id = t.direccion_id
      left join lateral (select r.id, r.pedido, r.direccion, r.referencia, r.lat, r.lng from public.relevamientos r
                         where r.turno_id = t.id limit 1) r on true
      where t.profesional_id = p_cuenta and t.asignado_a = uid and t.estado not in ('cancelado', 'suspendido', 'por_agendar')
        and t.inicio >= v_ini and t.inicio < v_fin
    ), '[]'::json)
  );
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

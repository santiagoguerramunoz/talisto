-- =====================================================================
--  TaListo!  ·  30 · Trabajos de varios días en la agenda
--  · Cada vez que se cierra un día de un trabajo "multi día" queda en la
--    agenda, ese día, un registro de lo trabajado: horario, avance y la
--    leyenda "Multi día · Sigue el …" (o "se continuó el …", o "terminado").
--  · Si al cerrar todavía no se puede coordinar cuándo se sigue, queda
--    "Pendiente de coordinar continuación" y aparece arriba de la agenda
--    para elegirle el día.
--  Correr después del 29. Se puede correr más de una vez.
-- =====================================================================

-- 1. Trabajos que siguen otro día sin fecha todavía
alter table public.ordenes add column if not exists continuar_pendiente boolean not null default false;
alter table public.turnos  add column if not exists continuar_pendiente boolean not null default false;

-- 2. Registro de cada día trabajado de un trabajo de varios días
create table if not exists public.trabajo_jornadas (
  id             uuid primary key default gen_random_uuid(),
  profesional_id uuid not null references public.perfiles(id) on delete cascade,   -- cuenta dueña del trabajo
  tipo           text not null check (tipo in ('ticket', 'turno')),
  trabajo_id     uuid not null,
  usuario_id     uuid references auth.users(id) on delete set null,                -- quien lo trabajó
  fecha          date not null,
  desde          timestamptz,
  hasta          timestamptz,
  titulo         text,
  avance         text,
  sigue_fecha    date,                                                              -- lo elegido al cerrar (vacío: a coordinar)
  sigue_hora     time,
  creado_en      timestamptz not null default now()
);
create index if not exists trabajo_jornadas_cuenta_idx on public.trabajo_jornadas (profesional_id, fecha);
create index if not exists trabajo_jornadas_trabajo_idx on public.trabajo_jornadas (trabajo_id, fecha);
alter table public.trabajo_jornadas enable row level security;
drop policy if exists trabajo_jornadas_ver on public.trabajo_jornadas;
create policy trabajo_jornadas_ver on public.trabajo_jornadas for select
  using (profesional_id = (select auth.uid()) or usuario_id = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['agenda', 'tickets_asignar'])));
revoke insert, update, delete on public.trabajo_jornadas from anon, authenticated;
grant select on public.trabajo_jornadas to authenticated;

-- 3. Al cambiarle el día (o al volver a empezarlo) deja de estar "a coordinar"
create or replace function public._continuacion_coordinada()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.continuar_pendiente and old.continuar_pendiente then
    if tg_table_name = 'ordenes' then
      if new.fecha is distinct from old.fecha or new.estado <> 'multidia' then
        new.continuar_pendiente := false;
        if new.estado = 'en_curso' and new.fecha < (now() at time zone 'America/Montevideo')::date then
          new.fecha := (now() at time zone 'America/Montevideo')::date;
        end if;
      end if;
    elsif new.inicio is distinct from old.inicio or new.estado in ('realizado', 'cancelado', 'suspendido', 'por_agendar')
          or jsonb_path_exists(coalesce(new.tiempos, '[]'::jsonb), '$[*] ? (!(exists(@.fin)) || @.fin == null)') then
      new.continuar_pendiente := false;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists talisto_continuacion_coordinada on public.ordenes;
create trigger talisto_continuacion_coordinada before update on public.ordenes
  for each row execute function public._continuacion_coordinada();
drop trigger if exists talisto_continuacion_coordinada on public.turnos;
create trigger talisto_continuacion_coordinada before update on public.turnos
  for each row execute function public._continuacion_coordinada();

-- 4. Cerrar un trabajo (multi día ahora puede quedar sin fecha y deja el registro del día)
create or replace function public.terminar_trabajo(
  p_tipo text, p_id uuid, p_resultado text, p_resolucion text default null,
  p_puestas numeric default null, p_moes numeric default null, p_nota text default null,
  p_lat double precision default null, p_lng double precision default null, p_fecha date default null,
  p_hora time default null, p_minutos int default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hoy date := (now() at time zone 'America/Montevideo')::date;
  dueno uuid; asignado uuid; est text; tiem jsonb; tipo_turno text; t_ini timestamptz; t_fin timestamptz;
  nuevos jsonb; nuevo_ini timestamptz; titulo text; quien text; quedan int; destino text;
  coordinan uuid[]; pendiente boolean := false; v_desde timestamptz;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_resultado not in ('finalizado', 'cancelado', 'suspendido', 'multidia') then raise exception 'Resultado no válido'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    p_lat := null; p_lng := null;
  end if;
  if p_tipo = 'ticket' then
    select profesional_id, asignado_a, estado, tiempos into dueno, asignado, est, tiem from public.ordenes where id = p_id for update;
  elsif p_tipo = 'turno' then
    select profesional_id, asignado_a, estado, tiempos, tipo, inicio, fin
      into dueno, asignado, est, tiem, tipo_turno, t_ini, t_fin from public.turnos where id = p_id for update;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if dueno is null or asignado is distinct from uid then raise exception 'Ese trabajo no está asignado a vos'; end if;
  if dueno <> uid and not public.puede(dueno, array['tickets_trabajar']) then
    raise exception 'No tenés permiso para trabajar en tickets de esta empresa';
  end if;
  if est in ('finalizado', 'cancelado', 'realizado', 'suspendido') then raise exception 'Ese trabajo ya está cerrado'; end if;
  if p_resultado = 'finalizado' and coalesce(trim(p_resolucion), '') = '' then
    raise exception 'Contá cómo quedó el trabajo para cerrarlo';
  end if;
  if p_resultado = 'cancelado' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Contá por qué no se pudo hacer';
  end if;
  if p_resultado = 'suspendido' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Poné el motivo de la suspensión';
  end if;
  if p_resultado = 'multidia' and p_fecha is null then
    pendiente := true;   -- sigue otro día, pero todavía no se pudo coordinar cuándo
  elsif p_resultado = 'multidia' then
    if p_fecha <= hoy or p_fecha > hoy + 365 then raise exception 'Elegí un día a partir de mañana'; end if;
    if p_tipo = 'turno' then
      if p_hora is null then raise exception 'Elegí a qué hora seguís'; end if;
      p_minutos := coalesce(p_minutos, greatest(30, (extract(epoch from (t_fin - t_ini)) / 60)::int));
      if p_minutos < 15 or p_minutos > 12 * 60 then raise exception 'Duración no válida'; end if;
    end if;
  end if;
  if (p_puestas is not null and (p_puestas < 0 or p_puestas > 999 or p_puestas * 2 <> trunc(p_puestas * 2)))
     or (p_moes is not null and (p_moes < 0 or p_moes > 999 or p_moes * 2 <> trunc(p_moes * 2))) then
    raise exception 'Las puestas y las MOE van de a media (0 · 0,5 · 1 · 1,5…)';
  end if;

  -- cierra la sesión abierta con la hora y el lugar
  select coalesce(jsonb_agg(case when s ->> 'fin' is null
                                 then s || jsonb_build_object('fin', to_jsonb(now()) #>> '{}', 'lat_f', p_lat, 'lng_f', p_lng)
                                 else s end order by n), '[]'::jsonb)
    into nuevos
    from jsonb_array_elements(coalesce(tiem, '[]'::jsonb)) with ordinality as x(s, n);

  perform set_config('talisto.trabajo_campo', 'si', true);
  if p_tipo = 'ticket' then
    update public.ordenes set
      tiempos = nuevos,
      estado = p_resultado,
      realizado = case when p_resultado in ('finalizado', 'multidia') then coalesce(left(nullif(trim(p_resolucion), ''), 2000), realizado) else realizado end,
      nota_estado = case when p_resultado in ('cancelado', 'suspendido') then left(trim(p_nota), 500)
                         when p_resultado = 'multidia' then left(nullif(trim(coalesce(p_nota, p_resolucion, '')), ''), 500)
                         else null end,
      fecha = case when p_resultado = 'multidia' and not pendiente then p_fecha else fecha end,
      hora_inicio = case when p_resultado = 'multidia' and not pendiente then p_hora else hora_inicio end,
      hora_fin = case when p_resultado = 'multidia' and not pendiente then (case when p_hora is not null and p_minutos is not null
                                                                    and extract(epoch from p_hora) / 60 + p_minutos < 24 * 60
                                                              then p_hora + make_interval(mins => p_minutos) end)
                      else hora_fin end,
      fecha_inicio = case when p_resultado = 'multidia' then coalesce(fecha_inicio, fecha) else fecha_inicio end,
      continuar_pendiente = (p_resultado = 'multidia' and pendiente),
      acondicionamientos = case when p_resultado = 'finalizado' then coalesce(p_puestas, acondicionamientos) else acondicionamientos end,
      moes = case when p_resultado = 'finalizado' then coalesce(p_moes, moes) else moes end,
      asignado_a = case when p_resultado = 'suspendido' then null else asignado_a end,
      orden_ruta = case when p_resultado in ('suspendido', 'multidia') then null else orden_ruta end,
      cerrado_por = case when p_resultado in ('finalizado', 'cancelado') then uid else cerrado_por end,
      cerrado_en = case when p_resultado in ('finalizado', 'cancelado') then now() else cerrado_en end
    where id = p_id;
  else
    begin
      nuevo_ini := case when p_resultado = 'multidia' and not pendiente then (p_fecha + p_hora) at time zone 'America/Montevideo' end;
      update public.turnos set
        tiempos = nuevos,
        estado = case p_resultado when 'finalizado' then 'realizado' when 'cancelado' then 'cancelado'
                                  when 'suspendido' then 'suspendido' else 'confirmado' end,
        resolucion = case when p_resultado = 'finalizado' then left(coalesce(nullif(trim(p_resolucion), ''), resolucion), 2000)
                          when p_resultado = 'multidia' then left(coalesce(nullif(trim(p_resolucion), ''), resolucion), 2000)
                          else resolucion end,
        nota_estado = case when p_resultado in ('cancelado', 'suspendido') then left(trim(p_nota), 500)
                           when p_resultado = 'multidia' then left(nullif(trim(coalesce(p_nota, p_resolucion, '')), ''), 500)
                           else null end,
        inicio_original = case when p_resultado = 'multidia' then coalesce(inicio_original, inicio) else inicio_original end,
        inicio = coalesce(nuevo_ini, inicio),
        continuar_pendiente = (p_resultado = 'multidia' and pendiente),
        fin = case when nuevo_ini is not null then nuevo_ini + make_interval(mins => p_minutos) else fin end,
        asignado_a = case when p_resultado = 'suspendido' then null else asignado_a end,
        orden_ruta = case when p_resultado in ('suspendido', 'multidia') then null else orden_ruta end,
        cerrado_por = case when p_resultado in ('finalizado', 'cancelado') then uid else cerrado_por end,
        cerrado_en = case when p_resultado in ('finalizado', 'cancelado') then now() else cerrado_en end
      where id = p_id;
    exception when exclusion_violation then
      raise exception 'Ya tenés otro trabajo en ese horario: elegí otra hora';
    end;
    -- un relevamiento hecho queda como relevado, con lo que anotó
    if tipo_turno = 'relevamiento' and p_resultado = 'finalizado' then
      update public.relevamientos set
        estado = case when estado = 'pendiente' then 'relevado' else estado end,
        notas = concat_ws(E'\n', nullif(notas, ''), trim(p_resolucion))
      where turno_id = p_id;
    end if;
  end if;
  -- multi día: queda el registro de lo trabajado hoy en la agenda
  if p_resultado = 'multidia' then
    select min((s ->> 'inicio')::timestamptz) into v_desde
      from jsonb_array_elements(coalesce(nuevos, '[]'::jsonb)) s
     where s ->> 'inicio' is not null and ((s ->> 'inicio')::timestamptz at time zone 'America/Montevideo')::date = hoy;
    insert into public.trabajo_jornadas (profesional_id, tipo, trabajo_id, usuario_id, fecha, desde, hasta, titulo, avance, sigue_fecha, sigue_hora)
    values (dueno, p_tipo, p_id, uid, hoy, v_desde, now(), public._titulo_trabajo(p_tipo, p_id),
            left(nullif(trim(coalesce(p_resolucion, p_nota, '')), ''), 2000),
            case when pendiente then null else p_fecha end, case when pendiente then null else p_hora end);
  end if;
  if p_lat is not null then
    insert into public.posiciones_equipo (cuenta_id, usuario_id, lat, lng) values (dueno, uid, p_lat, p_lng)
    on conflict (cuenta_id, usuario_id) do update set lat = excluded.lat, lng = excluded.lng, actualizado_en = now();
  end if;

  -- avisos a coordinación (si es parte de una empresa)
  if dueno <> uid then
    titulo := coalesce(public._titulo_trabajo(p_tipo, p_id), 'un trabajo');
    quien := coalesce(public._nombre_de(uid), 'Alguien del equipo');
    select array_agg(x) into coordinan from public._con_permiso(dueno, array['tickets_asignar', 'agenda']) x;
    destino := '/panel/equipo';
    perform public._avisar(coordinan, dueno, 'trabajo_' || p_resultado,
      case p_resultado
        when 'finalizado' then quien || ' terminó ' || titulo
        when 'cancelado' then quien || ' no pudo hacer ' || titulo
        when 'suspendido' then quien || ' suspendió ' || titulo || ': para reagendar'
        when 'multidia' then case when pendiente then quien || ' sigue ' || titulo || ' otro día: falta coordinar la continuación'
                             else quien || ' sigue ' || titulo || ' el ' || to_char(p_fecha, 'DD/MM') || coalesce(' ' || to_char(p_hora, 'HH24:MI'), '') end
        else quien || ' cerró ' || titulo end,
      case when p_resultado = 'finalizado' then nullif(trim(coalesce(p_resolucion, '')), '') else nullif(trim(coalesce(p_nota, p_resolucion, '')), '') end,
      destino, jsonb_build_object('trabajo', p_tipo, 'id', p_id));
    -- ¿le queda algo para hoy?
    select count(*) into quedan from (
      select 1 from public.ordenes o
       where o.profesional_id = dueno and o.asignado_a = uid and o.estado in ('pendiente', 'en_curso', 'multidia') and o.fecha <= hoy
         and not o.continuar_pendiente
      union all
      select 1 from public.turnos t
       where t.profesional_id = dueno and t.asignado_a = uid and t.estado in ('pendiente', 'confirmado')
         and (t.inicio at time zone 'America/Montevideo')::date = hoy and t.cerrado_en is null and not t.continuar_pendiente
         and not (t.id = p_id and p_tipo = 'turno')
    ) x;
    if quedan = 0 then
      perform public._avisar(coordinan, dueno, 'operario_libre', quien || ' quedó libre',
        'Terminó lo que tenía para hoy: le podés asignar otro trabajo.', destino, jsonb_build_object('usuario', uid));
    end if;
  end if;
  return json_build_object('ok', true);
end $$;

-- 5. Mis tickets: incluye los trabajos que siguen otro día sin fecha todavía
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
        'continuar_pendiente', o.continuar_pendiente,
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
        'continuar_pendiente', t.continuar_pendiente,
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
        and ((t.inicio >= v_ini and t.inicio < v_fin)
             or (t.continuar_pendiente and (now() at time zone 'America/Montevideo')::date between p_desde and p_hasta))
    ), '[]'::json)
  );
end $$;
-- 6. Elegir el día en que sigue un trabajo que quedó "a coordinar"
create or replace function public.coordinar_continuacion(p_tipo text, p_id uuid, p_fecha date, p_hora time default null, p_minutos int default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hoy date := (now() at time zone 'America/Montevideo')::date;
  dueno uuid; asignado uuid; pend boolean; t_ini timestamptz; t_fin timestamptz; ini timestamptz;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_tipo = 'ticket' then
    select profesional_id, asignado_a, continuar_pendiente into dueno, asignado, pend from public.ordenes where id = p_id for update;
  elsif p_tipo = 'turno' then
    select profesional_id, asignado_a, continuar_pendiente, inicio, fin into dueno, asignado, pend, t_ini, t_fin from public.turnos where id = p_id for update;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if dueno is null then raise exception 'Ese trabajo no existe'; end if;
  if not (dueno = uid or asignado is not distinct from uid or public.puede(dueno, array['tickets_asignar', 'agenda'])) then
    raise exception 'No podés coordinar este trabajo';
  end if;
  if not pend then raise exception 'Ese trabajo ya tiene el día coordinado'; end if;
  if p_fecha is null or p_fecha < hoy or p_fecha > hoy + 365 then raise exception 'Elegí un día a partir de hoy'; end if;
  if p_minutos is not null and (p_minutos < 15 or p_minutos > 12 * 60) then raise exception 'Duración no válida'; end if;
  perform set_config('talisto.trabajo_campo', 'si', true);
  if p_tipo = 'ticket' then
    update public.ordenes set
      fecha = p_fecha,
      hora_inicio = p_hora,
      hora_fin = case when p_hora is not null and p_minutos is not null and extract(epoch from p_hora) / 60 + p_minutos < 24 * 60
                      then p_hora + make_interval(mins => p_minutos) end,
      continuar_pendiente = false
    where id = p_id;
  else
    if p_hora is null then raise exception 'Elegí a qué hora se sigue'; end if;
    ini := (p_fecha + p_hora) at time zone 'America/Montevideo';
    if ini < now() then raise exception 'Esa hora ya pasó'; end if;
    begin
      update public.turnos set
        inicio = ini,
        fin = ini + make_interval(mins => coalesce(p_minutos, greatest(30, (extract(epoch from (t_fin - t_ini)) / 60)::int))),
        continuar_pendiente = false
      where id = p_id;
    exception when exclusion_violation then
      raise exception 'Ya hay otro trabajo en ese horario: elegí otra hora';
    end;
  end if;
  return json_build_object('ok', true);
end $$;

-- 7. Lo que se ve en la agenda
-- Registros de días trabajados, con cómo sigue cada trabajo ahora
create or replace function public.jornadas_agenda(p_cuenta uuid, p_desde date, p_hasta date)
returns json language sql stable set search_path = public as $$
  select coalesce(json_agg(x order by x.fecha, x.desde nulls last), '[]'::json)
    from (
      select j.id, j.tipo, j.trabajo_id, j.fecha, j.desde, j.hasta, j.titulo, j.avance, j.usuario_id,
             coalesce(c.color, '#5aa9e6') as color,
             case when sig.fecha is not null then 'siguio'
                  when coalesce(o.estado, t.estado) in ('finalizado', 'realizado') then 'terminado'
                  when coalesce(o.estado, t.estado) = 'cancelado' then 'cancelado'
                  when coalesce(o.estado, t.estado) in ('suspendido', 'por_agendar') then 'suspendido'
                  when coalesce(o.continuar_pendiente, t.continuar_pendiente, j.sigue_fecha is null) then 'pendiente'
                  else 'sigue' end as estado,
             case when sig.fecha is not null then sig.fecha
                  when o.id is not null then case when o.estado = 'finalizado' then (o.cerrado_en at time zone 'America/Montevideo')::date else o.fecha end
                  when t.id is not null then case when t.estado = 'realizado' then (t.cerrado_en at time zone 'America/Montevideo')::date
                                                  else (t.inicio at time zone 'America/Montevideo')::date end
                  else j.sigue_fecha end as sigue,
             case when sig.fecha is not null then null
                  when o.id is not null then o.hora_inicio
                  when t.id is not null then (t.inicio at time zone 'America/Montevideo')::time
                  else j.sigue_hora end as sigue_hora
        from public.trabajo_jornadas j
        left join public.ordenes o on j.tipo = 'ticket' and o.id = j.trabajo_id
        left join public.turnos t on j.tipo = 'turno' and t.id = j.trabajo_id
        left join public.clientes c on c.id = coalesce(o.empresa_id, t.cliente_id)
        left join lateral (select min(j2.fecha) fecha from public.trabajo_jornadas j2
                            where j2.trabajo_id = j.trabajo_id and j2.fecha > j.fecha) sig on true
       where j.profesional_id = p_cuenta and j.fecha between p_desde and p_hasta
    ) x;
$$;

-- Trabajos que siguen otro día y todavía no tienen fecha
create or replace function public.continuaciones_pendientes(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); todos boolean;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  todos := p_cuenta = uid or public.puede(p_cuenta, array['tickets_asignar', 'agenda']);
  if not todos and not public.puede(p_cuenta, array['tickets_trabajar']) then return '[]'::json; end if;
  return (
    select coalesce(json_agg(x order by x.desde), '[]'::json) from (
      select 'ticket' as tipo, o.id, public._titulo_trabajo('ticket', o.id) as titulo, coalesce(e.color, '#5aa9e6') as color,
             o.asignado_a, public._nombre_de(o.asignado_a) as asignado, o.nota_estado as avance, null::int as minutos,
             (select max(j.fecha) from public.trabajo_jornadas j where j.trabajo_id = o.id) as desde
        from public.ordenes o left join public.clientes e on e.id = o.empresa_id
       where o.profesional_id = p_cuenta and o.continuar_pendiente and o.estado = 'multidia'
         and (todos or o.asignado_a = uid)
      union all
      select 'turno', t.id, public._titulo_trabajo('turno', t.id), coalesce(c.color, '#5aa9e6'),
             t.asignado_a, public._nombre_de(t.asignado_a), t.nota_estado,
             greatest(30, (extract(epoch from (t.fin - t.inicio)) / 60)::int),
             (select max(j.fecha) from public.trabajo_jornadas j where j.trabajo_id = t.id)
        from public.turnos t left join public.clientes c on c.id = t.cliente_id
       where t.profesional_id = p_cuenta and t.continuar_pendiente and t.estado not in ('realizado', 'cancelado', 'suspendido', 'por_agendar')
         and (todos or t.asignado_a = uid)
    ) x);
end $$;

revoke execute on function public._continuacion_coordinada() from public, anon, authenticated;
revoke execute on function public.coordinar_continuacion(text, uuid, date, time, int) from public, anon;
grant execute on function public.coordinar_continuacion(text, uuid, date, time, int) to authenticated, service_role;
revoke execute on function public.jornadas_agenda(uuid, date, date) from public, anon;
grant execute on function public.jornadas_agenda(uuid, date, date) to authenticated, service_role;
revoke execute on function public.continuaciones_pendientes(uuid) from public, anon;
grant execute on function public.continuaciones_pendientes(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';

-- =====================================================================
-- LISTO.
-- =====================================================================

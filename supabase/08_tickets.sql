-- =====================================================================
--  TaListo!  ·  BUSINESS: TICKETS Y RUTAS DEL EQUIPO
--  · Administración asigna tickets B2B y turnos (trabajos, visitas,
--    relevamientos) a las cuentas de Producción, con el orden de la ruta.
--  · Producción ve SUS trabajos (sin importes), se inicia y los finaliza:
--    queda la hora y el lugar de inicio y fin, y la resolución.
--  · Solo quien hace el trabajo marca el inicio y el fin (Administración
--    no puede "iniciarse" en un ticket).
--  · La empresa ve en tiempo real el estado de las rutas y dónde está
--    cada uno mientras trabaja (si comparte la ubicación).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 07). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.soy_pro()') is null then
    raise exception 'Primero corré 07_seguridad.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
alter table public.ordenes add column if not exists asignado_a  uuid references public.perfiles(id) on delete set null;
alter table public.ordenes add column if not exists orden_ruta  int;
alter table public.ordenes add column if not exists cerrado_por uuid references public.perfiles(id) on delete set null;
alter table public.ordenes add column if not exists cerrado_en  timestamptz;
create index if not exists ordenes_asignado_idx on public.ordenes (asignado_a, fecha) where asignado_a is not null;

alter table public.turnos add column if not exists asignado_a  uuid references public.perfiles(id) on delete set null;
alter table public.turnos add column if not exists orden_ruta  int;
alter table public.turnos add column if not exists tiempos     jsonb not null default '[]'::jsonb;
alter table public.turnos add column if not exists resolucion  text;
alter table public.turnos add column if not exists cerrado_por uuid references public.perfiles(id) on delete set null;
alter table public.turnos add column if not exists cerrado_en  timestamptz;
alter table public.turnos drop constraint if exists turnos_tiempos_check;
alter table public.turnos add constraint turnos_tiempos_check check (jsonb_typeof(tiempos) = 'array');
create index if not exists turnos_asignado_idx on public.turnos (asignado_a, inicio) where asignado_a is not null;

-- En una empresa, dos personas distintas pueden tener trabajos a la misma hora
-- (lo que no se superpone es la agenda de cada uno)
alter table public.turnos drop constraint if exists turnos_sin_superposicion;
alter table public.turnos add constraint turnos_sin_superposicion exclude using gist (
  profesional_id with =,
  (coalesce(asignado_a, profesional_id)) with =,
  tstzrange(inicio, fin, '[)') with &&
) where (estado in ('pendiente', 'confirmado') and not flexible);

-- Última posición de cada cuenta del equipo mientras trabaja
create table if not exists public.posiciones_equipo (
  cuenta_id       uuid not null references public.profesionales(id) on delete cascade,  -- empresa (cuenta principal)
  usuario_id      uuid not null references public.perfiles(id) on delete cascade,
  lat             double precision not null check (lat between -90 and 90),
  lng             double precision not null check (lng between -180 and 180),
  precision_m     int,
  actualizado_en  timestamptz not null default now(),
  primary key (cuenta_id, usuario_id)
);

-- ---------------------------------------------------------------------
-- 2. Reglas
-- ---------------------------------------------------------------------
-- Solo se asigna a alguien del equipo de la empresa
create or replace function public.validar_asignado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.asignado_a is not null and new.asignado_a <> new.profesional_id
     and (tg_op = 'INSERT' or new.asignado_a is distinct from old.asignado_a)
     and not exists (select 1 from public.miembros m join public.empresas e on e.id = m.empresa_id
                     where e.dueno_id = new.profesional_id and m.usuario_id = new.asignado_a and m.estado = 'activo') then
    raise exception 'Esa persona no es parte del equipo de la empresa';
  end if;
  return new;
end $$;

-- El inicio y el fin del trabajo los marca quien lo hace (desde "Mis tickets").
-- La cuenta principal sigue pudiendo marcarlos en lo suyo.
create or replace function public.proteger_trabajo_campo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and coalesce(current_setting('talisto.trabajo_campo', true), '') <> 'si'
     and auth.uid() is distinct from new.profesional_id
     and coalesce(new.tiempos, '[]'::jsonb) is distinct from
         (case when tg_op = 'INSERT' then '[]'::jsonb else coalesce(old.tiempos, '[]'::jsonb) end) then
    raise exception 'El inicio y el fin del trabajo los marca la persona asignada desde Mis tickets.';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ordenes', 'turnos'] loop
    execute format('drop trigger if exists talisto_validar_asignado on public.%I', t);
    execute format('create trigger talisto_validar_asignado before insert or update on public.%I '
                   'for each row execute function public.validar_asignado()', t);
    execute format('drop trigger if exists talisto_trabajo_campo on public.%I', t);
    execute format('create trigger talisto_trabajo_campo before insert or update on public.%I '
                   'for each row execute function public.proteger_trabajo_campo()', t);
  end loop;
end $$;

-- Cierra la sesión que haya quedado abierta
create or replace function public.cerrar_sesiones(t jsonb)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(case when s ->> 'fin' is null then s || jsonb_build_object('fin', to_jsonb(now()) #>> '{}') else s end
                            order by n), '[]'::jsonb)
  from jsonb_array_elements(coalesce(t, '[]'::jsonb)) with ordinality as x(s, n);
$$;

-- Si una cuenta sale de la empresa: se borra su posición y sus trabajos sin terminar
-- quedan sin asignar (los que estaba haciendo, suspendidos) para dárselos a otro
create or replace function public.al_salir_del_equipo()
returns trigger language plpgsql security definer set search_path = public as $$
declare dueno uuid; t record;
begin
  select dueno_id into dueno from public.empresas where id = old.empresa_id;
  if dueno is null then return old; end if;
  delete from public.posiciones_equipo where cuenta_id = dueno and usuario_id = old.usuario_id;
  perform set_config('talisto.trabajo_campo', 'si', true);
  update public.ordenes set
      asignado_a = null,
      tiempos = public.cerrar_sesiones(tiempos),
      estado = case when estado = 'en_curso' then 'suspendido' else estado end,
      nota_estado = case when estado = 'en_curso' then 'Quien lo estaba haciendo salió del equipo' else nota_estado end
   where profesional_id = dueno and asignado_a = old.usuario_id
     and estado in ('pendiente', 'en_curso', 'suspendido', 'multidia');
  for t in select id from public.turnos
            where profesional_id = dueno and asignado_a = old.usuario_id and estado in ('pendiente', 'confirmado') loop
    begin
      update public.turnos set asignado_a = null, tiempos = public.cerrar_sesiones(tiempos) where id = t.id;
    exception when exclusion_violation then
      -- choca con otro sin asignar a esa hora: queda pendiente de reasignar
      update public.turnos set asignado_a = null, tiempos = public.cerrar_sesiones(tiempos), estado = 'cancelado',
                               notas = concat_ws(E'\n', nullif(notas, ''), 'Cancelado: quien lo tenía salió del equipo y chocaba con otro trabajo')
       where id = t.id;
    end;
  end loop;
  return old;
end $$;

drop trigger if exists talisto_al_salir_del_equipo on public.miembros;
create trigger talisto_al_salir_del_equipo after delete on public.miembros
  for each row execute function public.al_salir_del_equipo();

-- ---------------------------------------------------------------------
-- 3. Para quien asigna: el equipo que puede trabajar en tickets
-- ---------------------------------------------------------------------
create or replace function public.equipo_asignable(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.puede(p_cuenta, array['tickets_asignar', 'agenda']) then
    raise exception 'No tenés permiso para ver el equipo';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'usuario_id', m.usuario_id,
             'nombre', coalesce(nullif(pr.nombre_publico, ''), nullif(pe.nombre, ''), pe.email),
             'trabaja', exists (select 1 from public.miembros_roles mr join public.roles_empresa r on r.id = mr.rol_id
                                where mr.miembro_id = m.id and not r.bloqueado and 'tickets_trabajar' = any(r.permisos)))
           order by coalesce(nullif(pr.nombre_publico, ''), nullif(pe.nombre, ''), pe.email))
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.dueno_id = p_cuenta
    join public.perfiles pe on pe.id = m.usuario_id
    left join public.profesionales pr on pr.id = m.usuario_id
    where m.estado = 'activo'
  ), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
-- 4. Para Producción: sus trabajos (sin importes), iniciar y terminar
-- ---------------------------------------------------------------------
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
        'numero_ticket', o.numero_ticket, 'numero_cliente', o.numero_cliente,
        'empresa', e.nombre, 'color', e.color, 'cliente_final', o.cliente_final,
        'direccion', o.direccion, 'referencia', o.referencia, 'lat', o.lat, 'lng', o.lng,
        'pedido', o.pedido, 'realizado', o.realizado, 'estado', o.estado, 'nota_estado', o.nota_estado,
        'tiempos', o.tiempos, 'acondicionamientos', o.acondicionamientos, 'moes', o.moes, 'orden_ruta', o.orden_ruta,
        'materiales', (select coalesce(jsonb_agg(jsonb_build_object('item', m ->> 'item', 'cantidad', m -> 'cantidad', 'unidad', m ->> 'unidad')), '[]'::jsonb)
                       from jsonb_array_elements(o.materiales) m)
      ) order by o.fecha, o.orden_ruta nulls last, o.hora_inicio nulls last)
      from public.ordenes o
      join public.clientes e on e.id = o.empresa_id
      where o.profesional_id = p_cuenta and o.asignado_a = uid and o.estado <> 'cancelado'
        and ((o.fecha between p_desde and p_hasta) or (o.estado in ('en_curso', 'multidia') and o.fecha <= p_hasta))
    ), '[]'::json),
    'turnos', coalesce((
      select json_agg(json_build_object(
        'tipo', t.tipo, 'id', t.id, 'titulo', t.titulo, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado,
        'cliente', c.nombre, 'telefono', c.telefono, 'color', c.color,
        'direccion', coalesce(d.direccion, r.direccion), 'referencia', coalesce(d.referencia, r.referencia),
        'lat', coalesce(d.lat, r.lat), 'lng', case when d.lat is not null then d.lng else r.lng end,
        'notas', t.notas, 'resolucion', t.resolucion, 'tiempos', t.tiempos, 'orden_ruta', t.orden_ruta,
        'pedido', r.pedido, 'relevamiento_id', r.id
      ) order by t.inicio, t.orden_ruta nulls last)
      from public.turnos t
      left join public.clientes c on c.id = t.cliente_id
      left join public.direcciones d on d.id = t.direccion_id
      left join lateral (select r.id, r.pedido, r.direccion, r.referencia, r.lat, r.lng from public.relevamientos r
                         where r.turno_id = t.id limit 1) r on true
      where t.profesional_id = p_cuenta and t.asignado_a = uid and t.estado <> 'cancelado'
        and t.inicio >= v_ini and t.inicio < v_fin
    ), '[]'::json)
  );
end $$;

-- Sesión de trabajo abierta (sin fin) dentro de "tiempos"
create or replace function public.tiempos_abierto(t jsonb)
returns boolean language sql immutable as $$
  select exists (select 1 from jsonb_array_elements(coalesce(t, '[]'::jsonb)) s where s ->> 'fin' is null);
$$;

create or replace function public.iniciar_trabajo(p_tipo text, p_id uuid, p_lat double precision default null, p_lng double precision default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  dueno uuid; asignado uuid; est text; tiem jsonb;
  ses jsonb;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    p_lat := null; p_lng := null;
  end if;
  if p_tipo = 'ticket' then
    select profesional_id, asignado_a, estado, tiempos into dueno, asignado, est, tiem from public.ordenes where id = p_id for update;
  elsif p_tipo = 'turno' then
    select profesional_id, asignado_a, estado, tiempos into dueno, asignado, est, tiem from public.turnos where id = p_id for update;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if dueno is null or asignado is distinct from uid then raise exception 'Ese trabajo no está asignado a vos'; end if;
  if dueno <> uid and not public.puede(dueno, array['tickets_trabajar']) then
    raise exception 'No tenés permiso para trabajar en tickets de esta empresa';
  end if;
  if est in ('finalizado', 'cancelado', 'realizado') then raise exception 'Ese trabajo ya está cerrado'; end if;
  if public.tiempos_abierto(tiem) then return json_build_object('ya_iniciado', true); end if;

  ses := jsonb_build_object('inicio', to_jsonb(now()) #>> '{}', 'fin', null, 'por', uid, 'lat_i', p_lat, 'lng_i', p_lng);
  perform set_config('talisto.trabajo_campo', 'si', true);
  if p_tipo = 'ticket' then
    update public.ordenes set tiempos = coalesce(tiempos, '[]'::jsonb) || jsonb_build_array(ses), estado = 'en_curso',
                              fecha = (now() at time zone 'America/Montevideo')::date,
                              fecha_inicio = coalesce(fecha_inicio, (now() at time zone 'America/Montevideo')::date),
                              nota_estado = null
     where id = p_id;
  else
    update public.turnos set tiempos = coalesce(tiempos, '[]'::jsonb) || jsonb_build_array(ses),
                             estado = case when estado = 'pendiente' then 'confirmado' else estado end
     where id = p_id;
  end if;
  if p_lat is not null then
    insert into public.posiciones_equipo (cuenta_id, usuario_id, lat, lng) values (dueno, uid, p_lat, p_lng)
    on conflict (cuenta_id, usuario_id) do update set lat = excluded.lat, lng = excluded.lng, actualizado_en = now();
  end if;
  return json_build_object('ok', true);
end $$;

-- p_resultado: 'finalizado' · 'suspendido' · 'multidia' (sigue otro día: p_fecha)
drop function if exists public.terminar_trabajo(text, uuid, text, text, numeric, numeric, text, double precision, double precision);
create or replace function public.terminar_trabajo(
  p_tipo text, p_id uuid, p_resultado text, p_resolucion text default null,
  p_puestas numeric default null, p_moes numeric default null, p_nota text default null,
  p_lat double precision default null, p_lng double precision default null, p_fecha date default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  hoy date := (now() at time zone 'America/Montevideo')::date;
  dueno uuid; asignado uuid; est text; tiem jsonb; tipo_turno text; tid uuid;
  nuevos jsonb;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_resultado not in ('finalizado', 'suspendido', 'multidia') then raise exception 'Resultado no válido'; end if;
  if p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    p_lat := null; p_lng := null;
  end if;
  if p_tipo = 'ticket' then
    select profesional_id, asignado_a, estado, tiempos into dueno, asignado, est, tiem from public.ordenes where id = p_id for update;
  elsif p_tipo = 'turno' then
    select profesional_id, asignado_a, estado, tiempos, tipo, id into dueno, asignado, est, tiem, tipo_turno, tid from public.turnos where id = p_id for update;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if dueno is null or asignado is distinct from uid then raise exception 'Ese trabajo no está asignado a vos'; end if;
  if dueno <> uid and not public.puede(dueno, array['tickets_trabajar']) then
    raise exception 'No tenés permiso para trabajar en tickets de esta empresa';
  end if;
  if est in ('finalizado', 'cancelado', 'realizado') then raise exception 'Ese trabajo ya está cerrado'; end if;
  if p_resultado = 'finalizado' and coalesce(trim(p_resolucion), '') = '' then
    raise exception 'Contá cómo quedó el trabajo para cerrarlo';
  end if;
  if p_resultado = 'suspendido' and coalesce(trim(p_nota), '') = '' then
    raise exception 'Poné el motivo de la suspensión';
  end if;
  if p_resultado = 'multidia' and p_tipo = 'ticket' then
    p_fecha := coalesce(p_fecha, hoy + 1);
    if p_fecha <= hoy or p_fecha > hoy + 365 then raise exception 'Elegí un día a partir de mañana'; end if;
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
      realizado = coalesce(left(nullif(trim(p_resolucion), ''), 2000), realizado),
      nota_estado = case when p_resultado = 'suspendido' then left(trim(p_nota), 500) else null end,
      fecha = case when p_resultado = 'multidia' then p_fecha else fecha end,
      fecha_inicio = case when p_resultado = 'multidia' then coalesce(fecha_inicio, fecha) else fecha_inicio end,
      acondicionamientos = coalesce(p_puestas, acondicionamientos),
      moes = coalesce(p_moes, moes),
      cerrado_por = case when p_resultado = 'finalizado' then uid else cerrado_por end,
      cerrado_en = case when p_resultado = 'finalizado' then now() else cerrado_en end
    where id = p_id;
  else
    update public.turnos set
      tiempos = nuevos,
      estado = case when p_resultado = 'finalizado' then 'realizado' else estado end,
      resolucion = left(coalesce(nullif(trim(p_resolucion), ''), nullif(trim(p_nota), ''), resolucion), 2000),
      cerrado_por = case when p_resultado = 'finalizado' then uid else cerrado_por end,
      cerrado_en = case when p_resultado = 'finalizado' then now() else cerrado_en end
    where id = p_id;
    -- un relevamiento hecho queda como relevado, con lo que anotó
    if tipo_turno = 'relevamiento' and p_resultado = 'finalizado' then
      update public.relevamientos set
        estado = case when estado = 'pendiente' then 'relevado' else estado end,
        notas = concat_ws(E'\n', nullif(notas, ''), trim(p_resolucion))
      where turno_id = tid;
    end if;
  end if;
  if p_lat is not null then
    insert into public.posiciones_equipo (cuenta_id, usuario_id, lat, lng) values (dueno, uid, p_lat, p_lng)
    on conflict (cuenta_id, usuario_id) do update set lat = excluded.lat, lng = excluded.lng, actualizado_en = now();
  end if;
  return json_build_object('ok', true);
end $$;

-- Ubicación mientras trabaja (la manda la app de Producción si la persona lo permite)
create or replace function public.reportar_posicion(p_cuenta uuid, p_lat double precision, p_lng double precision, p_precision int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_cuenta = auth.uid() then return; end if;
  if not public.puede(p_cuenta, array['tickets_trabajar']) then
    raise exception 'No tenés permiso para trabajar en tickets de esta empresa';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then raise exception 'Ubicación no válida'; end if;
  insert into public.posiciones_equipo (cuenta_id, usuario_id, lat, lng, precision_m)
  values (p_cuenta, auth.uid(), p_lat, p_lng, p_precision)
  on conflict (cuenta_id, usuario_id) do update
    set lat = excluded.lat, lng = excluded.lng, precision_m = excluded.precision_m, actualizado_en = now();
end $$;

-- Dejar de compartir: borra la última posición
create or replace function public.dejar_de_compartir(p_cuenta uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.posiciones_equipo where cuenta_id = p_cuenta and usuario_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 5. Seguridad
-- ---------------------------------------------------------------------
alter table public.posiciones_equipo enable row level security;
drop policy if exists posiciones_leer on public.posiciones_equipo;
create policy posiciones_leer on public.posiciones_equipo for select
  using (usuario_id = (select auth.uid())
         or cuenta_id in (select public.cuentas_con(array['tickets_asignar', 'agenda']))
         or cuenta_id = (select auth.uid()));
revoke all on public.posiciones_equipo from anon;
grant select on public.posiciones_equipo to authenticated;
grant all on public.posiciones_equipo to service_role;

revoke execute on function public.validar_asignado()                 from public, anon;
revoke execute on function public.proteger_trabajo_campo()           from public, anon;
revoke execute on function public.al_salir_del_equipo()              from public, anon;
revoke execute on function public.equipo_asignable(uuid)             from public, anon;
revoke execute on function public.mis_trabajos(uuid, date, date)     from public, anon;
revoke execute on function public.tiempos_abierto(jsonb)             from public, anon;
revoke execute on function public.cerrar_sesiones(jsonb)             from public, anon;
revoke execute on function public.iniciar_trabajo(text, uuid, double precision, double precision) from public, anon;
revoke execute on function public.terminar_trabajo(text, uuid, text, text, numeric, numeric, text, double precision, double precision, date) from public, anon;
revoke execute on function public.reportar_posicion(uuid, double precision, double precision, int) from public, anon;
revoke execute on function public.dejar_de_compartir(uuid)           from public, anon;

grant execute on function public.validar_asignado()                  to authenticated, service_role;
grant execute on function public.proteger_trabajo_campo()            to authenticated, service_role;
grant execute on function public.al_salir_del_equipo()               to authenticated, service_role;
grant execute on function public.equipo_asignable(uuid)              to authenticated, service_role;
grant execute on function public.mis_trabajos(uuid, date, date)      to authenticated, service_role;
grant execute on function public.tiempos_abierto(jsonb)              to authenticated, service_role;
grant execute on function public.cerrar_sesiones(jsonb)              to authenticated, service_role;
grant execute on function public.iniciar_trabajo(text, uuid, double precision, double precision) to authenticated, service_role;
grant execute on function public.terminar_trabajo(text, uuid, text, text, numeric, numeric, text, double precision, double precision, date) to authenticated, service_role;
grant execute on function public.reportar_posicion(uuid, double precision, double precision, int) to authenticated, service_role;
grant execute on function public.dejar_de_compartir(uuid)            to authenticated, service_role;

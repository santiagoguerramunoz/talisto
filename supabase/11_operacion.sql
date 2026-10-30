-- =====================================================================
--  TaListo!  ·  OPERACIÓN DE CAMPO
--  · Cierre del trabajo: Finalizar (terminado o cancelado con el detalle),
--    Suspender (vuelve a coordinación sin asignar, para reagendar o pasarlo
--    a otra persona) y Multi día (sigue el día y la hora que se elige).
--    Igual para tickets B2B y trabajos de particulares (B2C).
--  · Avisos: a quien le asignan un trabajo (con la dirección), a
--    coordinación cuando alguien termina, suspende o queda libre, y por
--    los movimientos de stock y las cotizaciones. Quedan en la app y, si
--    está activado, llegan como notificación al celular (push).
--  · Cotizaciones pedidas: el operario pide desde el ticket que se coticen
--    materiales o tareas; le llega a quien hace presupuestos.
--  · Remito con numeración propia para entregas y devoluciones de stock.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 10). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.kardex') is null then
    raise exception 'Primero corré 10_stock.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
-- Trabajos de particulares: también se pueden suspender (vuelven a coordinación)
alter table public.turnos drop constraint if exists turnos_estado_check;
alter table public.turnos add constraint turnos_estado_check
  check (estado in ('pendiente', 'confirmado', 'realizado', 'cancelado', 'suspendido'));
alter table public.turnos add column if not exists nota_estado text;           -- motivo de suspensión, detalle de cancelación, avance
alter table public.turnos add column if not exists inicio_original timestamptz; -- multi día: cuándo empezó
-- Ticket B2B: teléfono del cliente final (para avisarle)
alter table public.ordenes add column if not exists telefono_contacto text;

-- ---------------------------------------------------------------------
-- 2. Avisos
-- ---------------------------------------------------------------------
create table if not exists public.notificaciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,     -- quien lo recibe
  cuenta_id   uuid references public.profesionales(id) on delete cascade,         -- empresa (dueña de los datos)
  tipo        text not null check (length(tipo) <= 40),
  titulo      text not null check (length(titulo) <= 160),
  cuerpo      text check (cuerpo is null or length(cuerpo) <= 600),
  url         text check (url is null or (url ~ '^/[A-Za-z0-9/_?=&:.%-]*$' and length(url) <= 300)),
  datos       jsonb not null default '{}'::jsonb,
  creado_por  uuid,
  creado_en   timestamptz not null default now(),
  leida_en    timestamptz,
  push_en     timestamptz
);
create index if not exists notificaciones_usuario_idx on public.notificaciones (usuario_id, creado_en desc);
create index if not exists notificaciones_push_idx on public.notificaciones (creado_por, creado_en) where push_en is null;

-- Celulares y computadoras donde cada uno activó las notificaciones
create or replace function public._endpoint_push_valido(e text)
returns boolean language sql immutable as $$
  select coalesce(e, '') ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
     and length(e) <= 1000;
$$;

create table if not exists public.push_suscripciones (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  endpoint    text not null unique check (public._endpoint_push_valido(endpoint)),
  p256dh      text not null check (length(p256dh) between 40 and 200),
  auth        text not null check (length(auth) between 10 and 100),
  agente      text check (agente is null or length(agente) <= 200),
  creado_en   timestamptz not null default now(),
  usado_en    timestamptz
);
create index if not exists push_suscripciones_usuario_idx on public.push_suscripciones (usuario_id);

-- Quienes tienen alguno de esos permisos en la empresa (más la cuenta principal)
create or replace function public._con_permiso(p_cuenta uuid, p_permisos text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select p_cuenta
  union
  select m.usuario_id
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id and e.dueno_id = p_cuenta
    join public.miembros_roles mr on mr.miembro_id = m.id
    join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado
   where m.estado = 'activo' and r.permisos && p_permisos;
$$;

-- Deja el aviso para cada destinatario (nunca a quien hizo el cambio)
create or replace function public._avisar(p_usuarios uuid[], p_cuenta uuid, p_tipo text, p_titulo text, p_cuerpo text,
                                          p_url text, p_datos jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.notificaciones (usuario_id, cuenta_id, tipo, titulo, cuerpo, url, datos, creado_por)
  select distinct u, p_cuenta, left(p_tipo, 40), left(coalesce(nullif(trim(p_titulo), ''), 'TaListo!'), 160),
         nullif(left(trim(coalesce(p_cuerpo, '')), 600), ''), p_url, coalesce(p_datos, '{}'::jsonb), auth.uid()
    from unnest(p_usuarios) u
   where u is not null and u is distinct from auth.uid() and exists (select 1 from public.perfiles where id = u);
  get diagnostics n = row_count;
  -- los avisos de más de 3 meses se borran solos
  delete from public.notificaciones where usuario_id = any(p_usuarios) and creado_en < now() - interval '90 days';
  return n;
end $$;

-- Mis avisos, sin leer y marcarlos
create or replace function public.mis_avisos(p_limite int default 40, p_antes timestamptz default null)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.creado_en desc), '[]'::json) from (
    select n.id, n.tipo, n.titulo, n.cuerpo, n.url, n.datos, n.creado_en, n.leida_en, n.cuenta_id,
           (select coalesce(nullif(p.nombre_publico, ''), 'TaListo!') from public.profesionales p where p.id = n.cuenta_id) as empresa
      from public.notificaciones n
     where n.usuario_id = auth.uid() and (p_antes is null or n.creado_en < p_antes)
     order by n.creado_en desc
     limit least(greatest(coalesce(p_limite, 40), 1), 100)
  ) x;
$$;

create or replace function public.avisos_sin_leer()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.notificaciones where usuario_id = auth.uid() and leida_en is null;
$$;

create or replace function public.marcar_avisos_leidos(p_ids uuid[] default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.notificaciones set leida_en = now()
   where usuario_id = auth.uid() and leida_en is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Activar / quitar las notificaciones de este dispositivo
create or replace function public.guardar_suscripcion_push(p_endpoint text, p_p256dh text, p_auth text, p_agente text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if not public._endpoint_push_valido(p_endpoint) then raise exception 'Este navegador no es compatible con las notificaciones'; end if;
  delete from public.push_suscripciones where endpoint = p_endpoint;
  insert into public.push_suscripciones (usuario_id, endpoint, p256dh, auth, agente)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_agente, 200));
  -- como mucho 10 dispositivos por persona
  delete from public.push_suscripciones
   where usuario_id = auth.uid()
     and id not in (select id from public.push_suscripciones where usuario_id = auth.uid() order by creado_en desc limit 10);
end $$;

create or replace function public.quitar_suscripcion_push(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_suscripciones where endpoint = p_endpoint;
$$;

-- Para el servidor: los avisos que generó esta persona y todavía no salieron por push,
-- con los dispositivos de cada destinatario. Cada aviso sale una sola vez.
create or replace function public.avisos_para_push()
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  if auth.uid() is null then return '[]'::json; end if;
  with pend as (
    update public.notificaciones n set push_en = now()
     where n.id in (select id from public.notificaciones
                     where creado_por = auth.uid() and push_en is null and creado_en > now() - interval '15 minutes'
                     order by creado_en limit 100)
    returning n.id, n.usuario_id, n.titulo, n.cuerpo, n.url, n.tipo
  )
  select coalesce(json_agg(json_build_object(
           'id', p.id, 'titulo', p.titulo, 'cuerpo', p.cuerpo, 'url', p.url, 'tipo', p.tipo,
           'subs', (select coalesce(json_agg(json_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::json)
                      from public.push_suscripciones s where s.usuario_id = p.usuario_id))), '[]'::json)
    into r
    from pend p;
  return r;
end $$;

-- ---------------------------------------------------------------------
-- 3. Avisos de los trabajos (tickets B2B y trabajos de particulares)
-- ---------------------------------------------------------------------
-- Nombre corto del trabajo para los avisos
create or replace function public._titulo_trabajo(p_tipo text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when p_tipo = 'ticket' then
           (select concat_ws(' · ', c.nombre, case when nullif(o.numero_ticket, '') is not null then 'Tk ' || o.numero_ticket
                                                   when nullif(o.numero_cliente, '') is not null then 'Cliente ' || o.numero_cliente end,
                             nullif(trim(o.cliente_final), ''))
              from public.ordenes o join public.clientes c on c.id = o.empresa_id where o.id = p_id)
         else
           (select concat_ws(' · ', coalesce(nullif(c.nombre, ''), nullif(t.titulo, ''), 'Trabajo'),
                             case when t.tipo = 'relevamiento' then 'relevamiento' end)
              from public.turnos t left join public.clientes c on c.id = t.cliente_id where t.id = p_id)
         end;
$$;

create or replace function public._lugar_trabajo(p_tipo text, p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when p_tipo = 'ticket' then (select o.direccion from public.ordenes o where o.id = p_id)
         else (select coalesce(d.direccion, (select r.direccion from public.relevamientos r where r.turno_id = t.id limit 1))
                 from public.turnos t left join public.direcciones d on d.id = t.direccion_id where t.id = p_id) end;
$$;

-- Asignación, cambio de persona y cambio de horario (lo que hace coordinación)
create or replace function public.avisar_cambios_trabajo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  es_ticket boolean := tg_table_name = 'ordenes';
  tipo text := case when tg_table_name = 'ordenes' then 'ticket' else 'turno' end;
  titulo text; lugar text; cuando text; cambio_horario boolean := false; abierto boolean;
begin
  -- el inicio y el cierre los avisa quien trabaja; los cambios del sistema no se avisan
  if uid is null or coalesce(current_setting('talisto.trabajo_campo', true), '') = 'si' then return new; end if;
  titulo := public._titulo_trabajo(tipo, new.id);
  lugar := public._lugar_trabajo(tipo, new.id);
  if es_ticket then
    cuando := to_char(new.fecha, 'DD/MM') || coalesce(' ' || to_char(new.hora_inicio, 'HH24:MI'), '');
    abierto := new.estado in ('pendiente', 'en_curso', 'multidia');
    if tg_op = 'UPDATE' then
      cambio_horario := new.fecha is distinct from old.fecha or new.hora_inicio is distinct from old.hora_inicio;
    end if;
  else
    cuando := to_char(new.inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI');
    abierto := new.estado in ('pendiente', 'confirmado');
    if tg_op = 'UPDATE' then
      cambio_horario := new.inicio is distinct from old.inicio;
    end if;
  end if;

  if not abierto then return new; end if;

  -- le asignan el trabajo a alguien
  if new.asignado_a is not null and (tg_op = 'INSERT' or new.asignado_a is distinct from old.asignado_a) then
    perform public._avisar(array[new.asignado_a], new.profesional_id, 'trabajo_asignado',
      (case when es_ticket then 'Nuevo ticket: ' else 'Nuevo trabajo: ' end) || coalesce(titulo, ''),
      concat_ws(' · ', cuando, lugar), '/panel?trabajo=' || tipo || ':' || new.id,
      jsonb_build_object('trabajo', tipo, 'id', new.id));
  elsif tg_op = 'UPDATE' and new.asignado_a is not null and cambio_horario then
    perform public._avisar(array[new.asignado_a], new.profesional_id, 'trabajo_horario',
      'Cambió el horario: ' || coalesce(titulo, ''), concat_ws(' · ', 'Ahora: ' || cuando, lugar),
      '/panel?trabajo=' || tipo || ':' || new.id, jsonb_build_object('trabajo', tipo, 'id', new.id));
  end if;

  -- se lo sacaron a quien lo tenía (si sigue en el equipo)
  if tg_op = 'UPDATE' and old.asignado_a is not null and new.asignado_a is distinct from old.asignado_a
     and public._es_del_equipo(new.profesional_id, old.asignado_a) then
    perform public._avisar(array[old.asignado_a], new.profesional_id, 'trabajo_quitado',
      'Ya no tenés: ' || coalesce(titulo, ''), 'Se lo pasaron a otra persona o volvió a coordinación.', '/panel',
      jsonb_build_object('trabajo', tipo, 'id', new.id));
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['ordenes', 'turnos'] loop
    execute format('drop trigger if exists talisto_avisar_cambios on public.%I', t);
    execute format('create trigger talisto_avisar_cambios after insert or update on public.%I '
                   'for each row execute function public.avisar_cambios_trabajo()', t);
  end loop;
end $$;

-- Lo que el operario ve de sus trabajos (con teléfono de contacto y el estado real)
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
        'empresa', e.nombre, 'color', e.color, 'cliente_final', o.cliente_final, 'telefono', o.telefono_contacto,
        'direccion', o.direccion, 'referencia', o.referencia, 'lat', o.lat, 'lng', o.lng,
        'pedido', o.pedido, 'realizado', o.realizado, 'estado', o.estado, 'nota_estado', o.nota_estado,
        'tiempos', o.tiempos, 'acondicionamientos', o.acondicionamientos, 'moes', o.moes, 'orden_ruta', o.orden_ruta,
        'materiales', (select coalesce(jsonb_agg(jsonb_build_object('item', m ->> 'item', 'cantidad', m -> 'cantidad', 'unidad', m ->> 'unidad')), '[]'::jsonb)
                       from jsonb_array_elements(o.materiales) m)
      ) order by o.fecha, o.orden_ruta nulls last, o.hora_inicio nulls last)
      from public.ordenes o
      join public.clientes e on e.id = o.empresa_id
      where o.profesional_id = p_cuenta and o.asignado_a = uid and o.estado not in ('cancelado', 'suspendido')
        and ((o.fecha between p_desde and p_hasta) or (o.estado in ('en_curso', 'multidia') and o.fecha <= p_hasta))
    ), '[]'::json),
    'turnos', coalesce((
      select json_agg(json_build_object(
        'tipo', t.tipo, 'id', t.id, 'titulo', t.titulo, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado,
        'cliente', c.nombre, 'cliente_empresa', coalesce(c.es_empresa, false), 'telefono', c.telefono, 'color', c.color,
        'direccion', coalesce(d.direccion, r.direccion), 'referencia', coalesce(d.referencia, r.referencia),
        'lat', coalesce(d.lat, r.lat), 'lng', case when d.lat is not null then d.lng else r.lng end,
        'notas', t.notas, 'resolucion', t.resolucion, 'nota_estado', t.nota_estado, 'inicio_original', t.inicio_original,
        'tiempos', t.tiempos, 'orden_ruta', t.orden_ruta, 'pedido', r.pedido, 'relevamiento_id', r.id
      ) order by t.inicio, t.orden_ruta nulls last)
      from public.turnos t
      left join public.clientes c on c.id = t.cliente_id
      left join public.direcciones d on d.id = t.direccion_id
      left join lateral (select r.id, r.pedido, r.direccion, r.referencia, r.lat, r.lng from public.relevamientos r
                         where r.turno_id = t.id limit 1) r on true
      where t.profesional_id = p_cuenta and t.asignado_a = uid and t.estado not in ('cancelado', 'suspendido')
        and t.inicio >= v_ini and t.inicio < v_fin
    ), '[]'::json)
  );
end $$;

-- Cierre del trabajo por quien lo hace:
--   'finalizado' (con lo que se hizo) · 'cancelado' (no se pudo: con el detalle)
--   'suspendido' (vuelve a coordinación sin asignar) · 'multidia' (sigue el día p_fecha, a la hora p_hora)
drop function if exists public.terminar_trabajo(text, uuid, text, text, numeric, numeric, text, double precision, double precision, date);
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
  coordinan uuid[];
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
  if p_resultado = 'multidia' then
    if p_fecha is null or p_fecha <= hoy or p_fecha > hoy + 365 then raise exception 'Elegí un día a partir de mañana'; end if;
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
      fecha = case when p_resultado = 'multidia' then p_fecha else fecha end,
      hora_inicio = case when p_resultado = 'multidia' then p_hora else hora_inicio end,
      hora_fin = case when p_resultado = 'multidia' then (case when p_hora is not null and p_minutos is not null
                                                                    and extract(epoch from p_hora) / 60 + p_minutos < 24 * 60
                                                              then p_hora + make_interval(mins => p_minutos) end)
                      else hora_fin end,
      fecha_inicio = case when p_resultado = 'multidia' then coalesce(fecha_inicio, fecha) else fecha_inicio end,
      acondicionamientos = case when p_resultado = 'finalizado' then coalesce(p_puestas, acondicionamientos) else acondicionamientos end,
      moes = case when p_resultado = 'finalizado' then coalesce(p_moes, moes) else moes end,
      asignado_a = case when p_resultado = 'suspendido' then null else asignado_a end,
      orden_ruta = case when p_resultado in ('suspendido', 'multidia') then null else orden_ruta end,
      cerrado_por = case when p_resultado in ('finalizado', 'cancelado') then uid else cerrado_por end,
      cerrado_en = case when p_resultado in ('finalizado', 'cancelado') then now() else cerrado_en end
    where id = p_id;
  else
    begin
      nuevo_ini := case when p_resultado = 'multidia' then (p_fecha + p_hora) at time zone 'America/Montevideo' end;
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
        else quien || ' sigue ' || titulo || ' el ' || to_char(p_fecha, 'DD/MM') || coalesce(' ' || to_char(p_hora, 'HH24:MI'), '') end,
      case when p_resultado = 'finalizado' then nullif(trim(coalesce(p_resolucion, '')), '') else nullif(trim(coalesce(p_nota, p_resolucion, '')), '') end,
      destino, jsonb_build_object('trabajo', p_tipo, 'id', p_id));
    -- ¿le queda algo para hoy?
    select count(*) into quedan from (
      select 1 from public.ordenes o
       where o.profesional_id = dueno and o.asignado_a = uid and o.estado in ('pendiente', 'en_curso', 'multidia') and o.fecha <= hoy
      union all
      select 1 from public.turnos t
       where t.profesional_id = dueno and t.asignado_a = uid and t.estado in ('pendiente', 'confirmado')
         and (t.inicio at time zone 'America/Montevideo')::date = hoy and t.cerrado_en is null
         and not (t.id = p_id and p_tipo = 'turno')
    ) x;
    if quedan = 0 then
      perform public._avisar(coordinan, dueno, 'operario_libre', quien || ' quedó libre',
        'Terminó lo que tenía para hoy: le podés asignar otro trabajo.', destino, jsonb_build_object('usuario', uid));
    end if;
  end if;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. Cotizaciones que pide el operario desde el ticket
--    items: [{ tipo: 'material' | 'tarea', descripcion, cantidad, unidad }]
-- ---------------------------------------------------------------------
create table if not exists public.cotizaciones_pedidas (
  id                 uuid primary key default gen_random_uuid(),
  profesional_id     uuid not null references public.profesionales(id) on delete cascade,
  numero             int not null,
  orden_id           uuid references public.ordenes(id) on delete set null,
  turno_id           uuid references public.turnos(id) on delete set null,
  cliente_id         uuid references public.clientes(id) on delete set null,
  titulo             text,
  direccion          text,
  items              jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 100),
  nota               text check (nota is null or length(nota) <= 1000),
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'presupuestada', 'descartada')),
  presupuesto_id     uuid references public.presupuestos(id) on delete set null,
  respuesta          text check (respuesta is null or length(respuesta) <= 500),
  creado_por         uuid default auth.uid(),
  creado_por_nombre  text,
  creado_en          timestamptz not null default now(),
  resuelto_por       uuid,
  resuelto_en        timestamptz,
  unique (profesional_id, numero)
);
create index if not exists cotizaciones_pedidas_cuenta_idx on public.cotizaciones_pedidas (profesional_id, estado, creado_en desc);

create or replace function public.pedir_cotizacion(p_cuenta uuid, p_tipo text, p_trabajo uuid, p_items jsonb, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); asig uuid; cli uuid; it jsonb; limpios jsonb := '[]'::jsonb; cant numeric; num int; nuevo uuid;
  titulo text; quien text; destinatarios uuid[];
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_tipo = 'ticket' then
    select o.asignado_a, o.empresa_id into asig, cli from public.ordenes o where o.id = p_trabajo and o.profesional_id = p_cuenta;
    if not found then raise exception 'Ese ticket no es de esta cuenta'; end if;
  elsif p_tipo = 'turno' then
    select t.asignado_a, t.cliente_id into asig, cli from public.turnos t where t.id = p_trabajo and t.profesional_id = p_cuenta;
    if not found then raise exception 'Ese trabajo no es de esta cuenta'; end if;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if not (asig = uid and public._es_del_equipo(p_cuenta, uid))
     and not public.puede(p_cuenta, array['tickets_asignar', 'agenda', 'presupuestos']) then
    raise exception 'Ese trabajo no está asignado a vos';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material o una tarea';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'Demasiados renglones'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(it ->> 'tipo', '') not in ('material', 'tarea') then raise exception 'Renglón no válido'; end if;
    if length(trim(coalesce(it ->> 'descripcion', ''))) = 0 then raise exception 'Cada renglón lleva qué es'; end if;
    cant := coalesce(public.numero_o_null(it ->> 'cantidad'), 1);
    if cant <= 0 or cant > 1000000 then raise exception 'Revisá la cantidad de %', it ->> 'descripcion'; end if;
    limpios := limpios || jsonb_build_array(jsonb_build_object(
      'tipo', it ->> 'tipo', 'descripcion', left(trim(it ->> 'descripcion'), 200), 'cantidad', cant,
      'unidad', left(coalesce(nullif(trim(it ->> 'unidad'), ''), case when it ->> 'tipo' = 'tarea' then 'tarea' else 'u' end), 12)));
  end loop;
  perform pg_advisory_xact_lock(hashtext('cotizacion' || p_cuenta::text));
  select coalesce(max(numero), 0) + 1 into num from public.cotizaciones_pedidas where profesional_id = p_cuenta;
  titulo := public._titulo_trabajo(p_tipo, p_trabajo);
  quien := public._nombre_de(uid);
  insert into public.cotizaciones_pedidas (profesional_id, numero, orden_id, turno_id, cliente_id, titulo, direccion, items, nota,
                                           creado_por, creado_por_nombre)
  values (p_cuenta, num, case when p_tipo = 'ticket' then p_trabajo end, case when p_tipo = 'turno' then p_trabajo end, cli,
          titulo, public._lugar_trabajo(p_tipo, p_trabajo), limpios, nullif(left(trim(coalesce(p_nota, '')), 1000), ''), uid, quien)
  returning id into nuevo;
  select array_agg(x) into destinatarios from public._con_permiso(p_cuenta, array['presupuestos']) x;
  perform public._avisar(destinatarios, p_cuenta, 'cotizacion_pedida',
    coalesce(quien, 'El equipo') || ' pide cotizar: ' || coalesce(titulo, 'un trabajo'),
    (select string_agg(x ->> 'descripcion', ' · ') from jsonb_array_elements(limpios) x),
    '/panel/finanzas/presupuestos?pedidas=1', jsonb_build_object('cotizacion', nuevo));
  return json_build_object('id', nuevo, 'numero', num);
end $$;

-- Quien hace presupuestos la marca como presupuestada (con el presupuesto) o descartada
create or replace function public.resolver_cotizacion(p_id uuid, p_estado text, p_presupuesto uuid default null, p_respuesta text default null)
returns void language plpgsql security definer set search_path = public as $$
declare c public.cotizaciones_pedidas;
begin
  select * into c from public.cotizaciones_pedidas where id = p_id for update;
  if not found or not public.puede(c.profesional_id, array['presupuestos']) then raise exception 'No podés resolver esta cotización'; end if;
  if p_estado not in ('presupuestada', 'descartada', 'pendiente') then raise exception 'Estado no válido'; end if;
  if p_presupuesto is not null and not exists (select 1 from public.presupuestos where id = p_presupuesto and profesional_id = c.profesional_id) then
    raise exception 'Ese presupuesto no es de esta cuenta';
  end if;
  update public.cotizaciones_pedidas set estado = p_estado, presupuesto_id = coalesce(p_presupuesto, presupuesto_id),
         respuesta = nullif(left(trim(coalesce(p_respuesta, '')), 500), ''),
         resuelto_por = case when p_estado = 'pendiente' then null else auth.uid() end,
         resuelto_en = case when p_estado = 'pendiente' then null else now() end
   where id = p_id;
  if p_estado <> 'pendiente' and c.creado_por is not null then
    perform public._avisar(array[c.creado_por], c.profesional_id, 'cotizacion_' || p_estado,
      case when p_estado = 'presupuestada' then 'Ya se presupuestó: ' else 'No se va a cotizar: ' end || coalesce(c.titulo, 'tu pedido'),
      nullif(trim(coalesce(p_respuesta, '')), ''), '/panel', jsonb_build_object('cotizacion', c.id));
  end if;
end $$;

alter table public.cotizaciones_pedidas enable row level security;
drop policy if exists cotizaciones_leer on public.cotizaciones_pedidas;
create policy cotizaciones_leer on public.cotizaciones_pedidas for select
  using (profesional_id = (select auth.uid()) or creado_por = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['presupuestos', 'importes'])));

-- ---------------------------------------------------------------------
-- 5. Avisos del stock: entregas y devoluciones para confirmar, y su respuesta
-- ---------------------------------------------------------------------
create or replace function public.avisar_stock()
returns trigger language plpgsql security definer set search_path = public as $$
declare d public.ubicaciones_stock; o public.ubicaciones_stock; para uuid[]; resumen text;
begin
  -- se avisa cuando el comprobante queda sellado (ya tiene sus renglones) y cuando se responde
  if not ((old.huella is null and new.huella is not null and new.estado = 'pendiente')
          or (old.estado = 'pendiente' and new.estado <> 'pendiente')) then
    return new;
  end if;
  select * into d from public.ubicaciones_stock where id = new.destino_id;
  select * into o from public.ubicaciones_stock where id = new.origen_id;
  select string_agg(m.nombre, ', ' order by i.n) into resumen
    from public.movimientos_stock_items i join public.materiales m on m.id = i.material_id where i.movimiento_id = new.id;
  if new.estado = 'pendiente' then
    -- algo para confirmar
    if d.tipo = 'operario' then
      para := array[d.usuario_id];
    else
      select array_agg(x) into para from public._con_permiso(new.profesional_id, array['stock']) x;
    end if;
    perform public._avisar(para, new.profesional_id, 'stock_por_confirmar',
      'Materiales para confirmar: ' || coalesce(o.nombre, '') || ' → ' || coalesce(d.nombre, ''),
      left(resumen, 300), case when d.tipo = 'operario' then '/panel/mi-stock' else '/panel/finanzas/stock' end,
      jsonb_build_object('movimiento', new.id));
  else
    -- respuesta a quien lo mandó
    perform public._avisar(array[new.creado_por, o.usuario_id], new.profesional_id, 'stock_' || new.estado,
      case new.estado when 'hecho' then coalesce(new.respondido_por_nombre, d.nombre) || ' confirmó lo que le mandaste'
                      when 'rechazado' then coalesce(new.respondido_por_nombre, d.nombre) || ' rechazó lo que le mandaste'
                      else 'Se canceló un envío de materiales' end,
      coalesce(new.respuesta, left(resumen, 300)),
      case when o.tipo = 'operario' then '/panel/mi-stock' else '/panel/finanzas/stock' end,
      jsonb_build_object('movimiento', new.id));
  end if;
  return new;
end $$;
drop trigger if exists talisto_avisar_stock on public.movimientos_stock;
create trigger talisto_avisar_stock after update of estado, huella on public.movimientos_stock
  for each row execute function public.avisar_stock();

-- ---------------------------------------------------------------------
-- 6. Remitos: número propio y datos del negocio para los documentos
-- ---------------------------------------------------------------------
create or replace function public._mov_json(p_id uuid, p_costos boolean default false)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', m.id, 'numero', m.numero, 'tipo', m.tipo, 'estado', m.estado, 'creado_en', m.creado_en,
    'origen_id', m.origen_id, 'origen', o.nombre, 'origen_tipo', o.tipo, 'origen_usuario', o.usuario_id,
    'destino_id', m.destino_id, 'destino', d.nombre, 'destino_tipo', d.tipo, 'destino_usuario', d.usuario_id,
    'proveedor_id', m.proveedor_id, 'proveedor', m.proveedor_nombre, 'orden_compra_id', m.orden_compra_id,
    'orden_numero', (select oc.numero from public.ordenes_compra oc where oc.id = m.orden_compra_id),
    'motivo', m.motivo, 'referencia', m.referencia, 'nota', m.nota,
    'creado_por', m.creado_por, 'por', m.creado_por_nombre,
    'respondido_por', m.respondido_por_nombre, 'respondido_en', m.respondido_en, 'respuesta', m.respuesta,
    'anula_a', m.anula_a, 'anula_numero', (select a.numero from public.movimientos_stock a where a.id = m.anula_a),
    'anulado_por', m.anulado_por, 'anulado_numero', (select a.numero from public.movimientos_stock a where a.id = m.anulado_por),
    'huella', m.huella,
    -- remito: numeración propia (sin huecos) de entregas, materiales a trabajos y devoluciones
    'remito', case when m.tipo in ('transferencia', 'a_trabajo', 'devolucion', 'devolucion_proveedor') then
                (select count(*) from public.movimientos_stock x where x.profesional_id = m.profesional_id
                    and x.tipo in ('transferencia', 'a_trabajo', 'devolucion', 'devolucion_proveedor') and x.numero <= m.numero) end,
    'items', (select coalesce(json_agg(json_build_object(
                 'n', i.n, 'material_id', i.material_id, 'nombre', mt.nombre, 'codigo', mt.codigo, 'marca', mt.marca,
                 'unidad', mt.unidad, 'decimales', mt.decimales, 'presentaciones', mt.presentaciones,
                 'cantidad', i.cantidad, 'presentacion', i.presentacion, 'factor', i.factor,
                 'cantidad_presentacion', i.cantidad_presentacion, 'recibido', i.recibido, 'anterior', i.anterior,
                 'costo', case when p_costos then (select c.costo from public.materiales_costos c where c.material_id = i.material_id) end
               ) order by i.n), '[]'::json)
              from public.movimientos_stock_items i join public.materiales mt on mt.id = i.material_id
              where i.movimiento_id = m.id)
  )
  from public.movimientos_stock m
  left join public.ubicaciones_stock o on o.id = m.origen_id
  left join public.ubicaciones_stock d on d.id = m.destino_id
  where m.id = p_id;
$$;

-- Datos del negocio que van en remitos y documentos (para todo el equipo)
create or replace function public.negocio_para_documentos(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not (p_cuenta = auth.uid() or public._es_del_equipo(p_cuenta, auth.uid()) or public.es_admin()) then
    raise exception 'No tenés acceso a los datos de este negocio';
  end if;
  return (select json_build_object('nombre', p.nombre_publico, 'razon_social', a.razon_social, 'rut', a.rut,
                                   'telefono', coalesce(a.telefono, p.whatsapp), 'email', a.email, 'direccion', a.direccion,
                                   'logo_url', a.logo_url)
            from public.profesionales p left join public.ajustes a on a.profesional_id = p.id where p.id = p_cuenta);
end $$;

-- ---------------------------------------------------------------------
-- 7. Seguridad
-- ---------------------------------------------------------------------
alter table public.notificaciones enable row level security;
drop policy if exists notificaciones_mias on public.notificaciones;
create policy notificaciones_mias on public.notificaciones for select using (usuario_id = (select auth.uid()));

alter table public.push_suscripciones enable row level security;
drop policy if exists push_mias on public.push_suscripciones;
create policy push_mias on public.push_suscripciones for select using (usuario_id = (select auth.uid()));
drop policy if exists push_borrar_mias on public.push_suscripciones;
create policy push_borrar_mias on public.push_suscripciones for delete using (usuario_id = (select auth.uid()));

revoke all on public.notificaciones, public.push_suscripciones, public.cotizaciones_pedidas from anon, authenticated;
grant select on public.notificaciones, public.cotizaciones_pedidas to authenticated;
grant select, delete on public.push_suscripciones to authenticated;
grant all on public.notificaciones, public.push_suscripciones, public.cotizaciones_pedidas to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.mis_avisos(int, timestamptz)', 'public.avisos_sin_leer()', 'public.marcar_avisos_leidos(uuid[])',
    'public.guardar_suscripcion_push(text, text, text, text)', 'public.quitar_suscripcion_push(text)', 'public.avisos_para_push()',
    'public.mis_trabajos(uuid, date, date)',
    'public.terminar_trabajo(text, uuid, text, text, numeric, numeric, text, double precision, double precision, date, time, int)',
    'public.pedir_cotizacion(uuid, text, uuid, jsonb, text)', 'public.resolver_cotizacion(uuid, text, uuid, text)',
    'public.negocio_para_documentos(uuid)', 'public._endpoint_push_valido(text)',
    'public.avisar_cambios_trabajo()', 'public.avisar_stock()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._con_permiso(uuid, text[])', 'public._avisar(uuid[], uuid, text, text, text, text, jsonb)',
    'public._titulo_trabajo(text, uuid)', 'public._lugar_trabajo(text, uuid)', 'public._mov_json(uuid, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

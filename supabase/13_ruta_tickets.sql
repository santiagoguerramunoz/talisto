-- =====================================================================
--  TaListo!  ·  RUTA DE LOS TICKETS: DE LA VENTA AL COBRO
--  · Tickets numerados (Nº de ticket) para los trabajos de la agenda,
--    enlazados al presupuesto (Nº de presupuesto). También sin presupuesto
--    (mantenimiento programado). "Generar ticket" desde el presupuesto
--    aceptado: agendado con operario, o "Por agendar" para coordinación.
--  · El relevamiento y el presupuesto dicen si el trabajo lleva materiales.
--    Si lleva, sale un pedido de materiales que tiene que aprobar Stock;
--    al aprobar, Stock los entrega con remito.
--  · Bitácora: cada paso (presupuesto, ticket, materiales, stock, cobro y
--    comisión) queda registrado con quién y cuándo. La ve la cuenta
--    principal y quien tenga el permiso Seguimiento (Gerencia general),
--    que también puede corregir (reabrir o cancelar un ticket, etc.).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 12). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.comisiones') is null then
    raise exception 'Primero corré 12_monedas_comisiones.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Permiso nuevo: Seguimiento (lo tiene Gerencia general)
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo','compras','stock','comisiones','seguimiento']::text[];
$$;

update public.roles_empresa set permisos = array_append(permisos, 'seguimiento')
 where nombre = 'Gerencia general' and not ('seguimiento' = any(permisos));

create or replace function public.crear_mi_empresa(p_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); eid uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if public.plan_de(uid) <> 'business' then
    raise exception using errcode = 'TL001', message = 'La empresa con equipo es parte del plan Business.',
      hint = 'Pasate a Business desde Perfil > Mi plan.';
  end if;
  if not exists (select 1 from public.profesionales where id = uid) then
    raise exception 'Primero completá tu perfil profesional';
  end if;
  insert into public.empresas (dueno_id, nombre) values (uid, trim(p_nombre))
  on conflict (dueno_id) do update set nombre = excluded.nombre
  returning id into eid;
  if not exists (select 1 from public.roles_empresa where empresa_id = eid) then
    insert into public.roles_empresa (empresa_id, nombre, permisos, orden) values
      (eid, 'Gerencia general', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock','equipo','comisiones','seguimiento'], 0),
      (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock'], 1),
      (eid, 'Producción',     array['tickets_trabajar'], 2),
      (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 3);
  end if;
  return eid;
end $$;

-- ¿Ve la ruta completa y puede corregir? (cuenta principal o permiso Seguimiento)
create or replace function public.ve_seguimiento(p_cuenta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (p_cuenta = auth.uid() or p_cuenta in (select public.cuentas_con(array['seguimiento'])));
$$;

-- ---------------------------------------------------------------------
-- 2. Tickets numerados y con o sin materiales
-- ---------------------------------------------------------------------
alter table public.turnos drop constraint if exists turnos_estado_check;
alter table public.turnos add constraint turnos_estado_check
  check (estado in ('pendiente', 'confirmado', 'realizado', 'cancelado', 'suspendido', 'por_agendar'));
alter table public.turnos add column if not exists numero int;
alter table public.turnos add column if not exists presupuesto_id uuid references public.presupuestos(id) on delete set null;
alter table public.turnos add column if not exists con_materiales boolean not null default false;
alter table public.turnos add column if not exists materiales jsonb not null default '[]'::jsonb;
alter table public.turnos drop constraint if exists turnos_materiales_check;
alter table public.turnos add constraint turnos_materiales_check check (jsonb_typeof(materiales) = 'array' and jsonb_array_length(materiales) <= 200);
create index if not exists turnos_presupuesto_idx on public.turnos (presupuesto_id) where presupuesto_id is not null;

-- numera los que ya había (una sola vez) y deja el índice único
update public.turnos t set numero = x.n
  from (select id, row_number() over (partition by profesional_id order by creado_en, id) as n from public.turnos) x
 where t.id = x.id and t.numero is null
   and not exists (select 1 from public.turnos y where y.profesional_id = t.profesional_id and y.numero is not null);
create unique index if not exists turnos_numero_uk on public.turnos (profesional_id, numero) where numero is not null;

create or replace function public.numerar_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.numero is null then
    perform pg_advisory_xact_lock(hashtext('ticket' || new.profesional_id::text));
    select coalesce(max(numero), 0) + 1 into new.numero from public.turnos where profesional_id = new.profesional_id;
  end if;
  return new;
end $$;
drop trigger if exists talisto_numerar_ticket on public.turnos;
create trigger talisto_numerar_ticket before insert on public.turnos
  for each row execute function public.numerar_ticket();

alter table public.presupuestos add column if not exists con_materiales boolean not null default true;
alter table public.relevamientos add column if not exists con_materiales boolean not null default true;

-- ---------------------------------------------------------------------
-- 3. Pedidos de materiales (los aprueba Stock)
--    items: [{ descripcion, cantidad, unidad, material_id?, producto_id? }]
-- ---------------------------------------------------------------------
create table if not exists public.pedidos_materiales (
  id                   uuid primary key default gen_random_uuid(),
  profesional_id       uuid not null references public.profesionales(id) on delete cascade,
  numero               int not null,
  turno_id             uuid references public.turnos(id) on delete set null,
  orden_id             uuid references public.ordenes(id) on delete set null,
  presupuesto_id       uuid references public.presupuestos(id) on delete set null,
  items                jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 200),
  estado               text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'cancelado')),
  nota                 text check (nota is null or length(nota) <= 500),
  respuesta            text check (respuesta is null or length(respuesta) <= 500),
  movimiento_id        uuid references public.movimientos_stock(id) on delete set null,
  creado_por           uuid default auth.uid(),
  creado_por_nombre    text,
  creado_en            timestamptz not null default now(),
  resuelto_por         uuid,
  resuelto_por_nombre  text,
  resuelto_en          timestamptz,
  unique (profesional_id, numero)
);
create index if not exists pedidos_materiales_cuenta_idx on public.pedidos_materiales (profesional_id, estado, creado_en desc);
create index if not exists pedidos_materiales_turno_idx on public.pedidos_materiales (turno_id);
create index if not exists pedidos_materiales_orden_idx on public.pedidos_materiales (orden_id);

-- ---------------------------------------------------------------------
-- 4. Bitácora: todo lo que pasa en la ruta, con quién y cuándo
-- ---------------------------------------------------------------------
create table if not exists public.bitacora (
  id              bigserial primary key,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  tipo            text not null check (tipo in ('presupuesto', 'ticket', 'materiales', 'stock', 'comision')),
  presupuesto_id  uuid,
  turno_id        uuid,
  orden_id        uuid,
  pedido_id       uuid,
  movimiento_id   uuid,
  accion          text not null check (length(accion) <= 200),
  detalle         text check (detalle is null or length(detalle) <= 1000),
  usuario_id      uuid,
  usuario_nombre  text,
  creado_en       timestamptz not null default now()
);
create index if not exists bitacora_cuenta_idx on public.bitacora (profesional_id, creado_en desc);
create index if not exists bitacora_presupuesto_idx on public.bitacora (presupuesto_id) where presupuesto_id is not null;
create index if not exists bitacora_turno_idx on public.bitacora (turno_id) where turno_id is not null;
create index if not exists bitacora_orden_idx on public.bitacora (orden_id) where orden_id is not null;

create or replace function public._registrar(p_cuenta uuid, p_tipo text, p_accion text, p_detalle text,
                                             p_presupuesto uuid default null, p_turno uuid default null, p_orden uuid default null,
                                             p_pedido uuid default null, p_movimiento uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); corr text := nullif(current_setting('talisto.correccion', true), '');
begin
  if p_cuenta is null or public._cuenta_borrandose(p_cuenta) then return; end if;
  insert into public.bitacora (profesional_id, tipo, presupuesto_id, turno_id, orden_id, pedido_id, movimiento_id,
                               accion, detalle, usuario_id, usuario_nombre)
  values (p_cuenta, p_tipo, p_presupuesto, p_turno, p_orden, p_pedido, p_movimiento,
          left(p_accion || case when corr is not null then ' (corrección)' else '' end, 200),
          left(nullif(concat_ws(' · ', nullif(trim(coalesce(p_detalle, '')), ''), case when corr is not null then 'Motivo: ' || corr end), ''), 1000),
          uid, case when uid is null then 'Sistema' else public._nombre_de(uid) end);
end $$;

create or replace function public._fecha_uy(t timestamptz)
returns text language sql immutable set search_path = public as $$
  select to_char(t at time zone 'America/Montevideo', 'DD/MM HH24:MI');
$$;

-- Presupuestos
create or replace function public.bitacora_presupuesto()
returns trigger language plpgsql security definer set search_path = public as $$
declare n text; estados constant jsonb := '{"borrador":"Borrador","enviado":"Enviado","aceptado":"Aceptado","rechazado":"Rechazado"}';
        total_txt text;
begin
  if tg_op = 'DELETE' then
    perform public._registrar(old.profesional_id, 'presupuesto', 'Presupuesto Nº ' || lpad(old.numero::text, 4, '0') || ' eliminado',
      old.cliente_nombre, old.id);
    return old;
  end if;
  n := 'Presupuesto Nº ' || lpad(new.numero::text, 4, '0');
  total_txt := concat_ws(' + ', case when coalesce(new.total_usd, 0) > 0 then 'US$ ' || to_char(new.total_usd, 'FM999G999G990D00') end,
                                case when coalesce(new.total_uyu, new.total, 0) > 0 or coalesce(new.total_usd, 0) = 0 then '$ ' || to_char(coalesce(nullif(new.total_uyu, 0), new.total), 'FM999G999G990D00') end);
  if tg_op = 'INSERT' then
    perform public._registrar(new.profesional_id, 'presupuesto', n || ' creado', concat_ws(' · ', new.cliente_nombre, new.titulo), new.id);
    return new;
  end if;
  if new.estado is distinct from old.estado then
    perform public._registrar(new.profesional_id, 'presupuesto', n || ': ' || coalesce(estados ->> new.estado, new.estado),
      case when new.estado = 'aceptado' then 'Total ' || total_txt end, new.id);
  elsif new.estado = 'aceptado' and (new.total is distinct from old.total or new.total_usd is distinct from old.total_usd) then
    perform public._registrar(new.profesional_id, 'presupuesto', n || ': se cambiaron los importes ya aceptado',
      'Antes $ ' || to_char(old.total, 'FM999G999G990D00') || ' (equivalente) · ahora ' || total_txt, new.id);
  end if;
  if new.cobrado_en is distinct from old.cobrado_en then
    perform public._registrar(new.profesional_id, 'presupuesto',
      case when new.cobrado_en is null then n || ': se desmarcó el cobro' else n || ': cobrado el ' || to_char(new.cobrado_en, 'DD/MM/YYYY') end,
      case when new.cobrado_en is not null then total_txt end, new.id);
  end if;
  if new.vendedor_id is distinct from old.vendedor_id and old.vendedor_id is not null then
    perform public._registrar(new.profesional_id, 'presupuesto', n || ': cambió el vendedor',
      coalesce(public._nombre_de(old.vendedor_id), '—') || ' → ' || coalesce(public._nombre_de(new.vendedor_id), '—'), new.id);
  end if;
  if new.con_materiales is distinct from old.con_materiales then
    perform public._registrar(new.profesional_id, 'presupuesto', n || case when new.con_materiales then ': lleva materiales' else ': sin materiales' end, null, new.id);
  end if;
  return new;
end $$;
drop trigger if exists talisto_bitacora_presupuesto on public.presupuestos;
create trigger talisto_bitacora_presupuesto after insert or update or delete on public.presupuestos
  for each row execute function public.bitacora_presupuesto();

-- Tickets (trabajos de la agenda y tickets B2B)
create or replace function public.bitacora_ticket()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  es_orden boolean := tg_table_name = 'ordenes';
  r record; o record; j jsonb; n text; cuenta uuid; tid uuid; oid uuid; pid uuid;
  abierta_antes boolean; abierta_ahora boolean; cuando_antes text; cuando_ahora text; destinatarios uuid[];
  estados constant jsonb := '{"pendiente":"Pendiente","confirmado":"Agendado","realizado":"Terminado","finalizado":"Terminado","cancelado":"Cancelado","suspendido":"Suspendido","multidia":"Sigue otro día","en_curso":"En curso","por_agendar":"Por agendar"}';
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'UPDATE' then o := old; end if;
  j := to_jsonb(r);  -- los campos que solo tiene una de las dos tablas se leen de acá
  cuenta := r.profesional_id;
  if es_orden then
    oid := r.id; pid := null;
    n := 'Ticket B2B' || coalesce(' ' || nullif(r.numero_ticket, ''), '');
    cuando_ahora := to_char(r.fecha, 'DD/MM') || coalesce(' ' || to_char(r.hora_inicio, 'HH24:MI'), '');
    if tg_op = 'UPDATE' then cuando_antes := to_char(o.fecha, 'DD/MM') || coalesce(' ' || to_char(o.hora_inicio, 'HH24:MI'), ''); end if;
  else
    tid := r.id; pid := public.uuid_o_null(j ->> 'presupuesto_id');
    n := 'Ticket Nº ' || lpad(coalesce(j ->> 'numero', '0'), 4, '0');
    cuando_ahora := public._fecha_uy(r.inicio);
    if tg_op = 'UPDATE' then cuando_antes := public._fecha_uy(o.inicio); end if;
  end if;

  if tg_op = 'DELETE' then
    perform public._registrar(cuenta, 'ticket', n || ' eliminado', null, pid, tid, oid);
    return old;
  end if;

  if tg_op = 'INSERT' then
    perform public._registrar(cuenta, 'ticket', n || ' creado',
      concat_ws(' · ',
        case when pid is not null then 'Del presupuesto Nº ' || (select lpad(numero::text, 4, '0') from public.presupuestos where id = pid) end,
        case when not es_orden and r.estado = 'por_agendar' then 'Por agendar' else 'Para el ' || cuando_ahora end,
        case when r.asignado_a is not null then 'Asignado a ' || public._nombre_de(r.asignado_a) end,
        case when (j ->> 'con_materiales') = 'true' then 'Lleva materiales' end),
      pid, tid, oid);
    return new;
  end if;

  -- asignación
  if r.asignado_a is distinct from o.asignado_a then
    perform public._registrar(cuenta, 'ticket',
      case when r.asignado_a is null then n || ': quedó sin asignar' else n || ': asignado a ' || coalesce(public._nombre_de(r.asignado_a), 'alguien') end,
      case when o.asignado_a is not null then 'Antes: ' || coalesce(public._nombre_de(o.asignado_a), '—') end, pid, tid, oid);
  end if;
  -- día y hora
  if cuando_ahora is distinct from cuando_antes and r.estado not in ('cancelado', 'por_agendar') then
    perform public._registrar(cuenta, 'ticket',
      case when not es_orden and o.estado = 'por_agendar' then n || ': agendado para el ' || cuando_ahora else n || ': cambió el día a ' || cuando_ahora end,
      case when not (not es_orden and o.estado = 'por_agendar') then 'Antes: ' || cuando_antes end, pid, tid, oid);
  end if;
  -- inicio del trabajo (se abre un tramo de tiempo)
  abierta_antes := exists (select 1 from jsonb_array_elements(coalesce(o.tiempos, '[]'::jsonb)) s where s ->> 'fin' is null and s ? 'inicio');
  abierta_ahora := exists (select 1 from jsonb_array_elements(coalesce(r.tiempos, '[]'::jsonb)) s where s ->> 'fin' is null and s ? 'inicio');
  if abierta_ahora and not abierta_antes then
    perform public._registrar(cuenta, 'ticket', n || ': iniciado', null, pid, tid, oid);
  end if;
  -- estado
  if r.estado is distinct from o.estado then
    perform public._registrar(cuenta, 'ticket', n || ': ' || coalesce(estados ->> r.estado, r.estado),
      case when r.estado in ('realizado', 'finalizado') then nullif(coalesce(j ->> 'realizado', j ->> 'resolucion', ''), '')
           when r.estado in ('cancelado', 'suspendido', 'multidia') then r.nota_estado end,
      pid, tid, oid);
    -- terminado: a quien cobra le llega que falta cobrar el presupuesto
    if not es_orden and r.estado = 'realizado' and pid is not null
       and exists (select 1 from public.presupuestos p where p.id = pid and p.cobrado_en is null) then
      select array_agg(x) into destinatarios from public._con_permiso(cuenta, array['presupuestos', 'importes']) x;
      perform public._avisar(destinatarios, cuenta, 'falta_cobrar',
        n || ' terminado: falta cobrar el presupuesto Nº ' || (select lpad(numero::text, 4, '0') from public.presupuestos where id = pid),
        nullif(j ->> 'resolucion', ''), '/panel/finanzas/presupuestos/' || pid, jsonb_build_object('presupuesto', pid));
    end if;
  end if;
  return new;
end $$;
drop trigger if exists talisto_bitacora_ticket on public.turnos;
create trigger talisto_bitacora_ticket after insert or update or delete on public.turnos
  for each row execute function public.bitacora_ticket();
drop trigger if exists talisto_bitacora_ticket on public.ordenes;
create trigger talisto_bitacora_ticket after insert or update or delete on public.ordenes
  for each row execute function public.bitacora_ticket();

-- Pedidos de materiales
create or replace function public.bitacora_pedido()
returns trigger language plpgsql security definer set search_path = public as $$
declare n text; mov int;
begin
  if tg_op = 'DELETE' then return old; end if;
  n := 'Pedido de materiales Nº ' || new.numero;
  if tg_op = 'INSERT' then
    perform public._registrar(new.profesional_id, 'materiales', n || ': esperando aprobación de Stock',
      (select string_agg(public.cantidad_texto(coalesce(public.numero_o_null(x ->> 'cantidad'), 1)) || ' ' || coalesce(x ->> 'unidad', 'u') || ' ' || (x ->> 'descripcion'), ' · ')
         from jsonb_array_elements(new.items) x),
      new.presupuesto_id, new.turno_id, new.orden_id, new.id);
  elsif new.estado is distinct from old.estado or new.movimiento_id is distinct from old.movimiento_id then
    select numero into mov from public.movimientos_stock where id = new.movimiento_id;
    perform public._registrar(new.profesional_id, 'materiales',
      n || ': ' || case new.estado when 'aprobado' then 'aprobado por Stock' when 'rechazado' then 'rechazado por Stock'
                                    when 'cancelado' then 'cancelado' else 'otra vez pendiente' end,
      concat_ws(' · ', case when mov is not null then 'Comprobante Nº ' || lpad(mov::text, 5, '0') end, new.respuesta),
      new.presupuesto_id, new.turno_id, new.orden_id, new.id, new.movimiento_id);
  end if;
  return new;
end $$;
drop trigger if exists talisto_bitacora_pedido on public.pedidos_materiales;
create trigger talisto_bitacora_pedido after insert or update on public.pedidos_materiales
  for each row execute function public.bitacora_pedido();

-- Movimientos de stock que tocan un trabajo, o que entregan un pedido
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
drop trigger if exists talisto_bitacora_stock on public.movimientos_stock;
create trigger talisto_bitacora_stock after update of estado, huella on public.movimientos_stock
  for each row execute function public.bitacora_stock();

-- Comisiones
create or replace function public.bitacora_comision()
returns trigger language plpgsql security definer set search_path = public as $$
declare montos text;
begin
  montos := concat_ws(' + ', case when new.monto_usd > 0 then 'US$ ' || to_char(new.monto_usd, 'FM999G999G990D00') end,
                             case when new.monto_uyu > 0 or new.monto_usd = 0 then '$ ' || to_char(new.monto_uyu, 'FM999G999G990D00') end);
  if tg_op = 'INSERT' then
    perform public._registrar(new.profesional_id, 'comision', 'Comisión de ' || coalesce(new.vendedor_nombre, 'el vendedor') || ': ' || montos,
      new.porcentaje::text || '% de la ' || case when new.base = 'ganancia' then 'ganancia' else 'venta sin IVA' end, new.presupuesto_id);
  elsif new.estado is distinct from old.estado or new.monto_uyu is distinct from old.monto_uyu or new.monto_usd is distinct from old.monto_usd then
    perform public._registrar(new.profesional_id, 'comision',
      'Comisión de ' || coalesce(new.vendedor_nombre, 'el vendedor') || ': ' ||
        case when new.estado is distinct from old.estado then case new.estado when 'pagada' then 'pagada' when 'anulada' then 'anulada' else 'pendiente' end
             else 'cambió el monto' end,
      concat_ws(' · ', montos, new.nota), new.presupuesto_id);
  end if;
  return new;
end $$;
drop trigger if exists talisto_bitacora_comision on public.comisiones;
create trigger talisto_bitacora_comision after insert or update on public.comisiones
  for each row execute function public.bitacora_comision();

-- ---------------------------------------------------------------------
-- 5. Generar ticket y pedir materiales
-- ---------------------------------------------------------------------
create or replace function public._crear_pedido_materiales(p_cuenta uuid, p_turno uuid, p_orden uuid, p_presupuesto uuid, p_items jsonb, p_nota text)
returns uuid language plpgsql security definer set search_path = public as $$
declare it jsonb; limpios jsonb := '[]'::jsonb; cant numeric; num int; nuevo uuid; para uuid[]; titulo text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then return null; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if length(trim(coalesce(it ->> 'descripcion', it ->> 'item', ''))) = 0 then continue; end if;
    cant := coalesce(public.numero_o_null(it ->> 'cantidad'), 1);
    if cant <= 0 or cant > 1000000 then raise exception 'Revisá la cantidad de %', coalesce(it ->> 'descripcion', it ->> 'item'); end if;
    limpios := limpios || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'descripcion', left(trim(coalesce(it ->> 'descripcion', it ->> 'item')), 200), 'cantidad', cant,
      'unidad', left(coalesce(nullif(trim(it ->> 'unidad'), ''), 'u'), 12),
      'material_id', public.uuid_o_null(it ->> 'material_id'), 'producto_id', public.uuid_o_null(it ->> 'producto_id'))));
  end loop;
  if jsonb_array_length(limpios) = 0 then return null; end if;
  if jsonb_array_length(limpios) > 200 then raise exception 'Demasiados materiales'; end if;
  perform pg_advisory_xact_lock(hashtext('pedido_materiales' || p_cuenta::text));
  select coalesce(max(numero), 0) + 1 into num from public.pedidos_materiales where profesional_id = p_cuenta;
  insert into public.pedidos_materiales (profesional_id, numero, turno_id, orden_id, presupuesto_id, items, nota, creado_por, creado_por_nombre)
  values (p_cuenta, num, p_turno, p_orden, p_presupuesto, limpios, nullif(left(trim(coalesce(p_nota, '')), 500), ''), auth.uid(), public._nombre_de(auth.uid()))
  returning id into nuevo;
  titulo := coalesce(public._titulo_trabajo(case when p_turno is not null then 'turno' else 'ticket' end, coalesce(p_turno, p_orden)), 'un trabajo');
  select array_agg(x) into para from public._con_permiso(p_cuenta, array['stock']) x;
  perform public._avisar(para, p_cuenta, 'pedido_materiales', 'Pedido de materiales Nº ' || num || ' para aprobar',
    titulo || ' · ' || jsonb_array_length(limpios) || case when jsonb_array_length(limpios) = 1 then ' material' else ' materiales' end,
    '/panel/finanzas/stock?pedidos=1', jsonb_build_object('pedido', nuevo));
  return nuevo;
end $$;

-- Coordinación, Ventas o quien hace el trabajo puede pedir materiales para un ticket
create or replace function public.pedir_materiales(p_cuenta uuid, p_tipo text, p_trabajo uuid, p_items jsonb, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); asig uuid; pres uuid; nuevo uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_tipo = 'turno' then
    select asignado_a, presupuesto_id into asig, pres from public.turnos where id = p_trabajo and profesional_id = p_cuenta;
  elsif p_tipo = 'ticket' then
    select asignado_a into asig from public.ordenes where id = p_trabajo and profesional_id = p_cuenta;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if not found then raise exception 'Ese trabajo no es de esta cuenta'; end if;
  if not (asig = uid or public.puede(p_cuenta, array['agenda', 'tickets_asignar', 'presupuestos', 'stock'])) then
    raise exception 'No podés pedir materiales para este trabajo';
  end if;
  nuevo := public._crear_pedido_materiales(p_cuenta, case when p_tipo = 'turno' then p_trabajo end, case when p_tipo = 'ticket' then p_trabajo end,
                                           pres, p_items, p_nota);
  if nuevo is null then raise exception 'Agregá al menos un material'; end if;
  if p_tipo = 'turno' then update public.turnos set con_materiales = true where id = p_trabajo and not con_materiales; end if;
  return json_build_object('id', nuevo, 'numero', (select numero from public.pedidos_materiales where id = nuevo));
end $$;

-- Stock aprueba (con el comprobante con el que entregó), rechaza o cancela
create or replace function public.resolver_pedido_materiales(p_id uuid, p_estado text, p_movimiento uuid default null, p_respuesta text default null)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ped public.pedidos_materiales; asig uuid; titulo text;
begin
  select * into ped from public.pedidos_materiales where id = p_id for update;
  if not found then raise exception 'No encontramos el pedido'; end if;
  if p_estado not in ('aprobado', 'rechazado', 'cancelado', 'pendiente') then raise exception 'Estado no válido'; end if;
  if p_estado in ('aprobado', 'rechazado', 'pendiente') and not public.gestiona_stock(ped.profesional_id) then
    raise exception 'Solo quien maneja el stock aprueba o rechaza pedidos de materiales';
  end if;
  if p_estado = 'cancelado' and not (ped.creado_por = uid or public.gestiona_stock(ped.profesional_id) or public.ve_seguimiento(ped.profesional_id)) then
    raise exception 'No podés cancelar este pedido';
  end if;
  if p_estado = 'rechazado' and coalesce(trim(p_respuesta), '') = '' then raise exception 'Poné el motivo del rechazo'; end if;
  if p_movimiento is not null and not exists (select 1 from public.movimientos_stock where id = p_movimiento and profesional_id = ped.profesional_id) then
    raise exception 'Ese comprobante no es de esta cuenta';
  end if;
  update public.pedidos_materiales set estado = p_estado, movimiento_id = coalesce(p_movimiento, movimiento_id),
         respuesta = nullif(left(trim(coalesce(p_respuesta, '')), 500), ''),
         resuelto_por = case when p_estado = 'pendiente' then null else uid end,
         resuelto_por_nombre = case when p_estado = 'pendiente' then null else public._nombre_de(uid) end,
         resuelto_en = case when p_estado = 'pendiente' then null else now() end
   where id = p_id;
  if p_estado in ('aprobado', 'rechazado') then
    if ped.turno_id is not null then select asignado_a into asig from public.turnos where id = ped.turno_id;
    elsif ped.orden_id is not null then select asignado_a into asig from public.ordenes where id = ped.orden_id; end if;
    titulo := coalesce(public._titulo_trabajo(case when ped.turno_id is not null then 'turno' else 'ticket' end, coalesce(ped.turno_id, ped.orden_id)), 'tu trabajo');
    perform public._avisar(array_remove(array[asig, ped.creado_por], null), ped.profesional_id, 'pedido_' || p_estado,
      case when p_estado = 'aprobado' then 'Materiales aprobados: ' else 'Materiales rechazados: ' end || titulo,
      case when p_estado = 'aprobado' then 'Stock aprobó el pedido Nº ' || ped.numero || '. Si te los entregaron, confirmalos en Mi stock.' else p_respuesta end,
      case when asig is not null then '/panel/mi-stock' else '/panel' end, jsonb_build_object('pedido', p_id));
  end if;
end $$;

-- Pedidos de materiales con los datos del ticket (para Stock)
create or replace function public.pedidos_materiales_de(p_cuenta uuid, p_estado text default 'pendiente')
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.ve_stock(p_cuenta) or public.ve_seguimiento(p_cuenta)) then raise exception 'No tenés acceso a los pedidos de materiales'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'numero', p.numero, 'estado', p.estado, 'items', p.items, 'nota', p.nota, 'respuesta', p.respuesta,
      'creado_en', p.creado_en, 'creado_por_nombre', p.creado_por_nombre, 'resuelto_por_nombre', p.resuelto_por_nombre,
      'movimiento_id', p.movimiento_id, 'turno_id', p.turno_id, 'orden_id', p.orden_id,
      'ticket_numero', t.numero, 'titulo', coalesce(public._titulo_trabajo(case when p.turno_id is not null then 'turno' else 'ticket' end, coalesce(p.turno_id, p.orden_id)), 'Trabajo'),
      'inicio', t.inicio, 'por_agendar', t.estado = 'por_agendar',
      'asignado_a', coalesce(t.asignado_a, o.asignado_a), 'asignado', public._nombre_de(coalesce(t.asignado_a, o.asignado_a)),
      'presupuesto_numero', (select numero from public.presupuestos where id = p.presupuesto_id)
    ) order by p.creado_en)
      from public.pedidos_materiales p
      left join public.turnos t on t.id = p.turno_id
      left join public.ordenes o on o.id = p.orden_id
     where p.profesional_id = p_cuenta and (p_estado is null or p.estado = p_estado)
  ), '[]'::json);
end $$;

-- Genera el ticket de un trabajo (desde el presupuesto aceptado o suelto, por ejemplo mantenimiento)
create or replace function public.generar_ticket(
  p_cuenta uuid, p_presupuesto uuid, p_cliente uuid, p_cliente_nombre text, p_telefono text,
  p_direccion_id uuid, p_direccion text, p_lat double precision, p_lng double precision,
  p_titulo text, p_pedido text, p_inicio timestamptz, p_minutos int, p_asignado uuid,
  p_con_materiales boolean, p_materiales jsonb, p_tipo text default 'trabajo')
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); agenda boolean; pr public.presupuestos; cli uuid := p_cliente; dir uuid := p_direccion_id;
  minutos int := coalesce(p_minutos, 120); ini timestamptz; est text; asig uuid; nuevo uuid; num int; ped uuid;
  mats jsonb := '[]'::jsonb; it jsonb; para uuid[];
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if not public.puede(p_cuenta, array['presupuestos', 'agenda', 'tickets_asignar']) then
    raise exception 'No tenés permiso para generar tickets en esta empresa';
  end if;
  agenda := public.puede(p_cuenta, array['agenda', 'tickets_asignar']);
  if coalesce(p_tipo, 'trabajo') not in ('trabajo', 'visita') then raise exception 'Tipo de ticket no válido'; end if;
  if minutos < 15 or minutos > 12 * 60 then raise exception 'La duración va de 15 minutos a 12 horas'; end if;

  if p_presupuesto is not null then
    select * into pr from public.presupuestos where id = p_presupuesto and profesional_id = p_cuenta;
    if not found then raise exception 'Ese presupuesto no es de esta cuenta'; end if;
    if pr.estado <> 'aceptado' then raise exception 'El presupuesto tiene que estar aceptado para generar el ticket'; end if;
    cli := coalesce(cli, pr.cliente_id);
  end if;

  -- cliente: el elegido, o uno nuevo con el nombre
  if cli is not null then
    if not exists (select 1 from public.clientes where id = cli and profesional_id = p_cuenta) then raise exception 'Ese cliente no es de esta cuenta'; end if;
  else
    if coalesce(trim(coalesce(p_cliente_nombre, pr.cliente_nombre)), '') = '' then raise exception 'Elegí el cliente o escribí su nombre'; end if;
    insert into public.clientes (profesional_id, nombre, telefono)
    values (p_cuenta, left(trim(coalesce(p_cliente_nombre, pr.cliente_nombre)), 120), nullif(left(trim(coalesce(p_telefono, '')), 40), ''))
    returning id into cli;
    if p_presupuesto is not null then update public.presupuestos set cliente_id = cli where id = p_presupuesto and cliente_id is null; end if;
  end if;

  -- dirección: una del cliente, o una nueva
  if dir is not null then
    if not exists (select 1 from public.direcciones where id = dir and cliente_id = cli) then raise exception 'Esa dirección no es de ese cliente'; end if;
  elsif coalesce(trim(coalesce(p_direccion, pr.cliente_direccion)), '') <> '' then
    insert into public.direcciones (cliente_id, etiqueta, direccion, lat, lng)
    values (cli, 'Trabajo', left(trim(coalesce(p_direccion, pr.cliente_direccion)), 300),
            case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lat end,
            case when p_lat between -90 and 90 and p_lng between -180 and 180 then p_lng end)
    returning id into dir;
  end if;

  -- cuándo y quién: solo quien agenda; si no, queda Por agendar para coordinación
  if agenda and p_inicio is not null then
    ini := p_inicio; est := 'confirmado';
    if p_asignado is not null then
      if p_asignado <> p_cuenta and not public._es_del_equipo(p_cuenta, p_asignado) then raise exception 'Esa persona no es del equipo'; end if;
      asig := p_asignado;
    end if;
  else
    ini := date_trunc('hour', now()) + interval '1 day'; est := 'por_agendar'; asig := null;
  end if;

  -- materiales previstos
  if coalesce(p_con_materiales, false) and p_materiales is not null and jsonb_typeof(p_materiales) = 'array' then
    for it in select * from jsonb_array_elements(p_materiales) loop
      if length(trim(coalesce(it ->> 'item', it ->> 'descripcion', ''))) = 0 then continue; end if;
      mats := mats || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'item', left(trim(coalesce(it ->> 'item', it ->> 'descripcion')), 200),
        'cantidad', coalesce(public.numero_o_null(it ->> 'cantidad'), 1),
        'unidad', left(coalesce(nullif(trim(it ->> 'unidad'), ''), 'u'), 12),
        'material_id', public.uuid_o_null(it ->> 'material_id'), 'producto_id', public.uuid_o_null(it ->> 'producto_id'))));
    end loop;
  end if;

  begin
    insert into public.turnos (profesional_id, cliente_id, direccion_id, titulo, inicio, fin, tipo, estado, notas, asignado_a,
                               presupuesto_id, con_materiales, materiales)
    values (p_cuenta, cli, dir, nullif(left(trim(coalesce(p_titulo, pr.titulo, '')), 160), ''), ini, ini + make_interval(mins => minutos),
            coalesce(p_tipo, 'trabajo'), est, nullif(left(trim(coalesce(p_pedido, '')), 2000), ''), asig,
            p_presupuesto, coalesce(p_con_materiales, false), mats)
    returning id, numero into nuevo, num;
  exception when exclusion_violation then
    raise exception 'Esa persona ya tiene otro trabajo en ese horario: elegí otra hora u otra persona';
  end;

  if coalesce(p_con_materiales, false) and jsonb_array_length(mats) > 0 then
    ped := public._crear_pedido_materiales(p_cuenta, nuevo, null, p_presupuesto, mats, null);
  end if;

  if est = 'por_agendar' then
    select array_agg(x) into para from public._con_permiso(p_cuenta, array['agenda', 'tickets_asignar']) x;
    perform public._avisar(para, p_cuenta, 'ticket_por_agendar', 'Ticket Nº ' || lpad(num::text, 4, '0') || ' para agendar',
      concat_ws(' · ', (select nombre from public.clientes where id = cli),
                case when p_presupuesto is not null then 'Presupuesto Nº ' || lpad(pr.numero::text, 4, '0') end),
      '/panel/equipo', jsonb_build_object('turno', nuevo));
  end if;
  return json_build_object('id', nuevo, 'numero', num, 'estado', est, 'pedido_id', ped);
end $$;

-- ---------------------------------------------------------------------
-- 6. Mis trabajos: número de ticket, presupuesto y materiales
-- ---------------------------------------------------------------------
create or replace function public._pedido_de(p_turno uuid, p_orden uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('numero', p.numero, 'estado', p.estado, 'respuesta', p.respuesta)
    from public.pedidos_materiales p
   where (p_turno is not null and p.turno_id = p_turno) or (p_orden is not null and p.orden_id = p_orden)
   order by (p.estado = 'pendiente') desc, p.creado_en desc limit 1;
$$;

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

-- terminar_trabajo: un ticket "por agendar" todavía no se puede cerrar desde el campo
create or replace function public._ticket_trabajable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('talisto.trabajo_campo', true), '') = 'si' and old.estado = 'por_agendar' then
    raise exception 'Ese ticket todavía no está agendado';
  end if;
  return new;
end $$;
drop trigger if exists talisto_ticket_trabajable on public.turnos;
create trigger talisto_ticket_trabajable before update on public.turnos
  for each row execute function public._ticket_trabajable();

-- ---------------------------------------------------------------------
-- 7. Seguimiento: la ruta de cada presupuesto y ticket, su historial y correcciones
-- ---------------------------------------------------------------------
create or replace function public._ticket_json(t public.turnos)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', t.id, 'numero', t.numero, 'estado', t.estado, 'inicio', t.inicio, 'tipo', t.tipo,
    'titulo', t.titulo, 'asignado', public._nombre_de(t.asignado_a), 'asignado_a', t.asignado_a,
    'empezado', jsonb_array_length(coalesce(t.tiempos, '[]'::jsonb)) > 0,
    'en_curso', exists (select 1 from jsonb_array_elements(coalesce(t.tiempos, '[]'::jsonb)) s where s ->> 'fin' is null and s ? 'inicio'),
    'nota_estado', t.nota_estado, 'con_materiales', t.con_materiales,
    'cliente', (select nombre from public.clientes where id = t.cliente_id),
    'pedido', public._pedido_de(t.id, null));
$$;

create or replace function public.ruta_trabajos(p_cuenta uuid, p_desde date)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_seguimiento(p_cuenta) then raise exception 'El seguimiento es para la cuenta principal y Gerencia general'; end if;
  return json_build_object(
    'presupuestos', coalesce((
      select json_agg(json_build_object(
        'id', p.id, 'numero', p.numero, 'cliente', coalesce(p.cliente_nombre, (select nombre from public.clientes where id = p.cliente_id)),
        'titulo', p.titulo, 'moneda', p.moneda, 'total', p.total, 'total_uyu', p.total_uyu, 'total_usd', p.total_usd,
        'aceptado_en', p.aceptado_en, 'cobrado_en', p.cobrado_en, 'con_materiales', p.con_materiales,
        'vendedor', public._nombre_de(p.vendedor_id),
        'tickets', coalesce((select json_agg(public._ticket_json(t) order by t.numero) from public.turnos t where t.presupuesto_id = p.id), '[]'::json)
      ) order by p.aceptado_en desc nulls last, p.numero desc)
      from public.presupuestos p
      where p.profesional_id = p_cuenta and p.estado = 'aceptado'
        and (p.aceptado_en >= p_desde or p.cobrado_en is null)
    ), '[]'::json),
    'sueltos', coalesce((
      select json_agg(public._ticket_json(t) order by t.inicio desc)
      from public.turnos t
      where t.profesional_id = p_cuenta and t.presupuesto_id is null and t.tipo in ('trabajo', 'visita')
        and (t.inicio >= p_desde or t.estado in ('por_agendar', 'suspendido') or t.creado_en >= p_desde)
    ), '[]'::json)
  );
end $$;

-- Tickets de un presupuesto (para Ventas, Administración y coordinación)
create or replace function public.tickets_de_presupuesto(p_presupuesto uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare cuenta uuid;
begin
  select profesional_id into cuenta from public.presupuestos where id = p_presupuesto;
  if cuenta is null or not public.puede(cuenta, array['presupuestos', 'importes', 'agenda', 'tickets_asignar', 'seguimiento']) then
    raise exception 'No podés ver los tickets de este presupuesto';
  end if;
  return coalesce((select json_agg(public._ticket_json(t) order by t.numero) from public.turnos t where t.presupuesto_id = p_presupuesto), '[]'::json);
end $$;

create or replace function public.historial(p_cuenta uuid, p_presupuesto uuid, p_turno uuid default null, p_orden uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_seguimiento(p_cuenta) then raise exception 'El historial es para la cuenta principal y Gerencia general'; end if;
  return coalesce((
    select json_agg(json_build_object('id', b.id, 'tipo', b.tipo, 'accion', b.accion, 'detalle', b.detalle, 'quien', b.usuario_nombre,
                                      'cuando', b.creado_en, 'presupuesto_id', b.presupuesto_id, 'turno_id', b.turno_id,
                                      'orden_id', b.orden_id, 'pedido_id', b.pedido_id, 'movimiento_id', b.movimiento_id)
                    order by b.creado_en, b.id)
      from public.bitacora b
     where b.profesional_id = p_cuenta
       and ((p_presupuesto is not null and (b.presupuesto_id = p_presupuesto
              or b.turno_id in (select id from public.turnos where presupuesto_id = p_presupuesto)))
         or (p_turno is not null and b.turno_id = p_turno)
         or (p_orden is not null and b.orden_id = p_orden))
  ), '[]'::json);
end $$;

-- Corrección de gerencia: reabrir, cancelar o volver a "por agendar" un ticket (con el motivo)
create or replace function public.corregir_ticket(p_tipo text, p_id uuid, p_accion text, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare cuenta uuid; est text;
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo de la corrección'; end if;
  if p_accion not in ('reabrir', 'cancelar', 'por_agendar') then raise exception 'Corrección no válida'; end if;
  if p_tipo = 'turno' then select profesional_id, estado into cuenta, est from public.turnos where id = p_id;
  elsif p_tipo = 'ticket' then select profesional_id, estado into cuenta, est from public.ordenes where id = p_id;
  else raise exception 'Tipo no válido'; end if;
  if cuenta is null or not public.ve_seguimiento(cuenta) then raise exception 'Solo la cuenta principal o Gerencia general corrigen tickets'; end if;
  perform set_config('talisto.correccion', left(trim(p_motivo), 300), true);
  if p_tipo = 'turno' then
    if p_accion = 'reabrir' then
      update public.turnos set estado = 'confirmado', cerrado_por = null, cerrado_en = null where id = p_id;
    elsif p_accion = 'cancelar' then
      update public.turnos set estado = 'cancelado', nota_estado = left(trim(p_motivo), 500) where id = p_id;
    else
      update public.turnos set estado = 'por_agendar', asignado_a = null, orden_ruta = null where id = p_id;
    end if;
  else
    if p_accion = 'reabrir' then
      update public.ordenes set estado = 'pendiente', cerrado_por = null, cerrado_en = null where id = p_id;
    elsif p_accion = 'cancelar' then
      update public.ordenes set estado = 'cancelado', nota_estado = left(trim(p_motivo), 500) where id = p_id;
    else
      update public.ordenes set estado = 'suspendido', asignado_a = null, orden_ruta = null, nota_estado = left(trim(p_motivo), 500) where id = p_id;
    end if;
  end if;
  perform set_config('talisto.correccion', '', true);
  perform public._registrar(cuenta, 'ticket',
    'Corrección de gerencia: ' || case p_accion when 'reabrir' then 'ticket reabierto' when 'cancelar' then 'ticket cancelado' else 'vuelve a por agendar' end,
    'Motivo: ' || left(trim(p_motivo), 300),
    case when p_tipo = 'turno' then (select presupuesto_id from public.turnos where id = p_id) end,
    case when p_tipo = 'turno' then p_id end, case when p_tipo = 'ticket' then p_id end);
end $$;

-- ---------------------------------------------------------------------
-- 8. Seguridad
-- ---------------------------------------------------------------------
alter table public.pedidos_materiales enable row level security;
drop policy if exists pedidos_materiales_leer on public.pedidos_materiales;
create policy pedidos_materiales_leer on public.pedidos_materiales for select
  using (profesional_id = (select auth.uid()) or creado_por = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['stock', 'compras', 'seguimiento', 'agenda', 'tickets_asignar']))
         or exists (select 1 from public.turnos t where t.id = pedidos_materiales.turno_id and t.asignado_a = (select auth.uid()))
         or exists (select 1 from public.ordenes o where o.id = pedidos_materiales.orden_id and o.asignado_a = (select auth.uid())));

alter table public.bitacora enable row level security;
drop policy if exists bitacora_leer on public.bitacora;
create policy bitacora_leer on public.bitacora for select
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['seguimiento'])));

revoke all on public.pedidos_materiales, public.bitacora from anon, authenticated;
grant select on public.pedidos_materiales, public.bitacora to authenticated;
grant all on public.pedidos_materiales, public.bitacora to service_role;
grant usage, select on sequence public.bitacora_id_seq to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.permisos_validos()', 'public.crear_mi_empresa(text)', 'public.ve_seguimiento(uuid)', 'public.numerar_ticket()',
    'public.bitacora_presupuesto()', 'public.bitacora_ticket()', 'public.bitacora_pedido()', 'public.bitacora_stock()', 'public.bitacora_comision()',
    'public.pedir_materiales(uuid, text, uuid, jsonb, text)', 'public.pedidos_materiales_de(uuid, text)', 'public.resolver_pedido_materiales(uuid, text, uuid, text)',
    'public.generar_ticket(uuid, uuid, uuid, text, text, uuid, text, double precision, double precision, text, text, timestamptz, int, uuid, boolean, jsonb, text)',
    'public.mis_trabajos(uuid, date, date)', 'public._ticket_trabajable()',
    'public.ruta_trabajos(uuid, date)', 'public.historial(uuid, uuid, uuid, uuid)', 'public.tickets_de_presupuesto(uuid)', 'public.corregir_ticket(text, uuid, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._registrar(uuid, text, text, text, uuid, uuid, uuid, uuid, uuid)', 'public._fecha_uy(timestamptz)',
    'public._crear_pedido_materiales(uuid, uuid, uuid, uuid, jsonb, text)', 'public._pedido_de(uuid, uuid)',
    'public._ticket_json(public.turnos)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

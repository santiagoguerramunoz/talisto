-- =====================================================================
--  TaListo!  ·  PRESUPUESTOS EN PESOS, DÓLARES O MIXTOS · COMISIONES
--  · Cada presupuesto se cobra en UYU, en USD o mixto (cada renglón en su
--    moneda). Se guardan los totales de cada moneda por separado y la
--    equivalencia en pesos con la cotización del día (para Finanzas).
--  · Comisiones por venta: la cuenta principal y quien tenga el permiso
--    Comisiones (Gerencia general) eligen el % de cada vendedor y sobre qué
--    se calcula (venta sin IVA o ganancia). Se generan solas al marcar el
--    presupuesto como cobrado y se pueden editar o marcar como pagadas.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 11). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.notificaciones') is null then
    raise exception 'Primero corré 11_operacion.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Permiso nuevo: Comisiones (y el rol de fábrica Gerencia general)
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo','compras','stock','comisiones']::text[];
$$;

insert into public.roles_empresa (empresa_id, nombre, permisos, orden)
select e.id, 'Gerencia general',
       array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock','equipo','comisiones'], 0
  from public.empresas e
 where not exists (select 1 from public.roles_empresa r where r.empresa_id = e.id and r.nombre = 'Gerencia general');

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
      (eid, 'Gerencia general', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock','equipo','comisiones'], 0),
      (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock'], 1),
      (eid, 'Producción',     array['tickets_trabajar'], 2),
      (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 3);
  end if;
  return eid;
end $$;

-- ---------------------------------------------------------------------
-- 2. Presupuestos en pesos, dólares o mixtos
--    items[].moneda: 'UYU' | 'USD' (solo cuenta en los mixtos)
--    subtotal / iva / total / costo_total: equivalencia en pesos (Finanzas)
-- ---------------------------------------------------------------------
alter table public.presupuestos add column if not exists moneda text not null default 'UYU';
alter table public.presupuestos drop constraint if exists presupuestos_moneda_check;
alter table public.presupuestos add constraint presupuestos_moneda_check check (moneda in ('UYU', 'USD', 'mixto'));
alter table public.presupuestos add column if not exists cotizacion numeric(12,4);
alter table public.presupuestos drop constraint if exists presupuestos_cotizacion_check;
alter table public.presupuestos add constraint presupuestos_cotizacion_check check (cotizacion is null or (cotizacion > 0 and cotizacion < 100000));
alter table public.presupuestos add column if not exists mano_obra_moneda text not null default 'UYU';
alter table public.presupuestos drop constraint if exists presupuestos_mano_obra_moneda_check;
alter table public.presupuestos add constraint presupuestos_mano_obra_moneda_check check (mano_obra_moneda in ('UYU', 'USD'));
alter table public.presupuestos add column if not exists subtotal_uyu numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists iva_uyu      numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists total_uyu    numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists costo_uyu    numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists subtotal_usd numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists iva_usd      numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists total_usd    numeric(12,2) not null default 0;
alter table public.presupuestos add column if not exists costo_usd    numeric(12,2) not null default 0;
-- Quién lo vendió (para la comisión). Por defecto, quien lo crea.
alter table public.presupuestos add column if not exists vendedor_id uuid;

-- Última cotización usada (se propone en el próximo presupuesto)
alter table public.ajustes add column if not exists cotizacion_dolar numeric(12,4);
alter table public.ajustes drop constraint if exists ajustes_cotizacion_dolar_check;
alter table public.ajustes add constraint ajustes_cotizacion_dolar_check check (cotizacion_dolar is null or (cotizacion_dolar > 0 and cotizacion_dolar < 100000));

create or replace function public.preparar_presupuesto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c_uyu numeric := 0; c_usd numeric := 0; v_uyu numeric := 0; v_usd numeric := 0;
  mo_moneda text;
  cot numeric;
begin
  if new.cliente_id is not null
     and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id)
     and not exists (select 1 from public.clientes c where c.id = new.cliente_id and c.profesional_id = new.profesional_id) then
    raise exception 'El cliente no pertenece a este profesional';
  end if;
  if new.relevamiento_id is not null
     and (tg_op = 'INSERT' or new.relevamiento_id is distinct from old.relevamiento_id)
     and not exists (select 1 from public.relevamientos r where r.id = new.relevamiento_id and r.profesional_id = new.profesional_id) then
    raise exception 'El relevamiento no pertenece a este profesional';
  end if;

  -- Número correlativo por profesional
  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('presupuesto' || new.profesional_id::text));
    select coalesce(max(p.numero), 0) + 1 into new.numero from public.presupuestos p where p.profesional_id = new.profesional_id;
  else
    new.numero := old.numero;
  end if;

  -- Vendedor: quien lo crea; lo cambian la cuenta principal o quien tiene el permiso Comisiones
  if tg_op = 'INSERT' then
    if new.vendedor_id is null or (uid is not null and new.vendedor_id <> uid and not public.puede(new.profesional_id, array['comisiones'])) then
      new.vendedor_id := coalesce(uid, new.profesional_id);
    end if;
  elsif new.vendedor_id is distinct from old.vendedor_id then
    if uid is not null and not public.puede(new.profesional_id, array['comisiones'])
       and not (uid = new.profesional_id) then
      new.vendedor_id := old.vendedor_id;
    end if;
  end if;
  if new.vendedor_id is not null and new.vendedor_id <> new.profesional_id
     and (tg_op = 'INSERT' or new.vendedor_id is distinct from old.vendedor_id)
     and not public._es_del_equipo(new.profesional_id, new.vendedor_id) then
    raise exception 'El vendedor tiene que ser de la empresa';
  end if;

  -- Totales de cada moneda
  mo_moneda := case when new.moneda = 'mixto' then coalesce(new.mano_obra_moneda, 'UYU') else new.moneda end;
  new.mano_obra_moneda := mo_moneda;
  select
    coalesce(sum(round(cant * costo, 2)) filter (where mon = 'UYU'), 0),
    coalesce(sum(round(cant * costo, 2)) filter (where mon = 'USD'), 0),
    coalesce(sum(round(cant * precio, 2)) filter (where mon = 'UYU'), 0),
    coalesce(sum(round(cant * precio, 2)) filter (where mon = 'USD'), 0)
    into c_uyu, c_usd, v_uyu, v_usd
    from (select coalesce(nullif(i->>'cantidad', '')::numeric, 0) as cant,
                 coalesce(nullif(i->>'costo', '')::numeric, 0) as costo,
                 coalesce(nullif(i->>'precio', '')::numeric, 0) as precio,
                 case when new.moneda = 'mixto' then (case when i->>'moneda' = 'USD' then 'USD' else 'UYU' end) else new.moneda end as mon
            from jsonb_array_elements(new.items) i) x;
  if mo_moneda = 'USD' then v_usd := v_usd + coalesce(new.mano_obra, 0); else v_uyu := v_uyu + coalesce(new.mano_obra, 0); end if;

  new.costo_uyu := c_uyu;
  new.costo_usd := c_usd;
  new.subtotal_uyu := round(v_uyu, 2);
  new.subtotal_usd := round(v_usd, 2);
  new.iva_uyu := round(new.subtotal_uyu * new.iva_porcentaje / 100, 2);
  new.iva_usd := round(new.subtotal_usd * new.iva_porcentaje / 100, 2);
  new.total_uyu := new.subtotal_uyu + new.iva_uyu;
  new.total_usd := new.subtotal_usd + new.iva_usd;

  -- Con dólares hace falta la cotización (para la equivalencia y Finanzas)
  if (new.subtotal_usd > 0 or new.costo_usd > 0) and new.cotizacion is null then
    raise exception 'Poné la cotización del dólar (cuántos pesos vale US$ 1)';
  end if;
  cot := coalesce(new.cotizacion, 0);
  new.costo_total := new.costo_uyu + round(new.costo_usd * cot, 2);
  new.subtotal    := new.subtotal_uyu + round(new.subtotal_usd * cot, 2);
  new.iva         := new.iva_uyu + round(new.iva_usd * cot, 2);
  new.total       := new.subtotal + new.iva;

  if new.estado = 'aceptado' then
    if tg_op = 'INSERT' or old.estado is distinct from 'aceptado' then
      new.aceptado_en := coalesce(new.aceptado_en, current_date);
    end if;
  else
    new.aceptado_en := null;
  end if;
  new.actualizado_en := now();

  -- se recuerda la cotización para el próximo presupuesto
  if new.cotizacion is not null and (tg_op = 'INSERT' or new.cotizacion is distinct from old.cotizacion) then
    update public.ajustes set cotizacion_dolar = new.cotizacion
     where profesional_id = new.profesional_id and cotizacion_dolar is distinct from new.cotizacion;
  end if;
  return new;
end $$;

-- Recalcula los presupuestos que ya existían (quedan en pesos, igual que antes)
update public.presupuestos set moneda = moneda where subtotal_uyu = 0 and subtotal > 0;

-- ---------------------------------------------------------------------
-- 3. Comisiones
-- ---------------------------------------------------------------------
-- % de cada vendedor y sobre qué se calcula: 'venta' (sin IVA) o 'ganancia' (venta sin IVA − costo)
create table if not exists public.comisiones_vendedores (
  profesional_id   uuid not null references public.profesionales(id) on delete cascade,
  usuario_id       uuid not null,
  porcentaje       numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  base             text not null default 'venta' check (base in ('venta', 'ganancia')),
  activo           boolean not null default true,
  actualizado_por  uuid,
  actualizado_en   timestamptz not null default now(),
  primary key (profesional_id, usuario_id)
);

create table if not exists public.comisiones (
  id                  uuid primary key default gen_random_uuid(),
  profesional_id      uuid not null references public.profesionales(id) on delete cascade,
  presupuesto_id      uuid not null references public.presupuestos(id) on delete cascade,
  vendedor_id         uuid not null,
  vendedor_nombre     text,
  base                text not null check (base in ('venta', 'ganancia')),
  porcentaje          numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  base_uyu            numeric(12,2) not null default 0,
  base_usd            numeric(12,2) not null default 0,
  monto_uyu           numeric(12,2) not null default 0 check (monto_uyu >= 0),
  monto_usd           numeric(12,2) not null default 0 check (monto_usd >= 0),
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'pagada', 'anulada')),
  cobrado_en          date,
  pagada_en           date,
  nota                text check (nota is null or length(nota) <= 500),
  editada             boolean not null default false,
  editado_por_nombre  text,
  editado_en          timestamptz,
  creado_en           timestamptz not null default now(),
  unique (presupuesto_id)
);
create index if not exists comisiones_cuenta_idx on public.comisiones (profesional_id, estado, creado_en desc);
create index if not exists comisiones_vendedor_idx on public.comisiones (vendedor_id, estado);

-- ¿Puede manejar las comisiones de esta cuenta? (la cuenta principal o el permiso Comisiones)
create or replace function public.gestiona_comisiones(p_cuenta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (p_cuenta = auth.uid() or p_cuenta in (select public.cuentas_con(array['comisiones'])));
$$;

-- Calcula (o recalcula) la comisión de un presupuesto cobrado con lo configurado para su vendedor.
-- No toca las pagadas ni las editadas a mano. Devuelve la comisión o null si el vendedor no tiene %.
create or replace function public._calcular_comision(p_presupuesto uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare p public.presupuestos; cfg public.comisiones_vendedores; actual public.comisiones; b_uyu numeric; b_usd numeric; nuevo uuid;
begin
  select * into p from public.presupuestos where id = p_presupuesto;
  if not found or p.cobrado_en is null or p.vendedor_id is null then return null; end if;
  select * into actual from public.comisiones where presupuesto_id = p.id;
  if found and (actual.estado = 'pagada' or (actual.editada and actual.estado = 'pendiente')) then return actual.id; end if;
  select * into cfg from public.comisiones_vendedores where profesional_id = p.profesional_id and usuario_id = p.vendedor_id and activo;
  if not found then
    if actual.id is not null then update public.comisiones set estado = 'anulada' where id = actual.id and estado = 'pendiente'; end if;
    return null;
  end if;
  if cfg.base = 'ganancia' then
    b_uyu := greatest(p.subtotal_uyu - p.costo_uyu, 0);
    b_usd := greatest(p.subtotal_usd - p.costo_usd, 0);
  else
    b_uyu := p.subtotal_uyu;
    b_usd := p.subtotal_usd;
  end if;
  insert into public.comisiones (profesional_id, presupuesto_id, vendedor_id, vendedor_nombre, base, porcentaje,
                                 base_uyu, base_usd, monto_uyu, monto_usd, estado, cobrado_en, editada)
  values (p.profesional_id, p.id, p.vendedor_id, public._nombre_de(p.vendedor_id), cfg.base, cfg.porcentaje,
          b_uyu, b_usd, round(b_uyu * cfg.porcentaje / 100, 2), round(b_usd * cfg.porcentaje / 100, 2), 'pendiente', p.cobrado_en, false)
  on conflict (presupuesto_id) do update set
    vendedor_id = excluded.vendedor_id, vendedor_nombre = excluded.vendedor_nombre, base = excluded.base, porcentaje = excluded.porcentaje,
    base_uyu = excluded.base_uyu, base_usd = excluded.base_usd, monto_uyu = excluded.monto_uyu, monto_usd = excluded.monto_usd,
    estado = 'pendiente', cobrado_en = excluded.cobrado_en, editada = false
  returning id into nuevo;
  return nuevo;
end $$;

-- Al cobrar el presupuesto se genera la comisión; si se desmarca el cobro, se anula (si no estaba pagada)
create or replace function public.comision_al_cobrar()
returns trigger language plpgsql security definer set search_path = public as $$
declare cid uuid; titulo text;
begin
  if new.cobrado_en is not null and (old.cobrado_en is null or new.vendedor_id is distinct from old.vendedor_id) then
    cid := public._calcular_comision(new.id);
    if cid is not null and new.vendedor_id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid) then
      titulo := 'Presupuesto Nº ' || lpad(new.numero::text, 4, '0') || coalesce(' · ' || nullif(new.cliente_nombre, ''), '');
      perform public._avisar(array[new.vendedor_id], new.profesional_id, 'comision_nueva', 'Tenés una comisión nueva: ' || titulo,
        'Se cobró el presupuesto. Mirala en Finanzas → Comisiones.', '/panel/finanzas/comisiones', jsonb_build_object('comision', cid));
    end if;
  elsif new.cobrado_en is null and old.cobrado_en is not null then
    update public.comisiones set estado = 'anulada' where presupuesto_id = new.id and estado = 'pendiente';
  elsif new.cobrado_en is not null and new.cobrado_en is distinct from old.cobrado_en then
    update public.comisiones set cobrado_en = new.cobrado_en where presupuesto_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists talisto_comision_al_cobrar on public.presupuestos;
create trigger talisto_comision_al_cobrar
  after update of cobrado_en, vendedor_id on public.presupuestos
  for each row execute function public.comision_al_cobrar();

-- Vendedores de la cuenta con su comisión (para quien las maneja)
create or replace function public.vendedores_comision(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.gestiona_comisiones(p_cuenta) then raise exception 'No tenés permiso para ver las comisiones'; end if;
  return coalesce((
    select json_agg(json_build_object('usuario_id', v.uid, 'nombre', public._nombre_de(v.uid), 'principal', v.uid = p_cuenta,
                                      'porcentaje', c.porcentaje, 'base', coalesce(c.base, 'venta'), 'activo', coalesce(c.activo, false))
                    order by v.uid <> p_cuenta, public._nombre_de(v.uid))
      from (select p_cuenta as uid
            union
            select m.usuario_id from public.miembros m join public.empresas e on e.id = m.empresa_id and e.dueno_id = p_cuenta
             where m.estado = 'activo'
            union
            select usuario_id from public.comisiones_vendedores where profesional_id = p_cuenta) v
      left join public.comisiones_vendedores c on c.profesional_id = p_cuenta and c.usuario_id = v.uid
  ), '[]'::json);
end $$;

create or replace function public.guardar_comision_vendedor(p_cuenta uuid, p_usuario uuid, p_porcentaje numeric, p_base text, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.gestiona_comisiones(p_cuenta) then raise exception 'Solo la cuenta principal o Gerencia general cambian las comisiones'; end if;
  if p_usuario <> p_cuenta and not public._es_del_equipo(p_cuenta, p_usuario)
     and not exists (select 1 from public.comisiones_vendedores where profesional_id = p_cuenta and usuario_id = p_usuario) then
    raise exception 'Esa persona no es de la empresa';
  end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 then raise exception 'El porcentaje va de 0 a 100'; end if;
  if coalesce(p_base, '') not in ('venta', 'ganancia') then raise exception 'Elegí sobre qué se calcula'; end if;
  insert into public.comisiones_vendedores (profesional_id, usuario_id, porcentaje, base, activo, actualizado_por, actualizado_en)
  values (p_cuenta, p_usuario, round(p_porcentaje, 2), p_base, coalesce(p_activo, true), auth.uid(), now())
  on conflict (profesional_id, usuario_id) do update set porcentaje = excluded.porcentaje, base = excluded.base, activo = excluded.activo,
    actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
end $$;

-- Editar una comisión: % (recalcula), montos a mano, pagada (con la fecha) o anulada, y una nota
create or replace function public.editar_comision(p_id uuid, p_porcentaje numeric, p_monto_uyu numeric, p_monto_usd numeric,
                                                  p_estado text, p_pagada_en date, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comisiones; pct numeric; m_uyu numeric; m_usd numeric;
begin
  select * into c from public.comisiones where id = p_id for update;
  if not found or not public.gestiona_comisiones(c.profesional_id) then raise exception 'No podés editar esta comisión'; end if;
  if coalesce(p_estado, c.estado) not in ('pendiente', 'pagada', 'anulada') then raise exception 'Estado no válido'; end if;
  pct := coalesce(p_porcentaje, c.porcentaje);
  if pct < 0 or pct > 100 then raise exception 'El porcentaje va de 0 a 100'; end if;
  m_uyu := coalesce(p_monto_uyu, case when pct <> c.porcentaje then round(c.base_uyu * pct / 100, 2) else c.monto_uyu end);
  m_usd := coalesce(p_monto_usd, case when pct <> c.porcentaje then round(c.base_usd * pct / 100, 2) else c.monto_usd end);
  if m_uyu < 0 or m_usd < 0 then raise exception 'El monto no puede ser negativo'; end if;
  update public.comisiones set
    porcentaje = round(pct, 2), monto_uyu = round(m_uyu, 2), monto_usd = round(m_usd, 2),
    estado = coalesce(p_estado, estado),
    pagada_en = case when coalesce(p_estado, estado) = 'pagada' then coalesce(p_pagada_en, pagada_en, current_date) else null end,
    nota = nullif(left(trim(coalesce(p_nota, '')), 500), ''),
    editada = editada or pct <> c.porcentaje or m_uyu <> c.monto_uyu or m_usd <> c.monto_usd,
    editado_por_nombre = public._nombre_de(auth.uid()), editado_en = now()
  where id = p_id;
  if coalesce(p_estado, c.estado) = 'pagada' and c.estado <> 'pagada' and c.vendedor_id <> auth.uid() then
    perform public._avisar(array[c.vendedor_id], c.profesional_id, 'comision_pagada', 'Te pagaron una comisión',
      concat_ws(' + ', case when m_usd > 0 then 'US$ ' || to_char(m_usd, 'FM999G999G990D00') end,
                       case when m_uyu > 0 or m_usd = 0 then '$ ' || to_char(m_uyu, 'FM999G999G990D00') end),
      '/panel/finanzas/comisiones', jsonb_build_object('comision', p_id));
  end if;
end $$;

-- Para un presupuesto ya cobrado (por ejemplo, de antes de configurar el %): la calcula de nuevo
create or replace function public.calcular_comision(p_presupuesto uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cuenta uuid; cid uuid;
begin
  select profesional_id into cuenta from public.presupuestos where id = p_presupuesto;
  if cuenta is null or not public.gestiona_comisiones(cuenta) then raise exception 'No podés calcular esta comisión'; end if;
  update public.comisiones set editada = false where presupuesto_id = p_presupuesto and estado = 'pendiente';
  cid := public._calcular_comision(p_presupuesto);
  if cid is null then raise exception 'El vendedor no tiene comisión configurada o el presupuesto no está cobrado'; end if;
  return cid;
end $$;

-- ---------------------------------------------------------------------
-- 4. Seguridad
-- ---------------------------------------------------------------------
alter table public.comisiones enable row level security;
drop policy if exists comisiones_leer on public.comisiones;
create policy comisiones_leer on public.comisiones for select
  using (profesional_id = (select auth.uid()) or vendedor_id = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['comisiones'])));

alter table public.comisiones_vendedores enable row level security;
drop policy if exists comisiones_vendedores_leer on public.comisiones_vendedores;
create policy comisiones_vendedores_leer on public.comisiones_vendedores for select
  using (profesional_id = (select auth.uid()) or usuario_id = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['comisiones'])));

-- Solo se cambian con las funciones de arriba
revoke all on public.comisiones, public.comisiones_vendedores from anon, authenticated;
grant select on public.comisiones, public.comisiones_vendedores to authenticated;
grant all on public.comisiones, public.comisiones_vendedores to service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'public.gestiona_comisiones(uuid)', 'public.vendedores_comision(uuid)',
    'public.guardar_comision_vendedor(uuid, uuid, numeric, text, boolean)',
    'public.editar_comision(uuid, numeric, numeric, numeric, text, date, text)', 'public.calcular_comision(uuid)',
    'public.preparar_presupuesto()', 'public.comision_al_cobrar()', 'public.permisos_validos()', 'public.crear_mi_empresa(text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  execute 'revoke execute on function public._calcular_comision(uuid) from public, anon, authenticated';
  execute 'grant execute on function public._calcular_comision(uuid) to service_role';
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

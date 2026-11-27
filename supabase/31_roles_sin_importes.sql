-- =====================================================================
--  TaListo!  ·  31  ·  Roles sin importes (encargado)
--  Los precios e importes de los trabajos son solo para quien tiene el
--  permiso "Importes" (o la cuenta principal). Alguien del equipo sin
--  ese permiso (por ejemplo, un encargado con "Agendar tickets") crea y
--  edita tickets con puestas, MOE y materiales, pero la base no le deja
--  poner ni cambiar precios:
--    · ticket nuevo: el precio por puesta y el factor MOE son los del
--      cliente, sin mano de obra, y los materiales sin precios
--    · ticket que ya existe: los precios quedan como estaban; en los
--      materiales se conservan los precios de los renglones que ya había
--  Lo mismo con los montos de los turnos y horarios fijos y el precio
--  por puesta de los clientes.
--  Además: rol "Encargado" listo para usar en cada empresa.
--  Se puede correr más de una vez.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.cuentas_con(text[])') is null or to_regprocedure('public.permisos_validos()') is null then
    raise exception 'Primero corré los SQL anteriores (06 al 30)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. ¿Quien escribe es del equipo de esa cuenta y no ve importes?
-- ---------------------------------------------------------------------
create or replace function public.ve_importes(p_dueno uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and (auth.uid() = p_dueno or p_dueno in (select public.cuentas_con(array['importes'])));
$$;

create or replace function public._equipo_sin_importes(p_dueno uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null
     and auth.uid() <> p_dueno
     and p_dueno in (select public.cuentas_con(public.permisos_validos()))
     and not public.ve_importes(p_dueno);
$$;

-- Materiales sin importes: saca costo, margen, precio y proveedor de cada
-- renglón y, si el renglón ya estaba, le devuelve los que tenía.
create or replace function public._materiales_sin_importes(p_nuevos jsonb, p_viejos jsonb)
returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg(
           (m - 'costo' - 'margen' - 'precio' - 'moneda' - 'proveedor' - 'proveedor_id')
           || coalesce((
                select jsonb_strip_nulls(jsonb_build_object(
                         'costo', v -> 'costo', 'margen', v -> 'margen', 'precio', v -> 'precio',
                         'moneda', v -> 'moneda', 'proveedor', v -> 'proveedor', 'proveedor_id', v -> 'proveedor_id'))
                from jsonb_array_elements(case when jsonb_typeof(p_viejos) = 'array' then p_viejos else '[]'::jsonb end)
                     with ordinality as y(v, j)
                where (m ? 'producto_id' and v ->> 'producto_id' = m ->> 'producto_id')
                   or lower(trim(v ->> 'item')) = lower(trim(m ->> 'item'))
                -- primero el renglón en el mismo lugar (si hay dos con el mismo nombre)
                order by (j = i) desc, j
                limit 1), '{}'::jsonb)
           order by i), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_nuevos) = 'array' then p_nuevos else '[]'::jsonb end) with ordinality as x(m, i)
  where jsonb_typeof(m) = 'object';
$$;

-- ---------------------------------------------------------------------
-- 2. La base protege los precios
--    Solo en lo que se escribe directo desde la app (rol authenticated):
--    las funciones del sistema (cierre de trabajos, stock, reservas)
--    siguen como estaban.
-- ---------------------------------------------------------------------
create or replace function public._proteger_importes()
returns trigger language plpgsql set search_path = public as $$
declare
  precio numeric; factor numeric;
begin
  if current_user <> 'authenticated' or not public._equipo_sin_importes(new.profesional_id) then
    return new;
  end if;

  if tg_table_name = 'ordenes' then
    if tg_op = 'INSERT' or new.empresa_id is distinct from old.empresa_id then
      select c.precio_acondicionamiento, c.factor_moe into precio, factor
      from public.clientes c where c.id = new.empresa_id and c.profesional_id = new.profesional_id;
      new.precio_acondicionamiento := precio;
      new.factor_moe := coalesce(factor, 1.75);
    else
      new.precio_acondicionamiento := old.precio_acondicionamiento;
      new.factor_moe := old.factor_moe;
    end if;
    if tg_op = 'INSERT' then
      new.mano_obra := null;
      new.materiales := public._materiales_sin_importes(new.materiales, '[]'::jsonb);
    else
      new.mano_obra := old.mano_obra;
      if new.materiales is distinct from old.materiales then
        new.materiales := public._materiales_sin_importes(new.materiales, old.materiales);
      end if;
    end if;

  elsif tg_table_name = 'turnos' then
    if tg_op = 'INSERT' then
      new.monto_acordado := null;
      new.materiales := public._materiales_sin_importes(new.materiales, '[]'::jsonb);
    else
      new.monto_acordado := old.monto_acordado;
      new.precio_visita := old.precio_visita;
      new.comision := old.comision;
      if new.materiales is distinct from old.materiales then
        new.materiales := public._materiales_sin_importes(new.materiales, old.materiales);
      end if;
    end if;

  elsif tg_table_name = 'clientes' then
    if tg_op = 'INSERT' then
      new.precio_acondicionamiento := null;
      new.factor_moe := 1.75;
    else
      new.precio_acondicionamiento := old.precio_acondicionamiento;
      new.factor_moe := old.factor_moe;
    end if;

  elsif tg_table_name = 'bloques_fijos' then
    new.monto := case when tg_op = 'INSERT' then null else old.monto end;
  end if;
  return new;
end $$;

drop trigger if exists talisto_importes_protegidos on public.ordenes;
create trigger talisto_importes_protegidos before insert or update on public.ordenes
  for each row execute function public._proteger_importes();
drop trigger if exists talisto_importes_protegidos on public.turnos;
create trigger talisto_importes_protegidos before insert or update on public.turnos
  for each row execute function public._proteger_importes();
drop trigger if exists talisto_importes_protegidos on public.clientes;
create trigger talisto_importes_protegidos before insert or update on public.clientes
  for each row execute function public._proteger_importes();
drop trigger if exists talisto_importes_protegidos on public.bloques_fijos;
create trigger talisto_importes_protegidos before insert or update on public.bloques_fijos
  for each row execute function public._proteger_importes();

-- ---------------------------------------------------------------------
-- 3. Rol "Encargado": agenda, crea y asigna tickets y trabaja, sin importes
-- ---------------------------------------------------------------------
insert into public.roles_empresa (empresa_id, nombre, permisos, orden)
select e.id, 'Encargado', array['agenda','tickets_asignar','tickets_trabajar'], 2
  from public.empresas e
 where not exists (select 1 from public.roles_empresa r where r.empresa_id = e.id and lower(r.nombre) = 'encargado');

create or replace function public.crear_mi_empresa(p_nombre text)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); eid uuid; pl text;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  pl := public.plan_de(uid);
  if pl not in ('pro', 'business') then
    raise exception using errcode = 'TL001', message = 'El equipo con colaboradores es parte de los planes Pro y Business.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  if not exists (select 1 from public.profesionales where id = uid) then
    raise exception 'Primero completá tu perfil profesional';
  end if;
  insert into public.empresas (dueno_id, nombre) values (uid, trim(p_nombre))
  on conflict (dueno_id) do update set nombre = excluded.nombre
  returning id into eid;
  if not exists (select 1 from public.roles_empresa where empresa_id = eid) then
    if pl = 'business' then
      insert into public.roles_empresa (empresa_id, nombre, permisos, orden) values
        (eid, 'Gerencia general', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock','equipo','comisiones','seguimiento'], 0),
        (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock'], 1),
        (eid, 'Encargado',      array['agenda','tickets_asignar','tickets_trabajar'], 2),
        (eid, 'Producción',     array['tickets_trabajar'], 3),
        (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 4);
    else
      insert into public.roles_empresa (empresa_id, nombre, permisos, orden) values
        (eid, 'Ayudante',       array['tickets_trabajar'], 1),
        (eid, 'Encargado',      array['agenda','tickets_asignar','tickets_trabajar'], 2),
        (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras'], 3);
    end if;
  end if;
  return eid;
end $$;

revoke all on function public._equipo_sin_importes(uuid) from public, anon;
revoke all on function public._materiales_sin_importes(jsonb, jsonb) from public, anon;
grant execute on function public.ve_importes(uuid) to authenticated, service_role;
grant execute on function public._equipo_sin_importes(uuid) to authenticated, service_role;
grant execute on function public._materiales_sin_importes(jsonb, jsonb) to authenticated, service_role;
grant execute on function public.crear_mi_empresa(text) to authenticated;

-- Para revisar: roles que agendan tickets sin ver importes (desde ahora no ven precios)
select e.nombre as empresa, r.nombre as rol, array_to_string(r.permisos, ', ') as permisos
  from public.roles_empresa r join public.empresas e on e.id = r.empresa_id
 where 'tickets_asignar' = any(r.permisos) and not ('importes' = any(r.permisos))
 order by e.nombre, r.orden;

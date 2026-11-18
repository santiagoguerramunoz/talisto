-- =====================================================================
--  TaListo!  ·  EQUIPO TAMBIÉN PARA PRO
--  · Pro arma su equipo con hasta 2 colaboradores (Business, 5). Los dos
--    números por defecto los cambia el admin, y a cada cuenta le puede
--    dar un cupo especial (Admin > Profesionales > Plan).
--  · El profesional define los roles de sus colaboradores, igual que
--    Business. Los permisos de lo que es solo de Business (Stock,
--    Seguimiento y Comisiones) no corren en una cuenta Pro.
--  · Si el equipo tiene más colaboradores que el cupo (por ejemplo, pasó
--    de Business a Pro), entran los primeros que se sumaron hasta
--    completar el cupo; los demás quedan sin acceso hasta que se libere
--    lugar o el admin amplíe el cupo.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 21). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.empresas') is null or to_regclass('public.planes') is null then
    raise exception 'Primero corré 05_planes.sql y 06_empresas.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Cupo por defecto del plan Pro
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists pro_colaboradores_defecto int not null default 2;
alter table public.configuracion drop constraint if exists configuracion_pro_colaboradores_check;
alter table public.configuracion add constraint configuracion_pro_colaboradores_check check (pro_colaboradores_defecto >= 0);
comment on column public.planes.max_cuentas is 'Cupo especial de colaboradores (Pro o Business) que fija el admin; vacío = el del plan';

-- ---------------------------------------------------------------------
-- 2. Permisos según el plan de la cuenta principal
-- ---------------------------------------------------------------------
create or replace function public.permisos_solo_business()
returns text[] language sql immutable as $$
  select array['stock', 'seguimiento', 'comisiones']::text[];
$$;

-- Los permisos de un rol que valen con ese plan (Free: ninguno)
create or replace function public.permisos_del_plan(p_permisos text[], p_plan text)
returns text[] language sql immutable as $$
  select case p_plan
           when 'business' then coalesce(p_permisos, '{}'::text[])
           when 'pro' then coalesce(array(select x from unnest(p_permisos) x where x <> all (public.permisos_solo_business())), '{}'::text[])
           else '{}'::text[] end;
$$;

-- Cuántos colaboradores puede tener la empresa: el cupo especial o el del plan
create or replace function public.cupo_empresa(e uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p.max_cuentas,
                  case public.plan_de(x.dueno_id)
                    when 'business' then c.business_cuentas_defecto
                    when 'pro' then c.pro_colaboradores_defecto
                    else 0 end)
  from public.empresas x
  cross join public.configuracion c
  left join public.planes p on p.usuario_id = x.dueno_id
  where x.id = e and c.id = 1;
$$;

-- ¿Este colaborador entra en el cupo? (los activos, por orden de llegada)
create or replace function public._en_cupo(p_miembro uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select x.n <= public.cupo_empresa(x.empresa_id)
      from (select m.id, m.empresa_id, row_number() over (order by m.creado_en, m.id) as n
              from public.miembros m
             where m.empresa_id = (select y.empresa_id from public.miembros y where y.id = p_miembro)
               and m.estado = 'activo') x
     where x.id = p_miembro), false);
$$;

-- Cuentas principales (dueños) cuyos datos puedo usar con alguno de esos permisos:
-- la empresa tiene que tener Pro o Business vigente y yo tengo que entrar en su cupo
create or replace function public.cuentas_con(p text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct e.dueno_id
  from public.empresas e
  join public.miembros m on m.empresa_id = e.id and m.usuario_id = auth.uid() and m.estado = 'activo'
  join public.miembros_roles mr on mr.miembro_id = m.id
  join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado
  cross join lateral (select public.plan_de(e.dueno_id) as plan) x
  where x.plan in ('pro', 'business')
    and public.permisos_del_plan(r.permisos, x.plan) && p
    and public._en_cupo(m.id);
$$;

-- ---------------------------------------------------------------------
-- 3. Funciones que usa la app
-- ---------------------------------------------------------------------
-- Pro o Business crea su equipo (o le cambia el nombre). Arranca con roles de ejemplo.
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
        (eid, 'Producción',     array['tickets_trabajar'], 2),
        (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 3);
    else
      insert into public.roles_empresa (empresa_id, nombre, permisos, orden) values
        (eid, 'Ayudante',       array['tickets_trabajar'], 1),
        (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras'], 2);
    end if;
  end if;
  return eid;
end $$;

-- Datos del equipo para quien lo gestiona
create or replace function public.info_empresa(p_empresa uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.gestiona_equipo(p_empresa) then raise exception 'No tenés permiso para ver el equipo'; end if;
  return (
    select json_build_object('id', e.id, 'nombre', e.nombre, 'dueno_id', e.dueno_id,
                             'cupo', public.cupo_empresa(e.id),
                             'usadas', (select count(*) from public.miembros m where m.empresa_id = e.id),
                             'plan', x.plan,
                             'activa', x.plan in ('pro', 'business'),
                             'fuera_de_cupo', (select count(*) from public.miembros m
                                                where m.empresa_id = e.id and m.estado = 'activo' and not public._en_cupo(m.id)),
                             'solo_business', public.permisos_solo_business())
    from public.empresas e, lateral (select public.plan_de(e.dueno_id) as plan) x
    where e.id = p_empresa
  );
end $$;

-- Equipo con nombre, email, roles y si entra en el cupo
create or replace function public.equipo_empresa(p_empresa uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.gestiona_equipo(p_empresa) then raise exception 'No tenés permiso para ver el equipo'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', m.id, 'usuario_id', m.usuario_id, 'estado', m.estado, 'creado_en', m.creado_en,
      'nombre', coalesce(nullif(pr.nombre_publico, ''), nullif(pe.nombre, ''), pe.email),
      'email', pe.email,
      'en_cupo', public._en_cupo(m.id),
      'roles', coalesce((select array_agg(mr.rol_id) from public.miembros_roles mr where mr.miembro_id = m.id), '{}')
    ) order by m.creado_en)
    from public.miembros m
    join public.perfiles pe on pe.id = m.usuario_id
    left join public.profesionales pr on pr.id = m.usuario_id
    where m.empresa_id = p_empresa
  ), '[]'::json);
end $$;

-- Empresas en las que estoy (con los permisos que valen con su plan)
create or replace function public.mis_empresas()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.nombre), '[]'::json) from (
    select e.id, e.nombre, e.dueno_id, m.id as miembro_id, m.estado, pl.plan,
           pl.plan in ('pro', 'business') and public._en_cupo(m.id) as activa,
           public._en_cupo(m.id) as en_cupo,
           public.permisos_del_plan(coalesce((select array_agg(distinct p) from public.miembros_roles mr
                     join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado,
                     unnest(r.permisos) p
                     where mr.miembro_id = m.id), '{}'), pl.plan) as permisos,
           coalesce((select array_agg(r.nombre order by r.orden) from public.miembros_roles mr
                     join public.roles_empresa r on r.id = mr.rol_id
                     where mr.miembro_id = m.id), '{}') as roles
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id
    cross join lateral (select public.plan_de(e.dueno_id) as plan) pl
    where m.usuario_id = auth.uid()
  ) x;
$$;

-- Aceptar una invitación: la empresa tiene que tener Pro o Business (el cupo lo controla la base al sumarse)
create or replace function public.aceptar_invitacion(p_codigo text)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  inv public.invitaciones;
  emp public.empresas;
  mi_email text;
  mid uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  select * into inv from public.invitaciones where codigo = p_codigo for update;
  if not found or inv.estado <> 'pendiente' then
    raise exception 'Esta invitación ya no es válida. Pedile una nueva a la empresa.';
  end if;
  if inv.vence_en < now() then raise exception 'La invitación venció. Pedile una nueva a la empresa.'; end if;
  select * into emp from public.empresas where id = inv.empresa_id;
  if emp.dueno_id = uid then raise exception 'Esta empresa es tuya: ya tenés acceso a todo.'; end if;
  select lower(email) into mi_email from public.perfiles where id = uid;
  if inv.email is not null and inv.email <> coalesce(mi_email, '') then
    raise exception 'Esta invitación es para otro email. Entrá con la cuenta de % o pedí una nueva.',
      left(inv.email, 1) || '•••' || substr(inv.email, position('@' in inv.email));
  end if;
  if public.plan_de(emp.dueno_id) not in ('pro', 'business') then
    raise exception 'La empresa no tiene un plan Pro o Business activo.';
  end if;

  -- Su cuenta personal de profesional (la sigue usando para lo suyo)
  update public.perfiles set rol = 'profesional' where id = uid and rol <> 'profesional';
  insert into public.profesionales (id, nombre_publico)
  select p.id, p.nombre from public.perfiles p where p.id = uid
  on conflict (id) do nothing;

  select id into mid from public.miembros where empresa_id = emp.id and usuario_id = uid;
  if mid is null then
    insert into public.miembros (empresa_id, usuario_id) values (emp.id, uid) returning id into mid;
  end if;
  insert into public.miembros_roles (miembro_id, rol_id)
  select mid, r.id from public.roles_empresa r where r.empresa_id = emp.id and r.id = any(inv.roles)
  on conflict do nothing;

  update public.invitaciones set estado = 'aceptada', usado_por = uid, usado_en = now() where id = inv.id;
  return json_build_object('empresa_id', emp.id, 'dueno_id', emp.dueno_id, 'nombre', emp.nombre);
end $$;

-- Mi plan: el cupo de colaboradores ahora depende del plan
create or replace function public.mi_plan()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'plan', public.plan_de(auth.uid()),
    'plan_guardado', coalesce(p.plan, 'free'),
    'origen', coalesce(p.origen, 'free'),
    'vence_en', p.vence_en,
    'max_cuentas', coalesce(p.max_cuentas, case public.plan_de(auth.uid())
                                             when 'business' then c.business_cuentas_defecto
                                             when 'pro' then c.pro_colaboradores_defecto else 0 end),
    'mp_plan', p.mp_plan,
    'mp_estado', p.mp_estado,
    'mp_proximo_cobro', p.mp_proximo_cobro,
    'exportaciones_mes', (select count(*) from public.exportaciones e
                          where e.usuario_id = auth.uid() and e.creado_en >= public.inicio_mes_uy()),
    'limite_exportaciones', c.free_exportaciones_mes,
    'limite_empresas_b2b', c.free_empresas_b2b,
    'precio_pro', c.precio_pro,
    'precio_business', c.precio_business,
    'moneda', c.moneda
  )
  from public.configuracion c
  left join public.planes p on p.usuario_id = auth.uid()
  where c.id = 1;
$$;

-- ---------------------------------------------------------------------
-- 4. Quién puede llamar a qué
-- ---------------------------------------------------------------------
revoke execute on function public._en_cupo(uuid) from public, anon, authenticated;
grant execute on function public._en_cupo(uuid) to service_role;
grant execute on function public.permisos_solo_business() to authenticated, service_role;
grant execute on function public.permisos_del_plan(text[], text) to authenticated, service_role;

-- =====================================================================
-- LISTO.
-- =====================================================================

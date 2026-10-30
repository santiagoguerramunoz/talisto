-- =====================================================================
--  TaListo!  ·  BUSINESS: EMPRESA, CUENTAS DEL EQUIPO Y ROLES
--  · La cuenta Business crea su empresa e invita al equipo por email o QR.
--  · Cada cuenta tiene uno o más roles; cada rol, sus permisos (editables).
--  · Roles y cuentas se pueden bloquear. El admin fija cuántas cuentas
--    puede tener cada empresa (Admin > Plan).
--  · Quien se suma a una empresa sigue teniendo su cuenta personal.
--  · Los datos de la empresa son los de la cuenta principal: el equipo los
--    ve y edita según sus permisos (lo controla la base).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 05). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.planes') is null then
    raise exception 'Primero corré 05_planes.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo']::text[];
$$;

create or replace function public.uuid_o_null(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

create table if not exists public.empresas (
  id         uuid primary key default gen_random_uuid(),
  dueno_id   uuid not null unique references public.profesionales(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) between 1 and 80),
  creado_en  timestamptz not null default now()
);

create table if not exists public.roles_empresa (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  nombre      text not null check (length(trim(nombre)) between 1 and 40),
  permisos    text[] not null default '{}',
  bloqueado   boolean not null default false,
  orden       int not null default 0,
  creado_en   timestamptz not null default now(),
  unique (empresa_id, nombre),
  constraint roles_permisos_validos check (permisos <@ public.permisos_validos())
);

create table if not exists public.miembros (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  estado      text not null default 'activo' check (estado in ('activo','bloqueado')),
  creado_en   timestamptz not null default now(),
  unique (empresa_id, usuario_id)
);
create index if not exists miembros_usuario_idx on public.miembros (usuario_id);

create table if not exists public.miembros_roles (
  miembro_id  uuid not null references public.miembros(id) on delete cascade,
  rol_id      uuid not null references public.roles_empresa(id) on delete cascade,
  primary key (miembro_id, rol_id)
);

create table if not exists public.invitaciones (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  email       text,                              -- null = invitación abierta (QR / link)
  codigo      text not null unique default replace(gen_random_uuid()::text, '-', ''),
  roles       uuid[] not null default '{}',
  estado      text not null default 'pendiente' check (estado in ('pendiente','aceptada','cancelada')),
  creado_por  uuid,
  creado_en   timestamptz not null default now(),
  vence_en    timestamptz not null default now() + interval '14 days',
  usado_por   uuid,
  usado_en    timestamptz
);
create index if not exists invitaciones_email_idx on public.invitaciones (lower(email)) where estado = 'pendiente';

-- ---------------------------------------------------------------------
-- 2. ¿Quién puede qué?
-- ---------------------------------------------------------------------
create or replace function public.es_miembro(e uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros m
                 where m.empresa_id = e and m.usuario_id = auth.uid() and m.estado = 'activo');
$$;

-- Dueño de la empresa, alguien con el permiso "equipo" o el admin de TaListo!
create or replace function public.gestiona_equipo(e uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.es_admin()
      or exists (select 1 from public.empresas x where x.id = e and x.dueno_id = auth.uid())
      or exists (select 1 from public.miembros m
                 join public.miembros_roles mr on mr.miembro_id = m.id
                 join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado
                 where m.empresa_id = e and m.usuario_id = auth.uid() and m.estado = 'activo'
                   and 'equipo' = any(r.permisos));
$$;

-- Cuentas principales (dueños) cuyos datos puedo usar con alguno de esos permisos.
-- La empresa tiene que tener Business vigente.
create or replace function public.cuentas_con(p text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct e.dueno_id
  from public.empresas e
  join public.miembros m on m.empresa_id = e.id and m.usuario_id = auth.uid() and m.estado = 'activo'
  join public.miembros_roles mr on mr.miembro_id = m.id
  join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado
  where r.permisos && p and public.plan_de(e.dueno_id) = 'business';
$$;

create or replace function public.puede(cuenta uuid, p text[])
returns boolean language sql stable security definer set search_path = public as $$
  select cuenta = auth.uid() or cuenta in (select public.cuentas_con(p));
$$;

-- Cuántas cuentas puede tener la empresa (lo fija el admin en el plan)
create or replace function public.cupo_empresa(e uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p.max_cuentas, c.business_cuentas_defecto)
  from public.empresas x
  cross join public.configuracion c
  left join public.planes p on p.usuario_id = x.dueno_id
  where x.id = e and c.id = 1;
$$;

-- ---------------------------------------------------------------------
-- 3. Reglas de las tablas nuevas
-- ---------------------------------------------------------------------
-- Una cuenta nueva respeta el cupo de la empresa
create or replace function public.controlar_cupo()
returns trigger language plpgsql security definer set search_path = public as $$
declare cupo int; usadas int;
begin
  cupo := public.cupo_empresa(new.empresa_id);
  select count(*) into usadas from public.miembros where empresa_id = new.empresa_id;
  if usadas >= cupo then
    raise exception using errcode = 'TL002',
      message = format('La empresa ya tiene %s cuentas, el máximo de su plan.', cupo),
      hint = 'Pedile a TaListo! que amplíe la cantidad de cuentas.';
  end if;
  return new;
end $$;

drop trigger if exists talisto_cupo_miembros on public.miembros;
create trigger talisto_cupo_miembros before insert on public.miembros
  for each row execute function public.controlar_cupo();

-- De una cuenta del equipo solo se cambia el estado (activa / bloqueada)
create or replace function public.proteger_miembro()
returns trigger language plpgsql set search_path = public as $$
begin
  new.empresa_id := old.empresa_id;
  new.usuario_id := old.usuario_id;
  new.creado_en := old.creado_en;
  return new;
end $$;

drop trigger if exists talisto_proteger_miembro on public.miembros;
create trigger talisto_proteger_miembro before update on public.miembros
  for each row execute function public.proteger_miembro();

-- El rol asignado tiene que ser de la misma empresa
create or replace function public.validar_miembro_rol()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.miembros m join public.roles_empresa r on r.empresa_id = m.empresa_id
                 where m.id = new.miembro_id and r.id = new.rol_id) then
    raise exception 'Ese rol no es de esta empresa';
  end if;
  return new;
end $$;

drop trigger if exists talisto_validar_miembro_rol on public.miembros_roles;
create trigger talisto_validar_miembro_rol before insert or update on public.miembros_roles
  for each row execute function public.validar_miembro_rol();

-- Invitaciones: email en minúscula, roles de la empresa, quién la creó
create or replace function public.preparar_invitacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.email := nullif(lower(trim(coalesce(new.email, ''))), '');
  if tg_op = 'INSERT' then
    new.creado_por := auth.uid();
    new.estado := 'pendiente';
    new.usado_por := null;
    new.usado_en := null;
  else
    new.codigo := old.codigo;
    new.empresa_id := old.empresa_id;
  end if;
  if exists (select 1 from unnest(new.roles) r
             where r not in (select id from public.roles_empresa where empresa_id = new.empresa_id)) then
    raise exception 'Hay roles que no son de esta empresa';
  end if;
  return new;
end $$;

drop trigger if exists talisto_preparar_invitacion on public.invitaciones;
create trigger talisto_preparar_invitacion before insert or update on public.invitaciones
  for each row execute function public.preparar_invitacion();

-- ---------------------------------------------------------------------
-- 4. Funciones que usa la app
-- ---------------------------------------------------------------------
-- La cuenta Business crea su empresa (o le cambia el nombre). Arranca con 3 roles.
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
      (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos'], 1),
      (eid, 'Producción',     array['tickets_trabajar'], 2),
      (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 3);
  end if;
  return eid;
end $$;

-- Datos de la empresa para quien la gestiona
create or replace function public.info_empresa(p_empresa uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.gestiona_equipo(p_empresa) then raise exception 'No tenés permiso para ver el equipo'; end if;
  return (
    select json_build_object('id', e.id, 'nombre', e.nombre, 'dueno_id', e.dueno_id,
                             'cupo', public.cupo_empresa(e.id),
                             'usadas', (select count(*) from public.miembros m where m.empresa_id = e.id),
                             'activa', public.plan_de(e.dueno_id) = 'business')
    from public.empresas e where e.id = p_empresa
  );
end $$;

-- Equipo con nombre, email y roles
create or replace function public.equipo_empresa(p_empresa uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.gestiona_equipo(p_empresa) then raise exception 'No tenés permiso para ver el equipo'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', m.id, 'usuario_id', m.usuario_id, 'estado', m.estado, 'creado_en', m.creado_en,
      'nombre', coalesce(nullif(pr.nombre_publico, ''), nullif(pe.nombre, ''), pe.email),
      'email', pe.email,
      'roles', coalesce((select array_agg(mr.rol_id) from public.miembros_roles mr where mr.miembro_id = m.id), '{}')
    ) order by m.creado_en)
    from public.miembros m
    join public.perfiles pe on pe.id = m.usuario_id
    left join public.profesionales pr on pr.id = m.usuario_id
    where m.empresa_id = p_empresa
  ), '[]'::json);
end $$;

-- Empresas en las que estoy (con mis permisos)
create or replace function public.mis_empresas()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.nombre), '[]'::json) from (
    select e.id, e.nombre, e.dueno_id, m.id as miembro_id, m.estado,
           public.plan_de(e.dueno_id) = 'business' as activa,
           coalesce((select array_agg(distinct p) from public.miembros_roles mr
                     join public.roles_empresa r on r.id = mr.rol_id and not r.bloqueado,
                     unnest(r.permisos) p
                     where mr.miembro_id = m.id), '{}') as permisos,
           coalesce((select array_agg(r.nombre order by r.orden) from public.miembros_roles mr
                     join public.roles_empresa r on r.id = mr.rol_id
                     where mr.miembro_id = m.id), '{}') as roles
    from public.miembros m
    join public.empresas e on e.id = m.empresa_id
    where m.usuario_id = auth.uid()
  ) x;
$$;

-- Mi empresa (si soy la cuenta principal)
create or replace function public.mi_empresa()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', e.id, 'nombre', e.nombre, 'cupo', public.cupo_empresa(e.id),
                           'usadas', (select count(*) from public.miembros m where m.empresa_id = e.id))
  from public.empresas e where e.dueno_id = auth.uid();
$$;

-- Lo que se muestra al abrir el link o QR de una invitación (también sin sesión)
create or replace function public.ver_invitacion(p_codigo text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'empresa', e.nombre,
    'estado', case when i.estado = 'pendiente' and i.vence_en < now() then 'vencida' else i.estado end,
    'para_email', case when i.email is null then null
                       else left(i.email, 1) || '•••' || substr(i.email, position('@' in i.email)) end,
    'roles', coalesce((select array_agg(r.nombre order by r.orden) from public.roles_empresa r where r.id = any(i.roles)), '{}')
  )
  from public.invitaciones i join public.empresas e on e.id = i.empresa_id
  where i.codigo = p_codigo;
$$;

-- Invitaciones pendientes para mi email
create or replace function public.mis_invitaciones()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('codigo', i.codigo, 'empresa', e.nombre, 'vence_en', i.vence_en)
                           order by i.creado_en desc), '[]'::json)
  from public.invitaciones i
  join public.empresas e on e.id = i.empresa_id
  where i.estado = 'pendiente' and i.vence_en > now()
    and i.email = (select lower(p.email) from public.perfiles p where p.id = auth.uid())
    and e.dueno_id <> auth.uid()
    and not exists (select 1 from public.miembros m where m.empresa_id = i.empresa_id and m.usuario_id = auth.uid());
$$;

-- Sumarse a una empresa con el código de la invitación
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
  if public.plan_de(emp.dueno_id) <> 'business' then
    raise exception 'La empresa no tiene el plan Business activo.';
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

-- ---------------------------------------------------------------------
-- 5. Seguridad de las tablas nuevas
-- ---------------------------------------------------------------------
alter table public.empresas       enable row level security;
alter table public.roles_empresa  enable row level security;
alter table public.miembros       enable row level security;
alter table public.miembros_roles enable row level security;
alter table public.invitaciones   enable row level security;

drop policy if exists empresas_leer on public.empresas;
create policy empresas_leer on public.empresas for select
  using (dueno_id = (select auth.uid()) or public.es_miembro(id) or public.es_admin());
drop policy if exists empresas_editar on public.empresas;
create policy empresas_editar on public.empresas for update
  using (dueno_id = (select auth.uid()) or public.es_admin())
  with check (dueno_id = (select auth.uid()) or public.es_admin());
drop policy if exists empresas_borrar on public.empresas;
create policy empresas_borrar on public.empresas for delete
  using (dueno_id = (select auth.uid()) or public.es_admin());

drop policy if exists roles_leer on public.roles_empresa;
create policy roles_leer on public.roles_empresa for select
  using (public.es_miembro(empresa_id) or public.gestiona_equipo(empresa_id));
drop policy if exists roles_gestionar on public.roles_empresa;
create policy roles_gestionar on public.roles_empresa for all
  using (public.gestiona_equipo(empresa_id)) with check (public.gestiona_equipo(empresa_id));

drop policy if exists miembros_leer on public.miembros;
create policy miembros_leer on public.miembros for select
  using (usuario_id = (select auth.uid()) or public.gestiona_equipo(empresa_id));
drop policy if exists miembros_editar on public.miembros;
create policy miembros_editar on public.miembros for update
  using (public.gestiona_equipo(empresa_id)) with check (public.gestiona_equipo(empresa_id));
drop policy if exists miembros_borrar on public.miembros;
create policy miembros_borrar on public.miembros for delete
  using (usuario_id = (select auth.uid()) or public.gestiona_equipo(empresa_id));

drop policy if exists miembros_roles_leer on public.miembros_roles;
create policy miembros_roles_leer on public.miembros_roles for select
  using (exists (select 1 from public.miembros m where m.id = miembro_id
                 and (m.usuario_id = (select auth.uid()) or public.gestiona_equipo(m.empresa_id))));
drop policy if exists miembros_roles_gestionar on public.miembros_roles;
create policy miembros_roles_gestionar on public.miembros_roles for all
  using (exists (select 1 from public.miembros m where m.id = miembro_id and public.gestiona_equipo(m.empresa_id)))
  with check (exists (select 1 from public.miembros m where m.id = miembro_id and public.gestiona_equipo(m.empresa_id)));

drop policy if exists invitaciones_gestionar on public.invitaciones;
create policy invitaciones_gestionar on public.invitaciones for all
  using (public.gestiona_equipo(empresa_id)) with check (public.gestiona_equipo(empresa_id));

grant select, update, delete on public.empresas to authenticated;
grant select, insert, update, delete on public.roles_empresa, public.miembros_roles, public.invitaciones to authenticated;
grant select, update, delete on public.miembros to authenticated;
grant all on public.empresas, public.roles_empresa, public.miembros, public.miembros_roles, public.invitaciones to service_role;

-- ---------------------------------------------------------------------
-- 6. El equipo trabaja con los datos de la empresa según sus permisos.
--    Se suman a las reglas que ya había: cada uno sigue viendo lo suyo.
--    leer: con alguno de esos permisos lo ve · editar: lo crea, cambia y borra
-- ---------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select * from (values
    ('clientes',      array['clientes','agenda','relevamientos','presupuestos','tickets_asignar','importes'], array['clientes']),
    ('turnos',        array['agenda','importes'],                          array['agenda']),
    ('bloques_fijos', array['agenda'],                                     array['agenda']),
    ('relevamientos', array['relevamientos','agenda'],                     array['relevamientos']),
    ('ordenes',       array['tickets_asignar','agenda','importes'],        array['tickets_asignar']),
    ('presupuestos',  array['presupuestos','importes'],                    array['presupuestos']),
    ('gastos',        array['gastos','importes'],                          array['gastos']),
    ('ajustes',       array['presupuestos','gastos','importes'],           array[]::text[])
  ) as v(tabla, leer, editar)
  loop
    execute format('drop policy if exists %I on public.%I', t.tabla || '_empresa_leer', t.tabla);
    execute format('create policy %I on public.%I for select using (profesional_id in (select public.cuentas_con(%L::text[])))',
                   t.tabla || '_empresa_leer', t.tabla, t.leer);
    execute format('drop policy if exists %I on public.%I', t.tabla || '_empresa_editar', t.tabla);
    if cardinality(t.editar) > 0 then
      execute format('create policy %I on public.%I for all using (profesional_id in (select public.cuentas_con(%L::text[]))) '
                     'with check (profesional_id in (select public.cuentas_con(%L::text[])))',
                     t.tabla || '_empresa_editar', t.tabla, t.editar, t.editar);
    end if;
  end loop;
end $$;

-- Direcciones (por el cliente) y excepciones de horarios fijos (por el horario)
drop policy if exists direcciones_empresa_leer on public.direcciones;
create policy direcciones_empresa_leer on public.direcciones for select
  using (exists (select 1 from public.clientes c where c.id = direcciones.cliente_id
                 and c.profesional_id in (select public.cuentas_con(array['clientes','agenda','relevamientos','presupuestos','tickets_asignar']))));
drop policy if exists direcciones_empresa_editar on public.direcciones;
create policy direcciones_empresa_editar on public.direcciones for all
  using (exists (select 1 from public.clientes c where c.id = direcciones.cliente_id
                 and c.profesional_id in (select public.cuentas_con(array['clientes']))))
  with check (exists (select 1 from public.clientes c where c.id = direcciones.cliente_id
                      and c.profesional_id in (select public.cuentas_con(array['clientes']))));

drop policy if exists excepciones_empresa on public.bloques_excepciones;
create policy excepciones_empresa on public.bloques_excepciones for all
  using (exists (select 1 from public.bloques_fijos b where b.id = bloques_excepciones.bloque_id
                 and b.profesional_id in (select public.cuentas_con(array['agenda']))))
  with check (exists (select 1 from public.bloques_fijos b where b.id = bloques_excepciones.bloque_id
                      and b.profesional_id in (select public.cuentas_con(array['agenda']))));

-- Fotos de los relevamientos de la empresa
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists relevamientos_fotos_empresa_leer on storage.objects';
    execute $p$create policy relevamientos_fotos_empresa_leer on storage.objects for select to authenticated
      using (bucket_id = 'relevamientos'
             and public.uuid_o_null((storage.foldername(name))[1]) in (select public.cuentas_con(array['relevamientos','agenda'])))$p$;
    execute 'drop policy if exists relevamientos_fotos_empresa_subir on storage.objects';
    execute $p$create policy relevamientos_fotos_empresa_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'relevamientos'
                  and public.uuid_o_null((storage.foldername(name))[1]) in (select public.cuentas_con(array['relevamientos'])))$p$;
    execute 'drop policy if exists relevamientos_fotos_empresa_borrar on storage.objects';
    execute $p$create policy relevamientos_fotos_empresa_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'relevamientos'
             and public.uuid_o_null((storage.foldername(name))[1]) in (select public.cuentas_con(array['relevamientos'])))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Límites del plan según la cuenta dueña de los datos
--    (el equipo de una empresa Business no queda limitado por su plan personal)
-- ---------------------------------------------------------------------
create or replace function public.exigir_pro()
returns trigger language plpgsql set search_path = public as $$
declare dueno uuid;
begin
  if current_user in ('authenticated','anon') then
    dueno := coalesce(public.uuid_o_null(to_jsonb(coalesce(new, old))->>'profesional_id'), auth.uid());
    if public.plan_de(dueno) = 'free' then
      raise exception using errcode = 'TL001', message = tg_argv[0], hint = 'Pasate a Pro desde Perfil > Mi plan.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.limitar_empresas_b2b()
returns trigger language plpgsql set search_path = public as $$
declare lim int; usadas int;
begin
  if current_user not in ('authenticated','anon') or public.plan_de(new.profesional_id) <> 'free' then
    return new;
  end if;
  if exists (select 1 from public.ordenes o
             where o.profesional_id = new.profesional_id and o.empresa_id = new.empresa_id and o.id <> new.id) then
    return new;
  end if;
  select free_empresas_b2b into lim from public.configuracion where id = 1;
  select count(distinct o.empresa_id) into usadas from public.ordenes o
   where o.profesional_id = new.profesional_id and o.id <> new.id;
  if usadas >= lim then
    raise exception using errcode = 'TL002',
      message = format('En el plan Free podés gestionar trabajos de hasta %s clientes B2B.', lim),
      hint = 'Con Pro sumás todas las empresas que quieras.';
  end if;
  return new;
end $$;

-- Planillas: cuentan para la cuenta dueña (en Business no hay límite)
drop function if exists public.registrar_exportacion(text, text);
create or replace function public.registrar_exportacion(p_tipo text default 'planilla', p_detalle text default null, p_cuenta uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cuenta uuid := coalesce(p_cuenta, auth.uid());
  pl text;
  lim int;
  usadas int;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if cuenta <> uid and not public.puede(cuenta, array['tickets_asignar','importes']) then
    raise exception 'No tenés permiso para exportar planillas de esta empresa';
  end if;
  pl := public.plan_de(cuenta);
  select free_exportaciones_mes into lim from public.configuracion where id = 1;
  select count(*) into usadas from public.exportaciones e where e.usuario_id = cuenta and e.creado_en >= public.inicio_mes_uy();
  if pl = 'free' and usadas >= lim then
    raise exception using errcode = 'TL002',
      message = format('Llegaste al límite de %s planillas por mes del plan Free.', lim),
      hint = 'Con Pro exportás sin límite.';
  end if;
  insert into public.exportaciones (usuario_id, tipo, detalle) values (cuenta, coalesce(p_tipo, 'planilla'), left(p_detalle, 200));
  return json_build_object('usadas', usadas + 1, 'limite', case when pl = 'free' then lim end);
end $$;

-- ---------------------------------------------------------------------
-- 8. Permisos de ejecución
-- ---------------------------------------------------------------------
grant execute on function public.permisos_validos()                         to authenticated, service_role;
grant execute on function public.uuid_o_null(text)                           to authenticated, service_role;
grant execute on function public.es_miembro(uuid)                            to authenticated, service_role;
grant execute on function public.gestiona_equipo(uuid)                       to authenticated, service_role;
grant execute on function public.cuentas_con(text[])                         to authenticated, service_role;
grant execute on function public.puede(uuid, text[])                         to authenticated, service_role;
grant execute on function public.cupo_empresa(uuid)                          to authenticated, service_role;
grant execute on function public.crear_mi_empresa(text)                      to authenticated, service_role;
grant execute on function public.info_empresa(uuid)                          to authenticated, service_role;
grant execute on function public.equipo_empresa(uuid)                        to authenticated, service_role;
grant execute on function public.mis_empresas()                              to authenticated, service_role;
grant execute on function public.mi_empresa()                                to authenticated, service_role;
grant execute on function public.ver_invitacion(text)                        to anon, authenticated, service_role;
grant execute on function public.mis_invitaciones()                          to authenticated, service_role;
grant execute on function public.aceptar_invitacion(text)                    to authenticated, service_role;
grant execute on function public.registrar_exportacion(text, text, uuid)     to authenticated, service_role;
grant execute on function public.exigir_pro()                                to authenticated, service_role;
grant execute on function public.limitar_empresas_b2b()                      to authenticated, service_role;
grant execute on function public.controlar_cupo()                            to authenticated, service_role;
grant execute on function public.proteger_miembro()                          to authenticated, service_role;
grant execute on function public.validar_miembro_rol()                       to authenticated, service_role;
grant execute on function public.preparar_invitacion()                       to authenticated, service_role;
revoke execute on function public.registrar_exportacion(text, text, uuid) from anon;

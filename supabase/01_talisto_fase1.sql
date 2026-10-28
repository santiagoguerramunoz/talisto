-- =====================================================================
--  TaListo!  ·  FASE 1  ·  Agenda del profesional
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  Es re-ejecutable: si lo corrés dos veces no rompe nada.
-- =====================================================================

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN GLOBAL (la edita solo el admin)
--    Visita técnica UYU 1.500 · comisión TaListo! UYU 200
-- ---------------------------------------------------------------------
create table if not exists public.configuracion (
  id                  smallint primary key default 1 check (id = 1),
  precio_visita       numeric(12,2) not null default 1500 check (precio_visita >= 0),
  comision_visita     numeric(12,2) not null default 200  check (comision_visita >= 0),
  moneda              text not null default 'UYU',
  duracion_visita_min int  not null default 60 check (duracion_visita_min between 15 and 480),
  actualizado_en      timestamptz not null default now(),
  actualizado_por     uuid,
  constraint comision_menor_o_igual_al_precio check (comision_visita <= precio_visita)
);
insert into public.configuracion (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 2. PERFILES (uno por usuario de Supabase Auth)
-- ---------------------------------------------------------------------
create table if not exists public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  rol        text not null default 'cliente' check (rol in ('cliente','profesional')),
  es_admin   boolean not null default false,
  nombre     text not null default '',
  email      text,
  telefono   text,
  creado_en  timestamptz not null default now()
);

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.es_admin from public.perfiles p where p.id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------------
-- 3. PROFESIONALES (datos públicos del perfil profesional)
-- ---------------------------------------------------------------------
create table if not exists public.profesionales (
  id              uuid primary key references public.perfiles(id) on delete cascade,
  nombre_publico  text not null default '',
  slug            text unique,
  bio             text,
  whatsapp        text,
  departamentos   text[] not null default '{}',
  barrios         text[] not null default '{}',
  radio_km        int check (radio_km is null or radio_km between 1 and 500),
  verificado      boolean not null default false,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);

create or replace function public.slugify(t text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
           lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
           '[^a-z0-9]+', '-', 'g'));
$$;

-- ---------------------------------------------------------------------
-- 4. CATEGORÍAS DE SERVICIO (con sinónimos para el buscador)
-- ---------------------------------------------------------------------
create table if not exists public.categorias (
  id         smallserial primary key,
  nombre     text not null unique,
  slug       text not null unique,
  sinonimos  text[] not null default '{}',
  orden      smallint not null default 0,
  activa     boolean not null default true
);

insert into public.categorias (nombre, slug, sinonimos, orden) values
  ('Electricidad',              'electricidad',        '{electricista,luz,instalacion electrica,tablero,enchufe}', 1),
  ('Sanitaria',                 'sanitaria',           '{sanitario,plomero,fontanero,caneria,perdida de agua,calefon,destapacion}', 2),
  ('Jardinería',                'jardineria',          '{jardinero,pasto,cesped,poda,paisajismo,desmalezado}', 3),
  ('Portones automáticos',      'portones-automaticos','{porton,motor de porton,automatizacion}', 4),
  ('Seguridad electrónica',     'seguridad-electronica','{alarma,camaras,cctv,videovigilancia,cerco electrico}', 5),
  ('Limpieza',                  'limpieza',            '{limpiadora,limpieza de casas,vidrios,limpieza de oficinas}', 6),
  ('Decoración',                'decoracion',          '{decorador,interiorismo,cortinas}', 7),
  ('Albañilería',               'albanileria',         '{albanil,construccion,reformas,revoque,ceramica}', 8),
  ('Pintura',                   'pintura',             '{pintor,pintura de casas,empapelado}', 9),
  ('Aire acondicionado',        'aire-acondicionado',  '{aire,climatizacion,split,refrigeracion,service de aire}', 10),
  ('Carpintería',               'carpinteria',         '{carpintero,muebles,placares,aberturas}', 11),
  ('Herrería',                  'herreria',            '{herrero,rejas,soldadura,portones}', 12),
  ('Cerrajería',                'cerrajeria',          '{cerrajero,llaves,cerradura,apertura de puertas}', 13),
  ('Fletes y mudanzas',         'fletes-mudanzas',     '{flete,mudanza,traslado}', 14),
  ('Electrodomésticos',         'electrodomesticos',   '{lavarropas,heladera,cocina,service,tecnico}', 15),
  ('Impermeabilización',        'impermeabilizacion',  '{goteras,techos,membrana,humedad}', 16)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
-- 5. SERVICIOS Y TARIFAS DEL PROFESIONAL
-- ---------------------------------------------------------------------
create table if not exists public.servicios (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  categoria_id    smallint references public.categorias(id),
  titulo          text not null,
  descripcion     text,
  tipo_tarifa     text not null default 'a_convenir'
                  check (tipo_tarifa in ('hora','visita','trabajo','m2','a_convenir')),
  precio          numeric(12,2) check (precio is null or precio >= 0),
  moneda          text not null default 'UYU' check (moneda in ('UYU','USD')),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create index if not exists servicios_profesional_idx on public.servicios (profesional_id);
create index if not exists servicios_categoria_idx   on public.servicios (categoria_id);

-- ---------------------------------------------------------------------
-- 6. HORARIO DE TRABAJO SEMANAL  (dia: 0 = domingo … 6 = sábado)
-- ---------------------------------------------------------------------
create table if not exists public.horarios_trabajo (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  dia             smallint not null check (dia between 0 and 6),
  hora_inicio     time not null,
  hora_fin        time not null,
  check (hora_fin > hora_inicio)
);
create index if not exists horarios_profesional_idx on public.horarios_trabajo (profesional_id, dia);

-- ---------------------------------------------------------------------
-- 7. CLIENTES DEL PROFESIONAL + SUS DIRECCIONES
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  nombre          text not null,
  telefono        text,
  email           text,
  notas           text,
  color           text not null default '#2dd4bf',
  usuario_id      uuid references public.perfiles(id) on delete set null,  -- Fase 2: cliente con cuenta en la app
  creado_en       timestamptz not null default now()
);
create index if not exists clientes_profesional_idx on public.clientes (profesional_id);

create table if not exists public.direcciones (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  etiqueta    text not null default 'Principal',
  direccion   text not null,
  referencia  text,
  lat         double precision,
  lng         double precision,
  creado_en   timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index if not exists direcciones_cliente_idx on public.direcciones (cliente_id);

-- ---------------------------------------------------------------------
-- 8. HORARIOS FIJOS (lo que se repite: "Grupo Gamma lun-mar-mié 9 a 17")
-- ---------------------------------------------------------------------
create table if not exists public.bloques_fijos (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  cliente_id      uuid references public.clientes(id) on delete cascade,
  direccion_id    uuid references public.direcciones(id) on delete set null,
  titulo          text,
  dias            smallint[] not null
                  check (cardinality(dias) between 1 and 7 and dias <@ array[0,1,2,3,4,5,6]::smallint[]),
  hora_inicio     time not null,
  hora_fin        time not null,
  fecha_desde     date not null default current_date,
  fecha_hasta     date,
  monto           numeric(12,2) check (monto is null or monto >= 0),
  notas           text,
  creado_en       timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  check (fecha_hasta is null or fecha_hasta >= fecha_desde)
);
create index if not exists bloques_profesional_idx on public.bloques_fijos (profesional_id);

-- Días puntuales en que un horario fijo NO se hace (feriado, el cliente avisó, etc.)
create table if not exists public.bloques_excepciones (
  bloque_id  uuid not null references public.bloques_fijos(id) on delete cascade,
  fecha      date not null,
  primary key (bloque_id, fecha)
);

-- ---------------------------------------------------------------------
-- 9. TURNOS (agenda puntual)
-- ---------------------------------------------------------------------
create table if not exists public.turnos (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  cliente_id      uuid references public.clientes(id) on delete set null,
  direccion_id    uuid references public.direcciones(id) on delete set null,
  titulo          text,
  inicio          timestamptz not null,
  fin             timestamptz not null,
  tipo            text not null default 'trabajo' check (tipo in ('trabajo','visita')),
  estado          text not null default 'confirmado'
                  check (estado in ('pendiente','confirmado','realizado','cancelado')),
  origen          text not null default 'manual' check (origen in ('manual','reserva')),
  monto_acordado  numeric(12,2) check (monto_acordado is null or monto_acordado >= 0),
  precio_visita   numeric(12,2),   -- foto del precio de visita al momento de reservar
  comision        numeric(12,2),   -- foto de la comisión al momento de reservar
  notas           text,
  creado_en       timestamptz not null default now(),
  check (fin > inicio),
  -- Nunca dos turnos activos del mismo profesional superpuestos
  constraint turnos_sin_superposicion exclude using gist (
    profesional_id with =,
    tstzrange(inicio, fin, '[)') with &&
  ) where (estado in ('pendiente','confirmado'))
);
create index if not exists turnos_profesional_inicio_idx on public.turnos (profesional_id, inicio);

-- =====================================================================
-- TRIGGERS
-- =====================================================================

-- Al registrarse: crea el perfil (y el perfil profesional si eligió "Soy profesional")
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rol    text := coalesce(new.raw_user_meta_data->>'rol', 'cliente');
  v_nombre text := coalesce(new.raw_user_meta_data->>'nombre', '');
begin
  if v_rol not in ('cliente','profesional') then v_rol := 'cliente'; end if;
  insert into public.perfiles (id, rol, nombre, email, telefono)
  values (new.id, v_rol, v_nombre, new.email, new.raw_user_meta_data->>'telefono')
  on conflict (id) do nothing;
  if v_rol = 'profesional' then
    insert into public.profesionales (id, nombre_publico) values (new.id, v_nombre)
    on conflict (id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists talisto_al_crear_usuario on auth.users;
create trigger talisto_al_crear_usuario
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();

-- Un usuario común no puede darse admin ni cambiarse el rol desde la app
create or replace function public.proteger_perfil()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') and not public.es_admin() then
    new.es_admin := old.es_admin;
    new.rol      := old.rol;
    new.email    := old.email;
  end if;
  return new;
end $$;

drop trigger if exists talisto_proteger_perfil on public.perfiles;
create trigger talisto_proteger_perfil
  before update on public.perfiles
  for each row execute function public.proteger_perfil();

-- "verificado" y "activo" solo los cambia el admin; genera el slug para la página pública
create or replace function public.proteger_profesional()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated','anon') and not public.es_admin() then
    if tg_op = 'INSERT' then
      new.verificado := false;
      new.activo     := true;
    else
      new.verificado := old.verificado;
      new.activo     := old.activo;
    end if;
  end if;
  if new.slug is null or new.slug = '' then
    new.slug := coalesce(nullif(public.slugify(new.nombre_publico), ''), 'profesional')
                || '-' || left(replace(new.id::text, '-', ''), 5);
  end if;
  return new;
end $$;

drop trigger if exists talisto_proteger_profesional on public.profesionales;
create trigger talisto_proteger_profesional
  before insert or update on public.profesionales
  for each row execute function public.proteger_profesional();

-- El cliente y la dirección de un turno / horario fijo tienen que ser del mismo profesional
create or replace function public.validar_cliente_direccion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null
     and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id)
     and not exists (select 1 from public.clientes c
                     where c.id = new.cliente_id and c.profesional_id = new.profesional_id) then
    raise exception 'El cliente no pertenece a este profesional';
  end if;
  if new.direccion_id is not null
     and (tg_op = 'INSERT' or new.direccion_id is distinct from old.direccion_id)
     and not exists (select 1 from public.direcciones d
                     where d.id = new.direccion_id and d.cliente_id = new.cliente_id) then
    raise exception 'La dirección no corresponde a ese cliente';
  end if;
  return new;
end $$;

drop trigger if exists talisto_validar_turno on public.turnos;
create trigger talisto_validar_turno
  before insert or update on public.turnos
  for each row execute function public.validar_cliente_direccion();

drop trigger if exists talisto_validar_bloque on public.bloques_fijos;
create trigger talisto_validar_bloque
  before insert or update on public.bloques_fijos
  for each row execute function public.validar_cliente_direccion();

-- Visitas técnicas: guarda precio y comisión vigentes al momento de crearse.
-- Si el admin cambia los valores después, las visitas ya agendadas no cambian.
create or replace function public.turno_foto_visita()
returns trigger language plpgsql security definer set search_path = public as $$
declare c public.configuracion;
begin
  if new.tipo = 'visita' then
    if tg_op = 'INSERT' or old.tipo is distinct from 'visita' then
      select * into c from public.configuracion where id = 1;
      new.precio_visita := c.precio_visita;
      new.comision      := c.comision_visita;
      if new.monto_acordado is null then new.monto_acordado := c.precio_visita; end if;
    else
      new.precio_visita := old.precio_visita;
      new.comision      := old.comision;
    end if;
  else
    new.precio_visita := null;
    new.comision      := null;
  end if;
  return new;
end $$;

drop trigger if exists talisto_foto_visita on public.turnos;
create trigger talisto_foto_visita
  before insert or update on public.turnos
  for each row execute function public.turno_foto_visita();

-- Registro de quién y cuándo cambió la configuración
create or replace function public.marcar_configuracion()
returns trigger language plpgsql as $$
begin
  new.id := 1;
  new.actualizado_en  := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;

drop trigger if exists talisto_marcar_configuracion on public.configuracion;
create trigger talisto_marcar_configuracion
  before update on public.configuracion
  for each row execute function public.marcar_configuracion();

-- =====================================================================
-- FUNCIONES (RPC)
-- =====================================================================

-- Un cliente que quiere empezar a ofrecer servicios
create or replace function public.convertirme_en_profesional()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  update public.perfiles set rol = 'profesional' where id = auth.uid();
  insert into public.profesionales (id, nombre_publico)
  select p.id, p.nombre from public.perfiles p where p.id = auth.uid()
  on conflict (id) do nothing;
end $$;

-- Horarios libres de un profesional en una fecha (la usa la Fase 2 para reservar).
-- Descuenta turnos activos y horarios fijos. Devuelve solo horas: nunca nombres de clientes.
create or replace function public.horarios_disponibles(
  p_profesional  uuid,
  p_fecha        date,
  p_duracion_min int default null
)
returns table (desde timestamptz, hasta timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  v_tz  constant text := 'America/Montevideo';
  v_dur interval;
  v_dow int := extract(dow from p_fecha)::int;
begin
  if not exists (select 1 from public.profesionales pr where pr.id = p_profesional and pr.activo) then
    return;
  end if;

  select make_interval(mins => coalesce(p_duracion_min, cf.duracion_visita_min))
    into v_dur from public.configuracion cf where cf.id = 1;

  return query
  with franjas as (
    select (p_fecha + h.hora_inicio) at time zone v_tz as f_ini,
           (p_fecha + h.hora_fin)    at time zone v_tz as f_fin
    from public.horarios_trabajo h
    where h.profesional_id = p_profesional and h.dia = v_dow
  ),
  candidatos as (
    select g as c_ini, g + v_dur as c_fin
    from franjas f,
         generate_series(f.f_ini, f.f_fin - v_dur, interval '30 minutes') as g
  )
  select distinct c.c_ini, c.c_fin
  from candidatos c
  where c.c_ini > now()
    and not exists (
      select 1 from public.turnos t
      where t.profesional_id = p_profesional
        and t.estado in ('pendiente','confirmado')
        and tstzrange(t.inicio, t.fin, '[)') && tstzrange(c.c_ini, c.c_fin, '[)'))
    and not exists (
      select 1 from public.bloques_fijos b
      where b.profesional_id = p_profesional
        and v_dow = any (b.dias)
        and p_fecha >= b.fecha_desde
        and (b.fecha_hasta is null or p_fecha <= b.fecha_hasta)
        and not exists (select 1 from public.bloques_excepciones e
                        where e.bloque_id = b.id and e.fecha = p_fecha)
        and tstzrange((p_fecha + b.hora_inicio) at time zone v_tz,
                      (p_fecha + b.hora_fin)    at time zone v_tz, '[)')
            && tstzrange(c.c_ini, c.c_fin, '[)'))
  order by c.c_ini;
end $$;

-- =====================================================================
-- PERMISOS DE ACCESO A LAS TABLAS
-- Los proyectos nuevos de Supabase ya no exponen las tablas a la app
-- automáticamente: hay que darlos explícitamente. Qué filas ve cada uno
-- lo deciden las políticas RLS de más abajo.
-- =====================================================================
grant usage on schema public to anon, authenticated, service_role;

-- Visitantes sin sesión: solo lo público (perfil profesional, servicios, horarios, categorías)
grant select on public.configuracion, public.profesionales, public.categorias,
                public.servicios, public.horarios_trabajo
  to anon;

-- Usuarios con sesión
grant select, insert, update, delete on
  public.configuracion, public.perfiles, public.profesionales, public.categorias,
  public.servicios, public.horarios_trabajo, public.clientes, public.direcciones,
  public.bloques_fijos, public.bloques_excepciones, public.turnos
  to authenticated, service_role;

grant usage, select on sequence public.categorias_id_seq to authenticated, service_role;

grant execute on function public.es_admin()                                to anon, authenticated, service_role;
grant execute on function public.slugify(text)                             to anon, authenticated, service_role;
grant execute on function public.horarios_disponibles(uuid, date, int)    to anon, authenticated, service_role;
grant execute on function public.convertirme_en_profesional()              to authenticated, service_role;

-- Si activaste "Enable automatic RLS" al crear el proyecto, Supabase crea la función
-- rls_auto_enable(). Se le quita el acceso desde la app (el aviso del Security Advisor).
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- =====================================================================
-- SEGURIDAD (Row Level Security)
-- =====================================================================
alter table public.configuracion       enable row level security;
alter table public.perfiles            enable row level security;
alter table public.profesionales       enable row level security;
alter table public.categorias          enable row level security;
alter table public.servicios           enable row level security;
alter table public.horarios_trabajo    enable row level security;
alter table public.clientes            enable row level security;
alter table public.direcciones         enable row level security;
alter table public.bloques_fijos       enable row level security;
alter table public.bloques_excepciones enable row level security;
alter table public.turnos              enable row level security;

-- Configuración: todos la leen, solo el admin la cambia
drop policy if exists configuracion_leer on public.configuracion;
create policy configuracion_leer on public.configuracion for select using (true);
drop policy if exists configuracion_admin on public.configuracion;
create policy configuracion_admin on public.configuracion for update
  using (public.es_admin()) with check (public.es_admin());

-- Perfiles: cada uno el suyo; el admin todos
drop policy if exists perfiles_leer on public.perfiles;
create policy perfiles_leer on public.perfiles for select
  using (id = (select auth.uid()) or public.es_admin());
drop policy if exists perfiles_editar on public.perfiles;
create policy perfiles_editar on public.perfiles for update
  using (id = (select auth.uid()) or public.es_admin())
  with check (id = (select auth.uid()) or public.es_admin());

-- Profesionales: perfil público visible para todos (si está activo)
drop policy if exists profesionales_leer on public.profesionales;
create policy profesionales_leer on public.profesionales for select
  using (activo or id = (select auth.uid()) or public.es_admin());
drop policy if exists profesionales_crear on public.profesionales;
create policy profesionales_crear on public.profesionales for insert
  with check (id = (select auth.uid()));
drop policy if exists profesionales_editar on public.profesionales;
create policy profesionales_editar on public.profesionales for update
  using (id = (select auth.uid()) or public.es_admin())
  with check (id = (select auth.uid()) or public.es_admin());

-- Categorías: lectura pública, edición admin
drop policy if exists categorias_leer on public.categorias;
create policy categorias_leer on public.categorias for select using (true);
drop policy if exists categorias_admin on public.categorias;
create policy categorias_admin on public.categorias for all
  using (public.es_admin()) with check (public.es_admin());

-- Servicios: lectura pública, cada profesional edita los suyos
drop policy if exists servicios_leer on public.servicios;
create policy servicios_leer on public.servicios for select
  using (activo or profesional_id = (select auth.uid()) or public.es_admin());
drop policy if exists servicios_propios on public.servicios;
create policy servicios_propios on public.servicios for all
  using (profesional_id = (select auth.uid()))
  with check (profesional_id = (select auth.uid()));

-- Horario de trabajo: lectura pública, edición propia
drop policy if exists horarios_leer on public.horarios_trabajo;
create policy horarios_leer on public.horarios_trabajo for select using (true);
drop policy if exists horarios_propios on public.horarios_trabajo;
create policy horarios_propios on public.horarios_trabajo for all
  using (profesional_id = (select auth.uid()))
  with check (profesional_id = (select auth.uid()));

-- Clientes, direcciones, horarios fijos y turnos: privados del profesional
drop policy if exists clientes_propios on public.clientes;
create policy clientes_propios on public.clientes for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));

drop policy if exists direcciones_propias on public.direcciones;
create policy direcciones_propias on public.direcciones for all
  using (exists (select 1 from public.clientes c
                 where c.id = direcciones.cliente_id
                   and (c.profesional_id = (select auth.uid()) or public.es_admin())))
  with check (exists (select 1 from public.clientes c
                      where c.id = direcciones.cliente_id
                        and c.profesional_id = (select auth.uid())));

drop policy if exists bloques_propios on public.bloques_fijos;
create policy bloques_propios on public.bloques_fijos for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));

drop policy if exists excepciones_propias on public.bloques_excepciones;
create policy excepciones_propias on public.bloques_excepciones for all
  using (exists (select 1 from public.bloques_fijos b
                 where b.id = bloques_excepciones.bloque_id
                   and (b.profesional_id = (select auth.uid()) or public.es_admin())))
  with check (exists (select 1 from public.bloques_fijos b
                      where b.id = bloques_excepciones.bloque_id
                        and b.profesional_id = (select auth.uid())));

drop policy if exists turnos_propios on public.turnos;
create policy turnos_propios on public.turnos for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));


-- =====================================================================
-- LISTO. Para hacerte admin, después de registrarte en la app corré:
--   update public.perfiles set es_admin = true where email = 'TU_EMAIL';
-- =====================================================================

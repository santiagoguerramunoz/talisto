-- =====================================================================
--  TaListo!  ·  TaListo! Match (etapa 1): solicitudes, visitas técnicas,
--  pagos con Mercado Pago, liquidaciones, devoluciones y reclamos.
--
--  Reutiliza lo que ya existe: configuración global (precio de la visita),
--  rubros (categorias), perfil y zonas del profesional, horario semanal y
--  turnos (la visita queda en la agenda), clientes, avisos y Mercado Pago.
--
--  Reglas de plata (confirmadas):
--  · TaListo! cobra en su cuenta de Mercado Pago, retiene hasta que se
--    confirma la visita y liquida al profesional (transferencia registrada).
--  · El costo de Mercado Pago se reparte: % configurable al profesional
--    (50 % al empezar) y el resto TaListo!.
--  · Las devoluciones las aprueba el admin y se hacen por Mercado Pago.
--  · Ningún pago se marca como pagado sin la confirmación real de
--    Mercado Pago (solo el servidor puede aplicarlo).
--  · Cada operación guarda sus importes al crearse: cambiar la
--    configuración nunca toca operaciones ya hechas.
--
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 18). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regprocedure('public._avisar(uuid[], uuid, text, text, text, text, jsonb)') is null then
    raise exception 'Primero corré 11_operacion.sql';
  end if;
  if to_regprocedure('public.normalizar(text)') is null then
    raise exception 'Primero corré 09_proveedores.sql';
  end if;
  if to_regprocedure('public.permisos_validos()') is null then
    raise exception 'Primero corré 13_ruta_tickets.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Permiso "Match" para las empresas (recibir y responder solicitudes)
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo','compras','stock','comisiones','seguimiento','match']::text[];
$$;

-- ---------------------------------------------------------------------
-- 2. Configuración comercial (la edita solo el admin) e historial
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists visita_ret_cliente        numeric(12,2) not null default 200;
alter table public.configuracion add column if not exists visita_ret_profesional    numeric(12,2) not null default 200;
alter table public.configuracion add column if not exists visita_neto_profesional   numeric(12,2) not null default 1100;
alter table public.configuracion add column if not exists trabajo_comision_pct      numeric(5,2)  not null default 5;
alter table public.configuracion add column if not exists trabajo_comision_activa   boolean       not null default true;
alter table public.configuracion add column if not exists comision_por_rubro        boolean       not null default false;
alter table public.configuracion add column if not exists mp_costo_profesional_pct  numeric(5,2)  not null default 50;
alter table public.configuracion add column if not exists acreditar_visita          boolean       not null default false;
alter table public.configuracion add column if not exists confirmacion_auto_horas   int           not null default 72;
alter table public.configuracion add column if not exists liquidacion_dias          int           not null default 7;
alter table public.configuracion add column if not exists cancelacion_horas         int           not null default 24;
alter table public.configuracion add column if not exists cancelacion_tarde_pct     numeric(5,2)  not null default 0;
alter table public.configuracion add column if not exists penalizacion_profesional  numeric(12,2) not null default 0;
alter table public.configuracion add column if not exists devolucion_dias           int           not null default 10;
alter table public.configuracion add column if not exists pago_minutos              int           not null default 30;
alter table public.configuracion add column if not exists solicitud_dias            int           not null default 7;
alter table public.configuracion add column if not exists max_invitados             int           not null default 10;
alter table public.configuracion add column if not exists solo_verificados          boolean       not null default false;
alter table public.configuracion add column if not exists garantia_dias             int           not null default 90;
alter table public.configuracion add column if not exists garantia_cobertura        text not null default 'Defectos de mano de obra en el trabajo contratado y pagado dentro de TaListo!, según el presupuesto aceptado.';
alter table public.configuracion add column if not exists garantia_exclusiones      text not null default 'Mal uso, daños de terceros, materiales provistos por el cliente, desgaste normal y trabajos no incluidos en el presupuesto.';
alter table public.configuracion add column if not exists reclamo_procedimiento     text not null default 'El cliente abre el reclamo desde TaListo! con fotos y la descripción del problema. El profesional tiene 72 horas para responder y TaListo! media hasta resolverlo.';

alter table public.configuracion drop constraint if exists configuracion_match_check;
alter table public.configuracion add constraint configuracion_match_check check (
  visita_ret_cliente >= 0 and visita_ret_profesional >= 0 and visita_neto_profesional >= 0
  and precio_visita = visita_ret_cliente + visita_ret_profesional + visita_neto_profesional
  and trabajo_comision_pct between 0 and 50 and mp_costo_profesional_pct between 0 and 100
  and confirmacion_auto_horas between 1 and 720 and liquidacion_dias between 0 and 90
  and cancelacion_horas between 0 and 720 and cancelacion_tarde_pct between 0 and 100
  and penalizacion_profesional >= 0 and devolucion_dias between 0 and 90 and pago_minutos between 5 and 1440
  and solicitud_dias between 1 and 60 and max_invitados between 1 and 50 and garantia_dias between 0 and 3650
) not valid;
-- Los valores que ya estaban (precio 1.500, comisión 200) quedan con el reparto nuevo
update public.configuracion
   set visita_ret_cliente = least(200, precio_visita),
       visita_ret_profesional = least(200, precio_visita - least(200, precio_visita)),
       visita_neto_profesional = precio_visita - least(200, precio_visita) - least(200, precio_visita - least(200, precio_visita))
 where id = 1 and precio_visita <> visita_ret_cliente + visita_ret_profesional + visita_neto_profesional;
update public.configuracion set comision_visita = visita_ret_cliente + visita_ret_profesional
 where id = 1 and comision_visita <> visita_ret_cliente + visita_ret_profesional;
alter table public.configuracion validate constraint configuracion_match_check;

-- Cada cambio queda con quién, cuándo, el valor anterior y el nuevo
create table if not exists public.config_historial (
  id              bigint generated always as identity primary key,
  ambito          text not null check (ambito in ('configuracion', 'comision', 'rubro')),
  referencia      text,
  campo           text not null,
  valor_anterior  text,
  valor_nuevo     text,
  admin_id        uuid,
  admin_nombre    text,
  creado_en       timestamptz not null default now()
);
create index if not exists config_historial_fecha_idx on public.config_historial (creado_en desc);

create or replace function public.historial_configuracion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.config_historial (ambito, referencia, campo, valor_anterior, valor_nuevo, admin_id, admin_nombre)
  select 'configuracion', null, n.key, o.value #>> '{}', n.value #>> '{}', auth.uid(),
         (select coalesce(nullif(nombre, ''), email) from public.perfiles where id = auth.uid())
    from jsonb_each(to_jsonb(new)) n
    join jsonb_each(to_jsonb(old)) o on o.key = n.key
   where n.value is distinct from o.value and n.key not in ('actualizado_en', 'actualizado_por');
  return new;
end $$;
drop trigger if exists talisto_historial_configuracion on public.configuracion;
create trigger talisto_historial_configuracion after update on public.configuracion
  for each row execute function public.historial_configuracion();

-- Comisiones especiales: por rubro (si se habilita) o por profesional / empresa
create table if not exists public.match_comisiones (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('rubro', 'cuenta')),
  categoria_id    smallint references public.categorias(id) on delete cascade,
  profesional_id  uuid references public.profesionales(id) on delete cascade,
  pct             numeric(5,2) not null check (pct between 0 and 50),
  activa          boolean not null default true,
  notas           text check (notas is null or length(notas) <= 300),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  check ((tipo = 'rubro' and categoria_id is not null and profesional_id is null)
      or (tipo = 'cuenta' and profesional_id is not null and categoria_id is null))
);
create unique index if not exists match_comisiones_rubro_uk on public.match_comisiones (categoria_id) where tipo = 'rubro';
create unique index if not exists match_comisiones_cuenta_uk on public.match_comisiones (profesional_id) where tipo = 'cuenta';

-- ---------------------------------------------------------------------
-- 3. Rubros (los que ya estaban siguen; se suman los de Match)
-- ---------------------------------------------------------------------
alter table public.categorias add column if not exists icono text;
alter table public.categorias add column if not exists descripcion text;
update public.categorias set nombre = 'Aire acondicionado y climatización' where slug = 'aire-acondicionado' and nombre = 'Aire acondicionado';
update public.categorias set nombre = 'Sanitaria y fontanería' where slug = 'sanitaria' and nombre = 'Sanitaria';
insert into public.categorias (nombre, slug, sinonimos, orden) values
  ('Alarmas',                         'alarmas',                 '{alarma,sensores,monitoreo,cerco electrico,central de alarma}', 5),
  ('Cámaras de seguridad y CCTV',     'camaras-cctv',            '{camaras,cctv,videovigilancia,dvr,nvr,camara ip}', 6),
  ('Vidriería',                       'vidrieria',               '{vidrio,vidriero,cristales,espejos,mamparas}', 12),
  ('Techistas',                       'techistas',               '{techo,techista,chapa,tejas,goteras,canalones}', 13),
  ('Mantenimiento de piscinas',       'piscinas',                '{piscina,pileta,bomba de piscina,limpieza de piscina}', 15),
  ('Refrigeración',                   'refrigeracion',           '{camara de frio,heladera comercial,freezer,refrigeracion comercial}', 16),
  ('Reparaciones generales',          'reparaciones-generales',  '{arreglos,mantenimiento,service,handyman,multiservicio}', 18),
  ('Mantenimiento comercial',         'mantenimiento-comercial', '{locales,oficinas,comercios,mantenimiento preventivo}', 19),
  ('Servicios industriales',          'servicios-industriales',  '{industria,planta,montaje industrial,mantenimiento industrial}', 20)
on conflict (slug) do nothing;
-- Orden del pedido para los nuevos y los equivalentes; el resto queda después
update public.categorias c set orden = x.o from (values
  ('aire-acondicionado', 1), ('electricidad', 2), ('sanitaria', 3), ('cerrajeria', 4), ('alarmas', 5), ('camaras-cctv', 6),
  ('albanileria', 7), ('herreria', 8), ('carpinteria', 9), ('pintura', 10), ('vidrieria', 11), ('techistas', 12),
  ('jardineria', 13), ('piscinas', 14), ('refrigeracion', 15), ('limpieza', 16), ('reparaciones-generales', 17),
  ('mantenimiento-comercial', 18), ('servicios-industriales', 19)) as x(s, o)
 where c.slug = x.s and not exists (select 1 from public.config_historial h where h.ambito = 'rubro' and h.campo = 'orden');
update public.categorias set orden = 20 + orden where slug not in ('aire-acondicionado','electricidad','sanitaria','cerrajeria','alarmas','camaras-cctv',
  'albanileria','herreria','carpinteria','pintura','vidrieria','techistas','jardineria','piscinas','refrigeracion','limpieza',
  'reparaciones-generales','mantenimiento-comercial','servicios-industriales') and orden < 20
  and not exists (select 1 from public.config_historial h where h.ambito = 'rubro' and h.campo = 'orden');

-- ---------------------------------------------------------------------
-- 4. Perfil Match del profesional (rubros; las zonas son las del perfil)
-- ---------------------------------------------------------------------
create table if not exists public.match_perfiles (
  profesional_id  uuid primary key references public.profesionales(id) on delete cascade,
  disponible      boolean not null default false,
  rubros          smallint[] not null default '{}',
  urgencias       boolean not null default false,
  actualizado_en  timestamptz not null default now()
);
create index if not exists match_perfiles_rubros_idx on public.match_perfiles using gin (rubros) where disponible;

-- A dónde se le transfiere (solo lo ven la cuenta y el admin)
create table if not exists public.match_datos_cobro (
  profesional_id  uuid primary key references public.profesionales(id) on delete cascade,
  banco           text not null check (length(banco) between 2 and 60),
  tipo_cuenta     text not null default 'caja_ahorro' check (tipo_cuenta in ('caja_ahorro', 'cuenta_corriente', 'otra')),
  numero          text not null check (length(numero) between 3 and 40),
  sucursal        text check (sucursal is null or length(sucursal) <= 40),
  titular         text not null check (length(titular) between 2 and 120),
  documento       text check (documento is null or length(documento) <= 20),
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 5. Solicitudes y profesionales invitados
-- ---------------------------------------------------------------------
create table if not exists public.match_solicitudes (
  id                 uuid primary key default gen_random_uuid(),
  numero             bigint generated always as identity,
  cliente_id         uuid not null references public.perfiles(id) on delete cascade,
  categoria_id       smallint not null references public.categorias(id),
  titulo             text not null check (length(trim(titulo)) between 3 and 120),
  descripcion        text not null check (length(trim(descripcion)) between 10 and 2000),
  departamento       text not null,
  localidad          text check (localidad is null or length(localidad) <= 80),
  direccion          text check (direccion is null or length(direccion) <= 200),
  referencia         text check (referencia is null or length(referencia) <= 200),
  lat                double precision,
  lng                double precision,
  preferencia        text not null default 'cualquiera' check (preferencia in ('manana', 'tarde', 'cualquiera')),
  urgente            boolean not null default false,
  archivos           text[] not null default '{}' check (cardinality(archivos) <= 8),
  dirigida_a         uuid references public.profesionales(id) on delete set null,
  estado             text not null default 'abierta'
                     check (estado in ('abierta', 'reservada', 'en_curso', 'finalizada', 'externa', 'cancelada', 'vencida')),
  modalidad          text check (modalidad in ('visita', 'garantia', 'externa')),
  sin_profesionales  boolean not null default false,
  profesional_id     uuid references public.profesionales(id) on delete set null,
  vence_en           timestamptz not null,
  cancelada_en       timestamptz,
  motivo_cancelacion text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  check ((lat is null) = (lng is null))
);
create index if not exists match_solicitudes_cliente_idx on public.match_solicitudes (cliente_id, creado_en desc);
create index if not exists match_solicitudes_estado_idx on public.match_solicitudes (estado, creado_en desc);

create table if not exists public.match_invitaciones (
  id              uuid primary key default gen_random_uuid(),
  solicitud_id    uuid not null references public.match_solicitudes(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente', 'aceptada', 'rechazada', 'elegida', 'descartada', 'vencida', 'cancelada')),
  mensaje         text check (mensaje is null or length(mensaje) <= 400),
  motivo_rechazo  text check (motivo_rechazo is null or length(motivo_rechazo) <= 200),
  precio_visita   numeric(12,2) not null,
  vista_en        timestamptz,
  respondida_en   timestamptz,
  respondida_por  uuid,
  creado_en       timestamptz not null default now(),
  unique (solicitud_id, profesional_id)
);
create index if not exists match_invitaciones_prof_idx on public.match_invitaciones (profesional_id, creado_en desc);

-- ---------------------------------------------------------------------
-- 6. Operaciones (cada cobro) con su reparto, y su historial de movimientos
-- ---------------------------------------------------------------------
create table if not exists public.match_liquidaciones (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,
  profesional_id  uuid not null references public.profesionales(id) on delete restrict,
  monto           numeric(12,2) not null check (monto >= 0),
  operaciones     int not null,
  penalizaciones  numeric(12,2) not null default 0,
  fecha           date not null,
  metodo          text not null default 'transferencia' check (metodo in ('transferencia', 'deposito', 'otro')),
  referencia      text not null check (length(trim(referencia)) between 2 and 80),
  notas           text check (notas is null or length(notas) <= 300),
  creado_por      uuid,
  creado_en       timestamptz not null default now()
);
create index if not exists match_liquidaciones_prof_idx on public.match_liquidaciones (profesional_id, creado_en desc);

create table if not exists public.match_operaciones (
  id                        uuid primary key default gen_random_uuid(),
  numero                    bigint generated always as identity,
  tipo                      text not null check (tipo in ('visita', 'trabajo')),
  solicitud_id              uuid not null references public.match_solicitudes(id) on delete restrict,
  invitacion_id             uuid references public.match_invitaciones(id) on delete set null,
  turno_id                  uuid references public.turnos(id) on delete set null,
  cliente_id                uuid not null references public.perfiles(id) on delete restrict,
  profesional_id            uuid not null references public.profesionales(id) on delete restrict,
  categoria_id              smallint references public.categorias(id),
  importe                   numeric(12,2) not null check (importe > 0),
  ret_cliente               numeric(12,2) not null default 0 check (ret_cliente >= 0),
  ret_profesional           numeric(12,2) not null default 0 check (ret_profesional >= 0),
  comision_pct              numeric(5,2) not null default 0,
  comision                  numeric(12,2) not null default 0 check (comision >= 0),
  credito_visita            numeric(12,2) not null default 0 check (credito_visita >= 0),
  neto_profesional          numeric(12,2) not null check (neto_profesional >= 0),
  mp_costo_profesional_pct  numeric(5,2) not null,
  mp_costo                  numeric(12,2),
  mp_costo_profesional      numeric(12,2),
  mp_costo_talisto          numeric(12,2),
  reintegrado               numeric(12,2) not null default 0 check (reintegrado >= 0),
  liquidacion_monto         numeric(12,2),
  ingreso_talisto           numeric(12,2),
  moneda                    text not null default 'UYU' check (moneda = 'UYU'),
  estado                    text not null default 'pendiente_pago' check (estado in (
                              'pendiente_pago', 'reserva_confirmada', 'visita_realizada', 'trabajo_en_curso', 'pendiente_confirmacion',
                              'pendiente_liquidacion', 'liquidado', 'reembolsado', 'en_disputa', 'cancelado')),
  estado_pago               text not null default 'pendiente'
                            check (estado_pago in ('pendiente', 'pagado', 'reembolsado', 'reembolso_parcial', 'vencido', 'rechazado')),
  estado_liquidacion        text not null default 'no_corresponde' check (estado_liquidacion in ('no_corresponde', 'pendiente', 'liquidado')),
  mp_preferencia_id         text,
  mp_pago_id                text unique,
  mp_estado                 text,
  vence_pago_en             timestamptz,
  pagado_en                 timestamptz,
  realizado_en              timestamptz,
  confirmar_hasta           timestamptz,
  confirmado_en             timestamptz,
  confirmado_por            text check (confirmado_por in ('cliente', 'automatica', 'admin', 'cancelacion')),
  liquidacion_id            uuid references public.match_liquidaciones(id) on delete restrict,
  liquidado_en              timestamptz,
  cancelado_en              timestamptz,
  cancelado_por             text check (cancelado_por in ('cliente', 'profesional', 'admin', 'sistema')),
  motivo                    text check (motivo is null or length(motivo) <= 300),
  diagnostico               text check (diagnostico is null or length(diagnostico) <= 2000),
  externa                   boolean not null default false,
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  constraint match_operaciones_reparto check (importe = ret_cliente + ret_profesional + comision + neto_profesional)
);
-- Una sola visita viva por solicitud: no se puede cobrar dos veces
create unique index if not exists match_operaciones_visita_uk on public.match_operaciones (solicitud_id)
  where tipo = 'visita' and estado not in ('cancelado', 'reembolsado');
create index if not exists match_operaciones_prof_idx on public.match_operaciones (profesional_id, creado_en desc);
create index if not exists match_operaciones_cliente_idx on public.match_operaciones (cliente_id, creado_en desc);
create index if not exists match_operaciones_estado_idx on public.match_operaciones (estado, creado_en desc);

-- Cada notificación de pago de Mercado Pago (sin datos de tarjeta)
create table if not exists public.match_pagos (
  mp_pago_id     text primary key,
  operacion_id   uuid references public.match_operaciones(id) on delete set null,
  estado         text not null,
  importe        numeric(12,2),
  moneda         text,
  costo_mp       numeric(12,2),
  resultado      text not null,
  datos          jsonb not null default '{}'::jsonb,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.match_devoluciones (
  id              uuid primary key default gen_random_uuid(),
  operacion_id    uuid not null references public.match_operaciones(id) on delete restrict,
  mp_pago_id      text,
  monto           numeric(12,2) not null check (monto > 0),
  motivo          text not null check (length(motivo) <= 300),
  origen          text not null check (origen in ('cliente', 'profesional', 'reclamo', 'pago_tardio', 'pago_duplicado', 'monto_incorrecto', 'admin')),
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'ejecutada', 'rechazada', 'error')),
  confirmar_despues boolean not null default false,  -- al ejecutarse, lo que queda se liquida
  nota_admin      text check (nota_admin is null or length(nota_admin) <= 300),
  aprobada_por    uuid,
  mp_refund_id    text,
  error           text,
  creado_en       timestamptz not null default now(),
  resuelta_en     timestamptz
);
create unique index if not exists match_devoluciones_viva_uk on public.match_devoluciones (operacion_id, coalesce(mp_pago_id, ''))
  where estado in ('pendiente', 'aprobada');

create table if not exists public.match_reclamos (
  id              uuid primary key default gen_random_uuid(),
  numero          bigint generated always as identity,
  operacion_id    uuid not null references public.match_operaciones(id) on delete restrict,
  cliente_id      uuid not null references public.perfiles(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  tipo            text not null default 'visita' check (tipo in ('visita', 'trabajo', 'garantia')),
  descripcion     text not null check (length(trim(descripcion)) between 10 and 2000),
  archivos        text[] not null default '{}' check (cardinality(archivos) <= 8),
  estado          text not null default 'abierto' check (estado in ('abierto', 'resuelto', 'rechazado')),
  accion          text check (accion in ('liberar', 'devolver_total', 'devolver_parcial', 'sin_accion')),
  resolucion      text check (resolucion is null or length(resolucion) <= 600),
  respuesta_profesional text check (respuesta_profesional is null or length(respuesta_profesional) <= 1000),
  resuelto_por    uuid,
  resuelto_en     timestamptz,
  creado_en       timestamptz not null default now()
);
create unique index if not exists match_reclamos_abierto_uk on public.match_reclamos (operacion_id) where estado = 'abierto';

create table if not exists public.match_calificaciones (
  id              uuid primary key default gen_random_uuid(),
  operacion_id    uuid not null unique references public.match_operaciones(id) on delete cascade,
  tipo            text not null check (tipo in ('visita', 'trabajo')),
  cliente_id      uuid not null references public.perfiles(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  puntaje         smallint not null check (puntaje between 1 and 5),
  comentario      text check (comentario is null or length(comentario) <= 600),
  respuesta       text check (respuesta is null or length(respuesta) <= 600),
  creado_en       timestamptz not null default now()
);
create index if not exists match_calificaciones_prof_idx on public.match_calificaciones (profesional_id, creado_en desc);

create table if not exists public.match_movimientos (
  id              bigint generated always as identity primary key,
  operacion_id    uuid references public.match_operaciones(id) on delete restrict,
  liquidacion_id  uuid references public.match_liquidaciones(id) on delete restrict,
  devolucion_id   uuid references public.match_devoluciones(id) on delete restrict,
  profesional_id  uuid references public.profesionales(id) on delete restrict,
  tipo            text not null check (tipo in ('cobro', 'costo_mp', 'a_liquidar', 'ingreso', 'liquidacion', 'reintegro',
                                                'penalizacion', 'ajuste', 'contracargo')),
  cuenta          text not null check (cuenta in ('cliente', 'talisto', 'profesional', 'mercadopago')),
  importe         numeric(12,2) not null,
  detalle         text,
  creado_por      uuid,
  creado_en       timestamptz not null default now()
);
create index if not exists match_movimientos_op_idx on public.match_movimientos (operacion_id);
create index if not exists match_movimientos_prof_idx on public.match_movimientos (profesional_id, creado_en desc);

-- ---------------------------------------------------------------------
-- 7. Actividad (para las estadísticas): solo el tipo de acción, nunca contenido
-- ---------------------------------------------------------------------
create table if not exists public.eventos (
  id              bigint generated always as identity primary key,
  usuario_id      uuid not null references public.perfiles(id) on delete cascade,
  cuenta_id       uuid,
  perfil          text not null check (perfil in ('cliente', 'profesional', 'empresa', 'admin')),
  tipo            text not null check (length(tipo) <= 40),
  funcionalidad   text not null check (length(funcionalidad) <= 30),
  creado_en       timestamptz not null default now()
);
create index if not exists eventos_fecha_idx on public.eventos (creado_en desc);
create index if not exists eventos_usuario_idx on public.eventos (usuario_id, creado_en desc);
create index if not exists eventos_func_idx on public.eventos (funcionalidad, creado_en desc);

create table if not exists public.match_tareas (
  id      smallint primary key default 1 check (id = 1),
  ultima  timestamptz
);
insert into public.match_tareas (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- 8. Ayudas
-- ---------------------------------------------------------------------
create or replace function public._cfg()
returns public.configuracion language sql stable security definer set search_path = public as $$
  select * from public.configuracion where id = 1;
$$;

create or replace function public._r2(n numeric)
returns numeric language sql immutable as $$ select round(coalesce(n, 0), 2) $$;

create or replace function public._es_match(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c is not null and public.puede(c, array['match']);
$$;

-- % de comisión por trabajo: excepción de la cuenta > rubro (si está habilitado) > general
create or replace function public._comision_pct(p_cuenta uuid, p_categoria smallint)
returns numeric language sql stable security definer set search_path = public as $$
  select case when not c.trabajo_comision_activa then 0 else coalesce(
    (select pct from public.match_comisiones where tipo = 'cuenta' and profesional_id = p_cuenta and activa),
    case when c.comision_por_rubro then (select pct from public.match_comisiones where tipo = 'rubro' and categoria_id = p_categoria and activa) end,
    c.trabajo_comision_pct) end
  from public.configuracion c where c.id = 1;
$$;

create or replace function public._mov(p_op uuid, p_tipo text, p_cuenta text, p_importe numeric, p_detalle text,
                                       p_liquidacion uuid default null, p_devolucion uuid default null, p_prof uuid default null)
returns void language sql security definer set search_path = public as $$
  insert into public.match_movimientos (operacion_id, liquidacion_id, devolucion_id, profesional_id, tipo, cuenta, importe, detalle, creado_por)
  values (p_op, p_liquidacion, p_devolucion,
          coalesce(p_prof, (select profesional_id from public.match_operaciones where id = p_op)),
          p_tipo, p_cuenta, public._r2(p_importe), p_detalle, auth.uid());
$$;

create or replace function public._admins()
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.perfiles where es_admin;
$$;

create or replace function public._aviso_pro(p_cuenta uuid, p_tipo text, p_titulo text, p_cuerpo text, p_url text)
returns void language sql security definer set search_path = public as $$
  select public._avisar(array(select public._con_permiso(p_cuenta, array['match'])), p_cuenta, p_tipo, p_titulo, p_cuerpo, p_url, '{}'::jsonb);
$$;

create or replace function public._aviso_cliente(p_cliente uuid, p_tipo text, p_titulo text, p_cuerpo text, p_url text)
returns void language sql security definer set search_path = public as $$
  select public._avisar(array[p_cliente], null, p_tipo, p_titulo, p_cuerpo, p_url, '{}'::jsonb);
$$;

create or replace function public._rubro(c smallint)
returns text language sql stable security definer set search_path = public as $$
  select nombre from public.categorias where id = c;
$$;

-- Registro de actividad interno (sin contenido)
create or replace function public._evento(p_usuario uuid, p_tipo text, p_funcionalidad text, p_cuenta uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_perfil text;
begin
  if p_usuario is null then return; end if;
  select case when es_admin then 'admin'
              when exists (select 1 from public.empresas e where e.dueno_id = p_usuario)
                or exists (select 1 from public.miembros m where m.usuario_id = p_usuario and m.estado = 'activo') then 'empresa'
              when rol = 'cliente' then 'cliente'
              else 'profesional' end
    into v_perfil from public.perfiles where id = p_usuario;
  if v_perfil is null then return; end if;
  insert into public.eventos (usuario_id, cuenta_id, perfil, tipo, funcionalidad)
  values (p_usuario, p_cuenta, v_perfil, left(p_tipo, 40), left(p_funcionalidad, 30));
end $$;

-- Desde la app: solo acciones de la lista, una por minuto (la sesión, una cada 30 minutos)
create or replace function public.registrar_evento(p_tipo text, p_funcionalidad text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid();
  f text;
  permitidos constant jsonb := '{
    "sesion": "general", "busco_servicio": "match", "vio_profesional": "match", "vio_solicitudes": "match",
    "vio_presupuesto": "presupuestos", "vio_reportes": "finanzas", "abrio_agenda": "agenda", "abrio_tickets": "tickets",
    "abrio_stock": "stock", "abrio_compras": "proveedores", "abrio_finanzas": "finanzas", "abrio_equipo": "empleados",
    "abrio_presupuestos": "presupuestos", "abrio_match": "match", "abrio_clientes": "clientes", "abrio_materiales": "materiales"
  }';
begin
  if u is null or not permitidos ? p_tipo then return; end if;
  f := permitidos ->> p_tipo;
  if exists (select 1 from public.eventos where usuario_id = u and tipo = p_tipo
              and creado_en > now() - case when p_tipo = 'sesion' then interval '30 minutes' else interval '1 minute' end) then
    return;
  end if;
  perform public._evento(u, p_tipo, f);
end $$;

-- ---------------------------------------------------------------------
-- 9. Perfil Match del profesional
-- ---------------------------------------------------------------------
-- p: { disponible, rubros: [ids], departamentos: [], barrios: [], urgencias,
--      cobro: { banco, tipo_cuenta, numero, sucursal, titular, documento } }
create or replace function public.guardar_match_perfil(p_cuenta uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_rubros smallint[]; v_deps text[]; v_barrios text[]; c jsonb := p -> 'cobro';
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  select coalesce(array_agg(distinct x::smallint), '{}') into v_rubros
    from jsonb_array_elements_text(coalesce(p -> 'rubros', '[]')) x
   where exists (select 1 from public.categorias k where k.id = x::smallint and k.activa);
  if p ? 'departamentos' then
    select coalesce(array_agg(distinct trim(x)), '{}') into v_deps from jsonb_array_elements_text(p -> 'departamentos') x where trim(x) <> '';
    select coalesce(array_agg(distinct trim(x)), '{}') into v_barrios from jsonb_array_elements_text(coalesce(p -> 'barrios', '[]')) x where trim(x) <> '';
    update public.profesionales set departamentos = v_deps, barrios = v_barrios where id = p_cuenta;
  end if;
  if coalesce((p ->> 'disponible')::boolean, false) then
    if cardinality(v_rubros) = 0 then raise exception 'Elegí al menos un rubro'; end if;
    if cardinality((select departamentos from public.profesionales where id = p_cuenta)) = 0 then
      raise exception 'Elegí al menos un departamento donde trabajás';
    end if;
  end if;
  insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias, actualizado_en)
  values (p_cuenta, coalesce((p ->> 'disponible')::boolean, false), v_rubros, coalesce((p ->> 'urgencias')::boolean, false), now())
  on conflict (profesional_id) do update set disponible = excluded.disponible, rubros = excluded.rubros,
    urgencias = excluded.urgencias, actualizado_en = now();
  -- Los datos de cobro solo los carga la cuenta principal
  if jsonb_typeof(c) = 'object' and p_cuenta = auth.uid() then
    insert into public.match_datos_cobro (profesional_id, banco, tipo_cuenta, numero, sucursal, titular, documento, actualizado_en)
    values (p_cuenta, trim(c ->> 'banco'), coalesce(nullif(c ->> 'tipo_cuenta', ''), 'caja_ahorro'), trim(c ->> 'numero'),
            nullif(trim(coalesce(c ->> 'sucursal', '')), ''), trim(c ->> 'titular'), nullif(trim(coalesce(c ->> 'documento', '')), ''), now())
    on conflict (profesional_id) do update set banco = excluded.banco, tipo_cuenta = excluded.tipo_cuenta, numero = excluded.numero,
      sucursal = excluded.sucursal, titular = excluded.titular, documento = excluded.documento, actualizado_en = now();
  end if;
  perform public._evento(auth.uid(), 'actualizo_disponibilidad', 'match', p_cuenta);
  return public.match_mi_perfil(p_cuenta);
end $$;

create or replace function public.match_mi_perfil(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  return (select json_build_object(
    'disponible', coalesce(m.disponible, false), 'rubros', coalesce(m.rubros, '{}'), 'urgencias', coalesce(m.urgencias, false),
    'departamentos', p.departamentos, 'barrios', p.barrios, 'verificado', p.verificado,
    'tiene_horario', exists (select 1 from public.horarios_trabajo h where h.profesional_id = p.id),
    'cobro', case when p.id = auth.uid() then (select to_json(d) from public.match_datos_cobro d where d.profesional_id = p.id) end,
    'tiene_cobro', exists (select 1 from public.match_datos_cobro d where d.profesional_id = p.id),
    'comision_pct', public._comision_pct(p.id, null),
    'calificacion', (select json_build_object('promedio', round(avg(puntaje), 1), 'cantidad', count(*))
                       from public.match_calificaciones where profesional_id = p.id))
    from public.profesionales p left join public.match_perfiles m on m.profesional_id = p.id where p.id = p_cuenta);
end $$;

-- ---------------------------------------------------------------------
-- 10. El cliente publica una solicitud: se buscan profesionales compatibles
-- ---------------------------------------------------------------------
create or replace function public._compatibles(p_sol uuid)
returns table (profesional_id uuid) language sql stable security definer set search_path = public as $$
  with s as (select * from public.match_solicitudes where id = p_sol), c as (select * from public.configuracion where id = 1)
  select p.id
    from public.profesionales p
    join public.match_perfiles mp on mp.profesional_id = p.id and mp.disponible
    cross join s cross join c
   where p.activo and p.id <> s.cliente_id
     and s.categoria_id = any (mp.rubros)
     and s.departamento = any (p.departamentos)
     and (cardinality(p.barrios) = 0 or s.localidad is null
          or exists (select 1 from unnest(p.barrios) b where public.normalizar(b) = public.normalizar(s.localidad)))
     and (not c.solo_verificados or p.verificado)
     and s.dirigida_a is null
   order by p.verificado desc,
            (select avg(puntaje) from public.match_calificaciones k where k.profesional_id = p.id) desc nulls last,
            (s.urgente and mp.urgencias) desc, random()
   limit (select max_invitados from c);
$$;

-- Si el cliente eligió un profesional en particular, solo a ese (si está recibiendo solicitudes)
create or replace function public._invitables(p_sol uuid)
returns table (profesional_id uuid) language sql stable security definer set search_path = public as $$
  select s.dirigida_a from public.match_solicitudes s
    join public.match_perfiles m on m.profesional_id = s.dirigida_a and m.disponible
    join public.profesionales p on p.id = s.dirigida_a and p.activo
   where s.id = p_sol and s.dirigida_a is not null and s.dirigida_a <> s.cliente_id
  union all
  select c.profesional_id from public._compatibles(p_sol) c
   where not exists (select 1 from public.match_solicitudes s where s.id = p_sol and s.dirigida_a is not null);
$$;

-- p: { categoria_id, titulo, descripcion, departamento, localidad, direccion, referencia, lat, lng,
--      preferencia, urgente, archivos: [rutas], dirigida_a }
create or replace function public.crear_solicitud(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); c public.configuracion := public._cfg(); s public.match_solicitudes; n int := 0; r record;
  v_arch text[]; v_dir uuid := public.uuid_o_null(p ->> 'dirigida_a');
begin
  if u is null then raise exception 'Tenés que iniciar sesión'; end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and estado = 'abierta') >= 5 then
    raise exception 'Ya tenés 5 solicitudes abiertas: esperá respuestas o cancelá alguna';
  end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de solicitudes por día';
  end if;
  if not exists (select 1 from public.categorias where id = (p ->> 'categoria_id')::smallint and activa) then
    raise exception 'Elegí el rubro';
  end if;
  if coalesce(p ->> 'departamento', '') not in ('Artigas','Canelones','Cerro Largo','Colonia','Durazno','Flores','Florida','Lavalleja',
       'Maldonado','Montevideo','Paysandú','Río Negro','Rivera','Rocha','Salto','San José','Soriano','Tacuarembó','Treinta y Tres') then
    raise exception 'Elegí el departamento';
  end if;
  select coalesce(array_agg(x), '{}') into v_arch from jsonb_array_elements_text(coalesce(p -> 'archivos', '[]')) x;
  if exists (select 1 from unnest(v_arch) a where split_part(a, '/', 1) <> u::text) then
    raise exception 'Archivo no válido';
  end if;
  if v_dir is not null and not exists (select 1 from public.match_perfiles where profesional_id = v_dir and disponible) then
    raise exception 'Ese profesional no está recibiendo solicitudes ahora';
  end if;
  insert into public.match_solicitudes (cliente_id, categoria_id, titulo, descripcion, departamento, localidad, direccion, referencia,
                                        lat, lng, preferencia, urgente, archivos, dirigida_a, vence_en)
  values (u, (p ->> 'categoria_id')::smallint, trim(p ->> 'titulo'), trim(p ->> 'descripcion'), p ->> 'departamento',
          nullif(trim(coalesce(p ->> 'localidad', '')), ''), nullif(trim(coalesce(p ->> 'direccion', '')), ''),
          nullif(trim(coalesce(p ->> 'referencia', '')), ''), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          coalesce(nullif(p ->> 'preferencia', ''), 'cualquiera'), coalesce((p ->> 'urgente')::boolean, false), v_arch, v_dir,
          now() + make_interval(days => c.solicitud_dias))
  returning * into s;
  for r in select profesional_id from public._invitables(s.id) loop
    insert into public.match_invitaciones (solicitud_id, profesional_id, precio_visita) values (s.id, r.profesional_id, c.precio_visita);
    n := n + 1;
    perform public._aviso_pro(r.profesional_id, 'match',
      format('Nueva solicitud: %s', public._rubro(s.categoria_id)),
      format('%s · %s%s. Respondé si podés hacer la visita.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento),
      '/panel/match?invitacion=' || (select id from public.match_invitaciones where solicitud_id = s.id and profesional_id = r.profesional_id));
  end loop;
  if n = 0 then
    update public.match_solicitudes set sin_profesionales = true where id = s.id;
    perform public._avisar(public._admins(), null, 'match', 'Solicitud sin profesionales',
      format('%s en %s: no hay profesionales disponibles para ese rubro y zona.', public._rubro(s.categoria_id), s.departamento),
      '/admin/match', '{}'::jsonb);
  end if;
  perform public._evento(u, 'publico_solicitud', 'match');
  if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
  return json_build_object('id', s.id, 'numero', s.numero, 'invitados', n);
end $$;

create or replace function public.cancelar_solicitud(p_id uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes;
begin
  select * into s from public.match_solicitudes where id = p_id for update;
  if s.id is null or s.cliente_id <> auth.uid() then raise exception 'No encontramos la solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'La solicitud ya tiene una visita: cancelá la visita'; end if;
  -- un pago empezado se cancela también (si después llega aprobado, se devuelve)
  update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'cliente'
   where solicitud_id = p_id and estado = 'pendiente_pago';
  update public.turnos set estado = 'cancelado', nota_estado = 'Solicitud cancelada por el cliente'
   where id in (select turno_id from public.match_operaciones where solicitud_id = p_id) and estado = 'pendiente';
  update public.match_solicitudes set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = left(p_motivo, 300), actualizado_en = now()
   where id = p_id;
  update public.match_invitaciones set estado = 'cancelada' where solicitud_id = p_id and estado in ('pendiente', 'aceptada');
  perform public._evento(auth.uid(), 'cancelo_solicitud', 'match');
end $$;

-- ---------------------------------------------------------------------
-- 11. El profesional acepta o rechaza
-- ---------------------------------------------------------------------
create or replace function public.responder_invitacion(p_id uuid, p_acepta boolean, p_mensaje text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.match_invitaciones; s public.match_solicitudes; quedan int;
begin
  select * into i from public.match_invitaciones where id = p_id for update;
  if i.id is null or not public._es_match(i.profesional_id) then raise exception 'No encontramos la solicitud'; end if;
  select * into s from public.match_solicitudes where id = i.solicitud_id;
  if i.estado <> 'pendiente' or s.estado <> 'abierta' then raise exception 'Esta solicitud ya no está abierta'; end if;
  update public.match_invitaciones
     set estado = case when p_acepta then 'aceptada' else 'rechazada' end,
         mensaje = case when p_acepta then nullif(left(trim(coalesce(p_mensaje, '')), 400), '') end,
         motivo_rechazo = case when not p_acepta then nullif(left(trim(coalesce(p_mensaje, '')), 200), '') end,
         respondida_en = now(), respondida_por = auth.uid(), vista_en = coalesce(vista_en, now())
   where id = p_id;
  if p_acepta then
    perform public._aviso_cliente(s.cliente_id, 'match', 'Un profesional aceptó tu solicitud',
      format('%s puede hacer la visita de "%s". Elegí el horario y reservá.', public._nombre_de(i.profesional_id), s.titulo),
      '/match/solicitud/' || s.id);
    perform public._evento(auth.uid(), 'acepto_solicitud', 'match', i.profesional_id);
  else
    select count(*) into quedan from public.match_invitaciones where solicitud_id = s.id and estado in ('pendiente', 'aceptada');
    if quedan = 0 then
      perform public._aviso_cliente(s.cliente_id, 'match', 'Tu solicitud fue rechazada',
        format('Ningún profesional pudo tomar "%s" por ahora. Podés publicarla de nuevo o cambiar la zona.', s.titulo),
        '/match/solicitud/' || s.id);
    end if;
    perform public._evento(auth.uid(), 'rechazo_solicitud', 'match', i.profesional_id);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12. El cliente elige un profesional y un horario: se reserva el turno
--     (queda pendiente) y se crea la operación a pagar
-- ---------------------------------------------------------------------
create or replace function public.elegir_profesional(p_invitacion uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  i public.match_invitaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); t uuid; op public.match_operaciones;
begin
  perform public.match_procesar_vencidos();
  select * into i from public.match_invitaciones where id = p_invitacion;
  if i.id is null then raise exception 'No encontramos el profesional'; end if;
  select * into s from public.match_solicitudes where id = i.solicitud_id for update;
  if s.cliente_id <> auth.uid() then raise exception 'No encontramos la solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'La solicitud ya no está abierta'; end if;
  if i.estado <> 'aceptada' then raise exception 'Ese profesional todavía no aceptó la solicitud'; end if;
  if exists (select 1 from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado not in ('cancelado', 'reembolsado')) then
    raise exception 'Ya hay una visita en curso para esta solicitud';
  end if;
  if p_inicio < now() + interval '2 hours' or not exists (
       select 1 from public.horarios_disponibles(i.profesional_id, (p_inicio at time zone 'America/Montevideo')::date, c.duracion_visita_min) h
        where h.desde = p_inicio) then
    raise exception 'Ese horario ya no está libre: elegí otro';
  end if;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas)
    values (i.profesional_id, left('Visita TaListo! Match · ' || public._rubro(s.categoria_id), 120), p_inicio,
            p_inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'pendiente', 'reserva', c.precio_visita,
            left(format('Solicitud Nº %s: %s', s.numero, s.titulo), 500))
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ese horario se acaba de ocupar: elegí otro';
  end;
  insert into public.match_operaciones (tipo, solicitud_id, invitacion_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                        ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en)
  values ('visita', s.id, i.id, t, s.cliente_id, i.profesional_id, s.categoria_id, c.precio_visita, c.visita_ret_cliente,
          c.visita_ret_profesional, c.visita_neto_profesional, c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos))
  returning * into op;
  perform public._evento(auth.uid(), 'reservo_visita', 'match');
  return json_build_object('operacion', op.id, 'importe', op.importe, 'vence', op.vence_pago_en);
end $$;

-- Para el servidor: los datos para armar el pago de Mercado Pago (solo del dueño y si sigue a pagar)
create or replace function public.operacion_a_pagar(p_op uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare op public.match_operaciones;
begin
  select * into op from public.match_operaciones where id = p_op;
  if op.id is null or op.cliente_id <> auth.uid() then raise exception 'No encontramos la operación'; end if;
  if op.estado <> 'pendiente_pago' then raise exception 'Esta operación ya no está para pagar'; end if;
  if op.vence_pago_en < now() then raise exception 'Se venció el tiempo para pagar: elegí el horario de nuevo'; end if;
  return (select json_build_object('id', op.id, 'numero', op.numero, 'tipo', op.tipo, 'importe', op.importe, 'moneda', op.moneda,
            'vence', op.vence_pago_en, 'solicitud', op.solicitud_id, 'preferencia', op.mp_preferencia_id,
            'titulo', case when op.tipo = 'visita' then 'Visita técnica · ' else 'Trabajo con garantía · ' end || public._rubro(op.categoria_id),
            'profesional', public._nombre_de(op.profesional_id), 'email', (select email from public.perfiles where id = op.cliente_id)));
end $$;

-- ---------------------------------------------------------------------
-- 13. Pago confirmado por Mercado Pago (SOLO el servidor, con el pago
--     consultado a la API). Idempotente: el mismo pago no se aplica dos veces.
--     p: { id, status, status_detail, transaction_amount, currency_id, external_reference, fee, date_approved }
-- ---------------------------------------------------------------------
create or replace function public.match_aplicar_pago(p_op uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  op public.match_operaciones; s public.match_solicitudes; pid text := p ->> 'id'; st text := p ->> 'status';
  monto numeric := (p ->> 'transaction_amount')::numeric; fee numeric := coalesce((p ->> 'fee')::numeric, 0);
  res text; cli uuid; dir uuid; ok_turno boolean := true;
begin
  if pid is null or p_op is null then raise exception 'Pago sin datos'; end if;
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null then raise exception 'Operación inexistente'; end if;

  -- ya aplicado (Mercado Pago avisa varias veces)
  if op.mp_pago_id = pid and st = 'approved' then
    return json_build_object('resultado', 'ya_aplicado');
  end if;

  if st = 'approved' then
    if op.mp_pago_id is not null and op.mp_pago_id <> pid then
      res := 'duplicado';
    elsif monto is null or abs(monto - op.importe) > 0.01 or coalesce(p ->> 'currency_id', '') <> 'UYU' then
      res := 'monto_incorrecto';
    elsif op.estado = 'pendiente_pago' or (op.estado = 'cancelado' and op.estado_pago = 'vencido') then
      -- si el turno se había liberado, se intenta recuperar; si ya está ocupado, se devuelve
      if op.estado = 'cancelado' then
        if (select estado from public.match_solicitudes where id = op.solicitud_id) <> 'abierta'
           or exists (select 1 from public.match_operaciones x where x.solicitud_id = op.solicitud_id and x.id <> op.id and x.tipo = op.tipo
                       and x.estado not in ('cancelado', 'reembolsado')) then
          ok_turno := false;
        else
          begin
            update public.turnos set estado = 'pendiente' where id = op.turno_id and estado = 'cancelado';
            if not found then ok_turno := false; end if;
          exception when exclusion_violation then ok_turno := false;
          end;
        end if;
      end if;
      res := case when ok_turno then 'aplicado' else 'pago_tardio' end;
    else
      res := 'pago_tardio';
    end if;
  else
    res := 'estado_' || coalesce(st, 'desconocido');
  end if;

  insert into public.match_pagos (mp_pago_id, operacion_id, estado, importe, moneda, costo_mp, resultado, datos)
  values (pid, op.id, coalesce(st, '?'), monto, p ->> 'currency_id', fee, res,
          jsonb_build_object('status_detail', p ->> 'status_detail', 'date_approved', p ->> 'date_approved'))
  on conflict (mp_pago_id) do update set estado = excluded.estado, resultado = excluded.resultado, actualizado_en = now();

  if res = 'aplicado' then
    select * into s from public.match_solicitudes where id = op.solicitud_id for update;
    update public.match_operaciones
       set estado = case when tipo = 'visita' then 'reserva_confirmada' else 'trabajo_en_curso' end, estado_pago = 'pagado',
           mp_pago_id = pid, mp_estado = st, pagado_en = coalesce((p ->> 'date_approved')::timestamptz, now()),
           mp_costo = public._r2(fee), mp_costo_profesional = public._r2(fee * mp_costo_profesional_pct / 100),
           mp_costo_talisto = public._r2(fee) - public._r2(fee * mp_costo_profesional_pct / 100),
           cancelado_en = null, cancelado_por = null, actualizado_en = now()
     where id = op.id returning * into op;
    perform public._mov(op.id, 'cobro', 'talisto', op.importe, 'Pago Mercado Pago Nº ' || pid);
    if fee > 0 then perform public._mov(op.id, 'costo_mp', 'mercadopago', fee, 'Costo de Mercado Pago'); end if;

    if op.tipo = 'visita' then
      -- el cliente queda en la lista de clientes del profesional, con la dirección
      begin
        select id into cli from public.clientes where profesional_id = op.profesional_id and usuario_id = op.cliente_id limit 1;
        if cli is null then
          insert into public.clientes (profesional_id, nombre, telefono, email, usuario_id, notas)
          select op.profesional_id, coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1)), pe.telefono, pe.email, pe.id, 'Cliente de TaListo! Match'
            from public.perfiles pe where pe.id = op.cliente_id returning id into cli;
        end if;
        if s.direccion is not null then
          insert into public.direcciones (cliente_id, etiqueta, direccion, referencia, lat, lng)
          values (cli, 'TaListo! Match', concat_ws(', ', s.direccion, s.localidad, s.departamento), s.referencia, s.lat, s.lng)
          returning id into dir;
        end if;
        update public.turnos set cliente_id = cli, direccion_id = dir where id = op.turno_id;
      exception when others then
        raise warning 'Match: no se pudo agregar el cliente a la agenda: %', sqlerrm;
      end;
      update public.turnos set estado = 'confirmado' where id = op.turno_id;
      update public.match_solicitudes set estado = 'reservada', profesional_id = op.profesional_id, modalidad = 'visita', actualizado_en = now()
       where id = op.solicitud_id;
      update public.match_invitaciones set estado = 'elegida' where id = op.invitacion_id;
      update public.match_invitaciones set estado = 'descartada' where solicitud_id = op.solicitud_id and id <> op.invitacion_id
         and estado in ('pendiente', 'aceptada');
      perform public._aviso_pro(op.profesional_id, 'match', 'Visita confirmada y paga',
        format('%s · %s. Ya está en tu agenda.', s.titulo,
               to_char((select inicio from public.turnos where id = op.turno_id) at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
        '/panel/match?operacion=' || op.id);
      perform public._aviso_cliente(op.cliente_id, 'match', 'Pago confirmado: visita reservada',
        format('Pagaste %s. %s te visita el %s.', public._pesos(op.importe), public._nombre_de(op.profesional_id),
               to_char((select inicio from public.turnos where id = op.turno_id) at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
        '/match/solicitud/' || op.solicitud_id);
    end if;
    perform public._evento(op.cliente_id, 'realizo_pago', 'match');
    perform public._evento(op.profesional_id, 'recibio_contratacion', 'match', op.profesional_id);
  elsif res in ('duplicado', 'monto_incorrecto', 'pago_tardio') then
    -- la plata entró pero no corresponde: se devuelve (lo aprueba el admin)
    if op.estado = 'pendiente_pago' and res = 'pago_tardio' then
      update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema' where id = op.id;
    end if;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen)
    values (op.id, pid, coalesce(monto, op.importe),
            case res when 'duplicado' then 'Pago repetido de la misma operación'
                     when 'monto_incorrecto' then 'El importe pagado no coincide con la operación'
                     else 'Pago aprobado después de vencer la reserva (el horario ya no estaba)' end,
            case res when 'duplicado' then 'pago_duplicado' when 'monto_incorrecto' then 'monto_incorrecto' else 'pago_tardio' end)
    on conflict do nothing;
    perform public._mov(op.id, 'cobro', 'talisto', coalesce(monto, 0), format('Pago Mercado Pago Nº %s (a devolver: %s)', pid, res));
    perform public._avisar(public._admins(), null, 'match', 'Pago a devolver', format('Operación Nº %s: %s.', op.numero, res), '/admin/match?ver=devoluciones', '{}'::jsonb);
    perform public._aviso_cliente(op.cliente_id, 'match', 'Recibimos tu pago, pero hay que devolverlo',
      'El horario ya no estaba disponible o el pago no coincidía. Te devolvemos el dinero por Mercado Pago.', '/match/solicitud/' || op.solicitud_id);
  elsif st in ('refunded', 'charged_back') and op.mp_pago_id = pid and op.estado not in ('reembolsado') then
    update public.match_operaciones set estado = 'en_disputa', mp_estado = st, actualizado_en = now() where id = op.id;
    if st = 'charged_back' then perform public._mov(op.id, 'contracargo', 'cliente', op.importe, 'Contracargo informado por Mercado Pago'); end if;
    perform public._avisar(public._admins(), null, 'match', 'Mercado Pago informó ' || st, format('Operación Nº %s', op.numero), '/admin/match', '{}'::jsonb);
  else
    update public.match_operaciones set mp_estado = st, actualizado_en = now() where id = op.id and estado = 'pendiente_pago';
  end if;
  return json_build_object('resultado', res);
end $$;

-- Se guarda la preferencia de pago creada (solo el servidor)
create or replace function public.match_guardar_preferencia(p_op uuid, p_pref text)
returns void language sql security definer set search_path = public as $$
  update public.match_operaciones set mp_preferencia_id = p_pref, actualizado_en = now() where id = p_op and estado = 'pendiente_pago';
$$;

-- ---------------------------------------------------------------------
-- 14. Visita realizada, confirmación (o automática) y reparto final
-- ---------------------------------------------------------------------
create or replace function public._confirmar_operacion(p_op uuid, p_por text)
returns void language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones; k numeric; liq numeric; ing numeric;
begin
  select * into op from public.match_operaciones where id = p_op for update;
  if op.estado_pago not in ('pagado', 'reembolso_parcial') or op.estado_liquidacion <> 'no_corresponde' then return; end if;
  k := op.importe - op.reintegrado;
  if k <= 0 then return; end if;
  -- lo que queda (si hubo devolución parcial, en proporción); el costo de MP se reparte según lo configurado
  liq := greatest(0, public._r2(op.neto_profesional * k / op.importe) - coalesce(op.mp_costo_profesional, 0));
  ing := k - coalesce(op.mp_costo, 0) - liq;
  update public.match_operaciones
     set estado = 'pendiente_liquidacion', estado_liquidacion = 'pendiente', confirmado_en = now(), confirmado_por = p_por,
         liquidacion_monto = liq, ingreso_talisto = public._r2(ing), actualizado_en = now()
   where id = op.id;
  perform public._mov(op.id, 'a_liquidar', 'profesional', liq, 'A liquidar al profesional');
  perform public._mov(op.id, 'ingreso', 'talisto', ing, 'Ingreso de TaListo! (retenciones y comisión menos costo de MP)');
  perform public._aviso_pro(op.profesional_id, 'match', format('%s a cobrar', public._pesos(liq)),
    format('La %s Nº %s quedó confirmada. TaListo! te lo transfiere en la próxima liquidación.', op.tipo, op.numero),
    '/panel/match?ver=cobros');
end $$;

create or replace function public.visita_realizada(p_op uuid, p_diagnostico text default null)
returns void language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones; c public.configuracion := public._cfg(); t public.turnos;
begin
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null or not public._es_match(op.profesional_id) then raise exception 'No encontramos la visita'; end if;
  if op.estado <> 'reserva_confirmada' then raise exception 'Esta visita no está confirmada'; end if;
  select * into t from public.turnos where id = op.turno_id;
  if t.inicio > now() + interval '1 hour' then raise exception 'La visita todavía no llegó'; end if;
  update public.match_operaciones set estado = 'pendiente_confirmacion', realizado_en = now(),
         confirmar_hasta = now() + make_interval(hours => c.confirmacion_auto_horas),
         diagnostico = nullif(left(trim(coalesce(p_diagnostico, '')), 2000), ''), actualizado_en = now()
   where id = op.id;
  update public.turnos set estado = 'realizado' where id = op.turno_id and estado in ('pendiente', 'confirmado');
  update public.match_solicitudes set estado = 'en_curso', actualizado_en = now() where id = op.solicitud_id;
  perform public._aviso_cliente(op.cliente_id, 'match', 'Confirmá la visita y calificala',
    format('%s marcó la visita como realizada. Si no lo confirmás ni reclamás, se confirma sola en %s horas.',
           public._nombre_de(op.profesional_id), c.confirmacion_auto_horas),
    '/match/solicitud/' || op.solicitud_id);
  perform public._evento(auth.uid(), 'realizo_visita', 'match', op.profesional_id);
end $$;

create or replace function public.confirmar_visita(p_op uuid)
returns void language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones;
begin
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null or op.cliente_id <> auth.uid() then raise exception 'No encontramos la visita'; end if;
  if op.estado = 'reserva_confirmada' and (select inicio from public.turnos where id = op.turno_id) > now() then
    raise exception 'La visita todavía no llegó';
  end if;
  if op.estado not in ('reserva_confirmada', 'pendiente_confirmacion') then raise exception 'Esta visita no está para confirmar'; end if;
  update public.turnos set estado = 'realizado' where id = op.turno_id and estado in ('pendiente', 'confirmado');
  update public.match_operaciones set realizado_en = coalesce(realizado_en, now()) where id = op.id;
  update public.match_solicitudes set estado = 'en_curso', actualizado_en = now() where id = op.solicitud_id and estado = 'reservada';
  perform public._confirmar_operacion(op.id, 'cliente');
end $$;

-- ---------------------------------------------------------------------
-- 15. Calificación verificada (solo de lo que se hizo dentro de TaListo!)
-- ---------------------------------------------------------------------
create or replace function public.calificar(p_op uuid, p_puntaje int, p_comentario text default null)
returns void language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones;
begin
  select * into op from public.match_operaciones where id = p_op;
  if op.id is null or op.cliente_id <> auth.uid() then raise exception 'No encontramos la operación'; end if;
  if op.realizado_en is null or op.estado not in ('pendiente_confirmacion', 'pendiente_liquidacion', 'liquidado') then
    raise exception 'Se califica cuando la % está hecha', op.tipo;
  end if;
  if p_puntaje not between 1 and 5 then raise exception 'La calificación va de 1 a 5'; end if;
  insert into public.match_calificaciones (operacion_id, tipo, cliente_id, profesional_id, puntaje, comentario)
  values (op.id, op.tipo, op.cliente_id, op.profesional_id, p_puntaje, nullif(left(trim(coalesce(p_comentario, '')), 600), ''));
  if op.estado = 'pendiente_confirmacion' then perform public._confirmar_operacion(op.id, 'cliente'); end if;
  perform public._evento(auth.uid(), 'califico_profesional', 'match');
exception when unique_violation then raise exception 'Ya calificaste esta %', op.tipo;
end $$;

create or replace function public.responder_calificacion(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare k public.match_calificaciones;
begin
  select * into k from public.match_calificaciones where id = p_id;
  if k.id is null or not public._es_match(k.profesional_id) then raise exception 'No encontramos la calificación'; end if;
  update public.match_calificaciones set respuesta = nullif(left(trim(coalesce(p_texto, '')), 600), '') where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 16. Cancelaciones (las devoluciones quedan para que las apruebe el admin)
-- ---------------------------------------------------------------------
create or replace function public.cancelar_visita(p_op uuid, p_motivo text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  op public.match_operaciones; c public.configuracion := public._cfg(); t public.turnos; quien text; pct numeric; monto numeric := 0;
begin
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null then raise exception 'No encontramos la visita'; end if;
  if op.cliente_id = auth.uid() then quien := 'cliente';
  elsif public._es_match(op.profesional_id) then quien := 'profesional';
  else raise exception 'No encontramos la visita'; end if;
  select * into t from public.turnos where id = op.turno_id;

  if op.estado = 'pendiente_pago' then
    update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = quien,
           motivo = left(p_motivo, 300) where id = op.id;
    update public.turnos set estado = 'cancelado' where id = op.turno_id and estado = 'pendiente';
    return json_build_object('devolucion', 0);
  end if;
  if op.estado <> 'reserva_confirmada' then raise exception 'Esta visita ya no se puede cancelar'; end if;
  if t.inicio < now() then raise exception 'La visita ya empezó: si no se hizo, hacé un reclamo'; end if;

  pct := case when quien = 'profesional' then 100
              when t.inicio - now() >= make_interval(hours => c.cancelacion_horas) then 100
              else c.cancelacion_tarde_pct end;
  monto := public._r2(op.importe * pct / 100);
  update public.match_operaciones set estado = 'cancelado', cancelado_en = now(), cancelado_por = quien, motivo = left(p_motivo, 300),
         actualizado_en = now() where id = op.id;
  update public.turnos set estado = 'cancelado', nota_estado = left('Cancelada por el ' || quien || coalesce(': ' || p_motivo, ''), 300)
   where id = op.turno_id;
  if monto > 0 then
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen, confirmar_despues)
    values (op.id, op.mp_pago_id, monto, format('Cancelación del %s (%s%% según las condiciones)', quien, pct), quien, monto < op.importe);
    perform public._avisar(public._admins(), null, 'match', 'Devolución para aprobar',
      format('Operación Nº %s: %s', op.numero, public._pesos(monto)), '/admin/match?ver=devoluciones', '{}'::jsonb);
  else
    -- cancelación tarde sin devolución: lo pagado se reparte como si se hubiera hecho
    perform public._confirmar_operacion(op.id, 'cancelacion');
  end if;

  if quien = 'profesional' then
    update public.match_invitaciones set estado = 'cancelada' where id = op.invitacion_id;
    -- los demás que habían aceptado vuelven a estar para elegir
    update public.match_invitaciones set estado = case when respondida_en is not null then 'aceptada' else 'pendiente' end
     where solicitud_id = op.solicitud_id and estado = 'descartada';
    update public.match_solicitudes set estado = 'abierta', profesional_id = null, modalidad = null, actualizado_en = now(),
           vence_en = greatest(vence_en, now() + interval '2 days') where id = op.solicitud_id;
    if c.penalizacion_profesional > 0 then
      perform public._mov(op.id, 'penalizacion', 'profesional', -c.penalizacion_profesional, 'Penalización por cancelar una visita paga');
    end if;
    perform public._aviso_cliente(op.cliente_id, 'match', 'El profesional canceló la visita',
      'Te devolvemos el pago. Podés elegir a otro profesional que aceptó tu solicitud.', '/match/solicitud/' || op.solicitud_id);
  else
    update public.match_solicitudes set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = left(p_motivo, 300), actualizado_en = now()
     where id = op.solicitud_id;
    perform public._aviso_pro(op.profesional_id, 'match', 'El cliente canceló la visita',
      format('Visita del %s cancelada%s.', to_char(t.inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI'),
             case when monto < op.importe then '. Igual se te liquida lo que corresponde' else '' end),
      '/panel/match?operacion=' || op.id);
    perform public._evento(auth.uid(), 'cancelo_solicitud', 'match');
  end if;
  return json_build_object('devolucion', monto, 'pct', pct);
end $$;

-- ---------------------------------------------------------------------
-- 17. Reclamos (el cliente; frena la confirmación automática)
-- ---------------------------------------------------------------------
create or replace function public.reclamar(p_op uuid, p_descripcion text, p_archivos text[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare op public.match_operaciones; r uuid;
begin
  select * into op from public.match_operaciones where id = p_op for update;
  if op.id is null or op.cliente_id <> auth.uid() then raise exception 'No encontramos la operación'; end if;
  if op.estado not in ('reserva_confirmada', 'pendiente_confirmacion') then
    raise exception 'Ya no se puede reclamar por esta %: escribinos a soporte', op.tipo;
  end if;
  if exists (select 1 from unnest(coalesce(p_archivos, '{}')) a where split_part(a, '/', 1) <> auth.uid()::text) then
    raise exception 'Archivo no válido';
  end if;
  insert into public.match_reclamos (operacion_id, cliente_id, profesional_id, tipo, descripcion, archivos)
  values (op.id, op.cliente_id, op.profesional_id, op.tipo, trim(p_descripcion), coalesce(p_archivos, '{}'))
  returning id into r;
  update public.match_operaciones set estado = 'en_disputa', actualizado_en = now() where id = op.id;
  perform public._aviso_pro(op.profesional_id, 'match', 'Reclamo recibido',
    format('El cliente reclamó por la %s Nº %s. Contá tu versión desde Match.', op.tipo, op.numero), '/panel/match?operacion=' || op.id);
  perform public._avisar(public._admins(), null, 'match', 'Reclamo recibido', format('Operación Nº %s', op.numero), '/admin/match?ver=reclamos', '{}'::jsonb);
  return r;
exception when unique_violation then raise exception 'Ya hay un reclamo abierto por esta %', op.tipo;
end $$;

create or replace function public.responder_reclamo(p_id uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.match_reclamos;
begin
  select * into r from public.match_reclamos where id = p_id;
  if r.id is null or not public._es_match(r.profesional_id) then raise exception 'No encontramos el reclamo'; end if;
  update public.match_reclamos set respuesta_profesional = nullif(left(trim(coalesce(p_texto, '')), 1000), '') where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 18. Contratación por fuera de TaListo! (sin comisión ni garantía)
-- ---------------------------------------------------------------------
create or replace function public.marcar_externa(p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes;
begin
  select * into s from public.match_solicitudes where id = p_solicitud for update;
  if s.id is null or not (s.cliente_id = auth.uid() or public._es_match(s.profesional_id)) then raise exception 'No encontramos la solicitud'; end if;
  if not exists (select 1 from public.match_operaciones where solicitud_id = s.id and tipo = 'visita'
                  and estado in ('pendiente_confirmacion', 'pendiente_liquidacion', 'liquidado')) then
    raise exception 'Primero tiene que estar hecha la visita técnica';
  end if;
  if exists (select 1 from public.match_operaciones where solicitud_id = s.id and tipo = 'trabajo' and estado <> 'cancelado') then
    raise exception 'El trabajo ya se contrató con garantía TaListo!';
  end if;
  update public.match_solicitudes set estado = 'externa', modalidad = 'externa', actualizado_en = now() where id = s.id;
  update public.match_operaciones set externa = true where solicitud_id = s.id and tipo = 'visita';
  perform public._evento(auth.uid(), 'contratacion_externa', 'match', s.profesional_id);
end $$;

-- ---------------------------------------------------------------------
-- 19. Vencimientos: pagos no hechos, solicitudes viejas y confirmación automática
--     (corre al abrir Match y una vez por día; no hace nada si corrió hace poco)
-- ---------------------------------------------------------------------
create or replace function public.match_procesar_vencidos()
returns json language plpgsql security definer set search_path = public as $$
declare a int := 0; b int := 0; k int := 0; d int := 0; r record; c public.configuracion := public._cfg();
begin
  if not pg_try_advisory_xact_lock(hashtext('match_vencidos')) then return json_build_object('omitido', true); end if;
  if (select ultima from public.match_tareas where id = 1) > now() - interval '1 minute' then return json_build_object('omitido', true); end if;
  update public.match_tareas set ultima = now() where id = 1;

  for r in select id, turno_id from public.match_operaciones where estado = 'pendiente_pago' and vence_pago_en < now() for update skip locked loop
    update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'No se pagó a tiempo' where id = r.id;
    update public.turnos set estado = 'cancelado', nota_estado = 'Reserva sin pagar' where id = r.turno_id and estado = 'pendiente';
    a := a + 1;
  end loop;

  for r in select id from public.match_solicitudes s where estado = 'abierta' and vence_en < now()
             and not exists (select 1 from public.match_operaciones o where o.solicitud_id = s.id and o.estado = 'pendiente_pago') loop
    update public.match_solicitudes set estado = 'vencida', actualizado_en = now() where id = r.id;
    update public.match_invitaciones set estado = 'vencida' where solicitud_id = r.id and estado in ('pendiente', 'aceptada');
    b := b + 1;
  end loop;

  -- visitas pasadas que nadie marcó: se le pregunta al cliente (puede reclamar) y después se confirman solas
  for r in select o.id, o.cliente_id, o.solicitud_id from public.match_operaciones o join public.turnos t on t.id = o.turno_id
            where o.estado = 'reserva_confirmada' and t.fin < now() - interval '24 hours' loop
    update public.match_operaciones set estado = 'pendiente_confirmacion', realizado_en = coalesce(realizado_en, now()),
           confirmar_hasta = now() + make_interval(hours => c.confirmacion_auto_horas) where id = r.id;
    perform public._aviso_cliente(r.cliente_id, 'match', '¿Se hizo la visita?',
      format('Confirmala o reclamá. Si no respondés, se confirma sola en %s horas.', c.confirmacion_auto_horas), '/match/solicitud/' || r.solicitud_id);
  end loop;

  for r in select o.id from public.match_operaciones o where o.estado = 'pendiente_confirmacion' and o.confirmar_hasta < now()
             and not exists (select 1 from public.match_reclamos x where x.operacion_id = o.id and x.estado = 'abierto') loop
    perform public._confirmar_operacion(r.id, 'automatica');
    k := k + 1;
  end loop;
  return json_build_object('pagos_vencidos', a, 'solicitudes_vencidas', b, 'confirmadas', k);
end $$;

-- ---------------------------------------------------------------------
-- 20. Consultas del cliente
-- ---------------------------------------------------------------------
create or replace function public._prof_publico(p uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', pr.id, 'nombre', coalesce(nullif(pr.nombre_publico, ''), pe.nombre), 'bio', pr.bio, 'verificado', pr.verificado,
    'departamentos', pr.departamentos, 'slug', pr.slug,
    'calificacion', (select json_build_object('promedio', round(avg(puntaje), 1), 'cantidad', count(*)) from public.match_calificaciones where profesional_id = pr.id),
    'visitas', (select count(*) from public.match_operaciones where profesional_id = pr.id and tipo = 'visita' and realizado_en is not null),
    'rubros', (select coalesce(json_agg(k.nombre order by k.orden), '[]') from public.categorias k join public.match_perfiles m on k.id = any(m.rubros)
                where m.profesional_id = pr.id))
  from public.profesionales pr join public.perfiles pe on pe.id = pr.id where pr.id = p;
$$;

create or replace function public.mis_solicitudes()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(x order by x.creado_en desc), '[]') from (
    select s.id, s.numero, s.titulo, s.estado, s.modalidad, s.sin_profesionales, s.creado_en, public._rubro(s.categoria_id) as rubro,
           s.departamento, s.localidad,
           (select count(*) from public.match_invitaciones i where i.solicitud_id = s.id and i.estado in ('aceptada', 'elegida')) as aceptaron,
           (select o.estado from public.match_operaciones o where o.solicitud_id = s.id and o.estado <> 'cancelado' order by o.creado_en desc limit 1) as operacion,
           public._nombre_de(s.profesional_id) as profesional
      from public.match_solicitudes s where s.cliente_id = auth.uid()) x;
$$;

create or replace function public.solicitud_cliente(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg();
begin
  select * into s from public.match_solicitudes where id = p_id;
  if s.id is null or (s.cliente_id <> auth.uid() and not public.es_admin()) then raise exception 'No encontramos la solicitud'; end if;
  return json_build_object(
    'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo, 'descripcion', s.descripcion, 'estado', s.estado,
       'modalidad', s.modalidad, 'rubro', public._rubro(s.categoria_id), 'categoria_id', s.categoria_id, 'departamento', s.departamento,
       'localidad', s.localidad, 'direccion', s.direccion, 'referencia', s.referencia, 'preferencia', s.preferencia, 'urgente', s.urgente,
       'archivos', s.archivos, 'creado_en', s.creado_en, 'vence_en', s.vence_en, 'sin_profesionales', s.sin_profesionales),
    'config', json_build_object('precio_visita', c.precio_visita, 'cancelacion_horas', c.cancelacion_horas,
       'cancelacion_tarde_pct', c.cancelacion_tarde_pct, 'confirmacion_auto_horas', c.confirmacion_auto_horas,
       'duracion_visita_min', c.duracion_visita_min, 'garantia_dias', c.garantia_dias, 'comision_pct', c.trabajo_comision_pct),
    'invitados', (select count(*) from public.match_invitaciones where solicitud_id = s.id),
    'esperando', (select count(*) from public.match_invitaciones where solicitud_id = s.id and estado = 'pendiente'),
    'propuestas', (select coalesce(json_agg(json_build_object('invitacion', i.id, 'estado', i.estado, 'mensaje', i.mensaje,
                      'precio_visita', i.precio_visita, 'respondida_en', i.respondida_en, 'profesional', public._prof_publico(i.profesional_id))
                      order by i.respondida_en), '[]')
                     from public.match_invitaciones i where i.solicitud_id = s.id and i.estado in ('aceptada', 'elegida')),
    'operaciones', (select coalesce(json_agg(json_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'estado', o.estado,
                      'estado_pago', o.estado_pago, 'importe', o.importe, 'reintegrado', o.reintegrado, 'vence_pago_en', o.vence_pago_en,
                      'pagado_en', o.pagado_en, 'realizado_en', o.realizado_en, 'confirmar_hasta', o.confirmar_hasta, 'diagnostico', o.diagnostico,
                      'profesional', public._prof_publico(o.profesional_id), 'externa', o.externa,
                      'turno', (select json_build_object('inicio', t.inicio, 'fin', t.fin, 'estado', t.estado) from public.turnos t where t.id = o.turno_id),
                      'calificacion', (select json_build_object('puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta)
                                         from public.match_calificaciones k where k.operacion_id = o.id),
                      'reclamo', (select json_build_object('id', r.id, 'estado', r.estado, 'descripcion', r.descripcion, 'resolucion', r.resolucion,
                                    'respuesta_profesional', r.respuesta_profesional) from public.match_reclamos r where r.operacion_id = o.id
                                    order by r.creado_en desc limit 1),
                      'devoluciones', (select coalesce(json_agg(json_build_object('monto', d.monto, 'estado', d.estado, 'motivo', d.motivo)), '[]')
                                         from public.match_devoluciones d where d.operacion_id = o.id))
                      order by o.creado_en desc), '[]')
                     from public.match_operaciones o where o.solicitud_id = s.id and not (o.estado = 'cancelado' and o.estado_pago = 'vencido'))
  );
end $$;

-- Horarios libres de un profesional que aceptó (para elegir la visita)
create or replace function public.horarios_visita(p_invitacion uuid, p_desde date default null, p_dias int default 7)
returns json language plpgsql stable security definer set search_path = public as $$
declare i public.match_invitaciones; c public.configuracion := public._cfg(); d0 date := coalesce(p_desde, (now() at time zone 'America/Montevideo')::date);
begin
  select * into i from public.match_invitaciones where id = p_invitacion;
  if i.id is null or not exists (select 1 from public.match_solicitudes where id = i.solicitud_id and cliente_id = auth.uid()) then
    raise exception 'No encontramos el profesional';
  end if;
  return (select coalesce(json_agg(h.desde order by h.desde), '[]') from generate_series(d0, d0 + least(greatest(p_dias, 1), 21) - 1, interval '1 day') g,
          lateral public.horarios_disponibles(i.profesional_id, g::date, c.duracion_visita_min) h
          where h.desde >= now() + interval '2 hours');
end $$;

-- Profesionales que hacen visitas por rubro y departamento (para buscar)
create or replace function public.profesionales_match(p_categoria smallint default null, p_departamento text default null)
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(public._prof_publico(x.id) order by x.verificado desc, x.prom desc nulls last, x.id), '[]') from (
    select p.id, p.verificado, (select avg(puntaje) from public.match_calificaciones k where k.profesional_id = p.id) prom
      from public.profesionales p join public.match_perfiles m on m.profesional_id = p.id and m.disponible
     where p.activo and (p_categoria is null or p_categoria = any(m.rubros))
       and (p_departamento is null or p_departamento = any(p.departamentos))
     limit 60) x;
$$;

-- Perfil público con las valoraciones verificadas
create or replace function public.perfil_match(p_id uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('profesional', public._prof_publico(p_id),
    'disponible', coalesce((select disponible from public.match_perfiles where profesional_id = p_id), false),
    'calificaciones', (select coalesce(json_agg(json_build_object('puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta,
         'tipo', k.tipo, 'fecha', k.creado_en, 'cliente', split_part(coalesce(nullif(pe.nombre, ''), 'Cliente'), ' ', 1)) order by k.creado_en desc), '[]')
       from (select * from public.match_calificaciones where profesional_id = p_id order by creado_en desc limit 30) k
       join public.perfiles pe on pe.id = k.cliente_id),
    'proximo', (select min(h.desde) from generate_series((now() at time zone 'America/Montevideo')::date,
                  (now() at time zone 'America/Montevideo')::date + 6, interval '1 day') g, lateral public.horarios_disponibles(p_id, g::date, null) h
                 where h.desde >= now() + interval '2 hours'))
  where exists (select 1 from public.profesionales where id = p_id and activo);
$$;

-- ---------------------------------------------------------------------
-- 21. Bandeja del profesional
-- ---------------------------------------------------------------------
create or replace function public.match_bandeja(p_cuenta uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  perform public.match_procesar_vencidos();
  perform public._evento(auth.uid(), 'consulto_solicitudes', 'match', p_cuenta);
  return json_build_object(
    'solicitudes', (select coalesce(json_agg(json_build_object('invitacion', i.id, 'estado', i.estado, 'creado_en', i.creado_en, 'vista_en', i.vista_en,
        'mensaje', i.mensaje, 'precio_visita', i.precio_visita, 'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo,
          'descripcion', s.descripcion, 'rubro', public._rubro(s.categoria_id), 'departamento', s.departamento, 'localidad', s.localidad,
          'preferencia', s.preferencia, 'urgente', s.urgente, 'archivos', s.archivos, 'estado', s.estado, 'dirigida', s.dirigida_a is not null))
        order by (i.estado = 'pendiente') desc, i.creado_en desc), '[]')
      from public.match_invitaciones i join public.match_solicitudes s on s.id = i.solicitud_id
     where i.profesional_id = p_cuenta and i.estado in ('pendiente', 'aceptada') and s.estado = 'abierta'),
    'visitas', (select coalesce(json_agg(public._op_profesional(o.id) order by t.inicio), '[]')
      from public.match_operaciones o left join public.turnos t on t.id = o.turno_id
     where o.profesional_id = p_cuenta and o.estado in ('reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
    'historial', (select coalesce(json_agg(public._op_profesional(o.id) order by o.creado_en desc), '[]')
      from (select * from public.match_operaciones where profesional_id = p_cuenta and estado in ('pendiente_liquidacion', 'liquidado', 'reembolsado', 'cancelado')
              and estado_pago <> 'vencido' order by creado_en desc limit 40) o),
    'cobros', json_build_object(
      'pendiente', (select coalesce(sum(liquidacion_monto), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion = 'pendiente'),
      'retenido', (select coalesce(sum(neto_profesional), 0) from public.match_operaciones where profesional_id = p_cuenta
                    and estado in ('reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
      'cobrado', (select coalesce(sum(monto), 0) from public.match_liquidaciones where profesional_id = p_cuenta),
      'retenciones', (select coalesce(sum(ret_profesional + comision), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion <> 'no_corresponde'),
      'costo_mp', (select coalesce(sum(mp_costo_profesional), 0) from public.match_operaciones where profesional_id = p_cuenta and estado_liquidacion <> 'no_corresponde'),
      'penalizaciones', (select coalesce(-sum(importe), 0) from public.match_movimientos where profesional_id = p_cuenta and tipo = 'penalizacion' and liquidacion_id is null),
      'liquidaciones', (select coalesce(json_agg(json_build_object('numero', l.numero, 'monto', l.monto, 'fecha', l.fecha, 'referencia', l.referencia,
                          'operaciones', l.operaciones) order by l.creado_en desc), '[]')
                         from (select * from public.match_liquidaciones where profesional_id = p_cuenta order by creado_en desc limit 24) l)),
    'calificaciones', (select coalesce(json_agg(json_build_object('id', k.id, 'puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta,
                          'tipo', k.tipo, 'fecha', k.creado_en) order by k.creado_en desc), '[]')
                        from (select * from public.match_calificaciones where profesional_id = p_cuenta order by creado_en desc limit 30) k),
    'perfil', public.match_mi_perfil(p_cuenta),
    'config', (select json_build_object('precio_visita', precio_visita, 'neto_visita', visita_neto_profesional, 'ret_profesional', visita_ret_profesional,
                 'mp_costo_profesional_pct', mp_costo_profesional_pct, 'liquidacion_dias', liquidacion_dias, 'confirmacion_auto_horas', confirmacion_auto_horas,
                 'comision_pct', public._comision_pct(p_cuenta, null), 'penalizacion', penalizacion_profesional) from public.configuracion where id = 1));
end $$;

-- Una operación vista por el profesional: la dirección y el contacto solo después del pago
create or replace function public._op_profesional(p_op uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'estado', o.estado, 'estado_pago', o.estado_pago,
    'estado_liquidacion', o.estado_liquidacion, 'importe', o.importe, 'neto_profesional', o.neto_profesional, 'ret_profesional', o.ret_profesional,
    'comision', o.comision, 'mp_costo_profesional', o.mp_costo_profesional, 'liquidacion_monto', o.liquidacion_monto, 'reintegrado', o.reintegrado,
    'confirmar_hasta', o.confirmar_hasta, 'realizado_en', o.realizado_en, 'diagnostico', o.diagnostico, 'externa', o.externa, 'motivo', o.motivo,
    'creado_en', o.creado_en,
    'turno', (select json_build_object('id', t.id, 'inicio', t.inicio, 'fin', t.fin, 'estado', t.estado) from public.turnos t where t.id = o.turno_id),
    'solicitud', json_build_object('id', s.id, 'numero', s.numero, 'titulo', s.titulo, 'descripcion', s.descripcion, 'rubro', public._rubro(s.categoria_id),
       'departamento', s.departamento, 'localidad', s.localidad, 'archivos', s.archivos, 'estado', s.estado,
       'direccion', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.direccion end,
       'referencia', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.referencia end,
       'lat', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.lat end,
       'lng', case when o.estado_pago in ('pagado', 'reembolso_parcial') then s.lng end),
    'cliente', case when o.estado_pago in ('pagado', 'reembolso_parcial') then
       (select json_build_object('nombre', coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1)), 'telefono', pe.telefono)
          from public.perfiles pe where pe.id = o.cliente_id) end,
    'reclamo', (select json_build_object('id', r.id, 'estado', r.estado, 'descripcion', r.descripcion, 'archivos', r.archivos,
                  'respuesta_profesional', r.respuesta_profesional, 'resolucion', r.resolucion)
                  from public.match_reclamos r where r.operacion_id = o.id order by r.creado_en desc limit 1),
    'calificacion', (select json_build_object('id', k.id, 'puntaje', k.puntaje, 'comentario', k.comentario, 'respuesta', k.respuesta)
                       from public.match_calificaciones k where k.operacion_id = o.id))
  from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id where o.id = p_op;
$$;

create or replace function public.marcar_invitacion_vista(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.match_invitaciones set vista_en = now() where id = p_id and vista_en is null and public._es_match(profesional_id);
$$;

-- ---------------------------------------------------------------------
-- 22. Administración (todo exige ser admin del lado de la base)
-- ---------------------------------------------------------------------
create or replace function public._exigir_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then raise exception 'Solo el administrador de TaListo! puede hacer esto'; end if;
end $$;

-- p: columnas de configuracion comercial (las que vengan)
create or replace function public.guardar_config_match(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare c public.configuracion := public._cfg(); n public.configuracion;
begin
  perform public._exigir_admin();
  n := jsonb_populate_record(c, p - 'id' - 'actualizado_en' - 'actualizado_por');
  if n.precio_visita <> n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional then
    raise exception 'El reparto no coincide con el precio: % + % + % = %, y la visita cuesta %', public._pesos(n.visita_ret_cliente),
      public._pesos(n.visita_ret_profesional), public._pesos(n.visita_neto_profesional),
      public._pesos(n.visita_ret_cliente + n.visita_ret_profesional + n.visita_neto_profesional), public._pesos(n.precio_visita);
  end if;
  update public.configuracion set
    precio_visita = n.precio_visita, comision_visita = n.visita_ret_cliente + n.visita_ret_profesional,
    visita_ret_cliente = n.visita_ret_cliente, visita_ret_profesional = n.visita_ret_profesional, visita_neto_profesional = n.visita_neto_profesional,
    duracion_visita_min = n.duracion_visita_min, trabajo_comision_pct = n.trabajo_comision_pct, trabajo_comision_activa = n.trabajo_comision_activa,
    comision_por_rubro = n.comision_por_rubro, mp_costo_profesional_pct = n.mp_costo_profesional_pct, acreditar_visita = n.acreditar_visita,
    confirmacion_auto_horas = n.confirmacion_auto_horas, liquidacion_dias = n.liquidacion_dias, cancelacion_horas = n.cancelacion_horas,
    cancelacion_tarde_pct = n.cancelacion_tarde_pct, penalizacion_profesional = n.penalizacion_profesional, devolucion_dias = n.devolucion_dias,
    pago_minutos = n.pago_minutos, solicitud_dias = n.solicitud_dias, max_invitados = n.max_invitados, solo_verificados = n.solo_verificados,
    garantia_dias = n.garantia_dias, garantia_cobertura = left(n.garantia_cobertura, 1500), garantia_exclusiones = left(n.garantia_exclusiones, 1500),
    reclamo_procedimiento = left(n.reclamo_procedimiento, 1500)
   where id = 1;
  return (select to_json(x) from public.configuracion x where id = 1);
end $$;

create or replace function public.guardar_comision_especial(p_id uuid, p_tipo text, p_categoria smallint, p_profesional uuid,
                                                           p_pct numeric, p_activa boolean, p_notas text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.match_comisiones; r uuid; ref text;
begin
  perform public._exigir_admin();
  if p_pct is null or p_pct < 0 or p_pct > 50 then raise exception 'La comisión va de 0 a 50 %%'; end if;
  ref := case when p_tipo = 'rubro' then 'Rubro: ' || public._rubro(p_categoria) else 'Cuenta: ' || public._nombre_de(p_profesional) end;
  if p_id is not null then
    select * into v from public.match_comisiones where id = p_id for update;
    if v.id is null then raise exception 'No encontramos la comisión'; end if;
    update public.match_comisiones set pct = p_pct, activa = p_activa, notas = nullif(trim(coalesce(p_notas, '')), ''), actualizado_en = now()
     where id = p_id returning id into r;
    insert into public.config_historial (ambito, referencia, campo, valor_anterior, valor_nuevo, admin_id, admin_nombre)
    values ('comision', ref, 'pct / activa', v.pct || ' % / ' || v.activa, p_pct || ' % / ' || p_activa, auth.uid(), public._nombre_de(auth.uid()));
  else
    insert into public.match_comisiones (tipo, categoria_id, profesional_id, pct, activa, notas)
    values (p_tipo, case when p_tipo = 'rubro' then p_categoria end, case when p_tipo = 'cuenta' then p_profesional end, p_pct,
            coalesce(p_activa, true), nullif(trim(coalesce(p_notas, '')), '')) returning id into r;
    insert into public.config_historial (ambito, referencia, campo, valor_anterior, valor_nuevo, admin_id, admin_nombre)
    values ('comision', ref, 'nueva', null, p_pct || ' %', auth.uid(), public._nombre_de(auth.uid()));
  end if;
  return r;
exception when unique_violation then raise exception 'Ya hay una comisión especial para eso: editala';
end $$;

-- Rubros: crear, editar, desactivar y ordenar
create or replace function public.guardar_rubro(p_id smallint, p_nombre text, p_sinonimos text[], p_activa boolean, p_icono text default null)
returns smallint language plpgsql security definer set search_path = public as $$
declare v public.categorias; r smallint;
begin
  perform public._exigir_admin();
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Poné el nombre del rubro'; end if;
  if p_id is null then
    insert into public.categorias (nombre, slug, sinonimos, orden, activa, icono)
    values (trim(p_nombre), public.slugify(p_nombre), coalesce(p_sinonimos, '{}'), (select coalesce(max(orden), 0) + 1 from public.categorias),
            coalesce(p_activa, true), nullif(p_icono, '')) returning id into r;
    insert into public.config_historial (ambito, referencia, campo, valor_nuevo, admin_id, admin_nombre)
    values ('rubro', trim(p_nombre), 'nuevo', trim(p_nombre), auth.uid(), public._nombre_de(auth.uid()));
  else
    select * into v from public.categorias where id = p_id for update;
    update public.categorias set nombre = trim(p_nombre), sinonimos = coalesce(p_sinonimos, '{}'), activa = coalesce(p_activa, activa),
           icono = nullif(p_icono, '') where id = p_id returning id into r;
    insert into public.config_historial (ambito, referencia, campo, valor_anterior, valor_nuevo, admin_id, admin_nombre)
    select 'rubro', v.nombre, x.campo, x.antes, x.despues, auth.uid(), public._nombre_de(auth.uid())
      from (values ('nombre', v.nombre, trim(p_nombre)), ('activo', v.activa::text, coalesce(p_activa, v.activa)::text),
                   ('sinonimos', array_to_string(v.sinonimos, ', '), array_to_string(coalesce(p_sinonimos, '{}'), ', '))) x(campo, antes, despues)
     where x.antes is distinct from x.despues;
  end if;
  return r;
exception when unique_violation then raise exception 'Ya existe un rubro con ese nombre';
end $$;

create or replace function public.ordenar_rubros(p_ids smallint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._exigir_admin();
  update public.categorias c set orden = x.k from unnest(p_ids) with ordinality x(id, k) where c.id = x.id;
  insert into public.config_historial (ambito, campo, valor_nuevo, admin_id, admin_nombre)
  values ('rubro', 'orden', (select string_agg(nombre, ' · ' order by orden) from public.categorias), auth.uid(), public._nombre_de(auth.uid()));
end $$;

create or replace function public.admin_config_historial(p_limite int default 100)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_admin();
  return (select coalesce(json_agg(h order by h.creado_en desc), '[]') from
           (select * from public.config_historial order by creado_en desc limit least(greatest(p_limite, 1), 500)) h);
end $$;

create or replace function public.admin_comisiones()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exigir_admin();
  return (select coalesce(json_agg(json_build_object('id', m.id, 'tipo', m.tipo, 'categoria_id', m.categoria_id, 'rubro', public._rubro(m.categoria_id),
            'profesional_id', m.profesional_id, 'profesional', public._nombre_de(m.profesional_id), 'pct', m.pct, 'activa', m.activa, 'notas', m.notas)
            order by m.tipo, m.creado_en), '[]') from public.match_comisiones m);
end $$;

-- Operaciones con filtros (estado o grupo: 'a_liquidar', 'devoluciones', 'reclamos')
create or replace function public.admin_match(p_ver text default 'operaciones', p_texto text default null)
returns json language plpgsql security definer set search_path = public as $$
declare q text := public.normalizar(trim(coalesce(p_texto, '')));
begin
  perform public._exigir_admin();
  perform public.match_procesar_vencidos();
  return json_build_object(
    'resumen', json_build_object(
      'a_liquidar', (select coalesce(sum(liquidacion_monto), 0) from public.match_operaciones where estado_liquidacion = 'pendiente'),
      'a_liquidar_ops', (select count(*) from public.match_operaciones where estado_liquidacion = 'pendiente'),
      'retenido', (select coalesce(sum(importe - reintegrado), 0) from public.match_operaciones
                    where estado in ('reserva_confirmada', 'pendiente_confirmacion', 'en_disputa', 'trabajo_en_curso')),
      'devoluciones', (select count(*) from public.match_devoluciones where estado in ('pendiente', 'aprobada', 'error')),
      'reclamos', (select count(*) from public.match_reclamos where estado = 'abierto'),
      'sin_profesionales', (select count(*) from public.match_solicitudes where sin_profesionales and estado = 'abierta')),
    'operaciones', case when p_ver in ('operaciones', 'a_liquidar') then (
      select coalesce(json_agg(x order by x.creado_en desc), '[]') from (
        select o.id, o.numero, o.tipo, o.estado, o.estado_pago, o.estado_liquidacion, o.importe, o.ret_cliente, o.ret_profesional, o.comision,
               o.neto_profesional, o.mp_costo, o.mp_costo_profesional, o.mp_costo_talisto, o.liquidacion_monto, o.ingreso_talisto, o.reintegrado,
               o.mp_pago_id, o.pagado_en, o.confirmado_en, o.confirmado_por, o.creado_en, o.profesional_id, o.externa,
               public._nombre_de(o.profesional_id) as profesional, public._nombre_de(o.cliente_id) as cliente, public._rubro(o.categoria_id) as rubro,
               (select json_build_object('banco', d.banco, 'tipo_cuenta', d.tipo_cuenta, 'numero', d.numero, 'sucursal', d.sucursal, 'titular', d.titular,
                         'documento', d.documento) from public.match_datos_cobro d where d.profesional_id = o.profesional_id) as cobro
          from public.match_operaciones o
         where (p_ver <> 'a_liquidar' or o.estado_liquidacion = 'pendiente')
           and not (o.estado = 'cancelado' and o.estado_pago = 'vencido' and p_ver = 'operaciones' and q = '')
           and (q = '' or public.normalizar(public._nombre_de(o.profesional_id) || ' ' || public._nombre_de(o.cliente_id) || ' ' || o.numero) like '%' || q || '%')
         order by o.creado_en desc limit 300) x) end,
    'devoluciones', case when p_ver = 'devoluciones' then (
      select coalesce(json_agg(json_build_object('id', d.id, 'operacion', o.numero, 'operacion_id', o.id, 'monto', d.monto, 'motivo', d.motivo,
               'origen', d.origen, 'estado', d.estado, 'error', d.error, 'creado_en', d.creado_en, 'importe', o.importe, 'mp_pago_id', coalesce(d.mp_pago_id, o.mp_pago_id),
               'cliente', public._nombre_de(o.cliente_id), 'profesional', public._nombre_de(o.profesional_id)) order by d.creado_en desc), '[]')
        from public.match_devoluciones d join public.match_operaciones o on o.id = d.operacion_id
       where d.estado in ('pendiente', 'aprobada', 'error') or d.creado_en > now() - interval '60 days') end,
    'reclamos', case when p_ver = 'reclamos' then (
      select coalesce(json_agg(json_build_object('id', r.id, 'numero', r.numero, 'operacion', o.numero, 'operacion_id', o.id, 'tipo', r.tipo,
               'descripcion', r.descripcion, 'archivos', r.archivos, 'estado', r.estado, 'accion', r.accion, 'resolucion', r.resolucion,
               'respuesta_profesional', r.respuesta_profesional, 'creado_en', r.creado_en, 'importe', o.importe, 'estado_operacion', o.estado,
               'cliente', public._nombre_de(r.cliente_id), 'profesional', public._nombre_de(r.profesional_id)) order by (r.estado = 'abierto') desc, r.creado_en desc), '[]')
        from public.match_reclamos r join public.match_operaciones o on o.id = r.operacion_id
       where r.estado = 'abierto' or r.creado_en > now() - interval '90 days') end,
    'liquidaciones', case when p_ver = 'a_liquidar' then (
      select coalesce(json_agg(json_build_object('numero', l.numero, 'profesional', public._nombre_de(l.profesional_id), 'monto', l.monto,
               'fecha', l.fecha, 'referencia', l.referencia, 'operaciones', l.operaciones) order by l.creado_en desc), '[]')
        from (select * from public.match_liquidaciones order by creado_en desc limit 50) l) end
  );
end $$;

-- Liquidar: el admin ya transfirió y lo registra con la referencia
create or replace function public.admin_liquidar(p_profesional uuid, p_operaciones uuid[], p_referencia text, p_fecha date default null,
                                                 p_metodo text default 'transferencia', p_notas text default null)
returns json language plpgsql security definer set search_path = public as $$
declare total numeric; n int; pen numeric; l public.match_liquidaciones; aplicar numeric;
begin
  perform public._exigir_admin();
  if coalesce(trim(p_referencia), '') = '' then raise exception 'Poné la referencia de la transferencia'; end if;
  perform 1 from public.match_operaciones where id = any(p_operaciones) for update;
  select count(*), coalesce(sum(liquidacion_monto), 0) into n, total from public.match_operaciones
   where id = any(p_operaciones) and profesional_id = p_profesional and estado_liquidacion = 'pendiente';
  if n = 0 or n <> cardinality(p_operaciones) then raise exception 'Alguna operación ya se liquidó o no es de este profesional'; end if;
  select coalesce(-sum(importe), 0) into pen from public.match_movimientos where profesional_id = p_profesional and tipo = 'penalizacion' and liquidacion_id is null;
  aplicar := least(pen, total);
  insert into public.match_liquidaciones (profesional_id, monto, operaciones, penalizaciones, fecha, metodo, referencia, notas, creado_por)
  values (p_profesional, total - aplicar, n, aplicar, coalesce(p_fecha, current_date), coalesce(p_metodo, 'transferencia'), trim(p_referencia),
          nullif(trim(coalesce(p_notas, '')), ''), auth.uid())
  returning * into l;
  update public.match_operaciones set estado = 'liquidado', estado_liquidacion = 'liquidado', liquidacion_id = l.id, liquidado_en = now(), actualizado_en = now()
   where id = any(p_operaciones);
  if aplicar > 0 then
    update public.match_movimientos set liquidacion_id = l.id where profesional_id = p_profesional and tipo = 'penalizacion' and liquidacion_id is null;
    if pen > aplicar then   -- lo que no alcanzó a descontarse queda para la próxima
      perform public._mov(null, 'penalizacion', 'profesional', -(pen - aplicar), 'Saldo de penalizaciones para la próxima liquidación', null, null, p_profesional);
    end if;
  end if;
  perform public._mov(null, 'liquidacion', 'profesional', l.monto, format('Liquidación Nº %s · %s', l.numero, l.referencia), l.id, null, p_profesional);
  perform public._aviso_pro(p_profesional, 'match', 'Liquidación realizada',
    format('TaListo! te transfirió %s por %s %s (ref. %s).', public._pesos(l.monto), n, case when n = 1 then 'operación' else 'operaciones' end, l.referencia),
    '/panel/match?ver=cobros');
  perform public._evento(p_profesional, 'recibio_pago', 'match', p_profesional);
  return json_build_object('id', l.id, 'numero', l.numero, 'monto', l.monto, 'penalizaciones', aplicar);
end $$;

-- Reclamo: liberar el pago, devolver todo o una parte
create or replace function public.admin_resolver_reclamo(p_id uuid, p_accion text, p_monto numeric default null, p_resolucion text default null)
returns json language plpgsql security definer set search_path = public as $$
declare r public.match_reclamos; op public.match_operaciones; monto numeric;
begin
  perform public._exigir_admin();
  select * into r from public.match_reclamos where id = p_id for update;
  if r.id is null or r.estado <> 'abierto' then raise exception 'Ese reclamo ya está resuelto'; end if;
  select * into op from public.match_operaciones where id = r.operacion_id for update;
  if p_accion not in ('liberar', 'devolver_total', 'devolver_parcial', 'sin_accion') then raise exception 'Acción no válida'; end if;
  update public.match_reclamos set estado = case when p_accion = 'sin_accion' then 'rechazado' else 'resuelto' end, accion = p_accion,
         resolucion = nullif(left(trim(coalesce(p_resolucion, '')), 600), ''), resuelto_por = auth.uid(), resuelto_en = now()
   where id = r.id;
  if p_accion in ('liberar', 'sin_accion') then
    if op.estado = 'en_disputa' then
      update public.match_operaciones set estado = 'pendiente_confirmacion', realizado_en = coalesce(realizado_en, now()) where id = op.id;
      perform public._confirmar_operacion(op.id, 'admin');
    end if;
  else
    monto := case when p_accion = 'devolver_total' then op.importe - op.reintegrado else public._r2(p_monto) end;
    if monto is null or monto <= 0 or monto > op.importe - op.reintegrado then raise exception 'El monto a devolver no es válido'; end if;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen, estado, aprobada_por, confirmar_despues)
    values (op.id, op.mp_pago_id, monto, 'Reclamo Nº ' || r.numero || coalesce(': ' || nullif(trim(p_resolucion), ''), ''), 'reclamo', 'aprobada', auth.uid(),
            monto < op.importe - op.reintegrado);
  end if;
  perform public._aviso_cliente(r.cliente_id, 'match', 'Tu reclamo se resolvió', coalesce(nullif(trim(p_resolucion), ''), 'Revisá el detalle en TaListo!'),
    '/match/solicitud/' || op.solicitud_id);
  perform public._aviso_pro(r.profesional_id, 'match', 'Reclamo resuelto', coalesce(nullif(trim(p_resolucion), ''), 'Revisá el detalle en Match'),
    '/panel/match?operacion=' || op.id);
  return (select json_build_object('devolucion', d.id, 'monto', d.monto) from public.match_devoluciones d
           where d.operacion_id = op.id and d.estado = 'aprobada' order by d.creado_en desc limit 1);
end $$;

-- Devoluciones: el admin aprueba (con el monto final) o rechaza; el servidor la hace en Mercado Pago
create or replace function public.admin_aprobar_devolucion(p_id uuid, p_monto numeric default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare d public.match_devoluciones; op public.match_operaciones; m numeric;
begin
  perform public._exigir_admin();
  select * into d from public.match_devoluciones where id = p_id for update;
  if d.id is null or d.estado not in ('pendiente', 'aprobada', 'error') then raise exception 'Esa devolución ya se resolvió'; end if;
  select * into op from public.match_operaciones where id = d.operacion_id;
  m := case when p_monto is null then d.monto else public._r2(p_monto) end;
  if m <= 0 or (d.origen not in ('pago_duplicado', 'monto_incorrecto', 'pago_tardio') and m > op.importe - op.reintegrado) then
    raise exception 'El monto a devolver no es válido';
  end if;
  update public.match_devoluciones set estado = 'aprobada', monto = m, aprobada_por = auth.uid(), error = null,
         nota_admin = coalesce(nullif(left(trim(coalesce(p_nota, '')), 300), ''), nota_admin),
         confirmar_despues = case when d.origen in ('cliente', 'reclamo') then m < op.importe - op.reintegrado else confirmar_despues end
   where id = d.id;
  return json_build_object('id', d.id, 'monto', m, 'mp_pago_id', coalesce(d.mp_pago_id, op.mp_pago_id));
end $$;

create or replace function public.admin_rechazar_devolucion(p_id uuid, p_nota text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.match_devoluciones; op public.match_operaciones;
begin
  perform public._exigir_admin();
  select * into d from public.match_devoluciones where id = p_id for update;
  if d.id is null or d.estado not in ('pendiente', 'error') then raise exception 'Esa devolución ya se resolvió'; end if;
  update public.match_devoluciones set estado = 'rechazada', nota_admin = left(trim(coalesce(p_nota, '')), 300), aprobada_por = auth.uid(), resuelta_en = now()
   where id = d.id;
  select * into op from public.match_operaciones where id = d.operacion_id;
  -- si no se devuelve, lo cobrado se reparte (cancelaciones)
  if d.origen in ('cliente', 'profesional') and op.estado = 'cancelado' then perform public._confirmar_operacion(op.id, 'cancelacion'); end if;
end $$;

-- El servidor informa el resultado de la devolución en Mercado Pago
create or replace function public.match_devolucion_resultado(p_id uuid, p_ok boolean, p_refund_id text, p_error text default null)
returns json language plpgsql security definer set search_path = public as $$
declare d public.match_devoluciones; op public.match_operaciones; nuevo numeric;
begin
  select * into d from public.match_devoluciones where id = p_id for update;
  if d.id is null then raise exception 'Devolución inexistente'; end if;
  if d.estado = 'ejecutada' then return json_build_object('resultado', 'ya_ejecutada'); end if;
  if not p_ok then
    update public.match_devoluciones set estado = 'error', error = left(p_error, 300) where id = d.id;
    return json_build_object('resultado', 'error');
  end if;
  update public.match_devoluciones set estado = 'ejecutada', mp_refund_id = p_refund_id, resuelta_en = now(), error = null where id = d.id;
  select * into op from public.match_operaciones where id = d.operacion_id for update;
  perform public._mov(op.id, 'reintegro', 'cliente', d.monto, format('Devolución por Mercado Pago (%s)', d.motivo), null, d.id);
  -- un pago que no correspondía (duplicado, tardío, monto mal) no toca la operación
  if d.origen in ('pago_duplicado', 'monto_incorrecto') or (d.origen = 'pago_tardio' and d.mp_pago_id is distinct from op.mp_pago_id) then
    perform public._aviso_cliente(op.cliente_id, 'match', 'Te devolvimos el dinero', format('Devolución de %s por Mercado Pago.', public._pesos(d.monto)),
      '/match/solicitud/' || op.solicitud_id);
    return json_build_object('resultado', 'ejecutada');
  end if;
  nuevo := op.reintegrado + d.monto;
  update public.match_operaciones set reintegrado = nuevo,
         estado_pago = case when nuevo >= importe then 'reembolsado' else 'reembolso_parcial' end,
         estado = case when nuevo >= importe then 'reembolsado' else estado end,
         ingreso_talisto = case when nuevo >= importe then -coalesce(mp_costo, 0) else ingreso_talisto end,
         actualizado_en = now()
   where id = op.id returning * into op;
  if op.estado = 'reembolsado' and coalesce(op.mp_costo, 0) > 0 then
    perform public._mov(op.id, 'ingreso', 'talisto', -op.mp_costo, 'Costo de Mercado Pago de un pago devuelto (lo absorbe TaListo!)');
  end if;
  if d.confirmar_despues and op.estado <> 'reembolsado' then perform public._confirmar_operacion(op.id, 'cancelacion'); end if;
  perform public._aviso_cliente(op.cliente_id, 'match', 'Te devolvimos el dinero', format('Devolución de %s por Mercado Pago.', public._pesos(d.monto)),
    '/match/solicitud/' || op.solicitud_id);
  return json_build_object('resultado', 'ejecutada');
end $$;

-- Avisos que generó el sistema (pagos de Mercado Pago, confirmaciones automáticas) para mandarlos por push
create or replace function public.avisos_para_push_sistema()
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  with pend as (
    update public.notificaciones n set push_en = now()
     where n.id in (select id from public.notificaciones
                     where creado_por is null and push_en is null and creado_en > now() - interval '15 minutes'
                     order by creado_en limit 200)
    returning n.id, n.usuario_id, n.titulo, n.cuerpo, n.url, n.tipo
  )
  select coalesce(json_agg(json_build_object('id', p.id, 'titulo', p.titulo, 'cuerpo', p.cuerpo, 'url', p.url, 'tipo', p.tipo,
           'subs', (select coalesce(json_agg(json_build_object('endpoint', x.endpoint, 'p256dh', x.p256dh, 'auth', x.auth)), '[]'::json)
                      from public.push_suscripciones x where x.usuario_id = p.usuario_id))), '[]'::json)
    into r from pend p;
  return r;
end $$;

-- Para el servidor: ¿el que pide es admin? (rutas /api)
create or replace function public.soy_admin()
returns boolean language sql stable security definer set search_path = public as $$ select public.es_admin() $$;

-- ---------------------------------------------------------------------
-- 23. Archivos (fotos y videos de solicitudes y reclamos), privados
-- ---------------------------------------------------------------------
create or replace function public.ve_archivo_match(p_ruta text)
returns boolean language sql stable security definer set search_path = public as $$
  select split_part(p_ruta, '/', 1) = auth.uid()::text or public.es_admin()
      or exists (select 1 from public.match_solicitudes s join public.match_invitaciones i on i.solicitud_id = s.id
                  where p_ruta = any(s.archivos) and public._es_match(i.profesional_id))
      or exists (select 1 from public.match_reclamos r where p_ruta = any(r.archivos) and public._es_match(r.profesional_id));
$$;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('match', 'match', false, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
    on conflict (id) do update set public = false, file_size_limit = 52428800,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'];
    execute 'drop policy if exists match_leer on storage.objects';
    execute $p$create policy match_leer on storage.objects for select to authenticated
      using (bucket_id = 'match' and public.ve_archivo_match(name))$p$;
    execute 'drop policy if exists match_subir on storage.objects';
    execute $p$create policy match_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'match' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute 'drop policy if exists match_borrar on storage.objects';
    execute $p$create policy match_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'match' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 24. Quién ve qué (solo lectura; todo se escribe con las funciones)
-- ---------------------------------------------------------------------
alter table public.config_historial enable row level security;
alter table public.match_comisiones enable row level security;
alter table public.match_perfiles enable row level security;
alter table public.match_datos_cobro enable row level security;
alter table public.match_solicitudes enable row level security;
alter table public.match_invitaciones enable row level security;
alter table public.match_liquidaciones enable row level security;
alter table public.match_operaciones enable row level security;
alter table public.match_pagos enable row level security;
alter table public.match_devoluciones enable row level security;
alter table public.match_reclamos enable row level security;
alter table public.match_calificaciones enable row level security;
alter table public.match_movimientos enable row level security;
alter table public.eventos enable row level security;
alter table public.match_tareas enable row level security;

do $$
declare t text;
begin
  foreach t in array array['config_historial', 'match_comisiones', 'match_perfiles', 'match_datos_cobro', 'match_solicitudes', 'match_invitaciones',
                           'match_liquidaciones', 'match_operaciones', 'match_pagos', 'match_devoluciones', 'match_reclamos', 'match_calificaciones',
                           'match_movimientos', 'eventos', 'match_tareas'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

create policy config_historial_leer on public.config_historial for select using (public.es_admin());
create policy match_comisiones_leer on public.match_comisiones for select using (public.es_admin() or public._es_match(profesional_id));
create policy match_perfiles_leer on public.match_perfiles for select using (public.es_admin() or public._es_match(profesional_id));
create policy match_datos_cobro_leer on public.match_datos_cobro for select using (public.es_admin() or profesional_id = (select auth.uid()));
create policy match_solicitudes_leer on public.match_solicitudes for select using (cliente_id = (select auth.uid()) or public.es_admin());
create policy match_invitaciones_leer on public.match_invitaciones for select using (public.es_admin() or public._es_match(profesional_id));
create policy match_liquidaciones_leer on public.match_liquidaciones for select
  using (public.es_admin() or public.puede(profesional_id, array['match', 'importes']));
create policy match_operaciones_leer on public.match_operaciones for select
  using (cliente_id = (select auth.uid()) or public.es_admin() or public._es_match(profesional_id));
create policy match_pagos_leer on public.match_pagos for select using (public.es_admin());
create policy match_devoluciones_leer on public.match_devoluciones for select using (public.es_admin());
create policy match_reclamos_leer on public.match_reclamos for select
  using (cliente_id = (select auth.uid()) or public.es_admin() or public._es_match(profesional_id));
create policy match_calificaciones_leer on public.match_calificaciones for select
  using (cliente_id = (select auth.uid()) or public.es_admin() or public._es_match(profesional_id));
create policy match_movimientos_leer on public.match_movimientos for select
  using (public.es_admin() or public.puede(profesional_id, array['match', 'importes']));
create policy eventos_leer on public.eventos for select using (public.es_admin());
create policy match_tareas_leer on public.match_tareas for select using (public.es_admin());
grant select on public.config_historial, public.match_comisiones, public.match_perfiles, public.match_datos_cobro, public.match_solicitudes,
  public.match_invitaciones, public.match_liquidaciones, public.match_operaciones, public.match_pagos, public.match_devoluciones,
  public.match_reclamos, public.match_calificaciones, public.match_movimientos, public.eventos, public.match_tareas to authenticated;

-- El admin edita los rubros solo con las funciones
drop policy if exists categorias_admin on public.categorias;

do $$
declare f text;
begin
  -- para cualquier usuario con sesión (cada función controla quién puede)
  foreach f in array array[
    'public.registrar_evento(text, text)', 'public.guardar_match_perfil(uuid, jsonb)', 'public.match_mi_perfil(uuid)',
    'public.crear_solicitud(jsonb)', 'public.cancelar_solicitud(uuid, text)', 'public.responder_invitacion(uuid, boolean, text)',
    'public.elegir_profesional(uuid, timestamptz)', 'public.operacion_a_pagar(uuid)', 'public.visita_realizada(uuid, text)',
    'public.confirmar_visita(uuid)', 'public.calificar(uuid, int, text)', 'public.responder_calificacion(uuid, text)',
    'public.cancelar_visita(uuid, text)', 'public.reclamar(uuid, text, text[])', 'public.responder_reclamo(uuid, text)',
    'public.marcar_externa(uuid)', 'public.match_procesar_vencidos()', 'public.mis_solicitudes()', 'public.solicitud_cliente(uuid)',
    'public.horarios_visita(uuid, date, int)', 'public.match_bandeja(uuid)', 'public.marcar_invitacion_vista(uuid)',
    'public.guardar_config_match(jsonb)', 'public.guardar_comision_especial(uuid, text, smallint, uuid, numeric, boolean, text)',
    'public.guardar_rubro(smallint, text, text[], boolean, text)', 'public.ordenar_rubros(smallint[])', 'public.admin_config_historial(int)',
    'public.admin_comisiones()', 'public.admin_match(text, text)', 'public.admin_liquidar(uuid, uuid[], text, date, text, text)',
    'public.admin_resolver_reclamo(uuid, text, numeric, text)', 'public.admin_aprobar_devolucion(uuid, numeric, text)',
    'public.admin_rechazar_devolucion(uuid, text)', 'public.soy_admin()', 'public.ve_archivo_match(text)', 'public._es_match(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- públicas (también sin sesión: buscar profesionales y ver perfiles)
  foreach f in array array['public.profesionales_match(smallint, text)', 'public.perfil_match(uuid)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
  -- solo el servidor (pagos y devoluciones confirmados por Mercado Pago) y uso interno
  foreach f in array array[
    'public.match_aplicar_pago(uuid, jsonb)', 'public.match_guardar_preferencia(uuid, text)', 'public.match_devolucion_resultado(uuid, boolean, text, text)',
    'public._cfg()', 'public._comision_pct(uuid, smallint)', 'public._invitables(uuid)',
    'public._mov(uuid, text, text, numeric, text, uuid, uuid, uuid)', 'public._admins()', 'public._aviso_pro(uuid, text, text, text, text)',
    'public._aviso_cliente(uuid, text, text, text, text)', 'public._rubro(smallint)', 'public._evento(uuid, text, text, uuid)',
    'public._compatibles(uuid)', 'public._confirmar_operacion(uuid, text)', 'public._prof_publico(uuid)', 'public._op_profesional(uuid)',
    'public._exigir_admin()', 'public.historial_configuracion()', 'public.avisos_para_push_sistema()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

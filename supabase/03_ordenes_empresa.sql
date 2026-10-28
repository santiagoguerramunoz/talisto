-- =====================================================================
--  TaListo!  ·  ÓRDENES DE EMPRESA (ej. Grupo Gamma)
--  Trabajos para los clientes de una empresa cliente: se guardan en la orden,
--  NO en "mis clientes". Con número de cliente y de ticket de la empresa,
--  acondicionamientos y MOE (mano de obra especial) para liquidar el mes.
--  También suma la dirección propia de los relevamientos.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 y 02). Es re-ejecutable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Un cliente puede ser "empresa" con su tarifa
--    precio_acondicionamiento: lo que paga por 1 acondicionamiento (editable)
--    factor_moe: cuántos acondicionamientos vale 1 MOE (Gamma: 1,75)
-- ---------------------------------------------------------------------
alter table public.clientes add column if not exists es_empresa boolean not null default false;
alter table public.clientes add column if not exists precio_acondicionamiento numeric(12,2);
alter table public.clientes add column if not exists factor_moe numeric(5,2) not null default 1.75;

alter table public.clientes drop constraint if exists clientes_precio_acond_check;
alter table public.clientes add constraint clientes_precio_acond_check
  check (precio_acondicionamiento is null or precio_acondicionamiento >= 0);
alter table public.clientes drop constraint if exists clientes_factor_moe_check;
alter table public.clientes add constraint clientes_factor_moe_check check (factor_moe > 0);

-- ---------------------------------------------------------------------
-- 2. Órdenes / tickets
-- ---------------------------------------------------------------------
create table if not exists public.ordenes (
  id                        uuid primary key default gen_random_uuid(),
  profesional_id            uuid not null references public.profesionales(id) on delete cascade,
  empresa_id                uuid not null references public.clientes(id) on delete cascade,
  numero_cliente            text,                 -- número de cliente en la empresa
  numero_ticket             text,                 -- ticket interno de la empresa
  fecha                     date not null default current_date,
  hora_inicio               time,                 -- opcional
  hora_fin                  time,
  cliente_final             text,                 -- nombre / detalle del cliente de la empresa
  direccion                 text,
  referencia                text,
  lat                       double precision,
  lng                       double precision,
  pedido                    text,                 -- qué hay que hacer
  realizado                 text,                 -- detalle de lo realizado (va a la planilla)
  acondicionamientos        numeric(5,1) not null default 0,
  moes                      numeric(5,1) not null default 0,
  precio_acondicionamiento  numeric(12,2),        -- foto del precio (editable)
  factor_moe                numeric(5,2) not null default 1.75,
  estado                    text not null default 'pendiente'
                            check (estado in ('pendiente','realizado','cancelado')),
  creado_en                 timestamptz not null default now(),
  actualizado_en            timestamptz not null default now(),
  -- se fraccionan en 2: 0 · 0,5 · 1 · 1,5 …
  constraint ordenes_acond_medios check (acondicionamientos >= 0 and acondicionamientos * 2 = trunc(acondicionamientos * 2)),
  constraint ordenes_moe_medios   check (moes >= 0 and moes * 2 = trunc(moes * 2)),
  constraint ordenes_precio_check check (precio_acondicionamiento is null or precio_acondicionamiento >= 0),
  constraint ordenes_factor_check check (factor_moe > 0),
  constraint ordenes_ubicacion_check check ((lat is null) = (lng is null)),
  constraint ordenes_horario_check check (hora_inicio is null or hora_fin is null or hora_fin > hora_inicio)
);
create index if not exists ordenes_profesional_fecha_idx on public.ordenes (profesional_id, fecha);
create index if not exists ordenes_empresa_fecha_idx on public.ordenes (empresa_id, fecha);
create index if not exists ordenes_ticket_idx on public.ordenes (empresa_id, numero_ticket);

-- La empresa tiene que ser un cliente del profesional; precio y factor de la empresa si no vienen
create or replace function public.preparar_orden()
returns trigger language plpgsql security definer set search_path = public as $$
declare e public.clientes;
begin
  select * into e from public.clientes c where c.id = new.empresa_id and c.profesional_id = new.profesional_id;
  if not found then
    raise exception 'La empresa no pertenece a este profesional';
  end if;
  if tg_op = 'INSERT' then
    if new.precio_acondicionamiento is null then new.precio_acondicionamiento := e.precio_acondicionamiento; end if;
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists talisto_preparar_orden on public.ordenes;
create trigger talisto_preparar_orden
  before insert or update on public.ordenes
  for each row execute function public.preparar_orden();

alter table public.ordenes enable row level security;

drop policy if exists ordenes_propias on public.ordenes;
create policy ordenes_propias on public.ordenes for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));

grant select, insert, update, delete on public.ordenes to authenticated, service_role;
grant execute on function public.preparar_orden() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3. Relevamientos con dirección propia (siempre en el mapa mientras están pendientes)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.relevamientos') is not null then
    alter table public.relevamientos add column if not exists direccion  text;
    alter table public.relevamientos add column if not exists referencia text;
    alter table public.relevamientos add column if not exists lat        double precision;
    alter table public.relevamientos add column if not exists lng        double precision;
    alter table public.relevamientos drop constraint if exists relevamientos_ubicacion_check;
    alter table public.relevamientos add constraint relevamientos_ubicacion_check check ((lat is null) = (lng is null));
    -- Si el relevamiento es en una dirección del cliente se usa direccion_id (toma sus cambios);
    -- estas columnas son para un lugar que no está entre las direcciones del cliente (obra nueva, etc.)
  end if;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

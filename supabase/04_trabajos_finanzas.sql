-- =====================================================================
--  TaListo!  ·  TRABAJOS B2B, MIS GASTOS, PRESUPUESTOS Y FINANZAS
--  - Trabajos B2B: Iniciar / Finalizar con tiempo, suspendido, multi día,
--    materiales (proveedor, costo, margen) y precio de mano de obra
--  - Mano de obra en relevamientos
--  - Presupuestos con costo, margen, IVA y número correlativo
--  - Mis gastos (movilidad, insumos, viáticos, herramientas, otros)
--  - Ajustes privados (IVA, margen, logo, datos del negocio, combustible)
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01, 02 y 03). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.relevamientos') is null then
    raise exception 'Primero corré 02_relevamientos.sql';
  end if;
  if to_regclass('public.ordenes') is null then
    raise exception 'Primero corré 03_ordenes_empresa.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Ajustes privados del profesional (no se ven en el perfil público)
-- ---------------------------------------------------------------------
create table if not exists public.ajustes (
  profesional_id          uuid primary key references public.profesionales(id) on delete cascade,
  iva_porcentaje          numeric(5,2) not null default 22 check (iva_porcentaje between 0 and 100),
  margen_materiales       numeric(7,2) not null default 30 check (margen_materiales between 0 and 1000),
  validez_presupuesto     int not null default 15 check (validez_presupuesto between 1 and 365),
  condiciones_presupuesto text,
  razon_social            text,
  rut                     text,
  telefono                text,
  email                   text,
  direccion               text,
  logo_url                text,
  precio_boleto           numeric(10,2) check (precio_boleto is null or precio_boleto >= 0),
  precio_combustible      numeric(10,2) check (precio_combustible is null or precio_combustible >= 0),
  consumo_km_litro        numeric(6,2) check (consumo_km_litro is null or consumo_km_litro > 0),
  categorias_gastos       text[] not null default '{}',
  actualizado_en          timestamptz not null default now()
);

alter table public.ajustes enable row level security;
drop policy if exists ajustes_propios on public.ajustes;
create policy ajustes_propios on public.ajustes for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));
grant select, insert, update, delete on public.ajustes to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Trabajos B2B (tabla ordenes)
--    estados: pendiente → en_curso → finalizado | suspendido | multidia
--    tiempos: [{ "inicio": "...", "fin": "..." }]  (fin vacío = corriendo)
--    acondicionamientos = "puestas"
-- ---------------------------------------------------------------------
alter table public.ordenes add column if not exists tiempos        jsonb not null default '[]'::jsonb;
alter table public.ordenes add column if not exists minutos_manual int;
alter table public.ordenes add column if not exists mano_obra      numeric(12,2);
alter table public.ordenes add column if not exists materiales     jsonb not null default '[]'::jsonb;
alter table public.ordenes add column if not exists nota_estado    text;      -- motivo de suspensión, etc.
alter table public.ordenes add column if not exists fecha_inicio   date;      -- primer día (multi día)
alter table public.ordenes add column if not exists finalizado_en  timestamptz;

alter table public.ordenes drop constraint if exists ordenes_tiempos_check;
alter table public.ordenes add constraint ordenes_tiempos_check check (jsonb_typeof(tiempos) = 'array');
alter table public.ordenes drop constraint if exists ordenes_materiales_check;
alter table public.ordenes add constraint ordenes_materiales_check check (jsonb_typeof(materiales) = 'array');
alter table public.ordenes drop constraint if exists ordenes_minutos_check;
alter table public.ordenes add constraint ordenes_minutos_check check (minutos_manual is null or minutos_manual >= 0);
alter table public.ordenes drop constraint if exists ordenes_mano_obra_check;
alter table public.ordenes add constraint ordenes_mano_obra_check check (mano_obra is null or mano_obra >= 0);

create index if not exists ordenes_estado_idx on public.ordenes (profesional_id, estado);

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
  -- fecha en que se terminó
  if new.estado = 'finalizado' then
    if tg_op = 'INSERT' or old.estado is distinct from 'finalizado' then
      new.finalizado_en := coalesce(new.finalizado_en, now());
    end if;
  else
    new.finalizado_en := null;
  end if;
  new.actualizado_en := now();
  return new;
end $$;

-- "realizado" pasa a llamarse "finalizado"
alter table public.ordenes drop constraint if exists ordenes_estado_check;
update public.ordenes set estado = 'finalizado', finalizado_en = coalesce(finalizado_en, creado_en) where estado = 'realizado';
alter table public.ordenes add constraint ordenes_estado_check
  check (estado in ('pendiente','en_curso','suspendido','multidia','finalizado','cancelado'));

-- ---------------------------------------------------------------------
-- 3. Relevamientos: precio de mano de obra
-- ---------------------------------------------------------------------
alter table public.relevamientos add column if not exists mano_obra numeric(12,2);
alter table public.relevamientos drop constraint if exists relevamientos_mano_obra_check;
alter table public.relevamientos add constraint relevamientos_mano_obra_check check (mano_obra is null or mano_obra >= 0);
-- el "costo estimado" anterior pasa a ser la mano de obra
update public.relevamientos set mano_obra = costo_estimado, costo_estimado = null
 where mano_obra is null and costo_estimado is not null;

-- ---------------------------------------------------------------------
-- 4. Presupuestos
--    items: [{ item, cantidad, unidad, costo, margen, precio }]
--    costo y margen son internos: al cliente solo le llega el precio final.
--    Los totales los calcula la base al guardar.
-- ---------------------------------------------------------------------
create table if not exists public.presupuestos (
  id                uuid primary key default gen_random_uuid(),
  profesional_id    uuid not null references public.profesionales(id) on delete cascade,
  numero            int,
  cliente_id        uuid references public.clientes(id) on delete set null,
  relevamiento_id   uuid references public.relevamientos(id) on delete set null,
  cliente_nombre    text,
  cliente_direccion text,
  titulo            text,
  fecha             date not null default current_date,
  validez_dias      int not null default 15 check (validez_dias between 1 and 365),
  items             jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  mano_obra         numeric(12,2) check (mano_obra is null or mano_obra >= 0),
  mano_obra_texto   text,
  iva_porcentaje    numeric(5,2) not null default 22 check (iva_porcentaje between 0 and 100),
  notas             text,
  estado            text not null default 'borrador'
                    check (estado in ('borrador','enviado','aceptado','rechazado')),
  aceptado_en       date,
  cobrado_en        date,
  costo_total       numeric(12,2) not null default 0,
  subtotal          numeric(12,2) not null default 0,
  iva               numeric(12,2) not null default 0,
  total             numeric(12,2) not null default 0,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  unique (profesional_id, numero)
);
create index if not exists presupuestos_profesional_idx on public.presupuestos (profesional_id, estado, aceptado_en);
create index if not exists presupuestos_relevamiento_idx on public.presupuestos (relevamiento_id);

create or replace function public.preparar_presupuesto()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_costo numeric := 0;
  v_venta numeric := 0;
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

  -- Totales
  select coalesce(sum(round(coalesce(nullif(i->>'cantidad', '')::numeric, 0) * coalesce(nullif(i->>'costo', '')::numeric, 0), 2)), 0),
         coalesce(sum(round(coalesce(nullif(i->>'cantidad', '')::numeric, 0) * coalesce(nullif(i->>'precio', '')::numeric, 0), 2)), 0)
    into v_costo, v_venta
    from jsonb_array_elements(new.items) i;
  new.costo_total := v_costo;
  new.subtotal    := round(v_venta + coalesce(new.mano_obra, 0), 2);
  new.iva         := round(new.subtotal * new.iva_porcentaje / 100, 2);
  new.total       := new.subtotal + new.iva;

  if new.estado = 'aceptado' then
    if tg_op = 'INSERT' or old.estado is distinct from 'aceptado' then
      new.aceptado_en := coalesce(new.aceptado_en, current_date);
    end if;
  else
    new.aceptado_en := null;
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists talisto_preparar_presupuesto on public.presupuestos;
create trigger talisto_preparar_presupuesto
  before insert or update on public.presupuestos
  for each row execute function public.preparar_presupuesto();

alter table public.presupuestos enable row level security;
drop policy if exists presupuestos_propios on public.presupuestos;
create policy presupuestos_propios on public.presupuestos for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));
grant select, insert, update, delete on public.presupuestos to authenticated, service_role;
grant execute on function public.preparar_presupuesto() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5. Mis gastos
--    movilidad: bus (boletos × precio) o vehículo (km ÷ consumo × precio del litro)
-- ---------------------------------------------------------------------
create table if not exists public.gastos (
  id                uuid primary key default gen_random_uuid(),
  profesional_id    uuid not null references public.profesionales(id) on delete cascade,
  fecha             date not null default current_date,
  categoria         text not null check (length(trim(categoria)) between 1 and 40),
  tipo              text check (tipo is null or tipo in ('bus','vehiculo')),
  descripcion       text,
  cantidad          numeric(10,2) check (cantidad is null or cantidad >= 0),
  precio_unitario   numeric(12,2) check (precio_unitario is null or precio_unitario >= 0),
  km                numeric(10,1) check (km is null or km >= 0),
  consumo_km_litro  numeric(6,2) check (consumo_km_litro is null or consumo_km_litro > 0),
  litros            numeric(10,2) check (litros is null or litros >= 0),
  monto             numeric(12,2) not null check (monto >= 0),
  orden_id          uuid references public.ordenes(id) on delete set null,
  creado_en         timestamptz not null default now()
);
create index if not exists gastos_profesional_fecha_idx on public.gastos (profesional_id, fecha);

create or replace function public.preparar_gasto()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.orden_id is not null
     and (tg_op = 'INSERT' or new.orden_id is distinct from old.orden_id)
     and not exists (select 1 from public.ordenes o where o.id = new.orden_id and o.profesional_id = new.profesional_id) then
    raise exception 'El trabajo no pertenece a este profesional';
  end if;
  new.categoria := trim(new.categoria);
  return new;
end $$;

drop trigger if exists talisto_preparar_gasto on public.gastos;
create trigger talisto_preparar_gasto
  before insert or update on public.gastos
  for each row execute function public.preparar_gasto();

alter table public.gastos enable row level security;
drop policy if exists gastos_propios on public.gastos;
create policy gastos_propios on public.gastos for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));
grant select, insert, update, delete on public.gastos to authenticated, service_role;
grant execute on function public.preparar_gasto() to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Logos para los presupuestos (Storage público: el logo se ve en el PDF)
--    Cada profesional sube y borra solo en su carpeta: <su id>/...
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('logos', 'logos', true, 2097152, array['image/png','image/jpeg','image/webp'])
    on conflict (id) do update set public = true;

    execute 'drop policy if exists logos_leer on storage.objects';
    execute $p$create policy logos_leer on storage.objects for select to authenticated
      using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

    execute 'drop policy if exists logos_subir on storage.objects';
    execute $p$create policy logos_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

    execute 'drop policy if exists logos_borrar on storage.objects';
    execute $p$create policy logos_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

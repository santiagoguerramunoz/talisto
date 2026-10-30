-- =====================================================================
--  TaListo!  ·  PROVEEDORES, LISTAS DE PRECIOS Y ÓRDENES DE COMPRA
--  · Cada cuenta Pro/Business carga sus proveedores con su lista de
--    precios (planilla Excel/CSV, un link publicado o la API del proveedor).
--  · El admin carga los "Proveedores de TaListo", que ven todas las
--    cuentas Pro y Business (sin comisión).
--  · En el presupuesto se busca el producto y el precio se carga solo; se
--    revisa el stock y se arma la orden de compra para cada proveedor.
--  · Las claves de las API de los proveedores quedan guardadas aparte: la
--    app nunca las puede leer, solo el servidor al consultar al proveedor.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 08). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.soy_pro()') is null or to_regclass('public.posiciones_equipo') is null then
    raise exception 'Primero corré 07_seguridad.sql y 08_tickets.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Permiso nuevo para los roles de la empresa: Compras
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo','compras','stock']::text[];
$$;
-- Administración (rol de fábrica) se encarga de las compras
update public.roles_empresa set permisos = array_append(permisos, 'compras')
 where nombre = 'Administración' and not ('compras' = any(permisos));

-- Búsqueda sin tildes ni mayúsculas
create or replace function public.normalizar(t text)
returns text language sql immutable parallel safe as $$
  select lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
$$;

create or replace function public.numero_o_null(t text)
returns numeric language sql immutable as $$
  select case when trim(coalesce(t, '')) ~ '^-?[0-9]+(\.[0-9]+)?$' then trim(t)::numeric end;
$$;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create extension if not exists pg_trgm with schema extensions';
  else
    execute 'create extension if not exists pg_trgm';
  end if;
exception when others then
  raise notice 'Sin pg_trgm: la búsqueda funciona igual, solo que sin índice especial';
end $$;

-- ---------------------------------------------------------------------
-- 2. Proveedores y sus productos
-- ---------------------------------------------------------------------
create table if not exists public.proveedores (
  id               uuid primary key default gen_random_uuid(),
  profesional_id   uuid references public.profesionales(id) on delete cascade,  -- null = Proveedor de TaListo (para todos)
  nombre           text not null check (length(trim(nombre)) between 1 and 120),
  rut              text,
  contacto         text,
  telefono         text,
  whatsapp         text,
  email            text,
  direccion        text,
  web              text,
  notas            text,
  moneda           text not null default 'UYU' check (moneda in ('UYU', 'USD')),
  iva_incluido     boolean not null default false,
  activo           boolean not null default true,
  -- de dónde sale la lista de precios
  fuente           text not null default 'planilla' check (fuente in ('manual', 'planilla', 'url', 'api')),
  fuente_url       text check (fuente_url is null or (fuente_url ~ '^https://' and length(fuente_url) <= 1000)),
  formato          text not null default 'auto' check (formato in ('auto', 'csv', 'json', 'xlsx')),
  mapeo            jsonb not null default '{}'::jsonb check (jsonb_typeof(mapeo) = 'object'),
  stock_url        text check (stock_url is null or (stock_url ~ '^https://' and length(stock_url) <= 1000)),
  pedido_url       text check (pedido_url is null or (pedido_url ~ '^https://' and length(pedido_url) <= 1000)),
  pedido_email     text,
  auth_header      text check (auth_header is null or auth_header ~ '^[A-Za-z0-9-]{1,60}$'),
  tiene_clave      boolean not null default false,
  productos        int not null default 0,
  sincronizado_en  timestamptz,
  sincronizacion   text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists proveedores_profesional_idx on public.proveedores (profesional_id);

create table if not exists public.productos_proveedor (
  id              uuid primary key default gen_random_uuid(),
  proveedor_id    uuid not null references public.proveedores(id) on delete cascade,
  codigo          text not null check (length(codigo) between 1 and 80),
  nombre          text not null check (length(nombre) between 1 and 300),
  marca           text,
  categoria       text,
  unidad          text not null default 'u',
  precio          numeric(14,2) not null check (precio >= 0),
  stock           numeric(14,2),
  stock_en        timestamptz,
  activo          boolean not null default true,
  actualizado_en  timestamptz not null default now(),
  texto           text generated always as (public.normalizar(codigo || ' ' || nombre || ' ' || coalesce(marca, '') || ' ' || coalesce(categoria, ''))) stored,
  unique (proveedor_id, codigo)
);
create index if not exists productos_proveedor_idx on public.productos_proveedor (proveedor_id, activo);
do $$
begin
  if exists (select 1 from pg_opclass where opcname = 'gin_trgm_ops') then
    execute 'create index if not exists productos_texto_trgm on public.productos_proveedor using gin (texto gin_trgm_ops)';
  end if;
exception when others then null;
end $$;

-- Claves de las API: sin ninguna regla de lectura (solo el servidor con la clave de servicio)
create table if not exists public.proveedores_claves (
  proveedor_id    uuid primary key references public.proveedores(id) on delete cascade,
  clave           text not null check (length(clave) between 1 and 4000),
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. Quién ve y quién edita
-- ---------------------------------------------------------------------
-- Ver los Proveedores de TaListo: cuentas Pro/Business y equipos de una empresa Business
create or replace function public.ve_catalogo_global()
returns boolean language sql stable security definer set search_path = public as $$
  select public.soy_pro() or exists (select 1 from public.cuentas_con(public.permisos_validos()));
$$;

create or replace function public.puede_ver_proveedor(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proveedores v
    where v.id = p
      and ((v.profesional_id is null and (public.es_admin() or (v.activo and public.ve_catalogo_global())))
           or v.profesional_id = auth.uid()
           or v.profesional_id in (select public.cuentas_con(array['compras', 'presupuestos', 'relevamientos', 'tickets_asignar']))));
$$;

create or replace function public.puede_editar_proveedor(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.proveedores v
    where v.id = p
      and ((v.profesional_id is null and public.es_admin())
           or v.profesional_id = auth.uid()
           or v.profesional_id in (select public.cuentas_con(array['compras']))));
$$;

alter table public.proveedores enable row level security;
drop policy if exists proveedores_leer on public.proveedores;
create policy proveedores_leer on public.proveedores for select
  using ((profesional_id is null and (public.es_admin() or (activo and public.ve_catalogo_global())))
         or profesional_id = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['compras', 'presupuestos', 'relevamientos', 'tickets_asignar'])));
drop policy if exists proveedores_editar on public.proveedores;
create policy proveedores_editar on public.proveedores for all
  using ((profesional_id is null and public.es_admin())
         or profesional_id = (select auth.uid())
         or profesional_id in (select public.cuentas_con(array['compras'])))
  with check ((profesional_id is null and public.es_admin())
              or profesional_id = (select auth.uid())
              or profesional_id in (select public.cuentas_con(array['compras'])));

alter table public.productos_proveedor enable row level security;
drop policy if exists productos_leer on public.productos_proveedor;
create policy productos_leer on public.productos_proveedor for select using (public.puede_ver_proveedor(proveedor_id));
drop policy if exists productos_editar on public.productos_proveedor;
create policy productos_editar on public.productos_proveedor for all
  using (public.puede_editar_proveedor(proveedor_id)) with check (public.puede_editar_proveedor(proveedor_id));

alter table public.proveedores_claves enable row level security;
revoke all on public.proveedores_claves from public, anon, authenticated;

-- Los campos que maneja el sistema no se tocan a mano
create or replace function public.preparar_proveedor()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and coalesce(current_setting('talisto.importando', true), '') <> 'si' then
    if tg_op = 'INSERT' then
      new.tiene_clave := false;
      new.productos := 0;
      new.sincronizado_en := null;
      new.sincronizacion := null;
    else
      new.tiene_clave := old.tiene_clave;
      new.productos := old.productos;
      new.sincronizado_en := old.sincronizado_en;
      new.sincronizacion := old.sincronizacion;
    end if;
  end if;
  new.nombre := trim(new.nombre);
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists talisto_preparar_proveedor on public.proveedores;
create trigger talisto_preparar_proveedor before insert or update on public.proveedores
  for each row execute function public.preparar_proveedor();

drop trigger if exists talisto_plan_proveedores on public.proveedores;
create trigger talisto_plan_proveedores before insert or update on public.proveedores
  for each row execute function public.exigir_pro('Los proveedores y sus listas de precios son parte del plan Pro.');

drop trigger if exists talisto_dueno_inmutable on public.proveedores;
create trigger talisto_dueno_inmutable before update on public.proveedores
  for each row execute function public.dueno_inmutable('profesional_id');
drop trigger if exists talisto_dueno_inmutable on public.productos_proveedor;
create trigger talisto_dueno_inmutable before update on public.productos_proveedor
  for each row execute function public.dueno_inmutable('proveedor_id');

create or replace function public.preparar_producto()
returns trigger language plpgsql set search_path = public as $$
begin
  new.codigo := left(trim(new.codigo), 80);
  new.nombre := left(trim(new.nombre), 300);
  new.unidad := coalesce(nullif(left(trim(new.unidad), 20), ''), 'u');
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists talisto_preparar_producto on public.productos_proveedor;
create trigger talisto_preparar_producto before insert or update on public.productos_proveedor
  for each row execute function public.preparar_producto();

-- ---------------------------------------------------------------------
-- 4. Clave de la API del proveedor (se guarda, nunca se devuelve)
-- ---------------------------------------------------------------------
create or replace function public.guardar_clave_proveedor(p_proveedor uuid, p_clave text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  perform set_config('talisto.importando', 'si', true);
  if coalesce(trim(p_clave), '') = '' then
    delete from public.proveedores_claves where proveedor_id = p_proveedor;
    update public.proveedores set tiene_clave = false where id = p_proveedor;
  else
    insert into public.proveedores_claves (proveedor_id, clave) values (p_proveedor, trim(p_clave))
    on conflict (proveedor_id) do update set clave = excluded.clave, actualizado_en = now();
    update public.proveedores set tiene_clave = true where id = p_proveedor;
  end if;
end $$;

-- Solo para el servidor (clave de servicio)
create or replace function public.clave_proveedor(p_proveedor uuid)
returns text language sql stable security definer set search_path = public as $$
  select clave from public.proveedores_claves where proveedor_id = p_proveedor;
$$;

-- Configuración para sincronizar (sin la clave). Evita sincronizar más de una vez por minuto.
create or replace function public.config_proveedor(p_proveedor uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare v public.proveedores;
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  select * into v from public.proveedores where id = p_proveedor;
  return json_build_object('id', v.id, 'nombre', v.nombre, 'fuente', v.fuente, 'fuente_url', v.fuente_url, 'formato', v.formato,
                           'mapeo', v.mapeo, 'auth_header', v.auth_header, 'tiene_clave', v.tiene_clave,
                           'sincronizado_en', v.sincronizado_en);
end $$;

-- ---------------------------------------------------------------------
-- 5. Importar la lista de precios (por tandas)
--    1) iniciar_importacion → hora de inicio
--    2) importar_productos  → de a 2000 filas [{codigo, nombre, precio, stock, unidad, marca, categoria}]
--    3) cerrar_importacion  → los que no vinieron quedan inactivos
-- ---------------------------------------------------------------------
create or replace function public.iniciar_importacion(p_proveedor uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  return clock_timestamp();
end $$;

create or replace function public.importar_productos(p_proveedor uuid, p_filas jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  nuevos int := 0; actualizados int := 0; omitidos int := 0; total int;
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'Formato no válido'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Mandá las filas de a 2000 como máximo'; end if;
  select count(*) into total from public.productos_proveedor where proveedor_id = p_proveedor;
  if total > 60000 then raise exception 'La lista llegó al máximo de 60.000 productos'; end if;

  with filas as (
    select distinct on (codigo) *
    from (
      select left(coalesce(nullif(trim(f ->> 'codigo'), ''), 'SC-' || left(md5(public.normalizar(trim(f ->> 'nombre'))), 10)), 80) as codigo,
             left(trim(f ->> 'nombre'), 300) as nombre,
             nullif(left(trim(f ->> 'marca'), 80), '') as marca,
             nullif(left(trim(f ->> 'categoria'), 80), '') as categoria,
             coalesce(nullif(left(trim(f ->> 'unidad'), 20), ''), 'u') as unidad,
             round(public.numero_o_null(f ->> 'precio'), 2) as precio,
             round(public.numero_o_null(f ->> 'stock'), 2) as stock,
             (f ? 'stock') and public.numero_o_null(f ->> 'stock') is not null as trae_stock
      from jsonb_array_elements(p_filas) f
      where jsonb_typeof(f) = 'object'
    ) x
    where coalesce(nombre, '') <> '' and precio is not null and precio >= 0 and precio < 1e11
    order by codigo
  ), escritas as (
    insert into public.productos_proveedor as p (proveedor_id, codigo, nombre, marca, categoria, unidad, precio, stock, stock_en, activo)
    select p_proveedor, codigo, nombre, marca, categoria, unidad, precio,
           case when trae_stock then stock end, case when trae_stock then now() end, true
    from filas
    on conflict (proveedor_id, codigo) do update set
      nombre = excluded.nombre, marca = excluded.marca, categoria = excluded.categoria, unidad = excluded.unidad,
      precio = excluded.precio,
      stock = case when excluded.stock_en is not null then excluded.stock else p.stock end,
      stock_en = coalesce(excluded.stock_en, p.stock_en),
      activo = true
    returning (xmax = 0) as nuevo
  )
  select count(*) filter (where nuevo), count(*) filter (where not nuevo) into nuevos, actualizados from escritas;
  omitidos := jsonb_array_length(p_filas) - nuevos - actualizados;
  return json_build_object('nuevos', nuevos, 'actualizados', actualizados, 'omitidos', omitidos);
end $$;

create or replace function public.cerrar_importacion(p_proveedor uuid, p_inicio timestamptz, p_resumen text default null)
returns json language plpgsql security definer set search_path = public as $$
declare bajas int; activos int;
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  update public.productos_proveedor set activo = false
   where proveedor_id = p_proveedor and activo and actualizado_en < p_inicio;
  get diagnostics bajas = row_count;
  select count(*) into activos from public.productos_proveedor where proveedor_id = p_proveedor and activo;
  perform set_config('talisto.importando', 'si', true);
  update public.proveedores set productos = activos, sincronizado_en = now(), sincronizacion = left(p_resumen, 300)
   where id = p_proveedor;
  return json_build_object('activos', activos, 'bajas', bajas);
end $$;

-- Si falla la sincronización, queda anotado el motivo
create or replace function public.anotar_sincronizacion(p_proveedor uuid, p_resumen text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  perform set_config('talisto.importando', 'si', true);
  update public.proveedores set sincronizacion = left(p_resumen, 300) where id = p_proveedor;
end $$;

-- Recalcula cuántos productos activos tiene (después de editar a mano)
create or replace function public.contar_productos(p_proveedor uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.puede_editar_proveedor(p_proveedor) then raise exception 'No podés editar este proveedor'; end if;
  select count(*) into n from public.productos_proveedor where proveedor_id = p_proveedor and activo;
  perform set_config('talisto.importando', 'si', true);
  update public.proveedores set productos = n where id = p_proveedor;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Buscar productos (para el presupuesto)
--    p_cuenta: la cuenta con la que se trabaja (en una empresa, la principal)
-- ---------------------------------------------------------------------
create or replace function public.buscar_productos(p_cuenta uuid, p_texto text, p_proveedor uuid default null, p_limite int default 40)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  palabras text[];
  plan text;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if not public.puede(p_cuenta, array['presupuestos', 'relevamientos', 'tickets_asignar', 'compras']) then
    raise exception 'No tenés permiso para ver los proveedores de esta cuenta';
  end if;
  plan := public.plan_de(p_cuenta);
  if plan = 'free' then
    raise exception using errcode = 'TL001', message = 'Los proveedores y sus listas de precios son parte del plan Pro.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  select coalesce(array_agg(w), '{}') into palabras
    from unnest(regexp_split_to_array(public.normalizar(trim(coalesce(p_texto, ''))), '\s+')) w where w <> '';
  if cardinality(palabras) = 0 and p_proveedor is null then return '[]'::json; end if;
  if cardinality(palabras) > 8 then palabras := palabras[1:8]; end if;

  return coalesce((
    select json_agg(x) from (
      select p.id, p.codigo, p.nombre, p.marca, p.categoria, p.unidad, p.precio, p.stock, p.stock_en,
             v.id as proveedor_id, v.nombre as proveedor, v.moneda, v.iva_incluido,
             v.profesional_id is null as de_talisto,
             (v.stock_url is not null) as stock_en_vivo
      from public.productos_proveedor p
      join public.proveedores v on v.id = p.proveedor_id
      where p.activo and v.activo
        and (v.profesional_id = p_cuenta or v.profesional_id is null)
        and (p_proveedor is null or v.id = p_proveedor)
        and (select bool_and(p.texto like '%' || w || '%') from unnest(palabras) w) is not false
      order by (public.normalizar(p.codigo) = array_to_string(palabras, ' ')) desc,
               (p.texto like palabras[1] || '%' or public.normalizar(p.nombre) like coalesce(palabras[1], '') || '%') desc,
               p.nombre
      limit least(greatest(coalesce(p_limite, 40), 1), 60)
    ) x
  ), '[]'::json);
end $$;

-- Datos para revisar stock y precios de los productos de un presupuesto u orden
create or replace function public.productos_para_revisar(p_cuenta uuid, p_ids uuid[])
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.puede(p_cuenta, array['presupuestos', 'relevamientos', 'tickets_asignar', 'compras']) then
    raise exception 'No tenés permiso para ver los proveedores de esta cuenta';
  end if;
  if cardinality(p_ids) > 80 then raise exception 'Demasiados productos para revisar de una vez'; end if;
  return coalesce((
    select json_agg(json_build_object(
      'id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'precio', p.precio, 'activo', p.activo and v.activo,
      'stock', p.stock, 'stock_en', p.stock_en, 'unidad', p.unidad,
      'proveedor_id', v.id, 'proveedor', v.nombre, 'moneda', v.moneda,
      'stock_url', v.stock_url, 'mapeo', v.mapeo, 'auth_header', v.auth_header, 'tiene_clave', v.tiene_clave))
    from public.productos_proveedor p
    join public.proveedores v on v.id = p.proveedor_id
    where p.id = any(p_ids) and (v.profesional_id = p_cuenta or v.profesional_id is null)
  ), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
-- 7. Órdenes de compra
--    items: [{ producto_id, codigo, item, cantidad, unidad, precio }]
-- ---------------------------------------------------------------------
create table if not exists public.ordenes_compra (
  id                 uuid primary key default gen_random_uuid(),
  profesional_id     uuid not null references public.profesionales(id) on delete cascade,
  numero             int,
  proveedor_id       uuid references public.proveedores(id) on delete set null,
  proveedor_nombre   text not null,
  proveedor_datos    jsonb not null default '{}'::jsonb,   -- foto: email, whatsapp, teléfono, rut
  presupuesto_id     uuid references public.presupuestos(id) on delete set null,
  fecha              date not null default ((now() at time zone 'America/Montevideo')::date),
  estado             text not null default 'borrador'
                     check (estado in ('borrador', 'enviada', 'confirmada', 'recibida', 'cancelada')),
  items              jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  moneda             text not null default 'UYU' check (moneda in ('UYU', 'USD')),
  iva_incluido       boolean not null default false,
  subtotal           numeric(14,2) not null default 0,
  entrega            text,
  notas              text,
  enviada_en         timestamptz,
  recibida_en        timestamptz,
  envio              jsonb,     -- resultado del envío por sistema al proveedor
  creado_por         uuid default auth.uid() references public.perfiles(id) on delete set null,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  unique (profesional_id, numero)
);
create index if not exists ordenes_compra_profesional_idx on public.ordenes_compra (profesional_id, estado, fecha);
create index if not exists ordenes_compra_presupuesto_idx on public.ordenes_compra (presupuesto_id);

create or replace function public.preparar_orden_compra()
returns trigger language plpgsql security definer set search_path = public as $$
declare v public.proveedores;
begin
  if new.proveedor_id is not null and (tg_op = 'INSERT' or new.proveedor_id is distinct from old.proveedor_id) then
    select * into v from public.proveedores where id = new.proveedor_id;
    if not found or not (v.profesional_id is null or v.profesional_id = new.profesional_id) then
      raise exception 'Ese proveedor no es de esta cuenta';
    end if;
  end if;
  if new.presupuesto_id is not null and (tg_op = 'INSERT' or new.presupuesto_id is distinct from old.presupuesto_id)
     and not exists (select 1 from public.presupuestos p where p.id = new.presupuesto_id and p.profesional_id = new.profesional_id) then
    raise exception 'El presupuesto no es de esta cuenta';
  end if;
  if jsonb_array_length(new.items) > 300 then raise exception 'La orden tiene demasiados ítems'; end if;

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtext('orden_compra' || new.profesional_id::text));
    select coalesce(max(o.numero), 0) + 1 into new.numero from public.ordenes_compra o where o.profesional_id = new.profesional_id;
  else
    new.numero := old.numero;
    new.creado_por := old.creado_por;
  end if;

  select coalesce(sum(round(coalesce(public.numero_o_null(i ->> 'cantidad'), 0) * coalesce(public.numero_o_null(i ->> 'precio'), 0), 2)), 0)
    into new.subtotal from jsonb_array_elements(new.items) i;

  if new.estado = 'enviada' and (tg_op = 'INSERT' or old.estado is distinct from 'enviada') then
    new.enviada_en := coalesce(new.enviada_en, now());
  end if;
  if new.estado = 'recibida' then
    if tg_op = 'INSERT' or old.estado is distinct from 'recibida' then new.recibida_en := now(); end if;
  else
    new.recibida_en := null;
  end if;
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists talisto_preparar_orden_compra on public.ordenes_compra;
create trigger talisto_preparar_orden_compra before insert or update on public.ordenes_compra
  for each row execute function public.preparar_orden_compra();

drop trigger if exists talisto_plan_ordenes_compra on public.ordenes_compra;
create trigger talisto_plan_ordenes_compra before insert or update on public.ordenes_compra
  for each row execute function public.exigir_pro('Las órdenes de compra son parte del plan Pro.');

drop trigger if exists talisto_dueno_inmutable on public.ordenes_compra;
create trigger talisto_dueno_inmutable before update on public.ordenes_compra
  for each row execute function public.dueno_inmutable('profesional_id');

alter table public.ordenes_compra enable row level security;
drop policy if exists ordenes_compra_propias on public.ordenes_compra;
create policy ordenes_compra_propias on public.ordenes_compra for all
  using (profesional_id = (select auth.uid())) with check (profesional_id = (select auth.uid()));
drop policy if exists ordenes_compra_empresa_leer on public.ordenes_compra;
create policy ordenes_compra_empresa_leer on public.ordenes_compra for select
  using (profesional_id in (select public.cuentas_con(array['compras', 'presupuestos', 'importes'])));
drop policy if exists ordenes_compra_empresa_editar on public.ordenes_compra;
create policy ordenes_compra_empresa_editar on public.ordenes_compra for all
  using (profesional_id in (select public.cuentas_con(array['compras'])))
  with check (profesional_id in (select public.cuentas_con(array['compras'])));

-- Para mandar la orden por sistema: dónde y cómo (sin la clave)
create or replace function public.config_pedido(p_orden uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare o public.ordenes_compra; v public.proveedores;
begin
  select * into o from public.ordenes_compra where id = p_orden;
  if not found or not public.puede(o.profesional_id, array['compras']) then raise exception 'No podés enviar esta orden'; end if;
  select * into v from public.proveedores where id = o.proveedor_id;
  if not found or v.pedido_url is null then raise exception 'Este proveedor no recibe órdenes por sistema'; end if;
  return json_build_object('proveedor_id', v.id, 'pedido_url', v.pedido_url, 'auth_header', v.auth_header, 'tiene_clave', v.tiene_clave);
end $$;

-- Compras puede ver los datos del negocio (van en la orden de compra)
drop policy if exists ajustes_empresa_leer on public.ajustes;
create policy ajustes_empresa_leer on public.ajustes for select
  using (profesional_id in (select public.cuentas_con(array['presupuestos', 'gastos', 'importes', 'compras'])));

-- ---------------------------------------------------------------------
-- 8. Permisos de las funciones y tablas
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.proveedores, public.productos_proveedor, public.ordenes_compra to authenticated;
grant all on public.proveedores, public.productos_proveedor, public.ordenes_compra, public.proveedores_claves to service_role;
revoke all on public.proveedores, public.productos_proveedor, public.ordenes_compra from anon;
revoke truncate, references, trigger on public.proveedores, public.productos_proveedor, public.ordenes_compra from authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.normalizar(text)', 'public.numero_o_null(text)', 'public.ve_catalogo_global()', 'public.puede_ver_proveedor(uuid)',
    'public.puede_editar_proveedor(uuid)', 'public.preparar_proveedor()', 'public.preparar_producto()',
    'public.guardar_clave_proveedor(uuid, text)', 'public.config_proveedor(uuid)', 'public.iniciar_importacion(uuid)',
    'public.importar_productos(uuid, jsonb)', 'public.cerrar_importacion(uuid, timestamptz, text)',
    'public.anotar_sincronizacion(uuid, text)', 'public.contar_productos(uuid)',
    'public.buscar_productos(uuid, text, uuid, int)', 'public.productos_para_revisar(uuid, uuid[])',
    'public.preparar_orden_compra()', 'public.config_pedido(uuid)', 'public.permisos_validos()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;
-- La clave solo la lee el servidor
revoke execute on function public.clave_proveedor(uuid) from public, anon, authenticated;
grant execute on function public.clave_proveedor(uuid) to service_role;

-- =====================================================================
--  TaListo!  ·  INTELIGENCIA DE COMPRAS, COSTOS Y PROVEEDORES (Business)
--  Extiende lo que ya existe (no es un sistema aparte):
--  · Cada compra registrada (comprobante leído con IA o orden de compra
--    recibida) deja su precio en un historial que no se borra: proveedor,
--    artículo, cantidad, costo unitario sin IVA, fecha y el documento que
--    lo respalda.
--  · Artículos equivalentes: el mismo material comprado a distintos
--    proveedores se agrupa (por el material del stock, el producto del
--    proveedor o la misma descripción y unidad). Lo que no es igual no se
--    mezcla; se pueden unir a mano ("es el mismo producto").
--  · Comparador, detector de aumentos/bajas con alertas (el % se
--    configura), recomendación de dónde comprar, panel con indicadores y
--    precios para los presupuestos y los tickets.
--  La "empresa" es la cuenta principal (profesional_id) y cada tabla tiene
--  sus reglas de acceso: ninguna cuenta ve precios ni proveedores de otra.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 14). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.comprobantes') is null then
    raise exception 'Primero corré 14_comprobantes_ia.sql';
  end if;
  if to_regclass('public.bitacora') is null then
    raise exception 'Primero corré 13_ruta_tickets.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Ajustes de las alertas (por cuenta)
-- ---------------------------------------------------------------------
alter table public.ajustes add column if not exists alerta_precio_pct numeric(5,2) not null default 10;
alter table public.ajustes add column if not exists dias_precio_viejo int not null default 90;
alter table public.ajustes drop constraint if exists ajustes_alertas_compras_check;
alter table public.ajustes add constraint ajustes_alertas_compras_check
  check (alerta_precio_pct between 1 and 100 and dias_precio_viejo between 7 and 730);

alter table public.bitacora drop constraint if exists bitacora_tipo_check;
alter table public.bitacora add constraint bitacora_tipo_check
  check (tipo in ('presupuesto', 'ticket', 'materiales', 'stock', 'comision', 'compras'));

-- ---------------------------------------------------------------------
-- 2. Artículos (grupos de productos equivalentes) e historial de precios
-- ---------------------------------------------------------------------
create table if not exists public.articulos (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) between 1 and 300),
  unidad          text not null default 'u',
  clave           text not null,                                  -- descripción normalizada + unidad
  material_id     uuid references public.materiales(id) on delete set null,
  unido_a         uuid references public.articulos(id) on delete set null,   -- se unió a otro equivalente
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (profesional_id, clave)
);
create index if not exists articulos_material_idx on public.articulos (profesional_id, material_id) where material_id is not null;

-- Producto de la lista de un proveedor → artículo (factor: unidades del artículo que trae cada unidad del producto)
create table if not exists public.articulos_productos (
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  producto_id     uuid not null references public.productos_proveedor(id) on delete cascade,
  articulo_id     uuid not null references public.articulos(id) on delete cascade,
  factor          numeric(14,4) not null default 1 check (factor > 0),
  origen          text not null default 'auto' check (origen in ('auto', 'manual')),
  creado_en       timestamptz not null default now(),
  primary key (profesional_id, producto_id)
);
create index if not exists articulos_productos_art_idx on public.articulos_productos (articulo_id);

-- Cada precio de compra. No se borra ni se edita: si estaba mal se anula (con el motivo).
create table if not exists public.precios_historial (
  id                 bigint generated always as identity primary key,
  profesional_id     uuid not null references public.profesionales(id) on delete cascade,
  articulo_id        uuid not null references public.articulos(id) on delete cascade,
  proveedor_id       uuid,
  proveedor_nombre   text,
  producto_id        uuid,
  material_id        uuid,
  descripcion        text not null,
  codigo             text,
  cantidad           numeric(16,3),
  unidad             text,
  factor             numeric(14,4) not null default 1 check (factor > 0),
  precio             numeric(16,4) not null check (precio >= 0),   -- por unidad comprada, sin IVA, en la moneda del documento
  moneda             text not null default 'UYU' check (moneda in ('UYU', 'USD')),
  cotizacion         numeric(12,4),
  precio_base_uyu    numeric(18,6),                                  -- por unidad del artículo, sin IVA, en pesos
  iva_pct            numeric(5,2),
  descuento_pct      numeric(5,2),
  fecha              date not null,
  origen             text not null check (origen in ('comprobante', 'orden_compra', 'manual')),
  comprobante_id     uuid references public.comprobantes(id) on delete set null,
  orden_compra_id    uuid references public.ordenes_compra(id) on delete set null,
  n                  int,
  documento          text,
  numero             text,
  anulado            boolean not null default false,
  anulado_motivo     text,
  anulado_por        uuid,
  anulado_en         timestamptz,
  creado_por         uuid,
  creado_por_nombre  text,
  creado_en          timestamptz not null default now()
);
create unique index if not exists precios_historial_comprobante_uk on public.precios_historial (comprobante_id, n) where comprobante_id is not null;
create unique index if not exists precios_historial_orden_uk on public.precios_historial (orden_compra_id, n) where orden_compra_id is not null;
create index if not exists precios_historial_art_idx on public.precios_historial (profesional_id, articulo_id, fecha desc);
create index if not exists precios_historial_prov_idx on public.precios_historial (profesional_id, proveedor_id, fecha desc);

create table if not exists public.alertas_precios (
  id              bigint generated always as identity primary key,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  tipo            text not null check (tipo in ('aumento', 'baja', 'mas_barato', 'inconsistencia', 'incompleto')),
  articulo_id     uuid references public.articulos(id) on delete set null,
  proveedor_id    uuid,
  historial_id    bigint references public.precios_historial(id) on delete set null,
  comprobante_id  uuid references public.comprobantes(id) on delete set null,
  orden_compra_id uuid references public.ordenes_compra(id) on delete set null,
  variacion_pct   numeric(9,2),
  mensaje         text not null,
  creado_en       timestamptz not null default now()
);
create index if not exists alertas_precios_cuenta_idx on public.alertas_precios (profesional_id, creado_en desc);
alter table public.alertas_precios drop constraint if exists alertas_precios_tipo_check;
alter table public.alertas_precios add constraint alertas_precios_tipo_check
  check (tipo in ('aumento', 'baja', 'mas_barato', 'inconsistencia', 'incompleto', 'desactualizado'));

-- ---------------------------------------------------------------------
-- 3. Ayudas
-- ---------------------------------------------------------------------
create or replace function public._unidad_normal(u text)
returns text language sql immutable as $$
  select case
    when t in ('', 'u', 'un', 'uni', 'unid', 'unidad', 'unidades', 'und', 'ud', 'uds', 'c/u', 'cu', 'pza', 'pieza', 'piezas') then 'u'
    when t in ('m', 'mt', 'mts', 'metro', 'metros') then 'm'
    when t in ('kg', 'kgs', 'kilo', 'kilos') then 'kg'
    when t in ('l', 'lt', 'lts', 'litro', 'litros') then 'l'
    when t in ('m2', 'm²', 'mt2') then 'm²'
    when t in ('m3', 'm³') then 'm³'
    else left(t, 12) end
  from (select public.normalizar(trim(coalesce(u, ''))) as t) x;
$$;

-- Clave del artículo: la descripción normalizada (en su orden, con medidas y números) + la unidad.
-- Conservadora a propósito: "Tornillo 8x1" y "Tornillo 1x8" no quedan juntos.
create or replace function public._clave_articulo(d text, u text)
returns text language sql immutable as $$
  select coalesce(string_agg(w, ' ' order by k), '') || '|' || public._unidad_normal(u)
  from (
    select w, k from regexp_split_to_table(trim(regexp_replace(regexp_replace(regexp_replace(
             public.normalizar(replace(replace(coalesce(d, ''), '²', '2'), '³', '3')),
             '[^a-z0-9]+', ' ', 'g'), '([0-9])([a-z])', '\1 \2', 'g'), '([a-z])([0-9])', '\1 \2', 'g')), '\s+')
         with ordinality as z(w, k)
    where w <> '' and w not in ('de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'en', 'al')
  ) y;
$$;

create or replace function public._pesos(n numeric)
returns text language sql immutable as $$
  select case when n is null then '—' else
    '$ ' || regexp_replace(translate(to_char(round(n, 2), 'FM999,999,999,990.00'), ',.', '.,'), ',00$', '') end;
$$;

create or replace function public._pct(n numeric)
returns text language sql immutable as $$
  select replace(regexp_replace(to_char(round(abs(n), 1), 'FM999990.0'), '\.0$', ''), '.', ',');
$$;

create or replace function public._es_envio(t text)
returns boolean language sql immutable as $$
  select public.normalizar(coalesce(t, '')) ~ '^\s*(flete|envio|costo de envio|costos de envio|gastos de envio|transporte|traslado|entrega)\M';
$$;

create or replace function public._ve_compras(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c is not null and public.plan_de(c) = 'business' and public.puede(c, array['compras', 'importes', 'stock', 'seguimiento']);
$$;

create or replace function public._articulo_final(a uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v uuid := a; sig uuid; k int := 0;
begin
  loop
    select unido_a into sig from public.articulos where id = v;
    exit when sig is null or k > 20;
    v := sig; k := k + 1;
  end loop;
  return v;
end $$;

-- Artículo de un renglón: por el producto del proveedor, el material del stock o la clave; si no hay, se crea
create or replace function public._articulo(p_cuenta uuid, p_producto uuid, p_material uuid, p_descripcion text, p_unidad text)
returns uuid language plpgsql security definer set search_path = public as $$
declare a uuid; k text := public._clave_articulo(p_descripcion, p_unidad);
begin
  if p_producto is not null then
    select articulo_id into a from public.articulos_productos where profesional_id = p_cuenta and producto_id = p_producto;
  end if;
  if a is null and p_material is not null then
    select id into a from public.articulos where profesional_id = p_cuenta and material_id = p_material order by (unido_a is null) desc, creado_en limit 1;
  end if;
  if a is null then
    select id into a from public.articulos where profesional_id = p_cuenta and clave = k;
  end if;
  if a is null then
    insert into public.articulos (profesional_id, nombre, unidad, clave, material_id)
    values (p_cuenta, left(trim(p_descripcion), 300), public._unidad_normal(p_unidad), k, p_material)
    on conflict (profesional_id, clave) do update set actualizado_en = now()
    returning id into a;
  end if;
  a := public._articulo_final(a);
  if p_material is not null then
    update public.articulos set material_id = p_material, actualizado_en = now() where id = a and material_id is null;
  end if;
  if p_producto is not null then
    insert into public.articulos_productos (profesional_id, producto_id, articulo_id)
    values (p_cuenta, p_producto, a) on conflict (profesional_id, producto_id) do nothing;
  end if;
  return a;
end $$;

-- Último precio de cada proveedor para un artículo (sin anulados)
create or replace function public._ultimos_precios(p_cuenta uuid, p_articulo uuid)
returns table (id bigint, proveedor_id uuid, proveedor_nombre text, precio numeric, moneda text, factor numeric,
               precio_base_uyu numeric, fecha date, origen text, documento text, comprobante_id uuid, orden_compra_id uuid)
language sql stable security definer set search_path = public as $$
  select distinct on (h.proveedor_id) h.id, h.proveedor_id, h.proveedor_nombre, h.precio, h.moneda, h.factor,
         h.precio_base_uyu, h.fecha, h.origen, h.documento, h.comprobante_id, h.orden_compra_id
    from public.precios_historial h
   where h.profesional_id = p_cuenta and h.articulo_id = p_articulo and not h.anulado and h.proveedor_id is not null
   order by h.proveedor_id, h.fecha desc, h.id desc;
$$;

-- Registra un precio y devuelve las alertas que generó: { id, alertas: [ {tipo, mensaje, variacion} ] }
create or replace function public._registrar_precio(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cuenta uuid := (p ->> 'cuenta')::uuid; art uuid := (p ->> 'articulo')::uuid; prov uuid := public.uuid_o_null(p ->> 'proveedor_id');
  nuevo public.precios_historial; ant record; otro record; a public.articulos;
  umbral numeric; var numeric; alertas jsonb := '[]'::jsonb; msg text; uid uuid := auth.uid(); hay_otro boolean := false;
begin
  insert into public.precios_historial (profesional_id, articulo_id, proveedor_id, proveedor_nombre, producto_id, material_id, descripcion, codigo,
                                        cantidad, unidad, factor, precio, moneda, cotizacion, precio_base_uyu, iva_pct, descuento_pct, fecha, origen,
                                        comprobante_id, orden_compra_id, n, documento, numero, creado_por, creado_por_nombre)
  values (cuenta, art, prov, nullif(p ->> 'proveedor_nombre', ''), public.uuid_o_null(p ->> 'producto_id'), public.uuid_o_null(p ->> 'material_id'),
          left(p ->> 'descripcion', 300), nullif(left(p ->> 'codigo', 80), ''), public.numero_o_null(p ->> 'cantidad'), nullif(left(p ->> 'unidad', 20), ''),
          coalesce(public.numero_o_null(p ->> 'factor'), 1), (p ->> 'precio')::numeric, coalesce(p ->> 'moneda', 'UYU'),
          public.numero_o_null(p ->> 'cotizacion'), public.numero_o_null(p ->> 'precio_base_uyu'),
          public.numero_o_null(p ->> 'iva_pct'), public.numero_o_null(p ->> 'descuento_pct'), (p ->> 'fecha')::date, p ->> 'origen',
          public.uuid_o_null(p ->> 'comprobante_id'), public.uuid_o_null(p ->> 'orden_compra_id'), (p ->> 'n')::int,
          nullif(left(p ->> 'documento', 80), ''), nullif(left(p ->> 'numero', 40), ''), uid, public._nombre_de(uid))
  on conflict do nothing
  returning * into nuevo;
  if nuevo.id is null then return null; end if;    -- ya estaba (mismo documento y renglón)

  select * into a from public.articulos where id = art;
  umbral := coalesce((select alerta_precio_pct from public.ajustes where profesional_id = cuenta), 10);
  -- el flete o envío depende de cada pedido: queda en el historial pero no se compara como un producto
  if public._es_envio(a.nombre) then return jsonb_build_object('id', nuevo.id, 'alertas', alertas); end if;

  -- mismo proveedor: compra anterior
  if prov is not null and nuevo.precio_base_uyu is not null then
    select h.precio_base_uyu, h.fecha into ant from public.precios_historial h
     where h.profesional_id = cuenta and h.articulo_id = art and h.proveedor_id = prov and not h.anulado and h.id <> nuevo.id
       and h.precio_base_uyu is not null and (h.fecha < nuevo.fecha or (h.fecha = nuevo.fecha and h.id < nuevo.id))
     order by h.fecha desc, h.id desc limit 1;
    -- otro proveedor más barato (su último precio)
    select u.proveedor_nombre, u.proveedor_id, u.precio_base_uyu into otro from public._ultimos_precios(cuenta, art) u
     where u.proveedor_id <> prov and u.precio_base_uyu is not null order by u.precio_base_uyu limit 1;
    hay_otro := otro.proveedor_id is not null and otro.precio_base_uyu < nuevo.precio_base_uyu;

    if ant.precio_base_uyu is not null and ant.precio_base_uyu > 0 then
      var := round((nuevo.precio_base_uyu - ant.precio_base_uyu) / ant.precio_base_uyu * 100, 1);
      if var >= umbral then
        msg := format('%s aumentó un %s%% el costo de %s respecto a la última compra (%s → %s).',
                      coalesce(nuevo.proveedor_nombre, 'El proveedor'), public._pct(var), a.nombre,
                      public._pesos(ant.precio_base_uyu), public._pesos(nuevo.precio_base_uyu));
        if hay_otro then msg := msg || format(' Existe otro proveedor registrado que lo ofrece a %s: %s.', public._pesos(otro.precio_base_uyu), otro.proveedor_nombre); end if;
        insert into public.alertas_precios (profesional_id, tipo, articulo_id, proveedor_id, historial_id, comprobante_id, orden_compra_id, variacion_pct, mensaje)
        values (cuenta, 'aumento', art, prov, nuevo.id, nuevo.comprobante_id, nuevo.orden_compra_id, var, msg);
        alertas := alertas || jsonb_build_object('tipo', 'aumento', 'mensaje', msg, 'variacion', var, 'articulo', art);
      elsif var <= -umbral then
        msg := format('%s bajó un %s%% el costo de %s (%s → %s).', coalesce(nuevo.proveedor_nombre, 'El proveedor'),
                      public._pct(var), a.nombre, public._pesos(ant.precio_base_uyu), public._pesos(nuevo.precio_base_uyu));
        insert into public.alertas_precios (profesional_id, tipo, articulo_id, proveedor_id, historial_id, comprobante_id, orden_compra_id, variacion_pct, mensaje)
        values (cuenta, 'baja', art, prov, nuevo.id, nuevo.comprobante_id, nuevo.orden_compra_id, var, msg);
        alertas := alertas || jsonb_build_object('tipo', 'baja', 'mensaje', msg, 'variacion', var, 'articulo', art);
      end if;
    end if;

    -- más barato en otro proveedor (si no se avisó ya con el aumento)
    if hay_otro and not (var is not null and var >= umbral)
       and otro.precio_base_uyu <= nuevo.precio_base_uyu * (1 - umbral / 100) then
      var := round((nuevo.precio_base_uyu - otro.precio_base_uyu) / otro.precio_base_uyu * 100, 1);
      msg := format('%s está %s más barato en %s (%s) que en %s (%s).', a.nombre,
                    public._pct((nuevo.precio_base_uyu - otro.precio_base_uyu) / nuevo.precio_base_uyu * 100) || '%',
                    otro.proveedor_nombre, public._pesos(otro.precio_base_uyu), coalesce(nuevo.proveedor_nombre, 'este proveedor'), public._pesos(nuevo.precio_base_uyu));
      insert into public.alertas_precios (profesional_id, tipo, articulo_id, proveedor_id, historial_id, comprobante_id, orden_compra_id, variacion_pct, mensaje)
      values (cuenta, 'mas_barato', art, otro.proveedor_id, nuevo.id, nuevo.comprobante_id, nuevo.orden_compra_id, var, msg);
      alertas := alertas || jsonb_build_object('tipo', 'mas_barato', 'mensaje', msg, 'variacion', var, 'articulo', art);
    end if;
  end if;
  return jsonb_build_object('id', nuevo.id, 'alertas', alertas);
end $$;

-- Un aviso por documento a quienes manejan Compras o Stock (con el sistema de avisos de siempre)
create or replace function public._avisar_precios(p_cuenta uuid, p_doc text, p_prov text, p_alertas jsonb, p_url text)
returns void language plpgsql security definer set search_path = public as $$
declare n int := jsonb_array_length(coalesce(p_alertas, '[]'::jsonb)); aum int; tit text;
begin
  if n = 0 or public.plan_de(p_cuenta) <> 'business' then return; end if;
  select count(*) into aum from jsonb_array_elements(p_alertas) x where x ->> 'tipo' = 'aumento';
  tit := format('%s%s: %s', coalesce(p_prov, 'Compras'), case when p_doc is not null then ' · ' || p_doc else '' end,
                case when aum > 0 then aum || case when aum = 1 then ' aumento de precio' else ' aumentos de precio' end
                     else n || case when n = 1 then ' alerta de precios' else ' alertas de precios' end end);
  perform public._avisar(array(select public._con_permiso(p_cuenta, array['compras', 'stock'])), p_cuenta, 'precios', tit,
                         (p_alertas -> 0 ->> 'mensaje') || case when n > 1 then format(' (y %s más)', n - 1) else '' end, p_url,
                         jsonb_build_object('alertas', n));
end $$;

-- ---------------------------------------------------------------------
-- 4. El historial se llena solo: comprobantes de compra y órdenes recibidas
-- ---------------------------------------------------------------------
create or replace function public._historial_de_comprobante(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.comprobantes; d jsonb; it jsonb; k int := 0; pv public.proveedores; cot numeric; con_iva boolean;
  nom text; cod text; precio numeric; cant numeric; desc_ numeric; iva numeric; neto numeric; prod uuid; mat uuid; fac numeric;
  uni text; m public.materiales; art uuid; base numeric; r jsonb; alertas jsonb := '[]'::jsonb; suma numeric := 0; sin_precio int := 0;
  suma_iva numeric := 0; incluir boolean; ref numeric; doc text; dif numeric; msg text; que text;
begin
  select * into c from public.comprobantes where id = p_id;
  if c.id is null or c.tipo <> 'compra' or c.estado <> 'registrado' or c.cargado is null then return '[]'::jsonb; end if;
  d := c.cargado;
  select * into pv from public.proveedores where id = c.proveedor_id;
  cot := coalesce(public.numero_o_null(d ->> 'cotizacion'), (select cotizacion_dolar from public.ajustes where profesional_id = c.profesional_id));
  con_iva := coalesce(lower(d ->> 'precios_con_iva') = 'true', false);
  doc := trim(coalesce(c.documento, 'Comprobante') || ' ' || coalesce(c.numero, ''));
  for it in select * from jsonb_array_elements(coalesce(d -> 'items', '[]'::jsonb)) loop
    k := k + 1;
    if jsonb_typeof(it) <> 'object' then continue; end if;
    incluir := lower(coalesce(it ->> 'incluir', 'true')) <> 'false';
    nom := nullif(left(trim(coalesce(it ->> 'descripcion', '')), 300), '');
    precio := public.numero_o_null(it ->> 'precio_unitario');
    cant := coalesce(public.numero_o_null(it ->> 'cantidad'), 1);
    desc_ := least(greatest(coalesce(public.numero_o_null(it ->> 'descuento_pct'), 0), 0), 100);
    iva := coalesce(public.numero_o_null(it ->> 'iva_pct'), 22);
    if precio is not null and precio >= 0 and cant > 0 then          -- para controlar la suma cuentan todos los renglones
      suma := suma + precio * cant * (1 - desc_ / 100);
      suma_iva := suma_iva + precio * cant * (1 - desc_ / 100) * case when con_iva then 1 else 1 + iva / 100 end;
    end if;
    if not incluir or nom is null then continue; end if;
    if precio is null or precio < 0 or cant <= 0 then sin_precio := sin_precio + 1; continue; end if;   -- sin precio no se inventa
    neto := precio * (1 - desc_ / 100) / case when con_iva then 1 + iva / 100 else 1 end;
    cod := coalesce(nullif(left(trim(coalesce(it ->> 'codigo', '')), 80), ''), 'SC-' || left(md5(public.normalizar(nom)), 10));
    prod := null; mat := null; fac := 1;
    if c.proveedor_id is not null then
      select id into prod from public.productos_proveedor where proveedor_id = c.proveedor_id and codigo = cod;
    end if;
    if prod is not null then
      select material_id, factor into mat, fac from public.materiales_vinculos where profesional_id = c.profesional_id and producto_id = prod;
    end if;
    if mat is null then mat := public.uuid_o_null(it ->> 'material_id'); end if;
    fac := coalesce(fac, case when public.numero_o_null(it ->> 'cantidad_stock') > 0 then public.numero_o_null(it ->> 'cantidad_stock') / cant end, 1);
    select * into m from public.materiales where id = mat and profesional_id = c.profesional_id;
    uni := coalesce(m.unidad, public._unidad_normal(it ->> 'unidad'));
    art := public._articulo(c.profesional_id, prod, m.id, coalesce(m.nombre, nom), uni);
    if prod is not null then update public.articulos_productos set factor = fac where profesional_id = c.profesional_id and producto_id = prod and origen = 'auto'; end if;
    base := case when c.moneda = 'USD' then case when cot is not null then neto * cot / fac end else neto / fac end;
    -- el mismo comprobante cargado dos veces (mismo proveedor, número, fecha, artículo y precio) no se repite
    if c.numero is not null and exists (select 1 from public.precios_historial h
        where h.profesional_id = c.profesional_id and h.proveedor_id = c.proveedor_id and lower(h.numero) = lower(c.numero)
          and h.fecha = c.fecha and h.articulo_id = art and h.precio = round(neto, 4) and h.comprobante_id is distinct from c.id and not h.anulado) then
      continue;
    end if;
    r := public._registrar_precio(jsonb_build_object(
      'cuenta', c.profesional_id, 'articulo', art, 'proveedor_id', c.proveedor_id, 'proveedor_nombre', coalesce(pv.nombre, c.proveedor_nombre),
      'producto_id', prod, 'material_id', m.id, 'descripcion', nom, 'codigo', nullif(it ->> 'codigo', ''), 'cantidad', cant,
      'unidad', it ->> 'unidad', 'factor', fac, 'precio', round(neto, 4), 'moneda', coalesce(c.moneda, 'UYU'), 'cotizacion', cot,
      'precio_base_uyu', round(base, 6), 'iva_pct', iva, 'descuento_pct', desc_, 'fecha', coalesce(c.fecha, current_date),
      'origen', 'comprobante', 'comprobante_id', c.id, 'n', k, 'documento', doc, 'numero', c.numero));
    if r is not null then alertas := alertas || coalesce(r -> 'alertas', '[]'::jsonb); end if;
  end loop;

  -- validación: datos incompletos y sumas que no cierran (lo revisa una persona)
  if sin_precio > 0 then
    msg := format('%s de %s: %s %s sin precio, no %s al historial. Revisalo en el comprobante.', doc, coalesce(pv.nombre, 'el proveedor'), sin_precio,
                  case when sin_precio = 1 then 'artículo' else 'artículos' end, case when sin_precio = 1 then 'pasó' else 'pasaron' end);
    insert into public.alertas_precios (profesional_id, tipo, proveedor_id, comprobante_id, mensaje) values (c.profesional_id, 'incompleto', c.proveedor_id, c.id, msg);
    alertas := alertas || jsonb_build_object('tipo', 'incompleto', 'mensaje', msg);
  end if;
  -- sin IVA: contra el subtotal que leyó la IA; si no hay, contra el total con el IVA de cada renglón
  if not con_iva and public.numero_o_null(c.datos ->> 'subtotal') > 0 then
    ref := public.numero_o_null(c.datos ->> 'subtotal'); que := 'subtotal';
  else
    ref := c.total; suma := suma_iva; que := 'total';
  end if;
  if ref is not null and ref > 0 and suma > 0 and sin_precio = 0 then
    dif := abs(suma - ref) / ref * 100;
    if dif > 3 then
      msg := format('%s de %s: la suma de los artículos (%s) no coincide con el %s del comprobante (%s). Puede haber un renglón mal leído.',
                    doc, coalesce(pv.nombre, 'el proveedor'), public._pesos(suma), que, public._pesos(ref));
      insert into public.alertas_precios (profesional_id, tipo, proveedor_id, comprobante_id, variacion_pct, mensaje)
      values (c.profesional_id, 'inconsistencia', c.proveedor_id, c.id, round(dif, 2), msg);
      alertas := alertas || jsonb_build_object('tipo', 'inconsistencia', 'mensaje', msg);
    end if;
  end if;
  perform public._avisar_precios(c.profesional_id, doc, coalesce(pv.nombre, c.proveedor_nombre), alertas, '/panel/finanzas/inteligencia');
  return alertas;
end $$;

create or replace function public.historial_al_registrar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'registrado' and old.estado is distinct from 'registrado' and new.tipo = 'compra' then
    begin
      perform public._historial_de_comprobante(new.id);
    exception when others then      -- el historial nunca frena la compra
      raise warning 'Historial de precios: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists talisto_historial_comprobante on public.comprobantes;
create trigger talisto_historial_comprobante after update of estado on public.comprobantes
  for each row execute function public.historial_al_registrar();

create or replace function public._historial_de_orden(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_compra; it jsonb; k int := -1; cot numeric; nom text; precio numeric; cant numeric; neto numeric; prod uuid; mat uuid;
  fac numeric; m public.materiales; uni text; art uuid; base numeric; r jsonb; alertas jsonb := '[]'::jsonb; doc text;
begin
  select * into o from public.ordenes_compra where id = p_id;
  if o.id is null then return '[]'::jsonb; end if;
  cot := (select cotizacion_dolar from public.ajustes where profesional_id = o.profesional_id);
  doc := 'Orden de compra Nº ' || lpad(o.numero::text, 4, '0');
  for it in select * from jsonb_array_elements(coalesce(o.items, '[]'::jsonb)) loop
    k := k + 1;
    nom := nullif(left(trim(coalesce(it ->> 'item', '')), 300), '');
    precio := public.numero_o_null(it ->> 'precio');
    cant := coalesce(public.numero_o_null(it ->> 'cantidad'), 1);
    if nom is null or precio is null or precio < 0 or cant <= 0 then continue; end if;
    neto := precio / case when o.iva_incluido then 1.22 else 1 end;
    prod := public.uuid_o_null(it ->> 'producto_id'); mat := null; fac := 1;
    if prod is not null then
      select material_id, factor into mat, fac from public.materiales_vinculos where profesional_id = o.profesional_id and producto_id = prod;
    end if;
    fac := coalesce(fac, 1);
    select * into m from public.materiales where id = mat and profesional_id = o.profesional_id;
    uni := coalesce(m.unidad, public._unidad_normal(it ->> 'unidad'));
    art := public._articulo(o.profesional_id, prod, m.id, coalesce(m.nombre, nom), uni);
    base := case when o.moneda = 'USD' then case when cot is not null then neto * cot / fac end else neto / fac end;
    r := public._registrar_precio(jsonb_build_object(
      'cuenta', o.profesional_id, 'articulo', art, 'proveedor_id', o.proveedor_id, 'proveedor_nombre', o.proveedor_nombre,
      'producto_id', prod, 'material_id', m.id, 'descripcion', nom, 'codigo', nullif(it ->> 'codigo', ''), 'cantidad', cant,
      'unidad', it ->> 'unidad', 'factor', fac, 'precio', round(neto, 4), 'moneda', coalesce(o.moneda, 'UYU'), 'cotizacion', cot,
      'precio_base_uyu', round(base, 6), 'fecha', coalesce(o.fecha, current_date), 'origen', 'orden_compra',
      'orden_compra_id', o.id, 'n', k, 'documento', doc, 'numero', 'OC-' || o.numero));
    if r is not null then alertas := alertas || coalesce(r -> 'alertas', '[]'::jsonb); end if;
  end loop;
  perform public._avisar_precios(o.profesional_id, doc, o.proveedor_nombre, alertas, '/panel/finanzas/inteligencia');
  return alertas;
end $$;

create or replace function public.historial_al_recibir()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado in ('parcial', 'recibida') and old.estado not in ('parcial', 'recibida') then
    begin
      perform public._historial_de_orden(new.id);
    exception when others then      -- el historial nunca frena la compra
      raise warning 'Historial de precios: %', sqlerrm;
    end;
  end if;
  return new;
end $$;
drop trigger if exists talisto_historial_orden on public.ordenes_compra;
create trigger talisto_historial_orden after update of estado on public.ordenes_compra
  for each row execute function public.historial_al_recibir();

-- ---------------------------------------------------------------------
-- 5. Consultas: comparador, recomendación, panel, presupuestos
-- ---------------------------------------------------------------------
-- Ofertas de un artículo: último precio de compra de cada proveedor + precio de lista de los productos vinculados
create or replace function public._ofertas(p_cuenta uuid, p_articulo uuid)
returns table (proveedor_id uuid, proveedor text, origen text, precio_base_uyu numeric, precio numeric, moneda text, factor numeric,
               fecha date, documento text, producto_id uuid, codigo text, stock numeric, comprobante_id uuid, orden_compra_id uuid)
language sql stable security definer set search_path = public as $$
  with cot as (select cotizacion_dolar c from public.ajustes where profesional_id = p_cuenta),
  u as (select * from public._ultimos_precios(p_cuenta, p_articulo))
  select u.proveedor_id, u.proveedor_nombre, 'compra', u.precio_base_uyu, u.precio, u.moneda, u.factor, u.fecha, u.documento,
         null::uuid, null::text, null::numeric, u.comprobante_id, u.orden_compra_id
    from u
  union all
  -- precio de lista solo de proveedores a los que nunca se les compró este artículo (lo comprado manda)
  select v.id, v.nombre, 'lista',
         round((p.precio / case when v.iva_incluido then 1.22 else 1 end) * case when v.moneda = 'USD' then (select c from cot) else 1 end / ap.factor, 6),
         p.precio, v.moneda, ap.factor, p.actualizado_en::date, 'Lista de precios', p.id, p.codigo, p.stock, null, null
    from public.articulos_productos ap
    join public.productos_proveedor p on p.id = ap.producto_id and p.activo
    join public.proveedores v on v.id = p.proveedor_id and v.activo and (v.profesional_id = p_cuenta or v.profesional_id is null)
   where ap.profesional_id = p_cuenta and ap.articulo_id = p_articulo and not exists (select 1 from public.precios_historial h where h.profesional_id = p_cuenta and h.articulo_id = p_articulo and h.proveedor_id = v.id);
$$;

create or replace function public._recomendacion(p_cuenta uuid, p_articulo uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  dias int := coalesce((select dias_precio_viejo from public.ajustes where profesional_id = p_cuenta), 90);
  mejor record; ultima record; n int; texto text; notas text[] := '{}'; conf record; cond text; pct numeric;
begin
  select count(distinct o.proveedor_id) into n from public._ofertas(p_cuenta, p_articulo) o where o.precio_base_uyu is not null;
  select o.* into mejor from public._ofertas(p_cuenta, p_articulo) o where o.precio_base_uyu is not null
   order by o.precio_base_uyu, o.fecha desc limit 1;
  select h.proveedor_id, h.proveedor_nombre, h.precio_base_uyu, h.fecha into ultima from public.precios_historial h
   where h.profesional_id = p_cuenta and h.articulo_id = p_articulo and not h.anulado and h.precio_base_uyu is not null
   order by h.fecha desc, h.id desc limit 1;
  if mejor.proveedor_id is null then
    return jsonb_build_object('suficiente', false, 'texto', 'Todavía no hay precios registrados de este artículo.');
  end if;
  if n < 2 then
    texto := format('Solo hay precios de %s: no hay otro proveedor registrado para comparar.', mejor.proveedor);
    return jsonb_build_object('suficiente', false, 'texto', texto, 'proveedor_id', mejor.proveedor_id, 'proveedor', mejor.proveedor);
  end if;
  if ultima.proveedor_id = mejor.proveedor_id or ultima.precio_base_uyu is null or ultima.precio_base_uyu <= mejor.precio_base_uyu then
    texto := format('Recomendación: seguir comprando a %s, que tiene el mejor precio registrado (%s).', mejor.proveedor, public._pesos(mejor.precio_base_uyu));
    pct := 0;
  else
    pct := round((ultima.precio_base_uyu - mejor.precio_base_uyu) / ultima.precio_base_uyu * 100, 1);
    texto := format('Recomendación: comprar a %s. Su precio es %s%% inferior al último costo registrado (%s en %s) y es el mismo artículo.',
                    mejor.proveedor, public._pct(pct), public._pesos(ultima.precio_base_uyu), ultima.proveedor_nombre);
  end if;
  if mejor.origen = 'lista' then notas := notas || text 'El mejor precio es de la lista del proveedor, no de una compra: confirmalo al pedir.'; end if;
  if mejor.fecha < current_date - dias then notas := notas || format('El precio es de hace más de %s días: puede estar desactualizado.', dias); end if;
  if mejor.stock is not null then
    notas := notas || case when mejor.stock > 0 then format('Stock informado por el proveedor: %s.', public.cantidad_texto(mejor.stock)) else 'El proveedor informó que no tiene stock.' end;
  else
    notas := notas || text 'No hay datos de disponibilidad registrados.';
  end if;
  select count(*) filter (where estado = 'recibida') r, count(*) filter (where estado in ('recibida', 'parcial', 'cancelada')) t into conf
    from public.ordenes_compra where profesional_id = p_cuenta and proveedor_id = mejor.proveedor_id;
  if conf.t >= 3 then notas := notas || format('Órdenes de compra a %s: %s de %s recibidas completas.', mejor.proveedor, conf.r, conf.t);
  else notas := notas || text 'No hay suficientes órdenes de compra para evaluar la confiabilidad del proveedor.'; end if;
  select format('Último envío o flete registrado con %s: %s (%s).', mejor.proveedor, public._pesos(h.precio_base_uyu), to_char(h.fecha, 'DD/MM/YYYY')) into cond
    from public.precios_historial h join public.articulos x on x.id = h.articulo_id
   where h.profesional_id = p_cuenta and h.proveedor_id = mejor.proveedor_id and not h.anulado and public._es_envio(x.nombre)
   order by h.fecha desc, h.id desc limit 1;
  notas := notas || coalesce(cond, 'No hay costos de envío registrados con este proveedor.');
  cond := (select nullif(trim(regexp_replace(coalesce(v.notas, ''), 'Creado desde un comprobante leído con IA\.?', '', 'g')), '')
             from public.proveedores v where v.id = mejor.proveedor_id);
  notas := notas || coalesce('Condiciones registradas del proveedor: ' || cond, 'No hay condiciones comerciales registradas.');
  return jsonb_build_object('suficiente', true, 'texto', texto, 'ahorro_pct', pct, 'proveedor_id', mejor.proveedor_id, 'proveedor', mejor.proveedor,
                            'precio_base_uyu', mejor.precio_base_uyu, 'origen', mejor.origen, 'notas', to_jsonb(notas));
end $$;

-- Ficha del artículo: comparador, historial, recomendación y posibles equivalentes
create or replace function public.articulo_precios(p_articulo uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare a public.articulos; cuenta uuid; dias int; mejor numeric; ultimo record;
begin
  select * into a from public.articulos where id = public._articulo_final(p_articulo);
  if a.id is null then raise exception 'No encontramos el artículo'; end if;
  cuenta := a.profesional_id;
  if not public._ve_compras(cuenta) then raise exception 'No tenés acceso a los precios de esta empresa'; end if;
  dias := coalesce((select dias_precio_viejo from public.ajustes where profesional_id = cuenta), 90);
  select min(o.precio_base_uyu) into mejor from public._ofertas(cuenta, a.id) o;
  select h.precio_base_uyu, h.fecha, h.proveedor_nombre into ultimo from public.precios_historial h
   where h.articulo_id = a.id and not h.anulado order by h.fecha desc, h.id desc limit 1;
  return json_build_object(
    'articulo', json_build_object('id', a.id, 'nombre', a.nombre, 'unidad', a.unidad, 'material_id', a.material_id,
                                  'material', (select nombre from public.materiales where id = a.material_id)),
    'dias_precio_viejo', dias,
    'ultimo', case when ultimo.fecha is not null then json_build_object('precio_base_uyu', ultimo.precio_base_uyu, 'fecha', ultimo.fecha, 'proveedor', ultimo.proveedor_nombre) end,
    'comparador', (select coalesce(json_agg(x order by x.precio_base_uyu nulls last), '[]'::json) from (
        select o.proveedor_id, o.proveedor, o.origen, o.precio_base_uyu, o.precio, o.moneda, o.factor, o.fecha, o.documento, o.stock,
               o.comprobante_id, o.orden_compra_id, o.producto_id, o.codigo,
               o.precio_base_uyu = mejor as mejor,
               round(o.precio_base_uyu - mejor, 2) as diferencia,
               case when mejor > 0 then round((o.precio_base_uyu - mejor) / mejor * 100, 1) end as diferencia_pct,
               o.fecha < current_date - dias as desactualizado,
               (select count(*) from public.precios_historial h where h.articulo_id = a.id and h.proveedor_id = o.proveedor_id and not h.anulado) as compras
          from public._ofertas(cuenta, a.id) o) x),
    'historial', (select coalesce(json_agg(x order by x.fecha, x.id), '[]'::json) from (
        select h.id, h.fecha, h.proveedor_id, h.proveedor_nombre as proveedor, h.precio, h.moneda, h.factor, h.precio_base_uyu, h.cantidad, h.unidad,
               h.descripcion, h.origen, h.documento, h.comprobante_id, h.orden_compra_id, h.anulado, h.anulado_motivo, h.creado_por_nombre
          from public.precios_historial h where h.articulo_id = a.id order by h.fecha desc, h.id desc limit 200) x),
    'recomendacion', public._recomendacion(cuenta, a.id),
    'equivalentes', (
      with yo as (select string_to_array(split_part(a.clave, '|', 1), ' ') t),
      cand as (select x.id, x.nombre, x.unidad, string_to_array(split_part(x.clave, '|', 1), ' ') t
                 from public.articulos x where x.profesional_id = cuenta and x.id <> a.id and x.unido_a is null and x.unidad = a.unidad)
      select coalesce(json_agg(json_build_object('id', c.id, 'nombre', c.nombre, 'unidad', c.unidad)), '[]'::json) from cand c, yo
       where (select coalesce(array_agg(w order by w), '{}') from unnest(c.t) w where w ~ '^[0-9]')
             = (select coalesce(array_agg(w order by w), '{}') from unnest(yo.t) w where w ~ '^[0-9]')
         and (select count(*) from (select unnest(c.t) intersect select unnest(yo.t)) i)::numeric
             / greatest((select count(*) from (select unnest(c.t) union select unnest(yo.t)) u), 1) >= 0.5),
    'productos', (select coalesce(json_agg(json_build_object('producto_id', p.id, 'codigo', p.codigo, 'nombre', p.nombre, 'proveedor', v.nombre, 'factor', ap.factor, 'origen', ap.origen)), '[]'::json)
                    from public.articulos_productos ap join public.productos_proveedor p on p.id = ap.producto_id join public.proveedores v on v.id = p.proveedor_id
                   where ap.articulo_id = a.id)
  );
end $$;

create or replace function public.buscar_articulos(p_cuenta uuid, p_texto text default '', p_limite int default 40)
returns json language plpgsql stable security definer set search_path = public as $$
declare q text := public.normalizar(trim(coalesce(p_texto, '')));
begin
  if not public._ve_compras(p_cuenta) then raise exception 'No tenés acceso a los precios de esta empresa'; end if;
  return (select coalesce(json_agg(x), '[]'::json) from (
    select a.id, a.nombre, a.unidad, a.material_id,
           (select count(distinct h.proveedor_id) from public.precios_historial h where h.articulo_id = a.id and not h.anulado) as proveedores,
           (select count(*) from public.precios_historial h where h.articulo_id = a.id and not h.anulado) as compras,
           (select max(h.fecha) from public.precios_historial h where h.articulo_id = a.id and not h.anulado) as ultima_fecha,
           (select min(o.precio_base_uyu) from public._ofertas(p_cuenta, a.id) o) as mejor_precio
      from public.articulos a
     where a.profesional_id = p_cuenta and a.unido_a is null
       and (q = '' or (select bool_and(public.normalizar(a.nombre) like '%' || w || '%') from regexp_split_to_table(q, '\s+') w where w <> ''))
       and exists (select 1 from public.precios_historial h where h.articulo_id = a.id)
     order by (select max(h.fecha) from public.precios_historial h where h.articulo_id = a.id) desc nulls last, a.nombre
     limit least(greatest(coalesce(p_limite, 40), 1), 200)) x);
end $$;

-- Panel de inteligencia de compras
create or replace function public.inteligencia_compras(p_cuenta uuid, p_dias int default 90)
returns json language plpgsql stable security definer set search_path = public as $$
declare dias_viejo int; umbral numeric; desde date := current_date - least(greatest(coalesce(p_dias, 90), 7), 730);
begin
  if not public._ve_compras(p_cuenta) then raise exception 'No tenés acceso a la inteligencia de compras de esta empresa'; end if;
  select coalesce(alerta_precio_pct, 10), coalesce(dias_precio_viejo, 90) into umbral, dias_viejo from public.ajustes where profesional_id = p_cuenta;
  umbral := coalesce(umbral, 10); dias_viejo := coalesce(dias_viejo, 90);
  return (
  with h as (select ph.* from public.precios_historial ph join public.articulos x on x.id = ph.articulo_id
              where ph.profesional_id = p_cuenta and not ph.anulado and not public._es_envio(x.nombre)),
  arts as (select a.id, a.nombre, a.unidad from public.articulos a where a.profesional_id = p_cuenta and a.unido_a is null
            and exists (select 1 from h where h.articulo_id = a.id)),
  ult as (select distinct on (h.articulo_id, h.proveedor_id) h.articulo_id, h.proveedor_id, h.proveedor_nombre, h.precio_base_uyu, h.fecha
            from h where h.proveedor_id is not null and h.precio_base_uyu is not null order by h.articulo_id, h.proveedor_id, h.fecha desc, h.id desc),
  mejor as (select articulo_id, min(precio_base_uyu) m, count(*) n from ult group by articulo_id),
  var as (select h.id, h.articulo_id, h.proveedor_id, h.proveedor_nombre, h.fecha, h.precio_base_uyu,
                 (select p.precio_base_uyu from h p where p.articulo_id = h.articulo_id and p.proveedor_id = h.proveedor_id and p.precio_base_uyu is not null
                    and (p.fecha < h.fecha or (p.fecha = h.fecha and p.id < h.id)) order by p.fecha desc, p.id desc limit 1) as anterior
            from h where h.fecha >= desde and h.precio_base_uyu is not null),
  aum as (select distinct on (v.articulo_id) v.*, round((v.precio_base_uyu - v.anterior) / v.anterior * 100, 1) as pct
            from var v where v.anterior > 0 and (v.precio_base_uyu - v.anterior) / v.anterior * 100 >= umbral
           order by v.articulo_id, v.fecha desc, v.id desc),
  ahorro as (select h.articulo_id, sum(greatest(0, h.precio_base_uyu - b.m) * coalesce(h.cantidad, 1) * h.factor) as monto
               from h join mejor b on b.articulo_id = h.articulo_id and b.n >= 2 where h.fecha >= desde and h.precio_base_uyu is not null group by h.articulo_id),
  ultfecha as (select articulo_id, max(fecha) f, sum(coalesce(cantidad, 1)) cant from h group by articulo_id),
  meses as (select to_char(date_trunc('month', h.fecha), 'YYYY-MM') mes,
                   round(avg(h.precio_base_uyu / nullif(pb.base, 0)) * 100, 1) indice, count(*) compras
              from h join (select distinct on (articulo_id) articulo_id, precio_base_uyu base from h
                            where fecha >= current_date - 365 and precio_base_uyu > 0 order by articulo_id, fecha, id) pb on pb.articulo_id = h.articulo_id
             where h.fecha >= current_date - 365 and h.precio_base_uyu is not null group by 1),
  var12 as (select h.id, h.articulo_id, h.proveedor_id, h.proveedor_nombre,
                   (h.precio_base_uyu - p.precio_base_uyu) / p.precio_base_uyu * 100 as pct
              from h cross join lateral (select q.precio_base_uyu from h q where q.articulo_id = h.articulo_id and q.proveedor_id = h.proveedor_id
                                           and q.precio_base_uyu > 0 and (q.fecha < h.fecha or (q.fecha = h.fecha and q.id < h.id))
                                         order by q.fecha desc, q.id desc limit 1) p
             where h.fecha >= current_date - 365 and h.precio_base_uyu is not null and h.proveedor_id is not null),
  recur as (select proveedor_id, max(proveedor_nombre) nombre, count(*) filter (where pct >= umbral) aumentos,
                   count(*) comparaciones, round(avg(pct) filter (where pct >= umbral), 1) promedio
              from var12 group by proveedor_id having count(*) filter (where pct >= umbral) >= 2),
  infl as (select x.articulo_id, x.primero, x.ultimo, round((x.ultimo - x.primero) / x.primero * 100, 1) pct from (
             select h.articulo_id,
                    (array_agg(h.precio_base_uyu order by h.fecha, h.id))[1] primero,
                    (array_agg(h.precio_base_uyu order by h.fecha desc, h.id desc))[1] ultimo, count(*) n
               from h where h.fecha >= current_date - 365 and h.precio_base_uyu > 0 group by h.articulo_id) x
            where x.n >= 2 and x.ultimo <> x.primero),
  comp as (select u.proveedor_id, max(u.proveedor_nombre) nombre,
                  count(*) filter (where u.precio_base_uyu = b.m) as mas_baratos, count(*) as articulos,
                  round(avg((u.precio_base_uyu - b.m) / nullif(b.m, 0) * 100), 1) as sobre_mejor_pct
             from ult u join mejor b on b.articulo_id = u.articulo_id and b.n >= 2 group by u.proveedor_id)
  select json_build_object(
    'umbral', umbral, 'dias_precio_viejo', dias_viejo, 'desde', desde,
    'indicadores', json_build_object(
      'proveedores', (select count(*) from public.proveedores where profesional_id = p_cuenta and activo),
      'articulos', (select count(*) from arts),
      'compras_periodo', (select count(*) from h where h.fecha >= desde),
      'documentos_ia', (select count(*) from public.comprobantes where profesional_id = p_cuenta and estado = 'registrado' and tipo = 'compra' and registrado_en >= desde),
      'aumentos', (select count(*) from aum),
      'ahorro_potencial', coalesce((select round(sum(monto), 2) from ahorro), 0),
      'sin_actualizar', (select count(*) from ultfecha where f < current_date - dias_viejo)),
    'evolucion', (select coalesce(json_agg(json_build_object('mes', mes, 'indice', indice, 'compras', compras) order by mes), '[]'::json) from meses),
    'aumentos', (select coalesce(json_agg(json_build_object('articulo_id', x.articulo_id, 'nombre', a.nombre, 'unidad', a.unidad, 'proveedor', x.proveedor_nombre,
                    'anterior', x.anterior, 'ultimo', x.precio_base_uyu, 'pct', x.pct, 'fecha', x.fecha,
                    'mejor_otro', (select json_build_object('proveedor', u.proveedor_nombre, 'precio', u.precio_base_uyu) from ult u
                                    where u.articulo_id = x.articulo_id and u.proveedor_id <> x.proveedor_id and u.precio_base_uyu < x.precio_base_uyu
                                    order by u.precio_base_uyu limit 1)) order by x.pct desc), '[]'::json)
                 from (select * from aum order by pct desc limit 12) x join arts a on a.id = x.articulo_id),
    'ahorros', (select coalesce(json_agg(json_build_object('articulo_id', x.articulo_id, 'nombre', a.nombre, 'monto', round(x.monto, 2)) order by x.monto desc), '[]'::json)
                 from (select * from ahorro where monto > 0 order by monto desc limit 8) x join arts a on a.id = x.articulo_id),
    'competitivos', (select coalesce(json_agg(json_build_object('proveedor_id', c.proveedor_id, 'nombre', c.nombre, 'mas_baratos', c.mas_baratos,
                       'articulos', c.articulos, 'sobre_mejor_pct', c.sobre_mejor_pct) order by c.mas_baratos desc, c.sobre_mejor_pct), '[]'::json)
                      from (select * from comp order by mas_baratos desc, sobre_mejor_pct limit 6) c),
    'recurrentes', (select coalesce(json_agg(json_build_object('proveedor_id', r.proveedor_id, 'nombre', r.nombre, 'aumentos', r.aumentos,
                      'comparaciones', r.comparaciones, 'promedio_pct', r.promedio) order by r.aumentos desc, r.promedio desc), '[]'::json)
                     from (select * from recur order by aumentos desc limit 6) r),
    'inflacion', (select coalesce(json_agg(json_build_object('articulo_id', i.articulo_id, 'nombre', a.nombre, 'unidad', a.unidad, 'primero', i.primero,
                    'ultimo', i.ultimo, 'pct', i.pct) order by i.pct desc), '[]'::json)
                   from (select * from infl where pct > 0 order by pct desc limit 8) i join arts a on a.id = i.articulo_id),
    'sin_actualizar', (select coalesce(json_agg(json_build_object('articulo_id', a.id, 'nombre', a.nombre, 'fecha', f.f) order by f.cant desc), '[]'::json)
                        from (select * from ultfecha where f < current_date - dias_viejo order by cant desc limit 8) f join arts a on a.id = f.articulo_id),
    'alertas', (select coalesce(json_agg(json_build_object('id', l.id, 'tipo', l.tipo, 'mensaje', l.mensaje, 'articulo_id', l.articulo_id,
                   'comprobante_id', l.comprobante_id, 'creado_en', l.creado_en) order by l.creado_en desc, l.id desc), '[]'::json)
                 from (select * from public.alertas_precios where profesional_id = p_cuenta order by creado_en desc, id desc limit 20) l),
    'ultimas', (select coalesce(json_agg(x order by x.registrado_en desc), '[]'::json) from (
                  select c.id, c.documento, c.numero, c.fecha, c.moneda, c.total, c.proveedor_id, c.proveedor_nombre, c.registrado_en, c.registrado_por_nombre,
                         c.archivos, (select count(*) from h where h.comprobante_id = c.id) as precios
                    from public.comprobantes c where c.profesional_id = p_cuenta and c.estado = 'registrado' and c.tipo = 'compra'
                   order by c.registrado_en desc limit 8) x)
  ));
end $$;

-- Ficha del proveedor: lo que se le compró y cómo están sus precios
drop function if exists public.proveedor_compras(uuid);
-- p_cuenta: la cuenta con la que se trabaja (para los proveedores de TaListo!, que no son de nadie)
create or replace function public.proveedor_compras(p_proveedor uuid, p_cuenta uuid default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare v public.proveedores; cuenta uuid;
begin
  select * into v from public.proveedores where id = p_proveedor;
  if v.id is null then raise exception 'No encontramos el proveedor'; end if;
  cuenta := coalesce(v.profesional_id, p_cuenta, auth.uid());
  if not public._ve_compras(cuenta) then raise exception 'No tenés acceso a los precios de esta empresa'; end if;
  return (
  with u as (select distinct on (h.articulo_id) h.articulo_id, h.precio_base_uyu, h.precio, h.moneda, h.fecha, h.documento
               from public.precios_historial h where h.profesional_id = cuenta and h.proveedor_id = v.id and not h.anulado
              order by h.articulo_id, h.fecha desc, h.id desc)
  select json_build_object(
    'compras', (select count(*) from public.precios_historial h where h.profesional_id = cuenta and h.proveedor_id = v.id and not h.anulado),
    'documentos', (select count(distinct coalesce(h.comprobante_id::text, h.orden_compra_id::text, h.id::text)) from public.precios_historial h
                    where h.profesional_id = cuenta and h.proveedor_id = v.id and not h.anulado),
    'ultima', (select max(fecha) from u),
    'articulos', (select coalesce(json_agg(x order by x.fecha desc), '[]'::json) from (
        select u.articulo_id, a.nombre, a.unidad, u.precio_base_uyu, u.precio, u.moneda, u.fecha, u.documento,
               (select p.precio_base_uyu from public.precios_historial p where p.articulo_id = u.articulo_id and p.proveedor_id = v.id and not p.anulado
                  and p.fecha <= u.fecha and p.precio_base_uyu is not null order by p.fecha desc, p.id desc offset 1 limit 1) as anterior,
               (select json_build_object('proveedor', o.proveedor, 'precio', o.precio_base_uyu) from public._ofertas(cuenta, u.articulo_id) o
                 where o.proveedor_id <> v.id and o.precio_base_uyu < u.precio_base_uyu order by o.precio_base_uyu limit 1) as mejor_otro
          from u join public.articulos a on a.id = u.articulo_id limit 300) x)
  ));
end $$;

create or replace function public.articulo_de_material(p_material uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare m public.materiales; a uuid;
begin
  select * into m from public.materiales where id = p_material;
  if m.id is null or not public._ve_compras(m.profesional_id) then return null; end if;
  select id into a from public.articulos where profesional_id = m.profesional_id and material_id = m.id order by (unido_a is null) desc, creado_en limit 1;
  return case when a is null then null else public._articulo_final(a) end;
end $$;

-- Para el presupuesto y el ticket: último costo conocido, mejor precio registrado y si está desactualizado
-- p_items: [{ i, producto_id?, descripcion, unidad }]
create or replace function public.mejores_precios(p_cuenta uuid, p_items jsonb)
returns json language plpgsql stable security definer set search_path = public as $$
declare it jsonb; a uuid; fac numeric; res jsonb := '[]'::jsonb; mej record; ult record; n int; dias int;
begin
  if p_cuenta is null or public.plan_de(p_cuenta) <> 'business'
     or not public.puede(p_cuenta, array['compras', 'importes', 'stock', 'seguimiento', 'presupuestos']) then
    return '[]'::json;
  end if;
  if jsonb_typeof(p_items) <> 'array' then return '[]'::json; end if;
  dias := coalesce((select dias_precio_viejo from public.ajustes where profesional_id = p_cuenta), 90);
  for it in select * from jsonb_array_elements(p_items) limit 300 loop
    a := null; fac := 1;
    if public.uuid_o_null(it ->> 'producto_id') is not null then
      select ap.articulo_id, ap.factor into a, fac from public.articulos_productos ap
       where ap.profesional_id = p_cuenta and ap.producto_id = public.uuid_o_null(it ->> 'producto_id');
    end if;
    if a is null and nullif(trim(coalesce(it ->> 'descripcion', '')), '') is not null then
      select id into a from public.articulos where profesional_id = p_cuenta and clave = public._clave_articulo(it ->> 'descripcion', it ->> 'unidad');
      fac := 1;
    end if;
    if a is null then continue; end if;
    a := public._articulo_final(a); fac := coalesce(fac, 1);
    select o.* into mej from public._ofertas(p_cuenta, a) o where o.precio_base_uyu is not null order by o.precio_base_uyu, o.fecha desc limit 1;
    select h.precio_base_uyu, h.precio, h.moneda, h.fecha, h.proveedor_nombre into ult from public.precios_historial h
     where h.profesional_id = p_cuenta and h.articulo_id = a and not h.anulado order by h.fecha desc, h.id desc limit 1;
    select count(distinct o.proveedor_id) into n from public._ofertas(p_cuenta, a) o where o.precio_base_uyu is not null;
    if mej.proveedor_id is null and ult.fecha is null then continue; end if;
    res := res || jsonb_build_object(
      'i', it -> 'i', 'articulo_id', a, 'nombre', (select nombre from public.articulos where id = a), 'factor', fac,
      'mejor', case when mej.proveedor_id is not null then jsonb_build_object('proveedor_id', mej.proveedor_id, 'proveedor', mej.proveedor, 'origen', mej.origen,
                 'precio_uyu', round(mej.precio_base_uyu * fac, 2), 'fecha', mej.fecha, 'producto_id', mej.producto_id, 'codigo', mej.codigo) end,
      'ultimo', case when ult.fecha is not null then jsonb_build_object('precio_uyu', round(ult.precio_base_uyu * fac, 2), 'fecha', ult.fecha, 'proveedor', ult.proveedor_nombre) end,
      'opciones', n,
      'dias', case when coalesce(mej.fecha, ult.fecha) is not null then current_date - greatest(coalesce(mej.fecha, ult.fecha), coalesce(ult.fecha, mej.fecha)) end,
      'desactualizado', greatest(coalesce(mej.fecha, ult.fecha), coalesce(ult.fecha, mej.fecha)) < current_date - dias);
  end loop;
  return res::json;
end $$;

create or replace function public.alertas_de_comprobante(p_comprobante uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare c public.comprobantes;
begin
  select * into c from public.comprobantes where id = p_comprobante;
  if c.id is null or not public._ve_compras(c.profesional_id) then return '[]'::json; end if;
  return (select coalesce(json_agg(json_build_object('tipo', tipo, 'mensaje', mensaje, 'articulo_id', articulo_id) order by id), '[]'::json)
            from public.alertas_precios where comprobante_id = c.id);
end $$;

-- Precios viejos: un aviso por semana como mucho (se revisa al abrir Compras o el panel de inteligencia)
create or replace function public.revisar_precios_viejos(p_cuenta uuid)
returns int language plpgsql security definer set search_path = public as $$
declare dias int; n int; ej text; msg text;
begin
  if not public._ve_compras(p_cuenta) then return 0; end if;
  if exists (select 1 from public.alertas_precios where profesional_id = p_cuenta and tipo = 'desactualizado' and creado_en > now() - interval '7 days') then
    return 0;
  end if;
  dias := coalesce((select dias_precio_viejo from public.ajustes where profesional_id = p_cuenta), 90);
  select count(*), string_agg(nombre, ', ' order by f desc) filter (where k <= 3) into n, ej from (
    select a.nombre, max(h.fecha) f, row_number() over (order by sum(coalesce(h.cantidad, 1)) desc) k
      from public.articulos a join public.precios_historial h on h.articulo_id = a.id and not h.anulado
     where a.profesional_id = p_cuenta and a.unido_a is null and not public._es_envio(a.nombre)
     group by a.id, a.nombre having max(h.fecha) < current_date - dias) x;
  if n = 0 then return 0; end if;
  msg := format('%s %s sin precio de compra en los últimos %s días: %s%s. Pedí precios actualizados antes de presupuestar.',
                n, case when n = 1 then 'artículo' else 'artículos' end, dias, ej, case when n > 3 then '…' else '' end);
  insert into public.alertas_precios (profesional_id, tipo, mensaje) values (p_cuenta, 'desactualizado', msg);
  perform public._avisar(array(select public._con_permiso(p_cuenta, array['compras', 'stock'])), p_cuenta, 'precios',
                         'Precios de compra desactualizados', msg, '/panel/finanzas/inteligencia', jsonb_build_object('articulos', n));
  return n;
end $$;

-- ---------------------------------------------------------------------
-- 6. Correcciones (quedan en la bitácora)
-- ---------------------------------------------------------------------
-- "Es el mismo producto": une dos artículos. p_factor: cuántas unidades del destino trae una del origen (si las unidades son distintas)
create or replace function public.unir_articulos(p_origen uuid, p_destino uuid, p_factor numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.articulos; d public.articulos; f numeric;
begin
  select * into o from public.articulos where id = public._articulo_final(p_origen);
  select * into d from public.articulos where id = public._articulo_final(p_destino);
  if o.id is null or d.id is null or o.profesional_id <> d.profesional_id then raise exception 'No encontramos los artículos'; end if;
  if o.id = d.id then raise exception 'Es el mismo artículo'; end if;
  if not public.puede(o.profesional_id, array['compras', 'stock']) or public.plan_de(o.profesional_id) <> 'business' then
    raise exception 'Para unir artículos necesitás el permiso Compras o Stock';
  end if;
  if o.unidad <> d.unidad and (p_factor is null or p_factor <= 0) then
    raise exception 'Las unidades son distintas (% y %): indicá cuántos % trae cada %', o.unidad, d.unidad, d.unidad, o.unidad;
  end if;
  f := case when o.unidad = d.unidad then coalesce(nullif(p_factor, 0), 1) else p_factor end;
  update public.precios_historial set articulo_id = d.id, factor = factor * f,
         precio_base_uyu = case when precio_base_uyu is not null then round(precio_base_uyu / f, 6) end
   where articulo_id = o.id;
  update public.articulos_productos set articulo_id = d.id, factor = factor * f where articulo_id = o.id;
  update public.alertas_precios set articulo_id = d.id where articulo_id = o.id;
  update public.articulos set unido_a = d.id, actualizado_en = now() where id = o.id;
  update public.articulos set material_id = o.material_id where id = d.id and material_id is null and o.material_id is not null;
  perform public._registrar(o.profesional_id, 'compras', format('Artículos unidos: "%s" ahora es "%s"', o.nombre, d.nombre),
                            case when f <> 1 then format('Cada %s trae %s %s', o.unidad, public.cantidad_texto(f), d.unidad) end);
end $$;

-- Un precio mal cargado se anula (no se borra), con el motivo
create or replace function public.anular_precio(p_id bigint, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare h public.precios_historial;
begin
  select * into h from public.precios_historial where id = p_id;
  if h.id is null then raise exception 'No encontramos el precio'; end if;
  if not public.puede(h.profesional_id, array['compras', 'stock']) or public.plan_de(h.profesional_id) <> 'business' then
    raise exception 'Para corregir precios necesitás el permiso Compras o Stock';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Contá por qué se anula este precio'; end if;
  update public.precios_historial set anulado = true, anulado_motivo = left(trim(p_motivo), 300), anulado_por = auth.uid(), anulado_en = now()
   where id = p_id and not anulado;
  perform public._registrar(h.profesional_id, 'compras', format('Precio anulado: %s de %s (%s)', h.descripcion, coalesce(h.proveedor_nombre, '—'), public._pesos(h.precio)),
                            'Motivo: ' || left(trim(p_motivo), 300));
end $$;

create or replace function public.guardar_ajustes_compras(p_cuenta uuid, p_pct numeric, p_dias int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.puede(p_cuenta, array['compras']) then raise exception 'Para cambiar las alertas necesitás el permiso Compras'; end if;
  if p_pct is null or p_pct < 1 or p_pct > 100 then raise exception 'El porcentaje de la alerta va de 1 a 100'; end if;
  if p_dias is null or p_dias < 7 or p_dias > 730 then raise exception 'Los días van de 7 a 730'; end if;
  insert into public.ajustes (profesional_id, alerta_precio_pct, dias_precio_viejo) values (p_cuenta, p_pct, p_dias)
  on conflict (profesional_id) do update set alerta_precio_pct = excluded.alerta_precio_pct, dias_precio_viejo = excluded.dias_precio_viejo;
end $$;

-- Lo que ya se compró antes de este SQL (comprobantes y órdenes recibidas) también entra al historial
do $$
declare r record;
begin
  for r in select id from public.comprobantes where estado = 'registrado' and tipo = 'compra'
            and not exists (select 1 from public.precios_historial h where h.comprobante_id = comprobantes.id) order by registrado_en loop
    perform public._historial_de_comprobante(r.id);
  end loop;
  for r in select id from public.ordenes_compra where estado in ('parcial', 'recibida')
            and not exists (select 1 from public.precios_historial h where h.orden_compra_id = ordenes_compra.id) order by fecha loop
    perform public._historial_de_orden(r.id);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 7. Quién ve qué (solo lectura; se escribe con las funciones)
-- ---------------------------------------------------------------------
alter table public.articulos enable row level security;
alter table public.articulos_productos enable row level security;
alter table public.precios_historial enable row level security;
alter table public.alertas_precios enable row level security;
do $$
declare t text;
begin
  foreach t in array array['articulos', 'articulos_productos', 'precios_historial', 'alertas_precios'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select using (profesional_id = (select auth.uid()) '
                   'or profesional_id in (select public.cuentas_con(array[''compras'', ''importes'', ''stock'', ''seguimiento''])))', t || '_leer', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.articulo_precios(uuid)', 'public.buscar_articulos(uuid, text, int)', 'public.inteligencia_compras(uuid, int)',
    'public.proveedor_compras(uuid, uuid)', 'public.articulo_de_material(uuid)', 'public.mejores_precios(uuid, jsonb)',
    'public.alertas_de_comprobante(uuid)', 'public.unir_articulos(uuid, uuid, numeric)', 'public.anular_precio(bigint, text)',
    'public.guardar_ajustes_compras(uuid, numeric, int)', 'public.revisar_precios_viejos(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._ve_compras(uuid)', 'public._es_envio(text)', 'public._pct(numeric)', 'public._articulo_final(uuid)', 'public._articulo(uuid, uuid, uuid, text, text)', 'public._ultimos_precios(uuid, uuid)',
    'public._registrar_precio(jsonb)', 'public._avisar_precios(uuid, text, text, jsonb, text)', 'public._historial_de_comprobante(uuid)',
    'public._historial_de_orden(uuid)', 'public._ofertas(uuid, uuid)', 'public._recomendacion(uuid, uuid)',
    'public.historial_al_registrar()', 'public.historial_al_recibir()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

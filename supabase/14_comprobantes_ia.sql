-- =====================================================================
--  TaListo!  ·  COMPROBANTES LEÍDOS CON IA (planes Pro y Business)
--  · Se le saca una foto (o se sube el PDF) a una factura, e-ticket,
--    remito o cualquier comprobante y la IA lo lee.
--  · Si es un gasto (nafta, peaje, almuerzo…) se agrega a Mis gastos.
--  · Si es una compra: queda el proveedor con el precio unitario de cada
--    artículo (sale al buscar materiales en los presupuestos) y, en
--    Business, los materiales entran al stock con un comprobante.
--  · Cada comprobante queda registrado con su foto, quién lo cargó y qué
--    se generó. Hay un tope de lecturas por mes según el plan (lo cambia
--    el admin).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 13). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.movimientos_stock') is null or to_regclass('public.proveedores') is null then
    raise exception 'Primero corré los SQL 09 y 10 (proveedores y stock)';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Tope de lecturas por mes (lo edita el admin)
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists ia_lecturas_pro int not null default 60;
alter table public.configuracion add column if not exists ia_lecturas_business int not null default 300;
alter table public.configuracion drop constraint if exists configuracion_ia_check;
alter table public.configuracion add constraint configuracion_ia_check check (ia_lecturas_pro >= 0 and ia_lecturas_business >= 0);

-- ---------------------------------------------------------------------
-- 2. Comprobantes: lo que se leyó y lo que se cargó con cada uno
-- ---------------------------------------------------------------------
create table if not exists public.comprobantes (
  id                     uuid primary key default gen_random_uuid(),
  profesional_id         uuid not null references public.profesionales(id) on delete cascade,
  usuario_id             uuid references public.perfiles(id) on delete set null,
  usuario_nombre         text,
  estado                 text not null default 'leyendo' check (estado in ('leyendo', 'leido', 'registrado', 'descartado', 'error')),
  archivos               text[] not null default '{}',      -- fotos o PDF en el Storage (bucket "comprobantes")
  datos                  jsonb,                               -- lo que leyó la IA
  cargado                jsonb,                               -- lo que se confirmó al registrar
  tipo                   text check (tipo is null or tipo in ('gasto', 'compra')),
  documento              text,
  numero                 text,
  fecha                  date,
  moneda                 text,
  total                  numeric(14,2),
  rut                    text,
  proveedor_id           uuid,
  proveedor_nombre       text,
  gasto_id               uuid,
  movimiento_id          uuid,
  productos              int,
  resumen                text,
  error                  text,
  creado_en              timestamptz not null default now(),
  registrado_en          timestamptz,
  registrado_por         uuid,
  registrado_por_nombre  text
);
create index if not exists comprobantes_cuenta_idx on public.comprobantes (profesional_id, creado_en desc);

-- Usa la lectura: cuenta Pro o Business y permiso Gastos, Compras o Stock
create or replace function public.puede_comprobantes(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c is not null and public.plan_de(c) <> 'free' and public.puede(c, array['gastos', 'compras', 'stock']);
$$;
-- Ve los comprobantes cargados: además, Importes y Seguimiento
create or replace function public.ve_comprobantes(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c is not null and public.puede(c, array['gastos', 'compras', 'stock', 'importes', 'seguimiento']);
$$;

create or replace function public._fecha_o_null(t text)
returns date language plpgsql immutable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(t, 10)::date;
exception when others then
  return null;
end $$;

create or replace function public._limite_ia(c uuid)
returns int language sql stable security definer set search_path = public as $$
  select case public.plan_de(c) when 'business' then x.ia_lecturas_business when 'pro' then x.ia_lecturas_pro else 0 end
  from public.configuracion x where x.id = 1;
$$;

create or replace function public._lecturas_mes(c uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.comprobantes
  where profesional_id = c and creado_en >= public.inicio_mes_uy() and estado <> 'error';
$$;

-- Cuántas lecturas se usaron este mes y cuántas hay
create or replace function public.lecturas_ia(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_comprobantes(p_cuenta) then raise exception 'No tenés acceso a los comprobantes de esta cuenta'; end if;
  return json_build_object('usadas', public._lecturas_mes(p_cuenta), 'limite', public._limite_ia(p_cuenta),
                           'puede', public.puede_comprobantes(p_cuenta));
end $$;

-- La llama el servidor antes de mandar el comprobante a la IA (controla plan, permiso y tope)
create or replace function public.iniciar_lectura_comprobante(p_cuenta uuid, p_archivos text[] default '{}')
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); lim int; usadas int; v uuid; arch text[];
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_cuenta is null or public.plan_de(p_cuenta) = 'free' then
    raise exception using errcode = 'TL001', message = 'Leer comprobantes con IA es parte de los planes Pro y Business.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  if not public.puede(p_cuenta, array['gastos', 'compras', 'stock']) then
    raise exception 'No tenés permiso para cargar comprobantes de esta cuenta';
  end if;
  perform pg_advisory_xact_lock(hashtext('comprobantes' || p_cuenta::text));
  -- lecturas que quedaron colgadas (se cortó la conexión): no cuentan
  update public.comprobantes set estado = 'error', error = 'Se cortó la lectura'
   where profesional_id = p_cuenta and estado = 'leyendo' and creado_en < now() - interval '10 minutes';
  lim := public._limite_ia(p_cuenta);
  usadas := public._lecturas_mes(p_cuenta);
  if usadas >= lim then
    raise exception using errcode = 'TL002',
      message = format('Llegaron al tope de %s comprobantes leídos con IA este mes.', lim),
      hint = 'El mes que viene se renueva. Mientras tanto los podés cargar a mano.';
  end if;
  -- solo archivos de la carpeta de esta cuenta
  select coalesce(array_agg(a), '{}') into arch
    from (select a from unnest(coalesce(p_archivos, '{}')) a where a like p_cuenta::text || '/%' and length(a) <= 300 limit 3) x;
  insert into public.comprobantes (profesional_id, usuario_id, usuario_nombre, archivos)
  values (p_cuenta, uid, public._nombre_de(uid), arch)
  returning id into v;
  return json_build_object('id', v, 'usadas', usadas + 1, 'limite', lim);
end $$;

-- Lo que leyó la IA (o el error si no pudo)
create or replace function public.guardar_lectura_comprobante(p_id uuid, p_datos jsonb, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.comprobantes set
    estado = case when p_error is null and p_datos is not null then 'leido' else 'error' end,
    datos = p_datos,
    error = nullif(left(coalesce(p_error, ''), 300), ''),
    tipo = case when p_datos ->> 'tipo' in ('gasto', 'compra') then p_datos ->> 'tipo' end,
    documento = nullif(left(trim(coalesce(p_datos ->> 'tipo_documento', '')), 40), ''),
    numero = nullif(left(trim(coalesce(p_datos ->> 'numero', '')), 40), ''),
    fecha = public._fecha_o_null(p_datos ->> 'fecha'),
    moneda = case when p_datos ->> 'moneda' = 'USD' then 'USD' else 'UYU' end,
    total = round(public.numero_o_null(p_datos ->> 'total'), 2),
    proveedor_nombre = nullif(left(trim(coalesce(p_datos -> 'proveedor' ->> 'nombre', '')), 120), '')
  where id = p_id and usuario_id = auth.uid() and estado = 'leyendo';
end $$;

create or replace function public.descartar_comprobante(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.comprobantes;
begin
  select * into c from public.comprobantes where id = p_id;
  if not found or not public.puede(c.profesional_id, array['gastos', 'compras', 'stock']) then
    raise exception 'No encontramos el comprobante';
  end if;
  if c.estado = 'registrado' then raise exception 'Este comprobante ya se registró'; end if;
  update public.comprobantes set estado = 'descartado' where id = p_id and estado in ('leido', 'error');
end $$;

-- ---------------------------------------------------------------------
-- 3. Registrar lo revisado
--    p_datos: { tipo: gasto|compra, fecha, numero, tipo_documento, moneda, cotizacion, total,
--               gasto: { categoria, descripcion, monto (en pesos), litros, precio_unitario },
--               proveedor: { id?, nombre, rut, telefono, email, direccion },
--               precios_con_iva, sumar_gasto, al_stock, destino,
--               items: [{ codigo, descripcion, cantidad, unidad, precio_unitario, descuento_pct, iva_pct,
--                         al_stock, material_id?, cantidad_stock, unidad_stock }] }
--    Precios: se guardan en la moneda del proveedor y como él los lista (con o sin IVA).
--    Costo del material en el stock: sin IVA, por unidad del stock.
-- ---------------------------------------------------------------------
create or replace function public.registrar_comprobante(p_id uuid, p_datos jsonb, p_forzar boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); c public.comprobantes; cuenta uuid; v_tipo text; mon text; cot numeric; v_fecha date; v_num text; v_doc text;
  prov jsonb; prov_id uuid; prov_nombre text; v_rut text; prov_nuevo boolean := false; pv public.proveedores;
  con_iva boolean; stock_on boolean := false; dest uuid; dest_nombre text;
  it jsonb; nom text; cod text; cod_real text; uni text; cant numeric; precio numeric; neto numeric; neto_sin numeric; iva numeric;
  precio_prov numeric; prod uuid; mat uuid; base numeric; dec int; uni_st text;
  items_stock jsonb := '[]'::jsonb; rs jsonb; r jsonb; mov uuid; mov_num int; v_gasto uuid; n_prod int := 0; n_mat int := 0;
  monto numeric; cat text; previo record; partes text[] := '{}';
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  select * into c from public.comprobantes where id = p_id for update;
  if not found then raise exception 'No encontramos el comprobante'; end if;
  cuenta := c.profesional_id;
  if not public.puede(cuenta, array['gastos', 'compras', 'stock']) then raise exception 'No tenés permiso para cargar comprobantes de esta cuenta'; end if;
  if public.plan_de(cuenta) = 'free' then
    raise exception using errcode = 'TL001', message = 'Leer comprobantes con IA es parte de los planes Pro y Business.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  if c.estado = 'registrado' then raise exception 'Este comprobante ya se registró'; end if;
  if c.estado not in ('leido', 'descartado') then raise exception 'Este comprobante no se terminó de leer'; end if;
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then raise exception 'Faltan los datos del comprobante'; end if;

  v_tipo := p_datos ->> 'tipo';
  if v_tipo is null or v_tipo not in ('gasto', 'compra') then raise exception 'Elegí si es un gasto o una compra'; end if;
  mon := case when p_datos ->> 'moneda' = 'USD' then 'USD' else 'UYU' end;
  cot := public.numero_o_null(p_datos ->> 'cotizacion');
  if cot is not null and cot <= 0 then cot := null; end if;
  v_fecha := coalesce(public._fecha_o_null(p_datos ->> 'fecha'), (now() at time zone 'America/Montevideo')::date);
  v_num := nullif(left(trim(coalesce(p_datos ->> 'numero', '')), 40), '');
  v_doc := nullif(left(trim(coalesce(p_datos ->> 'tipo_documento', '')), 40), '');
  prov := coalesce(p_datos -> 'proveedor', '{}'::jsonb);
  if jsonb_typeof(prov) <> 'object' then prov := '{}'::jsonb; end if;
  v_rut := nullif(regexp_replace(coalesce(prov ->> 'rut', ''), '\D', '', 'g'), '');
  prov_nombre := nullif(left(trim(coalesce(prov ->> 'nombre', '')), 120), '');
  con_iva := coalesce(lower(p_datos ->> 'precios_con_iva') = 'true', false);

  -- ¿Ya se cargó este comprobante?
  if not coalesce(p_forzar, false) and v_num is not null then
    select x.registrado_en, x.registrado_por_nombre into previo from public.comprobantes x
     where x.profesional_id = cuenta and x.estado = 'registrado' and x.id <> c.id and lower(x.numero) = lower(v_num)
       and ((v_rut is not null and x.rut = v_rut)
            or public.normalizar(coalesce(x.proveedor_nombre, '')) = public.normalizar(coalesce(prov_nombre, '')))
     order by x.registrado_en desc limit 1;
    if found then
      raise exception using errcode = 'TL005',
        message = format('El comprobante %s ya se cargó el %s%s.', v_num,
                         to_char(previo.registrado_en at time zone 'America/Montevideo', 'DD/MM/YYYY'),
                         coalesce(' por ' || previo.registrado_por_nombre, ''));
    end if;
  end if;

  if v_tipo = 'gasto' then
    -- -------------------------------------------------- gasto
    if not public.puede(cuenta, array['gastos']) then raise exception 'No tenés permiso para cargar gastos'; end if;
    monto := round(public.numero_o_null(p_datos -> 'gasto' ->> 'monto'), 2);
    if monto is null or monto < 0 then raise exception 'Poné el monto del gasto (en pesos)'; end if;
    cat := left(coalesce(nullif(trim(p_datos -> 'gasto' ->> 'categoria'), ''), 'Otros'), 40);
    insert into public.gastos (profesional_id, fecha, categoria, descripcion, litros, precio_unitario, monto)
    values (cuenta, v_fecha, cat,
            nullif(left(trim(coalesce(p_datos -> 'gasto' ->> 'descripcion', '')), 300), ''),
            case when public.numero_o_null(p_datos -> 'gasto' ->> 'litros') between 0 and 99999999 then round(public.numero_o_null(p_datos -> 'gasto' ->> 'litros'), 2) end,
            case when public.numero_o_null(p_datos -> 'gasto' ->> 'precio_unitario') between 0 and 9999999999 then round(public.numero_o_null(p_datos -> 'gasto' ->> 'precio_unitario'), 2) end,
            monto)
    returning id into v_gasto;
    partes := array[format('Gasto en %s: $ %s', cat, replace(to_char(round(monto), 'FM999,999,999,990'), ',', '.'))];
  else
    -- -------------------------------------------------- compra
    if not public.puede(cuenta, array['compras', 'stock']) then raise exception 'No tenés permiso para cargar compras'; end if;
    if jsonb_typeof(p_datos -> 'items') <> 'array' then raise exception 'No hay artículos para cargar'; end if;
    if jsonb_array_length(p_datos -> 'items') > 200 then raise exception 'Demasiados renglones (máximo 200)'; end if;

    -- proveedor: el elegido, o el de la cuenta con ese RUT o nombre, o uno nuevo
    prov_id := public.uuid_o_null(prov ->> 'id');
    if prov_id is not null and not exists (select 1 from public.proveedores where id = prov_id and profesional_id = cuenta) then
      prov_id := null;
    end if;
    if prov_id is null and v_rut is not null then
      select id into prov_id from public.proveedores
       where profesional_id = cuenta and regexp_replace(coalesce(rut, ''), '\D', '', 'g') = v_rut order by activo desc limit 1;
    end if;
    if prov_id is null and prov_nombre is not null then
      select id into prov_id from public.proveedores
       where profesional_id = cuenta and public.normalizar(nombre) = public.normalizar(prov_nombre) order by activo desc limit 1;
    end if;
    if prov_id is null then
      if prov_nombre is null then raise exception 'Poné el nombre del proveedor'; end if;
      insert into public.proveedores (profesional_id, nombre, rut, telefono, email, direccion, moneda, iva_incluido, fuente, notas)
      values (cuenta, prov_nombre, v_rut,
              nullif(left(trim(coalesce(prov ->> 'telefono', '')), 40), ''),
              nullif(left(trim(coalesce(prov ->> 'email', '')), 120), ''),
              nullif(left(trim(coalesce(prov ->> 'direccion', '')), 200), ''),
              mon, con_iva, 'manual', 'Creado desde un comprobante leído con IA')
      returning id into prov_id;
      prov_nuevo := true;
    else
      update public.proveedores set
        rut = coalesce(nullif(rut, ''), v_rut),
        telefono = coalesce(nullif(telefono, ''), nullif(left(trim(coalesce(prov ->> 'telefono', '')), 40), '')),
        email = coalesce(nullif(email, ''), nullif(left(trim(coalesce(prov ->> 'email', '')), 120), '')),
        direccion = coalesce(nullif(direccion, ''), nullif(left(trim(coalesce(prov ->> 'direccion', '')), 200), '')),
        activo = true
      where id = prov_id;
    end if;
    select * into pv from public.proveedores where id = prov_id;
    prov_nombre := pv.nombre;
    if pv.moneda <> mon and cot is null and exists (
         select 1 from jsonb_array_elements(p_datos -> 'items') x where public.numero_o_null(x ->> 'precio_unitario') is not null) then
      raise exception 'Este proveedor tiene los precios en %: poné la cotización del dólar para pasarlos',
        case when pv.moneda = 'USD' then 'dólares' else 'pesos' end;
    end if;

    -- stock (Business, con permiso Stock)
    stock_on := coalesce(lower(p_datos ->> 'al_stock') = 'true', false)
                and exists (select 1 from jsonb_array_elements(p_datos -> 'items') x where coalesce(lower(x ->> 'al_stock') = 'true', false));
    if stock_on then
      if public.plan_de(cuenta) <> 'business' then
        stock_on := false;
      else
        if not public.gestiona_stock(cuenta) then raise exception 'Para ingresar materiales al stock necesitás el permiso Stock'; end if;
        perform public._stock_abrir(cuenta);
        dest := public.uuid_o_null(p_datos ->> 'destino');
        if dest is not null and not exists (select 1 from public.ubicaciones_stock where id = dest and profesional_id = cuenta
                                            and tipo in ('deposito', 'operario') and activo) then
          raise exception 'Elegí a qué depósito entra';
        end if;
        dest := coalesce(dest, public._stock_principal(cuenta));
        select nombre into dest_nombre from public.ubicaciones_stock where id = dest;
      end if;
    end if;

    for it in select * from jsonb_array_elements(p_datos -> 'items') loop
      if jsonb_typeof(it) <> 'object' or lower(coalesce(it ->> 'incluir', 'true')) = 'false' then continue; end if;
      nom := nullif(left(trim(coalesce(it ->> 'descripcion', '')), 300), '');
      if nom is null then continue; end if;
      cant := coalesce(public.numero_o_null(it ->> 'cantidad'), 1);
      if cant <= 0 then raise exception 'Revisá la cantidad de %', nom; end if;
      cod_real := nullif(left(trim(coalesce(it ->> 'codigo', '')), 80), '');
      cod := coalesce(cod_real, 'SC-' || left(md5(public.normalizar(nom)), 10));
      uni := coalesce(nullif(left(trim(coalesce(it ->> 'unidad', '')), 20), ''), 'u');
      precio := public.numero_o_null(it ->> 'precio_unitario');
      if precio is not null and (precio < 0 or precio >= 1e11) then raise exception 'Revisá el precio de %', nom; end if;
      iva := coalesce(public.numero_o_null(it ->> 'iva_pct'), 22);
      if iva < 0 or iva > 100 then iva := 22; end if;
      neto := case when precio is not null then precio * (1 - least(greatest(coalesce(public.numero_o_null(it ->> 'descuento_pct'), 0), 0), 100) / 100) end;
      neto_sin := case when neto is not null then case when con_iva then neto / (1 + iva / 100) else neto end end;

      -- precio para la lista del proveedor (su moneda y con o sin IVA como él lista)
      prod := null;
      if neto is not null then
        precio_prov := case when pv.iva_incluido then neto_sin * (1 + iva / 100) else neto_sin end;
        if pv.moneda <> mon then
          precio_prov := case when pv.moneda = 'USD' then precio_prov / cot else precio_prov * cot end;
        end if;
        insert into public.productos_proveedor as p (proveedor_id, codigo, nombre, unidad, precio, activo)
        values (prov_id, cod, nom, uni, round(precio_prov, 2), true)
        on conflict (proveedor_id, codigo) do update set nombre = excluded.nombre, unidad = excluded.unidad,
          precio = excluded.precio, activo = true
        returning p.id into prod;
        n_prod := n_prod + 1;
      else
        select id into prod from public.productos_proveedor where proveedor_id = prov_id and codigo = cod;
      end if;

      -- al stock
      if stock_on and coalesce(lower(it ->> 'al_stock') = 'true', false) then
        base := round(coalesce(public.numero_o_null(it ->> 'cantidad_stock'), cant), 3);
        if base <= 0 then raise exception 'Revisá cuánto entra al stock de %', nom; end if;
        mat := public.uuid_o_null(it ->> 'material_id');
        if mat is not null and not exists (select 1 from public.materiales where id = mat and profesional_id = cuenta) then mat := null; end if;
        if mat is null and prod is not null then
          select material_id into mat from public.materiales_vinculos where profesional_id = cuenta and producto_id = prod;
        end if;
        if mat is null and cod_real is not null then
          select id into mat from public.materiales where profesional_id = cuenta and lower(codigo) = lower(left(cod_real, 60));
        end if;
        if mat is null then
          select id into mat from public.materiales
           where profesional_id = cuenta and public.normalizar(nombre) = public.normalizar(nom) order by activo desc limit 1;
        end if;
        if mat is null then
          uni_st := coalesce(nullif(left(trim(coalesce(it ->> 'unidad_stock', '')), 12), ''), left(uni, 12));
          dec := greatest(case when base = trunc(base) then 0 when base * 10 = trunc(base * 10) then 1 when base * 100 = trunc(base * 100) then 2 else 3 end,
                          case when uni_st in ('m', 'm²', 'l') then 2 when uni_st in ('kg', 'm³') then 3 else 0 end);
          insert into public.materiales (profesional_id, codigo, nombre, unidad, decimales)
          values (cuenta, case when cod_real is not null and length(cod_real) <= 60 then cod_real end, left(nom, 200), uni_st, dec)
          returning id into mat;
          n_mat := n_mat + 1;
        else
          update public.materiales set activo = true where id = mat and not activo;
        end if;
        if prod is not null then
          insert into public.materiales_vinculos (profesional_id, producto_id, material_id, factor)
          values (cuenta, prod, mat, least(greatest(round(base / cant, 3), 0.001), 1000000))
          on conflict (profesional_id, producto_id) do update set material_id = excluded.material_id, factor = excluded.factor;
        end if;
        if neto_sin is not null then
          insert into public.materiales_costos (material_id, profesional_id, costo, moneda)
          values (mat, cuenta, round(neto_sin * cant / base, 4), mon)
          on conflict (material_id) do update set costo = excluded.costo, moneda = excluded.moneda, actualizado_en = now();
        end if;
        items_stock := items_stock || jsonb_build_array(jsonb_build_object('material_id', mat, 'cantidad', base));
      end if;
    end loop;

    if n_prod = 0 and jsonb_array_length(items_stock) = 0 then
      raise exception 'No quedó ningún artículo para cargar: revisá las descripciones y los precios';
    end if;

    -- productos activos del proveedor
    perform set_config('talisto.importando', 'si', true);
    update public.proveedores set productos = (select count(*) from public.productos_proveedor where proveedor_id = prov_id and activo)
     where id = prov_id;
    partes := array[prov_nombre || case when prov_nuevo then ' (proveedor nuevo)' else '' end];
    if n_prod > 0 then
      partes := partes || format('%s %s', n_prod, case when n_prod = 1 then 'precio guardado' else 'precios guardados' end);
    end if;

    if jsonb_array_length(items_stock) > 0 then
      rs := public._stock_renglones(cuenta, items_stock);
      mov := public._stock_comprobante(cuenta, 'ingreso', 'hecho', null, dest, rs,
               jsonb_build_object('motivo', 'compra', 'proveedor_id', prov_id, 'proveedor_nombre', prov_nombre,
                                  'referencia', trim(coalesce(v_doc, 'Comprobante') || ' ' || coalesce(v_num, '')),
                                  'nota', 'Cargado desde la foto del comprobante (leído con IA)'));
      for r in select * from jsonb_array_elements(rs) loop
        perform public._stock_sumar(cuenta, mov, dest, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
      end loop;
      select numero into mov_num from public.movimientos_stock where id = mov;
      partes := partes || format('ingreso Nº %s al %s', lpad(mov_num::text, 5, '0'), dest_nombre);
    end if;

    -- también a Mis gastos (si se pidió)
    if coalesce(lower(p_datos ->> 'sumar_gasto') = 'true', false) then
      if not public.puede(cuenta, array['gastos']) then raise exception 'No tenés permiso para cargar gastos'; end if;
      monto := round(public.numero_o_null(p_datos -> 'gasto' ->> 'monto'), 2);
      if monto is null or monto < 0 then raise exception 'Poné el monto para Mis gastos (en pesos)'; end if;
      insert into public.gastos (profesional_id, fecha, categoria, descripcion, monto)
      values (cuenta, v_fecha, left(coalesce(nullif(trim(p_datos -> 'gasto' ->> 'categoria'), ''), 'Insumos'), 40),
              left(trim(format('Compra a %s %s', prov_nombre, coalesce(v_doc || ' ' || v_num, v_num, ''))), 300), monto)
      returning id into v_gasto;
      partes := partes || 'sumado a Mis gastos';
    end if;
  end if;

  update public.comprobantes set
    estado = 'registrado', cargado = p_datos, tipo = v_tipo, documento = v_doc, numero = v_num, fecha = v_fecha, moneda = mon,
    total = coalesce(round(public.numero_o_null(p_datos ->> 'total'), 2), total), rut = v_rut,
    proveedor_id = prov_id, proveedor_nombre = coalesce(prov_nombre, proveedor_nombre),
    gasto_id = v_gasto, movimiento_id = mov, productos = n_prod,
    resumen = left(array_to_string(partes, ' · '), 300),
    registrado_en = now(), registrado_por = uid, registrado_por_nombre = public._nombre_de(uid)
  where id = c.id;

  return json_build_object('tipo', v_tipo, 'gasto_id', v_gasto, 'proveedor_id', prov_id, 'proveedor', prov_nombre,
                           'proveedor_nuevo', prov_nuevo, 'productos', n_prod, 'materiales_nuevos', n_mat,
                           'movimiento_id', mov, 'movimiento_numero', mov_num, 'destino', dest_nombre,
                           'resumen', array_to_string(partes, ' · '));
end $$;

-- ---------------------------------------------------------------------
-- 4. Quién ve los comprobantes (solo lectura: se cargan con las funciones)
-- ---------------------------------------------------------------------
alter table public.comprobantes enable row level security;
drop policy if exists comprobantes_leer on public.comprobantes;
create policy comprobantes_leer on public.comprobantes for select using (public.ve_comprobantes(profesional_id));
revoke all on public.comprobantes from anon, authenticated;
grant select on public.comprobantes to authenticated;
grant all on public.comprobantes to service_role;

-- Fotos y PDF (privados): carpeta <cuenta>/...
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('comprobantes', 'comprobantes', false, 5242880, array['image/jpeg','image/png','image/webp','application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

    execute 'drop policy if exists comprobantes_leer on storage.objects';
    execute $p$create policy comprobantes_leer on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes' and public.ve_comprobantes(public.uuid_o_null((storage.foldername(name))[1])))$p$;

    execute 'drop policy if exists comprobantes_subir on storage.objects';
    execute $p$create policy comprobantes_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes' and public.puede_comprobantes(public.uuid_o_null((storage.foldername(name))[1])))$p$;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.puede_comprobantes(uuid)', 'public.ve_comprobantes(uuid)', 'public.lecturas_ia(uuid)',
    'public.iniciar_lectura_comprobante(uuid, text[])', 'public.guardar_lectura_comprobante(uuid, jsonb, text)',
    'public.descartar_comprobante(uuid)', 'public.registrar_comprobante(uuid, jsonb, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array['public._limite_ia(uuid)', 'public._lecturas_mes(uuid)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

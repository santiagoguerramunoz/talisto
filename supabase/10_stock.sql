-- =====================================================================
--  TaListo!  ·  BUSINESS: STOCK DE LA EMPRESA, DEL EQUIPO Y DE CADA TRABAJO
--  · Materiales con su unidad mínima (unidad, metro, kg, litro…) y sus
--    presentaciones (caja x 100, rollo de 100 m, bolsa de 25 kg): se mueven
--    por caja o suelto y el stock se lleva siempre en la unidad mínima.
--  · Lugares: los depósitos de la empresa, el stock de cada persona del
--    equipo y cada trabajo (tickets B2B y trabajos de la agenda).
--  · Todo se mueve con comprobantes numerados: ingreso, entrega, a un
--    trabajo, devolución, devolución al proveedor, conteo, baja y anulación.
--    Lo que se entrega a otra persona queda pendiente hasta que confirma
--    que lo recibió (o dice que recibió distinto, o lo rechaza).
--  · Nada se edita ni se borra: un error se corrige anulando el comprobante
--    (quedan el original y su anulación). Cada asiento queda sellado con
--    una huella encadenada a la anterior: si alguien tocara la base a mano,
--    la verificación lo marca.
--  · Las órdenes de compra se reciben en el stock (todo o una parte).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 09). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.ordenes_compra') is null then
    raise exception 'Primero corré 09_proveedores.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Permiso nuevo para los roles de la empresa: Stock
-- ---------------------------------------------------------------------
create or replace function public.permisos_validos()
returns text[] language sql immutable as $$
  select array['agenda','clientes','relevamientos','tickets_asignar','tickets_trabajar',
               'presupuestos','importes','gastos','equipo','compras','stock']::text[];
$$;
-- Administración (rol de fábrica) maneja el depósito
update public.roles_empresa set permisos = array_append(permisos, 'stock')
 where nombre = 'Administración' and not ('stock' = any(permisos));

-- Las empresas nuevas arrancan con Compras y Stock en Administración
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
      (eid, 'Administración', array['agenda','clientes','relevamientos','tickets_asignar','presupuestos','importes','gastos','compras','stock'], 1),
      (eid, 'Producción',     array['tickets_trabajar'], 2),
      (eid, 'Ventas',         array['clientes','relevamientos','presupuestos'], 3);
  end if;
  return eid;
end $$;

-- Cantidad para mostrar en mensajes: 12,5 · 100 · 0,25
create or replace function public.cantidad_texto(n numeric)
returns text language sql immutable as $$
  select case when n is null then ''
              else replace(case when position('.' in n::text) > 0 then rtrim(rtrim(n::text, '0'), '.') else n::text end, '.', ',') end;
$$;

-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------
-- Materiales de la cuenta. unidad = unidad mínima en la que se lleva el stock.
-- presentaciones: [{ "nombre": "Rollo 100 m", "factor": 100 }] (factor en unidades mínimas)
create table if not exists public.materiales (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  codigo          text check (codigo is null or length(codigo) between 1 and 60),
  nombre          text not null check (length(trim(nombre)) between 1 and 200),
  marca           text check (marca is null or length(marca) <= 80),
  categoria       text check (categoria is null or length(categoria) <= 80),
  unidad          text not null default 'u' check (length(trim(unidad)) between 1 and 12),
  decimales       smallint not null default 0 check (decimales between 0 and 3),
  presentaciones  jsonb not null default '[]'::jsonb check (jsonb_typeof(presentaciones) = 'array' and jsonb_array_length(presentaciones) <= 8),
  stock_minimo    numeric(16,3) check (stock_minimo is null or stock_minimo >= 0),
  notas           text check (notas is null or length(notas) <= 500),
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  texto           text generated always as (public.normalizar(coalesce(codigo, '') || ' ' || nombre || ' ' || coalesce(marca, '') || ' ' || coalesce(categoria, ''))) stored
);
create unique index if not exists materiales_codigo_uk on public.materiales (profesional_id, lower(codigo)) where codigo is not null;
create index if not exists materiales_cuenta_idx on public.materiales (profesional_id, activo);

-- Último costo por unidad mínima (aparte: solo lo ven la cuenta principal, Importes y Compras)
create table if not exists public.materiales_costos (
  material_id     uuid primary key references public.materiales(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  costo           numeric(14,4) not null check (costo >= 0),
  moneda          text not null default 'UYU' check (moneda in ('UYU', 'USD')),
  actualizado_en  timestamptz not null default now()
);

-- Producto de la lista de un proveedor = material del stock (factor: cuántas unidades mínimas trae)
create table if not exists public.materiales_vinculos (
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  producto_id     uuid not null references public.productos_proveedor(id) on delete cascade,
  material_id     uuid not null references public.materiales(id) on delete cascade,
  factor          numeric(14,3) not null default 1 check (factor > 0 and factor <= 1000000),
  creado_en       timestamptz not null default now(),
  primary key (profesional_id, producto_id)
);
create index if not exists materiales_vinculos_material_idx on public.materiales_vinculos (material_id);

-- Lugares donde hay stock: depósitos, cada persona del equipo y cada trabajo
create table if not exists public.ubicaciones_stock (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  tipo            text not null check (tipo in ('deposito', 'operario', 'trabajo')),
  nombre          text not null check (length(trim(nombre)) between 1 and 160),
  usuario_id      uuid references public.perfiles(id) on delete set null,   -- persona del equipo
  orden_id        uuid references public.ordenes(id) on delete set null,    -- ticket B2B
  turno_id        uuid references public.turnos(id) on delete set null,     -- trabajo de la agenda
  principal       boolean not null default false,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now()
);
create unique index if not exists ubicaciones_operario_uk on public.ubicaciones_stock (profesional_id, usuario_id) where tipo = 'operario' and usuario_id is not null;
create unique index if not exists ubicaciones_orden_uk on public.ubicaciones_stock (orden_id) where orden_id is not null;
create unique index if not exists ubicaciones_turno_uk on public.ubicaciones_stock (turno_id) where turno_id is not null;
create unique index if not exists ubicaciones_principal_uk on public.ubicaciones_stock (profesional_id) where principal;
create index if not exists ubicaciones_cuenta_idx on public.ubicaciones_stock (profesional_id, tipo);

-- Saldo de cada material en cada lugar (lo mueven solo los comprobantes)
create table if not exists public.stock (
  ubicacion_id    uuid not null references public.ubicaciones_stock(id) on delete cascade,
  material_id     uuid not null references public.materiales(id) on delete cascade,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  cantidad        numeric(16,3) not null default 0 check (cantidad >= 0),
  actualizado_en  timestamptz not null default now(),
  primary key (ubicacion_id, material_id)
);
create index if not exists stock_material_idx on public.stock (material_id);
create index if not exists stock_cuenta_idx on public.stock (profesional_id);

-- Comprobantes (numerados por cuenta, sin huecos). No se editan ni se borran.
create table if not exists public.movimientos_stock (
  id                     uuid primary key default gen_random_uuid(),
  profesional_id         uuid not null references public.profesionales(id) on delete cascade,
  numero                 int not null,
  tipo                   text not null check (tipo in ('ingreso', 'transferencia', 'a_trabajo', 'devolucion',
                                                       'devolucion_proveedor', 'conteo', 'baja', 'anulacion')),
  estado                 text not null default 'hecho' check (estado in ('hecho', 'pendiente', 'rechazado', 'cancelado')),
  origen_id              uuid references public.ubicaciones_stock(id),
  destino_id             uuid references public.ubicaciones_stock(id),
  proveedor_id           uuid,   -- sin vínculo: el comprobante no cambia aunque se borre el proveedor
  proveedor_nombre       text,
  orden_compra_id        uuid references public.ordenes_compra(id),
  anula_a                uuid references public.movimientos_stock(id),
  anulado_por            uuid references public.movimientos_stock(id),
  motivo                 text,
  referencia             text,   -- remito o factura del proveedor, etc.
  nota                   text,
  creado_por             uuid,
  creado_por_nombre      text,
  creado_en              timestamptz not null default now(),
  respondido_por         uuid,
  respondido_por_nombre  text,
  respondido_en          timestamptz,
  respuesta              text,
  huella                 text,
  unique (profesional_id, numero)
);
create index if not exists movimientos_stock_origen_idx on public.movimientos_stock (origen_id);
create index if not exists movimientos_stock_destino_idx on public.movimientos_stock (destino_id);
create index if not exists movimientos_stock_pendientes_idx on public.movimientos_stock (profesional_id) where estado = 'pendiente';
create index if not exists movimientos_stock_orden_idx on public.movimientos_stock (orden_compra_id) where orden_compra_id is not null;

-- Renglones del comprobante (cantidad en unidades mínimas; en un conteo es la diferencia)
create table if not exists public.movimientos_stock_items (
  movimiento_id          uuid not null references public.movimientos_stock(id) on delete cascade,
  profesional_id         uuid not null references public.profesionales(id) on delete cascade,
  n                      smallint not null,
  material_id            uuid not null references public.materiales(id),
  cantidad               numeric(16,3) not null,
  presentacion           text,            -- cómo se cargó: "Rollo 100 m", "caja"…
  factor                 numeric(14,3),
  cantidad_presentacion  numeric(16,3),
  anterior               numeric(16,3),   -- conteo: lo que había
  orden_item             int,             -- recepción: renglón de la orden de compra
  recibido               numeric(16,3),   -- entregas: lo que confirmó quien recibe
  primary key (movimiento_id, n)
);
create index if not exists movimientos_items_material_idx on public.movimientos_stock_items (material_id);

-- Asientos (kardex): cada suma o resta en un lugar, con el saldo que quedó y su huella
create table if not exists public.kardex (
  id              bigint generated always as identity primary key,
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  movimiento_id   uuid not null references public.movimientos_stock(id),
  material_id     uuid not null references public.materiales(id),
  ubicacion_id    uuid not null references public.ubicaciones_stock(id),
  cantidad        numeric(16,3) not null check (cantidad <> 0),
  saldo           numeric(16,3) not null check (saldo >= 0),
  evento          text not null check (evento in ('alta', 'confirmacion', 'rechazo', 'cancelacion')),
  creado_en       timestamptz not null default clock_timestamp(),
  creado_por      uuid,
  huella          text not null
);
create index if not exists kardex_cuenta_idx on public.kardex (profesional_id, id);
create index if not exists kardex_material_idx on public.kardex (material_id, ubicacion_id, id);
create index if not exists kardex_movimiento_idx on public.kardex (movimiento_id);

-- Sello: cuántos asientos hay y la última huella (si falta un asiento, no coincide)
create table if not exists public.stock_sello (
  profesional_id  uuid primary key references public.profesionales(id) on delete cascade,
  asientos        bigint not null default 0,
  ultimo_id       bigint,
  ultima_huella   text,
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. ¿Quién puede qué?
-- ---------------------------------------------------------------------
-- Maneja el stock: la cuenta principal (Business) o quien tiene el permiso Stock
create or replace function public.gestiona_stock(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select (c = auth.uid() and public.plan_de(c) = 'business') or c in (select public.cuentas_con(array['stock']));
$$;
-- Ve todo el stock (sin moverlo): además, Compras
create or replace function public.ve_stock(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c = auth.uid() or c in (select public.cuentas_con(array['stock', 'compras']));
$$;
-- Ve los costos: la cuenta principal, Importes y Compras
create or replace function public.ve_costos(c uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select c = auth.uid() or c in (select public.cuentas_con(array['importes', 'compras']));
$$;

create or replace function public._es_del_equipo(p_cuenta uuid, p_usuario uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.miembros m join public.empresas e on e.id = m.empresa_id
                 where e.dueno_id = p_cuenta and m.usuario_id = p_usuario and m.estado = 'activo');
$$;

create or replace function public._nombre_de(p uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(pr.nombre_publico, ''), nullif(pe.nombre, ''), pe.email)
  from public.perfiles pe left join public.profesionales pr on pr.id = pe.id where pe.id = p;
$$;

-- El plan que cuenta es el de la cuenta dueña de los datos
create or replace function public.exigir_business()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' and coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and public.plan_de(public.uuid_o_null(to_jsonb(new) ->> 'profesional_id')) <> 'business' then
    raise exception using errcode = 'TL001', message = tg_argv[0], hint = 'Pasate a Business desde Perfil > Mi plan.';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- 4. Reglas de las tablas
-- ---------------------------------------------------------------------
-- Material: limpia los datos y valida las presentaciones; la unidad no cambia si ya tiene movimientos
create or replace function public.preparar_material()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p jsonb; nom text; fac numeric;
  lista jsonb := '[]'::jsonb; vistos text[] := '{}';
begin
  new.nombre := left(trim(new.nombre), 200);
  new.codigo := nullif(left(trim(coalesce(new.codigo, '')), 60), '');
  new.marca := nullif(left(trim(coalesce(new.marca, '')), 80), '');
  new.categoria := nullif(left(trim(coalesce(new.categoria, '')), 80), '');
  new.notas := nullif(left(trim(coalesce(new.notas, '')), 500), '');
  new.unidad := coalesce(nullif(left(trim(new.unidad), 12), ''), 'u');
  for p in select * from jsonb_array_elements(coalesce(new.presentaciones, '[]'::jsonb)) loop
    nom := left(trim(coalesce(p ->> 'nombre', '')), 30);
    fac := public.numero_o_null(p ->> 'factor');
    if nom = '' and fac is null then continue; end if;
    if nom = '' then raise exception 'Poné el nombre de la presentación (ej. Caja x 100)'; end if;
    if fac is null or fac <= 0 or fac > 1000000 then
      raise exception 'La presentación "%" tiene que decir cuántos % trae', nom, new.unidad;
    end if;
    if round(fac, new.decimales) <> fac then
      raise exception 'La presentación "%" no puede traer % % si el material va sin decimales', nom, public.cantidad_texto(fac), new.unidad;
    end if;
    if lower(nom) = any(vistos) then raise exception 'Hay dos presentaciones llamadas "%"', nom; end if;
    vistos := vistos || lower(nom);
    lista := lista || jsonb_build_array(jsonb_build_object('nombre', nom, 'factor', fac));
  end loop;
  new.presentaciones := lista;
  if new.codigo is not null and exists (select 1 from public.materiales x where x.profesional_id = new.profesional_id
                                        and lower(x.codigo) = lower(new.codigo) and x.id <> new.id) then
    raise exception 'Ya hay un material con el código %', new.codigo;
  end if;

  if tg_op = 'UPDATE' then
    new.creado_en := old.creado_en;
    if (new.unidad is distinct from old.unidad or new.decimales < old.decimales)
       and exists (select 1 from public.kardex k where k.material_id = new.id) then
      raise exception 'Este material ya tiene movimientos: no se le puede cambiar la unidad ni quitarle decimales. Creá otro material.';
    end if;
    if old.activo and not new.activo and (
         exists (select 1 from public.stock s where s.material_id = new.id and s.cantidad > 0
                 and exists (select 1 from public.ubicaciones_stock u where u.id = s.ubicacion_id and u.tipo <> 'trabajo'))
         or exists (select 1 from public.movimientos_stock_items i join public.movimientos_stock m on m.id = i.movimiento_id
                    where i.material_id = new.id and m.estado = 'pendiente')) then
      raise exception 'Para archivar el material primero tiene que quedar sin stock (y sin entregas pendientes).';
    end if;
  end if;
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists talisto_preparar_material on public.materiales;
create trigger talisto_preparar_material before insert or update on public.materiales
  for each row execute function public.preparar_material();
drop trigger if exists talisto_plan_materiales on public.materiales;
create trigger talisto_plan_materiales before insert or update on public.materiales
  for each row execute function public.exigir_business('El stock es parte del plan Business.');
drop trigger if exists talisto_dueno_inmutable on public.materiales;
create trigger talisto_dueno_inmutable before update on public.materiales
  for each row execute function public.dueno_inmutable('profesional_id');

-- Un material con historia no se borra: se archiva
create or replace function public.borrar_material()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and (exists (select 1 from public.kardex k where k.material_id = old.id)
          or exists (select 1 from public.movimientos_stock_items i where i.material_id = old.id)) then
    raise exception 'Este material tiene movimientos: no se puede borrar, archivalo.';
  end if;
  return old;
end $$;
drop trigger if exists talisto_borrar_material on public.materiales;
create trigger talisto_borrar_material before delete on public.materiales
  for each row execute function public.borrar_material();

-- Costo y vínculos: del mismo material de la cuenta
create or replace function public.preparar_costo_material()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.materiales m where m.id = new.material_id and m.profesional_id = new.profesional_id) then
    raise exception 'Ese material no es de esta cuenta';
  end if;
  new.actualizado_en := now();
  return new;
end $$;
drop trigger if exists talisto_preparar_costo on public.materiales_costos;
create trigger talisto_preparar_costo before insert or update on public.materiales_costos
  for each row execute function public.preparar_costo_material();
drop trigger if exists talisto_plan_costos on public.materiales_costos;
create trigger talisto_plan_costos before insert or update on public.materiales_costos
  for each row execute function public.exigir_business('El stock es parte del plan Business.');
drop trigger if exists talisto_dueno_inmutable on public.materiales_costos;
create trigger talisto_dueno_inmutable before update on public.materiales_costos
  for each row execute function public.dueno_inmutable('profesional_id');

create or replace function public.preparar_vinculo_material()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.materiales m where m.id = new.material_id and m.profesional_id = new.profesional_id) then
    raise exception 'Ese material no es de esta cuenta';
  end if;
  if not exists (select 1 from public.productos_proveedor p join public.proveedores v on v.id = p.proveedor_id
                 where p.id = new.producto_id and (v.profesional_id is null or v.profesional_id = new.profesional_id)) then
    raise exception 'Ese producto no es de un proveedor de esta cuenta';
  end if;
  return new;
end $$;
drop trigger if exists talisto_preparar_vinculo on public.materiales_vinculos;
create trigger talisto_preparar_vinculo before insert or update on public.materiales_vinculos
  for each row execute function public.preparar_vinculo_material();
drop trigger if exists talisto_plan_vinculos on public.materiales_vinculos;
create trigger talisto_plan_vinculos before insert or update on public.materiales_vinculos
  for each row execute function public.exigir_business('El stock es parte del plan Business.');
drop trigger if exists talisto_dueno_inmutable on public.materiales_vinculos;
create trigger talisto_dueno_inmutable before update on public.materiales_vinculos
  for each row execute function public.dueno_inmutable('profesional_id');

-- El saldo solo lo mueven los comprobantes
create or replace function public.proteger_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('talisto.stock', true), '') <> 'si' then
    if tg_op = 'DELETE' and (old.cantidad = 0 or public._cuenta_borrandose(old.profesional_id)) then return old; end if;
    raise exception 'El stock solo se mueve con comprobantes';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists talisto_proteger_stock on public.stock;
create trigger talisto_proteger_stock before insert or update or delete on public.stock
  for each row execute function public.proteger_stock();

-- Comprobantes: de lo ya hecho solo cambian el estado, la respuesta y la anulación
-- Solo se borra todo junto cuando se borra la cuenta entera
create or replace function public._cuenta_borrandose(p uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.profesionales where id = p);
$$;

create or replace function public.proteger_movimiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare fijos text[] := array['estado', 'respondido_por', 'respondido_por_nombre', 'respondido_en', 'respuesta', 'anulado_por', 'huella'];
begin
  if tg_op = 'DELETE' then
    if not public._cuenta_borrandose(old.profesional_id) then
      raise exception 'Los comprobantes de stock no se borran: se anulan con otro comprobante.';
    end if;
    return old;
  end if;
  if coalesce(current_setting('talisto.stock', true), '') <> 'si'
     or (to_jsonb(new) - fijos) is distinct from (to_jsonb(old) - fijos)
     or (old.huella is not null and new.huella is distinct from old.huella)
     or (old.anulado_por is not null and new.anulado_por is distinct from old.anulado_por)
     or (old.estado <> 'pendiente' and new.estado is distinct from old.estado) then
    raise exception 'Los comprobantes de stock no se modifican: se anulan con otro comprobante.';
  end if;
  return new;
end $$;
drop trigger if exists talisto_proteger_movimiento on public.movimientos_stock;
create trigger talisto_proteger_movimiento before update or delete on public.movimientos_stock
  for each row execute function public.proteger_movimiento();

create or replace function public.proteger_movimiento_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if not public._cuenta_borrandose(old.profesional_id) then
      raise exception 'Los comprobantes de stock no se borran: se anulan con otro comprobante.';
    end if;
    return old;
  end if;
  if coalesce(current_setting('talisto.stock', true), '') <> 'si'
     or (to_jsonb(new) - 'recibido') is distinct from (to_jsonb(old) - 'recibido')
     or old.recibido is not null then
    raise exception 'Los comprobantes de stock no se modifican: se anulan con otro comprobante.';
  end if;
  return new;
end $$;
drop trigger if exists talisto_proteger_movimiento_item on public.movimientos_stock_items;
create trigger talisto_proteger_movimiento_item before update or delete on public.movimientos_stock_items
  for each row execute function public.proteger_movimiento_item();

-- Huella de un asiento: encadena con la anterior de la misma cuenta
create or replace function public.huella_asiento(prev text, k public.kardex)
returns text language sql stable as $$
  select encode(sha256(convert_to(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
           coalesce(prev, 'inicio'), k.id, k.profesional_id, k.movimiento_id, k.material_id, k.ubicacion_id,
           k.cantidad, k.saldo, k.evento, to_char(k.creado_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), k.creado_por),
         'UTF8')), 'hex');
$$;

-- Huella del comprobante (con sus renglones, como se hizo)
create or replace function public.huella_movimiento(p_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to(format('%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s',
           m.id, m.profesional_id, m.numero, m.tipo, m.origen_id, m.destino_id, m.proveedor_id, m.proveedor_nombre,
           m.orden_compra_id, m.anula_a, m.motivo, m.referencia, m.nota, m.creado_por, m.creado_por_nombre,
           to_char(m.creado_en at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
           (select string_agg(format('%s;%s;%s;%s;%s;%s;%s;%s', i.n, i.material_id, i.cantidad, i.presentacion, i.factor,
                                     i.cantidad_presentacion, i.anterior, i.orden_item), '/' order by i.n)
              from public.movimientos_stock_items i where i.movimiento_id = m.id)),
         'UTF8')), 'hex')
  from public.movimientos_stock m where m.id = p_id;
$$;

-- Asientos: solo los escriben los comprobantes, se sellan al entrar y nunca cambian
create or replace function public.sellar_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
declare prev text;
begin
  if coalesce(current_setting('talisto.stock', true), '') <> 'si' then
    raise exception 'El stock solo se mueve con comprobantes';
  end if;
  perform pg_advisory_xact_lock(hashtext('stock' || new.profesional_id::text));
  new.creado_en := clock_timestamp();
  select ultima_huella into prev from public.stock_sello where profesional_id = new.profesional_id for update;
  new.huella := public.huella_asiento(prev, new);
  insert into public.stock_sello (profesional_id, asientos, ultimo_id, ultima_huella)
  values (new.profesional_id, 1, new.id, new.huella)
  on conflict (profesional_id) do update
    set asientos = public.stock_sello.asientos + 1, ultimo_id = excluded.ultimo_id,
        ultima_huella = excluded.ultima_huella, actualizado_en = now();
  return new;
end $$;
drop trigger if exists talisto_sellar_asiento on public.kardex;
create trigger talisto_sellar_asiento before insert on public.kardex
  for each row execute function public.sellar_asiento();

create or replace function public.proteger_asiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'Los asientos del stock no se modifican';
  end if;
  if not public._cuenta_borrandose(old.profesional_id) then
    raise exception 'Los asientos del stock no se borran';
  end if;
  return old;
end $$;
drop trigger if exists talisto_proteger_asiento on public.kardex;
create trigger talisto_proteger_asiento before update or delete on public.kardex
  for each row execute function public.proteger_asiento();

-- Un trabajo con materiales no se borra hasta devolverlos
create or replace function public.trabajo_con_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and exists (select 1 from public.ubicaciones_stock u join public.stock s on s.ubicacion_id = u.id
                 where s.cantidad > 0
                   and ((tg_table_name = 'ordenes' and u.orden_id = old.id) or (tg_table_name = 'turnos' and u.turno_id = old.id))) then
    raise exception 'Este trabajo tiene materiales del stock. Devolvelos antes de borrarlo (o cancelalo).';
  end if;
  return old;
end $$;
drop trigger if exists talisto_trabajo_con_stock on public.ordenes;
create trigger talisto_trabajo_con_stock before delete on public.ordenes
  for each row execute function public.trabajo_con_stock();
drop trigger if exists talisto_trabajo_con_stock on public.turnos;
create trigger talisto_trabajo_con_stock before delete on public.turnos
  for each row execute function public.trabajo_con_stock();

-- ---------------------------------------------------------------------
-- 5. Órdenes de compra: recepción parcial y orden cerrada al recibir
-- ---------------------------------------------------------------------
alter table public.ordenes_compra drop constraint if exists ordenes_compra_estado_check;
alter table public.ordenes_compra add constraint ordenes_compra_estado_check
  check (estado in ('borrador', 'enviada', 'confirmada', 'parcial', 'recibida', 'cancelada'));

create or replace function public.orden_compra_con_stock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
     or coalesce(current_setting('talisto.stock', true), '') = 'si' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.movimientos_stock m where m.orden_compra_id = old.id) then
      raise exception 'Esta orden tiene materiales recibidos en el stock: no se puede borrar.';
    end if;
    return old;
  end if;
  if not exists (select 1 from public.movimientos_stock m
                 where m.orden_compra_id = old.id and m.tipo = 'ingreso' and m.anulado_por is null) then
    if new.estado = 'parcial' and old.estado is distinct from 'parcial' then
      raise exception 'Una orden queda "parcial" al recibir una parte en el stock.';
    end if;
    return new;
  end if;
  if new.items is distinct from old.items or new.moneda is distinct from old.moneda
     or new.proveedor_id is distinct from old.proveedor_id then
    raise exception 'Esta orden ya tiene materiales recibidos: no se pueden cambiar sus productos.';
  end if;
  if new.estado is distinct from old.estado and not (old.estado = 'parcial' and new.estado = 'cancelada') then
    raise exception 'El estado de esta orden lo marca la recepción en el stock (para deshacerla, anulá el ingreso).';
  end if;
  return new;
end $$;
drop trigger if exists talisto_orden_compra_stock on public.ordenes_compra;
create trigger talisto_orden_compra_stock before update or delete on public.ordenes_compra
  for each row execute function public.orden_compra_con_stock();

-- ---------------------------------------------------------------------
-- 6. Motor interno (solo lo usan las funciones de abajo)
-- ---------------------------------------------------------------------
-- Abre una operación: plan Business y de a una por cuenta (orden y huella sin huecos)
create or replace function public._stock_abrir(p_cuenta uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  if p_cuenta is null or public.plan_de(p_cuenta) <> 'business' then
    raise exception using errcode = 'TL001', message = 'El stock es parte del plan Business.',
      hint = 'Pasate a Business desde Perfil > Mi plan.';
  end if;
  perform pg_advisory_xact_lock(hashtext('stock' || p_cuenta::text));
  perform set_config('talisto.stock', 'si', true);
end $$;

-- Depósito principal (se crea la primera vez)
create or replace function public._stock_principal(p_cuenta uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from public.ubicaciones_stock where profesional_id = p_cuenta and principal;
  if v is null then
    insert into public.ubicaciones_stock (profesional_id, tipo, nombre, principal)
    values (p_cuenta, 'deposito', 'Depósito', true) returning id into v;
  end if;
  return v;
end $$;

-- Lugar de una persona del equipo (se crea la primera vez; el nombre se mantiene al día)
create or replace function public._stock_de_operario(p_cuenta uuid, p_usuario uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_nombre text := coalesce(public._nombre_de(p_usuario), 'Persona del equipo');
begin
  select id into v from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = p_usuario;
  if v is null then
    insert into public.ubicaciones_stock (profesional_id, tipo, nombre, usuario_id)
    values (p_cuenta, 'operario', left(v_nombre, 160), p_usuario) returning id into v;
  else
    update public.ubicaciones_stock set nombre = left(v_nombre, 160), activo = public._es_del_equipo(p_cuenta, p_usuario)
     where id = v and (nombre is distinct from left(v_nombre, 160) or activo is distinct from public._es_del_equipo(p_cuenta, p_usuario));
  end if;
  return v;
end $$;

-- Lugar de un trabajo (ticket B2B o trabajo de la agenda)
create or replace function public._stock_de_trabajo(p_cuenta uuid, p_tipo text, p_id uuid, p_crear boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; v_nombre text;
begin
  if p_tipo = 'ticket' then
    select concat_ws(' · ', c.nombre,
                     case when nullif(o.numero_ticket, '') is not null then 'Tk ' || o.numero_ticket
                          when nullif(o.numero_cliente, '') is not null then 'Cliente ' || o.numero_cliente end,
                     nullif(trim(o.cliente_final), ''))
      into v_nombre
      from public.ordenes o join public.clientes c on c.id = o.empresa_id
     where o.id = p_id and o.profesional_id = p_cuenta;
    if v_nombre is null then raise exception 'Ese ticket no es de esta cuenta'; end if;
    select id into v from public.ubicaciones_stock where orden_id = p_id;
  elsif p_tipo = 'turno' then
    select concat_ws(' · ', initcap(t.tipo), coalesce(nullif(c.nombre, ''), nullif(t.titulo, ''), 'Trabajo'),
                     to_char(t.inicio at time zone 'America/Montevideo', 'DD/MM'))
      into v_nombre
      from public.turnos t left join public.clientes c on c.id = t.cliente_id
     where t.id = p_id and t.profesional_id = p_cuenta;
    if v_nombre is null then raise exception 'Ese trabajo no es de esta cuenta'; end if;
    select id into v from public.ubicaciones_stock where turno_id = p_id;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  v_nombre := left(v_nombre, 160);
  if v is null and p_crear then
    insert into public.ubicaciones_stock (profesional_id, tipo, nombre, orden_id, turno_id)
    values (p_cuenta, 'trabajo', v_nombre, case when p_tipo = 'ticket' then p_id end, case when p_tipo = 'turno' then p_id end)
    returning id into v;
  elsif v is not null then
    update public.ubicaciones_stock set nombre = v_nombre where id = v and nombre is distinct from v_nombre;
  end if;
  return v;
end $$;

-- ¿Puede esta persona poner o sacar materiales de ese trabajo?
-- Quien maneja el stock: siempre (salvo poner en uno cancelado).
-- La persona asignada: mientras está abierto o hasta 2 días después de cerrarlo.
create or replace function public._stock_trabajo_permitido(p_cuenta uuid, p_tipo text, p_id uuid, p_gestor boolean, p_para_devolver boolean)
returns void language plpgsql security definer set search_path = public as $$
declare asig uuid; est text; cerr timestamptz;
begin
  if p_tipo = 'ticket' then
    select asignado_a, estado, coalesce(cerrado_en, finalizado_en) into asig, est, cerr
      from public.ordenes where id = p_id and profesional_id = p_cuenta;
  elsif p_tipo = 'turno' then
    select asignado_a, estado, cerrado_en into asig, est, cerr from public.turnos where id = p_id and profesional_id = p_cuenta;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if est is null then raise exception 'Ese trabajo no es de esta cuenta'; end if;
  if est = 'cancelado' and not p_para_devolver then raise exception 'Ese trabajo está cancelado'; end if;
  if p_gestor then return; end if;
  if asig is distinct from auth.uid() then raise exception 'Ese trabajo no está asignado a vos'; end if;
  if est in ('finalizado', 'realizado') and coalesce(cerr, '-infinity'::timestamptz) < now() - interval '48 hours' then
    raise exception 'Ese trabajo se cerró hace más de 2 días: pedile a quien maneja el stock que lo corrija.';
  end if;
end $$;

-- Renglones → unidades mínimas, validados
-- [{material_id, cantidad}] · [{material_id, presentacion, cantidad_presentacion}]
-- p_libre: la presentación viene con su factor (recepción de una orden de compra)
create or replace function public._stock_renglones(p_cuenta uuid, p_items jsonb, p_conteo boolean default false, p_libre boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb; m public.materiales; pres jsonb; nom text; fac numeric; cp numeric; base numeric;
  salida jsonb := '[]'::jsonb; k int := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Agregá al menos un material';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Demasiados renglones (máximo 200)'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    select * into m from public.materiales where id = public.uuid_o_null(it ->> 'material_id') and profesional_id = p_cuenta;
    if not found then raise exception 'Hay un material que no es de esta cuenta'; end if;
    nom := nullif(left(trim(coalesce(it ->> 'presentacion', '')), 40), '');
    fac := null; cp := null;
    if nom is not null and p_libre then
      fac := public.numero_o_null(it ->> 'factor');
      cp := public.numero_o_null(it ->> 'cantidad_presentacion');
      if fac is null or fac <= 0 then raise exception 'Falta cuántos % trae cada % de %', m.unidad, nom, m.nombre; end if;
      if cp is null then raise exception 'Falta la cantidad de %', m.nombre; end if;
      base := cp * fac;
    elsif nom is not null then
      select x into pres from jsonb_array_elements(m.presentaciones) x where lower(x ->> 'nombre') = lower(nom) limit 1;
      if pres is null then raise exception '% no tiene la presentación "%"', m.nombre, nom; end if;
      nom := pres ->> 'nombre';
      fac := (pres ->> 'factor')::numeric;
      cp := public.numero_o_null(it ->> 'cantidad_presentacion');
      if cp is null then raise exception 'Falta la cantidad de %', m.nombre; end if;
      base := cp * fac;
    else
      base := public.numero_o_null(it ->> 'cantidad');
      if base is null then raise exception 'Falta la cantidad de %', m.nombre; end if;
    end if;
    if p_conteo then
      if base < 0 then raise exception 'El conteo de % no puede ser negativo', m.nombre; end if;
    elsif base <= 0 then
      raise exception 'La cantidad de % tiene que ser mayor que 0', m.nombre;
    end if;
    if base > 999999999 then raise exception 'Cantidad demasiado grande en %', m.nombre; end if;
    if round(base, m.decimales) <> base then
      raise exception using errcode = 'TL003', message = case
        when m.decimales = 0 then format('%s va por %s: %s no se puede.', m.nombre,
                                         case when m.unidad = 'u' then 'unidades enteras' else m.unidad || ' enteros' end, public.cantidad_texto(base))
        else format('%s admite hasta %s %s.', m.nombre, m.decimales, case when m.decimales = 1 then 'decimal' else 'decimales' end) end;
    end if;
    k := k + 1;
    salida := salida || jsonb_build_array(jsonb_build_object(
      'n', k, 'material_id', m.id, 'cantidad', base, 'presentacion', nom, 'factor', fac, 'cantidad_presentacion', cp,
      'costo', public.numero_o_null(it ->> 'costo'), 'orden_item', public.numero_o_null(it ->> 'orden_item')));
  end loop;
  return salida;
end $$;

-- Crea el comprobante con sus renglones y su huella
create or replace function public._stock_comprobante(p_cuenta uuid, p_tipo text, p_estado text, p_origen uuid, p_destino uuid,
                                                     p_renglones jsonb, p_datos jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_num int; r jsonb;
begin
  select coalesce(max(numero), 0) + 1 into v_num from public.movimientos_stock where profesional_id = p_cuenta;
  insert into public.movimientos_stock (id, profesional_id, numero, tipo, estado, origen_id, destino_id, proveedor_id, proveedor_nombre,
                                        orden_compra_id, anula_a, motivo, referencia, nota, creado_por, creado_por_nombre)
  values (v_id, p_cuenta, v_num, p_tipo, p_estado, p_origen, p_destino,
          public.uuid_o_null(p_datos ->> 'proveedor_id'), nullif(left(trim(coalesce(p_datos ->> 'proveedor_nombre', '')), 120), ''),
          public.uuid_o_null(p_datos ->> 'orden_compra_id'), public.uuid_o_null(p_datos ->> 'anula_a'),
          nullif(left(trim(coalesce(p_datos ->> 'motivo', '')), 40), ''),
          nullif(left(trim(coalesce(p_datos ->> 'referencia', '')), 80), ''),
          nullif(left(trim(coalesce(p_datos ->> 'nota', '')), 500), ''),
          auth.uid(), public._nombre_de(auth.uid()));
  for r in select * from jsonb_array_elements(p_renglones) loop
    insert into public.movimientos_stock_items (movimiento_id, profesional_id, n, material_id, cantidad, presentacion, factor,
                                                cantidad_presentacion, anterior, orden_item)
    values (v_id, p_cuenta, (r ->> 'n')::int, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, nullif(r ->> 'presentacion', ''),
            public.numero_o_null(r ->> 'factor'), public.numero_o_null(r ->> 'cantidad_presentacion'),
            public.numero_o_null(r ->> 'anterior'), public.numero_o_null(r ->> 'orden_item')::int);
  end loop;
  update public.movimientos_stock set huella = public.huella_movimiento(v_id) where id = v_id;
  return v_id;
end $$;

-- Suma o resta en un lugar, con su asiento. Nunca queda en negativo.
create or replace function public._stock_sumar(p_cuenta uuid, p_mov uuid, p_ubic uuid, p_material uuid, p_cantidad numeric, p_evento text)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric; nuevo numeric; m public.materiales;
begin
  if p_cantidad is null or p_cantidad = 0 then return; end if;
  insert into public.stock (ubicacion_id, material_id, profesional_id, cantidad) values (p_ubic, p_material, p_cuenta, 0)
  on conflict (ubicacion_id, material_id) do nothing;
  select cantidad into v from public.stock where ubicacion_id = p_ubic and material_id = p_material for update;
  nuevo := v + p_cantidad;
  if nuevo < 0 then
    select * into m from public.materiales where id = p_material;
    raise exception using errcode = 'TL003', message = format('No alcanza %s en %s: hay %s %s y se quieren sacar %s.',
      m.nombre, (select nombre from public.ubicaciones_stock where id = p_ubic), public.cantidad_texto(v), m.unidad,
      public.cantidad_texto(-p_cantidad));
  end if;
  update public.stock set cantidad = nuevo, actualizado_en = now() where ubicacion_id = p_ubic and material_id = p_material;
  insert into public.kardex (profesional_id, movimiento_id, material_id, ubicacion_id, cantidad, saldo, evento, creado_por)
  values (p_cuenta, p_mov, p_material, p_ubic, p_cantidad, nuevo, p_evento, auth.uid());
end $$;

-- Comprobante en JSON (para las pantallas)
create or replace function public._mov_json(p_id uuid, p_costos boolean default false)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', m.id, 'numero', m.numero, 'tipo', m.tipo, 'estado', m.estado, 'creado_en', m.creado_en,
    'origen_id', m.origen_id, 'origen', o.nombre, 'origen_tipo', o.tipo, 'origen_usuario', o.usuario_id,
    'destino_id', m.destino_id, 'destino', d.nombre, 'destino_tipo', d.tipo, 'destino_usuario', d.usuario_id,
    'proveedor_id', m.proveedor_id, 'proveedor', m.proveedor_nombre, 'orden_compra_id', m.orden_compra_id,
    'orden_numero', (select oc.numero from public.ordenes_compra oc where oc.id = m.orden_compra_id),
    'motivo', m.motivo, 'referencia', m.referencia, 'nota', m.nota,
    'creado_por', m.creado_por, 'por', m.creado_por_nombre,
    'respondido_por', m.respondido_por_nombre, 'respondido_en', m.respondido_en, 'respuesta', m.respuesta,
    'anula_a', m.anula_a, 'anula_numero', (select a.numero from public.movimientos_stock a where a.id = m.anula_a),
    'anulado_por', m.anulado_por, 'anulado_numero', (select a.numero from public.movimientos_stock a where a.id = m.anulado_por),
    'huella', m.huella,
    'items', (select coalesce(json_agg(json_build_object(
                 'n', i.n, 'material_id', i.material_id, 'nombre', mt.nombre, 'codigo', mt.codigo, 'marca', mt.marca,
                 'unidad', mt.unidad, 'decimales', mt.decimales, 'presentaciones', mt.presentaciones,
                 'cantidad', i.cantidad, 'presentacion', i.presentacion, 'factor', i.factor,
                 'cantidad_presentacion', i.cantidad_presentacion, 'recibido', i.recibido, 'anterior', i.anterior,
                 'costo', case when p_costos then (select c.costo from public.materiales_costos c where c.material_id = i.material_id) end
               ) order by i.n), '[]'::json)
              from public.movimientos_stock_items i join public.materiales mt on mt.id = i.material_id
              where i.movimiento_id = m.id)
  )
  from public.movimientos_stock m
  left join public.ubicaciones_stock o on o.id = m.origen_id
  left join public.ubicaciones_stock d on d.id = m.destino_id
  where m.id = p_id;
$$;

-- Recalcula el estado de una orden de compra según lo recibido
create or replace function public._orden_recalcular(p_orden uuid)
returns text language plpgsql security definer set search_path = public as $$
declare o public.ordenes_compra; alguno boolean; todo boolean; nuevo text;
begin
  select * into o from public.ordenes_compra where id = p_orden for update;
  if not found then return null; end if;
  with rec as (
    select i.orden_item, sum(coalesce(i.cantidad_presentacion, i.cantidad)) as recibido
      from public.movimientos_stock_items i join public.movimientos_stock m on m.id = i.movimiento_id
     where m.orden_compra_id = p_orden and m.tipo = 'ingreso' and m.anulado_por is null and i.orden_item is not null
     group by i.orden_item)
  select coalesce(bool_or(r.recibido > 0), false),
         coalesce(bool_and(coalesce(r.recibido, 0) >= coalesce(public.numero_o_null(x.it ->> 'cantidad'), 0)), false)
    into alguno, todo
    from jsonb_array_elements(o.items) with ordinality as x(it, k)
    left join rec r on r.orden_item = x.k - 1
   where nullif(trim(coalesce(x.it ->> 'item', '')), '') is not null;
  nuevo := case when not alguno then case when o.estado in ('parcial', 'recibida') then 'confirmada' else o.estado end
                when todo then 'recibida'
                else case when o.estado = 'cancelada' then 'cancelada' else 'parcial' end end;
  if nuevo is distinct from o.estado then
    update public.ordenes_compra set estado = nuevo where id = p_orden;
  end if;
  return nuevo;
end $$;

-- ---------------------------------------------------------------------
-- 7. Lugares
-- ---------------------------------------------------------------------
-- Depósitos y personas del equipo (crea el depósito principal y el lugar de cada uno)
create or replace function public.stock_lugares(p_cuenta uuid)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ve boolean; mio uuid; r record;
begin
  perform public._stock_abrir(p_cuenta);
  ve := public.ve_stock(p_cuenta);
  if not ve and not public._es_del_equipo(p_cuenta, uid) then
    raise exception 'No tenés acceso al stock de esta empresa';
  end if;
  perform public._stock_principal(p_cuenta);
  for r in select m.usuario_id from public.miembros m join public.empresas e on e.id = m.empresa_id
            where e.dueno_id = p_cuenta and m.estado = 'activo' loop
    perform public._stock_de_operario(p_cuenta, r.usuario_id);
  end loop;
  update public.ubicaciones_stock u set activo = public._es_del_equipo(p_cuenta, u.usuario_id)
   where u.profesional_id = p_cuenta and u.tipo = 'operario' and u.usuario_id is not null
     and u.activo is distinct from public._es_del_equipo(p_cuenta, u.usuario_id);
  select id into mio from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = uid;
  return json_build_object(
    'gestiona', public.gestiona_stock(p_cuenta),
    've', ve,
    'mio', mio,
    'depositos', (select coalesce(json_agg(json_build_object('id', u.id, 'nombre', u.nombre, 'principal', u.principal, 'activo', u.activo)
                                           order by u.principal desc, u.nombre), '[]'::json)
                    from public.ubicaciones_stock u where u.profesional_id = p_cuenta and u.tipo = 'deposito' and (ve or u.activo)),
    'equipo', (select coalesce(json_agg(json_build_object('id', u.id, 'usuario_id', u.usuario_id, 'nombre', u.nombre,
                                                          'activo', u.activo, 'yo', u.usuario_id = uid) order by u.nombre), '[]'::json)
                 from public.ubicaciones_stock u where u.profesional_id = p_cuenta and u.tipo = 'operario' and (ve or u.activo))
  );
end $$;

-- Crear, renombrar o archivar un depósito
create or replace function public.stock_deposito(p_cuenta uuid, p_id uuid, p_nombre text, p_activo boolean default true)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.ubicaciones_stock; nom text := left(trim(coalesce(p_nombre, '')), 60);
begin
  perform public._stock_abrir(p_cuenta);
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para manejar el stock'; end if;
  if nom = '' then raise exception 'Poné el nombre del depósito'; end if;
  if p_id is null then
    insert into public.ubicaciones_stock (profesional_id, tipo, nombre, principal)
    values (p_cuenta, 'deposito', nom, not exists (select 1 from public.ubicaciones_stock where profesional_id = p_cuenta and principal))
    returning * into v;
    return v.id;
  end if;
  select * into v from public.ubicaciones_stock where id = p_id and profesional_id = p_cuenta and tipo = 'deposito';
  if not found then raise exception 'No encontramos ese depósito'; end if;
  if v.activo and not coalesce(p_activo, true) then
    if v.principal then raise exception 'El depósito principal no se puede archivar'; end if;
    if exists (select 1 from public.stock s where s.ubicacion_id = v.id and s.cantidad > 0)
       or exists (select 1 from public.movimientos_stock m where m.estado = 'pendiente' and m.destino_id = v.id) then
      raise exception 'Primero pasá el stock de % a otro lugar', v.nombre;
    end if;
  end if;
  update public.ubicaciones_stock set nombre = nom, activo = coalesce(p_activo, true) where id = v.id;
  return v.id;
end $$;

-- ---------------------------------------------------------------------
-- 8. Movimientos
-- ---------------------------------------------------------------------
-- Ingreso (compra sin orden, stock inicial, otro). costo: por unidad mínima, en pesos
create or replace function public.stock_ingresar(p_cuenta uuid, p_destino uuid, p_items jsonb, p_motivo text default 'compra',
                                                 p_proveedor uuid default null, p_referencia text default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare rs jsonb; r jsonb; mov uuid; prov text; costos boolean;
begin
  perform public._stock_abrir(p_cuenta);
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para ingresar stock'; end if;
  if not exists (select 1 from public.ubicaciones_stock where id = p_destino and profesional_id = p_cuenta
                 and tipo in ('deposito', 'operario') and activo) then
    raise exception 'Elegí a qué lugar entra';
  end if;
  p_motivo := coalesce(nullif(p_motivo, ''), 'compra');
  if p_motivo not in ('compra', 'inicial', 'otro') then raise exception 'Motivo no válido'; end if;
  if p_motivo = 'otro' and coalesce(trim(p_nota), '') = '' then raise exception 'Contá de dónde viene el material'; end if;
  if p_proveedor is not null then
    select nombre into prov from public.proveedores where id = p_proveedor and (profesional_id is null or profesional_id = p_cuenta);
    if prov is null then raise exception 'Ese proveedor no es de esta cuenta'; end if;
  end if;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'ingreso', 'hecho', null, p_destino, rs,
           jsonb_build_object('motivo', p_motivo, 'proveedor_id', p_proveedor, 'proveedor_nombre', prov,
                              'referencia', p_referencia, 'nota', p_nota));
  costos := public.ve_costos(p_cuenta);
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, p_destino, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
    if costos and public.numero_o_null(r ->> 'costo') is not null and (r ->> 'costo')::numeric >= 0 then
      insert into public.materiales_costos (material_id, profesional_id, costo, moneda)
      values ((r ->> 'material_id')::uuid, p_cuenta, (r ->> 'costo')::numeric, 'UYU')
      on conflict (material_id) do update set costo = excluded.costo, moneda = excluded.moneda;
    end if;
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- Recepción de una orden de compra (toda o una parte).
-- p_lineas: [{ indice, cantidad (en la unidad de la orden), material_id | nuevo:{nombre,codigo,unidad,decimales},
--              factor (unidades mínimas por cada unidad de la orden), presentacion (nombre para guardarla) }]
create or replace function public.recibir_orden_compra(p_orden uuid, p_destino uuid, p_lineas jsonb,
                                                       p_referencia text default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  o public.ordenes_compra; l jsonb; it jsonb; idx int; cant numeric; fac numeric; mat uuid; m public.materiales;
  nom_pres text; items jsonb := '[]'::jsonb; rs jsonb; r jsonb; mov uuid; prod uuid; nuevo text; cod text;
begin
  select * into o from public.ordenes_compra where id = p_orden;
  if not found then raise exception 'No encontramos la orden de compra'; end if;
  perform public._stock_abrir(o.profesional_id);
  select * into o from public.ordenes_compra where id = p_orden for update;
  if not (public.gestiona_stock(o.profesional_id) or o.profesional_id in (select public.cuentas_con(array['compras']))) then
    raise exception 'No tenés permiso para recibir esta orden';
  end if;
  if o.estado not in ('borrador', 'enviada', 'confirmada', 'parcial') then
    raise exception 'Esta orden está %: no se puede recibir', o.estado;
  end if;
  if not exists (select 1 from public.ubicaciones_stock where id = p_destino and profesional_id = o.profesional_id
                 and tipo in ('deposito', 'operario') and activo) then
    raise exception 'Elegí a qué lugar entra';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' then raise exception 'No hay nada para recibir'; end if;

  for l in select * from jsonb_array_elements(p_lineas) loop
    idx := public.numero_o_null(l ->> 'indice')::int;
    it := case when idx is not null and idx >= 0 then o.items -> idx end;
    if it is null then raise exception 'Hay un renglón que no es de la orden'; end if;
    cant := public.numero_o_null(l ->> 'cantidad');
    if cant is null or cant = 0 then continue; end if;
    if cant < 0 then raise exception 'La cantidad recibida de % no puede ser negativa', it ->> 'item'; end if;
    fac := coalesce(public.numero_o_null(l ->> 'factor'), 1);
    if fac <= 0 or fac > 1000000 then raise exception 'Revisá cuántas unidades trae %', it ->> 'item'; end if;

    mat := public.uuid_o_null(l ->> 'material_id');
    if mat is null then
      -- material nuevo con los datos del renglón (si ya hay uno con ese código, se usa ese)
      cod := nullif(left(trim(coalesce(l -> 'nuevo' ->> 'codigo', it ->> 'codigo', '')), 60), '');
      if cod is not null then
        select id into mat from public.materiales where profesional_id = o.profesional_id and lower(codigo) = lower(cod);
      end if;
      if mat is null then
        insert into public.materiales (profesional_id, codigo, nombre, unidad, decimales)
        values (o.profesional_id, cod,
                left(coalesce(nullif(trim(l -> 'nuevo' ->> 'nombre'), ''), nullif(trim(it ->> 'item'), ''), 'Material'), 200),
                coalesce(nullif(trim(l -> 'nuevo' ->> 'unidad'), ''), 'u'),
                least(greatest(coalesce(public.numero_o_null(l -> 'nuevo' ->> 'decimales')::int, 0), 0), 3))
        returning id into mat;
      end if;
    end if;
    select * into m from public.materiales where id = mat and profesional_id = o.profesional_id;
    if not found then raise exception 'Hay un material que no es de esta cuenta'; end if;

    -- presentación del proveedor guardada en el material (ej. "Caja x 100")
    nom_pres := nullif(left(trim(coalesce(l ->> 'presentacion', '')), 30), '');
    if nom_pres is not null and fac <> 1
       and not exists (select 1 from jsonb_array_elements(m.presentaciones) x where lower(x ->> 'nombre') = lower(nom_pres))
       and jsonb_array_length(m.presentaciones) < 8 then
      update public.materiales set presentaciones = presentaciones || jsonb_build_array(jsonb_build_object('nombre', nom_pres, 'factor', fac))
       where id = mat;
    end if;

    -- la próxima vez ese producto del proveedor se reconoce solo
    prod := public.uuid_o_null(it ->> 'producto_id');
    if prod is not null and exists (select 1 from public.productos_proveedor p join public.proveedores v on v.id = p.proveedor_id
                                    where p.id = prod and (v.profesional_id is null or v.profesional_id = o.profesional_id)) then
      insert into public.materiales_vinculos (profesional_id, producto_id, material_id, factor)
      values (o.profesional_id, prod, mat, fac)
      on conflict (profesional_id, producto_id) do update set material_id = excluded.material_id, factor = excluded.factor;
    end if;

    -- último costo por unidad mínima
    if public.numero_o_null(it ->> 'precio') is not null then
      insert into public.materiales_costos (material_id, profesional_id, costo, moneda)
      values (mat, o.profesional_id, round((it ->> 'precio')::numeric / fac, 4), o.moneda)
      on conflict (material_id) do update set costo = excluded.costo, moneda = excluded.moneda;
    end if;

    items := items || jsonb_build_array(jsonb_build_object(
      'material_id', mat, 'presentacion', coalesce(nom_pres, nullif(trim(it ->> 'unidad'), ''), 'u'),
      'factor', fac, 'cantidad_presentacion', cant, 'orden_item', idx));
  end loop;

  if jsonb_array_length(items) = 0 then raise exception 'Poné cuánto llegó de al menos un producto'; end if;
  rs := public._stock_renglones(o.profesional_id, items, false, true);
  mov := public._stock_comprobante(o.profesional_id, 'ingreso', 'hecho', null, p_destino, rs,
           jsonb_build_object('motivo', 'compra', 'proveedor_id', o.proveedor_id, 'proveedor_nombre', o.proveedor_nombre,
                              'orden_compra_id', o.id, 'referencia', p_referencia, 'nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(o.profesional_id, mov, p_destino, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
  end loop;
  nuevo := public._orden_recalcular(o.id);
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov), 'estado_orden', nuevo);
end $$;

-- Entrega o pase entre depósitos y personas del equipo.
-- Si va a otra persona (o al depósito desde alguien sin permiso de Stock) queda pendiente hasta que confirme.
create or replace function public.stock_transferir(p_cuenta uuid, p_origen uuid, p_destino uuid, p_items jsonb, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); gestor boolean; o public.ubicaciones_stock; d public.ubicaciones_stock;
  rs jsonb; r jsonb; mov uuid; est text; tip text;
begin
  perform public._stock_abrir(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  select * into o from public.ubicaciones_stock where id = p_origen and profesional_id = p_cuenta;
  select * into d from public.ubicaciones_stock where id = p_destino and profesional_id = p_cuenta;
  if o.id is null or d.id is null or o.tipo = 'trabajo' or d.tipo = 'trabajo' then
    raise exception 'Elegí de dónde sale y a dónde va';
  end if;
  if o.id = d.id then raise exception 'Sale y entra en el mismo lugar'; end if;
  if not d.activo then raise exception '% no está activo', d.nombre; end if;
  if not gestor then
    if not (o.tipo = 'operario' and o.usuario_id = uid and public._es_del_equipo(p_cuenta, uid)) then
      raise exception 'Solo podés pasar materiales de tu stock';
    end if;
  end if;
  tip := case when o.tipo = 'operario' and d.tipo = 'deposito' then 'devolucion' else 'transferencia' end;
  est := case when d.tipo = 'operario' and d.usuario_id is distinct from uid then 'pendiente'
              when d.tipo = 'deposito' and not gestor then 'pendiente'
              else 'hecho' end;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, tip, est, p_origen, p_destino, rs, jsonb_build_object('nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, p_origen, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
    if est = 'hecho' then
      perform public._stock_sumar(p_cuenta, mov, p_destino, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
    end if;
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov), 'estado', est);
end $$;

-- Quien recibe confirma (todo o lo que llegó) o rechaza. p_recibido: { "1": 8, "2": 0 } por renglón
create or replace function public.stock_responder(p_movimiento uuid, p_aceptar boolean, p_recibido jsonb default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); m public.movimientos_stock; d public.ubicaciones_stock; it record; mt public.materiales;
  rec numeric; dif boolean := false;
begin
  select * into m from public.movimientos_stock where id = p_movimiento;
  if not found then raise exception 'No encontramos ese movimiento'; end if;
  perform public._stock_abrir(m.profesional_id);
  select * into m from public.movimientos_stock where id = p_movimiento;
  if m.estado <> 'pendiente' then raise exception 'Ese movimiento ya no está pendiente'; end if;
  select * into d from public.ubicaciones_stock where id = m.destino_id;
  if d.tipo = 'operario' then
    if d.usuario_id is distinct from uid then raise exception 'Lo confirma %, que es quien lo recibe', d.nombre; end if;
  elsif not public.gestiona_stock(m.profesional_id) then
    raise exception 'Lo confirma quien maneja el depósito';
  end if;
  if not p_aceptar and coalesce(trim(p_nota), '') = '' then raise exception 'Contá por qué lo rechazás'; end if;

  for it in select * from public.movimientos_stock_items where movimiento_id = m.id order by n loop
    if p_aceptar then
      rec := coalesce(public.numero_o_null(p_recibido ->> it.n::text), it.cantidad);
      select * into mt from public.materiales where id = it.material_id;
      if rec < 0 or rec > it.cantidad then
        raise exception 'De % se puede recibir entre 0 y % %', mt.nombre, public.cantidad_texto(it.cantidad), mt.unidad;
      end if;
      if round(rec, mt.decimales) <> rec then
        raise exception '% admite hasta % %', mt.nombre, mt.decimales, case when mt.decimales = 1 then 'decimal' else 'decimales' end;
      end if;
      perform public._stock_sumar(m.profesional_id, m.id, m.destino_id, it.material_id, rec, 'confirmacion');
      if rec < it.cantidad then
        dif := true;
        perform public._stock_sumar(m.profesional_id, m.id, m.origen_id, it.material_id, it.cantidad - rec, 'rechazo');
      end if;
      update public.movimientos_stock_items set recibido = rec where movimiento_id = m.id and n = it.n;
    else
      perform public._stock_sumar(m.profesional_id, m.id, m.origen_id, it.material_id, it.cantidad, 'rechazo');
      update public.movimientos_stock_items set recibido = 0 where movimiento_id = m.id and n = it.n;
    end if;
  end loop;
  if dif and coalesce(trim(p_nota), '') = '' then raise exception 'Contá qué pasó con lo que no llegó'; end if;
  update public.movimientos_stock set estado = case when p_aceptar then 'hecho' else 'rechazado' end,
         respondido_por = uid, respondido_por_nombre = public._nombre_de(uid), respondido_en = now(),
         respuesta = nullif(left(trim(coalesce(p_nota, '')), 500), '')
   where id = m.id;
  return json_build_object('ok', true, 'diferencia', dif);
end $$;

-- Quien lo mandó (o quien maneja el stock) cancela una entrega pendiente: vuelve al origen
create or replace function public.stock_cancelar(p_movimiento uuid, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.movimientos_stock; o public.ubicaciones_stock; it record;
begin
  select * into m from public.movimientos_stock where id = p_movimiento;
  if not found then raise exception 'No encontramos ese movimiento'; end if;
  perform public._stock_abrir(m.profesional_id);
  select * into m from public.movimientos_stock where id = p_movimiento;
  if m.estado <> 'pendiente' then raise exception 'Ese movimiento ya no está pendiente'; end if;
  select * into o from public.ubicaciones_stock where id = m.origen_id;
  if not (m.creado_por = uid or (o.tipo = 'operario' and o.usuario_id = uid) or public.gestiona_stock(m.profesional_id)) then
    raise exception 'Solo quien lo mandó puede cancelarlo';
  end if;
  for it in select * from public.movimientos_stock_items where movimiento_id = m.id order by n loop
    perform public._stock_sumar(m.profesional_id, m.id, m.origen_id, it.material_id, it.cantidad, 'cancelacion');
  end loop;
  update public.movimientos_stock set estado = 'cancelado', respondido_por = uid, respondido_por_nombre = public._nombre_de(uid),
         respondido_en = now(), respuesta = nullif(left(trim(coalesce(p_nota, '')), 500), '')
   where id = m.id;
  return json_build_object('ok', true);
end $$;

-- Materiales a un trabajo (ticket B2B o trabajo de la agenda)
create or replace function public.stock_a_trabajo(p_cuenta uuid, p_origen uuid, p_tipo text, p_trabajo uuid, p_items jsonb, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); gestor boolean; o public.ubicaciones_stock; dest uuid; rs jsonb; r jsonb; mov uuid;
begin
  perform public._stock_abrir(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  select * into o from public.ubicaciones_stock where id = p_origen and profesional_id = p_cuenta and tipo in ('deposito', 'operario');
  if not found then raise exception 'Elegí de dónde salen los materiales'; end if;
  if not gestor and not (o.tipo = 'operario' and o.usuario_id = uid and public._es_del_equipo(p_cuenta, uid)) then
    raise exception 'Solo podés usar materiales de tu stock';
  end if;
  perform public._stock_trabajo_permitido(p_cuenta, p_tipo, p_trabajo, gestor, false);
  dest := public._stock_de_trabajo(p_cuenta, p_tipo, p_trabajo, true);
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'a_trabajo', 'hecho', p_origen, dest, rs, jsonb_build_object('nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, p_origen, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
    perform public._stock_sumar(p_cuenta, mov, dest, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- Devolución de lo que sobró en un trabajo
create or replace function public.stock_desde_trabajo(p_cuenta uuid, p_tipo text, p_trabajo uuid, p_destino uuid, p_items jsonb,
                                                      p_motivo text default 'sobrante', p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); gestor boolean; d public.ubicaciones_stock; orig uuid; rs jsonb; r jsonb; mov uuid;
begin
  perform public._stock_abrir(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  perform public._stock_trabajo_permitido(p_cuenta, p_tipo, p_trabajo, gestor, true);
  orig := public._stock_de_trabajo(p_cuenta, p_tipo, p_trabajo, false);
  if orig is null then raise exception 'Ese trabajo no tiene materiales del stock'; end if;
  select * into d from public.ubicaciones_stock where id = p_destino and profesional_id = p_cuenta and tipo in ('deposito', 'operario') and activo;
  if not found then raise exception 'Elegí a dónde vuelven'; end if;
  if not gestor and not (d.tipo = 'operario' and d.usuario_id = uid and public._es_del_equipo(p_cuenta, uid)) then
    raise exception 'Lo que sobra vuelve a tu stock (después lo devolvés al depósito)';
  end if;
  p_motivo := coalesce(nullif(p_motivo, ''), 'sobrante');
  if p_motivo not in ('sobrante', 'error', 'cancelado') then raise exception 'Motivo no válido'; end if;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'devolucion', 'hecho', orig, p_destino, rs, jsonb_build_object('motivo', p_motivo, 'nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, orig, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
    perform public._stock_sumar(p_cuenta, mov, p_destino, (r ->> 'material_id')::uuid, (r ->> 'cantidad')::numeric, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- Devolución al proveedor
create or replace function public.stock_devolver_proveedor(p_cuenta uuid, p_origen uuid, p_items jsonb, p_proveedor uuid default null,
                                                           p_orden_compra uuid default null, p_motivo text default null,
                                                           p_referencia text default null, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare prov text; rs jsonb; r jsonb; mov uuid;
begin
  perform public._stock_abrir(p_cuenta);
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para manejar el stock'; end if;
  if not exists (select 1 from public.ubicaciones_stock where id = p_origen and profesional_id = p_cuenta and tipo in ('deposito', 'operario')) then
    raise exception 'Elegí de dónde sale';
  end if;
  if p_proveedor is not null then
    select nombre into prov from public.proveedores where id = p_proveedor and (profesional_id is null or profesional_id = p_cuenta);
    if prov is null then raise exception 'Ese proveedor no es de esta cuenta'; end if;
  end if;
  if p_orden_compra is not null and not exists (select 1 from public.ordenes_compra where id = p_orden_compra and profesional_id = p_cuenta) then
    raise exception 'Esa orden de compra no es de esta cuenta';
  end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo de la devolución'; end if;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'devolucion_proveedor', 'hecho', p_origen, null, rs,
           jsonb_build_object('proveedor_id', p_proveedor, 'proveedor_nombre', prov, 'orden_compra_id', p_orden_compra,
                              'motivo', p_motivo, 'referencia', p_referencia, 'nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, p_origen, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- Baja: rotura, pérdida, vencido, robo, otro
create or replace function public.stock_baja(p_cuenta uuid, p_origen uuid, p_items jsonb, p_motivo text, p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare rs jsonb; r jsonb; mov uuid;
begin
  perform public._stock_abrir(p_cuenta);
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para dar de baja stock'; end if;
  if not exists (select 1 from public.ubicaciones_stock where id = p_origen and profesional_id = p_cuenta) then
    raise exception 'Elegí de dónde sale';
  end if;
  if coalesce(p_motivo, '') not in ('rotura', 'perdida', 'vencido', 'robo', 'otro') then raise exception 'Elegí el motivo de la baja'; end if;
  if p_motivo = 'otro' and coalesce(trim(p_nota), '') = '' then raise exception 'Contá el motivo de la baja'; end if;
  rs := public._stock_renglones(p_cuenta, p_items);
  mov := public._stock_comprobante(p_cuenta, 'baja', 'hecho', p_origen, null, rs, jsonb_build_object('motivo', p_motivo, 'nota', p_nota));
  for r in select * from jsonb_array_elements(rs) loop
    perform public._stock_sumar(p_cuenta, mov, p_origen, (r ->> 'material_id')::uuid, -(r ->> 'cantidad')::numeric, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov));
end $$;

-- Conteo: se carga lo que hay; queda la diferencia con lo que decía el sistema
create or replace function public.stock_conteo(p_cuenta uuid, p_ubicacion uuid, p_lineas jsonb, p_motivo text default 'conteo', p_nota text default null)
returns json language plpgsql security definer set search_path = public as $$
declare rs jsonb; c record; items jsonb := '[]'::jsonb; k int := 0; mov uuid; dif numeric; difs int := 0;
begin
  perform public._stock_abrir(p_cuenta);
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para contar el stock'; end if;
  if not exists (select 1 from public.ubicaciones_stock where id = p_ubicacion and profesional_id = p_cuenta and tipo in ('deposito', 'operario')) then
    raise exception 'Elegí qué lugar contaste';
  end if;
  p_motivo := coalesce(nullif(p_motivo, ''), 'conteo');
  if p_motivo not in ('conteo', 'inicial') then raise exception 'Motivo no válido'; end if;
  rs := public._stock_renglones(p_cuenta, p_lineas, true);
  for c in select (x ->> 'material_id')::uuid as material_id, sum((x ->> 'cantidad')::numeric) as contado, min((x ->> 'n')::int) as orden
             from jsonb_array_elements(rs) x group by 1 order by 3 loop
    k := k + 1;
    dif := c.contado - coalesce((select s.cantidad from public.stock s where s.ubicacion_id = p_ubicacion and s.material_id = c.material_id), 0);
    if dif <> 0 then difs := difs + 1; end if;
    items := items || jsonb_build_array(jsonb_build_object('n', k, 'material_id', c.material_id, 'cantidad', dif, 'anterior', c.contado - dif));
  end loop;
  mov := public._stock_comprobante(p_cuenta, 'conteo', 'hecho', p_ubicacion, p_ubicacion, items, jsonb_build_object('motivo', p_motivo, 'nota', p_nota));
  for c in select (x ->> 'material_id')::uuid as material_id, (x ->> 'cantidad')::numeric as dif from jsonb_array_elements(items) x loop
    perform public._stock_sumar(p_cuenta, mov, p_ubicacion, c.material_id, c.dif, 'alta');
  end loop;
  return json_build_object('id', mov, 'numero', (select numero from public.movimientos_stock where id = mov), 'diferencias', difs);
end $$;

-- Anulación: un comprobante nuevo que deshace el efecto del original (que queda, marcado como anulado)
create or replace function public.stock_anular(p_movimiento uuid, p_motivo text)
returns json language plpgsql security definer set search_path = public as $$
declare m public.movimientos_stock; items jsonb; nuevo uuid; k record;
begin
  select * into m from public.movimientos_stock where id = p_movimiento;
  if not found then raise exception 'No encontramos ese movimiento'; end if;
  perform public._stock_abrir(m.profesional_id);
  select * into m from public.movimientos_stock where id = p_movimiento;
  if not public.gestiona_stock(m.profesional_id) then raise exception 'Solo quien maneja el stock puede anular'; end if;
  if m.tipo = 'anulacion' then raise exception 'Una anulación no se anula: hacé el movimiento de nuevo'; end if;
  if m.anulado_por is not null then raise exception 'Ese comprobante ya está anulado'; end if;
  if m.estado = 'pendiente' then raise exception 'Está pendiente: cancelalo en lugar de anularlo'; end if;
  if m.estado <> 'hecho' then raise exception 'Ese comprobante no movió stock'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Poné el motivo de la anulación'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('n', i.n, 'material_id', i.material_id, 'cantidad', i.cantidad, 'presentacion', i.presentacion,
                                              'factor', i.factor, 'cantidad_presentacion', i.cantidad_presentacion, 'anterior', i.anterior)
                            order by i.n), '[]'::jsonb)
    into items from public.movimientos_stock_items i where i.movimiento_id = m.id;
  nuevo := public._stock_comprobante(m.profesional_id, 'anulacion', 'hecho', m.destino_id, m.origen_id, items,
             jsonb_build_object('anula_a', m.id, 'motivo', m.tipo, 'nota', p_motivo, 'referencia', 'Anula el Nº ' || m.numero,
                                'proveedor_id', m.proveedor_id, 'proveedor_nombre', m.proveedor_nombre, 'orden_compra_id', m.orden_compra_id));
  -- primero se saca de donde había entrado (si ya no está, no se puede anular)
  for k in select ubicacion_id, material_id, sum(cantidad) as c from public.kardex where movimiento_id = m.id
            group by 1, 2 having sum(cantidad) <> 0 order by 3 desc loop
    perform public._stock_sumar(m.profesional_id, nuevo, k.ubicacion_id, k.material_id, -k.c, 'alta');
  end loop;
  update public.movimientos_stock set anulado_por = nuevo where id = m.id;
  if m.orden_compra_id is not null and m.tipo = 'ingreso' then perform public._orden_recalcular(m.orden_compra_id); end if;
  return json_build_object('id', nuevo, 'numero', (select numero from public.movimientos_stock where id = nuevo));
end $$;

-- ---------------------------------------------------------------------
-- 9. Consultas para las pantallas
-- ---------------------------------------------------------------------
-- Existencias: cada material con su stock por lugar, en obra y en camino
create or replace function public.stock_existencias(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare vc boolean;
begin
  if not public.ve_stock(p_cuenta) then raise exception 'No tenés permiso para ver el stock'; end if;
  vc := public.ve_costos(p_cuenta);
  return json_build_object(
    'gestiona', public.gestiona_stock(p_cuenta),
    've_costos', vc,
    'materiales', (select coalesce(json_agg(json_build_object(
        'id', m.id, 'codigo', m.codigo, 'nombre', m.nombre, 'marca', m.marca, 'categoria', m.categoria, 'unidad', m.unidad,
        'decimales', m.decimales, 'presentaciones', m.presentaciones, 'stock_minimo', m.stock_minimo, 'activo', m.activo, 'notas', m.notas,
        'costo', case when vc then c.costo end, 'moneda', case when vc then c.moneda end,
        'lugares', (select coalesce(json_agg(json_build_object('ubicacion_id', s.ubicacion_id, 'cantidad', s.cantidad)), '[]'::json)
                      from public.stock s join public.ubicaciones_stock u on u.id = s.ubicacion_id
                     where s.material_id = m.id and s.cantidad > 0 and u.tipo in ('deposito', 'operario')),
        'en_obra', (select coalesce(sum(s.cantidad), 0) from public.stock s join public.ubicaciones_stock u on u.id = s.ubicacion_id
                     left join public.ordenes o on o.id = u.orden_id left join public.turnos t on t.id = u.turno_id
                     where s.material_id = m.id and u.tipo = 'trabajo'
                       and coalesce(o.estado, t.estado, 'borrado') not in ('finalizado', 'realizado')),
        'transito', (select coalesce(sum(i.cantidad), 0) from public.movimientos_stock_items i
                      join public.movimientos_stock mv on mv.id = i.movimiento_id
                     where i.material_id = m.id and mv.estado = 'pendiente')
      ) order by m.activo desc, m.nombre), '[]'::json)
      from public.materiales m left join public.materiales_costos c on c.material_id = m.id
      where m.profesional_id = p_cuenta),
    'lugares', (select coalesce(json_agg(json_build_object(
        'id', u.id, 'tipo', u.tipo, 'nombre', u.nombre, 'principal', u.principal, 'activo', u.activo,
        'usuario_id', u.usuario_id, 'orden_id', u.orden_id, 'turno_id', u.turno_id,
        'trabajo_estado', case when u.tipo = 'trabajo' then coalesce(o.estado, t.estado, 'borrado') end,
        'materiales', (select count(*) from public.stock s where s.ubicacion_id = u.id and s.cantidad > 0)
      ) order by case u.tipo when 'deposito' then 0 when 'operario' then 1 else 2 end, u.principal desc, u.nombre), '[]'::json)
      from public.ubicaciones_stock u
      left join public.ordenes o on o.id = u.orden_id left join public.turnos t on t.id = u.turno_id
      where u.profesional_id = p_cuenta
        and (u.tipo <> 'trabajo'
             or (coalesce(o.estado, t.estado, 'borrado') not in ('finalizado', 'realizado')
                 and exists (select 1 from public.stock s where s.ubicacion_id = u.id and s.cantidad > 0)))),
    'pendientes', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero), '[]'::json)
                     from public.movimientos_stock m where m.profesional_id = p_cuenta and m.estado = 'pendiente')
  );
end $$;

-- Comprobantes (quien ve el stock: todos; cada persona del equipo: los de su stock)
create or replace function public.stock_movimientos(p_cuenta uuid, p_ubicacion uuid default null, p_material uuid default null,
                                                    p_tipo text default null, p_antes int default null, p_limite int default 50)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); ve boolean; mio uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  ve := public.ve_stock(p_cuenta);
  if not ve then
    if not public._es_del_equipo(p_cuenta, uid) then raise exception 'No tenés acceso al stock de esta empresa'; end if;
    select id into mio from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = uid;
    if mio is null then return '[]'::json; end if;
  end if;
  return coalesce((
    select json_agg(public._mov_json(x.id, ve and public.ve_costos(p_cuenta)) order by x.numero desc)
    from (select m.id, m.numero from public.movimientos_stock m
           where m.profesional_id = p_cuenta
             and (ve or m.origen_id = mio or m.destino_id = mio)
             and (p_ubicacion is null or m.origen_id = p_ubicacion or m.destino_id = p_ubicacion)
             and (p_material is null or exists (select 1 from public.movimientos_stock_items i where i.movimiento_id = m.id and i.material_id = p_material))
             and (p_tipo is null or m.tipo = p_tipo)
             and (p_antes is null or m.numero < p_antes)
           order by m.numero desc
           limit least(greatest(coalesce(p_limite, 50), 1), 200)) x
  ), '[]'::json);
end $$;

-- Un comprobante (quien ve el stock, o la persona del equipo si es de su stock)
create or replace function public.stock_comprobante(p_id uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare m public.movimientos_stock; ve boolean;
begin
  if auth.uid() is null then raise exception 'Tenés que iniciar sesión'; end if;
  select * into m from public.movimientos_stock where id = p_id;
  if not found then raise exception 'No encontramos ese comprobante'; end if;
  ve := public.ve_stock(m.profesional_id);
  if not ve and not exists (select 1 from public.ubicaciones_stock u
                            where u.id in (m.origen_id, m.destino_id) and u.tipo = 'operario' and u.usuario_id = auth.uid()) then
    raise exception 'No tenés acceso a ese comprobante';
  end if;
  return public._mov_json(p_id, ve and public.ve_costos(m.profesional_id));
end $$;

-- Kardex de un material: cada asiento con el saldo que quedó en ese lugar
create or replace function public.stock_kardex(p_cuenta uuid, p_material uuid, p_ubicacion uuid default null, p_antes bigint default null, p_limite int default 80)
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ve_stock(p_cuenta) then raise exception 'No tenés permiso para ver el stock'; end if;
  return coalesce((
    select json_agg(json_build_object('id', k.id, 'creado_en', k.creado_en, 'cantidad', k.cantidad, 'saldo', k.saldo, 'evento', k.evento,
                                      'ubicacion_id', k.ubicacion_id, 'lugar', u.nombre, 'lugar_tipo', u.tipo,
                                      'movimiento_id', k.movimiento_id, 'numero', m.numero, 'tipo', m.tipo, 'estado', m.estado,
                                      'anulado', m.anulado_por is not null, 'por', public._nombre_de(k.creado_por))
                    order by k.id desc)
    from (select * from public.kardex k
           where k.profesional_id = p_cuenta and k.material_id = p_material
             and (p_ubicacion is null or k.ubicacion_id = p_ubicacion)
             and (p_antes is null or k.id < p_antes)
           order by k.id desc limit least(greatest(coalesce(p_limite, 80), 1), 300)) k
    join public.ubicaciones_stock u on u.id = k.ubicacion_id
    join public.movimientos_stock m on m.id = k.movimiento_id
  ), '[]'::json);
end $$;

-- Trabajos para elegir al mandar materiales (los recientes y los abiertos)
create or replace function public.stock_trabajos(p_cuenta uuid, p_texto text default null)
returns json language plpgsql stable security definer set search_path = public as $$
declare hoy date := (now() at time zone 'America/Montevideo')::date; q text := public.normalizar(coalesce(trim(p_texto), ''));
begin
  if not public.gestiona_stock(p_cuenta) then raise exception 'No tenés permiso para manejar el stock'; end if;
  return coalesce((
    select json_agg(x order by x.abierto desc, x.fecha desc, x.nombre)
    from (select * from (
            select 'ticket' as tipo, o.id,
                   concat_ws(' · ', c.nombre, case when nullif(o.numero_ticket, '') is not null then 'Tk ' || o.numero_ticket
                                                   when nullif(o.numero_cliente, '') is not null then 'Cliente ' || o.numero_cliente end,
                             nullif(trim(o.cliente_final), '')) as nombre,
                   o.fecha, o.estado, o.estado not in ('finalizado') as abierto,
                   o.asignado_a, public._nombre_de(o.asignado_a) as asignado
              from public.ordenes o join public.clientes c on c.id = o.empresa_id
             where o.profesional_id = p_cuenta and o.estado <> 'cancelado'
               and (o.fecha between hoy - 60 and hoy + 30 or o.estado in ('en_curso', 'multidia', 'suspendido'))
            union all
            select 'turno', t.id, concat_ws(' · ', initcap(t.tipo), coalesce(nullif(cl.nombre, ''), nullif(t.titulo, ''), 'Trabajo')),
                   (t.inicio at time zone 'America/Montevideo')::date, t.estado, t.estado <> 'realizado',
                   t.asignado_a, public._nombre_de(t.asignado_a)
              from public.turnos t left join public.clientes cl on cl.id = t.cliente_id
             where t.profesional_id = p_cuenta and t.estado <> 'cancelado'
               and t.inicio >= ((hoy - 30)::timestamp at time zone 'America/Montevideo')
               and t.inicio < ((hoy + 31)::timestamp at time zone 'America/Montevideo')
          ) y
          where q = '' or public.normalizar(y.nombre) like '%' || q || '%'
          order by y.abierto desc, y.fecha desc
          limit 80) x
  ), '[]'::json);
end $$;

-- Materiales de un trabajo: lo que hay, lo previsto en el ticket y los comprobantes.
-- Para la persona asignada incluye su stock (para elegir qué usa) y si todavía puede cargar.
create or replace function public.stock_de_trabajo(p_cuenta uuid, p_tipo text, p_trabajo uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); ve boolean; gestor boolean; u uuid; mio uuid; asig uuid; nombre text; puede boolean := true; previstos jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  ve := public.ve_stock(p_cuenta);
  gestor := public.gestiona_stock(p_cuenta);
  if p_tipo = 'ticket' then
    select o.asignado_a into asig from public.ordenes o where o.id = p_trabajo and o.profesional_id = p_cuenta;
    if not found then raise exception 'Ese ticket no es de esta cuenta'; end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item', x ->> 'item', 'cantidad', public.numero_o_null(x ->> 'cantidad'), 'unidad', x ->> 'unidad',
             'material_id', coalesce(
               (select v.material_id from public.materiales_vinculos v where v.profesional_id = p_cuenta
                  and v.producto_id = public.uuid_o_null(x ->> 'producto_id')),
               (select mt.id from public.materiales mt where mt.profesional_id = p_cuenta and mt.activo
                  and public.normalizar(mt.nombre) = public.normalizar(x ->> 'item') limit 1)))), '[]'::jsonb)
      into previstos
      from public.ordenes o, jsonb_array_elements(o.materiales) x
     where o.id = p_trabajo and nullif(trim(coalesce(x ->> 'item', '')), '') is not null;
  elsif p_tipo = 'turno' then
    select t.asignado_a into asig from public.turnos t where t.id = p_trabajo and t.profesional_id = p_cuenta;
    if not found then raise exception 'Ese trabajo no es de esta cuenta'; end if;
  else
    raise exception 'Tipo de trabajo no válido';
  end if;
  if not ve and not (asig = uid and public._es_del_equipo(p_cuenta, uid)) then
    raise exception 'Ese trabajo no está asignado a vos';
  end if;
  begin
    perform public._stock_trabajo_permitido(p_cuenta, p_tipo, p_trabajo, gestor, false);
  exception when others then
    puede := false;
  end;
  select id, ubicaciones_stock.nombre into u, nombre from public.ubicaciones_stock where (p_tipo = 'ticket' and orden_id = p_trabajo) or (p_tipo = 'turno' and turno_id = p_trabajo);
  select id into mio from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = uid;
  return json_build_object(
    'ubicacion', u, 'nombre', nombre, 'puede', puede, 'gestiona', gestor, 'mio', mio,
    'materiales', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                              'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                              'cantidad', s.cantidad) order by m.nombre), '[]'::json)
                     from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = u and s.cantidad > 0),
    'mi_stock', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                            'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                            'cantidad', s.cantidad) order by m.nombre), '[]'::json)
                   from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = mio and s.cantidad > 0),
    'previstos', previstos,
    'movimientos', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero desc), '[]'::json)
                      from public.movimientos_stock m where u is not null and (m.origen_id = u or m.destino_id = u))
  );
end $$;

-- Mi stock (cada persona del equipo): lo que tengo, lo que me mandaron y lo que mandé
create or replace function public.mi_stock(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); mio uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  if not public._es_del_equipo(p_cuenta, uid) then raise exception 'No sos parte del equipo de esta empresa'; end if;
  select id into mio from public.ubicaciones_stock where profesional_id = p_cuenta and tipo = 'operario' and usuario_id = uid;
  return json_build_object(
    'ubicacion', mio,
    'usa_stock', exists (select 1 from public.materiales where profesional_id = p_cuenta),
    'materiales', (select coalesce(json_agg(json_build_object('material_id', m.id, 'nombre', m.nombre, 'codigo', m.codigo, 'marca', m.marca,
                                                              'unidad', m.unidad, 'decimales', m.decimales, 'presentaciones', m.presentaciones,
                                                              'cantidad', s.cantidad) order by m.nombre), '[]'::json)
                     from public.stock s join public.materiales m on m.id = s.material_id where s.ubicacion_id = mio and s.cantidad > 0),
    'recibir', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero), '[]'::json)
                  from public.movimientos_stock m where mio is not null and m.destino_id = mio and m.estado = 'pendiente'),
    'enviados', (select coalesce(json_agg(public._mov_json(m.id) order by m.numero), '[]'::json)
                   from public.movimientos_stock m where mio is not null and m.origen_id = mio and m.estado = 'pendiente'),
    'depositos', (select coalesce(json_agg(json_build_object('id', u.id, 'nombre', u.nombre) order by u.principal desc, u.nombre), '[]'::json)
                    from public.ubicaciones_stock u where u.profesional_id = p_cuenta and u.tipo = 'deposito' and u.activo),
    'equipo', (select coalesce(json_agg(json_build_object('id', u.id, 'nombre', u.nombre) order by u.nombre), '[]'::json)
                 from public.ubicaciones_stock u where u.profesional_id = p_cuenta and u.tipo = 'operario' and u.activo
                   and u.usuario_id is distinct from uid)
  );
end $$;

-- Para el aviso en Mis tickets: ¿la empresa usa stock y cuántas entregas tengo para confirmar?
create or replace function public.stock_avisos(p_cuenta uuid)
returns json language sql stable security definer set search_path = public as $$
  select case when public._es_del_equipo(p_cuenta, auth.uid()) or public.ve_stock(p_cuenta) then json_build_object(
    'usa_stock', exists (select 1 from public.materiales where profesional_id = p_cuenta),
    'recibir', (select count(*) from public.movimientos_stock m join public.ubicaciones_stock u on u.id = m.destino_id
                 where m.profesional_id = p_cuenta and m.estado = 'pendiente' and u.tipo = 'operario' and u.usuario_id = auth.uid()),
    'tengo', exists (select 1 from public.stock s join public.ubicaciones_stock u on u.id = s.ubicacion_id
                     where u.profesional_id = p_cuenta and u.tipo = 'operario' and u.usuario_id = auth.uid() and s.cantidad > 0)
  ) else json_build_object('usa_stock', false, 'recibir', 0, 'tengo', false) end;
$$;

-- Verificación: huellas encadenadas, sello, saldos y comprobantes
create or replace function public.verificar_stock(p_cuenta uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare errores jsonb := '[]'::jsonb; n_asientos bigint; n_mov int; s public.stock_sello; ult public.kardex; x record;
begin
  if not public.ve_stock(p_cuenta) then raise exception 'No tenés permiso para ver el stock'; end if;
  select count(*) into n_asientos from public.kardex where profesional_id = p_cuenta;
  select count(*) into n_mov from public.movimientos_stock where profesional_id = p_cuenta;

  -- 1. cada asiento con su huella, encadenada a la anterior
  for x in select k.id, k.huella, public.huella_asiento(lag(k.huella) over (order by k.id), k) as calculada
             from public.kardex k where k.profesional_id = p_cuenta loop
    if x.huella is distinct from x.calculada then
      errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'asiento', 'id', x.id, 'texto', format('El asiento %s no coincide con su huella', x.id)));
    end if;
  end loop;

  -- 2. el sello: cantidad de asientos y la última huella
  select * into s from public.stock_sello where profesional_id = p_cuenta;
  select * into ult from public.kardex where profesional_id = p_cuenta order by id desc limit 1;
  if coalesce(s.asientos, 0) <> n_asientos or s.ultima_huella is distinct from ult.huella then
    errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'sello', 'texto', 'Faltan o sobran asientos respecto del sello'));
  end if;

  -- 3. saldo de cada lugar = suma de sus asientos, y el saldo anotado en cada asiento
  for x in select coalesce(st.ubicacion_id, k.ubicacion_id) as ubicacion_id, coalesce(st.material_id, k.material_id) as material_id
             from (select * from public.stock where profesional_id = p_cuenta and cantidad <> 0) st
             full join (select ubicacion_id, material_id, sum(cantidad) as total from public.kardex where profesional_id = p_cuenta group by 1, 2) k
               on k.ubicacion_id = st.ubicacion_id and k.material_id = st.material_id
            where coalesce(st.cantidad, 0) <> coalesce(k.total, 0) loop
    errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'saldo', 'ubicacion_id', x.ubicacion_id, 'material_id', x.material_id,
                 'texto', format('El saldo de %s en %s no coincide con sus movimientos',
                                 (select nombre from public.materiales where id = x.material_id),
                                 (select nombre from public.ubicaciones_stock where id = x.ubicacion_id))));
  end loop;
  for x in select id from (select k.id, k.saldo, sum(k.cantidad) over (partition by k.ubicacion_id, k.material_id order by k.id) as corrido
                             from public.kardex k where k.profesional_id = p_cuenta) z where z.saldo <> z.corrido limit 20 loop
    errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'asiento', 'id', x.id, 'texto', format('El saldo del asiento %s no cierra', x.id)));
  end loop;

  -- 4. comprobantes tal como se hicieron, y numeración sin huecos
  for x in select m.numero from public.movimientos_stock m
            where m.profesional_id = p_cuenta and m.huella is distinct from public.huella_movimiento(m.id) limit 20 loop
    errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'comprobante', 'numero', x.numero, 'texto', format('El comprobante Nº %s fue modificado', x.numero)));
  end loop;
  if n_mov > 0 and (select max(numero) from public.movimientos_stock where profesional_id = p_cuenta) <> n_mov then
    errores := errores || jsonb_build_array(jsonb_build_object('tipo', 'numeracion', 'texto', 'Falta algún comprobante en la numeración'));
  end if;

  return json_build_object('ok', jsonb_array_length(errores) = 0, 'asientos', n_asientos, 'comprobantes', n_mov,
                           'errores', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(errores) e limit 30) z),
                           'verificado_en', now());
end $$;

-- ---------------------------------------------------------------------
-- 10. Si una persona sale del equipo: lo que le habían mandado y no confirmó vuelve al origen;
--     lo que tiene queda en su lugar (inactivo) para pasarlo a otro.
-- ---------------------------------------------------------------------
create or replace function public.stock_al_salir()
returns trigger language plpgsql security definer set search_path = public as $$
declare dueno uuid; u uuid; m record; it record;
begin
  select dueno_id into dueno from public.empresas where id = old.empresa_id;
  if dueno is null or not exists (select 1 from public.profesionales where id = dueno) then return old; end if;
  select id into u from public.ubicaciones_stock where profesional_id = dueno and tipo = 'operario' and usuario_id = old.usuario_id;
  if u is null then return old; end if;
  perform pg_advisory_xact_lock(hashtext('stock' || dueno::text));
  perform set_config('talisto.stock', 'si', true);
  update public.ubicaciones_stock set activo = false where id = u;
  for m in select * from public.movimientos_stock where profesional_id = dueno and destino_id = u and estado = 'pendiente' loop
    for it in select * from public.movimientos_stock_items where movimiento_id = m.id loop
      perform public._stock_sumar(dueno, m.id, m.origen_id, it.material_id, it.cantidad, 'cancelacion');
    end loop;
    update public.movimientos_stock set estado = 'cancelado', respondido_en = now(),
           respuesta = 'Se canceló solo: la persona salió del equipo'
     where id = m.id;
  end loop;
  return old;
end $$;
drop trigger if exists talisto_stock_al_salir on public.miembros;
create trigger talisto_stock_al_salir after delete on public.miembros
  for each row execute function public.stock_al_salir();

-- ---------------------------------------------------------------------
-- 11. Seguridad: cada uno ve lo suyo; el stock solo se mueve con las funciones
-- ---------------------------------------------------------------------
alter table public.materiales enable row level security;
alter table public.materiales_costos enable row level security;
alter table public.materiales_vinculos enable row level security;
alter table public.ubicaciones_stock enable row level security;
alter table public.stock enable row level security;
alter table public.movimientos_stock enable row level security;
alter table public.movimientos_stock_items enable row level security;
alter table public.kardex enable row level security;
alter table public.stock_sello enable row level security;

drop policy if exists materiales_leer on public.materiales;
create policy materiales_leer on public.materiales for select
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])));
drop policy if exists materiales_editar on public.materiales;
create policy materiales_editar on public.materiales for all
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])))
  with check (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])));

drop policy if exists costos_leer on public.materiales_costos;
create policy costos_leer on public.materiales_costos for select
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['importes', 'compras'])));
drop policy if exists costos_editar on public.materiales_costos;
create policy costos_editar on public.materiales_costos for all
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['compras'])))
  with check (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['compras'])));

drop policy if exists vinculos_leer on public.materiales_vinculos;
create policy vinculos_leer on public.materiales_vinculos for select
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])));
drop policy if exists vinculos_editar on public.materiales_vinculos;
create policy vinculos_editar on public.materiales_vinculos for all
  using (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])))
  with check (profesional_id = (select auth.uid()) or profesional_id in (select public.cuentas_con(array['stock', 'compras'])));

do $$
declare t text;
begin
  foreach t in array array['ubicaciones_stock', 'stock', 'movimientos_stock', 'movimientos_stock_items', 'kardex', 'stock_sello'] loop
    execute format('drop policy if exists %I on public.%I', t || '_leer', t);
    execute format('create policy %I on public.%I for select using (profesional_id = (select auth.uid()) '
                   'or profesional_id in (select public.cuentas_con(array[''stock'', ''compras''])))', t || '_leer', t);
  end loop;
end $$;

revoke all on public.materiales, public.materiales_costos, public.materiales_vinculos, public.ubicaciones_stock, public.stock,
              public.movimientos_stock, public.movimientos_stock_items, public.kardex, public.stock_sello from anon, authenticated;
grant select, insert, update, delete on public.materiales, public.materiales_costos, public.materiales_vinculos to authenticated;
grant select on public.ubicaciones_stock, public.stock, public.movimientos_stock, public.movimientos_stock_items,
                public.kardex, public.stock_sello to authenticated;
grant all on public.materiales, public.materiales_costos, public.materiales_vinculos, public.ubicaciones_stock, public.stock,
             public.movimientos_stock, public.movimientos_stock_items, public.kardex, public.stock_sello to service_role;

do $$
declare f text;
begin
  -- funciones que usa la app
  foreach f in array array[
    'public.permisos_validos()', 'public.crear_mi_empresa(text)', 'public.cantidad_texto(numeric)',
    'public.gestiona_stock(uuid)', 'public.ve_stock(uuid)', 'public.ve_costos(uuid)',
    'public.stock_lugares(uuid)', 'public.stock_deposito(uuid, uuid, text, boolean)',
    'public.stock_ingresar(uuid, uuid, jsonb, text, uuid, text, text)',
    'public.recibir_orden_compra(uuid, uuid, jsonb, text, text)',
    'public.stock_transferir(uuid, uuid, uuid, jsonb, text)', 'public.stock_responder(uuid, boolean, jsonb, text)',
    'public.stock_cancelar(uuid, text)', 'public.stock_a_trabajo(uuid, uuid, text, uuid, jsonb, text)',
    'public.stock_desde_trabajo(uuid, text, uuid, uuid, jsonb, text, text)',
    'public.stock_devolver_proveedor(uuid, uuid, jsonb, uuid, uuid, text, text, text)',
    'public.stock_baja(uuid, uuid, jsonb, text, text)', 'public.stock_conteo(uuid, uuid, jsonb, text, text)',
    'public.stock_anular(uuid, text)', 'public.stock_existencias(uuid)',
    'public.stock_movimientos(uuid, uuid, uuid, text, int, int)', 'public.stock_kardex(uuid, uuid, uuid, bigint, int)',
    'public.stock_comprobante(uuid)',
    'public.stock_trabajos(uuid, text)', 'public.stock_de_trabajo(uuid, text, uuid)', 'public.mi_stock(uuid)',
    'public.stock_avisos(uuid)', 'public.verificar_stock(uuid)',
    -- las que corren en las reglas de las tablas
    'public.exigir_business()', 'public.preparar_material()', 'public.borrar_material()', 'public.preparar_costo_material()',
    'public.preparar_vinculo_material()', 'public.proteger_stock()', 'public.proteger_movimiento()', 'public.proteger_movimiento_item()',
    'public.sellar_asiento()', 'public.proteger_asiento()', 'public.trabajo_con_stock()', 'public.orden_compra_con_stock()',
    'public.stock_al_salir()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- internas: solo las usan otras funciones protegidas
  foreach f in array array[
    'public._es_del_equipo(uuid, uuid)', 'public._nombre_de(uuid)', 'public._cuenta_borrandose(uuid)', 'public.huella_asiento(text, public.kardex)',
    'public.huella_movimiento(uuid)', 'public._stock_abrir(uuid)', 'public._stock_principal(uuid)',
    'public._stock_de_operario(uuid, uuid)', 'public._stock_de_trabajo(uuid, text, uuid, boolean)',
    'public._stock_trabajo_permitido(uuid, text, uuid, boolean, boolean)', 'public._stock_renglones(uuid, jsonb, boolean, boolean)',
    'public._stock_comprobante(uuid, text, text, uuid, uuid, jsonb, jsonb)', 'public._stock_sumar(uuid, uuid, uuid, uuid, numeric, text)',
    'public._mov_json(uuid, boolean)', 'public._orden_recalcular(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

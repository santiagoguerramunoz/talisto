-- =====================================================================
--  TaListo!  ·  LISTAS DE PRECIOS EN PDF CON IA, POR TANDAS
--  La app parte el PDF (o las fotos) de la lista del proveedor en tandas
--  de pocas páginas y la IA lee cada una por separado. Toda la lista cuenta
--  como UNA lectura del tope del mes, y solo si se pudo leer alguna tanda.
--  Lo hace quien puede editar el proveedor, en Pro y Business.
--  Los productos se cargan después, revisados, con la importación de
--  siempre (SQL 09). Acá solo se anota quién leyó y cuántas tandas.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 17). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.productos_proveedor') is null then
    raise exception 'Primero corré el SQL 09 (proveedores)';
  end if;
  if to_regclass('public.lecturas_ordenes') is null then
    raise exception 'Primero corré el SQL 16 (órdenes de trabajo con IA)';
  end if;
end $$;

create table if not exists public.lecturas_listas (
  id              uuid primary key default gen_random_uuid(),
  profesional_id  uuid not null references public.profesionales(id) on delete cascade,
  proveedor_id    uuid not null references public.proveedores(id) on delete cascade,
  usuario_id      uuid references public.perfiles(id) on delete set null,
  usuario_nombre  text,
  tandas          int not null check (tandas between 1 and 40),
  pedidas         int not null default 0,   -- tandas mandadas a la IA (con reintentos)
  leidas          int not null default 0,   -- tandas que se pudieron leer
  productos       int not null default 0,
  creado_en       timestamptz not null default now()
);
create index if not exists lecturas_listas_cuenta_idx on public.lecturas_listas (profesional_id, creado_en desc);

alter table public.lecturas_listas enable row level security;
revoke all on public.lecturas_listas from anon, authenticated;
grant all on public.lecturas_listas to service_role;

-- El tope del mes es uno solo: comprobantes, órdenes y listas (cada lista leída cuenta una vez)
create or replace function public._lecturas_mes(c uuid)
returns int language sql stable security definer set search_path = public as $$
  select (select count(*) from public.comprobantes
           where profesional_id = c and creado_en >= public.inicio_mes_uy() and estado <> 'error')::int
       + (select count(*) from public.lecturas_ordenes
           where profesional_id = c and creado_en >= public.inicio_mes_uy() and estado <> 'error')::int
       + (select count(*) from public.lecturas_listas
           where profesional_id = c and creado_en >= public.inicio_mes_uy() and leidas > 0)::int;
$$;

-- La llama el servidor antes de la primera tanda (controla plan, permiso y tope)
create or replace function public.iniciar_lectura_lista(p_proveedor uuid, p_tandas int)
returns json language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); c uuid; lim int; usadas int; v uuid;
begin
  if uid is null then raise exception 'Tenés que iniciar sesión'; end if;
  select profesional_id into c from public.proveedores where id = p_proveedor;
  if c is null or not public.puede_editar_proveedor(p_proveedor) then
    raise exception 'No podés editar este proveedor';
  end if;
  if public.plan_de(c) = 'free' then
    raise exception using errcode = 'TL001', message = 'Leer listas de precios con IA es parte de los planes Pro y Business.',
      hint = 'Pasate a Pro desde Perfil > Mi plan.';
  end if;
  if p_tandas is null or p_tandas < 1 or p_tandas > 40 then
    raise exception 'La lista tiene que ir en 1 a 40 tandas';
  end if;
  -- el mismo candado que comprobantes y órdenes: el tope es compartido
  perform pg_advisory_xact_lock(hashtext('comprobantes' || c::text));
  lim := public._limite_ia(c);
  usadas := public._lecturas_mes(c);
  if usadas >= lim then
    raise exception using errcode = 'TL002',
      message = format('Llegaron al tope de %s lecturas con IA este mes.', lim),
      hint = 'El mes que viene se renueva. Mientras tanto la podés cargar en Excel o CSV.';
  end if;
  insert into public.lecturas_listas (profesional_id, proveedor_id, usuario_id, usuario_nombre, tandas)
  values (c, p_proveedor, uid, public._nombre_de(uid), p_tandas)
  returning id into v;
  return json_build_object('id', v, 'usadas', usadas + 1, 'limite', lim);
end $$;

-- Antes de mandar cada tanda a la IA: la lectura tiene que ser de quien la pide y seguir vigente
create or replace function public.tanda_lectura_lista(p_id uuid)
returns json language plpgsql security definer set search_path = public as $$
declare l public.lecturas_listas;
begin
  select * into l from public.lecturas_listas where id = p_id for update;
  if not found or l.usuario_id is distinct from auth.uid() then
    raise exception using errcode = 'TL003', message = 'Esta lectura no es tuya o ya no existe. Empezá de nuevo.';
  end if;
  if l.creado_en < now() - interval '3 hours' then
    raise exception using errcode = 'TL003', message = 'Pasaron más de 3 horas desde que empezó la lectura. Empezá de nuevo.';
  end if;
  if l.pedidas >= l.tandas * 2 + 4 then
    raise exception using errcode = 'TL003', message = 'Demasiados reintentos para esta lista. Empezá de nuevo.';
  end if;
  if not public.puede_editar_proveedor(l.proveedor_id) then raise exception 'No podés editar este proveedor'; end if;
  update public.lecturas_listas set pedidas = pedidas + 1 where id = p_id;
  return json_build_object('proveedor_id', l.proveedor_id);
end $$;

-- Una tanda que se pudo leer (desde la primera, la lista cuenta para el tope)
create or replace function public.tanda_lista_leida(p_id uuid, p_productos int default 0)
returns json language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  update public.lecturas_listas
     set leidas = leidas + 1, productos = productos + greatest(0, least(coalesce(p_productos, 0), 1000))
   where id = p_id and usuario_id = auth.uid() and leidas < pedidas
  returning profesional_id into c;
  if c is null then return null; end if;
  return json_build_object('usadas', public._lecturas_mes(c), 'limite', public._limite_ia(c));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.iniciar_lectura_lista(uuid, int)', 'public.tanda_lectura_lista(uuid)', 'public.tanda_lista_leida(uuid, int)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke execute on function public._lecturas_mes(uuid) from public, anon, authenticated;
  grant execute on function public._lecturas_mes(uuid) to service_role;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

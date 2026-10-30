-- =====================================================================
--  TaListo!  ·  PLANES  Free · Pro · Business
--  · Free: agenda, relevamientos, clientes B2B y B2C, mapa y rutas.
--          Trabajos B2B de hasta 2 empresas y 6 planillas Excel por mes.
--          Sin presupuestos, sin Mis gastos y sin logo / datos del negocio.
--  · Pro: todo lo actual.   · Business: Pro + empresa con cuentas (etapa 2).
--  El plan sale de Mercado Pago (suscripción) o de un regalo del admin,
--  con o sin fecha de vencimiento. Los límites los controla la base.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 04). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.presupuestos') is null or to_regclass('public.gastos') is null then
    raise exception 'Primero corré 04_trabajos_finanzas.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Precios y límites (los edita el admin)
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists precio_pro numeric(12,2) not null default 0;
alter table public.configuracion add column if not exists precio_business numeric(12,2) not null default 0;
alter table public.configuracion add column if not exists free_exportaciones_mes int not null default 6;
alter table public.configuracion add column if not exists free_empresas_b2b int not null default 2;
alter table public.configuracion add column if not exists business_cuentas_defecto int not null default 5;

alter table public.configuracion drop constraint if exists configuracion_planes_check;
alter table public.configuracion add constraint configuracion_planes_check check (
  precio_pro >= 0 and precio_business >= 0 and free_exportaciones_mes >= 0
  and free_empresas_b2b >= 0 and business_cuentas_defecto >= 1
);

-- ---------------------------------------------------------------------
-- 2. Plan de cada usuario
--    plan + vence_en: si vence_en ya pasó (o no hay fila) el plan es Free.
--    origen: 'mercadopago' (suscripción) o 'regalo' (lo dio el admin).
-- ---------------------------------------------------------------------
create table if not exists public.planes (
  usuario_id         uuid primary key references public.perfiles(id) on delete cascade,
  plan               text not null default 'free' check (plan in ('free','pro','business')),
  origen             text not null default 'free' check (origen in ('free','mercadopago','regalo')),
  vence_en           timestamptz,               -- null = sin vencimiento
  max_cuentas        int check (max_cuentas is null or max_cuentas >= 1),  -- Business: lo fija el admin
  nota               text,
  mp_preapproval_id  text unique,               -- suscripción de Mercado Pago
  mp_plan            text check (mp_plan is null or mp_plan in ('pro','business')),
  mp_estado          text,                      -- pending · authorized · paused · cancelled
  mp_email           text,
  mp_proximo_cobro   timestamptz,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  actualizado_por    uuid
);

create or replace function public.tocar_plan()
returns trigger language plpgsql set search_path = public as $$
begin
  new.actualizado_en := now();
  if auth.uid() is not null then new.actualizado_por := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists talisto_tocar_plan on public.planes;
create trigger talisto_tocar_plan before insert or update on public.planes
  for each row execute function public.tocar_plan();

-- Plan vigente de un usuario
create or replace function public.plan_de(u uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when p.plan <> 'free' and (p.vence_en is null or p.vence_en > now()) then p.plan else 'free' end
    from public.planes p where p.usuario_id = u
  ), 'free');
$$;

-- Texto a uuid sin fallar
create or replace function public.uuid_o_null(t text)
returns uuid language plpgsql immutable as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- Comienzo del mes en Montevideo (para los límites mensuales)
create or replace function public.inicio_mes_uy()
returns timestamptz language sql stable as $$
  select date_trunc('month', now() at time zone 'America/Montevideo') at time zone 'America/Montevideo';
$$;

-- ---------------------------------------------------------------------
-- 3. Planillas exportadas (Free: hasta N por mes)
-- ---------------------------------------------------------------------
create table if not exists public.exportaciones (
  id          bigserial primary key,
  usuario_id  uuid not null references public.perfiles(id) on delete cascade,
  tipo        text not null default 'planilla',
  detalle     text,
  creado_en   timestamptz not null default now()
);
create index if not exists exportaciones_usuario_fecha_idx on public.exportaciones (usuario_id, creado_en);

drop function if exists public.registrar_exportacion(text, text);
create or replace function public.registrar_exportacion(p_tipo text default 'planilla', p_detalle text default null, p_cuenta uuid default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  cuenta uuid := coalesce(p_cuenta, auth.uid());   -- en una empresa: la cuenta principal
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

-- Todo lo que la app necesita saber del plan, en una llamada
create or replace function public.mi_plan()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'plan', public.plan_de(auth.uid()),
    'plan_guardado', coalesce(p.plan, 'free'),
    'origen', coalesce(p.origen, 'free'),
    'vence_en', p.vence_en,
    'max_cuentas', coalesce(p.max_cuentas, c.business_cuentas_defecto),
    'mp_plan', p.mp_plan,
    'mp_estado', p.mp_estado,
    'mp_proximo_cobro', p.mp_proximo_cobro,
    'exportaciones_mes', (select count(*) from public.exportaciones e
                          where e.usuario_id = auth.uid() and e.creado_en >= public.inicio_mes_uy()),
    'limite_exportaciones', c.free_exportaciones_mes,
    'limite_empresas_b2b', c.free_empresas_b2b,
    'precio_pro', c.precio_pro,
    'precio_business', c.precio_business,
    'moneda', c.moneda
  )
  from public.configuracion c
  left join public.planes p on p.usuario_id = auth.uid()
  where c.id = 1;
$$;

-- ---------------------------------------------------------------------
-- 4. Límites del plan Free (los controla la base, no solo la pantalla)
--    Los triggers corren con los permisos de quien llama: el admin y los
--    procesos del servidor (service_role) no quedan limitados.
-- ---------------------------------------------------------------------
create or replace function public.exigir_pro()
returns trigger language plpgsql set search_path = public as $$
declare dueno uuid;
begin
  if current_user in ('authenticated','anon') then
    -- el plan que cuenta es el de la cuenta dueña de los datos (en una empresa, la principal)
    dueno := coalesce(public.uuid_o_null(to_jsonb(coalesce(new, old))->>'profesional_id'), auth.uid());
    if public.plan_de(dueno) = 'free' then
      raise exception using errcode = 'TL001', message = tg_argv[0], hint = 'Pasate a Pro desde Perfil > Mi plan.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists talisto_plan_presupuestos on public.presupuestos;
create trigger talisto_plan_presupuestos before insert or update on public.presupuestos
  for each row execute function public.exigir_pro('Los presupuestos son parte del plan Pro.');

drop trigger if exists talisto_plan_gastos on public.gastos;
create trigger talisto_plan_gastos before insert or update on public.gastos
  for each row execute function public.exigir_pro('Mis gastos es parte del plan Pro.');

drop trigger if exists talisto_plan_ajustes on public.ajustes;
create trigger talisto_plan_ajustes before insert or update on public.ajustes
  for each row execute function public.exigir_pro('El logo y los datos del negocio son parte del plan Pro.');

-- Trabajos B2B: en Free, de hasta N empresas distintas
create or replace function public.limitar_empresas_b2b()
returns trigger language plpgsql set search_path = public as $$
declare lim int; usadas int;
begin
  if current_user not in ('authenticated','anon') or public.plan_de(new.profesional_id) <> 'free' then
    return new;
  end if;
  if exists (select 1 from public.ordenes o
             where o.profesional_id = new.profesional_id and o.empresa_id = new.empresa_id and o.id <> new.id) then
    return new;   -- empresa que ya venía usando
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

drop trigger if exists talisto_plan_ordenes on public.ordenes;
create trigger talisto_plan_ordenes before insert or update of empresa_id on public.ordenes
  for each row execute function public.limitar_empresas_b2b();

-- Logo del negocio: solo Pro y Business pueden subirlo
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists logos_subir on storage.objects';
    execute $p$create policy logos_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.plan_de((select auth.uid())) <> 'free')$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 5. Seguridad
-- ---------------------------------------------------------------------
alter table public.planes        enable row level security;
alter table public.exportaciones enable row level security;

drop policy if exists planes_leer on public.planes;
create policy planes_leer on public.planes for select
  using (usuario_id = (select auth.uid()) or public.es_admin());
drop policy if exists planes_admin on public.planes;
create policy planes_admin on public.planes for all
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists exportaciones_leer on public.exportaciones;
create policy exportaciones_leer on public.exportaciones for select
  using (usuario_id = (select auth.uid()) or public.es_admin());

grant select, insert, update, delete on public.planes to authenticated, service_role;
grant select on public.exportaciones to authenticated;
grant all on public.exportaciones to service_role;
grant usage, select on sequence public.exportaciones_id_seq to service_role;
grant execute on function public.plan_de(uuid)                    to authenticated, service_role;
grant execute on function public.inicio_mes_uy()                   to authenticated, service_role;
grant execute on function public.mi_plan()                         to authenticated, service_role;
grant execute on function public.registrar_exportacion(text, text, uuid) to authenticated, service_role;
grant execute on function public.uuid_o_null(text)                 to authenticated, service_role;
grant execute on function public.exigir_pro()                      to authenticated, service_role;
grant execute on function public.limitar_empresas_b2b()            to authenticated, service_role;
revoke execute on function public.registrar_exportacion(text, text, uuid) from anon;
revoke execute on function public.mi_plan() from anon;

-- ---------------------------------------------------------------------
-- 6. Las cuentas admin arrancan con Business sin vencimiento (regalo),
--    así nadie que ya usa todo queda bloqueado al correr este archivo.
--    A los demás profesionales el admin les regala el plan desde /admin.
-- ---------------------------------------------------------------------
insert into public.planes (usuario_id, plan, origen, vence_en, nota)
select p.id, 'business', 'regalo', null, 'Cuenta admin'
from public.perfiles p
where p.es_admin
on conflict (usuario_id) do nothing;

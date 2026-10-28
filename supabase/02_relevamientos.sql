-- =====================================================================
--  TaListo!  ·  RELEVAMIENTOS
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01_talisto_fase1.sql). Es re-ejecutable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Turnos: nuevo tipo "relevamiento" y horario flexible
--    flexible = "paso en algún momento entre inicio y fin":
--    no bloquea la agenda, así podés agendar otras cosas en esa franja.
-- ---------------------------------------------------------------------
alter table public.turnos add column if not exists flexible boolean not null default false;

alter table public.turnos drop constraint if exists turnos_tipo_check;
alter table public.turnos add constraint turnos_tipo_check
  check (tipo in ('trabajo','visita','relevamiento'));

alter table public.turnos drop constraint if exists turnos_sin_superposicion;
alter table public.turnos add constraint turnos_sin_superposicion exclude using gist (
  profesional_id with =,
  tstzrange(inicio, fin, '[)') with &&
) where (estado in ('pendiente','confirmado') and not flexible);

-- Los horarios libres para reservar no se ven afectados por las franjas flexibles
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
        and not t.flexible
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

-- ---------------------------------------------------------------------
-- 2. Ficha de relevamiento (lo que pide el cliente y lo que relevás)
-- ---------------------------------------------------------------------
create table if not exists public.relevamientos (
  id               uuid primary key default gen_random_uuid(),
  profesional_id   uuid not null references public.profesionales(id) on delete cascade,
  turno_id         uuid unique references public.turnos(id) on delete set null,
  cliente_id       uuid references public.clientes(id) on delete set null,
  direccion_id     uuid references public.direcciones(id) on delete set null,
  pedido           text,                                   -- qué pide el cliente
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','relevado','presupuestado','descartado')),
  notas            text,                                   -- lo que viste en el lugar
  medidas          text,
  materiales       jsonb not null default '[]'::jsonb,     -- [{ item, cantidad, unidad }]
  horas_estimadas  numeric(6,1) check (horas_estimadas is null or horas_estimadas >= 0),
  costo_estimado   numeric(12,2) check (costo_estimado is null or costo_estimado >= 0),
  fotos            text[] not null default '{}',           -- rutas en Storage (bucket relevamientos)
  relevado_en      timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  check (jsonb_typeof(materiales) = 'array')
);
create index if not exists relevamientos_profesional_idx on public.relevamientos (profesional_id, estado);
create index if not exists relevamientos_cliente_idx on public.relevamientos (cliente_id);

-- El cliente / dirección tienen que ser del profesional (misma regla que turnos)
drop trigger if exists talisto_validar_relevamiento on public.relevamientos;
create trigger talisto_validar_relevamiento
  before insert or update on public.relevamientos
  for each row execute function public.validar_cliente_direccion();

-- El turno también tiene que ser del profesional; fechas automáticas
create or replace function public.preparar_relevamiento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.turno_id is not null
     and (tg_op = 'INSERT' or new.turno_id is distinct from old.turno_id)
     and not exists (select 1 from public.turnos t
                     where t.id = new.turno_id and t.profesional_id = new.profesional_id) then
    raise exception 'El turno no pertenece a este profesional';
  end if;
  new.actualizado_en := now();
  if new.estado = 'relevado' and (tg_op = 'INSERT' or old.estado is distinct from 'relevado') then
    new.relevado_en := coalesce(new.relevado_en, now());
  end if;
  return new;
end $$;

drop trigger if exists talisto_preparar_relevamiento on public.relevamientos;
create trigger talisto_preparar_relevamiento
  before insert or update on public.relevamientos
  for each row execute function public.preparar_relevamiento();

alter table public.relevamientos enable row level security;

drop policy if exists relevamientos_propios on public.relevamientos;
create policy relevamientos_propios on public.relevamientos for all
  using (profesional_id = (select auth.uid()) or public.es_admin())
  with check (profesional_id = (select auth.uid()));

grant select, insert, update, delete on public.relevamientos to authenticated, service_role;
grant execute on function public.preparar_relevamiento() to authenticated, service_role;

-- Dirección propia del relevamiento (puede ser una del cliente o un lugar nuevo).
-- Mientras está pendiente se ve siempre en el mapa.
alter table public.relevamientos add column if not exists direccion  text;
alter table public.relevamientos add column if not exists referencia text;
alter table public.relevamientos add column if not exists lat        double precision;
alter table public.relevamientos add column if not exists lng        double precision;
alter table public.relevamientos drop constraint if exists relevamientos_ubicacion_check;
alter table public.relevamientos add constraint relevamientos_ubicacion_check check ((lat is null) = (lng is null));

-- ---------------------------------------------------------------------
-- 3. Fotos de los relevamientos (Storage privado)
--    Cada profesional solo ve y sube fotos en su propia carpeta: <su id>/...
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('relevamientos', 'relevamientos', false, 10485760,
            array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
    on conflict (id) do nothing;

    execute 'drop policy if exists relevamientos_fotos_leer on storage.objects';
    execute $p$create policy relevamientos_fotos_leer on storage.objects for select to authenticated
      using (bucket_id = 'relevamientos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

    execute 'drop policy if exists relevamientos_fotos_subir on storage.objects';
    execute $p$create policy relevamientos_fotos_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'relevamientos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

    execute 'drop policy if exists relevamientos_fotos_borrar on storage.objects';
    execute $p$create policy relevamientos_fotos_borrar on storage.objects for delete to authenticated
      using (bucket_id = 'relevamientos' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

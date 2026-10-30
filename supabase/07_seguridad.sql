-- =====================================================================
--  TaListo!  ·  REFUERZO DE SEGURIDAD
--  · Nadie puede "mudar" datos de una cuenta o empresa a otra cambiando
--    el dueño de un registro (cliente, turno, ticket, presupuesto…).
--  · Quien no inició sesión solo puede leer lo público (perfiles de
--    profesionales, servicios, horarios, categorías y precios) y ver una
--    invitación con su código.
--  · Las funciones internas (plan de otra cuenta, cupo de una empresa) ya
--    no se pueden llamar desde la app.
--  · Se quitan permisos que la app nunca usa (vaciar tablas, etc.).
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 06). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if to_regclass('public.empresas') is null then
    raise exception 'Primero corré 06_empresas.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. El dueño de un registro no cambia nunca
--    (antes, alguien del equipo podía pasar un cliente de la empresa a su
--     cuenta personal editando el registro a mano)
-- ---------------------------------------------------------------------
create or replace function public.dueno_inmutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon')
     and (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
    raise exception 'No se puede cambiar a quién pertenece este registro';
  end if;
  return new;
end $$;

do $$
declare t record;
begin
  for t in select * from (values
    ('clientes', 'profesional_id'), ('direcciones', 'cliente_id'), ('bloques_fijos', 'profesional_id'),
    ('bloques_excepciones', 'bloque_id'), ('turnos', 'profesional_id'), ('relevamientos', 'profesional_id'),
    ('ordenes', 'profesional_id'), ('presupuestos', 'profesional_id'), ('gastos', 'profesional_id'),
    ('ajustes', 'profesional_id'), ('servicios', 'profesional_id'), ('horarios_trabajo', 'profesional_id'),
    ('roles_empresa', 'empresa_id'), ('exportaciones', 'usuario_id'), ('planes', 'usuario_id')
  ) as v(tabla, columna)
  loop
    if to_regclass('public.' || t.tabla) is not null then
      execute format('drop trigger if exists talisto_dueno_inmutable on public.%I', t.tabla);
      execute format('create trigger talisto_dueno_inmutable before update on public.%I '
                     'for each row execute function public.dueno_inmutable(%L)', t.tabla, t.columna);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Los controles del plan corren como funciones protegidas
--    (así la app ya no puede consultar el plan de otras cuentas)
-- ---------------------------------------------------------------------
create or replace function public.soy_pro()
returns boolean language sql stable security definer set search_path = public as $$
  select public.plan_de(auth.uid()) <> 'free';
$$;

create or replace function public.exigir_pro()
returns trigger language plpgsql security definer set search_path = public as $$
declare dueno uuid;
begin
  if coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    -- el plan que cuenta es el de la cuenta dueña de los datos (en una empresa, la principal)
    dueno := coalesce(public.uuid_o_null(to_jsonb(coalesce(new, old)) ->> 'profesional_id'), auth.uid());
    if public.plan_de(dueno) = 'free' then
      raise exception using errcode = 'TL001', message = tg_argv[0], hint = 'Pasate a Pro desde Perfil > Mi plan.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.limitar_empresas_b2b()
returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; usadas int;
begin
  if coalesce(current_setting('role', true), '') not in ('authenticated', 'anon')
     or public.plan_de(new.profesional_id) <> 'free' then
    return new;
  end if;
  if exists (select 1 from public.ordenes o
             where o.profesional_id = new.profesional_id and o.empresa_id = new.empresa_id and o.id <> new.id) then
    return new;
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

-- Logo: la regla del Storage usa la función protegida
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    execute 'drop policy if exists logos_subir on storage.objects';
    execute $p$create policy logos_subir on storage.objects for insert to authenticated
      with check (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.soy_pro())$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. Funciones: sin sesión, solo lo público
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
-- internas: solo las usan otras funciones protegidas
revoke execute on function public.plan_de(uuid) from authenticated;
revoke execute on function public.cupo_empresa(uuid) from authenticated;
-- lo que usa la parte pública
grant execute on function public.es_admin() to anon;
grant execute on function public.horarios_disponibles(uuid, date, int) to anon;
grant execute on function public.ver_invitacion(text) to anon;
-- funciones nuevas: no quedan abiertas a cualquiera por defecto
alter default privileges in schema public revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------
-- 4. Tablas: sin sesión solo se lee lo público; nadie vacía tablas
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.configuracion, public.profesionales, public.categorias,
                public.servicios, public.horarios_trabajo to anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

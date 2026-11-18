-- =====================================================================
--  TaListo!  ·  MATCH POR WHATSAPP, COTIZACIONES Y NUEVO COBRO
--  · Nuevo cobro: el cliente paga el precio del técnico + la tarifa de
--    TaListo! ($ 500). El técnico recibe el 100 % de su precio y la
--    comisión de Mercado Pago la paga TaListo!. Por defecto: visita
--    $ 1.000 + 500 = $ 1.500; urgencia $ 2.000 + 500 = $ 2.500. Todo se
--    edita en Admin > Match > Configuración (se aplica una sola vez).
--  · Cotizar la visita: al aceptar una solicitud el profesional puede
--    poner su precio; en los pedidos de WhatsApp puede tomarlo a precio
--    base o mandar una cotización (precio y hora) que el cliente acepta.
--  · Pedidos por WhatsApp: el bot hace las preguntas del rubro (se
--    editan en Admin), publica el pedido y el cliente paga recién cuando
--    un técnico lo toma o cuando acepta una cotización.
--  · Cobro del profesional: cuenta bancaria o giro por Abitab.
--  Correr COMPLETO en Supabase > SQL Editor > New query > Run
--  (después de 01 a 22). Es re-ejecutable.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'configuracion'
                  and column_name = 'pro_colaboradores_defecto') then
    raise exception 'Primero corré del 19 al 22';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Configuración
-- ---------------------------------------------------------------------
alter table public.configuracion add column if not exists cobro_v2_aplicado boolean not null default false;
alter table public.configuracion add column if not exists cotizacion_min numeric(12,2) not null default 300;
alter table public.configuracion add column if not exists cotizacion_max numeric(12,2) not null default 30000;
alter table public.configuracion add column if not exists whatsapp_activo boolean not null default true;
alter table public.configuracion add column if not exists whatsapp_numero text;
alter table public.configuracion add column if not exists whatsapp_bienvenida text not null
  default '¡Hola! Soy el asistente de TaListo! 👋 Te ayudo a conseguir un técnico de confianza.';
alter table public.configuracion add column if not exists app_url text not null default 'https://talisto-ashen.vercel.app';
alter table public.configuracion drop constraint if exists configuracion_cotizacion_check;
alter table public.configuracion add constraint configuracion_cotizacion_check check (cotizacion_min > 0 and cotizacion_max >= cotizacion_min);

-- Nuevo cobro (una sola vez: si después el admin cambia los números, no se pisan)
do $$
begin
  if not (select cobro_v2_aplicado from public.configuracion where id = 1) then
    update public.configuracion set
      visita_ret_cliente = 500, visita_ret_profesional = 0, visita_neto_profesional = 1000, precio_visita = 1500, comision_visita = 500,
      urgencia_ret_cliente = 500, urgencia_ret_profesional = 0, urgencia_neto_profesional = 2000, precio_urgencia = 2500,
      mp_costo_profesional_pct = 0, cobro_v2_aplicado = true
     where id = 1;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Columnas nuevas
-- ---------------------------------------------------------------------
-- La cotización del profesional al aceptar una solicitud (lo que recibe él)
alter table public.match_invitaciones add column if not exists precio_profesional numeric(12,2);

-- Pedidos que se pagan cuando un técnico los toma (WhatsApp) y por dónde entraron
alter table public.match_solicitudes add column if not exists pago text not null default 'al_publicar';
alter table public.match_solicitudes add column if not exists canal text not null default 'app';
alter table public.match_solicitudes add column if not exists urgencia_tarifa boolean;
alter table public.match_solicitudes drop constraint if exists match_solicitudes_pago_check;
alter table public.match_solicitudes add constraint match_solicitudes_pago_check check (pago in ('al_publicar', 'al_tomar'));
alter table public.match_solicitudes drop constraint if exists match_solicitudes_canal_check;
alter table public.match_solicitudes add constraint match_solicitudes_canal_check check (canal in ('app', 'whatsapp'));
-- Por WhatsApp la dirección puede venir sin punto en el mapa
alter table public.match_solicitudes drop constraint if exists match_solicitudes_primero_check;
alter table public.match_solicitudes add constraint match_solicitudes_primero_check check (
  modo in ('invitar', 'primero')
  and (cuando is null or cuando in ('hoy', 'dia'))
  and (franja is null or franja in ('manana', 'tarde', 'cualquiera'))
  and (modo = 'invitar' or (cuando is not null and direccion is not null and (lat is not null or canal = 'whatsapp')
                             and (cuando = 'hoy' or (fecha is not null and franja is not null)))));

-- Cobro por Abitab (giro a la cédula del titular)
alter table public.match_datos_cobro add column if not exists metodo text not null default 'banco';
alter table public.match_datos_cobro alter column banco drop not null;
alter table public.match_datos_cobro alter column numero drop not null;
alter table public.match_datos_cobro drop constraint if exists match_datos_cobro_metodo_check;
alter table public.match_datos_cobro add constraint match_datos_cobro_metodo_check check (
  (metodo = 'banco' and banco is not null and numero is not null)
  or (metodo = 'abitab' and documento is not null and length(regexp_replace(documento, '\D', '', 'g')) between 6 and 9));

-- ---------------------------------------------------------------------
-- 3. Cotizaciones de los pedidos de WhatsApp
-- ---------------------------------------------------------------------
create table if not exists public.match_cotizaciones (
  id                  uuid primary key default gen_random_uuid(),
  numero              int generated always as identity,
  solicitud_id        uuid not null references public.match_solicitudes(id) on delete cascade,
  profesional_id      uuid not null references public.profesionales(id) on delete cascade,
  precio_profesional  numeric(12,2) not null check (precio_profesional > 0),   -- lo que recibe el técnico
  importe             numeric(12,2) not null check (importe >= precio_profesional), -- lo que paga el cliente
  inicio              timestamptz not null,
  mensaje             text check (mensaje is null or length(mensaje) <= 300),
  urgencia            boolean not null default false,
  estado              text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada', 'vencida')),
  creado_por          uuid,
  creado_en           timestamptz not null default now(),
  respondida_en       timestamptz,
  unique (solicitud_id, profesional_id)
);
alter table public.match_cotizaciones enable row level security;
drop policy if exists match_cotizaciones_ver on public.match_cotizaciones;
create policy match_cotizaciones_ver on public.match_cotizaciones for select to authenticated using (
  public._es_match(profesional_id) or public.es_admin()
  or exists (select 1 from public.match_solicitudes s where s.id = solicitud_id and s.cliente_id = auth.uid()));

-- ---------------------------------------------------------------------
-- 4. WhatsApp: preguntas del bot, conversaciones, mensajes y avisos a mandar
-- ---------------------------------------------------------------------
create table if not exists public.bot_rubros (
  categoria_id    smallint primary key references public.categorias(id) on delete cascade,
  activo          boolean not null default true,
  palabras        text[] not null default '{}',     -- para reconocer el rubro en lo que escribe la persona
  preguntas       jsonb not null default '[]'::jsonb check (jsonb_typeof(preguntas) = 'array'),
                  -- [{ "texto": "¿Qué pasa?", "opciones": ["No prende", "..."], "libre": false }]
  pide_fotos      boolean not null default true,
  actualizado_en  timestamptz not null default now()
);
alter table public.bot_rubros enable row level security;
drop policy if exists bot_rubros_admin on public.bot_rubros;
create policy bot_rubros_admin on public.bot_rubros for all to authenticated using (public.es_admin()) with check (public.es_admin());

create table if not exists public.wa_conversaciones (
  id               uuid primary key default gen_random_uuid(),
  telefono         text not null unique check (telefono ~ '^[0-9]{8,15}$'),
  usuario_id       uuid references public.perfiles(id) on delete set null,
  nombre           text check (nombre is null or length(nombre) <= 120),
  paso             text not null default 'inicio' check (length(paso) <= 40),
  datos            jsonb not null default '{}'::jsonb,
  solicitud_id     uuid references public.match_solicitudes(id) on delete set null,
  ultimo_entrante  timestamptz,
  humano           boolean not null default false,      -- un admin atiende la charla: el bot no contesta
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);
create index if not exists wa_conversaciones_usuario_idx on public.wa_conversaciones (usuario_id);

create table if not exists public.wa_mensajes (
  id               bigint generated always as identity primary key,
  conversacion_id  uuid not null references public.wa_conversaciones(id) on delete cascade,
  direccion        text not null check (direccion in ('entrante', 'saliente')),
  wa_id            text unique,
  tipo             text not null default 'texto' check (length(tipo) <= 20),
  texto            text check (texto is null or length(texto) <= 4096),
  datos            jsonb not null default '{}'::jsonb,
  error            text,
  creado_en        timestamptz not null default now()
);
create index if not exists wa_mensajes_conv_idx on public.wa_mensajes (conversacion_id, creado_en desc);

create table if not exists public.wa_salida (
  id               bigint generated always as identity primary key,
  usuario_id       uuid not null references public.perfiles(id) on delete cascade,
  texto            text not null check (length(texto) <= 1500),
  operacion_pago   uuid references public.match_operaciones(id) on delete set null,   -- manda el link de pago
  creado_en        timestamptz not null default now(),
  enviado_en       timestamptz,
  intentos         int not null default 0,
  error            text
);
create index if not exists wa_salida_pendientes_idx on public.wa_salida (creado_en) where enviado_en is null;

alter table public.wa_conversaciones enable row level security;
alter table public.wa_mensajes enable row level security;
alter table public.wa_salida enable row level security;
drop policy if exists wa_conversaciones_admin on public.wa_conversaciones;
create policy wa_conversaciones_admin on public.wa_conversaciones for select to authenticated using (public.es_admin());
drop policy if exists wa_conversaciones_admin_editar on public.wa_conversaciones;
create policy wa_conversaciones_admin_editar on public.wa_conversaciones for update to authenticated using (public.es_admin()) with check (public.es_admin());
drop policy if exists wa_mensajes_admin on public.wa_mensajes;
create policy wa_mensajes_admin on public.wa_mensajes for select to authenticated using (public.es_admin());

-- Preguntas de ejemplo (el admin las cambia). Rubros sin preguntas: el bot pide que cuenten qué pasa.
insert into public.bot_rubros (categoria_id, palabras, preguntas)
select k.id, x.palabras, x.preguntas
from (values
  ('aire-acondicionado', array['aire', 'acondicionado', 'split', 'climatiz', 'no enfria', 'no enfría'],
   '[{"texto": "¿Cuál es el problema?", "opciones": ["No prende", "Prende pero no enfría", "El control se saltea el modo frío", "El control está en frío pero no enfría", "Instalar o mover un equipo", "Otro"]},
     {"texto": "¿Qué tipo de equipo es?", "opciones": ["Split de pared", "Ventana", "Central o conductos", "No sé"]}]'::jsonb),
  ('electricidad', array['luz', 'electric', 'enchufe', 'llave', 'tablero', 'corto', 'cable'],
   '[{"texto": "¿Qué pasa?", "opciones": ["No hay luz en toda la casa", "Salta la llave o el diferencial", "Un enchufe o una luz no anda", "Instalar algo nuevo", "Otro"]}]'::jsonb),
  ('sanitaria', array['agua', 'caño', 'cano', 'pérdida', 'perdida', 'canilla', 'inodoro', 'calefón', 'calefon', 'desagüe', 'sanitari'],
   '[{"texto": "¿Qué pasa?", "opciones": ["Pérdida de agua", "Algo tapado", "Calefón o termotanque", "Canilla o inodoro", "Instalar algo nuevo", "Otro"]}]'::jsonb),
  ('cerrajeria', array['cerradura', 'llave', 'cerraj', 'puerta trabada', 'me quedé afuera'],
   '[{"texto": "¿Qué necesitás?", "opciones": ["Abrir una puerta (me quedé afuera)", "Cambiar o arreglar una cerradura", "Copiar llaves", "Otro"]}]'::jsonb),
  ('refrigeracion', array['heladera', 'freezer', 'refriger', 'cámara de frío'],
   '[{"texto": "¿Qué pasa?", "opciones": ["No enfría", "Hace ruido", "Pierde agua", "No prende", "Otro"]}]'::jsonb),
  ('electrodomesticos', array['lavarropas', 'secarropas', 'horno', 'microondas', 'lavavajillas', 'electrodom'],
   '[{"texto": "¿Qué equipo es?", "opciones": ["Lavarropas", "Secarropas", "Horno o cocina", "Lavavajillas", "Otro"]}]'::jsonb)
) as x(slug, palabras, preguntas)
join public.categorias k on k.slug = x.slug
on conflict (categoria_id) do nothing;

-- ---------------------------------------------------------------------
-- 5. Ayudas
-- ---------------------------------------------------------------------
-- ¿El cliente usa TaListo! por WhatsApp?
create or replace function public._es_whatsapp(p_usuario uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.wa_conversaciones where usuario_id = p_usuario);
$$;

-- Deja un mensaje para mandarle por WhatsApp (solo si usa WhatsApp)
create or replace function public._wa_avisar(p_usuario uuid, p_texto text, p_op uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_usuario is null or not public._es_whatsapp(p_usuario) then return; end if;
  insert into public.wa_salida (usuario_id, texto, operacion_pago) values (p_usuario, left(p_texto, 1500), p_op);
end $$;

-- Los avisos de Match de un cliente de WhatsApp también le llegan por WhatsApp
-- (salvo los que la función ya le mandó con su propio texto)
create or replace function public._wa_desde_aviso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tipo = 'match' and coalesce(current_setting('talisto.wa_silencio', true), '') <> '1' and public._es_whatsapp(new.usuario_id) then
    insert into public.wa_salida (usuario_id, texto) values (new.usuario_id, left(new.titulo || coalesce(E'\n' || new.cuerpo, ''), 1500));
  end if;
  return null;
end $$;
drop trigger if exists notificaciones_a_whatsapp on public.notificaciones;
create trigger notificaciones_a_whatsapp after insert on public.notificaciones
  for each row execute function public._wa_desde_aviso();

-- Hay mensajes para mandar: se avisa a la app (si la base tiene pg_net; si no, salen con el próximo mensaje o la tarea diaria)
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net no está disponible: los avisos salen con el próximo mensaje'; end $$;
create or replace function public._wa_despertar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    perform net.http_post(url := (select app_url from public.configuracion where id = 1) || '/api/whatsapp/avisar',
                          body := '{}'::jsonb, headers := '{"Content-Type": "application/json"}'::jsonb);
  exception when others then null;
  end;
  return null;
end $$;
drop trigger if exists wa_salida_despertar on public.wa_salida;
create trigger wa_salida_despertar after insert on public.wa_salida for each statement execute function public._wa_despertar();

-- Tarifa de TaListo! y precio base del técnico según si es urgencia
create or replace function public._tarifa(p_urgencia boolean)
returns table (importe numeric, ret_cliente numeric, ret_profesional numeric, neto numeric)
language sql stable security definer set search_path = public as $$
  select case when p_urgencia then c.precio_urgencia else c.precio_visita end,
         case when p_urgencia then c.urgencia_ret_cliente else c.visita_ret_cliente end,
         case when p_urgencia then c.urgencia_ret_profesional else c.visita_ret_profesional end,
         case when p_urgencia then c.urgencia_neto_profesional else c.visita_neto_profesional end
    from public.configuracion c where c.id = 1;
$$;

-- Hace la llamada como si fuera el cliente (solo lo usan las funciones del servidor de WhatsApp)
create or replace function public._como(p_usuario uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('request.jwt.claim.sub', p_usuario::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_usuario, 'role', 'authenticated')::text, true);
  perform set_config('talisto.canal', 'whatsapp', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. Solicitudes: crear (por WhatsApp se paga al tomar) y publicar
-- ---------------------------------------------------------------------
create or replace function public.crear_solicitud(p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  u uuid := auth.uid(); c public.configuracion := public._cfg(); s public.match_solicitudes; n int := 0; r record;
  v_arch text[]; v_dir uuid := public.uuid_o_null(p ->> 'dirigida_a');
  v_modo text := coalesce(nullif(p ->> 'modo', ''), 'invitar'); v_cuando text; v_fecha date; v_franja text; v_op uuid; v_hoy date := public._hoy_uy();
  v_wa boolean := coalesce(current_setting('talisto.canal', true), '') = 'whatsapp';
  v_pago text := case when coalesce(current_setting('talisto.canal', true), '') = 'whatsapp' then 'al_tomar' else 'al_publicar' end;
begin
  if u is null then raise exception 'Tenés que iniciar sesión'; end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and estado = 'abierta') >= 5 then
    raise exception 'Ya tenés 5 solicitudes abiertas: esperá respuestas o cancelá alguna';
  end if;
  if (select count(*) from public.match_solicitudes where cliente_id = u and creado_en > now() - interval '1 day') >= 15 then
    raise exception 'Llegaste al máximo de solicitudes por día';
  end if;
  if not exists (select 1 from public.categorias where id = (p ->> 'categoria_id')::smallint and activa) then
    raise exception 'Elegí el rubro';
  end if;
  if coalesce(p ->> 'departamento', '') not in ('Artigas','Canelones','Cerro Largo','Colonia','Durazno','Flores','Florida','Lavalleja',
       'Maldonado','Montevideo','Paysandú','Río Negro','Rivera','Rocha','Salto','San José','Soriano','Tacuarembó','Treinta y Tres') then
    raise exception 'Elegí el departamento';
  end if;
  select coalesce(array_agg(x), '{}') into v_arch from jsonb_array_elements_text(coalesce(p -> 'archivos', '[]')) x;
  if exists (select 1 from unnest(v_arch) a where split_part(a, '/', 1) <> u::text) then
    raise exception 'Archivo no válido';
  end if;
  if v_dir is not null and not exists (select 1 from public.match_perfiles where profesional_id = v_dir and disponible) then
    raise exception 'Ese profesional no está recibiendo solicitudes ahora';
  end if;
  if v_wa then v_modo := 'primero'; end if;
  if v_modo not in ('invitar', 'primero') then raise exception 'Modo no válido'; end if;
  if v_modo = 'primero' then
    if not c.primero_activo then raise exception 'La opción "el primero disponible" no está activa por ahora'; end if;
    if v_dir is not null then raise exception 'Elegiste un profesional: no puede ser "el primero disponible"'; end if;
    if coalesce(trim(p ->> 'direccion'), '') = '' or (not v_wa and ((p ->> 'lat') is null or (p ->> 'lng') is null)) then
      raise exception 'Poné la dirección y marcala en el mapa: así los técnicos ven la zona';
    end if;
    v_cuando := coalesce(nullif(p ->> 'cuando', ''), 'hoy');
    if v_cuando = 'hoy' then
      if (now() at time zone 'America/Montevideo')::time >= time '19:00' then
        raise exception 'Para hoy ya es tarde: elegí otro día';
      end if;
    elsif v_cuando = 'dia' then
      v_fecha := (p ->> 'fecha')::date;
      v_franja := coalesce(nullif(p ->> 'franja', ''), 'cualquiera');
      if v_fecha is null or v_fecha < v_hoy or v_fecha > v_hoy + 30 then raise exception 'Elegí un día de los próximos 30'; end if;
      if v_franja not in ('manana', 'tarde', 'cualquiera') then raise exception 'Elegí la franja'; end if;
      if upper(public._ventana_primero('dia', v_fecha, v_franja, now())) < now() + interval '1 hour' then
        raise exception 'Esa franja ya pasó: elegí otra';
      end if;
    else
      raise exception 'Elegí para cuándo';
    end if;
    if not exists (select 1 from public.match_perfiles m where (p ->> 'categoria_id')::smallint = any (m.rubros) and m.disponible
                    and public._elegible_primero(m.profesional_id, (p ->> 'categoria_id')::smallint)) then
      raise exception 'Por ahora no hay técnicos de ese rubro tomando servicios: publicala para recibir propuestas';
    end if;
  end if;
  insert into public.match_solicitudes (cliente_id, categoria_id, titulo, descripcion, departamento, localidad, direccion, referencia,
                                        lat, lng, preferencia, urgente, archivos, dirigida_a, vence_en, modo, cuando, fecha, franja, pago, canal)
  values (u, (p ->> 'categoria_id')::smallint, trim(p ->> 'titulo'), trim(p ->> 'descripcion'), p ->> 'departamento',
          nullif(trim(coalesce(p ->> 'localidad', '')), ''), nullif(trim(coalesce(p ->> 'direccion', '')), ''),
          nullif(trim(coalesce(p ->> 'referencia', '')), ''), (p ->> 'lat')::double precision, (p ->> 'lng')::double precision,
          coalesce(nullif(p ->> 'preferencia', ''), 'cualquiera'), coalesce((p ->> 'urgente')::boolean, false), v_arch, v_dir,
          case when v_modo = 'primero' then now() + interval '1 day' else now() + make_interval(days => c.solicitud_dias) end,
          v_modo, v_cuando, v_fecha, v_franja, case when v_modo = 'primero' then v_pago else 'al_publicar' end,
          case when v_wa then 'whatsapp' else 'app' end)
  returning * into s;
  if v_modo = 'primero' then
    if s.pago = 'al_tomar' then
      perform public._publicar_al_tomar(s.id);
    else
      v_op := public._op_primero(s.id);
    end if;
    perform public._evento(u, 'publico_solicitud', 'match');
    if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
    return json_build_object('id', s.id, 'numero', s.numero, 'invitados', 0, 'operacion', v_op, 'pago', s.pago);
  end if;
  for r in select profesional_id from public._invitables(s.id) loop
    insert into public.match_invitaciones (solicitud_id, profesional_id, precio_visita) values (s.id, r.profesional_id, c.precio_visita);
    n := n + 1;
    perform public._aviso_pro(r.profesional_id, 'match',
      format('Nueva solicitud: %s', public._rubro(s.categoria_id)),
      format('%s · %s%s. Respondé si podés hacer la visita o mandá tu precio.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento),
      '/panel/match?invitacion=' || (select id from public.match_invitaciones where solicitud_id = s.id and profesional_id = r.profesional_id));
  end loop;
  if n = 0 then
    update public.match_solicitudes set sin_profesionales = true where id = s.id;
    perform public._avisar(public._admins(), null, 'match', 'Solicitud sin profesionales',
      format('%s en %s: no hay profesionales disponibles para ese rubro y zona.', public._rubro(s.categoria_id), s.departamento),
      '/admin/match', '{}'::jsonb);
  end if;
  perform public._evento(u, 'publico_solicitud', 'match');
  if cardinality(v_arch) > 0 then perform public._evento(u, 'adjunto_fotos', 'match'); end if;
  return json_build_object('id', s.id, 'numero', s.numero, 'invitados', n);
end $$;

-- Pedido de WhatsApp: sale al mapa sin pagar; la tarifa (normal o urgencia) se fija ahora
create or replace function public._publicar_al_tomar(p_sol uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); lim timestamptz; v_urg boolean; v_normal tstzrange;
  r record; n int := 0; t record;
begin
  select * into s from public.match_solicitudes where id = p_sol for update;
  v_urg := public._urgencia_primero(s.urgente, s.cuando, s.fecha, s.franja);
  select * into t from public._tarifa(v_urg);
  lim := case when s.cuando = 'hoy'
              then least(now() + make_interval(hours => c.primero_horas),
                         ((now() at time zone 'America/Montevideo')::date + time '20:00') at time zone 'America/Montevideo')
              else upper(public._ventana_primero('dia', s.fecha, s.franja, now())) - interval '1 hour' end;
  v_normal := public._ventana_toma(s, false, null);
  if not v_urg and v_normal is not null then
    lim := least(lim, upper(v_normal) - make_interval(mins => c.duracion_visita_min));
  end if;
  update public.match_solicitudes set publicada_en = now(), limite_toma = lim, vence_en = greatest(vence_en, lim), urgencia_tarifa = v_urg,
         actualizado_en = now() where id = s.id returning * into s;
  for r in select m.profesional_id from public.match_perfiles m join public.profesionales p on p.id = m.profesional_id
            where m.disponible and s.categoria_id = any (m.rubros) and s.departamento = any (p.departamentos)
              and m.profesional_id <> s.cliente_id and public._elegible_primero(m.profesional_id, s.categoria_id)
              and (v_normal is not null or (v_urg and public._atiende_urgencias(m.profesional_id)))
            limit 200 loop
    perform public._aviso_pro(r.profesional_id, 'match',
      format('%s para tomar o cotizar: %s', case when v_urg then 'Urgencia' else 'Servicio' end, public._rubro(s.categoria_id)),
      format('%s · %s%s · %s. Tomalo a %s o mandá tu cotización.', s.titulo, coalesce(s.localidad || ', ', ''), s.departamento,
             public._cuando_texto(s), public._pesos(t.neto)),
      '/panel/mapa?ver=servicios');
    n := n + 1;
  end loop;
  if n = 0 then
    update public.match_solicitudes set sin_profesionales = true where id = s.id;
    perform public._avisar(public._admins(), null, 'match', 'Pedido de WhatsApp sin técnicos',
      format('%s en %s: no hay técnicos para avisar.', public._rubro(s.categoria_id), s.departamento), '/admin/match', '{}'::jsonb);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 7. Lo que ve el técnico: pedidos pagos y pedidos para tomar o cotizar
-- ---------------------------------------------------------------------
create or replace function public.servicios_disponibles(p_cuenta uuid)
returns json language plpgsql security definer set search_path = public as $$
declare plan_ok boolean; m public.match_perfiles; c public.configuracion := public._cfg();
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para tomar servicios en esta cuenta'; end if;
  perform public.match_procesar_vencidos();
  plan_ok := public.plan_de(p_cuenta) in ('pro', 'business');
  select * into m from public.match_perfiles where profesional_id = p_cuenta;
  return json_build_object(
    'plan_ok', plan_ok,
    'disponible', coalesce(m.disponible, false),
    'rubros', coalesce(cardinality(m.rubros), 0),
    'cobro_ok', exists (select 1 from public.match_datos_cobro where profesional_id = p_cuenta),
    'urgencias', public._atiende_urgencias(p_cuenta),
    'duracion_visita_min', c.duracion_visita_min,
    'cotizacion_min', c.cotizacion_min, 'cotizacion_max', c.cotizacion_max,
    'tarifa_talisto', c.visita_ret_cliente, 'tarifa_talisto_urgencia', c.urgencia_ret_cliente,
    'servicios', case when plan_ok then (
      select coalesce(json_agg(x order by x.limite_toma), '[]') from (
        select s.id, s.numero, public._rubro(s.categoria_id) as rubro, s.titulo, s.descripcion, s.archivos, s.departamento, s.localidad,
               s.cuando, s.fecha, s.franja, s.limite_toma, s.publicada_en, s.urgente, s.pago, s.canal,
               coalesce(o.urgencia, s.urgencia_tarifa, false) as urgencia,
               round(s.lat::numeric, 2) as lat, round(s.lng::numeric, 2) as lng,
               coalesce(o.neto_profesional, t.neto) as neto, coalesce(o.importe, t.importe) as importe,
               lower(w.v) as desde, upper(w.v) as hasta, s.pago = 'al_tomar' as cotizable,
               (select json_build_object('id', k.id, 'precio', k.precio_profesional, 'importe', k.importe, 'inicio', k.inicio, 'estado', k.estado)
                  from public.match_cotizaciones k where k.solicitud_id = s.id and k.profesional_id = p_cuenta) as mi_cotizacion
          from public.match_solicitudes s
          left join public.match_operaciones o on o.solicitud_id = s.id and o.tipo = 'visita' and o.estado = 'buscando_tecnico'
          cross join lateral public._tarifa(coalesce(o.urgencia, s.urgencia_tarifa, false)) t
          cross join lateral (select public._ventana_toma(s, coalesce(o.urgencia, s.urgencia_tarifa, false), p_cuenta) as v) w
         where s.modo = 'primero' and s.estado = 'abierta' and s.profesional_id is null and s.publicada_en is not null
           and (o.id is not null or s.pago = 'al_tomar')
           and s.limite_toma > now() and s.cliente_id <> p_cuenta and s.cliente_id is distinct from auth.uid()
           and w.v is not null
           and public._elegible_primero(p_cuenta, s.categoria_id)
         limit 200) x) else '[]'::json end);
end $$;

-- El técnico toma el pedido. Si ya está pago, queda confirmado; si es de WhatsApp, el cliente recibe el link para pagar.
create or replace function public.tomar_servicio(p_solicitud uuid, p_cuenta uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  s public.match_solicitudes; op public.match_operaciones; c public.configuracion := public._cfg(); w tstzrange; t uuid;
  cli uuid; dir uuid; v_asig uuid; v_urg boolean; tf record;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para tomar servicios en esta cuenta'; end if;
  perform public.match_procesar_vencidos();
  select * into s from public.match_solicitudes where id = p_solicitud for update;
  if s.id is null or s.modo <> 'primero' then raise exception 'No encontramos el servicio'; end if;
  if s.profesional_id is not null or s.estado <> 'abierta' then raise exception 'Otro técnico ya tomó este servicio'; end if;
  if s.pago = 'al_tomar' then
    if s.publicada_en is null or s.limite_toma < now() or exists (
         select 1 from public.match_operaciones x where x.solicitud_id = s.id and x.tipo = 'visita' and x.estado not in ('cancelado', 'reembolsado')) then
      raise exception 'Este servicio ya no está disponible';
    end if;
    v_urg := coalesce(s.urgencia_tarifa, false);
  else
    select * into op from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado = 'buscando_tecnico' for update;
    if op.id is null or s.limite_toma < now() then raise exception 'Este servicio ya no está disponible'; end if;
    v_urg := op.urgencia;
  end if;
  if s.cliente_id = p_cuenta or s.cliente_id = auth.uid() then raise exception 'No podés tomar tu propio pedido'; end if;
  if not public._elegible_primero(p_cuenta, s.categoria_id) then
    raise exception 'Para tomar servicios necesitás plan Pro o Business, Match activo con este rubro y la cuenta bancaria cargada';
  end if;
  w := public._ventana_toma(s, v_urg, p_cuenta);
  if w is null then
    raise exception 'Este pedido es fuera de horario: lo toman los que atienden urgencias (activalo en tu perfil Match)';
  end if;
  if p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)%', public._cuando_texto(s),
      case when v_urg and public._atiende_urgencias(p_cuenta) then '' else ', en horario normal' end;
  end if;
  select * into tf from public._tarifa(v_urg);
  v_asig := case when auth.uid() is distinct from p_cuenta then auth.uid() end;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas, asignado_a)
    values (p_cuenta, left(case when v_urg then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            p_inicio, p_inicio + make_interval(mins => c.duracion_visita_min), 'visita',
            case when s.pago = 'al_tomar' then 'pendiente' else 'confirmado' end, 'reserva', coalesce(op.importe, tf.importe),
            left(format('Pedido Nº %s (el primero disponible): %s', s.numero, s.titulo), 500), v_asig)
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ya tenés algo agendado a esa hora: elegí otra';
  end;

  -- Pedido de WhatsApp: se reserva y el cliente paga (si no paga a tiempo, vuelve al mapa)
  if s.pago = 'al_tomar' then
    insert into public.match_operaciones (tipo, solicitud_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                          ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
    values ('visita', s.id, t, s.cliente_id, p_cuenta, s.categoria_id, tf.importe, tf.ret_cliente, tf.ret_profesional, tf.neto,
            c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), v_urg)
    returning * into op;
    update public.match_solicitudes set profesional_id = p_cuenta, tomada_en = now(), tomada_por = auth.uid(), actualizado_en = now()
     where id = s.id;
    update public.match_cotizaciones set estado = 'vencida' where solicitud_id = s.id and estado = 'pendiente';
    perform public._wa_avisar(s.cliente_id,
      format(E'¡Un técnico tomó tu pedido! 🙌\n%s te visita el %s a las %s.\nPara confirmarlo, pagá %s con Mercado Pago (tenés %s minutos):',
             public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
             to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'), public._pesos(tf.importe), c.pago_minutos), op.id);
    perform public._aviso_pro(p_cuenta, 'match', 'Lo tomaste: falta el pago del cliente',
      format('%s · %s. Te confirmamos cuando el cliente pague (tiene %s minutos).', s.titulo,
             to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI'), c.pago_minutos), '/panel/match?ver=visitas');
    perform public._evento(auth.uid(), 'acepto_solicitud', 'match', p_cuenta);
    return json_build_object('operacion', op.id, 'turno', t, 'inicio', p_inicio, 'pago_pendiente', true, 'vence', op.vence_pago_en);
  end if;

  -- el cliente queda en la lista de clientes del técnico, con la dirección
  begin
    select id into cli from public.clientes where profesional_id = p_cuenta and usuario_id = s.cliente_id limit 1;
    if cli is null then
      insert into public.clientes (profesional_id, nombre, telefono, email, usuario_id, notas)
      select p_cuenta, coalesce(nullif(pe.nombre, ''), split_part(pe.email, '@', 1), pe.telefono, 'Cliente'), pe.telefono, pe.email, pe.id, 'Cliente de TaListo! Match'
        from public.perfiles pe where pe.id = s.cliente_id returning id into cli;
    end if;
    insert into public.direcciones (cliente_id, etiqueta, direccion, referencia, lat, lng)
    values (cli, 'TaListo! Match', concat_ws(', ', s.direccion, s.localidad, s.departamento), s.referencia, s.lat, s.lng)
    returning id into dir;
    update public.turnos set cliente_id = cli, direccion_id = dir where id = t;
  exception when others then
    raise warning 'Match: no se pudo agregar el cliente a la agenda: %', sqlerrm;
  end;
  update public.match_operaciones set profesional_id = p_cuenta, turno_id = t, estado = 'reserva_confirmada', actualizado_en = now()
   where id = op.id;
  update public.match_solicitudes set estado = 'reservada', profesional_id = p_cuenta, modalidad = 'visita', tomada_en = now(),
         tomada_por = auth.uid(), sin_profesionales = false, actualizado_en = now()
   where id = s.id;
  perform public._aviso_cliente(s.cliente_id, 'match', 'Un técnico tomó tu pedido',
    format('%s te visita el %s a las %s.', public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
           to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI')),
    '/match/solicitud/' || s.id);
  perform public._aviso_pro(p_cuenta, 'match', 'Servicio tomado',
    format('%s · %s. Ya está en la agenda.', s.titulo, to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI')),
    '/panel/match?ver=visitas');
  perform public._evento(auth.uid(), 'acepto_solicitud', 'match', p_cuenta);
  perform public._evento(p_cuenta, 'recibio_contratacion', 'match', p_cuenta);
  return json_build_object('operacion', op.id, 'turno', t, 'inicio', p_inicio);
end $$;

-- El técnico manda su cotización (lo que cobra él y a qué hora llega) para un pedido de WhatsApp
create or replace function public.cotizar_servicio(p_solicitud uuid, p_cuenta uuid, p_precio numeric, p_inicio timestamptz, p_mensaje text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s public.match_solicitudes; c public.configuracion := public._cfg(); w tstzrange; v_urg boolean; v_fee numeric; k public.match_cotizaciones;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para cotizar en esta cuenta'; end if;
  select * into s from public.match_solicitudes where id = p_solicitud;
  if s.id is null or s.pago <> 'al_tomar' then raise exception 'Este pedido no recibe cotizaciones'; end if;
  if s.profesional_id is not null or s.estado <> 'abierta' or s.limite_toma < now() then raise exception 'Este pedido ya no está disponible'; end if;
  if s.cliente_id = p_cuenta or s.cliente_id = auth.uid() then raise exception 'No podés cotizar tu propio pedido'; end if;
  if not public._elegible_primero(p_cuenta, s.categoria_id) then
    raise exception 'Para cotizar necesitás plan Pro o Business, Match activo con este rubro y la cuenta para cobrar cargada';
  end if;
  p_precio := round(coalesce(p_precio, 0));
  if p_precio < c.cotizacion_min or p_precio > c.cotizacion_max then
    raise exception 'La cotización tiene que estar entre % y %', public._pesos(c.cotizacion_min), public._pesos(c.cotizacion_max);
  end if;
  w := public._ventana_toma(s, coalesce(s.urgencia_tarifa, false), p_cuenta);
  if w is null or p_inicio is null or p_inicio < lower(w) or p_inicio + make_interval(mins => c.duracion_visita_min) > upper(w) then
    raise exception 'Elegí una hora de llegada dentro de lo que pidió el cliente (%)', public._cuando_texto(s);
  end if;
  v_urg := coalesce(s.urgencia_tarifa, false) or not public._es_horario_normal(p_inicio);
  v_fee := case when v_urg then c.urgencia_ret_cliente else c.visita_ret_cliente end;
  insert into public.match_cotizaciones (solicitud_id, profesional_id, precio_profesional, importe, inicio, mensaje, urgencia, creado_por)
  values (s.id, p_cuenta, p_precio, p_precio + v_fee, p_inicio, nullif(left(trim(coalesce(p_mensaje, '')), 300), ''), v_urg, auth.uid())
  on conflict (solicitud_id, profesional_id) do update set precio_profesional = excluded.precio_profesional, importe = excluded.importe,
    inicio = excluded.inicio, mensaje = excluded.mensaje, urgencia = excluded.urgencia, estado = 'pendiente', creado_por = excluded.creado_por,
    creado_en = now(), respondida_en = null
  returning * into k;
  perform public._wa_avisar(s.cliente_id,
    format(E'💬 Cotización para tu pedido Nº %s\n%s puede ir el %s a las %s. La visita sale %s (incluye TaListo!).%s\nRespondé *COTIZACIONES* para verlas y elegir.',
           s.numero, public._nombre_de(p_cuenta), to_char(p_inicio at time zone 'America/Montevideo', 'DD/MM'),
           to_char(p_inicio at time zone 'America/Montevideo', 'HH24:MI'), public._pesos(k.importe),
           coalesce(E'\n«' || k.mensaje || '»', '')));
  perform public._evento(auth.uid(), 'envio_cotizacion', 'match', p_cuenta);
  return json_build_object('cotizacion', k.id, 'importe', k.importe);
end $$;

-- El cliente acepta una cotización: se reserva la hora del técnico y queda para pagar
create or replace function public.aceptar_cotizacion(p_cotizacion uuid)
returns json language plpgsql security definer set search_path = public as $$
declare k public.match_cotizaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); t uuid; op public.match_operaciones;
begin
  perform public.match_procesar_vencidos();
  select * into k from public.match_cotizaciones where id = p_cotizacion for update;
  if k.id is null then raise exception 'No encontramos la cotización'; end if;
  select * into s from public.match_solicitudes where id = k.solicitud_id for update;
  if s.cliente_id is distinct from auth.uid() then raise exception 'No encontramos la cotización'; end if;
  if k.estado <> 'pendiente' then raise exception 'Esa cotización ya no está disponible'; end if;
  if s.estado <> 'abierta' or s.profesional_id is not null then raise exception 'Tu pedido ya tiene técnico'; end if;
  if k.inicio < now() + interval '15 minutes' then
    update public.match_cotizaciones set estado = 'vencida' where id = k.id;
    raise exception 'La hora que propuso ese técnico ya pasó: elegí otra cotización';
  end if;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas)
    values (k.profesional_id, left(case when k.urgencia then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            k.inicio, k.inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'pendiente', 'reserva', k.importe,
            left(format('Pedido Nº %s (cotización aceptada): %s', s.numero, s.titulo), 500))
    returning id into t;
  exception when exclusion_violation then
    update public.match_cotizaciones set estado = 'vencida' where id = k.id;
    raise exception 'Ese técnico ya no tiene libre esa hora: elegí otra cotización';
  end;
  insert into public.match_operaciones (tipo, solicitud_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                        ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
  values ('visita', s.id, t, s.cliente_id, k.profesional_id, s.categoria_id, k.importe, k.importe - k.precio_profesional, 0,
          k.precio_profesional, c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), k.urgencia)
  returning * into op;
  update public.match_cotizaciones set estado = 'aceptada', respondida_en = now() where id = k.id;
  update public.match_solicitudes set profesional_id = k.profesional_id, tomada_en = now(), actualizado_en = now() where id = s.id;
  perform public._aviso_pro(k.profesional_id, 'match', 'Aceptaron tu cotización',
    format('%s · %s por %s. Te confirmamos cuando el cliente pague.', s.titulo,
           to_char(k.inicio at time zone 'America/Montevideo', 'DD/MM HH24:MI'), public._pesos(k.precio_profesional)), '/panel/match?ver=visitas');
  perform public._wa_avisar(s.cliente_id,
    format(E'Perfecto 👍 Reservamos a %s el %s a las %s.\nPagá %s con Mercado Pago para confirmar (tenés %s minutos):',
           public._nombre_de(k.profesional_id), to_char(k.inicio at time zone 'America/Montevideo', 'DD/MM'),
           to_char(k.inicio at time zone 'America/Montevideo', 'HH24:MI'), public._pesos(k.importe), c.pago_minutos), op.id);
  return json_build_object('operacion', op.id, 'importe', op.importe, 'vence', op.vence_pago_en);
end $$;

-- ---------------------------------------------------------------------
-- 8. Vencimientos: pedidos de WhatsApp sin pagar vuelven al mapa; sin técnico, se vencen
-- ---------------------------------------------------------------------
create or replace function public._vencer_primero()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select o.id, o.numero, o.importe, o.reintegrado, o.mp_pago_id, o.cliente_id, o.solicitud_id
             from public.match_operaciones o join public.match_solicitudes s on s.id = o.solicitud_id
            where o.estado = 'buscando_tecnico' and s.limite_toma < now()
            for update of o skip locked loop
    update public.match_operaciones set estado = 'cancelado', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'Ningún técnico lo tomó a tiempo', actualizado_en = now() where id = r.id;
    insert into public.match_devoluciones (operacion_id, mp_pago_id, monto, motivo, origen)
    values (r.id, r.mp_pago_id, r.importe - r.reintegrado, 'Ningún técnico lo tomó a tiempo', 'sin_tecnico')
    on conflict do nothing;
    update public.match_solicitudes set estado = 'vencida', sin_profesionales = true, actualizado_en = now() where id = r.solicitud_id;
    perform public._aviso_cliente(r.cliente_id, 'match', 'Ningún técnico pudo tomar tu pedido',
      'Te devolvemos el dinero por Mercado Pago. Podés pedirlo de nuevo para otro día o recibir propuestas.', '/match/solicitud/' || r.solicitud_id);
    perform public._avisar(public._admins(), null, 'match', 'Devolución para aprobar',
      format('Operación Nº %s: nadie la tomó (%s)', r.numero, public._pesos(r.importe - r.reintegrado)), '/admin/match?ver=devoluciones', '{}'::jsonb);
    n := n + 1;
  end loop;
  -- pedidos de WhatsApp (sin pagar) que nadie tomó
  for r in select s.id, s.cliente_id, s.numero from public.match_solicitudes s
            where s.pago = 'al_tomar' and s.estado = 'abierta' and s.profesional_id is null and s.limite_toma < now()
            for update skip locked loop
    update public.match_solicitudes set estado = 'vencida', sin_profesionales = true, actualizado_en = now() where id = r.id;
    update public.match_cotizaciones set estado = 'vencida' where solicitud_id = r.id and estado = 'pendiente';
    perform public._aviso_cliente(r.cliente_id, 'match', 'Ningún técnico pudo tomar tu pedido',
      format('Tu pedido Nº %s venció sin técnico. No se te cobró nada. Escribinos *HOLA* para pedirlo de nuevo.', r.numero),
      '/match/solicitud/' || r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.match_procesar_vencidos()
returns json language plpgsql security definer set search_path = public as $$
declare a int := 0; b int := 0; k int := 0; d int := 0; r record; c public.configuracion := public._cfg();
begin
  if not pg_try_advisory_xact_lock(hashtext('match_vencidos')) then return json_build_object('omitido', true); end if;
  if (select ultima from public.match_tareas where id = 1) > now() - interval '1 minute' then return json_build_object('omitido', true); end if;
  update public.match_tareas set ultima = now() where id = 1;
  d := public._vencer_primero();

  for r in select o.id, o.turno_id, o.solicitud_id, o.profesional_id, o.cliente_id
             from public.match_operaciones o where estado = 'pendiente_pago' and vence_pago_en < now() for update skip locked loop
    update public.match_operaciones set estado = 'cancelado', estado_pago = 'vencido', cancelado_en = now(), cancelado_por = 'sistema',
           motivo = 'No se pagó a tiempo' where id = r.id;
    update public.turnos set estado = 'cancelado', nota_estado = 'Reserva sin pagar' where id = r.turno_id and estado = 'pendiente';
    -- pedido de WhatsApp: vuelve al mapa para otro técnico
    if exists (select 1 from public.match_solicitudes s where s.id = r.solicitud_id and s.pago = 'al_tomar' and s.estado = 'abierta'
                and s.profesional_id = r.profesional_id) then
      update public.match_solicitudes set profesional_id = null, tomada_en = null, tomada_por = null, actualizado_en = now()
       where id = r.solicitud_id;
      perform public._aviso_pro(r.profesional_id, 'match', 'El cliente no pagó a tiempo',
        'Liberamos ese horario de tu agenda. El pedido volvió al mapa.', '/panel/mapa?ver=servicios');
      perform public._aviso_cliente(r.cliente_id, 'match', 'Se venció el tiempo para pagar',
        'No se te cobró nada. Seguimos buscando técnico: te avisamos por acá.', '/match/solicitud/' || r.solicitud_id);
    end if;
    a := a + 1;
  end loop;

  for r in select id from public.match_solicitudes s where estado = 'abierta' and vence_en < now()
             and not exists (select 1 from public.match_operaciones o where o.solicitud_id = s.id and o.estado in ('pendiente_pago', 'buscando_tecnico')) loop
    update public.match_solicitudes set estado = 'vencida', actualizado_en = now() where id = r.id;
    update public.match_invitaciones set estado = 'vencida' where solicitud_id = r.id and estado in ('pendiente', 'aceptada');
    b := b + 1;
  end loop;

  for r in select o.id, o.cliente_id, o.solicitud_id from public.match_operaciones o join public.turnos t on t.id = o.turno_id
            where o.estado = 'reserva_confirmada' and t.fin < now() - interval '24 hours' loop
    update public.match_operaciones set estado = 'pendiente_confirmacion', realizado_en = coalesce(realizado_en, now()),
           confirmar_hasta = now() + make_interval(hours => c.confirmacion_auto_horas) where id = r.id;
    perform public._aviso_cliente(r.cliente_id, 'match', '¿Se hizo la visita?',
      format('Confirmala o reclamá. Si no respondés, se confirma sola en %s horas.', c.confirmacion_auto_horas), '/match/solicitud/' || r.solicitud_id);
  end loop;

  for r in select o.id from public.match_operaciones o where o.estado = 'pendiente_confirmacion' and o.confirmar_hasta < now()
             and not exists (select 1 from public.match_reclamos x where x.operacion_id = o.id and x.estado = 'abierto') loop
    perform public._confirmar_operacion(r.id, 'automatica');
    k := k + 1;
  end loop;
  return json_build_object('pagos_vencidos', a, 'solicitudes_vencidas', b, 'confirmadas', k, 'sin_tecnico', d);
end $$;

-- ---------------------------------------------------------------------
-- 9. Cotización al aceptar una solicitud (modo "recibir propuestas")
-- ---------------------------------------------------------------------
drop function if exists public.responder_invitacion(uuid, boolean, text);
create or replace function public.responder_invitacion(p_id uuid, p_acepta boolean, p_mensaje text default null, p_precio numeric default null)
returns void language plpgsql security definer set search_path = public as $$
declare i public.match_invitaciones; s public.match_solicitudes; quedan int; c public.configuracion := public._cfg(); v_precio numeric;
begin
  select * into i from public.match_invitaciones where id = p_id for update;
  if i.id is null or not public._es_match(i.profesional_id) then raise exception 'No encontramos la solicitud'; end if;
  select * into s from public.match_solicitudes where id = i.solicitud_id;
  if i.estado <> 'pendiente' or s.estado <> 'abierta' then raise exception 'Esta solicitud ya no está abierta'; end if;
  if p_acepta and p_precio is not null then
    v_precio := round(p_precio);
    if v_precio < c.cotizacion_min or v_precio > c.cotizacion_max then
      raise exception 'Tu precio tiene que estar entre % y %', public._pesos(c.cotizacion_min), public._pesos(c.cotizacion_max);
    end if;
  end if;
  update public.match_invitaciones
     set estado = case when p_acepta then 'aceptada' else 'rechazada' end,
         mensaje = case when p_acepta then nullif(left(trim(coalesce(p_mensaje, '')), 400), '') end,
         motivo_rechazo = case when not p_acepta then nullif(left(trim(coalesce(p_mensaje, '')), 200), '') end,
         precio_profesional = v_precio,
         precio_visita = case when v_precio is not null
                              then v_precio + case when s.urgente and c.urgencia_activa then c.urgencia_ret_cliente else c.visita_ret_cliente end
                              else precio_visita end,
         respondida_en = now(), respondida_por = auth.uid(), vista_en = coalesce(vista_en, now())
   where id = p_id returning * into i;
  if p_acepta then
    perform public._aviso_cliente(s.cliente_id, 'match', 'Un profesional aceptó tu solicitud',
      format('%s puede hacer la visita de "%s"%s. Elegí el horario y reservá.', public._nombre_de(i.profesional_id), s.titulo,
             case when v_precio is not null then ' por ' || public._pesos(i.precio_visita) else '' end),
      '/match/solicitud/' || s.id);
    perform public._evento(auth.uid(), 'acepto_solicitud', 'match', i.profesional_id);
  else
    select count(*) into quedan from public.match_invitaciones where solicitud_id = s.id and estado in ('pendiente', 'aceptada');
    if quedan = 0 then
      perform public._aviso_cliente(s.cliente_id, 'match', 'Tu solicitud fue rechazada',
        format('Ningún profesional pudo tomar "%s" por ahora. Podés publicarla de nuevo o cambiar la zona.', s.titulo),
        '/match/solicitud/' || s.id);
    end if;
    perform public._evento(auth.uid(), 'rechazo_solicitud', 'match', i.profesional_id);
  end if;
end $$;

-- Horarios con precio: si el profesional cotizó, su precio + la tarifa de TaListo!
create or replace function public.horarios_visita_precios(p_invitacion uuid, p_desde date default null, p_dias int default 7)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  i public.match_invitaciones; s public.match_solicitudes; c public.configuracion := public._cfg();
  d0 date := coalesce(p_desde, (now() at time zone 'America/Montevideo')::date);
begin
  select * into i from public.match_invitaciones where id = p_invitacion;
  select * into s from public.match_solicitudes where id = i.solicitud_id;
  if i.id is null or s.cliente_id is distinct from auth.uid() then raise exception 'No encontramos el profesional'; end if;
  return (select coalesce(json_agg(json_build_object(
                   'desde', h.desde,
                   'urgencia', x.urg,
                   'importe', case when i.precio_profesional is not null
                                   then i.precio_profesional + case when x.urg then c.urgencia_ret_cliente else c.visita_ret_cliente end
                                   when x.urg then c.precio_urgencia else c.precio_visita end) order by h.desde), '[]')
            from generate_series(d0, d0 + least(greatest(p_dias, 1), 21) - 1, interval '1 day') g,
                 lateral public._horarios_match(i.profesional_id, g::date, c.duracion_visita_min) h,
                 lateral (select c.urgencia_activa and (s.urgente or h.urgencia) as urg) x
           where h.desde >= now() + interval '2 hours');
end $$;

create or replace function public.elegir_profesional(p_invitacion uuid, p_inicio timestamptz)
returns json language plpgsql security definer set search_path = public as $$
declare
  i public.match_invitaciones; s public.match_solicitudes; c public.configuracion := public._cfg(); t uuid; op public.match_operaciones;
  v_urg boolean; v_imp numeric; v_retc numeric; v_retp numeric; v_neto numeric;
begin
  perform public.match_procesar_vencidos();
  select * into i from public.match_invitaciones where id = p_invitacion;
  if i.id is null then raise exception 'No encontramos el profesional'; end if;
  select * into s from public.match_solicitudes where id = i.solicitud_id for update;
  if s.cliente_id <> auth.uid() then raise exception 'No encontramos la solicitud'; end if;
  if s.estado <> 'abierta' then raise exception 'La solicitud ya no está abierta'; end if;
  if i.estado <> 'aceptada' then raise exception 'Ese profesional todavía no aceptó la solicitud'; end if;
  if exists (select 1 from public.match_operaciones where solicitud_id = s.id and tipo = 'visita' and estado not in ('cancelado', 'reembolsado')) then
    raise exception 'Ya hay una visita en curso para esta solicitud';
  end if;
  if p_inicio < now() + interval '2 hours' or not exists (
       select 1 from public._horarios_match(i.profesional_id, (p_inicio at time zone 'America/Montevideo')::date, c.duracion_visita_min) h
        where h.desde = p_inicio) then
    raise exception 'Ese horario ya no está libre: elegí otro';
  end if;
  v_urg := c.urgencia_activa and (s.urgente or not public._es_horario_normal(p_inicio));
  v_retc := case when v_urg then c.urgencia_ret_cliente else c.visita_ret_cliente end;
  if i.precio_profesional is not null then
    v_neto := i.precio_profesional; v_retp := 0;
  else
    v_neto := case when v_urg then c.urgencia_neto_profesional else c.visita_neto_profesional end;
    v_retp := case when v_urg then c.urgencia_ret_profesional else c.visita_ret_profesional end;
  end if;
  v_imp := v_retc + v_retp + v_neto;
  begin
    insert into public.turnos (profesional_id, titulo, inicio, fin, tipo, estado, origen, monto_acordado, notas)
    values (i.profesional_id, left(case when v_urg then 'Urgencia TaListo! Match · ' else 'Visita TaListo! Match · ' end || public._rubro(s.categoria_id), 120),
            p_inicio, p_inicio + make_interval(mins => c.duracion_visita_min), 'visita', 'pendiente', 'reserva', v_imp,
            left(format('Solicitud Nº %s: %s', s.numero, s.titulo), 500))
    returning id into t;
  exception when exclusion_violation then
    raise exception 'Ese horario se acaba de ocupar: elegí otro';
  end;
  insert into public.match_operaciones (tipo, solicitud_id, invitacion_id, turno_id, cliente_id, profesional_id, categoria_id, importe,
                                        ret_cliente, ret_profesional, neto_profesional, mp_costo_profesional_pct, vence_pago_en, urgencia)
  values ('visita', s.id, i.id, t, s.cliente_id, i.profesional_id, s.categoria_id, v_imp, v_retc, v_retp, v_neto,
          c.mp_costo_profesional_pct, now() + make_interval(mins => c.pago_minutos), v_urg)
  returning * into op;
  perform public._evento(auth.uid(), 'reservo_visita', 'match');
  return json_build_object('operacion', op.id, 'importe', op.importe, 'vence', op.vence_pago_en, 'urgencia', op.urgencia);
end $$;

-- ---------------------------------------------------------------------
-- 10. Perfil Match: cobro por banco o por Abitab
-- ---------------------------------------------------------------------
create or replace function public.guardar_match_perfil(p_cuenta uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare v_rubros smallint[]; v_deps text[]; v_barrios text[]; c jsonb := p -> 'cobro'; v_metodo text;
begin
  if not public._es_match(p_cuenta) then raise exception 'No tenés permiso para manejar Match en esta cuenta'; end if;
  select coalesce(array_agg(distinct x::smallint), '{}') into v_rubros
    from jsonb_array_elements_text(coalesce(p -> 'rubros', '[]')) x
   where exists (select 1 from public.categorias k where k.id = x::smallint and k.activa);
  if p ? 'departamentos' then
    select coalesce(array_agg(distinct trim(x)), '{}') into v_deps from jsonb_array_elements_text(p -> 'departamentos') x where trim(x) <> '';
    select coalesce(array_agg(distinct trim(x)), '{}') into v_barrios from jsonb_array_elements_text(coalesce(p -> 'barrios', '[]')) x where trim(x) <> '';
    update public.profesionales set departamentos = v_deps, barrios = v_barrios where id = p_cuenta;
  end if;
  if coalesce((p ->> 'disponible')::boolean, false) then
    if cardinality(v_rubros) = 0 then raise exception 'Elegí al menos un rubro'; end if;
    if cardinality((select departamentos from public.profesionales where id = p_cuenta)) = 0 then
      raise exception 'Elegí al menos un departamento donde trabajás';
    end if;
  end if;
  insert into public.match_perfiles (profesional_id, disponible, rubros, urgencias, actualizado_en)
  values (p_cuenta, coalesce((p ->> 'disponible')::boolean, false), v_rubros, coalesce((p ->> 'urgencias')::boolean, false), now())
  on conflict (profesional_id) do update set disponible = excluded.disponible, rubros = excluded.rubros,
    urgencias = excluded.urgencias, actualizado_en = now();
  -- Los datos de cobro solo los carga la cuenta principal: cuenta bancaria o giro por Abitab (a la cédula del titular)
  if jsonb_typeof(c) = 'object' and p_cuenta = auth.uid() then
    v_metodo := coalesce(nullif(c ->> 'metodo', ''), 'banco');
    if v_metodo not in ('banco', 'abitab') then raise exception 'Elegí cómo querés cobrar'; end if;
    if v_metodo = 'abitab' and length(regexp_replace(coalesce(c ->> 'documento', ''), '\D', '', 'g')) not between 6 and 9 then
      raise exception 'Para cobrar por Abitab poné la cédula del titular';
    end if;
    if v_metodo = 'banco' and (coalesce(trim(c ->> 'banco'), '') = '' or coalesce(trim(c ->> 'numero'), '') = '') then
      raise exception 'Poné el banco y el número de cuenta';
    end if;
    insert into public.match_datos_cobro (profesional_id, metodo, banco, tipo_cuenta, numero, sucursal, titular, documento, actualizado_en)
    values (p_cuenta, v_metodo,
            case when v_metodo = 'abitab' then 'Abitab' else trim(c ->> 'banco') end,
            coalesce(nullif(c ->> 'tipo_cuenta', ''), 'caja_ahorro'),
            case when v_metodo = 'abitab' then null else trim(c ->> 'numero') end,
            case when v_metodo = 'abitab' then null else nullif(trim(coalesce(c ->> 'sucursal', '')), '') end,
            trim(c ->> 'titular'), nullif(trim(coalesce(c ->> 'documento', '')), ''), now())
    on conflict (profesional_id) do update set metodo = excluded.metodo, banco = excluded.banco, tipo_cuenta = excluded.tipo_cuenta,
      numero = excluded.numero, sucursal = excluded.sucursal, titular = excluded.titular, documento = excluded.documento, actualizado_en = now();
  end if;
  perform public._evento(auth.uid(), 'actualizo_disponibilidad', 'match', p_cuenta);
  return public.match_mi_perfil(p_cuenta);
end $$;

-- ---------------------------------------------------------------------
-- 11. Lo que usa el servidor de WhatsApp (solo con la clave de servicio)
-- ---------------------------------------------------------------------
-- Estado del cliente: su último pedido, lo que falta pagar, cotizaciones y visitas
create or replace function public.wa_estado(p_usuario uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s public.match_solicitudes;
begin
  select * into s from public.match_solicitudes where cliente_id = p_usuario and canal = 'whatsapp'
   order by creado_en desc, numero desc limit 1;
  return json_build_object(
    'solicitud', case when s.id is not null then json_build_object('id', s.id, 'numero', s.numero, 'estado', s.estado, 'rubro', public._rubro(s.categoria_id),
                   'titulo', s.titulo, 'limite_toma', s.limite_toma, 'profesional', public._nombre_de(s.profesional_id), 'creado_en', s.creado_en) end,
    'operacion', (select json_build_object('id', o.id, 'numero', o.numero, 'estado', o.estado, 'importe', o.importe, 'vence', o.vence_pago_en,
                   'preferencia', o.mp_preferencia_id, 'profesional', public._nombre_de(o.profesional_id),
                   'inicio', (select inicio from public.turnos where id = o.turno_id), 'calificada',
                   exists (select 1 from public.match_calificaciones k where k.operacion_id = o.id))
                    from public.match_operaciones o where o.solicitud_id = s.id and o.tipo = 'visita'
                     and o.estado not in ('cancelado') order by o.creado_en desc limit 1),
    'cotizaciones', (select coalesce(json_agg(json_build_object('id', k.id, 'numero', k.numero, 'profesional', public._nombre_de(k.profesional_id),
                       'importe', k.importe, 'inicio', k.inicio, 'mensaje', k.mensaje,
                       'calificacion', (select round(avg(q.puntaje)::numeric, 1) from public.match_calificaciones q where q.profesional_id = k.profesional_id))
                       order by k.importe, k.inicio), '[]')
                       from public.match_cotizaciones k where k.solicitud_id = s.id and k.estado = 'pendiente' and k.inicio > now() + interval '15 minutes'
                        and s.estado = 'abierta' and s.profesional_id is null));
end $$;

create or replace function public.wa_crear_pedido(p_usuario uuid, p jsonb)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  return public.crear_solicitud(p);
end $$;

create or replace function public.wa_cancelar(p_usuario uuid, p_solicitud uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  perform public.cancelar_solicitud(p_solicitud, 'Cancelada por WhatsApp');
end $$;

create or replace function public.wa_aceptar_cotizacion(p_usuario uuid, p_cotizacion uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  return public.aceptar_cotizacion(p_cotizacion);
end $$;

create or replace function public.wa_confirmar(p_usuario uuid, p_op uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  perform public.confirmar_visita(p_op);
end $$;

create or replace function public.wa_reclamar(p_usuario uuid, p_op uuid, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  perform public.reclamar(p_op, p_texto, '{}');
end $$;

create or replace function public.wa_calificar(p_usuario uuid, p_op uuid, p_puntaje int)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public._como(p_usuario);
  perform public.calificar(p_op, p_puntaje, null);
end $$;

-- Para armar el link de pago (el servidor, sin sesión del cliente)
create or replace function public.wa_operacion_a_pagar(p_op uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare op public.match_operaciones;
begin
  select * into op from public.match_operaciones where id = p_op;
  if op.id is null or op.estado <> 'pendiente_pago' or op.vence_pago_en < now() then return null; end if;
  return json_build_object('id', op.id, 'numero', op.numero, 'importe', op.importe, 'vence', op.vence_pago_en, 'solicitud', op.solicitud_id,
    'preferencia', op.mp_preferencia_id, 'titulo', 'Visita técnica · ' || public._rubro(op.categoria_id),
    'profesional', public._nombre_de(op.profesional_id));
end $$;

-- Toma los avisos pendientes (uno por vez cada uno: nadie más los toma mientras se mandan)
create or replace function public.wa_tomar_salida(p_limite int default 30)
returns table (id bigint, usuario_id uuid, telefono text, texto text, operacion_pago uuid, ultimo_entrante timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with x as (
    select w.id from public.wa_salida w
     where w.enviado_en is null and w.intentos < 5 and w.creado_en > now() - interval '3 days'
     order by w.creado_en limit p_limite for update skip locked)
  update public.wa_salida w set intentos = w.intentos + 1 from x where w.id = x.id
  returning w.id, w.usuario_id, (select c.telefono from public.wa_conversaciones c where c.usuario_id = w.usuario_id limit 1),
            w.texto, w.operacion_pago, (select c.ultimo_entrante from public.wa_conversaciones c where c.usuario_id = w.usuario_id limit 1);
end $$;

-- ---------------------------------------------------------------------
-- 12. Quién puede llamar a qué (las tablas nuevas: lectura con permisos; escritura solo el admin o el servidor)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['match_cotizaciones', 'bot_rubros', 'wa_conversaciones', 'wa_mensajes', 'wa_salida'] loop
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.match_cotizaciones, public.wa_conversaciones, public.wa_mensajes to authenticated;
grant select, insert, update, delete on public.bot_rubros to authenticated;
grant update (humano) on public.wa_conversaciones to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.cotizar_servicio(uuid, uuid, numeric, timestamptz, text)', 'public.aceptar_cotizacion(uuid)',
                           'public.responder_invitacion(uuid, boolean, text, numeric)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  foreach f in array array[
    'public._es_whatsapp(uuid)', 'public._wa_avisar(uuid, text, uuid)', 'public._wa_desde_aviso()', 'public._wa_despertar()',
    'public._tarifa(boolean)', 'public._como(uuid)', 'public._publicar_al_tomar(uuid)',
    'public.wa_estado(uuid)', 'public.wa_crear_pedido(uuid, jsonb)', 'public.wa_cancelar(uuid, uuid)',
    'public.wa_aceptar_cotizacion(uuid, uuid)', 'public.wa_confirmar(uuid, uuid)', 'public.wa_reclamar(uuid, uuid, text)',
    'public.wa_calificar(uuid, uuid, int)', 'public.wa_operacion_a_pagar(uuid)', 'public.wa_tomar_salida(int)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- =====================================================================
-- LISTO.
-- =====================================================================

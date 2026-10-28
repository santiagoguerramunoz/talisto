# TaListo! · Fase 1 — Agenda del profesional

Next.js + Supabase + Vercel.

## Qué incluye esta fase

- **Registro y login** (profesional o cliente), con confirmar contraseña, ojo para mostrarla y recuperación por email.
- **Agenda** por día y por semana. Turnos puntuales y **horarios fijos** que se repiten (ej. Grupo Gamma lun-mar-mié 9 a 17). Un horario fijo se puede suspender un día puntual.
- **Sin turnos cruzados**: la base de datos no deja guardar dos turnos superpuestos.
- **Clientes** con color, teléfono, notas y **varias direcciones** (con pin en el mapa, búsqueda y botón "Estoy acá"). En la ficha se ven los horarios acordados, los próximos turnos y el historial.
- **Mapa del día**: los trabajos del día numerados en orden, botones para ir con Google Maps o Waze y "ruta del día". También un mapa con todos los clientes.
- **Perfil**: nombre público, bio, WhatsApp, **zona de trabajo** (departamentos, barrios, km), **servicios y tarifas**, **días y horario de trabajo**.
- **Relevamientos**: visitas para ver el trabajo que pide el cliente, con horario flexible (no bloquea la agenda) y una ficha con notas, medidas, materiales, fotos, horas y costo estimado. Pestaña **Relevar** con pendientes, relevados y presupuestados.
- **Órdenes de empresa** (ej. Grupo Gamma): tickets con nº de cliente y de ticket, dirección del cliente de la empresa (no se guarda en tus clientes), detalle de lo realizado, acondicionamientos y MOE de a medio; precio editable por mes y planilla .xlsx de liquidación mensual.
- **Admin**: precio de la visita técnica (UYU 1.500) y comisión (UYU 200) editables, duración de la visita, verificar y suspender profesionales.
- La función `horarios_disponibles` ya calcula los huecos libres de cada profesional (la usa la Fase 2 para las reservas).

## Pasos

### 1. Supabase (proyecto NUEVO, no el de Metabia)

1. En supabase.com creá un proyecto nuevo llamado `talisto`.
2. **SQL Editor → New query**: pegá todo `supabase/01_talisto_fase1.sql` y tocá **Run**. Después hacé lo mismo, en orden, con `supabase/02_relevamientos.sql`, `supabase/03_ordenes_empresa.sql` y `supabase/04_trabajos_finanzas.sql` (el 03 agrega la dirección propia de los relevamientos; el 04 los trabajos B2B con tiempo y materiales, presupuestos, Mis gastos y los datos del negocio). Todos se pueden volver a correr sin problema.
3. **Authentication → URL Configuration**:
   - Site URL: `http://localhost:3000` (después cambiala por la URL de Vercel).
   - Redirect URLs: agregá `http://localhost:3000/**` y, cuando la tengas, `https://TU-APP.vercel.app/**`.
4. **Project Settings → API**: copiá la *Project URL* y la *anon / publishable key*.

### 2. Proyecto en tu PC

```bash
cd talisto
copy .env.local.example .env.local      # en Windows (en Mac/Linux: cp)
# abrí .env.local y pegá la URL y la key
npm install
npm run dev
```

Abrí http://localhost:3000 (necesitás Node 20.9 o más nuevo).

### 3. Hacerte admin

Registrate en la app y después corré en el SQL Editor:

```sql
update public.perfiles set es_admin = true where email = 'TU_EMAIL';
```

En **Perfil** te aparece el botón **Admin** (o entrá a `/admin`).

### 4. Publicar en Vercel

- Repositorio: `github.com/santiagoguerramunoz/talisto` (privado)
- Proyecto Vercel: `talisto` (equipo gstudiosoft1) → https://talisto-ashen.vercel.app
- Variables en Vercel (Settings → Environment Variables): `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Trabajar desde tu PC (Windows)

Necesitás [Git](https://git-scm.com/download/win) y Node 20.9 o más nuevo. Conviene una carpeta fuera de OneDrive
(por ejemplo `C:\proyectos`), para que OneDrive no sincronice `node_modules`.

**Primera vez**

```bash
cd C:\proyectos
git clone https://github.com/santiagoguerramunoz/talisto.git
cd talisto
npm install
npx vercel login
npx vercel link              # elegí el equipo gstudiosoft1 y el proyecto talisto
npx vercel env pull .env.local
npm run dev                  # http://localhost:3000
```

**Cada vez que trabajes**

```bash
git pull                     # trae los cambios que hizo Claude
npm install                  # solo si cambió package.json
npm run dev
```

**Guardar y publicar**

```bash
git add .
git commit -m "qué cambiaste"
git push                     # guarda el código en GitHub
npx vercel --prod            # publica en https://talisto-ashen.vercel.app
```

## Archivos

```
supabase/01_talisto_fase1.sql   → base de datos completa de la Fase 1 (correr en Supabase)
app/page.js                     → portada
app/login, app/registro, app/nueva-clave
app/inicio/page.js              → pantalla del cliente (buscador en Fase 3)
app/panel/layout.js             → protección de sesión + barra inferior
app/panel/page.js               → Agenda (día / semana)
app/panel/clientes/page.js      → lista de clientes
app/panel/clientes/[id]/page.js → ficha: horarios acordados, direcciones, historial
app/panel/mapa/page.js          → mapa del día y de todos los clientes
app/panel/perfil/page.js        → perfil público, zona, servicios, horario, visita técnica
app/admin/page.js               → configuración de visita/comisión y profesionales
components/                     → Mapa, formularios de turno, horario fijo y dirección, modal, íconos
lib/                            → conexión a Supabase, fechas, lógica de agenda, utilidades
```

## Notas

- Los montos de visita y comisión se "congelan" en cada visita al crearse: si el admin los cambia, las visitas ya agendadas no cambian.
- La ruta por calles del mapa usa el servidor público de OSRM (gratis, sin clave). Con mucho uso conviene uno propio o un plan pago.
- La app se instala desde el botón **Descargar app** (Perfil o portada) y se actualiza sola: al volver a abrirla, si hay una versión nueva publicada, se recarga.
- Los mapas usan OpenStreetMap (gratis). Para producción con mucho uso conviene pasar a un proveedor de mapas con plan gratuito (MapTiler o Stadia): es cambiar una línea en `components/Mapa.js`.

## Próximas fases

- **Fase 2 — Reservas**: página pública de cada profesional, el cliente elige un horario libre, carga su dirección y reserva la visita técnica.
- **Fase 3 — Buscador y presupuestos**: búsqueda por servicio y zona (con sinónimos), presupuestos con ítems, PDF y link para aceptar.
- **Fase 4 — Pagos y confianza**: Mercado Pago con pago retenido, reseñas, chat y notificaciones.

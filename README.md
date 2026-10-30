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
2. **SQL Editor → New query**: pegá todo `supabase/01_talisto_fase1.sql` y tocá **Run**. Después hacé lo mismo, en orden, con `supabase/02_relevamientos.sql`, `supabase/03_ordenes_empresa.sql`, `supabase/04_trabajos_finanzas.sql`, `supabase/05_planes.sql`, `supabase/06_empresas.sql`, `supabase/07_seguridad.sql`, `supabase/08_tickets.sql`, `supabase/09_proveedores.sql` y `supabase/10_stock.sql` (el 03 agrega la dirección propia de los relevamientos; el 04 los trabajos B2B con tiempo y materiales, presupuestos, Mis gastos y los datos del negocio; el 05 los planes Free, Pro y Business con sus límites; el 06 la empresa Business con cuentas del equipo, roles e invitaciones; el 07 el refuerzo de seguridad; el 08 los tickets y rutas del equipo; el 09 los proveedores, sus listas de precios y las órdenes de compra; el 10 el stock de la empresa, del equipo y de cada trabajo). Todos se pueden volver a correr sin problema.
3. **Authentication → URL Configuration**:
   - Site URL: `https://talisto-ashen.vercel.app` (para probar en tu PC podés usar `http://localhost:3000`).
   - Redirect URLs: solo `https://talisto-ashen.vercel.app/**` (y `http://localhost:3000/**` mientras pruebes en tu PC; después sacalo).
   - **Seguridad recomendada** (Authentication → Sign In / Providers y → Policies o *Password security*):
     - *Confirm email* prendido (nadie entra con un email que no es suyo).
     - Contraseña mínima de 8 caracteres y, si tu plan lo permite, *Leaked password protection*.
     - *Secure email change* prendido.
     - Apagá los proveedores que no usás (teléfono, Google, etc.).
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

### 5. Planes y Mercado Pago

- **Free**: agenda, relevamientos, clientes B2B y B2C, mapa y rutas; trabajos B2B de hasta 2 empresas y 6 planillas Excel por mes. Sin presupuestos, Mis gastos ni logo / datos del negocio.
- **Pro**: todo. **Business**: Pro + empresa con cuentas del equipo.
- **Business, cómo armar el equipo**: Perfil → Espacio de trabajo → *Crear mi empresa*. Después, en *Mi empresa*: **Invitar** (con email o con QR) y elegir los roles. La persona abre el link o escanea el QR, entra o crea su cuenta y toca *Unirme*. Cambia entre *Personal* y la empresa desde Perfil → Espacio de trabajo.
- Roles de fábrica (editables): **Administración** (agenda, clientes, relevamientos, agendar tickets, presupuestos, importes y gastos; no trabaja tickets), **Producción** (trabajar en sus tickets, sin ver importes) y **Ventas** (clientes, relevamientos y presupuestos). Roles y cuentas se pueden bloquear. La cantidad de cuentas la fija el admin (Admin → Plan → Cuentas).
- Al correr `05_planes.sql` las cuentas admin quedan en Business sin vencimiento. A los demás les regalás el plan desde **/admin → Plan** (sin vencimiento o hasta una fecha). Los precios y los límites de Free también se editan en /admin.
- Para cobrar la suscripción mensual con Mercado Pago, cargá en Vercel (las pegás vos, no las compartas):
  - `MP_ACCESS_TOKEN`: Mercado Pago → Tus integraciones → tu aplicación → Credenciales de producción → Access Token.
  - `SUPABASE_SERVICE_ROLE_KEY`: Supabase → Project Settings → API Keys → `service_role` (secreta: solo en Vercel).
  - `MP_WEBHOOK_SECRET` (recomendada): la clave secreta que te da Mercado Pago al configurar el webhook.
  - En Mercado Pago → Tus integraciones → Webhooks, URL de producción `https://talisto-ashen.vercel.app/api/mercadopago/webhook` con el evento **Planes y suscripciones**.
  - Después de cargar las variables, hacé **Redeploy** en Vercel. Hasta entonces el botón de suscribirse dice "Muy pronto".

### 6. Tickets y rutas del equipo (Business)

- **Administración** (o quien tenga *Agendar tickets* / *Agenda*) crea el ticket B2B o el turno y elige **Asignado a**. En una empresa, dos personas pueden tener trabajos a la misma hora.
- **Producción** ve **Tickets**: sus trabajos del día en el orden de la ruta, con dirección, Ir / Waze / Llamar, lo que hay que hacer y los materiales, **sin importes**. Toca **Iniciar** al llegar y **Finalizar** al terminar: *Terminado* (cuenta cómo quedó, puestas y MOE), *Suspendido* (con el motivo) o *Sigue otro día*. Se guarda la hora y el lugar de cada inicio y fin.
- Solo la persona asignada marca el inicio y el fin (la cuenta principal también puede, en lo suyo). Administración no puede "iniciarse": la base lo bloquea.
- **Equipo en ruta** (Agenda → *Equipo*, o Mi empresa): qué está haciendo cada uno ahora, el cronómetro, cuántos terminó, la resolución de cada trabajo, los que quedan sin asignar, el orden de la ruta con flechas y el mapa con la última ubicación de cada uno (si la comparte). Se actualiza sola cada 20 segundos.
- Si alguien sale del equipo, sus trabajos sin terminar quedan *Sin asignar* para dárselos a otro.

### 7. Proveedores y órdenes de compra (Pro y Business)

- **Finanzas → Compras → Proveedores → + Proveedor**. Cada proveedor tiene su lista de precios, que llega de una de estas formas:
  - **Planilla Excel o CSV**: el proveedor te la pasa y la subís (hay una *planilla modelo* para mandarle). TaListo! reconoce solo qué columna es el código, la descripción, el precio, el stock, la unidad y la marca; si algo no coincide lo cambiás antes de cargar.
  - **Link publicado**: por ejemplo una planilla de Google publicada como CSV. Con *Actualizar lista* se trae la versión nueva.
  - **API del proveedor**: el link de la lista (JSON, CSV o Excel), la clave (queda guardada protegida: nadie la vuelve a ver), el link de **stock al momento** con `{codigo}` y el link para **recibir órdenes de compra**.
  - **A mano**: cargás los productos uno por uno.
- En el **presupuesto**, en Materiales tocá **Proveedores**: buscás por nombre, marca o código y el producto se agrega con el costo y tu margen. Si está en dólares te pide la cotización.
- **Compra de materiales** (en el presupuesto): *Revisar stock* compara las cantidades con el stock (en el momento si el proveedor tiene API) y avisa si cambió el precio. *Orden de compra* arma una orden por proveedor, en borrador.
- En la orden: ajustás cantidades, la mandás en **PDF, WhatsApp o email**, o **a su sistema** si tiene API, y le vas cambiando el estado (enviada, confirmada, recibida).
- **Proveedores de TaListo!**: el admin los suma desde /admin (o Compras → + Proveedor → *Proveedor de TaListo!*) y los ven todas las cuentas Pro y Business, sin comisión.
- En una empresa, el permiso nuevo **Compras** maneja proveedores y órdenes (el rol Administración ya lo tiene).
- Para las API con clave y el stock al momento, el servidor necesita `SUPABASE_SERVICE_ROLE_KEY` en Vercel (la misma de Mercado Pago).

### 8. Stock (Business)

- **Finanzas → Stock**. Cada material tiene su **unidad mínima** (unidad, metro, kg, litro…) y sus **presentaciones** (caja x 100, rollo de 100 m, bolsa de 25 kg). Se carga por caja o suelto y el stock se lleva siempre en la unidad mínima, con el desglose a la vista ("2 × Rollo 100 m + 45,5 m").
- **Lugares**: los depósitos de la empresa (local, galpón, camioneta), el stock de **cada persona del equipo** y **cada trabajo** (ticket B2B o trabajo de la agenda).
- Todo se mueve con **comprobantes numerados**: *Ingreso* (compra o stock inicial), *Entrega* (depósito → operario), *A un trabajo*, *Devolución* (de un trabajo, o del operario al depósito), *Devolver al proveedor*, *Conteo* (queda la diferencia con lo que decía el sistema) y *Baja* (rotura, pérdida, vencido, robo).
- Lo que se entrega a otra persona queda **por confirmar** hasta que lo recibe en la app (puede decir que llegó distinto o rechazarlo: lo que no recibe vuelve al origen). Lo mismo cuando un operario devuelve al depósito.
- El operario ve **Mi stock** (desde Mis tickets): confirma lo que le entregan, lo usa en cada ticket con **Materiales** (también al cerrar el trabajo), devuelve lo que sobró y puede pasarle materiales a un compañero. No ve costos. Puede corregir hasta 2 días después de cerrar el trabajo; después, solo quien maneja el stock.
- **Nada se edita ni se borra**: un error se corrige **anulando** el comprobante (quedan el original y su anulación). Cada asiento queda sellado con una huella encadenada a la anterior y la pantalla verifica el stock cada vez que se abre: si alguien tocara la base a mano, lo marca.
- Las **órdenes de compra** se reciben en el stock (*Recibir en el stock*): todo o lo que llegó (queda *Recibida en parte*). Cada producto del proveedor se vincula a un material con cuántas unidades trae, y la próxima vez se reconoce solo. El costo por unidad se actualiza con el precio de la orden.
- Avisos: materiales por debajo del mínimo, personas que salieron del equipo con materiales a su cargo y trabajos cancelados con materiales. Planilla Excel con el stock por lugar.
- En una empresa, el permiso nuevo **Stock y depósito** mueve el stock (Administración ya lo tiene). **Compras** lo ve y recibe las compras. Los costos los ven la cuenta principal, Importes y Compras.

### 9. Seguridad

- La base controla todo (no la pantalla): cada cuenta solo ve y cambia lo suyo o lo que su rol permite, nadie puede pasar datos de una cuenta a otra, sin sesión solo se ve lo público, y las funciones internas no se pueden llamar desde afuera.
- La app manda encabezados de seguridad (no se puede meter dentro de otra página, solo carga scripts propios, conexiones solo a Supabase y los mapas).
- El permiso **Equipo** de un rol permite invitar y cambiar roles: dáselo solo a gente de confianza.
- Las claves (`SUPABASE_SERVICE_ROLE_KEY`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`) van solo en Vercel; nunca en el código ni en mensajes.
- Los links de los proveedores solo se consultan desde el servidor, con https, nunca a direcciones internas y con tiempo y tamaño máximos. Las claves de sus API quedan en una tabla que la app no puede leer.
- El stock solo se mueve con las funciones de la base, de a una operación por empresa, y nunca queda en negativo. Los comprobantes y asientos no se pueden modificar ni borrar desde la app (solo se borran si se borra la cuenta entera).

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
supabase/01 … 10                → base de datos (correr en orden en Supabase)
app/page.js                     → portada
app/login, app/registro, app/nueva-clave
app/inicio/page.js              → pantalla del cliente (buscador en Fase 3)
app/panel/layout.js             → protección de sesión + barra inferior
app/panel/page.js               → Agenda (día / semana) · Mis tickets para Producción
app/panel/equipo/page.js        → Equipo en ruta (tickets, tiempos y ubicación del equipo)
app/panel/finanzas/compras      → órdenes de compra y proveedores
app/panel/finanzas/proveedores  → ficha del proveedor y su lista de precios
app/panel/finanzas/stock        → stock: existencias, movimientos, materiales, lugares y ficha con kardex
app/panel/mi-stock/page.js      → Mi stock (cada persona del equipo)
app/api/proveedores             → actualizar listas, stock al momento y mandar órdenes (servidor)
app/panel/empresa/page.js       → Mi empresa: cuentas, roles e invitaciones
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

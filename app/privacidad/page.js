'use client';

import Link from 'next/link';
import PaginaLegal, { Contacto, useDatosLegales } from '@/components/PaginaLegal';

const L = ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;

export default function Privacidad() {
  const { responsable, email } = useDatosLegales();
  const secciones = [
    ['Quién es responsable de tus datos', <p>El responsable de la base de datos de TaListo! es {responsable}. Tratamos tus datos personales según la Ley N.º 18.331 de Protección de Datos Personales de Uruguay y su reglamentación.</p>],
    ['Qué datos guardamos', <L>
      <li><b>Tu cuenta:</b> nombre, correo, teléfono, el tipo de cuenta (cliente o profesional) y tu ubicación (país, departamento o provincia y localidad o barrio), para mostrarte técnicos, proveedores y novedades de tu zona.</li>
      <li><b>Pedidos y visitas:</b> direcciones, ubicación en el mapa, descripción del problema, fotos que subas, fechas y horarios.</li>
      <li><b>Mensajes:</b> el chat entre cliente y profesional y las conversaciones por WhatsApp con TaListo!. TaListo! puede revisarlos para resolver reclamos o problemas de seguridad.</li>
      <li><b>Calificaciones y comentarios</b> que dejan los clientes.</li>
      <li><b>Profesionales:</b> datos de identidad para la verificación, rubros, zonas, y cómo cobran (banco y número de cuenta, o documento para Abitab).</li>
      <li><b>Pagos:</b> los datos de tu tarjeta los maneja Mercado Pago: TaListo! no los ve ni los guarda. Guardamos el importe, la fecha y el estado de cada pago.</li>
      <li><b>Uso de la app:</b> qué secciones se usan (por ejemplo, &ldquo;publicó un pedido&rdquo;), nunca el contenido, para mejorar el servicio.</li>
      <li><b>Avisos:</b> si los activás, un identificador de tu dispositivo para mandarte avisos al celular.</li>
      <li><b>Gestión del profesional:</b> los clientes, presupuestos, gastos, comprobantes y datos de stock que cada profesional carga para su trabajo.</li>
    </L>],
    ['Para qué los usamos', <L>
      <li>Para conectar clientes y profesionales, coordinar visitas y mostrar el camino.</li>
      <li>Para cobrar las visitas y pagarles a los profesionales.</li>
      <li>Para mandarte avisos sobre tus pedidos, visitas y cuenta.</li>
      <li>Para atender reclamos, prevenir fraudes y cuidar la seguridad.</li>
      <li>Para hacer estadísticas internas del uso de TaListo!.</li>
    </L>],
    ['Con quién se comparten', <>
      <L>
        <li>Cuando una visita queda confirmada, el profesional ve el nombre, la dirección y el teléfono del cliente. El cliente ve el perfil público del profesional y sus calificaciones.</li>
        <li>Usamos proveedores que guardan o procesan datos para que TaListo! funcione: Supabase (base de datos), Vercel (alojamiento de la app), Mercado Pago (pagos), Meta (si nos escribís por WhatsApp), Google Gemini (para leer los comprobantes y órdenes de trabajo que suben los profesionales) y OpenStreetMap (para ubicar direcciones en el mapa).</li>
        <li>Algunos de esos proveedores guardan los datos fuera de Uruguay. Al usar TaListo! aceptás esa transferencia, que se hace solo para prestar el servicio.</li>
      </L>
      <p>No vendemos tus datos ni los usamos para publicidad de terceros.</p>
    </>],
    ['Cuánto tiempo los guardamos', <p>Mientras tengas tu cuenta. Si la das de baja, borramos o anonimizamos tus datos, salvo los que haya que conservar por obligaciones legales o contables (por ejemplo, los registros de pagos).</p>],
    ['Tus derechos', <>
      <p>Podés pedir acceso a tus datos, corregirlos, actualizarlos, incluir datos que falten o pedir que los borremos, <Contacto email={email} />. Te respondemos en los plazos que fija la ley.</p>
      <p>También podés presentar una denuncia ante la Unidad Reguladora y de Control de Datos Personales (URCDP).</p>
    </>],
    ['Seguridad', <p>Tus datos viajan cifrados y cada persona solo puede ver lo que le corresponde según su cuenta y sus permisos. Ningún sistema es 100 % seguro: si detectamos un problema que afecte tus datos, te avisamos.</p>],
    ['Menores de edad', <p>TaListo! no está pensado para menores de 18 años y no guardamos datos de menores a sabiendas.</p>],
    ['Cambios en esta política', <p>Si cambiamos esta política, lo avisamos en la app.</p>],
  ];
  return <PaginaLegal titulo="Política de privacidad" actualizado="20 de noviembre de 2026" secciones={secciones} otro={<Link href="/terminos" className="underline">Términos y condiciones</Link>} />;
}

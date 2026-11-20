'use client';

import Link from 'next/link';
import PaginaLegal, { Contacto, useDatosLegales } from '@/components/PaginaLegal';

const L = ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>;

export default function Terminos() {
  const { responsable, email } = useDatosLegales();
  const secciones = [
    ['Qué es TaListo!', <>
      <p>TaListo! es una plataforma de {responsable} que conecta a personas que necesitan un servicio para su hogar o empresa con profesionales independientes (técnicos y oficios), y que les da a esos profesionales herramientas para organizar su trabajo: agenda, clientes, presupuestos, finanzas y equipo.</p>
      <p>Los servicios técnicos los presta cada profesional, que trabaja por su cuenta. TaListo! no es empleador de los profesionales ni presta esos servicios: los pone en contacto, cobra la visita y le paga al profesional como se explica abajo.</p>
    </>],
    ['Tu cuenta', <L>
      <li>Para usar TaListo! tenés que ser mayor de 18 años y cargar datos verdaderos.</li>
      <li>Tu cuenta es personal: cuidá tu contraseña. Lo que se haga con tu cuenta es tu responsabilidad.</li>
      <li>Podemos suspender cuentas que den datos falsos, cometan fraude o falten el respeto a otras personas.</li>
    </L>],
    ['Profesionales', <L>
      <li>Para recibir pedidos de clientes, el profesional verifica su identidad ante TaListo! y carga cómo cobra (cuenta bancaria o Abitab).</li>
      <li>Cada profesional es responsable de estar habilitado para su oficio, de cumplir las normas que le correspondan (incluidas las fiscales) y de la calidad y seguridad de su trabajo.</li>
      <li>El precio de la visita lo fija TaListo!, salvo que el profesional mande una cotización propia y el cliente la acepte.</li>
    </L>],
    ['Cómo funciona TaListo! Match', <L>
      <li>El cliente pide un servicio desde la app o por WhatsApp: elige un profesional, recibe propuestas o pide &ldquo;el primero disponible&rdquo;.</li>
      <li>Antes de pagar se muestra el precio de la visita, que incluye la tarifa de TaListo!. Fuera del horario normal puede aplicarse el precio de urgencia, que también se muestra antes de pagar.</li>
      <li>Si la visita sale más cara por algún motivo, el profesional puede mandar una cotización. El cliente decide si la acepta.</li>
      <li>El pago se hace con Mercado Pago. Si el cliente no paga dentro del plazo que indica la app, la reserva se cae y el pedido vuelve a estar disponible.</li>
      <li>TaListo! retiene el pago y se lo libera al profesional cuando el cliente da el visto bueno, o cuando vence el plazo para confirmar sin que haya un reclamo.</li>
    </L>],
    ['Cancelaciones, devoluciones y reclamos', <L>
      <li>Al cancelar, la app muestra cuánto se devuelve según la anticipación y quién canceló.</li>
      <li>Si el profesional no se presenta o hay un problema con la visita, el cliente puede reclamar desde la app antes de dar el visto bueno.</li>
      <li>TaListo! revisa cada reclamo con la información de las dos partes. Las devoluciones se hacen por Mercado Pago, al mismo medio de pago.</li>
    </L>],
    ['Después de la visita', <p>Lo que cliente y profesional acuerden después de la visita (un trabajo más grande, un presupuesto) es entre ellos, salvo que lo contraten a través de TaListo!. En ese caso se aplican las condiciones que se muestren al contratar.</p>],
    ['Calificaciones', <L>
      <li>Al dar el visto bueno, el cliente califica de 0 a 10 la puntualidad, la velocidad y el desempeño del profesional. Solo califica quien pagó una visita por TaListo!.</li>
      <li>El puntaje del profesional es el promedio de sus últimas 10 contrataciones calificadas, y se muestra en estrellas.</li>
      <li>A los clientes les aparecen primero los profesionales con más puntaje sostenido en el tiempo.</li>
      <li>Está prohibido manipular las calificaciones. Podemos quitar comentarios ofensivos o que no tengan que ver con el servicio.</li>
    </L>],
    ['Planes Pro y Business', <p>Los planes pagos de TaListo! se cobran por mes con Mercado Pago, al precio que se muestra en la app antes de suscribirte. Podés cancelar la suscripción cuando quieras: el plan sigue hasta el final del período pago.</p>],
    ['Lo que no está permitido', <L>
      <li>Usar TaListo! para fraudes, estafas o cobros indebidos.</li>
      <li>Publicar contenido ofensivo, discriminatorio o que no te pertenezca.</li>
      <li>Intentar acceder a cuentas o datos de otras personas, o afectar el funcionamiento de la plataforma.</li>
    </L>],
    ['Responsabilidad', <p>TaListo! hace lo posible para que la plataforma funcione bien y esté disponible, pero puede tener interrupciones. TaListo! no responde por el trabajo que hace cada profesional, salvo en lo que se contrate con garantía TaListo! cuando esa opción esté disponible y en sus condiciones.</p>],
    ['Cambios en estos términos', <p>Si cambiamos estos términos, lo avisamos en la app. Seguir usando TaListo! después del aviso significa que aceptás los cambios.</p>],
    ['Ley aplicable y contacto', <>
      <p>Estos términos se rigen por las leyes de la República Oriental del Uruguay.</p>
      <p>Por cualquier consulta podés contactarnos <Contacto email={email} />. El tratamiento de tus datos se explica en la <Link href="/privacidad" className="underline">Política de privacidad</Link>.</p>
    </>],
  ];
  return <PaginaLegal titulo="Términos y condiciones" actualizado="20 de noviembre de 2026" secciones={secciones} otro={<Link href="/privacidad" className="underline">Política de privacidad</Link>} />;
}

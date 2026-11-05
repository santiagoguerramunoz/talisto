'use client';

import { useEffect, useState } from 'react';

// Qué decir mientras lee la IA: en el uso gratis de Google a veces tarda minutos
export default function TextoEspera({ className = '' }) {
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    const reloj = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(reloj);
  }, []);

  const texto =
    segundos < 25
      ? 'Tarda unos segundos.'
      : segundos < 60
        ? 'Google está con mucha demanda: estamos probando con otro modelo.'
        : 'Puede tardar hasta 3 minutos. No cierres esta pantalla.';

  return <p className={className}>{texto}</p>;
}

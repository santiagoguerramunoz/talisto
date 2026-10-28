'use client';

import { faltaConfiguracion } from '@/lib/supabase';

export default function AvisoConfiguracion() {
  if (!faltaConfiguracion) return null;
  return (
    <div className="mb-4 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-200">
      Falta configurar Supabase: copiá <b>.env.local.example</b> como <b>.env.local</b>, completá la URL y la key, y
      reiniciá <code>npm run dev</code>.
    </div>
  );
}

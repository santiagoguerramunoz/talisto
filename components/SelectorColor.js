'use client';

import Icon from './Icon';
import { COLORES } from '@/lib/util';

export default function SelectorColor({ valor, onChange }) {
  return (
    <div>
      <span className="etiqueta">Color en la agenda</span>
      <div className="flex flex-wrap gap-2.5">
        {COLORES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`grid h-9 w-9 place-items-center rounded-full ${valor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-navy-900' : ''}`}
            style={{ background: c }}
            aria-label={`Color ${c}`}
          >
            {valor === c && <Icon name="check" className="h-4 w-4 text-navy-950" strokeWidth={3} />}
          </button>
        ))}
      </div>
    </div>
  );
}

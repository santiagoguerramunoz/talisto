'use client';

import { useState } from 'react';
import Icon from './Icon';

export default function CampoPassword({ value, onChange, placeholder = 'Contraseña', autoComplete = 'current-password', id }) {
  const [ver, setVer] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={ver ? 'text' : 'password'}
        className="campo pr-12"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
        minLength={6}
      />
      <button
        type="button"
        onClick={() => setVer((v) => !v)}
        className="absolute inset-y-0 right-0 grid w-12 place-items-center text-tinta-400 hover:text-tinta-100"
        aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <Icon name={ver ? 'ojoNo' : 'ojo'} />
      </button>
    </div>
  );
}

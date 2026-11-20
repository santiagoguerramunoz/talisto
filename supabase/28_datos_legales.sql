-- =====================================================================
--  TaListo!  ·  28 · Datos para los términos y la política de privacidad
--  · Quién es el responsable (nombre o razón social) y el correo de
--    contacto que se muestran en /terminos y /privacidad. Se cambian en
--    /admin → Configuración.
--  Correr después del 27. Se puede correr más de una vez.
-- =====================================================================

alter table public.configuracion add column if not exists legal_responsable text
  check (legal_responsable is null or length(legal_responsable) between 2 and 160);
alter table public.configuracion add column if not exists contacto_email text
  check (contacto_email is null or contacto_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');

notify pgrst, 'reload schema';

-- =====================================================================
-- LISTO.
-- =====================================================================

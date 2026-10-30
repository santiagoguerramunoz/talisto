// Identificador único de cada publicación en Vercel (en local queda 'dev').
// La app lo compara con /api/version para saber si hay una versión nueva y recargarse sola.
const version = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'dev';
const desarrollo = process.env.NODE_ENV !== 'production';

// Qué puede cargar la página: solo TaListo!, Supabase y los mapas.
// Si alguien lograra meter un script de otro sitio, el navegador no lo ejecuta.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${desarrollo ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://router.project-osrm.org https://nominatim.openstreetmap.org${desarrollo ? ' ws: http://localhost:*' : ''}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'self' blob:",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(desarrollo ? [] : ['upgrade-insecure-requests']),
].join('; ');

const seguridad = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_VERSION: version,
  },
  async headers() {
    return [
      { source: '/:path*', headers: seguridad },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default nextConfig;

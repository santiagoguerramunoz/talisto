// Identificador único de cada publicación en Vercel (en local queda 'dev').
// La app lo compara con /api/version para saber si hay una versión nueva y recargarse sola.
const version = process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_URL || 'dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_VERSION: version,
  },
  async headers() {
    return [
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

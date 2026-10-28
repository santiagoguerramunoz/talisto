export default function manifest() {
  return {
    name: 'TaListo! · Agenda para profesionales',
    short_name: 'TaListo!',
    description: 'Agenda, clientes, mapa del día y servicios para profesionales y oficios en Uruguay.',
    id: '/',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'es-UY',
    background_color: '#060d1c',
    theme_color: '#060d1c',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

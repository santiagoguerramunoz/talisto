import { Plus_Jakarta_Sans } from 'next/font/google';
import 'leaflet/dist/leaflet.css';
import './globals.css';
import Actualizador from '@/components/Actualizador';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata = {
  title: 'TaListo! · Agenda para profesionales',
  description: 'Agenda, clientes y servicios para profesionales y oficios en Uruguay.',
  applicationName: 'TaListo!',
  appleWebApp: {
    capable: true,
    title: 'TaListo!',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: { telephone: false },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#060d1c',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={jakarta.variable}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Actualizador />
      </body>
    </html>
  );
}

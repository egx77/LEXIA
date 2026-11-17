import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { SwRegister } from '@/components/client';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'LEXIA — Legal Intelligence Assistant', template: '%s · LEXIA' },
  description: 'Philippine-law-grounded legal intelligence and practice platform for lawyer-supervised work. Pilot prototype.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = { themeColor: '#1f3a5f', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const text = (await cookies()).get('lexia_text')?.value === 'large' ? 'large' : 'normal';
  return (
    <html lang="en-PH" data-text={text}>
      <body>
        <a className="skip" href="#main">Skip to main content</a>
        {children}
        <SwRegister />
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Geist, Instrument_Serif } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { Toaster } from 'sonner';
import './globals.css';

const geist = Geist({
  subsets: ['latin'],
  variable: '--font-geist',
  weight: ['400', '500', '600', '700'],
});

const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-instrument-serif',
  weight: ['400'],
  style: ['normal', 'italic'],
});

export const metadata: Metadata = {
  title: 'Receh — Spare Change That Grows Communities',
  description:
    'Receh is an embeddable checkout widget that rounds up every USDC purchase and routes the spare change into a shared DeFindex yield vault. Contributions earn variable Blend-market yield while the pool grows, then merchants and shoppers vote monthly on which local community projects receive grants — disbursed on-chain by a Soroban voting contract.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={`${geist.variable} ${instrumentSerif.variable} antialiased`}>
        <NextIntlClientProvider messages={messages}>
          {children}
          <Toaster richColors position="top-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

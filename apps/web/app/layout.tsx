import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AuthProvider } from '../lib/auth';
import { Nav } from './nav';

export const metadata: Metadata = {
  title: 'Candle — Learn money, for real',
  description:
    'Gamified financial learning for beginners. Educational content only — not investment advice.',
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 antialiased min-h-screen">
        <AuthProvider>
          <Nav />
          <main className="mx-auto max-w-4xl px-4 py-8">{children}</main>
          <footer className="mx-auto max-w-4xl px-4 pb-8 text-xs text-slate-500">
            <p>
              Educational purpose only — this is not investment advice. All companies, tickers, and
              numbers are fictional illustrations.
            </p>
          </footer>
        </AuthProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { AuthGuard } from '@/components/AuthGuard';

export const metadata: Metadata = {
  title: 'Quotation Automation System',
  description: 'Dashboard for quotation → purchasing → inventory → delivery → collection workflow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden">
        <AuthProvider>
          <AuthGuard>
            {children}
          </AuthGuard>
        </AuthProvider>
      </body>
    </html>
  );
}

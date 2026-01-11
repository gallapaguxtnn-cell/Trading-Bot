import Link from 'next/link';
import { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Trading Bot Dashboard',
  description: 'Automated Trading Bot Manager',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex h-screen bg-slate-900 text-white">
        {/* Sidebar */}
        <aside className="w-64 bg-slate-800 border-r border-slate-700 flex flex-col">
          <div className="p-6">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              AutoTrader
            </h1>
          </div>
          
          <nav className="flex-1 px-4 space-y-2">
            <Link href="/" className="block py-2 px-4 rounded hover:bg-slate-700 transition">
              Dashboard
            </Link>
            <Link href="/strategies" className="block py-2 px-4 rounded hover:bg-slate-700 transition">
              Strategies
            </Link>
            <Link href="/settings" className="block py-2 px-4 rounded hover:bg-slate-700 transition">
              Settings
            </Link>
             <Link href="/logs" className="block py-2 px-4 rounded hover:bg-slate-700 transition">
              Logs
            </Link>
          </nav>
          
          <div className="p-4 border-t border-slate-700 text-slate-400 text-sm">
            Status: <span className="text-emerald-400">Online</span>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-auto bg-slate-900 p-8">
            {children}
        </main>
      </body>
    </html>
  );
}

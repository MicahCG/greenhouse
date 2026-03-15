import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: '◼' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: '◈' },
  { href: '/dashboard/ad-spend', label: 'Ad Spend', icon: '◉' },
  { href: '/dashboard/agent-log', label: 'Agent Log', icon: '◎' },
  { href: '/dashboard/chat', label: 'Growth Expert', icon: '◆' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-zinc-950 text-white">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <span className="text-lg font-bold tracking-tight">🌱 Greenhouse</span>
          <p className="text-xs text-zinc-500 mt-0.5">Growth Platform</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <span className="text-xs opacity-50">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t border-white/10 flex items-center gap-3">
          <UserButton />
          <span className="text-xs text-zinc-500">Account</span>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-white/10 flex items-center px-6 gap-4 flex-shrink-0">
          <div className="flex-1" />
          <div className="text-xs text-zinc-500 bg-zinc-900 border border-white/10 rounded-md px-3 py-1.5">
            Acquisition Q1 2026
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}

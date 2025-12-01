'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  History,
  TrendingUp,
  Settings,
  Key,
  FileText,
  Layers
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Test Runs', href: '/runs', icon: History },
  { name: 'Trends', href: '/trends', icon: TrendingUp },
  { name: 'API Keys', href: '/api-keys', icon: Key },
  { name: 'Documentation', href: '/docs', icon: FileText },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-[#F9FAFB] border-r border-gray-200">
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 bg-primary-500 rounded-lg flex items-center justify-center shadow-sm">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="text-gray-900 font-semibold text-base">A11y Agent</span>
              <span className="block text-xs text-gray-400">Dashboard</span>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="text-xs font-medium text-gray-400 uppercase tracking-wider px-3 mb-3">
            Menu
          </div>
          {navigation.map((item) => {
            const isActive = pathname === item.href ||
              (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`
                  flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                  ${isActive
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}
                `}
              >
                <item.icon className={`w-5 h-5 mr-3 ${isActive ? 'text-primary-500' : 'text-gray-400'}`} />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
            <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium mr-3">
              U
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">User</div>
              <div className="text-xs text-gray-400">Free Plan</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

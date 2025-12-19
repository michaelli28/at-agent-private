'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard,
  FolderKanban,
  History,
  TrendingUp,
  Settings,
  Key,
  FileText,
  LogOut
} from 'lucide-react';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Test Runs', href: '/runs', icon: History },
  { name: 'Trends', href: '/trends', icon: TrendingUp },
  { name: 'API Keys', href: '/api-keys', icon: Key },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  // Get user initials for avatar
  function getUserInitials(): string {
    if (!user) return 'U';
    if (user.displayName) {
      const parts = user.displayName.split(' ');
      return parts.map(p => p[0]).join('').substring(0, 2).toUpperCase();
    }
    if (user.email) {
      return user.email[0].toUpperCase();
    }
    return 'U';
  }

  function getUserDisplayName(): string {
    if (!user) return 'User';
    return user.displayName || user.email || 'User';
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      console.error('Sign out error:', error);
    }
  }

  return (
    <div className="fixed inset-y-0 left-0 w-64 bg-[#F9FAFB] border-r border-gray-200">
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center h-16 px-6 border-b border-gray-200">
          <div>
            <span className="text-gray-900 font-semibold text-base">AT Agent</span>
            <span className="block text-xs text-gray-400">Dashboard</span>
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
          <div className="flex items-center px-3 py-2 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-primary-500 flex items-center justify-center text-white text-sm font-medium mr-3">
              {getUserInitials()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 truncate">{getUserDisplayName()}</div>
              <div className="text-xs text-gray-400 truncate">{user?.email}</div>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-lg hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

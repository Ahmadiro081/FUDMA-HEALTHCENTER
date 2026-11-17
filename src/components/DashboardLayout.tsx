import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  CheckCheck,
  Cross,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { getRoleLabel, useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { AppNotification } from '../types/hospital';

export interface SidebarNavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badgeCount?: number;
}

interface DashboardLayoutProps {
  portalTitle: string;
  breadcrumb: string;
  navItems: SidebarNavItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}

export function DashboardLayout({
  portalTitle,
  breadcrumb,
  navItems,
  activeTab,
  onTabChange,
  headerAction,
  children,
}: DashboardLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifDrawerOpen, setNotifDrawerOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.notifications.list();
      setNotifications(res.notifications);
    } catch {
      // Silent ignore during polling
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
    const timer = window.setInterval(() => {
      void loadNotifications();
    }, 15000);
    return () => window.clearInterval(timer);
  }, [loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleMarkRead = async (id: string) => {
    await api.notifications.markRead(id);
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const handleMarkAllRead = async () => {
    await api.notifications.markAllRead();
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const handleSignOut = async () => {
    await logout();
    navigate('/login');
  };

  const sidebarContent = (
    <div className="flex flex-col h-full bg-white border-r border-slate-200">
      <div className="px-5 py-5 border-b border-slate-200">
        <Link to="/" className="flex items-center gap-2.5 text-slate-900">
          <div className="w-8 h-8 rounded-lg bg-[#0F4C81] text-white flex items-center justify-center shrink-0">
            <Cross className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <span className="block text-sm font-bold tracking-tight text-slate-900 truncate">
              FUDMA HEALTHCENTER
            </span>
            <span className="block text-xs text-slate-500 truncate">{portalTitle}</span>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Portal navigation">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onTabChange(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </span>
              {typeof item.badgeCount === 'number' && item.badgeCount > 0 && (
                <span
                  className={`font-mono tabular-nums text-xs px-1.5 py-0.5 rounded ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-800'
                  }`}
                >
                  {item.badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-200 bg-slate-50/70">
        <div className="mb-3">
          <p className="text-sm font-semibold text-slate-900 truncate">{user?.full_name}</p>
          <p className="text-xs text-slate-500 truncate">
            {user ? getRoleLabel(user.role) : ''} · {user?.email}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign Out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">
            {sidebarContent}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="absolute top-4 right-3 p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 hidden sm:inline">FUDMA Healthcenter</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 truncate">{breadcrumb}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {headerAction}
            <button
              type="button"
              onClick={() => {
                setNotifDrawerOpen((v) => !v);
                void loadNotifications();
              }}
              className="relative p-2 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors"
              aria-label="Toggle notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded bg-[#0D9488] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                  {unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* Notifications Slide-down Panel */}
        {notifDrawerOpen && (
          <div className="fixed inset-0 z-40" onClick={() => setNotifDrawerOpen(false)}>
            <div
              className="absolute right-4 sm:right-6 top-16 w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">
                  Notifications ({unreadCount} unread)
                </h3>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#0369A1] hover:underline"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      Mark all read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNotifDrawerOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-700"
                    aria-label="Close notifications"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
                {notifications.length === 0 ? (
                  <p className="p-6 text-sm text-slate-500 text-center">No notifications yet.</p>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => !n.is_read && handleMarkRead(n.id)}
                      className={`p-3.5 cursor-pointer transition-colors ${
                        n.is_read ? 'bg-white' : 'bg-sky-50/60 hover:bg-sky-50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900">{n.title}</p>
                        <span className="text-[11px] font-mono text-slate-400 shrink-0">
                          {new Date(n.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{n.message}</p>
                      {!n.is_read && (
                        <span className="inline-block mt-1.5 text-[11px] font-medium text-[#0369A1]">
                          Click to mark read
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

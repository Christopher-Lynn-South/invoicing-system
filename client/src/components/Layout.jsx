import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import useOrderStore from '../store/useOrderStore';
import api from '../lib/api';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', exact: true, icon: '⊞' },
  { to: '/orders', label: 'Orders', icon: '📋' },
  { to: '/invoices', label: 'Invoices', icon: '🧾' },
  { to: '/reminders', label: 'Reminders', icon: '🔔' },
  { to: '/patients', label: 'Patients', icon: '👤' },
  { to: '/products', label: 'Products', icon: '📦' },
  { to: '/analytics', label: 'Analytics', icon: '📈' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
  { to: '/import', label: 'Import', icon: '📥' },
];

export default function Layout() {
  const user = useOrderStore(s => s.user);
  const setUser = useOrderStore(s => s.setUser);
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  async function handleLogout() {
    await api.post('/auth/logout');
    setUser(null);
    navigate('/login');
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sidebar */}
      <aside style={{
        width: sidebarOpen ? 220 : 60,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.2s',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>🌊</span>
          {sidebarOpen && <span style={{ fontFamily: 'var(--brand-serif)', fontSize: 18, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>OrderFlow</span>}
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 8px', overflowY: 'auto' }}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              style={({ isActive }) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                margin: '2px 0',
                borderRadius: 8,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                background: isActive ? 'var(--accent-light)' : 'transparent',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                whiteSpace: 'nowrap',
                transition: 'background 0.15s, color 0.15s',
              })}
            >
              <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
              {sidebarOpen && item.label}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
          {sidebarOpen && <div style={{ color: 'var(--text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email}</div>}
          <button onClick={handleLogout} style={{
            background: 'transparent', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px',
            fontSize: 12, width: '100%',
          }}>
            {sidebarOpen ? 'Sign Out' : '↩'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <header style={{
          padding: '14px 24px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 18, padding: '4px 8px' }}
          >
            ☰
          </button>
          <span style={{ fontFamily: 'var(--brand-mono)', fontSize: 13, color: 'var(--text-muted)' }}>Corp 001 Inc.</span>
        </header>

        <div style={{ flex: 1, overflow: 'auto', padding: '24px' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

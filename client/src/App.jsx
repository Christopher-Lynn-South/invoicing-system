import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import useOrderStore from './store/useOrderStore';
import api from './lib/api';

import Layout from './components/Layout';
import Toast from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Invoices from './pages/Invoices';
import Reminders from './pages/Reminders';
import Patients from './pages/Patients';
import PatientDetail from './pages/PatientDetail';
import Products from './pages/Products';
import Settings from './pages/Settings';
import PayPage from './pages/PayPage';

function RequireAuth({ children }) {
  const user = useOrderStore(s => s.user);
  if (user === undefined) return null;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const setUser = useOrderStore(s => s.setUser);
  const toasts = useOrderStore(s => s.toasts);
  const removeToast = useOrderStore(s => s.removeToast);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    api.get('/auth/me')
      .then(res => {
        if (res.data.authenticated) setUser(res.data);
        else setUser(null);
      })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
        <div style={{ color: 'var(--text-secondary)', fontFamily: 'var(--brand-mono)' }}>Loading OrderFlow…</div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Toast toasts={toasts} removeToast={removeToast} />
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/pay/:invoiceId" element={<PayPage />} />

        {/* Protected routes */}
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Dashboard />} />
          <Route path="orders" element={<Orders />} />
          <Route path="orders/:id" element={<OrderDetail />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="reminders" element={<Reminders />} />
          <Route path="patients" element={<Patients />} />
          <Route path="patients/:id" element={<PatientDetail />} />
          <Route path="products" element={<Products />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

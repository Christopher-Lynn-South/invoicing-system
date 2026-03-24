import { create } from 'zustand';
import api from '../lib/api';

const useOrderStore = create((set, get) => ({
  // Auth
  user: null,
  setUser: (user) => set({ user }),

  // Orders
  orders: [],
  ordersLoading: false,
  fetchOrders: async (params = {}) => {
    set({ ordersLoading: true });
    try {
      const res = await api.get('/orders', { params });
      set({ orders: res.data, ordersLoading: false });
    } catch { set({ ordersLoading: false }); }
  },

  // Patients
  patients: [],
  fetchPatients: async () => {
    const res = await api.get('/patients');
    set({ patients: res.data });
  },

  // Products
  products: [],
  fetchProducts: async () => {
    const res = await api.get('/products');
    set({ products: res.data });
  },

  // Invoices
  invoices: [],
  fetchInvoices: async () => {
    const res = await api.get('/invoices');
    set({ invoices: res.data });
  },

  // Reminders
  reminders: [],
  fetchReminders: async () => {
    const res = await api.get('/reminders');
    set({ reminders: res.data });
  },

  // Toast notifications
  toasts: [],
  addToast: (message, type = 'info') => {
    const id = Date.now();
    set(s => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), 4000);
  },
  removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}));

export default useOrderStore;

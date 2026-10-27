const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'Cannot reach Chula right now. Check your connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.error || `Request failed (${response.status})`);
  return data;
}

export const api = {
  health: (opts) => request('/api/health', opts),
  listBags: ({ district, ...opts } = {}) =>
    request(`/api/bags${district ? `?district=${encodeURIComponent(district)}` : ''}`, opts),
  getBag: (id, opts) => request(`/api/bags/${id}`, opts),
  listOrders: (headers, opts) => request('/api/orders', { headers, ...opts }),
  getOrder: (id, headers, opts) => request(`/api/orders/${id}`, { headers, ...opts }),
  cancelOrder: (id, headers) => request(`/api/orders/${id}/cancel`, { method: 'POST', headers }),
  stkPush: (payload, headers) => request('/api/payments/stk-push', { method: 'POST', body: payload, headers }),
  simulatorMerchants: () => request('/api/whatsapp/simulator/merchants'),
  simulateWhatsApp: (payload) => request('/api/whatsapp/simulate', { method: 'POST', body: payload }),
};

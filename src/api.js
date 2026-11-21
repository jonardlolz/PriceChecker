const TOKEN_KEY = 'pc_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

// Fired when the server rejects our session, so the app can show the sign-in screen.
export const SIGNED_OUT_EVENT = 'pc:signed-out';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.fieldErrors = body?.errors || {};
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) {
      setToken(null);
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    throw new ApiError(res.status, data);
  }
  return data;
}

const q = (params) => new URLSearchParams(params).toString();

export const api = {
  config: () => request('/api/config'),
  signup: (body) => request('/api/auth/signup', { method: 'POST', body }),
  login: (body) => request('/api/auth/login', { method: 'POST', body }),
  me: () => request('/api/me'),

  lookup: (barcode) => request(`/api/lookup/${encodeURIComponent(barcode)}`),
  listProducts: ({ q: search = '', pricedOnly = false, limit } = {}) =>
    request(`/api/products?${q({ q: search, ...(pricedOnly && { priced: '1' }), ...(limit && { limit }) })}`),
  similarProducts: (name) => request(`/api/products/similar?${q({ name })}`),
  createProduct: (p) => request('/api/products', { method: 'POST', body: p }),
  setPrice: (id, price) => request(`/api/products/${id}/price`, { method: 'PUT', body: { price } }),
  clearPrice: (id) => request(`/api/products/${id}/price`, { method: 'DELETE' }),
  favorites: () => request('/api/favorites'),
  setFavorite: (id, on) => request(`/api/products/${id}/favorite`, { method: on ? 'PUT' : 'DELETE' }),

  // Admin only
  updateProduct: (id, p) => request(`/api/products/${id}`, { method: 'PUT', body: p }),
  deleteProduct: (id) => request(`/api/products/${id}`, { method: 'DELETE' }),
};

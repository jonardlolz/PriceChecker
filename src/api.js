const TOKEN_KEY = 'pc_admin_token';

export const getToken = () => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (t) => {
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
};

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `Request failed (${status})`);
    this.status = status;
    this.fieldErrors = body?.errors || {};
  }
}

async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) headers.Authorization = `Bearer ${getToken()}`;

  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (auth && res.status === 401) setToken(null);
    throw new ApiError(res.status, data);
  }
  return data;
}

export const api = {
  config: () => request('/api/config'),
  lookup: (barcode) => request(`/api/lookup/${encodeURIComponent(barcode)}`),
  login: (password) => request('/api/login', { method: 'POST', body: { password } }),
  listProducts: (q = '') => request(`/api/admin/products?q=${encodeURIComponent(q)}`, { auth: true }),
  createProduct: (p) => request('/api/admin/products', { method: 'POST', body: p, auth: true }),
  updateProduct: (id, p) => request(`/api/admin/products/${id}`, { method: 'PUT', body: p, auth: true }),
  deleteProduct: (id) => request(`/api/admin/products/${id}`, { method: 'DELETE', auth: true }),
};

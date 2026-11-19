import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import * as db from './db.js';

const PORT = Number(process.env.PORT) || 3000;
// Set HOST=127.0.0.1 when serving through Cloudflare Tunnel so only the tunnel can reach the app.
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const CURRENCY = process.env.CURRENCY || 'PHP';

if (!process.env.ADMIN_PASSWORD) {
  console.warn('[warn] ADMIN_PASSWORD not set — using default "admin". Set it before deploying.');
}

const app = express();
app.use(express.json());

// ---------- Auth (stateless HMAC-signed token) ----------
const sign = (payload) => crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');

const issueToken = () => {
  const payload = String(Date.now() + TOKEN_TTL_MS);
  return `${payload}.${sign(payload)}`;
};

const verifyToken = (token = '') => {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) && Number(payload) > Date.now();
};

const requireAdmin = (req, res, next) => {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!verifyToken(token)) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

// ---------- Validation ----------
function parseProduct(body = {}) {
  const errors = {};
  const productId = String(body.productId ?? '').trim();
  const barcode = String(body.barcode ?? '').trim();
  const productName = String(body.productName ?? '').trim();
  const priceRaw = String(body.price ?? '').trim();

  if (!productId) errors.productId = 'Product ID is required';
  else if (productId.length > 64) errors.productId = 'Product ID is too long';

  if (!barcode) errors.barcode = 'Barcode is required';
  else if (!/^[\x21-\x7E]{1,128}$/.test(barcode)) errors.barcode = 'Barcode contains invalid characters';

  if (!productName) errors.productName = 'Product name is required';
  else if (productName.length > 200) errors.productName = 'Product name is too long';

  if (!/^\d+(\.\d{1,2})?$/.test(priceRaw)) errors.price = 'Price must be a non-negative number with up to 2 decimals';

  const [whole, frac = ''] = priceRaw.split('.');
  const priceCents = Number(whole) * 100 + Number(frac.padEnd(2, '0') || 0);

  return { errors, value: { productId, barcode, productName, priceCents } };
}

function handleDbError(err, res) {
  const msg = String(err?.message || '');
  if (msg.includes('UNIQUE constraint failed: products.barcode')) {
    return res.status(409).json({ errors: { barcode: 'This barcode is already assigned to another product' } });
  }
  if (msg.includes('UNIQUE constraint failed: products.product_id')) {
    return res.status(409).json({ errors: { productId: 'This Product ID already exists' } });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
}

const parseDbId = (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid id' });
    return null;
  }
  return id;
};

// ---------- Public routes ----------
app.get('/api/config', (_req, res) => res.json({ currency: CURRENCY }));

app.get('/api/lookup/:barcode', (req, res) => {
  const product = db.findByBarcode(req.params.barcode.trim());
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const { productId, barcode, productName, price } = product;
  res.json({ productId, barcode, productName, price });
});

// Brute-force protection: max 5 failed logins per client per 15 minutes.
const LOGIN_MAX_FAILS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFails = new Map(); // clientKey -> { count, resetAt }

// Behind Cloudflare Tunnel every request arrives from localhost; Cloudflare puts the
// real visitor IP in CF-Connecting-IP (trustworthy only when HOST=127.0.0.1).
const clientKey = (req) => req.get('cf-connecting-ip') || req.ip;

app.post('/api/login', (req, res) => {
  const key = clientKey(req);
  const now = Date.now();
  let entry = loginFails.get(key);
  if (entry && entry.resetAt <= now) {
    loginFails.delete(key);
    entry = undefined;
  }
  if (entry && entry.count >= LOGIN_MAX_FAILS) {
    const mins = Math.ceil((entry.resetAt - now) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
  }

  const password = String(req.body?.password ?? '');
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    if (entry) entry.count += 1;
    else loginFails.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return res.status(401).json({ error: 'Incorrect password' });
  }
  loginFails.delete(key);
  res.json({ token: issueToken() });
});

// ---------- Admin routes ----------
const admin = express.Router();
admin.use(requireAdmin);

admin.get('/products', (req, res) => {
  res.json(db.listProducts(String(req.query.q ?? '').trim()));
});

admin.post('/products', (req, res) => {
  const { errors, value } = parseProduct(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  try {
    res.status(201).json(db.createProduct(value));
  } catch (err) {
    handleDbError(err, res);
  }
});

admin.put('/products/:id', (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  const { errors, value } = parseProduct(req.body);
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  try {
    const updated = db.updateProduct(id, value);
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    res.json(updated);
  } catch (err) {
    handleDbError(err, res);
  }
});

admin.delete('/products/:id', (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  if (!db.deleteProduct(id)) return res.status(404).json({ error: 'Product not found' });
  res.status(204).end();
});

app.use('/api/admin', admin);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Static frontend (production build) ----------
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, HOST, () => console.log(`Price Checker running on http://${HOST}:${PORT}`));

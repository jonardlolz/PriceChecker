import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { promisify } from 'node:util';
import * as db from './db.js';

const PORT = Number(process.env.PORT) || 3000;
// Set HOST=127.0.0.1 when serving through Cloudflare Tunnel so only the tunnel can reach the app.
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'admin').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_SECRET = process.env.TOKEN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — tinderas stay signed in on their device
const CURRENCY = process.env.CURRENCY || 'PHP';

if (!process.env.TOKEN_SECRET) {
  console.warn('[warn] TOKEN_SECRET not set — everyone will be signed out on every restart.');
}

// ---------- Passwords (scrypt, built into Node) ----------
const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Used when the username doesn't exist, so a failed login takes the same time either way.
const DUMMY_HASH = await hashPassword(crypto.randomBytes(16).toString('hex'));

// ---------- Admin account bootstrap + DB migration ----------
async function bootstrapAdmin() {
  if (!ADMIN_PASSWORD) {
    console.warn('[warn] ADMIN_PASSWORD not set — no admin account. Shared products cannot be edited or deleted.');
    return null;
  }
  const existing = db.findUserForLogin(ADMIN_USERNAME);
  if (!existing) {
    const user = db.createUser({
      username: ADMIN_USERNAME,
      storeName: 'Admin',
      passwordHash: await hashPassword(ADMIN_PASSWORD),
      isAdmin: true,
    });
    console.log(`[auth] Created admin account "${ADMIN_USERNAME}" (password = ADMIN_PASSWORD).`);
    return user.id;
  }
  if (!existing.user.isAdmin) {
    // Only promote if it's really ours — never hand admin rights to someone who registered this name.
    if (await verifyPassword(ADMIN_PASSWORD, existing.passwordHash)) db.makeAdmin(existing.user.id);
    else {
      console.warn(`[warn] User "${ADMIN_USERNAME}" exists but is not an admin and its password doesn't match ADMIN_PASSWORD. Not promoting it.`);
      return null;
    }
  }
  return existing.user.id;
}

db.migrate(await bootstrapAdmin());

const app = express();
app.use(express.json());

// ---------- Session tokens (stateless, HMAC-signed: "<userId>.<expiry>.<sig>") ----------
const sign = (payload) => crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');

const issueToken = (userId) => {
  const payload = `${userId}.${Date.now() + TOKEN_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
};

/** Returns the user id from a valid, unexpired token, else null. */
const verifyToken = (token = '') => {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const expected = Buffer.from(sign(`${uid}.${exp}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (!(Number(exp) > Date.now())) return null;
  return Number(uid);
};

const requireUser = (req, res, next) => {
  const uid = verifyToken(req.get('authorization')?.replace(/^Bearer\s+/i, ''));
  const user = uid && db.findUserById(uid); // re-read so deleted users / admin changes apply immediately
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Only the admin can change shared products' });
  next();
};

// ---------- Rate limiting (in memory, per client IP) ----------
// Behind Cloudflare Tunnel every request arrives from localhost; Cloudflare puts the
// real visitor IP in CF-Connecting-IP (trustworthy only when HOST=127.0.0.1).
const clientKey = (req) => req.get('cf-connecting-ip') || req.ip;

function createLimiter(max, windowMs) {
  const hits = new Map(); // key -> { count, resetAt }
  const current = (key, now = Date.now()) => {
    const e = hits.get(key);
    if (e && e.resetAt <= now) hits.delete(key);
    return hits.get(key);
  };
  return {
    /** Minutes until allowed again, or 0 if not blocked. */
    blockedFor(key) {
      const e = current(key);
      return e && e.count >= max ? Math.ceil((e.resetAt - Date.now()) / 60000) : 0;
    },
    hit(key) {
      const now = Date.now();
      if (hits.size > 10000) for (const k of hits.keys()) current(k, now); // prune expired entries
      const e = current(key, now);
      if (e) e.count += 1;
      else hits.set(key, { count: 1, resetAt: now + windowMs });
    },
    reset: (key) => hits.delete(key),
  };
}

const loginLimiter = createLimiter(5, 15 * 60 * 1000); // 5 failed logins / 15 min
const signupLimiter = createLimiter(5, 60 * 60 * 1000); // 5 new accounts / hour

const tooMany = (res, mins) =>
  res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });

// ---------- Validation ----------
const has = (errors) => Object.keys(errors).length > 0;

function parsePrice(raw, errors, { required }) {
  const s = String(raw ?? '').trim();
  if (!s) {
    if (required) errors.price = 'Price is required';
    return null;
  }
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) {
    errors.price = 'Price must be a non-negative number with up to 2 decimals';
    return null;
  }
  const [whole, frac = ''] = s.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

function parseProduct(body = {}, { withPrice }) {
  const errors = {};
  const productId = String(body.productId ?? '').trim();
  const barcode = String(body.barcode ?? '').trim();
  const productName = String(body.productName ?? '').trim();

  if (!productId) errors.productId = 'Product ID is required';
  else if (productId.length > 64) errors.productId = 'Product ID is too long';

  if (!barcode) errors.barcode = 'Barcode is required';
  else if (!/^[\x21-\x7E]{1,128}$/.test(barcode)) errors.barcode = 'Barcode contains invalid characters';

  if (!productName) errors.productName = 'Product name is required';
  else if (productName.length > 200) errors.productName = 'Product name is too long';

  const priceCents = withPrice ? parsePrice(body.price, errors, { required: false }) : null;
  return { errors, value: { productId, barcode, productName, priceCents } };
}

function parseSignup(body = {}) {
  const errors = {};
  const username = String(body.username ?? '').trim();
  const storeName = String(body.storeName ?? '').trim();
  const password = String(body.password ?? '');

  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username))
    errors.username = '3–32 characters: letters, numbers, dot, dash or underscore';
  if (!storeName) errors.storeName = 'Store name is required';
  else if (storeName.length > 80) errors.storeName = 'Store name is too long';
  if (password.length < 8) errors.password = 'Use at least 8 characters';
  else if (password.length > 200) errors.password = 'Password is too long';

  return { errors, value: { username, storeName, password } };
}

function handleDbError(err, res) {
  const msg = String(err?.message || '');
  if (msg.includes('UNIQUE constraint failed: products.barcode')) {
    return res.status(409).json({ errors: { barcode: 'This barcode is already assigned to another product' } });
  }
  if (msg.includes('UNIQUE constraint failed: products.product_id')) {
    return res.status(409).json({ errors: { productId: 'This Product ID already exists' } });
  }
  if (msg.includes('UNIQUE constraint failed: users.username')) {
    return res.status(409).json({ errors: { username: 'This username is already taken' } });
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

app.post('/api/auth/signup', async (req, res) => {
  const key = clientKey(req);
  const mins = signupLimiter.blockedFor(key);
  if (mins) return tooMany(res, mins);

  const { errors, value } = parseSignup(req.body);
  if (has(errors)) return res.status(400).json({ errors });
  if (db.findUserForLogin(value.username)) {
    return res.status(409).json({ errors: { username: 'This username is already taken' } });
  }
  try {
    const user = db.createUser({
      username: value.username,
      storeName: value.storeName,
      passwordHash: await hashPassword(value.password),
    });
    signupLimiter.hit(key);
    res.status(201).json({ token: issueToken(user.id), user });
  } catch (err) {
    handleDbError(err, res);
  }
});

app.post('/api/auth/login', async (req, res) => {
  const key = clientKey(req);
  const mins = loginLimiter.blockedFor(key);
  if (mins) return tooMany(res, mins);

  const username = String(req.body?.username ?? '').trim();
  const password = String(req.body?.password ?? '');
  const found = username ? db.findUserForLogin(username) : null;
  const ok = await verifyPassword(password, found?.passwordHash ?? DUMMY_HASH);
  if (!found || !ok) {
    loginLimiter.hit(key);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  loginLimiter.reset(key);
  res.json({ token: issueToken(found.user.id), user: found.user });
});

// ---------- Signed-in store routes ----------
const store = express.Router();
store.use(requireUser);

store.get('/me', (req, res) => res.json(req.user));

// Look up a scanned barcode: the shared product plus *this store's* price (null if not set).
store.get('/lookup/:barcode', (req, res) => {
  const product = db.findByBarcode(req.user.id, req.params.barcode.trim());
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

store.get('/products', (req, res) => {
  res.json(
    db.listProducts(req.user.id, {
      q: String(req.query.q ?? '').trim(),
      pricedOnly: req.query.priced === '1',
    })
  );
});

// Any store may add a new shared product (and set its own price in the same step).
store.post('/products', (req, res) => {
  const { errors, value } = parseProduct(req.body, { withPrice: true });
  if (has(errors)) return res.status(400).json({ errors });
  try {
    res.status(201).json(db.createProduct(req.user.id, value));
  } catch (err) {
    handleDbError(err, res);
  }
});

store.put('/products/:id/price', (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  const errors = {};
  const priceCents = parsePrice(req.body?.price, errors, { required: true });
  if (has(errors)) return res.status(400).json({ errors });
  const product = db.setPrice(req.user.id, id, priceCents);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

store.delete('/products/:id/price', (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  db.clearPrice(req.user.id, id);
  res.status(204).end();
});

// Only the admin may edit or delete shared products (affects every store).
store.put('/products/:id', requireAdmin, (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  const { errors, value } = parseProduct(req.body, { withPrice: false });
  if (has(errors)) return res.status(400).json({ errors });
  try {
    const updated = db.updateProduct(req.user.id, id, value);
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    res.json(updated);
  } catch (err) {
    handleDbError(err, res);
  }
});

store.delete('/products/:id', requireAdmin, (req, res) => {
  const id = parseDbId(req, res);
  if (id === null) return;
  if (!db.deleteProduct(id)) return res.status(404).json({ error: 'Product not found' });
  res.status(204).end();
});

app.use('/api', store);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---------- Static frontend (production build) ----------
const distDir = path.resolve('dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.listen(PORT, HOST, () => console.log(`Price Checker running on http://${HOST}:${PORT}`));

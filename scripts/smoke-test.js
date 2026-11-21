// End-to-end smoke test: starts the real server on a throwaway database and exercises the API.
// Used by CI (`npm test`). Run `npm run build` first to also check the frontend is served.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricechecker-test-'));
const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn(process.execPath, ['server.js'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DB_PATH: path.join(dir, 'test.db'),
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: 'admin-test-password',
    TOKEN_SECRET: 'test-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (d) => (logs += d));
server.stderr.on('data', (d) => (logs += d));

const cleanup = () => {
  server.kill();
  fs.rmSync(dir, { recursive: true, force: true });
};

async function call(method, url, { token, body } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, data };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/config`)).ok) return;
    } catch { /* not up yet */ }
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Server did not start');
}

const steps = [];
const step = (name, fn) => steps.push({ name, fn });
const ctx = {};

step('config is public', async () => {
  const r = await call('GET', '/api/config');
  assert.equal(r.status, 200);
  assert.ok(r.data.currency);
});
step('API requires sign-in', async () => {
  assert.equal((await call('GET', '/api/products')).status, 401);
});
step('admin can log in', async () => {
  const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'admin-test-password' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.isAdmin, true);
  ctx.admin = r.data.token;
});
step('wrong password is rejected', async () => {
  const r = await call('POST', '/api/auth/login', { body: { username: 'admin', password: 'nope' } });
  assert.equal(r.status, 401);
});
step('store can sign up', async () => {
  const r = await call('POST', '/api/auth/signup', {
    body: { username: 'tindera', password: 'tindera-pass', storeName: 'Test Store' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.isAdmin, false);
  ctx.store = r.data.token;
});
step('store adds a product with a barcode and price', async () => {
  const r = await call('POST', '/api/products', {
    token: ctx.store,
    body: { productName: 'Kopiko Brown', barcode: '4800000000017', price: '8.50' },
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.price, 8.5);
  ctx.productId = r.data.id;
});
step('store adds a loose item without a barcode', async () => {
  const r = await call('POST', '/api/products', { token: ctx.store, body: { productName: 'Itlog, per piece' } });
  assert.equal(r.status, 201);
  assert.equal(r.data.barcode, null);
});
step('duplicate barcode is rejected', async () => {
  const r = await call('POST', '/api/products', {
    token: ctx.store,
    body: { productName: 'Other', barcode: '4800000000017' },
  });
  assert.equal(r.status, 409);
});
step('prices are per store', async () => {
  const mine = await call('GET', '/api/lookup/4800000000017', { token: ctx.store });
  const admin = await call('GET', '/api/lookup/4800000000017', { token: ctx.admin });
  assert.equal(mine.data.price, 8.5);
  assert.equal(admin.data.price, null);
  const set = await call('PUT', `/api/products/${ctx.productId}/price`, { token: ctx.admin, body: { price: '9' } });
  assert.equal(set.data.price, 9);
  assert.equal((await call('GET', '/api/lookup/4800000000017', { token: ctx.store })).data.price, 8.5);
});
step('name search and "did you mean"', async () => {
  const search = await call('GET', '/api/products?q=itlog&limit=5', { token: ctx.store });
  assert.equal(search.data.length, 1);
  const similar = await call('GET', '/api/products/similar?name=itlog%20large', { token: ctx.store });
  assert.equal(similar.data[0].productName, 'Itlog, per piece');
});
step('quick picks', async () => {
  assert.equal((await call('PUT', `/api/products/${ctx.productId}/favorite`, { token: ctx.store })).status, 200);
  const favs = await call('GET', '/api/favorites', { token: ctx.store });
  assert.deepEqual(favs.data.map((p) => p.id), [ctx.productId]);
  assert.equal((await call('GET', '/api/favorites', { token: ctx.admin })).data.length, 0);
});
step('only admin can edit or delete shared products', async () => {
  const body = { productName: 'Renamed', barcode: '4800000000017' };
  assert.equal((await call('PUT', `/api/products/${ctx.productId}`, { token: ctx.store, body })).status, 403);
  assert.equal((await call('DELETE', `/api/products/${ctx.productId}`, { token: ctx.store })).status, 403);
  assert.equal((await call('PUT', `/api/products/${ctx.productId}`, { token: ctx.admin, body })).status, 200);
  assert.equal((await call('DELETE', `/api/products/${ctx.productId}`, { token: ctx.admin })).status, 204);
  assert.equal((await call('GET', '/api/favorites', { token: ctx.store })).data.length, 0);
});
step('frontend is served (if built)', async () => {
  if (!fs.existsSync('dist/index.html')) return 'skipped — run `npm run build` first';
  const r = await call('GET', '/products');
  assert.equal(r.status, 200);
  assert.match(String(r.data), /<div id="root">/);
});

let failed = 0;
try {
  await waitForServer();
  for (const { name, fn } of steps) {
    try {
      const note = await fn();
      console.log(`  ✓ ${name}${note ? ` (${note})` : ''}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${name}\n    ${err.message.split('\n').join('\n    ')}`);
    }
  }
} catch (err) {
  failed++;
  console.log(`  ✗ ${err.message}`);
}
if (failed) console.log(`\nServer output:\n${logs}`);
console.log(failed ? `\n${failed} check(s) failed` : `\nAll ${steps.length} checks passed`);
cleanup();
process.exit(failed ? 1 : 0);

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('data', 'pricechecker.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Data model
// - users:        one row per tindahan (store) account. `is_admin` users may edit/delete shared products.
// - products:     the shared, global catalog (same for every store). No prices here.
// - store_prices: each store's own price for a product (integer cents to avoid rounding errors).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    store_name    TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Older versions stored a single price directly on `products`. Move those rows to the new
// layout once; their prices are given to `legacyOwnerId` (the admin) when known.
export function migrate(legacyOwnerId) {
  const cols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
  const legacy = cols.includes('price_cents');

  db.exec('BEGIN');
  try {
    if (legacy) db.exec('ALTER TABLE products RENAME TO products_legacy');
    db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id   TEXT    NOT NULL UNIQUE,
        barcode      TEXT    NOT NULL UNIQUE,
        product_name TEXT    NOT NULL,
        created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS store_prices (
        user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS store_prices_product ON store_prices(product_id);
    `);
    if (legacy) {
      db.exec(`
        INSERT INTO products (id, product_id, barcode, product_name, created_at, updated_at)
        SELECT id, product_id, barcode, product_name, created_at, updated_at FROM products_legacy`);
      if (legacyOwnerId != null) {
        db.prepare(`
          INSERT INTO store_prices (user_id, product_id, price_cents)
          SELECT $owner, id, price_cents FROM products_legacy`).run({ owner: legacyOwnerId });
      }
      const { n } = db.prepare('SELECT count(*) AS n FROM products_legacy').get();
      db.exec('DROP TABLE products_legacy');
      console.log(`[db] Migrated ${n} product(s) to the multi-store layout.`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  stmts = prepareProductStmts();
}

// ---------- Users ----------
const toUser = (row) =>
  row && {
    id: row.id,
    username: row.username,
    storeName: row.store_name,
    isAdmin: !!row.is_admin,
    createdAt: row.created_at,
  };

const userStmts = {
  byId: db.prepare('SELECT * FROM users WHERE id = $id'),
  byUsername: db.prepare('SELECT * FROM users WHERE username = $username'),
  insert: db.prepare(`
    INSERT INTO users (username, store_name, password_hash, is_admin)
    VALUES ($username, $storeName, $passwordHash, $isAdmin)`),
  makeAdmin: db.prepare('UPDATE users SET is_admin = 1 WHERE id = $id'),
};

export const findUserById = (id) => toUser(userStmts.byId.get({ id }));

/** Returns the user plus its password hash (for login checks only). */
export const findUserForLogin = (username) => {
  const row = userStmts.byUsername.get({ username });
  return row && { user: toUser(row), passwordHash: row.password_hash };
};

export const createUser = ({ username, storeName, passwordHash, isAdmin = false }) => {
  const { lastInsertRowid } = userStmts.insert.run({ username, storeName, passwordHash, isAdmin: isAdmin ? 1 : 0 });
  return findUserById(Number(lastInsertRowid));
};

export const makeAdmin = (id) => userStmts.makeAdmin.run({ id });

// ---------- Products (shared) + this store's price ----------
// Every product query is made "as" a store: `price` is that store's price, or null if not set.
const PRODUCT_COLUMNS = `
  p.id, p.product_id, p.barcode, p.product_name, p.created_at, p.updated_at,
  sp.price_cents, sp.updated_at AS price_updated_at`;
const PRODUCT_FROM = `
  FROM products p
  LEFT JOIN store_prices sp ON sp.product_id = p.id AND sp.user_id = $userId`;

const toProduct = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    barcode: row.barcode,
    productName: row.product_name,
    price: row.price_cents == null ? null : row.price_cents / 100,
    priceUpdatedAt: row.price_updated_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

// Prepared by migrate(), once the tables are guaranteed to exist.
let stmts;
const prepareProductStmts = () => ({
  byBarcode: db.prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.barcode = $barcode`),
  byId: db.prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.id = $id`),
  list: db.prepare(`
    SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
    WHERE ($q = '' OR p.barcode LIKE $like OR p.product_id LIKE $like OR p.product_name LIKE $like)
      AND ($pricedOnly = 0 OR sp.price_cents IS NOT NULL)
    ORDER BY p.product_name COLLATE NOCASE
    LIMIT 500`),
  insert: db.prepare(`
    INSERT INTO products (product_id, barcode, product_name, created_by)
    VALUES ($productId, $barcode, $productName, $createdBy)`),
  update: db.prepare(`
    UPDATE products
    SET product_id = $productId, barcode = $barcode, product_name = $productName, updated_at = datetime('now')
    WHERE id = $id`),
  remove: db.prepare('DELETE FROM products WHERE id = $id'),
  setPrice: db.prepare(`
    INSERT INTO store_prices (user_id, product_id, price_cents) VALUES ($userId, $productId, $priceCents)
    ON CONFLICT (user_id, product_id) DO UPDATE SET price_cents = excluded.price_cents, updated_at = datetime('now')`),
  clearPrice: db.prepare('DELETE FROM store_prices WHERE user_id = $userId AND product_id = $productId'),
});

export const findByBarcode = (userId, barcode) => toProduct(stmts.byBarcode.get({ userId, barcode }));
export const findById = (userId, id) => toProduct(stmts.byId.get({ userId, id }));

export const listProducts = (userId, { q = '', pricedOnly = false } = {}) => {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return stmts.list.all({ userId, q, like, pricedOnly: pricedOnly ? 1 : 0 }).map(toProduct);
};

/** Adds a shared product and, optionally, the creating store's price — atomically. */
export const createProduct = (userId, { productId, barcode, productName, priceCents }) => {
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = stmts.insert.run({ productId, barcode, productName, createdBy: userId });
    const id = Number(lastInsertRowid);
    if (priceCents != null) stmts.setPrice.run({ userId, productId: id, priceCents });
    db.exec('COMMIT');
    return findById(userId, id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const updateProduct = (userId, id, { productId, barcode, productName }) => {
  const { changes } = stmts.update.run({ id, productId, barcode, productName });
  return changes ? findById(userId, id) : null;
};

export const deleteProduct = (id) => stmts.remove.run({ id }).changes > 0;

/** Sets this store's price. Returns the product, or null if it doesn't exist. */
export const setPrice = (userId, id, priceCents) => {
  if (!findById(userId, id)) return null;
  stmts.setPrice.run({ userId, productId: id, priceCents });
  return findById(userId, id);
};

export const clearPrice = (userId, id) => stmts.clearPrice.run({ userId, productId: id }).changes > 0;

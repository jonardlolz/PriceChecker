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

const productsTableSql = (name) => `
  CREATE TABLE ${name} (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode      TEXT    UNIQUE,  -- optional: loose (tingi) items have none; NULLs don't clash
    product_name TEXT    NOT NULL,
    created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  )`;

// Brings any older database up to the current layout. Product `id`s are always kept,
// so every store's prices stay attached to the right product.
//   v1: products had a single `price_cents` and a `product_id` code → prices go to `legacyOwnerId` (the admin)
//   v2: products had a `product_id` code (now removed; `id` identifies a product)
//   v3: `barcode` was required (now optional)
export function migrate(legacyOwnerId) {
  const info = db.prepare('PRAGMA table_info(products)').all();
  const cols = info.map((c) => c.name);
  const singlePrice = cols.includes('price_cents');
  const barcodeRequired = !!info.find((c) => c.name === 'barcode')?.notnull;
  const rebuild = cols.includes('product_id') || singlePrice || barcodeRequired;

  // Rebuilding `products` means dropping it; with foreign keys on, that would cascade-delete
  // every store's prices. This PRAGMA only takes effect outside a transaction.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS store_prices (
        user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS store_prices_product ON store_prices(product_id);

      -- Each store's "quick picks": big buttons on the scanner for items sold all day.
      CREATE TABLE IF NOT EXISTS store_favorites (
        user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        position   INTEGER NOT NULL,
        PRIMARY KEY (user_id, product_id)
      );
      CREATE INDEX IF NOT EXISTS store_favorites_product ON store_favorites(product_id);
    `);

    if (!rebuild) {
      db.exec(productsTableSql('products').replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
    } else {
      // SQLite's recommended way to change a table: create new → copy → drop old → rename.
      const createdBy = cols.includes('created_by') ? 'created_by' : 'NULL';
      db.exec(productsTableSql('products_new'));
      db.exec(`
        INSERT INTO products_new (id, barcode, product_name, created_by, created_at, updated_at)
        SELECT id, NULLIF(trim(barcode), ''), product_name, ${createdBy}, created_at, updated_at FROM products`);
      if (singlePrice && legacyOwnerId != null) {
        db.prepare(`
          INSERT OR IGNORE INTO store_prices (user_id, product_id, price_cents)
          SELECT $owner, id, price_cents FROM products`).run({ owner: legacyOwnerId });
      }
      const { n } = db.prepare('SELECT count(*) AS n FROM products').get();
      db.exec('DROP TABLE products');
      db.exec('ALTER TABLE products_new RENAME TO products');
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length) throw new Error(`Migration left ${broken.length} broken reference(s); rolled back.`);
      console.log(`[db] Migrated ${n} product(s) to the current layout.`);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
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
  p.id, p.barcode, p.product_name, p.created_at, p.updated_at,
  sp.price_cents, sp.updated_at AS price_updated_at, f.position AS favorite_position`;
const PRODUCT_FROM = `
  FROM products p
  LEFT JOIN store_prices sp ON sp.product_id = p.id AND sp.user_id = $userId
  LEFT JOIN store_favorites f ON f.product_id = p.id AND f.user_id = $userId`;

const toProduct = (row) =>
  row && {
    id: row.id,
    barcode: row.barcode,
    productName: row.product_name,
    price: row.price_cents == null ? null : row.price_cents / 100,
    priceUpdatedAt: row.price_updated_at ?? null,
    isFavorite: row.favorite_position != null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export const MAX_FAVORITES = 60;

// Prepared by migrate(), once the tables are guaranteed to exist.
let stmts;
const prepareProductStmts = () => ({
  byBarcode: db.prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.barcode = $barcode`),
  byId: db.prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE p.id = $id`),
  list: db.prepare(`
    SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
    WHERE ($q = '' OR p.barcode LIKE $like OR p.product_name LIKE $like OR CAST(p.id AS TEXT) = $q)
      AND ($pricedOnly = 0 OR sp.price_cents IS NOT NULL)
    ORDER BY p.product_name COLLATE NOCASE
    LIMIT $limit`),
  favorites: db.prepare(`
    SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM}
    WHERE f.position IS NOT NULL
    ORDER BY f.position
    LIMIT ${MAX_FAVORITES}`),
  addFavorite: db.prepare(`
    INSERT OR IGNORE INTO store_favorites (user_id, product_id, position)
    SELECT $userId, $productId, coalesce(max(position), 0) + 1 FROM store_favorites WHERE user_id = $userId`),
  removeFavorite: db.prepare('DELETE FROM store_favorites WHERE user_id = $userId AND product_id = $productId'),
  countFavorites: db.prepare('SELECT count(*) AS n FROM store_favorites WHERE user_id = $userId'),
  insert: db.prepare(`
    INSERT INTO products (barcode, product_name, created_by)
    VALUES ($barcode, $productName, $createdBy)`),
  update: db.prepare(`
    UPDATE products
    SET barcode = $barcode, product_name = $productName, updated_at = datetime('now')
    WHERE id = $id`),
  remove: db.prepare('DELETE FROM products WHERE id = $id'),
  setPrice: db.prepare(`
    INSERT INTO store_prices (user_id, product_id, price_cents) VALUES ($userId, $productId, $priceCents)
    ON CONFLICT (user_id, product_id) DO UPDATE SET price_cents = excluded.price_cents, updated_at = datetime('now')`),
  clearPrice: db.prepare('DELETE FROM store_prices WHERE user_id = $userId AND product_id = $productId'),
});

export const findByBarcode = (userId, barcode) => toProduct(stmts.byBarcode.get({ userId, barcode }));
export const findById = (userId, id) => toProduct(stmts.byId.get({ userId, id }));

export const listProducts = (userId, { q = '', pricedOnly = false, limit = 500 } = {}) => {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return stmts.list.all({ userId, q, like, pricedOnly: pricedOnly ? 1 : 0, limit }).map(toProduct);
};

/**
 * Existing products whose name shares a word with `name` — shown as "Did you mean…?" before
 * adding a product, to avoid duplicates like "Itlog" vs "Itlog (large)" in the shared list.
 */
export const findSimilar = (userId, name, limit = 5) => {
  const words = [...new Set(name.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 6);
  if (!words.length) return [];
  const params = { userId, limit };
  const where = words.map((w, i) => ((params[`w${i}`] = `%${w}%`), `p.product_name LIKE $w${i}`)).join(' OR ');
  // Rank by how many words match, then shortest name (closest) first.
  const score = words.map((_, i) => `(p.product_name LIKE $w${i})`).join(' + ');
  return db
    .prepare(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_FROM} WHERE ${where}
              ORDER BY ${score} DESC, length(p.product_name) LIMIT $limit`)
    .all(params)
    .map(toProduct);
};

/** Adds a shared product and, optionally, the creating store's price — atomically. */
export const createProduct = (userId, { barcode, productName, priceCents }) => {
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = stmts.insert.run({ barcode, productName, createdBy: userId });
    const id = Number(lastInsertRowid);
    if (priceCents != null) stmts.setPrice.run({ userId, productId: id, priceCents });
    db.exec('COMMIT');
    return findById(userId, id);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
};

export const updateProduct = (userId, id, { barcode, productName }) => {
  const { changes } = stmts.update.run({ id, barcode, productName });
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

// ---------- Quick picks (per store) ----------
export const listFavorites = (userId) => stmts.favorites.all({ userId }).map(toProduct);

/** Pins a product to this store's quick picks. Returns false if the store already has the maximum. */
export const addFavorite = (userId, productId) => {
  if (stmts.countFavorites.get({ userId }).n >= MAX_FAVORITES) return false;
  stmts.addFavorite.run({ userId, productId });
  return true;
};

export const removeFavorite = (userId, productId) => stmts.removeFavorite.run({ userId, productId }).changes > 0;

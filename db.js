import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.resolve('data', 'pricechecker.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

// `id` is the internal database key (auto-generated, never edited).
// `product_id` is the business/product identifier the admin manages.
// Prices are stored as integer cents to avoid floating-point rounding errors.
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id   TEXT    NOT NULL UNIQUE,
    barcode      TEXT    NOT NULL UNIQUE,
    product_name TEXT    NOT NULL,
    price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

const COLUMNS = 'id, product_id, barcode, product_name, price_cents, created_at, updated_at';

const toProduct = (row) =>
  row && {
    id: row.id,
    productId: row.product_id,
    barcode: row.barcode,
    productName: row.product_name,
    price: row.price_cents / 100,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const stmts = {
  byBarcode: db.prepare(`SELECT ${COLUMNS} FROM products WHERE barcode = $barcode`),
  byId: db.prepare(`SELECT ${COLUMNS} FROM products WHERE id = $id`),
  list: db.prepare(`
    SELECT ${COLUMNS} FROM products
    WHERE $q = '' OR barcode LIKE $like OR product_id LIKE $like OR product_name LIKE $like
    ORDER BY product_name COLLATE NOCASE`),
  insert: db.prepare(`
    INSERT INTO products (product_id, barcode, product_name, price_cents)
    VALUES ($productId, $barcode, $productName, $priceCents)`),
  update: db.prepare(`
    UPDATE products
    SET product_id = $productId, barcode = $barcode, product_name = $productName,
        price_cents = $priceCents, updated_at = datetime('now')
    WHERE id = $id`),
  remove: db.prepare('DELETE FROM products WHERE id = $id'),
};

export const findByBarcode = (barcode) => toProduct(stmts.byBarcode.get({ barcode }));
export const findById = (id) => toProduct(stmts.byId.get({ id }));

export const listProducts = (q = '') => {
  const like = `%${q.replace(/[%_]/g, '')}%`;
  return stmts.list.all({ q, like }).map(toProduct);
};

export const createProduct = (p) => {
  const { lastInsertRowid } = stmts.insert.run(p);
  return findById(Number(lastInsertRowid));
};

export const updateProduct = (id, p) => {
  const { changes } = stmts.update.run({ ...p, id });
  return changes ? findById(id) : null;
};

export const deleteProduct = (id) => stmts.remove.run({ id }).changes > 0;

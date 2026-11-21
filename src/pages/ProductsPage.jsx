import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useMoney } from '../money.js';
import ProductForm from '../components/ProductForm.jsx';
import PriceForm from '../components/PriceForm.jsx';

/** The shared product list, with this store's prices. Admins can also edit/delete products. */
export default function ProductsPage() {
  const { user } = useAuth();
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [pricedOnly, setPricedOnly] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | product (admin edit)
  const [pricing, setPricing] = useState(null); // product id whose price is being edited
  const [error, setError] = useState('');
  const money = useMoney();

  const onError = useCallback((err) => {
    if (err.status !== 401) setError(err.message);
  }, []);

  const load = useCallback(
    () => api.listProducts({ q: query, pricedOnly }).then(setProducts).catch(onError),
    [query, pricedOnly, onError]
  );

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const replace = (p) => setProducts((list) => list.map((x) => (x.id === p.id ? p : x)));

  const clearPrice = async (p) => {
    if (!confirm(`Remove your price for "${p.productName}"?`)) return;
    try {
      await api.clearPrice(p.id);
      pricedOnly ? load() : replace({ ...p, price: null });
    } catch (err) {
      onError(err);
    }
  };

  const remove = async (p) => {
    if (!confirm(`Delete "${p.productName}" (barcode ${p.barcode}) for ALL stores? Every store's price for it is deleted too.`))
      return;
    try {
      await api.deleteProduct(p.id);
      load();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="admin">
      <div className="admin-toolbar">
        <h1>Products &amp; my prices</h1>
        <input
          type="search"
          placeholder="Search barcode, product ID or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="check">
          <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} />
          Only priced
        </label>
        <button onClick={() => setEditing('new')}>+ Add product</button>
      </div>

      {error && <p className="error">{error}</p>}

      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
          onError={onError}
        />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Barcode</th>
              <th>Product ID</th>
              <th className="num">My price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={5} className="muted center">
                  {query || pricedOnly ? 'No matching products.' : 'No products yet. Click “Add product” or scan one.'}
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.productName}</td>
                <td className="mono">{p.barcode}</td>
                <td>{p.productId}</td>
                <td className="num">
                  {pricing === p.id ? (
                    <PriceForm
                      product={p}
                      onCancel={() => setPricing(null)}
                      onError={onError}
                      onSaved={(saved) => {
                        setPricing(null);
                        replace(saved);
                      }}
                    />
                  ) : p.price != null ? (
                    money(p.price)
                  ) : (
                    <span className="muted">not set</span>
                  )}
                </td>
                <td className="actions">
                  {pricing !== p.id && (
                    <button className="small" onClick={() => setPricing(p.id)}>
                      {p.price != null ? 'Change price' : 'Set price'}
                    </button>
                  )}
                  {p.price != null && pricing !== p.id && (
                    <button className="secondary small" onClick={() => clearPrice(p)}>
                      Remove price
                    </button>
                  )}
                  {user.isAdmin && (
                    <>
                      <button className="secondary small" onClick={() => setEditing(p)}>
                        Edit
                      </button>
                      <button className="danger small" onClick={() => remove(p)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {products.length === 500 && <p className="muted">Showing the first 500 — search to narrow down.</p>}
    </div>
  );
}

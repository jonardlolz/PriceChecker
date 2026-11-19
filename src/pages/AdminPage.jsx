import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken } from '../api.js';
import { useMoney } from '../money.js';
import Login from '../components/Login.jsx';
import ProductForm from '../components/ProductForm.jsx';

export default function AdminPage() {
  const [authed, setAuthed] = useState(!!getToken());
  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  return (
    <ProductManager
      onLogout={() => {
        setToken(null);
        setAuthed(false);
      }}
    />
  );
}

function ProductManager({ onLogout }) {
  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [error, setError] = useState('');
  const money = useMoney();

  const handleAuthError = useCallback(
    (err) => {
      if (err.status === 401) onLogout();
      else setError(err.message);
    },
    [onLogout]
  );

  const load = useCallback(
    (q) => api.listProducts(q).then(setProducts).catch(handleAuthError),
    [handleAuthError]
  );

  useEffect(() => {
    const t = setTimeout(() => load(query), 200);
    return () => clearTimeout(t);
  }, [query, load]);

  const remove = async (p) => {
    if (!confirm(`Delete "${p.productName}" (Product ID ${p.productId}, barcode ${p.barcode})?`)) return;
    try {
      await api.deleteProduct(p.id);
      load(query);
    } catch (err) {
      handleAuthError(err);
    }
  };

  return (
    <div className="admin">
      <div className="admin-toolbar">
        <h1>Products</h1>
        <input
          type="search"
          placeholder="Search barcode, product ID or name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button onClick={() => setEditing('new')}>+ Add product</button>
        <button className="secondary" onClick={onLogout}>
          Sign out
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {editing && (
        <ProductForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load(query);
          }}
          onAuthError={handleAuthError}
        />
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>DB ID</th>
              <th>Product ID</th>
              <th>Barcode</th>
              <th>Product Name</th>
              <th className="num">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.length === 0 && (
              <tr>
                <td colSpan={6} className="muted center">
                  {query ? 'No matching products.' : 'No products yet. Click “Add product” to create one.'}
                </td>
              </tr>
            )}
            {products.map((p) => (
              <tr key={p.id}>
                <td className="muted">{p.id}</td>
                <td>{p.productId}</td>
                <td className="mono">{p.barcode}</td>
                <td>{p.productName}</td>
                <td className="num">{money(p.price)}</td>
                <td className="actions">
                  <button className="secondary small" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button className="danger small" onClick={() => remove(p)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

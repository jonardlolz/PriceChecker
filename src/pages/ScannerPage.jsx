import { useCallback, useEffect, useRef, useState } from 'react';
import CameraScanner from '../components/CameraScanner.jsx';
import ProductForm from '../components/ProductForm.jsx';
import PriceForm from '../components/PriceForm.jsx';
import { api } from '../api.js';
import { useMoney } from '../money.js';

const RESULT_TIMEOUT_MS = 10000;

export default function ScannerPage() {
  const [code, setCode] = useState('');
  // status: idle | loading | found | notfound | error
  // `editing` is set while the user is typing a price ('price') or adding a product ('add');
  // scans are ignored and the result stays on screen until they finish.
  const [state, setState] = useState({ status: 'idle' });
  const [camera, setCamera] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const editingRef = useRef(false);
  const money = useMoney();

  const editing = !!state.editing;
  editingRef.current = editing;

  const scheduleClear = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState({ status: 'idle' }), RESULT_TIMEOUT_MS);
  }, []);

  const show = useCallback(
    (next) => {
      setState(next);
      scheduleClear();
    },
    [scheduleClear]
  );

  const lookup = useCallback(
    async (raw) => {
      const barcode = raw.trim();
      if (!barcode || editingRef.current) return;
      clearTimeout(timerRef.current);
      setState({ status: 'loading', barcode });
      try {
        show({ status: 'found', product: await api.lookup(barcode) });
      } catch (err) {
        if (err.status === 401) return; // signed out — the app shows the sign-in screen
        show(err.status === 404 ? { status: 'notfound', barcode } : { status: 'error', message: err.message });
      }
    },
    [show]
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Keep the scan input focused so USB/Bluetooth "keyboard wedge" scanners always work,
  // except while the user is interacting with buttons or form fields.
  useEffect(() => {
    if (editing) return;
    const refocus = (e) => {
      if (!e?.target?.closest?.('button, input, select, textarea, label')) inputRef.current?.focus();
    };
    refocus();
    window.addEventListener('click', refocus);
    return () => window.removeEventListener('click', refocus);
  }, [editing]);

  const submit = (e) => {
    e.preventDefault();
    lookup(code);
    setCode('');
  };

  const startEditing = (kind) => {
    clearTimeout(timerRef.current);
    setState((s) => ({ ...s, editing: kind }));
  };

  const stopEditing = () => show({ ...state, editing: undefined });

  const onError = (err) => {
    if (err.status !== 401) show({ status: 'error', message: err.message });
  };

  const { product } = state;

  return (
    <div className="scanner-page">
      {state.editing !== 'add' && (
        <section className="result" aria-live="polite">
          {state.status === 'idle' && (
            <div className="result-idle">
              <div className="result-icon">▮▯▮▮▯▮</div>
              <h1>Scan a barcode to check the price</h1>
            </div>
          )}
          {state.status === 'loading' && <p className="muted">Looking up {state.barcode}…</p>}
          {state.status === 'found' && (
            <div className="result-found">
              {state.badge && <p className="badge">{state.badge}</p>}
              <p className="result-name">{product.productName}</p>
              {state.editing === 'price' ? (
                <PriceForm
                  product={product}
                  onCancel={stopEditing}
                  onError={onError}
                  onSaved={(p) => show({ status: 'found', product: p, badge: 'Price saved' })}
                />
              ) : product.price != null ? (
                <>
                  <p className="result-price">{money(product.price)}</p>
                  <button className="link" onClick={() => startEditing('price')}>
                    Change price
                  </button>
                </>
              ) : (
                <div className="no-price">
                  <p className="result-noprice">No price set for your store</p>
                  <button onClick={() => startEditing('price')}>Set your price</button>
                </div>
              )}
              <p className="muted">
                Product ID {product.productId} · Barcode {product.barcode}
              </p>
            </div>
          )}
          {state.status === 'notfound' && (
            <div className="result-missing">
              <p className="result-name">New barcode</p>
              <p className="muted">
                <span className="mono">{state.barcode}</span> isn’t in the product list yet.
              </p>
              <button onClick={() => startEditing('add')}>Add this product</button>
            </div>
          )}
          {state.status === 'error' && <p className="error">{state.message}</p>}
        </section>
      )}

      {state.editing === 'add' && (
        <ProductForm
          initial={{ barcode: state.barcode }}
          title="Add new product"
          onCancel={stopEditing}
          onError={onError}
          onSaved={(p) => show({ status: 'found', product: p, badge: 'Product added' })}
        />
      )}

      {!editing && (
        <form className="scan-form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan or type a barcode"
            inputMode="numeric"
            autoComplete="off"
            aria-label="Barcode"
          />
          <button type="submit">Check</button>
          <button type="button" className="secondary" onClick={() => setCamera((c) => !c)}>
            {camera ? 'Stop camera' : 'Use camera'}
          </button>
        </form>
      )}

      {camera && !editing && <CameraScanner onDetected={lookup} />}
    </div>
  );
}

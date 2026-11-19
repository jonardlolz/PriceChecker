import { useCallback, useEffect, useRef, useState } from 'react';
import CameraScanner from '../components/CameraScanner.jsx';
import Login from '../components/Login.jsx';
import ProductForm from '../components/ProductForm.jsx';
import { api, getToken, setToken } from '../api.js';
import { useMoney } from '../money.js';

const RESULT_TIMEOUT_MS = 10000;

export default function ScannerPage() {
  const [code, setCode] = useState('');
  // status: idle | loading | found | notfound | error
  // notfound may carry step: 'login' | 'form' while the user is adding the product
  const [state, setState] = useState({ status: 'idle' });
  const [camera, setCamera] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const addingRef = useRef(false);
  const money = useMoney();

  const adding = state.status === 'notfound' && !!state.step;
  addingRef.current = adding;

  const scheduleClear = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState({ status: 'idle' }), RESULT_TIMEOUT_MS);
  }, []);

  const lookup = useCallback(
    async (raw) => {
      const barcode = raw.trim();
      // Ignore scans while the add-product form is open so typed details aren't lost.
      if (!barcode || addingRef.current) return;
      clearTimeout(timerRef.current);
      setState({ status: 'loading', barcode });
      try {
        const product = await api.lookup(barcode);
        setState({ status: 'found', product });
      } catch (err) {
        setState(err.status === 404 ? { status: 'notfound', barcode } : { status: 'error', message: err.message });
      }
      scheduleClear();
    },
    [scheduleClear]
  );

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Keep the scan input focused so USB/Bluetooth "keyboard wedge" scanners always work,
  // except while the user is interacting with buttons or form fields.
  useEffect(() => {
    if (adding) return;
    const refocus = (e) => {
      if (!e?.target?.closest?.('button, input, select, textarea, label')) inputRef.current?.focus();
    };
    refocus();
    window.addEventListener('click', refocus);
    return () => window.removeEventListener('click', refocus);
  }, [adding]);

  const submit = (e) => {
    e.preventDefault();
    lookup(code);
    setCode('');
  };

  const startAdding = () => {
    clearTimeout(timerRef.current);
    setState((s) => ({ ...s, step: getToken() ? 'form' : 'login' }));
  };

  const cancelAdding = () => {
    setState((s) => ({ status: 'notfound', barcode: s.barcode }));
    scheduleClear();
  };

  return (
    <div className="scanner-page">
      {!adding && (
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
              {state.added && <p className="badge">Product added</p>}
              <p className="result-name">{state.product.productName}</p>
              <p className="result-price">{money(state.product.price)}</p>
              <p className="muted">
                Product ID {state.product.productId} · Barcode {state.product.barcode}
              </p>
            </div>
          )}
          {state.status === 'notfound' && (
            <div className="result-missing">
              <p className="result-name">New barcode</p>
              <p className="muted">
                <span className="mono">{state.barcode}</span> isn’t in the database yet.
              </p>
              <button onClick={startAdding}>Add this product</button>
            </div>
          )}
          {state.status === 'error' && <p className="error">{state.message}</p>}
        </section>
      )}

      {state.step === 'login' && (
        <Login
          className="card product-form"
          title="Add new product"
          note={`Sign in as admin to add barcode ${state.barcode}.`}
          onCancel={cancelAdding}
          onLogin={() => setState((s) => ({ ...s, step: 'form' }))}
        />
      )}

      {state.step === 'form' && (
        <ProductForm
          initial={{ barcode: state.barcode }}
          title="Add new product"
          autoFocusField="productName"
          onCancel={cancelAdding}
          onSaved={(product) => {
            setState({ status: 'found', product, added: true });
            scheduleClear();
          }}
          onAuthError={(err) => {
            if (err.status === 401) {
              setToken(null);
              setState((s) => ({ ...s, step: 'login' }));
            } else {
              setState({ status: 'error', message: err.message });
            }
          }}
        />
      )}

      {!adding && (
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

      {camera && !adding && <CameraScanner onDetected={lookup} />}
    </div>
  );
}

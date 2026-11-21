import { useCallback, useEffect, useRef, useState } from 'react';
import CameraScanner from '../components/CameraScanner.jsx';
import Modal from '../components/Modal.jsx';
import ProductForm from '../components/ProductForm.jsx';
import PriceForm from '../components/PriceForm.jsx';
import QuickPicks, { PinButton } from '../components/QuickPicks.jsx';
import { api } from '../api.js';
import { useMoney } from '../money.js';

const RESULT_TIMEOUT_MS = 10000;
const LIST_TIMEOUT_MS = 30000; // search results take longer to read through
const SEARCH_LIMIT = 20;

// Typed text that is only digits is treated as a barcode; anything else is also searched by name.
const isNumeric = (s) => /^\d+$/.test(s);

export default function ScannerPage() {
  const [code, setCode] = useState('');
  // status: idle | loading | found | notfound | results | error
  // `editing` is set while the user is typing a price ('price') or adding a product ('add');
  // scans are ignored and the result stays on screen until they finish.
  const [state, setState] = useState({ status: 'idle' });
  const [camera, setCamera] = useState(false);
  const [picks, setPicks] = useState([]);
  const [pinBusy, setPinBusy] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const editingRef = useRef(false);
  const cameraRef = useRef(false);
  const modalRef = useRef(false);
  const money = useMoney();

  const editing = !!state.editing;
  // While the camera is on, results open in a pop-up over the camera view, so phone users
  // can act on a scan (set price, add product) without scrolling. Scanning pauses meanwhile.
  const modal = camera && state.status !== 'idle';
  editingRef.current = editing;
  cameraRef.current = camera;
  modalRef.current = modal;

  const loadPicks = useCallback(() => api.favorites().then(setPicks).catch(() => {}), []);
  useEffect(() => {
    loadPicks();
  }, [loadPicks]);

  const show = useCallback((next, ms = RESULT_TIMEOUT_MS) => {
    setState(next);
    clearTimeout(timerRef.current);
    // In the camera pop-up, only a found price closes by itself (back to scanning); anything
    // that needs a decision ("Add this product", search results, errors) waits for the user.
    if (cameraRef.current && next.status !== 'found') return;
    timerRef.current = setTimeout(() => setState({ status: 'idle' }), ms);
  }, []);

  const showProduct = useCallback((product, badge) => show({ status: 'found', product, badge }), [show]);

  const close = useCallback(() => {
    clearTimeout(timerRef.current);
    setState({ status: 'idle' });
  }, []);

  const onError = useCallback(
    (err) => {
      if (err.status !== 401) show({ status: 'error', message: err.message }); // 401 → app shows sign-in
    },
    [show]
  );

  /** Barcode first; if `searchByName`, fall back to searching product names. */
  const lookup = useCallback(
    async (raw, { searchByName = false } = {}) => {
      const text = raw.trim();
      if (!text || editingRef.current) return;
      clearTimeout(timerRef.current);
      setState({ status: 'loading', text });
      try {
        return showProduct(await api.lookup(text));
      } catch (err) {
        if (err.status !== 404) return onError(err);
      }
      if (!searchByName || isNumeric(text)) return show({ status: 'notfound', barcode: text });
      try {
        const items = await api.listProducts({ q: text, limit: SEARCH_LIMIT });
        if (items.length === 1) showProduct(items[0]);
        else show({ status: 'results', text, items }, LIST_TIMEOUT_MS);
      } catch (err) {
        onError(err);
      }
    },
    [show, showProduct, onError]
  );

  // Camera keeps running behind the pop-up; ignore what it sees until the pop-up is closed.
  const onCameraScan = useCallback((text) => !modalRef.current && lookup(text), [lookup]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  // Keep the scan input focused so USB/Bluetooth "keyboard wedge" scanners always work,
  // except while editing, or while the camera is on (on phones the keyboard would cover it).
  useEffect(() => {
    if (editing || camera) return;
    const refocus = (e) => {
      if (!e?.target?.closest?.('button, input, select, textarea, label, .modal')) inputRef.current?.focus();
    };
    refocus();
    window.addEventListener('click', refocus);
    return () => window.removeEventListener('click', refocus);
  }, [editing, camera]);

  const submit = (e) => {
    e.preventDefault();
    lookup(code, { searchByName: true });
    setCode('');
    if (camera) inputRef.current?.blur(); // hide the phone keyboard so the pop-up is fully visible
  };

  const startEditing = (kind) => {
    clearTimeout(timerRef.current);
    setState((s) => ({ ...s, editing: kind }));
  };

  const stopEditing = () => show({ ...state, editing: undefined });

  const togglePin = async (product) => {
    setPinBusy(true);
    try {
      const on = !product.isFavorite;
      await api.setFavorite(product.id, on);
      showProduct({ ...product, isFavorite: on }, on ? 'Added to quick picks' : 'Removed from quick picks');
      loadPicks();
    } catch (err) {
      onError(err);
    } finally {
      setPinBusy(false);
    }
  };

  const { product } = state;

  const resultView = (
    <section className="result" aria-live="polite">
      {state.status === 'idle' && (
        <div className="result-idle">
          <div className="result-icon">▮▯▮▮▯▮</div>
          <h1>Scan a barcode or type a product name</h1>
        </div>
      )}
      {state.status === 'loading' && <p className="muted">Looking up {state.text}…</p>}

      {state.status === 'found' && (
        <div className="result-found">
          {state.badge && <p className="badge">{state.badge}</p>}
          <p className="result-name">{product.productName}</p>
          {state.editing === 'price' ? (
            <PriceForm
              product={product}
              onCancel={stopEditing}
              onError={onError}
              onSaved={(p) => {
                showProduct(p, 'Price saved');
                if (p.isFavorite) loadPicks();
              }}
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
          <div className="result-meta">
            <span className="muted">
              ID {product.id}
              {product.barcode ? ` · Barcode ${product.barcode}` : ' · No barcode'}
            </span>
            {!state.editing && <PinButton product={product} onToggle={togglePin} busy={pinBusy} />}
          </div>
        </div>
      )}

      {state.status === 'results' && (
        <div className="result-list">
          <p className="muted">
            {state.items.length
              ? `${state.items.length === SEARCH_LIMIT ? 'First ' : ''}${state.items.length} matches for “${state.text}”`
              : `No product matches “${state.text}”.`}
          </p>
          {state.items.length > 0 && (
            <ul>
              {state.items.map((p) => (
                <li key={p.id}>
                  <button type="button" className="secondary result-item" onClick={() => showProduct(p)}>
                    <span>{p.productName}</span>
                    <span className={p.price != null ? 'quick-price' : 'quick-price none'}>
                      {p.price != null ? money(p.price) : 'no price'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className={state.items.length ? 'link' : ''} onClick={() => startEditing('add')}>
            Add “{state.text}” as a new product
          </button>
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
  );

  const panel =
    state.editing === 'add' ? (
      <ProductForm
        initial={state.status === 'results' ? { productName: state.text } : { barcode: state.barcode }}
        title="Add new product"
        onCancel={stopEditing}
        onError={onError}
        onPick={(p) => showProduct(p)}
        onSaved={(p) => showProduct(p, 'Product added')}
      />
    ) : (
      resultView
    );

  // Without the camera, editing replaces the page; with the camera it happens inside the pop-up.
  const hideControls = editing && !modal;

  return (
    <div className="scanner-page">
      {!modal && panel}

      {!hideControls && (
        <form className="scan-form" onSubmit={submit}>
          <input
            ref={inputRef}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Scan a barcode or type a name"
            autoComplete="off"
            aria-label="Barcode or product name"
          />
          <button type="submit">Check</button>
          <button type="button" className="secondary" onClick={() => setCamera((c) => !c)}>
            {camera ? 'Stop camera' : 'Use camera'}
          </button>
        </form>
      )}

      {/* Paused while a form is open, so the form's own "Scan" button can use the camera. */}
      {camera && !editing && <CameraScanner onDetected={onCameraScan} />}

      {!hideControls && <QuickPicks items={picks} onPick={(p) => showProduct(p)} />}

      {modal && (
        <Modal label="Scan result" onClose={close} dismissible={!editing}>
          {panel}
          {!editing && state.status !== 'loading' && (
            <button type="button" className="modal-next" onClick={close}>
              Scan next
            </button>
          )}
        </Modal>
      )}
    </div>
  );
}

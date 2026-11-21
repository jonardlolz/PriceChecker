import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useMoney } from '../money.js';
import CameraScanner from './CameraScanner.jsx';
import { Field } from './Login.jsx';

const EMPTY = { barcode: '', productName: '', price: '' };

/**
 * Add a new shared product (any store; includes "your price"), or edit an existing
 * shared product (admin only; no price — prices are edited per store).
 * Pass `initial` with an `id` to edit; without an `id` (e.g. `{ barcode }` or `{ productName }`)
 * to prefill a new one. `onPick(product)` is called when the user picks an existing product
 * from the "Did you mean…?" suggestions instead of adding a duplicate.
 */
export default function ProductForm({ initial, title, onCancel, onSaved, onError, onPick, autoFocusField = 'productName' }) {
  const isEdit = initial?.id != null;
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(initial && {
      barcode: initial.barcode ?? '',
      productName: initial.productName ?? '',
    }),
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  const similar = useSimilar(isEdit ? '' : form.productName);
  const money = useMoney();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const saved = isEdit ? await api.updateProduct(initial.id, form) : await api.createProduct(form);
      onSaved(saved);
    } catch (err) {
      if (Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else onError(err);
      setBusy(false);
    }
  };

  return (
    <form className="card product-form" onSubmit={submit}>
      <h2>{title ?? (isEdit ? `Edit shared product #${initial.id}` : 'Add product')}</h2>
      <p className="muted">
        {isEdit
          ? 'Changes apply to every store. Prices are not affected.'
          : 'The product is shared with all stores. Your price is only for your store.'}
      </p>
      <div className="grid">
        <Field label="Product Name" error={errors.productName}>
          <input
            value={form.productName}
            onChange={set('productName')}
            placeholder="e.g. Itlog (large), per piece"
            autoFocus={autoFocusField === 'productName'}
          />
        </Field>
        {!isEdit && (
          <Field label="Your price (optional)" error={errors.price}>
            <input value={form.price} onChange={set('price')} inputMode="decimal" placeholder="0.00" />
          </Field>
        )}
        <Field label="Barcode (optional)" error={errors.barcode}>
          <div className="inline">
            <input value={form.barcode} onChange={set('barcode')} className="mono" placeholder="None — loose item" />
            <button type="button" className="secondary small" onClick={() => setCamera((c) => !c)}>
              {camera ? 'Close' : 'Scan'}
            </button>
          </div>
        </Field>
      </div>

      {similar.length > 0 && (
        <div className="similar">
          <p className="similar-title">Already in the list — is it one of these?</p>
          <ul>
            {similar.map((p) => (
              <li key={p.id}>
                <span className="similar-name">
                  {p.productName}
                  <small className="muted">
                    {' '}#{p.id}
                    {p.barcode && ` · ${p.barcode}`}
                    {p.price != null && ` · ${money(p.price)}`}
                  </small>
                </span>
                {onPick && (
                  <button type="button" className="secondary small" onClick={() => onPick(p)}>
                    Use this
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {camera && (
        <CameraScanner
          onDetected={(text) => {
            setForm((f) => ({ ...f, barcode: text }));
            setCamera(false);
          }}
        />
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          {busy ? 'Saving…' : similar.length ? 'Save as new product' : 'Save'}
        </button>
      </div>
    </form>
  );
}

/** Existing products with a similar name (debounced). */
function useSimilar(name) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setItems([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      api.similarProducts(trimmed).then((r) => !cancelled && setItems(r)).catch(() => {});
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name]);
  return items;
}

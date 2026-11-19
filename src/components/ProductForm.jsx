import { useState } from 'react';
import { api } from '../api.js';
import CameraScanner from './CameraScanner.jsx';

const EMPTY = { productId: '', barcode: '', productName: '', price: '' };

/**
 * Add/edit form. Pass `initial` with an `id` to edit an existing product;
 * pass `initial` without an `id` (e.g. `{ barcode }`) to prefill a new one.
 */
export default function ProductForm({ initial, title, onCancel, onSaved, onAuthError, autoFocusField = 'productId' }) {
  const isEdit = initial?.id != null;
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(initial && {
      productId: initial.productId ?? '',
      barcode: initial.barcode ?? '',
      productName: initial.productName ?? '',
      price: initial.price != null ? Number(initial.price).toFixed(2) : '',
    }),
  }));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const saved = isEdit ? await api.updateProduct(initial.id, form) : await api.createProduct(form);
      onSaved(saved);
    } catch (err) {
      if (Object.keys(err.fieldErrors || {}).length) setErrors(err.fieldErrors);
      else onAuthError(err);
      setBusy(false);
    }
  };

  return (
    <form className="card product-form" onSubmit={submit}>
      <h2>{title ?? (isEdit ? `Edit product (DB ID ${initial.id})` : 'Add product')}</h2>
      <div className="grid">
        <Field label="Product Name" error={errors.productName}>
          <input value={form.productName} onChange={set('productName')} autoFocus={autoFocusField === 'productName'} />
        </Field>
        <Field label="Price" error={errors.price}>
          <input value={form.price} onChange={set('price')} inputMode="decimal" placeholder="0.00" />
        </Field>
        <Field label="Product ID" error={errors.productId}>
          <input value={form.productId} onChange={set('productId')} autoFocus={autoFocusField === 'productId'} />
        </Field>
        <Field label="Barcode" error={errors.barcode}>
          <div className="inline">
            <input value={form.barcode} onChange={set('barcode')} className="mono" />
            <button type="button" className="secondary small" onClick={() => setCamera((c) => !c)}>
              {camera ? 'Close' : 'Scan'}
            </button>
          </div>
        </Field>
      </div>
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
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

function Field({ label, error, children }) {
  return (
    <label className={error ? 'field has-error' : 'field'}>
      <span>{label}</span>
      {children}
      {error && <small className="error">{error}</small>}
    </label>
  );
}
